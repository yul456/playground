import { useState } from "react";
import "./confetti.css";

const PIECE_COUNT = 90;
const PIECE_COLORS = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];

function makePieces() {
  return Array.from({ length: PIECE_COUNT }, (_, i) => ({
    left: Math.random() * 100,
    delay: Math.random() * 0.5,
    duration: 1.8 + Math.random() * 1.4,
    size: 6 + Math.random() * 6,
    drift: (Math.random() - 0.5) * 240,
    rotate: Math.random() * 360,
    color: PIECE_COLORS[i % PIECE_COLORS.length],
  }));
}

// 화면 위에서 색종이를 뿌린다 (사다리 타기 당첨, 돌림판 결과).
// 색종이 위치는 처음 한 번만 정하므로, 새로 뿌릴 때는 key를 바꿔 다시 그린다
export default function Confetti() {
  const [pieces] = useState(makePieces);

  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.size * 0.45,
            background: p.color,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
            "--drift": `${p.drift}px`,
            "--rotate": `${p.rotate}deg`,
          }}
        />
      ))}
    </div>
  );
}
