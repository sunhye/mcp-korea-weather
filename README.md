# mcp-korea-weather (Fastify / Node.js) — Smithery-hardened

- Cloudflare Workers 제외
- Docker 컨테이너에서 바로 실행 (PORT=8080, tini, non-root, healthcheck)
- MCP JSON-RPC: initialize / notifications/initialized / tools/list / tools/call

## Run (Docker)
```bash
docker build -t mcp-korea-weather .
docker run --rm -p 8080:8080   -e KMA_SERVICE_KEY=***   -e KMA_API_BASE_URL=https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0   mcp-korea-weather

curl -s http://127.0.0.1:8080/health
```