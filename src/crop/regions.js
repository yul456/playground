// 사진을 눌러 자를 곳을 정한다: 누른 곳을 둘러싼 테두리 안쪽, 바깥 여백. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// image: { width, height, data } (RGBA)
//
// 누른 곳에 맞추기(fitRegion): 누른 화소와 비슷한 색으로 이어진 곳(4방향)을 찾고, 그곳과 그 안에 든 것(글자·그림 등 둘러싸인 것)을
// 남긴다. 테두리가 여러 겹이면 누른 곳에 따라 몇째 겹 안쪽까지 남길지 정해진다 (가장 안쪽 흰 곳을 누르면 그 흰 곳만,
// 둘째 겹 사이를 누르면 둘째 테두리 안쪽 모두). 둘러싼 테두리의 화소가 자를 곳 가장자리에 남지 않게 한다:
//   1. 이어진 곳의 바깥(둘러싼 테두리 쪽)과 닿은 화소가 가장자리 줄에 있으면 그 줄을 안으로 당긴다 (둥근 모서리. 4px까지,
//      그 안에서 다 피할 수 없는 팔각형 같은 비스듬한 모서리면 당기지 않는다)
//   2. 가장자리 줄이 누른 색과 조금씩 다르면(선의 흐린 가장자리) 3px까지 더 당긴다
// 선 안쪽에 맞추기(inside): 테두리 선을 누르면, 그 선이 둘러싼 곳(가장 큰 구멍)에 맞춘다. 사진이 테두리에 바로 붙어 있어
// 사진을 눌러서는 이어진 곳을 찾을 수 없을 때 쓴다.
// 바깥 여백(trimMargins): 네 모서리의 바탕색과 같은 줄을 둘레에서 걷어 낸다
// 직선 경계에 붙이기(snapEdge): 자를 줄을 끌 때, 가까이에 색이 바뀌는 곧은 줄(경계)이 있으면 거기에 딱 붙인다
//
// 직선 경계: 이웃한 두 줄(가로줄이나 세로줄) 사이에서 색이 40 넘게 바뀌는 화소가 그 줄 길이의 절반 이상인 곳 (edgeShare).
// 사진 두 장을 나란히 붙인 그림이면 두 사진이 만나는 세로줄이 그렇다. 사진 속 무늬는 짧아서 경계가 되지 않는다.
// 누르기(fitAt)는 먼저 누른 곳과 같은 색으로 이어진 곳을 보고(fitRegion, 테두리 그림처럼 색이 고른 그림), 그곳의 네 변이 모두
// 직선 경계(나 그림 끝)에 닿아 있을 때만 그것을 쓴다. 아니면(사진처럼 색이 고르지 않으면) 누른 곳에서 네 쪽으로 가장 가까운 직선 경계까지를
// 남긴다(fitStraight)

// 같은 곳으로 볼 색 차이 (누른 화소의 색과 채널마다 견준다)
const TOLERANCE = 48;
// 가장자리 줄이 누른 색과 이보다 평균으로 더 다르면 흐린 가장자리로 보고 더 당긴다
const FRINGE = 16;
const FRINGE_MAX = 3;
// 바깥 여백으로 볼 색 차이
const MARGIN_TOLERANCE = 24;
// 한 가지 색으로 칠한 곳으로 볼 색 차이와 그런 화소의 몫 (누르기가 그곳을 쓸지 정한다)
const FLAT_COLOR = 12;
const FLAT_SHARE = 0.6;
// 둘러싼 쪽 화소를 피하려고 변을 당기는 것은 이만큼까지 (둥근 모서리). 팔각형처럼 비스듬한 모서리는 남긴다
const CORNER_MAX = 4;

const near = (data, i, color, tolerance) =>
  Math.abs(data[i] - color[0]) <= tolerance && Math.abs(data[i + 1] - color[1]) <= tolerance && Math.abs(data[i + 2] - color[2]) <= tolerance;

