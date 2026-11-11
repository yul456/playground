// 확장 프로그램 버튼을 누르면 뜨는 창. 지금 탭의 사진을 찾아 보여 주고, 고른 사진을 받게 맡긴다(background.js)
import { collectImages } from "./collect.js";
import { BASE_FOLDER, cleanFolderName, extFromMime, extFromUrl, imageName, siteOf, validName } from "./names.js";

// 꾸밈 그림은 처음엔 체크를 꺼 두고, "꾸밈 그림 숨기기"가 켜져 있으면 목록에서도 숨긴다.
// 페이지 위쪽 메뉴의 아이콘이 수십 개라 숨기지 않으면 본문 사진이 한참 아래에 나온다.
// - 가로·세로가 모두 SMALL보다 작은 그림: 아이콘·작은 로고·추적용 1px 그림.
//   둘 다 보는 것은 상세 페이지를 잘라 놓은 가로로 긴 띠 그림(860×40 등)을 빼지 않으려는 것이다
// - SVG: 거의 로고·아이콘이다. 주소에 확장자가 없는 SVG는 받아 본 종류로 알아본다(probe)
// - CSS 배경 그림: 여러 아이콘을 모은 그림(스프라이트)·꾸밈 띠가 많다. 본문 사진은 대개 <img>다
// - 미리보기가 안 뜨는 것: 그림이 아닌 주소(광고·방문 기록용 주소, 오류 페이지)이거나 사이트가 막은 것이다
const SMALL = 100;
const STITCH_URL = "https://yul456.github.io/playground/stitch/";
const SETTINGS_KEY = "settings";
// 빼 둔 파일 이름. 받기를 누를 때 직접 끈 사진의 이름을 넣고, 다시 켜고 받으면 뺀다. 넣은 차례대로 두고 오래된 것부터 버린다
const RULES_KEY = "excludedNames";
const MAX_RULES = 1000;
// 꺼 둔 확장자. 확장자 체크박스를 끄고 켜는 즉시 기억하고, 다른 페이지에서도 그 확장자는 처음부터 꺼 둔다
const EXTS_KEY = "excludedExts";
// 주소에 확장자가 없고 받아 봐도 종류를 알 수 없는 그림 (목록에는 "기타")
const NO_EXT = "?";
// 확장자 체크박스를 놓는 순서
const EXT_ORDER = ["jpg", "png", "gif", "webp", "avif", "bmp", "svg", "ico", "tif", "heic", "heif", "jxl", NO_EXT];
// 한 번에 종류를 물어보는 그림 수
const PROBING = 4;
// 받는 방식: 사진 따로, 세로로 이어 붙인 한 장, 둘 다
const MODES = ["files", "stitch", "both"];
const START_TEXT = {
  files: (n) => `${n}장 받기`,
  stitch: (n) => `${n}장 이어 붙이기`,
  both: (n) => `${n}장 받고 이어 붙이기`,
};

const $ = (id) => document.getElementById(id);

let tabId = null;
let pageTitle = "";
let pageHost = "";
// { url, name, ext(확장자, 모르면 null), typed(종류를 다 알아봤나), width, height, alt, background, broken, checked, touched, cell }
let items = [];
let folderEdited = false;
let job = null; // 받는 중이거나 마지막으로 끝난 받기 (background.js가 알려 준다)
const settings = loadSettings();
const rules = loadRules();
// 꺼 둔 확장자. 체크박스를 누를 때마다 바로 저장한다.
// 옵션(받는 방식, 이름, 확장자, 꾸밈 그림 숨기기)은 모두 고르는 즉시 저장해서 다음에 그대로 설정한다 (사용자 요청).
// 사진을 하나씩 끈 것(빼 둔 이름)만 받기를 누를 때 기억한다
const extOff = loadExts();
// 체크박스를 늘 보일 확장자: 기억해 둔 것과 이 창에서 켜고 끈 것 (이 페이지에 없어도 다시 켤 수 있게)
const extShown = new Set(extOff);

