import { useEffect, useMemo, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { fileSize } from "../shared/format.js";
import { explainSaveError, removeEmptyFile, SAVE_TRIES, saveToFile } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { analyze, findSound, QUIET_LEVELS } from "./analyze.js";
import { cutAudio, MIME, openAudio, snap } from "./audio.js";
import Waveform from "./Waveform.jsx";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.audioCut.v1";
const SUFFIX = "자름";
// 파일 고르기 창에 보일 확장자
const AUDIO_EXTENSIONS = [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".oga", ".opus", ".webm", ".mka", ".mp4"];

// 설정: { quiet: 조용하다고 볼 크기(dB, analyze.js QUIET_LEVELS), as: MP3·WAV가 아닌 파일을 저장할 형식('same' · 'wav') }
function loadSettings() {
  const settings = { quiet: -40, as: "same" };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (QUIET_LEVELS.some((level) => level.db === saved?.quiet)) settings.quiet = saved.quiet;
    if (saved?.as === "same" || saved?.as === "wav") settings.as = saved.as;
  } catch {
    // 저장소를 못 쓰는 환경이면 기본값으로 시작한다
  }
  return settings;
}

// 1:23.45처럼 보인다
function clock(seconds) {
  const s = Math.max(0, seconds);
  const minutes = Math.floor(s / 60);
  return `${minutes}:${(s - minutes * 60).toFixed(2).padStart(5, "0")}`;
}
// "1:23.45" 또는 "83.45"를 초로. 읽지 못하면 null
function parseClock(text) {
  const match = /^\s*(?:(\d+):)?(\d+(?:\.\d*)?)\s*$/.exec(text);
  if (!match) return null;
  return (Number(match[1] ?? 0) * 60) + Number(match[2]);
}

