# Test toolchain only. Reuse the disposable native DB/client fixture; never deploy this image.
FROM pluton-phase5-real-db:local
USER root
WORKDIR /app
ENV CI=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY backend/jest.config.ts ./backend/jest.config.ts
# The base already built this exact SQLite version for this Node/libc runtime.
# Install existing lockfile test tools, without running project lifecycle scripts.
RUN cp /app/node_modules/.pnpm/better-sqlite3@12.2.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node /tmp/phase6-sqlite.node \
 && corepack enable && corepack prepare pnpm@10.20.0 --activate \
 && pnpm install --frozen-lockfile --ignore-scripts \
 && mkdir -p /app/node_modules/.pnpm/better-sqlite3@12.2.0/node_modules/better-sqlite3/build/Release \
 && install -m 0644 /tmp/phase6-sqlite.node /app/node_modules/.pnpm/better-sqlite3@12.2.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node \
 && rm /tmp/phase6-sqlite.node
HEALTHCHECK NONE
USER node
ENTRYPOINT ["/app/backend/node_modules/.bin/jest"]
