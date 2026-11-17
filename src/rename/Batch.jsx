import { useEffect, useRef, useState } from "react";
import { number } from "../shared/format.js";
import { COVERS_NAME, COVERS_URL, REGIONS } from "./covers.js";
import { cleanName } from "./names.js";
import { PICTURE_SIZES } from "./picture.js";
import { draggingFiles, typedName } from "./Rows.jsx";
import { TAG_FIELDS } from "./tags.js";

// 틀에 쓸 수 있는 칸 이름. 태그 칸은 화면의 이름표(제목, 아티스트 …)를 그대로 쓴다
export const NAME_KEY = "이름";
export const NUMBER_KEY = "번호";

const MODES = [
  { key: "replace", label: "찾아 바꾸기" },
  { key: "pattern", label: "틀로 채우기" },
  { key: "clear", label: "태그 비우기", tags: true },
  { key: "art", label: "앨범 아트", tags: true },
];

// 체크한 파일들을 한꺼번에 고치는 칸. 여기서 고친 것도 저장을 누르기 전에는 파일에 적히지 않는다.
//   hasTags: 태그를 고칠 수 있는 파일(MP3·M4A·FLAC·WAV)이 목록에 있는지
//   count: 체크한 파일 수, tagCount: 그 가운데 태그를 고칠 수 있는 파일 수
//   numbering: { start, digits }, onNumbering: 번호 설정을 바꿀 때
//   example(target, pattern): 첫 파일에 적용하면 어떻게 되는지 보여 줄 글
//   artMax·onArtMax: 넣을 그림을 줄일 크기(0이면 그대로), suggestArtist·suggestAlbum: 앨범 아트를 찾을 때 미리 채울 검색어,
//   region·onRegion: 앨범 아트를 찾을 곳(covers.js REGIONS의 key),
//   fill·onFill: 찾은 그림을 고르면 넣을 것(picture 그림만 · all 그림과 그 음반의 앨범·아티스트·연도),
//   onFind({ artist, album }): 앨범 아트 찾기(MH Covers), onGoogle({ artist, album }): 구글 이미지 검색에서 찾기,
//   searching: 찾는 중이면 { label, paste: 붙여 넣기를 기다리는 중인지(구글) }, onStopSearch: 찾기 그만두기,
//   canPaste: 버튼으로 클립보드의 그림을 읽을 수 있는 브라우저인지, onPaste(): 복사한 그림을 체크한 파일들에 넣기,
//   onPasteSearch(): 복사한 그림을 찾던 파일들에 넣기
export default function Batch({
  disabled,
  hasTags,
  count,
  tagCount,
  numbering,
  onNumbering,
  onReplace,
  onPattern,
  onClear,
  onPicture,
  artMax,
  onArtMax,
  suggestArtist,
  suggestAlbum,
  region,
  onRegion,
  fill,
  onFill,
  onFind,
  onGoogle,
  canPaste,
  onPaste,
  onPasteSearch,
  searching,
  onStopSearch,
  example,
  note,
}) {
  const [mode, setMode] = useState("replace");
  const [target, setTarget] = useState("name");
  const [find, setFind] = useState("");
  const [to, setTo] = useState("");
  const [ignoreCase, setIgnoreCase] = useState(false);
  const [pattern, setPattern] = useState(`{${NUMBER_KEY}} {${NAME_KEY}}`);
  const [clear, setClear] = useState(() => new Set());
  const [over, setOver] = useState(false);
  // 파일 이름에 넣을 글을 치다가 걸러 낸 글자를 알리는 말
  const [blocked, setBlocked] = useState("");
  // 앨범 아트를 찾을 검색어. 사용자가 고치기 전에는 체크한 파일 가운데 태그를 읽은 첫 파일의 태그를 따른다
  const [query, setQuery] = useState(null);
  useEffect(() => setQuery(null), [suggestArtist, suggestAlbum]);
  const artist = query?.artist ?? suggestArtist;
  const album = query?.album ?? suggestAlbum;
  const patternRef = useRef(null);
  const fileRef = useRef(null);

  const modes = MODES.filter((item) => hasTags || !item.tags);
  const current = modes.some((item) => item.key === mode) ? mode : "replace";
  const targets = [{ key: "name", label: "파일 이름" }, ...(hasTags ? TAG_FIELDS : [])];
  const where = targets.some((item) => item.key === target) ? target : "name";
  const tokens = [NAME_KEY, NUMBER_KEY, ...(hasTags ? TAG_FIELDS.map((field) => field.label) : [])];
  const reach = where === "name" ? count : tagCount;

  // 파일 이름에 들어갈 글(바꿀 글자, 틀)에는 이름에 쓸 수 없는 글자가 입력되지 않게 한다. 태그에 넣을 글은 그대로 둔다
  const typed = (set) => (event) => {
    if (where !== "name") {
      set(event.target.value);
      return;
    }
    const cleaned = typedName(event.target);
    setBlocked(cleaned.removed ? `파일 이름에 쓸 수 없는 글자(${cleaned.removed})는 넣지 않았습니다.` : "");
    set(cleaned.text);
  };
  // 고칠 곳을 파일 이름으로 바꾸면, 태그용으로 쳐 둔 글에서도 쓸 수 없는 글자를 뺀다
  const chooseTarget = (next) => {
    setTarget(next);
    setBlocked("");
    if (next === "name") {
      setTo(cleanName(to).text);
      setPattern(cleanName(pattern).text);
    }
  };

  // 틀의 커서 자리에 {칸}을 넣는다
  const insert = (token) => {
    const input = patternRef.current;
    const from = input?.selectionStart ?? pattern.length;
    const until = input?.selectionEnd ?? from;
    const text = `{${token}}`;
    setPattern(pattern.slice(0, from) + text + pattern.slice(until));
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(from + text.length, from + text.length);
    });
  };
  const toggleClear = (key) => {
    const next = new Set(clear);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setClear(next);
  };
  const sample = current === "pattern" ? example(where, pattern) : "";

  return (
    <section className="card rn-batch">
      <div className="rn-batch-head">
        <h2>한꺼번에 고치기</h2>
        <span className="rn-muted">체크한 파일 {number(count)}개에 적용합니다. 저장을 누르기 전에는 파일이 바뀌지 않습니다.</span>
      </div>
      <fieldset className="rn-modes" disabled={disabled}>
        <legend className="rn-hidden">고치는 방법</legend>
        {modes.map((item) => (
          <label key={item.key} className={current === item.key ? "on" : undefined}>
            <input type="radio" name="rn-mode" checked={current === item.key} onChange={() => setMode(item.key)} />
            {item.label}
          </label>
        ))}
      </fieldset>

      {current === "replace" && (
        <form
          className="rn-form"
          onSubmit={(event) => {
            event.preventDefault();
            onReplace({ target: where, find, to, ignoreCase });
          }}
        >
          <label>
            어디에서
            <select value={where} disabled={disabled} onChange={(event) => chooseTarget(event.target.value)}>
              {targets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            찾을 글자
            <input type="text" value={find} disabled={disabled} spellCheck={false} onChange={(event) => setFind(event.target.value)} />
          </label>
          <label>
            바꿀 글자
            <input type="text" value={to} disabled={disabled} spellCheck={false} placeholder="비워 두면 지웁니다" onChange={typed(setTo)} />
          </label>
          <label className="rn-inline">
            <input type="checkbox" checked={ignoreCase} disabled={disabled} onChange={(event) => setIgnoreCase(event.target.checked)} />
            대소문자 가리지 않기
          </label>
          <button type="submit" disabled={disabled || !find || !reach}>
            적용
          </button>
        </form>
      )}

      {current === "pattern" && (
        <form
          className="rn-form"
          onSubmit={(event) => {
            event.preventDefault();
            onPattern({ target: where, pattern });
          }}
        >
          <label>
            채울 칸
            <select value={where} disabled={disabled} onChange={(event) => chooseTarget(event.target.value)}>
              {targets.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label className="rn-wide">
            틀
            <input ref={patternRef} type="text" value={pattern} disabled={disabled} spellCheck={false} onChange={typed(setPattern)} />
          </label>
          <label>
            번호 시작
            <input
              type="number"
              min="0"
              value={numbering.start}
              disabled={disabled}
              onChange={(event) => onNumbering({ start: Math.max(0, Math.floor(Number(event.target.value) || 0)) })}
            />
          </label>
          <label>
            번호 자릿수
            <input
              type="number"
              min="1"
              max="6"
              value={numbering.digits}
              disabled={disabled}
              onChange={(event) => onNumbering({ digits: Math.min(6, Math.max(1, Math.floor(Number(event.target.value) || 1))) })}
            />
          </label>
          <button type="submit" disabled={disabled || !pattern.trim() || !reach}>
            적용
          </button>
          <p className="rn-tokens">
            넣을 수 있는 칸:
            {tokens.map((token) => (
              <button key={token} type="button" className="rn-token" disabled={disabled} onClick={() => insert(token)}>
                {`{${token}}`}
              </button>
            ))}
          </p>
          <p className="rn-hint">
            {`{${NAME_KEY}}`}은 지금 이름(확장자 빼고), {`{${NUMBER_KEY}}`}는 폴더마다 위에서부터 매기는 번호입니다.
            {hasTags && ` {트랙}은 "3/12"에서 번호만 두 자리(03)로 넣습니다.`}
            {sample && <b> 예: {sample}</b>}
          </p>
        </form>
      )}

      {current === "clear" && (
        <div className="rn-form">
          <div className="rn-clear">
            {[...TAG_FIELDS, { key: "picture", label: "앨범 아트" }].map((field) => (
              <label key={field.key} className="rn-inline">
                <input type="checkbox" checked={clear.has(field.key)} disabled={disabled} onChange={() => toggleClear(field.key)} />
                {field.label}
              </label>
            ))}
          </div>
          <button type="button" disabled={disabled || !clear.size || !tagCount} onClick={() => onClear(clear)}>
            고른 칸 비우기
          </button>
          <p className="rn-hint">체크한 파일 가운데 태그를 고칠 수 있는 {number(tagCount)}개에서 고른 칸의 내용을 지웁니다.</p>
        </div>
      )}

      {current === "art" && (
        <div className="rn-form">
          <div
            className={`rn-drop${over ? " over" : ""}`}
            onDragOver={(event) => {
              if (!draggingFiles(event)) return;
              event.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setOver(false);
              const file = [...event.dataTransfer.files][0];
              if (file && !disabled && tagCount) onPicture(file);
            }}
          >
            <span>체크한 파일 가운데 태그를 고칠 수 있는 {number(tagCount)}개에 넣을 그림을 여기로 끌어다 놓으세요.</span>
            <button type="button" className="secondary" disabled={disabled || !tagCount} onClick={() => fileRef.current.click()}>
              그림 고르기
            </button>
            {canPaste && (
              <button
                type="button"
                className="secondary"
                disabled={disabled || !tagCount}
                title="복사해 둔 그림을 체크한 파일들에 넣습니다. 여기에 마우스를 올리고 Ctrl+V를 눌러도 됩니다"
                onClick={onPaste}
              >
                복사한 그림 붙여넣기
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(event) => {
                const file = event.target.files[0];
                event.target.value = "";
                if (file) onPicture(file);
              }}
            />
          </div>
          <button type="button" className="secondary" disabled={disabled || !tagCount} onClick={() => onClear(new Set(["picture"]))}>
            앨범 아트 지우기
          </button>
          <label>
            넣을 그림 크기
            <select value={artMax} disabled={disabled} onChange={(event) => onArtMax(Number(event.target.value))}>
              {PICTURE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size ? `긴 변 ${number(size)}px까지` : "그대로"}
                </option>
              ))}
            </select>
          </label>
          <form
            className="rn-find"
            onSubmit={(event) => {
              event.preventDefault();
              onFind({ artist, album });
            }}
          >
            <label>
              아티스트
              <input type="text" value={artist} disabled={disabled} spellCheck={false} onChange={(event) => setQuery({ artist: event.target.value, album })} />
            </label>
            <label>
              앨범
              <input type="text" value={album} disabled={disabled} spellCheck={false} onChange={(event) => setQuery({ artist, album: event.target.value })} />
            </label>
            <label>
              찾을 곳
              <select value={region} disabled={disabled} onChange={(event) => onRegion(event.target.value)}>
                {REGIONS.map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              고르면 넣을 것
              <select value={fill} disabled={disabled} onChange={(event) => onFill(event.target.value)}>
                <option value="picture">그림만</option>
                <option value="all">그림과 앨범·아티스트·연도</option>
              </select>
            </label>
            <button type="submit" disabled={disabled || !tagCount || (!artist.trim() && !album.trim())}>
              앨범 아트 찾기
            </button>
            <button type="button" className="secondary" disabled={disabled || !tagCount || (!artist.trim() && !album.trim())} onClick={() => onGoogle({ artist, album })}>
              구글에서 찾기
            </button>
          </form>
          <p className="rn-hint">
            찾기는{" "}
            <a href={COVERS_URL} target="_blank" rel="noreferrer">
              {COVERS_NAME} ({COVERS_URL})
            </a>
            를 새 창으로 엽니다. 거기서 그림을 누르면 체크한 파일 가운데 태그를 고칠 수 있는 {number(tagCount)}개에 넣을 그림으로
            들어옵니다. 아티스트와 앨범 이름이 그 사이트로 전달됩니다. "고르면 넣을 것"을 "그림과 앨범·아티스트·연도"로 두면 그
            그림이 실린 음반의 정보도 태그에 넣습니다(있던 값은 바뀝니다). 찾을 곳과 고르면 넣을 것은 표의 "찾기"에도 적용됩니다.
          </p>
          <p className="rn-hint">
            "구글에서 찾기"는 구글 이미지 검색을 새 탭으로 엽니다(검색어가 구글로 전달됩니다). 구글은 고른 그림을 알려 주지 않아서,
            그림을 오른쪽 클릭해 "이미지 복사"를 누르고 그 탭을 닫은 뒤 이 화면에서 붙여 넣어야 합니다(Ctrl+V나 "붙여넣기").
          </p>
          <p className="rn-hint">파일 하나만 바꾸려면 아래 표의 그림 칸에 끌어다 놓거나 그림을 누르세요. JPG·PNG가 아닌 그림은 JPG로 바꿔 넣습니다.</p>
        </div>
      )}

      {blocked && (current === "replace" || current === "pattern") && <p className="rn-blocked">{blocked}</p>}
      {searching && (
        <p className="rn-searching" role="status">
          {searching.paste
            ? `구글에서 그림을 오른쪽 클릭해 "이미지 복사"를 누른 뒤, 그 탭을 닫고 이 화면에서 붙여 넣으면(Ctrl+V) ${searching.label}에 넣습니다. 다른 곡에 넣으려면 그 곡의 "붙여넣기"를 누르세요.`
            : `검색 창에서 그림을 누르면 ${searching.label}에 넣을 그림으로 들어옵니다.`}
          {searching.paste && canPaste && (
            <button type="button" className="rn-link" onClick={onPasteSearch}>
              붙여넣기
            </button>
          )}
          <button type="button" className="rn-link" onClick={onStopSearch}>
            찾기 그만두기
          </button>
        </p>
      )}
      {note && (
        <p className="rn-note" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
