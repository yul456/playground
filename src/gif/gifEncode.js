// 화면(RGBA 화소)들을 받아 움직이는 GIF를 만든다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// - GIF는 한 장에 256색까지라 장마다 그 장의 색으로 색표(255색 + 투명)를 만든다 (median cut).
// - 앞 장과 거의 같은 화소는 투명으로 두어 앞 장을 그대로 보인다. 용량이 크게 줄고, 멈춘 곳이 장마다 색이 흔들리지 않는다.
//   "같은지"는 그 화소를 마지막으로 담았을 때의 원래 색과 견준다. 화면에 보이는 색(색표로 줄인 색)과 견주면
//   줄이면서 생긴 차이 때문에 멈춘 곳도 다음 장에 다시 담게 된다.
//   바뀐 화소를 둘러싼 네모만 담고, 바뀐 화소가 하나도 없으면 앞 장을 그만큼 더 오래 보인다.

// 색을 채널마다 5비트로 줄여 센다 (32,768칸)
const BINS = 1 << 15;
const COLORS = 255; // 색표의 256번째(255번)는 투명
const TRANSPARENT = 255;
// 색 띠를 줄이려고 화소마다 더하는 무늬 (4×4 Bayer, 0~15)와 그 세기(±)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const DITHER = 5;

// 센 색(hist: 칸마다 화소 수, sums: 칸마다 r·g·b 합)에서 max색까지의 색표를 만든다. 결과: Uint8Array [r, g, b, …]
// 화소가 많이 몰린 넓은 상자부터 가장 긴 축의 가운데(화소 수 기준)에서 나눈다
export function buildPalette(hist, sums, max = COLORS) {
  const bins = [];
  for (let i = 0; i < BINS; i++) if (hist[i]) bins.push(i);
  const makeBox = (lo, hi) => {
    const box = { lo, hi, count: 0, min: [31, 31, 31], max: [0, 0, 0] };
    for (let i = lo; i < hi; i++) {
      const bin = bins[i];
      box.count += hist[bin];
      for (let c = 0; c < 3; c++) {
        const v = (bin >> (10 - c * 5)) & 31;
        if (v < box.min[c]) box.min[c] = v;
        if (v > box.max[c]) box.max[c] = v;
      }
    }
    const ranges = box.max.map((v, c) => v - box.min[c]);
    box.axis = ranges.indexOf(Math.max(...ranges));
    box.range = ranges[box.axis];
    return box;
  };
  const boxes = bins.length ? [makeBox(0, bins.length)] : [];
  while (boxes.length < max) {
    let pick = -1;
    let best = 0;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.hi - box.lo < 2) continue;
      const score = box.count * (box.range + 1);
      if (score > best) {
        best = score;
        pick = i;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    const shift = 10 - box.axis * 5;
    const part = bins.slice(box.lo, box.hi).sort((p, q) => ((p >> shift) & 31) - ((q >> shift) & 31));
    for (let i = 0; i < part.length; i++) bins[box.lo + i] = part[i];
    // 화소 수가 절반이 되는 자리. 두 쪽 모두 한 칸은 남긴다
    let seen = 0;
    let cut = box.lo;
    while (cut < box.hi - 1) {
      seen += hist[bins[cut]];
      cut++;
      if (seen * 2 >= box.count) break;
    }
    boxes[pick] = makeBox(box.lo, cut);
    boxes.push(makeBox(cut, box.hi));
  }
  const palette = new Uint8Array(boxes.length * 3);
  boxes.forEach((box, index) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = box.lo; i < box.hi; i++) {
      const bin = bins[i];
      r += sums[bin * 3];
      g += sums[bin * 3 + 1];
      b += sums[bin * 3 + 2];
    }
    palette[index * 3] = Math.round(r / box.count);
    palette[index * 3 + 1] = Math.round(g / box.count);
    palette[index * 3 + 2] = Math.round(b / box.count);
  });
  return palette;
}

// 바이트를 이어 붙여 가는 그릇
class Bytes {
  constructor(size = 1024) {
    this.data = new Uint8Array(size);
    this.length = 0;
  }
  push(byte) {
    if (this.length === this.data.length) {
      const bigger = new Uint8Array(this.data.length * 2);
      bigger.set(this.data);
      this.data = bigger;
    }
    this.data[this.length++] = byte;
  }
  done() {
    return this.data.subarray(0, this.length);
  }
}

