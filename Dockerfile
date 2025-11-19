# Build arguments (can be overridden at build time)
ARG APP_VERSION=0.0.1
ARG RESTIC_VERSION=0.18.1
ARG RCLONE_VERSION=1.71.2

# Stage 1: Dependencies
FROM node:24-alpine AS deps

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# Copy workspace configuration files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json

# Install all dependencies (needed for building)
RUN pnpm install --frozen-lockfile

# Stage 2: Frontend Builder
FROM node:24-alpine AS frontend-builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# Copy dependencies from deps stage
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./package.json
COPY --from=deps /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /workspace/frontend/node_modules ./frontend/node_modules
COPY --from=deps /workspace/frontend/package.json ./frontend/package.json

# Copy frontend source code
COPY frontend ./frontend

# Build frontend
WORKDIR /workspace/frontend
RUN pnpm run build

# Stage 3: Backend Builder
FROM node:24-alpine AS backend-builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /workspace

# Copy dependencies from deps stage
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/package.json ./package.json
COPY --from=deps /workspace/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=deps /workspace/backend/node_modules ./backend/node_modules
COPY --from=deps /workspace/backend/package.json ./backend/package.json

# Copy backend source code
COPY backend ./backend

# Build backend (compile TypeScript)
WORKDIR /workspace/backend
RUN pnpm run build:pkg

# Generate database migrations
RUN npx drizzle-kit generate

# Stage 4: Production Dependencies
FROM node:24-alpine AS prod-deps

# Install pnpm and build tools for native modules
RUN corepack enable && corepack prepare pnpm@latest --activate && \
    apk add --no-cache python3 make g++

WORKDIR /workspace

# Copy workspace configuration
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json ./backend/package.json

# Install production dependencies only (allow scripts for better-sqlite3)
RUN pnpm install --prod --frozen-lockfile

# Remove build tools
RUN apk del python3 make g++

# Stage 5: Production Image
FROM node:24-alpine AS production

# Install wget for healthcheck
RUN apk add --no-cache wget

WORKDIR /app

# Copy compiled backend from builder
COPY --from=backend-builder /workspace/backend/dist ./dist
COPY --from=backend-builder /workspace/backend/drizzle ./drizzle
COPY --from=backend-builder /workspace/backend/loader.mjs ./loader.mjs
COPY --from=backend-builder /workspace/backend/package.json ./package.json

# Copy frontend build to public directory
COPY --from=frontend-builder /workspace/frontend/dist ./public

# Copy production node_modules (pnpm workspace structure)
# Copy the .pnpm virtual store
COPY --from=prod-deps /workspace/node_modules/.pnpm ./node_modules/.pnpm

# Create symlinks for each package in node_modules
# This replicates what pnpm does for workspace packages
RUN cd node_modules/.pnpm && \
    for dir in *; do \
        if [ -d "$dir/node_modules" ]; then \
            for pkg in $dir/node_modules/*; do \
                pkg_name=$(basename $pkg); \
                if [ ! -e "../$pkg_name" ]; then \
                    ln -s ".pnpm/$dir/node_modules/$pkg_name" "../$pkg_name" 2>/dev/null || true; \
                fi; \
            done; \
        fi; \
    done

# Create data directory
RUN mkdir -p /data /data/logs /data/db /data/config

# Download specific versions of restic and rclone binaries and place in system PATH
ARG TARGETARCH
ARG RESTIC_VERSION
ARG RCLONE_VERSION
RUN echo "Building for architecture: ${TARGETARCH}" && \
    echo "Installing restic v${RESTIC_VERSION} and rclone v${RCLONE_VERSION}" && \
    # Download restic
    if [ "${TARGETARCH}" = "amd64" ]; then \
        wget -q "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" -O /tmp/restic.bz2; \
    elif [ "${TARGETARCH}" = "arm64" ]; then \
        wget -q "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_arm64.bz2" -O /tmp/restic.bz2; \
    fi && \
    bunzip2 /tmp/restic.bz2 && \
    mv /tmp/restic /usr/local/bin/restic && \
    chmod +x /usr/local/bin/restic && \
    # Download rclone
    if [ "${TARGETARCH}" = "amd64" ]; then \
        wget -q "https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-amd64.zip" -O /tmp/rclone.zip; \
    elif [ "${TARGETARCH}" = "arm64" ]; then \
        wget -q "https://downloads.rclone.org/v${RCLONE_VERSION}/rclone-v${RCLONE_VERSION}-linux-arm64.zip" -O /tmp/rclone.zip; \
    fi && \
    apk add --no-cache unzip && \
    unzip -q /tmp/rclone.zip -d /tmp && \
    mv /tmp/rclone-*/rclone /usr/local/bin/rclone && \
    chmod +x /usr/local/bin/rclone && \
    rm -rf /tmp/rclone* && \
    apk del unzip && \
    # Verify installations (unset env vars to avoid conflicts with rclone flags)
    unset RESTIC_VERSION RCLONE_VERSION && \
    restic version && \
    rclone version

# Create Pluton wrapper scripts for rclone and restic
# These ensure the tools use Pluton's configuration from /data/config
RUN echo '#!/bin/sh' > /usr/local/bin/prclone && \
    echo '# Pluton Wrapper for rclone' >> /usr/local/bin/prclone && \
    echo '# This script ensures that rclone uses Pluton configuration.' >> /usr/local/bin/prclone && \
    echo 'exec /usr/local/bin/rclone --config /data/config/rclone.conf "$@"' >> /usr/local/bin/prclone && \
    chmod +x /usr/local/bin/prclone && \
    echo '#!/bin/sh' > /usr/local/bin/prestic && \
    echo '# Pluton Wrapper for restic' >> /usr/local/bin/prestic && \
    echo '# This script ensures that restic uses Pluton rclone binary and configuration.' >> /usr/local/bin/prestic && \
    echo 'export RCLONE_CONFIG=/data/config/rclone.conf' >> /usr/local/bin/prestic && \
    echo 'exec /usr/local/bin/restic -o rclone.program=/usr/local/bin/rclone "$@"' >> /usr/local/bin/prestic && \
    chmod +x /usr/local/bin/prestic

# Set environment variables
ARG APP_VERSION
ENV NODE_ENV=production \
    IS_DOCKER=true \
    SERVER_PORT=5173 \
    APP_VERSION=${APP_VERSION}

# Expose the application port
EXPOSE 5173

# Start the application with custom loader for extension-less imports
CMD ["node", "--loader", "./loader.mjs", "dist/index.js"]