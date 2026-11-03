import { useEffect, useRef, useState } from "react";
import Confetti from "../shared/Confetti.jsx";
import { HUB_URL } from "../shared/site.js";
import { elapsed, FLAG, LEVELS, levelOf, newGame, OPEN, open, openAround, toggleFlag } from "./mines.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.mines.v1";
// 터치로 이만큼(ms) 누르고 있으면 깃발을 꽂는다
const LONG_PRESS_MS = 400;
// 누르는 동안 손가락이 이만큼(px) 넘게 움직이면 길게 누르기가 아니라 판을 미는 것으로 본다
const MOVE_TOLERANCE = 10;
// 이보다 좁은 화면에서는 가로로 긴 판(고급 30×16)을 세로로 돌려(16×30) 칸이 너무 작아지지 않게 한다
const NARROW = "(max-width: 600px)";
const CONFETTI_MS = 3500;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      // 난이도별 최고 기록(초). 숫자가 아닌 값은 버린다
      const best = Object.fromEntries(
        LEVELS.filter((l) => Number.isFinite(saved.best?.[l.key])).map((l) => [l.key, saved.best[l.key]]),
      );
      return { level: levelOf(saved.level).key, best };
    }
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return { level: LEVELS[0].key, best: {} };
}

// CSS 미디어 쿼리가 맞는지. 화면 폭이 바뀌면 다시 그린다
function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

// 걸린 시간(초). 판 전체가 아니라 이 부분만 시간마다 다시 그린다
function Clock({ game }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (game.status !== "playing") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [game.status]);
  return <span className="mines-stat" aria-label="걸린 시간">⏱ {Math.floor(elapsed(game, now))}</span>;
}

// 칸 하나를 어떻게 보여 줄지: 글자, 꾸밈(class), 화면 낭독기용 설명
function cellView(game, i) {
  const cell = game.cells[i];
  const lost = game.status === "lost";
  if (cell === OPEN) {
    const n = game.counts[i];
    return n ? { text: n, kind: `open n${n}`, label: `지뢰 ${n}개` } : { text: "", kind: "open", label: "빈 칸" };
  }
  if (cell === FLAG) {
    return lost && !game.mines[i]
      ? { text: "🚩", kind: "flag wrong", label: "잘못 꽂은 깃발" }
      : { text: "🚩", kind: "flag", label: "깃발" };
  }
  if (lost && game.mines[i]) return { text: "💣", kind: i === game.exploded ? "mine exploded" : "mine", label: "지뢰" };
  return { text: "", kind: "", label: "닫힌 칸" };
}

