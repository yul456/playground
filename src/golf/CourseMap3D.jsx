import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import {
  aimText,
  bearing,
  CLUB_GAP,
  clubText,
  distance,
  heightsAt,
  holeShots,
  lineLength,
  measureSegments,
  playsLike,
  pointAlong,
  SHOT_STEPS,
  shotHeights,
  shotMs,
  shotPoints,
  slopeText,
  TERRAIN_TILES,
  windParts,
  windText,
} from "./course3d.js";
import { placeKind } from "./placeKinds.js";
import { createShotLayer } from "./shotLayer.js";

// 지도 라이브러리는 무거운 계산을 웹 워커에서 한다. 워커 파일 주소를 스스로 찾지 못해(파일 이름을
// 실행 중에 만들어서 번들러가 모른다) 번들러가 내보낸 주소를 알려 준다
maplibregl.setWorkerUrl(workerUrl);

// 키 없이 쓰는 지도(OpenFreeMap)와 지형 높이 타일(AWS 공개 데이터)
const STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";
const TERRAIN_CREDIT = '지형 <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Terrain Tiles</a>';
const GOLF_CREDIT = '골프 코스 <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap 기여자</a>';
// 높낮이가 잘 보이게 실제보다 이만큼 부풀린다. 오르막·내리막 숫자는 부풀리기 전 높이로 계산한다
const EXAGGERATION = 1.5;
const VIEW = { zoom: 15, pitch: 58, bearing: -20 };
const ORBIT_MS = 30_000;
const AREA_COLORS = { fairway: "#8cc96f", tee: "#a8d98a", green: "#45a852", bunker: "#ecdcab", water: "#76b5e8" };
const SELECTED = "#facc15";
// 거리 재기 선·점 색
const MEASURE = "#e11d48";

// 바탕 지도 글자를 한글 이름으로 (기본은 영어 이름과 현지 이름을 함께 쓴다)
function koreanLabels(map) {
  for (const layer of map.getStyle().layers) {
    const field = layer.layout?.["text-field"];
    if (layer.type === "symbol" && field && JSON.stringify(field).includes("name")) {
      map.setLayoutProperty(layer.id, "text-field", ["coalesce", ["get", "name:ko"], ["get", "name"]]);
    }
  }
}

function toGeoJSON(data) {
  const features = [];
  for (const [kind, polygons] of Object.entries(data?.areas ?? {})) {
    for (const ring of polygons) features.push({ type: "Feature", properties: { kind }, geometry: { type: "Polygon", coordinates: [ring] } });
  }
  for (const ring of data?.outline ?? []) {
    features.push({ type: "Feature", properties: { kind: "outline" }, geometry: { type: "LineString", coordinates: ring } });
  }
  (data?.holes ?? []).forEach((hole, index) => {
    features.push({ type: "Feature", id: index, properties: { kind: "hole", index }, geometry: { type: "LineString", coordinates: hole.coords } });
    // 그린 쪽 끝에 홀 번호. "예술 3번" → "3" (label은 arrangeHoles가 붙인다)
    const number = hole.label?.match(/(\d+)번/)?.[1] ?? "";
    features.push({ type: "Feature", properties: { kind: "number", index, label: number }, geometry: { type: "Point", coordinates: hole.coords.at(-1) } });
  });
  return { type: "FeatureCollection", features };
}

