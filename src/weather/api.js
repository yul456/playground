// Open-Meteo: API 키 없이 쓸 수 있어 정적 사이트(GitHub Pages)에 적합
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
// 좌표 → 지역명 변환: OpenStreetMap의 Nominatim (키 불필요, 결과는 OpenStreetMap 데이터라 화면에 출처를 표시한다).
// 이용 정책: 초당 1번 이하, 같은 좌표는 다시 묻지 않기, 출처 표시. 입력하는 대로 묻는 검색(자동완성)은 금지지만
// 여기서는 위치가 정해질 때 한 번만 묻는다. https://operations.osmfoundation.org/policies/nominatim/
// 전에는 BigDataCloud의 무료 클라이언트용 주소를 썼는데, 그 주소는 기기의 현재 위치를 바꿀 때만 쓰게 되어 있어서
// 지도에서 고른 곳(과 새로고침 때 다시 쓰는 좌표)에는 쓸 수 없었다 (2026-11-12 바꿈)
const REVERSE_GEO_URL = "https://nominatim.openstreetmap.org/reverse";
// 두 요청 사이에 둘 간격(ms). 정책은 초당 1번 이하다
const REVERSE_GAP_MS = 1100;

// 위치 권한이 없거나 위치를 못 가져올 때 보여줄 기본 위치
export const DEFAULT_LOCATION = {
  lat: 35.17987,
  lon: 128.56085,
  name: "경상남도 창원시 마산합포구 해운동",
};

export const KIND_LABELS = { default: "기본 위치", mine: "현재 위치", picked: "선택한 위치" };

export async function fetchWeather(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    wind_speed_unit: "ms",
  });
  const res = await fetch(`${WEATHER_URL}?${params}`);
  if (!res.ok) throw new Error(`날씨 정보를 가져오지 못했습니다. (HTTP ${res.status})`);
  return res.json();
}

// Nominatim 주소(address)의 칸을 큰 단위부터 놓은 순서. 우리나라는 시·도(province·state·city) → 시·군·구
// (city·county·borough·city_district) → 읍·면·동·리(town·village·suburb·quarter)로 온다
const ADDRESS_ORDER = ["state", "province", "city", "county", "borough", "city_district", "town", "village", "suburb", "quarter", "neighbourhood"];
// 이 글자로 끝나는 이름(읍·면·동·리·가)이 나오면 거기서 멈춘다. 행정동과 법정동이 함께 와도("명동", "을지로1가") 하나만 쓴다
const SMALLEST = /(읍|면|동|리|가)$/;

// 주소 칸에서 "경상남도 창원시 마산합포구 해운동" 같은 이름을 만든다. 나라 이름과 우편번호는 쓰지 않는다
export function placeNameOf(address) {
  const parts = [];
  for (const key of ADDRESS_ORDER) {
    const name = address?.[key]?.trim();
    // 같은 이름이나 앞 이름으로 시작하는 이름(마루노우치 → 마루노우치1초메)은 건너뛴다
    if (!name || parts.includes(name) || (parts.length && name.startsWith(parts.at(-1)))) continue;
    parts.push(name);
    if (SMALLEST.test(name)) break;
  }
  return parts.join(" ") || null;
}

// 찾은 이름을 좌표(소수 넷째 자리, 약 10m)별로 기억한다. 새로고침이나 같은 곳을 다시 골라도 다시 묻지 않는다
const placeNames = new Map();
let lastAsked = 0;
let latestAsk = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchPlaceName(lat, lon) {
  const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  if (placeNames.has(key)) return placeNames.get(key);
  // 초당 1번을 넘지 않게 앞 요청과 간격을 둔다. 기다리는 동안 다른 곳을 고르면 이 요청은 하지 않는다
  // (화면은 마지막에 고른 곳만 보여 준다)
  const ask = ++latestAsk;
  for (let wait = lastAsked + REVERSE_GAP_MS - Date.now(); wait > 0; wait = lastAsked + REVERSE_GAP_MS - Date.now()) {
    await sleep(wait);
  }
  if (ask !== latestAsk) return null;
  lastAsked = Date.now();
  try {
    const params = new URLSearchParams({
      format: "jsonv2",
      lat,
      lon,
      zoom: 14, // 동네(읍·면·동) 단계
      layer: "address", // 가게 같은 장소가 아니라 주소로 답하게 한다
      addressdetails: 1,
      "accept-language": "ko",
    });
    const res = await fetch(`${REVERSE_GEO_URL}?${params}`);
    if (!res.ok) return null;
    const name = placeNameOf((await res.json()).address);
    if (name) placeNames.set(key, name);
    return name;
  } catch {
    // 지역명은 부가 정보라 실패해도 좌표로 대신 표시
    return null;
  }
}

export function formatDay(dateStr, index) {
  if (index === 0) return "오늘";
  if (index === 1) return "내일";
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
}

export function placeLabel({ lat, lon, placeName }) {
  return placeName || `위도 ${lat.toFixed(3)}, 경도 ${lon.toFixed(3)}`;
}
