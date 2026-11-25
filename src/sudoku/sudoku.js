// 스도쿠 규칙, 문제 만들기, 사람처럼 푸는 풀이기. 화면 코드가 없어 Node에서 시험할 수 있다.
// 판은 숫자 81개짜리 배열이다(0은 빈칸, 왼쪽 위부터 가로로). 함수는 받은 판을 고치지 않고 새 판을 돌려준다.
import { randomIndex, shuffle } from "../shared/random.js";

export const LEVELS = ["easy", "medium", "hard", "expert"];
export const LEVEL_LABELS = { easy: "쉬움", medium: "보통", hard: "어려움", expert: "아주 어려움" };
// 난이도는 푸는 데 필요한 가장 어려운 기술로 정한다 (아래 findStep의 level)
const LEVEL_NUM = { easy: 1, medium: 2, hard: 3, expert: 4 };
// 빈칸을 이만큼까지 판다. 아주 어려움은 더 지울 수 없을 때까지 판다
const TARGET_BLANKS = { easy: 40, medium: 48, hard: 54, expert: 81 };
// 바라는 난이도가 나올 때까지 다시 만드는 횟수
const MAX_ATTEMPTS = 60;

const ALL = 0x1ff;
const rowOf = (i) => Math.floor(i / 9);
const colOf = (i) => i % 9;
const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);
const bit = (d) => 1 << (d - 1);
function bitCount(mask) {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}
const digitsOf = (mask) => [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((d) => mask & bit(d));

// 묶음 27개: 가로줄 0~8, 세로줄 9~17, 상자 18~26
export const UNITS = [];
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let b = 0; b < 9; b++) {
  const r0 = Math.floor(b / 3) * 3;
  const c0 = (b % 3) * 3;
  UNITS.push(Array.from({ length: 9 }, (_, k) => (r0 + Math.floor(k / 3)) * 9 + c0 + (k % 3)));
}
// 칸마다 같은 가로줄·세로줄·상자에 있는 다른 칸 20개
export const PEERS = Array.from({ length: 81 }, (_, i) => {
  const set = new Set([...UNITS[rowOf(i)], ...UNITS[9 + colOf(i)], ...UNITS[18 + boxOf(i)]]);
  set.delete(i);
  return [...set];
});

const BOX_NAMES = ["왼쪽 위", "가운데 위", "오른쪽 위", "왼쪽 가운데", "한가운데", "오른쪽 가운데", "왼쪽 아래", "가운데 아래", "오른쪽 아래"];
const unitName = (u) => (u < 9 ? `${u + 1}번째 가로줄` : u < 18 ? `${u - 8}번째 세로줄` : `${BOX_NAMES[u - 18]} 상자`);
// 숫자 뒤에 붙는 조사: 1·3·6·7·8은 받침이 있다
const ga = (d) => ([1, 3, 6, 7, 8].includes(d) ? "이" : "가");

// 답의 개수를 limit까지만 센다. 후보가 가장 적은 칸부터 채워 본다
export function countSolutions(grid, limit = 2) {
  const cells = grid.slice();
  const rows = new Array(9).fill(0);
  const cols = new Array(9).fill(0);
  const boxes = new Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!cells[i]) continue;
    const b = bit(cells[i]);
    // 주어진 숫자끼리 겹치면 답이 없다
    if ((rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]) & b) return 0;
    rows[rowOf(i)] |= b;
    cols[colOf(i)] |= b;
    boxes[boxOf(i)] |= b;
  }
  let count = 0;
  const go = () => {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue;
      const mask = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = bitCount(mask);
      if (n === 0) return;
      if (n < bestN) {
        best = i;
        bestMask = mask;
        bestN = n;
        if (n === 1) break;
      }
    }
    if (best === -1) {
      count++;
      return;
    }
    const r = rowOf(best);
    const c = colOf(best);
    const bx = boxOf(best);
    for (let d = 1; d <= 9 && count < limit; d++) {
      const b = bit(d);
      if (!(bestMask & b)) continue;
      cells[best] = d;
      rows[r] |= b;
      cols[c] |= b;
      boxes[bx] |= b;
      go();
      cells[best] = 0;
      rows[r] &= ~b;
      cols[c] &= ~b;
      boxes[bx] &= ~b;
    }
  };
  go();
  return count;
}

