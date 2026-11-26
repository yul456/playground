import { useEffect, useMemo, useRef, useState } from "react";
import Confetti from "../shared/Confetti.jsx";
import { HUB_URL } from "../shared/site.js";
import { BLACK, WHITE, LEVELS, SIZE, countDiscs, legalMoves, newGame, other, pickMove, play, replay, winnerOf } from "./reversi.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.reversi.v1";
const CONFETTI_MS = 3500;
// 컴퓨터가 두기 전에 잠깐 기다린다. 바로 두면 무엇이 뒤집혔는지 보기 어렵다
const THINK_MS = 600;
// 상대: 컴퓨터 세기 셋과 둘이서(한 화면에서 번갈아)
const MODES = [...LEVELS, "two"];
const MODE_LABELS = { easy: "쉬움", normal: "보통", hard: "어려움", two: "둘이서" };
const NAMES = { [BLACK]: "검은 돌", [WHITE]: "흰 돌" };
const EMPTY_RECORD = { win: 0, lose: 0, draw: 0 };

function load() {
  const base = { mode: "normal", color: BLACK, hints: true, record: {}, moves: [], undone: false };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || typeof saved !== "object") return base;
    const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);
    const record = Object.fromEntries(
      LEVELS.map((level) => {
        const r = saved.record?.[level] ?? {};
        return [level, { win: count(r.win), lose: count(r.lose), draw: count(r.draw) }];
      }),
    );
    // 하던 판은 둔 칸 목록으로 저장한다. 규칙에 안 맞거나 이미 끝난 판이면 새 판으로 시작한다
    const game = Array.isArray(saved.moves) ? replay(saved.moves) : null;
    const moves = game && !game.over ? game.moves : [];
    return {
      mode: MODES.includes(saved.mode) ? saved.mode : base.mode,
      color: saved.color === WHITE ? WHITE : BLACK,
      hints: saved.hints !== false,
      record,
      moves,
      undone: moves.length > 0 && saved.undone === true,
    };
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
    return base;
  }
}

