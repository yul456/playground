// 열린 탭 받기. 이 창에 열려 있는 탭을 하나씩, 그 페이지에서 확장 프로그램 창을 열어 받기를 누른 것과 똑같이 받는다.
// 확장 프로그램 창(popup)은 다른 곳을 누르면 닫혀서, 여러 탭을 받는 긴 일은 따로 연 이 탭이 맡는다.
// 탭마다: 사진 찾기(core.js) → 크기 재기 → 꾸밈 그림·꺼 둔 확장자·빼 둔 이름 빼기 → 받기 맡기기(background.js) → 끝나기를 기다림.
// 주소로 더한 페이지(addresses.js)는 목록에만 넣어 두고, 받을 차례가 되면 그때 탭으로 연다(사용자 결정: 차례가 오면 열기).
// 한꺼번에 열면 PC가 느려지고 사이트에 한꺼번에 접속하게 된다.
// 더한 주소는 확장 프로그램 저장소(queue.js)에 두어 사이드바(링크 고르기·이 페이지 링크)와 오른쪽 클릭 메뉴로도 넣고,
// 이 화면을 닫았다 열어도 남는다. 받기를 마친 주소는 저장소에서 빼고 이 화면에는 결과와 함께 남긴다
import { describeUrls, listUrls, rangeUrls, showUrl } from "./addresses.js";
import { QUEUE_MAX, loadQueue, queueAdd, queueRemove, watchQueue } from "./queue.js";
import { JPG_QUALITIES, extKey, findImages, isDecor, loadExts, loadRules, loadSettings, measure, newItem, saveSettings } from "./core.js";
import { SPLIT_LABELS, SPLIT_MODES } from "./imageInfo.js";
import { BASE_FOLDER, cleanFolderName } from "./names.js";
import { mountSets } from "./sets.js";

// 탭의 페이지가 다 뜨기를 기다리는 시간
const LOAD_TIMEOUT = 30000;
// 다른 받기(확장 프로그램 창에서 누른 것)가 끝나기를 기다리는 시간
const BUSY_TIMEOUT = 5 * 60 * 1000;
// 주소로 더한 페이지를 방금 열었을 때, 다 뜬 뒤에 페이지의 스크립트가 사진을 그릴 틈을 주는 시간
const SETTLE_MS = 1500;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 옵션은 확장 프로그램 창과 같은 저장소의 것을 그대로 쓴다. 꺼 둔 확장자와 빼 둔 이름은 창에서 정한다.
// 이 화면을 열어 둔 채 창에서 옵션을 바꿀 수 있어서, 이 화면을 다시 볼 때와 받기를 시작할 때 다시 읽는다(readOptions)
let settings = loadSettings();
let rules = loadRules();
let extOff = loadExts();
// 이 화면을 연 창. 그 창의 탭만 받는다 (주소 없이 열었으면 이 화면이 있는 창, init에서 정한다)
let windowId = Number(new URLSearchParams(location.search).get("window")) || null;

// 목록의 줄. 탭: { tabId, title, host, checked }, 주소로 더한 것: { added: true, url, tabId(연 뒤에), title, host, checked, done(받기를 마침) }.
// 둘 다 cell: { li, box, name, state, remove }, 결과 글 stateText·stateKind(다시 그려도 남게)
let rows = [];
let running = false;
let stopping = false;
let lastDownload = null; // "폴더 열기"가 보여 줄 다운로드
let setsUi = null; // 설정 세트 고르는 줄 (sets.js)

