// 보기 싫은 부분 숨기기(사용자 요청, 2026-11-19, 1.20.0)의 늘 숨기는 곳 목록. 확장 프로그램 창(hide.js)과 서비스 워커(background.js)가 함께 쓴다.
// - 목록은 chrome.storage.local의 hideRules에 사이트(주소창의 호스트, 앞의 www.는 뗀다. unlock-sites.js의 siteKey)마다 둔다:
//   { "example.com": [{ sel, path, label, at }] }. sel은 숨길 요소의 CSS 선택자, label은 창의 목록에 보일 이름,
//   path는 그 주소(경로)에서만 숨길 때의 경로이고 사이트 전체면 null이다(위치로만 찾은 부분은 경로를 붙인다. hide-core.js 참고)
// - 숨기는 일은 페이지 쪽 hide-core.js가 한다. 서비스 워커가 목록에 있는 사이트에 hide-core.js를 콘텐츠 스크립트로 등록해 두어
//   그 사이트의 페이지는 뜰 때마다 저절로 숨긴다(syncHideScripts). 설정 세트에는 넣지 않는다 (서비스 워커는 세트가 든 localStorage를 읽지 못한다)
import { patternsFor, siteKey } from "./unlock-sites.js";

export { siteKey };
export const HIDE_KEY = "hideRules";
// "숨길 곳 고르기"의 "이 사이트에서 늘 숨기기" 칸 (고르는 동안 페이지의 안내 줄에서 바꾼다)
export const HIDE_REMEMBER = "hideRemember";
export const HIDE_SITE_MAX = 200;
export const HIDE_SITES_MAX = 500;
const SCRIPT_ID = "hide-core";

// 선택자는 hide-core.js가 이름표(id·class)를 CSS.escape로 적어 만든다. 저장된 값이 깨졌을 때를 대비해 규칙 밖으로 나가는 글자({ })는 받지 않는다
export const validRule = (rule) =>
  rule != null &&
  typeof rule.sel === "string" &&
  rule.sel.length > 0 &&
  rule.sel.length <= 1000 &&
  !/[{}]/.test(rule.sel) &&
  (rule.path == null || (typeof rule.path === "string" && rule.path.length <= 1000));

export const validSite = (site) => typeof site === "string" && siteKey(`http://${site}/`) === site;

export async function loadHideRules() {
  try {
    const all = (await chrome.storage.local.get(HIDE_KEY))[HIDE_KEY];
    return all && typeof all === "object" && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

// 사이트의 늘 숨기는 곳 (잘못된 값은 뺀다)
export const rulesOf = (all, site) => (Array.isArray(all?.[site]) ? all[site].filter(validRule) : []);

// 늘 숨기는 곳이 있는 사이트에 hide-core.js를 등록한다 (페이지가 뜰 때, 프레임마다). 사이트가 그대로면 다시 등록하지 않는다
export async function syncHideScripts() {
  const all = await loadHideRules();
  const sites = Object.keys(all).filter((site) => validSite(site) && rulesOf(all, site).length > 0);
  const matches = [...new Set(sites.flatMap(patternsFor))].sort();
  const [registered] = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] }).catch(() => []);
  if (registered && JSON.stringify([...(registered.matches ?? [])].sort()) === JSON.stringify(matches)) return;
  if (registered) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([
    { id: SCRIPT_ID, matches, js: ["hide-core.js"], runAt: "document_start", allFrames: true, persistAcrossSessions: true },
  ]);
}