export default function App() {
  const [state, setState] = useState(load);
  const { mode, color, hints, record, moves, undone } = state;
  // 끝난 판의 결과: win, lose, draw (둘이서 하면 null)
  const [result, setResult] = useState(null);
  const [confettiId, setConfettiId] = useState(null);
  const game = useMemo(() => replay(moves) ?? newGame(), [moves]);
  // 누르기가 다시 그리기 전에 몰려 와도 가장 새 값으로 계산하도록 ref에도 둔다
  const stateRef = useRef(state);
  stateRef.current = state;
  const update = (patch) => {
    const next = { ...stateRef.current, ...patch };
    stateRef.current = next;
    setState(next);
  };

  const computer = mode === "two" ? null : other(color);
  const thinking = !game.over && game.turn === computer;
  const counts = countDiscs(game.board);
  const options = useMemo(
    () => (game.over || thinking ? new Set() : new Set(legalMoves(game.board, game.turn))),
    [game, thinking],
  );

  useEffect(() => {
    try {
      // 끝난 판은 저장하지 않는다. 다시 열면 새 판이다
      localStorage.setItem(STORAGE_KEY, JSON.stringify(game.over ? { ...state, moves: [], undone: false } : state));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [state, game.over]);

  useEffect(() => {
    if (!confettiId) return undefined;
    const timer = setTimeout(() => setConfettiId(null), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [confettiId]);

  // 한 수를 두고, 판이 끝났으면 결과를 적는다
  function commit(pos) {
    const s = stateRef.current;
    const now = replay(s.moves) ?? newGame();
    const next = play(now, pos);
    if (!next) return;
    const patch = { moves: next.moves };
    if (next.over && s.mode !== "two") {
      const winner = winnerOf(next.board);
      const outcome = winner === s.color ? "win" : winner === other(s.color) ? "lose" : "draw";
      setResult(outcome);
      if (outcome === "win") setConfettiId(Date.now());
      // 무르기를 쓴 판은 전적에 넣지 않는다
      if (!s.undone) {
        const old = s.record[s.mode] ?? EMPTY_RECORD;
        patch.record = { ...s.record, [s.mode]: { ...old, [outcome]: old[outcome] + 1 } };
      }
    }
    update(patch);
  }

  // 컴퓨터 차례면 잠깐 뒤에 둔다. 그 사이 판이 바뀌면(새 판, 무르기) 그만둔다
  useEffect(() => {
    if (!thinking) return undefined;
    const timer = setTimeout(() => {
      const pos = pickMove(game.board, game.turn, mode);
      if (pos !== null) commit(pos);
    }, THINK_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, thinking, mode]);

  function restart(patch = {}) {
    setResult(null);
    setConfettiId(null);
    update({ ...patch, moves: [], undone: false });
  }

  function put(pos) {
    if (thinking || game.over || !options.has(pos)) return;
    commit(pos);
  }

  // 내가 마지막으로 둔 수 앞으로 돌아간다 (그 뒤에 컴퓨터가 둔 수도 함께). 둘이서 할 때는 한 수씩
  function undo() {
    const s = stateRef.current;
    const me = s.mode === "two" ? null : s.color;
    let k = s.moves.length;
    while (k > 0) {
      k--;
      const mover = replay(s.moves.slice(0, k)).turn;
      if (me === null || mover === me) break;
    }
    if (k === s.moves.length) return;
    update({ moves: s.moves.slice(0, k), undone: true });
  }
  // 무를 수가 있는지: 둘이서는 한 수라도, 컴퓨터와는 내가 둔 수가 있어야 한다
  const canUndo = useMemo(() => {
    if (game.over || !moves.length) return false;
    if (mode === "two") return true;
    for (let k = 0; k < moves.length; k++) if (replay(moves.slice(0, k)).turn === color) return true;
    return false;
  }, [game.over, moves, mode, color]);

  // 화살표 키로 칸 사이를 옮긴다
  function onBoardKey(e) {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SIZE, ArrowDown: SIZE }[e.key];
    const pos = Number(e.target.dataset?.pos);
    if (!step || !Number.isInteger(pos)) return;
    const col = pos % SIZE;
    if ((e.key === "ArrowLeft" && col === 0) || (e.key === "ArrowRight" && col === SIZE - 1)) return;
    const next = e.currentTarget.querySelector(`[data-pos="${pos + step}"]`);
    if (next) {
      e.preventDefault();
      next.focus();
    }
  }

  const score = `검은 돌 ${counts.black} : 흰 돌 ${counts.white}`;
  let status;
  if (game.over) {
    const winner = winnerOf(game.board);
    if (mode === "two") status = <><strong>{score}</strong>. {winner ? `${NAMES[winner]}이 이겼습니다.` : "비겼습니다."}</>;
    else {
      const words = { win: "🎉 이겼습니다.", lose: "졌습니다.", draw: "비겼습니다." }[result] ?? "";
      status = <><strong>{score}</strong>. {words}{undone && " 무르기를 써서 전적에는 넣지 않았습니다."}</>;
    }
  } else {
    const pass = game.passed ? `${NAMES[game.passed]}이 둘 곳이 없어 건너뜁니다. ` : "";
    if (thinking) status = `${pass}컴퓨터(${NAMES[computer]})가 생각하는 중…`;
    else if (mode === "two") status = `${pass}${NAMES[game.turn]} 차례입니다.`;
    else status = `${pass}내 차례입니다 (${NAMES[color]}).${hints ? " 점이 찍힌 칸에 둘 수 있습니다." : ""}`;
  }
  const mine = record[mode] ?? EMPTY_RECORD;

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>리버시</h1>
        <p className="subtitle">
          상대 돌을 내 돌 사이에 끼우면 내 돌로 뒤집힙니다. 판이 다 차거나 둘 다 둘 곳이 없을 때 돌이 많은 쪽이 이깁니다.
        </p>
      </header>

      <section className="card">
        <div className="rv-top">
          <div className="rv-seg" role="group" aria-label="상대">
            {MODES.map((m) => (
              <button
                key={m}
                type="button"
                className={m === mode ? "active" : ""}
                aria-pressed={m === mode}
                onClick={() => m !== mode && restart({ mode: m })}
              >
                {MODE_LABELS[m]}
              </button>
            ))}
          </div>
          {mode !== "two" && (
            <div className="rv-seg" role="group" aria-label="내 돌">
              {[BLACK, WHITE].map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === color ? "active" : ""}
                  aria-pressed={c === color}
                  onClick={() => c !== color && restart({ color: c })}
                >
                  {c === BLACK ? "검은 돌 (먼저)" : "흰 돌 (나중)"}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="rv-play">
          <div className="rv-board" role="grid" aria-label="리버시 판" onKeyDown={onBoardKey}>
            {game.board.map((v, pos) => {
              const can = options.has(pos);
              const flipped = game.flipped.includes(pos);
              const label = `${Math.floor(pos / SIZE) + 1}행 ${(pos % SIZE) + 1}열 ${v ? NAMES[v] : can ? "둘 수 있는 빈칸" : "빈칸"}`;
              return (
                <button
                  key={pos}
                  type="button"
                  data-pos={pos}
                  className={`rv-cell${can ? " can" : ""}${pos === game.last ? " last" : ""}`}
                  aria-label={label}
                  aria-disabled={!can}
                  onClick={() => put(pos)}
                >
                  {v ? (
                    <span
                      // 판이 바뀔 때마다 뒤집히는 움직임을 처음부터 다시 하도록 key를 바꾼다
                      key={flipped || pos === game.last ? `${moves.length}` : "still"}
                      className={`rv-disc ${v === BLACK ? "black" : "white"}${flipped ? " flip" : ""}${pos === game.last ? " placed" : ""}`}
                    />
                  ) : (
                    can && hints && <span className={`rv-dot ${game.turn === BLACK ? "black" : "white"}`} />
                  )}
                </button>
              );
            })}
          </div>

          <div className="rv-side">
            <div className="rv-score" aria-label={score}>
              <span className={!game.over && game.turn === BLACK ? "turn" : ""}>
                <i className="rv-disc black" /> {counts.black}
              </span>
              <span className={!game.over && game.turn === WHITE ? "turn" : ""}>
                <i className="rv-disc white" /> {counts.white}
              </span>
            </div>
            <p className="rv-status" role="status">{status}</p>
            <div className="rv-actions">
              <button type="button" onClick={() => restart()}>새 판</button>
              <button type="button" className="secondary" disabled={!canUndo} onClick={undo}>무르기</button>
            </div>
            <label className="rv-check">
              <input type="checkbox" checked={hints} onChange={(e) => update({ hints: e.target.checked })} />
              둘 수 있는 곳 표시
            </label>
            {mode !== "two" && (
              <p className="rv-record">
                {MODE_LABELS[mode]} 전적: {mine.win}승 {mine.lose}패 {mine.draw}무
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="card rv-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>빈칸에 돌을 놓아 가로·세로·대각선으로 상대 돌을 내 돌 사이에 끼워야 합니다. 하나도 못 뒤집는 칸에는 둘 수 없습니다.</li>
          <li>둘 곳이 없으면 차례를 건너뜁니다. 모서리는 한 번 잡으면 뒤집히지 않습니다.</li>
          <li>무르기를 쓴 판은 전적에 넣지 않습니다. 하던 판은 이 브라우저에 저장되어 다시 열면 이어집니다.</li>
        </ul>
      </section>

      {confettiId && <Confetti key={confettiId} />}
    </main>
  );
}
