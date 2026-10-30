// 스코어카드 캡처에서 표를 찾아 파와 타수를 읽는다. 브라우저 API를 쓰지 않아 Node에서도 시험할 수 있다.
// img는 { data, width, height } (RGBA 픽셀 배열) 형태다.
//
// 스마트스코어 카드는 화면(앱 화면, 출력용 카드, 사진 배경 카드)마다 모양과 색이 달라도
// 늘 "1 2 3 … 9" 홀 번호 줄 아래에 PAR 줄과 참가자 줄이 같은 칸에 맞춰 놓여 있다.
//  1) 화면의 글자 덩어리를 모두 찾아(어두운 글씨와 밝은 글씨 모두) 같은 높이끼리 줄로 묶고
//  2) 1~9가 고른 간격으로 놓인 줄을 홀 번호 줄로 삼아 칸 위치를 정한 뒤
//  3) 그 아래 칸에 맞춰 놓인 줄들을 PAR 줄과 참가자 줄로 읽는다
// 숫자는 범용 글자 인식(OCR) 대신 숫자 모양 견본과 비교해 읽고, −1·−2는 숫자 뒤 아이콘 색(노랑·분홍)으로 읽는다.
// 카드 속 숫자는 타수가 아니라 파 대비 값이다 (0 = 파, 1 = 보기, −1 = 버디).

export const GRID_W = 12;
export const GRID_H = 16;

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

// 숫자 뒤 아이콘 색. 아이콘 위의 음수는 모양으로 읽기 어려워 색으로 판별한다
const BADGES = [
  { diff: -1, test: (r, g, b) => r > 200 && g > 160 && g < 235 && b < 170 && r - b > 60 }, // 노랑 = 버디
  { diff: -2, test: (r, g, b) => r > 220 && g < 200 && b > 170 && r - g > 40 }, // 분홍 = 이글
];
// 칸 넓이에서 아이콘 색이 이 비율을 넘으면 아이콘이 있다고 본다
const BADGE_RATIO = 0.04;
// 둘레 평균 밝기보다 이만큼 어둡거나 밝아야 글자로 본다
const CONTRAST = 28;
// 숫자로 볼 최소 높이(px)
const MIN_DIGIT_H = 7;
// 글자 진하기가 이 값을 넘는 픽셀로 글자 범위를 정한다 (견본을 만들 때와 같은 값)
const INK = 0.35;
// 견본과 이 차이 이상 나야 확실하다고 본다 (시험한 캡처에서 맞게 읽은 글자는 모두 5 이상)
const SURE_MARGIN = 2.5;

// 밝기, 둘레 평균 밝기, 아이콘 색 표시를 미리 계산한다
function prepare(img) {
  const { width: W, height: H, data } = img;
  const L = new Float32Array(W * H);
  const badge = new Uint8Array(W * H); // 0: 없음, 1 이상: BADGES 번호 + 1
  for (let i = 0, p = 0; i < W * H; i++, p += 4) {
    const [r, g, b] = [data[p], data[p + 1], data[p + 2]];
    L[i] = lum(r, g, b);
    const k = BADGES.findIndex((badgeKind) => badgeKind.test(r, g, b));
    if (k >= 0) badge[i] = k + 1;
  }
  // 아이콘의 진한 그림자(짙은 분홍·주황 등)도 아이콘으로 본다: 아이콘 색에서 이어진 붉은·노란 기운의 픽셀까지 넓힌다.
  // 숫자 글씨(검정·흰색)는 넓어지지 않아 아이콘 위에 쓴 숫자도 글자로 남는다
  const warm = (i) => data[i * 4] - Math.min(data[i * 4 + 1], data[i * 4 + 2]) > 40;
  const queue = new Int32Array(W * H);
  let tail = 0;
  for (let i = 0; i < W * H; i++) if (badge[i]) queue[tail++] = i;
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const x = i % W;
    for (const j of [i - W, i + W, x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1]) {
      if (j < 0 || j >= W * H || badge[j] || !warm(j)) continue;
      badge[j] = badge[i];
      queue[tail++] = j;
    }
  }

  // 둘레 평균: 글자보다 넉넉히 큰 네모 창의 평균 (가로로 한 번, 세로로 한 번 이동 평균)
  const R = Math.max(12, Math.round(Math.max(W, H) / 40));
  const rowAvg = new Float32Array(W * H);
  const prefix = new Float64Array(Math.max(W, H) + 1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) prefix[x + 1] = prefix[x] + L[y * W + x];
    for (let x = 0; x < W; x++) {
      const a = Math.max(0, x - R);
      const b = Math.min(W - 1, x + R);
      rowAvg[y * W + x] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
    }
  }
  const mean = new Float32Array(W * H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) prefix[y + 1] = prefix[y] + rowAvg[y * W + x];
    for (let y = 0; y < H; y++) {
      const a = Math.max(0, y - R);
      const b = Math.min(H - 1, y + R);
      mean[y * W + x] = (prefix[b + 1] - prefix[a]) / (b - a + 1);
    }
  }
  return { W, H, L, mean, badge };
}

