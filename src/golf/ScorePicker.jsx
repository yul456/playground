import { useEffect } from "react";
import { scoreClass, scoreName } from "./golf.js";

// 스코어카드 칸을 누르면 아래에서 올라오는 타수 선택 목록. 한 번 눌러 바로 고친다
export default function ScorePicker({ name, hole, par, score, onPick, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 홀인원부터 파 +4까지 고를 수 있게 한다
  const values = Array.from({ length: par + 4 }, (_, i) => i + 1);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`${name} ${hole + 1}번 홀 타수 고르기`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-title">
          <strong>{name}</strong>
          <span>{hole + 1}번 홀 · 파 {par}</span>
        </div>
        <div className="picker-grid">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              className={`picker-option${value === score ? " selected" : ""}`}
              onClick={() => onPick(value)}
              autoFocus={value === (score ?? par)}
            >
              <span className={`mark ${scoreClass(value, par)}`}>{value}</span>
              <span className="picker-name">{scoreName(value, par)}</span>
            </button>
          ))}
        </div>
        <div className="sheet-actions">
          <button type="button" className="secondary" onClick={() => onPick(null)} disabled={score == null}>지우기</button>
          <button type="button" className="secondary" onClick={onClose}>취소</button>
        </div>
      </div>
    </div>
  );
}
