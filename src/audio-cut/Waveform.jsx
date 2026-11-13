import { useEffect, useRef, useState } from "react";
import { STEP_SECONDS } from "./analyze.js";

// 파형과 고른 구간. 시작·끝 손잡이를 끌거나, 파형을 눌러 가까운 손잡이를 그 자리로 옮긴다.
// analysis: analyze.js 결과, duration: 길이(초), start·end: 고른 구간(초), position: 재생 중인 자리(초) 또는 null,
// onChange({ start, end }): 손잡이를 옮길 때
const HEIGHT = 140;
const HANDLE_HIT = 12; // 손잡이를 잡는 너비(px)

export default function Waveform({ analysis, duration, start, end, position, onChange, disabled }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const dragRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(HEIGHT * ratio);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, width, HEIGHT);
    const mid = HEIGHT / 2;
    const xOf = (t) => (t / duration) * width;
    const startX = xOf(start);
    const endX = xOf(end);
    // 파형: 화면의 한 칸(px)마다 그 시간 동안의 가장 큰 소리
    const { peak } = analysis;
    const perPixel = duration / STEP_SECONDS / width;
    let loudest = 0;
    for (const v of peak) if (v > loudest) loudest = v;
    const scale = loudest ? (mid - 6) / loudest : 0;
    for (let x = 0; x < width; x++) {
      const from = Math.floor(x * perPixel);
      const to = Math.max(from + 1, Math.floor((x + 1) * perPixel));
      let max = 0;
      for (let i = from; i < to && i < peak.length; i++) if (peak[i] > max) max = peak[i];
      const h = Math.max(1, max * scale);
      ctx.fillStyle = x >= startX && x <= endX ? "#2563eb" : "#94a3b8";
      ctx.fillRect(x, mid - h, 1, h * 2);
    }
    // 잘라 낼 곳은 흐리게
    ctx.fillStyle = "rgba(148, 163, 184, 0.28)";
    ctx.fillRect(0, 0, startX, HEIGHT);
    ctx.fillRect(endX, 0, width - endX, HEIGHT);
    // 손잡이
    ctx.fillStyle = "#1d4ed8";
    for (const x of [startX, endX]) {
      ctx.fillRect(Math.round(x) - 1, 0, 2, HEIGHT);
      ctx.fillRect(Math.round(x) - 5, 0, 10, 14);
      ctx.fillRect(Math.round(x) - 5, HEIGHT - 14, 10, 14);
    }
    // 재생 중인 자리
    if (position != null) {
      ctx.fillStyle = "#e11d48";
      ctx.fillRect(Math.round(xOf(position)) - 1, 0, 2, HEIGHT);
    }
  }, [analysis, duration, start, end, position, width]);

  const timeAt = (clientX) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration));
  };

  function onPointerDown(e) {
    if (disabled) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const startX = (start / duration) * rect.width;
    const endX = (end / duration) * rect.width;
    // 가까운 손잡이를 잡는다. 손잡이에서 멀면 그 손잡이를 누른 자리로 옮긴다
    const which = Math.abs(x - startX) <= Math.abs(x - endX) ? "start" : "end";
    dragRef.current = which;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (Math.abs(x - (which === "start" ? startX : endX)) > HANDLE_HIT) move(e.clientX);
  }

  function move(clientX) {
    const t = timeAt(clientX);
    if (dragRef.current === "start") onChange({ start: Math.min(t, end - 0.05), end });
    else onChange({ start, end: Math.max(t, start + 0.05) });
  }

  return (
    <div className="ac-wave" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: "100%", height: HEIGHT }}
        onPointerDown={onPointerDown}
        onPointerMove={(e) => dragRef.current && move(e.clientX)}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
        aria-label="파형. 시작과 끝 손잡이를 끌어 남길 구간을 고릅니다"
      />
    </div>
  );
}
