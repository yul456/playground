import { useState } from "react";
import { awardsBet, settleTransfers, skinsBet, strokeBet } from "./bets.js";
import { HOLES, completedHoles, formatSignedWon, formatWon } from "./golf.js";

const AWARD_TYPES = ["니어리스트", "롱기스트", "기타"];

function AwardForm({ players, onAdd }) {
  const [type, setType] = useState(AWARD_TYPES[0]);
  const [hole, setHole] = useState(0);
  const [winner, setWinner] = useState(0);
  const [amount, setAmount] = useState(10000);

  return (
    <form
      className="award-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (amount > 0) onAdd({ type, hole, winner, amount });
      }}
    >
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="상 종류">
        {AWARD_TYPES.map((t) => <option key={t}>{t}</option>)}
      </select>
      <select value={hole} onChange={(e) => setHole(Number(e.target.value))} aria-label="홀">
        {Array.from({ length: HOLES }, (_, h) => <option key={h} value={h}>{h + 1}번 홀</option>)}
      </select>
      <select value={winner} onChange={(e) => setWinner(Number(e.target.value))} aria-label="받는 사람">
        {players.map((name, i) => <option key={i} value={i}>{name}</option>)}
      </select>
      <input
        type="number"
        inputMode="numeric"
        min="0"
        step="1000"
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        aria-label="1인당 금액"
      />
      <button type="submit">추가</button>
    </form>
  );
}

export default function Settlement({ round, update }) {
  const { players, scores, bets, awards } = round;
  const n = players.length;

  if (n < 2) {
    return (
      <section className="card">
        <h2>정산</h2>
        <p className="muted">내기 정산은 2명 이상일 때 할 수 있습니다. 설정에서 인원을 늘려 주세요.</p>
      </section>
    );
  }

  const holes = completedHoles(scores);
  const stroke = bets.strokeRate > 0 ? strokeBet(scores, holes, bets.strokeRate) : Array(n).fill(0);
  const skins = bets.skinAmount > 0 ? skinsBet(scores, holes, bets.skinAmount) : null;
  const award = awardsBet(n, awards);
  const net = players.map((_, i) => stroke[i] + (skins?.net[i] ?? 0) + award[i]);
  const transfers = settleTransfers(net);

  return (
    <>
      <section className="card">
        <h2>정산</h2>
        <p className="muted">
          모두가 타수를 적은 홀만 계산합니다 ({holes.length}/{HOLES}홀).
          {skins?.carry > 0 && ` 스킨 ${skins.carry}개가 다음 홀로 이월 중입니다.`}
        </p>

        <div className="table-scroll">
          <table className="settle-table">
            <thead>
              <tr>
                <th scope="col">이름</th>
                {bets.strokeRate > 0 && <th scope="col">타당</th>}
                {skins && <th scope="col">스킨스</th>}
                {awards.length > 0 && <th scope="col">특별상</th>}
                <th scope="col">합계</th>
              </tr>
            </thead>
            <tbody>
              {players.map((name, i) => (
                <tr key={i}>
                  <th scope="row">{name}</th>
                  {bets.strokeRate > 0 && <td>{formatSignedWon(stroke[i])}</td>}
                  {skins && <td>{formatSignedWon(skins.net[i])} <span className="muted">({skins.won[i]}개)</span></td>}
                  {awards.length > 0 && <td>{formatSignedWon(award[i])}</td>}
                  <td className={`net ${net[i] > 0 ? "plus" : net[i] < 0 ? "minus" : ""}`}>{formatSignedWon(net[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3>보낼 돈</h3>
        {transfers.length ? (
          <ul className="transfers">
            {transfers.map((t, i) => (
              <li key={i}>
                <span>{players[t.from]}</span>
                <span className="arrow">→</span>
                <span>{players[t.to]}</span>
                <strong>{formatWon(t.amount)}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">주고받을 돈이 없습니다.</p>
        )}
      </section>

      <section className="card">
        <h2>특별상</h2>
        <p className="muted">받는 사람이 나머지 사람에게서 각자 금액을 받습니다.</p>
        <AwardForm players={players} onAdd={(a) => update((r) => ({ awards: [...r.awards, a] }))} />
        {awards.length > 0 && (
          <ul className="award-list">
            {awards.map((a, i) => (
              <li key={i}>
                <span>{a.hole + 1}번 홀 {a.type}</span>
                <span>{players[a.winner]}</span>
                <span>1인당 {formatWon(a.amount)}</span>
                <button
                  type="button"
                  className="link"
                  onClick={() => update((r) => ({ awards: r.awards.filter((_, j) => j !== i) }))}
                >
                  삭제
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
