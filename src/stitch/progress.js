// 작업자(stitchWorker.js)가 보낸 진행 상황을 화면에 보일 비율과 글로 바꾼다. 폴더로 붙일 때와 사진을 골라 붙일 때 함께 쓴다

// 그림 하나를 만드는 일 안의 비율(0~1)에서 그림을 다 만든 때. 남은 몫은 저장하는 동안이다
export const MADE = 0.95;
// 사진을 다 그린 때. JPG는 다 그린 뒤에 한꺼번에 만들어서 그 몫을 남겨 둔다
const DRAWN = 0.85;

// { fraction, text }. 크기 확인은 금방 끝나 10%로 친다
export function describe(p) {
  if (p.phase === "measure") return { fraction: 0.1 * (p.done / p.total), text: `사진 크기 확인 ${p.done}/${p.total}` };
  if (p.phase === "encode") return { fraction: DRAWN, text: "JPG로 만드는 중" };
  return { fraction: 0.1 + (DRAWN - 0.1) * (p.rows / p.totalRows), text: `붙이는 중 ${p.done}/${p.total}장` };
}
