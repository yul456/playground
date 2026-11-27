// 사진 받기를 맡아 하는 서비스 워커. 팝업이 닫혀도 받기가 이어지도록 여기서 한다.
// - 사진 따로 받기: chrome.downloads로 받는다. 파일 이름은 고른 순서 번호(001, 002…)이고,
//   확장자는 받아 보고 안 그림 종류(MIME)로 정한다
// - 세로로 이어 붙이기: 보이지 않는 문서(offscreen.js)가 사진을 받아 그림을 만들고,
//   그 Blob 주소를 넘겨받아 여기서 받는다 (서비스 워커는 Blob 주소를 만들지 못한다).
//   JPG 한 장에 담기에 너무 길면 여러 장으로 나뉘어 와서 "제목_1.jpg", "제목_2.jpg" …로 받는다
import { parseUrl } from "./addresses.js";
import { linkTextOf, showToast } from "./collect.js";
import { HIDE_KEY, HIDE_SITE_MAX, HIDE_SITES_MAX, loadHideRules, rulesOf, syncHideScripts, validRule, validSite } from "./hide-sites.js";
import { BASE_FOLDER, extFromMime, extFromName, extFromUrl, originalBase, videoBase, videoExtFromMime, videoExtFromName, videoExtFromUrl, videoMime } from "./names.js";
import { OPEN_IN, applyOpenIn, loadOpenIn, saveOpenIn } from "./opener.js";
import { QUEUE_KEY, QUEUE_MAX } from "./queue.js";
import { PLAIN_KEY, SEARCH_KEY, cleanSelection, loadMarks, loadSearchList, searchUrl } from "./search-words.js";
import { URL_KEY, fillTemplate, loadTemplates, templateLabel } from "./url-templates.js";
import { UNLOCK_CSS, UNLOCK_KEY, syncUnlockScripts } from "./unlock-sites.js";

// 아이콘을 누르면 팝업과 사이드바 가운데 무엇을 열지 다시 맞춘다 (브라우저를 켤 때, 확장 프로그램을 설치하거나 새로 고칠 때).
// 크롬이 이 설정을 기억하는지 문서에 없어서 그때마다 맞춘다
const restoreOpenIn = () => loadOpenIn().then(applyOpenIn).catch(() => {});
chrome.runtime.onStartup.addListener(restoreOpenIn);
chrome.runtime.onInstalled.addListener(restoreOpenIn);

// 오른쪽 클릭을 늘 풀 사이트의 콘텐츠 스크립트를 목록대로 다시 등록한다 (브라우저를 켤 때, 설치하거나 새로 고칠 때, 목록이 바뀔 때).
// 등록한 것은 크롬이 기억하지만, 업데이트할 때 지워지는지 문서마다 말이 달라 그때마다 맞춘다. 겹쳐 돌지 않게 차례로 한다
let unlockSync = Promise.resolve();
const resyncUnlock = () => (unlockSync = unlockSync.then(syncUnlockScripts).catch(() => {}));
chrome.runtime.onStartup.addListener(resyncUnlock);
chrome.runtime.onInstalled.addListener(resyncUnlock);
// 늘 숨기는 곳이 있는 사이트에 hide-core.js를 등록하는 것도 같은 때 맞춘다 (hide-sites.js)
let hideSync = Promise.resolve();
const resyncHide = () => (hideSync = hideSync.then(syncHideScripts).catch(() => {}));
chrome.runtime.onStartup.addListener(resyncHide);
chrome.runtime.onInstalled.addListener(resyncHide);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[UNLOCK_KEY]) resyncUnlock();
  if (area === "local" && changes[HIDE_KEY]) resyncHide();
});

// 한 번에 시작을 기다리는 다운로드 수. 시작만 기다리고 끝나기는 기다리지 않아서 실제로는 여러 장을 함께 받는다
const STARTING = 4;
const OFFSCREEN = "offscreen.html";
// 받지 못한 까닭(크롬 다운로드 오류)을 사람 말로
const REASONS = {
  NOT_IMAGE: "그림이 아님",
  NOT_VIDEO: "영상이 아님",
  SERVER_FORBIDDEN: "사이트가 막음",
  SERVER_UNAUTHORIZED: "로그인 필요",
  SERVER_BAD_CONTENT: "주소에 그림이 없음",
  SERVER_FAILED: "사이트 오류",
  SERVER_NO_RANGE: "사이트 오류",
  NETWORK_FAILED: "연결 실패",
  NETWORK_TIMEOUT: "연결 시간 초과",
  NETWORK_DISCONNECTED: "연결 끊김",
  NETWORK_INVALID_REQUEST: "받을 수 없는 주소",
  FILE_FAILED: "저장 실패",
  FILE_ACCESS_DENIED: "저장 실패",
  FILE_NO_SPACE: "저장 공간 부족",
  FILE_NAME_TOO_LONG: "이름이 너무 김",
  FILE_BLOCKED: "크롬이 막음",
  FILE_VIRUS_INFECTED: "크롬이 막음",
  USER_CANCELED: "취소함",
};

let current = null; // 받는 중이거나 마지막으로 끝난 받기
let jobCount = 0;
const byId = new Map(); // 다운로드 id → plan
const byUrl = new Map(); // 주소 → [plan]. 이름 정하기(onDeterminingFilename)가 download()가 id를 돌려주기보다 먼저 올 때 쓴다

// plan.base는 다운로드 폴더 안의 경로에서 확장자만 뺀 것 (사진: 페이지 사진/제목/001, 이어 붙인 그림: 페이지 사진/제목)
const target = (plan, ext) => `${plan.base}.${ext}`;
// 여러 장으로 나눠 받는 이어 붙인 그림의 k번째(1부터) 이름: 제목 → 제목_1, 제목_2 … 한 장이면 그대로.
// 사진 세로로 붙이기(src/shared/fileNames.js의 partName)와 같은 규칙이다
const partBase = (base, k, count) => (count > 1 ? `${base}_${k}` : base);
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// 그림으로 받을 응답인가. 종류를 안 밝히거나(빈 값) 그냥 바이트(octet-stream)라고만 하는 곳도 있어 그것도 받는다
const imageMime = (mime) => !mime || mime.startsWith("image/") || mime.endsWith("/octet-stream");

// 같은 이름 폴더에 받은 적이 있고 파일이 남아 있으면 "제목 (2)"처럼 새 폴더를 쓴다.
// 같은 폴더에 다시 받으면 "001 (1).jpg"처럼 이름이 섞여 순서가 흐트러지기 때문이다. 다운로드 기록을 지웠으면 모른다
async function freeFolder(name) {
  for (let n = 1; n < 1000; n++) {
    const dir = n === 1 ? name : `${name} (${n})`;
    const filenameRegex = `[\\\\/]${escapeRegex(BASE_FOLDER)}[\\\\/]${escapeRegex(dir)}[\\\\/][^\\\\/]+$`;
    const used = await chrome.downloads.search({ filenameRegex, exists: true, limit: 1 });
    if (!used.length) return dir;
  }
  return `${name} (${Date.now()})`;
}

