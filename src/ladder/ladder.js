// 사다리 높이(가로줄을 놓을 수 있는 단 수)
export const ROWS = 12;

// rungs[row][col]이 true면 그 높이에서 col번과 col+1번 세로줄이 가로줄로 이어진다
export function createRungs(count, random = Math.random) {
  const rungs = Array.from({ length: ROWS }, () => Array(count - 1).fill(false));
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < count - 1; col++) {
      // 같은 높이에서 가로줄이 바로 옆에 붙으면 갈림길이 생겨 결과가 겹치므로 건너뛴다
      if (rungs[row][col - 1]) continue;
      rungs[row][col] = random() < 0.45;
    }
  }
  // 이웃한 두 줄 사이에 가로줄이 하나도 없으면 그 둘은 섞이지 않으므로 하나씩은 놓는다
  for (let col = 0; col < count - 1; col++) {
    if (rungs.some((r) => r[col])) continue;
    const free = [...Array(ROWS).keys()].filter((row) => !rungs[row][col - 1] && !rungs[row][col + 1]);
    const row = free.length ? free[Math.floor(random() * free.length)] : Math.floor(random() * ROWS);
    rungs[row][col - 1] = false;
    if (col + 1 < count - 1) rungs[row][col + 1] = false;
    rungs[row][col] = true;
  }
  return rungs;
}

// start번 세로줄에서 출발해 내려가며 건너는 가로줄과 도착 줄을 구한다
export function tracePath(rungs, start) {
  let col = start;
  const steps = [];
  rungs.forEach((row, r) => {
    if (row[col]) {
      steps.push({ row: r, from: col, to: col + 1 });
      col += 1;
    } else if (row[col - 1]) {
      steps.push({ row: r, from: col, to: col - 1 });
      col -= 1;
    }
  });
  return { end: col, steps };
}
