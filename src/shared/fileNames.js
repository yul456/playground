// 고른 폴더를 읽을 때 쓰는 이름 규칙: 이름순, 건너뛸 폴더.

// 윈도우가 드라이브마다 두는 시스템 폴더
const SYSTEM_FOLDERS = new Set(["$recycle.bin", "system volume information"]);

// 숨김 폴더(.으로 시작)와 시스템 폴더는 읽지 않는다
export const isSkippedFolder = (name) => name.startsWith(".") || SYSTEM_FOLDERS.has(name.toLowerCase());

// 윈도우 탐색기 이름순처럼 숫자는 크기대로(1, 2, 10) 놓고 대소문자는 가리지 않는다
const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
export const compareNames = (a, b) => collator.compare(a, b);

// 폴더 경로(이름 배열)를 위 폴더부터 이름순으로 견준다
export function comparePaths(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareNames(a[i], b[i]);
    if (order) return order;
  }
  return a.length - b.length;
}
