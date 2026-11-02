// OpenStreetMap에서 국내 골프장 목록(이름·위치·지역)을 받아 src/golf/golfCourses.js로 저장한다.
// 골프 라운드 날씨에서 골프장 이름을 찾을 때 쓴다. 목록을 새로 고칠 때만 손으로 돌린다: node scripts/golf-courses.mjs
// OpenStreetMap 검색(Nominatim)은 이름이 정확히 같아야 찾고 자동완성도 금지라, 목록을 받아 두고 페이지 안에서 찾는다.
// 데이터: © OpenStreetMap 기여자, ODbL (https://www.openstreetmap.org/copyright)
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const OUT_FILE = resolve(import.meta.dirname, "../src/golf/golfCourses.js");

// 시·도(4)와 시·군·구(6) 경계마다 그 안의 골프장 id를 내보내고, 마지막에 골프장 전체를 경계 상자와 함께 내보낸다
const QUERY = `[out:json][timeout:300];
area["ISO3166-1"="KR"][admin_level=2]->.kr;
nwr["leisure"="golf_course"](area.kr)->.all;
rel(area.kr)["boundary"="administrative"]["admin_level"~"^(4|6)$"];
map_to_area->.regions;
foreach.regions->.r(.r out tags; nwr.all(area.r); out ids;);
.all out bb tags;`;

// 연습장·스크린골프·파크골프처럼 골프장으로 잘못 표시된 곳
const NOT_COURSE = /연습장|스크린|아카데미|스쿨|레슨|파크\s*골프|그라운드\s*골프|실내|인도어|드라이빙|타석|퍼팅|골프존|GDR|driving|range|academy|school|lesson|screen|indoor|putting/i;
// 영역 없이 점 하나로만 표시된 곳은 이름이 골프장다울 때만 넣는다
const COURSE_NAME = /CC|C\.C|GC|G\.C|컨트리|골프\s*클럽|골프장|골프\s*(?:앤|&)?\s*리조트|골프\s*코스|링크스|country|golf\s*(?:club|resort|course|links)/i;
// 연습장 크기를 거르는 기준. 경계 상자 넓이 0.05km² (약 220m × 220m)
const MIN_AREA_KM2 = 0.05;

const SHORT_PROVINCE = {
  서울특별시: "서울", 부산광역시: "부산", 대구광역시: "대구", 인천광역시: "인천", 광주광역시: "광주",
  대전광역시: "대전", 울산광역시: "울산", 세종특별자치시: "세종", 경기도: "경기", 강원특별자치도: "강원",
  충청북도: "충북", 충청남도: "충남", 전북특별자치도: "전북", 전라남도: "전남", 경상북도: "경북",
  경상남도: "경남", 제주특별자치도: "제주", 전남광주통합특별시: "전남광주",
};

const res = await fetch(OVERPASS_URL, {
  method: "POST",
  headers: {
    "Content-Type": "application/x-www-form-urlencoded",
    "User-Agent": "playground-golf-courses/1.0 (https://yul456.github.io/playground/)",
  },
  body: new URLSearchParams({ data: QUERY }),
  signal: AbortSignal.timeout(6 * 60 * 1000),
});
if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
const { elements, osm3s } = await res.json();

// 경계 영역 다음에 오는 id만 있는 요소들이 그 영역 안의 골프장이다
const province = new Map();
const city = new Map();
let region = null;
const courses = [];
for (const el of elements) {
  if (el.type === "area") region = el.tags;
  else if (!el.tags) {
    const key = `${el.type}/${el.id}`;
    const target = region?.admin_level === "4" ? province : city;
    if (!target.has(key)) target.set(key, region.name);
  } else courses.push(el);
}

const rows = [];
for (const el of courses) {
  const name = (el.tags["name:ko"] || el.tags.name || "").trim();
  if (!name || NOT_COURSE.test(name)) continue;
  let lat, lon, area = 0;
  if (el.type === "node") {
    if (!COURSE_NAME.test(name)) continue;
    ({ lat, lon } = el);
  } else {
    const b = el.bounds;
    lat = (b.minlat + b.maxlat) / 2;
    lon = (b.minlon + b.maxlon) / 2;
    area = (b.maxlat - b.minlat) * 111 * (b.maxlon - b.minlon) * 111 * Math.cos((lat * Math.PI) / 180);
    if (area < MIN_AREA_KM2) continue;
  }
  const key = `${el.type}/${el.id}`;
  const p = province.get(key);
  const label = [SHORT_PROVINCE[p] ?? p, city.get(key)].filter(Boolean).join(" ");
  rows.push({ name, lat, lon, label, area });
}

// 같은 이름이 가까이 두 번 있으면(점과 영역으로 따로 그린 경우 등) 넓은 쪽만 남긴다
const kept = [];
for (const row of rows.sort((a, b) => b.area - a.area)) {
  const twin = kept.find((k) => k.name === row.name && Math.hypot(k.lat - row.lat, k.lon - row.lon) < 0.03);
  if (!twin) kept.push(row);
}
kept.sort((a, b) => a.name.localeCompare(b.name, "ko"));

const date = (osm3s?.timestamp_osm_base ?? new Date().toISOString()).slice(0, 10);
const lines = kept.map((r) => `  ${JSON.stringify([r.name, +r.lat.toFixed(4), +r.lon.toFixed(4), r.label])},`);
writeFileSync(OUT_FILE, `// 국내 골프장 목록: [이름, 위도, 경도, 지역]
// scripts/golf-courses.mjs가 OpenStreetMap에서 받아 만든 파일이다. 손으로 고치지 말고 스크립트를 다시 돌린다.
// 데이터: © OpenStreetMap 기여자, ODbL (https://www.openstreetmap.org/copyright). 기준 날짜: ${date}
export const GOLF_COURSES = [
${lines.join("\n")}
];
`);
console.log(`골프장 ${kept.length}곳 저장 (받은 골프장 ${courses.length}곳, 기준 ${date}) → ${OUT_FILE}`);
