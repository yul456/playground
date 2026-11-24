import { useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { fileSize, number } from "../shared/format.js";
import { explainSaveError, saveToFile } from "../shared/saveToFolder.js";
import { HUB_URL } from "../shared/site.js";
import { frameDelay, frameTimes, GifWriter, outputSize } from "./gifEncode.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.gif.v1";
// 폭(px). 0은 원본 그대로. 영상보다 크게 키우지는 않는다
const WIDTHS = [320, 480, 640, 0];
const DEFAULT_WIDTH = 480;
// 초당 장수
const RATES = [5, 10, 15, 20];
const DEFAULT_RATE = 10;
// 화질: 앞 장과 채널마다 이만큼까지 다른 화소는 같은 것으로 보고 다시 담지 않는다 (gifEncode.js의 tolerance)
const QUALITIES = [
  { key: "high", label: "좋게", tolerance: 3, hint: "작은 변화도 담습니다. 용량이 가장 큽니다." },
  { key: "normal", label: "보통", tolerance: 8, hint: "눈에 잘 띄지 않는 변화는 담지 않아 용량이 줄어듭니다." },
  { key: "small", label: "작게", tolerance: 16, hint: "용량이 가장 작습니다. 천천히 바뀌는 곳이 뚝뚝 끊겨 보일 수 있습니다." },
];
const DEFAULT_QUALITY = "normal";
// 처음 잡아 두는 구간 길이(초)와, 만들 수 있는 가장 많은 장수·화소 수(장수 × 폭 × 높이)
const FIRST_LENGTH = 5;
const MAX_FRAMES = 600;
const MAX_PIXELS = 400_000_000;
// 이보다 크면 메신저·게시판에 올리기 어렵다고 알린다
const BIG_FILE = 20 * 1024 * 1024;

// 설정: { width(WIDTHS), rate(RATES), quality(QUALITIES의 key), dither: 색 띠 줄이기 }
function loadSettings() {
  const settings = { width: DEFAULT_WIDTH, rate: DEFAULT_RATE, quality: DEFAULT_QUALITY, dither: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (WIDTHS.includes(saved?.width)) settings.width = saved.width;
    if (RATES.includes(saved?.rate)) settings.rate = saved.rate;
    if (QUALITIES.some((q) => q.key === saved?.quality)) settings.quality = saved.quality;
    if (typeof saved?.dither === "boolean") settings.dither = saved.dither;
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 영상을 읽는 코드(Mediabunny)는 커서 영상을 고를 때 받는다. 받지 못했으면 다음에 다시 받는다
let videoCode = null;
const loadVideoCode = () =>
  (videoCode ??= import("./video.js").catch((err) => {
    videoCode = null;
    throw err;
  }));

const OPEN_ERRORS = {
  format: "영상 파일이 아니거나 이 브라우저가 모르는 형식입니다.",
  "no-video": "영상이 들어 있지 않은 파일입니다.",
  read: "파일을 읽지 못했습니다.",
};

const round1 = (seconds) => Math.round(seconds * 10) / 10;
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

// 끌어다 놓은 것에서 파일과 (되면) 파일 핸들을 꺼낸다. 핸들이 있으면 저장 창을 영상의 폴더에서 연다
async function droppedFile(event) {
  const item = [...(event.dataTransfer?.items ?? [])].find((entry) => entry.kind === "file");
  const file = item?.getAsFile() ?? event.dataTransfer?.files?.[0];
  if (!file) return null;
  const handle = await item?.getAsFileSystemHandle?.().catch(() => null);
  return { file, handle: handle?.kind === "file" ? handle : null };
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 고른 영상: { name, url(재생기 주소), handle, opening, info: { start, duration, width, height, decodable } }
  const [video, setVideo] = useState(null);
  const [range, setRange] = useState({ start: 0, end: 0 }); // 재생기의 시각(초)
  const [notice, setNotice] = useState("");
  // 만드는 중: { done, total, size }
  const [progress, setProgress] = useState(null);
  // 만든 움짤: { blob, url, width, height, frames(담은 장수), seconds, name } · 저장한 결과: { text, kind }
  const [result, setResult] = useState(null);
  const [saved, setSaved] = useState(null);
  const [over, setOver] = useState(false);
  const openedRef = useRef(null); // Mediabunny로 연 영상 (video.js의 openVideo)
  const playerRef = useRef(null);
  const inputRef = useRef(null);
  const stopRef = useRef(false);
  const runRef = useRef(0); // 영상을 바꾸면 올려서, 늦게 끝난 일의 결과를 버린다
  const previewRef = useRef(null); // 구간 미리 보기가 멈출 시각

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장하지 못해도 이번에는 그대로 쓴다
    }
  }, [settings]);

  // 페이지를 떠날 때 연 영상을 닫는다
  useEffect(
    () => () => {
      runRef.current++;
      openedRef.current?.input.dispose();
    },
    [],
  );

  // 창 어디에 떨어뜨려도 브라우저가 그 파일을 열어 화면을 떠나지 않게 한다
  useEffect(() => {
    const block = (event) => event.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function clearResult() {
    setResult((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return null;
    });
    setSaved(null);
  }

  async function openFile(file, handle = null) {
    const run = ++runRef.current;
    stopRef.current = true;
    openedRef.current?.input.dispose();
    openedRef.current = null;
    clearResult();
    setProgress(null);
    setNotice("");
    setVideo((old) => {
      if (old) URL.revokeObjectURL(old.url);
      return { name: file.name, url: URL.createObjectURL(file), handle, opening: true, info: null };
    });
    try {
      const { openVideo } = await loadVideoCode();
      const opened = await openVideo(file);
      if (run !== runRef.current) {
        opened.input.dispose();
        return;
      }
      openedRef.current = opened;
      const { start, duration, width, height, decodable } = opened;
      setVideo((old) => old && { ...old, opening: false, info: { start, duration, width, height, decodable } });
      setRange({ start: 0, end: round1(Math.min(duration, FIRST_LENGTH)) });
      if (!decodable) setNotice("이 브라우저가 이 영상의 코덱을 풀지 못해 움짤을 만들 수 없습니다. (아이폰의 HEVC 영상 등)");
    } catch (err) {
      if (run !== runRef.current) return;
      setVideo((old) => {
        if (old) URL.revokeObjectURL(old.url);
        return null;
      });
      setNotice(`"${file.name}": ${OPEN_ERRORS[err.kind] ?? `영상을 읽는 코드를 받지 못했습니다. ${err.message}`}`);
    }
  }

  async function pick() {
    if (typeof window.showOpenFilePicker !== "function") {
      inputRef.current.click();
      return;
    }
    try {
      const [handle] = await window.showOpenFilePicker({
        id: "gif-video",
        startIn: "videos",
        types: [{ description: "영상", accept: { "video/*": [".mp4", ".m4v", ".mov", ".webm", ".mkv"] } }],
      });
      openFile(await handle.getFile(), handle);
    } catch (err) {
      if (err.name !== "AbortError") setNotice(`파일을 열지 못했습니다. ${err.message}`);
    }
  }

  const info = video?.info;
  const duration = info?.duration ?? 0;
  const size = info ? outputSize(info.width, info.height, settings.width) : null;
  const length = Math.max(0, range.end - range.start);
  const frames = info ? frameTimes(range.start, range.end, settings.rate).length : 0;
  const quality = QUALITIES.find((q) => q.key === settings.quality);
  const running = Boolean(progress);
  let problem = "";
  if (info && !info.decodable) problem = "이 영상은 만들 수 없습니다.";
  else if (info && frames < 1) problem = "끝이 시작보다 뒤여야 합니다.";
  else if (frames > MAX_FRAMES) problem = `${number(frames)}장은 너무 많습니다. ${number(MAX_FRAMES)}장까지 만듭니다. 구간을 줄이거나 초당 장수를 낮추세요.`;
  else if (size && frames * size.width * size.height > MAX_PIXELS) problem = "너무 큽니다. 폭을 줄이거나 구간을 줄이세요.";

  // 구간을 고친다. 시작은 끝보다 앞에, 끝은 영상 길이 안에 둔다
  function changeRange(patch) {
    setRange((old) => {
      const next = { ...old, ...patch };
      next.start = clamp(round1(next.start) || 0, 0, Math.max(0, round1(duration) - 0.1));
      next.end = clamp(round1(next.end) || 0, 0, round1(duration));
      if ("start" in patch && next.end <= next.start) next.end = Math.min(round1(duration), round1(next.start + FIRST_LENGTH));
      return next;
    });
  }

  function playRange() {
    const player = playerRef.current;
    previewRef.current = range.end;
    player.currentTime = range.start;
    player.play().catch(() => {});
  }

  // 구간 미리 보기는 끝에서 멈춘다. 직접 틀거나 옮기면 그만둔다
  function onTimeUpdate() {
    const player = playerRef.current;
    if (previewRef.current !== null && player.currentTime >= previewRef.current) {
      player.pause();
      previewRef.current = null;
    }
  }

  async function make() {
    const opened = openedRef.current;
    if (!opened || problem) return;
    const run = runRef.current;
    stopRef.current = false;
    clearResult();
    setNotice("");
    const { width, height } = size;
    const times = frameTimes(opened.start + range.start, opened.start + range.end, settings.rate);
    setProgress({ done: 0, total: times.length, size: 0 });
    try {
      const { renderFrames } = await loadVideoCode();
      const writer = new GifWriter(width, height, { tolerance: quality.tolerance, dither: settings.dither });
      let done = 0;
      let missing = 0;
      for await (const rgba of renderFrames(opened, times, width, height)) {
        if (stopRef.current || run !== runRef.current) return;
        if (rgba) writer.addFrame(rgba, frameDelay(done, settings.rate));
        else if (writer.frames.length) writer.frames[writer.frames.length - 1].delay += frameDelay(done, settings.rate);
        else missing++;
        done++;
        setProgress({ done, total: times.length, size: writer.size });
      }
      if (!writer.frames.length) throw new Error("이 구간에서 화면을 읽지 못했습니다.");
      const blob = new Blob(writer.finish(), { type: "image/gif" });
      const base = video.name.replace(/\.[^.]*$/, "");
      setResult({ blob, url: URL.createObjectURL(blob), width, height, frames: writer.frames.length, seconds: (done - missing) / settings.rate, name: `${base}.gif` });
    } catch (err) {
      if (run === runRef.current) setNotice(`만들지 못했습니다. ${err.message}`);
    } finally {
      if (run === runRef.current) setProgress(null);
    }
  }

  async function save() {
    let target = null;
    if (typeof window.showSaveFilePicker === "function") {
      try {
        target = await window.showSaveFilePicker({
          id: "gif-save",
          suggestedName: result.name,
          startIn: video.handle ?? "pictures",
          types: [{ description: "GIF", accept: { "image/gif": [".gif"] } }],
        });
      } catch (err) {
        if (err.name === "AbortError") return;
        // 저장 창을 띄우지 못하면(쓰기를 막아 둔 브라우저 등) 다운로드로 받는다
      }
    }
    if (target) {
      const outcome = await saveToFile(target, result.blob);
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

  return (
    <main
      className={`container gif-page${over ? " over" : ""}`}
      onDragOver={(event) => {
        if ([...(event.dataTransfer?.types ?? [])].includes("Files")) setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOver(false);
      }}
      onDrop={async (event) => {
        event.preventDefault();
        setOver(false);
        const dropped = await droppedFile(event);
        if (dropped) openFile(dropped.file, dropped.handle);
      }}
    >
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>움짤 만들기</h1>
        <p className="subtitle">
          영상에서 구간을 골라 움직이는 GIF로 만듭니다. 영상은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card gif-drop">
        <div className="gif-pick">
          <button type="button" onClick={pick} disabled={running}>
            {video ? "다른 영상 고르기" : "영상 고르기"}
          </button>
          <span className="gif-muted">{video ? video.name : "영상 파일을 여기에 끌어다 놓아도 됩니다."}</span>
          <input
            ref={inputRef}
            type="file"
            accept="video/*,.mkv"
            hidden
            onChange={(event) => {
              const file = event.target.files[0];
              event.target.value = "";
              if (file) openFile(file);
            }}
          />
        </div>
        {notice && (
          <p className="gif-notice" role="alert">
            {notice}
          </p>
        )}
        {video && (
          // 재생기가 못 트는 영상도 있다(코덱). 그래도 구간은 숫자로 고를 수 있다
          <video
            ref={playerRef}
            className="gif-player"
            src={video.url}
            controls
            muted
            playsInline
            preload="metadata"
            onTimeUpdate={onTimeUpdate}
            onSeeking={() => {
              if (previewRef.current !== null && playerRef.current.currentTime > previewRef.current) previewRef.current = null;
            }}
          />
        )}
        {video?.opening && <p className="gif-muted">영상을 살펴보는 중…</p>}
      </section>

      {info && (
        <section className="card">
          <h2>구간과 크기</h2>
          <fieldset className="gif-range" disabled={running} style={{ border: 0, padding: 0, margin: 0 }}>
            <label>
              시작 (초)
              <span className="gif-time">
                <input
                  type="number"
                  min="0"
                  max={round1(duration)}
                  step="0.1"
                  value={range.start}
                  onChange={(event) => changeRange({ start: Number(event.target.value) })}
                />
                <button type="button" className="secondary" onClick={() => changeRange({ start: playerRef.current.currentTime })}>
                  지금 위치로
                </button>
              </span>
            </label>
            <label>
              끝 (초)
              <span className="gif-time">
                <input
                  type="number"
                  min="0"
                  max={round1(duration)}
                  step="0.1"
                  value={range.end}
                  onChange={(event) => changeRange({ end: Number(event.target.value) })}
                />
                <button type="button" className="secondary" onClick={() => changeRange({ end: playerRef.current.currentTime })}>
                  지금 위치로
                </button>
              </span>
            </label>
            <button type="button" className="secondary" onClick={playRange} disabled={frames < 1}>
              구간 미리 보기
            </button>
          </fieldset>

          <fieldset className="gif-options" disabled={running}>
            <legend>폭</legend>
            {WIDTHS.map((width) => (
              <label key={width}>
                <input type="radio" name="width" checked={settings.width === width} onChange={() => setSettings((s) => ({ ...s, width }))} />
                {width ? `${width}px` : `원본 (${number(info.width)}px)`}
              </label>
            ))}
          </fieldset>
          <fieldset className="gif-options" disabled={running}>
            <legend>초당 장수</legend>
            {RATES.map((rate) => (
              <label key={rate}>
                <input type="radio" name="rate" checked={settings.rate === rate} onChange={() => setSettings((s) => ({ ...s, rate }))} />
                {rate}장
              </label>
            ))}
          </fieldset>
          <fieldset className="gif-options" disabled={running}>
            <legend>화질</legend>
            {QUALITIES.map((q) => (
              <label key={q.key}>
                <input type="radio" name="quality" checked={settings.quality === q.key} onChange={() => setSettings((s) => ({ ...s, quality: q.key }))} />
                {q.label}
              </label>
            ))}
            <label>
              <input type="checkbox" checked={settings.dither} onChange={(event) => setSettings((s) => ({ ...s, dither: event.target.checked }))} />
              색 띠 줄이기
            </label>
          </fieldset>
          <p className="gif-hint">
            {quality.hint}
            {settings.dither && " 색 띠 줄이기는 하늘처럼 색이 서서히 변하는 곳의 띠를 점무늬로 풀어 줍니다. 용량은 늘어납니다."}
          </p>

          <p className="gif-info" data-frames={frames}>
            {length.toFixed(1)}초 · {number(frames)}장 · {number(size.width)}×{number(size.height)}px
          </p>
          {problem && <p className="gif-notice">{problem}</p>}

          <div className="gif-actions">
            {running ? (
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  stopRef.current = true;
                  setProgress(null);
                }}
              >
                멈추기
              </button>
            ) : (
              <button type="button" onClick={make} disabled={Boolean(problem)}>
                {result ? "다시 만들기" : "움짤 만들기"}
              </button>
            )}
            {running && (
              <span className="gif-muted" aria-live="polite">
                {number(progress.done)}/{number(progress.total)}장 · 지금까지 {fileSize(progress.size)}
              </span>
            )}
          </div>
          {running && (
            <div className="gif-bar">
              <span style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
            </div>
          )}
        </section>
      )}

      {result && (
        <section className="card gif-result">
          <h2>만든 움짤</h2>
          <img src={result.url} alt="만든 움짤" width={result.width} height={result.height} />
          <p>
            {fileSize(result.blob.size)} · {number(result.width)}×{number(result.height)}px · {result.seconds.toFixed(1)}초
            {result.frames < Math.round(result.seconds * settings.rate) && ` · 같은 화면은 합쳐 ${number(result.frames)}장`}
          </p>
          {result.blob.size > BIG_FILE && (
            <p className="gif-warn">용량이 큽니다. 폭이나 초당 장수를 줄이거나 화질을 "작게"로 하면 줄어듭니다.</p>
          )}
          <div className="gif-actions">
            <button type="button" onClick={save}>
              저장
            </button>
            {saved && <span className={saved.kind === "ok" ? "gif-ok" : "gif-warn"}>{saved.text}</span>}
          </div>
        </section>
      )}

      <section className="gif-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            GIF는 오래된 형식이라 같은 화면이라도 영상(MP4)보다 용량이 몇 배에서 수십 배 큽니다. 몇 초짜리 짧은 구간에
            맞습니다. 폭과 초당 장수를 줄이는 것이 용량을 가장 많이 줄입니다.
          </li>
          <li>
            한 장에 256색까지만 담깁니다. 장마다 그 장면에 맞는 색을 골라 쓰지만, 하늘처럼 색이 서서히 변하는 곳은 띠가
            질 수 있습니다. "색 띠 줄이기"를 켜면 띠 대신 고운 점무늬가 됩니다.
          </li>
          <li>
            앞 장과 거의 같은 곳은 다시 담지 않습니다. 그래서 화면이 멈춰 있고 일부만 움직이는 영상(화면 녹화 등)은
            용량이 작고, 화면 전체가 움직이는 영상은 큽니다.
          </li>
          <li>소리는 담기지 않습니다. 끝나면 처음부터 계속 되풀이합니다.</li>
          <li>영상보다 크게 키우지는 않습니다. 폭 480px을 골라도 영상이 320px이면 320px로 만듭니다.</li>
          <li>
            한 번에 {number(MAX_FRAMES)}장까지 만듭니다(초당 10장이면 1분). 만든 움짤은 저장을 눌러야 파일이 됩니다.
          </li>
          <li>
            크롬·엣지가 풀 수 있는 영상(H.264, VP9, AV1)이면 됩니다. 아이폰의 HEVC 영상은 PC에 따라 안 될 수 있습니다.
          </li>
          <li>
            영상의 장면을 사진으로 뽑으려면 <a href={`${import.meta.env.BASE_URL}video-frames/`}>영상 장면 뽑기</a>를 쓰세요.
          </li>
        </ul>
      </section>
    </main>
  );
}
