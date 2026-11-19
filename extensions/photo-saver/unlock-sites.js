// 오른쪽 클릭 막기를 늘 풀 사이트 (사용자 요청, 2026-11-19). 확장 프로그램 창(unlock.js)과 서비스 워커(background.js)가 함께 쓴다.
// - 사이트는 주소창의 호스트다(blog.naver.com). 앞의 www.는 떼고 기억해서 www가 있든 없든 같은 사이트로 본다. 다른 하위 주소(m.·map. 등)는 따로다.
//   네이버처럼 하위 주소마다 다른 서비스(지도의 자체 오른쪽 클릭 메뉴 등)가 있어서 도메인 전체로 넓히지 않았다
// - 목록은 chrome.storage.local의 unlockSites에 둔다. 설정 세트에 넣지 않는다 (서비스 워커는 세트가 든 localStorage를 읽지 못한다)
// - 서비스 워커가 목록이 바뀔 때, 브라우저를 켤 때, 확장 프로그램을 설치하거나 새로 고칠 때 콘텐츠 스크립트를 다시 등록한다:
//   unlock-page.js(페이지 쪽 공간에서 페이지가 뜰 때 풀기)와 unlock-css.js(사용자 스타일을 넣어 달라고 부탁)

export const UNLOCK_KEY = "unlockSites";
export const UNLOCK_MAX = 200;
// 글자 고르기·그림 끌기를 막은 꾸밈을 덮는다. insertCSS의 사용자 스타일(origin USER)로 넣어 사이트의 !important보다 앞서고 사이트의 CSP에도 걸리지 않는다
export const UNLOCK_CSS =
  "*, *::before, *::after { -webkit-user-select: text !important; user-select: text !important; -webkit-user-drag: auto !important; -webkit-touch-callout: default !important; }";
const SCRIPT_IDS = ["unlock-page", "unlock-css"];

// 주소의 사이트 이름 (http·https만). 앞의 www.는 뗀다. 늘 풀기를 둘 수 없는 주소면 null
export function siteKey(url) {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== "http:" && protocol !== "https:") return null;
    const site = hostname.replace(/^www\./, "");
    return /^[a-z0-9.-]+$/.test(site) ? site : null;
  } catch {
    return null;
  }
}

// 사이트의 일치 패턴 (포트와 상관없이 맞는다). 이름이 있는 주소는 www.가 붙은 것도 함께 (IP 주소, localhost는 그대로)
export function patternsFor(site) {
  const plain = /^[\d.]+$/.test(site) || !site.includes(".");
  return plain ? [`*://${site}/*`] : [`*://${site}/*`, `*://www.${site}/*`];
}

export async function loadUnlockSites() {
  try {
    const list = (await chrome.storage.local.get(UNLOCK_KEY))[UNLOCK_KEY];
    return Array.isArray(list) ? list.filter((site) => typeof site === "string" && siteKey(`http://${site}/`) === site) : [];
  } catch {
    return [];
  }
}

export const saveUnlockSites = (list) => chrome.storage.local.set({ [UNLOCK_KEY]: list.slice(-UNLOCK_MAX) });

// 목록대로 콘텐츠 스크립트를 등록한다 (있던 것을 지우고 다시). 목록이 비면 등록하지 않는다
export async function syncUnlockScripts() {
  const sites = await loadUnlockSites();
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: SCRIPT_IDS }).catch(() => []);
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map((script) => script.id) });
  if (!sites.length) return;
  const matches = sites.flatMap(patternsFor);
  await chrome.scripting.registerContentScripts([
    { id: "unlock-page", matches, js: ["unlock-page.js"], world: "MAIN", runAt: "document_start", allFrames: true, persistAcrossSessions: true },
    { id: "unlock-css", matches, js: ["unlock-css.js"], runAt: "document_start", allFrames: true, persistAcrossSessions: true },
  ]);
}
