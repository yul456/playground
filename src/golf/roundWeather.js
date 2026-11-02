// 골프 라운드 날씨: 골프장 찾기, Open-Meteo 예보·지난 날씨 받기, 라운드 시간대 요약·평가, 공유
// Open-Meteo는 API 키가 필요 없어 정적 사이트에서 바로 부를 수 있다
import { describeWeather } from "../shared/weatherCodes.js";
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
// 라운드하기 좋은 날 기준. 하나라도 보통(fair) 기준에 닿으면 보통, 나쁨(bad) 기준에 닿으면 나쁨
export const RATING = {
  chance: { fair: 30, bad: 60 }, // 비 올 확률(%) 이상
  rain: { fair: 0.5, bad: 2 }, // 라운드 동안 내리는 비(mm) 이상
  wind: { fair: WINDY_SPEED, bad: 9 }, // 바람(m/s) 이상
  gust: { fair: WINDY_GUST, bad: 15 }, // 돌풍(m/s) 이상
  cold: { fair: 0, bad: -5 }, // 체감 온도(°) 이하
  hot: { fair: 30, bad: 33 }, // 기온(°) 이상
};
export const GRADE_LABELS = { good: "좋음", fair: "보통", bad: "나쁨" };
const GRADE_SHARE = { good: "✅ 라운드하기 좋음", fair: "⚠️ 라운드 날씨 보통", bad: "⛔ 라운드 날씨 나쁨" };

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
export const parseDate = (iso) => new Date(`${iso}T00:00:00`);
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
// "내일 · 11월 3일 (화)". relative가 false면 "11월 3일 (화)"만 쓴다 (공유한 글은 다른 날 읽을 수도 있다)
export function dateLabel(iso, relative = true) {
  const text = parseDate(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" });
  const near = relative && NEAR_DAYS[daysFromToday(iso)];
  return near ? `${near} · ${text}` : text;
}

// "11월 3일"
export const monthDayLabel = (iso) => parseDate(iso).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });

// "2026-11-03T06:47" → "06:47"
export const clockOf = (iso) => iso.slice(11, 16);

const minutesOf = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// 라운드가 끝나는 시각 "HH:MM"
export function roundEnd(tee, holes) {
  const end = minutesOf(tee) + ROUND_HOURS[holes] * 60;
  return `${pad(Math.floor(end / 60) % 24)}:${pad(end % 60)}`;
}

// date의 티오프부터 라운드가 끝날 때까지 걸치는 시각의 값들 (예: 07:30 티오프 18홀 → 7시~13시).
// hours에 다음 날 값도 있으면 자정을 넘기는 야간 라운드도 끝까지 넣는다
export function roundHours(hours, date, tee, holes) {
  const start = minutesOf(tee) / 60;
  const end = start + ROUND_HOURS[holes];
  const next = addDays(date, 1);
  return hours.filter((h) => {
    const at = h.date === date ? h.hour : h.date === next ? h.hour + 24 : -1;
    return at >= Math.floor(start) && at <= Math.ceil(end);
  });
}

