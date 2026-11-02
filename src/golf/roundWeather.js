// 골프 라운드 날씨: 골프장 찾기, Open-Meteo 예보·지난 날씨 받기, 라운드 시간대 계산
// Open-Meteo는 API 키가 필요 없어 정적 사이트에서 바로 부를 수 있다
import { GOLF_COURSES } from "./golfCourses.js";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
// 지난 날씨는 관측소 기록이 아니라 재분석 자료(ERA5 등)다
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const HOURLY = "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,wind_direction_10m";

// 예보는 오늘부터 16일째까지만 나온다. 그 뒤 날짜를 물으면 400 오류가 난다
export const FORECAST_DAYS = 16;
// 고를 수 있는 날짜: 오늘부터 1년 뒤까지 (그 뒤는 지난 해 기록만 보게 된다)
export const MAX_DAYS_AHEAD = 365;
export const HISTORY_YEARS = 5;
// 라운드에 걸리는 시간 (그늘집·대기를 넣은 대략값)
export const ROUND_HOURS = { 18: 5, 9: 2.5 };
// 표에서 눈에 띄게 할 기준: 비 올 확률·시간당 비(mm), 바람·돌풍(m/s)
export const WET_CHANCE = 50;
export const WET_MM = 0.5;
export const WINDY_SPEED = 6;
export const WINDY_GUST = 10;
// 지난 해 라운드 시간에 이만큼 넘게 왔으면 "비 온 해"로 센다
export const RAINY_ROUND_MM = 1;

const pad = (n) => String(n).padStart(2, "0");

// 표에 쓸 숫자. 값이 없으면 "–", 소수 자리를 안 주면 반올림한다 (-0.4가 "-0"으로 나오지 않게)
export const fmt = (v, digits = 0) => (v == null ? "–" : digits ? v.toFixed(digits) : String(Math.round(v)));

// --- 골프장 찾기 ---

// 띄어쓰기·기호를 빼고, "컨트리클럽"과 "CC"처럼 섞어 쓰는 말을 하나로 맞춰 비교한다
function searchKey(text) {
  return text
    .toLowerCase()
    .replace(/[\s.,·()&_-]/g, "")
    .replace(/컨트리클럽|칸트리클럽|countryclub/g, "cc")
    .replace(/골프클럽|golfclub/g, "gc");
}

const COURSES = GOLF_COURSES.map(([name, lat, lon, region]) => ({ name, lat, lon, region, key: searchKey(name) }));

// 이름에 검색어가 들어간 골프장. 검색어로 시작하는 이름, 짧은 이름 순
export function searchCourses(query, limit = 8) {
  const q = searchKey(query);
  if (!q) return [];
  return COURSES.filter((c) => c.key.includes(q))
    .sort((a, b) => b.key.startsWith(q) - a.key.startsWith(q) || a.key.length - b.key.length)
    .slice(0, limit)
    .map(({ name, lat, lon, region }) => ({ name, lat, lon, region }));
}

// 골프장 정도 거리에서는 평면으로 봐도 충분하다
function distanceKm(lat1, lon1, lat2, lon2) {
  const x = (lon2 - lon1) * Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(x, lat2 - lat1) * 111.2;
}

// 지도에서 고른 곳(또는 현재 위치)이 골프장 중심에서 1.5km 안이면 그 골프장으로 본다
export function nearestCourse(lat, lon, maxKm = 1.5) {
  let best = null;
  let bestKm = maxKm;
  for (const c of COURSES) {
    const km = distanceKm(lat, lon, c.lat, c.lon);
    if (km <= bestKm) [best, bestKm] = [c, km];
  }
  return best && { name: best.name, region: best.region };
}

// --- 날짜·시간 ---

// 브라우저 시간대 기준 "YYYY-MM-DD"
const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseDate = (iso) => new Date(`${iso}T00:00:00`);
export const todayIso = () => isoDate(new Date());

export function addDays(iso, days) {
  const d = parseDate(iso);
  d.setDate(d.getDate() + days);
  return isoDate(d);
}

export const daysFromToday = (iso) => Math.round((parseDate(iso) - parseDate(todayIso())) / 86_400_000);

// 날짜 칸에 연도를 치는 동안에는 0202년 같은 값도 들어오므로 범위 안인지 확인한다
export function isPlannableDate(iso) {
  const days = daysFromToday(iso);
  return days >= 0 && days <= MAX_DAYS_AHEAD;
}

