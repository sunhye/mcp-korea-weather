// KMA LCC DFS coordinate conversion (WGS84 -> grid nx, ny)
export function toGrid(lat, lon) {
  // constants
  const RE = 6371.00877; // km
  const GRID = 5.0;      // km
  const SLAT1 = 30.0 * Math.PI / 180.0;
  const SLAT2 = 60.0 * Math.PI / 180.0;
  const OLON = 126.0 * Math.PI / 180.0;
  const OLAT = 38.0 * Math.PI / 180.0;
  const XO = 43; // ref x
  const YO = 136; // ref y

  const DEGRAD = Math.PI / 180.0;

  let re = RE / GRID;
  let sn = Math.tan(Math.PI * 0.25 + SLAT2 * 0.5) / Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
  sn = Math.log(Math.cos(SLAT1) / Math.cos(SLAT2)) / Math.log(sn);
  let sf = Math.tan(Math.PI * 0.25 + SLAT1 * 0.5);
  sf = Math.pow(sf, sn) * (Math.cos(SLAT1) / sn);
  let ro = Math.tan(Math.PI * 0.25 + OLAT * 0.5);
  ro = re * sf / Math.pow(ro, sn);

  let ra = Math.tan(Math.PI * 0.25 + (lat) * DEGRAD * 0.5);
  ra = re * sf / Math.pow(ra, sn);
  let theta = (lon) * DEGRAD - OLON;
  if (theta > Math.PI) theta -= 2.0 * Math.PI;
  if (theta < -Math.PI) theta += 2.0 * Math.PI;
  theta *= sn;

  const nx = Math.floor(ra * Math.sin(theta) + XO + 0.5);
  const ny = Math.floor(ro - ra * Math.cos(theta) + YO + 0.5);
  return { nx, ny };
}

export function nowKST() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  return new Date(utc + 9 * 3600000);
}

export function fmtDateTimeBaseForUltraSrtObs(kstDate = nowKST()) {
  // HH00 baseTime for obs
  const y = kstDate.getFullYear();
  const m = String(kstDate.getMonth() + 1).padStart(2, '0');
  const d = String(kstDate.getDate()).padStart(2, '0');
  const h = String(kstDate.getHours()).padStart(2, '0');
  return { base_date: `${y}${m}${d}`, base_time: `${h}00` };
}

export function fmtDateTimeBaseForUltraSrtFcst(kstDate = nowKST()) {
  // HH30 baseTime for fcst
  const y = kstDate.getFullYear();
  const m = String(kstDate.getMonth() + 1).padStart(2, '0');
  const d = String(kstDate.getDate()).padStart(2, '0');
  const h = String(kstDate.getHours()).padStart(2, '0');
  return { base_date: `${y}${m}${d}`, base_time: `${h}30` };
}

export async function httpGetJson(url) {
  const res = await fetch(url, { headers: { "accept": "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return await res.json();
}