// 규칙에 맞게 꽉 찬 판 하나. 칸마다 넣어 볼 숫자의 순서를 섞는다
export function fullGrid(pick = randomIndex) {
  const cells = new Array(81).fill(0);
  const used = (i) => PEERS[i].reduce((m, p) => (cells[p] ? m | bit(cells[p]) : m), 0);
  const go = () => {
    let best = -1;
    let bestMask = 0;
    let bestN = 10;
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue;
      const mask = ALL & ~used(i);
      const n = bitCount(mask);
      if (n === 0) return false;
      if (n < bestN) {
        best = i;
        bestMask = mask;
        bestN = n;
      }
    }
    if (best === -1) return true;
    for (const d of shuffle(digitsOf(bestMask), pick)) {
      cells[best] = d;
      if (go()) return true;
    }
    cells[best] = 0;
    return false;
  };
  go();
  return cells;
}

// 빈칸마다 들어갈 수 있는 숫자(비트 묶음). 숫자가 있는 칸은 0
export function candidatesOf(values) {
  return values.map((v, i) => (v ? 0 : ALL & ~PEERS[i].reduce((m, p) => (values[p] ? m | bit(values[p]) : m), 0)));
}

// 다음 한 수를 쉬운 기술부터 찾는다. 넣을 칸을 찾으면 { cell, digit }, 후보만 지우면 { remove: [[칸, 지울 비트]] }.
// level 1: 들어갈 숫자가 하나뿐인 칸. 2: 묶음에서 그 숫자가 갈 칸이 하나뿐. 3: 후보 지우기(줄·상자 겹침, 두 칸·세 칸 묶음)
function findStep(values, cands, maxLevel) {
  for (let i = 0; i < 81; i++) {
    if (!values[i] && bitCount(cands[i]) === 1) {
      const digit = digitsOf(cands[i])[0];
      return { level: 1, kind: "naked", cell: i, digit, text: "이 칸에 들어갈 수 있는 숫자는 하나뿐입니다. 같은 가로줄·세로줄·상자에 나머지 숫자가 모두 있습니다." };
    }
  }
  if (maxLevel < 2) return null;
  for (let u = 0; u < 27; u++) {
    for (let d = 1; d <= 9; d++) {
      const where = UNITS[u].filter((i) => cands[i] & bit(d));
      if (where.length === 1) {
        return { level: 2, kind: "hidden", cell: where[0], digit: d, unit: u, text: `${unitName(u)}에서 이 숫자가 들어갈 수 있는 칸은 여기뿐입니다.` };
      }
    }
  }
  if (maxLevel < 3) return null;
  const removal = (targets, mask, text) => {
    const remove = targets.filter((i) => cands[i] & mask).map((i) => [i, cands[i] & mask]);
    return remove.length ? { level: 3, kind: "remove", remove, text } : null;
  };
  // 줄·상자 겹침: 한 묶음에서 그 숫자가 갈 칸이 모두 다른 묶음 하나에 들어 있으면, 그 묶음의 나머지 칸에서는 뺀다
  for (let u = 0; u < 27; u++) {
    for (let d = 1; d <= 9; d++) {
      const where = UNITS[u].filter((i) => cands[i] & bit(d));
      if (where.length < 2 || where.length > 3) continue;
      const others = u >= 18
        ? [rowOf(where[0]), 9 + colOf(where[0])].filter((o) => where.every((i) => UNITS[o].includes(i)))
        : [18 + boxOf(where[0])].filter((o) => where.every((i) => UNITS[o].includes(i)));
      for (const o of others) {
        const step = removal(
          UNITS[o].filter((i) => !where.includes(i)),
          bit(d),
          `${unitName(u)}에서 ${d}${ga(d)} 들어갈 칸은 모두 ${unitName(o)}에 있습니다. 그래서 ${unitName(o)}의 다른 칸에는 ${d}${ga(d)} 들어갈 수 없습니다.`,
        );
        if (step) return step;
      }
    }
  }
  // 두 칸·세 칸 묶음: 칸 n개의 후보를 모으면 숫자가 n개뿐일 때, 그 숫자들은 그 칸들의 것이다
  for (let u = 0; u < 27; u++) {
    const open = UNITS[u].filter((i) => !values[i]);
    for (const size of [2, 3]) {
      if (open.length <= size) continue;
      for (const group of combos(open, size)) {
        const mask = group.reduce((m, i) => m | cands[i], 0);
        if (bitCount(mask) !== size) continue;
        const step = removal(
          open.filter((i) => !group.includes(i)),
          mask,
          `${unitName(u)}의 칸 ${size}개에는 ${digitsOf(mask).join("·")}만 들어갈 수 있습니다. 그래서 그 묶음의 다른 칸에는 이 숫자들이 들어갈 수 없습니다.`,
        );
        if (step) return step;
      }
    }
  }
  // 숨은 두 칸 묶음: 숫자 둘이 같은 두 칸에만 들어갈 수 있으면, 그 두 칸의 다른 후보는 지운다
  for (let u = 0; u < 27; u++) {
    for (let a = 1; a <= 8; a++) {
      const whereA = UNITS[u].filter((i) => cands[i] & bit(a));
      if (whereA.length !== 2) continue;
      for (let b = a + 1; b <= 9; b++) {
        const whereB = UNITS[u].filter((i) => cands[i] & bit(b));
        if (whereB.length !== 2 || whereB[0] !== whereA[0] || whereB[1] !== whereA[1]) continue;
        const step = removal(
          whereA,
          ALL & ~(bit(a) | bit(b)),
          `${unitName(u)}에서 ${a}와 ${b}는 같은 두 칸에만 들어갈 수 있습니다. 그래서 그 두 칸에는 다른 숫자가 들어갈 수 없습니다.`,
        );
        if (step) return step;
      }
    }
  }
  return null;
}

