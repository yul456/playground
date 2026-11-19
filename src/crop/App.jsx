import { useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { compareNames } from "../shared/fileNames.js";
import { fileSize, number } from "../shared/format.js";
import { JPG_QUALITIES } from "../shared/jpgQuality.js";
import { explainSaveError, saveToFolder } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { cropFile } from "./cropJobs.js";
import Editor from "./Editor.jsx";
import { imageSize } from "./imageMeta.js";
import {
  clampCrop,
  cleanName,
  croppedSize,
  DEFAULT_FOLDER,
  IMAGE_NAME,
  isZero,
  outputType,
  planSaves,
  readSettings,
  rememberSize,
  SIDES,
  sizeKey,
  STORAGE_KEY,
  ZERO,
} from "./rules.js";
import { fitAt, trimMargins } from "./regions.js";
import Thumb from "./Thumb.jsx";

const SIDE_LABELS = { top: "위", bottom: "아래", left: "왼쪽", right: "오른쪽" };
// 크기마다의 자를 곳이 어디서 왔는지 (고르는 칸 아래에 알린다)
const ORIGIN_TEXT = {
  remembered: "지난번에 이 크기 사진에 쓴 값입니다.",
};
// 이보다 화소가 많은 사진은 끌 때 직선 경계에 붙이지 않는다 (화소를 미리 읽어 두면 메모리를 4바이트씩 쓴다)
const SNAP_PIXELS = 40_000_000;

const reader = (blob) => async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
const isImage = (name) => IMAGE_NAME.test(name) && !name.startsWith(".");
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

function loadSettings() {
  try {
    return readSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
    return readSettings(null);
  }
}

let seq = 1;
// 사진 하나: { id, name, type, size: { width, height }(보이는 크기), bytes, error, own: 이 사진만의 자를 곳(없으면 같은 크기의 값), checked, load() }
function newPhoto({ name, handle = null, file = null }) {
  const photo = { id: `p${seq++}`, name, type: file?.type ?? "", size: null, bytes: file?.size ?? 0, error: "", own: null, checked: true };
  photo.load = () => (file ? Promise.resolve(file) : handle.getFile());
  photo.handle = handle;
  return photo;
}

// 머리에서 크기를 읽지 못하는 형식(WebP 등)은 열어서 본다
async function sizeOf(file) {
  const size = await imageSize(reader(file)).catch(() => null);
  if (size) return size;
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const found = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return found;
}

// 그림의 화소 { width, height, data } (끌 때 직선 경계에 붙이기, 누른 곳에 맞추기, 여백 자르기에 쓴다)
function pixelsFrom(bitmap) {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: ctx.getImageData(0, 0, bitmap.width, bitmap.height).data };
}

async function pixelsOf(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    return pixelsFrom(bitmap);
  } finally {
    bitmap.close();
  }
}

// 되돌리기에 남길 고친 기록의 수와, 이 시간(ms) 안에 이어서 누른 화살표 키·숫자 칸 고치기는 한 번으로 친다
const HISTORY = 100;
const HISTORY_GAP = 700;

// 그 폴더에 있는 이름들 (소문자)
async function namesIn(dir) {
  const names = new Set();
  for await (const entry of dir.values()) names.add(entry.name.toLowerCase());
  return names;
}

