// 열린 탭 받기 목록(주소로 더한 페이지)을 둘 저장소 이름과 크기.
// 목록은 chrome.storage.local의 QUEUE_KEY에 [{ url, title }]로 둔다. 고치는 일은 서비스 워커가 맡고(background.js의 queue-* 메시지),
// 열린 탭 받기 화면과 사이드바는 저장소를 읽고 바뀜(storage.onChanged)을 듣는다

export const QUEUE_KEY = "addedPages";
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

// 목록이 바뀌면 onChange(pages)를 부른다
export function watchQueue(onChange) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[QUEUE_KEY]) onChange(changes[QUEUE_KEY].newValue ?? []);
  });
}