// 해가 떠 있을 때 치는 라운드인지 보고, 아니면 알려 줄 문장을 돌려준다
export function daylightWarning(day, tee, holes) {
  const start = minutesOf(tee);
  const end = start + ROUND_HOURS[holes] * 60;
  const sunrise = clockOf(day.sunrise);
  const sunset = clockOf(day.sunset);
  if (start >= minutesOf(sunset)) return `해가 진 뒤(${sunset})에 시작하는 야간 라운드입니다.`;
  if (start < minutesOf(sunrise)) return `티오프가 해 뜨는 시각(${sunrise})보다 이릅니다.`;
  if (end > minutesOf(sunset)) return `라운드가 해 지는 시각(${sunset}) 뒤에 끝납니다.`;
  return null;
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

// 시간대 날씨를 바뀌는 차례대로 적는다 (예: "☁️ 흐림 → 🌧️ 비"). 많으면 앞의 셋만
export function weatherSteps(rows) {
  const steps = [];
  for (const r of rows) {
    const [desc, icon] = describeWeather(r.code);
    const step = `${icon} ${desc}`;
    if (!steps.includes(step)) steps.push(step);
  }
  return steps.slice(0, 3).join(" → ");
}

const levelAtOrAbove = (v, { fair, bad }) => (v >= bad ? 2 : v >= fair ? 1 : 0);
const levelAtOrBelow = (v, { fair, bad }) => (v <= bad ? 2 : v <= fair ? 1 : 0);
const GRADES = ["good", "fair", "bad"];

// 라운드 시간대 요약으로 좋음·보통·나쁨을 정하고, 가장 걸리는 이유를 붙인다 (좋음이면 이유 없음)
export function rateRound(s) {
  const feelsMin = (s.feels ?? s.temp)[0];
  const checks = [
    { level: levelAtOrAbove(s.chance?.chance ?? 0, RATING.chance), reason: `비 올 확률 ${s.chance?.chance}%` },
    { level: levelAtOrAbove(s.rain, RATING.rain), reason: `비 ${fmt(s.rain, 1)}mm` },
    { level: levelAtOrAbove(s.wind?.wind ?? 0, RATING.wind), reason: `바람 ${fmt(s.wind?.wind, 1)}m/s` },
    { level: levelAtOrAbove(s.gust?.gust ?? 0, RATING.gust), reason: `돌풍 ${fmt(s.gust?.gust, 1)}m/s` },
    { level: levelAtOrBelow(feelsMin, RATING.cold), reason: `체감 ${fmt(feelsMin)}°` },
    { level: levelAtOrAbove(s.temp[1], RATING.hot), reason: `기온 ${fmt(s.temp[1])}°` },
  ];
  // 등급이 같으면 앞에 둔 이유(비 → 바람 → 기온)를 먼저 보여 준다
  const worst = checks.reduce((a, b) => (b.level > a.level ? b : a), { level: 0, reason: null });
  return { grade: GRADES[worst.level], reason: worst.reason };
}

// 지난 해들의 라운드 시간대 요약과, 비 온 해 수, 평균 기온 범위
export function summarizeHistory(history, tee, holes) {
  const years = history
    .map(({ year, date, hours }) => ({ year, s: summarize(roundHours(hours, date, tee, holes)) }))
    .filter((y) => y.s);
  if (!years.length) return null;
  const average = (pick) => years.reduce((sum, y) => sum + pick(y.s), 0) / years.length;
  return {
    years,
    rainy: years.filter((y) => y.s.rain >= RAINY_ROUND_MM).length,
    temp: [average((s) => s.temp[0]), average((s) => s.temp[1])],
  };
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
    date: time.slice(0, 10),
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

// 앞으로 16일의 시간별 예보(hours)와 날마다 일출·일몰(days: [{ date, sunrise, sunset }]).
// 골프장마다 한 번 받아 좋은 날 찾기와 그날 예보가 함께 쓴다
export function fetchForecast(place) {
  return cached(`forecast ${placeKey(place)}`, async () => {
    const data = await getJson(FORECAST_URL, {
      latitude: place.lat,
      longitude: place.lon,
      hourly: `${HOURLY},precipitation_probability`,
      daily: "sunrise,sunset",
      // 골프장 현지 시각으로 받는다
      timezone: "auto",
      wind_speed_unit: "ms",
      forecast_days: FORECAST_DAYS,
    }, "예보");
    return {
      hours: toHours(data.hourly),
      days: data.daily.time.map((date, i) => ({ date, sunrise: data.daily.sunrise[i], sunset: data.daily.sunset[i] })),
    };
  });
}

const isLeapYear = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// 지난 몇 해 같은 날의 시간별 날씨: [{ year, date, hours }]. 최근 해부터.
// 자정을 넘기는 야간 라운드를 위해 다음 날까지 받는다.
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
        end_date: addDays(iso, 1),
      }, "지난 날씨");
      return { year: y, date: iso, hours: toHours(data.hourly) };
    });
    const loaded = results.filter((r) => !r.error);
    if (!loaded.length) throw results[0].error;
    // 빠진 해가 있으면 다음에 열 때 다시 받도록 기억해 두지 않는다
    if (loaded.length < results.length) cache.delete(key);
    return loaded;
  });
}