function loadSettings() {
  // fileNames: 사진 따로 받을 때의 파일 이름 (original 원본 이름 · number 번호)
  // stitchName: 이어 붙인 그림의 이름 (page 페이지 이름 · custom 직접 입력), customName: 직접 입력한 이름
  // 기본은 원본 이름과 페이지 이름이다 (사용자 요청). 화면에서도 기본을 왼쪽에 둔다
  const fallback = { hideDecor: true, mode: "files", fileNames: "original", stitchName: "page", customName: "" };
  try {
    const saved = { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
    if (!MODES.includes(saved.mode)) saved.mode = fallback.mode;
    if (!["original", "number"].includes(saved.fileNames)) saved.fileNames = fallback.fileNames;
    if (!["page", "custom"].includes(saved.stitchName)) saved.stitchName = fallback.stitchName;
    if (typeof saved.customName !== "string") saved.customName = "";
    return saved;
  } catch {
    return fallback;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // 저장하지 못해도 이번 창에서는 그대로 쓴다
  }
}

function loadRules() {
  try {
    const list = JSON.parse(localStorage.getItem(RULES_KEY) ?? "[]");
    // 지금 기준으로 맞춰 볼 수 없는 옛 이름은 버린다 (names.js의 validName)
    return new Set(Array.isArray(list) ? list.filter((name) => typeof name === "string" && validName(name)) : []);
  } catch {
    return new Set();
  }
}

function saveRules() {
  try {
    localStorage.setItem(RULES_KEY, JSON.stringify([...rules].slice(-MAX_RULES)));
  } catch {
    // 저장하지 못해도 이번 창에서는 그대로 쓴다
  }
}

function loadExts() {
  try {
    const list = JSON.parse(localStorage.getItem(EXTS_KEY) ?? "[]");
    return new Set(Array.isArray(list) ? list.filter((ext) => typeof ext === "string" && ext) : []);
  } catch {
    return new Set();
  }
}

function saveExts() {
  try {
    localStorage.setItem(EXTS_KEY, JSON.stringify([...extOff]));
  } catch {
    // 저장하지 못해도 이번 창에서는 그대로 쓴다
  }
}

const isSmall = (item) => item.width > 0 && item.height > 0 && Math.max(item.width, item.height) < SMALL;
const isDecor = (item) => isSmall(item) || item.ext === "svg" || Boolean(item.background) || Boolean(item.broken);
const isRuled = (item) => Boolean(item.name) && rules.has(item.name);
const extKey = (item) => item.ext ?? NO_EXT;
// 확장자 체크박스를 꺼 둔 확장자의 사진. 꾸밈 그림·빼 둔 이름처럼 처음엔 체크를 꺼 두고, 목록에는 그대로 보인다.
// 처음엔 목록에서 숨겼는데, 아예 사라지는 것이 불편하다고 해서 체크만 끄게 바꿨다. 하나씩 다시 켤 수 있다
const isExtOff = (item) => extOff.has(extKey(item));
// 처음 고를 상태. 직접 켜고 끈 것은 그대로 둔다
const choose = (item) => {
  if (!item.touched) item.checked = !isDecor(item) && !isRuled(item) && !isExtOff(item);
};
// 체크한 꾸밈 그림은 숨기지 않는다 (숨긴 채 받으면 무엇을 받는지 모른다).
// 빼 둔 이름의 사진도 숨기지 않는다. 흔한 이름(image.png 등)이 겹쳐 본문 사진이 꺼졌을 때 보여야 한다
const isHidden = (item) => settings.hideDecor && isDecor(item) && !item.checked;
// "모두 고르기·모두 끄기"가 다루는 사진: 보이는 것 가운데 꺼 둔 확장자가 아닌 것.
// 꺼 둔 확장자의 사진은 확장자를 켜거나 하나씩 켜야 받는다
const canToggle = (item) => !isHidden(item) && !isExtOff(item);

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const pageName = () => cleanFolderName(pageTitle, pageHost || "사진");
const folderName = () => cleanFolderName($("folder").value, pageName());
// 받기에 쓸 폴더 이름. 이어 붙인 그림만 받을 때는 폴더 칸이 없어서 페이지 이름을 쓴다 (이 이름이 이어 붙인 그림의 이름이 된다)
const jobFolder = () => (settings.mode === "stitch" ? pageName() : folderName());
// 직접 입력한 이어 붙인 그림 이름. 직접 입력이 아니거나 비어 있으면 ""이고, 그때는 폴더 이름(페이지 제목)으로 저장한다
const customStitchName = () => (settings.stitchName === "custom" ? cleanFolderName(settings.customName, "") : "");

function showMessage(text, detail = "") {
  const box = $("message");
  box.replaceChildren(text);
  if (detail) {
    const small = document.createElement("small");
    small.textContent = detail;
    box.append(small);
  }
  box.hidden = false;
}

// 크롬 설정·웹 스토어 같은 페이지는 크롬이 확장 프로그램의 접근을 막는다
function showBlocked(err) {
  const detail = String(err?.message ?? err);
  if (/file:/i.test(detail)) {
    showMessage(
      "내 PC의 파일을 연 페이지입니다. chrome://extensions에서 이 확장 프로그램의 \"세부정보\"를 열어 \"파일 URL에 대한 액세스 허용\"을 켜면 읽을 수 있습니다.",
      detail,
    );
  } else {
    showMessage("이 페이지는 크롬이 확장 프로그램의 접근을 막는 페이지(크롬 설정, 웹 스토어 등)라 사진을 읽을 수 없습니다.", detail);
  }
}

async function scan() {
  if (tabId == null) {
    showMessage("사진을 찾을 탭을 알지 못했습니다.");
    return;
  }
  showMessage("사진을 찾는 중…");
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: collectImages });
  } catch {
    // 프레임 가운데 들어갈 수 없는 것이 있으면 맨 위 페이지만 본다
    try {
      results = await chrome.scripting.executeScript({ target: { tabId }, func: collectImages });
    } catch (err) {
      showBlocked(err);
      return;
    }
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
  pageTitle = top?.title ?? "";
  pageHost = hostOf(top?.url);

  // 다시 찾을 때는 고른 상태와 잰 크기를 이어 간다
  const previous = new Map(items.map((item) => [item.url, item]));
  const seen = new Set();
  items = [];
  for (const { result } of frames) {
    for (const found of result.images) {
      if (seen.has(found.url)) continue;
      seen.add(found.url);
      let item = previous.get(found.url);
      if (!item) {
        // 확장자는 주소에 적힌 것으로 안다. 주소에 없으면 미리보기가 뜬 뒤 받아 본 종류로 알아본다(probe)
        const ext = extFromUrl(found.url);
        item = { ...found, name: imageName(found.url), ext, typed: Boolean(ext), touched: false };
        choose(item);
      }
      items.push(item);
    }
  }

  $("page").textContent = pageTitle || pageHost || " ";
  if (!folderEdited) $("folder").value = cleanFolderName(pageTitle, pageHost || "사진");
  $("form").hidden = false;
  if (items.length) $("message").hidden = true;
  else showMessage("이 페이지에서 사진을 찾지 못했습니다. 스크롤해야 나오는 사진이면 페이지를 끝까지 내린 뒤 \"다시 찾기\"를 누르세요.");
  render();
  updatePreview();
}