// list를 limit개씩 함께 돌린다
async function eachLimit(list, limit, work) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, list.length) }, async () => {
    while (next < list.length) {
      const i = next++;
      await work(list[i], i);
    }
  });
  await Promise.all(runners);
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 고른 것: { kind: folder(폴더를 골라 그 폴더에 저장할 수 있다) · files(고른 사진, 저장할 때 폴더를 묻는다), name, dir, startIn }
  const [source, setSource] = useState(null);
  const [photos, setPhotos] = useState([]);
  // 크기마다의 자를 곳과 그 값이 어디서 왔는지
  const [crops, setCrops] = useState({});
  const [origins, setOrigins] = useState({});
  const [currentId, setCurrentId] = useState(null);
  const [active, setActive] = useState("top");
  const [bitmap, setBitmap] = useState(null);
  // 고치고 있는 사진의 화소 (끌 때 직선 경계에 붙인다. 아주 큰 사진은 null)
  const [pixels, setPixels] = useState(null);
  const [status, setStatus] = useState("idle"); // idle · reading · ready · saving · done
  const [progress, setProgress] = useState(null);
  const [results, setResults] = useState({});
  const [notice, setNotice] = useState("");
  const [editorNote, setEditorNote] = useState("");
  const [dragging, setDragging] = useState(false);
  const runRef = useRef(0);
  // 되돌리기: [{ photoId, key, own, crop }] (고치기 전의 값). 마지막으로 남긴 때
  const historyRef = useRef([]);
  const recordedRef = useRef(0);
  const lastKindRef = useRef("");
  const [historyCount, setHistoryCount] = useState(0);
  // 고치고 있는 사진의 화소 { id, image } (누를 때마다 다시 읽지 않게)
  const pixelsRef = useRef(null);
  const currentRef = useRef(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const stopRef = useRef(false);
  const savingRef = useRef(null);
  const folderInput = useRef(null);
  const fileInput = useRef(null);
  const busy = status === "reading" || status === "saving";
  // 칸에는 친 그대로 두고(빈칸·지우기를 칠 수 있게), 쓸 때 파일 이름에 못 쓰는 글자를 뺀다
  const folderName = cleanName(settings.folderName) || DEFAULT_FOLDER;
  const suffix = cleanName(settings.suffix);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  // 저장하는 동안 탭을 닫거나 새로 고치려 하면 브라우저가 한 번 묻게 한다
  useEffect(() => {
    if (status !== "saving") return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [status]);

  const current = photos.find((p) => p.id === currentId) ?? null;
  currentRef.current = current;
  const keyOf = (photo) => sizeKey(photo.size.width, photo.size.height);
  const cropOf = (photo) => (photo?.size ? clampCrop(photo.own ?? crops[keyOf(photo)] ?? ZERO, photo.size.width, photo.size.height) : ZERO);

  // 고치고 있는 사진을 연다 (화면에 보일 색으로). 끌 때 직선 경계에 붙이려고 화소도 읽어 둔다
  useEffect(() => {
    setEditorNote("");
    setPixels(null);
    if (!current?.size) {
      setBitmap(null);
      return undefined;
    }
    let alive = true;
    const photo = current;
    photo
      .load()
      .then((file) => createImageBitmap(file, { imageOrientation: "from-image" }))
      .then((made) => {
        if (!alive) {
          made.close();
          return;
        }
        setBitmap((old) => {
          old?.close();
          return made;
        });
        if (made.width * made.height <= SNAP_PIXELS) {
          const image = pixelsFrom(made);
          pixelsRef.current = { id: photo.id, image };
          setPixels(image);
        }
      })
      .catch(() => alive && setEditorNote("이 사진을 열지 못했습니다."));
    return () => {
      alive = false;
    };
  }, [currentId, current?.size]);

  async function open(entries, from) {
    const run = ++runRef.current;
    const list = entries
      .filter((entry) => isImage(entry.name))
      .sort((a, b) => compareNames(a.name, b.name))
      .map(newPhoto);
    setSource(from);
    setPhotos(list);
    setCurrentId(list[0]?.id ?? null);
    setResults({});
    setCrops({});
    setOrigins({});
    setActive("top");
    historyRef.current = [];
    setHistoryCount(0);
    pixelsRef.current = null;
    setNotice(list.length ? "" : "자를 수 있는 그림 파일(PNG·JPG·WebP·GIF·BMP·AVIF)이 없습니다.");
    if (!list.length) {
      setStatus("idle");
      return;
    }
    setStatus("reading");
    setProgress({ done: 0, total: list.length });
    const measured = [...list];
    let done = 0;
    await eachLimit(list, 4, async (photo, i) => {
      try {
        const file = await photo.load();
        measured[i] = { ...photo, size: await sizeOf(file), type: file.type || photo.type, bytes: file.size };
      } catch {
        measured[i] = { ...photo, error: "열지 못했습니다", checked: false };
      }
      done++;
      if (run === runRef.current) setProgress({ done, total: list.length });
    });
    if (run !== runRef.current) return;
    setPhotos(measured);
    // 크기마다 자를 곳: 지난번에 그 크기에 쓴 값, 없으면 자르지 않음
    const nextCrops = {};
    const nextOrigins = {};
    for (const photo of measured) {
      if (!photo.size) continue;
      const key = keyOf(photo);
      if (key in nextCrops) continue;
      const remembered = settingsRef.current.sizes[key];
      nextCrops[key] = remembered ? clampCrop(remembered, photo.size.width, photo.size.height) : { ...ZERO };
      if (remembered) nextOrigins[key] = "remembered";
    }
    setCrops(nextCrops);
    setOrigins(nextOrigins);
    setProgress(null);
    setStatus("ready");
  }

  async function pickFolder() {
    setNotice("");
    if (!canPickFolder()) {
      folderInput.current.click();
      return;
    }
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: "crop", startIn: "pictures", mode: "readwrite" });
    } catch (err) {
      if (err.name !== "AbortError") setNotice(`폴더를 열지 못했습니다. ${err.message}`);
      return;
    }
    const entries = [];
    for await (const entry of dir.values()) if (entry.kind === "file") entries.push({ name: entry.name, handle: entry });
    open(entries, { kind: "folder", name: dir.name, dir });
  }

  async function pickFiles() {
    setNotice("");
    if (typeof window.showOpenFilePicker !== "function") {
      fileInput.current.click();
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        id: "crop-files",
        startIn: "pictures",
        multiple: true,
        types: [{ description: "그림", accept: { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"] } }],
      });
    } catch (err) {
      if (err.name !== "AbortError") setNotice(`사진을 열지 못했습니다. ${err.message}`);
      return;
    }
    open(
      handles.map((handle) => ({ name: handle.name, handle })),
      { kind: "files", name: "고른 사진", startIn: handles[0] },
    );
  }

  // 폴더 고르기 창이 없는 브라우저: 고른 폴더 바로 안의 파일만 읽는다 (저장은 다운로드로)
  function onFolderInput(e) {
    const files = [...e.target.files].filter((file) => file.webkitRelativePath.split("/").length === 2);
    const name = e.target.files[0]?.webkitRelativePath.split("/")[0] ?? "고른 폴더";
    e.target.value = "";
    open(
      files.map((file) => ({ name: file.name, file })),
      { kind: "files", name },
    );
  }

  function onFileInput(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) open(files.map((file) => ({ name: file.name, file })), { kind: "files", name: "고른 사진" });
  }

  // 화면 어디에 끌어다 놓아도 받는다
  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const over = (e) => {
      if (!hasFiles(e) || busy) return;
      e.preventDefault();
      setDragging(true);
    };
    const leave = (e) => {
      if (!e.relatedTarget) setDragging(false);
    };
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      setDragging(false);
      if (busy) return;
      const files = [...e.dataTransfer.files];
      if (files.length) open(files.map((file) => ({ name: file.name, file })), { kind: "files", name: "끌어다 놓은 사진" });
    };
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  });

  // 고치기 전의 값을 되돌리기에 남긴다. kind: drag(끌기 하나), key(화살표 키·숫자 칸. 잇달아 고친 것은 한 번으로), action(단추·누르기)
  function record(photo, kind) {
    const now = Date.now();
    const last = historyRef.current.at(-1);
    const own = Boolean(photo.own);
    const typing = kind === "key" && lastKindRef.current === "key" && last?.photoId === photo.id && last.own === own && now - recordedRef.current < HISTORY_GAP;
    recordedRef.current = now;
    lastKindRef.current = kind;
    if (typing) return;
    historyRef.current.push({ photoId: photo.id, key: keyOf(photo), own, crop: cropOf(photo) });
    if (historyRef.current.length > HISTORY) historyRef.current.shift();
    setHistoryCount(historyRef.current.length);
  }

  function undo() {
    const entry = historyRef.current.pop();
    setHistoryCount(historyRef.current.length);
    recordedRef.current = 0;
    lastKindRef.current = "";
    if (!entry) return;
    if (entry.own) setPhotos((list) => list.map((p) => (p.id === entry.photoId ? { ...p, own: entry.crop } : p)));
    else {
      setCrops((all) => ({ ...all, [entry.key]: entry.crop }));
      setSettings((s) => ({ ...s, sizes: rememberSize(s.sizes, entry.key, entry.crop) }));
    }
    setCurrentId(entry.photoId);
    setEditorNote("되돌렸습니다.");
  }

  // 자를 곳을 고친다. 이 사진만 따로 자르기로 했으면 그 사진만, 아니면 같은 크기 사진 모두에 (그 크기의 값으로 기억한다).
  // kind: 되돌리기 단위 (record). live는 끄는 중이라 남기지 않는다(끌기를 시작할 때 남겼다)
  function changeCrop(next, kind = "action") {
    if (!current?.size) return;
    const crop = clampCrop(next, current.size.width, current.size.height);
    if (SIDES.every((side) => crop[side] === cropOf(current)[side])) return;
    if (kind !== "live") record(current, kind);
    if (current.own) {
      setPhotos((list) => list.map((p) => (p.id === current.id ? { ...p, own: crop } : p)));
      return;
    }
    const key = keyOf(current);
    setCrops((all) => ({ ...all, [key]: crop }));
    setOrigins((all) => ({ ...all, [key]: "edited" }));
    setSettings((s) => ({ ...s, sizes: rememberSize(s.sizes, key, crop) }));
  }

  function toggleOwn() {
    if (!current?.size) return;
    const own = current.own ? null : cropOf(current);
    setPhotos((list) => list.map((p) => (p.id === current.id ? { ...p, own } : p)));
  }

  // 고치고 있는 사진의 화소
  async function imageOf(photo) {
    if (pixelsRef.current?.id !== photo.id) pixelsRef.current = { id: photo.id, image: await pixelsOf(await photo.load()) };
    return pixelsRef.current.image;
  }

  // 사진을 눌렀다: 누른 곳을 둘러싼 직선 경계(테두리, 사진과 사진이 만나는 줄 등) 안쪽만 남긴다. Alt를 누른 채면 누른 선의 안쪽만 (regions.js의 fitAt)
  async function pickAt(x, y, inside) {
    const photo = current;
    if (!photo?.size) return;
    let found;
    try {
      found = fitAt(await imageOf(photo), x, y, { inside });
    } catch {
      setEditorNote("사진을 읽지 못했습니다.");
      return;
    }
    if (currentRef.current?.id !== photo.id) return;
    if (!found) {
      setEditorNote("누른 곳을 둘러싼 직선 경계를 찾지 못했습니다. 자를 줄을 끌어 보세요.");
      return;
    }
    const { how, ...crop } = found;
    if (isZero(crop)) {
      setEditorNote("누른 곳은 사진 가장자리까지 이어져 있어 자를 곳이 없습니다. 테두리 안쪽을 눌러 보세요.");
      return;
    }
    changeCrop(crop);
    const what = { inside: "누른 선의 안쪽", area: "누른 곳과 그 안쪽", straight: "누른 곳을 둘러싼 직선 경계 안쪽" }[how];
    setEditorNote(`${what}에 맞췄습니다. 되돌리려면 Ctrl+Z(맥은 ⌘+Z).`);
  }

  // 둘레의 바탕색 여백을 걷어 낸다
  async function trimEdges() {
    const photo = current;
    if (!photo?.size) return;
    const found = trimMargins(await imageOf(photo).catch(() => null) ?? { width: 0, height: 0, data: [] });
    if (currentRef.current?.id !== photo.id) return;
    if (!found) {
      setEditorNote("걷어 낼 바깥 여백이 없습니다.");
      return;
    }
    changeCrop(found);
    setEditorNote("바깥 여백을 걷어 냈습니다.");
  }

  const usable = photos.filter((p) => p.size);
  const index = usable.findIndex((p) => p.id === currentId);
  const go = (step) => {
    const next = usable[index + step];
    if (next) setCurrentId(next.id);
  };

  // 고치는 칸 어디에서든(숫자 칸 포함) PageUp·PageDown으로 앞뒤 사진으로 가고, Ctrl+Z(맥은 ⌘+Z)로 되돌린다
  function onEditKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.key !== "PageUp" && e.key !== "PageDown") || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    go(e.key === "PageUp" ? -1 : 1);
  }

  function setChecked(id, checked) {
    setPhotos((list) => list.map((p) => (p.id === id ? { ...p, checked } : p)));
  }

  const setResult = (id, result) => setResults((all) => ({ ...all, [id]: result }));

  async function save() {
    const chosen = photos.filter((p) => p.checked && p.size);
    if (!chosen.length) return;
    // 고른 사진의 폴더에는 쓸 권한이 없어 저장할 폴더를 한 번 묻는다. 그 폴더를 그대로 고르면 원본이 있는 곳이다.
    // 이 창은 버튼을 누른 바로 그때만 띄울 수 있어서 맨 먼저 한다
    let base = source.kind === "folder" ? source.dir : null;
    if (!base && canPickFolder()) {
      try {
        base = await window.showDirectoryPicker({ id: "crop-save", startIn: source.startIn ?? "pictures", mode: "readwrite" });
      } catch (err) {
        if (err.name === "AbortError") return; // 고르지 않고 닫음
        base = null; // 쓰기를 막아 둔 브라우저 등은 다운로드로 받는다
      }
    }
    stopRef.current = false;
    setStatus("saving");
    setResults({});
    setNotice("");
    let out = base;
    if (base && settings.saveMode === "folder") {
      try {
        out = await base.getDirectoryHandle(folderName, { create: true });
      } catch (err) {
        setNotice(`"${folderName}" 폴더를 만들지 못해 다운로드 폴더로 받습니다. ${explainSaveError(err).text}`);
        out = null;
      }
    }
    const existing = out ? await namesIn(out).catch(() => new Set()) : new Set();
    const plan = planSaves(
      chosen.map((p) => ({ id: p.id, name: p.name, type: p.type, crop: cropOf(p) })),
      { mode: settings.saveMode, suffix, existing },
    );
    const byId = new Map(chosen.map((p) => [p.id, p]));
    for (const [k, item] of plan.entries()) {
      if (stopRef.current) break;
      const photo = byId.get(item.id);
      setProgress({ done: k, total: plan.length, name: photo.name });
      if (item.action === "skip") {
        setResult(item.id, { type: "skipped" });
        continue;
      }
      try {
        const file = await photo.load();
        let blob = file;
        let made = croppedSize(photo.size.width, photo.size.height, ZERO);
        if (item.action === "crop") {
          const cropped = await cropFile(file, cropOf(photo), outputType(photo.name, file.type), settings.quality);
          if (cropped.error) throw new Error(cropped.error);
          blob = cropped.blob;
          made = { width: cropped.width, height: cropped.height };
        }
        const done = { name: item.name, ...made, bytes: blob.size, copied: item.action === "copy", overwrite: item.overwrite };
        if (!out) {
          download(blob, item.name);
          setResult(item.id, { type: "download", ...done });
          continue;
        }
        const saved = await saveToFolder(out, item.name, blob, {
          stopped: () => stopRef.current,
          hold: (writable) => {
            savingRef.current = writable;
          },
        });
        if (saved.cancelled) {
          setResult(item.id, { type: "cancelled" });
          break;
        }
        if (saved.ok) setResult(item.id, { type: "saved", ...done });
        else {
          download(blob, item.name);
          setResult(item.id, { type: "download", ...done, reason: explainSaveError(saved.error) });
        }
      } catch (err) {
        setResult(item.id, { type: "error", message: err.message });
      }
    }
    // 저장에 쓴 크기마다의 자를 곳을 기억해 둔다. 다음에 같은 크기의 사진을 열면 처음부터 맞춰져 있다
    setSettings((s) => {
      let sizes = s.sizes;
      for (const [key, crop] of Object.entries(crops)) sizes = rememberSize(sizes, key, crop);
      return { ...s, sizes };
    });
    setProgress(null);
    setStatus("done");
  }

  function stop() {
    stopRef.current = true;
    savingRef.current?.abort(new DOMException("멈춤", "AbortError")).catch(() => {});
  }

  // 저장 방식을 바꾸면 지난 저장 결과는 지운다 (남겨 두면 다른 방식으로 저장한 결과처럼 보인다)
  function changeSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
    if (status === "done") {
      setResults({});
      setStatus("ready");
    }
  }

  // 크기마다 묶은 목록 (처음 나온 차례). 열지 못한 사진은 맨 뒤에
  const groups = [];
  for (const photo of photos) {
    const key = photo.size ? keyOf(photo) : "error";
    let group = groups.find((g) => g.key === key);
    if (!group) {
      group = { key, size: photo.size, photos: [] };
      groups.push(group);
    }
    group.photos.push(photo);
  }
  groups.sort((a, b) => (a.key === "error") - (b.key === "error"));

  const chosen = photos.filter((p) => p.checked && p.size);
  const cropCount = chosen.filter((p) => !isZero(cropOf(p))).length;
  const plainCount = chosen.length - cropCount;
  const hasJpg = chosen.some((p) => !isZero(cropOf(p)) && outputType(p.name, p.type).mime === "image/jpeg");
  const all = Object.values(results);
  const savedCount = all.filter((r) => r.type === "saved").length;
  const downloadCount = all.filter((r) => r.type === "download").length;
  const failCount = all.filter((r) => r.type === "error").length;
  const crop = cropOf(current);
  const groupCount = current?.size ? usable.filter((p) => keyOf(p) === keyOf(current)).length : 0;
  const left = current?.size ? croppedSize(current.size.width, current.size.height, crop) : null;

  let saveWhere;
  if (settings.saveMode === "folder") {
    saveWhere =
      source?.kind === "folder"
        ? `"${source.name}" 폴더 안에 "${folderName}" 폴더를 만들어 같은 이름으로 저장합니다. 원본은 그대로 둡니다.`
        : `저장할 때 폴더를 묻고, 그 안에 "${folderName}" 폴더를 만들어 같은 이름으로 저장합니다.`;
  } else {
    const example = `이름${suffix}.png`;
    saveWhere =
      source?.kind === "folder"
        ? `원본 옆에 ${example}처럼 이름 뒤에 붙일 말을 붙여 저장합니다. 원본은 그대로 둡니다.`
        : `저장할 때 폴더를 묻고, 거기에 ${example}처럼 저장합니다. 원본이 있는 폴더를 고르면 원본 옆에 저장됩니다.`;
  }
  if (!canPickFolder()) saveWhere = "이 브라우저에서는 다운로드 폴더로 받습니다. 크롬·엣지에서는 고른 폴더에 바로 저장합니다.";

  let summary = "";
  if (status === "saving" && progress) summary = `${number(progress.done + 1)}/${number(progress.total)} · ${progress.name}`;
  else if (status === "done") {
    const parts = [];
    if (savedCount) parts.push(`${number(savedCount)}장을 저장했습니다`);
    if (downloadCount) parts.push(`${number(downloadCount)}장은 다운로드 폴더로 받았습니다`);
    if (failCount) parts.push(`${number(failCount)}장은 만들지 못했습니다`);
    summary = parts.length ? `${parts.join(". ")}.` : "저장한 사진이 없습니다.";
  } else if (chosen.length) {
    summary =
      settings.saveMode === "folder"
        ? `${number(cropCount)}장을 잘라 저장합니다.${plainCount ? ` 자를 곳이 없는 ${number(plainCount)}장은 그대로 복사합니다.` : ""}`
        : `${number(cropCount)}장을 잘라 저장합니다.${plainCount ? ` 자를 곳이 없는 ${number(plainCount)}장은 건너뜁니다.` : ""}`;
  }

  const resultText = (result) => {
    if (!result) return null;
    if (result.type === "saved" || result.type === "download") {
      const where = result.type === "saved" ? (result.copied ? "그대로 복사함" : "저장함") : "다운로드함";
      return (
        <span className={result.type === "saved" ? "cr-ok" : "cr-warn"} title={result.reason?.detail}>
          {where} · {result.name} · {number(result.width)}×{number(result.height)} · {fileSize(result.bytes)}
          {result.overwrite && " · 덮어씀"}
          {result.reason && ` · ${result.reason.text}`}
        </span>
      );
    }
    if (result.type === "skipped") return <span className="cr-muted">자를 곳이 없어 건너뜀</span>;
    if (result.type === "cancelled") return <span className="cr-muted">멈춤</span>;
    return <span className="cr-error">만들지 못함: {result.message}</span>;
  };

  return (
    <main className={`container cr-page${dragging ? " dragging" : ""}`}>
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>사진 자르기</h1>
        <p className="subtitle">
          사진 속 직선 경계(테두리, 화면 캡처의 위아래 띠 등)에 맞춰 위·아래·옆을 화소 단위로 정확히 잘라 냅니다. 같은 크기의 사진은
          한꺼번에 자르고, 한 장씩 고친 뒤 한 번에 저장합니다. 사진은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        <div className="cr-actions">
          <button type="button" onClick={pickFolder} disabled={busy}>
            {source?.kind === "folder" ? "다른 폴더 고르기" : "폴더 고르기"}
          </button>
          <button type="button" className="secondary" onClick={pickFiles} disabled={busy}>
            사진 고르기
          </button>
          <input ref={folderInput} type="file" webkitdirectory="" multiple hidden onChange={onFolderInput} />
          <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onFileInput} />
        </div>
        <p className="cr-hint">사진을 이 화면에 끌어다 놓아도 됩니다. 폴더를 고르면 그 폴더 바로 안의 사진을 읽습니다(안의 폴더는 읽지 않습니다).</p>
        {notice && (
          <p className="cr-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {status === "reading" && progress && (
        <section className="card cr-muted">
          사진을 읽는 중… {number(progress.done)}/{number(progress.total)}
        </section>
      )}

      {photos.length > 0 && status !== "reading" && (
        <div className="cr-work">
          <section className="card cr-list-card">
            <div className="cr-summary">
              <h2>{source?.name}</h2>
              <span>
                사진 {number(usable.length)}장 · 크기 {number(groups.filter((g) => g.key !== "error").length)}가지
              </span>
            </div>
            <div className="cr-list">
              {groups.map((group) => {
                const groupCrop = group.size ? clampCrop(crops[group.key] ?? ZERO, group.size.width, group.size.height) : ZERO;
                const cut = SIDES.filter((side) => groupCrop[side]).map((side) => `${SIDE_LABELS[side]} ${number(groupCrop[side])}`);
                return (
                  <div key={group.key} className="cr-group">
                    <div className="cr-group-head">
                      <strong>{group.size ? `${number(group.size.width)}×${number(group.size.height)}` : "열지 못한 사진"}</strong>
                      <span>
                        {number(group.photos.length)}장{group.size && ` · ${cut.length ? `${cut.join(" · ")}px 자름` : "자를 곳 없음"}`}
                      </span>
                    </div>
                    <ul>
                      {group.photos.map((photo) => {
                        const own = photo.own && photo.size ? clampCrop(photo.own, photo.size.width, photo.size.height) : null;
                        return (
                          <li key={photo.id} className={[photo.id === currentId && "on", !photo.checked && "off"].filter(Boolean).join(" ") || undefined}>
                            <input
                              type="checkbox"
                              aria-label={`${photo.name} 저장하기`}
                              checked={photo.checked}
                              disabled={!photo.size || status === "saving"}
                              onChange={(e) => setChecked(photo.id, e.target.checked)}
                            />
                            <button type="button" className="cr-row" onClick={() => photo.size && setCurrentId(photo.id)} disabled={!photo.size}>
                              {photo.size ? <Thumb load={photo.load} width={photo.size.width} height={photo.size.height} crop={cropOf(photo)} /> : <span className="cr-thumb-empty" />}
                              <span className="cr-row-text">
                                <span className="cr-name">{photo.name}</span>
                                {photo.error && <span className="cr-error">{photo.error}</span>}
                                {own && (
                                  <span className="cr-own">
                                    이 사진만: {SIDES.filter((side) => own[side]).map((side) => `${SIDE_LABELS[side]} ${number(own[side])}`).join(" · ") || "자르지 않음"}
                                  </span>
                                )}
                                {resultText(results[photo.id])}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          </section>

          {current?.size && (
            <section className="card cr-edit-card" onKeyDown={onEditKey}>
              <div className="cr-edit-head">
                <button type="button" className="secondary" onClick={() => go(-1)} disabled={index <= 0} aria-label="앞 사진">
                  ←
                </button>
                <strong className="cr-name">{current.name}</strong>
                <span className="cr-muted">
                  {number(index + 1)}/{number(usable.length)}
                </span>
                <button type="button" className="secondary" onClick={() => go(1)} disabled={index >= usable.length - 1} aria-label="다음 사진">
                  →
                </button>
              </div>
              <div className="cr-fields">
                {SIDES.map((side) => (
                  <label key={side} className={active === side ? "on" : undefined}>
                    {SIDE_LABELS[side]}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={crop[side]}
                      onFocus={() => setActive(side)}
                      onChange={(e) => changeCrop({ ...crop, [side]: e.target.value }, "key")}
                    />
                  </label>
                ))}
                <span className="cr-muted">px</span>
              </div>
              <div className="cr-tools">
                <label className="cr-check">
                  <input type="checkbox" checked={Boolean(current.own)} onChange={toggleOwn} />
                  이 사진만 따로 자르기
                </label>
                <button type="button" className="secondary" onClick={trimEdges}>
                  여백 자르기
                </button>
                <button type="button" className="secondary" onClick={() => changeCrop(ZERO)}>
                  자르지 않기
                </button>
                <button type="button" className="secondary" onClick={undo} disabled={!historyCount}>
                  되돌리기
                </button>
              </div>
              <p className="cr-hint">
                {current.own
                  ? "이 사진에만 적용됩니다."
                  : `같은 크기 사진 ${number(groupCount)}장에 함께 적용됩니다.${origins[keyOf(current)] && ORIGIN_TEXT[origins[keyOf(current)]] ? ` ${ORIGIN_TEXT[origins[keyOf(current)]]}` : ""}`}
              </p>
              {editorNote && <p className="cr-notice">{editorNote}</p>}
              <Editor
                bitmap={bitmap}
                pixels={pixels}
                width={current.size.width}
                height={current.size.height}
                crop={crop}
                onChange={changeCrop}
                onBegin={() => current && record(current, "drag")}
                active={active}
                onActive={setActive}
                onPick={pickAt}
                label={current.name}
              />
              <p className="cr-size">
                {number(current.size.width)}×{number(current.size.height)} → <strong>{number(left.width)}×{number(left.height)}px</strong>
              </p>
              <p className="cr-hint">
                사진을 누르면 누른 곳을 둘러싼 직선 경계(테두리, 사진과 사진이 만나는 줄 등) 안쪽만 남기고, 테두리와 그 흐린 가장자리는
                깔끔하게 잘라 냅니다. 테두리가 여러 겹이면 누른 곳에 따라 몇째 겹까지 남길지 정해집니다. 테두리 선을 Alt를 누른 채 누르면 그
                선의 안쪽만 남깁니다(사진이 테두리에 바로 붙어 있을 때). 자를 줄을 끌면 가까운 직선 경계에 붙습니다(초록색, Alt를 누르면 붙지
                않음).
              </p>
              <p className="cr-hint">
                자를 줄(밝은 곳의 테두리)을 끌어 옮기고, 줄 밖에서 끌면 새로 그립니다. 오른쪽 확대 칸은 사진 위에서는 마우스 밑을, 줄을
                끌거나 화살표 키·숫자 칸으로 고칠 때는 고른 줄(주황색) 근처를 화소째 보여 줍니다. 줄을 고른 뒤 화살표 키로 1px씩(Shift를
                누르면 10px) 옮기고, PageUp·PageDown으로 앞뒤 사진으로 갑니다.
              </p>
            </section>
          )}
        </div>
      )}

      {photos.length > 0 && status !== "reading" && (
        <section className="card">
          <h2>저장</h2>
          <fieldset className="cr-options" disabled={status === "saving"}>
            <legend>저장할 곳</legend>
            <label>
              <input type="radio" name="saveMode" checked={settings.saveMode === "folder"} onChange={() => changeSettings({ saveMode: "folder" })} />새 폴더에 같은
              이름으로
              <input
                type="text"
                className="cr-text"
                aria-label="새 폴더 이름"
                value={settings.folderName}
                onChange={(e) => changeSettings({ folderName: e.target.value })}
              />
            </label>
            <label>
              <input type="radio" name="saveMode" checked={settings.saveMode === "beside"} onChange={() => changeSettings({ saveMode: "beside" })} />
              원본 옆에, 이름 뒤에
              <input
                type="text"
                className="cr-text"
                aria-label="이름 뒤에 붙일 말"
                value={settings.suffix}
                onChange={(e) => changeSettings({ suffix: e.target.value })}
              />
            </label>
          </fieldset>
          {hasJpg && (
            <fieldset className="cr-options" disabled={status === "saving"}>
              <legend>JPG 품질</legend>
              {JPG_QUALITIES.map((quality) => (
                <label key={quality}>
                  <input type="radio" name="quality" checked={settings.quality === quality} onChange={() => changeSettings({ quality })} />
                  {quality}
                </label>
              ))}
            </fieldset>
          )}
          <p className="cr-hint">{saveWhere}</p>
          <div className="cr-footer">
            {status === "saving" ? (
              <button type="button" className="secondary" onClick={stop}>
                멈추기
              </button>
            ) : (
              <button type="button" onClick={save} disabled={!chosen.length || (settings.saveMode === "beside" && !cropCount)}>
                {status === "done" ? "다시 저장하기" : `${number(chosen.length)}장 저장하기`}
              </button>
            )}
            <span className="cr-muted">{summary}</span>
          </div>
          {status === "saving" && progress && (
            <div className="cr-bar">
              <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          )}
        </section>
      )}

      <section className="cr-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>같은 크기의 사진(같은 폰의 스크린샷 등)은 한 장에서 정하면 모두에 적용됩니다. 크기마다 마지막으로 쓴 값을 기억해 두어 다음에 열면 처음부터 맞춰져 있습니다.</li>
          <li>자를 줄을 끌면 가까이(10px 안)에 있는 사진 속 직선 경계, 곧 색이 바뀌는 곧은 줄에 붙습니다(초록색). 색이 바뀌는 곳이 줄 길이의 절반을 넘거나, 곧게 100px(짧은 줄은 줄 길이의 30%) 넘게 이어지면 경계로 봅니다. 그래서 팔각형처럼 곧은 변이 줄의 일부만 덮어도 붙습니다. 경계가 두세 줄에 걸쳐 흐리면 남길 쪽 끝에 붙어 흐린 줄이 남지 않습니다. Alt를 누른 채 끌면 붙지 않습니다.</li>
          <li>사진을 누르면 누른 곳을 둘러싼 직선 경계 안쪽만 남깁니다. 경계가 겹쳐 있으면 누른 곳을 둘러싼 가장 안쪽 네모가 남습니다(사진 두 장을 나란히 붙인 그림이면 누른 쪽 사진, 액자 속 사진이면 사진, 표면 누른 칸). 테두리 그림처럼 한 가지 색으로 칠한 곳을 누르면 그곳과 그 안에 든 것만 남기고, 둘러싼 테두리와 그 흐린 가장자리를 잘라 냅니다. 테두리가 여러 겹이면 가장 안쪽을 누르면 그 안만, 겹 사이를 누르면 그 겹의 안쪽 모두를 남깁니다. 액자의 나무처럼 무늬가 있는 테두리를 누르면 그 테두리와 안쪽을 남깁니다. 테두리 선을 Alt를 누른 채 누르면 그 선 안쪽만 남깁니다. 같은 크기 사진 모두에 함께 적용됩니다.</li>
          <li>"여백 자르기"는 네 모서리와 같은 색으로 된 둘레를 걷어 냅니다. 잘못 고쳤으면 "되돌리기"(Ctrl+Z, 맥은 ⌘+Z)를 누르세요.</li>
          <li>사진 하나만 다르게 자르려면 "이 사진만 따로 자르기"를 켜고 고칩니다.</li>
          <li>PNG는 자른 곳 말고는 화소가 원본과 똑같습니다. 아이폰 스크린샷의 넓은 색 영역(Display P3) 같은 색 정보도 그대로 옮깁니다.</li>
          <li>JPG는 다시 압축하므로 아주 조금 달라집니다(품질을 고를 수 있습니다). WebP·GIF·BMP·AVIF는 PNG로 저장합니다. 사진의 회전 정보는 반영해 보이는 대로 자르고, 찍은 날짜 같은 사진 정보(EXIF)는 옮기지 않습니다.</li>
          <li>"새 폴더에 같은 이름으로"는 자를 곳이 없는 사진도 그대로 복사해 그 폴더만으로 한 벌이 되게 합니다(그 폴더를 사진 세로로 붙이기에 넣기 좋습니다). 그 폴더에 같은 이름이 있으면 덮어씁니다.</li>
          <li>"원본 옆에"는 원본이나 다른 파일을 덮어쓰지 않습니다. 같은 이름이 있으면 번호를 붙입니다.</li>
          <li>
            자른 사진을 세로로 이어 붙이려면 <a href={`${import.meta.env.BASE_URL}stitch/`}>사진 세로로 붙이기</a>를 쓰세요.
          </li>
        </ul>
      </section>
    </main>
  );
}
