import { useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { addFile, folderKey, groupFileList, pickedScan, scanDirectory } from "../shared/folderScan.js";
import { fileSize, number } from "../shared/format.js";
import { explainSaveError, fileExists, SAVE_TRIES, saveToFolder } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { BITRATE_HINTS, planFolders, SOURCE_EXTENSIONS, TARGETS, targetOf } from "./formats.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.audioConvert.v1";
const ACCEPT = SOURCE_EXTENSIONS.map((ext) => `.${ext}`);

// 설정: { target: 바꿀 형식(formats.js TARGETS의 key), bitrates: { mp3: kbps, m4a: kbps } }
function loadSettings() {
  const settings = {
    target: TARGETS[0].key,
    bitrates: Object.fromEntries(TARGETS.filter((t) => t.lossy).map((t) => [t.key, t.bitrates[0]])),
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (TARGETS.some((t) => t.key === saved?.target)) settings.target = saved.target;
    for (const t of TARGETS) {
      if (t.lossy && t.bitrates.includes(saved?.bitrates?.[t.key])) settings.bitrates[t.key] = saved.bitrates[t.key];
    }
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 크롬·엣지는 고른 폴더에 바로 쓸 수 있다(File System Access API). 다른 브라우저는 폴더를 읽기만 한다
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

// 변환 코드(Mediabunny)는 커서 바꾸기를 누를 때 받는다. 받지 못했으면(네트워크 끊김 등) 다음에 다시 받는다
let converter = null;
const loadConverter = () =>
  (converter ??= import("./convert.js").catch((err) => {
    converter = null;
    throw err;
  }));

// 결과를 기억할 이름. 폴더 경로와 파일 이름으로 만든다
const itemKey = (folder, item) => `${folder.path.join("/")}/${item.name}`;

function ResultText({ result, exists, label }) {
  if (!result) return exists ? <span className="au-warn">같은 이름의 {label} 파일이 이미 있어 건너뜁니다</span> : null;
  if (result.type === "done") {
    return (
      <span className="au-ok">
        {result.savedTo === "folder" ? "저장함" : "다운로드함"} · {fileSize(result.from)} → {fileSize(result.to)}
        {result.copied && " · 다시 압축하지 않음"}
      </span>
    );
  }
  if (result.type === "skipped") return <span className="au-warn">건너뜀: 같은 이름의 {label} 파일이 이미 있습니다</span>;
  if (result.type === "cancelled") return <span>멈춤</span>;
  return <span className="au-error">바꾸지 못함: {result.message}</span>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const target = targetOf(settings.target);
  const bitrate = settings.bitrates[target.key];
  // 고른 폴더: { name, folders: [{ path, dir, files }] (shared/folderScan.js scanDirectory), canSave: 원본 옆에 저장할 수 있는지 }.
  // 파일을 직접 골랐으면 picked가 붙고 폴더가 하나뿐이다 (pickedScan). 저장할 폴더는 바꿀 때 묻는다
  const [source, setSource] = useState(null);
  // 체크를 끈 파일(itemKey). 폴더나 파일을 새로 고르면 모두 다시 켠다
  const [off, setOff] = useState(() => new Set());
  const [status, setStatus] = useState("idle"); // idle · scanning · ready · running · done
  // 파일마다의 결과 { [itemKey]: done · skipped · error · cancelled }
  const [results, setResults] = useState({});
  // { key: 지금 바꾸는 파일, done: 끝낸 파일 수, total: 바꿀 파일 수, fraction: 이 파일 안의 비율, text }
  const [progress, setProgress] = useState(null);
  const [notice, setNotice] = useState("");
  // 브라우저가 폴더에 쓰기를 막아 두었으면(회사 PC 정책 등) 읽기만 하고 결과는 다운로드로 받는다
  const [writeBlocked, setWriteBlocked] = useState(false);
  const inputRef = useRef(null);
  const fileInputRef = useRef(null);
  // 파일을 직접 골랐을 때, 바꾸기를 누르고 고른 저장 폴더
  const pickedDirRef = useRef(null);
  const allRef = useRef(null);
  const stopRef = useRef(false);
  // 지금 하는 변환(멈추기를 누르면 cancel)과 폴더에 쓰는 중인 스트림(멈추기를 누르면 abort)
  const conversionRef = useRef(null);
  const savingRef = useRef(null);
  const running = status === "running";
  const busy = running || status === "scanning";

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  // 바꾸는 동안 탭을 닫거나 새로 고치려 하면 브라우저가 한 번 묻게 한다
  useEffect(() => {
    if (!running) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function open(scan, canSave) {
    setSource({ ...scan, canSave });
    setOff(new Set());
    setResults({});
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
      dir = await window.showDirectoryPicker({ id: "audio-convert", startIn: "music", mode: writeBlocked ? "read" : "readwrite" });
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
      open(scan, writable);
    } catch (err) {
      setSource(null);
      setStatus("idle");
      setNotice(`폴더를 읽지 못했습니다. ${err.message}`);
    }
  }

  function onFiles(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) open(groupFileList(files), false);
  }

  // 폴더 대신 바꿀 파일을 직접 고른다
  async function pickFiles() {
    setNotice("");
    if (typeof window.showOpenFilePicker !== "function") {
      fileInputRef.current.click();
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        id: "audio-convert-files",
        startIn: "music",
        multiple: true,
        types: [{ description: "오디오", accept: { "audio/*": ACCEPT } }],
      });
    } catch (err) {
      if (err.name === "AbortError") return; // 고르지 않고 닫음
      setNotice(`파일을 열지 못했습니다. ${err.message}`);
      return;
    }
    open(pickedScan(handles.map((handle) => ({ name: handle.name, handle }))), false);
  }

  function onPickedFiles(e) {
    const files = [...e.target.files];
    e.target.value = "";
    if (files.length) open(pickedScan(files.map((file) => ({ name: file.name, file }))), false);
  }

  // 파일 하나를 바꿔 원본과 같은 폴더에 저장한다. 그 폴더에 쓸 수 없으면(또는 끝내 저장하지 못하면) 다운로드로 받는다.
  // 파일을 직접 골랐으면 바꾸기를 누를 때 고른 폴더에 저장한다
  async function convertOne(folder, item, report) {
    let dir = null;
    if (source.picked) dir = pickedDirRef.current;
    else if (source.canSave) dir = folder.dir;
    // 폴더를 읽은 뒤에 같은 이름의 파일이 생겼을 수도 있다. 덮어쓰지 않도록 바꾸기 전에 한 번 더 본다
    if (dir && (await fileExists(dir, item.out))) return { type: "skipped" };
    const file = item.source.file ?? (await item.source.handle.getFile());
    const { convertFile } = await loadConverter();
    const made = await convertFile(file, target.key, bitrate, {
      onStart: (conversion) => {
        conversionRef.current = conversion;
      },
      onProgress: (p) => report({ fraction: 0.95 * p, text: `바꾸는 중 ${Math.floor(p * 100)}%` }),
    });
    conversionRef.current = null;
    const result = { type: "done", from: file.size, to: made.blob.size, copied: made.copied, missing: made.missing };
    if (!dir) {
      download(made.blob, item.out);
      return { ...result, savedTo: "download" };
    }
    const saved = await saveToFolder(dir, item.out, made.blob, {
      stopped: () => stopRef.current,
      hold: (writable) => {
        savingRef.current = writable;
      },
      onTry: (n) => report({ fraction: 0.95, text: n === 1 ? "저장하는 중" : `다시 저장하는 중 (${n}/${SAVE_TRIES})` }),
    });
    if (saved.cancelled) return { type: "cancelled" };
    if (!saved.ok) {
      download(made.blob, item.out);
      return { ...result, savedTo: "download", saveError: explainSaveError(saved.error) };
    }
    return { ...result, savedTo: "folder" };
  }

  async function start() {
    // 파일을 직접 골랐으면 그 폴더에 쓸 권한이 없어 저장할 폴더를 한 번 묻는다. 첫 파일이 있는 폴더에서 열린다.
    // 이 창은 버튼을 누른 바로 그때만 띄울 수 있어서 맨 먼저 한다
    let pickedDir = null;
    if (source.picked && canPickFolder() && !writeBlocked) {
      try {
        pickedDir = await window.showDirectoryPicker({
          id: "audio-convert-save",
          startIn: source.folders[0].files[0]?.handle ?? "music",
          mode: "readwrite",
        });
      } catch (err) {
        if (err.name === "AbortError") return; // 고르지 않고 닫음
        // 폴더를 열지 못하면(쓰기를 막아 둔 브라우저 등) 다운로드로 받는다
      }
    }
    pickedDirRef.current = pickedDir;
    const jobs = planFolders(source, target)
      .folders.flatMap((folder) => folder.items.map((item) => ({ folder, item, key: itemKey(folder, item) })))
      .filter((job) => !off.has(job.key));
    stopRef.current = false;
    setStatus("running");
    setResults({});
    for (const [done, { folder, item, key }] of jobs.entries()) {
      if (stopRef.current) break;
      const at = { key, done, total: jobs.length };
      let result;
      if (item.exists) {
        result = { type: "skipped" };
      } else {
        setProgress({ ...at, fraction: 0, text: "여는 중" });
        try {
          result = await convertOne(folder, item, (p) => setProgress({ ...at, ...p }));
        } catch (err) {
          result = stopRef.current ? { type: "cancelled" } : { type: "error", message: err.message };
        }
        conversionRef.current = null;
      }
      setResults((all) => ({ ...all, [key]: result }));
      // 저장한 파일을 폴더 목록에 적어 둔다. 다시 돌리면 이미 있는 것으로 보고 건너뛴다.
      // 파일을 직접 골랐을 때는 적지 않는다. 다음에 다른 폴더를 고를 수 있어, 있는지는 고른 폴더에서 그때 본다
      if (result.savedTo === "folder" && !source.picked) setSource((s) => addFile(s, folder.path, item.out));
      if (result.type === "cancelled") break;
    }
    setProgress(null);
    setStatus("done");
  }

  function stop() {
    stopRef.current = true;
    conversionRef.current?.cancel().catch(() => {});
    // 폴더에 쓰는 중이면 그만 쓴다. 쓰다 만 임시 파일은 브라우저가 버린다
    savingRef.current?.abort(new DOMException("멈춤", "AbortError")).catch(() => {});
  }

  // 형식이나 음질을 바꾸면 지난 결과는 지운다. 남겨 두면 다른 설정으로 만든 결과처럼 보인다
  function changeSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
    if (status === "done") {
      setResults({});
      setStatus("ready");
    }
  }

  function toggleFile(key) {
    setOff((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  // 폴더 체크박스: 그 폴더의 파일이 모두 켜져 있으면 모두 끄고, 하나라도 꺼져 있으면 모두 켠다
  function toggleFolder(folder) {
    const keysOf = folder.items.map((item) => itemKey(folder, item));
    setOff((set) => {
      const next = new Set(set);
      const allOn = keysOf.every((key) => !next.has(key));
      for (const key of keysOf) {
        if (allOn) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  const plan = source ? planFolders(source, target) : { folders: [], same: 0 };
  const folders = plan.folders;
  const allKeys = folders.flatMap((folder) => folder.items.map((item) => itemKey(folder, item)));
  const fileCount = allKeys.length;
  // 체크해 둔 파일
  const chosen = folders.flatMap((folder) => folder.items.filter((item) => !off.has(itemKey(folder, item))));
  const existingCount = chosen.filter((item) => item.exists).length;
  const all = Object.values(results);
  const made = all.filter((r) => r.type === "done");
  const skippedCount = all.filter((r) => r.type === "skipped").length;
  const failedCount = all.filter((r) => r.type === "error").length;
  const fallbackCount = made.filter((r) => r.saveError).length;
  const missingCount = made.filter((r) => r.missing.length).length;
  const overall = progress ? (progress.done + progress.fraction) / progress.total : 0;

  // 모두 고르기 체크박스는 일부만 골랐을 때 가운데 줄(indeterminate)로 보인다. 이 상태는 HTML 속성이 없어 직접 넣는다
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = chosen.length > 0 && chosen.length < fileCount;
  });

  function toggleAll() {
    setOff(chosen.length === fileCount ? new Set(allKeys) : new Set());
  }

  let saveNote;
  if (source?.picked && canPickFolder() && !writeBlocked) {
    saveNote = `바꿀 때 저장할 폴더를 묻습니다. 창은 첫 파일이 있는 폴더에서 열리고, 그 폴더를 그대로 고르면 원본 옆에 저장됩니다. 묻지 않고 원래 자리에 저장하려면 "폴더 고르기"로 폴더를 고른 뒤 바꿀 파일만 체크하세요.`;
  } else if (source) {
    saveNote = source.canSave
      ? "바꾼 파일은 원본과 같은 폴더에 저장합니다. 원본은 그대로 둡니다."
      : "다운로드 폴더로 받습니다. 브라우저가 여러 파일 다운로드를 물으면 허용을 눌러 주세요.";
  } else {
    saveNote =
      canPickFolder() && !writeBlocked
        ? "바꾼 파일은 원본과 같은 폴더에 저장합니다. 원본은 그대로 둡니다."
        : "이 브라우저에서는 결과를 다운로드 폴더로 받습니다. 크롬·엣지에서는 원본과 같은 폴더에 바로 저장합니다.";
  }

  let footerText = "";
  if (running) {
    footerText = `${(progress?.done ?? 0) + 1}/${progress?.total ?? chosen.length} · ${Math.floor(overall * 100)}%`;
  } else if (status === "done") {
    const parts = [`${number(all.length)}개 중 ${number(made.length)}개를 ${target.label}로 바꿨습니다`];
    if (made.length) {
      const from = made.reduce((sum, r) => sum + r.from, 0);
      const to = made.reduce((sum, r) => sum + r.to, 0);
      parts[0] += ` (${fileSize(from)} → ${fileSize(to)})`;
    }
    if (skippedCount) parts.push(`${number(skippedCount)}개는 같은 이름의 ${target.label} 파일이 있어 건너뛰었습니다`);
    if (failedCount) parts.push(`${number(failedCount)}개는 바꾸지 못했습니다`);
    if (missingCount) parts.push(`${number(missingCount)}개는 태그 일부를 옮기지 못했습니다`);
    if (fallbackCount) {
      parts.push(`${number(fallbackCount)}개는 다운로드 폴더로 받았습니다. 브라우저가 여러 파일 다운로드를 물으면 허용을 눌러 주세요`);
    }
    footerText = `${parts.join(". ")}.`;
  } else if (chosen.length) {
    const count = chosen.length - existingCount;
    footerText = count ? `${number(count)}개를 ${target.label}로 바꿉니다.` : "바꿀 파일이 없습니다.";
    if (existingCount) footerText += ` ${number(existingCount)}개는 같은 이름의 ${target.label} 파일이 있어 건너뜁니다.`;
  }

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>오디오 형식 바꾸기</h1>
        <p className="subtitle">
          폴더나 파일을 고르면 그 안의 오디오 파일을 MP3·M4A·FLAC·WAV 가운데 고른 형식으로 바꿔 원본과 같은 자리에
          저장합니다. 앨범 아트 같은 태그도 옮깁니다. 파일은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        <fieldset className="au-options" disabled={running}>
          <legend>바꿀 형식</legend>
          {TARGETS.map((t) => (
            <label key={t.key}>
              <input type="radio" name="target" checked={target.key === t.key} onChange={() => changeSettings({ target: t.key })} />
              {t.label}
            </label>
          ))}
        </fieldset>
        <p className="au-hint">{target.hint}</p>
        {target.lossy && (
          <>
            <fieldset className="au-options" disabled={running}>
              <legend>음질</legend>
              {target.bitrates.map((kbps) => (
                <label key={kbps}>
                  <input
                    type="radio"
                    name="bitrate"
                    checked={bitrate === kbps}
                    onChange={() => changeSettings({ bitrates: { ...settings.bitrates, [target.key]: kbps } })}
                  />
                  {kbps}kbps{kbps === target.bitrates[0] && " (추천)"}
                </label>
              ))}
            </fieldset>
            <p className="au-hint">{BITRATE_HINTS[target.key][bitrate]}</p>
          </>
        )}
        <p className="au-hint">
          {target.lossy
            ? "MP3·M4A·OGG처럼 이미 압축된 파일을 바꾸면 한 번 더 압축되어 음질이 조금 깎입니다. 높은 음질을 고르면 귀로 구분하기 어렵습니다."
            : "MP3·M4A·OGG처럼 이미 압축된 파일을 바꾸면 음질은 원본 그대로이고(좋아지지는 않습니다) 파일만 커집니다."}
        </p>
        <div className="au-actions">
          <button type="button" onClick={pickFolder} disabled={busy}>
            {source && !source.picked ? "다른 폴더 고르기" : "폴더 고르기"}
          </button>
          <button type="button" className="secondary" onClick={pickFiles} disabled={busy}>
            {source?.picked ? "다른 파일 고르기" : "파일 고르기"}
          </button>
          <input ref={inputRef} type="file" webkitdirectory="" multiple hidden onChange={onFiles} />
          <input ref={fileInputRef} type="file" accept={`audio/*,${ACCEPT.join(",")}`} multiple hidden onChange={onPickedFiles} />
        </div>
        {!source && <p className="au-save">{saveNote}</p>}
        {notice && (
          <p className="au-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {status === "scanning" && <section className="card au-muted">폴더를 살펴보는 중…</section>}

      {source && status !== "scanning" && (
        <section className="card">
          <div className="au-summary">
            <h2>{source.name}</h2>
            <span>
              {!source.picked && `오디오가 든 폴더 ${number(folders.length)}개 · `}
              바꿀 파일 {number(fileCount)}개
              {plan.same > 0 && ` · 이미 ${target.label}인 ${number(plan.same)}개는 바꾸지 않습니다`}
            </span>
          </div>
          {folders.length === 0 ? (
            <p>
              {plan.same
                ? `이미 ${target.label}인 파일만 있습니다. 다른 형식을 고르면 바꿀 수 있습니다.`
                : `오디오 파일(${SOURCE_EXTENSIONS.join(", ")})이 없습니다.`}
            </p>
          ) : (
            <>
              <label className="au-all">
                <input ref={allRef} type="checkbox" checked={chosen.length === fileCount} disabled={running} onChange={toggleAll} />
                모두 고르기 ({number(chosen.length)}/{number(fileCount)})
              </label>
              <ol className="au-list">
                {folders.map((folder) => {
                  // 이 폴더에서 체크해 둔 파일 수. 일부만 골랐으면 폴더 체크박스가 가운데 줄로 보인다
                  const on = folder.items.filter((item) => !off.has(itemKey(folder, item))).length;
                  return (
                    <li key={folderKey(folder)} className={[!on && "off", source.picked && "picked"].filter(Boolean).join(" ") || undefined}>
                      <label className="au-row">
                        {!source.picked && (
                          <input
                            type="checkbox"
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && on < folder.items.length;
                            }}
                            checked={on === folder.items.length}
                            disabled={running}
                            onChange={() => toggleFolder(folder)}
                          />
                        )}
                        <span className="au-folder">
                          {folder.path.length ? folder.path.join(" / ") : source.picked ? source.name : `${source.name} (고른 폴더)`}
                        </span>
                        <span className="au-muted">{number(folder.items.length)}개</span>
                      </label>
                      <ul className="au-files">
                        {folder.items.map((item) => {
                          const key = itemKey(folder, item);
                          const result = results[key];
                          const current = running && progress?.key === key;
                          const checked = !off.has(key);
                          return (
                            <li key={item.name} className={[current && "current", !checked && "off"].filter(Boolean).join(" ") || undefined}>
                              <div className="au-out">
                                <label className="au-file">
                                  <input type="checkbox" checked={checked} disabled={running} onChange={() => toggleFile(key)} />
                                  <span className="au-name">
                                    {item.name} → {item.out}
                                  </span>
                                </label>
                                {current ? <span>{progress.text}</span> : <ResultText result={result} exists={checked && item.exists} label={target.label} />}
                              </div>
                              {result?.missing?.length > 0 && <p className="au-sub au-warn">옮기지 못한 태그: {result.missing.join(", ")}</p>}
                              {result?.saveError && (
                                <p className="au-sub au-warn" title={result.saveError.detail}>
                                  {source.picked ? "고른 폴더에" : "원본 옆에"} 저장하지 못해 다운로드 폴더로 받았습니다. {result.saveError.text}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
          {running && (
            <div className="au-bar">
              <span style={{ width: `${overall * 100}%` }} />
            </div>
          )}
          <div className="au-footer">
            {running ? (
              <button type="button" className="secondary" onClick={stop}>
                멈추기
              </button>
            ) : (
              <button type="button" onClick={start} disabled={chosen.length === existingCount}>
                {status === "done" ? "다시 바꾸기" : "바꾸기"}
              </button>
            )}
            <span className="au-muted">{footerText}</span>
          </div>
          <p className="au-save">{saveNote}</p>
        </section>
      )}

      <section className="au-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>바꾼 파일은 원본과 같은 폴더에 같은 이름으로 저장합니다(x.m4a → x.mp3). 원본은 지우지 않습니다.</li>
          <li>
            확장자 이름만 바꾸는 것이 아니라 소리를 풀어 새 형식으로 다시 만듭니다. 이름만 바꾸면 못 트는 기기나 프로그램이
            있습니다.
          </li>
          <li>
            MP3·M4A·OGG는 크기를 줄이려고 귀에 덜 들리는 소리를 덜어 낸 형식(손실 압축)입니다. 이런 파일끼리 바꾸면 한 번
            더 덜어 내서 음질이 조금 깎이고, FLAC·WAV로 바꿔도 덜어 낸 소리는 돌아오지 않습니다. 원본이 FLAC·WAV면 어느
            형식으로든 한 번만 압축됩니다.
          </li>
          <li>
            이미 고른 형식인 파일(MP3로 바꿀 때의 MP3)은 바꾸지 않습니다. 같은 이름의 파일이 이미 있으면 덮어쓰지 않고
            건너뜁니다.
          </li>
          <li>.aac 파일을 M4A로 바꿀 때처럼 소리 형식이 같으면 다시 압축하지 않고 옮겨 담아 음질이 그대로입니다.</li>
          <li>
            태그(제목·아티스트·앨범·작곡가·앨범 아트 등)도 옮깁니다. MP3에는 윈도우와 오래된 기기가 잘 읽는 방식(ID3v2.3)으로
            씁니다. 옮기지 못한 태그가 있으면 그 파일 줄에 알립니다.
          </li>
          <li>
            MP3·M4A로 바꾸면 맨 앞에 0.05초쯤 빈 소리가 생깁니다. 보통은 티가 나지 않지만, 곡 사이가 이어지는 앨범(라이브
            등)은 곡 사이에 아주 짧은 틈이 들릴 수 있습니다.
          </li>
          <li>
            MP3를 만드는 프로그램(LAME)과 FLAC을 만드는 프로그램은 그 형식으로 처음 바꿀 때 받습니다. M4A는 브라우저에
            들어 있는 것을 쓰고, 이 PC의 브라우저가 고른 음질로 만들지 못하면 따로 받습니다.
          </li>
          <li>
            크롬이 열지 못하는 형식(WMA, AIFF, 아이폰 무손실 녹음 ALAC 등)은 바꿀 수 없습니다. 목록에 나와도 "바꾸지 못함"으로
            끝납니다.
          </li>
          <li>
            원본 옆에 저장하지 못하면 잠깐 뒤 다시 해 보고, 그래도 안 되면 다운로드 폴더로 받습니다. 백신이나 클라우드
            백업 같은 다른 프로그램이 그 파일을 잡고 있을 때 생깁니다.
          </li>
          <li>바탕화면·문서·다운로드 폴더 자체는 크롬·엣지가 고르지 못하게 막습니다. 그 안의 폴더를 고르세요.</li>
          <li>
            앞뒤 잡음을 잘라 내려면 <a href={`${import.meta.env.BASE_URL}audio-cut/`}>오디오 자르기</a>를 쓰세요.
          </li>
        </ul>
      </section>
    </main>
  );
}
