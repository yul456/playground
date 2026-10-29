// Open-Meteo: API 키 없이 쓸 수 있어 정적 사이트(GitHub Pages)에 적합
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";
// 좌표 → 지역명 변환 (키 불필요, 클라이언트용 무료 엔드포인트)
const REVERSE_GEO_URL = "https://api.bigdatacloud.net/data/reverse-geocode-client";
// 위치 권한이 없거나 위치를 못 가져올 때 보여줄 기본 위치
const DEFAULT_LOCATION = {
  lat: 35.17987,
  lon: 128.56085,
  name: "경상남도 창원시 마산합포구 해운동",
};

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

// 안내 문구는 화면 아래에 떠 있는 토스트로 보여줘 지도·날씨 위치가 밀리지 않게 한다
let statusTimer = null;

function showStatus(message, isError = false) {
  const el = $("status");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(statusTimer);
  // 오류는 다음 동작까지 남겨 두고, 일반 안내는 잠시 뒤 사라진다
  if (!isError) statusTimer = setTimeout(hideStatus, 6000);
}

function hideStatus() {
  clearTimeout(statusTimer);
  $("status").classList.add("hidden");
}

// 위치 찾기나 날씨 조회가 진행 중이면 상단 로딩 바를 보여준다
const pending = { locating: false, requests: 0 };

function updateLoading() {
  $("loading-bar").classList.toggle("active", pending.locating || pending.requests > 0);
  // 날씨를 새로 불러오는 동안에만 기존 날씨를 흐리게 표시
  document.body.classList.toggle("loading-weather", pending.requests > 0);
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

function formatDay(dateStr, index) {
  if (index === 0) return "오늘";
  if (index === 1) return "내일";
  const date = new Date(`${dateStr}T00:00:00`);
  return date.toLocaleDateString("ko-KR", { month: "numeric", day: "numeric", weekday: "short" });
}

const KIND_LABELS = { default: "기본 위치", mine: "현재 위치", picked: "선택한 위치" };

function render(weather, placeName, lat, lon, kind) {
  const c = weather.current;
  const [desc, icon] = describe(c.weather_code);

  const label = placeName || `위도 ${lat.toFixed(3)}, 경도 ${lon.toFixed(3)}`;
  $("location").textContent = `${label} (${KIND_LABELS[kind]})`;
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

  $("weather").classList.remove("hidden");
}

// 동 단위가 한눈에 보이는 배율 (지도 가로 약 7km 범위)
const MAP_ZOOM = 14;
let map = null;
let marker = null;

async function copyText(text, what) {
  try {
    await navigator.clipboard.writeText(text);
    showStatus(`${what}를 복사했습니다: ${text}`);
  } catch {
    showStatus(`${what}를 복사하지 못했습니다.`, true);
  }
}

// 핀을 누르면 뜨는 메뉴: 주소·좌표 복사, 길찾기
function buildPopup() {
  const { lat, lon, placeName } = current;
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  // 카카오 링크는 쉼표로 값을 구분하므로 이름에서 쉼표를 뺀다
  const destName = (placeName || KIND_LABELS[current.kind]).replaceAll(",", " ");

  const el = document.createElement("div");
  el.className = "marker-popup";
  el.innerHTML = `
    <div class="popup-title"></div>
    <div class="popup-coords"></div>
    <div class="popup-actions">
      <button type="button" data-copy="address">주소 복사</button>
      <button type="button" data-copy="coords">좌표 복사</button>
      <a class="naver" target="_blank" rel="noopener">네이버 길찾기</a>
      <a class="kakao" target="_blank" rel="noopener">카카오 길찾기</a>
    </div>`;
  el.querySelector(".popup-title").textContent = placeName || KIND_LABELS[current.kind];
  el.querySelector(".popup-coords").textContent = coords;

  const address = el.querySelector('[data-copy="address"]');
  if (placeName) address.addEventListener("click", () => copyText(placeName, "주소"));
  else address.disabled = true;
  el.querySelector('[data-copy="coords"]').addEventListener("click", () => copyText(coords, "좌표"));

  // 도착지만 넘기면 출발지는 각 지도 서비스가 사용자의 현재 위치로 잡는다
  el.querySelector(".naver").href = "https://map.naver.com/index.nhn?" + new URLSearchParams({
    elng: lon, elat: lat, etext: destName, menu: "route", pathType: 0,
  });
  el.querySelector(".kakao").href =
    `https://map.kakao.com/link/to/${encodeURIComponent(destName)},${lat},${lon}`;
  return el;
}

// 지도는 처음 보여줄 위치(현재 위치 또는 기본 위치)가 정해지면 그 자리에서 만든다
// 미리 기본 위치로 만들어 두면 현재 위치로 옮겨 갈 때 지도가 크게 튄다
function initMap(lat, lon) {
  map = L.map("map").setView([lat, lon], MAP_ZOOM);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  marker = L.marker([lat, lon]).addTo(map).bindPopup(buildPopup, { minWidth: 220 });
  map.on("click", (e) => pickLocation(e.latlng.lat, e.latlng.lng));
  $("map-placeholder").classList.add("hidden");
}

function moveMarker(lat, lon, kind) {
  if (!window.L) return;
  if (!map) {
    initMap(lat, lon);
    return;
  }
  marker.setLatLng([lat, lon]);
  // 지도에서 직접 고른 위치는 사용자가 맞춰 둔 배율을 유지한다
  if (kind === "picked") map.panTo([lat, lon]);
  else map.setView([lat, lon], MAP_ZOOM);
}

// 지금 보여주는 위치. kind: "default"(기본) | "mine"(현재 위치) | "picked"(지도에서 선택)
// 아직 아무 위치도 보여주지 않았으면 null
let current = null;
// 응답이 순서대로 오지 않아도 마지막 요청만 화면에 반영한다
let requestSeq = 0;
let watchId = null;
let slowTimer = null;

async function showWeather(lat, lon, kind) {
  const seq = ++requestSeq;
  pending.requests++;
  updateLoading();
  let weather, placeName;
  try {
    [weather, placeName] = await Promise.all([
      fetchWeather(lat, lon),
      kind === "default" ? DEFAULT_LOCATION.name : fetchPlaceName(lat, lon),
    ]);
  } finally {
    pending.requests--;
    updateLoading();
  }
  if (seq !== requestSeq) return;
  current = { lat, lon, kind, placeName };
  render(weather, placeName, lat, lon, kind);
  moveMarker(lat, lon, kind);
}

async function loadDefaultWeather() {
  try {
    await showWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, "default");
  } catch (err) {
    showStatus(err.message, true);
  }
}

