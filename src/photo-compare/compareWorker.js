// 사진 비교의 무거운 일을 화면과 따로 한다 (Web Worker).
// 1. 원본과 견줄 파일을 한 번씩 열어 둔다 (화면 쪽은 열지 않는다. 큰 그림을 두 벌 들고 있지 않으려고).
// 2. 화면이 달라는 칸(타일, tiles.js)만 잘라 보낸다. JPG 품질별 판은 그 칸만 그때그때 JPG로 만들고 풀어서 보낸다.
//    실제 파일의 칸 경계에 맞춰 여유를 두고 만들어, 통째로 바꾼 파일과 화소까지 같다.
// 3. 품질별 JPG의 용량은 그림을 장마다 통째로 JPG로 만들어 잰다. 사진 형식 바꾸기(convertWorker.js)와 같은 화소를
//    같은 인코더로 만들고 같은 자리에서 나누므로 실제로 바꾼 파일과 크기가 같다.
// 칸 만들기가 먼저다. 용량 재기는 만들 칸이 없을 때 한 걸음(한 품질의 한 장)씩 한다.
//
// 받는 것: open { gen, file, splitMode } · add { id, files } · remove { id } · split { gen, splitMode } ·
//          want { gen, tiles: [{ key, version, tile }] } (앞의 것부터. 받을 때마다 남은 일을 이것으로 바꾼다) · measure { gen, qualities }
// 보내는 것: opened { gen, width, height, cuts, jpgProblem, overview } · open-error { message } ·
//           added { id, width, height } · add-error { id, message } · cuts { gen, cuts } ·
//           tile { gen, key, bitmap, sx, sy } (bitmap의 (sx, sy)가 칸의 왼쪽 위) · tile-error { gen, key, message } ·
//           size { gen, quality, bytes: 장마다의 크기, parts: 장수 } · size-error { gen, quality, message }
import { jpgMaxHeight, pngInfo, widthProblem } from "../shared/imageInfo.js";
import { addMark, hasMark } from "../shared/resultMark.js";
import { drawRows, findCuts, release } from "../shared/rowCuts.js";
import { encodeRect } from "./tiles.js";

// 전체를 줄인 그림(화면 옆의 띠)의 폭과 가장 긴 높이
const OVERVIEW_WIDTH = 128;
const OVERVIEW_MAX_HEIGHT = 4096;

// 원본: { bitmap, width, height, alpha: 투명한 곳이 있을 수 있는지, mark: 사진 세로로 붙이기가 만든 그림인지, cuts, jpg: JPG로 만들 수 있는지 }
let base = null;
// 견줄 파일: id → { parts: [{ bitmap, top }] (나눠 저장한 파일이면 여럿), width, height }
const versions = new Map();
// 지금 원본·나누는 방법의 번호. 화면이 나누는 방법을 바꾸면 올라가고, 그 전의 칸과 용량은 버린다
let gen = 0;
// 만들 칸 (앞의 것부터)
let queue = [];
// 용량 재기: { qualities, index: 지금 품질, part: 지금 장, canvas: 지금 장을 올린 캔버스, bytes }
let measuring = null;
let pumping = false;
// 지금 만드는 칸 (화면이 같은 칸을 또 달라고 해도 두 번 만들지 않게)
let making = null;

const post = (message, transfer = []) => self.postMessage(message, transfer);
const reader = (blob) => async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
const reason = (err) => String(err?.message || err);

