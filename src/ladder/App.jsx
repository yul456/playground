import { useEffect, useMemo, useState } from "react";
import { HUB_URL } from "../shared/site.js";
import Celebration from "./Celebration.jsx";
import LadderBoard from "./LadderBoard.jsx";
import { createRungs, tracePath } from "./ladder.js";

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;
const COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#64748b", "#a16207"];
const WIN = "당첨";
const LOSE = "꽝";

const defaultName = (i) => `참가자${i + 1}`;
const winLoseResults = (count, winners) => Array.from({ length: count }, (_, i) => (i < winners ? WIN : LOSE));
const countWinners = (results) => results.filter((r) => r.trim() === WIN).length;
// 결과 칸 하나하나가 당첨, 꽝(빈칸 포함), 직접 입력한 문구 중 하나다
const isWinLoseValue = (result) => [WIN, LOSE].includes(result.trim() || LOSE);
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// 인원수가 바뀌어도 이미 입력한 값은 남기고, 늘어난 칸만 기본값으로 채운다
function resize(list, count, fallback) {
  return Array.from({ length: count }, (_, i) => list[i] ?? fallback(i));
}

// 당첨 개수를 바꿀 때 지금 자리는 그대로 두고, 늘리면 앞쪽 꽝부터 당첨으로, 줄이면 앞쪽 당첨부터 꽝으로 바꾼다
// (둘 다 앞쪽부터라 +를 눌렀다 −를 누르면 원래 자리로 돌아온다)
function withWinnerCount(list, winners) {
  const next = list.map((r) => r.trim());
  let diff = winners - countWinners(next);
  for (let i = 0; diff !== 0 && i < next.length; i++) {
    if (diff > 0 && next[i] === LOSE) { next[i] = WIN; diff--; }
    else if (diff < 0 && next[i] === WIN) { next[i] = LOSE; diff++; }
  }
  return next;
}

// 당첨 개수를 고를 수 있는 범위. 당첨/꽝 칸 안에서만 고르고, 모든 칸이 당첨/꽝이면 꽝이 하나는 남게 한다
function winnerRange(results) {
  const cells = results.filter(isWinLoseValue).length;
  return { min: cells ? 1 : 0, max: cells === results.length ? cells - 1 : cells };
}

function Stepper({ label, value, unit, min, max, onChange }) {
  return (
    <div className="stepper" aria-label={label}>
      <span className="stepper-label">{label}</span>
      <button type="button" className="secondary" onClick={() => onChange(value - 1)} disabled={value <= min}>−</button>
      <span className="stepper-value">{value}{unit}</span>
      <button type="button" className="secondary" onClick={() => onChange(value + 1)} disabled={value >= max}>+</button>
    </div>
  );
}

