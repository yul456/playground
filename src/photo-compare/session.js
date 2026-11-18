// 화면 쪽에서 작업자(compareWorker.js)를 부리고, 받은 칸(타일)을 기억해 둔다.
// 원본을 새로 고르면 작업자를 통째로 새로 만든다 (열어 둔 큰 그림의 메모리를 바로 놓고, 하던 일도 버린다)

// 기억해 둘 칸의 화소 수 (약 160MB). 넘으면 오래 안 쓴 칸부터 버린다. 지금 보이는 칸은 버리지 않는다
const BUDGET = 40_000_000;

export class Session {
  // on: { opened, openError, added, addError, cuts, size, sizeError, tileError } (모두 고르는 대로).
  // 칸이 오면 redraw를 부른다 (보기 칸(Viewer.jsx)이 넣어 둔다)
  constructor(on) {
    this.on = on;
    this.gen = 1;
    this.cache = new Map(); // key → { bitmap, sx, sy, pixels, used }
    this.pixels = 0;
    this.frame = 0;
    this.asked = "";
    this.failed = new Set();
    this.worker = new Worker(new URL("./compareWorker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = ({ data }) => this.receive(data);
    // 작업 파일을 못 불러왔거나 작업자 안에서 잡지 못한 오류
    this.worker.onerror = (e) => {
      e.preventDefault();
      this.on.openError?.(e.message || "작업 중 오류가 났습니다");
    };
  }

  receive(data) {
    // 나누는 방법을 바꾸기 전에 만든 칸과 용량은 버린다
    if (data.gen !== undefined && data.gen !== this.gen) {
      data.bitmap?.close();
      data.overview?.close();
      return;
    }
    switch (data.type) {
      case "opened":
        this.on.opened?.(data);
        break;
      case "open-error":
        this.on.openError?.(data.message);
        break;
      case "added":
        this.on.added?.(data);
        break;
      case "add-error":
        this.on.addError?.(data);
        break;
      case "cuts":
        this.on.cuts?.(data.cuts);
        break;
      case "size":
        this.on.size?.(data);
        break;
      case "size-error":
        this.on.sizeError?.(data);
        break;
      case "tile":
        this.store(data);
        this.redraw?.();
        break;
      case "tile-error":
        this.failed.add(data.key);
        this.on.tileError?.(data);
        break;
      default:
    }
  }

  open(file, splitMode) {
    this.worker.postMessage({ type: "open", gen: this.gen, file, splitMode });
  }

  add(id, files) {
    this.worker.postMessage({ type: "add", id, files });
  }

  remove(id) {
    this.worker.postMessage({ type: "remove", id });
    for (const [key, entry] of this.cache) {
      if (key.startsWith(`${id}|`)) this.drop(key, entry);
    }
  }

  // 나누는 방법을 바꾼다. 장의 경계가 달라져 품질별 칸과 용량을 모두 새로 만든다
  split(splitMode) {
    this.gen++;
    this.clear();
    this.worker.postMessage({ type: "split", gen: this.gen, splitMode });
  }

  measure(qualities) {
    this.worker.postMessage({ type: "measure", gen: this.gen, qualities });
  }

  // 칸 하나. 있으면 이번 그리기에 썼다고 적는다
  tile(key) {
    const entry = this.cache.get(key);
    if (entry) entry.used = this.frame;
    return entry;
  }

  // 그리기 한 번을 시작한다 (이번에 쓴 칸은 버리지 않는다)
  begin() {
    this.frame++;
  }

  // 아직 없는 칸을 만들어 달라고 한다. jobs: [{ key, version, tile }] (먼저 보일 것부터).
  // 달라는 목록이 지난번과 같으면 다시 보내지 않는다
  want(jobs) {
    const missing = jobs.filter((job) => !this.cache.has(job.key) && !this.failed.has(job.key));
    const asked = missing.map((job) => job.key).join(",");
    if (asked === this.asked) return;
    this.asked = asked;
    this.worker.postMessage({ type: "want", gen: this.gen, tiles: missing });
  }

  store({ key, bitmap, sx, sy }) {
    const old = this.cache.get(key);
    if (old) this.drop(key, old);
    const pixels = bitmap.width * bitmap.height;
    this.cache.set(key, { bitmap, sx, sy, pixels, used: this.frame });
    this.pixels += pixels;
    if (this.pixels <= BUDGET) return;
    const stale = [...this.cache].filter(([, entry]) => entry.used < this.frame).sort((a, b) => a[1].used - b[1].used);
    for (const [k, entry] of stale) {
      if (this.pixels <= BUDGET) break;
      this.drop(k, entry);
    }
  }

  drop(key, entry) {
    entry.bitmap.close();
    this.pixels -= entry.pixels;
    this.cache.delete(key);
  }

  clear() {
    for (const [key, entry] of this.cache) this.drop(key, entry);
    this.asked = "";
    this.failed.clear();
  }

  dispose() {
    this.clear();
    this.worker.terminate();
  }
}