// GIF의 LZW 압축 (색 번호 8비트). 결과는 코드를 낮은 비트부터 채운 바이트들 (255바이트씩 나누기 전)
// table: 앞 코드와 다음 색 번호로 코드를 찾는 표 (4096 × 256칸). 여러 장에 돌려 쓰고, 쓴 칸만 지운다
export function lzwEncode(indices, table = new Uint16Array(4096 * 256)) {
  const CLEAR = 256;
  const END = 257;
  const out = new Bytes(Math.max(256, indices.length >> 1));
  const used = [];
  let next = 258;
  let size = 9;
  let bits = 0;
  let filled = 0;
  const emit = (code) => {
    bits |= code << filled;
    filled += size;
    while (filled >= 8) {
      out.push(bits & 255);
      bits >>>= 8;
      filled -= 8;
    }
  };
  const reset = () => {
    for (const key of used) table[key] = 0;
    used.length = 0;
    next = 258;
    size = 9;
  };
  emit(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i];
    const key = (prefix << 8) | c;
    const code = table[key];
    if (code) {
      prefix = code;
      continue;
    }
    emit(prefix);
    // 코드를 쓴 뒤에, 지금까지 만든 코드가 이 폭을 넘으면 폭을 늘린다 (푸는 쪽과 같은 때에)
    if (next > (1 << size) - 1 && size < 12) size++;
    if (next < 4096) {
      table[key] = next++;
      used.push(key);
    } else {
      emit(CLEAR);
      reset();
    }
    prefix = c;
  }
  emit(prefix);
  if (next > (1 << size) - 1 && size < 12) size++;
  emit(END);
  if (filled > 0) out.push(bits & 255);
  for (const key of used) table[key] = 0;
  return out.done();
}

const word = (n) => [n & 255, (n >> 8) & 255];