function render() {
  $("grid").replaceChildren(...items.map(makeCell));
  refresh();
}

function makeCell(item) {
  const li = document.createElement("li");
  li.className = "cell";
  li.title = item.url.startsWith("data:") ? "페이지 안에 들어 있는 그림" : item.url;
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.addEventListener("change", () => {
    item.checked = box.checked;
    item.touched = true;
    refresh();
  });
  const thumb = document.createElement("span");
  thumb.className = "thumb";
  const num = document.createElement("span");
  num.className = "num";
  const tag = document.createElement("span");
  tag.className = "tag";
  tag.textContent = "빼 둔 이름";
  const size = document.createElement("span");
  size.className = "size";
  if (item.broken) thumb.append(noPreview());
  else thumb.append(preview(item));
  label.append(box, thumb, num, tag, size);
  li.append(label);
  item.cell = { li, box, num, tag, size };
  return li;
}

function noPreview() {
  const none = document.createElement("span");
  none.className = "nopreview";
  none.textContent = "미리보기 없음";
  return none;
}

// 미리보기를 불러오며 크기를 잰다. 불러오지 못하면 그림이 아니거나 막힌 주소로 보고 꾸밈 그림처럼 뺀다
function preview(item) {
  const img = document.createElement("img");
  img.alt = item.alt ?? "";
  img.decoding = "async";
  // 리퍼러를 보내지 않는다. 다른 사이트에서 오는 요청을 막는 곳도 리퍼러가 없으면 대개 보여 준다
  img.referrerPolicy = "no-referrer";
  img.addEventListener(
    "load",
    () => {
      if (!item.typed) probe(item);
      if (item.width && item.height) return;
      item.width = img.naturalWidth;
      item.height = img.naturalHeight;
      choose(item);
      refresh();
    },
    { once: true },
  );
  img.addEventListener(
    "error",
    () => {
      item.broken = true;
      item.typed = true;
      img.replaceWith(noPreview());
      choose(item);
      refresh();
    },
    { once: true },
  );
  img.src = item.url;
  return img;
}