// 시각 입력 칸. 고치는 동안은 쓴 글자(draft)를 그대로 두고, 칸을 벗어나거나 Enter를 누르면 반영한다.
// 고치지 않을 때는 늘 지금 값을 보인다
function TimeInput({ label, value, onCommit, disabled }) {
  const [draft, setDraft] = useState(null);
  const commit = () => {
    const seconds = draft == null ? null : parseClock(draft);
    setDraft(null);
    if (seconds != null) onCommit(seconds);
  };
  return (
    <label className="ac-time">
      <span>{label}</span>
      <input
        value={draft ?? clock(value)}
        disabled={disabled}
        inputMode="decimal"
        onFocus={() => setDraft(clock(value))}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    </label>
  );
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 연 파일: { file, handle, opened(audio.js openAudio), analysis, url }
  const [source, setSource] = useState(null);
  const [loading, setLoading] = useState("");
  const [notice, setNotice] = useState("");
  const [range, setRange] = useState({ start: 0, end: 0 });
  const [position, setPosition] = useState(null);
  const [saving, setSaving] = useState(null); // 저장 중 글
  const [result, setResult] = useState(null);
  const audioRef = useRef(null);
  const stopAt = useRef(null);
  const playRun = useRef(0);
  const savingRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장하지 못해도 이번에는 그대로 쓴다
    }
  }, [settings]);

  // 연 파일의 앨범 아트를 보일 주소
  const coverUrl = useMemo(() => {
    const cover = source?.opened.tags.cover;
    return cover ? URL.createObjectURL(new Blob([cover.data], { type: cover.mimeType })) : null;
  }, [source]);
  useEffect(() => () => coverUrl && URL.revokeObjectURL(coverUrl), [coverUrl]);
  useEffect(() => () => source && URL.revokeObjectURL(source.url), [source]);

  async function openFile(file, handle = null) {
    stop();
    setNotice("");
    setResult(null);
    setLoading(`${file.name} 여는 중…`);
    try {
      const opened = await openAudio(file);
      setLoading("파형을 그리는 중…");
      const analysis = await analyze(file);
      setSource({ file, handle, opened, analysis, url: URL.createObjectURL(file) });
      setRange({ start: 0, end: analysis.duration });
    } catch (err) {
      setSource(null);
      setNotice(`이 파일을 열지 못했습니다. 브라우저가 풀지 못하는 형식이거나 파일이 깨졌을 수 있습니다. (${err?.message || err})`);
    }
    setLoading("");
  }

  async function pickFile() {
    if (typeof window.showOpenFilePicker !== "function") {
      document.getElementById("ac-file").click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        id: "audio-cut",
        startIn: "music",
        types: [{ description: "오디오", accept: { "audio/*": AUDIO_EXTENSIONS } }],
      });
      await openFile(await handle.getFile(), handle);
    } catch (err) {
      if (err.name !== "AbortError") setNotice(`파일을 열지 못했습니다. ${err.message}`);
    }
  }

  async function onDrop(e) {
    e.preventDefault();
    const item = [...e.dataTransfer.items].find((i) => i.kind === "file");
    if (!item) return;
    // 끌어다 놓은 파일도 저장 창이 그 파일의 폴더에서 열리도록 핸들을 받아 둔다 (크롬·엣지)
    const handle = (await item.getAsFileSystemHandle?.().catch(() => null)) ?? null;
    const file = handle ? await handle.getFile() : item.getAsFile();
    if (file) openFile(file, handle);
  }

  // 듣기: from초부터 to초까지 원래 파일을 들려준다. 다시 누르면 앞의 듣기(run)는 그만둔다
  function play(from, to) {
    const audio = audioRef.current;
    if (!audio) return;
    const run = ++playRun.current;
    stopAt.current = to;
    audio.currentTime = from;
    audio.play().catch((err) => {
      if (playRun.current !== run) return;
      stop();
      if (err?.name !== "AbortError") setNotice(`이 파일을 들려주지 못했습니다. (${err?.message || err})`);
    });
    const tick = () => {
      if (playRun.current !== run || stopAt.current == null) return;
      setPosition(audio.currentTime);
      if (audio.currentTime >= stopAt.current || audio.ended) {
        stop();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  function stop() {
    stopAt.current = null;
    audioRef.current?.pause();
    setPosition(null);
  }

  function findQuiet() {
    const found = findSound(source.analysis, settings.quiet);
    if (!found) {
      setNotice("소리가 너무 작아 앞뒤를 가리지 못했습니다. 기준을 바꾸거나 직접 고르세요.");
      return;
    }
    setNotice("");
    setResult(null);
    setRange(found);
  }

  function changeRange(next) {
    setResult(null);
    setRange(next);
  }

  const opened = source?.opened;
  const duration = source?.analysis.duration ?? 0;
  const cut = opened ? snap(opened, range.start, range.end) : range;
  const outputExt = opened && opened.kind === "media" && (settings.as === "wav" || !opened.sameFormat) ? "wav" : opened?.ext;
  const stem = source ? source.file.name.replace(/\.[^.]*$/, "") : "";
  const outputName = `${stem}_${SUFFIX}.${outputExt}`;

  async function save() {
    stop();
    const as = outputExt === "wav" && opened.kind === "media" ? "wav" : "same";
    let target = null;
    if (typeof window.showSaveFilePicker === "function") {
      try {
        target = await window.showSaveFilePicker({
          id: "audio-cut-save",
          suggestedName: outputName,
          startIn: source.handle ?? "music",
          types: [{ description: `${outputExt.toUpperCase()} 파일`, accept: { [MIME[outputExt] ?? "audio/*"]: [`.${outputExt}`] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return;
        // 저장 창을 띄우지 못하면(쓰기를 막아 둔 브라우저 등) 다운로드로 받는다
      }
    }
    setSaving("자르는 중");
    setResult(null);
    try {
      const made = await cutAudio(source.file, opened, range.start, range.end, as, (p) => setSaving(`자르는 중 ${Math.round(p * 100)}%`));
      const name = target?.name ?? outputName;
      let savedTo = "download";
      let saveError = null;
      if (target) {
        const saved = await saveToFile(target, made.blob, {
          hold: (writable) => {
            savingRef.current = writable;
          },
          onTry: (n) => setSaving(n === 1 ? "저장하는 중" : `다시 저장하는 중 (${n}/${SAVE_TRIES})`),
        });
        if (saved.ok) savedTo = "file";
        else {
          download(made.blob, name);
          saveError = explainSaveError(saved.error);
        }
      } else download(made.blob, name);
      setResult({ ...made, name, savedTo, saveError, length: cut.end - cut.start, bytes: made.blob.size });
    } catch (err) {
      if (target) await removeEmptyFile(target);
      setResult({ error: err?.message || String(err) });
    }
    setSaving(null);
  }

  const tags = opened?.tags;
  const tagLines = tags ? [["제목", tags.title], ["아티스트", tags.artist], ["앨범", tags.album], ["작곡가", tags.composer]].filter(([, v]) => v) : [];
  const busy = Boolean(loading || saving);

  return (
    <main className="container ac" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>오디오 자르기</h1>
        <p className="subtitle">
          오디오 파일을 열어 앞뒤 잡음 같은 부분을 잘라 내고 저장합니다. 파일은 이 PC 밖으로 나가지 않고 브라우저 안에서만
          처리합니다.
        </p>
      </header>

      <section className="card">
        <div className="ac-actions">
          <button type="button" onClick={pickFile} disabled={busy}>
            {source ? "다른 파일 열기" : "파일 열기"}
          </button>
          <span className="ac-muted">또는 파일을 이 화면에 끌어다 놓으세요.</span>
          <input
            id="ac-file"
            type="file"
            accept={`audio/*,${AUDIO_EXTENSIONS.join(",")}`}
            hidden
            onChange={(e) => {
              const file = e.target.files[0];
              e.target.value = "";
              if (file) openFile(file);
            }}
          />
        </div>
        {loading && <p className="ac-muted">{loading}</p>}
        {notice && (
          <p className="ac-notice" role="alert">
            {notice}
          </p>
        )}
        {source && (
          <div className="ac-file">
            {coverUrl && <img className="ac-cover" src={coverUrl} alt="앨범 아트" />}
            <div>
              <strong className="ac-name">{source.file.name}</strong>
              <p className="ac-muted">
                {opened.label} · {clock(duration)} · {fileSize(source.file.size)}
              </p>
              {tagLines.length > 0 && (
                <dl className="ac-tags">
                  {tagLines.map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </div>
        )}
      </section>

      {source && (
        <section className="card">
          <h2>남길 구간</h2>
          <Waveform analysis={source.analysis} duration={duration} start={range.start} end={range.end} position={position} onChange={changeRange} disabled={busy} />
          <div className="ac-ruler" aria-hidden="true">
            <span>0:00</span>
            <span>{clock(duration / 2)}</span>
            <span>{clock(duration)}</span>
          </div>
          <div className="ac-row">
            <TimeInput label="시작" value={cut.start} disabled={busy} onCommit={(t) => changeRange({ start: Math.max(0, Math.min(t, range.end - 0.05)), end: range.end })} />
            <TimeInput label="끝" value={cut.end} disabled={busy} onCommit={(t) => changeRange({ start: range.start, end: Math.min(duration, Math.max(t, range.start + 0.05)) })} />
            <span className="ac-muted">
              남는 길이 {clock(cut.end - cut.start)} · 앞 {clock(cut.start)}, 뒤 {clock(Math.max(0, duration - cut.end))}를 잘라 냅니다
            </span>
          </div>
          <div className="ac-row">
            <button type="button" className="secondary" onClick={findQuiet} disabled={busy}>
              앞뒤 조용한 부분 찾기
            </button>
            <label className="ac-select">
              기준
              <select value={settings.quiet} disabled={busy} onChange={(e) => setSettings((s) => ({ ...s, quiet: Number(e.target.value) }))}>
                {QUIET_LEVELS.map((level) => (
                  <option key={level.db} value={level.db}>
                    {level.label} ({level.db}dB)
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="secondary" onClick={() => changeRange({ start: 0, end: duration })} disabled={busy}>
              처음부터 끝까지
            </button>
          </div>
          <div className="ac-row">
            <button type="button" className="secondary" onClick={() => play(cut.start, cut.end)} disabled={busy}>
              ▶ 남길 구간 듣기
            </button>
            <button type="button" className="secondary" onClick={() => play(cut.start, Math.min(cut.end, cut.start + 3))} disabled={busy}>
              시작 3초
            </button>
            <button type="button" className="secondary" onClick={() => play(Math.max(cut.start, cut.end - 3), cut.end)} disabled={busy}>
              끝 3초
            </button>
            <button type="button" className="secondary" onClick={stop} disabled={position == null}>
              ■ 멈추기
            </button>
          </div>
          {opened.kind === "mp3" && (
            <p className="ac-muted ac-small">MP3는 다시 압축하지 않으려고 0.026초쯤 되는 조각 단위로 맞춰 자릅니다. 위 시각은 맞춘 뒤의 시각입니다.</p>
          )}
          <audio ref={audioRef} src={source.url} preload="auto" onEnded={stop} />
        </section>
      )}

      {source && (
        <section className="card">
          <h2>저장</h2>
          {opened.kind === "media" && (
            <fieldset className="ac-options" disabled={busy}>
              <legend>저장 형식</legend>
              <label>
                <input type="radio" name="as" checked={outputExt !== "wav"} disabled={!opened.sameFormat} onChange={() => setSettings((s) => ({ ...s, as: "same" }))} />
                원래 형식({opened.ext.toUpperCase()})
              </label>
              <label>
                <input type="radio" name="as" checked={outputExt === "wav"} onChange={() => setSettings((s) => ({ ...s, as: "wav" }))} />
                WAV (손실 없음, 파일이 큼, 앨범 아트 같은 태그는 남지 않을 수 있음)
              </label>
            </fieldset>
          )}
          <p className="ac-muted">
            {opened.kind === "mp3" && "다시 압축하지 않아 음질이 그대로이고, 태그(제목·아티스트·작곡가·앨범 아트 등)도 바이트 그대로 남습니다."}
            {opened.kind === "wav" && "샘플 단위로 정확히 자르고, 태그 조각도 그대로 남습니다."}
            {opened.kind === "media" &&
              outputExt !== "wav" &&
              "다시 압축하지 않고 자를 수 있으면 그렇게 하고, 못 하면 한 번 다시 압축합니다. 태그도 옮기고, 빠진 것이 있으면 저장한 뒤 알려 드립니다."}
            {opened.kind === "media" && outputExt === "wav" && "소리를 풀어 16비트 WAV로 저장합니다."}
          </p>
          <div className="ac-row">
            <button type="button" onClick={save} disabled={busy || cut.end - cut.start < 0.05}>
              잘라서 저장
            </button>
            <span className="ac-muted">
              {saving ?? `→ ${outputName}`}
            </span>
          </div>
          {result && !result.error && (
            <div className="ac-result">
              <p className="ac-ok">
                {result.savedTo === "file" ? "저장함" : "다운로드함"} · {result.name} · {clock(result.length)} · {fileSize(result.bytes)} ·{" "}
                {result.reencoded ? "한 번 다시 압축함" : "다시 압축하지 않음"}
              </p>
              {result.missing.length > 0 && <p className="ac-warn">이 형식으로 옮기지 못한 태그: {result.missing.join(", ")}</p>}
              {result.missing.length === 0 && tagLines.length + (tags.cover ? 1 : 0) > 0 && <p className="ac-muted">태그도 그대로 옮겼습니다.</p>}
              {result.saveError && (
                <p className="ac-warn" title={result.saveError.detail}>
                  고른 자리에 저장하지 못해 다운로드 폴더로 받았습니다. {result.saveError.text}
                </p>
              )}
            </div>
          )}
          {result?.error && <p className="ac-warn">저장하지 못했습니다: {result.error}</p>}
          <p className="ac-muted ac-small">
            {typeof window.showSaveFilePicker === "function"
              ? "저장할 때 자리와 이름을 묻습니다. 원본은 바꾸지 않습니다."
              : "다운로드 폴더로 받습니다. 원본은 바꾸지 않습니다."}
          </p>
        </section>
      )}

      <section className="ac-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            MP3는 다시 압축하지 않고 0.026초쯤 되는 조각 단위로 잘라 음질이 그대로입니다. 태그는 바이트 그대로 남기고, 재생
            시간 정보만 새 길이로 고칩니다. MP3의 구조 때문에 재생기에 따라 자른 맨 앞 0.03초쯤이 비어 들릴 수 있습니다.
          </li>
          <li>WAV는 샘플 단위로 정확히 자르고, 태그 조각도 그대로 남습니다.</li>
          <li>
            M4A·OGG·FLAC 같은 형식도 다시 압축하지 않고 조각 단위로 자릅니다(고른 구간 안쪽으로 맞춥니다). 그렇게 못 하는
            경우에만 한 번 다시 압축합니다. 태그도 옮기고, 저장한 뒤 다시 읽어 보아 빠진 것이 있으면 알려 드립니다.
          </li>
          <li>
            앞뒤 조용한 부분 찾기는 가장 큰 소리보다 기준만큼 작은 소리가 이어지는 앞뒤를 빼고, 소리가 잘리지 않게 0.1초씩
            남깁니다. 마이크를 건드리는 소리처럼 큰 잡음은 파형을 보고 직접 고르세요.
          </li>
          <li>크롬이 열지 못하는 형식(WMA, AMR, 아이폰 무손실 녹음 ALAC 등)은 열 수 없습니다.</li>
        </ul>
      </section>
    </main>
  );
}
