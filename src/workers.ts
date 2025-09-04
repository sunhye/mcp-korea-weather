// workers.ts — Cloudflare Worker (MCP Streamable HTTP) - Korea Weather API
// 한국 기상청 초단기실황/예보 정보 조회 MCP 서버
// - 통신 오류(429/5xx, 네트워크) 지수 백오프 재시도(최대 5회)
// - 응답 OK지만 items 비어있을 때, 기준시각을 1시간씩 과거로 최대 5회 롤백 재조회

export interface Env {
    KMA_API_BASE_URL: string;
    KMA_SERVICE_KEY: string;
    DEFAULT_PAGE_NO: string;
    DEFAULT_NUM_OF_ROWS: string;
    DEFAULT_DATA_TYPE: string;  // "JSON" 권장
    CORS_ALLOW_ORIGIN?: string;
    ALLOWED_ORIGINS?: string;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [k: string]: JsonValue };
type JsonRpcId = number | string | null | undefined;

interface JsonRpcReq {
    jsonrpc: "2.0";
    id?: JsonRpcId;
    method: string;
    params?: any;
}

const LATEST_PROTOCOL_VERSION = "2025-06-18";

// CORS & 공통 헤더
const EXPOSE_HEADERS = "mcp-session-id, mcp-protocol-version";
const ALLOW_HEADERS = "authorization, content-type, mcp-session-id, mcp-protocol-version";
const ALLOW_METHODS = "POST, GET, OPTIONS";

const JSON_HEADERS = {
    "content-type": "application/json; charset=utf-8",
} as const;

// 세션 관리
type Session = {
    createdAt: number;
    ready: boolean;
    protocolVersion: string;
};

const sessions = new Map<string, Session>();

