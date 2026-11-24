// 화면 녹화의 규칙: 고를 수 있는 값, 녹화 형식 고르기, 화면 공유에 넘길 조건, 저장할 이름.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

// 무엇을 고르게 할지. window: 고르기 창에 창과 탭만 보인다(화면 전체는 숨긴다) · any: 화면 전체도 고를 수 있다
export const SURFACES = ["window", "any"];
export const SURFACE_LABELS = { window: "창이나 탭만", any: "화면 전체도" };
// 초당 장수
export const RATES = [15, 30, 60];
export const DEFAULT_RATE = 30;
// 화질: 영상의 초당 비트 수. 화면은 멈춰 있는 때가 많아 실제 크기는 이보다 작다
export const QUALITIES = [
  { key: "low", label: "작게", bits: 2_500_000 },
  { key: "normal", label: "보통", bits: 6_000_000 },
  { key: "high", label: "좋게", bits: 14_000_000 },
];
export const DEFAULT_QUALITY = "normal";
// 저장 형식. 크롬이 그 형식으로 녹화하지 못하면 다른 쪽으로 녹화한다
export const FORMATS = ["mp4", "webm"];
// 형식마다 차례로 물어볼 녹화 형식(MediaRecorder의 mimeType). 앞의 것이 되면 그것을 쓴다
const MIMES = {
  mp4: ['video/mp4;codecs="avc1.640028,mp4a.40.2"', 'video/mp4;codecs="avc1.42E01F,mp4a.40.2"', "video/mp4"],
  webm: ['video/webm;codecs="vp9,opus"', 'video/webm;codecs="vp8,opus"', "video/webm"],
};

// 녹화 형식을 고른다. supported(mime)가 참인 첫 형식. 고른 형식(format)이 안 되면 다른 형식에서 찾는다.
// 결과: { mime, ext } 또는 null(이 브라우저는 녹화하지 못한다)
export function pickMime(format, supported) {
  const order = format === "webm" ? ["webm", "mp4"] : ["mp4", "webm"];
  for (const ext of order) {
    const mime = MIMES[ext].find((candidate) => supported(candidate));
    if (mime) return { mime, ext };
  }
  return null;
}

// 화면 공유(getDisplayMedia)에 넘길 조건.
// - window: 고르기 창을 "창" 쪽에서 열고 화면 전체는 숨긴다. any: "화면 전체" 쪽에서 연다.
// - 이 페이지의 탭은 목록에서 뺀다 (녹화 화면을 녹화하게 된다).
// - audio: PC·탭의 소리도 달라고 한다. 창을 고르면 크롬이 소리를 주지 않는다.
export function displayOptions({ surface, rate, audio }) {
  const windowOnly = surface !== "any";
  return {
    video: { frameRate: rate, displaySurface: windowOnly ? "window" : "monitor" },
    audio: audio ? { suppressLocalAudioPlayback: false } : false,
    monitorTypeSurfaces: windowOnly ? "exclude" : "include",
    selfBrowserSurface: "exclude",
    systemAudio: audio ? "include" : "exclude",
  };
}

const two = (n) => String(n).padStart(2, "0");

// 저장할 이름: "화면 녹화 2026-11-24 15.04.05.mp4" (이름순이 시간순이고, 윈도우 파일 이름에 못 쓰는 :는 쓰지 않는다)
export function fileName(date, ext) {
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
  return `화면 녹화 ${day} ${two(date.getHours())}.${two(date.getMinutes())}.${two(date.getSeconds())}.${ext}`;
}

// 걸린 시간: 0:07, 12:34, 1:02:03
export function clock(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}

// 고른 것이 무엇인지 (화면 공유가 알려 주는 displaySurface)
export const SURFACE_NAMES = { monitor: "화면 전체", window: "창", browser: "크롬 탭" };
