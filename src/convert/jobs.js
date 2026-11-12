// 화면 쪽에서 백그라운드 작업(convertWorker.js)에 사진을 하나씩 맡기고 결과를 기다린다. 한 번에 하나만 맡긴다
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
  worker = new Worker(new URL("./convertWorker.js", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (!current || data.id !== current.id) return;
    if (data.type === "progress") current.onProgress(data);
    else finish(data);
  };
  // 작업 파일을 못 불러왔거나 작업자 안에서 잡지 못한 오류. 다음 사진은 작업자를 새로 만들어 맡긴다
  worker.onerror = (e) => {
    e.preventDefault();
    worker.terminate();
    worker = null;
    if (current) finish({ type: "error", message: e.message || "작업 중 오류가 났습니다" });
  };
  return worker;
}

// file: 바꿀 파일, mime: 만들 형식, quality: 품질(1~100).
// 결과는 done(blob, width, height) · error(message) · cancelled 메시지 그대로 돌려준다
export function runJob(file, mime, quality, onProgress) {
  if (current) return Promise.reject(new Error("이미 바꾸는 중입니다"));
  return new Promise((resolve) => {
    current = { id: nextId++, resolve, onProgress };
    getWorker().postMessage({ type: "run", id: current.id, file, mime, quality });
  });
}

// 맡긴 일을 그만둔다. 그림을 열고 만드는 일은 중간에 멈출 수 없어 작업자를 끝내고, 다음에 새로 만든다
export function cancelJob() {
  if (!current) return;
  worker?.terminate();
  worker = null;
  finish({ type: "cancelled" });
}
