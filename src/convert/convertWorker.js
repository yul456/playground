// 사진 하나를 받아 다른 형식으로 바꾼다. 화면이 멈추지 않게 따로 돈다(Web Worker).
// 받는 것: { type: "run", id, file: File, mime: 만들 형식("image/jpeg"), quality: 품질(1~100) }
// 보내는 것: progress(phase: open · make), done(blob, width, height), error(message)
// 한 번에 하나만 맡는다. 멈출 때는 화면 쪽이 작업자를 통째로 끝낸다 (브라우저가 그림을 열고 만드는 일은 중간에 멈출 수 없다).
// 파일로 저장하는 일은 화면 쪽이 한다 (shared/saveToFolder.js)
import { jpegSize, pngInfo, sizeProblem } from "../shared/imageInfo.js";

// 바꾸지 못하는 까닭을 화면에 그대로 보일 오류
class Refused extends Error {}

const reader = (blob) => async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());

async function convert({ file, mime, quality }, post) {
  // 1. PNG 머리만 읽어 크기를 본다. 너무 큰 그림은 여는 데만도 메모리를 많이 쓰므로 열기 전에 거른다
  const info = await pngInfo(reader(file)).catch(() => null);
  if (info) {
    const problem = sizeProblem(info.width, info.height);
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
  const problem = sizeProblem(width, height);
  if (problem) {
    bitmap.close();
    throw new Refused(problem);
  }

  // 3. 캔버스에 올려 새 형식으로 만든다
  post({ type: "progress", phase: "make" });
  const canvas = new OffscreenCanvas(width, height);
  try {
    if (info && !info.alpha) {
      // 투명한 곳이 없는 PNG는 연 그림을 캔버스에 그대로 넘긴다. 다시 그리면 같은 크기의 메모리를 한 벌 더 쓴다
      canvas.getContext("bitmaprenderer").transferFromImageBitmap(bitmap);
    } else {
      // JPG에는 투명도가 없다. 투명한 곳이 검게 나오지 않도록 흰 바탕에 그린다
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
    }
    const blob = await canvas.convertToBlob({ type: mime, quality: quality / 100 });
    // 브라우저가 그 형식을 만들지 못하면 PNG를 돌려준다
    if (blob.type !== mime) throw new Refused("이 브라우저는 이 형식으로 만들지 못합니다");
    // 4. 만든 JPG의 크기가 원본과 같은지 본다. 인코더가 담지 못하는 크기는 오류 없이 잘려 나온 적이 있다
    if (mime === "image/jpeg") {
      const made = await jpegSize(reader(blob));
      if (!made || made.width !== width || made.height !== height) {
        throw new Refused("브라우저가 그림을 끝까지 담지 못했습니다");
      }
    }
    return { blob, width, height };
  } finally {
    // 캔버스가 잡은 메모리를 바로 놓는다
    canvas.width = 0;
    canvas.height = 0;
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
