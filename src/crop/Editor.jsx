import { useEffect, useRef, useState } from "react";
import { snapEdge } from "./regions.js";

// 자를 곳을 고치는 칸. 왼쪽은 사진 전체(화면에 맞춰 줄임)에 남길 곳을 밝게 보이고, 오른쪽 확대 칸은 화소 하나하나가 보이게 크게 보인다
// (사진 위에서는 마우스 밑, 줄을 고칠 때는 그 줄 근처. drawLoupe). 줄인 사진에서는 1px을 정확히 맞추기 어려워서, 확대 칸과
// 화살표 키(1px, Shift는 10px)로 맞춘다.
// 자를 줄을 끌어 옮기고, 줄 밖에서 끌면 그림판처럼 새 네모를 그린다. 모서리를 끌면 두 줄이 함께 움직인다.
// 끌지 않고 누르면 onPick(x, y, alt)을 부른다 (누른 곳을 둘러싼 테두리 안쪽에 맞추기, regions.js)
// 줄을 끌 때 가까이에 사진 속 직선 경계(색이 바뀌는 곧은 줄)가 있으면 거기에 붙는다(초록색으로 보인다). Alt를 누른 채 끌면 붙지 않는다.
// pixels: 사진의 화소 { width, height, data } (없으면 붙이지 않는다)
// crop: { top, bottom, left, right } (각 쪽에서 잘라 낼 화소 수), active: 고르고 있는 줄 (top · bottom · left · right)

// 줄을 잡았다고 볼 거리 (CSS px)
const HIT = 12;
// 확대 칸에서 그림 화소 하나를 그리는 크기 (CSS px)
const ZOOM = 8;
const SIDE_NAMES = { top: "위", bottom: "아래", left: "왼쪽", right: "오른쪽" };
const CURSORS = { top: "ns-resize", bottom: "ns-resize", left: "ew-resize", right: "ew-resize" };
// 이 거리(CSS px) 안의 직선 경계에 붙는다
const SNAP = 10;
const SNAPPED = "#16a34a";

