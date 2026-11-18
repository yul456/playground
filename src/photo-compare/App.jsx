import { useEffect, useRef, useState } from "react";
import { fileSize, number } from "../shared/format.js";
import { JPG_MAX_SIDE, SPLIT_EXAMPLES, SPLIT_LABELS, SPLIT_MODES } from "../shared/imageInfo.js";
import { DEFAULT_JPG_QUALITY, JPG_QUALITIES } from "../shared/jpgQuality.js";
import { HUB_URL } from "../shared/site.js";
import { Session } from "./session.js";
import {
  chooseBase,
  formatName,
  groupFiles,
  MODE_LABELS,
  MODES,
  qualityId,
  readSettings,
  sizeMismatch,
  STORAGE_KEY,
  ZOOMS,
} from "./versions.js";
import Viewer from "./Viewer.jsx";

// 용량을 재는 순서. 기본 품질부터 재고, 가장 오래 걸리는 100은 마지막에 잰다
const MEASURE_ORDER = [DEFAULT_JPG_QUALITY, ...JPG_QUALITIES.filter((q) => q !== DEFAULT_JPG_QUALITY && q !== 100), ...JPG_QUALITIES.filter((q) => q === 100)];

function loadSettings() {
  try {
    return readSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
    return readSettings(null);
  }
}

// 그림 파일인지 (끌어다 놓은 것 가운데 폴더나 다른 파일은 뺀다)
const isImage = (file) => file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(file.name);

