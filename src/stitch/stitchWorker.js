// 사진 묶음 하나를 받아 세로로 이어 붙인 PNG를 만든다. 화면이 멈추지 않게 따로 돈다(Web Worker).
// 받는 것: { type: "run", id, files: File[] }
//          { type: "cancel", id }
// 보내는 것: progress(measure·draw), done(blob: 다 만든 PNG), cancelled, error
// 파일로 저장하는 일은 화면 쪽(save.js)이 한다. 여기서 고른 폴더의 파일에 조각마다 바로 쓰지 않는 까닭도 거기 적었다
import { openPng } from "./png.js";

// 한 번에 그려 PNG로 넘길 화소 수(약 800만 개, 32MB). 폭이 넓으면 줄 수가 줄어든다
const STRIP_PIXELS = 8_000_000;
// 만든 데이터를 이만큼씩 Blob으로 묶는다. 브라우저가 큰 Blob은 디스크에 내려 둘 수 있어 메모리를 덜 쓴다
const BLOB_BYTES = 64 << 20;

class Cancelled extends Error {}

let job = null;

self.onmessage = ({ data }) => {
  if (data.type === "cancel") {
    if (job?.id === data.id) job.cancelled = true;
  } else if (data.type === "run") {
    run(data);
  }
};

// 휴대폰 사진의 회전 정보(EXIF)를 따라 세운다. 이 옵션을 모르는 옛 브라우저는 옵션 없이 연다
let decodeOptions = { imageOrientation: "from-image" };
async function decode(file) {
  try {
    return await createImageBitmap(file, decodeOptions);
  } catch (err) {
    if (!(err instanceof TypeError) || !decodeOptions) throw err;
    decodeOptions = undefined;
    return createImageBitmap(file);
  }
}

// PNG 조각을 받아 Blob 하나로 모은다
function blobSink() {
  const blobs = [];
  let parts = [];
  let size = 0;
  const pack = () => {
    if (parts.length) blobs.push(new Blob(parts));
    parts = [];
    size = 0;
  };
  const sink = {
    blob: null,
    async write(bytes) {
      parts.push(bytes);
      size += bytes.length;
      if (size >= BLOB_BYTES) pack();
    },
    async close() {
      pack();
      sink.blob = new Blob(blobs, { type: "image/png" });
    },
    async abort() {
      blobs.length = 0;
      parts = [];
    },
  };
  return sink;
}

async function run({ id, files }) {
  const current = { id, cancelled: false };
  job = current;
  const post = (message) => self.postMessage({ id, ...message });
  const check = () => {
    if (current.cancelled) throw new Cancelled();
  };
  const skipped = [];
  let sink = null;
  let png = null;
  try {
    // 1. 크기 재기. PNG 머리에 폭(가장 넓은 사진)과 높이(모두 더한 값)를 먼저 적어야 해서 한 번 열어 본다
    const items = [];
    for (const [k, file] of files.entries()) {
      check();
      try {
        const bitmap = await decode(file);
        items.push({ file, width: bitmap.width, height: bitmap.height });
        bitmap.close();
      } catch {
        skipped.push(file.name);
      }
      post({ type: "progress", phase: "measure", done: k + 1, total: files.length });
    }
    if (!items.length) throw new Error("열 수 있는 사진이 없습니다");
    const width = Math.max(...items.map((item) => item.width));
    const height = items.reduce((sum, item) => sum + item.height, 0);

    // 2. PNG를 모아 둘 곳 열기
    sink = blobSink();
    png = await openPng(width, height, sink);

    // 3. 사진을 위에서부터 몇백~몇천 줄씩 흰 바탕에 그려 PNG에 붙인다. 좁은 사진은 가운데에 둔다
    const strip = Math.max(1, Math.min(height, Math.floor(STRIP_PIXELS / width)));
    const canvas = new OffscreenCanvas(width, strip);
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.fillStyle = "#fff";
    let rowsDone = 0;
    for (const [k, item] of items.entries()) {
      check();
      const bitmap = await decode(item.file);
      try {
        if (bitmap.width !== item.width || bitmap.height !== item.height) {
          throw new Error(`${item.file.name}: 처음 열었을 때와 크기가 다릅니다`);
        }
        const x = Math.floor((width - item.width) / 2);
        for (let y = 0; y < item.height; y += strip) {
          check();
          const rows = Math.min(strip, item.height - y);
          ctx.fillRect(0, 0, width, rows);
          ctx.drawImage(bitmap, 0, y, item.width, rows, x, 0, item.width, rows);
          await png.writeRows(ctx.getImageData(0, 0, width, rows).data, rows);
          rowsDone += rows;
          post({ type: "progress", phase: "draw", done: k + 1, total: items.length, rows: rowsDone, totalRows: height });
        }
      } finally {
        bitmap.close();
      }
    }
    const bytes = await png.finish();
    post({ type: "done", width, height, bytes, count: items.length, skipped, blob: sink.blob });
  } catch (err) {
    if (png) await png.abort(err);
    else await sink?.abort();
    if (err instanceof Cancelled) post({ type: "cancelled", skipped });
    else post({ type: "error", message: err?.message || String(err), skipped });
  } finally {
    if (job === current) job = null;
  }
}
