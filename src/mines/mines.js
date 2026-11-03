// 지뢰찾기 규칙: 판 만들기, 칸 열기, 깃발, 숫자 칸으로 주변 한꺼번에 열기. 화면 코드가 없어 Node에서도 돌릴 수 있다.
// 판은 칸 수만큼의 1차원 배열로 다루고, i번 칸은 Math.floor(i / cols)행 i % cols열이다.
// 함수는 받은 판을 고치지 않고 새 판을 돌려준다 (React 상태로 그대로 쓴다)
import { shuffle } from "../shared/random.js";

export const LEVELS = [
  { key: "easy", name: "초급", cols: 9, rows: 9, mines: 10 },
  { key: "medium", name: "중급", cols: 16, rows: 16, mines: 40 },
  { key: "hard", name: "고급", cols: 30, rows: 16, mines: 99 },
];
export const levelOf = (key) => LEVELS.find((level) => level.key === key) ?? LEVELS[0];

// 칸 상태
export const HIDDEN = 0;
export const OPEN = 1;
export const FLAG = 2;

export function newGame(level) {
  return {
    level: level.key,
    cols: level.cols,
    rows: level.rows,
    mineCount: level.mines,
    // 지뢰와 칸마다 주변 8칸의 지뢰 수. 첫 칸을 연 뒤에 정하므로 그 전에는 null
    mines: null,
    counts: null,
    cells: new Array(level.cols * level.rows).fill(HIDDEN),
    // ready(첫 칸을 열기 전) → playing → won 또는 lost
    status: "ready",
    opened: 0,
    flags: 0,
    // 밟은 지뢰 칸
    exploded: null,
    startedAt: null,
    endedAt: null,
  };
}

export const isOver = (game) => game.status === "won" || game.status === "lost";

export function neighbors(game, i) {
  const { cols, rows } = game;
  const row = Math.floor(i / cols);
  const col = i % cols;
  const out = [];
  for (let r = row - 1; r <= row + 1; r++) {
    for (let c = col - 1; c <= col + 1; c++) {
      if ((r !== row || c !== col) && r >= 0 && r < rows && c >= 0 && c < cols) out.push(r * cols + c);
    }
  }
  return out;
}

// 처음 연 칸과 그 주변 8칸을 빼고 지뢰를 놓는다. 그래서 첫 칸은 늘 0이라 주변이 함께 펼쳐진다.
// 지뢰가 많아 자리가 모자라면 처음 연 칸만 뺀다. pick은 시험용 난수(없으면 crypto)
function placeMines(game, first, pick) {
  const all = [...game.cells.keys()];
  const safe = new Set([first, ...neighbors(game, first)]);
  let spots = all.filter((i) => !safe.has(i));
  if (spots.length < game.mineCount) spots = all.filter((i) => i !== first);
  const mines = all.map(() => false);
  for (const i of shuffle(spots, pick).slice(0, game.mineCount)) mines[i] = true;
  const counts = all.map((i) => neighbors(game, i).filter((n) => mines[n]).length);
  return { mines, counts };
}

// start 칸들을 연다. 0인 칸이면 이어진 칸을 함께 열고, 깃발 칸은 열지 않는다.
// next는 cells를 이미 복사한 새 판이라 고쳐도 된다
function reveal(next, start, now) {
  const queue = [...start];
  while (queue.length) {
    const i = queue.pop();
    if (next.cells[i] !== HIDDEN) continue;
    if (next.mines[i]) return { ...next, status: "lost", exploded: i, endedAt: now };
    next.cells[i] = OPEN;
    next.opened++;
    if (next.counts[i] === 0) queue.push(...neighbors(next, i));
  }
  if (next.opened === next.cells.length - next.mineCount) {
    // 다 열면 이긴다. 남은 지뢰 칸에는 모두 깃발을 꽂아 보여 준다
    const cells = next.cells.map((cell, i) => (next.mines[i] ? FLAG : cell));
    return { ...next, cells, flags: next.mineCount, status: "won", endedAt: now };
  }
  return next;
}

// i번 칸을 연다. 첫 칸이면 그때 지뢰를 놓고 시간을 재기 시작한다. now는 시각(ms)
export function open(game, i, now = Date.now(), pick) {
  if (isOver(game) || game.cells[i] !== HIDDEN) return game;
  let next = { ...game, cells: [...game.cells] };
  if (next.status === "ready") next = { ...next, ...placeMines(next, i, pick), status: "playing", startedAt: now };
  return reveal(next, [i], now);
}

// 닫힌 칸에 깃발을 꽂거나 뺀다. 열린 칸이나 끝난 판은 그대로 둔다
export function toggleFlag(game, i) {
  const cell = game.cells[i];
  if (isOver(game) || cell === OPEN) return game;
  const cells = [...game.cells];
  cells[i] = cell === FLAG ? HIDDEN : FLAG;
  return { ...game, cells, flags: game.flags + (cell === FLAG ? -1 : 1) };
}

// 열린 숫자 칸 주변에 그 숫자만큼 깃발이 꽂혀 있으면, 깃발 없는 주변 칸을 한꺼번에 연다.
// 깃발을 잘못 꽂았으면 지뢰를 밟는다
export function openAround(game, i, now = Date.now()) {
  if (game.status !== "playing" || game.cells[i] !== OPEN || game.counts[i] === 0) return game;
  const around = neighbors(game, i);
  const hidden = around.filter((n) => game.cells[n] === HIDDEN);
  const flags = around.filter((n) => game.cells[n] === FLAG).length;
  if (flags !== game.counts[i] || hidden.length === 0) return game;
  return reveal({ ...game, cells: [...game.cells] }, hidden, now);
}

// 걸린 시간(초). 끝난 판은 끝난 시각까지
export function elapsed(game, now = Date.now()) {
  if (game.startedAt == null) return 0;
  return Math.max(0, ((game.endedAt ?? now) - game.startedAt) / 1000);
}