function publicJob(job) {
  const { files, stitch } = job;
  const reason = files
    ? Object.entries(files.reasons)
        .map(([text, count]) => `${text} ${count}`)
        .join(", ")
    : "";
  return {
    id: job.id, // 받기마다 다른 번호. 열린 탭 받기가 자기가 맡긴 받기의 소식인지 알아본다
    kind: job.kind, // photo(사진) · video(영상)
    folder: BASE_FOLDER,
    dir: job.dir,
    running: job.running,
    // percent: 영상을 받는 동안 지금 받고 있는 것들이 몇 %까지 왔는지 (모르면 null)
    files: files && { total: files.total, done: files.done, failed: files.failed, canceled: files.canceled, shownId: files.shownId, reason, percent: files.percent ?? null },
    stitch: stitch && { ...stitch },
  };
}

// 이어 붙이기가 어디까지 왔나(0~100). 받기·크기 재기가 절반, 그리기가 나머지 (JPG로 만드는 중과 저장하는 중은 95)
function stitchPercent(stitch) {
  if (stitch.phase === "fetch") return (stitch.done / stitch.total) * 50;
  if (stitch.phase === "draw") return 50 + (stitch.done / stitch.total) * 45;
  return 95;
}

// 툴바 버튼에 남은 장수(이어 붙이는 중이면 %)를 보이고, 열려 있는 팝업에 알린다
function update(job) {
  let text = "";
  const filesLeft = job.files ? job.files.total - job.files.done - job.files.failed : 0;
  if (job.running) {
    if (filesLeft) text = String(filesLeft);
    else if (job.stitch?.state === "running") text = `${Math.floor(stitchPercent(job.stitch))}%`;
  } else if (job.files?.failed || job.stitch?.state === "failed") text = "!";
  chrome.action.setBadgeBackgroundColor({ color: job.running ? "#2563eb" : "#d97706" });
  chrome.action.setBadgeText({ text });
  chrome.runtime.sendMessage({ type: "job", job: publicJob(job) }).catch(() => {
    // 팝업이 닫혀 있다
  });
}

// 사진 받기와 이어 붙이기가 모두 끝났으면 받기를 마친다
function settle(job) {
  const filesLeft = job.files && job.files.done + job.files.failed < job.files.total;
  if (job.running && !filesLeft && job.stitch?.state !== "running") {
    job.running = false;
    setNaming(false);
  }
  update(job);
}

// 받는 동안만 다운로드 이름 정하기에 끼어든다. 늘 끼어 있으면 평소 다운로드마다 이 워커를 깨운다
let naming = false;
function setNaming(on) {
  if (on === naming) return;
  naming = on;
  if (on) chrome.downloads.onDeterminingFilename.addListener(nameDownload);
  else chrome.downloads.onDeterminingFilename.removeListener(nameDownload);
}

function nameDownload(item, suggest) {
  const plan = byId.get(item.id) ?? byUrl.get(item.url)?.find((p) => !p.named);
  if (!plan || plan.named) {
    suggest();
    return;
  }
  plan.named = true;
  const mime = String(item.mime ?? "").toLowerCase();
  // 그림(영상) 대신 웹 페이지(막힘 안내, 방문 기록용 주소의 응답 등)를 돌려주면 받지 않는다
  if (plan.video ? !videoMime(mime) : !imageMime(mime)) {
    plan.reason = plan.video ? "NOT_VIDEO" : "NOT_IMAGE";
    suggest();
    chrome.downloads.cancel(item.id).catch(() => {});
    return;
  }
  const ext = plan.video
    ? (videoExtFromMime(mime) ?? videoExtFromName(item.filename) ?? plan.guess)
    : (extFromMime(mime) ?? extFromName(item.filename) ?? plan.guess);
  suggest({ filename: target(plan, ext), conflictAction: "uniquify" });
}

function forgetUrl(plan) {
  const list = byUrl.get(plan.url);
  if (!list) return;
  const rest = list.filter((p) => p !== plan);
  if (rest.length) byUrl.set(plan.url, rest);
  else byUrl.delete(plan.url);
}

// 보이지 않는 문서는 이어 붙이기와 클립보드 읽기("복사한 글로")가 함께 쓴다 (확장 프로그램마다 하나만 열 수 있다)
let stitchingDoc = false; // 이어 붙이기가 쓰는 중 (클립보드를 읽은 뒤에 닫지 않게)
async function openOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ["BLOBS", "CLIPBOARD"],
    justification: "고른 사진을 세로로 이어 붙인 그림을 만들어 받고, 오른쪽 클릭 메뉴의 '복사한 글로'에서 클립보드의 글을 읽는다",
  });
}

// 이어 붙이기가 끝났거나 실패했을 때
function closeOffscreen() {
  stitchingDoc = false;
  chrome.offscreen.closeDocument().catch(() => {});
}

// 클립보드의 글 (오른쪽 클릭 메뉴 "복사한 글로", 1.23.0). 서비스 워커는 클립보드를 읽지 못해서 보이지 않는 문서(offscreen.js)가 읽는다.
// 메뉴를 누를 때만 읽는다. 겹쳐 돌지 않게 차례로 하고, 이어 붙이기가 쓰는 중이 아니면 읽은 뒤 문서를 닫는다
let clipboardQueue = Promise.resolve();
function readClipboard() {
  const read = async () => {
    try {
      await openOffscreen();
      const text = await chrome.runtime.sendMessage({ target: "offscreen", type: "clipboard-read" });
      return typeof text === "string" ? text : "";
    } catch {
      return "";
    } finally {
      if (!stitchingDoc) chrome.offscreen.closeDocument().catch(() => {});
    }
  };
  const run = clipboardQueue.then(read, read);
  clipboardQueue = run.catch(() => {});
  return run;
}

// 한 장(또는 이어 붙인 그림)이 끝났다. error가 있으면 받지 못함
function end(plan, error) {
  if (plan.ended) return;
  plan.ended = true;
  if (plan.id != null) {
    byId.delete(plan.id);
    // 받지 못한 것은 크롬 다운로드 목록에서도 지운다. 취소된 것이 크롬이 붙인 이름(track.txt 등)으로 남아
    // 이상한 파일을 받은 것처럼 보였다. 받지 못한 수와 까닭은 팝업이 알려 준다
    if (error) chrome.downloads.erase({ id: plan.id }).catch(() => {});
  }
  forgetUrl(plan);
  const job = plan.job;
  // 크롬 설정의 "다운로드 전에 각 파일의 저장 위치 확인"이 켜져 있으면 장마다 저장 창이 뜨고, 닫으면 취소된다
  const canceled = !plan.reason && error === "USER_CANCELED";
  if (plan.kind === "stitch") {
    // 이어 붙인 그림은 여러 장일 수 있다. 모든 장이 끝나야 이어 붙이기가 끝난다
    const stitch = job.stitch;
    stitch.left--;
    if (error) {
      stitch.failedParts++;
      stitch.error ||= REASONS[plan.reason ?? error] ?? "저장 실패";
      if (canceled) stitch.canceled = true;
    } else stitch.ids[plan.part] = plan.id;
    if (!stitch.left) {
      closeOffscreen(); // Blob 주소도 함께 사라진다. 모든 장을 다 받은 뒤에 닫는다
      const names = stitch.names.filter(Boolean);
      if (names.length) stitch.name = names.length > 1 ? `${names[0]} ~ ${names.at(-1)}` : names[0];
      stitch.id = stitch.ids.find((id) => id != null) ?? null;
      // 여러 장으로 나눠 받았으면 첫 장의 기록만 남기고 나머지는 크롬 다운로드 목록에서 지운다
      for (const id of stitch.ids) if (id != null && id !== stitch.id) chrome.downloads.erase({ id }).catch(() => {});
      if (!stitch.failedParts) stitch.state = "done";
      else {
        stitch.state = "failed";
        if (stitch.parts > 1) stitch.error = `${stitch.parts}장 중 ${stitch.failedParts}장을 받지 못했습니다 (${stitch.error})`;
      }
    }
  } else if (error) {
    job.files.failed++;
    if (canceled) job.files.canceled++;
    const reason = REASONS[plan.reason ?? error] ?? "기타";
    job.files.reasons[reason] = (job.files.reasons[reason] ?? 0) + 1;
  } else {
    job.files.done++;
    // 크롬 다운로드 목록에는 폴더마다 기록 하나만 남긴다 (2026-11-16 사용자와 정함, 옵션 없이 늘 한다).
    // 사진 한 장마다 기록이 하나 생기는데 크롬은 받은 기록을 스스로 지우지 않고 켤 때마다 모두 읽어서, 수만 개가 되면 크롬이 무거워진다.
    // 하나를 남기는 까닭: 같은 이름 폴더에 받은 적이 있는지(freeFolder)와 "폴더 열기"가 기록을 쓴다. 기록만 지우고 파일은 그대로다.
    // 처음 다 받은 사진의 기록을 남기고 나머지는 받는 대로 목록에서 지운다
    if (job.files.shownId == null) job.files.shownId = plan.id;
    else chrome.downloads.erase({ id: plan.id }).catch(() => {});
  }
  settle(job);
}

