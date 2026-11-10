// 골프장 3D 보기에 쓰는 계산: OpenStreetMap 골프장 데이터 정리, 거리·방향, 지형 높이.
// 좌표는 [경도, 위도] 순서다(지도 라이브러리와 같다). 화면 코드가 없어 Node에서도 돌릴 수 있고,
// 높이 타일을 받는 heightsAt만 브라우저에서 쓴다

const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

// 두 점 사이 거리(m)
export function distance([lon1, lat1], [lon2, lat2]) {
  const a =
    Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 +
    Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.sqrt(a));
}

// a에서 b를 바라보는 방향(도). 북쪽이 0이고 시계 방향으로 커진다
export function bearing([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x = Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

export const lineLength = (coords) => coords.slice(1).reduce((sum, p, i) => sum + distance(coords[i], p), 0);

// 선을 따라 meters만큼 간 곳
export function pointAlong(coords, meters) {
  let left = Math.max(0, meters);
  for (let i = 1; i < coords.length; i++) {
    const step = distance(coords[i - 1], coords[i]);
    if (left <= step && step > 0) {
      const t = left / step;
      return [coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t, coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t];
    }
    left -= step;
  }
  return coords.at(-1);
}

// 점이 고리(rings)들 안쪽인지. 고리마다 이웃한 점을 잇는 선분을 모아 짝홀 규칙으로 센다.
// 여러 조각으로 나뉜 OSM 멀티폴리곤 테두리도 조각을 잇지 않고 그대로 쓸 수 있다
export function inside([x, y], rings) {
  let crossings = 0;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const [x1, y1] = ring[i - 1];
      const [x2, y2] = ring[i];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) * (x2 - x1)) / (y2 - y1)) crossings++;
    }
  }
  return crossings % 2 === 1;
}

// 점에서 고리(rings)의 선분들까지 가장 가까운 거리(m). 짧은 거리라 평면으로 보고 계산한다
export function gapTo([lon0, lat0], rings) {
  const kx = Math.cos(lat0 * RAD) * EARTH_RADIUS * RAD;
  const ky = EARTH_RADIUS * RAD;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i++) {
      const ax = (ring[i - 1][0] - lon0) * kx;
      const ay = (ring[i - 1][1] - lat0) * ky;
      const dx = (ring[i][0] - ring[i - 1][0]) * kx;
      const dy = (ring[i][1] - ring[i - 1][1]) * ky;
      const t = dx || dy ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy))) : 0;
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

const average = (coords) => [
  coords.reduce((s, p) => s + p[0], 0) / coords.length,
  coords.reduce((s, p) => s + p[1], 0) / coords.length,
];