// --- 공유 ---

// 단톡방에 붙여 넣을 라운드 날씨 요약. 아직 예보가 없는 날은 지난 해 기록으로 대신한다
export function shareText({ course, date, tee, holes }, forecast, history, link) {
  const lines = [
    `⛳ ${course.name}${course.region ? ` (${course.region})` : ""}`,
    `📅 ${dateLabel(date, false)} ${tee}~${roundEnd(tee, holes)} · ${holes}홀`,
  ];
  const day = forecast?.days.find((d) => d.date === date);
  const rows = day ? roundHours(forecast.hours, date, tee, holes) : [];
  const s = summarize(rows);
  const past = !s && history ? summarizeHistory(history, tee, holes) : null;
  if (s) {
    const { grade, reason } = rateRound(s);
    const chance = !s.chance ? "정보 없음" : s.chance.chance > 0 ? `최대 ${s.chance.chance}%` : "0%";
    lines.push(
      `${GRADE_SHARE[grade]}${reason ? ` (${reason})` : ""}`,
      weatherSteps(rows),
      `🌡️ ${fmt(s.temp[0])}~${fmt(s.temp[1])}°${s.feels ? ` (체감 ${fmt(s.feels[0])}~${fmt(s.feels[1])}°)` : ""}`,
      `💧 비 올 확률 ${chance} · ${fmt(s.rain, 1)}mm`,
      `💨 바람 최대 ${fmt(s.wind?.wind, 1)}m/s · 돌풍 ${fmt(s.gust?.gust, 1)}m/s${s.dir != null ? ` · ${windName(s.dir)}` : ""}`,
      `🌅 일출 ${clockOf(day.sunrise)} · 일몰 ${clockOf(day.sunset)}`,
    );
  } else if (past) {
    lines.push(
      `🗓️ 아직 예보 전이라 지난 ${past.years.length}년 같은 날 기록: 비 온 해 ${past.rainy}번, 기온 평균 ${fmt(past.temp[0])}~${fmt(past.temp[1])}°`,
    );
  }
  lines.push(link);
  return lines.join("\n");
}

// 받은 사람이 열면 같은 골프장·날짜·티오프로 날씨 탭이 열리는 링크. 골프장 이름은 좌표로 다시 찾는다
export function shareLink({ course, date, tee, holes }, base) {
  const params = new URLSearchParams({
    lat: course.lat.toFixed(4),
    lon: course.lon.toFixed(4),
    d: date.replaceAll("-", ""),
    t: tee.replace(":", ""),
    h: String(holes),
  });
  return `${base}?${params}`;
}

// 공유 링크로 들어왔으면 그 골프장·날짜·티오프를 돌려준다. 아니면 null
export function settingsFromLink(search) {
  const p = new URLSearchParams(search);
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  const d = p.get("d") ?? "";
  const t = p.get("t") ?? "";
  const valid = p.has("lat") && p.has("lon") && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
    && /^\d{8}$/.test(d) && /^\d{4}$/.test(t);
  if (!valid) return null;
  const near = nearestCourse(lat, lon);
  return {
    course: { name: near?.name ?? "공유받은 위치", region: near?.region ?? "", lat, lon },
    date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`,
    tee: `${t.slice(0, 2)}:${t.slice(2)}`,
    holes: p.get("h") === "9" ? 9 : 18,
  };
}
