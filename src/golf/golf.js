export const HOLES = 18;
export const MIN_PLAYERS = 1;
export const MAX_PLAYERS = 4;
// 흔한 파 72 구성 (전반 36, 후반 36). 설정에서 홀마다 바꿀 수 있다
export const DEFAULT_PARS = [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 5, 4];
export const FRONT = [...Array(9).keys()];
export const BACK = FRONT.map((h) => h + 9);

export const SCORE_LABELS = {
  ace: "홀인원",
  albatross: "알바트로스",
  eagle: "이글",
  birdie: "버디",
  par: "파",
  bogey: "보기",
  double: "더블 이상",
};

// 파 대비 타수로 버디·보기 등을 구분한다
export function scoreClass(score, par) {
  if (score == null) return "";
  // 한 번에 넣으면 파와 상관없이 홀인원으로 따로 표시한다 (파 3이면 이글과 타수가 같다)
  if (score === 1) return "ace";
  const diff = score - par;
  if (diff <= -3) return "albatross";
  if (diff === -2) return "eagle";
  if (diff === -1) return "birdie";
  if (diff === 0) return "par";
  if (diff === 1) return "bogey";
  return "double";
}

// 타수 하나의 이름 (스코어 선택 목록에 쓴다)
export function scoreName(score, par) {
  if (score === 1) return "홀인원";
  const diff = score - par;
  const names = { [-3]: "알바트로스", [-2]: "이글", [-1]: "버디", 0: "파", 1: "보기", 2: "더블 보기", 3: "트리플 보기" };
  return names[diff] ?? (diff > 0 ? `+${diff}` : `${diff}`);
}

// 친 홀만 더한 타수와 파 대비 타수
export function playerTotals(scores, pars, holes = [...Array(HOLES).keys()]) {
  let strokes = 0;
  let toPar = 0;
  let played = 0;
  for (const h of holes) {
    if (scores[h] == null) continue;
    strokes += scores[h];
    toPar += scores[h] - pars[h];
    played += 1;
  }
  return { strokes, toPar, played };
}

// 모든 참가자가 타수를 적은 홀 (내기는 이 홀들만 계산한다)
export function completedHoles(scores) {
  return [...Array(HOLES).keys()].filter((h) => scores.every((s) => s[h] != null));
}

export const formatToPar = (n) => (n === 0 ? "E" : n > 0 ? `+${n}` : `${n}`);
export const formatWon = (n) => `${n.toLocaleString("ko-KR")}원`;
export const formatSignedWon = (n) => (n > 0 ? `+${formatWon(n)}` : n < 0 ? `−${formatWon(-n)}` : "0원");
