# Node.js Fastify MCP server (Smithery-hardened)
FROM node:20-alpine

# Install tini for proper signal handling
RUN apk add --no-cache tini wget

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

# Create non-root user (use built-in node user)
USER node

# Copy and install dependencies
COPY --chown=node:node package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

# Copy source
COPY --chown=node:node src ./src

EXPOSE 8080

# Healthcheck on /health
HEALTHCHECK --interval=10s --timeout=5s --retries=12 CMD wget -qO- http://127.0.0.1:8080/health || exit 1

# Use tini as init to reap zombies & forward signals
ENTRYPOINT ["/sbin/tini","--"]

CMD ["node","src/server.js"]