// 주소에 확장자가 없는 그림(…/avatar/128 등)은 받아 본 종류(Content-Type)로 확장자를 안다.
// 미리보기가 뜬 뒤에 물어서 대개 방금 받은 것을 다시 쓴다(force-cache). 머리만 읽고 내용은 받지 않는다
const probeQueue = [];
let probing = 0;
function probe(item) {
  if (item.probing) return;
  item.probing = true;
  probeQueue.push(item);
  pumpProbes();
}

function pumpProbes() {
  while (probing < PROBING && probeQueue.length) {
    const item = probeQueue.shift();
    probing++;
    typeOf(item.url).then((ext) => {
      probing--;
      item.ext = ext;
      item.typed = true;
      choose(item); // SVG면 꾸밈 그림이 된다
      if (items.includes(item)) refresh();
      pumpProbes();
    });
  }
}

async function typeOf(url) {
  try {
    const res = await fetch(url, { cache: "force-cache", credentials: "include", referrerPolicy: "no-referrer" });
    const ext = res.ok ? extFromMime(res.headers.get("content-type")) : null;
    res.body?.cancel().catch(() => {});
    return ext;
  } catch {
    return null;
  }
}

// 확장자 체크박스. 목록에 있는 확장자마다 하나씩 두고(꾸밈 그림으로 숨긴 것과 종류를 알아보는 중인 것은 세지 않는다),
// 꺼 둔 확장자는 이 페이지에 없어도 보인다
const extChips = new Map(); // 확장자 → { label, box, count }
let chipOrder = null;
const extRank = (key) => {
  const rank = EXT_ORDER.indexOf(key);
  return rank < 0 ? EXT_ORDER.length - 1.5 : rank;
};

function makeChip(key) {
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.addEventListener("change", () => {
    if (box.checked) extOff.delete(key);
    else extOff.add(key);
    extShown.add(key);
    saveExts();
    // 그 확장자의 사진을 한꺼번에 끄거나 처음 상태로 되돌린다. 하나씩 켜고 끈 것도 여기에 맞춘다
    for (const item of items) {
      if (extKey(item) !== key) continue;
      item.touched = false;
      choose(item);
    }
    refresh();
  });
  const name = document.createElement("span");
  name.className = "ext";
  name.textContent = key === NO_EXT ? "기타" : key;
  if (key === NO_EXT) label.title = "주소에 확장자가 없고, 받아 봐도 종류를 알 수 없는 그림";
  const count = document.createElement("span");
  count.className = "n";
  label.append(box, name, count);
  return { label, box, count };
}

