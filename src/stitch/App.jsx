import { useCallback, useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { partName, partRange } from "../shared/fileNames.js";
import { number } from "../shared/format.js";
import { JPG_MAX_SIDE } from "../shared/imageInfo.js";
import { DEFAULT_JPG_QUALITY, JPG_QUALITIES } from "../shared/jpgQuality.js";
import { explainSaveError, SAVE_TRIES, saveToFolder } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { cleanSuffix, FORMATS, groupFileList, groupKey, NAMINGS, outputNames, planGroups, scanDirectory } from "./folders.js";
import { cancelJob, runJob } from "./jobs.js";
import { addPhotos, sortByName } from "./photos.js";
import PickedSection from "./PickedSection.jsx";
import { describe, MADE } from "./progress.js";
import ResultText from "./ResultText.jsx";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.stitch.v1";
const DEFAULT_SUFFIX = "합본";
// 전에 쓴 붙일 말을 몇 개까지 기억할지. 고른 폴더에서 지난 결과를 알아보는 데 쓴다
const MAX_USED = 10;

// 저장 형식마다의 설명. JPG 품질의 설명은 받은 JPG를 붙여 다시 저장해 잰 어림이다 (CLAUDE.md 참고)
const FORMAT_LABELS = { jpg: "JPG", png: "PNG" };
const PNG_HINT = "화질이 하나도 깎이지 않습니다. JPG 사진을 붙이면 원본 합계의 몇 배가 됩니다.";
const QUALITY_HINTS = {
  100: "거의 그대로입니다. 받은 JPG 합계의 5배쯤이 됩니다.",
  95: "눈으로 구분하기 어렵습니다. 받은 JPG 합계의 2배쯤이 됩니다.",
  90: "받은 JPG 합계와 비슷하거나 조금 커집니다.",
  80: "받은 JPG 합계보다 작아질 수 있습니다. 확대하면 차이가 보일 수 있습니다.",
};

// 설정: { suffix: 붙일 말, naming: 이름 방식(folders.js NAMINGS), format: 저장 형식(folders.js FORMATS),
//   quality: JPG 품질, used: 전에 만들 때 쓴 붙일 말(새것부터) }
function loadSettings() {
  const settings = { suffix: DEFAULT_SUFFIX, naming: NAMINGS[0], format: FORMATS[0], quality: DEFAULT_JPG_QUALITY, used: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (typeof saved?.suffix === "string") settings.suffix = saved.suffix;
    if (NAMINGS.includes(saved?.naming)) settings.naming = saved.naming;
    if (FORMATS.includes(saved?.format)) settings.format = saved.format;
    if (JPG_QUALITIES.includes(saved?.quality)) settings.quality = saved.quality;
    if (Array.isArray(saved?.used)) settings.used = saved.used.filter((s) => typeof s === "string").slice(0, MAX_USED);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 크롬·엣지는 고른 폴더에 바로 쓸 수 있다(File System Access API). 다른 브라우저는 폴더를 읽기만 한다
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

// 사진 고르기 창에 보일 확장자
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".jfif", ".png", ".gif", ".webp", ".bmp", ".avif"];

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const { suffix, naming, format, quality, used } = settings;
  // 고른 폴더: { name, groups: 하위 폴더 묶음 [{ path, files }], rootFiles: 고른 폴더 바로 안의 사진,
  //   existing: 고른 폴더 바로 안 파일 이름(소문자), saveDir: 쓸 수 있으면 그 폴더 }
  const [source, setSource] = useState(null);
  // 체크를 끈 묶음(groupKey). 폴더를 새로 고르면 모두 다시 켠다
  const [unchecked, setUnchecked] = useState(() => new Set());
  const [status, setStatus] = useState("idle"); // idle · scanning · ready · running · done
  const [results, setResults] = useState([]);
  // { index: 묶음 번호, step: 고른 묶음 가운데 몇 번째(0부터), total: 고른 묶음 수, fraction, text }
  const [progress, setProgress] = useState(null);
  const [runTotal, setRunTotal] = useState(0);
  const [notice, setNotice] = useState("");
  // 브라우저가 폴더에 쓰기를 막아 두었으면(회사 PC 정책 등) 읽기만 하고 결과는 다운로드로 받는다
  const [writeBlocked, setWriteBlocked] = useState(false);
  // 직접 고른 사진(photos.js). 폴더 대신 사진을 골랐을 때만 있다. 붙이는 순서대로 둔다
  const [picked, setPicked] = useState(null);
  const [pickedRunning, setPickedRunning] = useState(false);
  const inputRef = useRef(null);
  const photoInputRef = useRef(null);
  // 사진 고르기 창을 "사진 더하기"로 열었는지 (파일 입력으로 받을 때 쓴다)
  const addingRef = useRef(false);
  const photoId = useRef(1);
  const allRef = useRef(null);
  const stopRef = useRef(false);
  // 고른 폴더에 쓰는 중인 스트림. 멈추기를 누르면 그만 쓰게 한다
  const savingRef = useRef(null);
  const running = status === "running";
  // 만드는 중에는 설정과 고르기를 잠근다
  const working = running || pickedRunning;
  const busy = working || status === "scanning";

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  // 만드는 동안 탭을 닫거나 새로 고치려 하면 브라우저가 한 번 묻게 한다
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  // 목록에서 뺀 사진의 작은 그림 주소를 푼다
  const forget = (photos) => {
    for (const photo of photos) URL.revokeObjectURL(photo.url);
  };

  function open(scan, saveDir) {
    // 사진을 골라 붙이던 것은 닫는다
    if (picked) forget(picked);
    setPicked(null);
    setSource({ ...scan, saveDir });
    setUnchecked(new Set());
    setResults([]);
    setProgress(null);
    setStatus("ready");
  }

  async function pickFolder() {
    setNotice("");
    if (!canPickFolder()) {
      inputRef.current.click();
      return;
    }
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: "stitch", startIn: "pictures", mode: writeBlocked ? "read" : "readwrite" });
    } catch (err) {
      if (err.name === "AbortError") return; // 고르지 않고 닫음
      if (!writeBlocked && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
        setWriteBlocked(true);
        setNotice("이 브라우저는 폴더에 저장하지 못하게 되어 있어 결과를 다운로드 폴더로 받습니다. 폴더를 한 번 더 골라 주세요.");
      } else {
        setNotice(`폴더를 열지 못했습니다. ${err.message}`);
      }
      return;
    }
    setStatus("scanning");
    try {
      const scan = await scanDirectory(dir);
      const writable = !writeBlocked && (await dir.queryPermission?.({ mode: "readwrite" })) === "granted";
      open(scan, writable ? dir : null);
    } catch (err) {
      setSource(null);
      setStatus("idle");
      setNotice(`폴더를 읽지 못했습니다. ${err.message}`);
    }
  }

  function onFiles(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) open(groupFileList(files), null);
  }

  // 고른 사진을 목록에 올린다. entries: [{ file, handle(파일 고르기 창으로 고른 것만) }].
  // add면 이미 고른 사진 뒤에 더하고(같은 사진은 한 번만), 아니면 새로 시작한다. 새로 온 사진은 파일 이름순으로 놓는다
  function takePhotos(entries, add) {
    const fresh = sortByName(
      entries.map(({ file, handle = null }) => ({
        id: photoId.current++,
        name: file.name,
        file,
        handle,
        bytes: file.size,
        modified: file.lastModified,
        url: URL.createObjectURL(file), // 목록에 보일 작은 그림
      })),
    );
    if (add && picked) {
      const { photos, dropped } = addPhotos(picked, fresh);
      forget(dropped);
      setPicked(photos);
    } else {
      if (picked) forget(picked);
      setPicked(fresh);
    }
    // 폴더로 붙이던 것은 닫는다
    setSource(null);
    setResults([]);
    setProgress(null);
    setStatus("idle");
  }

  async function pickPhotos(add) {
    setNotice("");
    addingRef.current = add;
    if (typeof window.showOpenFilePicker !== "function") {
      photoInputRef.current.click();
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        id: "stitch-photos",
        startIn: "pictures",
        multiple: true,
        types: [{ description: "사진", accept: { "image/*": PHOTO_EXTENSIONS } }],
      });
    } catch (err) {
      if (err.name === "AbortError") return; // 고르지 않고 닫음
      setNotice(`사진을 열지 못했습니다. ${err.message}`);
      return;
    }
    try {
      takePhotos(await Promise.all(handles.map(async (handle) => ({ handle, file: await handle.getFile() }))), add);
    } catch (err) {
      setNotice(`사진을 읽지 못했습니다. ${err.message}`);
    }
  }

  function onPhotoFiles(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) takePhotos(files.map((file) => ({ file })), addingRef.current);
  }

  function removePhoto(id) {
    forget(picked.filter((photo) => photo.id === id));
    const rest = picked.filter((photo) => photo.id !== id);
    setPicked(rest.length ? rest : null);
  }

  const addMorePhotos = () => pickPhotos(true);
  const onPickedRunning = useCallback((value) => setPickedRunning(value), []);

  // 묶음 하나를 만든다. 그림을 다 만든 뒤, 고른 폴더에 쓸 수 있으면 거기에 저장하고 아니면 다운로드로 받는다.
  // 고른 폴더에 끝내 저장하지 못한 장은 다운로드로 받고, 까닭(saveError)과 그 장수(fellBack)를 함께 돌려준다.
  // planned는 고른 형식으로 지은 이름이다. JPG로 만들 수 없어 PNG로 만들어졌으면 확장자를 바꿔 저장하고,
  // 길어서 JPG 여러 장으로 나눴으면 이름에 번호를 붙인다(결과의 names, name은 "첫 이름 ~ 끝 이름")
  async function saveGroup(files, planned, report) {
    const made = await runJob(files, format, quality, (p) => report(describe(p)));
    if (made.type !== "done") return made;
    const { parts, ...rest } = made;
    const single = planned.replace(/\.[^.]*$/, `.${made.format}`);
    const names = parts.length > 1 ? parts.map((_, k) => partName(single, k + 1)) : [single];
    const result = { ...rest, name: partRange(names), names, parts: parts.length };
    const dir = source.saveDir;
    if (!dir) {
      parts.forEach((part, k) => download(part.blob, names[k]));
      return { ...result, savedTo: "download" };
    }
    let saveError = null;
    let fellBack = 0;
    for (const [k, part] of parts.entries()) {
      const which = parts.length > 1 ? ` (${k + 1}/${parts.length}장)` : "";
      const saved = await saveToFolder(dir, names[k], part.blob, {
        stopped: () => stopRef.current,
        hold: (writable) => {
          savingRef.current = writable;
        },
        onTry: (n) => report({ fraction: MADE, text: `${n === 1 ? "폴더에 저장하는 중" : `다시 저장하는 중 (${n}/${SAVE_TRIES})`}${which}` }),
      });
      if (saved.cancelled) return { type: "cancelled", skipped: result.skipped };
      if (!saved.ok) {
        download(part.blob, names[k]);
        saveError ??= explainSaveError(saved.error);
        fellBack++;
      }
    }
    if (!fellBack) return { ...result, savedTo: "folder" };
    return { ...result, savedTo: fellBack === parts.length ? "download" : "folder", saveError, fellBack };
  }

  async function start() {
    const cleaned = cleanSuffix(suffix);
    const { groups, names } = planGroups(source, cleaned, used, naming, format);
    const chosen = [...groups.keys()].filter((i) => !unchecked.has(groupKey(groups[i])));
    // 이 붙일 말로 만든 결과를 다음에 고른 폴더에서 알아보도록 기억해 둔다
    setSettings((s) => ({ ...s, used: [cleaned, ...s.used.filter((u) => u !== cleaned)].slice(0, MAX_USED) }));
    stopRef.current = false;
    setStatus("running");
    setResults([]);
    setRunTotal(chosen.length);
    for (const [step, index] of chosen.entries()) {
      if (stopRef.current) break;
      const group = groups[index];
      const at = { index, step, total: chosen.length };
      const startedAt = performance.now();
      setProgress({ ...at, fraction: 0, text: "사진 여는 중" });
      let result;
      try {
        const files = await Promise.all(group.files.map((f) => (typeof f.getFile === "function" ? f.getFile() : f)));
        result = await saveGroup(files, names[index], (p) => setProgress({ ...at, ...p }));
      } catch (err) {
        result = { type: "error", message: err.message, skipped: [] };
      }
      result = { ...result, ms: performance.now() - startedAt };
      if (result.savedTo === "folder") {
        const saved = result.names.map((name) => name.toLowerCase());
        setSource((s) => ({ ...s, existing: new Set([...s.existing, ...saved]) }));
      }
      setResults((list) => {
        const next = [...list];
        next[index] = result;
        return next;
      });
      if (result.type === "cancelled") break;
    }
    setProgress(null);
    setStatus("done");
  }

  function stop() {
    stopRef.current = true;
    cancelJob();
    // 고른 폴더에 쓰는 중이면 그만 쓴다. 쓰다 만 임시 파일은 브라우저가 버리고 원래 있던 파일은 그대로 남는다
    savingRef.current?.abort(new DOMException("멈춤", "AbortError")).catch(() => {});
  }

  // 붙일 말·이름 방식을 바꾸면 지난 결과는 지운다. 남겨 두면 저장하지 않은 새 이름 옆에 "저장함"이 붙어 보인다
  function changeSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
    if (status === "done") {
      setResults([]);
      setStatus("ready");
    }
  }

  function toggleGroup(key) {
    setUnchecked((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const cleaned = cleanSuffix(suffix);
  // 이름 방식 예시: a 폴더를 골랐을 때 그 안의 1 폴더 결과 이름
  const namingExamples = NAMINGS.map((n) => outputNames([{ path: ["1"] }], cleaned, "a", n, format)[0]);
  const { groups, names } = source ? planGroups(source, cleaned, used, naming, format) : { groups: [], names: [] };
  const keys = groups.map(groupKey);
  const checkedCount = keys.filter((k) => !unchecked.has(k)).length;
  const imageCount = groups.reduce((sum, g) => sum + g.files.length, 0);
  const madeCount = results.filter((r) => r?.type === "done").length;
  // 고른 폴더에 저장하지 못해 다운로드로 받은 묶음 수
  const fallbackCount = results.filter((r) => r?.saveError).length;
  const overall = progress ? (progress.step + progress.fraction) / progress.total : 0;

  // 모두 고르기 체크박스는 일부만 골랐을 때 가운데 줄(indeterminate)로 보인다. 이 상태는 HTML 속성이 없어 직접 넣는다
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = checkedCount > 0 && checkedCount < groups.length;
  });

  function toggleAll() {
    setUnchecked(checkedCount === groups.length ? new Set(keys) : new Set());
  }

  let saveNote;
  if (source) {
    saveNote = source.saveDir
      ? `고른 폴더(${source.name})에 바로 저장합니다.`
      : "다운로드 폴더로 받습니다. 브라우저가 여러 파일 다운로드를 물으면 허용을 눌러 주세요.";
  } else {
    saveNote =
      canPickFolder() && !writeBlocked
        ? "고른 폴더에 바로 저장합니다."
        : "이 브라우저에서는 결과를 다운로드 폴더로 받습니다. 크롬·엣지에서는 고른 폴더에 바로 저장합니다.";
  }

  let footerText = "";
  if (running) footerText = `${(progress?.step ?? 0) + 1}/${progress?.total ?? runTotal} 폴더 · ${Math.floor(overall * 100)}%`;
  else if (status === "done") {
    footerText = `고른 폴더 ${runTotal}개 중 ${madeCount}개를 만들었습니다.`;
    if (fallbackCount) {
      footerText += ` ${fallbackCount}개는 다운로드 폴더로 받았습니다. 브라우저가 여러 파일 다운로드를 물으면 허용을 눌러 주세요.`;
    }
  } else if (groups.length) footerText = `${checkedCount}개 폴더를 붙입니다.`;

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>사진 세로로 붙이기</h1>
        <p className="subtitle">
          폴더를 고르면 그 폴더와 안의 폴더마다 사진을 파일 이름순으로 세로로 이어 붙여 한 장씩 만듭니다. 사진을 직접
          골라 한 장으로 붙일 수도 있습니다. 사진은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        <p className="st-example">
          예: <b>a</b> 폴더를 고르면 그 안의 폴더(<b>1</b>, <b>2</b>…)마다 사진을 붙여 <b>a</b> 폴더에 저장합니다.{" "}
          <b>a</b> 폴더 바로 안에 있는 사진도 따로 붙입니다.
        </p>
        <label className="st-suffix">
          <span>파일 이름 뒤에 붙일 말</span>
          <input
            value={suffix}
            maxLength={40}
            disabled={working}
            onChange={(e) => changeSettings({ suffix: e.target.value })}
          />
        </label>
        {/* 폴더 이름으로 이름을 짓는 방식은 폴더로 붙일 때만 쓴다 */}
        {!picked && (
          <fieldset className="st-naming" disabled={working}>
            <legend>파일 이름</legend>
            {NAMINGS.map((n, i) => (
              <label key={n}>
                <input type="radio" name="naming" checked={naming === n} onChange={() => changeSettings({ naming: n })} />
                {n === "folder" ? "폴더 이름" : "위 폴더_폴더 이름"} <code>{namingExamples[i]}</code>
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="st-naming" disabled={working}>
          <legend>저장 형식</legend>
          {FORMATS.map((f) => (
            <label key={f}>
              <input type="radio" name="format" checked={format === f} onChange={() => changeSettings({ format: f })} />
              {FORMAT_LABELS[f]}
            </label>
          ))}
        </fieldset>
        {format === "jpg" && (
          <fieldset className="st-naming" disabled={working}>
            <legend>JPG 품질</legend>
            {JPG_QUALITIES.map((q) => (
              <label key={q}>
                <input type="radio" name="quality" checked={quality === q} onChange={() => changeSettings({ quality: q })} />
                {q}
              </label>
            ))}
          </fieldset>
        )}
        <p className="st-hint">
          {format === "jpg"
            ? `${QUALITY_HINTS[quality]} 높이가 ${number(JPG_MAX_SIDE)}px을 넘는 묶음은 사진 사이에서 나눠 JPG 여러 장으로 저장합니다.`
            : PNG_HINT}
        </p>
        <div className="st-actions">
          <button type="button" onClick={pickFolder} disabled={busy}>
            {source ? "다른 폴더 고르기" : "폴더 고르기"}
          </button>
          <button type="button" className="secondary" onClick={() => pickPhotos(false)} disabled={busy}>
            {picked ? "다른 사진 고르기" : "사진 고르기"}
          </button>
          <input ref={inputRef} type="file" webkitdirectory="" multiple hidden onChange={onFiles} />
          <input ref={photoInputRef} type="file" accept="image/*" multiple hidden onChange={onPhotoFiles} />
        </div>
        {!source && !picked && <p className="st-save">{saveNote}</p>}
        {notice && (
          <p className="st-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {status === "scanning" && <section className="card st-muted">폴더를 살펴보는 중…</section>}

      {picked && (
        <PickedSection
          photos={picked}
          setPhotos={setPicked}
          onAdd={addMorePhotos}
          onRemove={removePhoto}
          suffix={cleaned}
          format={format}
          quality={quality}
          canAskWhere={typeof window.showSaveFilePicker === "function" && !writeBlocked}
          onRunning={onPickedRunning}
        />
      )}

      {source && status !== "scanning" && (
        <section className="card">
          <div className="st-summary">
            <h2>{source.name}</h2>
            <span>
              사진이 든 폴더 {number(groups.length)}개 · 사진 {number(imageCount)}장
            </span>
          </div>
          {groups.length === 0 ? (
            <p>이 폴더와 그 안의 폴더에는 붙일 사진이 없습니다.</p>
          ) : (
            <>
              <label className="st-all">
                <input
                  ref={allRef}
                  type="checkbox"
                  checked={checkedCount === groups.length}
                  disabled={running}
                  onChange={toggleAll}
                />
                모두 고르기 ({checkedCount}/{groups.length})
              </label>
              <ol className="st-list">
                {groups.map((group, i) => {
                  const result = results[i];
                  const current = running && progress?.index === i;
                  const checked = !unchecked.has(keys[i]);
                  return (
                    <li key={keys[i]} className={[current && "current", !checked && "off"].filter(Boolean).join(" ") || undefined}>
                      <label className="st-row">
                        <input type="checkbox" checked={checked} disabled={running} onChange={() => toggleGroup(keys[i])} />
                        <span className="st-folder">
                          {group.path.length ? group.path.join(" / ") : `${source.name} (고른 폴더)`}
                        </span>
                        <span className="st-muted">사진 {number(group.files.length)}장</span>
                      </label>
                      {group.excluded > 0 && (
                        <p className="st-muted st-small st-excluded">
                          이 화면이 전에 만든 그림 {number(group.excluded)}개는 빼고 붙입니다.
                        </p>
                      )}
                      <div className="st-out">
                        <span className="st-name">→ {result?.name ?? names[i]}</span>
                        {current ? (
                          <span>{progress.text}</span>
                        ) : (
                          <ResultText
                            result={result}
                            overwrite={checked && Boolean(source.saveDir) && source.existing.has(names[i].toLowerCase())}
                          />
                        )}
                      </div>
                      {current && (
                        <div className="st-bar">
                          <span style={{ width: `${progress.fraction * 100}%` }} />
                        </div>
                      )}
                      {result?.parts > 1 && (
                        <p className="st-split">
                          JPG 한 장에 담기에는 길어 사진과 사진 사이에서 {result.parts}장으로 나눠 저장했습니다.
                        </p>
                      )}
                      {result?.note && <p className="st-fallback">PNG로 저장했습니다. {result.note}.</p>}
                      {result?.saveError && (
                        <p className="st-fallback" title={result.saveError.detail}>
                          {result.parts > 1 && result.fellBack < result.parts ? `${result.parts}장 중 ${result.fellBack}장은 ` : ""}
                          고른 폴더에 저장하지 못해 다운로드 폴더로 받았습니다. {result.saveError.text}
                        </p>
                      )}
                      {result?.skipped?.length > 0 && (
                        <p className="st-skipped">열지 못해 뺀 사진: {result.skipped.join(", ")}</p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          <div className="st-footer">
            {running ? (
              <button type="button" className="secondary" onClick={stop}>
                멈추기
              </button>
            ) : (
              <button type="button" onClick={start} disabled={!checkedCount}>
                {status === "done" ? "다시 만들기" : "만들기"}
              </button>
            )}
            <span className="st-muted">{footerText}</span>
          </div>
          <p className="st-save">{saveNote}</p>
        </section>
      )}

      <section className="st-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>폭은 폴더에서 가장 넓은 사진에 맞춥니다. 크기를 줄이지 않고, 좁은 사진은 가운데에 두고 양옆을 흰색으로 채웁니다.</li>
          <li>
            JPG는 사진에 알맞고 작습니다. JPG 한 장에는 높이 {number(JPG_MAX_SIDE)}px까지 담을 수 있어서, 그보다 긴 묶음은
            사진과 사진 사이에서 고르게 나눠 여러 장(1_합본_1.jpg, 1_합본_2.jpg …)으로 저장합니다. 폭이 넓으면 한 장의 높이가
            더 짧아집니다. 사진 한 장이 그보다 길면 그 사진만 중간에서 자릅니다. 폭이 {number(JPG_MAX_SIDE)}px을 넘는
            묶음은 PNG로 저장합니다. 큰 묶음을 JPG로 만들 때는 메모리를 많이 씁니다.
          </li>
          <li>
            PNG는 화질을 하나도 잃지 않지만 사진에서는 JPG보다 훨씬 큽니다. 색 글자가 많은 그림은 PNG가 더 또렷합니다. 이미
            만든 PNG는 <a href={`${import.meta.env.BASE_URL}convert/`}>사진 형식 바꾸기</a>에서 JPG로 바꿀 수 있습니다.
          </li>
          <li>
            사진 고르기는 고른 사진을 한 장으로 붙입니다. 처음에는 파일 이름순으로 놓고, 끌어서 옮기거나 ↑ ↓로 순서를
            바꿉니다. 브라우저가 고른 사진의 폴더에 쓸 권한은 주지 않아서, 만들 때 저장할 자리를 한 번 묻습니다.
          </li>
          <li>
            같은 이름 파일이 있으면 덮어씁니다. 다 만들기 전에 멈추면 원래 파일은 그대로 남습니다. 여러 장으로 나눠 저장하다
            멈추면 그때까지 저장한 장은 남습니다.
          </li>
          <li>
            고른 폴더에 저장하지 못하면 잠깐 뒤 다시 해 보고, 그래도 안 되면 다운로드 폴더로 받습니다. 백신이나 클라우드
            백업 같은 다른 프로그램이 그 파일을 잡고 있을 때 생깁니다.
          </li>
          <li>고른 폴더 자체의 사진은 브라우저가 그 위 폴더 이름을 알려 주지 않아, 이름 방식과 상관없이 고른 폴더 이름으로 저장합니다.</li>
          <li>바탕화면·문서·다운로드 폴더 자체는 크롬·엣지가 고르지 못하게 막습니다. 그 안의 폴더를 고르세요.</li>
          <li>JPG·PNG·WebP·GIF·BMP를 붙입니다. 아이폰 원본(HEIC)과 TIFF는 브라우저가 열지 못해 빼고 붙입니다.</li>
          <li>
            웹 페이지의 사진은 <a href={`${import.meta.env.BASE_URL}photo-saver/`}>페이지 사진 받기</a> 확장
            프로그램으로 받으면 페이지 순서대로 번호가 붙어 그대로 붙일 수 있습니다.
          </li>
        </ul>
      </section>
    </main>
  );
}
