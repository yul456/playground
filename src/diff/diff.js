// 글 두 개를 줄 단위로 견주고, 바뀐 줄 안에서는 글자 단위로 견준다.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

// 줄을 견줄 때 이만큼 넘게 다르면(더하고 뺀 줄 수) 그 구간은 통째로 바뀐 것으로 본다. 기억할 것이 다른 수의 제곱만큼 늘어서다
const LINE_MAX_D = 2000;
// 글자를 견줄 때의 한도와, 글자 단위로 견줄 줄의 가장 긴 길이
const CHAR_MAX_D = 600;
export const CHAR_MAX_LENGTH = 3000;
// 바뀐 줄 한 쌍에서 같은 글자가 이 비율보다 적으면 다른 줄로 보고 글자 단위 표시를 하지 않는다
const ALIKE = 0.3;
// 바뀐 글자 사이에 낀 이보다 짧은 같은 글자는 바뀐 것으로 묶는다 (한두 글자씩 끊겨 보이지 않게)
const SHORT_SAME = 2;

// 글을 줄로 나눈다. 줄 바꿈 방식(윈도우 CRLF, 맥·리눅스 LF)은 가리지 않는다. 맨 앞의 BOM과 맨 끝의 줄 바꿈 하나는 뗀다
export function splitLines(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text === "") return [];
  const lines = text.split(/\r\n|\r|\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// 견줄 때 쓰는 줄의 모양. space: 빈칸 차이를 보지 않는다(앞뒤 빈칸은 떼고 이어진 빈칸은 하나로), letterCase: 대소문자를 가리지 않는다
export function lineKey(line, { space = false, letterCase = false } = {}) {
  let key = line;
  if (space) key = key.replace(/\s+/g, " ").trim();
  if (letterCase) key = key.toLowerCase();
  return key;
}

// Myers 방식으로 A[alo..ahi)와 B[blo..bhi)의 같은 자리를 찾아 out에 (a, b)를 이어 넣는다.
// 다른 것이 maxD개를 넘으면 찾기를 그만두고 false (그 구간은 통째로 바뀐 것으로 둔다)
function myers(A, alo, ahi, B, blo, bhi, out, maxD) {
  const n = ahi - alo;
  const m = bhi - blo;
  const max = Math.min(n + m, maxD);
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[alo + x] === B[blo + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    // d걸음째의 값 (k = -d … d). 되짚을 때 쓴다
    trace.push(v.slice(off - d, off + d + 1));
  }
  if (found < 0) return false;
  const back = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const prev = trace[d - 1];
    const get = (k) => (k < -(d - 1) || k > d - 1 ? -1 : prev[k + d - 1]);
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      back.push(alo + x, blo + y);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    back.push(alo + x, blo + y);
  }
  for (let i = back.length - 2; i >= 0; i -= 2) out.push(back[i], back[i + 1]);
  return true;
}

// 두 쪽에 한 번씩만 나오는 것들 가운데 순서가 맞는 가장 긴 줄기 (patience 방식의 닻). [a, b, a, b …]
function anchors(A, alo, ahi, B, blo, bhi) {
  const seen = new Map(); // 값 → [A에서 나온 수, A 자리, B에서 나온 수, B 자리]
  for (let i = alo; i < ahi; i++) {
    const entry = seen.get(A[i]);
    if (entry) entry[0]++;
    else seen.set(A[i], [1, i, 0, -1]);
  }
  for (let j = blo; j < bhi; j++) {
    const entry = seen.get(B[j]);
    if (entry) {
      entry[2]++;
      entry[3] = j;
    }
  }
  const pairs = [];
  for (let i = alo; i < ahi; i++) {
    const entry = seen.get(A[i]);
    if (entry[0] === 1 && entry[2] === 1) pairs.push(i, entry[3]);
  }
  const count = pairs.length / 2;
  if (count < 2) return pairs;
  // B 자리가 늘어나는 가장 긴 줄기
  const tails = []; // 길이마다 끝에 올 수 있는 가장 작은 B 자리를 가진 쌍의 번호
  const before = new Int32Array(count).fill(-1);
  for (let p = 0; p < count; p++) {
    const b = pairs[p * 2 + 1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid] * 2 + 1] < b) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) before[p] = tails[lo - 1];
    tails[lo] = p;
  }
  const chain = [];
  for (let p = tails[tails.length - 1]; p >= 0; p = before[p]) chain.push(p);
  const result = [];
  for (let i = chain.length - 1; i >= 0; i--) result.push(pairs[chain[i] * 2], pairs[chain[i] * 2 + 1]);
  return result;
}