export default function App() {
  const [count, setCount] = useState(4);
  const [names, setNames] = useState(() => resize([], 4, defaultName));
  const [results, setResults] = useState(() => winLoseResults(4, 1));
  // 사다리가 만들어지면 게임 진행, null이면 이름·결과 입력 중
  const [rungs, setRungs] = useState(null);
  // 경로를 그리기 시작한 참가자(누른 순서)와 다 그린 참가자
  const [traced, setTraced] = useState([]);
  const [finished, setFinished] = useState([]);
  const [hideRungs, setHideRungs] = useState(true);
  // 지금 축하 중인 당첨자들
  const [celebration, setCelebration] = useState(null);

  const playing = rungs !== null;
  const hasWinLose = results.some(isWinLoseValue);
  const customCount = results.filter((r) => !isWinLoseValue(r)).length;
  const winners = countWinners(results);
  const range = winnerRange(results);
  const paths = useMemo(
    () => (rungs ? names.map((_, i) => tracePath(rungs, i)) : []),
    [rungs, names],
  );
  // 결과 칸별로 도착한 참가자
  const arrivals = useMemo(() => {
    const byEnd = {};
    for (const player of finished) byEnd[paths[player].end] = player;
    return byEnd;
  }, [finished, paths]);
  const allFinished = playing && finished.length === count;
  const resultOf = (player) => results[paths[player].end];
  const sortedFinished = [...finished].sort((a, b) => a - b);
  const customFinished = sortedFinished.filter((p) => !isWinLoseValue(resultOf(p)));

  useEffect(() => {
    if (!celebration) return;
    const timer = setTimeout(() => setCelebration(null), 3500);
    return () => clearTimeout(timer);
  }, [celebration?.id]);

  function changeCount(next) {
    const n = clamp(next, MIN_PLAYERS, MAX_PLAYERS);
    setCount(n);
    setNames((list) => resize(list, n, defaultName));
    setResults((list) => {
      // 늘어난 칸은 꽝으로 채우고, 당첨 개수가 고를 수 있는 범위를 벗어나지 않게만 맞춘다
      const resized = resize(list, n, () => LOSE);
      const { min, max } = winnerRange(resized);
      return withWinnerCount(resized, clamp(countWinners(resized), min, max));
    });
  }

  // 당첨 ↔ 꽝을 바꾸고, 직접 입력한 문구는 꽝으로 되돌린다
  function toggleResult(index) {
    setResults((list) => list.map((r, i) => {
      if (i !== index) return r;
      if (!isWinLoseValue(r)) return LOSE;
      return r.trim() === WIN ? LOSE : WIN;
    }));
  }

  // 직접 입력한 문구만 꽝으로 바꾸고 당첨 자리는 그대로 둔다. 당첨이 없어지면 하나는 둔다
  function resetCustomResults() {
    setResults((list) => {
      const next = list.map((r) => (isWinLoseValue(r) ? r : LOSE));
      return withWinnerCount(next, Math.max(1, countWinners(next)));
    });
  }

  function updateAt(setter, index, value) {
    setter((list) => list.map((item, i) => (i === index ? value : item)));
  }

  function newLadder() {
    // 비워 둔 칸은 기본값으로 채운다
    setNames((list) => list.map((name, i) => name.trim() || defaultName(i)));
    // 결과 칸은 사용자가 정한 자리를 그대로 두고 가로줄만 새로 만든다
    setResults((list) => list.map((result) => result.trim() || LOSE));
    setRungs(createRungs(count));
    setTraced([]);
    setFinished([]);
    setCelebration(null);
  }

  function edit() {
    setRungs(null);
    setTraced([]);
    setFinished([]);
    setCelebration(null);
  }

  function trace(player) {
    setTraced((list) => (list.includes(player) ? list : [...list, player]));
  }

  function traceAll() {
    setHideRungs(false);
    setTraced((list) => [...list, ...names.map((_, i) => i).filter((i) => !list.includes(i))]);
  }

  function onTraceEnd(player) {
    setFinished((list) => (list.includes(player) ? list : [...list, player]));
    // 직접 입력한 문구가 섞여 있어도 당첨 칸에 도착하면 축하한다
    if (resultOf(player).trim() === WIN) {
      // 축하가 떠 있는 동안 다른 당첨자가 도착하면 이름을 더하고 색종이를 다시 뿌린다
      const name = names[player];
      setCelebration((prev) => ({ id: Date.now(), names: prev ? [...prev.names, name] : [name] }));
    }
  }

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>사다리 타기</h1>
        <p className="subtitle">
          {playing
            ? "위쪽 이름을 누르면 사다리를 타고 내려갑니다."
            : "이름을 입력하고 사다리를 만드세요. ⇅ 버튼으로 당첨/꽝을 바꾸고, 결과 칸에 원하는 문구를 직접 쓸 수도 있습니다."}
        </p>
      </header>

      <section className="card">
        <div className="toolbar">
          {playing ? (
            <>
              <button type="button" onClick={traceAll} disabled={traced.length === count}>모두 보기</button>
              <button type="button" className="secondary" onClick={newLadder}>다시 섞기</button>
              <button type="button" className="secondary" onClick={edit}>수정하기</button>
              <label className="toggle">
                <input type="checkbox" checked={hideRungs} onChange={(e) => setHideRungs(e.target.checked)} />
                가로줄 숨기기
              </label>
            </>
          ) : (
            <>
              <Stepper label="인원" value={count} unit="명" min={MIN_PLAYERS} max={MAX_PLAYERS} onChange={changeCount} />
              {hasWinLose && (
                <Stepper
                  label="당첨"
                  value={winners}
                  unit="개"
                  min={range.min}
                  max={range.max}
                  onChange={(k) => setResults((list) => withWinnerCount(list, clamp(k, range.min, range.max)))}
                />
              )}
              {customCount > 0 && (
                <div className="custom-note">
                  <span>직접 입력 {customCount}칸</span>
                  <button type="button" className="link" onClick={resetCustomResults}>
                    당첨/꽝으로 되돌리기
                  </button>
                </div>
              )}
              <button type="button" className="start" onClick={newLadder}>사다리 만들기</button>
            </>
          )}
        </div>

        <div className="ladder" style={{ "--count": count }}>
          <div className="cells">
            {names.map((name, i) => (playing ? (
              <button
                key={i}
                type="button"
                className="cell player"
                style={{ "--color": COLORS[i] }}
                onClick={() => trace(i)}
                disabled={traced.includes(i)}
                title={name}
              >
                {name}
              </button>
            ) : (
              <input
                key={i}
                className="cell"
                value={name}
                onChange={(e) => updateAt(setNames, i, e.target.value)}
                placeholder={defaultName(i)}
                aria-label={`${i + 1}번 참가자 이름`}
                maxLength={12}
              />
            )))}
          </div>

          <div className="board-wrap">
            <LadderBoard
              count={count}
              rungs={rungs}
              paths={paths}
              traced={playing ? traced : []}
              colors={COLORS}
              showRungs={playing && !hideRungs}
              onTraceEnd={onTraceEnd}
            />
            {!playing && <div className="board-hint">사다리 만들기를 누르면 가로줄이 생깁니다</div>}
            {playing && hideRungs && traced.length === 0 && (
              <div className="board-hint">가로줄이 숨겨져 있습니다. 이름을 눌러 보세요</div>
            )}
          </div>

          <div className="cells">
            {results.map((result, i) => (playing ? (
              <div
                key={i}
                className={[
                  "cell result",
                  result.trim() === WIN ? "win" : "",
                  arrivals[i] !== undefined ? "arrived" : "",
                ].join(" ")}
                style={arrivals[i] !== undefined ? { "--color": COLORS[arrivals[i]] } : undefined}
                title={result}
              >
                {result}
              </div>
            ) : (
              <input
                key={i}
                className={`cell${result.trim() === WIN ? " win" : ""}`}
                value={result}
                onChange={(e) => updateAt(setResults, i, e.target.value)}
                placeholder={LOSE}
                aria-label={`${i + 1}번 결과`}
                maxLength={12}
              />
            )))}
          </div>

          {!playing && (
            <div className="cells swaps">
              {results.map((result, i) => {
                const custom = !isWinLoseValue(result);
                const next = custom || result.trim() === WIN ? LOSE : WIN;
                return (
                  <button
                    key={i}
                    type="button"
                    className="swap"
                    onClick={() => toggleResult(i)}
                    title={custom ? "꽝으로 되돌리기" : "당첨/꽝 바꾸기"}
                    aria-label={`${i + 1}번 결과를 ${next}(으)로 바꾸기`}
                  >
                    {custom ? "↺" : "⇅"}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {finished.length > 0 && (
        <section className="card summary">
          <h2>{allFinished ? "결과" : `결과 (${finished.length}/${count})`}</h2>
          {hasWinLose && (
            <div className="win-lose">
              {[
                { key: "win", title: "🎉 당첨", value: WIN },
                { key: "lose", title: "꽝", value: LOSE },
              ].map((group) => {
                const members = sortedFinished.filter((p) => (resultOf(p).trim() || LOSE) === group.value);
                return (
                  <div key={group.key} className={`group ${group.key}`}>
                    <h3>{group.title} <span className="group-count">{members.length}명</span></h3>
                    {members.length ? (
                      <ul className="chips">
                        {members.map((p) => (
                          <li key={p} style={{ "--color": COLORS[p] }}>{names[p]}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="empty">아직 없습니다</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {customFinished.length > 0 && (
            <>
              {hasWinLose && <h3 className="custom-title">그 밖의 결과</h3>}
              <ul className="result-list">
                {customFinished.map((player) => (
                  <li key={player} style={{ "--color": COLORS[player] }}>
                    <span className="name">{names[player]}</span>
                    <span className="arrow">→</span>
                    <span className="value">{resultOf(player)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {celebration && (
        <Celebration key={celebration.id} names={celebration.names} onClose={() => setCelebration(null)} />
      )}
    </main>
  );
}
