import { useEffect, useRef, useState } from "react";
import { download } from "../shared/download.js";
import { partRange } from "../shared/fileNames.js";
import { fileSize, number } from "../shared/format.js";
import { SPLIT_LABELS } from "../shared/imageInfo.js";
import { explainSaveError, fileExists, removeEmptyFile, SAVE_TRIES, saveToFile, saveToFolder } from "../shared/saveToFolder.js";
import { cancelJob, runJob } from "./jobs.js";
import { movePhoto, outputName, partNames, plannedFormat, sortByName, stitchedSize, usable } from "./photos.js";
import { describe, MADE } from "./progress.js";
import ResultText from "./ResultText.jsx";

// 저장 창에 보일 형식
const SAVE_TYPES = {
  jpg: [{ description: "JPG 그림", accept: { "image/jpeg": [".jpg"] } }],
  png: [{ description: "PNG 그림", accept: { "image/png": [".png"] } }],
};

// 사진을 한 번 열어 크기를 잰다. 작업자(stitchWorker.js)와 같이 휴대폰 사진의 회전 정보(EXIF)를 따라 세운 크기다.
// 열지 못하는 사진이면 { error: true }
let decodeOptions = { imageOrientation: "from-image" };
async function measure(file) {
  try {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, decodeOptions);
    } catch (err) {
      // 이 옵션을 모르는 옛 브라우저는 옵션 없이 연다
      if (!(err instanceof TypeError) || !decodeOptions) throw err;
      decodeOptions = undefined;
      bitmap = await createImageBitmap(file);
    }
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { error: true };
  }
}

// 고른 폴더(dir)에 이 이름(name, 여러 장이면 번호를 붙인 이름들)으로 저장할 이름을 정한다. 이미 있는 이름이 하나라도 있으면
// " (2)"처럼 번호를 붙인다. 폴더를 고르는 창은 저장 창과 달리 덮어쓸지 묻지 않아서, 있던 파일을 덮어쓰지 않게 한다
async function freeNames(dir, name, parts) {
  const stem = name.replace(/\.[^.]*$/, "");
  const ext = name.slice(stem.length);
  for (let n = 1; n < 1000; n++) {
    const base = n === 1 ? name : `${stem} (${n})${ext}`;
    const names = parts > 1 ? partNames(base, parts) : [base];
    const taken = await Promise.all(names.map((each) => fileExists(dir, each)));
    if (!taken.some(Boolean)) return names;
  }
  throw new Error("저장할 이름을 정하지 못했습니다");
}

