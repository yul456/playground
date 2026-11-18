import { useEffect, useLayoutEffect, useRef } from "react";
import { number } from "../shared/format.js";
import { clampView, placement, TILE, tileKey, tilesIn } from "./tiles.js";
import { ZOOMS } from "./versions.js";

// 그림을 캔버스에 칸(타일)으로 그리는 보기 칸. 나란히(side)면 판마다 캔버스 하나, 번갈아(flip)면 캔버스 하나에 고른 판을 그린다.
// 모든 판이 같은 자리(view)를 본다. 보는 자리는 React 상태가 아니라 ref에 두고, 바뀌면 다음 프레임에 캔버스만 다시 그린다
// (끄는 동안 화면 전체를 다시 그리지 않으려고).
// 캔버스는 화면 화소 크기로 만든다(devicePixelContentBoxSize). 배율 1이면 그림 화소 하나가 화면 화소 하나다

// 아직 오지 않은 칸에 깔 무늬 (흰 그림과 헷갈리지 않게)
let waitingPattern = null;
function waitingFill(ctx) {
  if (!waitingPattern) {
    const tile = document.createElement("canvas");
    tile.width = 16;
    tile.height = 16;
    const t = tile.getContext("2d");
    t.fillStyle = "#e2e8f0";
    t.fillRect(0, 0, 16, 16);
    t.fillStyle = "#cbd5e1";
    t.fillRect(0, 0, 8, 8);
    t.fillRect(8, 8, 8, 8);
    waitingPattern = tile;
  }
  return ctx.createPattern(waitingPattern, "repeat");
}

// 캔버스 크기를 화면 화소로 맞춘다. 바뀌었으면 true
function fitCanvas(canvas, entry) {
  const box = entry.devicePixelContentBoxSize?.[0];
  const w = box ? box.inlineSize : Math.round(entry.contentRect.width * devicePixelRatio);
  const h = box ? box.blockSize : Math.round(entry.contentRect.height * devicePixelRatio);
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

// 화면(CSS) 1px이 화면 화소 몇 개인지. 캔버스 폭 ÷ CSS 폭으로 셈하면 CSS 폭이 반올림돼 있어 조금씩 어긋난다
const ratioOf = () => window.devicePixelRatio || 1;

const isTyping = (target) => target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));

