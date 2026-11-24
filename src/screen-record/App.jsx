import { useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { fileSize } from "../shared/format.js";
import { explainSaveError, saveToFile } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import {
  clock,
  DEFAULT_QUALITY,
  DEFAULT_RATE,
  displayOptions,
  fileName,
  FORMATS,
  pickMime,
  QUALITIES,
  RATES,
  SURFACE_LABELS,
  SURFACE_NAMES,
  SURFACES,
} from "./record.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.screenRecord.v1";
// 녹화한 것을 이 간격으로 받아 둔다(ms). 도중에 브라우저가 죽어도 그때까지 받은 것은 남지 않지만, 지금까지의 크기를 보일 수 있다
const SLICE_MS = 1000;
// 이보다 큰 녹화는 다시 담지 않는다 (다시 담을 때 파일 전체를 메모리에 한 벌 더 올린다)
const TIDY_MAX = 400 * 1024 * 1024;
const TITLE = document.title;

// 설정: { surface(SURFACES), audio: 소리도 담을지, rate(RATES), quality(QUALITIES의 key), format(FORMATS) }
function loadSettings() {
  const settings = { surface: SURFACES[0], audio: false, rate: DEFAULT_RATE, quality: DEFAULT_QUALITY, format: FORMATS[0] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (SURFACES.includes(saved?.surface)) settings.surface = saved.surface;
    if (typeof saved?.audio === "boolean") settings.audio = saved.audio;
    if (RATES.includes(saved?.rate)) settings.rate = saved.rate;
    if (QUALITIES.some((q) => q.key === saved?.quality)) settings.quality = saved.quality;
    if (FORMATS.includes(saved?.format)) settings.format = saved.format;
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

const canRecord = () => typeof navigator.mediaDevices?.getDisplayMedia === "function" && typeof window.MediaRecorder === "function";

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 녹화 중: { surface(고른 것: monitor · window · browser), hasAudio, ext, paused, seconds, size }
  const [live, setLive] = useState(null);
  const [busy, setBusy] = useState(""); // "다듬는 중" 같은 글
  // 녹화한 것: { blob, url, ext, seconds, name, tidied: 다시 담았는지 } · 저장한 결과: { kind, text }
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [notice, setNotice] = useState("");
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const previewRef = useRef(null);
  // 녹화한 시간을 잰다: 지금 구간을 시작한 때(멈춰 있으면 null)와 앞 구간들의 합(ms)
  const clockRef = useRef({ since: null, before: 0 });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장하지 못해도 이번에는 그대로 쓴다
    }
  }, [settings]);

  const elapsed = () => (clockRef.current.before + (clockRef.current.since === null ? 0 : performance.now() - clockRef.current.since)) / 1000;

  // 녹화하는 동안 시간과 크기를 다시 그리고, 탭 제목에도 보인다 (다른 창을 보다가 탭만 봐도 알 수 있게)
  const recording = Boolean(live);
  useEffect(() => {
    if (!recording) {
      document.title = TITLE;
      return undefined;
    }
    const tick = () => {
      const seconds = elapsed();
      const size = chunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0);
      setLive((old) => old && { ...old, seconds, size });
      document.title = `${recorderRef.current?.state === "paused" ? "❚❚" : "●"} ${clock(seconds)} · 화면 녹화`;
    };
    const timer = setInterval(tick, 500);
    return () => clearInterval(timer);
  }, [recording]);

  // 녹화 중이거나 저장하지 않은 녹화가 있으면 탭을 닫을 때 브라우저가 묻는다
  const unsaved = recording || Boolean(busy) || (result && !saved);
  useEffect(() => {
    if (!unsaved) return undefined;
    const ask = (event) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [unsaved]);

  // 페이지를 떠날 때 화면 공유를 끝낸다
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  function clearResult() {
    setResult((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    setSaved(null);
  }

  async function start() {
    setNotice("");
    const quality = QUALITIES.find((q) => q.key === settings.quality);
    const picked = pickMime(settings.format, (mime) => MediaRecorder.isTypeSupported(mime));
    if (!picked) {
      setNotice("이 브라우저는 화면을 녹화하지 못합니다.");
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia(displayOptions(settings));
    } catch (err) {
      // 고르지 않고 닫으면 NotAllowedError가 온다. 아무 말 없이 돌아간다
      if (err.name !== "NotAllowedError" && err.name !== "AbortError") setNotice(`화면을 고르지 못했습니다. ${err.message}`);
      else if (/system|denied by system/i.test(err.message)) setNotice("이 PC의 설정에서 브라우저의 화면 녹화가 막혀 있습니다.");
      return;
    }
    clearResult();
    const video = stream.getVideoTracks()[0];
    const hasAudio = stream.getAudioTracks().length > 0;
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: picked.mime, videoBitsPerSecond: quality.bits, audioBitsPerSecond: 160_000 });
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      setNotice(`녹화를 시작하지 못했습니다. ${err.message}`);
      return;
    }
    streamRef.current = stream;
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => finish(picked, recorder.mimeType || picked.mime);
    recorder.onerror = (event) => setNotice(`녹화하다 오류가 났습니다. ${event.error?.message ?? ""}`);
    // 브라우저의 "공유 중지"를 누르거나 녹화하던 창을 닫으면 녹화를 끝낸다
    video.addEventListener("ended", stop);
    recorder.start(SLICE_MS);
    clockRef.current = { since: performance.now(), before: 0 };
    setLive({ surface: video.getSettings().displaySurface, hasAudio, ext: picked.ext, paused: false, seconds: 0, size: 0 });
    if (previewRef.current) previewRef.current.srcObject = stream;
    if (settings.audio && !hasAudio) setNotice("소리는 담기지 않습니다. 창을 고르면 소리를 받을 수 없고, 화면 전체나 탭을 고를 때 소리 공유를 켜야 합니다.");
    if (picked.ext !== settings.format) setNotice((old) => `${old ? `${old} ` : ""}이 브라우저는 ${settings.format.toUpperCase()}로 녹화하지 못해 ${picked.ext.toUpperCase()}로 녹화합니다.`);
  }

  function stop() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function togglePause() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    const timer = clockRef.current;
    if (recorder.state === "recording") {
      recorder.pause();
      timer.before += performance.now() - timer.since;
      timer.since = null;
      setLive((old) => old && { ...old, paused: true });
    } else if (recorder.state === "paused") {
      recorder.resume();
      timer.since = performance.now();
      setLive((old) => old && { ...old, paused: false });
    }
  }

  // 녹화가 끝났다. 받아 둔 조각을 한 파일로 묶고, 길이와 찾아가기 표가 들어가게 다시 담는다
  async function finish(picked, mime) {
    const seconds = elapsed();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    const type = mime.split(";")[0];
    let blob = new Blob(chunksRef.current, { type });
    chunksRef.current = [];
    setLive(null);
    if (!blob.size) {
      setNotice("녹화된 것이 없습니다.");
      return;
    }
    let tidied = false;
    let length = seconds;
    if (blob.size <= TIDY_MAX) {
      setBusy("파일을 다듬는 중…");
      try {
        const { tidyRecording } = await import("./tidy.js");
        const made = await tidyRecording(blob, picked.ext, type);
        blob = made.blob;
        if (made.duration > 0) length = made.duration;
        tidied = true;
      } catch {
        // 다시 담지 못하면 녹화한 그대로 둔다
      }
      setBusy("");
    }
    setResult({ blob, url: URL.createObjectURL(blob), ext: picked.ext, seconds: length, name: fileName(new Date(), picked.ext), tidied });
  }

  async function save() {
    let target = null;
    if (typeof window.showSaveFilePicker === "function") {
      try {
        target = await window.showSaveFilePicker({
          id: "screen-record-save",
          suggestedName: result.name,
          startIn: "videos",
          types: [{ description: result.ext.toUpperCase(), accept: { [result.blob.type || `video/${result.ext}`]: [`.${result.ext}`] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return;
        // 저장 창을 띄우지 못하면(쓰기를 막아 둔 브라우저 등) 다운로드로 받는다
      }
    }
    if (target) {
      setBusy("저장하는 중…");
      const outcome = await saveToFile(target, result.blob);
      setBusy("");
      if (outcome.ok) {
        setSaved({ kind: "ok", text: `${target.name} 파일로 저장했습니다.` });
        return;
      }
      download(result.blob, result.name);
      setSaved({ kind: "warn", text: `고른 자리에 저장하지 못해 다운로드 폴더로 받았습니다. ${explainSaveError(outcome.error).text}` });
      return;
    }
    download(result.blob, result.name);
    setSaved({ kind: "ok", text: `${result.name} 파일을 다운로드 폴더로 받았습니다.` });
  }

  const supported = canRecord();
  const locked = recording || Boolean(busy);

  return (
    <main className="container sr-page">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>화면 녹화</h1>
        <p className="subtitle">
          창이나 화면을 골라 녹화해 영상 파일로 저장합니다. 녹화한 것은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        {!supported && <p className="sr-notice">이 브라우저는 화면 녹화를 할 수 없습니다. PC의 크롬이나 엣지에서 열어 주세요.</p>}
        {recording ? (
          <>
            <div className="sr-live" aria-live="off">
              <span className="sr-time">
                <span className={`sr-dot${live.paused ? " paused" : ""}`} />
                {clock(live.seconds)}
              </span>
              <span className="sr-muted">
                {live.paused ? "잠깐 멈춤" : "녹화 중"} · {SURFACE_NAMES[live.surface] ?? "화면"} · {fileSize(live.size)}
                {live.hasAudio && " · 소리 포함"}
              </span>
            </div>
            <div className="sr-actions">
              <button type="button" className="sr-stop" onClick={stop}>
                녹화 끝내기
              </button>
              <button type="button" className="secondary" onClick={togglePause}>
                {live.paused ? "이어서 녹화" : "잠깐 멈추기"}
              </button>
            </div>
          </>
        ) : (
          <>
            <fieldset className="sr-options" disabled={locked}>
              <legend>고를 것</legend>
              {SURFACES.map((key) => (
                <label key={key}>
                  <input type="radio" name="surface" checked={settings.surface === key} onChange={() => setSettings((s) => ({ ...s, surface: key }))} />
                  {SURFACE_LABELS[key]}
                </label>
              ))}
            </fieldset>
            <p className="sr-hint">
              {settings.surface === "window"
                ? "고르는 창에 프로그램 창과 크롬 탭만 나옵니다. 고른 창 하나만 녹화되고, 다른 창이 위를 가려도 그 창만 담깁니다."
                : "고르는 창에 화면 전체도 나옵니다. 화면 전체를 고르면 모니터에 보이는 것이 모두 녹화됩니다."}
            </p>
            <fieldset className="sr-options" disabled={locked}>
              <legend>소리</legend>
              <label>
                <input type="checkbox" checked={settings.audio} onChange={(event) => setSettings((s) => ({ ...s, audio: event.target.checked }))} />
                PC·탭의 소리도 담기
              </label>
            </fieldset>
            {settings.audio && (
              <p className="sr-hint">
                화면 전체나 크롬 탭을 고르고, 고르는 창 아래의 소리 공유를 켜야 담깁니다. 프로그램 창을 고르면 소리는 받을 수
                없습니다. 마이크 소리는 담지 않습니다.
              </p>
            )}
            <fieldset className="sr-options" disabled={locked}>
              <legend>초당 장수</legend>
              {RATES.map((rate) => (
                <label key={rate}>
                  <input type="radio" name="rate" checked={settings.rate === rate} onChange={() => setSettings((s) => ({ ...s, rate }))} />
                  {rate}장
                </label>
              ))}
            </fieldset>
            <fieldset className="sr-options" disabled={locked}>
              <legend>화질</legend>
              {QUALITIES.map((q) => (
                <label key={q.key}>
                  <input type="radio" name="quality" checked={settings.quality === q.key} onChange={() => setSettings((s) => ({ ...s, quality: q.key }))} />
                  {q.label}
                </label>
              ))}
            </fieldset>
            <fieldset className="sr-options" disabled={locked}>
              <legend>형식</legend>
              {FORMATS.map((format) => (
                <label key={format}>
                  <input type="radio" name="format" checked={settings.format === format} onChange={() => setSettings((s) => ({ ...s, format }))} />
                  {format.toUpperCase()}
                </label>
              ))}
            </fieldset>
            <div className="sr-actions">
              <button type="button" onClick={start} disabled={!supported || locked}>
                {result ? "새로 녹화하기" : "녹화 시작"}
              </button>
              {busy && <span className="sr-muted">{busy}</span>}
            </div>
          </>
        )}
        {notice && (
          <p className="sr-notice" role="alert">
            {notice}
          </p>
        )}
        {/* 녹화 중인 화면을 작게 보인다. 소리는 내지 않는다 (PC 소리를 녹화하면 되울린다) */}
        <video ref={previewRef} className="sr-video" autoPlay muted playsInline hidden={!recording} />
      </section>

      {result && (
        <section className="card sr-result">
          <h2>녹화한 영상</h2>
          <video className="sr-video" src={result.url} controls playsInline preload="metadata" style={{ marginTop: 0 }} />
          <p>
            {clock(result.seconds)} · {fileSize(result.blob.size)} · {result.ext.toUpperCase()}
            {!result.tidied && " · 파일을 다듬지 못해 재생기에 따라 길이가 안 보이거나 건너뛰기가 안 될 수 있습니다"}
          </p>
          <div className="sr-actions">
            <button type="button" onClick={save} disabled={Boolean(busy)}>
              저장
            </button>
            {saved && <span className={saved.kind === "ok" ? "sr-ok" : "sr-warn"}>{saved.text}</span>}
            {!saved && <span className="sr-muted">저장을 눌러야 파일이 됩니다.</span>}
          </div>
        </section>
      )}

      <section className="sr-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            "녹화 시작"을 누르면 브라우저가 무엇을 녹화할지 묻습니다. 어떤 창을 녹화할지는 매번 그 창에서 직접 골라야 하고,
            이 페이지가 미리 정해 둘 수는 없습니다.
          </li>
          <li>
            녹화하는 동안 이 탭은 열어 두세요. 닫으면 녹화가 사라집니다. 다른 창을 앞에 두고 작업하는 것은 괜찮고, 탭 제목에
            녹화 시간이 보입니다.
          </li>
          <li>
            끝낼 때는 "녹화 끝내기"나 브라우저의 "공유 중지"를 누릅니다. 녹화하던 창을 닫아도 끝납니다. 끝난 뒤 저장을 눌러야
            파일이 됩니다.
          </li>
          <li>창 하나를 녹화할 때 그 창을 최소화하면 화면이 멈춘 채 녹화됩니다. 그 프로그램이 따로 띄우는 창(대화 상자 등)은 담기지 않을 수 있습니다.</li>
          <li>마우스 커서는 함께 녹화됩니다. 넷플릭스 같은 보호된 영상은 검게 나옵니다.</li>
          <li>
            MP4는 어디서나 재생됩니다. 이 브라우저가 MP4로 녹화하지 못하면 WebM으로 녹화합니다. 녹화가 끝나면 재생기에서
            길이가 보이고 건너뛸 수 있게 파일을 한 번 다듬습니다(화질은 그대로).
          </li>
          <li>
            녹화한 것은 저장할 때까지 브라우저가 들고 있습니다. 화질 "보통"으로 1분에 최대 45MB쯤이고, 화면이 멈춰 있는 동안은
            훨씬 적게 씁니다. 아주 긴 녹화(수십 분)는 나눠서 하세요.
          </li>
          <li>
            녹화한 영상으로 움짤을 만들려면 저장한 뒤 <a href={`${import.meta.env.BASE_URL}gif/`}>움짤 만들기</a>에서 여세요.
          </li>
          <li>휴대폰 브라우저에서는 화면 녹화를 할 수 없습니다. 회사 PC는 정책으로 막혀 있을 수 있습니다.</li>
        </ul>
      </section>
    </main>
  );
}