// 골프장 데이터 파일 이름. 이름과 지역이 같으면 늘 같다 (FNV-1a 32비트)
export function courseKey({ name, region = "" }) {
  let hash = 0x811c9dc5;
  for (const ch of `${name}|${region}`) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// 선을 단순하게 한다(Douglas-Peucker). tolerance(m)보다 덜 벗어나는 점은 뺀다
export function simplify(coords, tolerance) {
  if (coords.length <= 2) return coords;
  const [lon0, lat0] = coords[0];
  const kx = Math.cos(lat0 * RAD) * EARTH_RADIUS * RAD;
  const ky = EARTH_RADIUS * RAD;
  const xy = coords.map(([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * ky]);
  const keep = new Array(coords.length).fill(false);
  keep[0] = keep[coords.length - 1] = true;
  const stack = [[0, coords.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const len = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let farDist = tolerance;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = xy[i];
      const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    }
    if (far >= 0) {
      keep[far] = true;
      stack.push([a, far], [far, b]);
    }
  }
  return coords.filter((_, i) => keep[i]);
}

const round5 = ([lon, lat]) => [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5];
const toCoords = (geometry) => geometry.map(({ lon, lat }) => [lon, lat]);

// 그릴 골프장 면: OSM 태그 → 종류
function areaKind(tags) {
  if (tags.natural === "water" || tags.golf === "water_hazard" || tags.golf === "lateral_water_hazard") return "water";
  if (["fairway", "green", "tee", "bunker"].includes(tags.golf)) return tags.golf;
  return null;
}

const parNumber = (par) => (/^\d+$/.test(par ?? "") ? Number(par) : null);

// Overpass 결과(out geom)를 3D 보기용 데이터로 정리한다. center는 골프장 목록의 위치([경도, 위도]).
// 골프장 테두리(leisure=golf_course) 가운데 center를 품은 것을 찾아, 그 안의 홀과 면만 남긴다.
// name은 골프장 목록의 이름으로, 테두리를 이름으로 찾을 때 쓴다.
// 테두리를 못 찾으면 center에서 fallbackRadius(m) 안의 것만 남긴다. 옆 골프장의 홀이 섞이지 않게 하려는 것이다.
// 돌려주는 outline은 그 테두리(고리 여러 개)다
export function courseFromOsm(elements, center, { name, fallbackRadius = 1500 } = {}) {
  const candidates = elements
    .filter((e) => e.tags?.leisure === "golf_course")
    .map((e) => ({
      names: [e.tags.name, e.tags["name:ko"]],
      rings: e.type === "way" ? [toCoords(e.geometry)] : e.members.filter((m) => m.geometry).map((m) => toCoords(m.geometry)),
    }))
    .filter((o) => o.rings.length);
  // 테두리가 겹치면(큰 리조트 안의 골프장 등) 가장 작은 것
  const size = (o) => {
    const all = o.rings.flat();
    return (Math.max(...all.map((p) => p[0])) - Math.min(...all.map((p) => p[0]))) * (Math.max(...all.map((p) => p[1])) - Math.min(...all.map((p) => p[1])));
  };
  // 목록 위치는 테두리 상자의 가운데라, 테두리가 오목하면(킹즈락CC 등) 테두리 밖에 찍힌다.
  // 그러면 이름이 같은 테두리를, 그것도 없으면 300m 안에서 가장 가까운 테두리를 쓴다
  const gap = (o) => gapTo(center, o.rings);
  const outline =
    candidates.filter((o) => inside(center, o.rings)).sort((a, b) => size(a) - size(b))[0] ??
    (name && candidates.find((o) => o.names.includes(name))) ??
    candidates.filter((o) => gap(o) <= 300).sort((a, b) => gap(a) - gap(b))[0] ??
    null;
  const belongs = (point) => (outline ? inside(point, outline.rings) : distance(point, center) <= fallbackRadius);

  const holes = [];
  const areas = { fairway: [], green: [], tee: [], bunker: [], water: [] };
  for (const e of elements) {
    if (e.type !== "way" || !e.geometry || e.geometry.length < 2) continue;
    const tags = e.tags ?? {};
    const coords = toCoords(e.geometry);
    if (tags.golf === "hole") {
      // 홀 선은 티에서 그린 쪽으로 그린다. 티나 그린 한쪽만 골프장 안이어도 그 골프장 홀로 본다
      if (!belongs(coords[0]) && !belongs(coords.at(-1))) continue;
      holes.push({
        ref: tags.ref ?? null,
        par: parNumber(tags.par),
        name: tags["name:ko"] ?? tags.name ?? null,
        coords: simplify(coords, 0.5).map(round5),
      });
      continue;
    }
    const kind = areaKind(tags);
    const closed = coords.length >= 4 && coords[0][0] === coords.at(-1)[0] && coords[0][1] === coords.at(-1)[1];
    if (!kind || !closed || !belongs(average(coords))) continue;
    areas[kind].push(simplify(coords, 0.8).map(round5));
  }

  const points = [...holes.flatMap((h) => h.coords), ...Object.values(areas).flat(2), ...(outline?.rings.flat() ?? [])];
  const bounds = points.length
    ? [
        [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))],
        [Math.max(...points.map((p) => p[0])), Math.max(...points.map((p) => p[1]))],
      ].map(round5)
    : null;
  // 골프장 테두리도 그린다. 홀·그린이 그려지지 않은 골프장(킹즈락CC 등)도 경계는 보인다
  const ring = outline?.rings.map((r) => simplify(r, 2).map(round5)) ?? [];
  return { holes, areas, outline: ring, bounds };
}