// 직접 고른 사진을 목록 순서대로 한 장으로 붙인다. JPG 한 장에 담기에 너무 길면 사진 사이에서 나눠 여러 장으로 저장한다.
// photos: 고른 사진(photos.js), setPhotos: 목록을 바꾼다(순서, 잰 크기), onAdd: 사진 더하기, onRemove(id): 사진 빼기,
// suffix: 이름 뒤에 붙일 말, format·quality: 저장 형식과 JPG 품질, split·splitMode: 너무 긴 묶음을 나눌지와 나누는 방법,
// canAskWhere: 저장 창을 띄울 수 있는지(크롬·엣지), onRunning(만드는 중인지): 만드는 동안 위쪽 설정을 잠그게 알린다
export default function PickedSection({ photos, setPhotos, onAdd, onRemove, suffix, format, quality, split, splitMode, canAskWhere, onRunning }) {
  const [running, setRunning] = useState(false);
  // { fraction, text }
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  // 끌어다 놓으려는 자리 (그 줄을 표시한다)
  const [over, setOver] = useState(null);
  const dragFrom = useRef(null);
  const measuring = useRef(new Set());
  const stopRef = useRef(false);
  // 고른 파일에 쓰는 중인 스트림. 멈추기를 누르면 그만 쓰게 한다
  const savingRef = useRef(null);

  // 사진을 하나씩 열어 크기를 잰다. 붙였을 때의 크기를 미리 알아야 저장 창에 알맞은 형식(JPG·PNG)을 보일 수 있다.
  // 한꺼번에 열면 큰 사진에서 메모리를 많이 써서 하나씩 한다
  useEffect(() => {
    if (measuring.current.size) return;
    const next = photos.find((photo) => !photo.width && !photo.error);
    if (!next) return;
    measuring.current.add(next.id);
    measure(next.file).then((size) => {
      measuring.current.delete(next.id);
      setPhotos((list) => list?.map((photo) => (photo.id === next.id ? { ...photo, ...size } : photo)) ?? list);
    });
  }, [photos, setPhotos]);

  // 사진이나 순서, 설정이 바뀌면 지난 결과는 지운다. 남겨 두면 지금 목록의 결과처럼 보인다
  const signature = `${photos.map((photo) => photo.id).join()}|${suffix}|${format}|${quality}|${split}|${splitMode}`;
  useEffect(() => {
    setResult(null);
  }, [signature]);

  useEffect(() => {
    onRunning(running);
    if (!running) return undefined;
    // 만드는 동안 탭을 닫거나 새로 고치려 하면 브라우저가 한 번 묻게 한다
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running, onRunning]);

  const list = usable(photos);
  const size = stitchedSize(photos);
  // { ext, note, parts }: 저장할 형식과 장수. 사진 크기를 다 재야 안다
  const plan = plannedFormat(format, photos, split);
  const name = outputName(photos, suffix, plan?.ext ?? format, plan?.parts ?? 1);
  const shownName = plan?.parts > 1 ? partRange(partNames(name, plan.parts)) : name;
  const measured = photos.filter((photo) => photo.width || photo.error).length;

  const move = (from, to) => setPhotos((current) => movePhoto(current, from, to));

  // 만든 그림을 저장한다. 저장 창에서 고른 파일(where.target)이나 고른 폴더(where.dir)가 있으면 거기에, 없으면 다운로드로 받는다.
  // where.ext는 저장 창을 띄울 때 정한 형식이다. planned는 그때 지은 이름이다
  async function save(made, where, planned) {
    const { target, dir, ext } = where;
    if (made.type !== "done") {
      if (target) await removeEmptyFile(target);
      return made;
    }
    const { parts, ...rest } = made;
    const options = (which) => ({
      stopped: () => stopRef.current,
      hold: (writable) => {
        savingRef.current = writable;
      },
      onTry: (n) => setProgress({ fraction: MADE, text: `${n === 1 ? "저장하는 중" : `다시 저장하는 중 (${n}/${SAVE_TRIES})`}${which}` }),
    });
    // 한 장: 저장 창에서 고른 파일에 쓴다
    if (target && parts.length === 1 && made.format === ext) {
      const { blob } = parts[0];
      const saved = await saveToFile(target, blob, options(""));
      const result = { ...rest, name: target.name, names: [target.name], parts: 1 };
      if (saved.ok) return { ...result, savedTo: "file" };
      if (saved.cancelled) return { type: "cancelled" };
      download(blob, target.name);
      return { ...result, savedTo: "download", saveError: explainSaveError(saved.error) };
    }
    // JPG로 만들다 실패해 PNG가 됐으면 저장 창에서 고른 .jpg 파일에는 쓰지 않는다
    if (target) await removeEmptyFile(target);
    const single = planned.replace(/\.[^.]*$/, `.${made.format}`);
    // 여러 장: 고른 폴더에 번호를 붙여 저장한다. 끝내 저장하지 못한 장은 다운로드로 받는다
    if (dir) {
      const names = await freeNames(dir, single, parts.length);
      let saveError = null;
      let fellBack = 0;
      for (const [k, part] of parts.entries()) {
        const saved = await saveToFolder(dir, names[k], part.blob, options(parts.length > 1 ? ` (${k + 1}/${parts.length}장)` : ""));
        if (saved.cancelled) return { type: "cancelled" };
        if (!saved.ok) {
          download(part.blob, names[k]);
          saveError ??= explainSaveError(saved.error);
          fellBack++;
        }
      }
      const savedTo = fellBack === parts.length ? "download" : "folder";
      return { ...rest, name: partRange(names), names, parts: parts.length, savedTo, saveError, fellBack };
    }
    const names = parts.length > 1 ? partNames(single, parts.length) : [single];
    parts.forEach((part, k) => download(part.blob, names[k]));
    return { ...rest, name: partRange(names), names, parts: parts.length, savedTo: "download", formatChanged: Boolean(target) };
  }

  async function start() {
    const { ext, parts } = plan;
    let target = null;
    let dir = null;
    if (canAskWhere) {
      // 저장 창은 버튼을 누른 바로 그때만 띄울 수 있어서 붙이기 전에 먼저 묻는다. 첫 사진이 있는 폴더에서 열린다.
      // 여러 장으로 나눠 저장할 때는 파일 하나를 고르는 저장 창 대신 저장할 폴더를 묻는다
      try {
        if (parts > 1) {
          dir = await window.showDirectoryPicker({ id: "stitch-save-folder", startIn: list[0].handle ?? "pictures", mode: "readwrite" });
        } else {
          target = await window.showSaveFilePicker({ id: "stitch-save", suggestedName: name, startIn: list[0].handle ?? "pictures", types: SAVE_TYPES[ext] });
        }
      } catch (err) {
        if (err.name === "AbortError") return; // 창을 닫음
        // 창을 띄우지 못하면(파일 쓰기를 막아 둔 브라우저 등) 다운로드로 받는다
      }
    }
    stopRef.current = false;
    setResult(null);
    setRunning(true);
    setProgress({ fraction: 0, text: "사진 여는 중" });
    const startedAt = performance.now();
    let outcome;
    try {
      const made = await runJob(
        list.map((photo) => photo.file),
        { format, quality, split, splitMode },
        (p) => setProgress(describe(p)),
        list.map(({ width, height }) => ({ width, height })),
      );
      outcome = await save(made, { target, dir, ext }, name);
    } catch (err) {
      if (target) await removeEmptyFile(target);
      outcome = { type: "error", message: err.message };
    }
    setResult({ ...outcome, ms: performance.now() - startedAt });
    setProgress(null);
    setRunning(false);
  }

  function stop() {
    stopRef.current = true;
    cancelJob();
    savingRef.current?.abort(new DOMException("멈춤", "AbortError")).catch(() => {});
  }

  let footerText = "";
  if (running) footerText = `${Math.floor((progress?.fraction ?? 0) * 100)}%`;
  else if (!size && list.length) footerText = `사진 크기 확인 중 ${measured}/${photos.length}`;
  else if (list.length) footerText = `사진 ${number(list.length)}장을 한 장으로 붙입니다.`;
  else footerText = "붙일 수 있는 사진이 없습니다.";

  return (
    <section className="card">
      <div className="st-summary">
        <h2>고른 사진</h2>
        <span>
          사진 {number(photos.length)}장{size && ` · 붙이면 ${number(size.width)}×${number(size.height)}px`}
        </span>
      </div>
      <div className="st-photo-tools">
        <button type="button" className="link" onClick={onAdd} disabled={running}>
          사진 더하기
        </button>
        <button type="button" className="link" onClick={() => setPhotos((current) => sortByName(current))} disabled={running}>
          이름순으로
        </button>
        <span className="st-muted">위에서부터 이 순서로 붙입니다. 끌어서 옮기거나 ↑ ↓로 바꿉니다.</span>
      </div>
      <ol className="st-photos">
        {photos.map((photo, i) => (
          <li
            key={photo.id}
            className={[photo.error && "bad", over === i && "over"].filter(Boolean).join(" ") || undefined}
            draggable={!running}
            onDragStart={(e) => {
              dragFrom.current = i;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragFrom.current === null) return;
              e.preventDefault();
              setOver(i);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom.current !== null) move(dragFrom.current, i);
              dragFrom.current = null;
              setOver(null);
            }}
            onDragEnd={() => {
              dragFrom.current = null;
              setOver(null);
            }}
          >
            <span className="st-photo-num">{i + 1}</span>
            <img
              className="st-thumb"
              src={photo.url}
              alt=""
              loading="lazy"
              decoding="async"
              draggable={false}
              onError={(e) => {
                e.currentTarget.style.visibility = "hidden";
              }}
            />
            <span className="st-photo-name">
              {photo.name}
              <small>
                {photo.error && "열지 못하는 사진이라 빼고 붙입니다"}
                {!photo.error && (photo.width ? `${number(photo.width)}×${number(photo.height)}px · ${fileSize(photo.bytes)}` : "크기 확인 중…")}
              </small>
            </span>
            <span className="st-photo-actions">
              <button type="button" className="secondary" disabled={running || i === 0} onClick={() => move(i, i - 1)} aria-label={`${photo.name} 위로`} title="위로">
                ↑
              </button>
              <button
                type="button"
                className="secondary"
                disabled={running || i === photos.length - 1}
                onClick={() => move(i, i + 1)}
                aria-label={`${photo.name} 아래로`}
                title="아래로"
              >
                ↓
              </button>
              <button type="button" className="secondary" disabled={running} onClick={() => onRemove(photo.id)} aria-label={`${photo.name} 빼기`} title="빼기">
                ✕
              </button>
            </span>
          </li>
        ))}
      </ol>
      <div className="st-out st-picked-out">
        <span className="st-name">→ {result?.name ?? shownName}</span>
        {running ? <span>{progress?.text}</span> : <ResultText result={result} />}
      </div>
      {running && (
        <div className="st-bar">
          <span style={{ width: `${(progress?.fraction ?? 0) * 100}%` }} />
        </div>
      )}
      {!result && plan?.parts > 1 && (
        <p className="st-split">
          JPG 한 장에 담기에는 길어 사진과 사진 사이에서 {plan.parts}장으로 나눠 저장합니다 ({SPLIT_LABELS[splitMode]}).
        </p>
      )}
      {result?.parts > 1 && (
        <p className="st-split">
          JPG 한 장에 담기에는 길어 사진과 사진 사이에서 {result.parts}장으로 나눠 저장했습니다 ({SPLIT_LABELS[result.splitMode]}).
        </p>
      )}
      {!result && plan?.note && <p className="st-fallback">JPG로 만들 수 없어 PNG로 저장합니다. {plan.note}.</p>}
      {result?.note && <p className="st-fallback">PNG로 저장했습니다. {result.note}.</p>}
      {result?.formatChanged && <p className="st-fallback">고른 파일과 형식이 달라져 다운로드 폴더로 받았습니다.</p>}
      {result?.saveError && (
        <p className="st-fallback" title={result.saveError.detail}>
          {result.parts > 1 && result.fellBack < result.parts ? `${result.parts}장 중 ${result.fellBack}장은 ` : ""}
          고른 자리에 저장하지 못해 다운로드 폴더로 받았습니다. {result.saveError.text}
        </p>
      )}
      <div className="st-footer">
        {running ? (
          <button type="button" className="secondary" onClick={stop}>
            멈추기
          </button>
        ) : (
          <button type="button" onClick={start} disabled={!plan}>
            {result?.type === "done" ? "다시 만들기" : "만들기"}
          </button>
        )}
        <span className="st-muted">{footerText}</span>
      </div>
      <p className="st-save">
        {!canAskWhere && "다운로드 폴더로 받습니다."}
        {canAskWhere &&
          (plan?.parts > 1
            ? "여러 장으로 나눠 저장해서, 만들 때 저장할 폴더를 묻습니다. 창은 첫 사진이 있는 폴더에서 열립니다. 그 폴더에 같은 이름 파일이 있으면 덮어쓰지 않고 이름에 번호를 붙입니다."
            : "만들 때 저장할 자리와 이름을 묻습니다. 저장 창은 첫 사진이 있는 폴더에서 열립니다.")}
      </p>
    </section>
  );
}
