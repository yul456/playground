import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileSize, number } from "../shared/format.js";
import { HUB_URL } from "../shared/site.js";
import { JsonError, MAX_DEPTH, excerpt, locate, parseJson } from "./parse.js";
import { SAMPLE } from "./sample.js";
import Tree from "./Tree.jsx";
import { CHUNK, canOpen, closeUnder, openToDepth, openUnder, showMore, stats, toggle, visibleRows } from "./tree.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다. 설정만 저장하고, 붙여 넣은 글은 저장하지 않는다
const STORAGE_KEY = "playground.json.v1";
// 붙여 넣었을 때 처음 펼칠 단계. 0은 모두
const DEPTHS = [1, 2, 3, 0];
const DEFAULT_DEPTH = 2;
// 이보다 긴 글을 입력 칸에 붙여 넣으면 브라우저에 맡기지 않고 입력 칸의 값을 바로 바꾼다.
// 크롬은 붙여 넣는 글을 편집 명령으로 한 줄씩 넣어서, 여러 줄 30만 자에 10초 넘게 걸렸다(값을 바로 바꾸면 0.1초).
// 대신 그 붙여넣기는 Ctrl+Z로 되돌릴 수 없어서 짧은 글은 브라우저에 맡긴다
const DIRECT_PASTE = 20000;
// 이보다 긴 글을 입력 칸에서 고칠 때는 타자를 멈추고 TYPING_WAIT 뒤에 읽는다 (한 글자마다 다시 읽고 그리면 타자가 밀린다)
const SLOW_TEXT = 100000;
const TYPING_WAIT = 300;