// 다 받았다. 그림이 아닌데 취소하기 전에 다 받아졌으면 파일을 지운다
async function completed(plan) {
  if (plan.ended || plan.completing) return;
  plan.completing = true;
  const [item] = await chrome.downloads.search({ id: plan.id });
  const mime = String(item?.mime ?? "").toLowerCase();
  const wrong = plan.video ? "NOT_VIDEO" : "NOT_IMAGE";
  if (plan.reason === wrong || (plan.video ? !videoMime(mime) : !imageMime(mime))) {
    plan.reason = wrong;
    await chrome.downloads.removeFile(plan.id).catch(() => {});
    end(plan, wrong);
    return;
  }
  // 같은 이름이 있으면 크롬이 "(1)"을 붙이므로 실제로 저장된 이름을 알린다
  if (plan.kind === "stitch" && item?.filename) plan.job.stitch.names[plan.part] = item.filename.split(/[\\/]/).pop();
  end(plan, null);
}

async function begin(plan) {
  const list = byUrl.get(plan.url) ?? [];
  list.push(plan);
  byUrl.set(plan.url, list);
  try {
    const id = await chrome.downloads.download({
      url: plan.url,
      filename: target(plan, plan.guess),
      conflictAction: "uniquify",
      saveAs: false,
    });
    plan.id = id;
    byId.set(id, plan);
    forgetUrl(plan);
    // 끝났다는 소식이 id를 받기 전에 지나갔을 수 있어 지금 상태를 한 번 본다
    const [item] = await chrome.downloads.search({ id });
    if (item?.state === "complete") completed(plan);
    else if (item?.state === "interrupted") end(plan, item.error ?? "FAILED");
  } catch (err) {
    end(plan, err?.message || "FAILED");
  }
}

async function startStitch(job, urls) {
  try {
    stitchingDoc = true;
    await openOffscreen();
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "stitch",
      jobId: job.id,
      urls,
      format: job.stitchFormat,
      quality: job.jpgQuality,
      split: job.split,
      splitMode: job.splitMode,
    });
  } catch (err) {
    Object.assign(job.stitch, { state: "failed", error: err?.message || String(err) });
    closeOffscreen();
    settle(job);
  }
}

// offscreen.js가 알려 오는 이어 붙이기 진행
function onStitchMessage(message) {
  const job = current;
  if (!job?.stitch || job.id !== message.jobId || job.stitch.state !== "running") return;
  const stitch = job.stitch;
  if (message.type === "stitch-progress") {
    // JPG를 여러 장으로 나눠 만들 때는 몇 번째 장을 만드는지(part/parts)도 온다
    Object.assign(stitch, { phase: message.phase, done: message.done, total: message.total, part: message.part ?? 0, parts: message.parts ?? stitch.parts });
    update(job);
  } else if (message.type === "stitch-done") {
    // format은 실제로 만든 형식이다. JPG를 바랐어도 폭이 너무 넓으면 PNG로 만들어지고, 그 까닭이 note에 온다.
    // parts는 장마다의 Blob 주소다. JPG 한 장에 담기에 너무 길면 여러 장이다
    const { parts = [], width, height, bytes, count, failed = [], format = "png", note = null } = message;
    if (!parts.length) {
      Object.assign(stitch, { state: "failed", error: "만든 그림이 없습니다" });
      closeOffscreen();
      settle(job);
      return;
    }
    const bases = parts.map((_, k) => partBase(job.stitchBase, k + 1, parts.length));
    const name = parts.length > 1 ? `${bases[0]}.${format} ~ ${bases.at(-1)}.${format}` : `${bases[0]}.${format}`;
    const splitMode = parts.length > 1 ? job.splitMode : null;
    Object.assign(stitch, { phase: "save", width, height, bytes, count, failed, format, note, name, parts: parts.length, left: parts.length, splitMode });
    update(job);
    parts.forEach((part, k) => {
      const base = `${BASE_FOLDER}/${bases[k]}`;
      begin({ job, kind: "stitch", part: k, url: part.url, base, guess: format, id: null, named: false, ended: false });
    });
  } else if (message.type === "stitch-error") {
    Object.assign(stitch, { state: "failed", error: message.message });
    closeOffscreen();
    settle(job);
  }
}

// 방금 받은 폴더. 같은 페이지의 사진과 영상을 한 폴더에 넣으려고 기억한다 ({ pageUrl, folder, dir, kinds }).
// 서비스 워커는 잠들면 변수를 잃어서 세션 저장소(브라우저를 끌 때까지)에 둔다
const LAST_FOLDER = "lastFolder";
const readLastFolder = async () => (await chrome.storage.session.get(LAST_FOLDER).catch(() => ({})))[LAST_FOLDER] ?? null;

// 영상은 받는 데 오래 걸린다. 받는 동안 1초마다 받은 양을 물어 창에 몇 %인지 알린다.
// 이 물음이 서비스 워커가 받는 도중에 잠들지 않게도 한다 (잠들면 끝난 것을 알아채지 못한다)
function watchBytes(job) {
  const timer = setInterval(async () => {
    if (!job.running || current !== job) {
      clearInterval(timer);
      return;
    }
    const items = await chrome.downloads.search({ state: "in_progress" }).catch(() => []);
    let received = 0;
    let total = 0;
    for (const item of items) {
      if (byId.get(item.id)?.job !== job || !(item.totalBytes > 0)) continue;
      received += item.bytesReceived;
      total += item.totalBytes;
    }
    const percent = total ? Math.floor((received / total) * 100) : null;
    if (percent !== job.files.percent && job.running) {
      job.files.percent = percent;
      update(job);
    }
  }, 1000);
}