// A와 B(견줄 수 있는 값의 배열)의 같은 자리를 찾는다. 결과는 a가 늘어나는 순서의 [a, b, a, b …].
// patience: 두 쪽에 한 번씩만 나오는 값을 닻으로 삼아 먼저 맞춘다 (줄을 견줄 때. 옮겨진 덩어리가 깔끔하게 나온다)
export function matchPairs(A, B, { maxD = LINE_MAX_D, patience = true } = {}) {
  const out = [];
  const stack = [[0, A.length, 0, B.length]];
  while (stack.length) {
    let [alo, ahi, blo, bhi] = stack.pop();
    while (alo < ahi && blo < bhi && A[alo] === B[blo]) out.push(alo++, blo++);
    while (alo < ahi && blo < bhi && A[ahi - 1] === B[bhi - 1]) out.push(--ahi, --bhi);
    if (alo === ahi || blo === bhi) continue;
    const found = patience ? anchors(A, alo, ahi, B, blo, bhi) : [];
    if (found.length) {
      let pa = alo;
      let pb = blo;
      for (let i = 0; i < found.length; i += 2) {
        stack.push([pa, found[i], pb, found[i + 1]]);
        out.push(found[i], found[i + 1]);
        pa = found[i] + 1;
        pb = found[i + 1] + 1;
      }
      stack.push([pa, ahi, pb, bhi]);
    } else {
      myers(A, alo, ahi, B, blo, bhi, out, maxD);
    }
  }
  // 구간을 차례 없이 풀었으므로 a 순서로 다시 놓는다
  const order = Array.from({ length: out.length / 2 }, (_, i) => i).sort((p, q) => out[p * 2] - out[q * 2]);
  const sorted = new Array(out.length);
  order.forEach((p, i) => {
    sorted[i * 2] = out[p * 2];
    sorted[i * 2 + 1] = out[p * 2 + 1];
  });
  return sorted;
}

// 바뀐 구간에서 닮은 줄끼리 짝지을 때: 닮았다고 보는 기준, 견줄 글자 수, 이보다 큰 구간(지운 줄 × 더한 줄)은 차례대로만 짝짓는다
const PAIR_ALIKE = 0.4;
const PAIR_LENGTH = 300;
const PAIR_CELLS = 10000;

