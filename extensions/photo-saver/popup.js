// 확장 프로그램 버튼을 누르면 뜨는 창. 지금 탭의 사진을 찾아 보여 주고, 고른 사진을 받게 맡긴다(background.js).
// 같은 화면을 크롬 사이드바(사이드 패널)에도 연다 (manifest의 side_panel). 사이드바는 다른 곳을 눌러도 닫히지 않고,
// 탭을 바꾸거나 다른 페이지로 넘어가도 열려 있어서 그때마다 지금 탭의 사진을 다시 찾는다(follow)
import { JPG_QUALITIES, NO_EXT, extKey, findImages, isDecor, loadExts, loadRules, loadSettings, newItem, saveExts, saveRules, saveSettings, typeOf } from "./core.js";
import { SPLIT_LABELS, SPLIT_MODES } from "./imageInfo.js";
import { BASE_FOLDER, cleanFolderName } from "./names.js";
import { applyOpenIn, loadOpenIn, saveOpenIn } from "./opener.js";
import { mountSets } from "./sets.js";

const STITCH_URL = "https://yul456.github.io/playground/stitch/";
// 확장자 체크박스를 놓는 순서
const EXT_ORDER = ["jpg", "png", "gif", "webp", "avif", "bmp", "svg", "ico", "tif", "heic", "heif", "jxl", NO_EXT];
// 한 번에 종류를 물어보는 그림 수
const PROBING = 4;
const START_TEXT = {
  files: (n) => `${n}장 받기`,
  stitch: (n) => `${n}장 이어 붙이기`,
  both: (n) => `${n}장 받고 이어 붙이기`,
};

const $ = (id) => document.getElementById(id);

// 사이드바에 열렸는지. 팝업이면 크롬이 팝업 창 목록(getViews type popup)에 이 창을 넣어 둔다
const inPanel = !(chrome.extension?.getViews?.({ type: "popup" }) ?? [window]).includes(window);

let tabId = null;
let windowId = null;
// 사진 찾기를 시작한 차례. 탭을 빨리 바꾸면 늦게 끝난 앞 탭의 결과를 버린다
let scanRun = 0;
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

const isRuled = (item) => Boolean(item.name) && rules.has(item.name);
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
  const run = ++scanRun;
  if (tabId == null) {
    showMessage("사진을 찾을 탭을 알지 못했습니다.");
    return;
  }
  showMessage("사진을 찾는 중…");
  let page;
  try {
    page = await findImages(tabId);
  } catch (err) {
    if (run !== scanRun) return;
    // 사이드바는 앞 탭의 목록이 남아 있을 수 있어 비운다
    items = [];
    $("grid").replaceChildren();
    $("form").hidden = true;
    $("page").textContent = " ";
    updateStart();
    showBlocked(err);
    return;
  }
  if (run !== scanRun) return;
  pageTitle = page.title;
  pageHost = page.host;

  // 다시 찾을 때는 고른 상태와 잰 크기를 이어 간다
  const previous = new Map(items.map((item) => [item.url, item]));
  items = page.images.map((found) => {
    let item = previous.get(found.url);
    if (!item) {
      item = newItem(found);
      choose(item);
    }
    return item;
  });

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

// 주소에 확장자가 없는 그림(…/avatar/128 등)은 미리보기가 뜬 뒤 받아 본 종류로 확장자를 안다(core.js의 typeOf).
// 한꺼번에 묻지 않고 몇 개씩 차례로 묻는다
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
    saveExts(extOff);
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

// 받는 방식에 맞는 옵션만 보인다 (사진 따로: 폴더와 사진 이름, 이어 붙이기: 그림 이름과 형식).
// 품질과 너무 길 때의 옵션은 JPG일 때만, 나누는 방법은 나눠 받을 때만 고른다
function showOptions() {
  $("filesOptions").hidden = settings.mode === "stitch";
  $("stitchOptions").hidden = settings.mode === "files";
  $("customName").hidden = settings.stitchName !== "custom";
  $("qualityBox").hidden = settings.stitchFormat !== "jpg";
  $("splitRow").hidden = settings.stitchFormat !== "jpg";
  $("splitModeBox").hidden = settings.tooLong !== "split";
}

