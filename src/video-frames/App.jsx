import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { fileSize, number } from "../shared/format.js";
import { JPG_QUALITIES } from "../shared/jpgQuality.js";
import { explainSaveError, saveToFolder } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { clockLabel, frameName, uniqueName } from "./names.js";
import { AMOUNT_LABELS, AMOUNTS, MIN_SCENES, detectScenes, difference, everyTimes } from "./scenes.js";
import { EVERY_MAX, EVERY_MIN, MAX_FRAMES, readSettings, STORAGE_KEY } from "./settings.js";
import { captureElement, captureFrame, closeVideo, openVideo, sampleRate, sampleVideo, VideoOpenError } from "./video.js";

// 영상 장면 뽑기 (사용자 요청, 2026-11-20). 구글 이미지 검색(렌즈)은 영상을 받지 않아서, 영상을 장면 사진으로 만들어 검색하려고 한다.
// - 자동으로 뽑기: 장면이 바뀔 때마다 한 장(scenes.js) 또는 몇 초마다 한 장
// - 직접 담기: 재생기에서 원하는 장면에 멈추고 "이 장면 담기"
// - 뽑은 그림은 페이지에 그대로 보여서, 오른쪽 클릭하면 크롬 메뉴의 구글 이미지 검색으로 바로 찾을 수 있다. 사진으로 저장도 한다
// 영상은 이 브라우저 안에서만 다룬다 (video.js, Mediabunny)

const VIDEO_NAME = /\.(mp4|m4v|mov|webm|mkv|ts|mts|m2ts|3gp|ogv)$/i;
const isVideoFile = (file) => file.type.startsWith("video/") || VIDEO_NAME.test(file.name);
// 뽑을 시각의 열쇠 (같은 시각을 두 번 뽑지 않게)
const keyOf = (t) => t.toFixed(4);
// 화면을 그 시각보다 아주 조금 뒤로 잡는다. 시각이 화면이 시작하는 시각과 꼭 같으면 계산 오차로 앞 화면이 잡힐 수 있다
const EPS = 1e-4;
// 그림을 만드는 동안 보일 미리보기 품질 (PNG로 저장할 때). JPG면 고른 품질로 만들어 그대로 저장한다
const PREVIEW_QUALITY = 92;
const CODECS = { avc: "H.264", hevc: "HEVC(H.265)", vp8: "VP8", vp9: "VP9", av1: "AV1" };

const OPEN_ERRORS = {
  format: "영상 파일로 읽지 못했습니다. MP4·MOV·WebM·MKV 영상을 골라 주세요.",
  "no-video": "이 파일에는 영상이 없습니다.",
  read: "영상을 읽다가 오류가 났습니다.",
};