// "예술 1" → { group: "예술", number: 1 }. 이름 끝에 번호가 없으면 ref 숫자를 쓴다
function holeOrder(hole) {
  const match = hole.name?.match(/^(.*?)\s*(\d+)\s*(번\s*홀|홀|번)?$/);
  if (match) return { group: match[1].trim(), number: Number(match[2]) };
  if (/^\d+$/.test(hole.ref ?? "")) return { group: "", number: Number(hole.ref) };
  return { group: hole.name ?? "", number: Infinity };
}

const labelOf = (group, number) => (Number.isFinite(number) ? `${group ? `${group} ` : ""}${number}번${group ? "" : " 홀"}` : group || "이름 없는 홀");

// 홀 순서를 정하고 목록에 쓸 이름(label)과 코스 이름(course, 코스별 둘러보기에 쓴다)을 붙인다.
// 코스 이름(동·서 코스 등) 순, 그 안에서 번호 순이다.
// 이름 없이 번호만 있는 9홀 코스가 여럿이면 번호가 겹치므로, n번 홀 그린에서 가장 가까운 티를 가진
// n+1번 홀로 이어 코스를 나누고 A·B·C를 붙인다
export function arrangeHoles(holes) {
  const groups = new Map();
  for (const hole of holes) {
    const order = holeOrder(hole);
    groups.set(order.group, [...(groups.get(order.group) ?? []), { hole, number: order.number }]);
  }
  const arranged = [];
  for (const [group, items] of [...groups].sort(([a], [b]) => a.localeCompare(b, "ko"))) {
    items.sort((a, b) => a.number - b.number);
    const numbered = items.filter((i) => Number.isFinite(i.number));
    const repeated = new Set(numbered.map((i) => i.number)).size < numbered.length;
    if (!repeated) {
      arranged.push(...items.map((i) => ({ ...i.hole, course: group, label: labelOf(group, i.number) })));
      continue;
    }
    const left = new Set(items);
    const chains = [];
    for (const start of numbered.filter((i) => i.number === numbered[0].number)) {
      const chain = [start];
      left.delete(start);
      for (;;) {
        const green = chain.at(-1).hole.coords.at(-1);
        const next = [...left]
          .filter((i) => i.number === chain.at(-1).number + 1)
          .sort((a, b) => distance(green, a.hole.coords[0]) - distance(green, b.hole.coords[0]))[0];
        if (!next) break;
        chain.push(next);
        left.delete(next);
      }
      chains.push(chain);
    }
    // 이어지지 않은 홀은 마지막 코스로 모은다
    if (left.size) chains.push([...left]);
    chains.forEach((chain, k) => {
      const name = `${group ? `${group} ` : ""}${String.fromCharCode(65 + k)}`;
      arranged.push(...chain.map((i) => ({ ...i.hole, course: name, label: labelOf(name, i.number) })));
    });
  }
  return arranged;
}

// 오르막·내리막 말. 2m 안쪽은 평지로 본다
export function slopeText(diff) {
  if (diff == null || Number.isNaN(diff)) return null;
  const meters = Math.round(Math.abs(diff));
  if (meters < 2) return "거의 평지";
  return diff > 0 ? `오르막 ${meters}m` : `내리막 ${meters}m`;
}

// 거리 재기: 찍은 점과 점 사이 구간마다 거리(m), 높이 차(rise, m, 오르막이 +), 체감 거리(plays, m).
// heights[i]는 i번 점의 지형 높이(아직 모르면 null). 체감 거리는 오르막 1m를 거리 1m로 치는 흔한 어림셈이다
export function measureSegments(points, heights = []) {
  return points.slice(1).map((point, i) => {
    const length = distance(points[i], point);
    const rise = heights[i] != null && heights[i + 1] != null ? heights[i + 1] - heights[i] : null;
    return { length, rise, plays: rise == null ? null : length + rise };
  });
}

// 이보다 약한 바람(m/s)은 홀 방향을 따지지 않는다
export const CALM_WIND = 1.5;

