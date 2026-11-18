// 화면 쪽에서 작업자(cropWorker.js)에 사진을 하나씩 맡긴다. 결과: { blob, width, height } · { error }
let worker = null;
let nextId = 1;
const waiting = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./cropWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    waiting.get(data.id)?.(data);
    waiting.delete(data.id);
  };
  // 작업 파일을 못 불러왔거나 작업자 안에서 잡지 못한 오류. 다음 사진은 작업자를 새로 만들어 맡긴다
  worker.onerror = (e) => {
    e.preventDefault();
    worker.terminate();
    worker = null;
    for (const done of waiting.values()) done({ error: e.message || "작업 중 오류가 났습니다" });
    waiting.clear();
  };
  return worker;
}

// file을 crop만큼 잘라 type 형식으로 만든다. type: { mime, raw } (rules.js의 outputType), quality: JPG 품질(1~100)
export function cropFile(file, crop, type, quality) {
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    getWorker().postMessage({ id, file, crop, mime: type.mime, raw: type.raw, quality });
  });
}