function showMessage(text) {
  $("message").textContent = text;
  $("message").hidden = !text;
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

const windowTabs = () => chrome.tabs.query(windowId ? { windowId } : { currentWindow: true });
// 탭의 주소. 막 열어서 아직 주소로 옮겨 가는 중인 탭은 url이 비어 있고 pendingUrl에 있다
const urlOf = (tab) => tab.pendingUrl || tab.url || "";

function showEmpty() {
  showMessage(rows.length ? "" : "받을 탭이 없습니다. 받을 페이지를 탭으로 열어 두고 \"탭 다시 읽기\"를 누르거나, 위의 \"주소로 더하기\"로 주소를 넣으세요.");
}

// 이 창에 열린 탭 가운데 웹 페이지(http·https)만 읽는다. 이 화면 같은 확장 프로그램 페이지와 크롬 설정 페이지는 빠진다.
// 주소로 더한 줄은 결과와 함께 그대로 두고 뒤에 놓는다. 그 주소로 연 탭은 그 줄이 맡으므로 탭 줄로 따로 넣지 않는다
// 저절로 다시 읽을 때도 체크와 결과 글은 그대로 두고 제목과 주소만 새로 한다(같은 줄을 다시 쓴다)
async function readTabs() {
  const tabs = await windowTabs();
  const before = new Map(rows.filter((row) => !row.added).map((row) => [row.tabId, row]));
  const added = rows.filter((row) => row.added);
  const owned = new Set(added.map((row) => row.tabId).filter((id) => id != null));
  rows = [
    ...tabs
      .filter((tab) => /^https?:/i.test(urlOf(tab)) && !owned.has(tab.id))
      .map((tab) => {
        const row = before.get(tab.id) ?? { tabId: tab.id, checked: true };
        row.title = tab.title || urlOf(tab);
        row.host = hostOf(urlOf(tab));
        row.loading = tab.status !== "complete";
        row.cell = null;
        return row;
      }),
    ...added,
  ];
  $("tabs").replaceChildren(...rows.map(makeRow));
  showEmpty();
  refresh();
}

function makeRow(row) {
  const li = document.createElement("li");
  const label = document.createElement("label");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.addEventListener("change", () => {
    row.checked = box.checked;
    refresh();
  });
  const title = document.createElement("span");
  title.className = "title";
  title.textContent = row.title;
  title.title = row.added ? showUrl(row.url) : row.title;
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = row.host;
  const state = document.createElement("span");
  state.className = "state";
  label.append(box, title, host);
  li.append(label, state);
  // 주소로 더한 줄은 목록에서 뺄 수 있다
  let remove = null;
  if (row.added) {
    remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "목록에서 빼기";
    remove.addEventListener("click", () => removeRows([row]));
    li.append(remove);
  }
  row.cell = { li, box, name: title, state, remove };
  if (row.stateText != null) setState(row, row.stateText, row.stateKind);
  else if (row.loading) state.textContent = "페이지 뜨는 중";
  return li;
}

function setState(row, text, kind = "") {
  row.stateText = text;
  row.stateKind = kind;
  row.cell.state.textContent = text;
  row.cell.state.className = kind ? `state ${kind}` : "state";
}

// 줄을 목록에서 뺀다. 아직 받지 않은 더한 주소는 저장소에서도 뺀다
function removeRows(list) {
  rows = rows.filter((row) => !list.includes(row));
  for (const row of list) row.cell?.li.remove();
  const urls = list.filter((row) => row.added && !row.done).map((row) => row.url);
  if (urls.length) queueRemove(urls).catch(() => {});
  showEmpty();
  refresh();
}

function newAddedRow(page) {
  let title = page.title;
  try {
    const parsed = new URL(page.url);
    title ||= showUrl(parsed.pathname + parsed.search);
  } catch {
    // 주소가 이상하면 주소 그대로
  }
  return { added: true, url: page.url, tabId: null, title: title || page.url, host: hostOf(page.url), checked: true, cell: null };
}

// 저장소의 목록에 맞춘다. 다른 곳(사이드바, 오른쪽 클릭 메뉴)에서 넣은 주소는 끝에 더하고, 뺀 주소는 지운다.
// 받기를 마친 줄은 저장소에서 빠져도 결과와 함께 남기고, 그 주소를 다시 넣으면 받기 전으로 되돌린다.
// 받는 중에는 더하기만 하고 지우기는 받기가 끝난 뒤에 한다 (받는 줄이 사라지지 않게)
function syncQueue(pages) {
  const urls = new Set(pages.map((page) => page.url));
  if (!running) {
    const gone = rows.filter((row) => row.added && !row.done && !urls.has(row.url));
    if (gone.length) {
      rows = rows.filter((row) => !gone.includes(row));
      for (const row of gone) row.cell?.li.remove();
    }
  }
  const byUrl = new Map(rows.filter((row) => row.added).map((row) => [row.url, row]));
  for (const page of pages) {
    const row = byUrl.get(page.url);
    if (!row) {
      const created = newAddedRow(page);
      rows.push(created);
      $("tabs").append(makeRow(created));
      setState(created, "열기 전");
    } else if (row.done && !running) {
      row.done = false;
      row.checked = true;
      row.tabId = null;
      setState(row, "열기 전");
    }
  }
  showEmpty();
  refresh();
}

function refresh() {
  const chosen = rows.filter((row) => row.checked).length;
  for (const row of rows) {
    row.cell.box.checked = row.checked;
    row.cell.box.disabled = running;
    row.cell.li.classList.toggle("off", !row.checked);
    if (row.cell.remove) row.cell.remove.disabled = running;
  }
  const added = rows.filter((row) => row.added).length;
  $("count").textContent = `${chosen}개 고름 · 탭 ${rows.length - added}개${added ? ` · 더한 주소 ${added}개` : ""}`;
  $("clearAdded").hidden = !added;
  $("clearAdded").disabled = running;
  updateAddButtons();
  $("toggleAll").textContent = rows.length && chosen === rows.length ? "모두 끄기" : "모두 고르기";
  $("toggleAll").disabled = running;
  $("reload").disabled = running;
  $("start").disabled = running || !chosen;
  $("start").textContent = chosen ? `${chosen}개 탭 받기` : "받기";
  $("start").hidden = running;
  $("stop").hidden = !running;
  $("stop").disabled = stopping;
  $("stop").textContent = stopping ? "지금 탭까지 받고 멈춥니다" : "멈추기";
  setsUi?.setDisabled(running);
  for (const input of document.querySelectorAll("input[name=mode], input[name=fileNames], input[name=stitchFormat], input[name=tooLong], #jpgQuality, #splitMode, #closeTabs")) {
    input.disabled = running;
  }
}

// 저장될 자리와, 받지 않는 것을 알려 준다
function showOptions() {
  $("fileNamesRow").hidden = settings.mode === "stitch";
  $("stitchFormatRow").hidden = settings.mode === "files";
  $("qualityBox").hidden = settings.stitchFormat !== "jpg";
  // 너무 길 때의 옵션은 이어 붙인 그림을 JPG로 받을 때만, 나누는 방법은 나눠 받을 때만 고른다
  $("splitRow").hidden = settings.mode === "files" || settings.stitchFormat !== "jpg";
  $("splitModeBox").hidden = settings.tooLong !== "split";
  const lines = [];
  if (settings.mode !== "stitch") {
    const names = settings.fileNames === "original" ? "원본 이름.jpg …" : "001.jpg, 002.jpg …";
    lines.push(`사진: 다운로드/${BASE_FOLDER}/탭의 페이지 제목/${names}`);
  }
  if (settings.mode !== "files") {
    let tooLong = "";
    if (settings.stitchFormat === "jpg") {
      tooLong = settings.tooLong === "split" ? ` (너무 길면 _1.jpg, _2.jpg …로 나눔: ${SPLIT_LABELS[settings.splitMode]})` : " (너무 길면 .png)";
    }
    lines.push(`이어 붙인 그림: 다운로드/${BASE_FOLDER}/탭의 페이지 제목.${settings.stitchFormat}${tooLong}`);
  }
  $("preview").replaceChildren(
    ...lines.map((text) => {
      const span = document.createElement("span");
      span.textContent = text;
      return span;
    }),
  );
  const filters = ["꾸밈 그림(작은 그림, SVG, 배경 그림, 미리보기가 안 뜨는 것)은 받지 않습니다."];
  if (extOff.size) filters.push(`꺼 둔 확장자: ${[...extOff].map((ext) => (ext === "?" ? "기타" : ext)).join(", ")}.`);
  if (rules.size) filters.push(`빼 둔 이름 ${rules.size}개.`);
  if (extOff.size || rules.size) filters.push("확장자와 빼 둔 이름은 확장 프로그램 창에서 바꿉니다.");
  // 직접 입력한 이름은 탭마다 같은 이름이 되어 쓸모가 없다. 여러 탭을 받을 때는 늘 페이지 제목을 쓴다
  if (settings.mode !== "files" && settings.stitchName === "custom") {
    filters.push("이어 붙인 그림 이름은 직접 입력한 이름 대신 탭마다 페이지 제목을 씁니다.");
  }
  $("filters").textContent = filters.join(" ");
}

// 저장해 둔 옵션을 다시 읽어 화면에 맞춘다. 받는 중에는 바꾸지 않는다 (탭마다 기준이 달라지지 않게)
function readOptions() {
  if (running) return;
  settings = loadSettings();
  rules = loadRules();
  extOff = loadExts();
  for (const name of ["mode", "fileNames", "stitchFormat", "tooLong"]) {
    for (const radio of document.querySelectorAll(`input[name=${name}]`)) radio.checked = radio.value === settings[name];
  }
  $("jpgQuality").value = String(settings.jpgQuality);
  $("splitMode").value = settings.splitMode;
  $("closeTabs").checked = settings.closeTabs;
  setsUi?.refresh(); // 확장 프로그램 창에서 세트를 바꾸거나 만들었을 수 있다
  showOptions();
}

// 받을 사진인가: 확장 프로그램 창에서 처음에 체크되어 나오는 것과 같다
const wanted = (item) => !isDecor(item) && !(item.name && rules.has(item.name)) && !extOff.has(extKey(item));

// 탭의 페이지가 다 뜨기를 기다린다. 크롬이 쉬게 해 둔 탭(오래 안 본 탭, 다시 연 창의 탭)은 먼저 깨운다
async function ensureLoaded(tabId) {
  let tab = await chrome.tabs.get(tabId);
  if (tab.discarded) await chrome.tabs.reload(tabId);
  const deadline = Date.now() + LOAD_TIMEOUT;
  for (;;) {
    tab = await chrome.tabs.get(tabId);
    // 막 연 탭은 주소로 옮겨 가는 동안 pendingUrl이 있다
    if (tab.status === "complete" && !tab.discarded && !tab.pendingUrl) return;
    if (Date.now() > deadline) return; // 다 뜨지 않았어도 지금 있는 것으로 해 본다
    await sleep(200);
  }
}

const send = (message) => chrome.runtime.sendMessage(message).catch((err) => ({ error: err.message }));

// 받기를 맡긴다. 다른 받기가 돌고 있으면 끝나기를 기다렸다가 맡긴다
async function startJob(message) {
  const deadline = Date.now() + BUSY_TIMEOUT;
  for (;;) {
    const status = await send({ type: "status" });
    if (!status?.job?.running) {
      const reply = await send(message);
      if (reply?.job) return reply.job;
      if (!/받는 중/.test(reply?.error ?? "")) throw new Error(reply?.error || "받기를 시작하지 못했습니다");
    }
    if (Date.now() > deadline) throw new Error("앞의 받기가 끝나지 않았습니다");
    await sleep(500);
  }
}

// 맡긴 받기가 끝나기를 기다린다. background.js가 보내는 소식을 듣고, 놓쳤을 때를 생각해 가끔 물어도 본다
function waitJob(id, onUpdate) {
  return new Promise((resolve) => {
    let timer = null;
    const finish = (job) => {
      chrome.runtime.onMessage.removeListener(onMessage);
      clearInterval(timer);
      resolve(job);
    };
    const see = (job) => {
      if (!job || job.id !== id) return;
      onUpdate(job);
      if (!job.running) finish(job);
    };
    const onMessage = (message) => {
      if (message?.type === "job") see(message.job);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    timer = setInterval(async () => see((await send({ type: "status" }))?.job), 1000);
  });
}

function progressText(job) {
  const { files, stitch } = job;
  if (files && files.done + files.failed < files.total) return `사진 받는 중 ${files.done + files.failed}/${files.total}`;
  if (stitch?.state === "running") {
    if (stitch.phase === "fetch") return `이어 붙일 사진 받는 중 ${stitch.done}/${stitch.total}`;
    if (stitch.phase === "draw") return `이어 붙이는 중 ${stitch.done}/${stitch.total}`;
    if (stitch.phase === "encode") return stitch.parts > 1 ? `JPG로 만드는 중 (${stitch.part}/${stitch.parts}장)` : "JPG로 만드는 중";
    return stitch.parts > 1 ? `이어 붙인 그림 ${stitch.parts}장 저장하는 중` : "이어 붙인 그림 저장하는 중";
  }
  return "마무리하는 중";
}

// 탭 하나의 결과. { text, kind(ok·warn), got(받은 것이 있나) }
function resultOf(job) {
  const { files, stitch } = job;
  const parts = [];
  let warn = false;
  let got = false;
  if (files) {
    parts.push(`사진 ${files.done}장`);
    if (files.done) got = true;
    if (files.failed) {
      parts.push(`받지 못한 사진 ${files.failed}장${files.reason ? ` (${files.reason})` : ""}`);
      warn = true;
    }
  }
  if (stitch) {
    if (stitch.state === "done") {
      parts.push(`이어 붙임 ${stitch.width.toLocaleString()}×${stitch.height.toLocaleString()}`);
      // JPG 한 장에 담기에 너무 길어 여러 장으로 나눠 받은 탭
      if (stitch.parts > 1) parts.push(`${stitch.parts}장으로 나눔(${SPLIT_LABELS[stitch.splitMode] ?? ""})`);
      // JPG를 골랐는데 폭이 너무 넓어(또는 만들다 실패해) PNG로 받은 탭
      if (stitch.note) parts.push("JPG로 만들 수 없어 PNG로 받음");
      got = true;
      if (stitch.failed?.length) {
        parts.push(`붙이지 못한 사진 ${stitch.failed.length}장`);
        warn = true;
      }
    } else {
      parts.push(`이어 붙이지 못함: ${stitch.error}`);
      warn = true;
    }
  }
  return { text: parts.join(" · "), kind: warn ? "warn" : "ok", got };
}

// 주소로 더한 줄의 페이지를 탭으로 연다(이 창, 뒤쪽에). 전에 열어 둔 탭이 아직 있으면 그 탭을 쓴다
async function openAdded(row) {
  if (row.tabId != null && (await chrome.tabs.get(row.tabId).catch(() => null))) return;
  setState(row, "페이지 여는 중", "now");
  const tab = await chrome.tabs.create({ ...(windowId ? { windowId } : {}), url: row.url, active: false });
  row.tabId = tab.id;
  await ensureLoaded(row.tabId);
  await sleep(SETTLE_MS);
}

// 탭 하나를 받는다. 받은 것이 있으면 "got", 받을 사진이 없으면 "none", 못 받았으면 "failed"
async function runTab(row) {
  try {
    if (row.added) await openAdded(row);
    setState(row, "사진 찾는 중", "now");
    await ensureLoaded(row.tabId);
    const page = await findImages(row.tabId);
    // 주소로 더한 줄은 연 페이지의 제목을 보인다
    if (row.added && page.title) {
      row.title = page.title;
      row.cell.name.textContent = page.title;
    }
    const items = page.images.map(newItem);
    setState(row, `사진 ${items.length}장 살펴보는 중`, "now");
    await Promise.all(items.map((item) => measure(item)));
    const urls = items.filter(wanted).map((item) => item.url);
    if (!urls.length) {
      setState(row, "받을 사진 없음");
      return "none";
    }
    const job = await startJob({
      type: "start",
      folder: cleanFolderName(page.title, page.host || "사진"),
      urls,
      mode: settings.mode,
      naming: settings.fileNames,
      stitchName: "",
      stitchFormat: settings.stitchFormat,
      jpgQuality: settings.jpgQuality,
      tooLong: settings.tooLong,
      splitMode: settings.splitMode,
    });
    setState(row, progressText(job), "now");
    const done = await waitJob(job.id, (now) => setState(row, progressText(now), "now"));
    const result = resultOf(done);
    setState(row, result.text, result.kind);
    lastDownload = done.stitch?.id ?? done.files?.shownId ?? lastDownload;
    if (!result.got) return "failed";
    if (settings.closeTabs) await chrome.tabs.remove(row.tabId).catch(() => {});
    return "got";
  } catch (err) {
    const text = String(err?.message ?? err);
    // 크롬 설정·웹 스토어처럼 크롬이 확장 프로그램을 막는 페이지, 그사이 닫힌 탭, 열지 못한 주소(크롬의 오류 페이지)
    let message = `받지 못함: ${text}`;
    if (/No tab with id/i.test(text)) message = "탭이 닫혔습니다";
    else if (/error page/i.test(text)) message = "페이지를 열지 못했습니다";
    setState(row, message, "warn");
    return "failed";
  }
}

// 주소로 더하기 ---------------------------------------------------------------

const rangeInput = () => ({ prefix: $("rangePrefix").value, from: $("rangeFrom").value, to: $("rangeTo").value, suffix: $("rangeSuffix").value });
// 넣을 수 있는 주소가 있는지 (더하기 단추를 켤지)
let rangeReady = false;
let listReady = false;

function note(id, text, warn = false) {
  $(id).textContent = text;
  $(id).classList.toggle("warn", warn);
}

function updateAddButtons() {
  $("addRange").disabled = running || !rangeReady;
  $("addList").disabled = running || !listReady;
}

// 번호로 만들 주소를 미리 보인다: 첫 주소 ~ 끝 주소 (n개)
function previewRange() {
  const input = rangeInput();
  const result = rangeUrls(input);
  const empty = !input.prefix.trim() && !input.from.trim() && !input.to.trim();
  rangeReady = !result.error;
  note("rangeNote", empty ? "" : (result.error ?? describeUrls(result.urls)), Boolean(result.error) && !empty);
  updateAddButtons();
}

function previewList() {
  const text = $("urlList").value;
  const result = listUrls(text);
  listReady = !result.error && result.urls.length > 0;
  let message = result.error ?? (result.urls.length ? `주소 ${result.urls.length}개` : "");
  if (!result.error && result.invalid) message += `${message ? " · " : ""}주소가 아닌 것 ${result.invalid}개는 뺍니다`;
  note("listNote", text.trim() ? message : "", Boolean(result.error) || (!result.urls.length && Boolean(result.invalid)));
  updateAddButtons();
}

// 주소들을 목록 끝에 더한다 (저장소에 넣는다). 이미 목록에 있는 주소(더한 주소, 이 창에 열린 탭)는 뺀다
async function addUrls(urls) {
  const open = new Set((await windowTabs()).map(urlOf));
  const fresh = urls.filter((url) => !open.has(url));
  const reply = fresh.length ? await queueAdd(fresh.map((url) => ({ url }))) : { added: 0, skipped: 0, full: 0 };
  if (reply?.error) return `넣지 못했습니다: ${reply.error}`;
  if (reply.pages) syncQueue(reply.pages);
  const skipped = urls.length - fresh.length + reply.skipped;
  if (!reply.added) return reply.full ? `목록이 가득 찼습니다 (${QUEUE_MAX}개)` : "모두 이미 목록에 있는 주소입니다";
  let text = `${reply.added}개를 목록에 더했습니다`;
  if (skipped) text += ` · 이미 목록에 있는 주소 ${skipped}개는 뺐습니다`;
  if (reply.full) text += ` · 목록이 가득 차 ${reply.full}개는 넣지 못했습니다`;
  return text;
}

async function addRange() {
  const result = rangeUrls(rangeInput());
  if (result.error || running) return;
  rangeReady = false;
  updateAddButtons();
  const message = await addUrls(result.urls);
  // 앞부분과 뒷부분은 남겨 두어 다른 번호를 이어서 넣기 쉽게 한다
  $("rangeFrom").value = "";
  $("rangeTo").value = "";
  note("rangeNote", message);
}

async function addList() {
  const result = listUrls($("urlList").value);
  if (result.error || !result.urls.length || running) return;
  listReady = false;
  updateAddButtons();
  const message = await addUrls(result.urls);
  $("urlList").value = "";
  note("listNote", message);
}

async function runAll() {
  const list = rows.filter((row) => row.checked);
  if (!list.length || running) return;
  readOptions();
  running = true;
  stopping = false;
  lastDownload = null;
  $("openFolder").hidden = true;
  for (const row of list) setState(row, "기다리는 중");
  refresh();
  const count = { got: 0, none: 0, failed: 0 };
  let handled = 0;
  for (const row of list) {
    if (stopping) break;
    $("status").textContent = `${handled + 1}/${list.length}번째 탭을 받는 중`;
    const result = await runTab(row);
    count[result]++;
    handled++;
    // 주소로 더한 줄은 끝나면 체크를 끄고 저장소의 목록에서 뺀다(결과와 함께 이 화면에는 남는다).
    // 받지 못한 것만 체크된 채 목록에 남아, 다시 받기를 누르면 그것만 다시 해 본다
    if (row.added && result !== "failed") {
      row.checked = false;
      row.done = true;
      queueRemove([row.url]).catch(() => {});
    }
  }
  for (const row of list.slice(handled)) setState(row, "받지 않음");
  running = false;
  const parts = [`${count.got}개 탭을 받았습니다`];
  if (count.none) parts.push(`받을 사진이 없던 탭 ${count.none}개`);
  if (count.failed) parts.push(`받지 못한 탭 ${count.failed}개`);
  if (handled < list.length) parts.push(`멈춰서 받지 않은 탭 ${list.length - handled}개`);
  $("status").textContent = parts.join(" · ");
  $("openFolder").hidden = lastDownload == null;
  stopping = false;
  // 받는 동안 다른 곳에서 넣고 뺀 주소와 열고 닫은 탭을 목록에 맞춘다 (결과 글은 남는다)
  syncQueue(await loadQueue());
  await readTabs();
}

// 이 창의 탭이 바뀌면(새 탭, 닫힘, 다른 주소로 감, 제목·로딩 상태가 바뀜) 목록을 다시 읽는다. 받는 중에는 받기가 끝난 뒤에 읽는다.
// 전에는 이 화면을 열 때 한 번만 읽어서, 그 뒤에 연 탭이나 그때 아직 주소로 넘어가는 중이던 탭이
// "탭 다시 읽기"를 누르기 전에는 목록에 없었다 (2026-11-13 사용자 제보)
let rereadTimer = null;
function scheduleReread() {
  if (running) return; // 받기가 끝나면 runAll이 다시 읽는다
  clearTimeout(rereadTimer);
  rereadTimer = setTimeout(readTabs, 300);
}

function watchTabs() {
  const mine = (id) => id === windowId;
  chrome.tabs.onCreated.addListener((tab) => mine(tab.windowId) && scheduleReread());
  chrome.tabs.onRemoved.addListener((_, info) => mine(info.windowId) && scheduleReread());
  chrome.tabs.onUpdated.addListener((_, change, tab) => {
    if (mine(tab.windowId) && (change.url || change.title || change.status)) scheduleReread();
  });
  for (const event of [chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabs.onMoved]) event.addListener(scheduleReread);
}

async function init() {
  windowId ??= (await chrome.windows.getCurrent()).id;
  watchTabs();
  // 설정 세트를 바꾸거나 지우면 옵션을 다시 읽는다
  setsUi = mountSets($("sets"), readOptions);
  // 옵션은 고르는 즉시 저장한다 (확장 프로그램 창과 같은 저장소)
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
    showOptions();
  });
  for (const name of ["mode", "fileNames", "stitchFormat", "tooLong"]) {
    for (const radio of document.querySelectorAll(`input[name=${name}]`)) {
      radio.checked = radio.value === settings[name];
      radio.addEventListener("change", () => {
        settings[name] = radio.value;
        saveSettings(settings);
        showOptions();
      });
    }
  }
  $("closeTabs").checked = settings.closeTabs;
  $("closeTabs").addEventListener("change", () => {
    settings.closeTabs = $("closeTabs").checked;
    saveSettings(settings);
  });
  $("toggleAll").addEventListener("click", () => {
    const all = rows.every((row) => row.checked);
    for (const row of rows) row.checked = !all;
    refresh();
  });
  $("reload").addEventListener("click", readTabs);
  $("clearAdded").addEventListener("click", () => removeRows(rows.filter((row) => row.added)));
  for (const id of ["rangePrefix", "rangeFrom", "rangeTo", "rangeSuffix"]) {
    $(id).addEventListener("input", previewRange);
    $(id).addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !$("addRange").disabled) addRange();
    });
  }
  $("urlList").addEventListener("input", previewList);
  $("addRange").addEventListener("click", addRange);
  $("addList").addEventListener("click", addList);
  $("start").addEventListener("click", runAll);
  $("stop").addEventListener("click", () => {
    stopping = true;
    refresh();
  });
  $("openFolder").addEventListener("click", () => {
    if (lastDownload != null) chrome.downloads.show(lastDownload);
  });
  // 받는 중에 이 탭을 닫으면 남은 탭을 받지 못한다
  window.addEventListener("beforeunload", (event) => {
    if (running) event.preventDefault();
  });
  // 다른 탭에서 확장 프로그램 창으로 옵션을 바꾸고 돌아오면 그 값을 보여 준다
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) readOptions();
  });
  window.addEventListener("focus", readOptions);
  showOptions();
  // 더한 주소는 저장소에 있다. 다른 곳(사이드바, 오른쪽 클릭 메뉴)에서 넣거나 빼면 바로 맞춘다
  watchQueue(syncQueue);
  await readTabs();
  syncQueue(await loadQueue());
}

init();
