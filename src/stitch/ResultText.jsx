import { duration, fileSize, number } from "../shared/format.js";

// 묶음 하나(또는 골라 붙인 한 장)의 결과를 한 줄로 보인다. overwrite는 아직 만들기 전에 같은 이름 파일이 있을 때
export default function ResultText({ result, overwrite = false }) {
  if (!result) return overwrite ? <span className="st-warn">같은 이름 파일이 있어 덮어씁니다</span> : null;
  if (result.type === "done") {
    return (
      <span className="st-ok">
        {result.savedTo === "download" ? "다운로드함" : "저장함"} · {number(result.width)}×{number(result.height)}px ·{" "}
        {fileSize(result.bytes)} · {duration(result.ms)}
      </span>
    );
  }
  if (result.type === "cancelled") return <span>멈춤</span>;
  return <span className="st-error">만들지 못함: {result.message}</span>;
}
