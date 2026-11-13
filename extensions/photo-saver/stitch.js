// 고른 사진을 받아 세로로 이어 붙인 그림(Blob)을 만든다. 보이지 않는 문서(offscreen.js)에서 돈다.
// 규칙은 사진 세로로 붙이기(src/stitch)와 같다: 폭은 가장 넓은 사진에 맞추고 크기는 줄이지 않으며,
// 좁은 사진은 가운데에 두고 양옆을 흰색으로 채운다.
// JPG를 바라면 JPG로 만들고, JPG 한 장에 담기에 너무 길면 사진과 사진 사이에서 고르게 나눠 JPG 여러 장으로 만든다.
// 폭이 너무 넓어 JPG로 만들 수 없으면 PNG로 만든다.
// PNG는 png.js(src/stitch/png.js 복사본)로 줄 단위로 이어 쓴다. 크기 한계와 나눌 자리는 imageInfo.js(src/shared/imageInfo.js 복사본)에 있다
import { jpegSize, jpgMaxHeight, splitAtPhotos, widthProblem } from "./imageInfo.js";
import { openPng } from "./png.js";

// 한 번에 그려 PNG로 넘길 화소 수(약 800만 개, 32MB)
const STRIP_PIXELS = 8_000_000;
// 한 번에 그릴 줄 수의 한계. 캔버스는 한 변이 65,535px을 넘을 수 없다.
// 폭이 120px쯤보다 좁은 그림은 화소 수로만 정하면 띠가 그보다 길어져 그림이 그려지지 않는다
const STRIP_ROWS = 16384;
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

// JPG 한 장을 만든다. 이어 붙인 그림의 [start, end) 줄을 캔버스 한 장에 그려 브라우저의 JPG 인코더에 넘긴다
// (인코더는 캔버스 한 장을 통째로 받는다). 나눠 만들 때는 장마다 부른다.
// 캔버스는 화소마다 4바이트를 쓴다. 만들 수 있는 크기인지는 부르는 쪽이 먼저 본다. part: { index: 몇 번째 장(1부터), count: 모두 몇 장 }
async function makeJpg(items, width, [start, end], quality, onProgress, part) {
  const rows = end - start;
  const canvas = new OffscreenCanvas(width, rows);
  try {
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, rows);
    let y = 0;
    for (const [k, item] of items.entries()) {
      const top = y;
      y += item.height;
      // 이 장에 드는 줄만 그린다. 사진 사이에서 나누므로 보통은 사진 하나가 한 장에 다 들고, 한 장보다 긴 사진만 여러 장에 걸친다
      const from = Math.max(start, top);
      const to = Math.min(end, y);
      if (from >= to) continue;
      const bitmap = await open(item);
      ctx.drawImage(bitmap, 0, from - top, item.width, to - from, Math.floor((width - item.width) / 2), from - start, item.width, to - from);
      bitmap.close();
      if (y <= end) item.blob = null; // 다 그린 사진은 놓아 준다 (다음 장에는 들지 않는다)
      onProgress({ phase: "draw", done: k + 1, total: items.length });
    }
    onProgress({ phase: "encode", done: items.length, total: items.length, part: part.index, parts: part.count });
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: quality / 100 });
    // 만든 JPG의 크기가 맞는지 본다. 인코더가 담지 못하는 크기는 오류 없이 잘려 나온 적이 있다
    const made = blob.type === "image/jpeg" ? await jpegSize(async (a, b) => new Uint8Array(await blob.slice(a, b).arrayBuffer())) : null;
    if (!made || made.width !== width || made.height !== rows) throw new Error("JPG가 온전히 만들어지지 않았습니다");
    return blob;
  } finally {
    // 캔버스가 잡은 메모리를 바로 놓는다
    canvas.width = 0;
    canvas.height = 0;
  }
}

// PNG로 만든다. 위에서부터 몇백~몇천 줄씩 흰 바탕에 그려 PNG에 붙인다. 길이에 한계가 없고 메모리를 적게 쓴다
async function makePng(items, width, height, onProgress) {
  const sink = blobSink();
  const png = await openPng(width, height, sink);
  try {
    const strip = Math.max(1, Math.min(height, STRIP_ROWS, Math.floor(STRIP_PIXELS / width)));
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
    await png.finish();
    return sink.blob;
  } catch (err) {
    await png.abort(err);
    throw err;
  }
}

// urls 순서대로 이어 붙인다. onProgress({ phase: "fetch" | "draw" | "encode", done, total, part, parts }).
// format: 바라는 형식("jpg" · "png"), quality: JPG 품질(1~100).
// 결과의 parts는 다 만든 그림 [{ blob, height }]이다. JPG 한 장에 담기에 너무 길어 나눴으면 둘 이상이다.
// format은 실제로 만든 형식이고, note는 JPG를 바랐는데 PNG로 만든 까닭이다
export async function stitchImages(urls, onProgress, { format = "png", quality = 95 } = {}) {
  // 1. 받기와 크기 재기. 폭과 높이를 알아야 형식을 정하고 PNG 머리를 쓸 수 있어서 다 받아 본 뒤에 그린다
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
  const result = (parts, made, note) => ({
    parts,
    width,
    height,
    bytes: parts.reduce((sum, part) => sum + part.blob.size, 0),
    count: items.length,
    failed,
    format: made,
    note,
  });

  // 2. JPG를 바라면 JPG로 만든다. JPG 한 장에 담기에 너무 길면 사진과 사진 사이에서 고르게 나눠 여러 장으로 만든다
  //    (imageInfo.js의 splitAtPhotos, 사진 세로로 붙이기와 같은 규칙). 폭이 너무 넓어 만들 수 없으면,
  //    또는 만들다 실패하면 PNG로 만들고 까닭을 알린다
  let note = null;
  if (format === "jpg") {
    note = widthProblem(width);
    if (!note) {
      try {
        const maxHeight = jpgMaxHeight(width);
        const ranges = height > maxHeight ? splitAtPhotos(items.map((item) => item.height), maxHeight) : [[0, height]];
        const parts = [];
        for (const [k, range] of ranges.entries()) {
          const blob = await makeJpg(items, width, range, quality, onProgress, { index: k + 1, count: ranges.length });
          parts.push({ blob, height: range[1] - range[0] });
        }
        return result(parts, "jpg", null);
      } catch (err) {
        note = `브라우저가 JPG를 만들지 못했습니다 (${err?.message || err})`;
      }
    }
  }

  // 3. PNG로 만든다. PNG는 길이에 한계가 없어 늘 한 장이다
  return result([{ blob: await makePng(items, width, height, onProgress), height }], "png", note);
}
