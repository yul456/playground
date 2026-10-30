// 스코어카드 사진을 읽는다. 서버나 API 키 없이 브라우저 안에서만 처리한다.
// 사진을 픽셀로 바꾸는 부분만 여기 있고, 표 찾기와 숫자 읽기는 scanLayout.js에 있다.
import { DIGIT_TEMPLATES } from "./digitTemplates.js";
import { ScanError, readScorecardImage } from "./scanLayout.js";

export { ScanError };

// 아주 큰 사진은 긴 변을 이 크기로 줄여 읽는다 (휴대폰 메모리와 속도). 숫자는 이 크기에서도 충분히 크다
const MAX_SIDE = 2000;

async function loadImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { data, width, height };
}

// 결과: { pars, parSure, parTotals, rows: [{ diffs, sure, totals }] }. 읽지 못한 칸은 null
export async function readScorecard(file) {
  const img = await loadImage(file);
  // 계산이 무거워서, 시작 전에 화면이 "읽는 중"을 그릴 틈을 준다
  await new Promise((resolve) => setTimeout(resolve, 0));
  return readScorecardImage(img, DIGIT_TEMPLATES);
}
