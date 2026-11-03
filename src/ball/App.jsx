import { useEffect, useMemo, useState } from "react";
import Confetti from "../shared/Confetti.jsx";
import { shuffle } from "../shared/random.js";
import { HUB_URL } from "../shared/site.js";
import { COURSES, courseOf } from "./courses/index.js";
import { GRAVITY, MAX_BALLS, MAX_GRAVITY, MIN_BALLS, MIN_GRAVITY, createRace } from "./race.js";
import RaceView from "./RaceView.jsx";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.ball.v1";
const PRESETS = [
  { name: "참가자 4명", items: ["참가자1", "참가자2", "참가자3", "참가자4"] },
  { name: "참가자 8명", items: Array.from({ length: 8 }, (_, i) => `참가자${i + 1}`) },
  { name: "점심 메뉴", items: ["김치찌개", "짜장면", "돈까스", "국밥", "초밥", "햄버거", "칼국수", "비빔밥"] },
];
const MODES = [
  { key: "last", label: "마지막까지 남은 구슬" },
  { key: "first", label: "가장 먼저 도착한 구슬" },
];
const CONFETTI_MS = 3500;
const MAX_HISTORY = 100;

// 저장된 중력. 숫자가 아니면 기본값으로, 고를 수 있는 범위를 벗어나면 가까운 끝 값으로 한다
function gravityOf(value) {
  if (!Number.isFinite(value)) return GRAVITY;
  return Math.min(MAX_GRAVITY, Math.max(MIN_GRAVITY, Math.round(value)));
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (typeof saved?.text === "string") {
      // 저장된 값에 빠진 설정은 기본값으로 한다 (번호도 돌리기, 첫 코스, 기본 중력, 슬로 모션 켜기)
      return {
        text: saved.text,
        mode: saved.mode === "first" ? "first" : "last",
        spinNumbers: saved.spinNumbers !== false,
        course: courseOf(saved.course).key,
        gravity: gravityOf(saved.gravity),
        slowMotion: saved.slowMotion !== false,
      };
    }
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return {
    text: PRESETS[1].items.join("\n"),
    mode: "last",
    spinNumbers: true,
    course: COURSES[0].key,
    gravity: GRAVITY,
    slowMotion: true,
  };
}

// 한 줄에 하나씩. 빈 줄과 앞뒤 공백은 뺀다
const linesOf = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

