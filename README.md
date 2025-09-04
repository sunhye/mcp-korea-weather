# mcp-korea-weather (Cloudflare Worker)

한국 기상청 초단기실황/초단기예보를 MCP(Server) 프로토콜로 제공하는 Cloudflare Worker입니다.  
SSE(`text/event-stream`)과 JSON-RPC 2.0을 지원하며, Smithery/스미드리 스타일의 MCP 레지스트리에 등록해 바로 사용 가능합니다.

## 구조
```
.
├─ src/workers.ts          # MCP 서버 구현 (initialize / notifications/initialized / tools/list / tools/call)
├─ wrangler.toml           # Cloudflare Workers 배포 설정
├─ package.json            # 스크립트 및 개발 의존성
├─ tsconfig.json
└─ README.md
```

## 요구사항
- Node 18+
- Cloudflare Wrangler (`npm i -g wrangler` 또는 로컬 devDependencies 사용)

## 빠른 시작
```bash
# 1) 의존성 설치
npm i

# 2) 로컬 개발 서버 (http://127.0.0.1:8787)
npm run dev

# 3) 배포
npm run deploy
```

## 환경변수
`wrangler.toml`의 [vars] 섹션으로 환경변수를 주입합니다.

- `KMA_API_BASE_URL` : 기상청 API 베이스 URL
- `KMA_SERVICE_KEY`  : 기상청 인증키
- `DEFAULT_PAGE_NO`  : 기본 페이지 번호 (문자열)
- `DEFAULT_NUM_OF_ROWS` : 기본 행 수 (문자열)
- `DEFAULT_DATA_TYPE` : `JSON` 권장
- (선택) `CORS_ALLOW_ORIGIN`, `ALLOWED_ORIGINS` : CORS 허용 도메인(쉼표 구분)

> 보안상 운영 환경에서는 `KMA_SERVICE_KEY`를 wrangler secret으로 관리하는 것을 권장합니다.
> 예) `wrangler secret put KMA_SERVICE_KEY` 후, `vars`에서 제거하고 `env`로 참조

## 엔드포인트
- `GET /health` : 상태 확인
- `GET /?stream=true[&sessionId=...]` : SSE 연결(프로토콜/세션 헤더 포함)
- `POST /` : JSON-RPC 2.0 (MCP 메서드 처리)

응답 헤더는 아래를 포함합니다.
- `mcp-session-id`
- `mcp-protocol-version`

## 지원 메서드
- `initialize`
- `notifications/initialized`
- `tools/list`
- `tools/call`

### tools
1) `get_korea_weather` — 초단기실황  
**인자**: `latitude`, `longitude` (문자열)  
**결과**: 텍스트 요약(기온/강수/풍속/습도) + 내부 nx/ny, 기준시각

2) `get_korea_forecast` — 초단기예보  
**인자**: `latitude`, `longitude` (문자열)  
**결과**: 가까운 미래 3개 타임슬롯 요약(기온/하늘상태/강수형태/강수확률)

## 호출 예시

### 1) JSON-RPC (단일 요청)
```bash
curl -s -X POST http://127.0.0.1:8787/   -H 'content-type: application/json'   -H 'accept: application/json'   --data '{
    "jsonrpc": "2.0",
    "id": "1",
    "method": "tools/call",
    "params": {
      "name": "get_korea_weather",
      "arguments": { "latitude": "37.5665", "longitude": "126.9780" }
    }
  }'
```

### 2) SSE 스트림 모드
```bash
curl -N -X POST http://127.0.0.1:8787/   -H 'accept: text/event-stream'   -H 'mcp-session-id: session_demo'   -H 'mcp-protocol-version: 2025-06-18'   --data '{
    "jsonrpc": "2.0",
    "id": "2",
    "method": "tools/call",
    "params": {
      "name": "get_korea_forecast",
      "arguments": { "latitude": "37.5665", "longitude": "126.9780" }
    }
  }'
```

## Smithery/스미드리 등록 팁
- MCP 서버 URL: 배포된 Worker의 루트(`/`)
- **Accept** 헤더: `application/json` 또는 `text/event-stream` (SSE 권장)
- 초기화 순서:
  1. `initialize`
  2. `notifications/initialized`
  3. `tools/list`
  4. `tools/call` (`get_korea_weather` / `get_korea_forecast`)

## 참고
- 재시도: 429/5xx 지수 백오프(최대 5회)
- items 비어있을 때: 기준시각을 최대 5회, 1시간 단위 과거로 롤백 재조회
- 위경도→격자 변환: 기상청 LCC 좌표계 구현
- 기준시각 계산: 실황(HH00), 예보(HH30) 안전 버퍼 반영