// 확장 프로그램 창(popup.js)과 열린 탭 받기(batch.js)가 함께 쓰는 것: 저장해 둔 옵션, 꾸밈 그림 기준, 사진 찾기와 크기 재기.
// 옵션은 확장 프로그램 페이지의 localStorage에 둔다 (창과 열린 탭 받기 화면이 같은 저장소를 본다. 서비스 워커는 못 읽는다)
import { collectImages } from "./collect.js";
import { SPLIT_MODES } from "./imageInfo.js";
import { extFromMime, extFromUrl, imageName, siteOf, validName } from "./names.js";

// 꾸밈 그림은 처음엔 체크를 꺼 둔다 (창에서는 "꾸밈 그림 숨기기"가 켜져 있으면 목록에서도 숨긴다).
// 페이지 위쪽 메뉴의 아이콘이 수십 개라 숨기지 않으면 본문 사진이 한참 아래에 나온다.
// - 가로·세로가 모두 SMALL보다 작은 그림: 아이콘·작은 로고·추적용 1px 그림.
//   둘 다 보는 것은 상세 페이지를 잘라 놓은 가로로 긴 띠 그림(860×40 등)을 빼지 않으려는 것이다
// - SVG: 거의 로고·아이콘이다. 주소에 확장자가 없는 SVG는 받아 본 종류로 알아본다(typeOf)
// - CSS 배경 그림: 여러 아이콘을 모은 그림(스프라이트)·꾸밈 띠가 많다. 본문 사진은 대개 <img>다
// - 미리보기가 안 뜨는 것: 그림이 아닌 주소(광고·방문 기록용 주소, 오류 페이지)이거나 사이트가 막은 것이다
export const SMALL = 100;
// 주소에 확장자가 없고 받아 봐도 종류를 알 수 없는 그림 (목록에는 "기타")
export const NO_EXT = "?";
// 받는 방식: 사진 따로, 세로로 이어 붙인 한 장, 둘 다
export const MODES = ["files", "stitch", "both"];
// 이어 붙인 그림의 형식: jpg(작다. JPG 한 장에 담기에 너무 길면 여러 장으로 나눠 받고, 폭이 너무 넓으면 png로 받는다) ·
// png(화질 그대로, 크다)
export const STITCH_FORMATS = ["jpg", "png"];
// JPG 한 장에 담기에 너무 긴 이어 붙인 그림(높이 65,500px 넘음): split(여러 장으로 나눠 받기, 기본) · png(PNG 한 장으로 받기).
// 나누는 방법(splitMode)은 imageInfo.js의 SPLIT_MODES(균등하게 · 최대 + 나머지)다. 사진 세로로 붙이기와 같은 옵션이다
export const TOO_LONG = ["split", "png"];
// JPG 품질과 기본값. 사이트의 src/shared/jpgQuality.js와 같은 값이다 (바꾸면 함께 바꾼다. 기본 95를 고른 까닭도 거기 있다)
export const JPG_QUALITIES = [100, 95, 90, 80];
export const DEFAULT_JPG_QUALITY = 95;

const SETTINGS_KEY = "settings";
// 빼 둔 파일 이름. 받기를 누를 때 직접 끈 사진의 이름을 넣고, 다시 켜고 받으면 뺀다. 넣은 차례대로 두고 오래된 것부터 버린다
const RULES_KEY = "excludedNames";
const MAX_RULES = 1000;
// 꺼 둔 확장자. 확장자 체크박스를 끄고 켜는 즉시 기억하고, 다른 페이지에서도 그 확장자는 처음부터 꺼 둔다
const EXTS_KEY = "excludedExts";

