// 사진 경계를 모르는 긴 그림(이미 이어 붙인 PNG 등)을 JPG 여러 장으로 나눌 때, 그림을 보고 자를 줄을 고른다.
// 사진 형식 바꾸기(convertWorker.js)가 나누고, 사진 비교(compareWorker.js)가 같은 자리에서 나눠 보여 주고 용량을 잰다.
// 비교가 실제로 바꾼 파일과 같으려면 둘이 같은 규칙이어야 해서 여기에 함께 둔다.
// OffscreenCanvas를 써서 작업자(Web Worker)에서 돈다
import { rowSplit } from "./imageInfo.js";

// 자를 줄을 찾을 때 한 번에 읽는 화소 수의 한계(약 1,600만 개, 64MB). 폭이 넓으면 찾는 범위가 좁아진다
const WINDOW_PIXELS = 16_000_000;
// 한 가지 색으로 된 줄로 볼 색 차이(0~255). JPG에서 온 그림은 흰 바탕도 몇씩 흔들린다
const FLAT_TOLERANCE = 12;

// 그림의 [top, top + rows) 줄을 캔버스에 올린다. 투명한 곳이 있을 수 있으면 흰 바탕에 그린다 (JPG에는 투명도가 없어 검게 나온다)
export function drawRows(bitmap, top, rows, alpha, readable = false) {
  const canvas = new OffscreenCanvas(bitmap.width, rows);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: readable });
  if (alpha) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, bitmap.width, rows);
  }
  ctx.drawImage(bitmap, 0, top, bitmap.width, rows, 0, 0, bitmap.width, rows);
  return { canvas, ctx };
}

// 캔버스가 잡은 메모리를 바로 놓는다
export function release(canvas) {
  canvas.width = 0;
  canvas.height = 0;
}

// from~to 줄 안에서 자를 줄(다음 장의 첫 줄)을 고른다. target은 자르고 싶은 자리다. 사진 경계를 모르는 그림이라 그림을 보고 고른다.
// 1. 한 가지 색으로만 된 줄(빈 줄)이 있으면, 그런 줄이 이어진 띠 가운데 target에 가장 가까운 띠의 가운데에서 자른다.
//    상세 페이지처럼 칸 사이가 비어 있는 그림은 글자나 사진을 자르지 않는다
// 2. 없으면 위아래 줄이 가장 크게 달라지는 줄에서 자른다. 사진을 이어 붙인 그림에서는 사진과 사진의 경계일 때가 많다
// 3. 그것도 없으면(위아래가 모두 같으면) target
function findCut(bitmap, from, to, target, alpha) {
  const width = bitmap.width;
  const top = from;
  const rows = to - from + 1;
  const { canvas, ctx } = drawRows(bitmap, top, rows, alpha, true);
  const data = ctx.getImageData(0, 0, width, rows).data;
  release(canvas);
  const stride = width * 4;

  const flat = new Uint8Array(rows);
  for (let i = 0; i < rows; i++) {
    const start = i * stride;
    const r = data[start];
    const g = data[start + 1];
    const b = data[start + 2];
    let same = 1;
    for (let j = start + 4; j < start + stride; j += 4) {
      if (Math.abs(data[j] - r) > FLAT_TOLERANCE || Math.abs(data[j + 1] - g) > FLAT_TOLERANCE || Math.abs(data[j + 2] - b) > FLAT_TOLERANCE) {
        same = 0;
        break;
      }
    }
    flat[i] = same;
  }
  let best = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < rows; ) {
    if (!flat[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < rows && flat[j]) j++;
    const middle = Math.floor((i + j) / 2);
    const distance = Math.abs(top + middle - target);
    if (distance < bestDistance) {
      best = middle;
      bestDistance = distance;
    }
    i = j;
  }
  if (best >= 0) return top + best;

  let edge = -1;
  let edgeDiff = 0;
  for (let i = 1; i < rows; i++) {
    const above = (i - 1) * stride;
    const here = i * stride;
    let diff = 0;
    for (let j = 0; j < stride; j += 4) {
      diff += Math.abs(data[above + j] - data[here + j]) + Math.abs(data[above + j + 1] - data[here + j + 1]) + Math.abs(data[above + j + 2] - data[here + j + 2]);
    }
    if (diff > edgeDiff) {
      edgeDiff = diff;
      edge = i;
    }
  }
  return edge > 0 ? top + edge : target;
}

// 그림을 나눌 줄들: [0, 둘째 장의 첫 줄, …, 높이]. 장 k는 [cuts[k], cuts[k + 1]) 줄이다. 한 장에 담기면 [0, 높이].
// 장수는 imageInfo.js의 rowSplit이 정하고(나누는 방법과 상관없이 같다), 자를 자리 근처에서 더 나은 줄을 찾는다.
// 찾는 범위는 한 장이 maxHeight를 넘지 않고 장수도 늘지 않을 만큼이다.
// alpha: 투명한 곳이 있을 수 있는 그림이면 흰 바탕에 올려 본다 (JPG로 만들 때와 같은 화소로 고르려고)
export function findCuts(bitmap, maxHeight, splitMode = "even", alpha = true) {
  const { width, height } = bitmap;
  if (height <= maxHeight) return [0, height];
  const plan = rowSplit(height, maxHeight, splitMode);
  const reach = Math.min(plan.radius, Math.floor(WINDOW_PIXELS / width / 2));
  const cuts = [0];
  if (splitMode === "max") {
    // 최대 + 나머지: 앞 장이 시작한 줄에서 maxHeight 아래가 이 장이 끝날 수 있는 가장 먼 자리다. 거기서 위로만 찾는다
    while (cuts.length < plan.count) {
      const end = cuts.at(-1) + maxHeight;
      cuts.push(reach > 0 ? findCut(bitmap, end - reach, end, end, alpha) : end);
    }
  } else {
    for (const target of plan.targets) cuts.push(reach > 0 ? findCut(bitmap, target - reach, target + reach, target, alpha) : target);
  }
  cuts.push(height);
  return cuts;
}
