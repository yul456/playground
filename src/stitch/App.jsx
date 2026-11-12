import { useEffect, useRef, useState } from "react";
import { HUB_URL } from "../shared/site.js";
import { cleanSuffix, groupFileList, groupKey, NAMINGS, outputNames, planGroups, scanDirectory } from "./folders.js";
import { cancelJob, runJob } from "./jobs.js";
import { explainSaveError, SAVE_TRIES, saveToFolder } from "./save.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.stitch.v1";
const DEFAULT_SUFFIX = "합본";
// 전에 쓴 붙일 말을 몇 개까지 기억할지. 고른 폴더에서 지난 결과를 알아보는 데 쓴다
const MAX_USED = 10;
// 다운로드한 그림 주소(blob URL)를 풀 때까지의 시간. "여러 파일 다운로드" 허용 창을 늦게 눌러도 받을 수 있게 넉넉히 둔다
const DOWNLOAD_URL_MS = 5 * 60_000;

// 설정: { suffix: 붙일 말, naming: 이름 방식(folders.js NAMINGS), used: 전에 만들 때 쓴 붙일 말(새것부터) }
function loadSettings() {
  const settings = { suffix: DEFAULT_SUFFIX, naming: NAMINGS[0], used: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (typeof saved?.suffix === "string") settings.suffix = saved.suffix;
    if (NAMINGS.includes(saved?.naming)) settings.naming = saved.naming;
    if (Array.isArray(saved?.used)) settings.used = saved.used.filter((s) => typeof s === "string").slice(0, MAX_USED);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 크롬·엣지는 고른 폴더에 바로 쓸 수 있다(File System Access API). 다른 브라우저는 폴더를 읽기만 한다
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_URL_MS);
}

const number = (n) => n.toLocaleString("ko-KR");

function fileSize(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))}KB`;
}

function duration(ms) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}초` : `${Math.floor(s / 60)}분 ${s % 60}초`;
}

// 묶음 안의 비율(0~1)에서 PNG를 다 만든 때. 남은 몫은 고른 폴더에 저장하는 동안이다
const MADE = 0.95;

// 작업자가 보낸 진행 상황을 묶음 안의 비율(0~1)과 글로 바꾼다. 크기 확인은 금방 끝나 10%로 친다
function describe(p) {
  if (p.phase === "measure") return { fraction: 0.1 * (p.done / p.total), text: `사진 크기 확인 ${p.done}/${p.total}` };
  return { fraction: 0.1 + (MADE - 0.1) * (p.rows / p.totalRows), text: `붙이는 중 ${p.done}/${p.total}장` };
}

function ResultText({ result, overwrite }) {
  if (!result) return overwrite ? <span className="st-warn">같은 이름 파일이 있어 덮어씁니다</span> : null;
  if (result.type === "done") {
    return (
      <span className="st-ok">
        {result.savedTo === "folder" ? "저장함" : "다운로드함"} · {number(result.width)}×{number(result.height)}px ·{" "}
        {fileSize(result.bytes)} · {duration(result.ms)}
      </span>
    );
  }
  if (result.type === "cancelled") return <span>멈춤</span>;
  return <span className="st-error">만들지 못함: {result.message}</span>;
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const { suffix, naming, used } = settings;
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
  const inputRef = useRef(null);
  const allRef = useRef(null);
  const stopRef = useRef(false);
  // 고른 폴더에 쓰는 중인 스트림. 멈추기를 누르면 그만 쓰게 한다
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

  function open(scan, saveDir) {
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

  // 묶음 하나를 만든다. PNG를 다 만든 뒤, 고른 폴더에 쓸 수 있으면 거기에 저장하고 아니면 다운로드로 받는다.
  // 고른 폴더에 끝내 저장하지 못해도 다운로드로 받고, 까닭(saveError)을 함께 돌려준다
  async function saveGroup(files, name, report) {
    const made = await runJob(files, (p) => report(describe(p)));
    if (made.type !== "done") return made;
    const { blob, ...result } = made;
    const dir = source.saveDir;
    if (!dir) {
      download(blob, name);
      return { ...result, savedTo: "download" };
    }
    const saved = await saveToFolder(dir, name, blob, {
      stopped: () => stopRef.current,
      hold: (writable) => {
        savingRef.current = writable;
      },
      onTry: (n) => report({ fraction: MADE, text: n === 1 ? "폴더에 저장하는 중" : `다시 저장하는 중 (${n}/${SAVE_TRIES})` }),
    });
    if (saved.ok) return { ...result, savedTo: "folder" };
    if (saved.cancelled) return { type: "cancelled", skipped: result.skipped };
    download(blob, name);
    return { ...result, savedTo: "download", saveError: explainSaveError(saved.error) };
  }

  async function start() {
    const cleaned = cleanSuffix(suffix);
    const { groups, names } = planGroups(source, cleaned, used, naming);
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
        const saved = names[index].toLowerCase();
        setSource((s) => ({ ...s, existing: new Set(s.existing).add(saved) }));
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
  const namingExamples = NAMINGS.map((n) => outputNames([{ path: ["1"] }], cleaned, "a", n)[0]);
  const { groups, names } = source ? planGroups(source, cleaned, used, naming) : { groups: [], names: [] };
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
          폴더를 고르면 그 폴더와 안의 폴더마다 사진을 파일 이름순으로 세로로 이어 붙여 PNG 한 장씩 만듭니다. 사진은
          이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
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
            disabled={running}
            onChange={(e) => changeSettings({ suffix: e.target.value })}
          />
        </label>
        <fieldset className="st-naming" disabled={running}>
          <legend>파일 이름</legend>
          {NAMINGS.map((n, i) => (
            <label key={n}>
              <input type="radio" name="naming" checked={naming === n} onChange={() => changeSettings({ naming: n })} />
              {n === "folder" ? "폴더 이름" : "위 폴더_폴더 이름"} <code>{namingExamples[i]}</code>
            </label>
          ))}
        </fieldset>
        <div className="st-actions">
          <button type="button" onClick={pickFolder} disabled={busy}>
            {source ? "다른 폴더 고르기" : "폴더 고르기"}
          </button>
          <input ref={inputRef} type="file" webkitdirectory="" multiple hidden onChange={onFiles} />
        </div>
        {!source && <p className="st-save">{saveNote}</p>}
        {notice && (
          <p className="st-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {status === "scanning" && <section className="card st-muted">폴더를 살펴보는 중…</section>}

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
                        <span className="st-name">→ {names[i]}</span>
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
                      {result?.saveError && (
                        <p className="st-fallback" title={result.saveError.detail}>
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
          <li>PNG는 JPG보다 훨씬 커서 원본 사진을 여러 장 붙이면 파일이 수백 MB가 될 수 있습니다.</li>
          <li>같은 이름 파일이 있으면 덮어씁니다. 다 만들기 전에 멈추면 원래 파일은 그대로 남습니다.</li>
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