// (x, y)와 비슷한 색으로 이어진 곳. mask[p] = 1이면 그곳. box: 둘레 { x0, y0, x1, y1 } (끝 포함),
// flat: 그곳의 화소 가운데 누른 색과 거의 같은(12 안) 것의 몫 (그림처럼 한 가지 색으로 칠한 곳은 1에 가깝고, 사진은 작다)
export function floodRegion({ width, height, data }, x, y, tolerance = TOLERANCE) {
  const start = y * width + x;
  const color = [data[start * 4], data[start * 4 + 1], data[start * 4 + 2]];
  const mask = new Uint8Array(width * height);
  const stack = new Int32Array(width * height);
  let top = 0;
  stack[top++] = start;
  mask[start] = 1;
  let x0 = x;
  let x1 = x;
  let y0 = y;
  let y1 = y;
  let count = 0;
  let same = 0;
  const visit = (p) => {
    if (!mask[p] && near(data, p * 4, color, tolerance)) {
      mask[p] = 1;
      stack[top++] = p;
    }
  };
  while (top) {
    const p = stack[--top];
    count++;
    if (near(data, p * 4, color, FLAT_COLOR)) same++;
    const px = p % width;
    const py = (p - px) / width;
    if (px < x0) x0 = px;
    if (px > x1) x1 = px;
    if (py < y0) y0 = py;
    if (py > y1) y1 = py;
    if (px > 0) visit(p - 1);
    if (px < width - 1) visit(p + 1);
    if (py > 0) visit(p - width);
    if (py < height - 1) visit(p + width);
  }
  return { mask, color, box: { x0, y0, x1, y1 }, count, flat: same / count };
}

// box 안에서 bad(p)인 화소가 가장자리 줄에 없을 때까지 줄을 안으로 당긴다. 매번 bad 화소가 가장 많은(몫으로) 줄을 당긴다.
// limit: 한쪽을 이만큼 당겼으면 그쪽은 더 당기지 않는다
function shrinkAway(box, width, bad, limit = Infinity) {
  let { x0, y0, x1, y1 } = box;
  const moved = { top: 0, bottom: 0, left: 0, right: 0 };
  const row = (y) => {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (bad(y * width + x)) n++;
    return n / (x1 - x0 + 1);
  };
  const col = (x) => {
    let n = 0;
    for (let y = y0; y <= y1; y++) if (bad(y * width + x)) n++;
    return n / (y1 - y0 + 1);
  };
  for (let guard = 0; x0 <= x1 && y0 <= y1 && guard < 100000; guard++) {
    const sides = [
      ["top", moved.top < limit ? row(y0) : 0],
      ["bottom", moved.bottom < limit ? row(y1) : 0],
      ["left", moved.left < limit ? col(x0) : 0],
      ["right", moved.right < limit ? col(x1) : 0],
    ];
    const [side, share] = sides.reduce((a, b) => (b[1] > a[1] ? b : a));
    if (share === 0) return { x0, y0, x1, y1 };
    moved[side]++;
    if (side === "top") y0++;
    else if (side === "bottom") y1--;
    else if (side === "left") x0++;
    else x1--;
  }
  return null;
}

// 네모의 네 변 위에 bad(p)인 화소가 있는지
function onLines(rect, width, bad) {
  for (let x = rect.x0; x <= rect.x1; x++) if (bad(rect.y0 * width + x) || bad(rect.y1 * width + x)) return true;
  for (let y = rect.y0; y <= rect.y1; y++) if (bad(y * width + rect.x0) || bad(y * width + rect.x1)) return true;
  return false;
}