// kind: photo(사진, 기본) · video(영상. 확장 프로그램 창의 "영상" 목록에서 고른 것을 파일 그대로 받는다. 이어 붙이지 않는다)
// pageUrl: 받는 페이지의 주소. 같은 페이지에서 방금 다른 종류(사진 ↔ 영상)를 받았으면 그 폴더에 함께 넣는다
// mode: files(사진 따로) · stitch(이어 붙인 한 장) · both(둘 다)
// naming: 사진 따로 받을 때의 파일 이름. original(주소에 적힌 원래 이름, 기본) · number(고른 순서 번호 001…)
// stitchName: 이어 붙인 그림의 이름(확장자 빼고). 비어 있으면 폴더 이름(페이지 제목)과 같게 한다.
// 처음엔 "<폴더>_합본"이었는데, 페이지 이름으로 받을 때는 "_합본"을 붙이지 말자고 해서 뺐다
// stitchFormat: 이어 붙인 그림의 형식(jpg · png). jpg여도 폭이 너무 넓으면 png로 받는다. jpgQuality: JPG 품질(1~100).
// tooLong: JPG 한 장에 담기에 너무 길 때 split(여러 장으로 나눠 받기) · png(PNG 한 장으로 받기),
// splitMode: 나누는 방법(even 균등하게 · max 최대 + 나머지)
async function startJob({
  folder,
  urls,
  kind = "photo",
  pageUrl = "",
  mode = "files",
  naming = "original",
  stitchName = "",
  stitchFormat = "png",
  jpgQuality = 95,
  tooLong = "split",
  splitMode = "even",
}) {
  if (current?.running) throw new Error("앞의 사진을 아직 받는 중입니다. 다 받은 뒤에 다시 누르세요.");
  if (!urls?.length) throw new Error("고른 사진이 없습니다.");
  const video = kind === "video";
  const withFiles = video || mode !== "stitch";
  const withStitch = !video && mode !== "files";
  // 사진을 따로 받으면 폴더를 새로 만들므로 겹치지 않는 이름을 찾는다. 이어 붙인 그림만 받으면 같은 이름일 때 크롬이 "(1)"을 붙인다.
  // 같은 페이지에서 방금 받은 폴더에 아직 이 종류(사진·영상)를 받지 않았으면 그 폴더에 함께 넣는다
  const last = withFiles && pageUrl ? await readLastFolder() : null;
  const together = Boolean(last) && last.pageUrl === pageUrl && last.folder === folder && !last.kinds.includes(kind);
  const dir = together ? last.dir : withFiles ? await freeFolder(folder) : folder;
  if (withFiles && pageUrl) {
    chrome.storage.session.set({ [LAST_FOLDER]: { pageUrl, folder, dir, kinds: [...(together ? last.kinds : []), kind] } }).catch(() => {});
  }
  const stitchBase = stitchName || dir;
  const job = {
    id: ++jobCount,
    kind: video ? "video" : "photo",
    dir,
    stitchBase,
    stitchFormat: stitchFormat === "jpg" ? "jpg" : "png",
    jpgQuality: Number(jpgQuality) || 95,
    split: tooLong !== "png",
    splitMode: splitMode === "max" ? "max" : "even",
    running: true,
    files: withFiles ? { total: urls.length, done: 0, failed: 0, canceled: 0, reasons: {}, shownId: null, percent: null } : null,
    stitch: withStitch
      ? {
          state: "running",
          phase: "fetch",
          done: 0,
          total: urls.length,
          name: `${stitchBase}.${stitchFormat === "jpg" ? "jpg" : "png"}`, // 여러 장이면 "첫 이름 ~ 끝 이름"
          format: "", // 실제로 만든 형식 (다 만든 뒤에 안다)
          note: null, // JPG를 바랐는데 PNG로 만든 까닭
          part: 0, // JPG를 여러 장으로 나눠 만들 때 지금 만드는 장 (1부터)
          parts: 0, // 만든 장수. 너무 길어 나눴으면 둘 이상
          splitMode: null, // 나눴으면 나눈 방법 (even · max)
          names: [], // 장마다 실제로 저장된 이름
          ids: [], // 장마다의 다운로드 id
          left: 0, // 아직 끝나지 않은 장 수
          failedParts: 0, // 받지 못한 장 수
          width: 0,
          height: 0,
          bytes: 0,
          count: 0,
          failed: [], // 붙이지 못하고 뺀 사진 { n: 고른 순서 번호, why: "fetch" | "decode" }
          error: "",
          canceled: false,
          id: null,
        }
      : null,
  };
  current = job;
  setNaming(true);
  update(job);
  if (withFiles) {
    const digits = Math.max(3, String(urls.length).length);
    const used = new Set();
    const plans = urls.map((url, i) => {
      const guess = video ? (videoExtFromUrl(url) ?? "mp4") : (extFromUrl(url) ?? "jpg");
      const number = String(i + 1).padStart(digits, "0");
      // 원본 이름으로 받을 때: 주소에 파일 이름이 없는 사진은 번호를 쓰고, 같은 이름이 또 나오면 " (2)"를 붙인다.
      // 영상은 늘 주소에 적힌 이름으로 받고, 이름이 없으면 "영상 001"
      const byName = video || naming === "original";
      let name = video ? (videoBase(url) ?? `영상 ${number}`) : (naming === "original" && originalBase(url)) || number;
      if (byName) {
        const first = name;
        for (let n = 2; used.has(`${name}.${guess}`.toLowerCase()); n++) name = `${first} (${n})`;
        used.add(`${name}.${guess}`.toLowerCase());
      }
      return { job, kind: "file", video, url, base: `${BASE_FOLDER}/${dir}/${name}`, guess, id: null, named: false, ended: false };
    });
    let next = 0;
    const worker = async () => {
      while (next < plans.length) await begin(plans[next++]);
    };
    for (let i = 0; i < Math.min(STARTING, plans.length); i++) worker();
    if (video) watchBytes(job);
  }
  if (withStitch) startStitch(job, urls);
  return publicJob(job);
}

// 열린 탭 받기 목록(주소로 더한 페이지) ---------------------------------------------
// 열린 탭 받기 화면, 사이드바(링크 고르기·이 페이지 링크), 오른쪽 클릭 메뉴가 함께 쓰는 목록이라 chrome.storage.local에 둔다.
// 여러 곳에서 동시에 고쳐도 빠지지 않게 고치는 일은 여기서 하나씩 차례로 한다(queued). 읽기는 저장소에서 바로 해도 된다
let queueLock = Promise.resolve();
function queued(task) {
  const run = queueLock.then(task);
  queueLock = run.catch(() => {});
  return run;
}
const readQueue = async () => (await chrome.storage.local.get(QUEUE_KEY))[QUEUE_KEY] ?? [];
const writeQueue = (pages) => chrome.storage.local.set({ [QUEUE_KEY]: pages });

// pages: [{ url, title }]. 웹 주소가 아니거나 이미 있는 것은 빼고 뒤에 더한다. { added, skipped, full, pages }
function queueAdd(pages) {
  return queued(async () => {
    const list = await readQueue();
    const have = new Set(list.map((page) => page.url));
    let added = 0;
    let skipped = 0;
    let full = 0;
    for (const page of pages) {
      const url = parseUrl(page?.url);
      if (!url || have.has(url)) skipped++;
      else if (list.length >= QUEUE_MAX) full++;
      else {
        have.add(url);
        list.push({ url, title: String(page.title ?? "").slice(0, 200) });
        added++;
      }
    }
    if (added) await writeQueue(list);
    return { added, skipped, full, pages: list };
  });
}

