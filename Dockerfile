# Node.js runtime for Fastify MCP server (PORT=8080 for Smithery)
FROM node:20-alpine
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080

# Install deps (copy package files first for caching)
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --only=production; else npm i --only=production; fi

# Copy source
COPY src ./src

EXPOSE 8080

# Healthcheck (Smithery sidecar commonly expects 8080)
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/server.js"]