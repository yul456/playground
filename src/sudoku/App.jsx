import { useEffect, useRef, useState } from "react";
import Confetti from "../shared/Confetti.jsx";
import { HUB_URL } from "../shared/site.js";
import {
  digitCounts, erase, hint, LEVEL_LABELS, LEVELS, newGame, noteDigits, packGame, PEERS, setValue, toggleNote, unpackGame, wrongCells,
} from "./sudoku.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.sudoku.v1";
const CONFETTI_MS = 3500;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const UNDO_MAX = 500;

function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  const s = saved && typeof saved === "object" ? saved : {};
  const level = LEVELS.includes(s.level) ? s.level : LEVELS[0];
  // 난이도별 최고 기록(초). 정수가 아닌 값은 버린다
  const best = Object.fromEntries(LEVELS.filter((l) => Number.isInteger(s.best?.[l]) && s.best[l] > 0).map((l) => [l, s.best[l]]));
  const game = unpackGame(s.game);
  return {
    settings: { level: game ? game.level : level, check: s.check !== false, best },
    game: game ?? newGame(level),
    elapsed: game && Number.isFinite(s.game.elapsed) && s.game.elapsed >= 0 ? s.game.elapsed : 0,
    hints: game && Number.isInteger(s.game.hints) && s.game.hints >= 0 ? s.game.hints : 0,
  };
}

const clockText = (ms) => {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
};

// 시간만 0.5초마다 다시 그린다. 판 전체를 그때마다 다시 그리지 않게 한다
function Clock({ read }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  return <span className="sd-clock" role="timer">{clockText(read())}</span>;
}

const cellName = (i) => `${Math.floor(i / 9) + 1}번째 줄 ${(i % 9) + 1}번째 칸`;

