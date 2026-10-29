import { useState } from "react";
import { BACK, FRONT, SCORE_LABELS, formatToPar, playerTotals, scoreClass } from "./golf.js";
import ScorePicker from "./ScorePicker.jsx";

const sumPars = (pars, holes) => holes.reduce((t, h) => t + pars[h], 0);

// 전반·후반 9홀씩 표로 보여준다. 홀 번호를 누르면 그 홀로 이동하고, 타수 칸을 누르면 타수를 고친다
function NineTable({ title, holes, round, onPickHole, onEditCell }) {
  const { pars, players, scores, hole: currentHole } = round;
  return (
    <div className="table-scroll">
      <table className="scorecard">
        <thead>
          <tr>
            <th scope="col">{title}</th>
            {holes.map((h) => (
              <th key={h} scope="col" className={h === currentHole ? "current" : ""}>
                <button type="button" className="hole-link" onClick={() => onPickHole(h)}>{h + 1}</button>
              </th>
            ))}
            <th scope="col">합</th>
          </tr>
          <tr className="par-row">
            <th scope="row">파</th>
            {holes.map((h) => <td key={h}>{pars[h]}</td>)}
            <td>{sumPars(pars, holes)}</td>
          </tr>
        </thead>
        <tbody>
          {players.map((name, i) => {
            const totals = playerTotals(scores[i], pars, holes);
            return (
              <tr key={i}>
                <th scope="row" className="player-name">{name}</th>
                {holes.map((h) => (
                  <td key={h}>
                    <button
                      type="button"
                      className="cell-button"
                      onClick={() => onEditCell(i, h)}
                      aria-label={`${name} ${h + 1}번 홀 ${scores[i][h] ?? "빈칸"}, 고치기`}
                    >
                      <span className={`mark ${scoreClass(scores[i][h], pars[h])}`}>{scores[i][h] ?? ""}</span>
                    </button>
                  </td>
                ))}
                <td className="sum">{totals.played ? totals.strokes : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function Scorecard({ round, onPickHole, setScore }) {
  const { pars, players, scores } = round;
  // 고치는 중인 칸 { player, hole }
  const [editing, setEditing] = useState(null);
  const onEditCell = (player, hole) => setEditing({ player, hole });
  return (
    <section className="card">
      <h2>스코어카드</h2>
      <NineTable title="전반" holes={FRONT} round={round} onPickHole={onPickHole} onEditCell={onEditCell} />
      <NineTable title="후반" holes={BACK} round={round} onPickHole={onPickHole} onEditCell={onEditCell} />
      <p className="muted hint">타수 칸을 누르면 바로 고칠 수 있습니다.</p>

      <ul className="totals">
        {players.map((name, i) => {
          const t = playerTotals(scores[i], pars);
          return (
            <li key={i}>
              <span className="player-name">{name}</span>
              <span className="total-strokes">{t.played ? `${t.strokes}타` : "–"}</span>
              <span className="total-topar">{t.played ? formatToPar(t.toPar) : ""}</span>
              <span className="total-played">{t.played}/18홀</span>
            </li>
          );
        })}
      </ul>

      <ul className="legend" aria-label="표시 설명">
        {Object.entries(SCORE_LABELS).map(([kind, label]) => (
          <li key={kind}><span className={`mark ${kind}`}>{" "}</span>{label}</li>
        ))}
      </ul>

      {editing && (
        <ScorePicker
          name={players[editing.player]}
          hole={editing.hole}
          par={pars[editing.hole]}
          score={scores[editing.player][editing.hole]}
          onPick={(value) => {
            setScore(editing.player, editing.hole, value);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
