// 확장 프로그램 창(팝업·사이드바) 맨 위의 바로 열기 (사용자 요청, 2026-11-19, 1.25.0).
// 사용자는 윈도우에서 복사해 두고 크롬에서 바로 완성된 주소를 보기를 바랐다(주소창이 그렇게 될 줄 알았다). 크롬은 확장 프로그램이 주소창에
// 미리 채우는 것을 허락하지 않아서, 아이콘을 누르면 창 맨 위에 보이게 했다:
// - 지금 페이지에서 고른 글이 있으면 그 글, 없으면 클립보드의 글 ("고른 글: …" / "복사한 글: …")
// - 그 글로 완성한 구글 검색·주소 열기 단추 (서비스 워커의 text-actions. 오른쪽 클릭 메뉴·고른 글 옆 단추와 같은 목록·규칙)
// - 누르면 지금 탭 바로 뒤에 새 탭으로 연다 (text-open). 고른 글로 열었으면 그 페이지의 고름을 풀어 준다
// 구글 검색 붙일 말이나 주소가 하나도 없으면 아무것도 읽지 않고 보이지 않는다. 사이드바는 탭을 바꾸거나 사이드바를 다시 누를 때(focus) 다시 읽는다.
// 창의 "기호 떼기"에 적어 둔 기호(처음엔 "-", 1.26.0)는 앞뒤에서 뗀 글을 보이고 쓴다 ("399-"를 복사했으면 "복사한 글: 399")
import { SEARCH_KEY, TRIM_KEY, cleanSelection, loadMarks, loadWords } from "./search-words.js";
import { URL_KEY, loadTemplates } from "./url-templates.js";

const $ = (id) => document.getElementById(id);
const SHOWN_TEXT = 40; // "복사한 글: …"에 보일 글자 수

// 지금 탭에서 고른 글 (맨 위 프레임 먼저, 없으면 안쪽 틀). 크롬이 막는 페이지면 빈 글. 다듬고 나면 남는 글이 없는 고름(기호뿐 등)은 건너뛴다
async function selectedText(tabId, marks) {
  const results = await chrome.scripting
    .executeScript({ target: { tabId, allFrames: true }, func: () => getSelection()?.toString() ?? "" })
    .catch(() => []);
  results.sort((a, b) => (a.frameId === 0 ? -1 : b.frameId === 0 ? 1 : 0));
  return results.map((r) => r.result).find((text) => typeof text === "string" && cleanSelection(text, marks)) ?? "";
}

// 클립보드의 글 (clipboardRead 권한). 창에 초점이 없으면 navigator.clipboard가 거절해서, 보이지 않는 글 칸에 붙여 넣어 읽는다
async function clipboardText() {
  try {
    return await navigator.clipboard.readText();
  } catch {
    const area = document.createElement("textarea");
    area.style.cssText = "position: fixed; top: 0; left: 0; width: 1px; height: 1px; opacity: 0;";
    document.body.append(area);
    const before = document.activeElement;
    area.focus();
    document.execCommand("paste");
    const text = area.value;
    area.remove();
    before?.focus?.({ preventScroll: true });
    return text;
  }
}

export function mountQuick({ inPanel }) {
  let tabId = null;
  let run = 0;
  const box = $("quick");
  const source = $("quickSource");
  const list = $("quickList");

  async function refresh() {
    const id = ++run;
    const [words, templates, marks] = await Promise.all([loadWords(), loadTemplates(), loadMarks()]);
    if (id !== run) return;
    if (!words.length && !templates.length) {
      box.hidden = true;
      return;
    }
    let from = "selection";
    let text = tabId != null ? await selectedText(tabId, marks) : "";
    if (!cleanSelection(text, marks)) {
      from = "clipboard";
      text = await clipboardText().catch(() => "");
    }
    if (id !== run) return;
    const clean = cleanSelection(text, marks);
    box.hidden = false;
    if (!clean) {
      source.textContent = "글자를 고르거나 복사하면 여기에 완성된 구글 검색·주소 열기가 나옵니다.";
      list.replaceChildren();
      return;
    }
    const items = await chrome.runtime.sendMessage({ type: "text-actions", text: clean }).catch(() => []);
    if (id !== run) return;
    source.textContent = `${from === "selection" ? "고른 글" : "복사한 글"}: ${clean.length > SHOWN_TEXT ? `${clean.slice(0, SHOWN_TEXT - 1)}…` : clean}`;
    source.title = clean;
    list.replaceChildren(
      ...(Array.isArray(items) ? items : []).map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = item.label;
        button.title = item.label;
        button.addEventListener("click", async () => {
          await chrome.runtime.sendMessage({ type: "text-open", id: item.id, text: clean, tabId, clear: from === "selection" }).catch(() => {});
          // 팝업은 새 탭이 앞으로 오면 저절로 닫힌다. 사이드바는 그대로 둔다
          if (!inPanel) window.close();
        });
        return button;
      }),
    );
  }

  // 목록을 고치거나 뗄 기호를 바꾸면(이 창이나 다른 창에서) 다시 만든다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && (changes[SEARCH_KEY] || changes[URL_KEY] || changes[TRIM_KEY])) refresh();
  });
  // 사이드바는 열어 둔 채 다른 프로그램에서 복사하고 돌아와 누르므로, 창에 초점이 올 때 다시 읽는다
  if (inPanel) addEventListener("focus", () => refresh());

  return {
    setTab(id) {
      tabId = id;
      refresh();
    },
  };
}