export default function App() {
  const [initial] = useState(load);
  const [settings, setSettings] = useState(initial.settings);
  const [game, setGame] = useState(initial.game);
  const [selected, setSelected] = useState(null);
  const [memoMode, setMemoMode] = useState(false);
  const [notice, setNotice] = useState("");
  // 힌트: { cell, text, digit, before, shown } 또는 틀린 칸 알림 { wrong: [칸] }
  const [tip, setTip] = useState(null);
  const [hints, setHints] = useState(initial.hints);
  // 이긴 판의 기록: { ms, isBest }
  const [result, setResult] = useState(null);
  const [confettiId, setConfettiId] = useState(null);
  const [undoCount, setUndoCount] = useState(0);
  const playing = game.status === "playing";

  // 누르기가 다시 그리기 전에 몰려 와도 가장 새 판으로 계산하도록 ref에도 둔다
  const gameRef = useRef(game);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const hintsRef = useRef(hints);
  hintsRef.current = hints;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const memoRef = useRef(memoMode);
  memoRef.current = memoMode;
  const undoRef = useRef([]);

  // 걸린 시간: 탭이 보이고 판이 진행 중일 때만 흐른다
  const clock = useRef({ base: initial.elapsed, since: null });
  const elapsed = () => clock.current.base + (clock.current.since ? Date.now() - clock.current.since : 0);
  const pauseClock = () => {
    clock.current = { base: elapsed(), since: null };
  };
  const runClock = () => {
    if (!clock.current.since && gameRef.current.status === "playing" && !document.hidden) clock.current.since = Date.now();
  };

  function save() {
    try {
      const s = settingsRef.current;
      const g = gameRef.current;
      // 다 푼 판은 저장하지 않는다. 다음에 열면 새 판으로 시작한다
      const saved = g.status === "playing" ? { ...packGame(g), elapsed: Math.round(elapsed()), hints: hintsRef.current } : null;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ level: s.level, check: s.check, best: s.best, game: saved }));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => saveRef.current(), [settings, game, hints]);

  useEffect(() => {
    runClock();
    const onVisible = () => {
      if (document.hidden) {
        pauseClock();
        saveRef.current();
      } else runClock();
    };
    const onLeave = () => saveRef.current();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pagehide", onLeave);
    // 탭을 그냥 닫아도 시간이 크게 어긋나지 않게 가끔 저장한다
    const timer = setInterval(() => saveRef.current(), 5000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pagehide", onLeave);
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!confettiId) return undefined;
    const timer = setTimeout(() => setConfettiId(null), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [confettiId]);

  function start(level) {
    const next = newGame(level);
    gameRef.current = next;
    setGame(next);
    clock.current = { base: 0, since: null };
    runClock();
    undoRef.current = [];
    setUndoCount(0);
    setSelected(null);
    setNotice("");
    setTip(null);
    setHints(0);
    hintsRef.current = 0;
    setResult(null);
    setConfettiId(null);
  }

  function changeLevel(level) {
    setSettings((s) => ({ ...s, level }));
    start(level);
  }

  // 판을 바꾸고, 되돌릴 수 있게 바꾸기 전 판을 쌓아 둔다
  function commit(next) {
    const g = gameRef.current;
    if (next === g) return;
    undoRef.current.push({ values: g.values, notes: g.notes });
    if (undoRef.current.length > UNDO_MAX) undoRef.current.shift();
    setUndoCount(undoRef.current.length);
    gameRef.current = next;
    setGame(next);
    setTip(null);
    setNotice("");
    if (next.status === "won") {
      pauseClock();
      const ms = elapsed();
      // 화면의 시간과 같게 초 아래는 버린다
      const seconds = Math.max(1, Math.floor(ms / 1000));
      const s = settingsRef.current;
      const old = s.best[next.level];
      // 힌트를 쓴 판은 최고 기록으로 치지 않는다
      const isBest = hintsRef.current === 0 && (!Number.isInteger(old) || seconds < old);
      if (isBest) setSettings((prev) => ({ ...prev, best: { ...prev.best, [next.level]: seconds } }));
      setResult({ ms, isBest });
      setConfettiId(Date.now());
    } else if (next.values.every(Boolean) && !settingsRef.current.check) {
      setNotice(`다 채웠지만 틀린 칸이 ${wrongCells(next).length}개 있습니다.`);
    }
  }

  function press(digit) {
    const g = gameRef.current;
    const cell = selectedRef.current;
    if (g.status !== "playing") return;
    if (cell === null) {
      setNotice("칸을 먼저 고르세요.");
      return;
    }
    if (g.puzzle[cell]) {
      setNotice("처음부터 있던 숫자는 바꿀 수 없습니다.");
      return;
    }
    commit(memoRef.current ? toggleNote(g, cell, digit) : setValue(g, cell, digit));
  }

  function clearCell() {
    const cell = selectedRef.current;
    if (cell !== null) commit(erase(gameRef.current, cell));
  }

  function undo() {
    const last = undoRef.current.pop();
    if (!last || gameRef.current.status !== "playing") return;
    setUndoCount(undoRef.current.length);
    const next = { ...gameRef.current, ...last };
    gameRef.current = next;
    setGame(next);
    setTip(null);
    setNotice("");
  }

  function askHint() {
    const g = gameRef.current;
    if (g.status !== "playing") return;
    const found = hint(g);
    if (!found) return;
    setNotice("");
    if (found.kind === "wrong") {
      setTip({ wrong: found.cells });
      return;
    }
    setHints((n) => n + 1);
    hintsRef.current += 1;
    setSelected(found.cell);
    setTip({ ...found, shown: false });
  }

  function move(dr, dc) {
    const cur = selectedRef.current ?? 40;
    const r = Math.min(8, Math.max(0, Math.floor(cur / 9) + dr));
    const c = Math.min(8, Math.max(0, (cur % 9) + dc));
    setSelected(selectedRef.current === null ? 40 : r * 9 + c);
  }

  // 키보드: 숫자, 화살표, Backspace·Delete(지우기), N(메모), Ctrl+Z(되돌리기), Esc(고른 칸 풀기).
  // 버튼에 초점이 있을 때 Enter·스페이스는 그 버튼을 누르는 것이라 건드리지 않는다
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.altKey) return;
    if (e.ctrlKey || e.metaKey) {
      if (e.key.toLowerCase() !== "z" || e.shiftKey) return;
      undo();
    } else if (/^[1-9]$/.test(e.key)) press(Number(e.key));
    else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") clearCell();
    else if (e.key === "ArrowUp") move(-1, 0);
    else if (e.key === "ArrowDown") move(1, 0);
    else if (e.key === "ArrowLeft") move(0, -1);
    else if (e.key === "ArrowRight") move(0, 1);
    else if (e.key.toLowerCase() === "n") setMemoMode((m) => !m);
    else if (e.key === "Escape") {
      setSelected(null);
      setTip(null);
    } else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 숫자판은 눌러도 초점을 가져가지 않게 한다. 그래야 누른 뒤에도 화살표·숫자 키가 판으로 간다
  const keepFocus = (e) => e.preventDefault();

  const counts = digitCounts(game.values);
  const wrong = new Set(settings.check || tip?.wrong ? wrongCells(game) : []);
  const peers = selected === null ? null : new Set(PEERS[selected]);
  const sameDigit = selected === null ? 0 : game.values[selected];
  const blanks = game.values.filter((v) => !v).length;

  let status;
  if (game.status === "won") {
    status = (
      <>
        🎉 다 풀었습니다. <strong>{clockText(result?.ms ?? elapsed())}</strong>
        {result?.isBest && " · 최고 기록입니다."}
        {hints > 0 && ` · 힌트 ${hints}번`}
      </>
    );
  } else if (tip?.wrong) status = `틀린 칸이 ${tip.wrong.length}개 있습니다. 빨갛게 표시한 칸을 먼저 고치세요.`;
  else if (tip) {
    status = (
      <>
        <strong>{cellName(tip.cell)}</strong>: {tip.before.length > 0 && `${tip.before.join(" ")} 그러면 `}
        {tip.text}{" "}
        {tip.shown ? <strong>답은 {tip.digit}입니다.</strong> : (
          <button type="button" className="sd-link" onMouseDown={keepFocus} onClick={() => setTip({ ...tip, shown: true })}>숫자 보기</button>
        )}
      </>
    );
  } else if (notice) status = notice;
  else status = `빈칸 ${blanks}개 남았습니다.`;

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>스도쿠</h1>
        <p className="subtitle">가로줄, 세로줄, 굵은 선으로 나눈 3×3 상자마다 1부터 9까지를 한 번씩 넣습니다.</p>
      </header>

      <section className="card sd-card">
        <div className="sd-top">
          <div className="sd-levels" role="group" aria-label="난이도">
            {LEVELS.map((l) => (
              <button key={l} type="button" className={l === settings.level ? "active" : ""} aria-pressed={l === settings.level} onClick={() => changeLevel(l)}>
                {LEVEL_LABELS[l]}
              </button>
            ))}
          </div>
          <Clock read={elapsed} />
        </div>

        <div className="sd-play">
          <div className="sd-board" role="grid" aria-label="스도쿠 판">
            {game.values.map((v, i) => {
              const given = game.puzzle[i] !== 0;
              const classes = ["sd-cell"];
              if (given) classes.push("given");
              if (i % 3 === 2 && i % 9 !== 8) classes.push("edge-r");
              if (Math.floor(i / 9) % 3 === 2 && i < 72) classes.push("edge-b");
              if (i === selected) classes.push("selected");
              else if (sameDigit && v === sameDigit) classes.push("same");
              else if (peers?.has(i)) classes.push("peer");
              if (wrong.has(i)) classes.push("wrong");
              if (tip && tip.cell === i) classes.push("tip");
              return (
                <button
                  key={i}
                  type="button"
                  role="gridcell"
                  className={classes.join(" ")}
                  data-cell={i}
                  aria-label={`${cellName(i)} ${v ? `${v}${given ? "" : " (넣은 숫자)"}` : "빈칸"}`}
                  aria-selected={i === selected}
                  onMouseDown={keepFocus}
                  onClick={() => setSelected(i)}
                >
                  {v ? v : game.notes[i] ? (
                    <span className="sd-notes" aria-hidden="true">
                      {DIGITS.map((d) => <span key={d}>{noteDigits(game.notes[i]).includes(d) ? d : ""}</span>)}
                    </span>
                  ) : ""}
                </button>
              );
            })}
          </div>

          <div className="sd-side">
            <p className="sd-status" role="status">{status}</p>
            <div className="sd-keypad">
              {DIGITS.map((d) => (
                <button
                  key={d}
                  type="button"
                  className="sd-key"
                  disabled={!playing || (!memoMode && counts[d] >= 9)}
                  aria-label={`${d} (남은 ${Math.max(0, 9 - counts[d])}개)`}
                  onMouseDown={keepFocus}
                  onClick={() => press(d)}
                >
                  {d}
                  <small>{Math.max(0, 9 - counts[d])}</small>
                </button>
              ))}
            </div>
            <div className="sd-tools">
              <button type="button" className={memoMode ? "sd-on" : "secondary"} aria-pressed={memoMode} onMouseDown={keepFocus} onClick={() => setMemoMode((m) => !m)}>
                메모 {memoMode ? "켬" : "끔"}
              </button>
              <button type="button" className="secondary" disabled={!playing || selected === null} onMouseDown={keepFocus} onClick={clearCell}>지우기</button>
              <button type="button" className="secondary" disabled={!playing || undoCount === 0} onMouseDown={keepFocus} onClick={undo}>되돌리기</button>
              <button type="button" className="secondary" disabled={!playing} onMouseDown={keepFocus} onClick={askHint}>힌트</button>
            </div>
            <label className="sd-option">
              <input type="checkbox" checked={settings.check} onChange={(e) => setSettings((s) => ({ ...s, check: e.target.checked }))} />
              틀린 숫자 바로 표시
            </label>
            <button type="button" className="sd-new" onClick={() => start(settings.level)}>새 판</button>
          </div>
        </div>

        <p className="sd-best">
          최고 기록 {LEVELS.map((l) => `${LEVEL_LABELS[l]} ${Number.isInteger(settings.best[l]) ? clockText(settings.best[l] * 1000) : "없음"}`).join(" · ")}
        </p>
        <p className="sd-hint">
          문제는 열 때마다 새로 만들고, 답이 하나뿐인 것만 냅니다. 난이도는 빈칸 수가 아니라 풀 때 필요한 기술로 정합니다.
          키보드로도 됩니다(숫자, 화살표, Backspace, N은 메모, Ctrl+Z는 되돌리기). 하던 판은 이 브라우저에 저장되어 다시 열면 이어집니다.
          힌트를 쓴 판은 최고 기록에 넣지 않습니다.
        </p>
      </section>

      {confettiId && <Confetti key={confettiId} />}
    </main>
  );
}