function queueRemove(urls) {
  return queued(async () => {
    const drop = new Set(urls);
    const list = (await readQueue()).filter((page) => !drop.has(page.url));
    await writeQueue(list);
    return { pages: list };
  });
}

// 있으면 빼고 없으면 넣는다 (링크 고르기). { inList, full, pages }
function queueToggle(page) {
  return queued(async () => {
    const url = parseUrl(page?.url);
    const list = await readQueue();
    if (!url) return { inList: false, invalid: true, pages: list };
    const at = list.findIndex((item) => item.url === url);
    if (at >= 0) list.splice(at, 1);
    else if (list.length >= QUEUE_MAX) return { inList: false, full: true, pages: list };
    else list.push({ url, title: String(page.title ?? "").slice(0, 200) });
    await writeQueue(list);
    return { inList: at < 0, pages: list };
  });
}

// 순서를 바꾼다 (열린 탭 받기 화면에서 끌어 옮기거나 뒤집었을 때). urls의 순서대로 놓고, 거기 없는 주소는 뒤에 원래 순서대로 둔다
function queueReorder(urls) {
  return queued(async () => {
    const list = await readQueue();
    const at = new Map(urls.map((url, index) => [url, index]));
    const moved = list.filter((page) => at.has(page.url)).sort((a, b) => at.get(a.url) - at.get(b.url));
    const pages = [...moved, ...list.filter((page) => !at.has(page.url))];
    await writeQueue(pages);
    return { pages };
  });
}

const QUEUE_OPS = {
  "queue-reorder": (message) => queueReorder(Array.isArray(message.urls) ? message.urls.map(String) : []),
  "queue-add": (message) => queueAdd(message.pages ?? []),
  "queue-remove": (message) => queueRemove(message.urls ?? []),
  "queue-toggle": (message) => queueToggle(message.page),
};

// 보기 싫은 부분 숨기기 (1.20.0) ----------------------------------------------------
// 페이지 쪽은 hide-watch.js(오른쪽 클릭한 곳 기억), hide-core.js(숨기기), hide-picker.js(숨길 곳 고르기)이고, 여기서는
// 오른쪽 클릭 메뉴, 사용자 스타일 넣고 빼기, 늘 숨기는 곳 저장, 되돌릴 순서, 고르기의 키와 안내 줄을 맡는다
const HIDE_MENU = { "hide-once": false, "hide-always": true }; // 메뉴 id → 늘 숨기기인지
// 숨기기는 어디서나 보인다. 글자를 고른 채 누를 때도 (구글 검색과 함께 "페이지 도우미" 아래에 나온다. 사용자 결정, 2026-11-19)
const HIDE_CONTEXTS = ["page", "frame", "selection", "link", "editable", "image", "video", "audio"];
const UNDO_KEY = "hideUndo"; // 탭마다 숨긴 순서 (chrome.storage.session. 서비스 워커가 잠들어도 남는다)

// 늘 숨기는 곳 목록과 되돌릴 순서는 여러 프레임이 함께 고쳐서 하나씩 차례로 한다 (둘은 따로: 되돌리기가 목록 고치기를 기다리므로)
function serial() {
  let lock = Promise.resolve();
  return (task) => {
    const run = lock.then(task);
    lock = run.catch(() => {});
    return run;
  };
}
const ruleQueue = serial();
const undoQueue = serial();

// 그 프레임의 문서에 넣는다 (그 사이 프레임이 다른 페이지로 넘어갔으면 넣지 않게 documentId로)
const docTarget = (tabId, frameId, documentId) => (documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [frameId ?? 0] });

function hideRuleAdd(site, rule) {
  return ruleQueue(async () => {
    if (!validSite(site) || !validRule(rule)) return { ok: false };
    const all = await loadHideRules();
    const path = rule.path ?? null;
    const list = rulesOf(all, site).filter((r) => !(r.sel === rule.sel && (r.path ?? null) === path));
    list.push({ sel: rule.sel, path, label: String(rule.label ?? "").slice(0, 100), at: Number(rule.at) || Date.now() });
    delete all[site];
    all[site] = list.slice(-HIDE_SITE_MAX);
    // 사이트가 너무 많으면 오래전에 고친 사이트부터 버린다 (고친 사이트를 맨 뒤로 옮겨 두었다)
    const sites = Object.keys(all);
    for (const old of sites.slice(0, Math.max(0, sites.length - HIDE_SITES_MAX))) delete all[old];
    await chrome.storage.local.set({ [HIDE_KEY]: all });
    return { ok: true, count: all[site].length };
  });
}

// sel이 없으면 그 사이트를 모두 뺀다 (창의 "모두 다시 보이기")
function hideRuleRemove(site, sel, path) {
  return ruleQueue(async () => {
    const all = await loadHideRules();
    if (!all[site]) return { ok: true, count: 0 };
    const list = sel == null ? [] : rulesOf(all, site).filter((r) => !(r.sel === sel && (r.path ?? null) === (path ?? null)));
    if (list.length) all[site] = list;
    else delete all[site];
    await chrome.storage.local.set({ [HIDE_KEY]: all });
    return { ok: true, count: list.length };
  });
}

const readUndo = async () => (await chrome.storage.session.get(UNDO_KEY).catch(() => ({})))[UNDO_KEY] ?? {};
const writeUndo = (all) => chrome.storage.session.set({ [UNDO_KEY]: all }).catch(() => {});
function undoPush(tabId, entry) {
  return undoQueue(async () => {
    const all = await readUndo();
    all[tabId] = [...(all[tabId] ?? []), entry].slice(-50);
    await writeUndo(all);
  });
}
// 이 탭에서 마지막으로 숨긴 것을 되돌린다. 그 문서가 없어졌으면(새로 고침 등) 그 앞의 것. { ok, label }
function undoLast(tabId) {
  return undoQueue(async () => {
    const all = await readUndo();
    const list = all[tabId] ?? [];
    let result = { ok: false };
    while (list.length && !result.ok) {
      const entry = list.pop();
      const [done] = await chrome.scripting
        .executeScript({ target: docTarget(tabId, entry.frameId, entry.documentId), func: (id) => self.__photoSaverHide?.undo(id), args: [entry.id] })
        .catch(() => []);
      if (done?.result?.ok) result = done.result;
    }
    all[tabId] = list;
    await writeUndo(all);
    return result;
  });
}
chrome.tabs.onRemoved.addListener((tabId) => {
  undoQueue(async () => {
    const all = await readUndo();
    if (!all[tabId]) return;
    delete all[tabId];
    await writeUndo(all);
  });
});

// 지금 탭의 모든 프레임에 한다. 들어갈 수 없는 프레임이 있어 실패하면 맨 위 프레임에만
async function everyFrame(tabId, call) {
  try {
    return await call({ tabId, allFrames: true });
  } catch {
    return call({ tabId });
  }
}

