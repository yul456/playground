import { useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { fileSize, number } from "../shared/format.js";
import { JPG_MAX_SIDE } from "../shared/imageInfo.js";
import { DEFAULT_JPG_QUALITY } from "../shared/jpgQuality.js";
import { explainSaveError, fileExists, SAVE_TRIES, saveToFolder } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { addFile, directionOf, DIRECTIONS, folderKey, groupFileList, pickedScan, planFolders, scanDirectory } from "./folders.js";
import { cancelJob, runJob } from "./jobs.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.convert.v1";
// 고를 수 있는 JPG 품질과 그 설명. 기본값은 shared/jpgQuality.js에 있다 (처음엔 100이었다가 95로 바꿨다).
// 줄어드는 정도는 3840×2160 사진 두 장으로 잰 어림이다
const QUALITIES = [
  { value: 100, hint: "화질이 원본과 거의 같습니다. 사진은 PNG의 60%쯤으로 줄어듭니다." },
  { value: 95, hint: "눈으로 구분하기 어렵습니다. 사진은 PNG의 20%쯤으로 줄어듭니다." },
  { value: 90, hint: "흔히 쓰는 값입니다. 사진은 PNG의 13%쯤으로 줄어듭니다." },
  { value: 80, hint: "확대하면 차이가 보일 수 있습니다. 사진은 PNG의 9%쯤으로 줄어듭니다." },
];

// 설정: { direction: 바꿀 방향(folders.js DIRECTIONS의 key), quality: JPG 품질 }
function loadSettings() {
  const settings = { direction: DIRECTIONS[0].key, quality: DEFAULT_JPG_QUALITY };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (DIRECTIONS.some((d) => d.key === saved?.direction)) settings.direction = saved.direction;
    if (QUALITIES.some((q) => q.value === saved?.quality)) settings.quality = saved.quality;
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 크롬·엣지는 고른 폴더에 바로 쓸 수 있다(File System Access API). 다른 브라우저는 폴더를 읽기만 한다
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

// 결과를 기억할 이름. 폴더 경로와 파일 이름으로 만든다
const itemKey = (folder, item) => `${folder.path.join("/")}/${item.name}`;

function ResultText({ result, exists, to }) {
  if (!result) return exists ? <span className="cv-warn">같은 이름의 {to}가 이미 있어 건너뜁니다</span> : null;
  if (result.type === "done") {
    // 단색이나 글자가 많은 그림은 JPG가 PNG보다 커지기도 한다. 그런 결과는 눈에 띄게 알린다
    const bigger = result.to > result.from;
    return (
      <span className={bigger ? "cv-warn" : "cv-ok"}>
        {result.savedTo === "folder" ? "저장함" : "다운로드함"} · {fileSize(result.from)} → {fileSize(result.to)} (
        {Math.round((result.to / result.from) * 100)}%){bigger && " · 원본보다 커졌습니다"}
      </span>
    );
  }
  if (result.type === "skipped") return <span className="cv-warn">건너뜀: 같은 이름의 {to}가 이미 있습니다</span>;
  if (result.type === "cancelled") return <span>멈춤</span>;
  return <span className="cv-error">바꾸지 못함: {result.message}</span>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const direction = directionOf(settings.direction);
  const quality = QUALITIES.find((q) => q.value === settings.quality) ?? QUALITIES.find((q) => q.value === DEFAULT_JPG_QUALITY);
  // 고른 폴더: { name, folders: [{ path, dir, files }] (folders.js scanDirectory), canSave: 원본 옆에 저장할 수 있는지 }.
  // 파일을 직접 골랐으면 picked가 붙고 폴더가 하나뿐이다 (folders.js pickedScan). 저장할 폴더는 바꿀 때 묻는다
  const [source, setSource] = useState(null);
  // 체크를 끈 폴더(folderKey). 폴더를 새로 고르면 모두 다시 켠다
  const [unchecked, setUnchecked] = useState(() => new Set());
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
  // 폴더에 쓰는 중인 스트림. 멈추기를 누르면 그만 쓰게 한다
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
    setUnchecked(new Set());
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
      dir = await window.showDirectoryPicker({ id: "convert", startIn: "pictures", mode: writeBlocked ? "read" : "readwrite" });
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
        id: "convert-files",
        startIn: "pictures",
        multiple: true,
        types: [{ description: `${direction.from} 그림`, accept: direction.accept }],
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
    const made = await runJob(file, direction.type, settings.quality, ({ phase }) =>
      report(phase === "open" ? { fraction: 0.1, text: "여는 중" } : { fraction: 0.4, text: `${direction.to}로 만드는 중` }),
    );
    if (made.type !== "done") return made;
    const result = { type: "done", from: file.size, to: made.blob.size };
    if (!dir) {
      download(made.blob, item.out);
      return { ...result, savedTo: "download" };
    }
    const saved = await saveToFolder(dir, item.out, made.blob, {
      stopped: () => stopRef.current,
      hold: (writable) => {
        savingRef.current = writable;
      },
      onTry: (n) => report({ fraction: 0.9, text: n === 1 ? "저장하는 중" : `다시 저장하는 중 (${n}/${SAVE_TRIES})` }),
    });
    if (saved.ok) return { ...result, savedTo: "folder" };
    if (saved.cancelled) return { type: "cancelled" };
    download(made.blob, item.out);
    return { ...result, savedTo: "download", saveError: explainSaveError(saved.error) };
  }

  async function start() {
    // 파일을 직접 골랐으면 그 폴더에 쓸 권한이 없어 저장할 폴더를 한 번 묻는다. 첫 파일이 있는 폴더에서 열린다.
    // 이 창은 버튼을 누른 바로 그때만 띄울 수 있어서 맨 먼저 한다
    let pickedDir = null;
    if (source.picked && canPickFolder() && !writeBlocked) {
      try {
        pickedDir = await window.showDirectoryPicker({
          id: "convert-save",
          startIn: source.folders[0].files[0]?.handle ?? "pictures",
          mode: "readwrite",
        });
      } catch (err) {
        if (err.name === "AbortError") return; // 고르지 않고 닫음
        // 폴더를 열지 못하면(쓰기를 막아 둔 브라우저 등) 다운로드로 받는다
      }
    }
    pickedDirRef.current = pickedDir;
    const jobs = planFolders(source, direction)
      .filter((folder) => !unchecked.has(folderKey(folder)))
      .flatMap((folder) => folder.items.map((item) => ({ folder, item, key: itemKey(folder, item) })));
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
          result = { type: "error", message: err.message };
        }
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
    cancelJob();
    // 폴더에 쓰는 중이면 그만 쓴다. 쓰다 만 임시 파일은 브라우저가 버린다
    savingRef.current?.abort(new DOMException("멈춤", "AbortError")).catch(() => {});
  }

  // 방향이나 품질을 바꾸면 지난 결과는 지운다. 남겨 두면 다른 설정으로 만든 결과처럼 보인다
  function changeSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
    if (status === "done") {
      setResults({});
      setStatus("ready");
    }
  }

  function toggleFolder(key) {
    setUnchecked((set) => {
      const next = new Set(set);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const folders = source ? planFolders(source, direction) : [];
  const keys = folders.map(folderKey);
  const checkedCount = keys.filter((k) => !unchecked.has(k)).length;
  const fileCount = folders.reduce((sum, folder) => sum + folder.items.length, 0);
  const chosen = folders.filter((folder) => !unchecked.has(folderKey(folder))).flatMap((folder) => folder.items);
  const existingCount = chosen.filter((item) => item.exists).length;
  const all = Object.values(results);
  const made = all.filter((r) => r.type === "done");
  const skippedCount = all.filter((r) => r.type === "skipped").length;
  const failedCount = all.filter((r) => r.type === "error").length;
  const fallbackCount = made.filter((r) => r.saveError).length;
  const biggerCount = made.filter((r) => r.to > r.from).length;
  const overall = progress ? (progress.done + progress.fraction) / progress.total : 0;

  // 모두 고르기 체크박스는 일부만 골랐을 때 가운데 줄(indeterminate)로 보인다. 이 상태는 HTML 속성이 없어 직접 넣는다
  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = checkedCount > 0 && checkedCount < folders.length;
  });

  function toggleAll() {
    setUnchecked(checkedCount === folders.length ? new Set(keys) : new Set());
  }

  let saveNote;
  if (source?.picked && canPickFolder() && !writeBlocked) {
    saveNote = `바꿀 때 저장할 폴더를 묻습니다. 창은 첫 파일이 있는 폴더에서 열리고, 그 폴더를 그대로 고르면 원본 옆에 저장됩니다. 원본 ${direction.from}는 그대로 둡니다.`;
  } else if (source) {
    saveNote = source.canSave
      ? `바꾼 파일은 원본과 같은 폴더에 저장합니다. 원본 ${direction.from}는 그대로 둡니다.`
      : "다운로드 폴더로 받습니다. 브라우저가 여러 파일 다운로드를 물으면 허용을 눌러 주세요.";
  } else {
    saveNote =
      canPickFolder() && !writeBlocked
        ? `바꾼 파일은 원본과 같은 폴더에 저장합니다. 원본 ${direction.from}는 그대로 둡니다.`
        : "이 브라우저에서는 결과를 다운로드 폴더로 받습니다. 크롬·엣지에서는 원본과 같은 폴더에 바로 저장합니다.";
  }

  let footerText = "";
  if (running) {
    footerText = `${(progress?.done ?? 0) + 1}/${progress?.total ?? chosen.length} · ${Math.floor(overall * 100)}%`;
  } else if (status === "done") {
    const parts = [`${direction.from} ${number(all.length)}개 중 ${number(made.length)}개를 바꿨습니다`];
    if (made.length) {
      const from = made.reduce((sum, r) => sum + r.from, 0);
      const to = made.reduce((sum, r) => sum + r.to, 0);
      parts[0] += ` (${fileSize(from)} → ${fileSize(to)})`;
    }
    if (skippedCount) parts.push(`${number(skippedCount)}개는 이미 ${direction.to}가 있어 건너뛰었습니다`);
    if (failedCount) parts.push(`${number(failedCount)}개는 바꾸지 못했습니다`);
    if (biggerCount) parts.push(`${number(biggerCount)}개는 원본보다 커졌습니다`);
    if (fallbackCount) {
      parts.push(`${number(fallbackCount)}개는 다운로드 폴더로 받았습니다. 브라우저가 여러 파일 다운로드를 물으면 허용을 눌러 주세요`);
    }
    footerText = `${parts.join(". ")}.`;
  } else if (chosen.length) {
    const count = chosen.length - existingCount;
    footerText = `${direction.from} ${number(count)}개를 바꿉니다.`;
    if (existingCount) footerText += ` ${number(existingCount)}개는 이미 ${direction.to}가 있어 건너뜁니다.`;
  }

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>사진 형식 바꾸기</h1>
        <p className="subtitle">
          폴더를 고르면 그 폴더와 안의 폴더에 있는 PNG를 JPG로 바꿔 원본과 같은 자리에 저장합니다. 바꿀 파일을 직접 고를
          수도 있습니다. 사진은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        <fieldset className="cv-options" disabled={running}>
          <legend>바꿀 방향</legend>
          {DIRECTIONS.map((d) => (
            <label key={d.key}>
              <input
                type="radio"
                name="direction"
                checked={direction.key === d.key}
                onChange={() => changeSettings({ direction: d.key })}
              />
              {d.from} → {d.to}
            </label>
          ))}
        </fieldset>
        <fieldset className="cv-options" disabled={running}>
          <legend>{direction.to} 품질</legend>
          {QUALITIES.map((q) => (
            <label key={q.value}>
              <input
                type="radio"
                name="quality"
                checked={quality.value === q.value}
                onChange={() => changeSettings({ quality: q.value })}
              />
              {q.value}
            </label>
          ))}
        </fieldset>
        <p className="cv-hint">{quality.hint}</p>
        <div className="cv-actions">
          <button type="button" onClick={pickFolder} disabled={busy}>
            {source && !source.picked ? "다른 폴더 고르기" : "폴더 고르기"}
          </button>
          <button type="button" className="secondary" onClick={pickFiles} disabled={busy}>
            {source?.picked ? "다른 파일 고르기" : "파일 고르기"}
          </button>
          <input ref={inputRef} type="file" webkitdirectory="" multiple hidden onChange={onFiles} />
          <input ref={fileInputRef} type="file" accept=".png,image/png" multiple hidden onChange={onPickedFiles} />
        </div>
        {!source && <p className="cv-save">{saveNote}</p>}
        {notice && (
          <p className="cv-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {status === "scanning" && <section className="card cv-muted">폴더를 살펴보는 중…</section>}

      {source && status !== "scanning" && (
        <section className="card">
          <div className="cv-summary">
            <h2>{source.name}</h2>
            <span>
              {!source.picked && `${direction.from}가 든 폴더 ${number(folders.length)}개 · `}
              {direction.from} {number(fileCount)}개
            </span>
          </div>
          {folders.length === 0 ? (
            <p>이 폴더와 그 안의 폴더에는 {direction.from} 파일이 없습니다.</p>
          ) : (
            <>
              {/* 파일을 직접 골랐으면 묶음이 하나라 고르는 칸이 필요 없다 */}
              {!source.picked && (
                <label className="cv-all">
                  <input
                    ref={allRef}
                    type="checkbox"
                    checked={checkedCount === folders.length}
                    disabled={running}
                    onChange={toggleAll}
                  />
                  모두 고르기 ({checkedCount}/{folders.length})
                </label>
              )}
              <ol className="cv-list">
                {folders.map((folder, i) => {
                  const checked = !unchecked.has(keys[i]);
                  return (
                    <li key={keys[i]} className={[!checked && "off", source.picked && "picked"].filter(Boolean).join(" ") || undefined}>
                      <label className="cv-row">
                        {!source.picked && (
                          <input type="checkbox" checked={checked} disabled={running} onChange={() => toggleFolder(keys[i])} />
                        )}
                        <span className="cv-folder">
                          {folder.path.length ? folder.path.join(" / ") : source.picked ? source.name : `${source.name} (고른 폴더)`}
                        </span>
                        <span className="cv-muted">
                          {direction.from} {number(folder.items.length)}개
                        </span>
                      </label>
                      <ul className="cv-files">
                        {folder.items.map((item) => {
                          const key = itemKey(folder, item);
                          const result = results[key];
                          const current = running && progress?.key === key;
                          return (
                            <li key={item.name} className={current ? "current" : undefined}>
                              <div className="cv-out">
                                <span className="cv-name">
                                  {item.name} → {item.out}
                                </span>
                                {current ? (
                                  <span>{progress.text}</span>
                                ) : (
                                  <ResultText result={result} exists={checked && item.exists} to={direction.to} />
                                )}
                              </div>
                              {result?.saveError && (
                                <p className="cv-fallback" title={result.saveError.detail}>
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
            <div className="cv-bar">
              <span style={{ width: `${overall * 100}%` }} />
            </div>
          )}
          <div className="cv-footer">
            {running ? (
              <button type="button" className="secondary" onClick={stop}>
                멈추기
              </button>
            ) : (
              <button type="button" onClick={start} disabled={chosen.length === existingCount}>
                {status === "done" ? "다시 바꾸기" : "바꾸기"}
              </button>
            )}
            <span className="cv-muted">{footerText}</span>
          </div>
          <p className="cv-save">{saveNote}</p>
        </section>
      )}

      <section className="cv-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>바꾼 파일은 원본과 같은 폴더에 같은 이름으로 저장합니다(x.png → x.jpg). 원본은 지우지 않습니다.</li>
          <li>
            파일 고르기는 고른 PNG만 바꿉니다. 브라우저가 고른 파일의 폴더에 쓸 권한은 주지 않아서, 바꿀 때 저장할 폴더를
            한 번 묻습니다.
          </li>
          <li>같은 이름의 JPG가 이미 있으면 덮어쓰지 않고 건너뜁니다. 다시 만들려면 그 JPG를 지우거나 옮긴 뒤 하세요.</li>
          <li>
            JPG는 품질이 100이어도 PNG와 완전히 같지는 않습니다. 하나도 달라지면 안 되는 그림은 PNG로 두세요. 색 글자가
            또렷해야 하면 100을 고르세요. 투명한 부분은 흰색이 됩니다.
          </li>
          <li>
            사진은 JPG가 훨씬 작지만, 단색이나 글자가 많은 그림(화면 캡처 등)은 JPG가 PNG보다 커지기도 합니다. 결과 줄에
            바꾸기 전과 후의 크기가 나옵니다.
          </li>
          <li>
            한 변이 {number(JPG_MAX_SIDE)}px을 넘는 그림은 JPG로 만들 수 없어 건너뜁니다. 큰 그림은 메모리를 많이 써서
            바꾸지 못할 수도 있습니다.
          </li>
          <li>
            원본 옆에 저장하지 못하면 잠깐 뒤 다시 해 보고, 그래도 안 되면 다운로드 폴더로 받습니다. 백신이나 클라우드
            백업 같은 다른 프로그램이 그 파일을 잡고 있을 때 생깁니다.
          </li>
          <li>바탕화면·문서·다운로드 폴더 자체는 크롬·엣지가 고르지 못하게 막습니다. 그 안의 폴더를 고르세요.</li>
          <li>
            사진을 한 장으로 이어 붙이려면 <a href={`${import.meta.env.BASE_URL}stitch/`}>사진 세로로 붙이기</a>를 쓰세요.
          </li>
        </ul>
      </section>
    </main>
  );
}
