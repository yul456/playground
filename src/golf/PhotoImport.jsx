import { useEffect, useState } from "react";
import { MAX_PLAYERS } from "./golf.js";
import { ScanError, readScorecard } from "./scorecardScan.js";

// 사진에서 읽은 파 대비 값을 타수로 바꿔 검토 화면에 쓸 상태로 만든다
function toReview(scan, playerCount) {
  const sections = scan.pars.length / 9;
  // 사진의 합계(T)와 맞는 구간은 칸마다의 인식 확신도와 상관없이 맞게 읽은 것으로 본다
  const confirm = (sure, values, totals) => sure.map((s, h) => s || sectionSum(values, Math.floor(h / 9)) === totals[Math.floor(h / 9)]);
  return {
    pars: scan.pars,
    parSure: scan.parSure,
    rows: scan.rows.map((row, i) => {
      const strokes = row.diffs.map((d, h) => (d == null || scan.pars[h] == null ? null : scan.pars[h] + d));
      return {
        target: i < MAX_PLAYERS ? i : -1,
        strokes,
        sure: confirm(row.sure.map((s, h) => s && strokes[h] != null), strokes, row.totals).map((s, h) => s && strokes[h] != null),
        totals: row.totals,
      };
    }),
    playerCount,
    sections,
  };
}

const sectionSum = (list, s) => list.slice(s * 9, s * 9 + 9).reduce((t, v) => (t == null || v == null ? null : t + v), 0);

function NumberCell({ value, sure, onChange, label }) {
  return (
    <input
      className={`review-input${sure ? "" : " unsure"}`}
      type="number"
      inputMode="numeric"
      min="1"
      max="15"
      value={value ?? ""}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
    />
  );
}

export default function PhotoImport({ players, onApply }) {
  const [status, setStatus] = useState({ step: "idle" });
  const [preview, setPreview] = useState(null);

  useEffect(() => () => preview && URL.revokeObjectURL(preview), [preview]);

  async function onFile(e) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    setStatus({ step: "reading" });
    try {
      const scan = await readScorecard(file);
      setStatus({ step: "review", review: toReview(scan, players.length) });
    } catch (err) {
      setStatus({
        step: "error",
        message: err instanceof ScanError ? err.message : "사진을 읽는 중 문제가 생겼습니다. 다른 사진으로 다시 시도해 주세요.",
      });
    }
  }

  function edit(fn) {
    setStatus((s) => ({ ...s, review: fn(s.review) }));
  }

  const close = () => setStatus({ step: "idle" });

  if (status.step !== "review") {
    return (
      <section className="card photo-import">
        <div className="photo-head">
          <div>
            <strong>📷 사진으로 입력</strong>
            <p className="muted">스마트스코어 스코어카드(앱 화면 캡처, 출력용 카드, 사진 배경 카드)를 올리면 타수를 한 번에 채웁니다.</p>
          </div>
          <label className={`file-button${status.step === "reading" ? " disabled" : ""}`}>
            사진 고르기
            <input type="file" accept="image/*" onChange={onFile} disabled={status.step === "reading"} hidden />
          </label>
        </div>
        {status.step === "reading" && (
          <p className="scan-progress" role="status">사진을 읽는 중…</p>
        )}
        {status.step === "error" && <p className="scan-error" role="alert">{status.message}</p>}
      </section>
    );
  }

  const { review } = status;
  const holes = review.pars.length;
  const sections = holes / 9;
  const holeIdx = [...Array(holes).keys()];
  const unsureCount = review.rows.reduce((n, r) => n + r.sure.filter((s) => !s).length, 0)
    + review.parSure.filter((s) => !s).length;
  const targets = review.rows.map((r) => r.target).filter((t) => t >= 0);
  const duplicated = targets.length !== new Set(targets).size;

  return (
    <section className="card photo-import">
      <div className="photo-head">
        <strong>사진에서 읽은 결과</strong>
        <button type="button" className="link" onClick={close}>닫기</button>
      </div>
      <p className="muted">
        사진의 파 대비 값을 타수로 바꿨습니다. 노란 칸은 확실하지 않은 칸이니 사진과 비교해 확인해 주세요.
        {unsureCount > 0 && ` (확인할 칸 ${unsureCount}개)`}
      </p>
      {preview && (
        <details className="photo-preview">
          <summary>올린 사진 보기</summary>
          <img src={preview} alt="올린 스코어카드 사진" />
        </details>
      )}

      <div className="table-scroll">
        <table className="review-table">
          <thead>
            <tr>
              <th scope="col">홀</th>
              {holeIdx.map((h) => <th key={h} scope="col">{h + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            <tr className="par-row">
              <th scope="row">파</th>
              {holeIdx.map((h) => (
                <td key={h}>
                  <NumberCell
                    value={review.pars[h]}
                    sure={review.parSure[h]}
                    label={`${h + 1}번 홀 파`}
                    onChange={(v) => edit((r) => ({ ...r, pars: r.pars.map((p, i) => (i === h ? v : p)), parSure: r.parSure.map((s, i) => (i === h ? true : s)) }))}
                  />
                </td>
              ))}
            </tr>
            {review.rows.map((row, i) => (
              <tr key={i}>
                <th scope="row">
                  <select
                    value={row.target}
                    aria-label={`사진의 ${i + 1}번째 줄을 넣을 참가자`}
                    onChange={(e) => edit((r) => ({ ...r, rows: r.rows.map((x, j) => (j === i ? { ...x, target: Number(e.target.value) } : x)) }))}
                  >
                    {Array.from({ length: MAX_PLAYERS }, (_, p) => (
                      <option key={p} value={p}>{players[p] ?? `플레이어${p + 1} (추가)`}</option>
                    ))}
                    <option value={-1}>가져오지 않음</option>
                  </select>
                </th>
                {holeIdx.map((h) => (
                  <td key={h}>
                    <NumberCell
                      value={row.strokes[h]}
                      sure={row.sure[h]}
                      label={`사진 ${i + 1}번째 줄 ${h + 1}번 홀 타수`}
                      onChange={(v) => edit((r) => ({
                        ...r,
                        rows: r.rows.map((x, j) => (j === i
                          ? { ...x, strokes: x.strokes.map((s, k) => (k === h ? v : s)), sure: x.sure.map((s, k) => (k === h ? true : s)) }
                          : x)),
                      }))}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="review-checks">
        {review.rows.map((row, i) => [...Array(sections).keys()].map((s) => {
          const sum = sectionSum(row.strokes, s);
          const ok = sum != null && sum === row.totals[s];
          return (
            <li key={`${i}-${s}`} className={ok ? "ok" : "warn"}>
              {i + 1}번째 줄 {s === 0 ? "전반" : "후반"}: {sum ?? "빈칸 있음"}타
              {ok ? ` ✓ 사진 합계와 같음` : row.totals[s] != null ? ` — 사진 합계(${row.totals[s]}타로 읽힘)와 다름, 확인 필요` : " — 확인 필요"}
            </li>
          );
        }))}
        {duplicated && <li className="warn">같은 참가자에 두 줄이 연결되어 있습니다.</li>}
      </ul>

      <div className="review-actions">
        <button type="button" className="secondary" onClick={close}>취소</button>
        <button
          type="button"
          disabled={duplicated || targets.length === 0}
          onClick={() => {
            if (!window.confirm("사진에서 읽은 파와 타수로 지금 스코어카드를 덮어쓸까요?")) return;
            onApply({ pars: review.pars, rows: review.rows.filter((r) => r.target >= 0) });
            close();
          }}
        >
          스코어카드에 적용
        </button>
      </div>
    </section>
  );
}
