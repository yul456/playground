import { awayFrom, both, frame, ledgeEnds, ledges, WIDTH } from "./kit.js";

// 짧은 코스: 기본 코스의 40% 길이라 한 판이 금방 끝난다. 화면이나 기능을 고친 뒤 시험해 볼 때 쓴다.
// 깔때기 → 핀 숲 → 바람개비 → 범퍼 → 마지막 깔때기 → 결승선. 시험할 때 빠지는 것이 없도록 핀·턱·바람개비·범퍼를 다 넣었다
const GOAL_Y = 37;
const PIN_FIELD_LEDGES = [13.5];

// 핀 숲: 기본 코스와 같은 간격으로 다섯 줄만
const pinField = [];
for (let row = 0; row < 5; row++) {
  const y = 11 + row * 1.55;
  const offset = row % 2 ? 2.05 : 1.2;
  for (let x = offset; x < WIDTH - 1; x += 1.7) {
    if (awayFrom(ledgeEnds(PIN_FIELD_LEDGES), 1.3)([x, y])) pinField.push([x, y, 0.14]);
  }
}

export default {
  key: "short",
  name: "짧은 코스",
  goalY: GOAL_Y,
  segments: [
    ...frame(GOAL_Y),
    // 첫 깔때기 (틈 3.6m)
    ...both([[0, 2], [6.2, 8]]),
    ...ledges(PIN_FIELD_LEDGES),
    ...ledges([25]),
    // 마지막 깔때기 (틈 2.2m)
    ...both([[0, 28], [6.9, 34.7]]),
  ],
  pins: [
    // 첫 깔때기 아래에서 흐름을 좌우로 가른다
    [8, 9.6, 0.45],
    ...pinField,
  ],
  bumpers: [
    [5, 27, 0.8],
    [11, 27, 0.8],
    [8, 30.5, 0.8],
  ],
  spinners: [
    { x: 4.2, y: 21.5, half: 2.4, speed: 1.8 },
    { x: 11.8, y: 21.5, half: 2.4, speed: -1.8 },
  ],
};