// box 안에서 inside(p)가 아닌 화소 가운데 box 둘레와 이어진 것(둘러싼 쪽). 4방향으로 퍼진다
function outsideOf(box, width, inside) {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const out = new Uint8Array(bw * bh);
  const stack = new Int32Array(bw * bh);
  let top = 0;
  const push = (lx, ly) => {
    const q = ly * bw + lx;
    if (out[q] || inside((box.y0 + ly) * width + box.x0 + lx)) return;
    out[q] = 1;
    stack[top++] = q;
  };
  for (let lx = 0; lx < bw; lx++) {
    push(lx, 0);
    push(lx, bh - 1);
  }
  for (let ly = 0; ly < bh; ly++) {
    push(0, ly);
    push(bw - 1, ly);
  }
  while (top) {
    const q = stack[--top];
    const lx = q % bw;
    const ly = (q - lx) / bw;
    if (lx > 0) push(lx - 1, ly);
    if (lx < bw - 1) push(lx + 1, ly);
    if (ly > 0) push(lx, ly - 1);
    if (ly < bh - 1) push(lx, ly + 1);
  }
  return (p) => {
    const px = p % width;
    const py = (p - px) / width;
    return out[(py - box.y0) * bw + (px - box.x0)] === 1;
  };
}

// 가장자리 줄이 누른 색과 평균으로 FRINGE보다 다르면(선의 흐린 가장자리) FRINGE_MAX까지 더 당긴다.
// 그곳(mask)의 화소만 본다. 팔각형의 모서리처럼 줄에 걸친 바깥 화소는 흐린 가장자리가 아니다
function trimFringe(rect, image, color, mask) {
  const { width, data } = image;
  const lineDiff = (from, step, n) => {
    let sum = 0;
    let m = 0;
    for (let k = 0; k < n; k++) {
      const p = from + k * step;
      if (mask && !mask[p]) continue;
      const i = p * 4;
      sum += Math.max(Math.abs(data[i] - color[0]), Math.abs(data[i + 1] - color[1]), Math.abs(data[i + 2] - color[2]));
      m++;
    }
    return m < n * 0.3 ? 0 : sum / m;
  };
  let { x0, y0, x1, y1 } = rect;
  for (let k = 0; k < FRINGE_MAX && y0 < y1 && lineDiff(y0 * width + x0, 1, x1 - x0 + 1) > FRINGE; k++) y0++;
  for (let k = 0; k < FRINGE_MAX && y1 > y0 && lineDiff(y1 * width + x0, 1, x1 - x0 + 1) > FRINGE; k++) y1--;
  for (let k = 0; k < FRINGE_MAX && x0 < x1 && lineDiff(y0 * width + x0, width, y1 - y0 + 1) > FRINGE; k++) x0++;
  for (let k = 0; k < FRINGE_MAX && x1 > x0 && lineDiff(y0 * width + x1, width, y1 - y0 + 1) > FRINGE; k++) x1--;
  return { x0, y0, x1, y1 };
}

const toCrop = (rect, width, height) => ({ top: rect.y0, bottom: height - 1 - rect.y1, left: rect.x0, right: width - 1 - rect.x1 });

// 누른 곳 (x, y)에 맞춘 자를 곳 { top, bottom, left, right } 와 어떻게 맞췄는지(how: area · inside). 못 찾으면 null.
// inside: 누른 선이 둘러싼 곳에 맞춘다(선은 잘라 낸다). 둘러싼 곳이 없으면 이어진 곳에 맞춘다
export function fitRegion(image, x, y, { inside = false } = {}) {
  const { width, height } = image;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  const region = floodRegion(image, x, y);
  const { mask, box, color } = region;
  const isRegion = (p) => mask[p] === 1;
  const outside = outsideOf(box, width, isRegion);
  if (inside) {
    // 선 안쪽: 이어진 곳(선)도 바깥도 아닌 화소가 구멍이다. 가장 큰 구멍의 둘레에 맞추고, 선이 가장자리에 남지 않게 당긴다
    const hole = largestHole(box, width, (p) => !isRegion(p) && !outside(p));
    const rect = hole && shrinkAway(hole, width, (p) => isRegion(p) || outside(p));
    if (rect) {
      // 선의 흐린 가장자리(둥근 모서리의 회색 화소 등)는 선과 같은 색이 아니어서 구멍에 든다. 안쪽 색보다 선의 색에 가까운 화소가
      // 가장자리 줄에 있으면 3px까지 더 당긴다 (안쪽 색은 가운데 화소. 사진이 들어 있으면 덜 맞지만 3px까지만 당긴다)
      const { data } = image;
      const mid = (((rect.y0 + rect.y1) >> 1) * width + ((rect.x0 + rect.x1) >> 1)) * 4;
      const innerColor = [data[mid], data[mid + 1], data[mid + 2]];
      const gap = (i, c) => Math.max(Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2]));
      const lineLike = (p) => gap(p * 4, color) < gap(p * 4, innerColor);
      return { ...toCrop(shrinkAway(rect, width, lineLike, FRINGE_MAX) ?? rect, width, height), how: "inside" };
    }
  }
  // 둥근 모서리처럼 4px 안에서 둘러싼 쪽 화소를 다 피할 수 있을 때만 당긴다. 팔각형처럼 비스듬한 모서리는 당겨도 피할 수 없어
  // 당기지 않은 둘레(곧은 변에 닿은 네모)를 쓴다
  let rect = shrinkAway(box, width, outside, CORNER_MAX);
  if (!rect) return null;
  if (onLines(rect, width, outside)) rect = box;
  return { ...toCrop(trimFringe(rect, image, color, mask), width, height), how: "area", flat: region.flat, count: region.count };
}

