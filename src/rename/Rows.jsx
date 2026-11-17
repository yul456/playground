import { memo, useEffect, useRef, useState } from "react";
import { fileSize } from "../shared/format.js";
import { COVERS_NAME } from "./covers.js";
import { TAG_FORMAT_NAMES } from "./formats.js";
import { cleanName, MAX_NAME } from "./names.js";
import { TAG_FIELDS } from "./tags.js";

const FORMAT_NAMES = { "image/jpeg": "JPG", "image/png": "PNG", "image/gif": "GIF", "image/webp": "WebP", "image/bmp": "BMP" };
const formatName = (mime) => FORMAT_NAMES[mime] ?? mime.replace("image/", "").toUpperCase();

// 미리보기 그림의 긴 변(px). 마우스를 올렸을 때 보이는 큰 그림의 크기다
const PREVIEW = 260;

// 이름을 치는 칸의 글에서 이름에 쓸 수 없는 글자를 빼고, 커서를 뺀 글자만큼 앞으로 당긴다. 결과: cleanName의 결과.
// 칸의 값을 여기서 바로 고쳐 둔다. 리액트가 나중에 값을 고쳐 넣게 두면 커서가 맨 끝으로 가서,
// 빠르게 이어 친 다음 글자가 엉뚱한 자리에 들어갔다
export function typedName(input) {
  const raw = input.value;
  const cleaned = cleanName(raw);
  if (cleaned.removed) {
    const caret = cleanName(raw.slice(0, input.selectionStart ?? raw.length)).text.length;
    input.value = cleaned.text;
    input.setSelectionRange(caret, caret);
  }
  return cleaned;
}

// 끌고 있는 것이 파일인지 (글이나 링크를 끄는 것은 받지 않는다)
export const draggingFiles = (event) => [...(event.dataTransfer?.types ?? [])].includes("Files");

// 그림 정보 한 줄: "JPG · 500×500 · 120KB"
export function pictureInfo(picture) {
  return [formatName(picture.mime), picture.width ? `${picture.width}×${picture.height}` : null, fileSize(picture.size)].filter(Boolean).join(" · ");
}