// GIF를 한 장씩 만든다.
// options: { loop: 되풀이 횟수(0은 끝없이), tolerance: 앞 장과 채널마다 이만큼까지 다르면 같은 화소로 본다, dither: 색 띠 줄이기 }
export class GifWriter {
  constructor(width, height, { loop = 0, tolerance = 8, dither = false } = {}) {
    this.width = width;
    this.height = height;
    this.dither = dither;
    this.tolerance = tolerance;
    this.shown = new Uint8Array(width * height * 3); // 화소마다 마지막으로 담은 원래 색
    this.frames = []; // { head: 장 머리(쉬는 시간이 든다), body, delay }
    this.count = 0; // 받은 장 수
    this.hist = new Uint32Array(BINS);
    this.sums = new Float64Array(BINS * 3);
    this.nearest = new Int16Array(BINS);
    this.table = new Uint16Array(4096 * 256);
    this.header = Uint8Array.from([
      ...[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
      ...word(width),
      ...word(height),
      0x70, // 전체 색표 없음 (장마다 색표를 둔다)
      0,
      0,
      ...[0x21, 0xff, 0x0b, ...Array.from("NETSCAPE2.0", (ch) => ch.charCodeAt(0)), 3, 1, ...word(loop), 0], // 되풀이
    ]);
  }

  // rgba: 화면 한 장 (width × height × 4), delay: 이 장을 보일 시간 (1/100초)
  addFrame(rgba, delay) {
    const { width, height, shown, tolerance } = this;
    const first = this.count === 0;
    this.count++;
    // 바뀐 화소를 둘러싼 네모
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    if (first) {
      x0 = 0;
      y0 = 0;
      x1 = width - 1;
      y1 = height - 1;
    } else {
      for (let y = 0, p = 0, s = 0; y < height; y++) {
        for (let x = 0; x < width; x++, p += 4, s += 3) {
          if (Math.abs(rgba[p] - shown[s]) > tolerance || Math.abs(rgba[p + 1] - shown[s + 1]) > tolerance || Math.abs(rgba[p + 2] - shown[s + 2]) > tolerance) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      }
      if (x1 < 0) {
        // 바뀐 화소가 없다: 앞 장을 그만큼 더 오래 보인다
        this.frames[this.frames.length - 1].delay += delay;
        return;
      }
    }
    const w = x1 - x0 + 1;
    const h = y1 - y0 + 1;
    const indices = new Uint8Array(w * h);
    const { hist, sums, nearest } = this;
    hist.fill(0);
    sums.fill(0);
    // 바뀐 화소의 색을 센다. 바뀌지 않은 화소는 투명으로 둔다
    let anyClear = false;
    for (let y = y0, i = 0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++, i++) {
        const p = (y * width + x) * 4;
        const s = (y * width + x) * 3;
        const r = rgba[p];
        const g = rgba[p + 1];
        const b = rgba[p + 2];
        if (!first && Math.abs(r - shown[s]) <= tolerance && Math.abs(g - shown[s + 1]) <= tolerance && Math.abs(b - shown[s + 2]) <= tolerance) {
          indices[i] = TRANSPARENT;
          anyClear = true;
          continue;
        }
        const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        hist[bin]++;
        sums[bin * 3] += r;
        sums[bin * 3 + 1] += g;
        sums[bin * 3 + 2] += b;
        indices[i] = 0;
      }
    }
    const palette = buildPalette(hist, sums);
    const colors = palette.length / 3;
    nearest.fill(-1);
    const find = (bin) => {
      const r = ((bin >> 10) << 3) | 4;
      const g = (((bin >> 5) & 31) << 3) | 4;
      const b = ((bin & 31) << 3) | 4;
      let best = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < colors; c++) {
        const dr = r - palette[c * 3];
        const dg = g - palette[c * 3 + 1];
        const db = b - palette[c * 3 + 2];
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = c;
        }
      }
      return best;
    };
    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
    for (let y = y0, i = 0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++, i++) {
        if (indices[i] === TRANSPARENT) continue;
        const p = (y * width + x) * 4;
        const s = (y * width + x) * 3;
        let r = (shown[s] = rgba[p]);
        let g = (shown[s + 1] = rgba[p + 1]);
        let b = (shown[s + 2] = rgba[p + 2]);
        if (this.dither) {
          const offset = ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * 2 * DITHER;
          r = clamp(Math.round(r + offset));
          g = clamp(Math.round(g + offset));
          b = clamp(Math.round(b + offset));
        }
        const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        let color = nearest[bin];
        if (color < 0) color = nearest[bin] = find(bin);
        indices[i] = color;
      }
    }
    const packed = lzwEncode(indices, this.table);
    const table = new Uint8Array(256 * 3);
    table.set(palette);
    const body = new Bytes(packed.length + packed.length / 255 + 800);
    for (const byte of [0x2c, ...word(x0), ...word(y0), ...word(w), ...word(h), 0x87]) body.push(byte); // 이 장의 색표 256색
    for (const byte of table) body.push(byte);
    body.push(8); // 색 번호 8비트
    for (let at = 0; at < packed.length; at += 255) {
      const size = Math.min(255, packed.length - at);
      body.push(size);
      for (let i = 0; i < size; i++) body.push(packed[at + i]);
    }
    body.push(0);
    // 장 머리: 앞 장을 지우지 않고 그 위에 그린다(1). 투명 화소가 있으면 투명 색 번호를 알린다
    const head = Uint8Array.from([0x21, 0xf9, 4, (1 << 2) | (anyClear ? 1 : 0), 0, 0, TRANSPARENT, 0]);
    this.frames.push({ head, body: body.done(), delay });
  }

  // 지금까지 만든 크기 (바이트)
  get size() {
    return this.frames.reduce((sum, frame) => sum + frame.head.length + frame.body.length, this.header.length + 1);
  }

  // GIF 파일의 조각들 (Blob에 그대로 넘긴다)
  finish() {
    const parts = [this.header];
    for (const frame of this.frames) {
      // 쉬는 시간은 65,535(약 11분)까지 담긴다
      frame.head.set(word(Math.min(Math.max(Math.round(frame.delay), 1), 0xffff)), 4);
      parts.push(frame.head, frame.body);
    }
    parts.push(Uint8Array.of(0x3b));
    return parts;
  }
}

// n번째 장을 보일 시간 (1/100초). GIF는 1/100초 단위라 초당 15장처럼 나누어떨어지지 않으면 7, 7, 6을 섞어 맞춘다
export const frameDelay = (n, fps) => Math.round(((n + 1) * 100) / fps) - Math.round((n * 100) / fps);

// 만들 크기. 폭을 maxWidth까지 줄이고(키우지는 않는다) 높이는 비율대로
export function outputSize(width, height, maxWidth) {
  if (!maxWidth || width <= maxWidth) return { width, height };
  return { width: maxWidth, height: Math.max(1, Math.round((height * maxWidth) / width)) };
}

// 구간과 초당 장수로 뽑을 시각들 (영상 안의 시각). limit장을 넘으면 거기까지만
export function frameTimes(start, end, fps, limit = Infinity) {
  const times = [];
  for (let n = 0; n < limit && start + n / fps < end - 1e-6; n++) times.push(start + n / fps);
  return times;
}