// 숨길 곳 고르기를 시작한다 (창의 단추, 또는 오른쪽 클릭 메뉴가 누른 곳을 모를 때). options: { remember, status }
async function startPick(tabId, options = {}) {
  await everyFrame(tabId, (target) => chrome.scripting.executeScript({ target, files: ["hide-core.js", "hide-picker.js"] }));
  await everyFrame(tabId, (target) => chrome.scripting.executeScript({ target, func: (opts) => self.__photoSaverPicker?.start(opts), args: [options] }));
  chrome.runtime.sendMessage({ type: "hide-pick-state", tabId, on: true }).catch(() => {});
}
async function stopPick(tabId) {
  await everyFrame(tabId, (target) => chrome.scripting.executeScript({ target, func: () => self.__photoSaverPicker?.stop() })).catch(() => {});
  chrome.runtime.sendMessage({ type: "hide-pick-state", tabId, on: false }).catch(() => {});
}
// 고르기의 안내 줄(맨 위 프레임)에 글을 보인다
const pickStatus = (tabId, text, warn = false) => chrome.tabs.sendMessage(tabId, { type: "hide-pick-status", text, warn }, { frameId: 0 }).catch(() => {});

// 고르기 중에 누른 키 (어느 프레임에서 눌렀든 여기로 온다): 끝내기와 되돌리기는 여기서, 넓히기·좁히기·숨기기는 모든 프레임에 돌려준다
async function pickKey(tabId, key) {
  if (key === "stop") return stopPick(tabId);
  if (key === "undo") {
    const result = await undoLast(tabId);
    return pickStatus(tabId, result.ok ? `되돌렸습니다: ${result.label}` : "되돌릴 것이 없습니다", !result.ok);
  }
  if (["up", "down", "hide"].includes(key)) await chrome.tabs.sendMessage(tabId, { type: "hide-pick-key", key }).catch(() => {});
}

// 오른쪽 클릭 메뉴 "이 부분 숨기기"·"이 부분 늘 숨기기". 누른 곳은 그 프레임의 hide-watch.js가 기억해 둔다.
// 다른 사이트의 틀 안이면 바깥 프레임이 틀째 숨겨서, 모든 프레임에 hide-core.js를 넣고 이번 메뉴의 번호를 준다(arm)
async function hideFromMenu(info, tab) {
  if (tab?.id == null) return;
  const tabId = tab.id;
  const remember = HIDE_MENU[info.menuItemId];
  const nonce = crypto.randomUUID();
  await everyFrame(tabId, (target) => chrome.scripting.executeScript({ target, files: ["hide-core.js"] })).catch(() => {});
  await everyFrame(tabId, (target) => chrome.scripting.executeScript({ target, func: (n) => self.__photoSaverHide?.arm(n), args: [nonce] })).catch(() => {});
  const [done] = await chrome.scripting
    .executeScript({ target: { tabId, frameIds: [info.frameId ?? 0] }, func: (r, n) => self.__photoSaverHide?.fromMenu(r, n), args: [remember, nonce] })
    .catch(() => []);
  // 누른 곳을 모르면(확장 프로그램을 설치하거나 새로 고치기 전에 연 페이지 등) 고르기로 숨기게 한다
  if (done?.result?.reason === "no-target") {
    await startPick(tabId, { remember, status: "누른 곳을 알 수 없어 고르기로 숨깁니다. 숨길 곳을 누르세요. (페이지를 새로 고치면 오른쪽 클릭으로 바로 숨길 수 있습니다)", warn: true }).catch(() => {});
  }
}

const HIDE_OPS = {
  "hide-rule-add": (message) => hideRuleAdd(message.site, message.rule),
  "hide-rule-remove": (message) => hideRuleRemove(message.site, message.sel, message.path),
  "hide-rules-clear": (message) => hideRuleRemove(message.site, null, null),
  "hide-pick-start": (message) => startPick(message.tabId).then(() => ({ ok: true })),
  "hide-pick-stop": (message, sender) => stopPick(message.tabId ?? sender.tab?.id).then(() => ({ ok: true })),
};

// 페이지 쪽(hide-core.js·hide-picker.js)에서 오는 말
function onHideMessage(message, sender, reply) {
  const tabId = sender.tab?.id;
  if (message.type === "hide-css") {
    if (tabId == null) return false;
    // 새것을 넣은 뒤 옛것을 뺀다 (그 사이에 깜빡 보이지 않게). 사용자 스타일이라 사이트의 !important보다 앞선다
    const target = docTarget(tabId, sender.frameId, sender.documentId);
    (async () => {
      if (message.css) await chrome.scripting.insertCSS({ target, css: message.css, origin: "USER" });
      if (message.old) await chrome.scripting.removeCSS({ target, css: message.old, origin: "USER" }).catch(() => {});
    })().then(
      () => reply({ ok: true }),
      (err) => reply({ error: err.message }),
    );
    return true;
  }
  if (message.type === "hide-did") {
    if (tabId != null) undoPush(tabId, { frameId: sender.frameId ?? 0, documentId: sender.documentId ?? null, id: message.id });
    return false;
  }
  if (message.type === "hide-pick-key") {
    if (tabId != null) pickKey(tabId, message.key);
    return false;
  }
  if (message.type === "hide-pick-status") {
    if (tabId != null) pickStatus(tabId, String(message.text ?? ""), Boolean(message.warn));
    return false;
  }
  return false;
}

// 오른쪽 클릭 메뉴 -----------------------------------------------------------------
// - 고른 글자: "구글 검색: 고른 글 + 붙일 말" (붙일 말마다 한 줄, 적은 그대로 바로 뒤에 붙인다. 1.21.0. search-words.js),
//   "열기: 주소" (정해 둔 주소의 자리에 고른 글을 소문자로 바꿔 넣는다. 1.22.0. url-templates.js)
// - 빈 곳(고른 글자가 없을 때): 같은 구글 검색·주소 열기를 같은 자리에 "(복사한 글)"로. 고른 글 대신 클립보드의 글을 쓴다 (1.23.0, readClipboard)
// - 링크: "열린 탭 받기 목록에 넣기". 넣었는지는 그 페이지 아래쪽에 잠깐 글로 알린다 (툴바 배지는 받기 진행을 보이는 데 쓴다)
// - 어디서나: "이 부분 숨기기"·"이 부분 늘 숨기기" (1.20.0)
// 한 확장 프로그램의 메뉴가 둘 이상 보이면 크롬이 "페이지 도우미" 아래로 묶고, 만든 순서대로 보인다
const MENU_ID = "add-link";
const SEARCH_PREFIX = "search:"; // 구글 검색 메뉴의 id는 이 뒤에 붙일 말을 그대로 붙인다 (목록이 바뀌는 사이에 눌러도 그 말로 찾게)
const OPEN_PREFIX = "open:"; // 주소 열기 메뉴의 id는 이 뒤에 주소를 그대로 붙인다
const CLIP_SEARCH = "clip-search:"; // 빈 곳의 구글 검색 (뒤에 붙일 말)
const CLIP_OPEN = "clip-open:"; // 빈 곳의 주소 열기 (뒤에 주소)
const CLIP_TEXT = "(복사한 글)"; // 크롬 메뉴는 고른 글(%s)만 메뉴 글에 넣어 보일 수 있어서 복사한 글 자리는 이렇게 적는다
let menuItems = [];
let menuBuild = Promise.resolve();