function loadSettings() {
  try {
    return readSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return readSettings(null);
  }
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

// 그 폴더에 있는 이름들 (소문자)
async function namesIn(dir) {
  const names = new Set();
  for await (const entry of dir.values()) names.add(entry.name.toLowerCase());
  return names;
}

// 끌어다 놓은 것에서 영상 파일과 (되면) 파일 핸들을 꺼낸다. 핸들이 있으면 저장할 폴더를 고를 때 영상의 폴더에서 연다
async function droppedVideo(event) {
  const items = [...(event.dataTransfer?.items ?? [])].filter((item) => item.kind === "file");
  for (const item of items) {
    const file = item.getAsFile();
    if (!file || !isVideoFile(file)) continue;
    const handle = await item.getAsFileSystemHandle?.().catch(() => null);
    return { file, handle: handle?.kind === "file" ? handle : null };
  }
  const file = [...(event.dataTransfer?.files ?? [])][0];
  return file ? { file, handle: null } : null;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // 고른 영상: { name, size, url(재생기 주소), handle, opening, info: { start, duration, width, height, codec, fps, decodable } }
  const [video, setVideo] = useState(null);
  const [notice, setNotice] = useState("");
  const [playable, setPlayable] = useState(true);
  // 장면 찾기: idle · running · done · stopped · failed. progress 0~1
  const [scan, setScan] = useState({ state: "idle", progress: 0 });
  const scanRef = useRef(scan);
  scanRef.current = scan;
  // 자동으로 뽑은 시각과 직접 담은 시각
  const [autoTimes, setAutoTimes] = useState([]);
  // 찾은 장면이 적어 더 고른 장 수 (MIN_SCENES)
  const [filled, setFilled] = useState(0);
  const [manualTimes, setManualTimes] = useState([]);
  // 만든 그림: key → { t, url, blob, type, quality, width, height } · { error }
  const [frames, setFrames] = useState({});
  const framesRef = useRef(frames);
  // 저장하지 않을(체크를 끈) 장면, 목록에서 뺀 자동 장면
  const [off, setOff] = useState(() => new Set());
  const [gone, setGone] = useState(() => new Set());
  const [saving, setSaving] = useState(null);
  const [saved, setSaved] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [now, setNow] = useState(0);
  const [everyText, setEveryText] = useState(String(settings.every));
  const playerRef = useRef(null);
  const fileInput = useRef(null);
  const openedRef = useRef(null); // Mediabunny로 연 영상 (video.js의 openVideo)
  const urlRef = useRef(null);
  const runRef = useRef(0); // 영상을 새로 열 때마다 올린다
  const scanRunRef = useRef(0); // 장면 찾기를 새로 시작할 때마다 올린다
  const stopRef = useRef(false);
  const samplesRef = useRef([]);
  const diffsRef = useRef([]);
  const scannedRef = useRef(false);
  const queueRef = useRef([]); // 만들 그림 [{ key, t, run }]
  const pumpingRef = useRef(false);
  // 화면을 원래 크기로 만드는 일(그림 칸 하나를 돌려 쓴다)은 한 번에 하나씩 한다
  const decoderRef = useRef(Promise.resolve());
  const withDecoder = useCallback((work) => {
    const next = decoderRef.current.then(work, work);
    decoderRef.current = next.catch(() => {});
    return next;
  }, []);

  const update = (patch) => setSettings((old) => readSettings({ ...old, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장소를 못 쓰면 이번 화면에서만 쓴다
    }
  }, [settings]);

  const putFrames = useCallback((next) => {
    framesRef.current = next;
    setFrames(next);
  }, []);

  // 줄 서 있는 그림을 하나씩 만든다
  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      while (queueRef.current.length) {
        const job = queueRef.current.shift();
        const opened = openedRef.current;
        if (!opened || job.run !== runRef.current || framesRef.current[job.key]) continue;
        const { format, quality } = settingsRef.current;
        const q = format === "jpg" ? quality : PREVIEW_QUALITY;
        let frame;
        try {
          const made = await withDecoder(() => captureFrame(opened, job.t + EPS, "image/jpeg", q / 100));
          frame = made ? { ...made, type: "image/jpeg", quality: q, url: URL.createObjectURL(made.blob) } : { error: "이 시각의 화면을 찾지 못했습니다." };
        } catch (err) {
          frame = { error: err?.message || "그림을 만들지 못했습니다." };
        }
        if (job.run !== runRef.current) {
          if (frame.url) URL.revokeObjectURL(frame.url);
          continue;
        }
        putFrames({ ...framesRef.current, [job.key]: frame });
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [putFrames, withDecoder]);

  // 그 시각들의 그림을 만들게 한다 (front: 맨 앞에 끼워 넣는다. 직접 담은 장면)
  const want = useCallback(
    (times, front = false) => {
      const run = runRef.current;
      const queued = new Set(queueRef.current.map((job) => job.key));
      const jobs = times.map((t) => ({ key: keyOf(t), t, run })).filter((job) => !framesRef.current[job.key] && !queued.has(job.key));
      if (!jobs.length) return;
      queueRef.current = front ? [...jobs, ...queueRef.current] : [...queueRef.current, ...jobs];
      pump();
    },
    [pump],
  );

  // 목록에 없는 장면의 그림은 버린다 (메모리)
  useEffect(() => {
    const keep = new Set([...autoTimes, ...manualTimes].map(keyOf));
    queueRef.current = queueRef.current.filter((job) => keep.has(job.key));
    const current = framesRef.current;
    const stale = Object.keys(current).filter((key) => !keep.has(key));
    if (!stale.length) return;
    const next = { ...current };
    for (const key of stale) {
      if (next[key].url) URL.revokeObjectURL(next[key].url);
      delete next[key];
    }
    putFrames(next);
  }, [autoTimes, manualTimes, putFrames]);

  // 찾은 장면에서 고른 시각을 목록에 둔다. 읽는 중이면 끝난(닫힌) 장면만
  const showScenes = useCallback(
    (done) => {
      if (settingsRef.current.mode !== "scenes") return;
      const scenes = detectScenes(samplesRef.current, AMOUNTS[settingsRef.current.amount], { diffs: diffsRef.current, done, atLeast: MIN_SCENES });
      const shown = scenes.filter((scene) => scene.closed).slice(0, MAX_FRAMES);
      const times = shown.map((scene) => scene.pick);
      setFilled(shown.filter((scene) => scene.filled).length);
      setAutoTimes((old) => (sameList(old, times) ? old : times));
      want(times);
    },
    [want],
  );

  const startScan = useCallback(async () => {
    const opened = openedRef.current;
    if (!opened?.decodable) return;
    const run = runRef.current;
    const myScan = ++scanRunRef.current;
    const live = () => scanRunRef.current === myScan && runRef.current === run;
    stopRef.current = false;
    scannedRef.current = false;
    samplesRef.current = [];
    diffsRef.current = [];
    setScan({ state: "running", progress: 0 });
    const rate = sampleRate(opened);
    let nextShow = 30;
    let lastUi = 0;
    let failed = null;
    let progress = 0;
    try {
      for await (const sample of sampleVideo(opened, rate, () => !live() || stopRef.current)) {
        if (!live()) return;
        const samples = samplesRef.current;
        diffsRef.current.push(samples.length ? difference(samples[samples.length - 1].sig, sample.sig) : 0);
        samples.push(sample);
        progress = Math.min(1, (sample.t - opened.start) / Math.max(opened.duration, 0.001));
        if (samples.length >= nextShow) {
          // 찾은 장면을 읽는 동안에도 보인다. 점점 드물게 다시 센다 (모양이 많아질수록 한 번 세는 데 오래 걸린다)
          nextShow = Math.ceil(samples.length * 1.2) + 20;
          showScenes(false);
        }
        if (performance.now() - lastUi > 250) {
          lastUi = performance.now();
          setScan({ state: "running", progress });
        }
      }
    } catch (err) {
      failed = err;
    }
    if (!live()) return;
    scannedRef.current = true;
    showScenes(true);
    if (failed) setScan({ state: "failed", progress, error: failed?.message ?? String(failed) });
    else setScan({ state: stopRef.current ? "stopped" : "done", progress: stopRef.current ? progress : 1 });
  }, [showScenes]);

  // 고른 방법대로 자동으로 뽑는다
  const autoExtract = useCallback(() => {
    const opened = openedRef.current;
    if (!opened?.decodable) return;
    const { mode, every } = settingsRef.current;
    if (mode === "every") {
      const times = everyTimes(opened.start, opened.duration, every, MAX_FRAMES);
      setAutoTimes((old) => (sameList(old, times) ? old : times));
      want(times);
    } else if (scanRef.current.state === "running") {
      showScenes(false);
    } else if (scannedRef.current) {
      showScenes(true);
    } else {
      startScan();
    }
  }, [showScenes, startScan, want]);

  // 방법·장면 수·간격을 바꾸면 다시 뽑는다 (장면은 읽어 둔 모양으로 다시 세어서 영상을 다시 읽지 않는다)
  useEffect(() => {
    if (openedRef.current) autoExtract();
  }, [settings.mode, settings.amount, settings.every, autoExtract]);

  function forgetVideo() {
    runRef.current++;
    scanRunRef.current++;
    stopRef.current = true;
    queueRef.current = [];
    closeVideo(openedRef.current);
    openedRef.current = null;
    for (const frame of Object.values(framesRef.current)) if (frame.url) URL.revokeObjectURL(frame.url);
    putFrames({});
    samplesRef.current = [];
    diffsRef.current = [];
    scannedRef.current = false;
    setAutoTimes([]);
    setManualTimes([]);
    setOff(new Set());
    setGone(new Set());
    setSaved(null);
    setNotice("");
    setNow(0);
  }

  // 재생기 주소는 새 영상으로 바뀐 뒤에 버린다 (재생기가 아직 쓰는 중에 버리면 오류가 나서 새 영상도 재생되지 않는 것으로 보일 수 있다)
  useEffect(() => {
    const url = video?.url;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [video?.url]);

  async function openFile(file, handle = null) {
    if (!file) return;
    if (!isVideoFile(file)) {
      setNotice("영상 파일을 골라 주세요.");
      return;
    }
    if (saving) return;
    forgetVideo();
    const url = URL.createObjectURL(file);
    urlRef.current = url;
    setPlayable(true);
    setVideo({ name: file.name, size: file.size, url, handle, opening: true, info: null });
    setScan({ state: "idle", progress: 0 });
    const run = runRef.current;
    let opened;
    try {
      opened = await openVideo(file);
    } catch (err) {
      if (run !== runRef.current) return;
      setVideo((old) => old && { ...old, opening: false });
      const kind = err instanceof VideoOpenError ? err.kind : "read";
      setNotice(`${OPEN_ERRORS[kind]}${kind === "read" ? ` (${err?.message ?? err})` : ""}`);
      return;
    }
    if (run !== runRef.current) {
      closeVideo(opened);
      return;
    }
    openedRef.current = opened;
    const { start, duration, width, height, codec, fps, decodable } = opened;
    setVideo((old) => old && { ...old, opening: false, info: { start, duration, width, height, codec, fps, decodable } });
    if (!decodable) {
      setNotice(
        `이 영상의 코덱(${CODECS[codec] ?? codec ?? "알 수 없음"})은 이 브라우저가 풀지 못해 장면을 자동으로 뽑을 수 없습니다. 재생이 되면 "이 장면 담기"로 직접 담을 수는 있습니다.`,
      );
      return;
    }
    autoExtract();
  }

  async function pickVideo() {
    if (typeof window.showOpenFilePicker === "function") {
      try {
        const [handle] = await window.showOpenFilePicker({
          id: "video-frames-open",
          types: [{ description: "영상", accept: { "video/*": [".mp4", ".m4v", ".mov", ".webm", ".mkv", ".ts", ".mts", ".m2ts", ".3gp"] } }],
        });
        openFile(await handle.getFile(), handle);
      } catch (err) {
        if (err?.name !== "AbortError") fileInput.current?.click();
      }
      return;
    }
    fileInput.current?.click();
  }

  // 창 밖으로 떨어뜨린 파일을 브라우저가 열어 이 화면을 떠나지 않게 한다
  useEffect(() => {
    const stop = (event) => event.preventDefault();
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);

  // 재생기 옮기기
  const playerTime = () => (openedRef.current?.start ?? 0) + (playerRef.current?.currentTime ?? 0);
  function step(direction) {
    const el = playerRef.current;
    if (!el) return;
    el.pause();
    const fps = openedRef.current?.fps || 30;
    const end = Number.isFinite(el.duration) ? el.duration : Infinity;
    el.currentTime = Math.max(0, Math.min(end, el.currentTime + direction / fps));
  }
  function seek(t) {
    const el = playerRef.current;
    if (!el) return;
    el.pause();
    el.currentTime = Math.max(0, t - (openedRef.current?.start ?? 0));
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // 지금 재생기에 보이는 장면을 담는다
  async function captureNow() {
    const el = playerRef.current;
    if (!el || !video || video.opening) return;
    el.pause();
    const t = playerTime();
    const key = keyOf(t);
    setManualTimes((list) => (list.some((x) => keyOf(x) === key) ? list : [...list, t]));
    setGone((old) => {
      if (!old.has(key)) return old;
      const next = new Set(old);
      next.delete(key);
      return next;
    });
    if (openedRef.current?.decodable) {
      want([t], true);
      return;
    }
    // 이 브라우저가 풀 수 없는 영상: 재생기에 보이는 화면을 그대로 그린다
    try {
      const made = await captureElement(el, "image/jpeg", settingsRef.current.quality / 100);
      if (framesRef.current[key]) return;
      putFrames({ ...framesRef.current, [key]: { ...made, t, type: "image/jpeg", quality: settingsRef.current.quality, url: URL.createObjectURL(made.blob) } });
    } catch (err) {
      putFrames({ ...framesRef.current, [key]: { error: err?.message || "그림을 만들지 못했습니다." } });
    }
  }

  // 쉼표·마침표로 한 프레임씩 옮긴다 (유튜브와 같은 키). 글을 치는 중에는 두지 않는다
  useEffect(() => {
    const onKey = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
      if (event.key === ",") step(-1);
      else if (event.key === ".") step(1);
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // step은 ref만 써서 처음 만든 것을 그대로 써도 된다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 목록에 보일 장면: 자동(뺀 것 말고) + 직접, 시각 순서
  const shown = useMemo(() => {
    const items = new Map();
    for (const t of autoTimes) {
      const key = keyOf(t);
      if (!gone.has(key)) items.set(key, { key, t, manual: false });
    }
    for (const t of manualTimes) items.set(keyOf(t), { key: keyOf(t), t, manual: true });
    return [...items.values()].sort((a, b) => a.t - b.t);
  }, [autoTimes, manualTimes, gone]);
  const ready = shown.filter((item) => frames[item.key]?.blob);
  const picked = ready.filter((item) => !off.has(item.key));

  function removeItem(item) {
    setManualTimes((list) => list.filter((t) => keyOf(t) !== item.key));
    if (autoTimes.some((t) => keyOf(t) === item.key)) setGone((old) => new Set(old).add(item.key));
  }
  function setChecked(key, checked) {
    setOff((old) => {
      const next = new Set(old);
      if (checked) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll() {
    const all = ready.every((item) => !off.has(item.key));
    setOff(all ? new Set(ready.map((item) => item.key)) : new Set());
  }

  async function save() {
    const opened = openedRef.current;
    const list = picked.slice();
    if (!list.length || !video) return;
    let dir = null;
    if (canPickFolder()) {
      try {
        dir = await window.showDirectoryPicker({ id: "video-frames-save", mode: "readwrite", ...(video.handle ? { startIn: video.handle } : {}) });
      } catch (err) {
        if (err?.name === "AbortError") return;
        dir = null; // 폴더를 고르지 못하는 브라우저면 다운로드로 받는다
      }
    }
    const { format, quality } = settingsRef.current;
    const type = format === "png" ? "image/png" : "image/jpeg";
    const taken = dir ? await namesIn(dir).catch(() => new Set()) : new Set();
    const long = (video.info?.duration ?? 0) >= 3600;
    const start = opened?.start ?? video.info?.start ?? 0;
    const result = { saved: 0, downloaded: 0, failed: [], folder: dir?.name ?? null };
    setSaved(null);
    setSaving({ done: 0, total: list.length });
    for (const [i, item] of list.entries()) {
      const frame = framesRef.current[item.key];
      if (!frame?.blob) continue;
      let blob = frame.blob;
      let ext = "jpg";
      // 보이는 그림이 고른 형식·품질과 다르면 그 형식으로 다시 만든다 (PNG, 다른 품질)
      if (type !== frame.type || (type === "image/jpeg" && quality !== frame.quality)) {
        const made = opened?.decodable ? await withDecoder(() => captureFrame(opened, frame.t + EPS, type, quality / 100)).catch(() => null) : null;
        if (made) {
          blob = made.blob;
          ext = format;
        }
      } else {
        ext = format;
      }
      const name = uniqueName(frameName(video.name, frame.t - start, ext, long), taken);
      if (dir) {
        const res = await saveToFolder(dir, name, blob);
        if (res.ok) result.saved++;
        else {
          download(blob, name);
          result.downloaded++;
          result.failed.push({ name, why: explainSaveError(res.error).text });
        }
      } else {
        download(blob, name);
        result.downloaded++;
      }
      setSaving({ done: i + 1, total: list.length });
    }
    setSaving(null);
    setSaved(result);
  }

  const info = video?.info;
  const infoLine = info
    ? [
        `길이 ${clockLabel(info.duration)}`,
        `${number(info.width)}×${number(info.height)}`,
        CODECS[info.codec] ?? info.codec,
        `${Math.round(info.fps * 100) / 100}fps`,
        fileSize(video.size),
      ]
        .filter(Boolean)
        .join(" · ")
    : video?.opening
      ? "여는 중…"
      : fileSize(video?.size ?? 0);
  const scanning = scan.state === "running";
  const busy = Boolean(saving);

  let scanText = "";
  if (settings.mode === "scenes") {
    if (scanning) scanText = `장면을 찾는 중… ${Math.floor(scan.progress * 100)}% · 지금까지 ${number(autoTimes.length)}장`;
    else if (scan.state === "done")
      scanText = filled
        ? `장면 ${number(autoTimes.length - filled)}개를 찾았고, ${MIN_SCENES}장이 되게 ${number(filled)}장을 더 골랐습니다.`
        : `장면 ${number(autoTimes.length)}개를 찾았습니다.`;
    else if (scan.state === "stopped") scanText = `영상의 ${Math.floor(scan.progress * 100)}%까지 보고 멈췄습니다. 거기까지 장면 ${number(autoTimes.length)}개.`;
    else if (scan.state === "failed") scanText = `영상을 읽다가 멈췄습니다(${scan.error}). 거기까지 장면 ${number(autoTimes.length)}개.`;
  } else if (info?.decodable) {
    scanText = `${settings.every}초마다 ${number(autoTimes.length)}장`;
  }
  const capped = autoTimes.length >= MAX_FRAMES;

  return (
    <main
      className={`container vf-page${dragging ? " dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setDragging(false);
        const dropped = await droppedVideo(event);
        if (dropped) openFile(dropped.file, dropped.handle);
      }}
    >
      <a className="back-link" href={HUB_URL}>
        ← Playground
      </a>
      <header>
        <h1>영상 장면 뽑기</h1>
        <p className="subtitle">
          영상에서 장면이 바뀔 때마다 한 장씩 뽑아 보여 줍니다. 원하는 장면은 재생하다 멈추고 직접 담을 수 있습니다. 뽑은 그림을 오른쪽
          클릭하면 크롬 메뉴의 구글 이미지 검색(렌즈)으로 그 장면을 찾을 수 있고, 사진으로 저장할 수도 있습니다. 영상은 이 PC 밖으로 나가지
          않고 브라우저 안에서만 다룹니다.
        </p>
      </header>

      <section className="card">
        <div className="vf-actions">
          <button type="button" onClick={pickVideo} disabled={busy}>
            {video ? "다른 영상 고르기" : "영상 고르기"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="video/*,.mkv,.ts,.mts,.m2ts"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) openFile(file);
            }}
          />
        </div>
        <p className="vf-hint">영상을 이 화면에 끌어다 놓아도 됩니다. 크롬이 푸는 영상(MP4·MOV·WebM 등)이면 됩니다.</p>
        {notice && (
          <p className="vf-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {video && (
        <section className="card">
          <div className="vf-head">
            <h2 className="vf-name">{video.name}</h2>
            <span className="vf-muted">{infoLine}</span>
          </div>
          {playable ? (
            <video
              ref={playerRef}
              className="vf-player"
              src={video.url}
              controls
              preload="metadata"
              onTimeUpdate={(event) => setNow(event.currentTarget.currentTime)}
              onSeeked={(event) => setNow(event.currentTarget.currentTime)}
              onError={(event) => {
                // 앞 영상의 주소에서 늦게 온 오류는 넘긴다
                if (event.currentTarget.getAttribute("src") === urlRef.current) setPlayable(false);
              }}
            />
          ) : (
            <p className="vf-notice">이 영상은 이 브라우저에서 재생되지 않아 직접 담기는 쓸 수 없습니다. 자동으로 뽑은 장면은 볼 수 있습니다.</p>
          )}
          {playable && (
            <>
              <div className="vf-controls">
                <button type="button" className="secondary" onClick={() => step(-1)} aria-label="한 프레임 앞으로">
                  ◀ 1프레임
                </button>
                <button type="button" onClick={captureNow} disabled={video.opening}>
                  이 장면 담기
                </button>
                <button type="button" className="secondary" onClick={() => step(1)} aria-label="한 프레임 뒤로">
                  1프레임 ▶
                </button>
                <span className="vf-muted vf-now">지금 {clockLabel(now)}</span>
              </div>
              <p className="vf-hint">원하는 장면에서 멈추고 "이 장면 담기"를 누르면 아래 목록에 더해집니다. 쉼표(,)·마침표(.) 키로 한 프레임씩 옮깁니다.</p>
            </>
          )}
        </section>
      )}

      {info?.decodable && (
        <section className="card">
          <h2 className="vf-title">자동으로 뽑기</h2>
          <div className="vf-options" role="radiogroup" aria-label="뽑는 방법">
            <label>
              <input type="radio" name="mode" checked={settings.mode === "scenes"} onChange={() => update({ mode: "scenes" })} />
              장면이 바뀔 때마다
            </label>
            <label>
              <input type="radio" name="mode" checked={settings.mode === "every"} onChange={() => update({ mode: "every" })} />
              <input
                type="number"
                className="vf-every"
                min={EVERY_MIN}
                max={EVERY_MAX}
                step="0.5"
                value={everyText}
                aria-label="몇 초마다"
                onFocus={() => update({ mode: "every" })}
                onChange={(event) => {
                  setEveryText(event.target.value);
                  const value = Number(event.target.value);
                  if (event.target.value !== "" && Number.isFinite(value) && value >= EVERY_MIN && value <= EVERY_MAX) update({ every: value });
                }}
                onBlur={() => setEveryText(String(settingsRef.current.every))}
              />
              초마다
            </label>
          </div>
          {settings.mode === "scenes" && (
            <div className="vf-options" role="radiogroup" aria-label="장면 수">
              <span className="vf-muted">장면 수</span>
              {Object.keys(AMOUNTS).map((amount) => (
                <label key={amount}>
                  <input type="radio" name="amount" checked={settings.amount === amount} onChange={() => update({ amount })} />
                  {AMOUNT_LABELS[amount]}
                </label>
              ))}
            </div>
          )}
          <div className="vf-scan">
            <span className={scan.state === "failed" ? "vf-notice" : "vf-muted"} role="status">
              {scanText}
            </span>
            {settings.mode === "scenes" && scanning && (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  stopRef.current = true;
                }}
              >
                멈추기
              </button>
            )}
            {settings.mode === "scenes" && (scan.state === "stopped" || scan.state === "failed") && (
              <button type="button" className="secondary" onClick={startScan} disabled={busy}>
                처음부터 다시 찾기
              </button>
            )}
          </div>
          {scanning && <progress className="vf-progress" max="1" value={scan.progress} />}
          {capped && <p className="vf-notice">자동으로 뽑는 장면은 {number(MAX_FRAMES)}장까지입니다. 장면 수를 줄이거나 간격을 늘려 보세요.</p>}
          {settings.mode === "scenes" && (
            <p className="vf-hint">
              화면이 갑자기 바뀌거나 천천히 바뀌어 많이 달라진 곳마다 한 장씩 뽑습니다. 장면마다 그 장면다운 화면을 고르고, 검은 화면처럼 한
              가지 색뿐인 장면은 뺍니다. 장면이 {MIN_SCENES}개보다 적으면 서로 다르게 생긴 화면을 더 골라 {MIN_SCENES}장을 채웁니다. 너무 많거나 적으면 장면 수를 바꿔 보세요(영상을 다시 읽지 않고 바로 다시 고릅니다).
            </p>
          )}
        </section>
      )}

      {shown.length > 0 && (
        <section className="card">
          <div className="vf-toolbar">
            <h2 className="vf-title">뽑은 장면 {number(shown.length)}장</h2>
            <span className="vf-muted">저장할 것 {number(picked.length)}장</span>
            <button type="button" className="secondary" onClick={toggleAll} disabled={!ready.length || busy}>
              {ready.length && ready.every((item) => !off.has(item.key)) ? "모두 끄기" : "모두 고르기"}
            </button>
          </div>
          <p className="vf-tip">
            그림을 <b>오른쪽 클릭</b>하면 나오는 크롬 메뉴의 구글 이미지 검색("Google로 이미지 검색" 등, 크롬 판에 따라 이름이 조금 다릅니다)으로 그
            장면을 찾을 수 있습니다. 시각을 누르면 재생기가 그 장면으로 갑니다.
          </p>
          <ul className="vf-grid">
            {shown.map((item) => {
              const frame = frames[item.key];
              const label = clockLabel((frame?.t ?? item.t) - (info?.start ?? 0));
              return (
                <li key={item.key} className={off.has(item.key) ? "off" : undefined}>
                  <div className="vf-shot">
                    {frame?.url ? (
                      <img src={frame.url} alt={`${label} 장면`} width={frame.width} height={frame.height} />
                    ) : (
                      <span className={frame?.error ? "vf-error" : "vf-muted"}>{frame?.error ?? "그림을 만드는 중…"}</span>
                    )}
                  </div>
                  <div className="vf-caption">
                    <input
                      type="checkbox"
                      checked={!off.has(item.key)}
                      disabled={!frame?.blob || busy}
                      aria-label={`${label} 장면 저장하기`}
                      onChange={(event) => setChecked(item.key, event.target.checked)}
                    />
                    <button type="button" className="vf-time" onClick={() => seek(frame?.t ?? item.t)} disabled={!playable}>
                      {label}
                    </button>
                    {item.manual && <span className="vf-badge">직접 담음</span>}
                    <button type="button" className="vf-remove" onClick={() => removeItem(item)} aria-label={`${label} 장면 빼기`} disabled={busy}>
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="vf-save">
            <div className="vf-options" role="radiogroup" aria-label="저장 형식">
              <label>
                <input type="radio" name="format" checked={settings.format === "jpg"} onChange={() => update({ format: "jpg" })} disabled={busy} />
                JPG
              </label>
              {settings.format === "jpg" && (
                <label>
                  품질
                  <select value={settings.quality} onChange={(event) => update({ quality: Number(event.target.value) })} disabled={busy}>
                    {JPG_QUALITIES.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label>
                <input type="radio" name="format" checked={settings.format === "png"} onChange={() => update({ format: "png" })} disabled={busy} />
                PNG <span className="vf-muted">(화질 그대로, 큼)</span>
              </label>
            </div>
            <button type="button" onClick={save} disabled={!picked.length || busy}>
              {saving ? `저장하는 중… ${number(saving.done)}/${number(saving.total)}` : `고른 장면 저장 (${number(picked.length)}장)`}
            </button>
          </div>
          <p className="vf-hint">
            영상 원래 크기 그대로 저장합니다. 이름은 영상 이름 뒤에 그 장면의 시각을 붙입니다(예: {frameName(video?.name ?? "영상", 72.5, settings.format)}).
            {canPickFolder() ? " 저장할 폴더를 한 번 묻습니다. 같은 이름이 있으면 번호를 붙입니다." : " 다운로드 폴더로 받습니다."}
          </p>
          {saved && (
            <p className={saved.failed.length ? "vf-notice" : "vf-ok"} role="status">
              {saved.folder ? `${number(saved.saved)}장을 "${saved.folder}" 폴더에 저장했습니다.` : `${number(saved.downloaded)}장을 다운로드 폴더로 받았습니다.`}
              {saved.failed.length > 0 && ` 저장하지 못한 ${number(saved.failed.length)}장은 다운로드 폴더로 받았습니다(${saved.failed[0].why}).`}
            </p>
          )}
        </section>
      )}
    </main>
  );
}
