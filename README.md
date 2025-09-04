# mcp-korea-weather (Fastify / Node.js)

Docker에서 바로 실행되는 Fastify(Node.js) MCP 서버입니다.

## Run (Docker)
```bash
docker build -t mcp-korea-weather .
docker run --rm -p 8787:8787   -e KMA_SERVICE_KEY=***   -e KMA_API_BASE_URL=https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0   mcp-korea-weather

curl -s http://127.0.0.1:8787/health
```

## MCP JSON-RPC
- `POST /` 로 JSON-RPC 2.0 요청 전송
- 메서드: `initialize`, `tools/list`, `tools/call`
- 툴: `get_korea_weather`, `get_korea_forecast`

### 예시
```bash
curl -s -X POST http://127.0.0.1:8787/   -H 'content-type: application/json'   --data '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/call",
    "params": {
      "name": "get_korea_weather",
      "arguments": { "latitude": "37.5665", "longitude": "126.9780" }
    }
  }'
```

## ENV
- `KMA_API_BASE_URL` (예: https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0)  
- `KMA_SERVICE_KEY`
- `DEFAULT_NUM_OF_ROWS` (기본 60)
- `DEFAULT_DATA_TYPE` (기본 JSON)

## 노트
- 위경도→격자(nx, ny) 변환은 기상청 LCC 변환식을 내장.
- 기준시각 보정(실황 HH00, 예보 HH30) 및 과거 재시도(최대 5회) 포함.