// 줄에 든 두 글자 묶음들 (닮은 정도를 빨리 어림하려고)
function bigrams(text) {
  const chars = Array.from(text.slice(0, PAIR_LENGTH * 2)).slice(0, PAIR_LENGTH);
  const grams = new Map();
  for (let i = 0; i + 1 < chars.length; i++) {
    const gram = chars[i] + chars[i + 1];
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return { grams, total: Math.max(chars.length - 1, 0) };
}

// 두 줄이 닮은 정도 (0~1). 함께 든 두 글자 묶음의 몫
function likeness(a, b) {
  if (!a.total || !b.total) return 0;
  let common = 0;
  for (const [gram, count] of a.grams) common += Math.min(count, b.grams.get(gram) ?? 0);
  return (2 * common) / (a.total + b.total);
}

// 지운 줄들(dels)과 더한 줄들(adds) 가운데 닮은 줄끼리 순서를 지키며 짝짓는다. 결과: [지운 줄 번호, 더한 줄 번호, …]
export function alignBlock(dels, adds) {
  if (dels.length * adds.length > PAIR_CELLS) return [];
  const A = dels.map(bigrams);
  const B = adds.map(bigrams);
  const width = adds.length + 1;
  const best = new Float64Array((dels.length + 1) * width);
  const like = new Float64Array(dels.length * adds.length);
  for (let i = 1; i <= dels.length; i++) {
    for (let j = 1; j <= adds.length; j++) {
      const score = likeness(A[i - 1], B[j - 1]);
      like[(i - 1) * adds.length + j - 1] = score;
      let value = Math.max(best[(i - 1) * width + j], best[i * width + j - 1]);
      if (score >= PAIR_ALIKE) value = Math.max(value, best[(i - 1) * width + j - 1] + score);
      best[i * width + j] = value;
    }
  }
  const pairs = [];
  let i = dels.length;
  let j = adds.length;
  while (i > 0 && j > 0) {
    const score = like[(i - 1) * adds.length + j - 1];
    if (score >= PAIR_ALIKE && best[i * width + j] === best[(i - 1) * width + j - 1] + score) {
      pairs.push(i - 1, j - 1);
      i--;
      j--;
    } else if (best[i * width + j] === best[(i - 1) * width + j]) i--;
    else j--;
  }
  const ordered = [];
  for (let p = pairs.length - 2; p >= 0; p -= 2) ordered.push(pairs[p], pairs[p + 1]);
  return ordered;
}

// 조각들에서 바뀐 것 사이에 낀 짧은 같은 조각을 바뀐 것으로 묶고, 이어진 같은 종류를 합친다
function tidy(parts) {
  const merged = [];
  parts.forEach((part, i) => {
    const between = !part.changed && i > 0 && i < parts.length - 1 && part.text.length < SHORT_SAME && /\S/.test(part.text);
    const changed = part.changed || between;
    const last = merged[merged.length - 1];
    if (last && last.changed === changed) last.text += part.text;
    else merged.push({ text: part.text, changed });
  });
  return merged;
}

// 바뀐 줄 한 쌍을 글자 단위로 견준다. 결과: { left, right: [{ text, changed }] } 또는 null(너무 길거나 서로 너무 다른 줄).
// 짝을 이루는 두 글자(이모지 등)가 갈라지지 않게 글자(코드 포인트) 단위로 본다
export function charParts(left, right, options = {}) {
  const a = Array.from(left);
  const b = Array.from(right);
  if (a.length > CHAR_MAX_LENGTH || b.length > CHAR_MAX_LENGTH) return null;
  const fold = (ch) => (options.letterCase ? ch.toLowerCase() : ch);
  const pairs = matchPairs(a.map(fold), b.map(fold), { maxD: CHAR_MAX_D, patience: false });
  const same = pairs.length / 2;
  if (same < Math.max(a.length, b.length) * ALIKE) return null;
  const build = (chars, side) => {
    const parts = [];
    let at = 0;
    const push = (text, changed) => text && parts.push({ text, changed });
    for (let i = 0; i < pairs.length; i += 2) {
      const index = pairs[i + side];
      push(chars.slice(at, index).join(""), true);
      // 이어진 같은 글자를 한 조각으로
      let end = i;
      while (end + 2 < pairs.length && pairs[end + 2] === pairs[end] + 1 && pairs[end + 3] === pairs[end + 1] + 1) end += 2;
      const last = pairs[end + side];
      push(chars.slice(index, last + 1).join(""), false);
      at = last + 1;
      i = end;
    }
    push(chars.slice(at).join(""), true);
    return tidy(parts);
  };
  return { left: build(a, 0), right: build(b, 1) };
}

// 두 글을 견준다. options: { space, letterCase } (lineKey).
// 결과: { rows, stats: { same, changed, added, removed }, left: 왼쪽 줄 수, right: 오른쪽 줄 수 }
// rows의 한 줄: { type: 'same' | 'change' | 'del' | 'ins', left: { n: 줄 번호, text, parts? } | null, right: … | null }
// change는 지운 줄과 더한 줄을 차례로 짝지은 것이고, 서로 닮았으면 parts(글자 단위 조각)가 붙는다
export function diffTexts(leftText, rightText, options = {}) {
  const left = splitLines(leftText);
  const right = splitLines(rightText);
  // 같은 줄은 같은 번호로 바꿔 견준다
  const ids = new Map();
  const idOf = (line) => {
    const key = lineKey(line, options);
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size));
    return id;
  };
  const A = Int32Array.from(left, idOf);
  const B = Int32Array.from(right, idOf);
  const pairs = matchPairs(A, B);
  const rows = [];
  const stats = { same: 0, changed: 0, added: 0, removed: 0 };
  const side = (lines, i, parts) => (parts ? { n: i + 1, text: lines[i], parts } : { n: i + 1, text: lines[i] });
  // 지운 줄과 더한 줄을 앞에서부터 차례로 짝짓고, 남는 줄은 한쪽만 둔다
  const inOrder = (a, aEnd, b, bEnd) => {
    while (a < aEnd && b < bEnd) {
      const parts = charParts(left[a], right[b], options);
      rows.push({ type: "change", left: side(left, a, parts?.left), right: side(right, b, parts?.right) });
      stats.changed++;
      a++;
      b++;
    }
    for (; a < aEnd; a++, stats.removed++) rows.push({ type: "del", left: side(left, a), right: null });
    for (; b < bEnd; b++, stats.added++) rows.push({ type: "ins", left: null, right: side(right, b) });
  };
  // 같은 줄 사이의 구간: 닮은 줄끼리 먼저 짝짓고(alignBlock), 그 사이사이는 차례대로 짝짓는다
  const block = (a, aEnd, b, bEnd) => {
    if (a === aEnd || b === bEnd) return inOrder(a, aEnd, b, bEnd);
    const key = (line) => lineKey(line, options);
    const alike = alignBlock(left.slice(a, aEnd).map(key), right.slice(b, bEnd).map(key));
    let da = a;
    let db = b;
    for (let p = 0; p < alike.length; p += 2) {
      const pa = a + alike[p];
      const pb = b + alike[p + 1];
      inOrder(da, pa, db, pb);
      inOrder(pa, pa + 1, pb, pb + 1);
      da = pa + 1;
      db = pb + 1;
    }
    inOrder(da, aEnd, db, bEnd);
  };
  let a = 0;
  let b = 0;
  for (let i = 0; i < pairs.length; i += 2) {
    block(a, pairs[i], b, pairs[i + 1]);
    a = pairs[i];
    b = pairs[i + 1];
    rows.push({ type: "same", left: side(left, a), right: side(right, b) });
    stats.same++;
    a++;
    b++;
  }
  block(a, left.length, b, right.length);
  return { rows, stats, left: left.length, right: right.length };
}