export default function Viewer({ session, image, overview, versions, mode, current, zoom, onFlip, onZoom }) {
  const viewRef = useRef({ x: 0, y: 0 });
  const canvasesRef = useRef(new Map()); // 판 id(번갈아는 "flip") → canvas
  const mapRef = useRef(null);
  const boxRef = useRef(null);
  const placeRef = useRef(null); // 보는 자리 글
  const frameRef = useRef(0);
  const dragRef = useRef(null);
  const zoomRef = useRef(zoom);
  const prevRef = useRef(null); // 번갈아 보기에서 바로 앞에 본 판 (Space로 돌아간다)
  const lastCurrent = useRef(current);
  // 그리는 함수가 늘 지금 값을 보게 한다 (requestAnimationFrame과 이벤트에서 부른다)
  const live = useRef({});
  live.current = { session, image, overview, versions, mode, current, zoom, onFlip, onZoom };

  if (lastCurrent.current !== current) {
    prevRef.current = lastCurrent.current;
    lastCurrent.current = current;
  }

  // 지금 그리는 캔버스들 [{ id, canvas }]
  function targets() {
    const { mode: m, current: cur, versions: list } = live.current;
    const canvases = canvasesRef.current;
    if (m === "flip") return canvases.get("flip") && cur ? [{ id: cur, canvas: canvases.get("flip") }] : [];
    return list.map((v) => ({ id: v.id, canvas: canvases.get(v.id) })).filter((t) => t.canvas);
  }

  // 보는 자리를 맞출 칸 크기 (나란히면 가장 작은 칸)
  function panelSize() {
    let size = null;
    for (const { canvas } of targets()) {
      if (!canvas.width || !canvas.height) continue;
      if (!size) size = { w: canvas.width, h: canvas.height };
      else size = { w: Math.min(size.w, canvas.width), h: Math.min(size.h, canvas.height) };
    }
    return size;
  }

  function draw() {
    frameRef.current = 0;
    const { session: s, image: img, mode: m, versions: list, zoom: z } = live.current;
    if (!s || !img) return;
    const size = panelSize();
    if (!size) return;
    viewRef.current = clampView(viewRef.current, z, size, img);
    s.begin();
    const now = [];
    const soon = [];
    const ids = [];
    for (const { id, canvas } of targets()) {
      ids.push(id);
      drawPanel(s, img, z, id, canvas, now);
    }
    // 다음에 볼 칸을 미리 만들어 둔다: 번갈아면 다른 판의 같은 자리(바꿔 볼 때 바로 보이게), 그다음 위아래 한 칸씩
    const { rect } = placement(viewRef.current, z, size, img);
    const others = m === "flip" ? list.map((v) => v.id).filter((id) => !ids.includes(id)) : [];
    for (const id of others) for (const tile of tilesIn(rect, img.w, img.cuts)) soon.push({ key: tileKey(id, tile), version: id, tile });
    const around = { x: rect.x, y: rect.y - TILE, w: rect.w, h: rect.h + 2 * TILE };
    for (const id of [...ids, ...others]) {
      for (const tile of tilesIn(around, img.w, img.cuts)) soon.push({ key: tileKey(id, tile), version: id, tile });
    }
    const seen = new Set(now.map((job) => job.key));
    s.want([...now, ...soon.filter((job) => !seen.has(job.key) && seen.add(job.key))]);
    drawMap(rect);
    writePlace(rect, img);
    // 보는 자리와 아직 오지 않은 칸 수를 적어 둔다 (시험이 읽는다)
    const box = boxRef.current;
    if (box) {
      box.dataset.x = String(Math.round(viewRef.current.x));
      box.dataset.y = String(Math.round(viewRef.current.y));
      box.dataset.waiting = String(now.length);
    }
  }

  function drawPanel(s, img, z, id, canvas, jobs) {
    const ctx = canvas.getContext("2d");
    const size = { w: canvas.width, h: canvas.height };
    const { left, top, rect } = placement(viewRef.current, z, size, img);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.imageSmoothingEnabled = false;
    // 투명한 곳은 흰 바탕으로 보인다 (JPG로 바꿀 때와 같다)
    const ix = Math.max(0, left);
    const iy = Math.max(0, top);
    ctx.fillStyle = "#fff";
    ctx.fillRect(ix, iy, Math.min(size.w, left + img.w * z) - ix, Math.min(size.h, top + img.h * z) - iy);
    for (const tile of tilesIn(rect, img.w, img.cuts)) {
      const x0 = Math.max(tile.x, rect.x);
      const y0 = Math.max(tile.y, rect.y);
      const x1 = Math.min(tile.x + tile.w, rect.x + rect.w);
      const y1 = Math.min(tile.y + tile.h, rect.y + rect.h);
      if (x1 <= x0 || y1 <= y0) continue;
      const key = tileKey(id, tile);
      const entry = s.tile(key);
      const dx = left + x0 * z;
      const dy = top + y0 * z;
      if (entry) {
        ctx.drawImage(entry.bitmap, entry.sx + x0 - tile.x, entry.sy + y0 - tile.y, x1 - x0, y1 - y0, dx, dy, (x1 - x0) * z, (y1 - y0) * z);
      } else {
        ctx.fillStyle = waitingFill(ctx);
        ctx.fillRect(dx, dy, (x1 - x0) * z, (y1 - y0) * z);
        jobs.push({ key, version: id, tile });
      }
    }
  }

  // 옆의 띠: 그림 전체를 줄여 보이고, 보고 있는 곳을 네모로 표시한다. 긴 그림은 띠 높이에 맞춰 세로로 눌러 보인다
  function drawMap(rect) {
    const canvas = mapRef.current;
    const { overview: ov, image: img } = live.current;
    if (!canvas || !canvas.width || !ov) return;
    const ctx = canvas.getContext("2d");
    const { width: w, height: h } = canvas;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const sx = w / img.w;
    const sy = Math.min(sx, h / img.h);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, img.h * sy);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(ov, 0, 0, w, img.h * sy);
    const r = ratioOf();
    // JPG가 나뉘는 자리
    ctx.fillStyle = "#f59e0b";
    for (const cut of img.cuts.slice(1, -1)) ctx.fillRect(0, Math.round(cut * sy - r), w, Math.max(1, Math.round(2 * r)));
    // 보고 있는 곳: 옅은 파랑으로 덮고 안쪽에 테두리를 그린다 (띠 끝에서도 테두리가 잘리지 않게)
    const lw = Math.max(1, Math.round(2 * r));
    const bh = Math.max(rect.h * sy, 6 * r);
    const box = { x: rect.x * sx, y: Math.min(rect.y * sy, img.h * sy - bh), w: Math.max(rect.w * sx, 2 * lw), h: bh };
    ctx.fillStyle = "rgba(37, 99, 235, 0.3)";
    ctx.fillRect(box.x, box.y, box.w, box.h);
    ctx.lineWidth = lw;
    ctx.strokeStyle = "#1d4ed8";
    ctx.strokeRect(box.x + lw / 2, box.y + lw / 2, box.w - lw, box.h - lw);
  }

  function writePlace(rect, img) {
    const el = placeRef.current;
    if (!el) return;
    const bottom = Math.min(img.h, rect.y + rect.h);
    let text = `${number(rect.y)} ~ ${number(bottom)}px / ${number(img.h)}px`;
    const parts = img.cuts.length - 1;
    if (parts > 1) {
      const first = img.cuts.findLastIndex((cut, k) => k < parts && cut <= rect.y);
      text += ` · JPG ${parts}장 중 ${first + 1}번째`;
    }
    el.textContent = text;
  }

  function redraw() {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
  }

  // 보는 자리를 옮긴다 (그림 화소). 실제로 옮겼으면 true
  function move(dx, dy) {
    const { image: img, zoom: z } = live.current;
    const size = panelSize();
    if (!img || !size) return false;
    const before = viewRef.current;
    const next = clampView({ x: before.x + dx, y: before.y + dy }, z, size, img);
    viewRef.current = next;
    redraw();
    return Math.round(next.x) !== Math.round(before.x) || Math.round(next.y) !== Math.round(before.y);
  }

  // 그림의 어느 점을 보는 곳 가운데에 둔다
  function centerOn(x, y) {
    const { zoom: z } = live.current;
    const size = panelSize();
    if (!size) return;
    viewRef.current = { x: x - size.w / z / 2, y: y - size.h / z / 2 };
    move(0, 0);
  }

  useEffect(() => {
    if (!session) return undefined;
    session.redraw = redraw;
    return () => {
      if (session.redraw === redraw) session.redraw = null;
    };
  });

  // 새 그림을 열면 맨 위에서 본다
  useLayoutEffect(() => {
    viewRef.current = { x: 0, y: 0 };
  }, [image?.w, image?.h, session]);

  // 배율을 바꾸면 보던 곳의 가운데를 그대로 둔다
  useLayoutEffect(() => {
    const before = zoomRef.current;
    zoomRef.current = zoom;
    const size = panelSize();
    if (before === zoom || !size) return;
    const v = viewRef.current;
    const cx = v.x + size.w / before / 2;
    const cy = v.y + size.h / before / 2;
    viewRef.current = { x: cx - size.w / zoom / 2, y: cy - size.h / zoom / 2 };
  }, [zoom]);

  // 무엇이든 바뀌면 다시 그린다
  useEffect(() => {
    redraw();
  });

  // 캔버스 크기가 바뀌면 화면 화소로 다시 맞춘다
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) changed = fitCanvas(entry.target, entry) || changed;
      if (changed) redraw();
    });
    const all = [...canvasesRef.current.values(), mapRef.current].filter(Boolean);
    for (const canvas of all) {
      try {
        observer.observe(canvas, { box: "device-pixel-content-box" });
      } catch {
        observer.observe(canvas);
      }
    }
    return () => observer.disconnect();
  }, [mode, versions.map((v) => v.id).join(",")]);

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  // 휠로 위아래(Shift면 옆으로) 옮긴다. 그림 끝에 닿아 더 옮길 수 없으면 페이지가 스크롤되게 둔다
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const onWheel = (e) => {
      if (e.ctrlKey) return; // 트랙패드 오므리기(브라우저 확대)
      const canvas = targets()[0]?.canvas;
      if (!canvas) return;
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.deltaMode === 1) {
        dx *= 40;
        dy *= 40;
      } else if (e.deltaMode === 2) {
        dx *= canvas.clientWidth;
        dy *= canvas.clientHeight;
      }
      if (e.shiftKey && !dx) {
        dx = dy;
        dy = 0;
      }
      const k = ratioOf() / live.current.zoom;
      if (move(dx * k, dy * k)) e.preventDefault();
    };
    box.addEventListener("wheel", onWheel, { passive: false });
    return () => box.removeEventListener("wheel", onWheel);
  });

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ratio: ratioOf() };
    boxRef.current?.focus({ preventScroll: true });
  }

  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const k = drag.ratio / live.current.zoom;
    move(-(e.clientX - drag.x) * k, -(e.clientY - drag.y) * k);
    drag.x = e.clientX;
    drag.y = e.clientY;
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  // 옆의 띠를 누르거나 끌면 그 자리로 간다
  function onMap(e) {
    if (e.type === "pointerdown") {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { map: true };
      boxRef.current?.focus({ preventScroll: true });
    } else if (!dragRef.current?.map) return;
    const canvas = mapRef.current;
    const { image: img } = live.current;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * canvas.width;
    const y = ((e.clientY - r.top) / r.height) * canvas.height;
    const sx = canvas.width / img.w;
    const sy = Math.min(sx, canvas.height / img.h);
    centerOn(x / sx, y / sy);
  }

  function onKeyDown(e) {
    if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
    const { versions: list, mode: m, zoom: z } = live.current;
    const size = panelSize();
    if (!size) return;
    const page = (size.h / z) * 0.9;
    const step = Math.max(32, (size.h / z) * 0.1);
    const keys = {
      ArrowDown: () => move(0, step),
      ArrowUp: () => move(0, -step),
      ArrowRight: () => move(Math.max(32, (size.w / z) * 0.1), 0),
      ArrowLeft: () => move(-Math.max(32, (size.w / z) * 0.1), 0),
      PageDown: () => move(0, page),
      PageUp: () => move(0, -page),
      Home: () => move(-Infinity, -Infinity),
      End: () => move(0, Infinity),
      "+": () => onZoom(ZOOMS.find((value) => value > z) ?? z),
      "=": () => onZoom(ZOOMS.find((value) => value > z) ?? z),
      "-": () => onZoom(ZOOMS.findLast((value) => value < z) ?? z),
    };
    let handled = keys[e.key];
    if (e.key === " ") {
      // 번갈아 보기에서는 바로 앞에 본 판으로, 나란히면 한 화면씩 내린다
      if (m === "flip" && prevRef.current && list.some((v) => v.id === prevRef.current)) handled = () => onFlip(prevRef.current);
      else handled = () => move(0, e.shiftKey ? -page : page);
    } else if (m === "flip" && /^[1-9]$/.test(e.key)) {
      const version = list[Number(e.key) - 1];
      if (version) handled = () => onFlip(version.id);
    }
    if (!handled) return;
    e.preventDefault();
    handled();
  }

  const setCanvas = (id) => (el) => {
    if (el) canvasesRef.current.set(id, el);
    else canvasesRef.current.delete(id);
  };

  const panel = (id, label, detail) => (
    <div className="pc-panel" key={id}>
      <div className="pc-panel-head" title={detail ? `${label} · ${detail}` : label}>
        <strong>{label}</strong>
        {detail && <span>{detail}</span>}
      </div>
      <div className="pc-canvas-box">
        <canvas
          ref={setCanvas(id)}
          aria-label={`${label} 그림`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );

  const shown = versions.find((v) => v.id === current);
  return (
    <div className="pc-viewer-wrap">
      {mode === "flip" && (
        <div className="pc-tabs" role="tablist" aria-label="볼 판">
          {versions.map((v, i) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={v.id === current}
              className={v.id === current ? "on" : undefined}
              onClick={() => onFlip(v.id)}
            >
              <kbd>{i + 1}</kbd> {v.label}
            </button>
          ))}
        </div>
      )}
      <div className="pc-viewer" ref={boxRef} tabIndex={0} onKeyDown={onKeyDown} aria-label="그림 보기 칸. 화살표·PageUp·PageDown·Home·End로 옮깁니다">
        <div className={`pc-panels ${mode}`}>
          {mode === "flip" ? shown && panel("flip", shown.label, shown.detail) : versions.map((v) => panel(v.id, v.label, v.detail))}
        </div>
        <div className="pc-map">
          <canvas
            ref={mapRef}
            aria-label="그림 전체. 누르면 그 자리로 갑니다"
            onPointerDown={onMap}
            onPointerMove={onMap}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
        </div>
      </div>
      <p className="pc-place" ref={placeRef} aria-live="off" />
    </div>
  );
}
