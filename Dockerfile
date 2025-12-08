# Dockerfile
# Uses pre-built binaries from scripts/build-executables.js
# Run "node scripts/build-executables.js" before building this image.

FROM debian:bookworm-slim

ARG TARGETARCH=amd64
ARG APP_VERSION=0.0.1

# Install runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    openssl \
    fuse \
    wget \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Select and install the correct architecture using bind mount to avoid copying all binaries to the image layer
RUN --mount=type=bind,source=dist/executables,target=/tmp/executables \
    set -e && \
    ARCH_SUFFIX=$( [ "$TARGETARCH" = "amd64" ] && echo "x64" || echo "arm64" ) && \
    SOURCE_DIR="/tmp/executables/pluton-linux-${ARCH_SUFFIX}" && \
    if [ ! -d "$SOURCE_DIR" ]; then \
        echo "Error: Directory $SOURCE_DIR not found"; \
        ls -R /tmp/executables; \
        exit 1; \
    fi && \
    # Copy application files (use /. to copy all contents including hidden files)
    cp -r "$SOURCE_DIR"/. /app/ && \
    chmod +x /app/pluton && \
    # Verify native modules were copied
    if [ ! -f "/app/node_modules/better-sqlite3/build/Release/better_sqlite3.node" ]; then \
        echo "Error: better_sqlite3.node not found after copy"; \
        ls -la /app/; \
        exit 1; \
    fi && \
    # Setup binaries
    mkdir -p /usr/local/bin && \
    cp "/app/binaries/linux-${ARCH_SUFFIX}/restic" /usr/local/bin/restic && \
    cp "/app/binaries/linux-${ARCH_SUFFIX}/rclone" /usr/local/bin/rclone && \
    chmod +x /usr/local/bin/restic /usr/local/bin/rclone && \
    # Remove duplicate binaries from app directory (they're now in /usr/local/bin)
    rm -rf /app/binaries

# Create wrappers
RUN echo '#!/bin/sh' > /usr/local/bin/prclone && \
    echo 'exec /usr/local/bin/rclone --config /data/config/rclone.conf "$@"' >> /usr/local/bin/prclone && \
    chmod +x /usr/local/bin/prclone && \
    echo '#!/bin/sh' > /usr/local/bin/prestic && \
    echo 'export RCLONE_CONFIG=/data/config/rclone.conf' >> /usr/local/bin/prestic && \
    echo 'exec /usr/local/bin/restic -o rclone.program=/usr/local/bin/rclone "$@"' >> /usr/local/bin/prestic && \
    chmod +x /usr/local/bin/prestic

# Create data directories
RUN mkdir -p /data/config /data/db /data/logs /data/backups /data/progress /data/rescue /data/restore /data/stats /data/sync

ENV NODE_ENV=production \
    IS_DOCKER=true \
    SERVER_PORT=5173 \
    APP_VERSION=${APP_VERSION} \
    PLUTON_DATA_DIR=/data \
    PATH="/usr/local/bin:$PATH"

EXPOSE 5173

CMD ["./pluton"]