export default function App() {
  const [settings, setSettings] = useState(load);
  const level = levelOf(settings.level);
  const [game, setGame] = useState(() => newGame(level));
  // 길게 누르기 타이머처럼 나중에 오는 이벤트도 가장 새 판에서 계산하도록 ref에도 둔다
  const gameRef = useRef(game);
  gameRef.current = game;
  const [flagMode, setFlagMode] = useState(false);
  // 이긴 판의 기록: { time, isBest }
  const [result, setResult] = useState(null);
  const [confettiId, setConfettiId] = useState(null);
  const narrow = useMediaQuery(NARROW);
  // 터치로 누르고 있는 칸: { i, x, y, timer, fired }
  const pressRef = useRef(null);
  // 마지막으로 누른 도구(mouse, touch, pen). 안드로이드는 길게 누르면 contextmenu도 보내므로 터치에서 온 것은 무시한다
  const pointerRef = useRef("mouse");

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  useEffect(() => {
    if (!confettiId) return undefined;
    const timer = setTimeout(() => setConfettiId(null), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [confettiId]);

  useEffect(() => () => clearTimeout(pressRef.current?.timer), []);

  function apply(next) {
    const prev = gameRef.current;
    if (next === prev) return;
    gameRef.current = next;
    setGame(next);
    if (next.status === "won" && prev.status !== "won") {
      const time = Math.round(elapsed(next) * 10) / 10;
      const old = settings.best[next.level];
      const isBest = !Number.isFinite(old) || time < old;
      if (isBest) setSettings((s) => ({ ...s, best: { ...s.best, [next.level]: time } }));
      setResult({ time, isBest });
      setConfettiId(Date.now());
    }
  }

  function restart(key = settings.level) {
    clearTimeout(pressRef.current?.timer);
    pressRef.current = null;
    setResult(null);
    setConfettiId(null);
    apply(newGame(levelOf(key)));
  }

  function changeLevel(key) {
    setSettings((s) => ({ ...s, level: key }));
    restart(key);
  }

  // 닫힌 칸은 열고(깃발 모드면 깃발), 열린 숫자 칸은 주변 칸을 한꺼번에 연다
  function activate(i) {
    const g = gameRef.current;
    if (g.cells[i] === OPEN) apply(openAround(g, i));
    else if (flagMode) apply(toggleFlag(g, i));
    else apply(open(g, i));
  }

  const flag = (i) => apply(toggleFlag(gameRef.current, i));

  // 칸 이벤트는 판 하나에서 받는다. 누른 칸은 data-i로 찾는다
  const cellOf = (e) => {
    const button = e.target.closest?.("[data-i]");
    return button ? Number(button.dataset.i) : null;
  };

  function onClick(e) {
    const i = cellOf(e);
    if (i == null) return;
    const p = pressRef.current;
    pressRef.current = null;
    // 길게 눌러 깃발을 꽂았으면 손을 뗄 때 오는 클릭은 무시한다
    if (p?.fired && p.i === i) return;
    activate(i);
  }

  function onContextMenu(e) {
    const i = cellOf(e);
    if (i == null) return;
    e.preventDefault();
    if (pointerRef.current === "mouse") flag(i);
  }

  function onPointerDown(e) {
    pointerRef.current = e.pointerType;
    clearTimeout(pressRef.current?.timer);
    pressRef.current = null;
    const i = cellOf(e);
    if (i == null || e.pointerType === "mouse") return;
    const p = { i, x: e.clientX, y: e.clientY, fired: false, timer: 0 };
    p.timer = setTimeout(() => {
      p.fired = true;
      flag(i);
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
    pressRef.current = p;
  }

  function onPointerMove(e) {
    const p = pressRef.current;
    if (p && !p.fired && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_TOLERANCE) {
      clearTimeout(p.timer);
      pressRef.current = null;
    }
  }

  // 손을 떼면 타이머만 멈춘다. 바로 뒤에 오는 클릭이 길게 눌렀는지(fired) 알아야 한다
  const onPointerUp = () => clearTimeout(pressRef.current?.timer);

  function onPointerCancel() {
    clearTimeout(pressRef.current?.timer);
    pressRef.current = null;
  }

  // 키보드: 칸에서 F를 누르면 깃발
  function onKeyDown(e) {
    const i = cellOf(e);
    if (i == null || e.key.toLowerCase() !== "f") return;
    e.preventDefault();
    flag(i);
  }

  const transposed = narrow && game.cols > game.rows;
  const viewCols = transposed ? game.rows : game.cols;
  const viewRows = transposed ? game.cols : game.rows;
  const board = [];
  for (let r = 0; r < viewRows; r++) {
    for (let c = 0; c < viewCols; c++) board.push({ i: transposed ? c * game.cols + r : r * game.cols + c, r, c });
  }

  let status;
  if (game.status === "won") {
    status = <>🎉 <strong>{result?.time.toFixed(1)}초</strong> 만에 모두 찾았습니다!{result?.isBest && " 최고 기록입니다."}</>;
  } else if (game.status === "lost") status = "💥 지뢰를 밟았습니다. 새 게임으로 다시 해 보세요.";
  else if (game.status === "ready") status = "아무 칸이나 눌러 시작하세요. 첫 칸에는 지뢰가 없습니다.";
  else if (flagMode) status = "깃발 모드: 누르는 칸에 깃발을 꽂거나 뺍니다.";
  else status = "숫자는 주변 8칸에 있는 지뢰 수입니다.";

  return (
    <main className="container mines-page">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>지뢰찾기</h1>
        <p className="subtitle">숫자를 단서로 지뢰를 피해서 나머지 칸을 모두 열면 이깁니다.</p>
      </header>

      <section className="card mines-card">
        <div className="mines-levels" role="group" aria-label="난이도">
          {LEVELS.map((l) => (
            <button
              key={l.key}
              type="button"
              className={l.key === level.key ? "active" : ""}
              aria-pressed={l.key === level.key}
              onClick={() => changeLevel(l.key)}
            >
              {l.name}
            </button>
          ))}
        </div>
        <div className="mines-bar">
          <span className="mines-stat" aria-label="남은 지뢰">💣 {game.mineCount - game.flags}</span>
          <Clock game={game} />
          <button
            type="button"
            className={flagMode ? "mines-flag-mode active" : "mines-flag-mode secondary"}
            aria-pressed={flagMode}
            onClick={() => setFlagMode((on) => !on)}
          >
            🚩 깃발 모드
          </button>
          <button type="button" onClick={() => restart()}>새 게임</button>
        </div>
        <div className="mines-scroll">
          <div
            className={`mines-board ${game.status}`}
            style={{ "--cols": viewCols }}
            role="group"
            aria-label={`지뢰찾기 판, 가로 ${viewCols}칸 세로 ${viewRows}칸`}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
          >
            {board.map(({ i, r, c }) => {
              const view = cellView(game, i);
              return (
                <button
                  key={i}
                  type="button"
                  data-i={i}
                  className={`mines-cell ${view.kind}`}
                  aria-label={`${r + 1}행 ${c + 1}열, ${view.label}`}
                >
                  {view.text}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mines-status" role="status">{status}</p>
        <p className="mines-best">
          최고 기록{" "}
          {LEVELS.map((l) => `${l.name} ${Number.isFinite(settings.best[l.key]) ? `${settings.best[l.key].toFixed(1)}초` : "없음"}`).join(" · ")}
        </p>
        <p className="mines-hint">
          칸을 누르면 열립니다. 지뢰 같은 칸에는 깃발을 꽂아 두세요: PC는 오른쪽 클릭(키보드는 F), 휴대폰은 길게 누르거나
          깃발 모드에서 누릅니다. 숫자만큼 깃발을 꽂은 숫자 칸을 누르면 나머지 주변 칸이 한꺼번에 열립니다.
        </p>
      </section>

      {confettiId && <Confetti key={confettiId} />}
    </main>
  );
}