async function open({ file, splitMode }) {
  queue = [];
  stopMeasuring();
  base?.bitmap.close();
  base = null;
  // 사진 형식 바꾸기와 같은 규칙: PNG 머리에 투명도가 없다고 적혀 있을 때만 흰 바탕 없이 그린다 (화소는 어느 쪽이든 같다)
  const info = await pngInfo(reader(file)).catch(() => null);
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    post({ type: "open-error", message: "그림을 열지 못했습니다. 파일이 깨졌거나 브라우저가 열기에 너무 큽니다" });
    return;
  }
  const { width, height } = bitmap;
  const jpgProblem = widthProblem(width);
  const alpha = !info || info.alpha;
  let cuts = [0, height];
  try {
    if (!jpgProblem) cuts = findCuts(bitmap, jpgMaxHeight(width), splitMode, alpha);
  } catch (err) {
    bitmap.close();
    post({ type: "open-error", message: `그림을 살펴보지 못했습니다 (${reason(err)})` });
    return;
  }
  base = { bitmap, width, height, alpha, mark: await hasMark(file), cuts, jpg: !jpgProblem };
  const w = Math.min(OVERVIEW_WIDTH, width);
  const h = Math.max(1, Math.min(OVERVIEW_MAX_HEIGHT, Math.round((height * w) / width)));
  const overview = await createImageBitmap(bitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: "medium" });
  post({ type: "opened", gen, width, height, cuts, jpgProblem, overview }, [overview]);
}

async function add({ id, files }) {
  const parts = [];
  const fail = (message) => {
    for (const part of parts) part.bitmap.close();
    post({ type: "add-error", id, message });
  };
  let top = 0;
  for (const file of files) {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
    } catch {
      fail(files.length > 1 ? `${file.name}을(를) 열지 못했습니다` : "그림을 열지 못했습니다. 파일이 깨졌거나 브라우저가 열기에 너무 큽니다");
      return;
    }
    parts.push({ bitmap, top });
    top += bitmap.height;
  }
  const width = parts[0].bitmap.width;
  if (parts.some((part) => part.bitmap.width !== width)) {
    fail("나눠 저장한 파일들의 폭이 서로 달라 한 그림으로 이을 수 없습니다");
    return;
  }
  versions.set(id, { parts, width, height: top });
  post({ type: "added", id, width, height: top });
}

function remove({ id }) {
  const version = versions.get(id);
  if (!version) return;
  for (const part of version.parts) part.bitmap.close();
  versions.delete(id);
  queue = queue.filter((job) => job.version !== id);
}

function split({ splitMode }) {
  queue = [];
  stopMeasuring();
  if (!base?.jpg) return;
  try {
    base.cuts = findCuts(base.bitmap, jpgMaxHeight(base.width), splitMode, base.alpha);
  } catch (err) {
    post({ type: "open-error", message: `그림을 살펴보지 못했습니다 (${reason(err)})` });
    return;
  }
  post({ type: "cuts", gen, cuts: base.cuts });
}

// 견줄 파일의 칸. 나눠 저장한 파일이면 칸이 걸치는 장들을 이어 그린다
async function cropVersion(version, tile) {
  const hits = version.parts.filter((part) => part.top < tile.y + tile.h && part.top + part.bitmap.height > tile.y);
  if (hits.length === 1) {
    const [part] = hits;
    return createImageBitmap(part.bitmap, tile.x, tile.y - part.top, tile.w, tile.h);
  }
  const canvas = new OffscreenCanvas(tile.w, tile.h);
  const ctx = canvas.getContext("2d");
  for (const part of hits) {
    ctx.drawImage(part.bitmap, tile.x, 0, tile.w, part.bitmap.height, 0, part.top - tile.y, tile.w, part.bitmap.height);
  }
  return canvas.transferToImageBitmap();
}

// 원본의 칸을 그 품질의 JPG로 만들어 푼다. 사진 형식 바꾸기가 장을 올리는 캔버스와 같은 방법(shared/rowCuts.js의 drawRows)으로
// 올린다: 투명도를 담지 않는 캔버스에, 투명한 곳이 있을 수 있으면 흰 바탕을 깔고 그린다.
// 작은 캔버스는 브라우저가 그래픽 카드로 그리기도 해서, 반쯤 비치는 화소를 흰 바탕에 겹칠 때 셈이 조금 다를 수 있다.
// 긴 장을 올리는 큰 캔버스처럼 CPU로 그리게 한다(willReadFrequently)
async function jpgTile(quality, tile) {
  const rect = encodeRect(tile, base.width, base.cuts);
  const canvas = new OffscreenCanvas(rect.w, rect.h);
  const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (base.alpha) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, rect.w, rect.h);
  }
  ctx.drawImage(base.bitmap, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
  release(canvas);
  return { bitmap: await createImageBitmap(blob), sx: tile.x - rect.x, sy: tile.y - rect.y };
}

