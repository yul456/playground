// 골프장 3D 보기에 쓸 데이터(홀 선, 그린·티·페어웨이·벙커·물)를 OpenStreetMap(Overpass)에서 받아
// src/golf/courses3d/<골프장 key>.json으로 저장한다. golfCourses.js를 새로 받은 뒤에 손으로 실행한다 (몇 분).
//   node scripts/golf-3d.mjs              모든 골프장을 새로 받는다
//   node scripts/golf-3d.mjs 킹즈락CC     이름을 준 골프장만 다시 받는다 (다른 파일은 그대로 둔다)
// 홀 선이나 그린이 그려진 골프장만 파일을 만든다(PRIORITY 골프장은 테두리만 있어도 만든다). 화면은 이 파일이 있는
// 골프장에서만 홀·면·테두리를 그린다.
// 공개 Overpass 서버는 자주 꽉 차서(502·504) 기다렸다가 다시 묻는다
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { courseFromOsm, courseKey, distance } from "../src/golf/course3d.js";
import { GOLF_COURSES } from "../src/golf/golfCourses.js";

const ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
const USER_AGENT = "playground-golf-courses/1.0 (https://yul456.github.io/playground/)";
const OUT_DIR = resolve(import.meta.dirname, "../src/golf/courses3d");
// 골프장 목록 위치에서 이 거리(m) 안을 받는다. 27·36홀 골프장도 들어오게 넉넉히
const RADIUS = 1800;
// 홀 선이 없어도 그린이 이만큼 그려져 있으면 받는다
const MIN_GREENS = 3;
// 사용자가 가장 먼저 챙기는 골프장. 맨 먼저 받고, 홀·그린이 없어도 테두리가 있으면 파일을 만든다
const PRIORITY = ["킹즈락CC"];
const ONLY = process.argv.slice(2);
const sleep = (seconds) => new Promise((r) => setTimeout(r, seconds * 1000));
// 마지막으로 답한 서버부터 묻는다. 꽉 찬 서버에 매번 먼저 물어 기다리는 시간을 줄인다
let preferred = 0;

async function overpass(query) {
  let wait = 10;
  for (let attempt = 0; attempt < 10; attempt++) {
    const index = (preferred + attempt) % ENDPOINTS.length;
    const url = ENDPOINTS[index];
    const host = new URL(url).host;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": USER_AGENT },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(120_000),
      });
      if (res.ok) {
        preferred = index;
        return (await res.json()).elements;
      }
      console.warn(`  ${host}: HTTP ${res.status}. ${wait}초 뒤 다시 묻습니다`);
    } catch (err) {
      console.warn(`  ${host}: ${err.name}. ${wait}초 뒤 다시 묻습니다`);
    }
    await sleep(wait);
    wait = Math.min(wait * 2, 240);
  }
  throw new Error("Overpass 서버가 계속 응답하지 않습니다. 나중에 다시 실행해 주세요.");
}

const byName = (name) => {
  const row = GOLF_COURSES.find(([n]) => n === name);
  if (!row) throw new Error(`골프장 목록에 "${name}"이 없습니다`);
  const [, lat, lon, region] = row;
  return { course: { name, lat, lon, region } };
};

// 1) 홀 선과 그린이 어느 골프장에 있는지 센다 (가운데 점만 받아 가볍게). 이름을 줬으면 그 골프장만
const marks = ONLY.length ? [] : await overpass(
  '[out:json][timeout:120];area["ISO3166-1"="KR"][admin_level=2]->.kr;way["golf"~"^(hole|green)$"](area.kr);out center tags;',
);
const found = new Map();
for (const e of marks) {
  const point = [e.center.lon, e.center.lat];
  let best = null;
  for (const [name, lat, lon, region] of GOLF_COURSES) {
    const d = distance(point, [lon, lat]);
    if (d < 2500 && (!best || d < best.d)) best = { d, course: { name, lat, lon, region } };
  }
  if (!best) continue;
  const key = courseKey(best.course);
  const entry = found.get(key) ?? { course: best.course, holes: 0, greens: 0 };
  entry[e.tags.golf === "hole" ? "holes" : "greens"]++;
  found.set(key, entry);
}
const priority = PRIORITY.map(byName);
const targets = ONLY.length
  ? ONLY.map(byName)
  : [...priority, ...[...found.values()].filter((t) => (t.holes > 0 || t.greens >= MIN_GREENS) && !PRIORITY.includes(t.course.name))];
console.log(`골프장 ${targets.length}곳을 받습니다`);

// 2) 골프장마다 테두리와 골프 시설을 자세히 받아 정리한다
mkdirSync(OUT_DIR, { recursive: true });
const written = new Set();
const today = new Date().toISOString().slice(0, 10);
for (const [i, { course }] of targets.entries()) {
  const { name, region, lat, lon } = course;
  const around = `(around:${RADIUS},${lat},${lon})`;
  const elements = await overpass(
    `[out:json][timeout:90];(way["leisure"="golf_course"]${around};relation["leisure"="golf_course"]${around};);out geom;` +
      `(way["golf"~"^(hole|tee|green|fairway|bunker|water_hazard|lateral_water_hazard)$"]${around};way["natural"="water"]${around};);out geom;`,
  );
  const data = courseFromOsm(elements, [lon, lat], { name });
  const label = `(${i + 1}/${targets.length}) ${name}`;
  const keepOutline = PRIORITY.includes(name) && data.outline.length > 0;
  if (!data.holes.length && data.areas.green.length < MIN_GREENS && !keepOutline) {
    console.log(`${label}: 골프장 테두리 안에 홀·그린이 없어 건너뜁니다`);
  } else {
    const file = `${courseKey(course)}.json`;
    writeFileSync(resolve(OUT_DIR, file), `${JSON.stringify({ name, region, source: "© OpenStreetMap 기여자, ODbL", updated: today, ...data })}\n`);
    written.add(file);
    console.log(`${label}: 홀 ${data.holes.length}, 그린 ${data.areas.green.length}`);
  }
  await sleep(2);
}

// 3) 모두 받았을 때만, 이번에 만들지 않은 예전 파일(목록에서 빠지거나 데이터가 지워진 골프장)을 지운다
if (!ONLY.length) for (const file of readdirSync(OUT_DIR)) if (!written.has(file)) rmSync(resolve(OUT_DIR, file));
console.log(`파일 ${written.size}개를 ${OUT_DIR}에 저장했습니다`);
