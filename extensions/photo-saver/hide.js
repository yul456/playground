// 확장 프로그램 창(팝업·사이드바)의 "숨기기" 줄: 보기 싫은 부분 숨기기 (사용자 요청, 2026-11-19, 1.20.0).
// - "숨길 곳 고르기": 지금 탭에서 고르기를 시작한다 (서비스 워커가 hide-core.js·hide-picker.js를 프레임마다 넣는다).
//   팝업은 페이지를 누르면 닫히는데 그 클릭이 페이지에 가서 무언가를 숨기게 되므로 시작하자마자 닫는다. 사이드바는 열어 둔 채 같은 단추로 끝낸다
// - "잠깐 숨긴 곳 n곳 · 다시 보이기": 지금 페이지에서 잠깐 숨긴 것 (새로 고쳐도 다시 보인다)
// - "○○에서 늘 숨기는 곳": 사이트마다 기억한 곳(hide-sites.js). ×로 빼면 열려 있는 페이지에서도 바로 다시 보인다
//   (페이지의 hide-core.js가 목록이 바뀐 것을 듣고 사용자 스타일을 바꾼다)
// 페이지의 오른쪽 클릭 메뉴("이 부분 숨기기"·"이 부분 늘 숨기기")는 서비스 워커(background.js)가 맡는다
import { HIDE_KEY, loadHideRules, rulesOf, siteKey } from "./hide-sites.js";

const $ = (id) => document.getElementById(id);

export function mountHide({ inPanel }) {
  let tabId = null;
  let site = null; // 지금 탭의 사이트 (늘 숨기기를 둘 수 없는 주소면 null)
  let web = false; // 숨기기를 쓸 수 있는 페이지(웹 주소)인지
  let rules = [];
  let picking = false;
  const pick = $("hidePick");
  const note = $("hideNote");

  const say = (text, warn = false) => {
    note.textContent = text;
    note.classList.toggle("warn", warn);
    note.hidden = !text;
  };

  function renderPick() {
    pick.disabled = !web;
    pick.setAttribute("aria-pressed", String(picking));
    pick.textContent = picking ? "고르기 끝내기" : "숨길 곳 고르기";
  }

  function renderRules() {
    $("hideRules").hidden = !site || rules.length === 0;
    $("hideRulesTitle").textContent = `${site}에서 늘 숨기는 곳`;
    $("hideRuleCount").textContent = String(rules.length);
    $("hideRuleList").replaceChildren(
      ...[...rules].reverse().map((rule) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        const name = rule.label || rule.sel;
        text.textContent = rule.path ? `${name} · 이 주소만` : name;
        text.title = rule.path ? `${rule.sel}\n${rule.path}에서만 숨깁니다` : rule.sel;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "다시 보이기 (늘 숨기지 않기)";
        remove.addEventListener("click", () => chrome.runtime.sendMessage({ type: "hide-rule-remove", site, sel: rule.sel, path: rule.path ?? null }).catch(() => {}));
        li.append(text, remove);
        return li;
      }),
    );
  }

  async function loadRules() {
    const id = tabId;
    const list = site ? rulesOf(await loadHideRules(), site) : [];
    if (id !== tabId) return;
    rules = list;
    renderRules();
  }

  // 지금 페이지의 프레임마다 잠깐 숨긴 수를 더한다 (hide-core.js가 없는 프레임은 0)
  async function refreshTemp() {
    const id = tabId;
    let total = 0;
    if (id != null && web) {
      const results = await chrome.scripting
        .executeScript({ target: { tabId: id, allFrames: true }, func: () => self.__photoSaverHide?.tempCount() ?? 0 })
        .catch(() => []);
      total = results.reduce((sum, r) => sum + (Number(r.result) || 0), 0);
    }
    if (id !== tabId) return;
    $("hideTemp").textContent = `잠깐 숨긴 곳 ${total}곳`;
    $("hideTemp").hidden = total === 0;
    $("hideShow").hidden = total === 0;
  }

  // 사이드바를 다시 열었을 때 고르기가 이미 도는지 (맨 위 프레임에 묻는다)
  async function refreshPicking() {
    const id = tabId;
    if (id == null || !web) return;
    const [r] = await chrome.scripting.executeScript({ target: { tabId: id, frameIds: [0] }, func: () => self.__photoSaverPicker?.isOn() ?? false }).catch(() => []);
    if (id !== tabId) return;
    picking = Boolean(r?.result);
    renderPick();
  }

  pick.addEventListener("click", async () => {
    if (tabId == null) return;
    if (picking) {
      await chrome.runtime.sendMessage({ type: "hide-pick-stop", tabId }).catch(() => {});
      return;
    }
    pick.disabled = true;
    const reply = await chrome.runtime.sendMessage({ type: "hide-pick-start", tabId }).catch((err) => ({ error: err.message }));
    pick.disabled = !web;
    if (!reply?.ok) {
      say("이 페이지에서는 고를 수 없습니다 (크롬 설정, 웹 스토어처럼 크롬이 막는 페이지).", true);
      return;
    }
    if (!inPanel) window.close();
    else say("페이지에서 숨길 곳을 누르세요. 끝내려면 Esc를 누르거나 이 단추를 다시 누르세요.");
  });

  $("hideShow").addEventListener("click", async () => {
    if (tabId == null) return;
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: () => self.__photoSaverHide?.clearTemp() }).catch(() => []);
    refreshTemp();
  });

  $("hideClearRules").addEventListener("click", () => {
    if (site) chrome.runtime.sendMessage({ type: "hide-rules-clear", site }).catch(() => {});
  });

  // 페이지에서 숨기거나 되돌리면(hide-core.js) 잠깐 숨긴 수를 다시 센다. 고르기를 시작하거나 끝내면(서비스 워커) 단추를 바꾼다
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message?.type === "hide-pick-state" && message.tabId === tabId) {
      picking = Boolean(message.on);
      renderPick();
      if (!picking) say("");
    } else if ((message?.type === "hide-did" || message?.type === "hide-changed") && sender.tab?.id === tabId) refreshTemp();
  });
  // 다른 창에서 바꾼 것, 페이지에서 늘 숨긴 것도 맞춘다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[HIDE_KEY]) loadRules();
  });

  return {
    // 사이드바에서 탭을 바꾸거나 페이지가 넘어가면 그 탭으로 바꾼다
    async setTab(id) {
      tabId = id;
      site = null;
      web = false;
      picking = false;
      rules = [];
      say("");
      renderPick();
      renderRules();
      $("hideTemp").hidden = true;
      $("hideShow").hidden = true;
      if (id == null) return;
      const tab = await chrome.tabs.get(id).catch(() => null);
      if (id !== tabId) return;
      const url = tab?.url || tab?.pendingUrl || "";
      web = /^https?:/.test(url);
      site = siteKey(url);
      renderPick();
      loadRules();
      refreshTemp();
      refreshPicking();
    },
  };
}