// box 안에서 hole(p)인 화소들이 이어진 덩어리 가운데 가장 큰 것의 둘레
function largestHole(box, width, hole) {
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const seen = new Uint8Array(bw * bh);
  const stack = new Int32Array(bw * bh);
  let best = null;
  for (let start = 0; start < bw * bh; start++) {
    if (seen[start]) continue;
    const sx = start % bw;
    const sy = (start - sx) / bw;
    if (!hole((box.y0 + sy) * width + box.x0 + sx)) continue;
    let top = 0;
    stack[top++] = start;
    seen[start] = 1;
    let count = 0;
    let x0 = sx;
    let x1 = sx;
    let y0 = sy;
    let y1 = sy;
    while (top) {
      const q = stack[--top];
      count++;
      const lx = q % bw;
      const ly = (q - lx) / bw;
      if (lx < x0) x0 = lx;
      if (lx > x1) x1 = lx;
      if (ly < y0) y0 = ly;
      if (ly > y1) y1 = ly;
      for (const [nx, ny] of [[lx - 1, ly], [lx + 1, ly], [lx, ly - 1], [lx, ly + 1]]) {
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const n = ny * bw + nx;
        if (seen[n] || !hole((box.y0 + ny) * width + box.x0 + nx)) continue;
        seen[n] = 1;
        stack[top++] = n;
      }
    }
    if (!best || count > best.count) best = { count, x0: box.x0 + x0, y0: box.y0 + y0, x1: box.x0 + x1, y1: box.y0 + y1 };
  }
  return best;
}

// 바깥 여백: 네 모서리 가운데 셋 이상이 같은 색이면 그 색을 바탕으로 보고, 그 색만 있는 줄을 둘레에서 걷어 낸다.
// 자를 곳 { top, bottom, left, right } 또는 null (바탕색을 정하지 못했거나 걷어 낼 줄이 없거나 모두 바탕색)
export function trimMargins({ width, height, data }) {
  const at = (x, y) => (y * width + x) * 4;
  const corners = [at(0, 0), at(width - 1, 0), at(0, height - 1), at(width - 1, height - 1)].map((i) => [data[i], data[i + 1], data[i + 2]]);
  const bg = corners.find((c) => corners.filter((d) => near([d[0], d[1], d[2]], 0, c, MARGIN_TOLERANCE)).length >= 3);
  if (!bg) return null;
  const rowPlain = (y) => {
    for (let x = 0; x < width; x++) if (!near(data, at(x, y), bg, MARGIN_TOLERANCE)) return false;
    return true;
  };
  const colPlain = (x, y0, y1) => {
    for (let y = y0; y <= y1; y++) if (!near(data, at(x, y), bg, MARGIN_TOLERANCE)) return false;
    return true;
  };
  let y0 = 0;
  while (y0 < height && rowPlain(y0)) y0++;
  if (y0 === height) return null;
  let y1 = height - 1;
  while (y1 > y0 && rowPlain(y1)) y1--;
  let x0 = 0;
  while (x0 < width && colPlain(x0, y0, y1)) x0++;
  let x1 = width - 1;
  while (x1 > x0 && colPlain(x1, y0, y1)) x1--;
  if (y0 === 0 && x0 === 0 && y1 === height - 1 && x1 === width - 1) return null;
  return toCrop({ x0, y0, x1, y1 }, width, height);
}

