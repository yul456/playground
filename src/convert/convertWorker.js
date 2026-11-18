// 사진 하나를 받아 다른 형식으로 바꾼다. 화면이 멈추지 않게 따로 돈다(Web Worker).
// 받는 것: { type: "run", id, file: File, mime: 만들 형식("image/jpeg"), quality: 품질(1~100),
//          split: 너무 긴 그림을 여러 장으로 나눌지(아니면 바꾸지 않는다), splitMode: 나누는 방법(shared/imageInfo.js의 SPLIT_MODES) }
// 보내는 것: progress(phase: open · find · make), done(parts: [{ blob, height }], width, height), error(message)
// JPG 한 장에 담기에 너무 긴 그림은 나눌 자리 근처에서 자를 줄을 찾아 여러 장(parts)으로 만든다. 나머지는 한 장이다.
// 한 번에 하나만 맡는다. 멈출 때는 화면 쪽이 작업자를 통째로 끝낸다 (브라우저가 그림을 열고 만드는 일은 중간에 멈출 수 없다).
// 파일로 저장하는 일은 화면 쪽이 한다 (shared/saveToFolder.js)
import { jpegSize, jpgMaxHeight, pngInfo, sizeProblem, widthProblem } from "../shared/imageInfo.js";
import { addMark, hasMark } from "../shared/resultMark.js";
import { drawRows, findCuts, release } from "../shared/rowCuts.js";

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

  // 4. 너무 길면 나눌 자리마다 그 근처에서 자를 줄을 찾아 여러 장으로 만든다 (shared/rowCuts.js의 findCuts.
  //    장수는 나누는 방법과 상관없이 같고, 화면도 같은 규칙으로 미리 세어 저장할 이름을 정한다.
  //    사진 비교도 같은 함수로 나눠 보여 준다)
  try {
    post({ type: "progress", phase: "find" });
    const cuts = findCuts(bitmap, maxHeight, splitMode, alpha);
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
    const made = await convert(data, post);
    // 사진 세로로 붙이기가 만든 그림(표시가 있는 PNG)을 바꾼 것이면 그 표시(shared/resultMark.js)를 옮겨 넣는다.
    // 붙이기 화면이 바꾼 JPG도 지난 결과로 알아보게 하려는 것이다
    if (await hasMark(data.file)) for (const part of made.parts) part.blob = await addMark(part.blob);
    post({ type: "done", ...made });
  } catch (err) {
    const message = err instanceof Refused ? err.message : `브라우저가 이 그림을 바꾸지 못했습니다 (${err?.message || err})`;
    post({ type: "error", message });
  }
};
