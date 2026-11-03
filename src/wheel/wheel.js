// 돌림판 계산: 뽑힌 칸에서 바늘이 멈추는 회전 각도, 칸 색·글자.
// 어느 칸을 뽑을지는 회전 애니메이션이 아니라 src/shared/random.js의 randomIndex로 먼저 정한다.
// 바늘은 맨 위(12시)에 고정되어 있고, 칸은 12시부터 시계 방향으로 놓는다

export const MIN_ITEMS = 2;
export const MAX_ITEMS = 30;

const mod360 = (deg) => ((deg % 360) + 360) % 360;

// 돌림판이 시계 방향으로 rotation도 돌아가 있을 때 바늘이 가리키는 칸
export function indexAt(rotation, count) {
  return Math.floor(mod360(-rotation) / (360 / count)) % count;
}

// 지금 각도에서 turns바퀴 넘게 더 돌아 winner 칸에 멈추는 최종 각도.
// 칸 경계에 멈추면 어느 칸인지 헷갈리므로 칸 안쪽 15%~85% 사이 아무 곳에 멈춘다
export function spinTarget(rotation, count, winner, { turns = 4, random = Math.random } = {}) {
  const slice = 360 / count;
  const at = winner * slice + slice * (0.15 + 0.7 * random());
  return rotation + turns * 360 + mod360(-at - rotation);
}

// 실제 돌림판처럼 처음 accel(전체 시간 중 비율) 동안 빨라졌다가, 남은 시간 동안 점점 느려져 멈춘다.
// 진행 시간 t(0~1)에 전체 회전의 몇 %를 돌았는지(0~1)를 돌려준다.
// 속도: 빨라질 때 v = 1 - (1 - t/accel)², 느려질 때 v = (1 - u)^power (u: 느려지는 구간의 진행률).
// power가 클수록 끝에서 천천히 기어가듯 멈춘다
export function spinProgress(t, accel = 0.13, power = 2) {
  const accelDistance = (2 / 3) * accel;
  const total = accelDistance + (1 - accel) / (power + 1);
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  if (t < accel) return (t - (accel / 3) * (1 - (1 - t / accel) ** 3)) / total;
  const u = (t - accel) / (1 - accel);
  return (accelDistance + ((1 - accel) * (1 - (1 - u) ** (power + 1))) / (power + 1)) / total;
}

// 이웃한 칸이 잘 구분되도록 따뜻한 색과 차가운 색을 번갈아 둔다. 흰 글씨가 잘 보이는 진한 색들
const COLORS = ["#e11d48", "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#db2777", "#65a30d", "#4f46e5", "#a16207", "#0d9488", "#475569"];

// 마지막 칸이 첫 칸과 같은 색이 되면 둘이 붙어 한 칸처럼 보이므로 다른 색을 쓴다
export function sliceColor(i, count) {
  if (count > 1 && i === count - 1 && i % COLORS.length === 0) return COLORS[COLORS.length / 2];
  return COLORS[i % COLORS.length];
}

// 칸 수에 따른 글자 크기 (돌림판 반지름 100 기준)
export const labelSize = (count) => (count <= 6 ? 12 : count <= 10 ? 10.5 : count <= 16 ? 8.5 : 7);

// 한글·이모지는 한 글자, 영문·숫자는 0.6글자 너비로 센다
const charWidth = (ch) => (ch.codePointAt(0) > 0x2e80 ? 1 : 0.6);

// 칸에 들어갈 만큼만 남기고 뒤를 "…"로 줄인다 (maxWidth: 한글 글자 수 기준)
export function fitLabel(label, maxWidth) {
  const chars = [...label];
  if (chars.reduce((w, ch) => w + charWidth(ch), 0) <= maxWidth) return label;
  let width = 0.7;
  let out = "";
  for (const ch of chars) {
    if (width + charWidth(ch) > maxWidth) break;
    width += charWidth(ch);
    out += ch;
  }
  return `${out}…`;
}
