// 사진 묶음 하나를 받아 세로로 이어 붙인 그림을 만든다. 화면이 멈추지 않게 따로 돈다(Web Worker).
// 받는 것: { type: "run", id, files: File[], format: 바라는 형식("jpg" · "png"), quality: JPG 품질(1~100),
//            sizes: 화면이 이미 잰 사진 크기 [{ width, height }] (없으면 여기서 잰다) }
//          { type: "cancel", id }
// 보내는 것: progress(measure·draw·encode), done(blob: 다 만든 그림, format: 실제로 만든 형식, note: JPG로 만들지 못한 까닭), cancelled, error
// 파일로 저장하는 일은 화면 쪽(shared/saveToFolder.js)이 한다. 여기서 고른 폴더의 파일에 조각마다 바로 쓰지 않는 까닭도 거기 적었다
import { jpegSize, sizeProblem } from "../shared/imageInfo.js";
import { openPng } from "./png.js";

// 한 번에 그려 PNG로 넘길 화소 수(약 800만 개, 32MB). 폭이 넓으면 줄 수가 줄어든다
const STRIP_PIXELS = 8_000_000;
// 한 번에 그릴 줄 수의 한계. 캔버스는 한 변이 65,535px을 넘을 수 없다.
// 폭이 120px쯤보다 좁은 사진은 화소 수로만 정하면 띠가 그보다 길어져 그림이 그려지지 않았다
const STRIP_ROWS = 16384;
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

// 처음 크기를 잴 때와 같은 그림인지 본다 (그사이 파일이 바뀌었을 수 있다)
async function openSame(item) {
  const bitmap = await decode(item.file);
  if (bitmap.width !== item.width || bitmap.height !== item.height) {
    bitmap.close();
    throw new Error(`${item.file.name}: 처음 열었을 때와 크기가 다릅니다`);
  }
  return bitmap;
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

// JPG로 만든다. 브라우저의 JPG 인코더는 캔버스 한 장을 통째로 받으므로 사진을 큰 캔버스 한 장에 모두 그린다.
// 캔버스는 화소마다 4바이트를 쓴다 (4000×24000이면 약 400MB). 만들 수 있는 크기인지는 부르는 쪽이 먼저 본다
async function makeJpg(items, width, height, quality, check, post) {
  const canvas = new OffscreenCanvas(width, height);
  try {
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    let y = 0;
    for (const [k, item] of items.entries()) {
      check();
      const bitmap = await openSame(item);
      // 좁은 사진은 가운데에 둔다
      ctx.drawImage(bitmap, Math.floor((width - item.width) / 2), y);
      bitmap.close();
      y += item.height;
      post({ type: "progress", phase: "draw", done: k + 1, total: items.length, rows: y, totalRows: height });
    }
    check();
    post({ type: "progress", phase: "encode" });
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
    // 만든 JPG의 크기가 맞는지 본다. 인코더가 담지 못하는 크기는 오류 없이 잘려 나온 적이 있다
    const made = blob.type === "image/jpeg" ? await jpegSize(async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer())) : null;
    if (!made || made.width !== width || made.height !== height) throw new Error("JPG가 온전히 만들어지지 않았습니다");
    return blob;
  } finally {
    // 캔버스가 잡은 메모리를 바로 놓는다
    canvas.width = 0;
    canvas.height = 0;
  }
}

// PNG로 만든다. 사진을 위에서부터 몇백~몇천 줄씩 흰 바탕에 그려 PNG에 붙인다. 좁은 사진은 가운데에 둔다.
// 캔버스 한 장에 다 그리지 않아 길이에 한계가 없고 메모리를 적게 쓴다
async function makePng(items, width, height, check, post) {
  const sink = blobSink();
  const png = await openPng(width, height, sink);
  try {
    const strip = Math.max(1, Math.min(height, STRIP_ROWS, Math.floor(STRIP_PIXELS / width)));
    const canvas = new OffscreenCanvas(width, strip);
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.fillStyle = "#fff";
    let rowsDone = 0;
    for (const [k, item] of items.entries()) {
      check();
      const bitmap = await openSame(item);
      try {
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
    await png.finish();
    return sink.blob;
  } catch (err) {
    await png.abort(err);
    throw err;
  }
}

async function run({ id, files, format = "png", quality = 95, sizes = null }) {
  const current = { id, cancelled: false };
  job = current;
  const post = (message) => self.postMessage({ id, ...message });
  const check = () => {
    if (current.cancelled) throw new Cancelled();
  };
  const skipped = [];
  try {
    // 1. 크기 재기. 폭(가장 넓은 사진)과 높이(모두 더한 값)를 알아야 형식을 정하고 PNG 머리를 쓸 수 있어서 한 번 열어 본다
    const items = [];
    for (const [k, file] of files.entries()) {
      check();
      const known = sizes?.[k];
      if (known) {
        // 사진을 골라 붙일 때는 화면이 목록을 보이면서 크기를 이미 쟀다. 그릴 때 크기가 같은지 다시 본다
        items.push({ file, width: known.width, height: known.height });
      } else {
        try {
          const bitmap = await decode(file);
          items.push({ file, width: bitmap.width, height: bitmap.height });
          bitmap.close();
        } catch {
          skipped.push(file.name);
        }
      }
      post({ type: "progress", phase: "measure", done: k + 1, total: files.length });
    }
    if (!items.length) throw new Error("열 수 있는 사진이 없습니다");
    const width = Math.max(...items.map((item) => item.width));
    const height = items.reduce((sum, item) => sum + item.height, 0);
    const done = (blob, made, note) =>
      post({ type: "done", width, height, bytes: blob.size, count: items.length, skipped, blob, format: made, note });

    // 2. JPG를 바라면 JPG로 만든다. 너무 길거나 커서 JPG로 만들 수 없으면, 또는 만들다 실패하면 PNG로 만들고 까닭을 알린다
    let note = null;
    if (format === "jpg") {
      note = sizeProblem(width, height);
      if (!note) {
        try {
          done(await makeJpg(items, width, height, quality, check, post), "jpg", null);
          return;
        } catch (err) {
          if (err instanceof Cancelled) throw err;
          note = `브라우저가 JPG를 만들지 못했습니다 (${err?.message || err})`;
        }
      }
    }

    // 3. PNG로 만든다
    done(await makePng(items, width, height, check, post), "png", note);
  } catch (err) {
    if (err instanceof Cancelled) post({ type: "cancelled", skipped });
    else post({ type: "error", message: err?.message || String(err), skipped });
  } finally {
    if (job === current) job = null;
  }
}
