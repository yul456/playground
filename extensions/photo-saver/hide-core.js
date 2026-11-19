// 보기 싫은 부분 숨기기 (사용자 요청, 2026-11-19, 1.20.0). 페이지의 프레임마다 도는 콘텐츠 스크립트다 (격리된 공간, 모듈이 아닌 그냥 스크립트).
// - 들어가는 길: 오른쪽 클릭 메뉴("이 부분 숨기기"·"이 부분 늘 숨기기")와 "숨길 곳 고르기"를 쓸 때 서비스 워커가 executeScript로 넣고,
//   늘 숨기는 곳이 있는 사이트는 페이지가 뜰 때 콘텐츠 스크립트로 들어간다 (hide-sites.js가 등록). 같은 프레임에 두 번 들어가도 한 번만 준비한다
// - 숨기기: 그 요소를 가리키는 CSS 선택자를 만들어 "선택자 { display: none !important }"를 사용자 스타일(insertCSS, origin USER)로 넣는다
//   (서비스 워커에 부탁한다). 사용자 스타일의 !important는 사이트의 !important(요소에 직접 적은 것까지)보다 앞서고, 사이트의 CSP에도 걸리지 않는다.
//   요소에 표시를 다는 대신 선택자로 숨겨서 사이트가 그 부분을 다시 그려도 숨긴 채다
// - 잠깐 숨기기는 이 프레임에만 기억해 새로 고치면 다시 보이고, 늘 숨기기는 사이트마다 기억한다 (hideRules, 서비스 워커가 저장한다).
//   위치로만 찾을 수 있는 부분(이름표 id·class로는 가릴 수 없어 몇째인지로 찾은 것)은 같은 사이트의 다른 페이지에서 엉뚱한 곳을 숨길 수 있어
//   그 주소(경로)에서만 숨긴다
// - 바깥 프레임과 다른 사이트의 틀(광고 등)이나 웹 주소가 아닌 틀(about:blank 등) 안을 숨기라고 하면, 바깥 프레임이 그 틀째 숨긴다 (postMessage)
// - 페이지에 띄우는 알림은 따로 이름을 지은 요소(photo-saver-ui)라 사이트의 선택자나 몇째 세기에 섞이지 않는다
(() => {
  if (self.__photoSaverHide) return;
  const KEY = "hideRules";
  const UI = "photo-saver-ui";
  // 선택자를 만들지 못한 요소(드물다)는 잠깐 숨길 때만 이 표시를 달아 숨긴다
  const MARK = "data-photo-saver-hide";
  const top = window === window.top;

  // 확장 프로그램을 새로 고치거나 지우면, 이미 열려 있던 페이지의 이 스크립트는 확장 프로그램과 끊긴다(chrome.runtime.id가 없어진다).
  // 그때 chrome.runtime.sendMessage는 약속(promise)을 돌려주지 않고 그 자리에서 오류(Extension context invalidated)를 던져서
  // .catch로는 잡히지 않는다. 주소만 바뀌는 페이지에서 늘 숨기는 곳을 다시 맞추다 확장 프로그램 관리 화면의 오류에 쌓였다(2026-11-19).
  // 그래서 크롬에 말을 걸기 전에 끊겼는지 보고, 끊겼으면 아무것도 하지 않는다
  const alive = () => {
    try {
      return Boolean(chrome.runtime?.id);
    } catch {
      return false;
    }
  };
  function send(message) {
    if (!alive()) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch {
      return Promise.resolve(null);
    }
  }

  // unlock-sites.js의 siteKey와 같다: http·https 주소의 호스트, 앞의 www.는 뗀다. 늘 숨기기를 둘 수 없는 주소면 null
  function siteKey(url) {
    try {
      const { protocol, hostname } = new URL(url);
      if (protocol !== "http:" && protocol !== "https:") return null;
      const site = hostname.replace(/^www\./, "");
      return /^[a-z0-9.-]+$/.test(site) ? site : null;
    } catch {
      return null;
    }
  }
  // names.js의 siteOf와 같다: 도메인 단위 사이트(map.naver.com → naver.com). 틀이 바깥과 같은 사이트인지 볼 때 쓴다
  const SECOND_LEVEL = new Set(["co", "com", "net", "org", "or", "ne", "go", "gov", "ac", "edu", "re", "pe", "mil"]);
  function siteOf(url) {
    let host;
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (!host) return null;
    if (/^[\d.]+$/.test(host) || host.startsWith("[")) return host;
    const labels = host.split(".").filter(Boolean);
    if (labels.length <= 2) return labels.join(".");
    const [second, last] = labels.slice(-2);
    return labels.slice(-(last.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2)).join(".");
  }

  const here = siteKey(location.href);
  // 틀째 숨길 프레임: 바깥 프레임과 다른 사이트이거나 웹 주소가 아닌 틀
  const atomic = !top && (here == null || siteOf(location.ancestorOrigins?.[0] ?? "") !== siteOf(location.href));

  // 요소의 종류 (창의 목록, 고르기의 테두리 옆 글)
  const KINDS = {
    img: "그림",
    picture: "그림",
    svg: "그림",
    canvas: "그림",
    video: "영상",
    audio: "소리",
    iframe: "틀",
    frame: "틀",
    object: "틀",
    embed: "틀",
    a: "링크",
    button: "단추",
    input: "입력 칸",
    textarea: "입력 칸",
    select: "고르는 칸",
    form: "양식",
    table: "표",
    ul: "목록",
    ol: "목록",
    nav: "메뉴",
    header: "머리",
    footer: "바닥",
    aside: "옆 칸",
    dialog: "알림 창",
  };
  const kindOf = (el) => KINDS[el.localName] ?? "칸";

  // 창의 목록에 보일 이름: 종류, 글(앞 24자), 크기. 틀은 글 대신 주소의 호스트
  function labelFor(el) {
    let text = "";
    if (kindOf(el) === "틀") {
      try {
        text = new URL(el.getAttribute("src") || el.getAttribute("data") || "", document.baseURI).hostname;
      } catch {
        text = "";
      }
    } else {
      text = (el.getAttribute("aria-label") || el.getAttribute("alt") || el.getAttribute("title") || el.innerText || "").replace(/\s+/g, " ").trim();
    }
    if (text.length > 24) text = `${text.slice(0, 23)}…`;
    const box = el.getBoundingClientRect();
    const head = [KINDS[el.localName], text && `“${text}”`].filter(Boolean).join(" ") || "칸";
    return `${head} · ${Math.round(box.width)}×${Math.round(box.height)}`;
  }

  // 이름표로 쓰지 않을 이름: 바뀌는 상태(열림·고름·붙음 등)와 만들 때마다 바뀌는 이름(숫자 넷 이상이나 해시가 섞인 것, CSS-in-JS)
  const STATE =
    /^(is-|has-)|^(active|on|off|show|shown|hide|hidden|open|opened|closed|visible|invisible|hover|focus|focused|selected|current|fixed|sticky|scrolled|in|out|fade|animate|animated|loaded|loading|ready)$/i;
  const GENERATED = /\d{4,}|[0-9a-f]{8,}|^(css|sc|jsx|emotion|styled|svelte|tw)-|__[\w-]{5,}$/i;
  const stable = (name) => typeof name === "string" && name.length <= 40 && /^[A-Za-z_][\w-]*$/.test(name) && !GENERATED.test(name) && !STATE.test(name);

  function unique(sel, el) {
    try {
      const found = document.querySelectorAll(sel);
      return found.length === 1 && found[0] === el;
    } catch {
      return false;
    }
  }

  // 요소를 가리키는 CSS 선택자: { sel, positional } 또는 null. 그 요소부터 바깥으로 한 겹씩 붙여, 그 요소 하나만 가리키게 되면 멈춘다.
  // 겹마다 id(바뀌지 않을 이름이고 페이지에 하나뿐이면 거기서 끝), 이름표 class(셋까지), 같은 모양의 형제가 있으면 몇째(nth-of-type).
  // positional: 몇째로 찾았거나 이름표가 하나도 없다 (같은 사이트의 다른 페이지에서는 다른 것을 가리킬 수 있다)
  function selectorFor(el) {
    const parts = [];
    let named = false;
    let positional = false;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      if (node.id && stable(node.id)) {
        const idSel = `#${CSS.escape(node.id)}`;
        if (unique(idSel, node)) {
          parts.unshift(idSel);
          const sel = parts.join(" > ");
          return unique(sel, el) ? { sel, positional } : null;
        }
      }
      const classes = [...node.classList].filter(stable).slice(0, 3);
      if (classes.length) named = true;
      let part = CSS.escape(node.localName) + classes.map((name) => `.${CSS.escape(name)}`).join("");
      const parent = node.parentElement;
      if (parent && [...parent.children].some((child) => child !== node && child.matches(part))) {
        part += `:nth-of-type(${[...parent.children].filter((child) => child.localName === node.localName).indexOf(node) + 1})`;
        positional = true;
      }
      parts.unshift(part);
      const sel = parts.join(" > ");
      if (unique(sel, el)) return { sel, positional: positional || !named };
    }
    return null;
  }

  const validSelector = (sel) => {
    try {
      document.querySelector(sel);
      return true;
    } catch {
      return false;
    }
  };

  let rules = []; // 늘 숨기는 곳 가운데 이 주소에 맞는 것
  let temp = []; // 잠깐 숨긴 곳 [{ id, sel, label }]
  const done = new Map(); // 숨긴 번호 → 되돌릴 때 쓸 것 { kind: "temp" | "rule", sel, path, label }
  let applied = ""; // 지금 넣어 둔 사용자 스타일
  let chain = Promise.resolve();
  let count = 0;
  let path = location.pathname;
  let armed = null; // 오른쪽 클릭 메뉴 한 번에 맞춘 번호. 안쪽 틀의 "틀째 숨겨 달라"는 부탁을 이 번호로만 받는다

  const cssOf = (list) => list.map((item) => `${item.sel} { display: none !important; }`).join("\n");
  // 숨길 것이 바뀌면 사용자 스타일을 새것으로 바꾼다: 서비스 워커가 새것을 넣은 뒤 옛것을 뺀다 (그 사이에 깜빡 보이지 않게)
  function apply() {
    chain = chain
      .then(async () => {
        if (!alive()) return;
        const css = cssOf([...rules, ...temp]);
        if (css === applied) return;
        const reply = await send({ type: "hide-css", css, old: applied });
        if (reply?.ok) applied = css;
      })
      .catch(() => {});
    return chain;
  }

  // 저장된 늘 숨기는 곳을 다시 읽는다 (처음, 목록이 바뀔 때, 주소만 바뀔 때)
  async function refresh() {
    if (!alive()) return undefined;
    path = location.pathname;
    let list = [];
    if (here) {
      try {
        const all = (await chrome.storage.local.get(KEY))[KEY];
        if (Array.isArray(all?.[here])) list = all[here];
      } catch {
        list = [];
      }
    }
    rules = list.filter((rule) => rule && typeof rule.sel === "string" && !/[{}]/.test(rule.sel) && (rule.path == null || rule.path === path) && validSelector(rule.sel));
    return apply();
  }

  const changed = () => send({ type: "hide-changed" });

  // el을 숨긴다. remember면 사이트에 기억한다 (선택자를 만들 수 없거나 사이트가 없는 주소면 지금만).
  // { ok, id, label, remembered, site, path, wanted } · 숨길 수 없으면 { ok: false, reason }
  async function hide(el, remember) {
    if (!(el instanceof Element) || !el.isConnected || el.ownerDocument !== document) return { ok: false, reason: "gone" };
    if (el === document.documentElement || el === document.body || el === document.head || el.localName === UI) return { ok: false, reason: "page" };
    const label = labelFor(el);
    const found = selectorFor(el);
    const id = ++count;
    if (remember && here && found) {
      const rule = { sel: found.sel, path: found.positional ? location.pathname : null, label, at: Date.now() };
      rules = [...rules.filter((r) => !(r.sel === rule.sel && (r.path ?? null) === rule.path)), rule];
      const applying = apply();
      const reply = await send({ type: "hide-rule-add", site: here, rule });
      await applying;
      if (reply?.ok) {
        done.set(id, { kind: "rule", sel: rule.sel, path: rule.path, label });
        send({ type: "hide-did", id });
        return { ok: true, id, label, remembered: true, site: here, path: rule.path };
      }
      // 저장하지 못했으면 지금만 숨긴다
      rules = rules.filter((r) => r !== rule);
    }
    let sel = found?.sel;
    if (!sel) {
      el.setAttribute(MARK, String(id));
      sel = `[${MARK}="${id}"]`;
    }
    temp.push({ id, sel, label });
    await apply();
    done.set(id, { kind: "temp", sel, label });
    send({ type: "hide-did", id });
    return { ok: true, id, label, remembered: false, wanted: Boolean(remember) };
  }

  // 숨긴 것을 되돌린다 (늘 숨기던 것이면 목록에서도 뺀다). { ok, label }
  async function undo(id) {
    const item = done.get(id);
    if (!item || !alive()) return { ok: false };
    done.delete(id);
    if (item.kind === "temp") {
      temp = temp.filter((t) => t.id !== id);
      document.querySelector(`[${MARK}="${id}"]`)?.removeAttribute(MARK);
      await apply();
    } else {
      rules = rules.filter((r) => !(r.sel === item.sel && (r.path ?? null) === item.path));
      await apply();
      await send({ type: "hide-rule-remove", site: here, sel: item.sel, path: item.path });
    }
    changed();
    return { ok: true, label: item.label };
  }

  // 잠깐 숨긴 것을 모두 다시 보인다 (창의 "다시 보이기"). 다시 보인 수
  async function clearTemp() {
    const n = temp.length;
    for (const item of temp) {
      document.querySelector(`[${MARK}="${item.id}"]`)?.removeAttribute(MARK);
      done.delete(item.id);
    }
    temp = [];
    await apply();
    if (n) changed();
    return n;
  }

  const shorten = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
  // 숨긴 결과를 사람 말로. short: 고르기의 안내 줄 (숨긴 것의 이름을 붙인다)
  function messageFor(result, short = false) {
    if (!result?.ok) return result?.reason === "page" ? "페이지 전체는 숨길 수 없습니다" : "숨기지 못했습니다";
    if (short) {
      if (result.remembered) return `${result.path ? `이 주소(${shorten(result.path, 30)})에서` : `${result.site}에서`} 늘 숨깁니다: ${result.label}`;
      return `${result.wanted ? "늘 숨길 수 없는 곳이라 지금만 숨겼습니다" : "숨겼습니다"}: ${result.label}`;
    }
    if (result.remembered) {
      return `${result.path ? `이 주소(${shorten(result.path, 30)})에서` : `${result.site}에서`} 늘 숨깁니다. 확장 프로그램 창에서 다시 보이게 할 수 있습니다.`;
    }
    return result.wanted ? "늘 숨길 수 없는 곳이라 지금만 숨겼습니다. 새로 고치면 다시 보입니다." : "숨겼습니다. 새로 고치면 다시 보입니다.";
  }

  // 페이지 아래쪽에 잠깐 알림을 띄운다 (오른쪽 클릭 메뉴로 숨겼을 때). undoId가 있으면 되돌리기 단추를 단다
  let toastHost = null;
  let toastTimer = null;
  function toast(text, undoId) {
    toastHost?.remove();
    clearTimeout(toastTimer);
    const host = document.createElement(UI);
    host.style.cssText = [
      "all: initial !important",
      "display: block !important",
      "position: fixed !important",
      "left: 50% !important",
      "bottom: 24px !important",
      "transform: translateX(-50%) !important",
      "z-index: 2147483647 !important",
    ].join(";");
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .toast { display: flex; align-items: center; gap: 12px; max-width: min(560px, calc(100vw - 32px)); box-sizing: border-box; padding: 10px 14px;
        border-radius: 10px; background: rgba(28, 39, 51, 0.94); color: #fff; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
      button { flex: none; padding: 4px 10px; border: 0; border-radius: 6px; background: #334155; color: #fff; font: inherit; cursor: pointer; }
      button:hover { background: #475569; }
    </style><div class="toast" role="status"><span></span><button type="button">되돌리기</button></div>`;
    root.querySelector("span").textContent = text;
    const button = root.querySelector("button");
    if (undoId == null) button.remove();
    else {
      button.addEventListener("click", async () => {
        button.disabled = true;
        const result = await undo(undoId);
        toast(result.ok ? "되돌렸습니다" : "되돌릴 수 없습니다");
      });
    }
    document.documentElement.append(host);
    toastHost = host;
    toastTimer = setTimeout(() => host.remove(), undoId == null ? 2500 : 6000);
  }

  // 이 프레임 안의 틀 요소 가운데 그 창(contentWindow)의 것
  function frameOf(source) {
    if (!source) return null;
    for (const frame of document.querySelectorAll("iframe, frame, object")) {
      if (frame.contentWindow === source) return frame;
    }
    return null;
  }

  // 바깥 프레임에 이 틀째 숨겨 달라고 부탁하고 결과를 기다린다 (오른쪽 클릭 메뉴)
  function hideFrame(remember, nonce) {
    return new Promise((resolve) => {
      const onReply = (event) => {
        if (event.source !== parent || event.data?.photoSaverHide !== "frame-done" || event.data.nonce !== nonce) return;
        finish(event.data.result ?? { ok: false });
      };
      const timer = setTimeout(() => finish({ ok: false, reason: "no-parent" }), 3000);
      function finish(result) {
        clearTimeout(timer);
        removeEventListener("message", onReply);
        resolve(result);
      }
      addEventListener("message", onReply);
      parent.postMessage({ photoSaverHide: "frame", nonce, remember: Boolean(remember) }, "*");
    });
  }

  // 안쪽 틀의 부탁: 그 틀째 숨긴다. 이 프레임도 틀째 숨길 프레임이면 한 겹 더 바깥에 넘긴다
  addEventListener("message", async (event) => {
    const data = event.data;
    if (data?.photoSaverHide !== "frame" || !armed || data.nonce !== armed.nonce || Date.now() > armed.until) return;
    const frame = frameOf(event.source);
    if (!frame) return;
    armed = null;
    let result;
    if (atomic) result = await hideFrame(data.remember, data.nonce);
    else {
      result = await hide(frame, data.remember);
      toast(messageFor(result), result.ok ? result.id : null);
    }
    event.source.postMessage({ photoSaverHide: "frame-done", nonce: data.nonce, result }, "*");
  });

  // 오른쪽 클릭 메뉴: 서비스 워커가 먼저 모든 프레임에 이번 번호를 주고(arm) 누른 프레임에서 fromMenu를 부른다.
  // 누른 곳은 hide-watch.js가 기억해 둔다. 모르면(확장 프로그램을 새로 고치기 전에 연 페이지 등) { ok: false, reason: "no-target" }
  function arm(nonce) {
    armed = { nonce, until: Date.now() + 10000 };
  }
  async function fromMenu(remember, nonce) {
    if (atomic) return hideFrame(remember, nonce);
    const context = self.__photoSaverContext;
    if (!context?.el?.isConnected || Date.now() - context.at > 60000) return { ok: false, reason: "no-target" };
    const result = await hide(context.el, remember);
    toast(messageFor(result), result.ok ? result.id : null);
    return result;
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) refresh();
  });
  // 주소만 바뀌는 페이지(pushState): 그 주소에서만 숨기는 곳을 다시 맞춘다
  self.navigation?.addEventListener("currententrychange", () => {
    if (alive() && location.pathname !== path) refresh();
  });

  self.__photoSaverHide = {
    hide,
    undo,
    clearTemp,
    tempCount: () => temp.length,
    fromMenu,
    arm,
    messageFor,
    kindOf,
    frameOf,
    atomic,
    top,
    here,
  };
  refresh();
})();
