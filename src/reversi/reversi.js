// 리버시 규칙과 컴퓨터. 화면 코드가 없어 Node에서 시험할 수 있다.
// 판은 칸 64개 배열(0 빈칸, 1 검은 돌, 2 흰 돌)이고, 함수는 받은 판을 고치지 않고 새 판을 돌려준다
import { randomIndex, shuffle } from "../shared/random.js";

export const SIZE = 8;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;
export const other = (player) => 3 - player;
export const LEVELS = ["easy", "normal", "hard"];

// 칸마다 여덟 방향으로 뻗은 줄(가까운 칸부터)
const RAYS = Array.from({ length: SIZE * SIZE }, (_, pos) => {
  const row = Math.floor(pos / SIZE);
  const col = pos % SIZE;
  const rays = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const ray = [];
      for (let r = row + dr, c = col + dc; r >= 0 && r < SIZE && c >= 0 && c < SIZE; r += dr, c += dc) ray.push(r * SIZE + c);
      if (ray.length > 1) rays.push(ray);
    }
  }
  return rays;
});

// pos에 두면 뒤집히는 칸들. 빈 배열이면 둘 수 없는 곳이다
export function flipsFor(board, pos, player) {
  if (board[pos] !== EMPTY) return [];
  const enemy = 3 - player;
  const out = [];
  for (const ray of RAYS[pos]) {
    let n = 0;
    while (n < ray.length && board[ray[n]] === enemy) n++;
    if (n > 0 && n < ray.length && board[ray[n]] === player) for (let k = 0; k < n; k++) out.push(ray[k]);
  }
  return out;
}

export function legalMoves(board, player) {
  const out = [];
  for (let pos = 0; pos < board.length; pos++) if (flipsFor(board, pos, player).length) out.push(pos);
  return out;
}

export function countDiscs(board) {
  let black = 0;
  let white = 0;
  for (const v of board) {
    if (v === BLACK) black++;
    else if (v === WHITE) white++;
  }
  return { black, white };
}

export function newGame() {
  const board = Array(SIZE * SIZE).fill(EMPTY);
  board[27] = WHITE;
  board[28] = BLACK;
  board[35] = BLACK;
  board[36] = WHITE;
  // last: 방금 둔 칸, flipped: 그때 뒤집힌 칸, passed: 둘 곳이 없어 건너뛴 쪽
  return { board, turn: BLACK, over: false, moves: [], last: null, flipped: [], passed: null };
}

// 지금 차례인 쪽이 pos에 둔다. 둘 수 없는 곳이면 null
export function play(game, pos) {
  if (game.over) return null;
  const flipped = flipsFor(game.board, pos, game.turn);
  if (!flipped.length) return null;
  const board = [...game.board];
  board[pos] = game.turn;
  for (const p of flipped) board[p] = game.turn;
  const next = other(game.turn);
  let turn = next;
  let passed = null;
  let over = false;
  if (!legalMoves(board, next).length) {
    if (legalMoves(board, game.turn).length) {
      turn = game.turn;
      passed = next;
    } else over = true;
  }
  return { board, turn, over, moves: [...game.moves, pos], last: pos, flipped, passed };
}

// 둔 칸 목록으로 판을 다시 만든다. 둘 수 없는 수가 섞여 있으면 null
export function replay(moves) {
  let game = newGame();
  for (const pos of moves) {
    if (!Number.isInteger(pos) || pos < 0 || pos >= SIZE * SIZE) return null;
    game = play(game, pos);
    if (!game) return null;
  }
  return game;
}

// 끝난 판에서 이긴 쪽. 비기면 0
export function winnerOf(board) {
  const { black, white } = countDiscs(board);
  return black > white ? BLACK : white > black ? WHITE : EMPTY;
}

// ── 컴퓨터 ──

