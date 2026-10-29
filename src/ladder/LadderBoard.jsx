import { useEffect, useRef, useState } from "react";
import { ROWS } from "./ladder.js";

const ROW_GAP = 30;
const HEIGHT = ROW_GAP * (ROWS + 1);
// 경로가 그려지는 속도(px/ms). 길이에 비례해 시간이 정해져 모든 경로가 같은 속도로 내려간다
const DRAW_SPEED = 0.45;

function pathPoints(path, start, x) {
  const points = [[x(start), 0]];
  for (const step of path.steps) {
    const y = ROW_GAP * (step.row + 1);
    points.push([x(step.from), y], [x(step.to), y]);
  }
  points.push([x(path.end), HEIGHT]);
  return points;
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

// 세로줄, 가로줄, 참가자별 경로를 그린다. 화면 폭을 재서 위아래 이름 칸과 세로줄 위치를 맞춘다
export default function LadderBoard({ count, rungs, paths, traced, colors, showRungs, onTraceEnd }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(wrapRef.current);
    return () => observer.disconnect();
  }, []);

  const x = (col) => (width * (col + 0.5)) / count;

  return (
    <div ref={wrapRef} className="ladder-board">
      {width > 0 && (
        <svg width={width} height={HEIGHT} role="img" aria-label="사다리">
          {Array.from({ length: count }, (_, col) => (
            <line key={col} className="pole" x1={x(col)} y1={0} x2={x(col)} y2={HEIGHT} />
          ))}
          {showRungs && rungs?.map((row, r) => row.map((on, col) => on && (
            <line
              key={`${r}-${col}`}
              className="rung"
              x1={x(col)}
              y1={ROW_GAP * (r + 1)}
              x2={x(col + 1)}
              y2={ROW_GAP * (r + 1)}
            />
          )))}
          {traced.map((player) => {
            const points = pathPoints(paths[player], player, x);
            const length = pathLength(points);
            return (
              <polyline
                key={player}
                className="trace"
                points={points.map((p) => p.join(",")).join(" ")}
                stroke={colors[player]}
                style={{
                  strokeDasharray: length,
                  strokeDashoffset: length,
                  animationDuration: `${Math.round(length / DRAW_SPEED)}ms`,
                }}
                onAnimationEnd={() => onTraceEnd(player)}
              />
            );
          })}
        </svg>
      )}
    </div>
  );
}
