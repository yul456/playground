// 확장 프로그램 창(팝업·사이드바)의 "오른쪽 클릭" 줄: 오른쪽 클릭·글자 고르기·복사를 막아 둔 페이지를 푼다 (사용자 요청, 2026-11-19).
// - "막기 풀기": 지금 탭의 페이지 쪽 공간(MAIN)에 unlock-page.js를 프레임마다 넣는다. 그 이벤트들을 사이트 코드보다 먼저(창의 capture 단계)
//   받아 사이트 코드에 닿지 않게 한다. 크롬의 기본 동작(메뉴, 글자 고르기, 복사)은 막지 않는다. 지금 페이지에서만 풀리고, 새로 고치면 다시 막힌다
// - "○○에서 늘 풀기": 지금 탭의 사이트를 기억해(unlock-sites.js), 그 사이트의 페이지는 뜰 때마다 저절로 푼다. 목록은 "늘 푸는 사이트"에서 보고 뺀다
// - 글자를 못 고르게 한 꾸밈(user-select: none)은 사용자 스타일(insertCSS, origin USER)로 덮는다. 사용자 스타일의 !important는
//   사이트의 !important보다 앞선다. 사이트의 CSP(인라인 style 금지)에도 걸리지 않는다
// - 그림 위에 투명한 막을 덮어 둔 사이트는 오른쪽 클릭이 되어도 그림 저장이 안 될 수 있다. 그런 그림은 사진 받기로 받는다
import { UNLOCK_CSS, UNLOCK_KEY, loadUnlockSites, saveUnlockSites, siteKey } from "./unlock-sites.js";

const $ = (id) => document.getElementById(id);

// 모든 프레임에 하고, 들어갈 수 없는 프레임이 있어 실패하면 맨 위 페이지에만 한다
async function everyFrame(tabId, call) {
  try {
    return await call({ tabId, allFrames: true });
  } catch {
    return call({ tabId });
  }
}

// 지금 페이지를 푼다: "done" 풀었음 · "again" 이미 풀려 있었음 · "fail" 크롬이 막는 페이지
async function unlockNow(tabId) {
  try {
    const results = await everyFrame(tabId, (target) => chrome.scripting.executeScript({ target, world: "MAIN", files: ["unlock-page.js"] }));
    await everyFrame(tabId, (target) => chrome.scripting.insertCSS({ target, css: UNLOCK_CSS, origin: "USER" })).catch(() => {});
    return results.length > 0 && results.every((r) => r.result?.again) ? "again" : "done";
  } catch {
    return "fail";
  }
}

export function mountUnlock() {
  let tabId = null;
  let site = null; // 지금 탭의 사이트 (늘 풀기를 둘 수 없는 페이지면 null)
  let sites = []; // 늘 푸는 사이트
  const button = $("unlockPage");
  const always = $("unlockAlways");
  const note = $("unlockNote");

  const say = (text, warn = false) => {
    note.textContent = text;
    note.classList.toggle("warn", warn);
    note.hidden = !text;
  };

  function render() {
    always.disabled = site == null;
    always.checked = site != null && sites.includes(site);
    $("unlockAlwaysLabel").textContent = site ? `${site}에서 늘 풀기` : "이 사이트에서 늘 풀기";
    $("unlockSites").hidden = sites.length === 0;
    $("unlockSiteCount").textContent = String(sites.length);
    $("unlockSiteList").replaceChildren(
      ...[...sites].reverse().map((name) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        text.textContent = name;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "이 사이트는 늘 풀지 않기";
        remove.addEventListener("click", () => setSites(sites.filter((s) => s !== name)));
        li.append(text, remove);
        return li;
      }),
    );
  }

  // 목록을 저장하면 서비스 워커가 콘텐츠 스크립트를 다시 등록한다 (background.js)
  async function setSites(next) {
    sites = next;
    render();
    await saveUnlockSites(next);
  }

  button.addEventListener("click", async () => {
    if (tabId == null) return;
    const id = tabId;
    button.disabled = true;
    const result = await unlockNow(id);
    if (id === tabId) {
      if (result === "fail") say("이 페이지는 풀 수 없습니다 (크롬 설정, 웹 스토어처럼 크롬이 막는 페이지).", true);
      else if (result === "again") say("이미 풀어 두었습니다. 페이지를 새로 고치면 다시 막힙니다.");
      else say("오른쪽 클릭, 글자 고르기, 복사를 풀었습니다. 페이지를 새로 고치면 다시 막힙니다.");
    }
    button.disabled = tabId == null;
  });

  always.addEventListener("change", async () => {
    if (site == null) return;
    const id = tabId;
    const name = site;
    if (always.checked) {
      await setSites([...sites.filter((s) => s !== name), name]);
      const result = await unlockNow(id);
      if (id === tabId) say(result === "fail" ? `${name}을 늘 풀기에 넣었지만 이 페이지는 풀 수 없습니다.` : `${name}의 페이지는 열 때마다 저절로 풉니다. 지금 페이지도 풀었습니다.`, result === "fail");
    } else {
      await setSites(sites.filter((s) => s !== name));
      if (id === tabId) say(`${name}의 늘 풀기를 껐습니다. 이미 푼 지금 페이지는 새로 고치면 다시 막힙니다.`);
    }
  });

  // 다른 창(팝업·사이드바·다른 창의 사이드바)에서 바꾼 것도 맞춘다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[UNLOCK_KEY]) return;
    const next = changes[UNLOCK_KEY].newValue;
    sites = Array.isArray(next) ? next : [];
    render();
  });
  loadUnlockSites().then((list) => {
    sites = list;
    render();
  });

  return {
    // 사이드바에서 탭을 바꾸거나 페이지가 넘어가면 그 탭의 사이트로 바꾸고 알림을 지운다 (푼 것은 그 페이지에만 남는다)
    async setTab(id) {
      tabId = id;
      button.disabled = id == null;
      site = null;
      say("");
      render();
      if (id == null) return;
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (id !== tabId) return;
      site = siteKey(tab?.url || tab?.pendingUrl || "");
      render();
    },
  };
}
