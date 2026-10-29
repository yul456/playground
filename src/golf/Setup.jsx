import { DEFAULT_PARS, MAX_PLAYERS, MIN_PLAYERS, formatWon } from "./golf.js";

export default function Setup({ round, update, setPlayerCount, newRound }) {
  const { players, pars, bets } = round;
  const totalPar = pars.reduce((a, b) => a + b, 0);

  function setBet(key, value) {
    update((r) => ({ bets: { ...r.bets, [key]: Math.max(0, Number(value) || 0) } }));
  }

  return (
    <>
      <section className="card">
        <h2>참가자</h2>
        <div className="stepper">
          <span className="stepper-label">인원</span>
          <button type="button" className="secondary" onClick={() => setPlayerCount(players.length - 1)} disabled={players.length <= MIN_PLAYERS}>−</button>
          <span className="stepper-value">{players.length}명</span>
          <button type="button" className="secondary" onClick={() => setPlayerCount(players.length + 1)} disabled={players.length >= MAX_PLAYERS}>+</button>
        </div>
        <div className="name-inputs">
          {players.map((name, i) => (
            <input
              key={i}
              value={name}
              maxLength={10}
              aria-label={`${i + 1}번 참가자 이름`}
              onChange={(e) => update((r) => ({ players: r.players.map((p, j) => (j === i ? e.target.value : p)) }))}
            />
          ))}
        </div>
      </section>

      <section className="card">
        <h2>내기</h2>
        <label className="field">
          <span>타당 금액 <small>1타 차이마다</small></span>
          <input type="number" inputMode="numeric" min="0" step="500" value={bets.strokeRate} onChange={(e) => setBet("strokeRate", e.target.value)} />
        </label>
        <label className="field">
          <span>스킨 금액 <small>스킨 1개마다 1인당, 0이면 안 함</small></span>
          <input type="number" inputMode="numeric" min="0" step="1000" value={bets.skinAmount} onChange={(e) => setBet("skinAmount", e.target.value)} />
        </label>
        <p className="muted">
          타당 {bets.strokeRate ? formatWon(bets.strokeRate) : "안 함"} · 스킨스 {bets.skinAmount ? formatWon(bets.skinAmount) : "안 함"}.
          니어리스트·롱기스트는 정산 탭에서 홀마다 추가합니다.
        </p>
      </section>

      <section className="card">
        <h2>코스 <small className="muted">파 {totalPar}</small></h2>
        <div className="par-grid">
          {pars.map((par, h) => (
            <label key={h} className="par-cell">
              <span>{h + 1}</span>
              <select
                value={par}
                onChange={(e) => update((r) => ({ pars: r.pars.map((p, j) => (j === h ? Number(e.target.value) : p)) }))}
              >
                {[3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          ))}
        </div>
        <button type="button" className="link" onClick={() => update({ pars: DEFAULT_PARS })}>기본 파 72로 되돌리기</button>
      </section>

      <section className="card">
        <h2>새 라운드</h2>
        <p className="muted">참가자·코스·내기 설정은 그대로 두고 타수와 특별상만 지웁니다.</p>
        <button
          type="button"
          className="danger"
          onClick={() => {
            if (window.confirm("지금까지 입력한 타수와 특별상을 모두 지울까요?")) newRound();
          }}
        >
          새 라운드 시작
        </button>
      </section>
    </>
  );
}