export default function App() {
  const [settings, setSettings] = useState(load);
  const { text, mode, spinNumbers, gravity, slowMotion } = settings;
  const course = courseOf(settings.course);
  const lines = linesOf(text);
  const names = lines.slice(0, MAX_BALLS);
  const namesKey = names.join("\n");
  // 새 판을 만들 때마다 올린다 (다시 하기, 이름·규칙·코스 바꾸기)
  const [round, setRound] = useState(0);
  // 출발 자리는 crypto로 고르게 섞는다. 코스가 어느 자리에 유리하든 누구나 당첨될 확률이 같아진다.
  // names는 매번 새 배열이라 내용(namesKey)으로 새로 섞을지 정한다
  const slots = useMemo(() => shuffle(names.map((_, i) => i)), [namesKey, round]);
  // 중력만 바꾸면 자리는 그대로 두고 그 중력으로 판을 다시 만든다. 막대를 끄는 동안 자리가 자꾸 바뀌지 않게 한다
  const race = useMemo(
    () => createRace({ names, slots, course, mode, gravity }),
    [slots, course, mode, gravity],
  );
  const [phase, setPhase] = useState("ready");
  // 도착한 구슬 번호(도착 순서), 당첨 구슬 번호, 화면이 따라갈 구슬 번호
  const [arrived, setArrived] = useState([]);
  const [winner, setWinner] = useState(null);
  const [follow, setFollow] = useState(null);
  const [history, setHistory] = useState([]);
  const [confettiId, setConfettiId] = useState(null);

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

  // 결과를 비우고 출발 전으로 돌아간다
  function clearResult() {
    setPhase("ready");
    setArrived([]);
    setWinner(null);
    setFollow(null);
    setConfettiId(null);
  }

  // 새 판: 출발 자리를 다시 섞고 결과를 비운다.
  // 이름이 그대로여도(공백만 고친 경우 등) 이미 끝난 판을 다시 쓰지 않도록 늘 새 판을 만든다
  function reset() {
    setRound((n) => n + 1);
    clearResult();
  }

  function start() {
    if (names.length < MIN_BALLS) return;
    race.start();
    setPhase("running");
  }

  function handleEvents(events) {
    for (const event of events) {
      if (event.type === "finish") setArrived((list) => [...list, event.ball.id]);
      if (event.type === "done") {
        setWinner(event.winner.id);
        setPhase("done");
        setHistory((list) => [...list, event.winner.name].slice(-MAX_HISTORY));
        setConfettiId(Date.now());
      }
    }
  }

  function changeText(value) {
    setSettings((s) => ({ ...s, text: value }));
    reset();
  }

  function changeMode(next) {
    setSettings((s) => ({ ...s, mode: next }));
    reset();
  }

  function changeCourse(next) {
    setSettings((s) => ({ ...s, course: next }));
    reset();
  }

  // 자리는 섞지 않고 결과만 비운다. 새 중력의 판은 race를 만드는 useMemo가 다시 만든다
  function changeGravity(value) {
    setSettings((s) => ({ ...s, gravity: value }));
    clearResult();
  }

  const left = names.length - arrived.length;
  const winnerGroup = winner == null ? null : race.balls[winner].group;
  const duplicates = race.groups.filter((g) => g.balls.length > 1);
  let status;
  if (phase === "done") status = <>🏆 <strong>{race.balls[winner].name}</strong> 당첨!</>;
  else if (phase === "running") status = mode === "last" ? `남은 구슬 ${left}개` : "가장 먼저 도착하는 구슬이 당첨입니다.";
  else if (names.length < MIN_BALLS) status = `이름을 ${MIN_BALLS}개 이상 넣어 주세요.`;
  else status = `출발을 누르면 구슬 ${names.length}개가 한꺼번에 굴러 내려갑니다.`;

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>구슬 레이스</h1>
        <p className="subtitle">이름마다 구슬이 하나씩 생기고, 출발하면 한꺼번에 코스를 굴러 내려갑니다.</p>
      </header>

      <section className="card race-card">
        <div className="race-options">
          <div className="race-option">
            <span className="race-label">코스</span>
            <div className="mode-toggle" role="group" aria-label="코스">
              {COURSES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className={course === c ? "active" : ""}
                  aria-pressed={course === c}
                  disabled={phase === "running"}
                  onClick={() => changeCourse(c.key)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
          <div className="race-option">
            <span className="race-label">당첨</span>
            <div className="mode-toggle" role="group" aria-label="당첨 규칙">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  className={mode === m.key ? "active" : ""}
                  aria-pressed={mode === m.key}
                  disabled={phase === "running"}
                  onClick={() => changeMode(m.key)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
          {/* 낮추면 둥둥 떠다니며 천천히, 높이면 빠르게 떨어진다 */}
          <label className="race-option">
            <span className="race-label">중력</span>
            <input
              type="range"
              className="race-range"
              min={MIN_GRAVITY}
              max={MAX_GRAVITY}
              step={1}
              value={gravity}
              disabled={phase === "running"}
              onChange={(e) => changeGravity(Number(e.target.value))}
            />
            <span className="race-value">{gravity === GRAVITY ? `${gravity} (기본)` : gravity}</span>
          </label>
          <label className="race-check">
            <input
              type="checkbox"
              checked={spinNumbers}
              onChange={(e) => setSettings((s) => ({ ...s, spinNumbers: e.target.checked }))}
            />
            번호도 함께 돌리기
          </label>
          {/* 보여 주는 속도만 바뀌고 결과는 같으므로 경주 중에도 바꿀 수 있다 */}
          <label className="race-check">
            <input
              type="checkbox"
              checked={slowMotion}
              onChange={(e) => setSettings((s) => ({ ...s, slowMotion: e.target.checked }))}
            />
            마지막 슬로 모션
          </label>
        </div>
        <RaceView race={race} follow={follow} spinNumbers={spinNumbers} slowMotion={slowMotion} onEvents={handleEvents} />
        <p className="race-status" role="status">{status}</p>
        <div className="race-buttons">
          {phase === "ready" && (
            <>
              {/* 새 판을 만들면 출발 자리를 crypto로 다시 섞는다 */}
              <button type="button" className="secondary" onClick={reset} disabled={names.length < MIN_BALLS}>자리 섞기</button>
              <button type="button" onClick={start} disabled={names.length < MIN_BALLS}>출발!</button>
            </>
          )}
          {phase === "running" && (
            <button type="button" className="secondary" onClick={reset}>그만하기</button>
          )}
          {phase === "done" && (
            <button type="button" onClick={reset}>다시 하기</button>
          )}
        </div>
        {race.balls.length > 0 && (
          <>
            <ul className="ball-list" aria-label="이름 목록. 누르면 화면이 그 이름의 구슬을 따라갑니다">
              {/* 같은 이름의 구슬은 한 칸에 모아 보여 준다 */}
              {race.groups.map((g) => {
                const won = winnerGroup === g.index;
                const orders = g.balls.map((m) => arrived.indexOf(m.id) + 1).filter((order) => order > 0).sort((a, b) => a - b);
                const out = !won && orders.length === g.balls.length;
                const classes = [g.index === follow && "following", out && "arrived", won && "winner"];
                return (
                  <li key={g.index}>
                    <button
                      type="button"
                      className={classes.filter(Boolean).join(" ")}
                      aria-pressed={g.index === follow}
                      onClick={() => setFollow((f) => (f === g.index ? null : g.index))}
                    >
                      <span className="ball-dot" style={{ background: g.color }} aria-hidden="true">{g.number}</span>
                      {g.name}
                      {g.balls.length > 1 && <span className="ball-count">×{g.balls.length}</span>}
                      {won && <span aria-label="당첨"> 🏆</span>}
                      {!won && orders.length > 0 && <span className="arrival">{orders.join("·")}번째 도착</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="ball-hint">
              이름을 누르면 화면이 그 이름의 구슬을 따라갑니다(여러 개면 결승선에 가장 가까운 구슬). 한 번 더 누르면 자동으로 돌아갑니다.
              오른쪽 지도를 누르거나 위아래로 끌면 그 위치를 보여 줍니다.
            </p>
          </>
        )}
      </section>

      <section className="card">
        <h2>이름 <small>{names.length}개</small></h2>
        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="secondary"
              disabled={phase === "running"}
              onClick={() => changeText(preset.items.join("\n"))}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <textarea
          className="items-input"
          value={text}
          rows={8}
          disabled={phase === "running"}
          aria-label="구슬 이름, 한 줄에 하나씩"
          onChange={(e) => changeText(e.target.value)}
        />
        <p className="items-hint">
          한 줄에 하나씩 적습니다. {MIN_BALLS}~{MAX_BALLS}개까지 쓸 수 있고, 출발 자리는 판마다 무작위로 섞습니다.
          같은 이름을 여러 줄 넣으면 그 이름의 구슬이 그만큼 생기고, 같은 색·번호로 보입니다.
          {lines.length > MAX_BALLS && ` 지금 ${lines.length}개라 앞의 ${MAX_BALLS}개만 구슬로 만듭니다.`}
        </p>
        {duplicates.length > 0 && (
          <p className="items-hint">
            같은 이름: {duplicates.map((g) => `${g.name} ×${g.balls.length}`).join(", ")}
          </p>
        )}
      </section>

      {history.length > 0 && (
        <section className="card">
          <div className="history-head">
            <h2>당첨 기록</h2>
            <button type="button" className="secondary" onClick={() => setHistory([])}>지우기</button>
          </div>
          <ol className="history">
            {history.map((name, i) => (
              <li key={i}><span className="order">{i + 1}</span>{name}</li>
            ))}
          </ol>
        </section>
      )}

      {confettiId && <Confetti key={confettiId} />}
    </main>
  );
}
