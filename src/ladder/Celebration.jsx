import { useState } from "react";

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

// 당첨자가 나오면 화면 위에서 색종이를 뿌리고 축하 문구를 띄운다
export default function Celebration({ names, onClose }) {
  // 색종이 위치는 처음 한 번만 정한다 (축하가 새로 시작될 때마다 key로 다시 만든다)
  const [pieces] = useState(makePieces);

  return (
    <>
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
      <div className="celebration" role="status" onClick={onClose}>
        <div className="celebration-emoji" aria-hidden="true">🎉</div>
        <div className="celebration-title">축하합니다!</div>
        <div className="celebration-names">{names.join(", ")}님 당첨</div>
      </div>
    </>
  );
}