// 세션 생성
function createSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2)}`;
}

// CORS 헤더 생성
function createCorsHeaders(origin: string | null, env: Env): HeadersInit {
    const allowOrigin = env.CORS_ALLOW_ORIGIN || env.ALLOWED_ORIGINS || "*";
    return {
        "Access-Control-Allow-Origin": origin && allowOrigin.includes(origin) ? origin : allowOrigin,
        "Access-Control-Allow-Methods": ALLOW_METHODS,
        "Access-Control-Allow-Headers": ALLOW_HEADERS,
        "Access-Control-Expose-Headers": EXPOSE_HEADERS,
    };
}

// JSON-RPC 응답/에러
function jsonRpcResponse(id: JsonRpcId, result: any): JsonValue {
    return { jsonrpc: "2.0", id, result };
}
function jsonRpcError(id: JsonRpcId, code: number, message: string): JsonValue {
    return { jsonrpc: "2.0", id, error: { code, message } };
}

// -------------------------- 재시도 유틸 --------------------------

function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// -------------------------- KMA 호출 공통 --------------------------

/**
 * 한국 기상청 API 호출 - 공통 함수 (지수 백오프 재시도 + 선택적 유효성 검증)
 */
async function fetchKoreaApiData(
    endpoint: string,
    params: {
        serviceKey?: string;
        nx: string;
        ny: string;
        base_date: string;
        base_time: string;
        pageNo?: string;
        numOfRows?: string;
        dataType?: string;
    },
    env: Env,
    options?: {
        maxRetries?: number;              // 기본 5
        baseBackoffMs?: number;           // 기본 300ms
        validate?: (data: any) => boolean; // 응답 유효성 검사
    }
) {
    const apiUrl = `${env.KMA_API_BASE_URL}/${endpoint}`;
    const serviceKey = params.serviceKey || env.KMA_SERVICE_KEY;

    const queryParams = new URLSearchParams({
        ServiceKey: serviceKey,
        pageNo: params.pageNo || env.DEFAULT_PAGE_NO,
        numOfRows: params.numOfRows || env.DEFAULT_NUM_OF_ROWS,
        dataType: params.dataType || env.DEFAULT_DATA_TYPE,
        base_date: params.base_date,
        base_time: params.base_time,
        nx: params.nx,
        ny: params.ny,
    });

    const maxRetries = options?.maxRetries ?? 5;
    const baseBackoffMs = options?.baseBackoffMs ?? 300;
    const shouldValidate = options?.validate;

    let lastError: any;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await fetch(`${apiUrl}?${queryParams}`);

            // 재시도 대상 상태코드: 429, 5xx
            if (!res.ok) {
                const retriable = res.status === 429 || (res.status >= 500 && res.status <= 599);
                if (!retriable) {
                    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
                }
                throw new Error(`Retriable error: ${res.status} ${res.statusText}`);
            }

            // parse
            const wantJson = params.dataType === 'JSON' || env.DEFAULT_DATA_TYPE === 'JSON';
            const payload = wantJson ? await res.json() : await res.text();

            // 유효성 검증(필요 시)
            if (shouldValidate && !shouldValidate(payload)) {
                throw new Error('Empty or invalid payload (no items).');
            }

            return payload; // 성공
        } catch (err: any) {
            lastError = err;

            // 마지막 시도면 종료
            if (attempt === maxRetries) break;

            // 지수형 백오프 + 지터(0~100ms)
            const delay = baseBackoffMs * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 100);
            await sleep(delay);
        }
    }

    // 모두 실패
    throw new Error(
        `API request failed after ${maxRetries} attempts: ${lastError?.message || lastError}`
    );
}

// -------------------------- 응답 파서 --------------------------

const WEATHER_CATEGORIES: { [key: string]: string } = {
    'RN1': '1시간 강수량',
    'T1H': '기온',
    'UUU': '동서바람성분',
    'VVV': '남북바람성분',
    'WSD': '풍속',
    'SKY': '하늘상태',
    'PTY': '강수형태',
    'VEC': '풍향',
    'LGT': '낙뢰',
    'POP': '강수확률',
    'WAV': '파고',
    'PCP': '1시간 강수량',
    'REH': '습도',
    'SNO': '1시간 신적설'
};

const SKY_CONDITIONS: { [key: string]: string } = {
    '1': '맑음',
    '3': '구름많음',
    '4': '흐림'
};

const PRECIPITATION_TYPE: { [key: string]: string } = {
    '0': '없음',
    '1': '비',
    '2': '비/눈',
    '3': '눈',
    '4': '소나기'
};

function parseWeatherData(data: any): string {
    try {
        if (!data.response?.body?.items?.item || data.response.body.items.item.length === 0) {
            return JSON.stringify(data.response) + "기상 데이터를 가져올 수 없습니다.";
        }

        const items = data.response.body.items.item;
        const weatherInfo: { [key: string]: string } = {};

        // 가장 최신 데이터만 사용 (같은 시간대)
        const latestTime = items[0]?.baseTime;
        const latestDate = items[0]?.baseDate;

        items.forEach((item: any) => {
            if (item.baseTime === latestTime && item.baseDate === latestDate) {
                weatherInfo[item.category] = item.obsrValue;
            }
        });

        let result = `📍 기상 실황 정보 (${latestDate?.slice(0,4)}년 ${latestDate?.slice(4,6)}월 ${latestDate?.slice(6,8)}일 ${latestTime?.slice(0,2)}:${latestTime?.slice(2,4)})\n\n`;

        if (weatherInfo.T1H) {
            result += `🌡️ 기온: ${weatherInfo.T1H}°C\n`;
        }
        if (weatherInfo.RN1) {
            const rain = parseFloat(weatherInfo.RN1);
            if (rain > 0) {
                result += `🌧️ 1시간 강수량: ${weatherInfo.RN1}mm\n`;
            } else {
                result += `☀️ 강수: 없음\n`;
            }
        }
        if (weatherInfo.WSD) {
            result += `💨 풍속: ${weatherInfo.WSD}m/s\n`;
        }
        if (weatherInfo.REH) {
            result += `💧 습도: ${weatherInfo.REH}%\n`;
        }

        return result.trim();
    } catch (error) {
        return `기상 데이터 파싱 중 오류가 발생했습니다: ${error}`;
    }
}

function parseForecastData(data: any): string {
    try {
        if (!data.response?.body?.items?.item || data.response.body.items.item.length === 0) {
            return JSON.stringify(data.response) + "예보 데이터를 가져올 수 없습니다.";
        }

        const items = data.response.body.items.item;
        const forecastInfo: { [key: string]: { [key: string]: string } } = {};

        // 시간별로 그룹화
        items.forEach((item: any) => {
            const timeKey = `${item.fcstDate}_${item.fcstTime}`;
            if (!forecastInfo[timeKey]) {
                forecastInfo[timeKey] = {};
            }
            forecastInfo[timeKey][item.category] = item.fcstValue;
        });

        // 가장 가까운 미래 시간 3개 선택
        const sortedTimes = Object.keys(forecastInfo).sort().slice(0, 3);

        let result = `📍 초단기 예보 정보\n\n`;

        sortedTimes.forEach((timeKey, index) => {
            const [date, time] = timeKey.split('_');
            const info = forecastInfo[timeKey];

            result += `⏰ ${date.slice(4,6)}월 ${date.slice(6,8)}일 ${time.slice(0,2)}:${time.slice(2,4)}\n`;

            if (info.T1H) result += `🌡️ 기온: ${info.T1H}°C`;
            if (info.SKY) {
                const skyCondition = SKY_CONDITIONS[info.SKY] || info.SKY;
                result += ` | ☁️ 하늘: ${skyCondition}`;
            }
            if (info.PTY) {
                const precipType = PRECIPITATION_TYPE[info.PTY] || info.PTY;
                if (precipType !== '없음') result += ` | 🌧️ 강수: ${precipType}`;
            }
            if (info.POP) result += ` | 💧 강수확률: ${info.POP}%`;

            result += '\n';
            if (index < sortedTimes.length - 1) result += '\n';
        });

        return result.trim();
    } catch (error) {
        return `예보 데이터 파싱 중 오류가 발생했습니다: ${error}`;
    }
}

// -------------------------- 좌표 변환 --------------------------

interface LamcParameter {
    Re: number;      // 지구반경 [km]
    grid: number;    // 격자간격 [km]
    slat1: number;   // 표준위도1 [degree]
    slat2: number;   // 표준위도2 [degree]
    olon: number;    // 기준점 경도 [degree]
    olat: number;    // 기준점 위도 [degree]
    xo: number;      // 기준점 X좌표 [격자거리]
    yo: number;      // 기준점 Y좌표 [격자거리]
    first: boolean;  // 초기화 여부
}

let mapParams: LamcParameter | null = null;
let PI: number, DEGRAD: number, RADDEG: number;
let re: number, olon: number, olat: number, sn: number, sf: number, ro: number;

function initMapParameters(): void {
    if (mapParams?.first) return;

    PI = Math.asin(1.0) * 2.0;
    DEGRAD = PI / 180.0;
    RADDEG = 180.0 / PI;

    mapParams = {
        Re: 6371.00877,
        grid: 5.0,
        slat1: 30.0,
        slat2: 60.0,
        olon: 126.0,
        olat: 38.0,
        xo: 210 / 5.0,
        yo: 675 / 5.0,
        first: true
    };

    re = mapParams.Re / mapParams.grid;
    const slat1_rad = mapParams.slat1 * DEGRAD;
    const slat2_rad = mapParams.slat2 * DEGRAD;
    olon = mapParams.olon * DEGRAD;
    olat = mapParams.olat * DEGRAD;

    sn = Math.tan(PI * 0.25 + slat2_rad * 0.5) / Math.tan(PI * 0.25 + slat1_rad * 0.5);
    sn = Math.log(Math.cos(slat1_rad) / Math.cos(slat2_rad)) / Math.log(sn);
    sf = Math.tan(PI * 0.25 + slat1_rad * 0.5);
    sf = Math.pow(sf, sn) * Math.cos(slat1_rad) / sn;
    ro = Math.tan(PI * 0.25 + olat * 0.5);
    ro = re * sf / Math.pow(ro, sn);
}

function convertLatLonToGrid(lat: number, lon: number): { nx: number; ny: number } {
    initMapParameters();

    const ra = Math.tan(PI * 0.25 + lat * DEGRAD * 0.5);
    const raCalc = re * sf / Math.pow(ra, sn);
    let theta = lon * DEGRAD - olon;

    if (theta > PI) theta -= 2.0 * PI;
    if (theta < -PI) theta += 2.0 * PI;
    theta *= sn;

    const x = raCalc * Math.sin(theta) + mapParams!.xo;
    const y = ro - raCalc * Math.cos(theta) + mapParams!.yo;

    return {
        nx: Math.round(x + 1.5),
        ny: Math.round(y + 1.5)
    };
}

// -------------------------- 시간 계산 --------------------------

/**
 * 현재 시간 기준 KST로 base_date/base_time 계산
 * - 실황: 정시 발표, 안전하게 (분<40)면 직전시각 HH00
 * - 예보: 30분 발표, 안전하게 (분<70)면 직전시각 HH30
 */
function calculateApiDateTime(isNcst: boolean = true): { base_date: string; base_time: string } {
    const now = new Date();
    const kstOffset = 9 * 60; // UTC+9
    const kst = new Date(now.getTime() + (kstOffset * 60 * 1000));

    const year = kst.getFullYear();
    const month = String(kst.getMonth() + 1).padStart(2, '0');
    const date = String(kst.getDate()).padStart(2, '0');
    const hour = kst.getHours();
    const minute = kst.getMinutes();

    const base_date = `${year}${month}${date}`;

    if (isNcst) {
        let targetHour = hour;
        if (minute < 40) {
            targetHour = targetHour - 1;
            if (targetHour < 0) {
                const yesterday = new Date(kst);
                yesterday.setDate(yesterday.getDate() - 1);
                const prevYear = yesterday.getFullYear();
                const prevMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
                const prevDate = String(yesterday.getDate()).padStart(2, '0');
                return { base_date: `${prevYear}${prevMonth}${prevDate}`, base_time: "2300" };
            }
        }
        return { base_date, base_time: String(targetHour).padStart(2, '0') + "00" };
    } else {
        let targetHour = hour;
        if (minute < 70) { // 30분 + 40분 여유
            targetHour = targetHour - 1;
            if (targetHour < 0) {
                const yesterday = new Date(kst);
                yesterday.setDate(yesterday.getDate() - 1);
                const prevYear = yesterday.getFullYear();
                const prevMonth = String(yesterday.getMonth() + 1).padStart(2, '0');
                const prevDate = String(yesterday.getDate()).padStart(2, '0');
                return { base_date: `${prevYear}${prevMonth}${prevDate}`, base_time: "2330" };
            }
        }
        return { base_date, base_time: String(targetHour).padStart(2, '0') + "30" };
    }
}

// -------------------------- 응답 유효성 & 롤백 --------------------------

/** KMA JSON의 items.item 존재 여부 */
function hasItems(data: any): boolean {
    return !!(data?.response?.body?.items?.item && data.response.body.items.item.length > 0);
}

/** base_date/base_time을 한 스텝 이전으로 (실황: -60분 → HH00, 예보: -60분 → HH30) */
function stepBackBaseDateTime(
    base_date: string,
    base_time: string,
    isNcst: boolean
): { base_date: string; base_time: string } {
    const y = Number(base_date.slice(0, 4));
    const m = Number(base_date.slice(4, 6)) - 1; // 0-based
    const d = Number(base_date.slice(6, 8));
    const H = Number(base_time.slice(0, 2));

    const minute = isNcst ? 0 : 30;
    const dt = new Date(Date.UTC(y, m, d, H, minute));
    dt.setUTCMinutes(dt.getUTCMinutes() - 60);

    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    const HH = String(dt.getUTCHours()).padStart(2, "0");
    const MM = isNcst ? "00" : "30";

    return { base_date: `${yy}${mm}${dd}`, base_time: `${HH}${MM}` };
}

// -------------------------- API 래퍼 (롤백 포함) --------------------------

/**
 * 초단기실황 조회
 * - 통신/서버 오류: 내부에서 지수 백오프 재시도 (최대 5회)
 * - items 비어있음: 기준시각을 1시간씩 과거로 최대 5회 롤백 재조회
 */
async function fetchKoreaWeatherData(
    params: {
        serviceKey?: string;
        nx: string;
        ny: string;
        base_date: string;
        base_time: string;
        pageNo?: string;
        numOfRows?: string;
        dataType?: string;
    },
    env: Env
) {
    const maxBackSteps = 5;
    let p = { ...params };

    for (let step = 0; step <= maxBackSteps; step++) {
        const data = await fetchKoreaApiData("getUltraSrtNcst", p, env, {
            maxRetries: 5,
            baseBackoffMs: 300,
        });

        if (hasItems(data)) return data;

        if (step < maxBackSteps) {
            const prev = stepBackBaseDateTime(p.base_date, p.base_time, true);
            p = { ...p, ...prev };
            continue;
        }
        return data; // 마지막까지 비어있을 경우 그대로 반환(상위에서 안내)
    }

    throw new Error("Unexpected flow in fetchKoreaWeatherData");
}

/**
 * 초단기예보 조회
 * - 통신/서버 오류: 내부에서 지수 백오프 재시도 (최대 5회)
 * - items 비어있음: 기준시각을 1시간씩 과거로 최대 5회 롤백 재조회
 */
async function fetchKoreaForecastData(
    params: {
        serviceKey?: string;
        nx: string;
        ny: string;
        base_date: string;
        base_time: string;
        pageNo?: string;
        numOfRows?: string;
        dataType?: string;
    },
    env: Env
) {
    const maxBackSteps = 5;
    let p = { ...params };

    for (let step = 0; step <= maxBackSteps; step++) {
        const data = await fetchKoreaApiData("getUltraSrtFcst", p, env, {
            maxRetries: 5,
            baseBackoffMs: 300,
        });

        if (hasItems(data)) return data;

        if (step < maxBackSteps) {
            const prev = stepBackBaseDateTime(p.base_date, p.base_time, false);
            p = { ...p, ...prev };
            continue;
        }
        return data;
    }

    throw new Error("Unexpected flow in fetchKoreaForecastData");
}

// -------------------------- JSON-RPC 핸들러 --------------------------

async function processJsonRpcRequest(body: JsonRpcReq, session: Session, env: Env): Promise<JsonValue> {
    // initialize
    if (body.method === "initialize") {
        return jsonRpcResponse(body.id, {
            protocolVersion: LATEST_PROTOCOL_VERSION,
            capabilities: {
                tools: {},
            },
            serverInfo: {
                name: "Korea Weather",
                version: "1.0.0",
            },
        });
    }

    // initialized
    if (body.method === "notifications/initialized") {
        session.ready = true;
        return { jsonrpc: "2.0" };
    }

    // tools/list
    if (body.method === "tools/list") {
        return jsonRpcResponse(body.id, { tools: TOOLS });
    }

    // tools/call
    if (body.method === "tools/call") {
        const { name, arguments: args } = body.params || {};

        if (name === "get_korea_weather") {
            const {
                serviceKey,
                latitude,
                longitude,
                pageNo,
                numOfRows,
                dataType,
            } = args || {};

            if (!latitude || !longitude) {
                return jsonRpcError(body.id, -32602, "latitude, longitude are required parameters");
            }

            const { base_date, base_time } = calculateApiDateTime(true); // 실황
            const { nx, ny } = convertLatLonToGrid(parseFloat(latitude), parseFloat(longitude));

            const weatherData = await fetchKoreaWeatherData(
                { serviceKey, nx: nx.toString(), ny: ny.toString(), base_date, base_time, pageNo, numOfRows, dataType },
                env
            );

            return jsonRpcResponse(body.id, {
                content: [
                    {
                        type: "text",
                        text: `nx: ${nx}, ny: ${ny}, 기준일자:${base_date}, 기준시각: ${base_time}. \n` + parseWeatherData(weatherData),
                    },
                ],
            });
        }

        if (name === "get_korea_forecast") {
            const {
                serviceKey,
                latitude,
                longitude,
                pageNo,
                numOfRows,
                dataType,
            } = args || {};

            if (!latitude || !longitude) {
                return jsonRpcError(body.id, -32602, "latitude, longitude are required parameters");
            }

            const { base_date, base_time } = calculateApiDateTime(false); // 예보
            const { nx, ny } = convertLatLonToGrid(parseFloat(latitude), parseFloat(longitude));

            const forecastData = await fetchKoreaForecastData(
                { serviceKey, nx: nx.toString(), ny: ny.toString(), base_date, base_time, pageNo, numOfRows, dataType },
                env
            );

            return jsonRpcResponse(body.id, {
                content: [
                    {
                        type: "text",
                        text: `nx: ${nx}, ny: ${ny}, 기준일자:${base_date}, 기준시각: ${base_time}. \n` + parseForecastData(forecastData),
                    },
                ],
            });
        }

        return jsonRpcError(body.id, -32601, `Unknown tool: ${name}`);
    }

    return jsonRpcError(body.id, -32601, `Method not found: ${body.method}`);
}

// -------------------------- 도구 목록 --------------------------

const TOOLS = [
    {
        name: "get_korea_weather",
        description: "한국 기상청 초단기실황 정보를 조회합니다. 기온, 습도, 풍속, 강수량 등 현재 기상 상태를 제공합니다.",
        inputSchema: {
            type: "object",
            properties: {
                latitude: {
                    type: "string",
                    description: "위도 (도 단위, 소수점 가능, 예: 37.5665 - 서울시청)",
                },
                longitude: {
                    type: "string",
                    description: "경도 (도 단위, 소수점 가능, 예: 126.9780 - 서울시청)",
                },
            },
            required: ["latitude", "longitude"],
        },
    },
    {
        name: "get_korea_forecast",
        description: "한국 기상청 초단기예보 정보를 조회합니다. 향후 6시간 동안의 시간별 기온, 하늘상태, 강수확률 등을 제공합니다.",
        inputSchema: {
            type: "object",
            properties: {
                latitude: {
                    type: "string",
                    description: "위도 (도 단위, 소수점 가능, 예: 37.5665 - 서울시청)",
                },
                longitude: {
                    type: "string",
                    description: "경도 (도 단위, 소수점 가능, 예: 126.9780 - 서울시청)",
                },
            },
            required: ["latitude", "longitude"],
        },
    },
];

// -------------------------- Worker fetch --------------------------

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);
        const origin = request.headers.get("origin");
        const corsHeaders = createCorsHeaders(origin, env);

        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, { status: 200, headers: corsHeaders });
        }

        // Health check
        if (url.pathname === "/health" && request.method === "GET") {
            return new Response(JSON.stringify({ status: "ok", service: "korea-weather-mcp" }), {
                headers: { ...JSON_HEADERS, ...corsHeaders },
            });
        }

        // SSE 스트림 (GET ?stream=true)
        if (request.method === "GET" && url.searchParams.get("stream") === "true") {
            const sessionId = url.searchParams.get("sessionId") || createSessionId();

            const { readable, writable } = new TransformStream();
            const writer = writable.getWriter();

            const sseHeaders = {
                "Content-Type": "text/event-stream",
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                ...corsHeaders,
                "mcp-session-id": sessionId,
                "mcp-protocol-version": LATEST_PROTOCOL_VERSION,
            };

            if (!sessions.has(sessionId)) {
                sessions.set(sessionId, {
                    createdAt: Date.now(),
                    ready: false,
                    protocolVersion: LATEST_PROTOCOL_VERSION,
                });
            }

            // 초기 연결 이벤트
            writer.write(new TextEncoder().encode(`data: ${JSON.stringify({
                type: "connection",
                sessionId,
                protocolVersion: LATEST_PROTOCOL_VERSION
            })}\n\n`));

            return new Response(readable, { headers: sseHeaders });
        }

        // MCP JSON-RPC (POST)
        if (request.method === "POST") {
            try {
                const body: JsonRpcReq = await request.json();
                const sessionId = request.headers.get("mcp-session-id") || createSessionId();
                const protocolVersion = request.headers.get("mcp-protocol-version") || LATEST_PROTOCOL_VERSION;
                const streamResponse = request.headers.get("accept")?.includes("text/event-stream");

                if (!sessions.has(sessionId)) {
                    sessions.set(sessionId, {
                        createdAt: Date.now(),
                        ready: false,
                        protocolVersion,
                    });
                }
                const session = sessions.get(sessionId)!;

                // SSE 스트림 응답
                if (streamResponse) {
                    const { readable, writable } = new TransformStream();
                    const writer = writable.getWriter();

                    const sseHeaders = {
                        "Content-Type": "text/event-stream",
                        "Cache-Control": "no-cache",
                        "Connection": "keep-alive",
                        ...corsHeaders,
                        "mcp-session-id": sessionId,
                        "mcp-protocol-version": protocolVersion,
                    };

                    (async () => {
                        try {
                            const response = await processJsonRpcRequest(body, session, env);
                            await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(response)}\n\n`));
                        } catch (error: any) {
                            const errorResponse = jsonRpcError(body.id, -32603, error.message);
                            await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(errorResponse)}\n\n`));
                        } finally {
                            await writer.close();
                        }
                    })();

                    return new Response(readable, { headers: sseHeaders });
                }

                // 일반 JSON 응답
                const responseHeaders = {
                    ...JSON_HEADERS,
                    ...corsHeaders,
                    "mcp-session-id": sessionId,
                    "mcp-protocol-version": protocolVersion,
                };

                const response = await processJsonRpcRequest(body, session, env);
                return new Response(JSON.stringify(response), { headers: responseHeaders });
            } catch (error: any) {
                return new Response(
                    JSON.stringify(jsonRpcError(null, -32700, `Parse error: ${error.message}`)),
                    { headers: { ...JSON_HEADERS, ...corsHeaders } }
                );
            }
        }

        return new Response("Method Not Allowed", { status: 405, headers: corsHeaders });
    },
};
