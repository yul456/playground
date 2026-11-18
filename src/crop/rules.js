// 사진 자르기의 규칙: 설정, 자를 곳 맞추기, 저장할 이름. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다
import { DEFAULT_JPG_QUALITY, JPG_QUALITIES } from "../shared/jpgQuality.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
export const STORAGE_KEY = "playground.crop.v1";

// 자를 수 있는 그림 (크롬이 여는 형식. HEIC는 열지 못한다)
export const IMAGE_NAME = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

// 저장하는 곳: folder(원본이 있는 폴더 안의 새 폴더에 같은 이름으로, 기본) · beside(원본 옆에 이름 뒤에 붙일 말을 붙여)
export const SAVE_MODES = ["folder", "beside"];
export const DEFAULT_FOLDER = "자른 사진";
export const DEFAULT_SUFFIX = "_자름";
// 크기마다 기억해 두는 자를 곳의 수 (오래된 것부터 버린다)
const MAX_SIZES = 50;

export const ZERO = Object.freeze({ top: 0, bottom: 0, left: 0, right: 0 });
export const SIDES = ["top", "bottom", "left", "right"];
export const isZero = (crop) => SIDES.every((side) => !crop[side]);
export const sameCrop = (a, b) => SIDES.every((side) => (a?.[side] ?? 0) === (b?.[side] ?? 0));
export const sizeKey = (width, height) => `${width}x${height}`;

const toInt = (value) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// 자를 곳을 그림 안에 맞춘다: 0 이상의 정수, 자르고 남는 그림이 1px 이상. 먼저 적힌 쪽(위·왼쪽)을 먼저 지킨다
export function clampCrop(crop, width, height) {
  const top = Math.min(toInt(crop?.top), height - 1);
  const bottom = Math.min(toInt(crop?.bottom), height - 1 - top);
  const left = Math.min(toInt(crop?.left), width - 1);
  const right = Math.min(toInt(crop?.right), width - 1 - left);
  return { top, bottom, left, right };
}

// 자르고 남는 크기
export const croppedSize = (width, height, crop) => ({ width: width - crop.left - crop.right, height: height - crop.top - crop.bottom });

// 파일 이름에 쓸 수 없는 글자(윈도우)와 앞뒤 빈칸, 끝의 점을 뺀다
const FORBIDDEN = /[\\/:*?"<>|]/g;
const isControl = (ch) => ch.charCodeAt(0) < 32;
export function cleanName(text) {
  return [...String(text ?? "")]
    .filter((ch) => !isControl(ch))
    .join("")
    .replace(FORBIDDEN, "")
    .trim()
    .replace(/[. ]+$/, "");
}

// 설정: { sizes: { "1080x2340": 자를 곳 } (크기마다 마지막으로 쓴 것), saveMode, folderName, suffix, quality: JPG 품질 }
export function readSettings(saved) {
  const settings = { sizes: {}, saveMode: SAVE_MODES[0], folderName: DEFAULT_FOLDER, suffix: DEFAULT_SUFFIX, quality: DEFAULT_JPG_QUALITY };
  if (!saved || typeof saved !== "object") return settings;
  if (saved.sizes && typeof saved.sizes === "object") {
    const entries = Object.entries(saved.sizes).filter(([key, crop]) => /^\d+x\d+$/.test(key) && crop && typeof crop === "object");
    for (const [key, crop] of entries.slice(-MAX_SIZES)) {
      const [width, height] = key.split("x").map(Number);
      settings.sizes[key] = clampCrop(crop, width, height);
    }
  }
  if (SAVE_MODES.includes(saved.saveMode)) settings.saveMode = saved.saveMode;
  // 이름 칸은 친 그대로 저장한다 (쓸 때 cleanName으로 거른다)
  if (typeof saved.folderName === "string") settings.folderName = saved.folderName.slice(0, 100);
  if (typeof saved.suffix === "string") settings.suffix = saved.suffix.slice(0, 100);
  if (JPG_QUALITIES.includes(saved.quality)) settings.quality = saved.quality;
  return settings;
}

// 크기마다 기억한 자를 곳에 하나를 더한다 (같은 크기는 맨 뒤로 옮긴다. 많으면 오래된 것부터 버린다)
export function rememberSize(sizes, key, crop) {
  const next = { ...sizes };
  delete next[key];
  next[key] = { ...crop };
  const keys = Object.keys(next);
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_SIZES))) delete next[old];
  return next;
}

const extOf = (name) => /\.[^.]+$/.exec(name)?.[0] ?? "";
const baseOf = (name) => name.slice(0, name.length - extOf(name).length);

// 만들 형식. PNG·JPG는 같은 형식으로(원본 화소를 색 변환 없이 풀고 색 정보를 옮긴다: raw),
// 나머지(WebP·GIF·BMP·AVIF)는 PNG로 만든다(색은 sRGB로 바꿔 푼다). 확장자는 원본의 것을 그대로 쓴다(.jpeg, .PNG 등)
export function outputType(name, type = "") {
  const ext = extOf(name);
  if (type === "image/jpeg" || /^\.jpe?g$/i.test(ext)) return { mime: "image/jpeg", ext: ext || ".jpg", raw: true };
  if (type === "image/png" || /^\.png$/i.test(ext)) return { mime: "image/png", ext: ext || ".png", raw: true };
  return { mime: "image/png", ext: ".png", raw: false };
}

// 이름 뒤에 " (2)", " (3)" …을 붙여 taken(소문자 이름)에 없는 이름을 고른다
function freeName(base, ext, taken) {
  let name = `${base}${ext}`;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})${ext}`;
  return name;
}

// 저장할 것들을 정한다. items: [{ id, name, type, crop }] (저장하기로 고른 것, 목록 순서).
// mode folder: 새 폴더에 같은 이름으로 저장한다. 자를 곳이 없는 사진은 원본 그대로 복사한다(그 폴더만으로 한 벌이 되게).
//   그 폴더에 같은 이름이 있으면 덮어쓴다(overwrite 표시). 이번에 저장할 것끼리 이름이 겹치면 번호를 붙인다
// mode beside: 원본 옆에 이름 뒤에 붙일 말을 붙여 저장한다. 자를 곳이 없는 사진은 건너뛴다. 원본이나 다른 파일을 덮어쓰지 않는다.
// existing: 저장할 폴더에 이미 있는 파일 이름(소문자)
// 돌려주는 것: [{ id, action: crop · copy · skip, name, overwrite }]
export function planSaves(items, { mode, suffix = "", existing = new Set() }) {
  const taken = new Set(mode === "beside" ? existing : []);
  return items.map((item) => {
    const zero = isZero(item.crop);
    if (zero && mode === "beside") return { id: item.id, action: "skip", name: "" };
    if (zero) {
      const name = freeName(baseOf(item.name), extOf(item.name), taken);
      taken.add(name.toLowerCase());
      return { id: item.id, action: "copy", name, overwrite: existing.has(name.toLowerCase()) };
    }
    const { ext } = outputType(item.name, item.type);
    const base = mode === "beside" ? `${baseOf(item.name)}${suffix}` : baseOf(item.name);
    const name = freeName(base, ext, taken);
    taken.add(name.toLowerCase());
    return { id: item.id, action: "crop", name, overwrite: mode === "folder" && existing.has(name.toLowerCase()) };
  });
}
