import { useEffect, useRef } from "react";
import { fitLabel, indexAt, labelSize, sliceColor, spinProgress } from "./wheel.js";

// 돌림판 그림의 크기 (viewBox -100~100 기준)
const RADIUS = 96;
const HUB = 25;
const LABEL_END = 88;

// 칸 경계가 바늘을 지날 때 바늘이 튕기는 모양
const POINTER_TICK = [
  { transform: "translateX(-50%) rotate(-24deg)" },
  { transform: "translateX(-50%) rotate(0deg)" },
];

// i번째 칸 모양. 12시부터 시계 방향
function slicePath(i, count) {
  const a0 = (i / count) * 2 * Math.PI;
  const a1 = ((i + 1) / count) * 2 * Math.PI;
  const point = (a) => `${RADIUS * Math.sin(a)} ${-RADIUS * Math.cos(a)}`;
  return `M0 0 L${point(a0)} A${RADIUS} ${RADIUS} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${point(a1)} Z`;
}

// 돌림판. 원판만 돌고 바늘(맨 위)과 가운데 돌리기 버튼은 제자리에 있다.
// rotation은 멈춰 있을 때의 각도, spin({ from, to, duration })이 있으면 from에서 to까지 돌린 뒤 onSpinEnd를 부른다.
// 도는 동안 칸 경계가 바늘을 지날 때마다 onTick을 부른다 (딸깍 소리).
// highlight 칸이 있으면 나머지 칸을 흐리게 해 뽑힌 칸이 보이게 한다
export default function Wheel({ labels, rotation, spin, highlight, canSpin, onSpin, onSpinEnd, onTick }) {
  const discRef = useRef(null);
  const pointerRef = useRef(null);
  // 애니메이션 도중에 바뀌어도(소리를 끄고 켜는 등) 마지막 함수를 부르도록 ref에 담는다
  const onSpinEndRef = useRef(onSpinEnd);
  onSpinEndRef.current = onSpinEnd;
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;
  const count = labels.length;
  const size = labelSize(count);
  const maxWidth = (LABEL_END - HUB - 6) / size;

  // 돌리는 동안에는 React로 다시 그리지 않고 매 프레임 원판 각도만 바꾼다.
  // 시각 기준으로 계산하므로 탭을 가렸다 돌아와도 그 사이만큼 지난 자리에서 이어진다
  useEffect(() => {
    if (!spin) return undefined;
    const disc = discRef.current;
    const pointer = pointerRef.current;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const started = performance.now();
    let lastSlice = indexAt(spin.from, count);
    let frame = 0;
    const step = (now) => {
      const t = Math.min(1, (now - started) / spin.duration);
      const angle = spin.from + (spin.to - spin.from) * spinProgress(t);
      disc.style.transform = `rotate(${angle}deg)`;
      // 칸 경계가 바늘을 지날 때마다 바늘을 살짝 튕긴다 (실제 돌림판의 딸깍거림)
      const slice = indexAt(angle, count);
      if (slice !== lastSlice) {
        lastSlice = slice;
        if (!calm) pointer.animate?.(POINTER_TICK, { duration: 140, easing: "ease-out" });
        onTickRef.current?.();
      }
      if (t < 1) frame = requestAnimationFrame(step);
      else onSpinEndRef.current();
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [spin, count]);

  return (
    <div className="wheel">
      <div ref={discRef} className="wheel-disc" style={{ transform: `rotate(${rotation}deg)` }}>
        <svg viewBox="-100 -100 200 200" role="img" aria-label={`돌림판: ${labels.join(", ") || "항목 없음"}`}>
          {count === 0 && <circle r={RADIUS} className="wheel-empty" />}
          {count === 1 && <circle r={RADIUS} fill={sliceColor(0, 1)} />}
          {count > 1 && labels.map((_, i) => (
            <path
              key={i}
              d={slicePath(i, count)}
              fill={sliceColor(i, count)}
              className={highlight != null && highlight !== i ? "dim" : undefined}
            />
          ))}
          {/* 테두리는 칸 위에 고리로 그린다. 칸 뒤에 채운 원을 두면 흐리게 한 칸이 그 색으로 탁해진다 */}
          <circle r={RADIUS + 1.5} className="wheel-rim" />
          {labels.map((label, i) => (
            <text
              key={i}
              className="wheel-label"
              transform={`rotate(${((i + 0.5) * 360) / count - 90}) translate(${LABEL_END} 0)`}
              textAnchor="end"
              dominantBaseline="central"
              fontSize={size}
            >
              {fitLabel(label, maxWidth)}
            </text>
          ))}
        </svg>
      </div>
      <div ref={pointerRef} className="wheel-pointer" aria-hidden="true" />
      <button type="button" className="wheel-spin" onClick={onSpin} disabled={!canSpin}>
        {spin ? "…" : "돌리기"}
      </button>
    </div>
  );
}
