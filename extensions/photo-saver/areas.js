// 확장 프로그램 창의 영역 접기 (1.30.0, 2026-11-25 사용자와 정함).
// 창이 길어서, 영역(바로 열기 · 페이지 손보기 · 찾기·열기 · 사진·영상 받기)마다 제목 줄을 두고 누르면 접는다.
// 접은 영역은 localStorage의 foldedAreas에 기억한다 (이 PC의 창 모양이라 설정 세트와 따로 둔다)
const KEY = "foldedAreas";
const TITLES = { quick: "바로 열기", page: "페이지 손보기", text: "찾기·열기", photos: "사진·영상 받기" };

function loadFolded() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return new Set(Array.isArray(saved) ? saved.filter((name) => name in TITLES) : []);
  } catch {
    return new Set();
  }
}

export function mountAreas() {
  const folded = loadFolded();
  for (const area of document.querySelectorAll("section.area[data-area]")) {
    const name = area.dataset.area;
    // 영역의 내용을 한 상자에 모으고 그 앞에 제목 단추를 둔다
    const body = document.createElement("div");
    body.className = "area-body";
    body.append(...area.childNodes);
    const head = document.createElement("button");
    head.type = "button";
    head.className = "area-head";
    head.textContent = TITLES[name];
    const show = () => {
      const closed = folded.has(name);
      body.hidden = closed;
      head.setAttribute("aria-expanded", String(!closed));
      head.title = closed ? "펼치기" : "접기";
    };
    head.addEventListener("click", () => {
      if (!folded.delete(name)) folded.add(name);
      localStorage.setItem(KEY, JSON.stringify([...folded]));
      show();
    });
    area.append(head, body);
    show();
  }
}
