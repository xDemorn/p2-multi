# Build context: repository root (the server also needs client/public/assets/map.tmj)
FROM node:22-bookworm-slim AS deps

WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
# Native modules (better-sqlite3, argon2) use prebuilds, but keep a compiler
# available in case a matching prebuild is missing.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=10000 \
    DB_PATH=/data/data.db \
    UPLOAD_DIR=/data/uploads \
    MAP_PATH=/app/client/public/assets/map.tmj

WORKDIR /app/server
COPY --from=deps /app/server/node_modules ./node_modules
COPY server/ ./
COPY client/public/assets/map.tmj /app/client/public/assets/map.tmj
COPY server/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data

EXPOSE 10000

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "index.js"]
