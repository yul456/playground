// 사진 받기를 맡아 하는 서비스 워커. 팝업이 닫혀도 받기가 이어지도록 여기서 한다.
// - 사진 따로 받기: chrome.downloads로 받는다. 파일 이름은 고른 순서 번호(001, 002…)이고,
//   확장자는 받아 보고 안 그림 종류(MIME)로 정한다
// - 세로로 이어 붙이기: 보이지 않는 문서(offscreen.js)가 사진을 받아 PNG 한 장을 만들고,
//   그 Blob 주소를 넘겨받아 여기서 받는다 (서비스 워커는 Blob 주소를 만들지 못한다)
import { BASE_FOLDER, extFromMime, extFromName, extFromUrl, originalBase } from "./names.js";

// 한 번에 시작을 기다리는 다운로드 수. 시작만 기다리고 끝나기는 기다리지 않아서 실제로는 여러 장을 함께 받는다
const STARTING = 4;
const OFFSCREEN = "offscreen.html";
// 받지 못한 까닭(크롬 다운로드 오류)을 사람 말로
const REASONS = {
  NOT_IMAGE: "그림이 아님",
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
    folder: BASE_FOLDER,
    dir: job.dir,
    running: job.running,
    files: files && { total: files.total, done: files.done, failed: files.failed, canceled: files.canceled, shownId: files.shownId, reason },
    stitch: stitch && { ...stitch },
  };
}

// 이어 붙이기가 어디까지 왔나(0~100). 받기·크기 재기가 절반, 그리기가 나머지
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
  // 그림 대신 웹 페이지(막힘 안내, 방문 기록용 주소의 응답 등)를 돌려주면 받지 않는다
  if (!imageMime(mime)) {
    plan.reason = "NOT_IMAGE";
    suggest();
    chrome.downloads.cancel(item.id).catch(() => {});
    return;
  }
  const ext = extFromMime(mime) ?? extFromName(item.filename) ?? plan.guess;
  suggest({ filename: target(plan, ext), conflictAction: "uniquify" });
}

function forgetUrl(plan) {
  const list = byUrl.get(plan.url);
  if (!list) return;
  const rest = list.filter((p) => p !== plan);
  if (rest.length) byUrl.set(plan.url, rest);
  else byUrl.delete(plan.url);
}

async function openOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN,
    reasons: ["BLOBS"],
    justification: "고른 사진을 세로로 이어 붙인 PNG를 만들어 받는다",
  });
}

function closeOffscreen() {
  chrome.offscreen.closeDocument().catch(() => {});
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
    closeOffscreen(); // Blob 주소도 함께 사라진다
    if (error) Object.assign(job.stitch, { state: "failed", error: REASONS[plan.reason ?? error] ?? "저장 실패", canceled });
    else Object.assign(job.stitch, { state: "done", id: plan.id });
  } else if (error) {
    job.files.failed++;
    if (canceled) job.files.canceled++;
    const reason = REASONS[plan.reason ?? error] ?? "기타";
    job.files.reasons[reason] = (job.files.reasons[reason] ?? 0) + 1;
  } else {
    job.files.done++;
    job.files.shownId ??= plan.id;
  }
  settle(job);
}

// 다 받았다. 그림이 아닌데 취소하기 전에 다 받아졌으면 파일을 지운다
async function completed(plan) {
  if (plan.ended || plan.completing) return;
  plan.completing = true;
  const [item] = await chrome.downloads.search({ id: plan.id });
  if (plan.reason === "NOT_IMAGE" || !imageMime(String(item?.mime ?? "").toLowerCase())) {
    plan.reason = "NOT_IMAGE";
    await chrome.downloads.removeFile(plan.id).catch(() => {});
    end(plan, "NOT_IMAGE");
    return;
  }
  // 같은 이름이 있으면 크롬이 "(1)"을 붙이므로 실제로 저장된 이름을 알린다
  if (plan.kind === "stitch" && item?.filename) plan.job.stitch.name = item.filename.split(/[\\/]/).pop();
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
    await openOffscreen();
    await chrome.runtime.sendMessage({ target: "offscreen", type: "stitch", jobId: job.id, urls });
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
    Object.assign(stitch, { phase: message.phase, done: message.done, total: message.total });
    update(job);
  } else if (message.type === "stitch-done") {
    const { width, height, bytes, count, failed = [] } = message;
    Object.assign(stitch, { phase: "save", width, height, bytes, count, failed });
    update(job);
    const base = `${BASE_FOLDER}/${job.stitchBase}`;
    begin({ job, kind: "stitch", url: message.url, base, guess: "png", id: null, named: false, ended: false });
  } else if (message.type === "stitch-error") {
    Object.assign(stitch, { state: "failed", error: message.message });
    closeOffscreen();
    settle(job);
  }
}

// mode: files(사진 따로) · stitch(이어 붙인 한 장) · both(둘 다)
// naming: 사진 따로 받을 때의 파일 이름. original(주소에 적힌 원래 이름, 기본) · number(고른 순서 번호 001…)
// stitchName: 이어 붙인 그림의 이름(확장자 빼고). 비어 있으면 폴더 이름(페이지 제목)과 같게 한다.
// 처음엔 "<폴더>_합본"이었는데, 페이지 이름으로 받을 때는 "_합본"을 붙이지 말자고 해서 뺐다
async function startJob({ folder, urls, mode = "files", naming = "original", stitchName = "" }) {
  if (current?.running) throw new Error("앞의 사진을 아직 받는 중입니다. 다 받은 뒤에 다시 누르세요.");
  if (!urls?.length) throw new Error("고른 사진이 없습니다.");
  const withFiles = mode !== "stitch";
  const withStitch = mode !== "files";
  // 사진을 따로 받으면 폴더를 새로 만들므로 겹치지 않는 이름을 찾는다. 이어 붙인 그림만 받으면 같은 이름일 때 크롬이 "(1)"을 붙인다
  const dir = withFiles ? await freeFolder(folder) : folder;
  const stitchBase = stitchName || dir;
  const job = {
    id: ++jobCount,
    dir,
    stitchBase,
    running: true,
    files: withFiles ? { total: urls.length, done: 0, failed: 0, canceled: 0, reasons: {}, shownId: null } : null,
    stitch: withStitch
      ? {
          state: "running",
          phase: "fetch",
          done: 0,
          total: urls.length,
          name: `${stitchBase}.png`,
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
      const guess = extFromUrl(url) ?? "jpg";
      const number = String(i + 1).padStart(digits, "0");
      // 원본 이름으로 받을 때: 주소에 파일 이름이 없는 사진은 번호를 쓰고, 같은 이름이 또 나오면 " (2)"를 붙인다
      let name = (naming === "original" && originalBase(url)) || number;
      if (naming === "original") {
        const first = name;
        for (let n = 2; used.has(`${name}.${guess}`.toLowerCase()); n++) name = `${first} (${n})`;
        used.add(`${name}.${guess}`.toLowerCase());
      }
      return { job, kind: "file", url, base: `${BASE_FOLDER}/${dir}/${name}`, guess, id: null, named: false, ended: false };
    });
    let next = 0;
    const worker = async () => {
      while (next < plans.length) await begin(plans[next++]);
    };
    for (let i = 0; i < Math.min(STARTING, plans.length); i++) worker();
  }
  if (withStitch) startStitch(job, urls);
  return publicJob(job);
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target === "background") {
    onStitchMessage(message);
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
