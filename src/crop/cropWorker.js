// 사진 하나를 잘라 새 파일로 만든다 (Web Worker. 화면이 멈추지 않게).
// 받는 것: { id, file, crop: { top, bottom, left, right }, mime: "image/png" · "image/jpeg", raw, quality }
// 보내는 것: { id, blob, width, height } · { id, error }
// raw(PNG·JPG): 원본 화소를 색 변환 없이 풀어 자르고, 원본의 색 정보 조각을 결과에 옮겨 넣는다(imageMeta.js).
//   PNG는 자른 곳 말고는 원본과 화소까지 같다. JPG는 다시 압축하므로 조금 달라진다.
// 휴대폰 사진의 회전 정보(EXIF)는 풀 때 적용해 화면에 보이는 대로 자른다. 회전 정보 같은 EXIF는 옮기지 않는다
import { jpegIccSegments, pngColorChunks, withJpegIcc, withPngChunks } from "./imageMeta.js";

const reader = (blob) => async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

async function crop({ file, crop: c, mime, raw, quality }) {
  const options = raw ? { colorSpaceConversion: "none", premultiplyAlpha: "none", imageOrientation: "from-image" } : { imageOrientation: "from-image" };
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, options);
  } catch {
    throw new Error("그림을 열지 못했습니다. 파일이 깨졌거나 브라우저가 열지 못하는 형식입니다");
  }
  const width = bitmap.width - c.left - c.right;
  const height = bitmap.height - c.top - c.bottom;
  if (width < 1 || height < 1) {
    bitmap.close();
    throw new Error("자르고 남는 곳이 없습니다");
  }
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { alpha: mime === "image/png", willReadFrequently: true });
  // JPG에는 투명도가 없어 투명한 곳은 흰색으로 한다
  if (mime === "image/jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.drawImage(bitmap, c.left, c.top, width, height, 0, 0, width, height);
  bitmap.close();
  let blob = await canvas.convertToBlob(mime === "image/jpeg" ? { type: mime, quality: quality / 100 } : { type: mime });
  if (raw) {
    const read = reader(file);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const fixed = mime === "image/png" ? withPngChunks(bytes, await pngColorChunks(read)) : withJpegIcc(bytes, await jpegIccSegments(read));
    if (fixed !== bytes) blob = new Blob([fixed], { type: mime });
  }
  return { blob, width, height };
}

self.onmessage = async ({ data }) => {
  try {
    self.postMessage({ id: data.id, ...(await crop(data)) });
  } catch (err) {
    self.postMessage({ id: data.id, error: String(err?.message || err) });
  }
};
