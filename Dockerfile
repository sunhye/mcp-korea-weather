# Smithery/mcpsdk server — explicit CLI build & runtime
FROM node:20-alpine AS build
WORKDIR /app

# Install build tools
RUN apk add --no-cache wget

# Copy package manifests first for caching
COPY package.json package-lock.json* ./
# Install ALL deps (dev + prod) so CLI and types are available
RUN if [ -f package-lock.json ]; then npm ci; else npm i; fi

# Copy source (TS/JS)
COPY . .

# Build mcpsdk entry with Smithery CLI (generates .smithery/index.cjs)
# If you have @smithery/cli in devDependencies, prefer: npx smithery build -o .smithery/index.cjs
RUN npx -y @smithery/cli@1.2.21 build -o .smithery/index.cjs

# -------- Runtime image --------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Install wget for healthcheck
RUN apk add --no-cache wget

# Copy only runtime artifacts
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

# Copy built server bundle
COPY --from=build /app/.smithery ./.smithery

EXPOSE 8080

# Healthcheck (server exposes /health)
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD wget -qO- http://127.0.0.1:8080/health || exit 1

# Run compiled server
CMD ["node", ".smithery/index.cjs"]