// 옵션(받는 방식, 이름, 확장자, 꾸밈 그림 숨기기 등)은 모두 고르는 즉시 저장해서 다음에 그대로 설정한다 (사용자 요청).
// 사진을 하나씩 끈 것(빼 둔 이름)만 받기를 누를 때 기억한다
export function loadSettings() {
  // fileNames: 사진 따로 받을 때의 파일 이름 (original 원본 이름 · number 번호)
  // stitchName: 이어 붙인 그림의 이름 (page 페이지 이름 · custom 직접 입력), customName: 직접 입력한 이름
  // 기본은 원본 이름과 페이지 이름이다 (사용자 요청). 화면에서도 기본을 왼쪽에 둔다
  // stitchFormat: 이어 붙인 그림의 형식 (jpg · png), jpgQuality: JPG 품질
  // tooLong: JPG 한 장에 담기에 너무 길 때 (split 여러 장으로 · png PNG 한 장), splitMode: 나누는 방법 (even 균등하게 · max 최대 + 나머지)
  // closeTabs: 열린 탭 받기에서 다 받은 탭을 닫을지
  const fallback = {
    hideDecor: true,
    mode: "files",
    fileNames: "original",
    stitchName: "page",
    customName: "",
    stitchFormat: STITCH_FORMATS[0],
    jpgQuality: DEFAULT_JPG_QUALITY,
    tooLong: TOO_LONG[0],
    splitMode: SPLIT_MODES[0],
    closeTabs: false,
  };
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    if (!MODES.includes(saved.mode)) saved.mode = fallback.mode;
    if (!["original", "number"].includes(saved.fileNames)) saved.fileNames = fallback.fileNames;
    if (!["page", "custom"].includes(saved.stitchName)) saved.stitchName = fallback.stitchName;
    if (typeof saved.customName !== "string") saved.customName = "";
    if (!STITCH_FORMATS.includes(saved.stitchFormat)) saved.stitchFormat = fallback.stitchFormat;
    if (!JPG_QUALITIES.includes(saved.jpgQuality)) saved.jpgQuality = fallback.jpgQuality;
    if (!TOO_LONG.includes(saved.tooLong)) saved.tooLong = fallback.tooLong;
    if (!SPLIT_MODES.includes(saved.splitMode)) saved.splitMode = fallback.splitMode;
    saved.closeTabs = Boolean(saved.closeTabs);
    return saved;
  } catch {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장하지 못해도 이번 창에서는 그대로 쓴다
  }
}

export const saveSettings = (settings) => store(SETTINGS_KEY, settings);

export function loadRules() {
  try {
    const list = JSON.parse(localStorage.getItem(RULES_KEY) ?? "[]");
    // 지금 기준으로 맞춰 볼 수 없는 옛 이름은 버린다 (names.js의 validName)
    return new Set(Array.isArray(list) ? list.filter((name) => typeof name === "string" && validName(name)) : []);
  } catch {
    return new Set();
  }
}

export const saveRules = (rules) => store(RULES_KEY, [...rules].slice(-MAX_RULES));

export function loadExts() {
  try {
    const list = JSON.parse(localStorage.getItem(EXTS_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((ext) => typeof ext === "string" && ext) : []);
  } catch {
    return new Set();
  }
}

export const saveExts = (extOff) => store(EXTS_KEY, [...extOff]);

// 설정 세트(사용자 요청): 설정을 이름 붙인 묶음으로 여러 개 두고 골라 쓴다. "우리 페이지용", "스마트스토어용"처럼 나눠 쓴다.
// 세트에는 위의 세 가지(옵션, 꺼 둔 확장자, 빼 둔 이름)가 모두 들어간다.
// 지금 고른 세트의 값은 늘 위의 세 열쇠(settings·excludedExts·excludedNames)에 있어서, 다른 코드는 세트를 몰라도 된다.
// 세트를 바꿀 때만 지금 값을 그 세트 자리에 넣어 두고, 고른 세트의 값을 세 열쇠로 꺼내 온다.
// 그래서 옵션을 바꾸면 따로 저장하지 않아도 고른 세트에 저장된다 (옵션은 고르는 즉시 저장한다는 규칙 그대로)
const SETS_KEY = "sets";
const SET_KEYS = [SETTINGS_KEY, EXTS_KEY, RULES_KEY];
const DEFAULT_SET = "기본";
const MAX_SET_NAME = 20;

// { active: 고른 세트 이름, list: [{ name, data: 세 열쇠의 값(고른 세트는 바꿀 때에야 채운다) }] }
function readSets() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETS_KEY) ?? "null");
    const list = Array.isArray(saved?.list) ? saved.list.filter((set) => typeof set?.name === "string" && set.name) : [];
    if (list.some((set) => set.name === saved?.active)) return { active: saved.active, list };
  } catch {
    // 읽지 못하면 처음 상태로 본다
  }
  return { active: DEFAULT_SET, list: [{ name: DEFAULT_SET, data: null }] };
}