// onChange(crop, kind): kind는 되돌리기 단위를 정한다 (live: 끄는 중, key: 화살표 키). 끌기를 시작하면 onBegin()을 한 번 부른다
export default function Editor({ bitmap, pixels, width, height, crop, onChange, onBegin, active, onActive, onPick, label }) {
  const stageRef = useRef(null);
  const mainRef = useRef(null);
  const loupeRef = useRef(null);
  const labelRef = useRef(null);
  const layoutRef = useRef(null);
  // 확대 칸이 보이는 것: pointer(마우스 밑) · line(고르고 있는 줄 근처)
  const modeRef = useRef("line");
  // 이번에 자를 곳이 바뀐 것이 마우스로 끈 것인지 (아니면 확대 칸을 줄로 돌린다)
  const pointerEditRef = useRef(false);
  const dragRef = useRef(null);
  // 확대 칸의 가운데로 삼을 자리 (그림 좌표). 마우스를 따라간다
  const focusRef = useRef({ x: width / 2, y: height / 2 });
  const [cursor, setCursor] = useState("crosshair");
  // 끄는 동안 직선 경계에 붙은 줄들
  const [snapped, setSnapped] = useState([]);
  const [, redraw] = useState(0);

  useEffect(() => {
    focusRef.current = { x: width / 2, y: height / 2 };
  }, [width, height]);

  // 사진을 칸 폭과 화면 높이에 맞춘다 (키우는 것은 2배까지)
  function layout() {
    const stage = stageRef.current;
    const canvas = mainRef.current;
    if (!stage || !canvas) return null;
    const maxH = Math.max(240, Math.round(window.innerHeight * 0.72));
    const scale = Math.min(stage.clientWidth / width, maxH / height, 2);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    layoutRef.current = { scale: w / width, w, h, dpr };
    return layoutRef.current;
  }

  function drawMain() {
    const canvas = mainRef.current;
    const L = layout();
    if (!canvas || !L) return;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    ctx.clearRect(0, 0, L.w, L.h);
    if (bitmap) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, L.w, L.h);
    }
    const s = L.scale;
    const x0 = crop.left * s;
    const x1 = (width - crop.right) * s;
    const y0 = crop.top * s;
    const y1 = (height - crop.bottom) * s;
    // 잘라 낼 곳은 어둡게
    ctx.fillStyle = "rgba(15, 23, 42, 0.62)";
    ctx.fillRect(0, 0, L.w, y0);
    ctx.fillRect(0, y1, L.w, L.h - y1);
    ctx.fillRect(0, y0, x0, y1 - y0);
    ctx.fillRect(x1, y0, L.w - x1, y1 - y0);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
    ctx.strokeRect(x0 + 0.5, y0 + 0.5, Math.max(0, x1 - x0 - 1), Math.max(0, y1 - y0 - 1));
    // 직선 경계에 붙은 줄은 초록색
    ctx.strokeStyle = SNAPPED;
    ctx.lineWidth = 3;
    for (const edge of snapped) {
      if (edge === active) continue;
      ctx.beginPath();
      if (edge === "top" || edge === "bottom") {
        const y = edge === "top" ? y0 : y1;
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
      } else {
        const x = edge === "left" ? x0 : x1;
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
      }
      ctx.stroke();
    }
    // 고르고 있는 줄
    ctx.strokeStyle = snapped.includes(active) ? SNAPPED : "#f59e0b";
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (active === "top" || active === "bottom") {
      const y = active === "top" ? y0 : y1;
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
    } else {
      const x = active === "left" ? x0 : x1;
      ctx.moveTo(x, y0);
      ctx.lineTo(x, y1);
    }
    ctx.stroke();
    // 줄 가운데의 손잡이
    ctx.fillStyle = "#fff";
    const knob = (x, y) => {
      ctx.fillRect(x - 5, y - 5, 10, 10);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 5 + 0.5, y - 5 + 0.5, 9, 9);
    };
    knob((x0 + x1) / 2, y0);
    knob((x0 + x1) / 2, y1);
    knob(x0, (y0 + y1) / 2);
    knob(x1, (y0 + y1) / 2);
  }

  // 확대 칸. 사진 위에서 마우스를 움직이는 동안은 마우스 밑을 보이고(가운데 화소에 네모), 줄을 끌거나 화살표 키·숫자 칸·단추로
  // 고친 뒤에는 고르고 있는 줄 근처를 보인다(줄이 가운데, 줄을 따라서는 마지막 마우스 자리). 마우스를 다시 움직이면 마우스 밑으로 돌아간다.
  // 잘라 낼 곳은 어둡게, 보이는 자를 줄은 모두 주황색으로(고르고 있는 줄은 굵게) 긋고, 위에 무엇을 보는지 글로 적는다
  function drawLoupe() {
    const canvas = loupeRef.current;
    if (!canvas) return;
    const cssW = canvas.clientWidth;
    const cssH = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#cbd5e1";
    ctx.fillRect(0, 0, cssW, cssH);
    const label = labelRef.current;
    if (!bitmap) {
      if (label) label.textContent = "";
      return;
    }
    const cols = Math.ceil(cssW / ZOOM);
    const rows = Math.ceil(cssH / ZOOM);
    const focus = focusRef.current;
    const fx = Math.min(width - 1, Math.max(0, Math.floor(focus.x)));
    const fy = Math.min(height - 1, Math.max(0, Math.floor(focus.y)));
    const pointer = modeRef.current === "pointer";
    const horizontal = active === "top" || active === "bottom";
    const edgeY = active === "top" ? crop.top : height - crop.bottom;
    const edgeX = active === "left" ? crop.left : width - crop.right;
    let sx = fx - Math.floor(cols / 2);
    let sy = fy - Math.floor(rows / 2);
    if (!pointer && horizontal) sy = edgeY - Math.floor(rows / 2);
    if (!pointer && !horizontal) sx = edgeX - Math.floor(cols / 2);
    const ix0 = Math.max(0, sx);
    const iy0 = Math.max(0, sy);
    const ix1 = Math.min(width, sx + cols);
    const iy1 = Math.min(height, sy + rows);
    ctx.imageSmoothingEnabled = false;
    if (ix1 > ix0 && iy1 > iy0) {
      ctx.drawImage(bitmap, ix0, iy0, ix1 - ix0, iy1 - iy0, (ix0 - sx) * ZOOM, (iy0 - sy) * ZOOM, (ix1 - ix0) * ZOOM, (iy1 - iy0) * ZOOM);
    }
    // 남길 네모(확대 칸 좌표) 밖은 어둡게
    const kx0 = (crop.left - sx) * ZOOM;
    const kx1 = (width - crop.right - sx) * ZOOM;
    const ky0 = (crop.top - sy) * ZOOM;
    const ky1 = (height - crop.bottom - sy) * ZOOM;
    const clampX = (x) => Math.min(cssW, Math.max(0, x));
    const clampY = (y) => Math.min(cssH, Math.max(0, y));
    const shade = (x0, y0, x1, y1) => {
      const a = clampX(x0);
      const b = clampY(y0);
      const c = clampX(x1);
      const d = clampY(y1);
      if (c > a && d > b) ctx.fillRect(a, b, c - a, d - b);
    };
    ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
    shade(0, 0, cssW, ky0);
    shade(0, ky1, cssW, cssH);
    shade(0, ky0, kx0, ky1);
    shade(kx1, ky0, cssW, ky1);
    // 보이는 자를 줄
    ctx.strokeStyle = "#f59e0b";
    for (const edge of ["top", "bottom", "left", "right"]) {
      const flat = edge === "top" || edge === "bottom";
      const at = { top: ky0, bottom: ky1, left: kx0, right: kx1 }[edge];
      if (at < 0 || at > (flat ? cssH : cssW)) continue;
      ctx.lineWidth = edge === active ? 3 : 1.5;
      ctx.beginPath();
      if (flat) {
        ctx.moveTo(clampX(kx0), at);
        ctx.lineTo(clampX(kx1), at);
      } else {
        ctx.moveTo(at, clampY(ky0));
        ctx.lineTo(at, clampY(ky1));
      }
      ctx.stroke();
    }
    // 마우스 밑 화소
    if (pointer) {
      const bx = (fx - sx) * ZOOM;
      const by = (fy - sy) * ZOOM;
      ctx.lineWidth = 2;
      ctx.strokeStyle = "#0f172a";
      ctx.strokeRect(bx - 1, by - 1, ZOOM + 2, ZOOM + 2);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#fff";
      ctx.strokeRect(bx + 0.5, by + 0.5, ZOOM - 1, ZOOM - 1);
    }
    if (label) label.textContent = pointer ? `마우스 자리 · x ${fx}, y ${fy}` : `${SIDE_NAMES[active]} 자를 줄 · ${crop[active]}px`;
  }

  // 자를 곳이나 고르는 줄이 마우스로 고친 것이 아니면(화살표 키, 숫자 칸, 단추, 누르기, 되돌리기) 확대 칸은 그 줄을 보인다
  useEffect(() => {
    if (pointerEditRef.current) pointerEditRef.current = false;
    else modeRef.current = "line";
  }, [crop.top, crop.bottom, crop.left, crop.right, active]);

  useEffect(() => {
    drawMain();
    drawLoupe();
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    // 칸 폭이 바뀌거나(창 크기) 화면 높이가 바뀌면 사진 크기를 다시 맞춘다
    const again = () => redraw((n) => n + 1);
    const observer = new ResizeObserver(again);
    observer.observe(stage);
    window.addEventListener("resize", again);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", again);
    };
  }, []);

  // 화면 자리 → 그림 좌표 (CSS px도 함께)
  function point(e) {
    const r = mainRef.current.getBoundingClientRect();
    const s = layoutRef.current?.scale ?? 1;
    const cssX = e.clientX - r.left;
    const cssY = e.clientY - r.top;
    return { cssX, cssY, x: cssX / s, y: cssY / s };
  }

  // 잡은 줄들 (모서리면 둘)
  function hit(p) {
    const s = layoutRef.current?.scale ?? 1;
    const x0 = crop.left * s;
    const x1 = (width - crop.right) * s;
    const y0 = crop.top * s;
    const y1 = (height - crop.bottom) * s;
    const inX = p.cssX >= x0 - HIT && p.cssX <= x1 + HIT;
    const inY = p.cssY >= y0 - HIT && p.cssY <= y1 + HIT;
    const edges = [];
    const dTop = Math.abs(p.cssY - y0);
    const dBottom = Math.abs(p.cssY - y1);
    if (inX && Math.min(dTop, dBottom) <= HIT) edges.push(dTop <= dBottom ? "top" : "bottom");
    const dLeft = Math.abs(p.cssX - x0);
    const dRight = Math.abs(p.cssX - x1);
    if (inY && Math.min(dLeft, dRight) <= HIT) edges.push(dLeft <= dRight ? "left" : "right");
    return edges;
  }

  // 줄 자리: top·left는 남길 첫 줄(칸), bottom·right는 잘라 낼 첫 줄(칸)
  const lineAt = (c, edge) => ({ top: c.top, bottom: height - c.bottom, left: c.left, right: width - c.right })[edge];

  // 줄을 가까운 직선 경계에 붙인다. 붙였으면 true
  function snapLine(next, edge, alt) {
    if (!pixels || alt) return false;
    const radius = SNAP / (layoutRef.current?.scale ?? 1);
    const b = snapEdge(pixels, edge, lineAt(next, edge), next, radius);
    if (b === null) return false;
    if (edge === "top") next.top = Math.max(0, Math.min(b, height - next.bottom - 1));
    if (edge === "bottom") next.bottom = Math.max(0, Math.min(height - b, height - next.top - 1));
    if (edge === "left") next.left = Math.max(0, Math.min(b, width - next.right - 1));
    if (edge === "right") next.right = Math.max(0, Math.min(width - b, width - next.left - 1));
    return true;
  }

  // 줄 하나를 그림의 그 자리(그림 좌표)로 옮긴다
  function moveEdge(next, edge, p) {
    const y = Math.round(Math.min(height, Math.max(0, p.y)));
    const x = Math.round(Math.min(width, Math.max(0, p.x)));
    if (edge === "top") next.top = Math.min(y, height - next.bottom - 1);
    if (edge === "bottom") next.bottom = Math.min(height - y, height - next.top - 1);
    if (edge === "left") next.left = Math.min(x, width - next.right - 1);
    if (edge === "right") next.right = Math.min(width - x, width - next.left - 1);
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const p = point(e);
    focusRef.current = { x: p.x, y: p.y };
    stageRef.current.focus({ preventScroll: true });
    e.currentTarget.setPointerCapture(e.pointerId);
    const edges = hit(p);
    if (edges.length) {
      dragRef.current = { edges };
      modeRef.current = "line";
      pointerEditRef.current = edges[0] !== active;
      onActive(edges[0]);
    } else {
      dragRef.current = { start: p, moved: false };
    }
  }

  function onPointerMove(e) {
    const p = point(e);
    const drag = dragRef.current;
    if (!drag) {
      const edges = hit(p);
      if (edges.length === 2) setCursor(edges.includes("top") === edges.includes("left") ? "nwse-resize" : "nesw-resize");
      else setCursor(edges.length ? CURSORS[edges[0]] : "crosshair");
      focusRef.current = { x: p.x, y: p.y };
      modeRef.current = "pointer";
      drawLoupe();
      return;
    }
    focusRef.current = { x: p.x, y: p.y };
    if (drag.edges) {
      const next = { ...crop };
      for (const edge of drag.edges) moveEdge(next, edge, p);
      setSnapped(drag.edges.filter((edge) => snapLine(next, edge, e.altKey)));
      if (!drag.begun) {
        drag.begun = true;
        onBegin?.();
      }
      modeRef.current = "line";
      pointerEditRef.current = true;
      onChange(next, "live");
      return;
    }
    // 줄 밖에서 끌면 새 네모
    if (!drag.moved && Math.hypot(p.cssX - drag.start.cssX, p.cssY - drag.start.cssY) < 4) return;
    if (!drag.moved) onBegin?.();
    drag.moved = true;
    const x0 = Math.round(Math.max(0, Math.min(drag.start.x, p.x)));
    const x1 = Math.round(Math.min(width, Math.max(drag.start.x, p.x)));
    const y0 = Math.round(Math.max(0, Math.min(drag.start.y, p.y)));
    const y1 = Math.round(Math.min(height, Math.max(drag.start.y, p.y)));
    if (x1 - x0 < 1 || y1 - y0 < 1) return;
    const next = { top: y0, bottom: height - y1, left: x0, right: width - x1 };
    setSnapped(["top", "bottom", "left", "right"].filter((edge) => snapLine(next, edge, e.altKey)));
    modeRef.current = "pointer";
    pointerEditRef.current = true;
    onChange(next, "live");
  }

  // 마우스가 사진 밖으로 나가면(숫자 칸·단추로 가면) 확대 칸은 고르고 있는 줄을 보인다
  function onPointerLeave() {
    if (dragRef.current) return;
    modeRef.current = "line";
    drawLoupe();
  }

  function onPointerUp(e) {
    const drag = dragRef.current;
    dragRef.current = null;
    setSnapped([]);
    if (drag?.start && !drag.moved && e.type === "pointerup") {
      const x = Math.min(width - 1, Math.max(0, Math.floor(drag.start.x)));
      const y = Math.min(height - 1, Math.max(0, Math.floor(drag.start.y)));
      onPick?.(x, y, e.altKey);
    }
  }

  function onKeyDown(e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const step = e.shiftKey ? 10 : 1;
    const next = { ...crop };
    const moves = {
      ArrowUp: { top: -step, bottom: step },
      ArrowDown: { top: step, bottom: -step },
      ArrowLeft: { left: -step, right: step },
      ArrowRight: { left: step, right: -step },
    };
    const move = moves[e.key]?.[active];
    if (move === undefined) return;
    e.preventDefault();
    next[active] = Math.max(0, next[active] + move);
    modeRef.current = "line";
    onChange(next, "key");
  }

  return (
    <div className="cr-editor">
      <div
        className="cr-stage"
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-label={`${label}. 자를 줄을 끌거나, 줄을 고른 뒤 화살표 키로 1px씩(Shift는 10px) 옮깁니다`}
      >
        <canvas
          ref={mainRef}
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
        />
      </div>
      <div className="cr-loupe-box">
        <p className="cr-loupe-label" ref={labelRef} />
        <canvas ref={loupeRef} className="cr-loupe" aria-label="확대 칸: 사진 위에서는 마우스 밑, 줄을 고칠 때는 그 줄 근처를 크게 본 것" />
      </div>
    </div>
  );
}