async function makeTile({ key, version, tile }) {
  const at = gen;
  making = key;
  try {
    let made;
    if (version === "base") {
      made = { bitmap: await createImageBitmap(base.bitmap, tile.x, tile.y, tile.w, tile.h), sx: 0, sy: 0 };
    } else if (version.startsWith("q")) {
      if (!base.jpg) return;
      made = await jpgTile(Number(version.slice(1)), tile);
    } else {
      const found = versions.get(version);
      if (!found) return;
      made = { bitmap: await cropVersion(found, tile), sx: 0, sy: 0 };
    }
    // 만드는 동안 나누는 방법이 바뀌었으면 칸 자리가 달라졌으니 버린다
    if (at !== gen) {
      made.bitmap.close();
      return;
    }
    post({ type: "tile", gen: at, key, ...made }, [made.bitmap]);
  } catch (err) {
    post({ type: "tile-error", gen: at, key, message: reason(err) });
  } finally {
    making = null;
  }
}

function stopMeasuring() {
  if (measuring?.canvas) release(measuring.canvas);
  measuring = null;
}

// 용량 재기 한 걸음: 한 품질의 한 장을 통째로 JPG로 만들어 크기를 잰다. 품질 하나를 끝까지(모든 장) 잰 뒤 다음 품질로 간다.
// 사진 세로로 붙이기가 만든 그림이면 사진 형식 바꾸기처럼 JPG에도 표시(shared/resultMark.js, 21바이트)를 넣어 잰다
async function measureStep() {
  const job = measuring;
  const quality = job.qualities[job.index];
  const { cuts } = base;
  try {
    job.canvas ??= drawRows(base.bitmap, cuts[job.part], cuts[job.part + 1] - cuts[job.part], base.alpha).canvas;
    let blob = await job.canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
    if (base.mark) blob = await addMark(blob);
    if (measuring !== job) return;
    job.bytes.push(blob.size);
    post({ type: "size", gen, quality, bytes: [...job.bytes], parts: cuts.length - 1 });
  } catch (err) {
    if (measuring !== job) return;
    post({ type: "size-error", gen, quality, message: reason(err) });
    job.part = cuts.length - 2; // 이 품질은 그만 잰다
  }
  if (job.canvas) release(job.canvas);
  job.canvas = null;
  job.part++;
  if (job.part < cuts.length - 1) return;
  job.part = 0;
  job.bytes = [];
  job.index++;
  if (job.index >= job.qualities.length) measuring = null;
}

// 할 일을 하나씩 한다. 일 사이에 받은 메시지(want 등)가 남은 일을 바꾼다
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      if (queue.length) await makeTile(queue.shift());
      else if (measuring && base) await measureStep();
      else break;
    }
  } finally {
    pumping = false;
  }
}

self.onmessage = async ({ data }) => {
  switch (data.type) {
    case "open":
      gen = data.gen;
      await open(data);
      break;
    case "add":
      await add(data);
      break;
    case "remove":
      remove(data);
      break;
    case "split":
      gen = data.gen;
      split(data);
      break;
    case "want":
      if (data.gen !== gen || !base) return;
      queue = data.tiles.filter((job) => job.key !== making);
      pump();
      break;
    case "measure":
      if (data.gen !== gen || !base?.jpg) return;
      stopMeasuring();
      measuring = { qualities: data.qualities, index: 0, part: 0, canvas: null, bytes: [] };
      pump();
      break;
    default:
  }
};
