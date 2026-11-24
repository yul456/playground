import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { number } from "../shared/format.js";
import { HUB_URL } from "../shared/site.js";
import { CHAR_MAX_LENGTH, diffTexts, foldRows } from "./diff.js";
import { SAMPLE_LEFT, SAMPLE_RIGHT } from "./sample.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다. 설정만 저장하고, 붙여 넣은 글은 저장하지 않는다
const STORAGE_KEY = "playground.diff.v1";
const VIEWS = ["split", "unified"];
const VIEW_LABELS = { split: "나란히", unified: "한 줄로" };
// 바뀐 곳 앞뒤로 남기는 같은 줄 수
const CONTEXT = 3;
// 한 번에 그리는 줄 수. 넘으면 "더 보기"로 이만큼씩 더 그린다
const PAGE = 2000;
// 글을 고치면 타자를 멈추고 이만큼 뒤에 견준다. 긴 글(SLOW_TEXT자 넘게)은 더 기다린다
const WAIT = 150;
const SLOW_WAIT = 500;
const SLOW_TEXT = 200000;
// 끌어다 놓는 파일은 이 크기까지 읽는다
const MAX_FILE = 20 * 1024 * 1024;
// 좁은 화면에서는 나란히 놓을 자리가 없어 한 줄로만 보인다 (diff.css의 기준과 같다)
const NARROW = "(max-width: 760px)";