// 구글 검색·주소 열기 메뉴. 글자를 고르면 고른 글로, 고른 글자가 없는 빈 곳이면 복사해 둔 글로 한다 (사용자 요청: 둘이 같은 메뉴를 쓰게).
// 크롬 메뉴는 고른 글(%s)만 메뉴 글에 넣을 수 있어서, 줄마다 둘을 만들어 한 번에 하나만 보이게 한다:
// - 고른 글자(selection): "구글 검색: %s가격", "열기: aaa.com/%s/b" (%s는 크롬이 고른 글로 바꿔 보인다.
//   찾을 말 그대로 보이게 붙일 말을 바로 뒤에 붙인다. 띄어 쓰는 말은 앞에 빈칸이 있다)
// - 빈 곳(page: 고른 글자·링크·그림·입력 칸이 아닌 곳. 틀 안의 빈 곳도): 같은 자리에 "(복사한 글)"로
// 그 아래 구분선 (그 아래에 링크·숨기기가 온다). 윈도우 메뉴는 &를 단축키 표시로 읽어서 두 번 적는다
function searchMenus(words, templates) {
  if (!words.length && !templates.length) return [];
  const amp = (text) => text.replace(/&/g, "&&");
  return [
    ...words.flatMap((word) => [
      { id: `${SEARCH_PREFIX}${word}`, title: `구글 검색: %s${amp(word)}`, contexts: ["selection"] },
      { id: `${CLIP_SEARCH}${word}`, title: `구글 검색: ${CLIP_TEXT}${amp(word)}`, contexts: ["page"] },
    ]),
    ...templates.flatMap((template) => [
      { id: `${OPEN_PREFIX}${template}`, title: `열기: ${amp(templateLabel(template))}`, contexts: ["selection"] },
      { id: `${CLIP_OPEN}${template}`, title: `열기: ${amp(templateLabel(template).replaceAll("%s", CLIP_TEXT))}`, contexts: ["page"] },
    ]),
    { id: "search-end", type: "separator", contexts: ["selection", "page"] },
  ];
}

// 메뉴를 처음부터 다시 만든다 (설치하거나 새로 고칠 때, 붙일 말이 바뀔 때). 겹쳐 돌지 않게 차례로 한다
function buildMenus() {
  menuBuild = menuBuild
    .then(async () => {
      const [words, templates] = await Promise.all([loadSearchList(), loadTemplates()]);
      // 웹 페이지에서만 (크롬 설정 같은 페이지에서는 숨길 수 없다)
      const documentUrlPatterns = ["http://*/*", "https://*/*"];
      const items = [
        ...searchMenus(words, templates),
        { id: MENU_ID, title: "열린 탭 받기 목록에 넣기", contexts: ["link"] },
        { id: "hide-once", title: "이 부분 숨기기", contexts: HIDE_CONTEXTS, documentUrlPatterns },
        { id: "hide-always", title: "이 부분 늘 숨기기 (이 사이트에서 기억)", contexts: HIDE_CONTEXTS, documentUrlPatterns },
      ];
      await chrome.contextMenus.removeAll();
      for (const item of items) {
        await new Promise((resolve) =>
          chrome.contextMenus.create(item, () => {
            void chrome.runtime.lastError;
            resolve();
          }),
        );
      }
      menuItems = items;
    })
    .catch(() => {});
  return menuBuild;
}
chrome.runtime.onInstalled.addListener(buildMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes[SEARCH_KEY] || changes[PLAIN_KEY] || changes[URL_KEY])) buildMenus();
});

// 지금 탭 바로 뒤에 새 탭으로 연다 (그 탭을 닫으면 원래 탭으로 돌아간다)
async function openNextTo(url, tab) {
  const placed = tab?.id != null && tab.index != null ? { index: tab.index + 1, openerTabId: tab.id, windowId: tab.windowId } : {};
  await chrome.tabs.create({ url, active: true, ...placed }).catch(() => chrome.tabs.create({ url }));
}

// 고른 글로 열었으면 그 페이지에서 글자의 고름을 풀어 준다 (사용자 요청, 2026-11-19). 입력 칸 안이면 끝에 커서만 남긴다.
// 메뉴를 누른 프레임에 executeScript로 넣는 함수라 함수 밖의 이름을 쓰면 안 된다
function clearSelection() {
  const active = document.activeElement;
  if (active && (active.localName === "input" || active.localName === "textarea") && typeof active.selectionEnd === "number") {
    try {
      active.setSelectionRange(active.selectionEnd, active.selectionEnd);
    } catch {
      // 고를 수 없는 입력 칸
    }
  }
  getSelection()?.removeAllRanges();
}

// 고른 글·복사한 글을 쓸 글로 다듬는다: 앞뒤의 빈칸과, 창의 "기호 떼기"에 적어 둔 기호(처음엔 "-")를 뗀다 (cleanSelection, 1.26.0)
const usable = async (text) => cleanSelection(text, await loadMarks());
// 뗄 기호만 골랐거나 복사했으면(떼고 나면 남는 글이 없다) 열지 않고 그 프레임에 알린다
const ONLY_MARKS = "기호뿐이라 쓸 글자가 없습니다.";

// 메뉴에서 고른 글로: 다듬은 글로 주소를 만들어 열고 고름을 풀어 준다
async function selectionFromMenu(makeUrl, info, tab) {
  const text = await usable(info.selectionText);
  if (!text) {
    if (String(info.selectionText ?? "").trim()) await inMenuFrame(info, tab, showToast, [`고른 글이 ${ONLY_MARKS}`]);
    return;
  }
  await openNextTo(makeUrl(text), tab);
  await inMenuFrame(info, tab, clearSelection, []);
}

// 메뉴를 누른 프레임에서 함수를 돌린다 (알림 띄우기 등)
async function inMenuFrame(info, tab, func, args) {
  if (tab?.id == null) return undefined;
  const target = { tabId: tab.id, frameIds: [info.frameId ?? 0] };
  return (await chrome.scripting.executeScript({ target, func, args }).catch(() => []))[0]?.result;
}

// "복사한 글로": 클립보드의 글로 구글 검색이나 주소 열기. 글이 없으면 그 페이지에 알린다.
// clipboardText는 시험이 클립보드 대신 넣는다 (시험이 이 컴퓨터의 클립보드를 건드리지 않게)
async function clipboardFromMenu(makeUrl, info, tab, clipboardText) {
  const copied = String(clipboardText ?? (await readClipboard()) ?? "");
  const text = await usable(copied);
  if (!text) {
    await inMenuFrame(info, tab, showToast, [copied.trim() ? `복사한 글이 ${ONLY_MARKS}` : "복사한 글이 없습니다. 글자를 복사한 뒤 다시 눌러 주세요."]);
    return;
  }
  await openNextTo(makeUrl(text), tab);
}

async function addLinkFromMenu(info, tab) {
  const inPage = (func, args) => inMenuFrame(info, tab, func, args);
  const title = (await inPage(linkTextOf, [info.linkUrl])) ?? "";
  const result = await queueAdd([{ url: info.linkUrl, title }]);
  let text;
  if (result.added) text = `열린 탭 받기 목록에 넣었습니다 (목록 ${result.pages.length}개)`;
  else if (result.full) text = `목록이 가득 찼습니다 (${QUEUE_MAX}개)`;
  else if (!parseUrl(info.linkUrl)) text = "주소가 없는 링크라 넣을 수 없습니다";
  else text = "이미 열린 탭 받기 목록에 있습니다";
  await inPage(showToast, [text]);
}