// 경계로 볼 색 차이와, 자를 줄의 길이 가운데 색이 바뀌어야 하는 몫
const EDGE = 40;
const EDGE_SHARE = 0.5;
// 경계는 둘레보다 뚜렷해야 한다: 4줄 떨어진 양쪽 줄보다 이만큼 더 많이 바뀌어야 한다 (자글자글한 무늬는 어느 줄이나 많이 바뀌어 경계가 아니다)
const PROMINENCE = 0.25;
const AROUND = 4;
// 끌 때는 끊이지 않고 이만큼(줄 길이의 몫) 바뀌는 곧은 줄에도 붙는다. 줄이 길면 이 길이(px)만 넘어도 된다
const SNAP_RUN = 0.3;
const SNAP_RUN_PX = 100;

// 자를 줄(side)을 at 자리 가까이(radius 안)의 직선 경계에 붙인다. 붙일 경계가 없으면 null.
// at과 돌려주는 값은 줄의 자리다: top·left는 남길 첫 줄(칸), bottom·right는 잘라 낼 첫 줄(칸) (crop.bottom = 높이 − 자리).
// 경계 b는 b − 1과 b 사이다. 그 사이에서 색이 크게 바뀌는 화소가 자를 줄 길이(지금 남길 곳의 폭이나 높이)의 절반 이상이면 경계다.
// 가장 뚜렷한 경계에 붙이고(비슷하면 at에 가까운 것), 흐린 경계(두세 줄에 걸쳐 바뀜)면 남길 쪽 끝까지 가서 흐린 줄이 남지 않게 한다
export function snapEdge({ width, height, data }, side, at, crop, radius) {
  const horizontal = side === "top" || side === "bottom";
  const from = horizontal ? crop.left : crop.top;
  const to = horizontal ? width - crop.right : height - crop.bottom;
  const size = horizontal ? height : width;
  if (to - from < 8) return null;
  const image = { width, height, data };
  const strength = (b) => snapScore(image, horizontal, b, from, to);
  const lo = Math.max(1, Math.round(at - radius));
  const hi = Math.min(size - 1, Math.round(at + radius));
  const found = [];
  for (let b = lo; b <= hi; b++) {
    const s = strength(b);
    if (s > 0) found.push({ b, s });
  }
  if (!found.length) return null;
  const top = Math.max(...found.map((f) => f.s));
  let best = found.filter((f) => f.s >= top - 0.05).reduce((a, f) => (Math.abs(f.b - at) < Math.abs(a.b - at) ? f : a)).b;
  const keep = side === "top" || side === "left" ? 1 : -1;
  for (let k = 0; k < 3 && strength(best + keep) > 0; k++) best += keep;
  return best;
}

// 경계 b(b − 1과 b 사이)에서 색이 EDGE 넘게 바뀌는 화소의 몫. horizontal이면 가로 경계(줄 b − 1과 b)를 [from, to) 칸에서,
// 아니면 세로 경계(칸 b − 1과 b)를 [from, to) 줄에서 잰다
export function edgeShare({ width, data }, horizontal, b, from, to) {
  if (to <= from) return 0;
  let n = 0;
  for (let k = from; k < to; k++) {
    const i = horizontal ? (b * width + k) * 4 : (k * width + b) * 4;
    const j = horizontal ? i - width * 4 : i - 4;
    if (Math.abs(data[i] - data[j]) > EDGE || Math.abs(data[i + 1] - data[j + 1]) > EDGE || Math.abs(data[i + 2] - data[j + 2]) > EDGE) n++;
  }
  return n / (to - from);
}