const percent = (part, whole) => `${Math.max(1, Math.round((part / whole) * 100))}%`;

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 원본 { file, name, size, format }
  const [base, setBase] = useState(null);
  // 연 원본 { w, h, cuts: JPG가 나뉘는 줄(shared/rowCuts.js), jpgProblem: JPG로 만들 수 없는 까닭 }
  const [image, setImage] = useState(null);
  const [overview, setOverview] = useState(null);
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState("");
  // 견줄 파일 [{ id, name, size, count: 파일 수, status: opening · ok · error, message, shown }]
  const [files, setFiles] = useState([]);
  // 품질별 용량 { [품질]: { bytes: 잰 장마다의 크기, parts: 장수, error } }
  const [sizes, setSizes] = useState({});
  // 번갈아 보기에서 보는 판
  const [flip, setFlip] = useState("base");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [session, setSession] = useState(null);
  const sessionRef = useRef(null);
  const baseSizeRef = useRef(null);
  const waitingRef = useRef([]); // 원본을 다 열기 전에 고른 견줄 파일
  const nextId = useRef(1);
  const baseInput = useRef(null);
  const addInput = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  useEffect(() => () => sessionRef.current?.dispose(), []);

  const patchFile = (id, patch) => setFiles((list) => list.map((f) => (f.id === id ? { ...f, ...patch } : f)));

  function sendFiles(s, items) {
    for (const item of items) s.add(item.id, item.files);
  }

  function openBase(file, others = []) {
    sessionRef.current?.dispose();
    const s = new Session({
      opened: (data) => {
        if (sessionRef.current !== s) return;
        baseSizeRef.current = { width: data.width, height: data.height };
        setImage({ w: data.width, h: data.height, cuts: data.cuts, jpgProblem: data.jpgProblem });
        setOverview(data.overview);
        setOpening(false);
        if (!data.jpgProblem) s.measure(MEASURE_ORDER);
        sendFiles(s, waitingRef.current);
        waitingRef.current = [];
      },
      openError: (message) => {
        if (sessionRef.current !== s) return;
        setOpenError(message);
        setOpening(false);
      },
      added: ({ id, width, height }) => {
        const problem = sizeMismatch(baseSizeRef.current, { width, height });
        if (problem) s.remove(id);
        patchFile(id, problem ? { status: "error", message: problem } : { status: "ok" });
      },
      addError: ({ id, message }) => patchFile(id, { status: "error", message }),
      cuts: (cuts) => {
        setImage((img) => (img ? { ...img, cuts } : img));
        setSizes({});
        s.measure(MEASURE_ORDER);
      },
      size: ({ quality, bytes, parts }) => setSizes((all) => ({ ...all, [quality]: { bytes, parts } })),
      sizeError: ({ quality, message }) => setSizes((all) => ({ ...all, [quality]: { error: message } })),
      tileError: ({ message }) => setNotice(`일부 칸을 그리지 못했습니다. 그림이 커서 메모리가 모자랄 수 있습니다 (${message})`),
    });
    sessionRef.current = s;
    baseSizeRef.current = null;
    waitingRef.current = [];
    setSession(s);
    setBase({ file, name: file.name, size: file.size, format: formatName(file) });
    setImage(null);
    setOverview(null);
    setOpenError("");
    setFiles([]);
    setSizes({});
    setFlip("base");
    setNotice("");
    setOpening(true);
    s.open(file, settings.splitMode);
    if (others.length) addGroups(others, s);
  }

  function addGroups(groups, s = sessionRef.current) {
    if (!s) return;
    const items = groups.map((group) => ({ id: `f${nextId.current++}`, files: group.files, name: group.name, size: group.size }));
    setFiles((list) => [
      ...list,
      ...items.map((item) => ({ id: item.id, name: item.name, size: item.size, count: item.files.length, status: "opening", shown: true })),
    ]);
    // 원본의 크기를 알아야 견줄 수 있는지 알 수 있어 원본을 연 뒤에 맡긴다
    if (baseSizeRef.current) sendFiles(s, items);
    else waitingRef.current.push(...items);
  }

  function removeFile(id) {
    sessionRef.current?.remove(id);
    setFiles((list) => list.filter((f) => f.id !== id));
  }

  // 고르거나 끌어다 놓은 파일들. 원본이 없으면 그 가운데 하나(PNG 먼저)를 원본으로, 나머지를 견줄 파일로 한다
  function takeFiles(list, asBase) {
    setNotice("");
    const images = list.filter(isImage);
    if (!images.length) {
      setNotice("그림 파일이 아닙니다.");
      return;
    }
    const groups = groupFiles(images);
    if (asBase || !base) {
      const first = chooseBase(groups);
      if (!first) {
        setNotice("원본으로 쓸 파일을 하나 골라 주세요. 나눠 저장한 파일 묶음(x_1.jpg ~ x_3.jpg)은 원본이 될 수 없습니다.");
        return;
      }
      openBase(
        first.files[0],
        groups.filter((group) => group !== first),
      );
    } else {
      addGroups(groups);
    }
  }

  function onBaseInput(e) {
    const list = [...e.target.files];
    e.target.value = "";
    if (list.length) takeFiles(list, true);
  }

  function onAddInput(e) {
    const list = [...e.target.files];
    e.target.value = "";
    if (list.length) takeFiles(list, false);
  }

  // 화면 어디에 끌어다 놓아도 받는다
  useEffect(() => {
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes("Files");
    const over = (e) => {
      if (!hasFiles(e)) return;
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
      takeFiles([...e.dataTransfer.files], false);
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

  function changeSettings(patch) {
    setSettings((s) => ({ ...s, ...patch }));
  }

  function toggleHidden(id) {
    const hidden = new Set(settings.hidden);
    if (!hidden.delete(id)) hidden.add(id);
    changeSettings({ hidden: [...hidden] });
  }

  function changeSplit(splitMode) {
    changeSettings({ splitMode });
    if (image && image.cuts.length > 2) {
      setSizes({});
      sessionRef.current?.split(splitMode);
    }
  }

  // 품질별 용량 글
  function sizeOf(quality) {
    const size = sizes[quality];
    if (!size) return { text: "재는 중…" };
    if (size.error) return { text: "재지 못함", title: size.error };
    const done = size.bytes.length;
    if (done < size.parts) return { text: `재는 중… (${done}/${size.parts}장)` };
    const total = size.bytes.reduce((sum, b) => sum + b, 0);
    return { bytes: total, text: fileSize(total), title: `${number(total)}바이트${size.parts > 1 ? ` (${size.bytes.map(number).join(" + ")})` : ""}` };
  }

  const hidden = new Set(settings.hidden);
  const parts = image ? image.cuts.length - 1 : 1;
  const rows = [];
  if (base && image) {
    rows.push({ id: "base", label: `원본 ${base.format}`, size: { bytes: base.size, text: fileSize(base.size) }, parts: 1, shown: !hidden.has("base") });
    if (!image.jpgProblem) {
      for (const quality of JPG_QUALITIES) {
        const id = qualityId(quality);
        rows.push({ id, label: `JPG ${quality}`, size: sizeOf(quality), parts, shown: !hidden.has(id), jpg: true });
      }
    }
    for (const f of files) {
      rows.push({ id: f.id, label: f.name, size: { bytes: f.size, text: fileSize(f.size) }, parts: f.count, shown: f.shown, file: f });
    }
  }
  const versions = rows
    .filter((row) => row.shown && (!row.file || row.file.status === "ok"))
    .map((row) => ({
      id: row.id,
      label: row.label,
      detail: row.size.bytes ? `${row.size.text}${row.id === "base" ? "" : ` · 원본의 ${percent(row.size.bytes, base.size)}`}` : row.size.text,
    }));
  const current = versions.some((v) => v.id === flip) ? flip : versions[0]?.id;

  function toggleRow(row) {
    if (row.file) patchFile(row.id, { shown: !row.file.shown });
    else toggleHidden(row.id);
  }

  return (
    <main className={`container pc-page${dragging ? " dragging" : ""}`}>
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>사진 비교</h1>
        <p className="subtitle">
          같은 그림의 여러 파일을 나란히 놓고 같은 자리를 함께 옮겨 가며 봅니다. 원본을 고르면 JPG 품질별로 바꿨을 때의 모습과 용량을
          파일을 만들지 않고 보여 줍니다. 사진은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        <div className="pc-actions">
          <button type="button" onClick={() => baseInput.current.click()}>
            {base ? "다른 원본 고르기" : "원본 고르기"}
          </button>
          <button type="button" className="secondary" onClick={() => addInput.current.click()} disabled={!image}>
            견줄 파일 더하기
          </button>
          <input ref={baseInput} type="file" accept="image/*" hidden onChange={onBaseInput} />
          <input ref={addInput} type="file" accept="image/*" multiple hidden onChange={onAddInput} />
        </div>
        <p className="pc-hint">
          {base
            ? "그림을 이 화면에 끌어다 놓으면 견줄 파일로 더합니다. 견줄 파일은 원본과 크기가 같아야 합니다."
            : "그림을 이 화면에 끌어다 놓아도 됩니다. 여러 개를 놓으면 PNG 하나를 원본으로, 나머지를 견줄 파일로 둡니다."}
        </p>
        {notice && (
          <p className="pc-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {base && (
        <section className="card">
          <div className="pc-summary">
            <h2>{base.name}</h2>
            {image && (
              <span>
                {number(image.w)}×{number(image.h)}px · {base.format} {fileSize(base.size)}
              </span>
            )}
          </div>
          {opening && <p className="pc-muted">그림을 여는 중…</p>}
          {openError && (
            <p className="pc-error" role="alert">
              {openError}
            </p>
          )}
          {image?.jpgProblem && <p className="pc-warn">{image.jpgProblem}. 견줄 파일만 볼 수 있습니다.</p>}
          {image && parts > 1 && (
            <>
              <p className="pc-hint">
                높이가 {number(JPG_MAX_SIDE)}px을 넘어 JPG로 바꾸면 {number(parts)}장으로 나뉩니다. 사진 형식 바꾸기와 같은 자리에서
                나누고, 용량은 장마다 더한 값입니다. 옆의 띠에 나뉘는 자리가 주황색 줄로 보입니다.
              </p>
              <fieldset className="pc-options">
                <legend>나누는 방법</legend>
                {SPLIT_MODES.map((mode) => (
                  <label key={mode}>
                    <input type="radio" name="splitMode" checked={settings.splitMode === mode} onChange={() => changeSplit(mode)} />
                    {SPLIT_LABELS[mode]}
                  </label>
                ))}
                <span className="pc-muted">예: 높이 150,000px → {SPLIT_EXAMPLES[settings.splitMode]}</span>
              </fieldset>
            </>
          )}
          {rows.length > 0 && (
            <div className="pc-table-box">
              <table className="pc-table">
                <thead>
                  <tr>
                    <th scope="col">보기</th>
                    <th scope="col">판</th>
                    <th scope="col">크기</th>
                    <th scope="col">원본보다</th>
                    <th scope="col">장수</th>
                    <th scope="col">
                      <span className="pc-hidden">빼기</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const failed = row.file?.status === "error";
                    const waiting = row.file?.status === "opening";
                    return (
                      <tr key={row.id} className={row.shown && !failed ? undefined : "off"}>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={`${row.label} 보기`}
                            checked={row.shown && !failed}
                            disabled={failed}
                            onChange={() => toggleRow(row)}
                          />
                        </td>
                        <th scope="row" className="pc-name">
                          {row.label}
                          {row.jpg && row.id === qualityId(DEFAULT_JPG_QUALITY) && <span className="pc-muted"> (지금 기본값)</span>}
                          {waiting && <span className="pc-muted"> · 여는 중…</span>}
                          {failed && <span className="pc-error"> · {row.file.message}</span>}
                        </th>
                        <td title={row.size.title}>{row.size.text}</td>
                        <td>{row.size.bytes && row.id !== "base" ? percent(row.size.bytes, base.size) : row.id === "base" ? "—" : ""}</td>
                        <td>{row.parts > 1 ? `${number(row.parts)}장` : "1장"}</td>
                        <td>
                          {row.file && (
                            <button type="button" className="pc-remove" aria-label={`${row.label} 빼기`} onClick={() => removeFile(row.id)}>
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {image && (
        <section className="card pc-view-card">
          <div className="pc-toolbar">
            <fieldset className="pc-options">
              <legend>보기</legend>
              {MODES.map((mode) => (
                <label key={mode}>
                  <input type="radio" name="mode" checked={settings.mode === mode} onChange={() => changeSettings({ mode })} />
                  {MODE_LABELS[mode]}
                </label>
              ))}
            </fieldset>
            <fieldset className="pc-options">
              <legend>배율</legend>
              {ZOOMS.map((zoom) => (
                <label key={zoom}>
                  <input type="radio" name="zoom" checked={settings.zoom === zoom} onChange={() => changeSettings({ zoom })} />
                  {zoom * 100}%
                </label>
              ))}
            </fieldset>
          </div>
          {versions.length ? (
            <Viewer
              session={session}
              image={image}
              overview={overview}
              versions={versions}
              mode={settings.mode}
              current={current}
              zoom={settings.zoom}
              onFlip={setFlip}
              onZoom={(zoom) => changeSettings({ zoom })}
            />
          ) : (
            <p className="pc-muted">볼 판을 위 표에서 하나 이상 체크하세요.</p>
          )}
          <p className="pc-hint">
            끌거나 휠로 옮기고, 옆의 띠를 누르면 그 자리로 갑니다. 보기 칸을 누른 뒤 ↑↓ · PageUp/PageDown · Home/End로 옮기고 +/−로
            배율을 바꿉니다. 번갈아 보기에서는 숫자 키로 판을 고르고, Space로 바로 앞에 본 판과 번갈아 봅니다.
          </p>
        </section>
      )}

      <section className="pc-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            JPG 품질별 판은 파일을 만들지 않고, 보고 있는 부분만 그때그때 JPG로 만들어 보여 줍니다. 실제 파일의 압축 칸(16px)에 맞춰
            만들어서, 사진 형식 바꾸기로 바꾼 파일과 화소까지 같습니다.
          </li>
          <li>
            용량은 그림 전체를 품질마다 한 번씩 JPG로 만들어 잽니다. 사진 형식 바꾸기로 바꾼 파일의 크기와 같습니다. 큰 그림은 몇 초에서
            몇십 초 걸리고, 재는 동안에도 볼 수 있습니다.
          </li>
          <li>
            높이가 {number(JPG_MAX_SIDE)}px을 넘는 그림은 JPG 여러 장으로 나뉘어, 사진 형식 바꾸기와 같은 자리에서 나눠 보여 줍니다.
            사진 세로로 붙이기로 처음부터 JPG로 만들면 사진과 사진 사이에서 나누므로 나뉘는 자리가 다를 수 있습니다. 화질은 같습니다.
          </li>
          <li>
            100%는 그림의 화소 하나를 화면의 화소 하나로 보입니다(사진 보기 프로그램의 실제 크기). 화면 배율을 125%처럼 키워 쓰면 다른
            페이지보다 작게 보입니다. 200%·400%는 화소를 그대로 키워 보입니다.
          </li>
          <li>
            견줄 파일은 원본과 크기가 같아야 합니다. 나눠 저장한 파일(x_1.jpg, x_2.jpg …)은 함께 고르면 위에서부터 이어 한 그림으로
            봅니다.
          </li>
          <li>투명한 부분은 흰 바탕으로 보입니다. JPG로 바꿀 때와 같습니다.</li>
          <li>
            원본과 견줄 파일은 통째로 열어 둡니다. 860×60,000px 그림 하나에 메모리를 200MB쯤 씁니다. 아주 큰 그림은 열지 못할 수
            있습니다.
          </li>
          <li>
            PNG를 실제로 JPG로 바꾸려면 <a href={`${import.meta.env.BASE_URL}convert/`}>사진 형식 바꾸기</a>를 쓰세요.
          </li>
        </ul>
      </section>
    </main>
  );
}