async function pickLocation(lat, lon) {
  // 사용자가 직접 고른 위치를 늦게 잡힌 현재 위치가 덮어쓰지 않게 위치 찾기를 멈춘다
  stopLocating();
  marker.closePopup();
  marker.setLatLng([lat, lon]);
  try {
    await showWeather(lat, lon, "picked");
    hideStatus();
  } catch (err) {
    showStatus(err.message, true);
  }
}

function stopLocating() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  clearTimeout(slowTimer);
  pending.locating = false;
  updateLoading();
}

async function onPosition(position) {
  stopLocating();
  const { latitude: lat, longitude: lon } = position.coords;
  try {
    await showWeather(lat, lon, "mine");
    hideStatus();
  } catch (err) {
    showStatus(err.message, true);
  }
}

function onPositionError(err) {
  // 권한 거부만 포기하고, 위치를 아직 못 잡은 경우(2, 3)는 계속 기다린다
  if (err.code !== 1) return;
  stopLocating();
  if (!current) {
    loadDefaultWeather();
    showStatus(`${geoErrorMessage(err)} 기본 위치의 날씨를 보여줍니다.`);
  } else {
    showStatus(`${geoErrorMessage(err)} 지도에서 위치를 직접 선택할 수도 있습니다.`);
  }
}

// 현재 위치를 찾는다. 위치를 읽을 수 없을 때만 기본 위치를 보여준다
function locate() {
  if (!("geolocation" in navigator)) {
    if (!current) loadDefaultWeather();
    showStatus("이 브라우저는 위치 정보를 지원하지 않습니다. 지도에서 위치를 선택해 주세요.");
    return;
  }
  stopLocating();
  pending.locating = true;
  updateLoading();
  // getCurrentPosition은 시간 초과 시 바로 끝나므로, 위치가 늦게 잡혀도 받을 수 있게 watchPosition을 쓴다
  watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
    // macOS 크롬에서 false면 캐시된 위치가 없을 때 응답이 오지 않는다
    enableHighAccuracy: true,
    maximumAge: 5 * 60 * 1000,
  });
  slowTimer = setTimeout(() => {
    // 로딩 바가 끝없이 돌지 않게 멈추고, 위치는 뒤에서 계속 기다린다
    pending.locating = false;
    updateLoading();
    if (!current) {
      loadDefaultWeather();
      showStatus("현재 위치를 확인하지 못해 기본 위치를 보여줍니다. 확인되면 자동으로 바뀝니다.");
    } else {
      showStatus("현재 위치 확인이 늦어지고 있습니다. 확인되면 자동으로 바뀝니다.");
    }
  }, 15000);
}

// 브라우저 설정에서 위치 권한을 바꾸면 새로고침 없이 반영한다
async function watchPermission() {
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    status.addEventListener("change", () => {
      if (status.state === "granted" && (!current || current.kind === "default")) locate();
      if (status.state === "denied") {
        stopLocating();
        if (!current || current.kind === "mine") loadDefaultWeather();
        showStatus("위치 권한이 꺼졌습니다. 지도에서 위치를 직접 선택할 수 있습니다.");
      }
    });
  } catch {
    // permissions API 미지원 브라우저는 버튼으로만 다시 시도
  }
}

$("locate-btn").addEventListener("click", locate);
$("skip-locate-btn").addEventListener("click", () => {
  // 위치 확인을 기다리지 않고 기본 위치를 보겠다고 고른 것이므로 위치 찾기를 멈춘다
  stopLocating();
  loadDefaultWeather();
});
$("refresh-btn").addEventListener("click", async () => {
  if (current.kind === "mine") {
    locate();
    return;
  }
  // 위치 찾기가 끝났는데(거부 등) 기본 위치를 보고 있다면 한 번 더 시도
  if (current.kind === "default" && watchId === null) locate();
  try {
    await showWeather(current.lat, current.lon, current.kind);
  } catch (err) {
    showStatus(err.message, true);
  }
});

// 지도 스크립트를 못 불러와도 날씨는 보여준다
if (!window.L) $("map-card").classList.add("hidden");
locate();
watchPermission();
