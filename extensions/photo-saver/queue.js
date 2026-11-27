// 열린 탭 받기 목록(주소로 더한 페이지)을 둘 저장소 이름과 크기.
// 목록은 chrome.storage.local의 QUEUE_KEY에 [{ url, title }]로 둔다. 고치는 일은 서비스 워커가 맡고(background.js의 queue-* 메시지),
// 열린 탭 받기 화면과 사이드바는 저장소를 읽고 바뀜(storage.onChanged)을 듣는다

export const QUEUE_KEY = "addedPages";
// 확장 프로그램 창의 "열고 바로 받기"(1.35.0)가 열린 탭 받기 화면에 받을 주소를 넘기는 표시: { urls, windowId, at, tabId | token }.
// 서비스 워커가 받을 화면 하나를 정해 적는다(이미 열린 화면이면 그 탭 번호, 새로 여는 화면이면 그 주소의 auto 값).
// 그 화면만 표시를 지우고 그 주소들만 체크해 받기를 시작한다 (batch.js의 takeAutoRun. 화면이 둘 열려 있어도 함께 받지 않게)
export const AUTO_RUN_KEY = "autoRun";
// 세션 저장소(chrome.storage.session, 브라우저를 끌 때까지)의 이름 (1.35.0).
// OPENING_KEY: 서비스 워커가 "탭으로 열기"로 탭을 여는 중이면 { token, windowId, now(지금 여는 탭이 몇째인지), total, at }. 열린 탭 받기의 받기 단추가 "탭 여는 중"을 보인다
// OPENED_KEY: 서비스 워커가 연 탭과 연 때 { 탭 번호: 시각 }. 열린 탭 받기의 "연 뒤 기다리기"가 쓴다
export const OPENING_KEY = "openingTabs";
export const OPENED_KEY = "openedTabs";
// 목록에 둘 수 있는 주소 수
export const QUEUE_MAX = 1000;

export async function loadQueue() {
  try {
    return (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] ?? [];
  } catch {
    return [];
  }
}

// 목록을 고친다. 서비스 워커가 차례로 처리한다. 결과: { added, skipped, full, pages } · { pages } · { inList, pages }
export const queueAdd = (pages) => chrome.runtime.sendMessage({ type: "queue-add", pages });
export const queueRemove = (urls) => chrome.runtime.sendMessage({ type: "queue-remove", urls });
export const queueToggle = (page) => chrome.runtime.sendMessage({ type: "queue-toggle", page });
// 목록의 순서를 바꾼다: urls의 순서대로 놓고, urls에 없는 주소는 그 뒤에 원래 순서대로 둔다
export const queueReorder = (urls) => chrome.runtime.sendMessage({ type: "queue-reorder", urls });

// 목록이 바뀌면 onChange(pages)를 부른다
export function watchQueue(onChange) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[QUEUE_KEY]) onChange(changes[QUEUE_KEY].newValue ?? []);
  });
}