// 설정: { view: 보는 방법(VIEWS), all: 같은 줄도 모두 보일지, space: 빈칸 차이를 보지 않을지, letterCase: 대소문자를 가리지 않을지 }
function loadSettings() {
  const settings = { view: VIEWS[0], all: false, space: false, letterCase: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (VIEWS.includes(saved?.view)) settings.view = saved.view;
    for (const key of ["all", "space", "letterCase"]) if (typeof saved?.[key] === "boolean") settings[key] = saved[key];
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const media = window.matchMedia(NARROW);
    const onChange = () => setNarrow(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

// 줄의 글. 글자 단위 조각이 있으면 바뀐 글자를 짙게 칠한다
function Text({ side }) {
  if (!side.parts) return side.text;
  return side.parts.map((part, i) => (part.changed ? <mark key={i}>{part.text}</mark> : part.text));
}

// 나란히: 왼쪽에 원래 글, 오른쪽에 바뀐 글. 한쪽에만 있는 줄은 다른 쪽을 비운다
const SplitRow = memo(function SplitRow({ row, first }) {
  const leftKind = row.type === "same" ? "" : row.left ? "df-del" : "df-none";
  const rightKind = row.type === "same" ? "" : row.right ? "df-ins" : "df-none";
  return (
    <div className="df-row" data-type={row.type} data-first={first ? "" : undefined}>
      <span className={`df-n ${leftKind}`}>{row.left?.n}</span>
      <span className={`df-text left ${leftKind}`}>{row.left && <Text side={row.left} />}</span>
      <span className={`df-n ${rightKind}`}>{row.right?.n}</span>
      <span className={`df-text right ${rightKind}`}>{row.right && <Text side={row.right} />}</span>
    </div>
  );
});

// 한 줄로: 지운 줄(-)과 더한 줄(+)을 위아래로. 바뀐 줄은 두 줄이 된다
const UnifiedRow = memo(function UnifiedRow({ row, first }) {
  const line = (kind, sign, side, isFirst) => (
    <div className={`df-row ${kind}`} data-type={row.type} data-first={isFirst ? "" : undefined}>
      <span className="df-n">{sign === "+" ? "" : side.n}</span>
      <span className="df-n">{sign === "-" ? "" : side.n}</span>
      <span className="df-sign">{sign}</span>
      <span className="df-text">
        <Text side={side} />
      </span>
    </div>
  );
  if (row.type === "same") {
    return (
      <div className="df-row" data-type="same">
        <span className="df-n">{row.left.n}</span>
        <span className="df-n">{row.right.n}</span>
        <span className="df-sign" />
        <span className="df-text">{row.right.text}</span>
      </div>
    );
  }
  return (
    <>
      {row.left && line("df-del", "-", row.left, first)}
      {row.right && line("df-ins", "+", row.right, first && !row.left)}
    </>
  );
});

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 견준 결과 (diff.js diffTexts). 두 칸이 모두 비어 있으면 null. 글은 입력 칸만 들고 있다
  const [result, setResult] = useState(null);
  // 펼친 접힌 곳(첫 줄의 rows 번호)과 그릴 줄 수
  const [opened, setOpened] = useState(() => new Set());
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState("");
  const [over, setOver] = useState(null); // 파일을 끌어 올려 둔 칸 ("left" · "right")
  const leftRef = useRef(null);
  const rightRef = useRef(null);
  const tableRef = useRef(null);
  const timerRef = useRef(0);
  const hereRef = useRef(-1); // "다음 바뀐 곳"으로 가 있는 곳의 번호
  const narrow = useNarrow();
  const view = narrow ? "unified" : settings.view;
  const { space, letterCase } = settings;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장하지 못해도 이번에는 그대로 쓴다
    }
  }, [settings]);

  const compare = useCallback(() => {
    clearTimeout(timerRef.current);
    const left = leftRef.current.value;
    const right = rightRef.current.value;
    setResult(left === "" && right === "" ? null : diffTexts(left, right, { space, letterCase }));
    setOpened(new Set());
    setLimit(PAGE);
    hereRef.current = -1;
  }, [space, letterCase]);

  // 옵션을 바꾸면 바로 다시 견준다
  useEffect(compare, [compare]);
  useEffect(() => () => clearTimeout(timerRef.current), []);

  function onInput() {
    setNotice("");
    clearTimeout(timerRef.current);
    const size = leftRef.current.value.length + rightRef.current.value.length;
    timerRef.current = setTimeout(compare, size > SLOW_TEXT ? SLOW_WAIT : WAIT);
  }

  function fill(left, right) {
    leftRef.current.value = left;
    rightRef.current.value = right;
    setNotice("");
    compare();
  }

  // 글 파일을 칸에 끌어다 놓으면 그 내용을 넣는다
  async function onDrop(event, ref) {
    const file = event.dataTransfer?.files?.[0];
    setOver(null);
    if (!file) return; // 끌어 온 글은 브라우저가 넣게 둔다
    event.preventDefault();
    if (file.size > MAX_FILE) {
      setNotice(`"${file.name}"은 너무 커서 읽지 않았습니다 (20MB까지).`);
      return;
    }
    const text = await file.text();
    if (text.includes(String.fromCharCode(0))) {
      setNotice(`"${file.name}"은 글 파일이 아닌 것 같아 읽지 않았습니다.`);
      return;
    }
    ref.current.value = text;
    setNotice("");
    compare();
  }
  const dropProps = (name, ref) => ({
    onDragOver: (event) => {
      if (![...(event.dataTransfer?.types ?? [])].includes("Files")) return;
      event.preventDefault();
      setOver(name);
    },
    onDragLeave: () => setOver(null),
    onDrop: (event) => onDrop(event, ref),
  });

  const items = useMemo(
    () => (result ? foldRows(result.rows, settings.all ? Infinity : CONTEXT, opened) : []),
    [result, settings.all, opened],
  );
  const stats = result?.stats;
  const differs = stats ? stats.changed + stats.added + stats.removed : 0;
  const hasText = Boolean(result);
  const tooLong = useMemo(
    () => Boolean(result?.rows.some((row) => row.type === "change" && Math.max(row.left.text.length, row.right.text.length) > CHAR_MAX_LENGTH)),
    [result],
  );

  // 다음·이전 바뀐 곳으로 간다. 바뀐 곳의 첫 줄(data-first)을 차례로 돈다
  function go(step) {
    const marks = [...tableRef.current.querySelectorAll("[data-first]")];
    if (!marks.length) return;
    tableRef.current.querySelector(".here")?.classList.remove("here");
    hereRef.current = (hereRef.current + step + marks.length) % marks.length;
    const mark = marks[hereRef.current];
    mark.classList.add("here");
    mark.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  const Row = view === "split" ? SplitRow : UnifiedRow;
  const shown = items.slice(0, limit);

  return (
    <main className="container df-page">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>글 비교</h1>
        <p className="subtitle">
          글 두 개를 붙여 넣으면 달라진 줄과 글자를 표시합니다. 붙여 넣은 글은 이 브라우저 안에서만 견주고 저장하지 않습니다.
        </p>
      </header>

      <section className="card">
        <div className="df-inputs">
          <label>
            <span>
              원래 글 <small>(왼쪽)</small>
            </span>
            <textarea
              ref={leftRef}
              className={`df-input${over === "left" ? " over" : ""}`}
              rows={9}
              wrap="off"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="먼저 있던 글을 붙여 넣거나 글 파일을 끌어다 놓으세요"
              onInput={onInput}
              {...dropProps("left", leftRef)}
            />
          </label>
          <label>
            <span>
              바뀐 글 <small>(오른쪽)</small>
            </span>
            <textarea
              ref={rightRef}
              className={`df-input${over === "right" ? " over" : ""}`}
              rows={9}
              wrap="off"
              spellCheck={false}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              placeholder="고친 글을 붙여 넣거나 글 파일을 끌어다 놓으세요"
              onInput={onInput}
              {...dropProps("right", rightRef)}
            />
          </label>
        </div>
        <div className="df-bar">
          <div className="df-actions">
            <button type="button" className="secondary" onClick={() => fill(SAMPLE_LEFT, SAMPLE_RIGHT)}>
              예시 넣기
            </button>
            <button type="button" className="secondary" disabled={!hasText} onClick={() => fill(rightRef.current.value, leftRef.current.value)}>
              서로 바꾸기
            </button>
            <button type="button" className="secondary" disabled={!hasText} onClick={() => fill("", "")}>
              지우기
            </button>
          </div>
          <div className="df-settings">
            <fieldset className="df-options df-view">
              <legend>보는 방법</legend>
              {VIEWS.map((key) => (
                <label key={key}>
                  <input type="radio" name="view" checked={settings.view === key} onChange={() => setSettings((s) => ({ ...s, view: key }))} />
                  {VIEW_LABELS[key]}
                </label>
              ))}
            </fieldset>
            <label className="df-check">
              <input type="checkbox" checked={settings.all} onChange={(e) => setSettings((s) => ({ ...s, all: e.target.checked }))} />
              같은 줄도 모두 보기
            </label>
            <label className="df-check">
              <input type="checkbox" checked={space} onChange={(e) => setSettings((s) => ({ ...s, space: e.target.checked }))} />
              빈칸 차이는 보지 않기
            </label>
            <label className="df-check">
              <input type="checkbox" checked={letterCase} onChange={(e) => setSettings((s) => ({ ...s, letterCase: e.target.checked }))} />
              대소문자 가리지 않기
            </label>
          </div>
        </div>
        {notice && (
          <p className="df-notice" role="alert">
            {notice}
          </p>
        )}
      </section>

      {result && (
        <section className="card df-result">
          <div className="df-head" aria-live="polite">
            {differs === 0 ? (
              <p className="df-same-text">
                두 글이 같습니다. <span className="df-summary">({number(stats.same)}줄{space || letterCase ? ", 보지 않기로 한 차이는 빼고" : ""})</span>
              </p>
            ) : (
              <p className="df-summary">
                바뀐 줄 <b>{number(stats.changed)}</b> · 지운 줄 <b className="del">{number(stats.removed)}</b> · 더한 줄{" "}
                <b className="ins">{number(stats.added)}</b> · 같은 줄 {number(stats.same)}
              </p>
            )}
            {differs > 0 && (
              <div className="df-actions">
                <button type="button" className="secondary" onClick={() => go(-1)}>
                  ↑ 이전 바뀐 곳
                </button>
                <button type="button" className="secondary" onClick={() => go(1)}>
                  ↓ 다음 바뀐 곳
                </button>
              </div>
            )}
          </div>
          {differs > 0 && (
            <>
              <div ref={tableRef} className={`df-table ${view}`}>
                {shown.map((item, i) =>
                  item.gap ? (
                    <button
                      key={`gap-${item.index}`}
                      type="button"
                      className="df-gap"
                      onClick={() => setOpened((set) => new Set(set).add(item.index))}
                    >
                      같은 줄 {number(item.gap)}개 펼치기
                    </button>
                  ) : (
                    <Row
                      key={item.index}
                      row={item.row}
                      first={item.row.type !== "same" && (i === 0 || Boolean(shown[i - 1].gap) || shown[i - 1].row.type === "same")}
                    />
                  ),
                )}
              </div>
              {items.length > limit && (
                <button type="button" className="secondary df-more" onClick={() => setLimit((n) => n + PAGE)}>
                  더 보기 (남은 {number(items.length - limit)}줄)
                </button>
              )}
              {tooLong && (
                <p className="df-notice">{number(CHAR_MAX_LENGTH)}자가 넘는 줄은 바뀐 글자를 따로 표시하지 않고 줄 전체를 칠했습니다.</p>
              )}
            </>
          )}
        </section>
      )}

      <section className="df-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            붙여 넣은 글은 이 브라우저 안에서만 견줍니다. 어디로도 보내지 않고 저장하지도 않아서, 페이지를 닫거나 새로 고치면
            사라집니다. 보는 방법 같은 설정만 기억합니다.
          </li>
          <li>
            줄 단위로 견줍니다. 붉은 줄은 원래 글에만 있는 줄, 초록 줄은 바뀐 글에만 있는 줄입니다. 서로 닮은 줄은 짝지어
            바뀐 글자만 짙게 칠하고, 닮지 않은 줄은 줄 전체를 칠합니다.
          </li>
          <li>
            바뀐 곳의 앞뒤 {CONTEXT}줄만 보이고 그 사이의 같은 줄은 접어 둡니다. 접힌 곳을 누르면 펼치고, "같은 줄도 모두
            보기"를 켜면 처음부터 다 보입니다.
          </li>
          <li>줄 바꿈 방식(윈도우와 맥·리눅스의 차이)과 맨 끝의 줄 바꿈 하나는 차이로 치지 않습니다.</li>
          <li>
            "빈칸 차이는 보지 않기"는 줄 앞뒤의 빈칸과 이어진 빈칸의 개수(탭 포함)가 달라도 같은 줄로 봅니다. 빈 줄이 더
            있거나 없는 것은 차이로 칩니다.
          </li>
          <li>줄 번호와 +·- 표시는 끌어서 골라 복사할 때 빠집니다.</li>
          <li>글 파일(txt, 소스 코드, CSV 등)을 칸에 끌어다 놓으면 그 내용을 넣습니다. 워드·한글·PDF 같은 문서 파일은 읽지 못합니다.</li>
          <li>
            한쪽에서 덩어리째 자리를 옮긴 글은 한 곳에서 지우고 다른 곳에 더한 것으로 나옵니다. 되풀이되는 줄이 아주 많고
            서로 많이 다른 글은 그 구간을 통째로 바뀐 것으로 보일 수 있습니다.
          </li>
        </ul>
      </section>
    </main>
  );
}
