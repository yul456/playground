import { useEffect, useRef, useState } from "react";
import Confetti from "../shared/Confetti.jsx";
import { HUB_URL } from "../shared/site.js";
import { giveUp, isValidGuess, LENGTHS, MAX_TRIES, newGame, play, wasTried } from "./baseball.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.baseball.v1";
const CONFETTI_MS = 3500;
const KEYPAD = [..."1234567890"];
// 메모: 누를 때마다 표시 없음 → 아님 → 있음 → 표시 없음
const MEMO_NEXT = { none: "out", out: "in", in: "none" };
const MEMO_LABEL = { none: "", out: "아님", in: "있음" };

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && typeof saved === "object") {
      // 자릿수별 최고 기록(가장 적게 친 횟수). 정수가 아닌 값은 버린다
      const best = Object.fromEntries(LENGTHS.filter((n) => Number.isInteger(saved.best?.[n])).map((n) => [n, saved.best[n]]));
      return { length: LENGTHS.includes(saved.length) ? saved.length : LENGTHS[0], best };
    }
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return { length: LENGTHS[0], best: {} };
}

// 스트라이크·볼 결과. 둘 다 0이면 아웃
function Result({ strikes, balls }) {
  if (!strikes && !balls) return <span className="bb-chip out">OUT</span>;
  return (
    <>
      {strikes > 0 && <span className="bb-chip strike">{strikes}S</span>}
      {balls > 0 && <span className="bb-chip ball">{balls}B</span>}
    </>
  );
}

const resultWords = ({ strikes, balls }) =>
  !strikes && !balls ? "아웃" : [strikes && `${strikes} 스트라이크`, balls && `${balls} 볼`].filter(Boolean).join(" ");

