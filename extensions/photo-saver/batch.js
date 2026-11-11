// 열린 탭 받기. 이 창에 열려 있는 탭을 하나씩, 그 페이지에서 확장 프로그램 창을 열어 받기를 누른 것과 똑같이 받는다.
// 확장 프로그램 창(popup)은 다른 곳을 누르면 닫혀서, 여러 탭을 받는 긴 일은 따로 연 이 탭이 맡는다.
// 탭마다: 사진 찾기(core.js) → 크기 재기 → 꾸밈 그림·꺼 둔 확장자·빼 둔 이름 빼기 → 받기 맡기기(background.js) → 끝나기를 기다림
import { extKey, findImages, isDecor, loadExts, loadRules, loadSettings, measure, newItem, saveSettings } from "./core.js";
import { BASE_FOLDER, cleanFolderName } from "./names.js";
import { mountSets } from "./sets.js";

// 탭의 페이지가 다 뜨기를 기다리는 시간
const LOAD_TIMEOUT = 30000;
// 다른 받기(확장 프로그램 창에서 누른 것)가 끝나기를 기다리는 시간
const BUSY_TIMEOUT = 5 * 60 * 1000;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 옵션은 확장 프로그램 창과 같은 저장소의 것을 그대로 쓴다. 꺼 둔 확장자와 빼 둔 이름은 창에서 정한다.
// 이 화면을 열어 둔 채 창에서 옵션을 바꿀 수 있어서, 이 화면을 다시 볼 때와 받기를 시작할 때 다시 읽는다(readOptions)
let settings = loadSettings();
let rules = loadRules();
let extOff = loadExts();
// 이 화면을 연 창. 그 창의 탭만 받는다
const windowId = Number(new URLSearchParams(location.search).get("window")) || null;

let rows = []; // { tabId, title, host, checked, cell: { li, box, state } }
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

// 이 창에 열린 탭 가운데 웹 페이지(http·https)만 읽는다. 이 화면 같은 확장 프로그램 페이지와 크롬 설정 페이지는 빠진다
async function readTabs() {
  const tabs = await chrome.tabs.query(windowId ? { windowId } : { currentWindow: true });
  const before = new Map(rows.map((row) => [row.tabId, row]));
  rows = tabs
    .filter((tab) => /^https?:/i.test(tab.url ?? ""))
    .map((tab) => ({
      tabId: tab.id,
      title: tab.title || tab.url,
      host: hostOf(tab.url),
      checked: before.get(tab.id)?.checked ?? true,
      cell: null,
    }));
  $("tabs").replaceChildren(...rows.map(makeRow));
  showMessage(rows.length ? "" : "이 창에 받을 수 있는 탭이 없습니다. 받을 페이지를 탭으로 열어 둔 뒤 \"탭 다시 읽기\"를 누르세요.");
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
  title.title = row.title;
  const host = document.createElement("span");
  host.className = "host";
  host.textContent = row.host;
  const state = document.createElement("span");
  state.className = "state";
  label.append(box, title, host);
  li.append(label, state);
  row.cell = { li, box, state };
  return li;
}

function setState(row, text, kind = "") {
  row.cell.state.textContent = text;
  row.cell.state.className = kind ? `state ${kind}` : "state";
}

function refresh() {
  const chosen = rows.filter((row) => row.checked).length;
  for (const row of rows) {
    row.cell.box.checked = row.checked;
    row.cell.box.disabled = running;
    row.cell.li.classList.toggle("off", !row.checked);
  }
  $("count").textContent = `${chosen}개 고름 · 탭 ${rows.length}개`;
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
  for (const input of document.querySelectorAll("input[name=mode], input[name=fileNames], #closeTabs")) input.disabled = running;
}

// 저장될 자리와, 받지 않는 것을 알려 준다
function showOptions() {
  $("fileNamesRow").hidden = settings.mode === "stitch";
  const lines = [];
  if (settings.mode !== "stitch") {
    const names = settings.fileNames === "original" ? "원본 이름.jpg …" : "001.jpg, 002.jpg …";
    lines.push(`사진: 다운로드/${BASE_FOLDER}/탭의 페이지 제목/${names}`);
  }
  if (settings.mode !== "files") lines.push(`이어 붙인 그림: 다운로드/${BASE_FOLDER}/탭의 페이지 제목.png`);
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
  for (const name of ["mode", "fileNames"]) {
    for (const radio of document.querySelectorAll(`input[name=${name}]`)) radio.checked = radio.value === settings[name];
  }
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
    if (tab.status === "complete" && !tab.discarded) return;
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
    return "이어 붙인 그림 저장하는 중";
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

// 탭 하나를 받는다. 받은 것이 있으면 "got", 받을 사진이 없으면 "none", 못 받았으면 "failed"
async function runTab(row) {
  setState(row, "사진 찾는 중", "now");
  try {
    await ensureLoaded(row.tabId);
    const page = await findImages(row.tabId);
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
    // 크롬 설정·웹 스토어처럼 크롬이 확장 프로그램을 막는 페이지, 그사이 닫힌 탭
    setState(row, /No tab with id/i.test(text) ? "탭이 닫혔습니다" : `받지 못함: ${text}`, "warn");
    return "failed";
  }
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
    count[await runTab(row)]++;
    handled++;
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
  if (settings.closeTabs) await readTabs();
  else refresh();
}

function init() {
  // 설정 세트를 바꾸거나 지우면 옵션을 다시 읽는다
  setsUi = mountSets($("sets"), readOptions);
  // 옵션은 고르는 즉시 저장한다 (확장 프로그램 창과 같은 저장소)
  for (const name of ["mode", "fileNames"]) {
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
  readTabs();
}

init();
