import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { bearing, heightsAt, lineLength, measureSegments, pointAlong, slopeText, TERRAIN_TILES } from "./course3d.js";

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
// 그린에 닿은 뒤 다음 홀로 가기 전에 잠깐 멈추는 시간
const PAUSE_MS = 700;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// 둘러보기 버튼 이름. "A" → "A 코스", "북코스" → 그대로
const courseName = (name) => (/코스$/.test(name) ? name : `${name} 코스`);
// 같은 골프장 데이터인지 알아보는 값
const dataId = (data) => (data ? `${data.name}|${data.updated}` : null);

// 3D 지형 위에 골프장(data가 있으면 홀·그린·경계)을 그린다. selected({ index, nonce })가 바뀌면 그 홀을
// 티에서 그린까지 날아가고, 아래 "코스 둘러보기"로 전체나 코스 하나의 홀을 차례로 날아간다.
// info[i]는 날아가는 동안 지도에 띄울 i번 홀 설명, onActive(i)는 지금 보여 주는 홀이 바뀔 때,
// onPick(i)은 지도에서 홀 선을 눌렀을 때 부른다. windDir(풍향, 불어오는 쪽)·windSpeed(m/s)가 있으면
// 지도 위에 바람 화살표를 띄우고, 지도를 돌리면 화살표도 같이 돈다
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
  const measuringRef = useRef(false);
  measuringRef.current = measuring;
  const [points, setPoints] = useState([]);
  const [measured, setMeasured] = useState({ points: [], heights: [] });
  const heights = measured.points === points ? measured.heights : [];
  const segments = measureSegments(points, heights);
  // 바람 화살표는 지도가 돌 때마다(날기 중엔 화면마다) 돌리므로 다시 그리지 않고 스타일만 바꾼다
  const windRef = useRef(windDir);
  windRef.current = windDir;
  const arrowRef = useRef(null);

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

  // 지도의 노란 홀 선, 지도 위 설명, 아래 목록 표시를 이 홀로 옮긴다 (null이면 지운다)
  function highlight(index) {
    const map = mapRef.current;
    if (activeRef.current != null) map.setFeatureState({ source: "golf", id: activeRef.current }, { selected: false });
    if (index != null) map.setFeatureState({ source: "golf", id: index }, { selected: true });
    activeRef.current = index;
    setCurrent(index);
    onActiveRef.current?.(index);
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
    setMeasuring(!measuring);
    setPoints([]);
  }

  function toggleFlat() {
    const map = mapRef.current;
    if (!map) return;
    stop();
    map.easeTo({ pitch: flat ? VIEW.pitch : 0, duration: 800 });
    setFlat(!flat);
  }

  // index번 홀을 따라 날기: 티 뒤에서 그린 쪽을 보고 시작해, 홀 선을 따라 그린까지 간다.
  // 휘어진 홀(도그레그)도 따라가도록 늘 70m 앞을 바라본다. run이 바뀌면(멈추면) 그만두고,
  // 그린에 닿으면 잠깐 쉬었다가 onDone을 부른다 (둘러보기에서 다음 홀로)
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
    };
    if (reducedMotion()) {
      map.jumpTo({ center: path.at(-1), bearing: look(Math.max(0, total - 70)), zoom: 17.3, pitch: 60 });
      finish();
      return;
    }
    map.flyTo({ center: path[0], bearing: look(0), zoom: 17, pitch: 66, duration: 1400 });
    map.once("moveend", () => {
      if (run !== runRef.current) return;
      // 둘러보기는 홀이 많아 조금 빨리 난다
      const duration = Math.min(10_000, Math.max(onDone ? 3500 : 4000, total * (onDone ? 11 : 14)));
      const begin = performance.now();
      let heading = look(0);
      const frame = (now) => {
        if (run !== runRef.current) return;
        const t = Math.min(1, (now - begin) / duration);
        const meters = easeInOut(t) * total;
        // 그린 가까이에서는 바라볼 앞쪽이 없어 방향이 흔들리므로 마지막 방향을 그대로 쓴다
        if (total - meters > 25) heading = look(meters);
        map.jumpTo({ center: pointAlong(path, meters), bearing: heading, zoom: 17 + 0.3 * t, pitch: 66 - 6 * t });
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
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), "top-right");
    map.on("rotate", turnArrow);
    map.on("load", () => {
      koreanLabels(map);
      addLayers(map);
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

  // 골프장이 바뀌면 그 자리로 옮긴다
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    stop();
    setFlat(false);
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
          <button type="button" onClick={overview}>전체 보기</button>
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
            <button type="button" className="secondary" disabled={!points.length} onClick={() => setPoints((list) => list.slice(0, -1))}>
              되돌리기
            </button>
            <button type="button" className="secondary" disabled={!points.length} onClick={() => setPoints([])}>지우기</button>
          </div>
          {segments.length === 0 ? (
            <p className="course3d-note">
              지도를 눌러 점을 찍으세요. 두 점 사이 거리와 높이 차를 잽니다. 여러 점을 찍으면(티 → 떨어질 곳 → 그린) 구간마다 잽니다.
            </p>
          ) : (
            <ol className="measure-list">
              {segments.map((seg, i) => (
                <li key={i}>
                  <span className="muted">{i + 1}→{i + 2}</span> <strong>{Math.round(seg.length)}m</strong>
                  {seg.rise == null ? " · 높이 재는 중" : ` · ${slopeText(seg.rise)} · 체감 약 ${Math.round(seg.plays)}m`}
                </li>
              ))}
              {segments.length > 1 && (
                <li className="measure-total">
                  합계 <strong>{Math.round(segments.reduce((sum, seg) => sum + seg.length, 0))}m</strong>
                  {segments.every((seg) => seg.plays != null) &&
                    ` · 체감 약 ${Math.round(segments.reduce((sum, seg) => sum + seg.plays, 0))}m`}
                </li>
              )}
            </ol>
          )}
          {segments.length > 0 && (
            <p className="weather-note">체감 거리는 오르막 1m를 거리 1m로 친 대략값입니다(내리막은 그만큼 짧게). 높이는 약 30m 간격 지형 자료로 잽니다.</p>
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
    </>
  );
}