export default function App() {
  const [settings, setSettings] = useState(load);
  const [game, setGame] = useState(() => newGame(settings.length));
  const [input, setInput] = useState("");
  // 잘못 넣었을 때 잠깐 보여 줄 말
  const [notice, setNotice] = useState("");
  // 숫자마다 메모 표시(out, in). 판마다 새로 한다
  const [memo, setMemo] = useState({});
  // 이긴 판의 기록: { tries, isBest }
  const [result, setResult] = useState(null);
  const [confettiId, setConfettiId] = useState(null);
  const playing = game.status === "playing";
  // 누르기가 다시 그리기 전에 몰려 와도 가장 새 판과 입력으로 계산하도록 ref에도 둔다
  const gameRef = useRef(game);
  gameRef.current = game;
  const inputRef = useRef(input);
  inputRef.current = input;
  const updateGame = (next) => {
    gameRef.current = next;
    setGame(next);
  };
  const updateInput = (next) => {
    inputRef.current = next;
    setInput(next);
  };

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

  function restart(length = settings.length) {
    updateGame(newGame(length));
    updateInput("");
    setNotice("");
    setMemo({});
    setResult(null);
    setConfettiId(null);
  }

  function changeLength(length) {
    setSettings((s) => ({ ...s, length }));
    restart(length);
  }

  function quit() {
    updateGame(giveUp(gameRef.current));
    updateInput("");
    setNotice("");
  }

  function addDigit(d) {
    const g = gameRef.current;
    const current = inputRef.current;
    if (g.status !== "playing" || current.length >= g.length || current.includes(d)) return;
    updateInput(current + d);
    setNotice("");
  }

  function removeDigit() {
    updateInput(inputRef.current.slice(0, -1));
    setNotice("");
  }

  function submit() {
    const g = gameRef.current;
    const guess = inputRef.current;
    if (g.status !== "playing") return;
    if (!isValidGuess(guess, g.length)) {
      setNotice(`서로 다른 숫자 ${g.length}개를 골라 주세요.`);
      return;
    }
    if (wasTried(g, guess)) {
      setNotice("이미 쳐 본 숫자입니다. 기회는 그대로입니다.");
      return;
    }
    const next = play(g, guess);
    updateGame(next);
    updateInput("");
    setNotice("");
    if (next.status === "won") {
      const tries = next.guesses.length;
      const old = settings.best[next.length];
      const isBest = !Number.isInteger(old) || tries < old;
      if (isBest) setSettings((s) => ({ ...s, best: { ...s.best, [next.length]: tries } }));
      setResult({ tries, isBest });
      setConfettiId(Date.now());
    }
  }

  // 키보드로도 칠 수 있다: 숫자, Backspace, Enter(확인), Esc(지우기).
  // 버튼에 초점이 있을 때 Enter·스페이스는 그 버튼을 누르는 것이라 건드리지 않는다
  const keyRef = useRef(null);
  keyRef.current = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = e.target.closest?.("button");
    if (/^[0-9]$/.test(e.key)) addDigit(e.key);
    else if (e.key === "Backspace") removeDigit();
    else if (e.key === "Escape") updateInput("");
    else if (e.key === "Enter" && !onButton) submit();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 화면 숫자판은 눌러도 초점을 가져가지 않게 한다. 그래야 마우스로 누른 뒤 Enter가 확인으로 간다
  const keepFocus = (e) => e.preventDefault();

  const last = game.guesses.at(-1);
  let status;
  if (game.status === "won") {
    status = <>⚾ 정답! <strong>{result?.tries}회</strong> 만에 맞혔습니다.{result?.isBest && " 최고 기록입니다."}</>;
  } else if (game.status === "lost") {
    status = <>{game.gaveUp ? "포기했습니다." : `${MAX_TRIES}회까지 못 맞혔습니다.`} 정답은 <strong>{game.secret}</strong></>;
  } else if (notice) status = notice;
  else if (last) status = `${game.guesses.length}회: ${last.guess} → ${resultWords(last)}`;
  else status = `0~9 중 서로 다른 숫자 ${game.length}개를 골라 확인을 누르세요.`;

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>숫자 야구</h1>
        <p className="subtitle">
          컴퓨터가 정한 숫자를 {MAX_TRIES}회 안에 맞힙니다. 숫자와 자리가 맞으면 스트라이크(S), 숫자만 맞으면 볼(B),
          하나도 없으면 아웃입니다.
        </p>
      </header>

      <section className="card bb-card">
        <div className="bb-top">
          <div className="bb-lengths" role="group" aria-label="자릿수">
            {LENGTHS.map((n) => (
              <button
                key={n}
                type="button"
                className={n === settings.length ? "active" : ""}
                aria-pressed={n === settings.length}
                onClick={() => changeLength(n)}
              >
                {n}자리
              </button>
            ))}
          </div>
          <span className="bb-inning">{playing ? `${game.guesses.length + 1}회 / ${MAX_TRIES}회` : "경기 끝"}</span>
        </div>

        <div className="bb-play">
          <div className="bb-pad">
            <div className="bb-slots" aria-label={`고른 숫자 ${input || "없음"}`}>
              {Array.from({ length: game.length }, (_, k) => (
                <span key={k} className={k === input.length && playing ? "current" : ""}>{input[k] ?? ""}</span>
              ))}
            </div>
            <p className="bb-status" role="status">{status}</p>
            <div className="bb-keypad">
              {KEYPAD.map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`bb-key memo-${memo[d] ?? "none"}`}
                  disabled={!playing || input.includes(d) || input.length >= game.length}
                  onMouseDown={keepFocus}
                  onClick={() => addDigit(d)}
                >
                  {d}
                </button>
              ))}
            </div>
            <div className="bb-actions">
              <button type="button" className="secondary" disabled={!input} onMouseDown={keepFocus} onClick={removeDigit}>
                지우기
              </button>
              <button type="button" disabled={!playing || input.length !== game.length} onMouseDown={keepFocus} onClick={submit}>
                확인
              </button>
            </div>
            <div className="bb-memo">
              <span className="bb-label">메모</span>
              {[..."0123456789"].map((d) => {
                const mark = memo[d] ?? "none";
                return (
                  <button
                    key={d}
                    type="button"
                    className={`memo-${mark}`}
                    aria-label={`${d} ${MEMO_LABEL[mark] || "표시 없음"}`}
                    onMouseDown={keepFocus}
                    onClick={() => setMemo((m) => ({ ...m, [d]: MEMO_NEXT[mark] }))}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bb-board">
            <h2>기록</h2>
            {game.guesses.length === 0 ? (
              <p className="bb-empty">아직 친 숫자가 없습니다.</p>
            ) : (
              <ol className="bb-history">
                {game.guesses.map((g, k) => (
                  <li key={g.guess}>
                    <span className="bb-try">{k + 1}회</span>
                    <span className="bb-guess">{g.guess}</span>
                    <span className="bb-result" aria-label={resultWords(g)}><Result {...g} /></span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>

        <div className="bb-footer">
          <button type="button" className="secondary" disabled={!playing} onClick={quit}>포기</button>
          <button type="button" onClick={() => restart()}>새 게임</button>
        </div>
        <p className="bb-best">
          최고 기록 {LENGTHS.map((n) => `${n}자리 ${Number.isInteger(settings.best[n]) ? `${settings.best[n]}회` : "없음"}`).join(" · ")}
        </p>
        <p className="bb-hint">
          키보드로도 칠 수 있습니다(숫자, Enter, Backspace). 메모 칸의 숫자를 누르면 아님 → 있음 → 표시 없음으로 바뀌고,
          위 숫자판에도 같은 표시가 나옵니다.
        </p>
      </section>

      {confettiId && <Confetti key={confettiId} />}
    </main>
  );
}
