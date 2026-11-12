// 화면 쪽에서 백그라운드 작업(stitchWorker.js)에 사진 묶음을 맡기고 결과를 기다린다. 한 번에 한 묶음만 맡긴다
let worker = null;
let current = null; // { id, resolve, onProgress }
let nextId = 1;

function finish(message) {
  const { resolve } = current;
  current = null;
  resolve(message);
}

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./stitchWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (!current || data.id !== current.id) return;
    if (data.type === "progress") current.onProgress(data);
    else finish(data);
  };
  // 작업 파일을 못 불러왔거나 작업자 안에서 잡지 못한 오류. 다음 묶음은 작업자를 새로 만들어 맡긴다
  worker.onerror = (e) => {
    e.preventDefault();
    worker.terminate();
    worker = null;
    if (current) finish({ type: "error", message: e.message || "작업 중 오류가 났습니다", skipped: [] });
  };
  return worker;
}

// files: File 목록, format: 바라는 형식("jpg" · "png"), quality: JPG 품질(1~100),
// sizes: 이미 잰 사진 크기 [{ width, height }] (없으면 작업자가 잰다).
// 결과는 done(blob: 다 만든 그림, format: 실제로 만든 형식, note: JPG로 만들지 못한 까닭) · cancelled · error 메시지 그대로 돌려준다
export function runJob(files, format, quality, onProgress, sizes = null) {
  if (current) return Promise.reject(new Error("이미 만드는 중입니다"));
  return new Promise((resolve) => {
    current = { id: nextId++, resolve, onProgress };
    getWorker().postMessage({ type: "run", id: current.id, files, format, quality, sizes });
  });
}

export function cancelJob() {
  if (current) worker?.postMessage({ type: "cancel", id: current.id });
}
