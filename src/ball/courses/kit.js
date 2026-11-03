// 코스를 만들 때 함께 쓰는 크기와 도우미. 단위는 m(구슬 지름 0.76m)이고, y는 아래로 갈수록 커진다.
// 코스는 { key, name, goalY, segments, pins, bumpers, spinners } 모양의 데이터다 (basic.js 참고)

export const WIDTH = 16;
export const BALL_RADIUS = 0.38;
// 출발 전 구슬이 서 있는 선. 출발하면 그대로 떨어진다
export const GATE_Y = 0;
// 화면에 보여 줄 코스 위 끝(출발선 위)과 아래 끝(결승선 조금 아래)
export const TOP_Y = -4;
export const bottomOf = (course) => course.goalY + 2.5;

export const mirror = ([x, y]) => [WIDTH - x, y];
// 선분 하나와 좌우로 뒤집은 선분
export const both = (segment) => [segment, segment.map(mirror)];

// 양쪽 벽과 결승선 아래 바닥 (도착한 구슬은 바로 빠지므로 바닥은 만일을 위한 것)
export const frame = (goalY) => [
  [[0, TOP_Y - 8], [0, goalY + 4]],
  [[WIDTH, TOP_Y - 8], [WIDTH, goalY + 4]],
  [[0, goalY + 4], [WIDTH, goalY + 4]],
];

// 벽에서 안쪽 아래로 비스듬히 튀어나온 턱. 구슬이 벽을 타고 그대로 내려가지 않게 한다
const LEDGE_LENGTH = 1.2;
export const ledges = (ys) => ys.flatMap((y) => both([[0, y], [LEDGE_LENGTH, y + 0.8]]));
export const ledgeEnds = (ys) => ys.flatMap((y) => [[LEDGE_LENGTH, y + 0.8], mirror([LEDGE_LENGTH, y + 0.8])]);

// points에서 distance(m) 넘게 떨어진 자리인지. 턱 끝이나 범퍼 바로 옆에 핀을 두면 그 사이에
// 구슬이 빠져나갈 수 없는 홈이 생겨 자꾸 끼였다
export const awayFrom = (points, distance) => ([x, y]) => points.every(([px, py]) => Math.hypot(x - px, y - py) >= distance);
