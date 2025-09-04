# Simple Node.js runtime for Fastify MCP server
FROM node:20-alpine
WORKDIR /app

# Install deps (copy package files first for caching)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm i --only=production; fi

# Copy source
COPY src ./src

EXPOSE 8787

# Healthcheck to ensure server is up
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:8787/health || exit 1

CMD ["node", "src/server.js"]