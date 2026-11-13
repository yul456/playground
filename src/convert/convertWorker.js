// 사진 하나를 받아 다른 형식으로 바꾼다. 화면이 멈추지 않게 따로 돈다(Web Worker).
// 받는 것: { type: "run", id, file: File, mime: 만들 형식("image/jpeg"), quality: 품질(1~100),
//          split: 너무 긴 그림을 여러 장으로 나눌지(아니면 바꾸지 않는다), splitMode: 나누는 방법(shared/imageInfo.js의 SPLIT_MODES) }
// 보내는 것: progress(phase: open · find · make), done(parts: [{ blob, height }], width, height), error(message)
// JPG 한 장에 담기에 너무 긴 그림은 나눌 자리 근처에서 자를 줄을 찾아 여러 장(parts)으로 만든다. 나머지는 한 장이다.
// 한 번에 하나만 맡는다. 멈출 때는 화면 쪽이 작업자를 통째로 끝낸다 (브라우저가 그림을 열고 만드는 일은 중간에 멈출 수 없다).
// 파일로 저장하는 일은 화면 쪽이 한다 (shared/saveToFolder.js)
import { jpegSize, jpgMaxHeight, pngInfo, rowSplit, sizeProblem, widthProblem } from "../shared/imageInfo.js";

// 자를 줄을 찾을 때 한 번에 읽는 화소 수의 한계(약 1,600만 개, 64MB). 폭이 넓으면 찾는 범위가 좁아진다
const WINDOW_PIXELS = 16_000_000;
// 한 가지 색으로 된 줄로 볼 색 차이(0~255). JPG에서 온 그림은 흰 바탕도 몇씩 흔들린다
const FLAT_TOLERANCE = 12;

// 바꾸지 못하는 까닭을 화면에 그대로 보일 오류
class Refused extends Error {}

const reader = (blob) => async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

// 캔버스를 새 형식으로 만든다. 만든 JPG의 크기가 맞는지도 본다. 인코더가 담지 못하는 크기는 오류 없이 잘려 나온 적이 있다
async function encode(canvas, mime, quality) {
  const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
  // 브라우저가 그 형식을 만들지 못하면 PNG를 돌려준다
  if (blob.type !== mime) throw new Refused("이 브라우저는 이 형식으로 만들지 못합니다");
  if (mime === "image/jpeg") {
    const made = await jpegSize(reader(blob));
    if (!made || made.width !== canvas.width || made.height !== canvas.height) {
      throw new Refused("브라우저가 그림을 끝까지 담지 못했습니다");
    }
  }
  return blob;
}

// 그림의 [top, top + rows) 줄을 캔버스에 올린다. 투명한 곳이 있을 수 있으면 흰 바탕에 그린다 (JPG에는 투명도가 없어 검게 나온다)
function drawRows(bitmap, top, rows, alpha, readable = false) {
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
function release(canvas) {
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

// 너무 길어 JPG 한 장으로 만들 수 없을 때, 나누지 않기로 했거나 폭이 너무 넓어 나눌 수 없으면 그 까닭
const unsplittable = (width, height, mime, split) => {
  if (mime !== "image/jpeg") return null;
  return widthProblem(width) ?? (split ? null : sizeProblem(width, height));
};

async function convert({ file, mime, quality, split = true, splitMode = "even" }, post) {
  // 1. PNG 머리만 읽어 크기를 본다. 바꾸지 않을 그림(나누지 않기로 한 긴 그림, 폭이 너무 넓은 그림)은 열기 전에 거른다
  const info = await pngInfo(reader(file)).catch(() => null);
  if (info) {
    const problem = unsplittable(info.width, info.height, mime, split);
    if (problem) throw new Refused(problem);
  }

  // 2. 그림을 연다
  post({ type: "progress", phase: "open" });
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Refused("그림을 열지 못했습니다. 파일이 깨졌거나 브라우저가 열기에 너무 큽니다");
  }
  const { width, height } = bitmap;
  // 확장자만 PNG인 다른 형식이면 머리를 읽지 못했으므로 연 뒤에 한 번 더 본다
  const problem = unsplittable(width, height, mime, split);
  if (problem) {
    bitmap.close();
    throw new Refused(problem);
  }
  const alpha = !info || info.alpha;
  const maxHeight = mime === "image/jpeg" ? jpgMaxHeight(width) : height;

  // 3. 한 장에 담기면 캔버스에 올려 새 형식으로 만든다
  if (height <= maxHeight) {
    post({ type: "progress", phase: "make", part: 1, parts: 1 });
    let canvas;
    if (alpha) {
      canvas = drawRows(bitmap, 0, height, true).canvas;
      bitmap.close();
    } else {
      // 투명한 곳이 없는 PNG는 연 그림을 캔버스에 그대로 넘긴다. 다시 그리면 같은 크기의 메모리를 한 벌 더 쓴다
      canvas = new OffscreenCanvas(width, height);
      canvas.getContext("bitmaprenderer").transferFromImageBitmap(bitmap);
    }
    try {
      return { parts: [{ blob: await encode(canvas, mime, quality), height }], width, height };
    } finally {
      release(canvas);
    }
  }

  // 4. 너무 길면 나눌 자리마다 그 근처에서 자를 줄을 찾아 여러 장으로 만든다 (shared/imageInfo.js의 rowSplit.
  //    장수는 나누는 방법과 상관없이 같고, 화면도 같은 규칙으로 미리 세어 저장할 이름을 정한다).
  //    찾는 범위는 한 장이 maxHeight를 넘지 않고 장수도 늘지 않을 만큼이다
  try {
    post({ type: "progress", phase: "find" });
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
    const parts = [];
    for (let k = 1; k < cuts.length; k++) {
      post({ type: "progress", phase: "make", part: k, parts: cuts.length - 1 });
      const rows = cuts[k] - cuts[k - 1];
      const { canvas } = drawRows(bitmap, cuts[k - 1], rows, alpha);
      try {
        parts.push({ blob: await encode(canvas, mime, quality), height: rows });
      } finally {
        release(canvas);
      }
    }
    return { parts, width, height };
  } finally {
    bitmap.close();
  }
}

self.onmessage = async ({ data }) => {
  if (data.type !== "run") return;
  const post = (message) => self.postMessage({ id: data.id, ...message });
  try {
    post({ type: "done", ...(await convert(data, post)) });
  } catch (err) {
    const message = err instanceof Refused ? err.message : `브라우저가 이 그림을 바꾸지 못했습니다 (${err?.message || err})`;
    post({ type: "error", message });
  }
};
