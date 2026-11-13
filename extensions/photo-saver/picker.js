// 사이드바의 "링크 고르기"가 페이지(프레임마다)에 넣는 스크립트(links.js가 chrome.scripting.executeScript의 files로 넣는다).
// 사이드바와 연결(port)되어 있는 동안만 동작하고, 사이드바를 닫거나 고르기를 끄거나 다른 탭으로 가면 연결이 끊겨 원래대로 돌아간다.
// - 링크를 누르면 열지 않고 사이드바에 알린다. 사이드바가 열린 탭 받기 목록에 넣거나 빼고 결과를 돌려준다
// - 글을 버튼·표 줄·주소 없는 링크(#, javascript:)의 스크립트로 여는 게시판도 있다. 그런 클릭은 막지 않고 두었다가,
//   페이지가 다른 주소로 넘어가려 하면(Navigation API의 navigate) 그 주소를 잡아 넘어가지 않게 하고 목록에 넣는다.
//   새 창(window.open)으로 여는 것은 collect.js의 wrapWindowOpen이 페이지 쪽에서 잡아 알려 준다(photo-saver-open)
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
  // 마지막으로 누른 것: 스크립트로 넘어갈 때 목록에 붙일 글, 누른 때, 넘어가기를 기다리는지(주소 없는 링크·onclick)
  let lastClick = { text: "", time: 0, waiting: false };
  let silentTimer = null;
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
  const here = () => strip(location.href);
  // 버튼처럼 누르는 것 (글 제목을 담고 있을 만한 가까운 요소)
  const clickableOf = (event) =>
    event.composedPath().find((el) => el instanceof Element && el.matches("[onclick], button, [role=button], [role=link], tr, li"));

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

  // 스크립트로 넘어가기를 기다린 클릭이 1.5초 안에 아무 데로도 넘어가지 않으면 알린다 (화면 안에서 여는 글 등)
  function expectNavigation(text) {
    lastClick = { text, time: Date.now(), waiting: true };
    clearTimeout(silentTimer);
    silentTimer = setTimeout(() => {
      if (lastClick.waiting && port) toast("주소로 넘어가지 않아 넣을 수 없습니다 (화면 안에서 여는 글 등)");
      lastClick.waiting = false;
    }, 1500);
  }

  function send(url, text) {
    // 누른 것의 글은 한 번만 쓴다 (틀에서 바깥 주소를 바꾸는 버튼처럼 이 프레임에서 누르지 않은 이동에 앞 글이 붙지 않게)
    lastClick = { text: "", time: 0, waiting: false };
    clearTimeout(silentTimer);
    port?.postMessage({ type: "pick", url, text, from: frameKey });
  }
  // 방금(3초 안) 누른 것의 글
  const recentText = () => (Date.now() - lastClick.time < 3000 ? lastClick.text : "");

  function onClick(event) {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const a = anchorOf(event);
    if (a) {
      const url = strip(a.getAttribute("href"));
      // 주소 없는 링크(#, javascript:)는 페이지의 스크립트가 글을 열 수 있어 막지 않는다 (넘어가려 할 때 onNavigate가 잡는다)
      if (!url || url === here()) {
        expectNavigation(textOf(a));
        return;
      }
      // 페이지가 링크를 열지 못하게 막는다 (페이지의 다른 클릭 처리보다 먼저 받으려고 window에서 capture로 듣는다)
      event.preventDefault();
      event.stopImmediatePropagation();
      send(url, textOf(a));
      return;
    }
    // 링크가 아닌 것(버튼, 표 줄 등)은 그대로 두고, 넘어가면 이 글을 붙인다. onclick이 있는 것만 넘어가기를 기다린다
    const clickable = clickableOf(event);
    const text = (clickable?.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (clickable?.hasAttribute("onclick")) expectNavigation(text);
    else lastClick = { text, time: Date.now(), waiting: false };
  }

  // 페이지가 다른 주소로 넘어가려 할 때(스크립트로 여는 글). 사용자가 방금 누른 뒤(userActivation)의 이동만 잡는다.
  // 자동 이동, # 이동, 뒤로·새로 고침, 주소만 고치는 replaceState, 검색 같은 GET 양식은 그대로 둔다
  function onNavigate(event) {
    if (!port || !event.cancelable || event.hashChange || event.downloadRequest) return;
    if (event.navigationType !== "push" && event.navigationType !== "replace") return;
    if (event.destination.sameDocument && event.navigationType !== "push") return;
    if (!navigator.userActivation?.isActive) return;
    const source = event.sourceElement;
    if (!event.formData && (source?.localName === "form" || source?.form)) return;
    if (event.formData) {
      // 양식(POST)으로 여는 글은 주소만으로 다시 열 수 없다
      event.preventDefault();
      lastClick.waiting = false;
      toast("양식으로 여는 글이라 주소로 넣을 수 없습니다");
      return;
    }
    const url = strip(event.destination.url);
    if (!url || url === here()) return;
    event.preventDefault();
    send(url, recentText());
  }

  // 새 창으로 여는 글 (collect.js wrapWindowOpen이 알려 준다)
  function onOpen(event) {
    if (!port) return;
    const url = strip(event.detail);
    if (!url) toast("주소가 없는 새 창이라 넣을 수 없습니다");
    else send(url, recentText());
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
    window.navigation?.addEventListener("navigate", onNavigate);
    document.addEventListener("photo-saver-open", onOpen);
    // 글 목록을 스크롤로 더 불러오는 페이지도 새로 생긴 링크에 표시를 단다
    observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(paint, 200);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function stop() {
    window.removeEventListener("click", onClick, true);
    window.navigation?.removeEventListener("navigate", onNavigate);
    document.removeEventListener("photo-saver-open", onOpen);
    clearTimeout(silentTimer);
    lastClick = { text: "", time: 0, waiting: false };
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