// 둘레보다 확실히 어둡거나(어두운 글씨) 밝은(밝은 글씨) 픽셀이 이어진 덩어리들
function findBlobs(pic) {
  const { W, H, L, mean, badge } = pic;
  const blobs = [];
  const seen = new Uint8Array(W * H);
  const stack = new Int32Array(W * H);
  for (const dark of [true, false]) {
    seen.fill(0);
    const isInk = dark
      ? (i) => badge[i] === 0 && L[i] < mean[i] - CONTRAST
      : (i) => badge[i] === 0 && L[i] > mean[i] + CONTRAST;
    for (let s = 0; s < W * H; s++) {
      if (seen[s] || !isInk(s)) continue;
      let top = 0;
      stack[top++] = s;
      seen[s] = 1;
      let x0 = W, y0 = H, x1 = -1, y1 = -1, n = 0;
      while (top) {
        const i = stack[--top];
        const y = (i / W) | 0;
        const x = i - y * W;
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= H) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= W) continue;
            const j = yy * W + xx;
            if (!seen[j] && isInk(j)) {
              seen[j] = 1;
              stack[top++] = j;
            }
          }
        }
      }
      const w = x1 - x0 + 1;
      const h = y1 - y0 + 1;
      // 너무 큰 덩어리는 글자가 아니다 (사진, 띠 등)
      if (h < 2 || h > H / 6 || w > W / 6) continue;
      blobs.push({ x0, y0, x1, y1, w, h, n, dark, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
    }
  }
  return blobs;
}

// 숫자 크기의 덩어리를 같은 높이끼리 줄로 묶는다
function groupLines(blobs) {
  const digits = blobs
    .filter((b) => b.h >= MIN_DIGIT_H && b.w <= b.h * 2.4 && b.n >= b.w * b.h * 0.12)
    .sort((a, b) => a.cy - b.cy);
  const lines = [];
  for (const b of digits) {
    let line = null;
    for (let k = lines.length - 1; k >= 0 && lines[k].cy > b.cy - b.h * 2; k--) {
      const l = lines[k];
      if (Math.abs(l.cy - b.cy) < l.h * 0.35 && b.h > l.h * 0.7 && b.h < l.h * 1.45) {
        line = l;
        break;
      }
    }
    if (!line) {
      line = { items: [], cy: b.cy, h: b.h };
      lines.push(line);
    }
    line.items.push(b);
    const n = line.items.length;
    line.cy += (b.cy - line.cy) / n;
    line.h += (b.h - line.h) / n;
  }
  for (const line of lines) line.items.sort((a, b) => a.cx - b.cx);
  return lines;
}

