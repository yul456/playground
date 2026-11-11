// PNG를 한 번에 메모리에 만들지 않고 몇백 줄씩 받아 바로 압축해 내보내는 인코더.
// 캔버스 한 장은 세로 65,535px·화소 약 2억 6천만 개를 넘을 수 없고, 원본 크기 사진 수십 장을 한 캔버스에 그리면
// 메모리도 1GB를 넘는다. 이렇게 이어 쓰면 세로 길이에 한계가 없고 메모리는 사진 한 장 몫만 쓴다.
// 압축은 브라우저 내장 CompressionStream("deflate")을 쓴다. PNG 그림 데이터(IDAT)가 바로 이 zlib 형식이다.
// 화면 코드가 없어 Node에서도 돌릴 수 있다.

const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
// PNG 가로·세로 최대값(2^31 - 1)
const MAX_SIDE = 0x7fffffff;
// 압축된 데이터를 이만큼 모아 IDAT 조각 하나로 쓴다
const IDAT_BYTES = 4 << 20;
// 줄마다 붙이는 필터 번호. Paeth(왼쪽·위·왼쪽 위로 예측)가 사진에서 대체로 가장 잘 줄어든다
const PAETH = 4;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts, size = parts.reduce((sum, p) => sum + p.length, 0)) {
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// PNG 조각: 길이(4바이트) + 종류(4글자) + 데이터 + CRC(종류와 데이터의 검사값)
function chunk(type, data = new Uint8Array(0)) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function header(width, height) {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  data[8] = 8; // 색 하나에 8비트
  data[9] = 2; // RGB. 흰 바탕에 그려 늘 불투명하므로 투명도는 넣지 않는다
  // 10~12: 압축·필터 방식 0, 인터레이스 없음
  return data;
}

// sink: { write(bytes), close(), abort() } (모두 Promise). 머리(시그니처·IHDR)를 쓴 뒤 인코더를 돌려준다.
// writeRows로 위에서부터 height줄을 다 넣고 finish를 부른다. 중간에 그만두면 abort를 부른다
export async function openPng(width, height, sink) {
  const valid = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_SIDE;
  if (!valid(width) || !valid(height)) throw new RangeError(`PNG 크기가 맞지 않습니다: ${width}×${height}`);

  await sink.write(concat([SIGNATURE, chunk("IHDR", header(width, height))]));
  let written = SIGNATURE.length + 25;
  const stride = width * 3;
  // 바로 위 줄과 지금 줄(RGB). 맨 첫 줄의 위 줄은 PNG 규칙대로 0으로 본다
  let prev = new Uint8Array(stride);
  let cur = new Uint8Array(stride);
  let rowsDone = 0;

  const deflate = new CompressionStream("deflate");
  const writer = deflate.writable.getWriter();
  const reader = deflate.readable.getReader();
  const put = async (bytes) => {
    await sink.write(bytes);
    written += bytes.length;
  };
  // 압축된 데이터를 받아 IDAT 조각으로 내보낸다. 내보내다 실패하면 압축 쪽도 멈춰 writeRows가 오류를 받는다
  const pump = (async () => {
    let parts = [];
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
        size += value.length;
        if (size >= IDAT_BYTES) {
          await put(chunk("IDAT", concat(parts, size)));
          parts = [];
          size = 0;
        }
      }
      if (size) await put(chunk("IDAT", concat(parts, size)));
    } catch (err) {
      reader.cancel(err).catch(() => {});
      throw err;
    }
  })();
  pump.catch(() => {}); // 오류는 writeRows·finish 쪽에서 받는다

  return {
    // RGBA 화소 rows줄(폭 width)을 붙인다. 투명도는 버린다
    async writeRows(rgba, rows) {
      if (!(rows >= 1) || rowsDone + rows > height) throw new RangeError("PNG 높이보다 많은 줄을 넣었습니다");
      const out = new Uint8Array(rows * (stride + 1));
      let o = 0;
      for (let r = 0; r < rows; r++) {
        for (let i = 0, s = r * width * 4; i < stride; i += 3, s += 4) {
          cur[i] = rgba[s];
          cur[i + 1] = rgba[s + 1];
          cur[i + 2] = rgba[s + 2];
        }
        out[o++] = PAETH;
        // 줄의 첫 화소는 왼쪽이 없어 위 화소로 예측한다 (Paeth 규칙을 그대로 따르면 이렇게 된다)
        out[o++] = cur[0] - prev[0];
        out[o++] = cur[1] - prev[1];
        out[o++] = cur[2] - prev[2];
        for (let i = 3; i < stride; i++) {
          const a = cur[i - 3];
          const b = prev[i];
          const c = prev[i - 3];
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - c - c);
          // Uint8Array에 넣으면 음수도 256으로 나눈 나머지가 되어 PNG가 바라는 값이 된다
          out[o++] = cur[i] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        const done = prev;
        prev = cur;
        cur = done;
      }
      rowsDone += rows;
      await writer.write(out);
    },
    // 남은 압축 데이터와 끝 조각(IEND)을 쓰고 닫는다. 쓴 바이트 수를 돌려준다
    async finish() {
      if (rowsDone !== height) throw new Error(`PNG 줄 수가 맞지 않습니다: ${rowsDone}/${height}`);
      await writer.close();
      await pump;
      await put(chunk("IEND"));
      await sink.close();
      return written;
    },
    async abort(reason) {
      await writer.abort(reason).catch(() => {});
      await pump.catch(() => {});
      await sink.abort();
    },
  };
}
