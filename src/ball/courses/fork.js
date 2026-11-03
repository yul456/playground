import { awayFrom, both, frame, ledgeEnds, ledges, WIDTH } from "./kit.js";

// 갈림길 코스: 깔때기 → 회전문(십자 바람개비) → 가르개 → 왼쪽 계단·오른쪽 핀 숲 갈림길 → 바람개비 밭 → 범퍼 삼각형
// → 지그재그 → 마지막 깔때기. 회전문이 구슬을 몇 개씩 퍼 나르며 순서를 섞고, 빠르게 도는 가르개가 구슬마다
// 왼쪽·오른쪽 갈래를 무작위로 정한다. 회전문만 두면 도는 방향 쪽 갈래로 거의 다 몰렸다
const GOAL_Y = 92;
const MID = WIDTH / 2;
const SPINNER_LEDGES = [45.5, 50.5];
const BUMPER_LEDGES = [62, 68];
const LANE_BUMPER = [12, 26, 0.7];

// 오른쪽 갈래의 핀 숲. 가운데 벽과 오른쪽 벽에서 1m 넘게 떼어 구슬이 벽과 핀 사이에 끼지 않게 한다
const laneBumperAway = awayFrom([LANE_BUMPER], 1.5);
const lanePins = [];
for (let row = 0; row < 12; row++) {
  const y = 17.6 + row * 1.6;
  for (let x = row % 2 ? 10 : 9.2; x < WIDTH - 1.1; x += 1.6) {
    if (laneBumperAway([x, y])) lanePins.push([x, y, 0.14]);
  }
}

const ledgeAway = awayFrom(ledgeEnds([...SPINNER_LEDGES, ...BUMPER_LEDGES]), 1.3);

export default {
  key: "fork",
  name: "갈림길",
  goalY: GOAL_Y,
  segments: [
    ...frame(GOAL_Y),
    // 첫 깔때기: 회전문 위로 모은다 (틈 4.4m)
    ...both([[0, 2.5], [5.8, 7.5]]),
    // 갈림길: 지붕 모양 꼭대기와 가운데 벽. 왼쪽은 계단, 오른쪽은 핀 숲
    [[MID - 0.6, 16.2], [MID, 15]],
    [[MID, 15], [MID + 0.6, 16.2]],
    [[MID, 15], [MID, 38]],
    // 왼쪽 갈래 계단: 가운데 벽과 왼쪽 벽 사이를 지그재그로 내려간다.
    // 기울기는 오른쪽 핀 숲과 걸리는 시간(약 4초)이 비슷해지도록 맞췄다. 한쪽이 빠르면 그쪽으로 가기 쉬운 출발 자리가 유리해진다
    [[0, 16], [6.2, 19.2]],
    [[MID, 21], [1.8, 24.2]],
    [[0, 26], [6.2, 29.2]],
    [[MID, 31], [1.8, 34.2]],
    ...ledges(SPINNER_LEDGES),
    ...ledges(BUMPER_LEDGES),
    // 지그재그 미끄럼틀: 오른쪽 → 왼쪽
    [[0, 74], [11, 77]],
    [[WIDTH, 79.5], [5, 82.5]],
    // 마지막 깔때기 (틈 2.2m)
    ...both([[0, 84], [6.9, 89.5]]),
  ],
  pins: [
    ...lanePins,
    ...[[2.6, 59.5], [13.4, 59.5], [8, 66]].filter(ledgeAway).map(([x, y]) => [x, y, 0.2]),
  ],
  bumpers: [
    LANE_BUMPER,
    // 범퍼 삼각형
    [8, 60, 0.9],
    [4.5, 65, 0.85],
    [11.5, 65, 0.85],
    [8, 70.5, 0.8],
  ],
  spinners: [
    // 흔들 회전문: 깔때기 바로 아래에서 좌우로 흔들리며 구슬을 몇 개씩 왼쪽·오른쪽 갈래로 번갈아 퍼 나른다
    { x: MID, y: 9.5, half: 2, arms: 2, swing: 1.2, period: 2.4 },
    // 바람개비 밭
    { x: 4, y: 42, half: 2.2, speed: 2 },
    { x: 12, y: 42, half: 2.2, speed: -2 },
    { x: MID, y: 47.5, half: 2.4, speed: 2.4, arms: 2 },
    { x: 3.5, y: 53, half: 1.8, speed: -1.6 },
    { x: 12.5, y: 53, half: 1.8, speed: 1.6 },
  ],
};