function addLayers(map) {
  const dem = { type: "raster-dem", tiles: [TERRAIN_TILES], tileSize: 256, encoding: "terrarium", maxzoom: 15, attribution: TERRAIN_CREDIT };
  // 지형과 음영은 같은 타일을 쓰지만 소스를 따로 둔다 (MapLibre 권장)
  map.addSource("terrain-dem", dem);
  map.addSource("hillshade-dem", dem);
  map.setTerrain({ source: "terrain-dem", exaggeration: EXAGGERATION });
  map.setSky({
    "sky-color": "#a9cdf5",
    "sky-horizon-blend": 0.6,
    "horizon-color": "#e9f1fb",
    "horizon-fog-blend": 0.6,
    "fog-color": "#eef3f9",
    "fog-ground-blend": 0.4,
  });
  map.addSource("golf", { type: "geojson", data: toGeoJSON(null), attribution: GOLF_CREDIT });

  // 음영과 골프 면은 바탕 지도의 글자 아래에 둔다
  const labels = map.getStyle().layers.find((l) => l.type === "symbol")?.id;
  map.addLayer({ id: "golf-hillshade", type: "hillshade", source: "hillshade-dem", paint: { "hillshade-exaggeration": 0.35 } }, labels);
  for (const kind of Object.keys(AREA_COLORS)) {
    map.addLayer(
      { id: `golf-${kind}`, type: "fill", source: "golf", filter: ["==", ["get", "kind"], kind], paint: { "fill-color": AREA_COLORS[kind], "fill-opacity": 0.9 } },
      labels,
    );
  }
  // 골프장 경계
  map.addLayer(
    {
      id: "golf-outline",
      type: "line",
      source: "golf",
      filter: ["==", ["get", "kind"], "outline"],
      paint: { "line-color": "#2f6b3a", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.85 },
    },
    labels,
  );
  const picked = ["boolean", ["feature-state", "selected"], false];
  map.addLayer(
    {
      id: "golf-hole",
      type: "line",
      source: "golf",
      filter: ["==", ["get", "kind"], "hole"],
      layout: { "line-cap": "round" },
      paint: { "line-color": ["case", picked, SELECTED, "#ffffff"], "line-width": ["case", picked, 4, 2], "line-opacity": 0.95 },
    },
    labels,
  );
  // 거리 재기: 찍은 점, 점을 잇는 점선, 구간 거리. 다른 것보다 위에
  map.addSource("measure", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "measure-line",
    type: "line",
    source: "measure",
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round" },
    paint: { "line-color": MEASURE, "line-width": 3, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: "measure-point",
    type: "circle",
    source: "measure",
    filter: ["==", ["get", "kind"], "point"],
    paint: { "circle-radius": 6, "circle-color": "#ffffff", "circle-stroke-color": MEASURE, "circle-stroke-width": 2.5 },
  });
  map.addLayer({
    id: "measure-label",
    type: "symbol",
    source: "measure",
    filter: ["==", ["get", "kind"], "label"],
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 12, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": MEASURE, "text-halo-color": "#ffffff", "text-halo-width": 2 },
  });
  // 홀 번호는 바탕 지도 글자보다 위에
  map.addLayer({
    id: "golf-number-dot",
    type: "circle",
    source: "golf",
    filter: ["==", ["get", "kind"], "number"],
    paint: { "circle-radius": 9, "circle-color": "#ffffff", "circle-stroke-color": "#1c2733", "circle-stroke-width": 1.5 },
  });
  map.addLayer({
    id: "golf-number",
    type: "symbol",
    source: "golf",
    filter: ["==", ["get", "kind"], "number"],
    layout: { "text-field": ["get", "label"], "text-font": ["Noto Sans Bold"], "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true },
    paint: { "text-color": "#1c2733" },
  });
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
// easeInOut을 거꾸로: 움직인 비율(0~1)에 닿는 시간 비율
const easeInOutInverse = (y) => (y < 0.5 ? Math.sqrt(y / 2) : 1 - Math.sqrt(2 * (1 - y)) / 2);
// 그린에 닿은 뒤 다음 홀로 가기 전에 잠깐 멈추는 시간
const PAUSE_MS = 700;
// 홀을 날 때 카메라를 홀 방향에서 이만큼(도) 비켜 비스듬히 본다. 바로 뒤에서 보면 공 궤적이 세로 선으로만 보여
// 공이 움직이는 게 잘 안 보였다
const SIDE_ANGLE = 35;
// 공이 떨어진 뒤 다음 샷까지 쉬는 시간
const SHOT_PAUSE_MS = 350;

// 샷([출발, 도착] 쌍)마다 공 궤적. 공이 지나는 자리의 지형 높이를 읽어 공 높이를 정하고, 지도처럼 높이를 부풀린다.
// 체감 거리에 쓰도록 샷 거리(length), 높이 차(rise, 부풀리기 전), 방향(bearing)도 함께 돌려준다
async function buildArcs(pairs) {
  const paths = pairs.map(([from, to]) => shotPoints(from, to));
  const heights = await heightsAt(paths.flat());
  return paths.map((points, k) => {
    const ground = heights.slice(k * (SHOT_STEPS + 1), (k + 1) * (SHOT_STEPS + 1));
    const length = distance(...pairs[k]);
    return {
      points,
      heights: shotHeights(ground, length).map((h) => h * EXAGGERATION),
      ground: ground.map((h) => h * EXAGGERATION),
      ms: shotMs(length),
      length,
      rise: ground.at(-1) - ground[0],
      bearing: bearing(...pairs[k]),
    };
  });
}

// 샷 이름
const SHOT_NAMES = ["티샷", "두 번째 샷", "세 번째 샷", "네 번째 샷"];
// 거리 재기 방식
const MEASURE_MODES = [
  ["plain", "일반"],
  ["shot", "공 궤적"],
];

// 체감 거리 한 줄: "오르막 3m · 맞바람 +14m → 체감 약 227m · 클럽 2개 길게 · 오른쪽 보고"
function playsLine(length, rise, wind) {
  const { plays, byWind } = playsLike(length, rise, wind);
  const reasons = [rise == null ? null : slopeText(rise), windText(byWind)].filter(Boolean);
  const advice = [clubText(plays - length), aimText(wind?.side)].filter(Boolean);
  return `${reasons.length ? `${reasons.join(" · ")} → ` : ""}체감 약 ${Math.round(plays)}m · ${advice.join(" · ")}`;
}

// 체감 거리 설명. 바람 예보가 없는 날이면 높낮이만 넣었다고 알린다
const playsNote = (wind) =>
  `체감 거리는 어림셈입니다. 오르막 1m를 거리 1m로 치고, 맞바람은 1m/s마다 2.2% 길게, 뒷바람은 1m/s마다 1.1% 짧게 칩니다. 클럽 하나는 ${CLUB_GAP}m로 봅니다. ` +
  (wind
    ? "바람은 고른 시각의 예보(땅에서 10m 높이, 1시간 평균)라 코스 안 바람과 다를 수 있습니다. 옆바람이 1.5m/s를 넘으면 바람이 오는 쪽을 보고 치라고 알려 줍니다."
    : "이 날은 바람 예보가 없어 높낮이만 넣었습니다.") +
  " 높이는 약 30m 간격 지형 자료로 잽니다.";
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// 둘러보기 버튼 이름. "A" → "A 코스", "북코스" → 그대로
const courseName = (name) => (/코스$/.test(name) ? name : `${name} 코스`);
// 같은 골프장 데이터인지 알아보는 값
const dataId = (data) => (data ? `${data.name}|${data.updated}` : null);

// 3D 지형 위에 골프장(data가 있으면 홀·그린·경계)을 그린다. selected({ index, nonce })가 바뀌면 그 홀을
// 티에서 그린까지 날아가고, 아래 "코스 둘러보기"로 전체나 코스 하나의 홀을 차례로 날아간다.
// info[i]는 날아가는 동안 지도에 띄울 i번 홀 설명, onActive(i)는 지금 보여 주는 홀이 바뀔 때,
// onPick(i)은 지도에서 홀 선을 눌렀을 때 부른다. windDir(풍향, 불어오는 쪽)·windSpeed(m/s)가 있으면
// 지도 위에 바람 화살표를 띄우고, 지도를 돌리면 화살표도 같이 돈다.
// 홀을 날 때와 거리를 잴 때는 공이 날아가는 궤적(shotLayer.js)을 그린다
export default function CourseMap3D({ course, data, selected, info, onActive, onPick, windDir, windSpeed }) {
  const boxRef = useRef(null);
  const mapRef = useRef(null);
  const readyRef = useRef(false);
  // 지도가 준비되기 전에 온 데이터도 준비되면 그린다
  const dataRef = useRef(data);
  dataRef.current = data;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const onActiveRef = useRef(onActive);
  onActiveRef.current = onActive;
  // 날기·돌기·둘러보기 같은 움직임. 새 움직임을 시작하거나 사용자가 지도를 만지면 번호를 올려 앞의 것을 멈춘다
  const runRef = useRef(0);
  const frameRef = useRef(0);
  const timerRef = useRef(0);
  // 지금 그린 골프장 데이터(dataId)와 노랗게 칠한 홀
  const shownRef = useRef(null);
  const activeRef = useRef(null);
  const [current, setCurrent] = useState(null);
  // 둘러보는 중이면 { name, step, total }
  const [touring, setTouring] = useState(null);
  const [error, setError] = useState(null);
  const [flat, setFlat] = useState(false);
  // 거리 재기: 켜져 있으면 지도를 누를 때마다 점을 찍는다. 점의 지형 높이는 따로 읽어 points와 짝을 맞춘다
  const [measuring, setMeasuring] = useState(false);
  // 재는 방식: "plain"(거리·높이 차만) 또는 "shot"(점 사이 공 궤적과 바람·높낮이를 넣은 체감 거리). 처음에는 일반
  const [measureMode, setMeasureMode] = useState("plain");
  const measuringRef = useRef(false);
  measuringRef.current = measuring;
  const [points, setPoints] = useState([]);
  const [measured, setMeasured] = useState({ points: [], heights: [] });
  const heights = measured.points === points ? measured.heights : [];
  // 고른 시각의 바람. 체감 거리에 넣는다 (예보가 없는 날이면 높낮이만)
  const wind = windDir != null && windSpeed != null ? { dir: windDir, speed: windSpeed } : null;
  const segments = measureSegments(points, heights, wind);
  // 고른 홀의 샷마다 거리·높이 차·방향 ({ index, shots }). 공 궤적을 계산할 때 함께 나온다
  const [plan, setPlan] = useState(null);
  // 바람 화살표는 지도가 돌 때마다(날기 중엔 화면마다) 돌리므로 다시 그리지 않고 스타일만 바꾼다
  const windRef = useRef(windDir);
  windRef.current = windDir;
  const arrowRef = useRef(null);
  // 공 궤적 레이어, 홀마다 계산해 둔 궤적, 늦게 온 계산 결과를 버리기 위한 번호
  const shotsRef = useRef(null);
  // 바탕 지도 장소를 눌렀을 때 띄운 말풍선
  const popupRef = useRef(null);
  const arcCacheRef = useRef(new Map());
  const holeTokenRef = useRef(0);
  const measureTokenRef = useRef(0);
  const measureShownRef = useRef(0);

  // 바람 화살표는 바람이 불어 가는 쪽을 가리킨다 (지도 회전만큼 되돌린다)
  function turnArrow() {
    const map = mapRef.current;
    if (map && arrowRef.current && windRef.current != null) {
      arrowRef.current.style.transform = `rotate(${windRef.current + 180 - map.getBearing()}deg)`;
    }
  }

  function stop() {
    runRef.current++;
    cancelAnimationFrame(frameRef.current);
    clearTimeout(timerRef.current);
    setTouring(null);
  }

  // 지도의 노란 홀 선, 지도 위 설명, 아래 목록 표시를 이 홀로 옮긴다 (null이면 지운다). 앞 홀의 공 궤적은 지운다
  function highlight(index) {
    const map = mapRef.current;
    if (activeRef.current != null) map.setFeatureState({ source: "golf", id: activeRef.current }, { selected: false });
    if (index != null) map.setFeatureState({ source: "golf", id: index }, { selected: true });
    activeRef.current = index;
    setCurrent(index);
    onActiveRef.current?.(index);
    holeTokenRef.current++;
    shotsRef.current?.clear("hole");
    setPlan(null);
  }

  // index번 홀의 공 궤적. 골프장 데이터마다 홀별로 한 번만 계산한다
  function holeArcs(index) {
    const cache = arcCacheRef.current;
    if (!cache.has(index)) {
      const hole = dataRef.current.holes[index];
      const shots = holeShots(hole.coords, hole.par);
      const arcs = buildArcs(shots.map((shot) => [shot.from, shot.to])).then((list) => list.map((arc, k) => ({ ...arc, at: shots[k].at })));
      arcs.catch(() => cache.delete(index));
      cache.set(index, arcs);
    }
    return cache.get(index);
  }

  function overview() {
    const map = mapRef.current;
    if (!map) return;
    stop();
    setFlat(false);
    if (readyRef.current) highlight(null);
    const bounds = dataRef.current?.bounds;
    if (bounds) {
      const camera = map.cameraForBounds(bounds, { padding: 40, bearing: VIEW.bearing });
      if (camera) {
        // 비스듬히 보면 위쪽이 멀리까지 보여 골프장이 작아 보이므로 평면 기준보다 조금 가까이 간다
        map.easeTo({ ...camera, zoom: camera.zoom + 0.3, pitch: VIEW.pitch, bearing: VIEW.bearing, duration: 1200 });
        return;
      }
    }
    map.easeTo({ center: [course.lon, course.lat], ...VIEW, duration: 1200 });
  }

  function orbit() {
    const map = mapRef.current;
    if (!map) return;
    stop();
    const run = runRef.current;
    const from = map.getBearing();
    const begin = performance.now();
    const frame = (now) => {
      if (run !== runRef.current) return;
      const t = Math.min(1, (now - begin) / ORBIT_MS);
      map.setBearing(from + 360 * t);
      if (t < 1) frameRef.current = requestAnimationFrame(frame);
    };
    frameRef.current = requestAnimationFrame(frame);
  }

  function toggleMeasure() {
    stop();
    popupRef.current?.remove();
    setMeasuring(!measuring);
    setPoints([]);
  }

  // "전체 보기" 버튼: 거리 재기도 끝내고 처음 화면으로 돌아간다. 카메라만 돌리면, 확대하지 않고 거리를 쟀을 때
  // 점과 궤적이 그대로 남아 버튼이 안 눌린 것처럼 보였다
  function showAll() {
    popupRef.current?.remove();
    setMeasuring(false);
    setPoints([]);
    overview();
  }

  // 바탕 지도의 장소(가게·정류장 등)를 누르면 이름과 종류를 말풍선으로 띄운다. 지도 데이터에는 이름과 종류만 있다.
  // 거리를 재는 중이거나 홀 선을 함께 눌렀으면(그 홀을 난다) 띄우지 않는다. 이름은 OpenStreetMap 글자라 HTML로 넣지 않는다
  function showPlace(e) {
    const map = mapRef.current;
    if (!map || measuringRef.current) return;
    if (map.queryRenderedFeatures(e.point, { layers: ["golf-hole"] }).length) return;
    const place = e.features[0];
    const name = place.properties["name:ko"] ?? place.properties.name;
    if (!name) return;
    const box = document.createElement("div");
    box.className = "place-popup";
    const title = document.createElement("strong");
    title.textContent = name;
    box.append(title);
    const kind = placeKind(place.properties);
    if (kind) {
      const line = document.createElement("span");
      line.textContent = kind;
      box.append(line);
    }
    popupRef.current?.remove();
    popupRef.current = new maplibregl.Popup({ offset: 10, maxWidth: "240px" }).setLngLat(place.geometry.coordinates).setDOMContent(box).addTo(map);
  }

  function toggleFlat() {
    const map = mapRef.current;
    if (!map) return;
    stop();
    map.easeTo({ pitch: flat ? VIEW.pitch : 0, duration: 800 });
    setFlat(!flat);
  }

  // 홀 전체를 옆에서 본다(티가 왼쪽, 그린이 오른쪽). 뒤에서 따라갈 때는 공 궤적이 세로 선으로만 보여서,
  // 다 날고 나면 옆에서 궤적 모양을 보여 준다
  function sideView(path, jump = false) {
    const map = mapRef.current;
    const side = (bearing(path[0], path.at(-1)) + 270) % 360;
    const lons = path.map(([lon]) => lon);
    const lats = path.map(([, lat]) => lat);
    const bounds = [
      [Math.min(...lons), Math.min(...lats)],
      [Math.max(...lons), Math.max(...lats)],
    ];
    const camera = map.cameraForBounds(bounds, { padding: { top: 90, bottom: 40, left: 40, right: 70 }, bearing: side });
    if (!camera) return;
    const view = { ...camera, bearing: side, pitch: 62 };
    if (jump) map.jumpTo(view);
    else map.easeTo({ ...view, duration: 1600 });
  }

  // index번 홀을 따라 날기: 티 뒤에서 그린 쪽을 보고 시작해, 홀 선을 따라 그린까지 간다.
  // 휘어진 홀(도그레그)도 따라가도록 늘 70m 앞을 바라보되, 공 궤적이 보이게 SIDE_ANGLE만큼 비스듬히 본다. run이 바뀌면(멈추면) 그만두고,
  // 그린에 닿으면 잠깐 쉬었다가 onDone을 부른다 (둘러보기에서 다음 홀로). 홀 하나만 날 때는 끝에 옆에서 본다
  function flyHole(index, run, onDone) {
    const map = mapRef.current;
    const hole = dataRef.current?.holes[index];
    if (!map || !hole) return;
    setFlat(false);
    highlight(index);
    const path = hole.coords;
    const total = lineLength(path);
    const look = (meters) => bearing(pointAlong(path, meters), pointAlong(path, Math.min(total, meters + 70)));
    const finish = () => {
      if (onDone) timerRef.current = setTimeout(() => run === runRef.current && onDone(), reducedMotion() ? 2500 : PAUSE_MS);
      else if (!reducedMotion()) timerRef.current = setTimeout(() => run === runRef.current && sideView(path), PAUSE_MS);
    };
    // 공 궤적. timing이 없으면 다 그린 채로, 있으면 timing(궤적들)이 정한 시각부터 공이 날아간다.
    // 그사이 다른 홀로 옮겼으면(번호가 바뀌면) 그리지 않는다
    const token = holeTokenRef.current;
    const arcs = holeArcs(index);
    const showArcs = (timing) =>
      arcs.then(
        (list) => token === holeTokenRef.current && shotsRef.current?.show("hole", list, timing?.(list) ?? null),
        () => {
          // 높이를 못 읽으면 궤적은 그리지 않는다
        },
      );
    // 샷마다 체감 거리는 궤적이 계산되는 대로 보여 준다 (카메라를 기다리지 않는다)
    arcs.then(
      (list) => token === holeTokenRef.current && setPlan({ index, shots: list.map(({ length, rise, bearing: dir }) => ({ length, rise, dir })) }),
      () => {},
    );
    if (reducedMotion()) {
      sideView(path, true);
      showArcs(null);
      finish();
      return;
    }
    map.flyTo({ center: path[0], bearing: look(0) + SIDE_ANGLE, zoom: 17, pitch: 66, duration: 1400 });
    map.once("moveend", () => {
      if (run !== runRef.current) {
        // 홀 선을 따라 날기 전에 멈췄으면 궤적만 그려 둔다
        showArcs(null);
        return;
      }
      // 둘러보기는 홀이 많아 조금 빨리 난다
      const duration = Math.min(10_000, Math.max(onDone ? 3500 : 4000, total * (onDone ? 11 : 14)));
      const begin = performance.now();
      // 카메라가 샷을 치는 곳에 닿을 때 공을 날린다. 앞 공이 아직 날고 있으면 떨어진 뒤에
      showArcs((list) => {
        let free = performance.now();
        return list.map((arc) => {
          const start = Math.max(begin + easeInOutInverse(total > 0 ? arc.at / total : 0) * duration, free);
          free = start + arc.ms + SHOT_PAUSE_MS;
          return start;
        });
      });
      let heading = look(0);
      const frame = (now) => {
        if (run !== runRef.current) return;
        const t = Math.min(1, (now - begin) / duration);
        const meters = easeInOut(t) * total;
        // 그린 가까이에서는 바라볼 앞쪽이 없어 방향이 흔들리므로 마지막 방향을 그대로 쓴다
        if (total - meters > 25) heading = look(meters);
        map.jumpTo({ center: pointAlong(path, meters), bearing: heading + SIDE_ANGLE, zoom: 17 + 0.3 * t, pitch: 66 - 6 * t });
        if (t < 1) frameRef.current = requestAnimationFrame(frame);
        else finish();
      };
      frameRef.current = requestAnimationFrame(frame);
    });
  }

  // 홀들을 차례로 날아간다. 다 돌면 코스 전체를 보여 준다
  function tour(indices, name) {
    stop();
    const run = runRef.current;
    const step = (k) => {
      if (run !== runRef.current) return;
      if (k >= indices.length) {
        overview();
        return;
      }
      setTouring({ name, step: k + 1, total: indices.length });
      flyHole(indices[k], run, () => step(k + 1));
    };
    step(0);
  }

  // 지도는 한 번만 만들고, 골프장이 바뀌면 아래에서 그 자리로 옮긴다
  useEffect(() => {
    const map = new maplibregl.Map({
      container: boxRef.current,
      style: STYLE_URL,
      center: [course.lon, course.lat],
      ...VIEW,
      maxPitch: 75,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    const shots = createShotLayer();
    shotsRef.current = shots;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("rotate", turnArrow);
    map.on("load", () => {
      koreanLabels(map);
      addLayers(map);
      // 공 궤적은 맨 위에 그린다
      map.addLayer(shots.layer);
      // 바탕 지도의 장소 글자·아이콘 레이어(OpenMapTiles poi). 레이어 이름은 바탕 지도 스타일마다 달라 데이터 층으로 찾는다
      const places = map.getStyle().layers.filter((l) => l["source-layer"] === "poi").map((l) => l.id);
      if (places.length) {
        map.on("click", places, showPlace);
        map.on("mouseenter", places, () => !measuringRef.current && (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", places, () => !measuringRef.current && (map.getCanvas().style.cursor = ""));
      }
      readyRef.current = true;
      map.getSource("golf").setData(toGeoJSON(dataRef.current));
      shownRef.current = dataId(dataRef.current);
      if (dataRef.current) overview();
    });
    map.on("error", (e) => {
      // 타일 하나 못 받는 것은 지도가 알아서 넘어간다. 그리기 자체가 안 될 때만 알린다
      if (/webgl/i.test(e.error?.message ?? "")) setError("이 브라우저에서는 3D 지도를 그릴 수 없습니다 (WebGL을 쓸 수 없음).");
    });
    // 사용자가 지도를 만지면 날기·돌기·둘러보기를 멈춘다
    for (const type of ["mousedown", "touchstart", "wheel"]) map.on(type, stop);
    // 거리를 재는 중에는 홀 선을 눌러도 날지 않고 점을 찍는다
    map.on("click", (e) => measuringRef.current && setPoints((list) => [...list, [e.lngLat.lng, e.lngLat.lat]]));
    map.on("click", "golf-hole", (e) => !measuringRef.current && onPickRef.current?.(e.features[0].properties.index));
    map.on("mouseenter", "golf-hole", () => !measuringRef.current && (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "golf-hole", () => !measuringRef.current && (map.getCanvas().style.cursor = ""));
    return () => {
      stop();
      readyRef.current = false;
      mapRef.current = null;
      shotsRef.current = null;
      map.remove();
    };
  }, []);

  // 찍은 점의 지형 높이를 읽는다
  useEffect(() => {
    if (!points.length) return undefined;
    const controller = new AbortController();
    heightsAt(points, controller.signal).then(
      (values) => setMeasured({ points, heights: values }),
      () => {
        // 높이를 못 읽으면 거리만 보여 준다
      },
    );
    return () => controller.abort();
  }, [points]);

  // 찍은 점과 구간 거리("152m +8m")를 지도에 그린다. 지도 글꼴에 없는 글자를 피해 숫자와 기호만 쓴다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const features = points.map((p) => ({ type: "Feature", properties: { kind: "point" }, geometry: { type: "Point", coordinates: p } }));
    if (points.length > 1) features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: points } });
    segments.forEach((seg, i) => {
      const rise = seg.rise == null ? "" : ` ${seg.rise >= 0 ? "+" : "-"}${Math.abs(Math.round(seg.rise))}m`;
      const middle = [(points[i][0] + points[i + 1][0]) / 2, (points[i][1] + points[i + 1][1]) / 2];
      features.push({ type: "Feature", properties: { kind: "label", label: `${Math.round(seg.length)}m${rise}` }, geometry: { type: "Point", coordinates: middle } });
    });
    map.getSource("measure").setData({ type: "FeatureCollection", features });
    map.getCanvas().style.cursor = measuring ? "crosshair" : "";
  }, [points, measured, measuring]);

  // 공 궤적 방식이면 찍은 점 사이로 공 궤적을 그린다. 점을 하나 더 찍으면 새 구간으로 공이 날아가고,
  // 일반에서 공 궤적으로 바꾸면 모든 구간을 차례로 날아간다
  useEffect(() => {
    const shots = shotsRef.current;
    if (!shots) return;
    const token = ++measureTokenRef.current;
    const shown = measureShownRef.current;
    if (measureMode !== "shot" || points.length < 2) {
      shots.clear("measure");
      measureShownRef.current = 0;
      return;
    }
    const pairs = points.slice(1).map((point, i) => [points[i], point]);
    buildArcs(pairs).then(
      (arcs) => {
        if (token !== measureTokenRef.current) return;
        measureShownRef.current = pairs.length;
        if (reducedMotion()) {
          shots.show("measure", arcs);
          return;
        }
        // 날릴 첫 구간: 아직 그린 게 없으면 처음부터, 점을 하나 더 찍었으면 새 구간만, 되돌렸으면 없음
        const from = shown === 0 ? 0 : pairs.length === shown + 1 ? pairs.length - 1 : arcs.length;
        let free = performance.now();
        const starts = arcs.map((arc, i) => {
          if (i < from) return null;
          const start = free;
          free = start + arc.ms + SHOT_PAUSE_MS;
          return start;
        });
        shots.show("measure", arcs, starts);
      },
      () => {
        // 높이를 못 읽으면 궤적은 그리지 않는다
      },
    );
  }, [points, measureMode]);

  // 골프장이 바뀌면 그 자리로 옮긴다
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    stop();
    setFlat(false);
    popupRef.current?.remove();
    map.jumpTo({ center: [course.lon, course.lat], ...VIEW });
    setPoints([]);
  }, [course.lat, course.lon]);

  // 골프장 데이터가 오면 그리고, 코스 전체가 보이게 한다.
  // 같은 골프장 데이터가 다시 들어오면(개발 서버가 파일을 다시 읽을 때 등) 카메라와 고른 홀을 그대로 둔다
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    map.getSource("golf").setData(toGeoJSON(data));
    if (dataId(data) === shownRef.current) return;
    shownRef.current = dataId(data);
    arcCacheRef.current = new Map();
    map.removeFeatureState({ source: "golf" });
    activeRef.current = null;
    highlight(null);
    if (data) overview();
  }, [data]);

  useEffect(turnArrow, [windDir]);

  // 목록이나 지도에서 홀을 고르면 그 홀을 날아간다
  useEffect(() => {
    if (!mapRef.current || !readyRef.current || !selected || !data?.holes[selected.index]) return;
    stop();
    flyHole(selected.index, runRef.current);
  }, [selected]);

  const holes = data?.holes ?? [];
  const groups = [...new Set(holes.map((h) => h.course).filter(Boolean))];
  const indicesOf = (name) => holes.flatMap((h, i) => (h.course === name ? [i] : []));

  return (
    <>
      <div className="course3d-map">
        <div ref={boxRef} className="course3d-canvas" />
        <div className="course3d-tools">
          <button type="button" onClick={showAll}>전체 보기</button>
          <button type="button" onClick={orbit}>한 바퀴</button>
          <button type="button" onClick={toggleFlat} aria-pressed={flat}>{flat ? "비스듬히" : "위에서"}</button>
          <button type="button" onClick={toggleMeasure} aria-pressed={measuring}>거리 재기</button>
        </div>
        {current != null && info?.[current] && (
          <p className="course3d-caption" aria-live="polite">
            {touring && <span className="step">{touring.step}/{touring.total}</span>}
            {info[current]}
          </p>
        )}
        {windDir != null && windSpeed != null && (
          <div className="course3d-badge" role="img" aria-label={`바람 ${windSpeed.toFixed(1)}m/s, 화살표 쪽으로 분다`}>
            <span ref={arrowRef} className="wind-arrow" aria-hidden="true">↑</span>
            <span>{windSpeed.toFixed(1)}m/s</span>
          </div>
        )}
        {error && <p className="course3d-error" role="alert">{error}</p>}
      </div>
      {measuring && (
        <div className="course3d-measure">
          <div className="measure-head">
            <strong>📏 거리 재기</strong>
            <div className="measure-mode" role="group" aria-label="재는 방식">
              {MEASURE_MODES.map(([key, name]) => (
                <button
                  key={key}
                  type="button"
                  className={measureMode === key ? "active" : ""}
                  aria-pressed={measureMode === key}
                  onClick={() => setMeasureMode(key)}
                >
                  {name}
                </button>
              ))}
            </div>
            <button type="button" className="secondary" disabled={!points.length} onClick={() => setPoints((list) => list.slice(0, -1))}>
              되돌리기
            </button>
            <button type="button" className="secondary" disabled={!points.length} onClick={() => setPoints([])}>지우기</button>
          </div>
          {segments.length === 0 ? (
            <p className="course3d-note">
              {measureMode === "shot"
                ? "지도를 눌러 점을 찍으세요. 티 → 떨어질 곳 → 그린 순서로 찍으면 점 사이로 공이 날아가고, 구간마다 바람과 높낮이를 넣은 체감 거리를 보여 줍니다."
                : "지도를 눌러 점을 찍으세요. 두 점 사이 거리와 높이 차를 잽니다. 여러 점을 찍으면 구간마다 잽니다."}
            </p>
          ) : (
            <ol className="measure-list">
              {segments.map((seg, i) => (
                <li key={i}>
                  <span className="muted">{i + 1}→{i + 2}</span> <strong>{Math.round(seg.length)}m</strong>
                  {seg.rise == null
                    ? " · 높이 재는 중"
                    : ` · ${measureMode === "shot" ? playsLine(seg.length, seg.rise, seg.wind) : slopeText(seg.rise)}`}
                </li>
              ))}
              {segments.length > 1 && (
                <li className="measure-total">
                  합계 <strong>{Math.round(segments.reduce((sum, seg) => sum + seg.length, 0))}m</strong>
                  {measureMode === "shot" &&
                    segments.every((seg) => seg.plays != null) &&
                    ` · 체감 약 ${Math.round(segments.reduce((sum, seg) => sum + seg.plays, 0))}m`}
                </li>
              )}
            </ol>
          )}
          {segments.length > 0 && (
            <p className="weather-note">{measureMode === "shot" ? playsNote(wind) : "높이는 약 30m 간격 지형 자료로 잽니다."}</p>
          )}
        </div>
      )}
      {holes.length > 0 && (
        <div className="course3d-tour">
          <span className="course3d-label">코스 둘러보기</span>
          {touring ? (
            <button type="button" className="secondary" onClick={() => stop()}>
              멈추기 · {touring.name} {touring.step}/{touring.total}
            </button>
          ) : (
            <>
              <button type="button" onClick={() => tour(holes.map((_, i) => i), "전체")}>전체 {holes.length}홀</button>
              {groups.length > 1 &&
                groups.map((name) => (
                  <button key={name} type="button" className="secondary" onClick={() => tour(indicesOf(name), courseName(name))}>
                    {courseName(name)} {indicesOf(name).length}홀
                  </button>
                ))}
            </>
          )}
        </div>
      )}
      {plan && plan.index === current && holes[current] && (
        <div className="course3d-measure">
          <div className="measure-head">
            <strong>🏌️ {holes[current].label} 샷마다 체감 거리 (공 궤적 기준)</strong>
          </div>
          <ol className="measure-list">
            {plan.shots.map((shot, i) => (
              <li key={i}>
                <span className="muted">{SHOT_NAMES[i] ?? `${i + 1}번째 샷`}</span> <strong>{Math.round(shot.length)}m</strong> ·{" "}
                {playsLine(shot.length, shot.rise, wind && windParts(shot.dir, wind.dir, wind.speed))}
              </li>
            ))}
          </ol>
          <p className="weather-note">{playsNote(wind)}</p>
        </div>
      )}
    </>
  );
}
