# MCP Korea Weather - Dockerized with Miniflare
FROM node:20-alpine AS base

WORKDIR /app

# Install deps first (for caching)
COPY package.json package-lock.json* ./
RUN npm install --omit=peer || npm install

# Copy sources
COPY tsconfig.json ./
COPY src ./src

# Build worker (bundled ESM module)
RUN npm run build:worker

# Runtime stage
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production

# Copy build artifacts and node_modules
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/dist ./dist

EXPOSE 8787

# Run worker with Miniflare
CMD ["npx", "miniflare", "dist/worker.mjs", "--port=8787", "--modules", "--compatibility-date=2025-06-18"]