function renderExts() {
  const counts = new Map();
  for (const item of items) {
    if (!item.typed || isHidden(item)) continue;
    const key = extKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const keys = [...new Set([...counts.keys(), ...extShown])].sort((a, b) => extRank(a) - extRank(b) || a.localeCompare(b));
  // 체크박스는 확장자 종류가 바뀔 때만 다시 놓는다 (누르고 있는 체크박스를 옮기면 초점을 잃는다)
  if (keys.join() !== chipOrder) {
    chipOrder = keys.join();
    for (const key of keys) if (!extChips.has(key)) extChips.set(key, makeChip(key));
    $("extList").replaceChildren(...keys.map((key) => extChips.get(key).label));
  }
  for (const key of keys) {
    const chip = extChips.get(key);
    chip.box.checked = !extOff.has(key);
    chip.count.textContent = String(counts.get(key) ?? 0);
  }
  $("exts").hidden = keys.length === 0;
}

// 고른 상태에 맞춰 번호(받을 때 파일 이름)와 개수를 다시 적는다
function refresh() {
  renderExts();
  const chosen = items.filter((item) => item.checked).length;
  const digits = Math.max(3, String(chosen).length);
  let n = 0;
  let hidden = 0;
  for (const item of items) {
    const { li, box, num, tag, size } = item.cell;
    box.checked = item.checked;
    li.classList.toggle("off", !item.checked);
    li.hidden = isHidden(item);
    if (li.hidden) hidden++;
    num.textContent = item.checked ? String(++n).padStart(digits, "0") : "";
    tag.hidden = !isRuled(item);
    size.textContent = [item.width ? `${item.width}×${item.height}` : "", item.ext ?? ""].filter(Boolean).join(" · ");
  }
  $("count").textContent = `${chosen}장 고름 · 모두 ${items.length}장${hidden ? ` (꾸밈 그림 ${hidden}장 숨김)` : ""}`;
  const list = items.filter(canToggle);
  $("toggleAll").textContent = list.length && list.every((item) => item.checked) ? "모두 끄기" : "모두 고르기";
  updateStart();
}

function updateStart() {
  const chosen = items.filter((item) => item.checked).length;
  const start = $("start");
  start.disabled = !chosen || Boolean(job?.running);
  start.textContent = chosen ? START_TEXT[settings.mode](chosen) : "받기";
}

// 받는 방식에 맞는 이름 옵션만 보인다 (사진 따로: 폴더와 사진 이름, 이어 붙이기: 그림 이름)
function showOptions() {
  $("filesOptions").hidden = settings.mode === "stitch";
  $("stitchOptions").hidden = settings.mode === "files";
  $("customName").hidden = settings.stitchName !== "custom";
}

// 받으면 생길 파일을 미리 보여 준다
function updatePreview() {
  const folder = jobFolder();
  const lines = [];
  if (settings.mode !== "stitch") {
    const names = settings.fileNames === "original" ? "원본 이름.jpg …" : "001.jpg, 002.jpg …";
    lines.push(`사진: 다운로드/${BASE_FOLDER}/${folder}/${names}`);
  }
  if (settings.mode !== "files") {
    lines.push(`이어 붙인 그림: 다운로드/${BASE_FOLDER}/${customStitchName() || folder}.png`);
  }
  $("preview").replaceChildren(
    ...lines.map((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    }),
  );
}

// 보이는 그림을 모두 고르거나 끈다. 꺼 둔 확장자의 사진은 건드리지 않는다
function toggleAll() {
  const list = items.filter(canToggle);
  const all = list.every((item) => item.checked);
  for (const item of list) {
    item.checked = !all;
    item.touched = true;
  }
  refresh();
}

// 받기를 누를 때 직접 끈 사진의 이름은 기억하고, 빼 둔 이름인데 직접 켠 사진은 잊는다
function learn() {
  let changed = false;
  for (const item of items) {
    if (!item.touched || !item.name) continue;
    if (item.checked) {
      if (rules.delete(item.name)) changed = true;
    } else {
      rules.delete(item.name); // 맨 뒤(최근)로 옮긴다
      rules.add(item.name);
      changed = true;
    }
  }
  if (changed) {
    saveRules();
    renderRules();
  }
}

function forget(names) {
  for (const name of names) rules.delete(name);
  saveRules();
  for (const item of items) if (names.includes(item.name)) choose(item);
  renderRules();
  refresh();
}

// 빼 둔 이름 목록에 적을 글자. 주소 전체로 기억한 것은 끝의 두 마디만 적는다 (전체는 마우스를 올리면 보인다)
const ruleLabel = (name) => (name.startsWith("//") ? `…/${name.split("/").filter(Boolean).slice(-2).join("/")}` : name);

function renderRules() {
  $("rules").hidden = rules.size === 0;
  $("ruleCount").textContent = String(rules.size);
  $("ruleList").replaceChildren(
    ...[...rules].reverse().map((name) => {
      const li = document.createElement("li");
      const text = document.createElement("span");
      text.textContent = ruleLabel(name);
      text.title = name.replace(/^\/\//, "");
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "이 이름 지우기";
      remove.addEventListener("click", () => forget([name]));
      li.append(text, remove);
      return li;
    }),
  );
}

async function start() {
  const urls = items.filter((item) => item.checked).map((item) => item.url);
  if (!urls.length) return;
  const folder = jobFolder();
  if (settings.mode !== "stitch") $("folder").value = folder;
  // 빼 둔 이름(하나씩 끈 사진)은 받기를 누르는 지금 기억한다. 옵션은 고를 때 이미 저장했다
  learn();
  $("start").disabled = true;
  const reply = await chrome.runtime
    .sendMessage({ type: "start", folder, urls, mode: settings.mode, naming: settings.fileNames, stitchName: customStitchName() })
    .catch((err) => ({ error: err.message }));
  if (reply?.error) {
    showMessage(reply.error);
    updateStart();
    return;
  }
  showJob(reply.job);
}

// 이어 붙이지 못하고 뺀 사진을 번호와 까닭으로 알린다. 번호는 고른 순서(사진 따로 받을 때의 파일 이름)다
const WHY = { fetch: "받지 못함", decode: "열지 못하는 형식" };
const MAX_LEFT_OUT = 8;
function leftOut(stitch) {
  const failed = stitch.failed ?? [];
  if (!failed.length) return "";
  const digits = Math.max(3, String(stitch.count + failed.length).length);
  const shown = failed.slice(0, MAX_LEFT_OUT).map(({ n, why }) => `${String(n).padStart(digits, "0")}(${WHY[why] ?? "열지 못함"})`);
  return ` · 붙이지 못하고 뺀 사진 ${failed.length}장: ${shown.join(", ")}${failed.length > shown.length ? " …" : ""}`;
}

function showJob(next) {
  job = next;
  const status = $("status");
  status.replaceChildren();
  const line = (text, warn = "") => {
    const span = document.createElement("span");
    span.append(text);
    if (warn) {
      const em = document.createElement("em");
      em.className = "warn";
      em.textContent = warn;
      span.append(em);
    }
    status.append(span);
  };
  const { files, stitch } = job;
  if (files) {
    if (files.done + files.failed < files.total) line(`사진 받는 중 ${files.done + files.failed}/${files.total}`);
    else {
      const failed = files.failed ? ` · 받지 못한 사진 ${files.failed}장${files.reason ? ` (${files.reason})` : ""}` : "";
      line(`사진 ${files.done}장을 받았습니다 · 다운로드 › ${job.folder} › ${job.dir}`, failed);
    }
  }
  if (stitch) {
    if (stitch.state === "running") {
      if (stitch.phase === "fetch") line(`이어 붙일 사진 받는 중 ${stitch.done}/${stitch.total}`);
      else if (stitch.phase === "draw") line(`이어 붙이는 중 ${stitch.done}/${stitch.total}`);
      else line("이어 붙인 그림 저장하는 중");
    } else if (stitch.state === "done") {
      const size = `${stitch.width.toLocaleString()}×${stitch.height.toLocaleString()}`;
      line(`이어 붙인 그림을 저장했습니다 · 다운로드 › ${job.folder} › ${stitch.name} (${size})`, leftOut(stitch));
    } else {
      line("", `이어 붙이지 못했습니다: ${stitch.error}`);
    }
  }
  const openId = stitch?.id ?? files?.shownId;
  $("openFolder").hidden = job.running || !openId;
  // 사진만 따로 받았으면 사진 세로로 붙이기(웹 페이지)로 이어 갈 수 있게 한다
  $("openStitch").hidden = job.running || !files?.shownId || Boolean(stitch);
  if (!job.running && (files?.canceled || stitch?.canceled)) {
    showMessage(
      "사진마다 저장 위치를 묻는 창이 떴다면 크롬 설정 › 다운로드에서 \"다운로드 전에 각 파일의 저장 위치 확인\"을 끄고 다시 받으세요.",
    );
  }
  updateStart();
}

async function init() {
  $("base").textContent = BASE_FOLDER;
  $("hideDecor").checked = settings.hideDecor;
  $("hideDecor").addEventListener("change", () => {
    settings.hideDecor = $("hideDecor").checked;
    saveSettings();
    refresh();
  });
  // 받는 방식, 사진 이름, 이어 붙인 그림 이름: 고르면 바로 기억한다
  for (const name of ["mode", "fileNames", "stitchName"]) {
    for (const radio of document.querySelectorAll(`input[name=${name}]`)) {
      radio.checked = radio.value === settings[name];
      radio.addEventListener("change", () => {
        settings[name] = radio.value;
        saveSettings();
        showOptions();
        updateStart();
        updatePreview();
        if (name === "stitchName" && radio.value === "custom") $("customName").focus();
      });
    }
  }
  $("customName").value = settings.customName;
  $("customName").addEventListener("input", () => {
    settings.customName = $("customName").value;
    saveSettings();
    updatePreview();
  });
  showOptions();
  $("folder").addEventListener("input", () => {
    folderEdited = true;
    updatePreview();
  });
  $("toggleAll").addEventListener("click", toggleAll);
  $("rescan").addEventListener("click", scan);
  $("clearRules").addEventListener("click", () => forget([...rules]));
  $("start").addEventListener("click", start);
  $("openFolder").addEventListener("click", () => {
    const id = job?.stitch?.id ?? job?.files?.shownId;
    if (id) chrome.downloads.show(id);
  });
  $("openStitch").addEventListener("click", () => chrome.tabs.create({ url: STITCH_URL }));
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "job") showJob(message.job);
  });
  renderRules();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  const reply = await chrome.runtime.sendMessage({ type: "status" }).catch(() => null);
  if (reply?.job) showJob(reply.job);
  await scan();
}

init();
