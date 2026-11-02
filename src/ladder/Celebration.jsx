import Confetti from "../shared/Confetti.jsx";

// 당첨자가 나오면 화면 위에서 색종이를 뿌리고 축하 문구를 띄운다
export default function Celebration({ names, onClose }) {
  return (
    <>
      <Confetti />
      <div className="celebration" role="status" onClick={onClose}>
        <div className="celebration-emoji" aria-hidden="true">🎉</div>
        <div className="celebration-title">축하합니다!</div>
        <div className="celebration-names">{names.join(", ")}님 당첨</div>
      </div>
    </>
  );
}
