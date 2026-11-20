// 영상 장면 뽑기의 설정 (고르는 즉시 저장한다). 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다
import { DEFAULT_JPG_QUALITY, JPG_QUALITIES } from "../shared/jpgQuality.js";
import { AMOUNTS } from "./scenes.js";

export const STORAGE_KEY = "playground.video-frames.v1";
// 자동으로 뽑는 방법: scenes(장면이 바뀔 때마다 한 장) · every(몇 초마다 한 장)
export const MODES = ["scenes", "every"];
export const FORMATS = ["jpg", "png"];
// 몇 초마다 뽑을 때 고를 수 있는 범위
export const EVERY_MIN = 0.5;
export const EVERY_MAX = 600;
// 한 영상에서 자동으로 뽑는 장면은 이만큼까지 (그림이 너무 많으면 고르기 어렵고 메모리도 많이 쓴다)
export const MAX_FRAMES = 200;

export const DEFAULT_SETTINGS = { mode: "scenes", amount: "normal", every: 5, format: "jpg", quality: DEFAULT_JPG_QUALITY };

export function readSettings(saved) {
  const value = { ...DEFAULT_SETTINGS, ...(saved && typeof saved === "object" ? saved : {}) };
  if (!MODES.includes(value.mode)) value.mode = DEFAULT_SETTINGS.mode;
  if (!Object.hasOwn(AMOUNTS, value.amount)) value.amount = DEFAULT_SETTINGS.amount;
  const every = Number(value.every);
  value.every = Number.isFinite(every) ? Math.min(EVERY_MAX, Math.max(EVERY_MIN, every)) : DEFAULT_SETTINGS.every;
  if (!FORMATS.includes(value.format)) value.format = DEFAULT_SETTINGS.format;
  if (!JPG_QUALITIES.includes(value.quality)) value.quality = DEFAULT_SETTINGS.quality;
  return { mode: value.mode, amount: value.amount, every: value.every, format: value.format, quality: value.quality };
}
