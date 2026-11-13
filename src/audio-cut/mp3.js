// MP3를 다시 압축하지 않고 자른다. MP3는 작은 조각(프레임, 대개 0.026초)이 이어진 것이라
// 앞뒤 조각을 빼고 나머지를 그대로 이어 붙이면 음질이 그대로다.
// 파일 앞의 태그(ID3v2: 제목·아티스트·작곡가·앨범 아트 등)와 끝의 태그(ID3v1·APE)는 바이트 그대로 옮긴다.
// 첫 조각에 길이 정보(Xing·Info, VBRI)가 있으면 새 길이로 고친다. 이 정보가 틀리면 재생 시간이 잘못 보인다.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

// 초당 비트 수(kbps). [MPEG1 레이어 1, 2, 3], [MPEG2·2.5 레이어 1, 2·3]
const BITRATES = {
  "1-1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  "1-2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  "2-1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  "2-2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const SAMPLE_RATES = { 1: [44100, 48000, 32000], 2: [22050, 24000, 16000], 2.5: [11025, 12000, 8000] };

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const writeU32 = (bytes, at, value) => {
  bytes[at] = value >>> 24;
  bytes[at + 1] = (value >>> 16) & 255;
  bytes[at + 2] = (value >>> 8) & 255;
  bytes[at + 3] = value & 255;
};

// 프레임 머리(4바이트)를 읽는다. 틀린 머리면 null
export function frameHeader(bytes, at) {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const versionBits = (bytes[at + 1] >> 3) & 3;
  const layerBits = (bytes[at + 1] >> 1) & 3;
  const bitrateIndex = bytes[at + 2] >> 4;
  const rateIndex = (bytes[at + 2] >> 2) & 3;
  if (versionBits === 1 || layerBits === 0 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) return null;
  const version = versionBits === 3 ? 1 : versionBits === 2 ? 2 : 2.5;
  const layer = 4 - layerBits;
  const table = version === 1 ? `1-${layer}` : layer === 1 ? "2-1" : "2-2";
  const bitrate = BITRATES[table][bitrateIndex] * 1000;
  const sampleRate = SAMPLE_RATES[version][rateIndex];
  const padding = (bytes[at + 2] >> 1) & 1;
  const channels = (bytes[at + 3] >> 6) === 3 ? 1 : 2;
  const protectedByCrc = (bytes[at + 1] & 1) === 0;
  let size;
  let samples;
  if (layer === 1) {
    size = (Math.floor((12 * bitrate) / sampleRate) + padding) * 4;
    samples = 384;
  } else {
    const perFrame = layer === 3 && version !== 1 ? 576 : 1152;
    size = Math.floor(((perFrame / 8) * bitrate) / sampleRate) + padding;
    samples = perFrame;
  }
  return { version, layer, bitrate, sampleRate, channels, size, samples, protectedByCrc };
}

// 같은 종류의 프레임인지 (잘못 찾은 동기 신호를 거르려고 다음 프레임과 견준다)
const sameKind = (a, b) => a && b && a.version === b.version && a.layer === b.layer && a.sampleRate === b.sampleRate;

// 파일 앞의 ID3v2 태그 길이 (없으면 0). 태그가 여러 개 이어져 있으면 모두 더한다
function id3v2Length(bytes) {
  let at = 0;
  while (at + 10 <= bytes.length && ascii(bytes, at, 3) === "ID3") {
    const size = ((bytes[at + 6] & 127) << 21) | ((bytes[at + 7] & 127) << 14) | ((bytes[at + 8] & 127) << 7) | (bytes[at + 9] & 127);
    const footer = bytes[at + 5] & 0x10 ? 10 : 0;
    at += 10 + size + footer;
  }
  return Math.min(at, bytes.length);
}

// 파일 끝의 태그가 시작하는 자리 (ID3v1, 확장 ID3v1(TAG+), APEv2, Lyrics3v2). 없으면 파일 길이
function tailStart(bytes) {
  let end = bytes.length;
  for (let guard = 0; guard < 4; guard++) {
    if (end >= 128 && ascii(bytes, end - 128, 3) === "TAG") {
      end -= 128;
      if (end >= 227 && ascii(bytes, end - 227, 4) === "TAG+") end -= 227;
      continue;
    }
    if (end >= 32 && ascii(bytes, end - 32, 8) === "APETAGEX") {
      const size = bytes[end - 20] | (bytes[end - 19] << 8) | (bytes[end - 18] << 16) | (bytes[end - 17] << 24);
      const hasHeader = (bytes[end - 9] & 0x80) !== 0;
      end -= size + (hasHeader ? 32 : 0);
      continue;
    }
    if (end >= 15 && ascii(bytes, end - 9, 9) === "LYRICS200") {
      const size = Number(ascii(bytes, end - 15, 6));
      if (Number.isFinite(size)) {
        end -= size + 15;
        continue;
      }
    }
    break;
  }
  return Math.max(0, end);
}

// 첫 프레임의 길이 정보(Xing·Info 또는 VBRI)를 찾는다
function infoHeader(bytes, frame) {
  const sideInfo = frame.version === 1 ? (frame.channels === 1 ? 17 : 32) : frame.channels === 1 ? 9 : 17;
  for (const offset of [4 + sideInfo, 4 + sideInfo + 2]) {
    const tag = ascii(bytes, frame.offset + offset, 4);
    if (tag === "Xing" || tag === "Info") {
      const at = frame.offset + offset;
      const flags = u32(bytes, at + 4);
      let field = at + 8;
      const xing = { kind: "xing", at, flags, framesAt: -1, bytesAt: -1, tocAt: -1 };
      if (flags & 1) {
        xing.framesAt = field;
        field += 4;
      }
      if (flags & 2) {
        xing.bytesAt = field;
        field += 4;
      }
      if (flags & 4) {
        xing.tocAt = field;
        field += 100;
      }
      if (flags & 8) field += 4;
      // LAME 태그 (인코더 이름 9바이트로 시작하고 36바이트). LAME·FFmpeg(Lavf·Lavc)가 쓴다
      if (field + 36 <= frame.offset + frame.size && /^(LAME|Lavf|Lavc|GOGO|L3.99)/.test(ascii(bytes, field, 4))) xing.lameAt = field;
      return xing;
    }
  }
  if (ascii(bytes, frame.offset + 36, 4) === "VBRI") return { kind: "vbri", at: frame.offset + 36 };
  return null;
}

// MP3 파일을 읽는다. { head: 첫 프레임 앞(ID3v2 등) 길이, info: 길이 정보 프레임, frames: 소리 프레임들, tail: 끝 태그 시작 자리,
//   sampleRate, samplesPerFrame, channels, delay·padding: 인코더가 앞뒤에 덧붙인 샘플 수(LAME 태그) }
// MP3로 볼 수 없으면 null
export function parseMp3(bytes) {
  const start = id3v2Length(bytes);
  const end = tailStart(bytes);
  // 첫 프레임: 동기 신호 뒤에 같은 종류의 프레임이 이어지는 자리
  let first = -1;
  for (let at = start; at + 4 <= end && at < start + 65536; at++) {
    const header = frameHeader(bytes, at);
    if (header && sameKind(header, frameHeader(bytes, at + header.size))) {
      first = at;
      break;
    }
  }
  if (first < 0) return null;
  const firstHeader = frameHeader(bytes, first);
  const frames = [];
  let at = first;
  while (at + 4 <= end) {
    const header = frameHeader(bytes, at);
    if (!sameKind(header, firstHeader) || at + header.size > end) {
      // 프레임 사이에 끼어든 쓰레기는 건너뛰고 다음 프레임을 찾는다 (찾지 못하면 끝)
      let next = -1;
      for (let probe = at + 1; probe + 4 <= end && probe < at + 4096; probe++) {
        const candidate = frameHeader(bytes, probe);
        if (sameKind(candidate, firstHeader) && probe + candidate.size <= end) {
          next = probe;
          break;
        }
      }
      if (next < 0) break;
      at = next;
      continue;
    }
    frames.push({ offset: at, size: header.size });
    at += header.size;
  }
  if (frames.length < 2) return null;
  const info = infoHeader(bytes, { ...firstHeader, offset: frames[0].offset, size: frames[0].size });
  let delay = 0;
  let padding = 0;
  if (info?.lameAt) {
    const at3 = info.lameAt + 21;
    delay = (bytes[at3] << 4) | (bytes[at3 + 1] >> 4);
    padding = ((bytes[at3 + 1] & 15) << 8) | bytes[at3 + 2];
  }
  return {
    head: frames[0].offset,
    info: info && { ...info, frame: frames[0] },
    frames: info ? frames.slice(1) : frames,
    tail: end,
    sampleRate: firstHeader.sampleRate,
    samplesPerFrame: firstHeader.samples,
    channels: firstHeader.channels,
    layer: firstHeader.layer,
    delay,
    padding,
  };
}

// MP3 조각의 길이(초)
export const frameDuration = (mp3) => mp3.samplesPerFrame / mp3.sampleRate;

// 재생 시간(초)에서 조각 번호. 재생기는 인코더가 앞에 덧붙인 샘플(delay)과 디코더 지연(529)을 빼고 들려주므로 그만큼 더한다
export function frameAt(mp3, seconds) {
  const shift = mp3.delay ? mp3.delay + 529 : 0;
  return Math.max(0, Math.min(mp3.frames.length, Math.round((seconds * mp3.sampleRate + shift) / mp3.samplesPerFrame)));
}

// 조각 번호에서 재생 시간(초)
export function timeOfFrame(mp3, index) {
  const shift = mp3.delay ? mp3.delay + 529 : 0;
  return Math.max(0, (index * mp3.samplesPerFrame - shift) / mp3.sampleRate);
}

// CRC-16 (LAME 태그가 쓰는 것: 다항식 0x8005를 거꾸로 한 0xA001, 처음 값 0)
const CRC_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xa001 : c >>> 1;
    table[n] = c;
  }
  return table;
})();
export function crc16(bytes, crc = 0) {
  for (let i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 255];
  return crc;
}