// ── 숫자 모양 ──
// 글자 하나하나를 잘라 높이 기준으로 GRID_W×GRID_H 격자에 맞추고(가로 비율 유지), 가장 닮은 견본을 고른다.
// ink(x, y)는 그 픽셀의 글자 진하기(0~1)다.
function glyphsFromInk(ink, x0, y0, x1, y1) {
  const colInk = (x) => {
    let sum = 0;
    for (let y = y0; y <= y1; y++) sum += ink(x, y);
    return sum;
  };
  const rowsOf = (a, b) => {
    let top = y1;
    let bottom = y0;
    for (let y = y0; y <= y1; y++) for (let x = a; x <= b; x++) if (ink(x, y) > INK) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    return [top, bottom];
  };

  // 글씨가 없는 열을 경계로 글자를 나눈다
  const parts = [];
  let start = -1;
  for (let x = x0; x <= x1 + 1; x++) {
    let has = false;
    if (x <= x1) for (let y = y0; y <= y1 && !has; y++) has = ink(x, y) > INK;
    if (has && start < 0) start = x;
    if (!has && start >= 0) { parts.push([start, x - 1]); start = -1; }
  }
  // 앞쪽 빼기 기호: 왼쪽부터 글자 전체 높이의 가운데 띠에만 글씨가 있는 열들 (숫자에 붙어 있거나 따로 떨어져 있다)
  const [textTop, textBottom] = rowsOf(x0, x1);
  const textH = textBottom - textTop + 1;
  const band = textH * 0.3;
  const flatColumn = (x) => {
    for (let y = y0; y <= y1; y++) if (ink(x, y) > INK && (y < textTop + band || y > textBottom - band)) return false;
    return true;
  };
  const minusAt = new Set();
  const withMinus = [];
  for (const [a, b] of parts) {
    let x = a;
    while (x <= b && flatColumn(x)) x++;
    // 충분히 길거나, 따로 떨어진 빼기 기호의 끝이 숫자에 붙어 들어온 조각(조각 전체가 가운데 띠 안)이면 빼기 기호다
    if (x - a >= Math.max(2, textH * 0.2) || (x > b && withMinus.length === 0)) {
      minusAt.add(a);
      withMinus.push([a, x - 1]);
      if (x <= b) withMinus.push([x, b]);
    } else {
      withMinus.push([a, b]);
    }
  }

  // 붙어 버린 두 자리 숫자(굵은 합계 글씨 등)는 너무 넓으면 가운데쪽에서 가장 얇은 열로 자른다
  const split = [];
  for (const [a, b] of withMinus) {
    if (minusAt.has(a)) { split.push([a, b]); continue; }
    const [top, bottom] = rowsOf(a, b);
    if (bottom < top) continue;
    if ((b - a + 1) / (bottom - top + 1) < 0.95) { split.push([a, b]); continue; }
    const third = Math.floor((b - a) / 3);
    let cut = a + third;
    for (let x = a + third; x <= b - third; x++) if (colInk(x) < colInk(cut)) cut = x;
    split.push([a, cut - 1], [cut + 1, b]);
  }

  return split.flatMap(([a, b]) => {
    if (minusAt.has(a)) return [{ minus: true }];
    const [top, bottom] = rowsOf(a, b);
    if (bottom < top) return [];
    const w = b - a + 1;
    const h = bottom - top + 1;
    const scale = GRID_H / h;
    const offset = (GRID_W - w * scale) / 2;
    const grid = new Float32Array(GRID_W * GRID_H);
    // 격자 한 칸 = 원본에서 해당하는 영역의 평균 진하기 (4×4 표본)
    for (let gy = 0; gy < GRID_H; gy++) {
      for (let gx = 0; gx < GRID_W; gx++) {
        let sum = 0;
        for (let sy = 0; sy < 4; sy++) {
          for (let sx = 0; sx < 4; sx++) {
            const fx = (gx + (sx + 0.5) / 4 - offset) / scale;
            const fy = (gy + (sy + 0.5) / 4) / scale;
            if (fx >= 0 && fx < w) sum += ink(a + Math.floor(fx), top + Math.floor(fy));
          }
        }
        grid[gy * GRID_W + gx] = sum / 16;
      }
    }
    return [{ grid, aspect: w / h }];
  });
}

// 덩어리 안의 글자들. 바탕 밝기는 덩어리 바로 바깥 테두리의 중간값으로 잡는다
function blobGlyphs(pic, b) {
  const { W, H, L } = pic;
  const rx0 = Math.max(0, b.x0 - 2);
  const rx1 = Math.min(W - 1, b.x1 + 2);
  const ry0 = Math.max(0, b.y0 - 2);
  const ry1 = Math.min(H - 1, b.y1 + 2);
  const ring = [];
  for (let x = rx0; x <= rx1; x++) ring.push(L[ry0 * W + x], L[ry1 * W + x]);
  for (let y = ry0; y <= ry1; y++) ring.push(L[y * W + rx0], L[y * W + rx1]);
  ring.sort((p, q) => p - q);
  const bg = ring[ring.length >> 1];
  let extreme = bg;
  for (let y = b.y0; y <= b.y1; y++) {
    for (let x = b.x0; x <= b.x1; x++) {
      const l = L[y * W + x];
      extreme = b.dark ? Math.min(extreme, l) : Math.max(extreme, l);
    }
  }
  const span = Math.abs(extreme - bg);
  if (span < CONTRAST) return [];
  // 아이콘 픽셀은 글자가 아니다
  const ink = (x, y) => {
    const i = y * W + x;
    return pic.badge[i] ? 0 : Math.max(0, Math.min(1, (b.dark ? bg - L[i] : L[i] - bg) / span));
  };
  return glyphsFromInk(ink, b.x0, b.y0, b.x1, b.y1);
}

