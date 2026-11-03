import { awayFrom, both, frame, ledgeEnds, ledges, WIDTH } from "./kit.js";

// 기본 코스: 깔때기 → 핀 숲 → 바람개비 → 지그재그 비탈 → 범퍼 → 마지막 깔때기 → 결승선
const GOAL_Y = 92;
const PIN_FIELD_LEDGES = [14, 20, 26];

// 핀 숲: 엇갈린 줄마다 1.7m 간격. 턱 끝 바로 옆의 핀은 뺀다
const pinField = [];
for (let row = 0; row < 12; row++) {
  const y = 11 + row * 1.55;
  const offset = row % 2 ? 2.05 : 1.2;
  for (let x = offset; x < WIDTH - 1; x += 1.7) {
    if (awayFrom(ledgeEnds(PIN_FIELD_LEDGES), 1.3)([x, y])) pinField.push([x, y, 0.14]);
  }
}

export default {
  key: "basic",
  name: "기본",
  goalY: GOAL_Y,
  // 선분 벽: [[x1, y1], [x2, y2]]
  segments: [
    ...frame(GOAL_Y),
    // 첫 깔때기: 가운데 틈(3.6m)으로 모은다
    ...both([[0, 2], [6.2, 8]]),
    ...ledges(PIN_FIELD_LEDGES),
    ...ledges([36.5]),
    // 지그재그 비탈: 오른쪽 → 왼쪽 → 오른쪽으로 내려가고, 끝마다 반대쪽 틈으로 떨어진다
    [[0, 44], [13.4, 47.6]],
    [[WIDTH, 51], [2.6, 54.6]],
    [[0, 58], [13.4, 61.6]],
    // 오른쪽 틈으로 떨어진 구슬을 범퍼 쪽 가운데로 보낸다
    [[WIDTH, 65], [10.5, 67]],
    ...ledges([71.5, 79]),
    // 마지막 깔때기: 틈(2.2m)이 좁아 구슬이 한두 개씩 빠져나간다
    ...both([[0, 83], [6.9, 89.7]]),
  ],
  // 핀: [x, y, 반지름]
  pins: [
    // 첫 깔때기 아래에서 흐름을 좌우로 가른다
    [8, 9.6, 0.45],
    ...pinField,
    [8, 68.7, 0.2],
    [2, 74, 0.2],
    [14, 74, 0.2],
    [8, 80.7, 0.2],
  ],
  // 범퍼: 닿으면 세게 튕겨 낸다. [x, y, 반지름]
  bumpers: [
    [5, 70, 0.85],
    [11, 70, 0.85],
    [8, 74, 0.95],
    [4, 78, 0.85],
    [12, 78, 0.85],
  ],
  // 바람개비: 가운데를 축으로 도는 막대. half는 막대 반 길이(m), speed는 초당 회전(라디안, +가 시계 방향),
  // arms는 막대 수(2면 십자, 없으면 1)
  spinners: [
    { x: 4.2, y: 33.5, half: 2.4, speed: 1.8 },
    { x: 11.8, y: 33.5, half: 2.4, speed: -1.8 },
    { x: 8, y: 40, half: 2.6, speed: 2.2 },
  ],
};