// [from, to) 조각만 남긴 MP3를 만든다. 앞 태그, 길이 정보 프레임(새 길이로 고침), 남긴 조각들, 끝 태그 순서다
export function cutMp3(bytes, mp3, from, to) {
  const kept = mp3.frames.slice(from, to);
  if (!kept.length) throw new Error("남길 소리가 없습니다");
  const audioBytes = kept.reduce((sum, frame) => sum + frame.size, 0);
  const infoSize = mp3.info ? mp3.info.frame.size : 0;
  const tailBytes = bytes.length - mp3.tail;
  const out = new Uint8Array(mp3.head + infoSize + audioBytes + tailBytes);
  let at = 0;
  out.set(bytes.subarray(0, mp3.head), at);
  at += mp3.head;
  const infoAt = at;
  if (mp3.info) {
    out.set(bytes.subarray(mp3.info.frame.offset, mp3.info.frame.offset + infoSize), at);
    at += infoSize;
  }
  const audioAt = at;
  for (const frame of kept) {
    out.set(bytes.subarray(frame.offset, frame.offset + frame.size), at);
    at += frame.size;
  }
  out.set(bytes.subarray(mp3.tail), at);
  if (mp3.info) fixInfo(out, mp3, infoAt, audioAt, kept, infoSize + audioBytes);
  return out;
}

