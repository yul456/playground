// 고른 글자를 넣어 열 주소 (사용자 요청, 2026-11-19, 1.22.0). 확장 프로그램 창(open-urls.js)과 서비스 워커(background.js)가 함께 쓴다.
// 주소에 고른 글이 들어갈 자리를 {a}처럼 적어 둔다 (자리 이름은 아무거나, 비워도 된다: {}. 크롬 검색 엔진 설정처럼 %s도 된다).
// 페이지에서 글자를 고르고 오른쪽 클릭 › 페이지 도우미에서 그 주소를 고르면, 고른 글을 소문자로 바꾸고 주소에 쓸 수 있게 바꿔서
// (encodeURIComponent: 빈칸은 %20, /는 %2F, 한글은 %XX) 그 자리에 넣고 새 탭으로 연다 (사용자가 정한 규칙).
// 바꿀 자리는 한 가지만 쓴다 (같은 자리를 여러 번 쓰면 모두 같은 글로 바꾼다). 목록은 chrome.storage.local의 urlTemplates에 더한 순서대로 둔다
import { tidyText } from "./search-words.js";

export const URL_KEY = "urlTemplates";
export const URL_MAX = 20;
export const TEMPLATE_MAX = 500;
// 바꿀 자리: {이름} 또는 %s
const SLOT = /\{([^{}]*)\}|%s/g;

// 적은 주소를 살핀다: { template } 또는 { error } (빈 칸이면 error가 빈 글). https://를 빠뜨리면 붙인다
export function parseTemplate(text) {
  let template = String(text ?? "").trim();
  if (!template) return { error: "" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(template)) template = `https://${template}`;
  if (template.length > TEMPLATE_MAX) return { error: `주소가 너무 깁니다 (${TEMPLATE_MAX}자까지).` };
  const names = new Set([...template.matchAll(SLOT)].map((m) => (m[0] === "%s" ? "%s" : m[1])));
  if (!names.size) return { error: "주소에 {a}처럼 고른 글을 넣을 자리를 적어 주세요." };
  if (names.size > 1) return { error: "바꿀 자리는 한 가지만 쓸 수 있습니다 (같은 자리를 여러 번 쓰는 것은 됩니다)." };
  let url;
  try {
    url = new URL(template.replace(SLOT, "x"));
  } catch {
    return { error: "주소 모양이 아닙니다." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "http나 https 주소만 됩니다." };
  return { template };
}

// 고른 글을 넣은 주소: 고른 글은 줄 바꿈·여러 칸을 한 칸으로, 앞뒤 빈칸을 떼고, 소문자로 바꿔 주소에 쓸 수 있게 바꾼다.
// 앞뒤의 기호를 뗄지는 부르는 쪽이 정해 다듬은 글을 넘긴다 (search-words.js의 cleanSelection. 여기서는 기호를 떼지 않는다)
export function fillTemplate(template, selection) {
  const value = encodeURIComponent(tidyText(selection).toLowerCase());
  return template.replace(SLOT, () => value);
}

// 메뉴와 창에 보일 주소: 앞의 http(s)://는 떼고, %XX는 글자로 풀고, 바꿀 자리는 %s로 (메뉴에서는 크롬이 %s를 고른 글로 바꿔 보인다)
export function templateLabel(template) {
  let text = template.replace(/^https?:\/\//i, "").replace(SLOT, "{}");
  try {
    text = decodeURI(text);
  } catch {
    // 풀 수 없는 %가 섞인 주소는 그대로 보인다
  }
  return text.replaceAll("{}", "%s");
}

export async function loadTemplates() {
  try {
    const list = (await chrome.storage.local.get(URL_KEY))[URL_KEY];
    if (!Array.isArray(list)) return [];
    const templates = [];
    for (const item of list) {
      const { template } = parseTemplate(item);
      if (template && !templates.includes(template)) templates.push(template);
    }
    return templates.slice(0, URL_MAX);
  } catch {
    return [];
  }
}

export const saveTemplates = (list) => chrome.storage.local.set({ [URL_KEY]: list.slice(0, URL_MAX) });
