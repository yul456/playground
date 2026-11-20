// 뽑은 장면의 시각 글자와 저장할 파일 이름. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

// 파일 이름에 쓰지 못하는 글자 (윈도우)와 제어 글자
const BAD_CHARS = /[\\/:*?"<>|\p{Cc}\p{Cf}]/gu;
// 윈도우가 예약해 둔 이름
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_BASE = 80;

// 화면에 보일 시각: 0:12.5 · 1:02:03.5 (0.1초까지, 내림)
export function clockLabel(seconds) {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const s = Math.floor(tenths / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = `${String(s % 60).padStart(2, "0")}.${tenths % 10}`;
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

// 파일 이름에 넣을 시각: 01분12.5초 · 1시간02분03.5초. 자릿수를 맞춰 이름순이 시각 순서가 된다
export function timeLabel(seconds, long = false) {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const s = Math.floor(tenths / 10);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = `${String(m).padStart(2, "0")}분${String(s % 60).padStart(2, "0")}.${tenths % 10}초`;
  return long || h ? `${h}시간${rest}` : rest;
}

// 영상 파일 이름에서 확장자를 뗀 바탕 이름 (파일 이름에 못 쓰는 글자는 빼고, 너무 길면 자른다)
export function videoBase(fileName) {
  let base = String(fileName ?? "").replace(/\.[^.]*$/, "");
  base = base.replace(BAD_CHARS, " ").replace(/\s+/g, " ").trim();
  base = Array.from(base).slice(0, MAX_BASE).join("").replace(/[.\s]+$/, "");
  if (RESERVED.test(base)) base = `${base}_`;
  return base || "영상";
}

// 장면 하나의 파일 이름: 영상이름_01분12.5초.jpg. long이면 시간 자리도 넣는다 (한 시간이 넘는 영상은 모두 시간 자리를 넣어 이름순을 맞춘다)
export const frameName = (fileName, seconds, ext, long = false) => `${videoBase(fileName)}_${timeLabel(seconds, long)}.${ext}`;

// 같은 이름이 겹치면 " (2)", " (3)"을 붙인다. taken: 이미 쓴 이름(소문자)
export function uniqueName(name, taken) {
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let candidate = name;
  for (let k = 2; taken.has(candidate.toLowerCase()); k++) candidate = `${stem} (${k})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