const glyphDistance = (glyph, template) => {
  let d = 0;
  for (let i = 0; i < glyph.grid.length; i++) d += (glyph.grid[i] - template.grid[i]) ** 2;
  return d + 20 * (glyph.aspect - template.aspect) ** 2;
};

// 가장 닮은 견본의 숫자와, 두 번째로 닮은 다른 숫자와의 차이(클수록 확실)
function classify(glyph, templates) {
  const byDigit = new Map();
  for (const t of templates) {
    const d = glyphDistance(glyph, t);
    if (!byDigit.has(t.digit) || d < byDigit.get(t.digit)) byDigit.set(t.digit, d);
  }
  const [best, second] = [...byDigit].sort((a, b) => a[1] - b[1]);
  return { digit: best[0], margin: second ? second[1] - best[1] : Infinity };
}

// ── 표 찾기 ──

// 한 줄에서 1~9가 고른 간격으로 놓인 자리를 찾는다 (한 줄에 표가 둘 나란히 있을 수도 있다)
function findHeaders(lines, readBlob) {
  const headers = [];
  for (const line of lines) {
    const items = line.items;
    if (items.length < 9) continue;
    const text = items.map((b) => readBlob(b).map((r) => r.digit).join(""));
    const used = new Set();
    const nearest = (x, tolerance) => {
      let best = -1;
      for (let j = 0; j < items.length; j++) {
        if (used.has(j)) continue;
        const dx = Math.abs(items[j].cx - x);
        if (dx < tolerance && (best < 0 || dx < Math.abs(items[best].cx - x))) best = j;
      }
      return best;
    };
    for (let found = 0; found < 3; found++) {
      let best = null;
      // 이웃한 두 덩어리를 i, i+1번 칸으로 가정하고 1~9 자리를 예측해 맞는 칸 수를 센다
      for (let p = 0; p + 1 < items.length; p++) {
        if (used.has(p)) continue;
        for (let q = p + 1; q <= p + 2 && q < items.length; q++) {
          const d = items[q].cx - items[p].cx;
          if (d < line.h * 0.8 || d > line.h * 6) continue;
          for (let i = 1; i <= 8; i++) {
            const first = items[p].cx - (i - 1) * d;
            const hits = [];
            let ok = 0;
            for (let k = 1; k <= 9; k++) {
              const j = nearest(first + (k - 1) * d, d * 0.3);
              hits.push(j);
              if (j >= 0 && text[j] === String(k)) ok++;
            }
            const present = hits.filter((j) => j >= 0).length;
            if (ok >= 7 && present >= 8 && (!best || ok > best.ok)) best = { ok, hits };
          }
        }
      }
      if (!best) break;
      // 찾은 자리들로 칸 중심과 간격을 다시 맞춘다 (최소제곱 직선)
      const pts = best.hits.flatMap((j, k) => (j >= 0 ? [[k, items[j].cx]] : []));
      const mk = pts.reduce((s, [k]) => s + k, 0) / pts.length;
      const mx = pts.reduce((s, [, x]) => s + x, 0) / pts.length;
      const slope = pts.reduce((s, [k, x]) => s + (k - mk) * (x - mx), 0) / pts.reduce((s, [k]) => s + (k - mk) ** 2, 0);
      headers.push({ line, d: slope, h: line.h, cy: line.cy, centers: Array.from({ length: 9 }, (_, k) => mx + (k - mk) * slope) });
      best.hits.forEach((j) => j >= 0 && used.add(j));
    }
  }
  // 위에서 아래로, 같은 줄이면 왼쪽부터 (전반, 후반 순서)
  headers.sort((a, b) => (Math.abs(a.cy - b.cy) < a.h ? a.centers[0] - b.centers[0] : a.cy - b.cy));
  headers.forEach((header, i) => {
    // 합계 칸: 9번 칸 오른쪽부터, 같은 줄 다음 표의 1번 칸 전까지
    const next = headers.find((o, j) => j !== i && o.line === header.line && o.centers[0] > header.centers[8]);
    const right = header.centers[8] + header.d * 3.6;
    header.totalRight = next ? Math.min(right, next.centers[0] - next.d * 0.6) : right;
  });
  return headers;
}

