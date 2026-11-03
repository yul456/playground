// 구슬 레이스 코스를 화면 없이 여러 판 돌려 본다. 코스(src/ball/courses/)나 물리 값을 고친 뒤 실행한다.
//   node scripts/ball-sim.mjs [코스 key, 없으면 모든 코스] [판 수 배율, 기본 1] [중력, 기본 GRAVITY]
// 보는 것: 한 판 길이(당첨이 정해질 때까지), 첫 도착, 끼여서 튕겨 준 횟수와 자리, 벽을 뚫고 나간 횟수,
// 출발 자리별 당첨 횟수(자리 쏠림). 이름은 자리를 무작위로 받으므로 이름 기준으로는 늘 공정하지만,
// 자리 쏠림이 크면 출발할 때 이미 결과가 거의 정해져 재미가 덜하다. 같은 판이 나오도록 난수는 고정한다
import { COURSES } from "../src/ball/courses/index.js";
import { createRace, GRAVITY } from "../src/ball/race.js";

const only = process.argv[2] && process.argv[2] !== "all" ? process.argv[2] : null;
const scale = Number(process.argv[3] ?? 1);
const gravity = Number(process.argv[4] ?? GRAVITY);
const courses = COURSES.filter((course) => !only || course.key === only);
if (!courses.length) throw new Error(`코스 "${only}"가 없습니다. 있는 코스: ${COURSES.map((c) => c.key).join(", ")}`);
const CASES = [
  { count: 4, mode: "last", runs: 200 },
  { count: 8, mode: "last", runs: 200 },
  { count: 8, mode: "first", runs: 160 },
  { count: 30, mode: "last", runs: 30 },
];

function seeded(seed) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const sec = (x) => `${x.toFixed(1)}초`;

for (const course of courses) for (const { count, mode, runs: baseRuns } of CASES) {
  const runs = Math.max(1, Math.round(baseRuns * scale));
  const random = seeded(count * 1000 + (mode === "first" ? 7 : 1));
  const durations = [];
  const firsts = [];
  const stuck = new Map();
  const wins = Array(count).fill(0);
  let escapes = 0;
  for (let run = 0; run < runs; run++) {
    // 자리별 쏠림을 보려고 i번 구슬을 i번 자리에 세운다
    const slots = Array.from({ length: count }, (_, i) => i);
    const race = createRace({ names: slots.map((i) => `구슬${i + 1}`), slots, course, mode, gravity, random });
    race.start();
    // 화면이 프레임마다 부르는 함수도 함께 불러 오류가 없는지 본다
    while (!race.winner) {
      race.step(1 / 60);
      race.isDeciding();
    }
    durations.push(race.time);
    firsts.push(race.order[0]?.finish.time ?? race.time);
    escapes += race.stats.escapes;
    wins[race.winner.id]++;
    for (const [x, y] of race.stats.stuckAt) {
      const key = `(${Math.round(x)}, ${Math.round(y)})`;
      stuck.set(key, (stuck.get(key) ?? 0) + 1);
    }
  }
  const expected = runs / count;
  const chi2 = wins.reduce((sum, w) => sum + (w - expected) ** 2 / expected, 0);
  const nudges = [...stuck.values()].reduce((a, b) => a + b, 0);
  const spots = [...stuck].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${v}번`).join(", ");
  console.log(`[${course.name}] ${mode === "last" ? "마지막까지 남은 구슬" : "가장 먼저 도착한 구슬"}, ${count}개, ${runs}판, 중력 ${gravity}`);
  console.log(`  한 판 길이: 중간 ${sec(median(durations))}, 가장 길게 ${sec(Math.max(...durations))} / 첫 도착 중간 ${sec(median(firsts))}`);
  console.log(`  끼임: 판마다 ${(nudges / runs).toFixed(2)}번${spots ? ` (많은 자리 ${spots})` : ""} / 벽 뚫음 ${escapes}번`);
  console.log(`  자리별 당첨: ${wins.join(" ")} (고르면 ${expected.toFixed(0)}씩, 카이제곱 ${chi2.toFixed(1)} / 자유도 ${count - 1})`);
}
