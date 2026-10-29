// Open-Meteo: API 키 없이 쓸 수 있어 정적 사이트(GitHub Pages)에 적합
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
// 좌표 → 지역명 변환 (키 불필요, 클라이언트용 무료 엔드포인트)
const REVERSE_GEO_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

// 위치 권한이 없거나 위치를 못 가져올 때 보여줄 기본 위치
export const DEFAULT_LOCATION = {
  lat: 35.17987,
  lon: 128.56085,
  name: "경상남도 창원시 마산합포구 해운동",
};

export const KIND_LABELS = { default: "기본 위치", mine: "현재 위치", picked: "선택한 위치" };

// WMO 날씨 코드 → [설명, 아이콘]
const WEATHER_CODES = {
  0: ["맑음", "☀️"],
  1: ["대체로 맑음", "🌤️"],
  2: ["구름 조금", "⛅"],
  3: ["흐림", "☁️"],
  45: ["안개", "🌫️"],
  48: ["짙은 안개", "🌫️"],
  51: ["약한 이슬비", "🌦️"],
  53: ["이슬비", "🌦️"],
  55: ["강한 이슬비", "🌧️"],
  56: ["어는 이슬비", "🌧️"],
  57: ["강한 어는 이슬비", "🌧️"],
  61: ["약한 비", "🌦️"],
  63: ["비", "🌧️"],
  65: ["강한 비", "🌧️"],
  66: ["어는 비", "🌧️"],
  67: ["강한 어는 비", "🌧️"],
  71: ["약한 눈", "🌨️"],
  73: ["눈", "🌨️"],
  75: ["강한 눈", "❄️"],
  77: ["싸락눈", "🌨️"],
  80: ["약한 소나기", "🌦️"],
  81: ["소나기", "🌧️"],
  82: ["강한 소나기", "⛈️"],
  85: ["약한 눈 소나기", "🌨️"],
  86: ["강한 눈 소나기", "❄️"],
  95: ["뇌우", "⛈️"],
  96: ["우박 동반 뇌우", "⛈️"],
  99: ["강한 우박 동반 뇌우", "⛈️"],
};

export function describe(code) {
  return WEATHER_CODES[code] || ["알 수 없음", "❔"];
}

export function geoErrorMessage(err) {
  switch (err.code) {
    case 1: return "위치 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.";
    case 2: return "현재 위치를 확인할 수 없습니다.";
    case 3: return "위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.";
    default: return err.message || "위치 정보를 가져오지 못했습니다.";
  }
}

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

export async function fetchPlaceName(lat, lon) {
  try {
    const params = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: "ko" });
    const res = await fetch(`${REVERSE_GEO_URL}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    // 행정구역 단계(adminLevel): 2 국가, 4 시·도, 6 시·군·구, 7 일반구, 8 읍·면·동
    // 동 단위는 여러 개가 올 수 있어 대표값인 locality를 쓴다
    const regions = (data.localityInfo?.administrative || [])
      .filter((a) => a.adminLevel > 2 && a.adminLevel < 8)
      .sort((a, b) => a.order - b.order)
      .map((a) => a.name);
    const parts = [...regions, data.locality].filter(Boolean);
    return [...new Set(parts)].join(" ") || null;
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