// 홀 번호 줄 아래에서 칸에 맞춰 놓인 줄들을 찾는다: 첫 줄이 PAR 줄, 나머지가 참가자 줄
function findRows(header, lines, headers, readBlob) {
  const { centers, d, h } = header;
  const left = centers[0] - d * 0.6;
  const rows = [];
  let lastY = header.cy;
  let spacing = h * 3;
  for (const line of lines) {
    if (line.cy <= header.cy + h * 0.6) continue;
    // 다음 표의 홀 번호 줄이 나오거나, 줄 간격보다 훨씬 떨어지면 표가 끝난 것이다
    if (headers.some((o) => o !== header && o.line === line && Math.abs(o.centers[0] - centers[0]) < d)) break;
    if (line.cy - lastY > spacing * 1.8) break;
    // 글씨 크기가 다르거나 칸에 맞지 않는 줄(이름 글자 조각, 아이콘 테두리, "Total" 줄 등)은 건너뛴다
    if (line.h < h * 0.7 || line.h > h * 1.5) continue;
    const items = line.items.filter((b) => b.cx >= left && b.cx <= header.totalRight);
    // 칸 가운데쯤에 글자가 놓인 칸이 6개 이상이어야 한다 ("Total" 줄처럼 칸과 상관없이 놓인 글자를 거른다).
    // 아이콘 칸은 숫자가 칸 가운데에서 조금 비켜나 있다
    const inColumns = centers.map((c) => items.filter((b) => Math.abs(b.cx - c) <= d * 0.55));
    const centered = centers.filter((c) => items.some((b) => Math.abs(b.cx - c) <= d * 0.35)).length;
    if (centered < 6) continue;
    // 줄의 글자 대부분이 확실한 숫자여야 한다 (아래쪽 광고 문구 같은 한글 줄을 거른다)
    const sure = items.filter((b) => readBlob(b).length && readBlob(b).every((r) => r.margin >= SURE_MARGIN)).length;
    if (sure < items.length * 0.8) continue;
    // 홀별 거리(세 자리 수)가 칸마다 놓인 줄은 참가자 줄이 아니다
    const digitCount = (list) => list.reduce((n, b) => n + readBlob(b).filter((r) => r.digit !== "-").length, 0);
    if (inColumns.filter((list) => digitCount(list) >= 3).length >= 5) break;
    if (rows.length === 1) spacing = line.cy - lastY;
    rows.push({ line, items });
    lastY = line.cy;
    if (rows.length > 9) break;
  }
  return rows;
}

// 칸 하나의 숫자: 칸 안의 덩어리들을 간격으로 묶어 수로 만들고, 앞에 짧은 가로줄이 있으면 음수로 본다
function cellNumbers(items, minuses, lineH, readBlob) {
  const groups = [];
  for (const b of items) {
    const last = groups.at(-1);
    if (last && b.x0 - last.x1 <= lineH * 0.5) {
      last.blobs.push(b);
      last.x1 = b.x1;
    } else {
      groups.push({ blobs: [b], x0: b.x0, x1: b.x1 });
    }
  }
  return groups.map((g) => {
    const read = g.blobs.flatMap((b) => readBlob(b));
    const digits = read.filter((r) => r.digit !== "-");
    if (!digits.length) return null;
    const negative = read[0].digit === "-" || minuses.some((m) => m.x1 <= g.x0 + 1 && g.x0 - m.x1 <= lineH * 0.8);
    const value = Number(digits.map((r) => r.digit).join(""));
    return {
      value: negative ? -value : value,
      sure: digits.every((r) => r.margin >= SURE_MARGIN),
      cx: (g.x0 + g.x1) / 2,
      digits: digits.length,
    };
  }).filter(Boolean);
}

function badgeInRect(pic, [x0, y0, x1, y1]) {
  const { W, badge } = pic;
  const counts = BADGES.map(() => 0);
  for (let y = Math.max(0, Math.round(y0)); y <= Math.min(pic.H - 1, Math.round(y1)); y++) {
    for (let x = Math.max(0, Math.round(x0)); x <= Math.min(W - 1, Math.round(x1)); x++) {
      const k = badge[y * W + x];
      if (k) counts[k - 1]++;
    }
  }
  const area = (x1 - x0 + 1) * (y1 - y0 + 1);
  const best = counts.indexOf(Math.max(...counts));
  return counts[best] / area > BADGE_RATIO ? BADGES[best].diff : null;
}

export class ScanError extends Error {}