const snapshot = () => Object.fromEntries(SET_KEYS.map((key) => [key, localStorage.getItem(key)]));

function restore(data) {
  for (const key of SET_KEYS) {
    if (typeof data?.[key] === "string") localStorage.setItem(key, data[key]);
    else localStorage.removeItem(key);
  }
}

export const cleanSetName = (text) =>
  Array.from(String(text ?? "").replace(/\s+/g, " ").trim())
    .slice(0, MAX_SET_NAME)
    .join("");

function newName(sets, text) {
  const name = cleanSetName(text);
  if (!name) throw new Error("세트 이름을 적어 주세요.");
  if (sets.list.some((set) => set.name === name)) throw new Error("같은 이름의 세트가 있습니다.");
  return name;
}

export function listSets() {
  const sets = readSets();
  return { active: sets.active, names: sets.list.map((set) => set.name) };
}

// 다른 세트로 바꾼다. 바뀌었으면 true (화면은 옵션을 다시 읽어야 한다)
export function switchSet(name) {
  const sets = readSets();
  const from = sets.list.find((set) => set.name === sets.active);
  const to = sets.list.find((set) => set.name === name);
  if (!to || to === from) return false;
  from.data = snapshot();
  restore(to.data);
  sets.active = to.name;
  store(SETS_KEY, sets);
  return true;
}

// 지금 설정을 복사해 새 세트를 만들고 그 세트를 고른다 (설정 값은 그대로다)
export function addSet(text) {
  const sets = readSets();
  const name = newName(sets, text);
  sets.list.find((set) => set.name === sets.active).data = snapshot();
  sets.list.push({ name, data: snapshot() });
  sets.active = name;
  store(SETS_KEY, sets);
}

// 지금 고른 세트의 이름을 바꾼다
export function renameSet(text) {
  const sets = readSets();
  if (cleanSetName(text) === sets.active) return;
  const name = newName(sets, text);
  sets.list.find((set) => set.name === sets.active).name = name;
  sets.active = name;
  store(SETS_KEY, sets);
}

// 지금 고른 세트를 지우고 남은 첫 세트를 고른다 (화면은 옵션을 다시 읽어야 한다)
export function removeSet() {
  const sets = readSets();
  if (sets.list.length <= 1) throw new Error("세트가 하나뿐이라 지울 수 없습니다.");
  sets.list = sets.list.filter((set) => set.name !== sets.active);
  restore(sets.list[0].data);
  sets.active = sets.list[0].name;
  store(SETS_KEY, sets);
}

export const isSmall = (item) => item.width > 0 && item.height > 0 && Math.max(item.width, item.height) < SMALL;
export const isDecor = (item) => isSmall(item) || item.ext === "svg" || Boolean(item.background) || Boolean(item.broken);
export const extKey = (item) => item.ext ?? NO_EXT;

export function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