// 앨범 아트 칸. 지금 든 그림(또는 넣을 그림)과 그 정보를 보이고, 그림 파일을 끌어다 놓거나 눌러서 바꾼다
function ArtCell({ row, busy, actions }) {
  const tags = row.tags;
  // undefined: 그대로 둔다 · null: 지운다 · { … }: 새 그림을 넣는다
  const pending = row.edit.picture;
  const current = tags.picture;
  // 파일에 든 그림을 줄여 만든 미리보기 { url, width, height } (width·height는 원래 그림의 크기)
  const [thumb, setThumb] = useState(null);
  const [reading, setReading] = useState(false);
  const [over, setOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  // 파일에 든 그림을 한 번 읽어 작은 미리보기를 만들어 둔다. 파일의 그 자리를 주소로 걸어 두면(blob 주소) 그림을 메모리에
  // 올리지 않아도 되지만, 저장하면서 파일이 바뀌거나 이름이 바뀌는 사이에 그림을 읽다가 실패했다
  useEffect(() => {
    setThumb(null);
    if (!current || current.at < 0) {
      setReading(false);
      return undefined;
    }
    let alive = true;
    let made = "";
    setReading(true);
    (async () => {
      try {
        const bitmap = await createImageBitmap(tags.file.slice(current.at, current.at + current.length, current.mime));
        const scale = Math.min(1, PREVIEW / Math.max(bitmap.width, bitmap.height));
        const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)));
        const context = canvas.getContext("2d");
        context.fillStyle = "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const size = { width: bitmap.width, height: bitmap.height };
        bitmap.close();
        const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setThumb({ url: made, ...size });
      } catch {
        // 열 수 없는 그림이면 형식과 크기만 글로 보인다
      } finally {
        if (alive) setReading(false);
      }
    })();
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [tags.file, current]);

  let shown = null;
  if (pending) shown = pending;
  else if (pending === undefined && current) shown = { url: thumb?.url ?? "", mime: current.mime, size: current.length, width: thumb?.width, height: thumb?.height };
  const others = pending === undefined && tags.pictures > 1 ? ` 외 ${tags.pictures - 1}장` : "";
  let label = "없음";
  if (pending === null) label = "지움";
  else if (shown && !shown.url) label = "있음";

  const drop = (event) => {
    event.preventDefault();
    setOver(false);
    const file = [...event.dataTransfer.files][0];
    if (file && !busy) actions.dropPicture(row.id, file);
  };
  const showPreview = (event) => {
    if (!shown?.url) return;
    const box = event.currentTarget.getBoundingClientRect();
    setPreview({ left: Math.min(box.right + 10, window.innerWidth - 270), top: Math.max(8, Math.min(box.top - 100, window.innerHeight - 270)) });
  };

  return (
    <td className={`rn-art-cell${pending !== undefined ? " changed" : ""}`}>
      <div
        className={`rn-art${over ? " over" : ""}`}
        data-state={reading ? "reading" : "ready"}
        onDragOver={(event) => {
          if (!draggingFiles(event)) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
      >
        <button
          type="button"
          className="rn-art-thumb"
          disabled={busy}
          title="눌러서 그림을 고르거나 그림 파일을 여기로 끌어다 놓으세요. 복사한 그림은 옆의 붙여넣기를 누르거나, 여기에 마우스를 올리고 Ctrl+V를 누르면 들어갑니다"
          aria-label={`${row.name}의 앨범 아트 바꾸기`}
          onClick={() => inputRef.current.click()}
          onMouseEnter={showPreview}
          onMouseLeave={() => setPreview(null)}
        >
          {shown?.url ? (
            <img src={shown.url} alt="" />
          ) : (
            <span>{label}</span>
          )}
        </button>
        <div className="rn-art-info" data-info={shown ? pictureInfo(shown) + others : pending === null ? "지울 그림" : "그림 없음"}>
          {shown ? (
            <span className="rn-art-what">
              {pictureInfo(shown)}
              {others}
            </span>
          ) : (
            <span className="rn-art-what rn-faint">{pending === null ? "지울 그림" : "그림 없음"}</span>
          )}
          <span className="rn-art-actions">
            <button
              type="button"
              className="rn-link"
              disabled={busy}
              title={`${COVERS_NAME}(covers.musichoarders.xyz)를 열어 이 곡의 앨범 아트를 찾습니다`}
              onClick={() => actions.findPicture(row.id)}
            >
              찾기
            </button>
            <button
              type="button"
              className="rn-link"
              disabled={busy}
              title="구글 이미지 검색을 새 탭으로 엽니다. 거기서 그림을 복사한 뒤 이 화면에 붙여 넣으면 이 곡에 들어갑니다"
              onClick={() => actions.googlePicture(row.id)}
            >
              구글
            </button>
            {actions.canPaste && (
              <button
                type="button"
                className="rn-link"
                disabled={busy}
                title="복사해 둔 그림을 이 곡에 넣습니다. 다른 곡의 그림을 찾던 중이어도 이 곡에 들어갑니다 (처음 누르면 브라우저가 클립보드를 봐도 되는지 묻습니다)"
                onClick={() => actions.pastePicture(row.id)}
              >
                붙여넣기
              </button>
            )}
          </span>
          {(shown || pending !== undefined) && (
            <span className="rn-art-actions">
              {shown && (
                <button type="button" className="rn-link" disabled={busy} onClick={() => actions.setPicture(row.id, null)}>
                  지우기
                </button>
              )}
              {pending !== undefined && (
                <button type="button" className="rn-link" disabled={busy} onClick={() => actions.setPicture(row.id, undefined)}>
                  되돌리기
                </button>
              )}
            </span>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files[0];
            event.target.value = "";
            if (file) actions.dropPicture(row.id, file);
          }}
        />
        {preview && shown?.url && <img className="rn-art-big" src={shown.url} alt="" style={preview} />}
      </div>
    </td>
  );
}

function Result({ label, result }) {
  if (!result) return null;
  if (result.ok) return <p className="rn-ok">{label} 저장함</p>;
  return (
    <p className="rn-error" title={result.detail || undefined}>
      {label} 저장 못 함: {result.text}
    </p>
  );
}

// 파일 한 줄. row가 바뀐 줄만 다시 그린다 (actions는 늘 같은 객체다)
export const FileRow = memo(function FileRow({ row, issue, showTags, busy, actions }) {
  const base = row.edit.base ?? row.base;
  const renamed = row.edit.base !== undefined;
  const tags = row.tags;
  const span = TAG_FIELDS.length + 1;
  let tagCells = null;
  if (showTags) {
    if (row.kind === "file") tagCells = <td colSpan={span} />;
    else if (!row.format) tagCells = <td colSpan={span} className="rn-none">이 형식의 태그는 고칠 수 없습니다 ({TAG_FORMAT_NAMES}만 됩니다)</td>;
    else if (tags.state === "loading") tagCells = <td colSpan={span} className="rn-none">태그 읽는 중…</td>;
    else if (tags.state === "unreadable") tagCells = <td colSpan={span} className="rn-none">태그를 고칠 수 없습니다: {tags.why}</td>;
    else if (tags.state === "error") tagCells = <td colSpan={span} className="rn-none">태그를 읽지 못했습니다: {tags.message}</td>;
    else {
      tagCells = (
        <>
          <ArtCell row={row} busy={busy} actions={actions} />
          {TAG_FIELDS.map((field) => {
            const edited = row.edit.tags?.[field.key];
            const fixed = tags.repaired.includes(field.key);
            return (
              <td key={field.key} className={`rn-tag rn-${field.key}`}>
                <input
                  type="text"
                  className={edited !== undefined ? "changed" : fixed ? "fixed" : undefined}
                  value={edited ?? tags.values[field.key]}
                  disabled={busy}
                  spellCheck={false}
                  title={edited !== undefined ? `원래: ${tags.values[field.key] || "(비어 있음)"}` : fixed ? "깨진 한글을 바로잡아 보여 주고 있습니다 (파일은 아직 그대로입니다)" : undefined}
                  aria-label={`${row.name}의 ${field.label}`}
                  onChange={(event) => actions.setTag(row.id, field.key, event.target.value)}
                />
              </td>
            );
          })}
        </>
      );
    }
  }
  return (
    <tr className={row.checked ? undefined : "off"} data-row={row.id}>
      <td className="rn-check">
        <input type="checkbox" checked={row.checked} disabled={busy} aria-label={`${row.name} 고르기`} onChange={() => actions.toggle(row.id)} />
      </td>
      <td className="rn-name">
        <div className="rn-name-line">
          <input
            type="text"
            className={issue ? "bad" : renamed ? "changed" : undefined}
            value={base}
            disabled={busy}
            spellCheck={false}
            maxLength={MAX_NAME - row.ext.length}
            aria-label={`${row.name}의 새 이름`}
            onChange={(event) => {
              const cleaned = typedName(event.target);
              actions.setBase(row.id, cleaned.text, cleaned.removed);
            }}
          />
          {row.ext && <span className="rn-ext">{row.ext}</span>}
        </div>
        {row.hint && <p className="rn-blocked">{row.hint}</p>}
        {renamed && <p className="rn-was">지금 이름: {row.name}</p>}
        {issue && <p className="rn-error">{issue}</p>}
        <Result label="이름" result={row.result?.name} />
        <Result label="태그" result={row.result?.tags} />
      </td>
      {tagCells}
    </tr>
  );
});