function combos(items, size) {
  const out = [];
  const go = (start, picked) => {
    if (picked.length === size) {
      out.push(picked);
      return;
    }
    for (let k = start; k < items.length; k++) go(k + 1, [...picked, items[k]]);
  };
  go(0, []);
  return out;
}

function applyStep(values, cands, step) {
  if (step.cell !== undefined) {
    values[step.cell] = step.digit;
    cands[step.cell] = 0;
    for (const p of PEERS[step.cell]) cands[p] &= ~bit(step.digit);
  } else {
    for (const [i, mask] of step.remove) cands[i] &= ~mask;
  }
}

// 사람처럼 풀어 본다. solved: maxLevel까지의 기술로 다 풀렸는지, level: 쓴 기술 가운데 가장 어려운 것
export function rate(puzzle, maxLevel = 3) {
  const values = puzzle.slice();
  const cands = candidatesOf(values);
  let level = 1;
  for (;;) {
    const step = findStep(values, cands, maxLevel);
    if (!step) break;
    level = Math.max(level, step.level);
    applyStep(values, cands, step);
  }
  return { solved: values.every(Boolean), level };
}

// 난이도에 맞는 문제를 만든다. 꽉 찬 판에서 칸을 무작위 순서로 지워 보고, 그 난이도의 기술로 여전히 풀리면 지운 채로 둔다.
// 기술로 풀리는 문제는 답이 하나뿐이다. 아주 어려움은 답이 하나뿐인 동안 지우고, 위 기술만으로는 안 풀리는 것을 고른다
export function generate(level, pick = randomIndex) {
  const want = LEVEL_NUM[level];
  let fallback = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const solution = fullGrid(pick);
    const puzzle = solution.slice();
    let blanks = 0;
    for (const i of shuffle([...puzzle.keys()], pick)) {
      if (blanks >= TARGET_BLANKS[level]) break;
      const d = puzzle[i];
      puzzle[i] = 0;
      const ok = want === 4 ? countSolutions(puzzle) === 1 : rate(puzzle, want).solved;
      if (ok) blanks++;
      else puzzle[i] = d;
    }
    const rated = rate(puzzle, 3);
    const got = rated.solved ? rated.level : 4;
    const made = { puzzle, solution, got };
    if (got === want) return made;
    // 끝내 못 맞추면 바라는 난이도에 가장 가까운 것을 쓴다
    if (!fallback || Math.abs(got - want) < Math.abs(fallback.got - want)) fallback = made;
  }
  return fallback;
}

export function newGame(level, pick = randomIndex) {
  const { puzzle, solution } = generate(level, pick);
  return { level, puzzle, solution, values: puzzle.slice(), notes: new Array(81).fill(0), status: "playing" };
}