// 경계 b가 둘레보다 뚜렷하면 그 몫, 아니면 0 (4줄 떨어진 양쪽보다 PROMINENCE 넘게 많이 바뀌어야 한다)
function straightShare(image, horizontal, b, from, to) {
  const share = edgeShare(image, horizontal, b, from, to);
  if (share < EDGE_SHARE * 0.6) return share;
  const size = horizontal ? image.height : image.width;
  const side = (at) => (at < 1 || at > size - 1 ? 0 : edgeShare(image, horizontal, at, from, to));
  return share - Math.max(side(b - AROUND), side(b + AROUND)) >= PROMINENCE ? share : 0;
}

// 경계 b에서 색이 바뀌는 화소가 끊이지 않고 이어진 가장 긴 길이의 몫 (2화소까지 끊긴 것은 이어진 것으로 본다)
function longestRun({ width, data }, horizontal, b, from, to) {
  let best = 0;
  let run = 0;
  let gap = 0;
  for (let k = from; k < to; k++) {
    const i = horizontal ? (b * width + k) * 4 : (k * width + b) * 4;
    const j = horizontal ? i - width * 4 : i - 4;
    if (Math.abs(data[i] - data[j]) > EDGE || Math.abs(data[i + 1] - data[j + 1]) > EDGE || Math.abs(data[i + 2] - data[j + 2]) > EDGE) {
      run += gap + 1;
      gap = 0;
      if (run > best) best = run;
    } else if (run && gap < 2) gap++;
    else {
      run = 0;
      gap = 0;
    }
  }
  return to > from ? best / (to - from) : 0;
}

// 끌 때 붙을 경계의 세기 (0이면 경계가 아님). 줄 길이의 절반 이상이 바뀌거나, 끊이지 않고 바뀌는 곧은 줄이 줄 길이의 30%나 100px을
// 넘으면(20px 이상) 경계다.
// 팔각형처럼 곧은 변이 자를 줄의 일부만 덮어도 붙는다 (위아래를 먼저 늘린 뒤 옆을 늘릴 때). 어느 쪽이든 4줄 떨어진 양쪽보다 뚜렷해야 한다
function snapScore(image, horizontal, b, from, to) {
  const size = horizontal ? image.height : image.width;
  if (b < 1 || b > size - 1) return 0;
  const score = (at) => (at < 1 || at > size - 1 ? 0 : Math.max(edgeShare(image, horizontal, at, from, to), longestRun(image, horizontal, at, from, to)));
  const here = score(b);
  const long = longestRun(image, horizontal, b, from, to);
  const span = to - from;
  const enough = here >= EDGE_SHARE || (long >= Math.min(SNAP_RUN, SNAP_RUN_PX / span) && long * span >= 20);
  if (!enough) return 0;
  // 짧은 곧은 줄(긴 줄의 12% 등)도 둘레보다 뚜렷하면 되도록, 뚜렷한 정도는 그 세기의 60%까지만 요구한다
  return here - Math.max(score(b - AROUND), score(b + AROUND)) >= Math.min(PROMINENCE, here * 0.6) ? here : 0;
}

// 자를 곳의 네 변 가운데 직선 경계(끌 때 붙는 경계와 같은 기준, snapScore)나 그림 끝에 닿은 변의 수.
// 변에서 바깥쪽으로 3줄 안에 경계가 있으면 닿은 것으로 본다 (흐린 가장자리를 잘라 내느라 변이 경계보다 한두 줄 안에 있을 수 있다)
function sidesOnEdges(image, crop) {
  const { width, height } = image;
  const x0 = crop.left;
  const x1 = width - crop.right;
  const y0 = crop.top;
  const y1 = height - crop.bottom;
  const near = (horizontal, from, step, a, b) => {
    for (let k = 0; k <= 3; k++) {
      const at = from + k * step;
      if (at <= 0 || at >= (horizontal ? height : width)) return true;
      if (snapScore(image, horizontal, at, a, b) > 0) return true;
    }
    return false;
  };
  return (
    Number(y0 === 0 || near(true, y0, -1, x0, x1)) +
    Number(y1 === height || near(true, y1, 1, x0, x1)) +
    Number(x0 === 0 || near(false, x0, -1, y0, y1)) +
    Number(x1 === width || near(false, x1, 1, y0, y1))
  );
}

