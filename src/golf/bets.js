// 내기 정산. 모든 함수는 참가자 순서대로 손익(받으면 +, 내면 −)을 돌려준다

// 타당: 모두가 친 홀의 타수 합 차이 × 1타당 금액을 서로 주고받는다
export function strokeBet(scores, holes, rate) {
  const totals = scores.map((s) => holes.reduce((t, h) => t + s[h], 0));
  return totals.map((mine) => totals.reduce((net, other) => net + (other - mine) * rate, 0));
}

// 스킨스: 홀마다 단독 최저타가 스킨을 가져가고, 비기면 다음 홀로 이월된다.
// 스킨 하나마다 나머지 사람이 각자 금액을 낸다
export function skinsBet(scores, holes, amount) {
  const n = scores.length;
  const net = Array(n).fill(0);
  const won = Array(n).fill(0);
  let carry = 0;
  for (const h of holes) {
    carry += 1;
    const best = Math.min(...scores.map((s) => s[h]));
    const leaders = scores.flatMap((s, i) => (s[h] === best ? [i] : []));
    if (leaders.length !== 1) continue;
    const winner = leaders[0];
    won[winner] += carry;
    for (let i = 0; i < n; i++) net[i] += i === winner ? carry * amount * (n - 1) : -carry * amount;
    carry = 0;
  }
  return { net, won, carry };
}

// 니어리스트·롱기스트 같은 특별상: 수상자가 나머지 사람에게서 각자 금액을 받는다
export function awardsBet(count, awards) {
  const net = Array(count).fill(0);
  for (const award of awards) {
    if (award.winner >= count) continue;
    for (let i = 0; i < count; i++) net[i] += i === award.winner ? award.amount * (count - 1) : -award.amount;
  }
  return net;
}

// 최종 손익을 가장 적은 송금 횟수에 가깝게 "누가 누구에게 얼마"로 바꾼다
export function settleTransfers(net) {
  const debtors = net.flatMap((v, i) => (v < 0 ? [{ i, amount: -v }] : [])).sort((a, b) => b.amount - a.amount);
  const creditors = net.flatMap((v, i) => (v > 0 ? [{ i, amount: v }] : [])).sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(debtors[d].amount, creditors[c].amount);
    transfers.push({ from: debtors[d].i, to: creditors[c].i, amount });
    debtors[d].amount -= amount;
    creditors[c].amount -= amount;
    if (debtors[d].amount === 0) d++;
    if (creditors[c].amount === 0) c++;
  }
  return transfers;
}