// options.clipboardText: 시험이 클립보드 대신 넣는 글 (크롬은 info, tab만 준다)
function onMenuClick(info, tab, options = {}) {
  const id = String(info.menuItemId);
  // 구글 검색: 고른 글 바로 뒤에 붙일 말을 붙여 찾는다. 주소 열기: 정해 둔 주소의 자리에 고른 글(소문자, 주소에 쓸 수 있게 바꾼 것)을 넣어 연다
  if (id.startsWith(SEARCH_PREFIX)) {
    const word = id.slice(SEARCH_PREFIX.length);
    return selectionFromMenu((text) => searchUrl(text, word), info, tab);
  }
  if (id.startsWith(OPEN_PREFIX)) {
    const template = id.slice(OPEN_PREFIX.length);
    return selectionFromMenu((text) => fillTemplate(template, text), info, tab);
  }
  if (id.startsWith(CLIP_SEARCH)) {
    const word = id.slice(CLIP_SEARCH.length);
    return clipboardFromMenu((text) => searchUrl(text, word), info, tab, options.clipboardText);
  }
  if (id.startsWith(CLIP_OPEN)) {
    const template = id.slice(CLIP_OPEN.length);
    return clipboardFromMenu((text) => fillTemplate(template, text), info, tab, options.clipboardText);
  }
  if (id in HIDE_MENU) return hideFromMenu(info, tab);
  if (id === MENU_ID) return addLinkFromMenu(info, tab);
  return undefined;
}
chrome.contextMenus.onClicked.addListener(onMenuClick);

// 고른 글 옆 단추(select-button.js, 1.24.0): 고른 글로 완성한 목록과 고른 줄 열기. 오른쪽 클릭 메뉴와 같은 목록·규칙을 쓴다
// (구글 검색은 고른 글 바로 뒤에 붙일 말, 주소는 소문자로 바꿔 인코딩해 넣는다). 주소는 사람이 읽게 앞의 http(s)://는 떼고 %XX는 풀어 보인다
function shownUrl(url) {
  let text = url.replace(/^https?:\/\//i, "");
  try {
    text = decodeURI(text);
  } catch {
    // 풀 수 없으면 그대로
  }
  return text;
}
async function textActions(text) {
  const clean = await usable(text);
  if (!clean) return [];
  const [words, templates] = await Promise.all([loadSearchList(), loadTemplates()]);
  return [
    ...words.map((word) => ({ id: `${SEARCH_PREFIX}${word}`, label: `구글 검색: ${clean}${word}` })),
    ...templates.map((template) => ({ id: `${OPEN_PREFIX}${template}`, label: `열기: ${shownUrl(fillTemplate(template, clean))}` })),
  ];
}
// 창 맨 위의 바로 열기(quick.js)도 쓴다. 창에서 오면 sender.tab이 없어 지금 탭(tabId)을 함께 보내고,
// 페이지에서 고른 글로 열었으면(clear) 그 페이지의 고름을 풀어 준다
async function textOpen(id, text, tab, clear) {
  const clean = await usable(text);
  if (!clean) return;
  if (id.startsWith(SEARCH_PREFIX)) await openNextTo(searchUrl(clean, id.slice(SEARCH_PREFIX.length)), tab);
  else if (id.startsWith(OPEN_PREFIX)) await openNextTo(fillTemplate(id.slice(OPEN_PREFIX.length), clean), tab);
  else return;
  if (clear && tab?.id != null) await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func: clearSelection }).catch(() => {});
}
// 창의 "이 페이지 링크"에서 고른 링크를 탭으로 연다 (links.js의 openChosen, 1.32.0).
// 그 탭 바로 뒤에 고른 순서대로, 뒤쪽에 연다 (지금 보는 페이지와 창은 그대로). 웹 주소만 연다
async function openTabs(urls, tabId) {
  const list = (Array.isArray(urls) ? urls : []).filter((url) => typeof url === "string" && /^https?:\/\//i.test(url)).slice(0, 50);
  const origin = tabId != null ? await chrome.tabs.get(tabId).catch(() => null) : null;
  let opened = 0;
  for (const url of list) {
    const place = origin ? { windowId: origin.windowId, index: origin.index + 1 + opened, openerTabId: origin.id } : {};
    await chrome.tabs.create({ url, active: false, ...place });
    opened++;
  }
  return { opened };
}

// 시험(local-tests)이 메뉴를 누른 것처럼 부르고, 만든 메뉴를 본다 (headless 크롬에서는 오른쪽 클릭 메뉴를 누를 수 없다)
globalThis.photoSaverMenu = { click: onMenuClick, items: () => menuItems, built: () => menuBuild };

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  // 아이콘이 무엇을 열지 기억한다 (팝업의 "사이드바로 열기". 팝업은 사이드바가 열리면 닫혀서 스스로 끝까지 하지 못할 수 있다)
  if (message?.type === "open-in" && OPEN_IN.includes(message.value)) {
    saveOpenIn(message.value)
      .then(() => applyOpenIn(message.value))
      .catch(() => {});
    return false;
  }
  if (message?.target === "background") {
    onStitchMessage(message);
    return false;
  }
  if (QUEUE_OPS[message?.type]) {
    QUEUE_OPS[message.type](message).then(reply, (err) => reply({ error: err.message }));
    return true;
  }
  if (message?.type === "open-tabs") {
    openTabs(message.urls, message.tabId).then(reply, (err) => reply({ error: err.message }));
    return true;
  }
  if (message?.type === "text-actions") {
    textActions(message.text).then(reply, () => reply([]));
    return true;
  }
  if (message?.type === "text-open") {
    const tab = sender.tab ? Promise.resolve(sender.tab) : message.tabId != null ? chrome.tabs.get(message.tabId).catch(() => null) : Promise.resolve(null);
    tab.then((t) => textOpen(String(message.id ?? ""), message.text, t, Boolean(message.clear) && !sender.tab)).then(
      () => reply({ ok: true }),
      () => reply({ ok: false }),
    );
    return true;
  }
  if (HIDE_OPS[message?.type]) {
    HIDE_OPS[message.type](message, sender).then(reply, (err) => reply({ error: err.message }));
    return true;
  }
  if (typeof message?.type === "string" && message.type.startsWith("hide-")) return onHideMessage(message, sender, reply);
  if (message?.type === "unlock-css") {
    // 늘 푸는 사이트의 프레임이 뜰 때(unlock-css.js): 글자 고르기를 막은 꾸밈을 사용자 스타일로 덮는다
    if (sender.tab?.id != null) {
      chrome.scripting.insertCSS({ target: { tabId: sender.tab.id, frameIds: [sender.frameId ?? 0] }, css: UNLOCK_CSS, origin: "USER" }).catch(() => {});
    }
    return false;
  }
  if (message?.type === "status") {
    // 끝난 받기를 팝업에서 봤으니 툴바의 표시(!)를 지운다
    if (current && !current.running) chrome.action.setBadgeText({ text: "" });
    reply({ job: current && publicJob(current) });
    return false;
  }
  if (message?.type === "start") {
    startJob(message).then(
      (job) => reply({ job }),
      (err) => reply({ error: err.message }),
    );
    return true;
  }
  return false;
});

chrome.downloads.onChanged.addListener((delta) => {
  const plan = byId.get(delta.id);
  if (!plan || !delta.state) return;
  if (delta.state.current === "complete") completed(plan);
  else if (delta.state.current === "interrupted") end(plan, delta.error?.current ?? "FAILED");
});