// 누른 곳 (x, y)를 둘러싼 직선 경계 안쪽. 네 쪽으로 가장 가까운 경계(없으면 그림 끝)까지를 남긴다.
// 처음에는 그림 전체 길이로 재서 절반 이상 바뀌는 줄을 찾고, 찾은 네모 안에서 한 번 더 찾을 때는 네모 길이의 80% 넘게 바뀌어야
// 경계로 본다 (네모 안의 글자 띠 같은 짧은 줄에 걸리지 않게). 누른 곳에서 바깥쪽으로 찾으므로 두세 줄에 걸친 흐린 경계는 안쪽 끝에서 멈춘다.
// 그림 전체가 남으면(경계가 없으면) null
export function fitStraight(image, x, y) {
  const { width, height } = image;
  if (x < 0 || y < 0 || x >= width || y >= height) return null;
  let rect = { x0: 0, y0: 0, x1: width, y1: height };
  for (let pass = 0; pass < 3; pass++) {
    const need = pass === 0 ? EDGE_SHARE : 0.8;
    const next = { ...rect };
    for (let b = x; b > rect.x0; b--) {
      if (straightShare(image, false, b, rect.y0, rect.y1) >= need) {
        next.x0 = b;
        break;
      }
    }
    for (let b = x + 1; b < rect.x1; b++) {
      if (straightShare(image, false, b, rect.y0, rect.y1) >= need) {
        next.x1 = b;
        break;
      }
    }
    for (let b = y; b > rect.y0; b--) {
      if (straightShare(image, true, b, rect.x0, rect.x1) >= need) {
        next.y0 = b;
        break;
      }
    }
    for (let b = y + 1; b < rect.y1; b++) {
      if (straightShare(image, true, b, rect.x0, rect.x1) >= need) {
        next.y1 = b;
        break;
      }
    }
    if (next.x0 === rect.x0 && next.x1 === rect.x1 && next.y0 === rect.y0 && next.y1 === rect.y1) break;
    rect = next;
  }
  if (rect.x0 === 0 && rect.y0 === 0 && rect.x1 === width && rect.y1 === height) return null;
  return { top: rect.y0, bottom: height - rect.y1, left: rect.x0, right: width - rect.x1, how: "straight" };
}

// 누른 곳에 맞추기. inside(Alt): 누른 선의 안쪽(fitRegion).
// 아니면 같은 색으로 이어진 곳을 먼저 본다. 한 가지 색으로 칠한 곳(그곳 화소의 60% 넘게가 누른 색과 12 안: 테두리 그림, 표지판)이고
// 16×16보다 크고, 그 둘레의 네 변 가운데 셋 이상이 직선 경계(나 그림 끝)에 닿아 있으면 그 둘레에 맞춘다.
// 사진은 이어진 곳의 색이 고르지 않거나(얼굴, 옷: 10~20%), 고르더라도(흐린 배경: 80%쯤) 둘레가 곧은 줄이 아니어서 쓰지 않고,
// 누른 곳을 둘러싼 직선 경계 안쪽에 맞춘다(fitStraight: 나란히 붙인 사진이면 누른 쪽 사진). 직선 경계가 없으면 한 가지 색으로 칠한 곳의
// 둘레(표지판의 손 등)를 쓴다. 그것도 없으면 null
export function fitAt(image, x, y, { inside = false } = {}) {
  if (inside) return fitRegion(image, x, y, { inside: true });
  const area = fitRegion(image, x, y);
  let flatCrop = null;
  if (area) {
    const { flat, count, ...crop } = area;
    const w = image.width - crop.left - crop.right;
    const h = image.height - crop.top - crop.bottom;
    if (flat >= FLAT_SHARE && w >= 16 && h >= 16 && count >= 64) {
      if (sidesOnEdges(image, crop) >= 3) return crop;
      flatCrop = crop;
    }
  }
  return fitStraight(image, x, y) ?? flatCrop;
}
