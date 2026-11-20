// 고른 글 옆 단추 (페이지 도우미 1.24.0, 사용자 요청 2026-11-19: 한 손(마우스)으로 쓰는 일이 많아 오른쪽 클릭 말고 쓸 방법으로 골랐다).
// 마우스로 글자를 고르면(드래그·더블클릭) 고른 글 끝에 작은 단추를 띄운다. 누르면 구글 검색·주소 열기 목록이 고른 글로 완성된 모양으로 나오고
// ("구글 검색: 편의시설 위치", "열기: aaa.com/편의시설/b"), 고르면 지금 탭 바로 뒤에 새 탭으로 열고 페이지의 고른 글을 풀어 준다(사용자 요청).
// 목록을 만들고 여는 일은 서비스 워커가 한다(text-actions·text-open. 오른쪽 클릭 메뉴와 같은 규칙: search-words.js·url-templates.js).
// - 모든 웹 페이지의 프레임마다 페이지가 뜰 때 들어간다(manifest의 content_scripts). 페이지가 뜰 때는 아무것도 읽지 않고, 글자를 골랐을 때만
//   목록이 있는지와 창에서 끄지 않았는지(selectButton)를 읽는다
// - 입력 칸 안에서 고른 글, 키보드로 고른 글, 페이지가 만든 가짜 이벤트에는 뜨지 않는다. 스크롤·다른 곳 누르기·Esc·고른 글이 없어지면 사라진다
// - 창의 "기호 떼기"에 적어 둔 기호(trimChars, 1.26.0)와 빈칸만 고른 것에도 뜨지 않는다. 고른 글은 앞뒤의 그 기호를 떼고 쓰므로
//   (search-words.js의 cleanSelection) "-"만 고르면 쓸 글이 없다. 이 스크립트는 그 모듈을 가져다 쓸 수 없어, 저장한 적이 없을 때의
//   처음 값("-", 그쪽의 TRIM_DEFAULT)을 여기에도 적어 둔다
// - 확장 프로그램을 새로 고치면 이미 열린 페이지의 이 스크립트는 끊긴다. 그때는 아무것도 하지 않는다 (hide-core.js 참고)
(() => {
  if (self.__photoSaverSelect) return;
  self.__photoSaverSelect = true;
  const UI = "photo-saver-ui";
  const KEYS = ["searchWords", "urlTemplates", "selectButton", "trimChars"];
  const TRIM_DEFAULT = "-";
  let host = null;
  let root = null;
  let text = ""; // 단추를 띄울 때 고른 글
  let shownAt = 0;

  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };
  const send = (message) => {
    if (!alive()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  };
  const ours = (event) => event.target instanceof Element && event.target.localName === UI && event.target === host;

  // 입력 칸이나 고칠 수 있는 곳(contenteditable) 안의 글
  function inEditable(selection) {
    const active = document.activeElement;
    if (active && (active.localName === "input" || active.localName === "textarea" || active.isContentEditable)) return true;
    const node = selection.anchorNode;
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return Boolean(el?.closest?.("input, textarea, [contenteditable]:not([contenteditable=false])"));
  }

  function hide() {
    host?.remove();
    host = root = null;
  }

  function build() {
    host = document.createElement(UI);
    host.style.cssText = ["all: initial !important", "display: block !important", "position: fixed !important", "inset: 0 auto auto 0 !important", "z-index: 2147483647 !important"].join(";");
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .sel-button { position: fixed; display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 50%;
        background: #2563eb; color: #fff; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3); cursor: pointer; }
      .sel-button:hover { background: #1d4ed8; }
      .sel-button svg { width: 16px; height: 16px; }
      .sel-list { position: fixed; display: none; box-sizing: border-box; min-width: 200px; max-width: min(440px, calc(100vw - 16px)); padding: 4px; border-radius: 10px;
        background: #fff; color: #1c2733; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28);
        font: 13px/1.4 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
      .sel-list button { display: block; width: 100%; padding: 6px 10px; overflow: hidden; border: 0; border-radius: 6px; background: none; color: inherit; font: inherit;
        text-align: left; white-space: nowrap; text-overflow: ellipsis; cursor: pointer; }
      .sel-list button:hover, .sel-list button:focus-visible { background: #eff6ff; outline: none; }
      .sel-list .empty { padding: 6px 10px; color: #64748b; }
      @media (prefers-color-scheme: dark) {
        .sel-list { background: #1a2430; color: #e6edf5; }
        .sel-list button:hover, .sel-list button:focus-visible { background: #24364a; }
        .sel-list .empty { color: #94a3b8; }
      }
    </style>
    <button type="button" class="sel-button" title="고른 글로 구글 검색·주소 열기 (페이지 도우미)" aria-label="고른 글로 구글 검색·주소 열기">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15.5 15.5 20 20"/></svg>
    </button>
    <div class="sel-list" role="menu"></div>`;
    // 단추와 목록을 눌러도 페이지의 고른 글이 풀리지 않게 한다
    root.addEventListener("mousedown", (event) => event.preventDefault());
    root.querySelector(".sel-button").addEventListener("click", (event) => {
      if (event.isTrusted) showList();
    });
    document.documentElement.append(host);
  }

  // 고른 글 끝 바로 아래에 단추를 둔다 (화면 밖으로 나가지 않게)
  function place(rect) {
    const button = root.querySelector(".sel-button");
    const x = Math.max(4, Math.min(rect.right + 4, innerWidth - 32));
    const y = Math.max(4, Math.min(rect.bottom + 4, innerHeight - 32));
    Object.assign(button.style, { left: `${x}px`, top: `${y}px` });
  }

  async function showList() {
    if (!root) return;
    const list = root.querySelector(".sel-list");
    const items = await send({ type: "text-actions", text });
    if (!root) return;
    if (!Array.isArray(items)) {
      hide();
      return;
    }
    list.replaceChildren(
      ...(items.length
        ? items.map((item) => {
            const button = document.createElement("button");
            button.type = "button";
            button.setAttribute("role", "menuitem");
            button.textContent = item.label;
            button.title = item.label;
            button.addEventListener("click", (event) => {
              if (!event.isTrusted) return;
              send({ type: "text-open", id: item.id, text });
              hide();
              getSelection()?.removeAllRanges();
            });
            return button;
          })
        : [Object.assign(document.createElement("div"), { className: "empty", textContent: "확장 프로그램 창에서 구글 검색 붙일 말이나 주소를 더해 주세요." })]),
    );
    // 단추 아래에, 화면 아래쪽이면 단추 위에 둔다
    const at = root.querySelector(".sel-button").getBoundingClientRect();
    list.style.display = "block";
    const box = list.getBoundingClientRect();
    const left = Math.max(8, Math.min(at.left, innerWidth - box.width - 8));
    const top = at.bottom + 4 + box.height <= innerHeight - 8 ? at.bottom + 4 : Math.max(8, at.top - 4 - box.height);
    Object.assign(list.style, { left: `${left}px`, top: `${top}px` });
  }

  // 마우스로 글자를 고른 뒤: 고른 글이 있고, 입력 칸 밖이고, 목록이 있고, 창에서 끄지 않았으면 단추를 띄운다
  async function check() {
    const selection = getSelection();
    const raw = selection && !selection.isCollapsed ? selection.toString() : "";
    if (!raw.trim() || inEditable(selection) || !alive()) {
      hide();
      return;
    }
    let state;
    try {
      state = await chrome.storage.local.get(KEYS);
    } catch {
      return;
    }
    if (state.selectButton === false) return;
    const marks = new Set(typeof state.trimChars === "string" ? state.trimChars : TRIM_DEFAULT);
    if (![...raw].some((ch) => !/\s/.test(ch) && !marks.has(ch))) return;
    const count = (Array.isArray(state.searchWords) ? state.searchWords.length : 0) + (Array.isArray(state.urlTemplates) ? state.urlTemplates.length : 0);
    if (!count) return;
    const now = getSelection();
    if (!now || now.isCollapsed || now.toString() !== raw) return;
    const rects = now.getRangeAt(0).getClientRects();
    const rect = rects.length ? rects[rects.length - 1] : now.getRangeAt(0).getBoundingClientRect();
    hide();
    text = raw;
    build();
    place(rect);
    shownAt = Date.now();
  }

  addEventListener(
    "mouseup",
    (event) => {
      if (!event.isTrusted || event.button !== 0 || ours(event)) return;
      // 고른 글은 mouseup의 기본 동작이 끝난 뒤에 정해진다
      setTimeout(check, 0);
    },
    true,
  );
  addEventListener(
    "mousedown",
    (event) => {
      if (host && !ours(event)) hide();
    },
    true,
  );
  addEventListener(
    "keydown",
    (event) => {
      if (host && event.key === "Escape") hide();
    },
    true,
  );
  // 스크롤하면 자리가 어긋나서 치운다 (단추를 띄운 직후에 페이지가 스스로 조금 움직이는 것은 넘긴다)
  addEventListener(
    "scroll",
    () => {
      if (host && Date.now() - shownAt > 200) hide();
    },
    true,
  );
  addEventListener("resize", hide);
  addEventListener("blur", () => {
    // 목록을 열어 둔 채 다른 창으로 가면 치운다 (단추만 있을 때는 그대로 둔다)
    if (root?.querySelector(".sel-list")?.style.display === "block") hide();
  });
  document.addEventListener("selectionchange", () => {
    if (!host) return;
    const selection = getSelection();
    if (!selection || selection.isCollapsed) hide();
  });
})();
