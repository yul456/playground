import { HOLES, scoreClass, scoreName } from "./golf.js";

// 한 홀씩 넘기며 참가자별 타수를 +/−로 입력한다 (필드에서 한 손으로 쓰기 좋게 큰 버튼)
export default function HoleEntry({ round, setScore, setHole }) {
  const { hole, pars, players, scores } = round;
  const par = pars[hole];

  function change(player, delta) {
    const current = scores[player][hole];
    // 빈 칸에서 +를 누르면 파, −를 누르면 버디부터 시작한다
    const next = current == null ? (delta > 0 ? par : par - 1) : current + delta;
    setScore(player, hole, Math.max(1, next));
  }

  return (
    <section className="card hole-entry">
      <div className="hole-nav">
        <button type="button" className="secondary" onClick={() => setHole(hole - 1)} disabled={hole === 0} aria-label="이전 홀">◀</button>
        <div className="hole-title">
          <strong>{hole + 1}번 홀</strong>
          <span>파 {par}</span>
        </div>
        <button type="button" className="secondary" onClick={() => setHole(hole + 1)} disabled={hole === HOLES - 1} aria-label="다음 홀">▶</button>
      </div>

      <ul className="entry-list">
        {players.map((name, i) => {
          const score = scores[i][hole];
          const kind = scoreClass(score, par);
          return (
            <li key={i}>
              <span className="entry-name">{name}</span>
              <button type="button" className="secondary step" onClick={() => change(i, -1)} disabled={score === 1} aria-label={`${name} 타수 줄이기`}>−</button>
              <span className={`entry-score ${kind}`}>{score ?? "–"}</span>
              <button type="button" className="secondary step" onClick={() => change(i, 1)} aria-label={`${name} 타수 늘리기`}>+</button>
              <span className="entry-label">
                {score != null && (kind === "ace" || kind === "albatross" ? `${scoreName(score, par)} 🎉` : scoreName(score, par))}
                {score != null && (
                  <button type="button" className="link clear" onClick={() => setScore(i, hole, null)}>지우기</button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="hole-chips" role="tablist" aria-label="홀 선택">
        {pars.map((_, h) => {
          const done = scores.every((s) => s[h] != null);
          return (
            <button
              key={h}
              type="button"
              role="tab"
              aria-selected={h === hole}
              className={`chip${h === hole ? " current" : ""}${done ? " done" : ""}`}
              onClick={() => setHole(h)}
            >
              {h + 1}
            </button>
          );
        })}
      </div>
    </section>
  );
}
