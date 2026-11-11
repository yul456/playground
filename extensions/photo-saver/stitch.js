// 고른 사진을 받아 세로로 이어 붙인 PNG(Blob)를 만든다. 보이지 않는 문서(offscreen.js)에서 돈다.
// 규칙은 사진 세로로 붙이기(src/stitch)와 같다: 폭은 가장 넓은 사진에 맞추고 크기는 줄이지 않으며,
// 좁은 사진은 가운데에 두고 양옆을 흰색으로 채운다. PNG는 png.js(src/stitch/png.js 복사본)로 줄 단위로 이어 쓴다
import { openPng } from "./png.js";

// 한 번에 그려 PNG로 넘길 화소 수(약 800만 개, 32MB)
const STRIP_PIXELS = 8_000_000;
// 만든 PNG를 이만큼씩 Blob으로 묶는다. 크롬은 큰 Blob을 디스크에 내려 둘 수 있어 메모리를 덜 쓴다
const BLOB_BYTES = 64 << 20;
// 한 번에 받는 사진 수
const FETCHING = 4;

// 휴대폰 사진의 회전 정보(EXIF)를 따라 세운다
let decodeOptions = { imageOrientation: "from-image" };
async function decode(blob) {
  try {
    return await createImageBitmap(blob, decodeOptions);
  } catch (err) {
    if (!(err instanceof TypeError) || !decodeOptions) throw err;
    decodeOptions = undefined;
    return createImageBitmap(blob);
  }
}

// SVG는 createImageBitmap이 Blob에서 바로 열지 못한다. <img>로 읽어 그 크기대로 그림(비트맵)으로 바꾼다.
// 크기는 SVG에 적힌 크기이고, 적혀 있지 않으면 크롬이 정한 크기다(팝업 미리보기에 나오는 크기와 같다).
// <img>로 읽는 SVG는 스크립트가 돌지 않고 바깥 파일도 불러오지 않는다
async function decodeSvg(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((ok, fail) => {
      img.onload = ok;
      img.onerror = () => fail(new Error("열 수 없는 SVG"));
      img.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = img;
    if (!width || !height) throw new Error("크기를 알 수 없는 SVG");
    // 캔버스에 크기를 정해 그린다. createImageBitmap(img)은 크기가 적혀 있지 않은 SVG(viewBox만 있는 것)를 빈 그림으로 만들었다
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").drawImage(img, 0, 0, width, height);
    return canvas.transferToImageBitmap();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const open = (item) => (item.svg ? decodeSvg(item.blob) : decode(item.blob));

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

// 사진을 받아 한 번 열어 크기를 잰다. 못 하면 까닭을 돌려준다 (fetch: 받지 못함, decode: 열지 못하는 형식)
async function load(url) {
  let blob;
  try {
    const res = await fetch(url, { credentials: "include", referrerPolicy: "no-referrer" });
    if (!res.ok) return { failed: "fetch" };
    blob = await res.blob();
  } catch {
    return { failed: "fetch" };
  }
  const item = { blob, svg: /svg/i.test(blob.type), width: 0, height: 0 };
  try {
    const bitmap = await open(item);
    item.width = bitmap.width;
    item.height = bitmap.height;
    bitmap.close();
    return item;
  } catch {
    return { failed: "decode" };
  }
}

// urls 순서대로 이어 붙인다. onProgress({ phase: "fetch" | "draw", done, total })
export async function stitchImages(urls, onProgress) {
  // 1. 받기와 크기 재기. PNG 머리에 폭과 높이를 먼저 적어야 해서 다 받아 본 뒤에 그린다
  const loaded = new Array(urls.length);
  let next = 0;
  let fetched = 0;
  const worker = async () => {
    while (next < urls.length) {
      const i = next++;
      loaded[i] = await load(urls[i]);
      onProgress({ phase: "fetch", done: ++fetched, total: urls.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(FETCHING, urls.length) }, worker));
  const items = loaded.filter((item) => !item.failed);
  // 붙이지 못하고 뺀 사진: 고른 순서의 번호(1부터)와 까닭
  const failed = loaded.flatMap((item, i) => (item.failed ? [{ n: i + 1, why: item.failed }] : []));
  if (!items.length) throw new Error("이어 붙일 수 있는 사진이 없습니다");
  const width = Math.max(...items.map((item) => item.width));
  const height = items.reduce((sum, item) => sum + item.height, 0);

  // 2. 위에서부터 몇백~몇천 줄씩 흰 바탕에 그려 PNG에 붙인다
  const sink = blobSink();
  const png = await openPng(width, height, sink);
  try {
    const strip = Math.max(1, Math.min(height, Math.floor(STRIP_PIXELS / width)));
    const canvas = new OffscreenCanvas(width, strip);
    const ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    ctx.fillStyle = "#fff";
    for (const [k, item] of items.entries()) {
      const bitmap = await open(item);
      try {
        const x = Math.floor((width - item.width) / 2);
        for (let y = 0; y < item.height; y += strip) {
          const rows = Math.min(strip, item.height - y);
          ctx.fillRect(0, 0, width, rows);
          ctx.drawImage(bitmap, 0, y, item.width, rows, x, 0, item.width, rows);
          await png.writeRows(ctx.getImageData(0, 0, width, rows).data, rows);
        }
      } finally {
        bitmap.close();
      }
      item.blob = null; // 다 그린 사진은 놓아 준다
      onProgress({ phase: "draw", done: k + 1, total: items.length });
    }
    const bytes = await png.finish();
    return { blob: sink.blob, width, height, bytes, count: items.length, failed };
  } catch (err) {
    await png.abort(err);
    throw err;
  }
}