// 설정: { depth: 처음 펼칠 단계(DEPTHS), index: 배열 항목 앞에 번호(0, 1, 2…)를 보일지 }
function loadSettings() {
  const settings = { depth: DEFAULT_DEPTH, index: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (DEPTHS.includes(saved?.depth)) settings.depth = saved.depth;
    if (typeof saved?.index === "boolean") settings.index = saved.index;
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 글을 읽는다. 빈 글이면 null, 읽었으면 { root, values, depth, size }, 못 읽었으면 { error, size }.
// size는 UTF-8로 센 바이트 수. 틀린 자리는 화면에 보일 줄·칸·앞뒤 글로 바꿔 둔다 (글 자체는 들고 있지 않는다)
function read(text) {
  if (!/\S/.test(text)) return null;
  const size = new Blob([text]).size;
  try {
    const root = parseJson(text);
    return { root, size, ...stats(root) };
  } catch (error) {
    if (!(error instanceof JsonError)) throw error;
    return {
      size,
      error: {
        message: error.message,
        index: error.index,
        ...locate(text, error.index),
        excerpt: excerpt(text, error.index),
        opened: error.opened === null ? null : locate(text, error.opened),
      },
    };
  }
}

// 처음 보일 모양: depth단계까지 펼친다(0은 모두). { open: 펼친 묶음, shown: 묶음마다 보일 항목 수, note: 알릴 말 }
function firstView(root, depth) {
  const { open, levels, limited } = openToDepth(root, depth === 0 ? Infinity : depth);
  return { open, shown: new Map(), note: limited ? `줄이 너무 많아져서 ${levels}단계까지만 펼쳤습니다. 더 안쪽은 눌러서 펼치세요.` : null };
}

const KINDS = { string: "문자열", number: "숫자", boolean: "참·거짓", null: "null" };

function summaryOf(doc) {
  const { root } = doc;
  const parts = [];
  if (root.type === "object") parts.push("객체", `키 ${number(root.children.length)}개`);
  else if (root.type === "array") parts.push("배열", `항목 ${number(root.children.length)}개`);
  else parts.push(KINDS[root.type]);
  if (doc.values > 1) parts.push(`전체 값 ${number(doc.values)}개`, `깊이 ${number(doc.depth)}단계`);
  parts.push(fileSize(doc.size));
  return parts.join(" · ");
}

function ErrorCard({ error, onGo }) {
  const { before, mark, after } = error.excerpt;
  return (
    <section className="card json-error">
      <h2>JSON으로 읽지 못했습니다</h2>
      <p className="json-where">
        {number(error.line)}번째 줄 {number(error.column)}번째 칸
      </p>
      <p className="json-message">{error.message}</p>
      <pre className="json-excerpt">
        {before}
        {mark ? <mark>{mark}</mark> : <mark className="json-here">여기</mark>}
        {after}
      </pre>
      {error.opened && (
        <p className="json-muted">
          {number(error.opened.line)}번째 줄 {number(error.opened.column)}번째 칸에서 연 괄호가 닫히지 않았습니다.
        </p>
      )}
      <button type="button" className="secondary" onClick={onGo}>
        틀린 곳으로 가기
      </button>
    </section>
  );
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 읽은 결과(read)와 지금 보이는 모양(firstView). 글은 입력 칸이 들고 있고 여기에는 두지 않는다
  const [doc, setDoc] = useState(null);
  const [view, setView] = useState(null);
  const areaRef = useRef(null);
  const timerRef = useRef(0);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장하지 못해도 화면은 그대로 쓴다
    }
  }, [settings]);

  const show = useCallback(
    (text) => {
      const next = read(text);
      setDoc(next);
      setView(next?.root ? firstView(next.root, settings.depth) : null);
    },
    [settings.depth],
  );

  // 입력 칸의 글이 바뀌었다. typing이면(자판으로 고치는 중) 긴 글은 타자를 멈춘 뒤에 읽는다
  const load = useCallback(
    (text, typing = false) => {
      clearTimeout(timerRef.current);
      if (typing && text.length > SLOW_TEXT) timerRef.current = setTimeout(() => show(text), TYPING_WAIT);
      else show(text);
    },
    [show],
  );
  useEffect(() => () => clearTimeout(timerRef.current), []);

  // 입력 칸의 글을 통째로 바꾼다. 입력 칸은 줄바꿈을 \n으로 맞추므로 넣은 뒤의 값을 읽는다 (틀린 자리가 입력 칸과 맞게)
  const replaceAll = useCallback(
    (text) => {
      const area = areaRef.current;
      area.value = text;
      load(area.value);
    },
    [load],
  );

  // 입력 칸 밖에서 붙여 넣어도(Ctrl+V) 받는다. 입력 칸 안의 붙여넣기는 onPaste가 맡는다
  useEffect(() => {
    const onWindowPaste = (event) => {
      if (event.defaultPrevented || event.target === areaRef.current) return;
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return;
      event.preventDefault();
      replaceAll(text);
    };
    window.addEventListener("paste", onWindowPaste);
    return () => window.removeEventListener("paste", onWindowPaste);
  }, [replaceAll]);

  const onPaste = (event) => {
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    // 짧은 글은 브라우저가 넣게 둔다. 넣고 나면 input 이벤트가 온다
    if (pasted.length <= DIRECT_PASTE) return;
    event.preventDefault();
    const area = event.currentTarget;
    const { selectionStart, selectionEnd, value } = area;
    area.value = value.slice(0, selectionStart) + pasted + value.slice(selectionEnd);
    const caret = selectionStart + pasted.replace(/\r\n?/g, "\n").length;
    area.setSelectionRange(caret, caret);
    load(area.value);
  };

  const chooseDepth = (depth) => {
    setSettings((current) => ({ ...current, depth }));
    if (doc?.root) setView(firstView(doc.root, depth));
  };

  // deep이면(Alt를 누른 채 누름) 그 아래까지 모두 펼치거나 접는다
  const onToggle = useCallback((node, deep) => {
    setView((current) => {
      if (!deep) return { ...current, open: toggle(current.open, node), note: null };
      if (current.open.has(node)) return { ...current, open: closeUnder(current.open, node), note: null };
      const { open, limited } = openUnder(current.open, node);
      return { ...current, open, note: limited ? "줄이 너무 많아져서 그 아래를 끝까지 펼치지는 않았습니다. 더 안쪽은 눌러서 펼치세요." : null };
    });
  }, []);
  const onMore = useCallback((node, add) => {
    setView((current) => ({ ...current, shown: showMore(current.shown, node, add) }));
  }, []);

  // 입력 칸에서 틀린 글자를 고르고 그 자리가 보이게 한다.
  // 크롬은 글자를 고르거나 초점을 주어도 입력 칸 안을 그 자리로 스크롤해 주지 않아서 직접 옮긴다.
  // 입력 칸은 줄을 넘기지 않으므로(wrap="off") 세로는 줄 번호로 알 수 있고, 가로는 그 줄에서 틀린 자리 앞까지의 글 폭을 잰다
  const goToError = () => {
    const area = areaRef.current;
    const { index, line, lineStart } = doc.error;
    area.focus();
    area.setSelectionRange(index, Math.min(index + 1, area.value.length));
    const style = getComputedStyle(area);
    const lineHeight = parseFloat(style.lineHeight);
    area.scrollTop = (line - 1) * lineHeight + parseFloat(style.paddingTop) - (area.clientHeight - lineHeight) / 2;
    const context = document.createElement("canvas").getContext("2d");
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    // 탭은 입력 칸에서 두 칸이다 (json.css의 tab-size)
    const width = context.measureText(area.value.slice(lineStart, index).replaceAll("\t", "  ")).width;
    area.scrollLeft = width + parseFloat(style.paddingLeft) - area.clientWidth / 2;
  };

  const rows = useMemo(() => (doc?.root && view ? visibleRows(doc.root, view.open, view.shown) : []), [doc, view]);

  return (
    <main className="container json-page">
      <a className="back-link" href={HUB_URL}>
        ← Playground
      </a>
      <h1>JSON 보기</h1>
      <p className="subtitle">JSON 글을 붙여 넣으면 구조대로 보여 줍니다. 항목마다 펼치거나 접어서 볼 수 있습니다.</p>

      <section className="card">
        <textarea
          ref={areaRef}
          className="json-input"
          rows={7}
          wrap="off"
          placeholder={'여기에 JSON을 붙여 넣으세요  (예: {"이름": "값", "목록": [1, 2, 3]})'}
          aria-label="JSON 글"
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          onInput={(event) => load(event.currentTarget.value, true)}
          onPaste={onPaste}
        />
        <div className="json-inputbar">
          <div className="json-actions">
            <button type="button" className="secondary" onClick={() => replaceAll(SAMPLE)}>
              예시 넣기
            </button>
            <button
              type="button"
              className="secondary"
              disabled={!doc}
              onClick={() => {
                replaceAll("");
                areaRef.current.focus();
              }}
            >
              지우기
            </button>
          </div>
          <div className="json-settings">
            <fieldset className="json-options">
              <legend>처음 펼칠 단계</legend>
              {DEPTHS.map((depth) => (
                <label key={depth}>
                  <input type="radio" name="depth" checked={settings.depth === depth} onChange={() => chooseDepth(depth)} />
                  {depth === 0 ? "모두" : `${depth}단계`}
                </label>
              ))}
            </fieldset>
            <label className="json-check">
              <input
                type="checkbox"
                checked={settings.index}
                onChange={(event) => {
                  const index = event.target.checked;
                  setSettings((current) => ({ ...current, index }));
                }}
              />
              배열 번호(0, 1, 2…) 보이기
            </label>
          </div>
        </div>
      </section>

      <div aria-live="polite">{doc?.error && <ErrorCard error={doc.error} onGo={goToError} />}</div>

      {doc?.root && view && (
        <section className="card json-result">
          <div className="json-head">
            <p className="json-summary">{summaryOf(doc)}</p>
            {canOpen(doc.root) && (
              <div className="json-actions">
                <button type="button" className="secondary" onClick={() => setView(firstView(doc.root, 0))}>
                  모두 펼치기
                </button>
                <button type="button" className="secondary" onClick={() => setView(firstView(doc.root, 1))}>
                  모두 접기
                </button>
              </div>
            )}
          </div>
          {view.note && <p className="json-note">{view.note}</p>}
          <Tree rows={rows} showIndex={settings.index} onToggle={onToggle} onMore={onMore} />
        </section>
      )}

      <section className="json-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            붙여 넣은 글은 이 브라우저 안에서만 읽습니다. 어디로도 보내지 않고 저장하지도 않아서, 페이지를 닫거나 새로 고치면
            사라집니다.
          </li>
          <li>
            입력 칸을 누르지 않아도 이 페이지에서 Ctrl+V(맥은 ⌘V)를 누르면 붙여 넣어집니다. 2만 자가 넘는 글은 빨리 넣으려고
            브라우저 대신 직접 넣어서, 그 붙여넣기는 Ctrl+Z로 되돌릴 수 없습니다.
          </li>
          <li>화살표나 괄호를 누르면 펼치고 접습니다. Alt(맥은 ⌥)를 누른 채 누르면 그 아래까지 한꺼번에 펼치거나 접습니다.</li>
          <li>
            괄호 옆의 항목 수(3개)와 배열 번호는 글에 없는 도움말입니다. 끌어서 골라 복사할 때는 빠져서, 모두 펼친 것을 복사하면
            그대로 JSON입니다.
          </li>
          <li>
            글에 적힌 그대로 보여 줍니다. 아주 큰 수나 긴 소수도 바뀌지 않고, 키 순서도 그대로입니다. 한 객체에 같은 키가 두 번
            있으면 둘 다 보이고 "겹친 키"라고 표시합니다.
          </li>
          <li>
            규격대로 적은 JSON만 읽습니다. 작은따옴표, 따옴표 없는 키, 마지막 항목 뒤의 쉼표, 주석이 있으면 읽지 못하고 어디가
            틀렸는지 알려 줍니다.
          </li>
          <li>
            항목이 {CHUNK}개가 넘는 객체·배열은 {CHUNK}개씩 보여 줍니다. 한꺼번에 펼칠 때 줄이 너무 많아지면 얕은 단계까지만
            펼칩니다.
          </li>
          <li>객체·배열이 {number(MAX_DEPTH)}단계보다 깊게 겹친 글은 읽지 않습니다.</li>
        </ul>
      </section>
    </main>
  );
}