// 결과: { pars, parSure, parTotals, rows: [{ diffs, sure, totals }] }. 읽지 못한 칸은 null
export function readScorecardImage(img, templates) {
  const pic = prepare(img);
  const blobs = findBlobs(pic);
  const lines = groupLines(blobs);
  const cache = new Map();
  const readBlob = (b) => {
    if (!cache.has(b)) cache.set(b, blobGlyphs(pic, b).map((g) => (g.minus ? { digit: "-", margin: Infinity } : classify(g, templates))));
    return cache.get(b);
  };

  const headers = findHeaders(lines, readBlob).slice(0, 2);
  if (!headers.length) {
    throw new ScanError("홀 번호(1~9) 줄을 찾지 못했습니다. 스마트스코어 스코어카드 화면이 잘리지 않게 캡처한 사진인지 확인해 주세요.");
  }
  // 음수 앞의 가로줄 후보: 숫자보다 낮고 납작한 덩어리
  const minusBlobs = blobs.filter((b) => b.h <= b.w * 0.6 && b.h < MIN_DIGIT_H * 1.2);

  const sections = headers.map((header) => ({ header, rows: findRows(header, lines, headers, readBlob) }));
  if (sections.some((s) => s.rows.length < 2)) {
    throw new ScanError("홀 번호 아래에서 PAR 줄과 참가자 줄을 찾지 못했습니다. 표 전체가 보이게 캡처해 주세요.");
  }
  const players = Math.max(...sections.map((s) => s.rows.length - 1));
  const result = {
    pars: [],
    parSure: [],
    parTotals: [],
    rows: Array.from({ length: players }, () => ({ diffs: [], sure: [], totals: [] })),
  };

  for (const { header, rows } of sections) {
    const { centers, d } = header;
    // 줄 사이 가운데를 경계로 칸의 위아래를 정한다
    const ys = [header.cy, ...rows.map((r) => r.line.cy)];
    const bounds = rows.map((_, r) => {
      const cy = ys[r + 1];
      const top = (ys[r] + cy) / 2;
      const bottom = r + 2 < ys.length ? (cy + ys[r + 2]) / 2 : cy + (cy - top);
      return [top, bottom];
    });

    const readRow = (r) => {
      const { line, items } = rows[r];
      const [top, bottom] = bounds[r];
      const minuses = minusBlobs.filter((m) => m.cy > top && m.cy < bottom && Math.abs(m.cy - line.cy) < line.h * 0.35);
      const cells = centers.map((c) => {
        const rect = [c - d / 2, top, c + d / 2, bottom];
        const inCell = items.filter((b) => Math.abs(b.cx - c) <= d * 0.55);
        const nums = cellNumbers(inCell, minuses.filter((m) => m.cx > c - d * 0.6 && m.cx < c + d * 0.5), line.h, readBlob);
        // 칸 가운데에 가장 가까운 수
        const num = nums.sort((a, b) => Math.abs(a.cx - c) - Math.abs(b.cx - c))[0] ?? null;
        return { rect, num };
      });
      const totalItems = items.filter((b) => b.cx > centers[8] + d * 0.55);
      const total = cellNumbers(totalItems, [], line.h, readBlob)[0] ?? null;
      return { cells, total };
    };

    // PAR 줄
    const par = readRow(0);
    for (const { num } of par.cells) {
      result.pars.push(num ? num.value : null);
      result.parSure.push(Boolean(num && num.sure && num.value >= 3 && num.value <= 6));
    }
    result.parTotals.push(par.total ? par.total.value : null);

    // 참가자 줄
    for (let p = 0; p < players; p++) {
      const row = result.rows[p];
      if (p + 1 >= rows.length) {
        row.diffs.push(...Array(9).fill(null));
        row.sure.push(...Array(9).fill(false));
        row.totals.push(null);
        continue;
      }
      const { cells, total } = readRow(p + 1);
      for (const { rect, num } of cells) {
        const badge = badgeInRect(pic, rect);
        if (badge !== null) {
          // 아이콘 색으로 읽고, 아이콘 위 숫자가 확실히 다른 값으로 읽힐 때만 확인 필요로 둔다
          row.diffs.push(badge);
          row.sure.push(!(num && num.sure && Math.abs(num.value) !== -badge));
        } else if (num) {
          row.diffs.push(num.value);
          // 아이콘 없는 음수(처음 보는 아이콘)는 직접 확인하게 한다
          row.sure.push(num.sure && num.value >= 0);
        } else {
          row.diffs.push(null);
          row.sure.push(false);
        }
      }
      // 합계(T)는 검토 화면에서 칸 합과 비교하는 데만 쓴다
      row.totals.push(total ? total.value : null);
    }
  }
  return result;
}
