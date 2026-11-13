// WAV를 그대로 자른다. WAV(PCM)는 샘플이 압축 없이 차례로 들어 있어, 고른 구간의 바이트만 남기면 손실이 없다.
// 소리 데이터(data 조각) 말고 다른 조각(LIST INFO 태그, id3 태그 등)은 바이트 그대로 같은 순서로 옮긴다.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
const view = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

// 바이트만 잘라도 되는 형식: PCM(1), 부동소수(3), A-law(6), µ-law(7), 확장형(0xFFFE, 안쪽 형식이 PCM·부동소수)
const CUTTABLE = new Set([1, 3, 6, 7]);

// WAV 파일을 읽는다. { chunks: [{ id, at, size }], sampleRate, channels, bitsPerSample, blockAlign, dataIndex, frames(샘플 수) }
// 그대로 자를 수 없는 WAV(압축 형식, 4GB가 넘는 RF64 등)면 null
export function parseWav(bytes) {
  if (bytes.length < 12 || ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return null;
  const dv = view(bytes);
  const chunks = [];
  let fmt = null;
  let at = 12;
  while (at + 8 <= bytes.length) {
    const id = ascii(bytes, at, 4);
    let size = dv.getUint32(at + 4, true);
    // 마지막 조각의 길이가 파일보다 길게 적혀 있으면(녹음이 끊긴 파일 등) 파일 끝까지로 본다
    if (at + 8 + size > bytes.length) size = bytes.length - at - 8;
    chunks.push({ id, at, size });
    if (id === "fmt " && size >= 16) {
      let format = dv.getUint16(at + 8, true);
      if (format === 0xfffe && size >= 40) format = dv.getUint16(at + 8 + 24, true);
      fmt = {
        format,
        channels: dv.getUint16(at + 10, true),
        sampleRate: dv.getUint32(at + 12, true),
        blockAlign: dv.getUint16(at + 20, true),
        bitsPerSample: dv.getUint16(at + 22, true),
      };
    }
    at += 8 + size + (size & 1);
  }
  const dataIndex = chunks.findIndex((chunk) => chunk.id === "data");
  if (!fmt || dataIndex < 0 || !CUTTABLE.has(fmt.format) || !fmt.blockAlign || !fmt.sampleRate) return null;
  return { chunks, ...fmt, dataIndex, frames: Math.floor(chunks[dataIndex].size / fmt.blockAlign) };
}

// [from, to) 샘플만 남긴 WAV를 만든다. 다른 조각은 그대로 옮기고, 샘플 수를 적는 fact 조각이 있으면 새 수로 고친다
export function cutWav(bytes, wav, from, to) {
  const start = Math.max(0, Math.min(wav.frames, Math.round(from)));
  const end = Math.max(start, Math.min(wav.frames, Math.round(to)));
  if (end <= start) throw new Error("남길 소리가 없습니다");
  const data = wav.chunks[wav.dataIndex];
  const dataBytes = (end - start) * wav.blockAlign;
  const parts = [];
  let total = 12;
  for (const [i, chunk] of wav.chunks.entries()) {
    const body = i === wav.dataIndex ? bytes.subarray(data.at + 8 + start * wav.blockAlign, data.at + 8 + end * wav.blockAlign) : bytes.subarray(chunk.at + 8, chunk.at + 8 + chunk.size);
    parts.push({ id: chunk.id, body });
    total += 8 + body.length + (body.length & 1);
  }
  const out = new Uint8Array(total);
  const dv = view(out);
  out.set(bytes.subarray(0, 12));
  dv.setUint32(4, total - 8, true);
  let at = 12;
  for (const part of parts) {
    for (let k = 0; k < 4; k++) out[at + k] = part.id.charCodeAt(k);
    dv.setUint32(at + 4, part.body.length, true);
    out.set(part.body, at + 8);
    if (part.id === "fact" && part.body.length >= 4) dv.setUint32(at + 8, end - start, true);
    at += 8 + part.body.length + (part.body.length & 1);
  }
  if (dataBytes !== parts[wav.dataIndex].body.length) throw new Error("WAV를 자르지 못했습니다");
  return out;
}
