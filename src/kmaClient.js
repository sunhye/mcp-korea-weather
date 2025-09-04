import { httpGetJson, fmtDateTimeBaseForUltraSrtObs, fmtDateTimeBaseForUltraSrtFcst, toGrid, nowKST } from "./utils.js";

const DEFAULT_NUM_OF_ROWS = process.env.DEFAULT_NUM_OF_ROWS || "60";
const DEFAULT_DATA_TYPE = process.env.DEFAULT_DATA_TYPE || "JSON";
const KMA_BASE = process.env.KMA_API_BASE_URL || "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0";
const KMA_KEY = process.env.KMA_SERVICE_KEY;

function buildUrl(path, params) {
  const u = new URL(path, KMA_BASE + "/");
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function fetchWithFallbacks(type, lat, lon) {
  if (!KMA_KEY) throw new Error("Missing KMA_SERVICE_KEY env");
  const { nx, ny } = toGrid(Number(lat), Number(lon));

  const maxAttempts = 5;
  let dt = nowKST();

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { base_date, base_time } = type === "obs"
      ? fmtDateTimeBaseForUltraSrtObs(dt)
      : fmtDateTimeBaseForUltraSrtFcst(dt);

    const path = type === "obs" ? "getUltraSrtNcst" : "getUltraSrtFcst";
    const url = buildUrl(path, {
      serviceKey: KMA_KEY,
      pageNo: "1",
      numOfRows: DEFAULT_NUM_OF_ROWS,
      dataType: DEFAULT_DATA_TYPE,
      base_date, base_time, nx, ny
    });

    try {
      const json = await httpGetJson(url);
      const items = json?.response?.body?.items?.item || [];
      if (items.length > 0) {
        return { items, nx, ny, base_date, base_time };
      }
    } catch (e) {
      // continue fallback
    }

    // Roll back an hour and retry
    dt = new Date(dt.getTime() - 3600000);
  }
  throw new Error("No items returned after fallback attempts");
}

export async function getUltraSrtNcst(lat, lon) {
  return await fetchWithFallbacks("obs", lat, lon);
}

export async function getUltraSrtFcst(lat, lon) {
  return await fetchWithFallbacks("fcst", lat, lon);
}

export function summarizeObs(items) {
  // Categories: T1H(기온), RN1(강수량), WSD(풍속), REH(습도)
  const pick = (c) => items.find(x => x.category === c)?.obsrValue;
  const T1H = pick("T1H");
  const RN1 = pick("RN1");
  const WSD = pick("WSD");
  const REH = pick("REH");
  let s = [];
  if (T1H != null) s.push(`기온 ${T1H}°C`);
  if (REH != null) s.push(`습도 ${REH}%`);
  if (WSD != null) s.push(`풍속 ${WSD} m/s`);
  if (RN1 != null) s.push(`강수 ${RN1} mm`);
  return s.join(", ");
}

export function summarizeFcst(items) {
  // PTY(강수형태), POP(강수확률), SKY(하늘상태), T1H(기온)
  // pick earliest 3 slots
  const byTime = {};
  for (const it of items) {
    const key = `${it.fcstDate}-${it.fcstTime}`;
    byTime[key] = byTime[key] || {};
    byTime[key][it.category] = it.fcstValue;
  }
  const keys = Object.keys(byTime).sort().slice(0, 3);
  const mapSKY = { "1": "맑음", "3": "구름많음", "4": "흐림" };
  const mapPTY = { "0": "없음", "1": "비", "2": "비/눈", "3": "눈", "4": "소나기" };
  return keys.map(k => {
    const v = byTime[k];
    const sky = v["SKY"] && mapSKY[v["SKY"]] || "";
    const pty = v["PTY"] && mapPTY[v["PTY"]] || "";
    const pop = v["POP"] != null ? `${v["POP"]}%` : "";
    const t1h = v["T1H"] != null ? `${v["T1H"]}°C` : "";
    return `${k} → ${t1h} ${sky} ${pty} 강수확률 ${pop}`.replace(/\s+/g, " ").trim();
  });
}