// 탭의 페이지에서 사진을 찾는다. { title, host, images }를 돌려주고, 크롬이 막는 페이지(크롬 설정, 웹 스토어 등)면 오류를 던진다
export async function findImages(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: collectImages });
  } catch {
    // 프레임 가운데 들어갈 수 없는 것이 있으면 맨 위 페이지만 본다
    results = await chrome.scripting.executeScript({ target: { tabId }, func: collectImages });
  }
  // 맨 위 페이지(frameId 0)를 먼저, 그 안의 프레임은 만들어진 순서대로 붙인다.
  // 프레임은 맨 위 페이지와 같은 사이트(naver.com처럼 도메인 뒤쪽이 같은 것)의 것만 쓴다.
  // 네이버 지도(map.naver.com)의 장소 사진은 pcmap.place.naver.com 프레임에 있어서, 주소(출처)가 같은 것만 쓰면 빠진다.
  // 다른 사이트의 광고·위젯(네이버 블로그 옆 배너 blog.naverblogwidget.com 등)은 뺀다
  const top = results.find((r) => r.frameId === 0)?.result;
  const topSite = top ? siteOf(top.origin) : null;
  const sameSite = (origin) => origin === top.origin || (topSite !== null && siteOf(origin) === topSite);
  const frames = results
    .filter((r) => r.result?.images && (!top || r.frameId === 0 || sameSite(r.result.origin)))
    .sort((a, b) => a.frameId - b.frameId);
  const seen = new Set();
  const images = [];
  for (const { result } of frames) {
    for (const found of result.images) {
      if (seen.has(found.url)) continue;
      seen.add(found.url);
      images.push(found);
    }
  }
  return { title: top?.title ?? "", host: hostOf(top?.url), images };
}

// 찾은 그림에 이름(빼 둔 이름과 맞춰 볼 것)과 확장자를 붙인다.
// 확장자는 주소에 적힌 것으로 안다. 주소에 없으면 그림이 뜬 뒤 받아 본 종류로 알아본다(typeOf)
export function newItem(found) {
  const ext = extFromUrl(found.url);
  return { ...found, name: imageName(found.url), ext, typed: Boolean(ext), touched: false };
}

// 주소에 확장자가 없는 그림(…/avatar/128 등)의 확장자를 받아 본 종류(Content-Type)로 안다.
// 그림이 뜬 뒤에 물어서 대개 방금 받은 것을 다시 쓴다(force-cache). 머리만 읽고 내용은 받지 않는다
export async function typeOf(url) {
  try {
    const res = await fetch(url, { cache: "force-cache", credentials: "include", referrerPolicy: "no-referrer" });
    const ext = res.ok ? extFromMime(res.headers.get("content-type")) : null;
    res.body?.cancel().catch(() => {});
    return ext;
  } catch {
    return null;
  }
}

// 화면에 보이지 않게 그림을 불러 크기를 재고, 못 불러오면 미리보기가 안 뜨는 것(broken)으로 친다 (열린 탭 받기용).
// 창이 미리보기로 하는 일과 같다. 너무 오래 걸리면 모르는 채로 둔다 (창에서 미리보기가 뜨기 전에 받기를 누른 것과 같다)
export function measure(item, timeout = 15000) {
  return new Promise((resolve) => {
    const img = new Image();
    // 리퍼러를 보내지 않는다. 다른 사이트에서 오는 요청을 막는 곳도 리퍼러가 없으면 대개 보여 준다
    img.referrerPolicy = "no-referrer";
    let settled = false;
    const finish = async (state) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (state === "loaded") {
        if (!(item.width && item.height)) {
          item.width = img.naturalWidth;
          item.height = img.naturalHeight;
        }
        if (!item.typed) {
          item.ext = await typeOf(item.url);
          item.typed = true;
        }
      } else if (state === "failed") {
        item.broken = true;
        item.typed = true;
      }
      resolve(item);
    };
    const timer = setTimeout(() => finish("slow"), timeout);
    img.addEventListener("load", () => finish("loaded"), { once: true });
    img.addEventListener("error", () => finish("failed"), { once: true });
    img.src = item.url;
  });
}