// 길이 정보 프레임을 새 길이로 고친다 (프레임 수, 바이트 수, 찾아가기 표, LAME 태그의 길이와 CRC)
function fixInfo(out, mp3, infoAt, audioAt, kept, streamBytes) {
  const shift = infoAt - mp3.info.frame.offset;
  if (mp3.info.kind === "vbri") {
    const at = mp3.info.at + shift;
    writeU32(out, at + 10, streamBytes);
    writeU32(out, at + 14, kept.length);
    // 찾아가기 표는 다시 만들지 않고 비워 둔다 (표 항목 수 0)
    out[at + 18] = 0;
    out[at + 19] = 0;
    return;
  }
  const xing = mp3.info;
  if (xing.framesAt >= 0) writeU32(out, xing.framesAt + shift, kept.length);
  if (xing.bytesAt >= 0) writeU32(out, xing.bytesAt + shift, streamBytes);
  if (xing.tocAt >= 0) {
    // 재생 시간의 i%에 있는 조각이 스트림 앞에서 몇 바이트 뒤에 있는지를 256분율로 적는다
    const starts = [];
    let offset = audioAt - infoAt;
    for (const frame of kept) {
      starts.push(offset);
      offset += frame.size;
    }
    for (let i = 0; i < 100; i++) {
      const frameIndex = Math.min(kept.length - 1, Math.floor((i / 100) * kept.length));
      out[xing.tocAt + shift + i] = Math.min(255, Math.floor((256 * starts[frameIndex]) / streamBytes));
    }
  }
  if (xing.lameAt) {
    const lameAt = xing.lameAt + shift;
    // 소리 길이(바이트, 길이 정보 프레임 포함)와 소리 부분의 CRC
    writeU32(out, lameAt + 28, streamBytes);
    const music = crc16(out.subarray(audioAt, audioAt + streamBytes - (audioAt - infoAt)));
    out[lameAt + 32] = music >> 8;
    out[lameAt + 33] = music & 255;
    // 태그 CRC: 프레임 처음부터 이 CRC 바로 앞까지
    const tag = crc16(out.subarray(infoAt, lameAt + 34));
    out[lameAt + 34] = tag >> 8;
    out[lameAt + 35] = tag & 255;
  }
}