// 칸의 값: 모서리는 한 번 잡으면 뒤집히지 않아 크고, 모서리 옆 칸은 모서리를 내주기 쉬워 작다
const WEIGHTS = [
  100, -20, 10, 5, 5, 10, -20, 100,
  -20, -50, -2, -2, -2, -2, -50, -20,
  10, -2, 1, 1, 1, 1, -2, 10,
  5, -2, 1, 0, 0, 1, -2, 5,
  5, -2, 1, 0, 0, 1, -2, 5,
  10, -2, 1, 1, 1, 1, -2, 10,
  -20, -50, -2, -2, -2, -2, -50, -20,
  100, -20, 10, 5, 5, 10, -20, 100,
];
// 모서리와 그 옆 세 칸. 모서리가 차 있으면 옆 칸은 더 위험하지 않다
const CORNERS = [
  [0, [1, 8, 9]],
  [7, [6, 15, 14]],
  [56, [57, 48, 49]],
  [63, [62, 55, 54]],
];
// 값이 큰 칸부터 본다. 좋은 수를 먼저 보면 가지치기가 잘 된다
const ORDER = Array.from({ length: 64 }, (_, pos) => pos).sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
const MOBILITY = 6;
const WIN = 10000;
// 세기마다 몇 수 앞까지 보는지, 빈칸이 몇 개 남으면 끝까지 읽는지
const SEARCH = { normal: { depth: 3, exact: 8 }, hard: { depth: 6, exact: 12 } };

function mobility(board, player) {
  let n = 0;
  for (let pos = 0; pos < 64; pos++) if (board[pos] === EMPTY && flipsFor(board, pos, player).length) n++;
  return n;
}

// player 쪽에서 본 판의 값
function evaluate(board, player) {
  const enemy = 3 - player;
  let score = 0;
  for (let pos = 0; pos < 64; pos++) {
    if (board[pos] === player) score += WEIGHTS[pos];
    else if (board[pos] === enemy) score -= WEIGHTS[pos];
  }
  for (const [corner, near] of CORNERS) {
    if (board[corner] === EMPTY) continue;
    for (const pos of near) {
      if (board[pos] === player) score -= WEIGHTS[pos];
      else if (board[pos] === enemy) score += WEIGHTS[pos];
    }
  }
  return score + MOBILITY * (mobility(board, player) - mobility(board, enemy));
}

function finalScore(board, player) {
  let diff = 0;
  for (let pos = 0; pos < 64; pos++) {
    if (board[pos] === player) diff++;
    else if (board[pos] !== EMPTY) diff--;
  }
  return diff > 0 ? WIN + diff : diff < 0 ? -WIN + diff : 0;
}

// 판을 직접 고쳤다가 되돌리며 읽는다 (negamax + 알파베타)
function search(board, player, depth, alpha, beta, passed) {
  const enemy = 3 - player;
  let any = false;
  let best = -Infinity;
  for (const pos of ORDER) {
    if (board[pos] !== EMPTY) continue;
    const flipped = flipsFor(board, pos, player);
    if (!flipped.length) continue;
    if (!any && depth <= 0) return evaluate(board, player);
    any = true;
    board[pos] = player;
    for (const p of flipped) board[p] = player;
    const score = -search(board, enemy, depth - 1, -beta, -alpha, false);
    board[pos] = EMPTY;
    for (const p of flipped) board[p] = enemy;
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  if (any) return best;
  if (passed) return finalScore(board, player);
  return -search(board, enemy, depth, -beta, -alpha, true);
}

// 컴퓨터가 둘 칸. 둘 곳이 없으면 null. pick(n)은 0 이상 n 미만을 고르게 뽑는 함수
export function pickMove(board, player, level, pick = randomIndex) {
  const moves = legalMoves(board, player);
  if (!moves.length) return null;
  if (level === "easy") {
    // 쉬움: 절반은 아무 데나, 절반은 가장 많이 뒤집는 곳 (초보가 흔히 두는 식)
    if (pick(2) === 0) return moves[pick(moves.length)];
    const most = Math.max(...moves.map((pos) => flipsFor(board, pos, player).length));
    const top = moves.filter((pos) => flipsFor(board, pos, player).length === most);
    return top[pick(top.length)];
  }
  const { depth, exact } = SEARCH[level] ?? SEARCH.normal;
  const empties = board.filter((v) => v === EMPTY).length;
  const plies = empties <= exact ? empties : depth;
  // 값이 같은 수는 판마다 다르게 두도록 먼저 섞는다
  const ordered = shuffle(moves, pick).sort((a, b) => WEIGHTS[b] - WEIGHTS[a]);
  const work = [...board];
  const enemy = 3 - player;
  let best = ordered[0];
  let bestScore = -Infinity;
  for (const pos of ordered) {
    const flipped = flipsFor(work, pos, player);
    work[pos] = player;
    for (const p of flipped) work[p] = player;
    const score = -search(work, enemy, plies - 1, -Infinity, -bestScore, false);
    work[pos] = EMPTY;
    for (const p of flipped) work[p] = enemy;
    if (score > bestScore) {
      bestScore = score;
      best = pos;
    }
  }
  return best;
}