// 화면에 보일 줄. 바뀐 곳의 앞뒤 context줄만 남기고 그 사이의 같은 줄은 접는다.
// opened: 펼친 접힌 곳(첫 줄의 rows 번호)의 Set. context가 Infinity면 접지 않는다.
// 결과: [{ row, index } | { gap: 접힌 줄 수, index: 접힌 첫 줄의 rows 번호 }]
export function foldRows(rows, context = 3, opened = new Set()) {
  const items = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== "same") {
      items.push({ row: rows[i], index: i });
      i++;
      continue;
    }
    let end = i;
    while (end < rows.length && rows[end].type === "same") end++;
    // 같은 줄이 이어진 구간 [i, end). 맨 앞 구간은 뒤쪽만, 맨 뒤 구간은 앞쪽만 남긴다
    const head = i === 0 ? 0 : context;
    const tail = end === rows.length ? 0 : context;
    const hidden = end - i - head - tail;
    // 한두 줄을 접어 봐야 접힌 줄 표시가 그만큼 자리를 차지한다
    if (hidden < 2 || opened.has(i + head)) {
      for (let r = i; r < end; r++) items.push({ row: rows[r], index: r });
    } else {
      for (let r = i; r < i + head; r++) items.push({ row: rows[r], index: r });
      items.push({ gap: hidden, index: i + head });
      for (let r = end - tail; r < end; r++) items.push({ row: rows[r], index: r });
    }
    i = end;
  }
  return items;
}