const finish = (game) => ({ ...game, status: game.values.every((v, i) => v === game.solution[i]) ? "won" : "playing" });

// 숫자 넣기. 같은 숫자를 다시 넣으면 지운다. 넣으면 그 칸의 메모와, 같은 줄·상자에 적어 둔 그 숫자 메모를 지운다
export function setValue(game, cell, digit) {
  if (game.status !== "playing" || game.puzzle[cell]) return game;
  const values = game.values.slice();
  const notes = game.notes.slice();
  values[cell] = values[cell] === digit ? 0 : digit;
  if (values[cell]) {
    notes[cell] = 0;
    for (const p of PEERS[cell]) notes[p] &= ~bit(digit);
  }
  return finish({ ...game, values, notes });
}

// 메모 적기·지우기. 숫자가 든 칸에는 적지 않는다
export function toggleNote(game, cell, digit) {
  if (game.status !== "playing" || game.values[cell]) return game;
  const notes = game.notes.slice();
  notes[cell] ^= bit(digit);
  return { ...game, notes };
}

// 칸 비우기: 숫자가 있으면 숫자를, 없으면 메모를 지운다
export function erase(game, cell) {
  if (game.status !== "playing" || game.puzzle[cell]) return game;
  const values = game.values.slice();
  const notes = game.notes.slice();
  if (values[cell]) values[cell] = 0;
  else notes[cell] = 0;
  return { ...game, values, notes };
}

export const noteDigits = (mask) => digitsOf(mask);
export const wrongCells = (game) => game.values.flatMap((v, i) => (v && v !== game.solution[i] ? [i] : []));
// 숫자마다 판에 놓인 개수 (1~9, 0번 자리는 쓰지 않는다)
export function digitCounts(values) {
  const counts = new Array(10).fill(0);
  for (const v of values) counts[v]++;
  return counts;
}

// 다음에 넣을 수 있는 칸과 까닭. 틀린 칸이 있으면 그것부터 알린다.
// 후보를 지워야 보이는 칸이면 지우는 까닭(before)을 함께 준다. 위 기술로 안 나오면 후보가 가장 적은 칸의 답을 알려 준다
export function hint(game) {
  const wrong = wrongCells(game);
  if (wrong.length) return { kind: "wrong", cells: wrong };
  const values = game.values.slice();
  const cands = candidatesOf(values);
  const before = [];
  for (;;) {
    const step = findStep(values, cands, 3);
    if (!step) break;
    if (step.cell !== undefined) return { kind: step.kind, cell: step.cell, digit: step.digit, text: step.text, before };
    before.push(step.text);
    applyStep(values, cands, step);
  }
  let cell = -1;
  for (let i = 0; i < 81; i++) {
    if (!values[i] && (cell === -1 || bitCount(cands[i]) < bitCount(cands[cell]))) cell = i;
  }
  if (cell === -1) return null;
  return { kind: "reveal", cell, digit: game.solution[cell], text: "이 화면이 아는 기술로는 다음 칸이 나오지 않습니다. 이 칸의 답을 알려 드립니다.", before: [] };
}

// 저장한 판 읽기. 모양이 맞지 않거나 문제와 답이 어긋나면 버린다
const toText = (cells) => cells.join("");
const fromText = (text) => (typeof text === "string" && /^[0-9]{81}$/.test(text) ? [...text].map(Number) : null);

export function packGame(game) {
  return { level: game.level, puzzle: toText(game.puzzle), solution: toText(game.solution), values: toText(game.values), notes: game.notes };
}

export function unpackGame(saved) {
  if (!saved || !LEVELS.includes(saved.level)) return null;
  const puzzle = fromText(saved.puzzle);
  const solution = fromText(saved.solution);
  const values = fromText(saved.values);
  if (!puzzle || !solution || !values || solution.includes(0)) return null;
  if (countSolutions(solution, 1) !== 1) return null;
  if (puzzle.some((v, i) => (v && v !== solution[i]) || (v && values[i] !== v))) return null;
  const notes = Array.isArray(saved.notes) && saved.notes.length === 81 && saved.notes.every((n) => Number.isInteger(n) && n >= 0 && n <= ALL)
    ? saved.notes.map((n, i) => (values[i] ? 0 : n))
    : new Array(81).fill(0);
  return finish({ level: saved.level, puzzle, solution, values, notes, status: "playing" });
}
