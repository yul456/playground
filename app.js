// Open-Meteo: API 키 없이 쓸 수 있어 정적 사이트(GitHub Pages)에 적합
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
// 좌표 → 지역명 변환 (키 불필요, 클라이언트용 무료 엔드포인트)
const REVERSE_GEO_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";

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

const $ = (id) => document.getElementById(id);

function describe(code) {
  return WEATHER_CODES[code] || ["알 수 없음", "❔"];
}

function showStatus(message, isError = false) {
  const el = $("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
}

function hideStatus() {
  $("status").classList.add("hidden");
}

function getPosition() {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("이 브라우저는 위치 정보를 지원하지 않습니다."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: false,
      timeout: 10000,
      maximumAge: 5 * 60 * 1000,
    });
  });
}

function geoErrorMessage(err) {
  switch (err.code) {
    case 1: return "위치 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.";
    case 2: return "현재 위치를 확인할 수 없습니다.";
    case 3: return "위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.";
    default: return err.message || "위치 정보를 가져오지 못했습니다.";
  }
}

async function fetchWeather(lat, lon) {
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

async function fetchPlaceName(lat, lon) {
  try {
    const params = new URLSearchParams({ latitude: lat, longitude: lon, localityLanguage: "ko" });
    const res = await fetch(`${REVERSE_GEO_URL}?${params}`);
    if (!res.ok) return null;
    const data = await res.json();
    const parts = [data.principalSubdivision, data.city || data.locality].filter(Boolean);
    return [...new Set(parts)].join(" ") || null;
  } catch {
    // 지역명은 부가 정보라 실패해도 좌표로 대신 표시
    return null;
  }
}

function formatDay(dateStr, index) {
  if (index === 0) return "오늘";
  if (index === 1) return "내일";
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
}

function render(weather, placeName, lat, lon) {
  const c = weather.current;
  const [desc, icon] = describe(c.weather_code);

  $("location").textContent = placeName || `위도 ${lat.toFixed(3)}, 경도 ${lon.toFixed(3)}`;
  $("current-icon").textContent = icon;
  $("current-temp").textContent = `${Math.round(c.temperature_2m)}°`;
  $("current-desc").textContent = desc;
  $("feels-like").textContent = `${Math.round(c.apparent_temperature)}°`;
  $("humidity").textContent = `${c.relative_humidity_2m}%`;
  $("wind").textContent = `${c.wind_speed_10m.toFixed(1)} m/s`;
  $("precip").textContent = `${c.precipitation} mm`;
  $("updated").textContent = `업데이트: ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;

  const d = weather.daily;
  $("daily").replaceChildren(...d.time.map((day, i) => {
    const [dayDesc, dayIcon] = describe(d.weather_code[i]);
    const li = document.createElement("li");
    li.title = dayDesc;
    li.innerHTML = `
      <span class="day"></span>
      <span class="day-icon"></span>
      <span class="rain"></span>
      <span class="range"><span class="max"></span> / <span class="min"></span></span>`;
    li.querySelector(".day").textContent = formatDay(day, i);
    li.querySelector(".day-icon").textContent = dayIcon;
    const rain = d.precipitation_probability_max[i];
    li.querySelector(".rain").textContent = rain != null ? `💧 ${rain}%` : "";
    li.querySelector(".max").textContent = `${Math.round(d.temperature_2m_max[i])}°`;
    li.querySelector(".min").textContent = `${Math.round(d.temperature_2m_min[i])}°`;
    return li;
  }));

  $("prompt").classList.add("hidden");
  $("weather").classList.remove("hidden");
}

async function loadWeather() {
  showStatus("위치를 확인하는 중…");
  let position;
  try {
    position = await getPosition();
  } catch (err) {
    showStatus(geoErrorMessage(err), true);
    return;
  }

  const { latitude: lat, longitude: lon } = position.coords;
  showStatus("날씨 정보를 불러오는 중…");
  try {
    const [weather, placeName] = await Promise.all([
      fetchWeather(lat, lon),
      fetchPlaceName(lat, lon),
    ]);
    render(weather, placeName, lat, lon);
    hideStatus();
  } catch (err) {
    showStatus(err.message, true);
  }
}

$("locate-btn").addEventListener("click", loadWeather);
$("refresh-btn").addEventListener("click", loadWeather);

// 이전에 권한을 허용했다면 버튼을 누르지 않아도 바로 조회
if (navigator.permissions) {
  navigator.permissions.query({ name: "geolocation" })
    .then((status) => { if (status.state === "granted") loadWeather(); })
    .catch(() => {});
}
