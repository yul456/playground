// 확장 프로그램 창(팝업·사이드바)의 "영상" 줄: 지금 페이지의 영상을 찾아 보이고, 고른 것을 받는다 (사용자 요청, 2026-11-16).
// - 영상은 사진과 함께 저절로 받지 않는다. "영상" 버튼을 눌러 목록을 열고 골라 받는다 (사용자가 고른 방식. 영상은 용량이 크다)
// - 파일로 올라 있는 영상(<video>의 mp4·webm 주소, 영상 파일로 가는 링크)만 받는다. 스트리밍 영상은 목록에 보이되
//   받을 수 없다고 알린다 (영상이 있는데 왜 안 받아지는지 알 수 있게)
// - 받는 곳은 사진과 같은 폴더(다운로드 › 페이지 사진 › 제목)다. 같은 페이지에서 방금 사진을 받았으면 그 폴더에 함께 넣는다(background.js)
// - 열린 탭 받기에는 넣지 않았다 (탭마다 고르는 단계가 없다)
import { findVideos } from "./core.js";
import { videoBase, videoExtFromUrl } from "./names.js";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

const isFile = (item) => item.kind === "file";

// 길이를 0:35, 1:02:03처럼
function clock(seconds) {
  const total = Math.round(seconds);
  const s = String(total % 60).padStart(2, "0");
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function sizeText(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))}KB`;
}

// 영상의 용량을 묻는다 (받지는 않는다). 머리만 묻고(HEAD), 안 알려 주면 첫 바이트만 달라고 해서 전체 크기를 읽는다.
// 결과: { size: 바이트(모르면 null), blocked: 서버가 막았는지(401·403. 받을 때도 같은 대답이 온다) }
async function sizeOf(url) {
  const options = { credentials: "include", referrerPolicy: "no-referrer", cache: "no-store" };
  let blocked = false;
  try {
    const head = await fetch(url, { ...options, method: "HEAD" });
    const length = Number(head.headers.get("content-length"));
    if (head.ok && length > 0) return { size: length, blocked };
    blocked = head.status === 401 || head.status === 403;
  } catch {
    // HEAD를 받지 않는 서버
  }
  try {
    const part = await fetch(url, { ...options, headers: { Range: "bytes=0-0" } });
    const total = Number((part.headers.get("content-range") ?? "").split("/")[1]);
    part.body?.cancel().catch(() => {});
    if (part.ok && total > 0) return { size: total, blocked: false };
    blocked = part.status === 401 || part.status === 403;
  } catch {
    // 직접 여는 것을 막는 서버
  }
  return { size: null, blocked };
}

// 화면에 보일 영상 이름: 주소에 적힌 파일 이름
function nameOf(item) {
  if (!isFile(item)) return item.label || "스트리밍 영상";
  const ext = videoExtFromUrl(item.url);
  return `${videoBase(item.url) ?? "영상"}${ext ? `.${ext}` : ""}`;
}

// getFolder(): 받을 폴더 이름(popup.js가 사진에 쓰는 것), onStarted(job): 받기를 맡겼을 때 (진행은 창 아래쪽에 보인다)
export function mountVideos({ getFolder, onStarted }) {
  let tabId = null;
  let page = null; // { title, url, host, videos }
  // { ...찾은 영상, checked, size(바이트. undefined 아직 안 물음 · null 모름), blocked(서버가 막음), noPreview(미리보기를 못 불러옴), cell }
  let items = [];
  let run = 0; // 찾기를 시작한 차례. 탭을 빨리 바꾸면 늦게 끝난 앞 탭의 결과를 버린다
  let busy = false; // 다른 받기가 돌고 있다

  const files = () => items.filter(isFile);
  const chosen = () => items.filter((item) => isFile(item) && item.checked);

  function showButton(text) {
    const button = $("showVideos");
    const count = files().length;
    const streams = items.length - count;
    if (text) button.textContent = text;
    else if (count) button.textContent = `이 페이지 영상 ${count}개${streams ? ` · 스트리밍 ${streams}개` : ""}`;
    else if (streams) button.textContent = `스트리밍 영상 ${streams}개 (받을 수 없음)`;
    else button.textContent = "이 페이지에 영상 없음";
    button.disabled = Boolean(text) || !items.length;
  }

  function note(text, warn = false) {
    $("videosNote").textContent = text;
    $("videosNote").classList.toggle("warn", warn);
  }

  function metaText(item) {
    if (!isFile(item)) return "스트리밍이라 받을 수 없습니다";
    const parts = [];
    if (item.width && item.height) parts.push(`${item.width}×${item.height}`);
    if (item.duration) parts.push(clock(item.duration));
    const ext = videoExtFromUrl(item.url) ?? item.type.split("/")[1];
    if (ext) parts.push(ext);
    if (item.size) parts.push(sizeText(item.size));
    else if (item.size === undefined) parts.push("용량 묻는 중");
    if (item.from === "link") parts.push("링크");
    if (item.blocked) parts.push("사이트가 막아 받지 못할 수 있음");
    else if (item.noPreview) parts.push("미리보기 없음");
    return parts.join(" · ");
  }

  function refresh() {
    const picked = chosen();
    const count = files().length;
    for (const item of items) {
      if (!item.cell) continue;
      if (item.cell.box) {
        item.cell.box.checked = item.checked;
        item.cell.box.disabled = busy;
      }
      item.cell.meta.textContent = metaText(item);
    }
    const total = picked.reduce((sum, item) => sum + (item.size || 0), 0);
    const start = $("startVideos");
    start.disabled = busy || !picked.length;
    start.textContent = picked.length ? `영상 ${picked.length}개 받기${total ? ` (${sizeText(total)})` : ""}` : "영상 받기";
    $("toggleVideos").hidden = count < 2;
    $("toggleVideos").textContent = picked.length === count ? "모두 끄기" : "모두 고르기";
    $("toggleVideos").disabled = busy;
  }

  // 첫 장면: 포스터 그림이 있으면 그것, 없으면 영상의 머리만 받아 한 장면을 보인다. 길이와 화면 크기도 여기서 안다
  function thumbOf(item) {
    if (item.poster) return el("img", { className: "video-thumb", src: item.poster, alt: "", referrerPolicy: "no-referrer" });
    if (!isFile(item)) return el("span", { className: "video-thumb none", textContent: "▶" });
    const video = el("video", { className: "video-thumb", muted: true, preload: "metadata", playsInline: true });
    video.addEventListener("loadedmetadata", () => {
      item.width ||= video.videoWidth;
      item.height ||= video.videoHeight;
      if (!item.duration && Number.isFinite(video.duration)) item.duration = video.duration;
      refresh();
    });
    video.addEventListener("error", () => {
      item.noPreview = true;
      refresh();
    });
    // 조금 뒤의 장면을 보인다 (맨 처음은 검은 화면일 때가 많다)
    video.src = item.url.includes("#") ? item.url : `${item.url}#t=0.1`;
    return video;
  }

  function makeRow(item) {
    const meta = el("span", { className: "video-meta" });
    const info = el("span", { className: "video-info" }, [el("span", { className: "video-name", textContent: nameOf(item) }), meta]);
    let box = null;
    if (isFile(item)) {
      box = el("input", { type: "checkbox" });
      box.addEventListener("change", () => {
        item.checked = box.checked;
        refresh();
      });
    }
    const label = el("label", {}, [...(box ? [box] : []), thumbOf(item), info]);
    const li = el("li", { className: isFile(item) ? "video-item" : "video-item stream", title: isFile(item) ? item.url : "" }, [label]);
    item.cell = { li, box, meta };
    return li;
  }

  function render() {
    $("videoList").replaceChildren(...items.map(makeRow));
    const streams = items.length - files().length;
    $("videosHint").textContent = `고른 영상을 사진과 같은 폴더(다운로드 › 페이지 사진 › 제목)에 받습니다.${streams ? " 스트리밍 영상은 조각으로 나눠 보내는 방식이라 받을 수 없습니다." : ""}`;
    note("");
    refresh();
    // 용량은 목록을 열 때 한 번씩 묻는다
    for (const item of files()) {
      if (item.size !== undefined) continue;
      sizeOf(item.url).then(({ size, blocked }) => {
        item.size = size;
        item.blocked = blocked;
        refresh();
      });
    }
  }

  function close() {
    $("videos").hidden = true;
    $("videoList").replaceChildren(); // 미리보기를 불러오던 것을 그만둔다
    for (const item of items) item.cell = null;
  }

  function show() {
    if (!items.length) return;
    $("videos").hidden = false;
    render();
  }

  // 지금 탭의 영상을 찾는다 (창을 열 때, "다시 찾기", 사이드바에서 탭이나 페이지가 바뀔 때)
  async function scan(id) {
    tabId = id;
    const mine = ++run;
    showButton("영상 찾는 중");
    let found = null;
    try {
      if (tabId != null) found = await findVideos(tabId);
    } catch {
      // 크롬이 막는 페이지. 사진 쪽에서 알린다
    }
    if (mine !== run) return;
    // 같은 페이지를 다시 찾았으면 고른 것과 알아 둔 용량을 이어 간다
    const before = found && page && found.url === page.url ? new Map(items.map((item) => [item.url, item])) : new Map();
    page = found;
    items = (found?.videos ?? []).map((video) => {
      const old = before.get(video.url);
      return { ...video, checked: old?.checked ?? false, size: old?.size, blocked: old?.blocked ?? false, noPreview: false, cell: null };
    });
    // 받을 수 있는 영상이 하나뿐이면 골라 둔다
    if (!before.size && files().length === 1) files()[0].checked = true;
    showButton();
    if (!$("videos").hidden) {
      if (items.length) render();
      else close();
    }
  }

  async function start() {
    const urls = chosen().map((item) => item.url);
    if (!urls.length || busy || !page) return;
    $("startVideos").disabled = true;
    const reply = await chrome.runtime
      .sendMessage({ type: "start", kind: "video", folder: getFolder(), urls, pageUrl: page.url })
      .catch((err) => ({ error: err.message }));
    if (reply?.error) {
      note(reply.error, true);
      refresh();
      return;
    }
    note("받기를 시작했습니다. 진행은 아래에 보입니다.");
    onStarted(reply.job);
  }

  $("showVideos").addEventListener("click", () => ($("videos").hidden ? show() : close()));
  $("closeVideos").addEventListener("click", close);
  $("toggleVideos").addEventListener("click", () => {
    const all = chosen().length === files().length;
    for (const item of files()) item.checked = !all;
    refresh();
  });
  $("startVideos").addEventListener("click", start);
  showButton("영상 찾는 중");

  return {
    scan,
    // 다른 받기가 도는 동안에는 받기를 누르지 못한다
    setBusy(value) {
      busy = value;
      if (!$("videos").hidden) refresh();
    },
  };
}