// 이어 붙인 그림이 JPG 한 장에 담기에 너무 길 때 어떻게 받는지 (미리보기 줄)
const tooLongText = () =>
  settings.stitchFormat !== "jpg" ? "" : settings.tooLong === "split" ? ` (너무 길면 _1.jpg, _2.jpg …로 나눔: ${SPLIT_LABELS[settings.splitMode]})` : " (너무 길면 .png)";

// 받으면 생길 파일을 미리 보여 준다
function updatePreview() {
  const folder = jobFolder();
  const lines = [];
  if (settings.mode !== "stitch") {
    const names = settings.fileNames === "original" ? "원본 이름.jpg …" : "001.jpg, 002.jpg …";
    lines.push(`사진: 다운로드/${BASE_FOLDER}/${folder}/${names}`);
  }
  if (settings.mode !== "files") {
    lines.push(`이어 붙인 그림: 다운로드/${BASE_FOLDER}/${customStitchName() || folder}.${settings.stitchFormat}${tooLongText()}`);
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
    saveRules(rules);
    renderRules();
  }
}

function forget(names) {
  for (const name of names) rules.delete(name);
  saveRules(rules);
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
    .sendMessage({
      type: "start",
      folder,
      urls,
      mode: settings.mode,
      naming: settings.fileNames,
      stitchName: customStitchName(),
      stitchFormat: settings.stitchFormat,
      jpgQuality: settings.jpgQuality,
      tooLong: settings.tooLong,
      splitMode: settings.splitMode,
    })
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
      else if (stitch.phase === "encode") line(stitch.parts > 1 ? `JPG로 만드는 중 (${stitch.part}/${stitch.parts}장)` : "JPG로 만드는 중");
      else line(stitch.parts > 1 ? `이어 붙인 그림 ${stitch.parts}장 저장하는 중` : "이어 붙인 그림 저장하는 중");
    } else if (stitch.state === "done") {
      const size = `${stitch.width.toLocaleString()}×${stitch.height.toLocaleString()}`;
      // JPG를 골랐는데 폭이 너무 넓어(또는 만들다 실패해) PNG로 받았으면 그 까닭을 알린다
      const asPng = stitch.note ? ` · PNG로 받았습니다: ${stitch.note}` : "";
      // JPG 한 장에 담기에 너무 길면 여러 장으로 나눠 받는다
      const split = stitch.parts > 1 ? `${stitch.parts}장으로 나눠(${SPLIT_LABELS[stitch.splitMode] ?? ""}) ` : "";
      line(`이어 붙인 그림을 ${split}저장했습니다 · 다운로드 › ${job.folder} › ${stitch.name} (${size})`, asPng + leftOut(stitch));
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

// 사이드바: 다른 탭을 보거나 지금 탭이 다른 페이지로 넘어가면 그 페이지의 사진을 처음부터 다시 찾는다.
// 고른 상태와 폴더 이름은 페이지마다 새로 한다 ("다시 찾기"는 같은 페이지라 고른 상태를 이어 간다)
function follow(id) {
  tabId = id;
  items = [];
  folderEdited = false;
  scan();
}

// 아이콘을 누르면 팝업과 사이드바 가운데 무엇을 열지. 고르는 즉시 저장하고 바로 맞춘다 (opener.js)
async function mountOpenIn() {
  const value = await loadOpenIn();
  for (const radio of document.querySelectorAll("input[name=openIn]")) {
    radio.checked = radio.value === value;
    radio.addEventListener("change", async () => {
      await saveOpenIn(radio.value);
      await applyOpenIn(radio.value).catch((err) => showMessage("아이콘을 누를 때의 동작을 바꾸지 못했습니다.", err.message));
    });
  }
  // 서비스 워커가 브라우저를 켤 때 맞추지만, 그 전에 열렸을 수도 있어 한 번 더 맞춘다
  applyOpenIn(value).catch(() => {});
}

async function init() {
  if (inPanel) document.documentElement.classList.add("panel");
  $("base").textContent = BASE_FOLDER;
  // 설정 세트를 바꾸거나 지우면 옵션, 꺼 둔 확장자, 빼 둔 이름이 한꺼번에 바뀐다. 창을 다시 읽어 새 값으로 처음부터 그린다
  mountSets($("sets"), () => location.reload());
  $("hideDecor").checked = settings.hideDecor;
  $("hideDecor").addEventListener("change", () => {
    settings.hideDecor = $("hideDecor").checked;
    saveSettings(settings);
    refresh();
  });
  // 받는 방식, 사진 이름, 이어 붙인 그림 이름과 형식, 너무 길 때: 고르면 바로 기억한다
  for (const name of ["mode", "fileNames", "stitchName", "stitchFormat", "tooLong"]) {
    for (const radio of document.querySelectorAll(`input[name=${name}]`)) {
      radio.checked = radio.value === settings[name];
      radio.addEventListener("change", () => {
        settings[name] = radio.value;
        saveSettings(settings);
        showOptions();
        updateStart();
        updatePreview();
        if (name === "stitchName" && radio.value === "custom") $("customName").focus();
      });
    }
  }
  $("jpgQuality").replaceChildren(...JPG_QUALITIES.map((value) => new Option(String(value), String(value))));
  $("jpgQuality").value = String(settings.jpgQuality);
  $("jpgQuality").addEventListener("change", () => {
    settings.jpgQuality = Number($("jpgQuality").value);
    saveSettings(settings);
  });
  $("splitMode").replaceChildren(...SPLIT_MODES.map((mode) => new Option(SPLIT_LABELS[mode], mode)));
  $("splitMode").value = settings.splitMode;
  $("splitMode").addEventListener("change", () => {
    settings.splitMode = $("splitMode").value;
    saveSettings(settings);
    updatePreview();
  });
  $("customName").value = settings.customName;
  $("customName").addEventListener("input", () => {
    settings.customName = $("customName").value;
    saveSettings(settings);
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
  // 열린 탭 받기: 이 창에 열린 탭들을 차례로 받는 화면을 새 탭으로 연다.
  // 이 창은 다른 곳을 누르면 닫혀서, 여러 탭을 받는 긴 일은 맡지 못한다
  $("openBatch").addEventListener("click", async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.create({ url: chrome.runtime.getURL(`batch.html?window=${tab?.windowId ?? ""}`) });
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "job") showJob(message.job);
  });
  // 사이드바로 열기 (팝업에서만). 사이드바는 누른 그때만 열 수 있어서(사용자 동작) 다른 일을 기다리지 않고 바로 연다
  $("openPanel").hidden = inPanel;
  $("openPanel").addEventListener("click", () => {
    chrome.sidePanel.open({ windowId }).then(
      () => window.close(),
      (err) => showMessage("사이드바를 열지 못했습니다. 크롬 116 이상에서 됩니다.", err.message),
    );
  });
  mountOpenIn();
  renderRules();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id ?? null;
  windowId = tab?.windowId ?? null;
  $("openPanel").disabled = windowId == null;
  if (inPanel) {
    chrome.tabs.onActivated.addListener((info) => {
      if (info.windowId === windowId) follow(info.tabId);
    });
    chrome.tabs.onUpdated.addListener((id, change) => {
      if (id === tabId && change.status === "complete") follow(id);
    });
  }
  const reply = await chrome.runtime.sendMessage({ type: "status" }).catch(() => null);
  if (reply?.job) showJob(reply.job);
  await scan();
}

init();
