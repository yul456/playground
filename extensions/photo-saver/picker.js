// 사이드바의 "링크 고르기"가 페이지(프레임마다)에 넣는 스크립트(links.js가 chrome.scripting.executeScript의 files로 넣는다).
// 사이드바와 연결(port)되어 있는 동안만 동작하고, 사이드바를 닫거나 고르기를 끄거나 다른 탭으로 가면 연결이 끊겨 원래대로 돌아간다.
// - 링크를 누르면 열지 않고 사이드바에 알린다. 사이드바가 열린 탭 받기 목록에 넣거나 빼고 결과를 돌려준다
// - 목록에 있는 링크는 초록 테두리, 마우스를 올린 링크는 파란 점선 테두리로 보인다
// - Ctrl·⌘·Shift·Alt를 누르고 누르거나 가운데 버튼으로 누르면 브라우저가 하던 대로 둔다
// 같은 프레임에 두 번 넣어도 한 번만 준비하고, 연결될 때마다 다시 켠다
(() => {
  if (window.__photoSaverPicker) return;
  window.__photoSaverPicker = true;

  const PORT_NAME = "photo-saver-picker";
  const MARK = "data-photo-saver-picked";
  const PICKING = "data-photo-saver-picking";
  // 이 프레임을 알아볼 이름. 누른 프레임에만 알림 글을 띄운다
  const frameKey = Math.random().toString(36).slice(2);
  let port = null;
  let marks = new Set();
  let style = null;
  let observer = null;
  let timer = null;

  const strip = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };
  const anchorOf = (event) =>
    event.composedPath().find((el) => el instanceof Element && (el.localName === "a" || el.localName === "area") && el.hasAttribute("href"));
  const textOf = (a) =>
    (a.textContent || a.getAttribute("title") || a.querySelector?.("img[alt]")?.alt || "").replace(/\s+/g, " ").trim().slice(0, 200);

  // 목록에 있는 링크에 표시를 단다 (같은 주소의 링크가 여럿이면 모두)
  function paint() {
    for (const a of document.querySelectorAll("a[href], area[href]")) {
      const url = strip(a.getAttribute("href"));
      if (url && marks.has(url)) a.setAttribute(MARK, "");
      else a.removeAttribute(MARK);
    }
  }

  function toast(text) {
    const id = "photo-saver-toast";
    document.getElementById(id)?.remove();
    const box = document.createElement("div");
    box.id = id;
    box.textContent = text;
    box.setAttribute("role", "status");
    box.style.cssText = [
      "position:fixed",
      "left:50%",
      "bottom:24px",
      "transform:translateX(-50%)",
      "z-index:2147483647",
      "max-width:80vw",
      "padding:10px 16px",
      "border-radius:10px",
      "background:rgba(28,39,51,.92)",
      "color:#fff",
      "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif",
      "box-shadow:0 4px 16px rgba(0,0,0,.25)",
      "pointer-events:none",
    ].join(";");
    (document.body || document.documentElement).append(box);
    setTimeout(() => box.remove(), 2000);
  }

  function onClick(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const a = anchorOf(event);
    if (!a) return;
    // 페이지가 링크를 열지 못하게 막는다 (페이지의 다른 클릭 처리보다 먼저 받으려고 window에서 capture로 듣는다)
    event.preventDefault();
    event.stopImmediatePropagation();
    const url = strip(a.getAttribute("href"));
    if (!url) {
      toast("주소가 없는 링크(스크립트로 여는 링크)라 넣을 수 없습니다");
      return;
    }
    port?.postMessage({ type: "pick", url, text: textOf(a), from: frameKey });
  }

  function start(next) {
    port = next;
    document.documentElement.setAttribute(PICKING, "");
    style = document.createElement("style");
    style.textContent = `
      html[${PICKING}] a[href]:hover, html[${PICKING}] area[href]:hover {
        outline: 2px dashed #2563eb !important; outline-offset: 2px !important; cursor: copy !important;
      }
      a[${MARK}], area[${MARK}] {
        outline: 2px solid #16a34a !important; outline-offset: 2px !important; background-color: rgba(22, 163, 74, 0.14) !important;
      }`;
    (document.head || document.documentElement).append(style);
    window.addEventListener("click", onClick, true);
    // 글 목록을 스크롤로 더 불러오는 페이지도 새로 생긴 링크에 표시를 단다
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, 200);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stop() {
    window.removeEventListener("click", onClick, true);
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    style?.remove();
    style = null;
    document.documentElement.removeAttribute(PICKING);
    for (const a of document.querySelectorAll(`[${MARK}]`)) a.removeAttribute(MARK);
    marks = new Set();
    port = null;
  }

  chrome.runtime.onConnect.addListener((next) => {
    if (next.name !== PORT_NAME) return;
    if (port) stop();
    start(next);
    next.onMessage.addListener((message) => {
      if (port !== next) return;
      if (message.type === "marks") {
        marks = new Set(message.urls);
        paint();
      } else if (message.type === "picked") {
        if (message.inList) marks.add(message.url);
        else marks.delete(message.url);
        paint();
        if (message.to === frameKey && message.text) toast(message.text);
      }
    });
    next.onDisconnect.addListener(() => {
      if (port === next) stop();
    });
  });
})();