// 바람이 홀에 어떻게 부는지. holeBearing은 티에서 그린 쪽 방향, dir은 바람이 불어오는 쪽(풍향, 북쪽 0°부터
// 시계 방향)이다. 그린 쪽에서 불어오면 맞바람, 티 쪽에서 불어오면 뒷바람, 그 사이(45°~135°)는 옆바람이다.
// 그린을 보고 섰을 때 오른쪽에서 불어오면 공이 오른쪽에서 왼쪽으로 밀린다
export function windOnHole(holeBearing, dir, speed) {
  if (dir == null || speed == null) return null;
  const strength = `${speed.toFixed(1)}m/s`;
  if (speed < CALM_WIND) return { kind: "calm", text: `바람 약함 ${strength}` };
  const turn = ((dir - holeBearing + 540) % 360) - 180;
  if (Math.abs(turn) <= 45) return { kind: "head", text: `맞바람 ${strength}` };
  if (Math.abs(turn) >= 135) return { kind: "tail", text: `뒷바람 ${strength}` };
  return turn > 0 ? { kind: "right", text: `오→왼 옆바람 ${strength}` } : { kind: "left", text: `왼→오 옆바람 ${strength}` };
}

// 지형 높이: Terrarium 타일(PNG)의 색에 높이가 들어 있다. 높이(m) = R × 256 + G + B ÷ 256 − 32768
export const TERRAIN_TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const terrariumHeight = (r, g, b) => r * 256 + g + b / 256 - 32768;

// 경위도가 zoom 단계 타일의 어느 칸, 어느 픽셀(256×256 안, 소수)인지
export function tilePixel([lon, lat], zoom) {
  const n = 2 ** zoom;
  const x = ((lon + 180) / 360) * n;
  const y = ((1 - Math.log(Math.tan(lat * RAD) + 1 / Math.cos(lat * RAD)) / Math.PI) / 2) * n;
  return { tx: Math.floor(x), ty: Math.floor(y), px: (x - Math.floor(x)) * 256, py: (y - Math.floor(y)) * 256 };
}

// 점들의 지형 높이(m). 타일을 받아 픽셀 네 개 사이를 이어서(bilinear) 읽는다. 브라우저에서만 쓴다
const HEIGHT_ZOOM = 14;
const tileCache = new Map();
function tilePixels(tx, ty, signal) {
  const key = `${tx}/${ty}`;
  if (!tileCache.has(key)) {
    const url = TERRAIN_TILES.replace("{z}", HEIGHT_ZOOM).replace("{x}", tx).replace("{y}", ty);
    const loading = fetch(url, { signal })
      .then((res) => {
        if (!res.ok) throw new Error(`지형 타일을 받지 못했습니다 (HTTP ${res.status})`);
        return res.blob();
      })
      .then((blob) => createImageBitmap(blob))
      .then((bitmap) => {
        const canvas = new OffscreenCanvas(256, 256);
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        return ctx.getImageData(0, 0, 256, 256).data;
      });
    // 실패한 타일은 기억하지 않는다. 다음에 다시 받는다
    loading.catch(() => tileCache.delete(key));
    tileCache.set(key, loading);
  }
  return tileCache.get(key);
}

export async function heightsAt(points, signal) {
  return Promise.all(
    points.map(async (point) => {
      const { tx, ty, px, py } = tilePixel(point, HEIGHT_ZOOM);
      const data = await tilePixels(tx, ty, signal);
      // 타일 가장자리에서는 이웃 픽셀 대신 가장자리 픽셀을 쓴다
      const x0 = Math.min(255, Math.max(0, Math.floor(px - 0.5)));
      const y0 = Math.min(255, Math.max(0, Math.floor(py - 0.5)));
      const x1 = Math.min(255, x0 + 1);
      const y1 = Math.min(255, y0 + 1);
      const fx = Math.min(1, Math.max(0, px - 0.5 - x0));
      const fy = Math.min(1, Math.max(0, py - 0.5 - y0));
      const at = (x, y) => {
        const i = (y * 256 + x) * 4;
        return terrariumHeight(data[i], data[i + 1], data[i + 2]);
      };
      const top = at(x0, y0) * (1 - fx) + at(x1, y0) * fx;
      const bottom = at(x0, y1) * (1 - fx) + at(x1, y1) * fx;
      return top * (1 - fy) + bottom * fy;
    }),
  );
}
