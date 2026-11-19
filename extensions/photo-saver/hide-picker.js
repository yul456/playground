// "숨길 곳 고르기" (보기 싫은 부분 숨기기, 1.20.0). 서비스 워커가 지금 탭의 프레임마다 hide-core.js 다음에 넣고(executeScript files) start를 부른다.
// - 마우스를 올린 부분에 파란 테두리를 그리고, 누르면 숨긴다 (hide-core.js). 고르는 동안 페이지의 클릭은 막아 링크·단추가 열리지 않는다
// - ↑·↓ 키로 테두리를 한 겹 바깥 상자로 넓히거나 되돌리고, Enter로 숨긴다. 키는 어느 프레임에서 눌러도 서비스 워커를 거쳐 모든 프레임에 가고
//   테두리가 있는 프레임이 받는다. Esc는 끝내기, Ctrl·⌘+Z는 마지막으로 숨긴 것을 되돌리기다 (서비스 워커가 숨긴 순서를 안다)
// - 맨 위 프레임에 안내 줄을 띄운다: 늘 숨기기 칸(chrome.storage.local의 hideRemember, 바꾸면 기억한다), 되돌리기, 끝내기, 방금 한 일
// - 틀: 같은 사이트의 틀은 그 안의 고르기가 맡는다 (시작할 때 바깥에 ready라고 알린다). 다른 사이트의 틀(광고 등, atomic이라고 알린다)과
//   대답이 없는 틀(고르기가 들어가지 못했거나 나중에 뜬 틀)은 안을 고르지 않고 틀째 고른다: 바깥 프레임이 틀 위에 투명한 막을 덮어 마우스와 클릭을 받는다.
//   크롬은 다른 사이트의 틀을 다른 프로세스로 돌려서, 마우스가 그 틀에 들어가도 바깥 프레임은 알지 못한다(mouseover가 오지 않는다). 그래서 미리 덮는다.
//   막 위에서는 그 자리의 맨 위 요소를 고른다 (틀 위에 겹친 다른 요소도 고를 수 있게).
//   같은 사이트의 틀 안에서 ↑로 틀의 맨 바깥보다 더 넓히면 바깥 프레임이 틀째 고른다 (postMessage로 넘긴다)
// - 페이지가 만든 가짜 이벤트(isTrusted가 아닌 것)로는 고르거나 숨기지 않는다
(() => {
  if (self.__photoSaverPicker) return;
  const core = self.__photoSaverHide;
  if (!core) return;
  const UI = "photo-saver-ui";
  const REMEMBER = "hideRemember";
  const top = core.top;
  const BLOCK = ["mousedown", "mouseup", "click", "dblclick", "auxclick", "pointerdown", "pointerup", "submit"];
  const KEYS = { Escape: "stop", ArrowUp: "up", ArrowDown: "down", Enter: "hide" };
  const undoKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘Z" : "Ctrl+Z";

  let on = false;
  let remember = false;
  let current = null; // 테두리를 그린 요소
  let trail = []; // 넓히기 전의 요소들 (↓로 되돌아간다)
  let handedFrom = null; // 안쪽 틀이 ↑로 넘겨준 그 틀 요소 (그 틀에서 누르면 이 프레임이 숨긴다)
  let handed = null; // 이 프레임이 바깥에 넘겼을 때의 마우스 자리. 마우스가 멀리 가면 되찾는다
  let resume = null; // 넘기기 전에 테두리를 그렸던 요소 (바깥이 ↓로 돌려주면 다시 그린다)
  let mouse = { x: 0, y: 0 };
  let ready = new WeakSet(); // 안을 고르기가 맡는 같은 사이트의 틀 (ready라고 대답한 틀)
  let answered = new WeakSet(); // 대답한 틀 (ready 또는 atomic)
  let seen = new WeakMap(); // 틀 → 처음 본 때 (1초가 지나도 대답이 없으면 덮는다)
  const shields = new Map(); // 틀째 고를 틀 → 그 위에 덮은 막
  let shieldTimer = 0;
  let host = null;
  let root = null;
  let box = null;
  let tip = null;
  let bar = null;
  let statusLine = null;
  let check = null;
  let frameRaf = 0;

  const ours = (event) => event.target instanceof Element && event.target.localName === UI;
  const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});

  function build() {
    host = document.createElement(UI);
    host.style.cssText = [
      "all: initial !important",
      "display: block !important",
      "position: fixed !important",
      "inset: 0 !important",
      "z-index: 2147483647 !important",
      "pointer-events: none !important",
    ].join(";");
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>
      .box { position: fixed; display: none; box-sizing: border-box; border: 2px solid #2563eb; border-radius: 2px; background: rgba(37, 99, 235, 0.16); pointer-events: none; }
      .tip { position: fixed; display: none; padding: 1px 6px; border-radius: 4px; background: #2563eb; color: #fff; white-space: nowrap; pointer-events: none;
        font: 12px/1.6 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
      .shield { position: fixed; pointer-events: auto; cursor: crosshair; background: transparent; }
      .bar { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%); width: max-content; max-width: calc(100vw - 32px); box-sizing: border-box;
        padding: 10px 14px; border-radius: 12px; background: rgba(28, 39, 51, 0.95); color: #fff; box-shadow: 0 6px 24px rgba(0, 0, 0, 0.3); pointer-events: auto;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
      .bar.up { top: 16px; bottom: auto; }
      .row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; }
      label { display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
      label:has(input:disabled) { opacity: 0.5; cursor: default; }
      input { margin: 0; accent-color: #60a5fa; }
      button { padding: 3px 10px; border: 0; border-radius: 6px; background: #334155; color: #fff; font: inherit; cursor: pointer; }
      button:hover { background: #475569; }
      .keys { margin-top: 4px; color: #cbd5e1; font-size: 12px; }
      .status { margin-top: 4px; color: #86efac; font-size: 12px; }
      .status.warn { color: #fcd34d; }
      .status:empty { display: none; }
    </style><div class="shields"></div><div class="box"></div><div class="tip"></div>`;
    box = root.querySelector(".box");
    tip = root.querySelector(".tip");
    if (top) {
      bar = document.createElement("div");
      bar.className = "bar";
      bar.setAttribute("role", "dialog");
      bar.setAttribute("aria-label", "숨길 곳 고르기");
      bar.innerHTML = `<div class="row">
          <strong>숨길 곳을 누르세요</strong>
          <label><input type="checkbox"> <span></span></label>
          <button type="button" data-act="undo">되돌리기</button>
          <button type="button" data-act="stop">끝내기</button>
        </div>
        <div class="keys"></div>
        <div class="status" role="status"></div>`;
      check = bar.querySelector("input");
      check.disabled = !core.here;
      bar.querySelector("label span").textContent = core.here ? `${core.here}에서 늘 숨기기` : "이 페이지는 늘 숨길 수 없음";
      bar.querySelector(".keys").textContent = `↑ 넓히기 · ↓ 좁히기 · Enter 숨기기 · Esc 끝내기 · ${undoKey} 되돌리기`;
      statusLine = bar.querySelector(".status");
      check.addEventListener("change", () => {
        remember = check.checked;
        chrome.storage.local.set({ [REMEMBER]: remember }).catch(() => {});
      });
      bar.querySelector("[data-act=undo]").addEventListener("click", () => send({ type: "hide-pick-key", key: "undo" }));
      bar.querySelector("[data-act=stop]").addEventListener("click", () => send({ type: "hide-pick-key", key: "stop" }));
      root.append(bar);
    }
    document.documentElement.append(host);
  }

  function setStatus(text, warn) {
    if (!statusLine) return;
    statusLine.textContent = text ?? "";
    statusLine.classList.toggle("warn", Boolean(warn));
  }

  // 테두리 옆 글: 종류와 크기 (넓히면 크기가 바뀌어 어디까지인지 안다)
  function describe(el) {
    const r = el.getBoundingClientRect();
    return `${core.kindOf(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  }

  function draw() {
    frameRaf = 0;
    if (!box) return;
    for (const [frame, shield] of shields) placeShield(frame, shield);
    if (!current?.isConnected) {
      box.style.display = "none";
      tip.style.display = "none";
      return;
    }
    const r = current.getBoundingClientRect();
    Object.assign(box.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    tip.textContent = describe(current);
    Object.assign(tip.style, {
      display: "block",
      left: `${Math.max(0, Math.min(r.left, innerWidth - 160))}px`,
      top: `${r.top >= 22 ? r.top - 21 : Math.min(Math.max(r.bottom + 2, 0), innerHeight - 21)}px`,
    });
    // 안내 줄이 테두리를 가리면 반대쪽(위·아래)으로 옮긴다
    if (bar) bar.classList.toggle("up", r.bottom > innerHeight - 140 && r.top > 140);
  }
  const schedule = () => {
    if (!frameRaf) frameRaf = requestAnimationFrame(draw);
  };

  function setCurrent(el) {
    current = el;
    schedule();
  }
  function clearCurrent() {
    current = null;
    schedule();
  }

  // 틀째 고를 틀 위에 막을 덮는다. 막이 마우스와 클릭을 받는다 (틀 안의 페이지에는 가지 않는다)
  function ensureShield(frame) {
    let shield = shields.get(frame);
    if (!shield) {
      shield = document.createElement("div");
      shield.className = "shield";
      shield.addEventListener("mousemove", onShieldMove);
      shield.addEventListener("click", (event) => {
        if (event.isTrusted && event.button === 0) commit();
      });
      root.querySelector(".shields").append(shield);
      shields.set(frame, shield);
    }
    placeShield(frame, shield);
  }
  function placeShield(frame, shield) {
    const r = frame.getBoundingClientRect();
    const show = frame.isConnected && r.width >= 2 && r.height >= 2;
    Object.assign(shield.style, { display: show ? "block" : "none", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
  }
  function dropShield(frame) {
    shields.get(frame)?.remove();
    shields.delete(frame);
  }
  // 0.5초마다: 새로 생긴 틀에 묻고(ping), 1초가 지나도 대답이 없는 틀은 덮고, 없어진 틀의 막은 걷는다
  function syncShields() {
    if (!root) return;
    const now = Date.now();
    const frames = new Set(document.querySelectorAll("iframe, frame"));
    for (const frame of frames) {
      if (!seen.has(frame)) {
        seen.set(frame, now);
        frame.contentWindow?.postMessage({ photoSaverHide: "ping" }, "*");
      }
      if (ready.has(frame)) dropShield(frame);
      else if (shields.has(frame) || (!answered.has(frame) && now - seen.get(frame) > 1000)) ensureShield(frame);
    }
    for (const frame of [...shields.keys()]) if (!frames.has(frame)) dropShield(frame);
  }
  // 막 위에서 마우스가 움직일 때: 그 자리의 맨 위 요소를 고른다. 대개 그 틀이고, 틀 위에 다른 요소가 겹쳐 있으면 그 요소다
  function onShieldMove(event) {
    if (!event.isTrusted) return;
    mouse = { x: event.clientX, y: event.clientY };
    const hit = document.elementsFromPoint(event.clientX, event.clientY).find((el) => el.localName !== UI);
    if (!hit || hit === document.documentElement || hit === document.body) {
      clearCurrent();
      return;
    }
    if (hit === current) return;
    const had = current != null;
    trail = [];
    handedFrom = null;
    setCurrent(hit);
    if (!had && !top) parent.postMessage({ photoSaverHide: "inside" }, "*");
  }

  function onOver(event) {
    if (!event.isTrusted || ours(event)) return;
    mouse = { x: event.clientX, y: event.clientY };
    if (core.atomic) return; // 틀째 고르는 틀: 바깥 프레임이 막으로 고른다
    if (handed) {
      if (Math.hypot(event.clientX - handed.x, event.clientY - handed.y) < 24) return;
      handed = null;
      resume = null;
    }
    const el = event.target;
    if (!(el instanceof Element) || el === document.documentElement || el === document.body) {
      clearCurrent();
      return;
    }
    const had = current != null;
    trail = [];
    handedFrom = null;
    setCurrent(el);
    // 같은 사이트의 틀 안에서 고르기 시작: 바깥 프레임이 틀 요소에 그린 테두리를 지운다
    if (!had && !top) parent.postMessage({ photoSaverHide: "inside" }, "*");
  }

  function onOut(event) {
    if (!event.isTrusted || event.relatedTarget || handed) return;
    // 마우스가 이 프레임(창) 밖으로 나갔다
    clearCurrent();
  }

  function block(event) {
    if (ours(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.type !== "click" || !event.isTrusted || event.button !== 0 || core.atomic) return;
    if (handed) {
      parent.postMessage({ photoSaverHide: "click" }, "*");
      return;
    }
    if (!current) {
      const el = event.target;
      if (!(el instanceof Element) || el === document.documentElement || el === document.body) return;
      current = el;
    }
    commit();
  }

  function onKey(event) {
    if (!event.isTrusted) return;
    let key = KEYS[event.key];
    if (!key && (event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && String(event.key).toLowerCase() === "z") key = "undo";
    if (!key) return;
    // 안내 줄의 단추에 초점이 있을 때 누른 Enter는 그 단추를 누르게 둔다 (늘 숨기기 칸을 누른 뒤에도 키는 모두 된다)
    const inner = event.composedPath()[0];
    if (key === "hide" && inner instanceof Element && inner.localName === "button" && ours(event)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    send({ type: "hide-pick-key", key });
  }

  // 서비스 워커가 모든 프레임에 돌려준 키: 테두리가 있는 프레임이 한다
  function onRelayedKey(key) {
    if (!current) return;
    if (key === "up") widen();
    else if (key === "down") narrow();
    else if (key === "hide") commit();
  }

  function widen() {
    const up = current.parentElement;
    if (!up || up === document.body || up === document.documentElement) {
      // 같은 사이트의 틀에서 맨 바깥보다 더 넓히면 바깥 프레임이 틀째 고른다
      if (!top && !core.atomic) {
        handed = { ...mouse };
        resume = current;
        trail = [];
        clearCurrent();
        parent.postMessage({ photoSaverHide: "up" }, "*");
      }
      return;
    }
    trail.push(current);
    setCurrent(up);
  }

  function narrow() {
    if (trail.length) {
      setCurrent(trail.pop());
      return;
    }
    if (handedFrom && current === handedFrom) {
      // 넘겨준 틀에 돌려준다
      handedFrom.contentWindow?.postMessage({ photoSaverHide: "down" }, "*");
      handedFrom = null;
      clearCurrent();
    }
  }

  async function commit() {
    const el = current;
    if (!el) return;
    trail = [];
    handedFrom = null;
    clearCurrent();
    const result = await core.hide(el, remember);
    syncShields();
    send({ type: "hide-pick-status", text: core.messageFor(result, true), warn: !result.ok || (result.wanted && !result.remembered) });
  }

  // 틀끼리 주고받는 말 (postMessage). 페이지도 받을 수 있는 길이라 이름표(photoSaverHide)가 맞고 아는 틀에서 온 것만 받는다
  function onFrameMessage(event) {
    const kind = event.data?.photoSaverHide;
    if (typeof kind !== "string") return;
    if (event.source === parent && !top) {
      if (kind === "ping") parent.postMessage({ photoSaverHide: core.atomic ? "atomic" : "ready" }, "*");
      else if (kind === "down" && handed) {
        handed = null;
        if (resume?.isConnected) setCurrent(resume);
        resume = null;
      }
      return;
    }
    const frame = core.frameOf(event.source);
    if (!frame) return;
    if (kind === "ready") {
      answered.add(frame);
      ready.add(frame);
      dropShield(frame);
    } else if (kind === "atomic") {
      answered.add(frame);
      ensureShield(frame);
    } else if (kind === "inside") {
      if (current === frame || handedFrom === frame) {
        handedFrom = null;
        clearCurrent();
      }
    } else if (kind === "up") {
      trail = [];
      handedFrom = frame;
      setCurrent(frame);
    } else if (kind === "click" && handedFrom === frame) commit();
  }

  function onRuntime(message) {
    if (message?.type === "hide-pick-key") onRelayedKey(message.key);
    else if (message?.type === "hide-pick-status" && top) setStatus(message.text, message.warn);
  }

  function onStorage(changes, area) {
    if (area !== "local" || !changes[REMEMBER]) return;
    remember = Boolean(changes[REMEMBER].newValue);
    if (check) check.checked = remember;
  }

  // options.remember: 늘 숨기기를 이번에만 이렇게 (오른쪽 클릭 메뉴에서 넘어온 경우). options.status: 안내 줄에 처음 보일 글
  async function start(options = {}) {
    if (on) {
      if (options.status) setStatus(options.status, options.warn);
      return;
    }
    on = true;
    build();
    for (const type of BLOCK) addEventListener(type, block, true);
    addEventListener("mouseover", onOver, true);
    addEventListener("mouseout", onOut, true);
    addEventListener("keydown", onKey, true);
    addEventListener("scroll", schedule, true);
    addEventListener("resize", schedule);
    addEventListener("message", onFrameMessage);
    chrome.runtime.onMessage.addListener(onRuntime);
    chrome.storage.onChanged.addListener(onStorage);
    // 바깥 프레임에 이 틀을 어떻게 고를지 알리고(ready: 안을 고른다, atomic: 틀째), 안쪽 틀들에게도 물어 본다 (프레임마다 시작하는 순서가 정해져 있지 않다)
    if (!top) parent.postMessage({ photoSaverHide: core.atomic ? "atomic" : "ready" }, "*");
    syncShields();
    shieldTimer = setInterval(syncShields, 500);
    if (options.remember != null) remember = Boolean(options.remember);
    else remember = Boolean((await chrome.storage.local.get(REMEMBER).catch(() => ({})))[REMEMBER]);
    if (check) check.checked = remember && !check.disabled;
    if (options.status) setStatus(options.status, options.warn);
  }

  function stop() {
    if (!on) return;
    on = false;
    for (const type of BLOCK) removeEventListener(type, block, true);
    removeEventListener("mouseover", onOver, true);
    removeEventListener("mouseout", onOut, true);
    removeEventListener("keydown", onKey, true);
    removeEventListener("scroll", schedule, true);
    removeEventListener("resize", schedule);
    removeEventListener("message", onFrameMessage);
    chrome.runtime.onMessage.removeListener(onRuntime);
    chrome.storage.onChanged.removeListener(onStorage);
    cancelAnimationFrame(frameRaf);
    frameRaf = 0;
    clearInterval(shieldTimer);
    shields.clear();
    host?.remove();
    host = root = box = tip = bar = statusLine = check = null;
    current = handedFrom = handed = resume = null;
    trail = [];
    ready = new WeakSet();
    answered = new WeakSet();
    seen = new WeakMap();
  }

  self.__photoSaverPicker = { start, stop, isOn: () => on };
})();