const NEAR_DAYS = ["오늘", "내일", "모레"];
// "내일 · 11월 3일 (화)"
export function dateLabel(iso) {
  const text = parseDate(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const near = NEAR_DAYS[daysFromToday(iso)];
  return near ? `${near} · ${text}` : text;
}

// "11월 3일"
export const monthDayLabel = (iso) => parseDate(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// 라운드가 끝나는 시각 "HH:MM"
export function roundEnd(tee, holes) {
  const end = minutesOf(tee) + ROUND_HOURS[holes] * 60;
  return `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

// 티오프부터 라운드가 끝날 때까지 걸치는 시각의 값들 (예: 07:30 티오프 18홀 → 7시~13시)
export function roundHours(hours, tee, holes) {
  const start = minutesOf(tee) / 60;
  const end = start + ROUND_HOURS[holes];
  return hours.filter((h) => h.hour >= Math.floor(start) && h.hour <= Math.ceil(end));
}

// --- 요약 ---

const values = (rows, key) => rows.map((r) => r[key]).filter((v) => v != null);
// key 값이 가장 큰 시각 (값이 하나도 없으면 null)
const peak = (rows, key) => rows.reduce((best, r) => (r[key] != null && (!best || r[key] > best[key]) ? r : best), null);

// 라운드 시간대의 기온 범위, 비, 바람, 대표 날씨를 모은다
export function summarize(rows) {
  const temps = values(rows, "temp");
  if (!temps.length) return null;
  const feels = values(rows, "feels");
  // 바람 세기를 실어 풍향을 평균 내면 주로 부는 쪽이 나온다
  let x = 0;
  let y = 0;
  for (const r of rows) {
    if (r.wind == null || r.dir == null) continue;
    x += r.wind * Math.sin((r.dir * Math.PI) / 180);
    y += r.wind * Math.cos((r.dir * Math.PI) / 180);
  }
  return {
    temp: [Math.min(...temps), Math.max(...temps)],
    feels: feels.length ? [Math.min(...feels), Math.max(...feels)] : null,
    chance: peak(rows, "chance"),
    rain: values(rows, "rain").reduce((sum, v) => sum + v, 0),
    wind: peak(rows, "wind"),
    gust: peak(rows, "gust"),
    dir: x || y ? (Math.atan2(x, y) * 180) / Math.PI : null,
    // 가장 궂은 날씨(코드 숫자가 클수록 궂다)를 대표 날씨로 본다
    code: Math.max(...values(rows, "code")),
  };
}

const DIRECTIONS = ["북", "북동", "동", "남동", "남", "남서", "서", "북서"];
// 풍향(바람이 불어오는 쪽, 북쪽 0°부터 시계 방향)을 8방위 이름으로
export function windName(deg) {
  return `${DIRECTIONS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]}풍`;
}

// --- 받아 오기 ---

// 탭을 오가며 같은 골프장·날짜를 다시 열 때는 10분 동안 받아 둔 값을 쓴다
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map();

function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;
  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  // 실패한 요청은 다음에 다시 시도하도록 지운다
  promise.catch(() => cache.delete(key));
  return promise;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Open-Meteo는 한 곳에서 동시에 많이 부르면 429(Too many concurrent requests)를 준다. 잠시 뒤 다시 부르면 대개 된다
async function getJson(url, params, what, retries = 2) {
  const res = await fetch(`${url}?${new URLSearchParams(params)}`);
  if (res.status === 429 && retries > 0) {
    await sleep(1500);
    return getJson(url, params, what, retries - 1);
  }
  if (!res.ok) throw new Error(`${what}를 가져오지 못했습니다. (HTTP ${res.status})`);
  return res.json();
}

// items를 한 번에 limit개씩만 처리한다. 실패한 것은 { error }로 돌려준다
async function mapLimit(items, limit, fn) {
  const results = [];
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]).catch((error) => ({ error }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function toHours(h) {
  return h.time.map((time, i) => ({
    hour: Number(time.slice(11, 13)),
    temp: h.temperature_2m[i],
    feels: h.apparent_temperature[i],
    chance: h.precipitation_probability?.[i] ?? null,
    rain: h.precipitation[i],
    code: h.weather_code[i],
    wind: h.wind_speed_10m[i],
    gust: h.wind_gusts_10m[i],
    dir: h.wind_direction_10m[i],
  }));
}

const placeKey = ({ lat, lon }) => `${lat.toFixed(3)},${lon.toFixed(3)}`;

// 그날의 시간별 예보와 일출·일몰
export function fetchForecast(place, date) {
  return cached(`forecast ${placeKey(place)} ${date}`, async () => {
    const data = await getJson(FORECAST_URL, {
      latitude: place.lat,
      longitude: place.lon,
      hourly: `${HOURLY},precipitation_probability`,
      daily: "sunrise,sunset",
      // 골프장 현지 시각으로 받는다
      timezone: "auto",
      wind_speed_unit: "ms",
      start_date: date,
      end_date: date,
    }, "예보");
    return { hours: toHours(data.hourly), sunrise: data.daily.sunrise[0], sunset: data.daily.sunset[0] };
  });
}

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// 지난 몇 해 같은 날의 시간별 날씨. 최근 해부터.
// 한 해에 한 번씩 불러야 해서 동시 요청 제한에 걸리지 않게 두 해씩 부르고, 일부 해만 못 받으면 받은 해만 돌려준다
export function fetchHistory(place, date) {
  const key = `history ${placeKey(place)} ${date}`;
  const [year, month, day] = date.split("-").map(Number);
  const years = Array.from({ length: HISTORY_YEARS }, (_, i) => year - 1 - i);
  return cached(key, async () => {
    const results = await mapLimit(years, 2, async (y) => {
      // 2월 29일은 윤년이 아닌 해에는 2월 28일로 본다
      const d = month === 2 && day === 29 && !isLeapYear(y) ? 28 : day;
      const iso = `${y}-${pad(month)}-${pad(d)}`;
      const data = await getJson(ARCHIVE_URL, {
        latitude: place.lat,
        longitude: place.lon,
        hourly: HOURLY,
        timezone: "auto",
        wind_speed_unit: "ms",
        start_date: iso,
        end_date: iso,
      }, "지난 날씨");
      return { year: y, hours: toHours(data.hourly) };
    });
    const loaded = results.filter((r) => !r.error);
    if (!loaded.length) throw results[0].error;
    // 빠진 해가 있으면 다음에 열 때 다시 받도록 기억해 두지 않는다
    if (loaded.length < results.length) cache.delete(key);
    return loaded;
  });
}
