// MP3의 ID3 태그를 틀(frame) 단위로 읽고 다시 쓴다. 브라우저 API 가운데 TextDecoder·TextEncoder만 써서 Node에서 시험할 수 있다.
//
// 오디오 자르기의 읽기(audio-cut/tags.js)는 보여 줄 칸만 읽고, 오디오 형식 바꾸기의 쓰기(audio-convert/id3.js)는 태그를 새로 만든다.
// 여기서는 태그를 고쳐 쓰므로 고치지 않은 틀을 바이트 그대로 남겨야 해서 따로 두었다.
//
// ID3v2는 파일 맨 앞에 있다: 머리 10바이트("ID3", 판, 플래그, 크기) + 틀들 + 빈 채움.
//   2.2: 틀 이름 3글자 + 크기 3바이트                      (예전 아이튠즈. 저장할 때 2.3으로 바꾼다)
//   2.3: 틀 이름 4글자 + 크기 4바이트(보통 정수) + 플래그 2  (가장 널리 읽힌다)
//   2.4: 틀 이름 4글자 + 크기 4바이트(7비트씩, syncsafe) + 플래그 2
// ID3v1은 파일 맨 끝 128바이트("TAG" + 제목 30 + 아티스트 30 + 앨범 30 + 연도 4 + 설명 30 + 장르 1)다.

const NUL = String.fromCharCode(0);

function ascii(bytes, at, length) {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[at + i]);
  return text;
}
const fromAscii = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 255);
const syncsafe = (bytes, at) => ((bytes[at] & 127) << 21) | ((bytes[at + 1] & 127) << 14) | ((bytes[at + 2] & 127) << 7) | (bytes[at + 3] & 127);
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const u24 = (bytes, at) => (bytes[at] << 16) | (bytes[at + 1] << 8) | bytes[at + 2];
const toSyncsafe = (n) => Uint8Array.of((n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127);
const toU32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

export function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// 파일 맨 앞 10바이트를 보고 ID3v2 태그 전체의 길이를 안다 (머리와 2.4의 꼬리 포함). 태그가 없으면 0
export function id3v2Length(head) {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  if (head[3] === 0xff || head[4] === 0xff) return 0;
  if ((head[6] | head[7] | head[8] | head[9]) & 0x80) return 0;
  const footer = head[3] === 4 && head[5] & 0x10 ? 10 : 0;
  return 10 + syncsafe(head, 6) + footer;
}

// 비동기화(unsynchronisation)를 푼다: FF 뒤에 끼워 넣은 00을 뺀다
function deunsync(bytes) {
  const out = new Uint8Array(bytes.length);
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[n++] = bytes[i];
    if (bytes[i] === 0xff && bytes[i + 1] === 0) i++;
  }
  return out.subarray(0, n);
}

const isFrameId = (text) => /^[A-Z0-9]+$/.test(text);

// 2.4의 틀 크기는 7비트씩(syncsafe) 적어야 하는데 예전 아이튠즈는 보통 정수로 적었다.
// 두 방식으로 읽은 크기가 다르면, 그만큼 건너뛴 자리에 다음 틀이나 빈 채움, 태그의 끝이 오는 쪽을 고른다
function frameSize24(body, at) {
  const plain = u32(body, at + 4);
  if ((body[at + 4] | body[at + 5] | body[at + 6] | body[at + 7]) & 0x80) return plain;
  const safe = syncsafe(body, at + 4);
  if (safe === plain) return safe;
  const fits = (size) => {
    const next = at + 10 + size;
    if (next === body.length) return true;
    if (next > body.length) return false;
    // 빈 채움(0이 이어짐)이거나 다음 틀의 이름이 온다. 그림 데이터 안에도 0이 흔해서 0 하나로는 판단하지 않는다
    const ahead = body.subarray(next, next + 10);
    return ahead.every((byte) => byte === 0) || (ahead.length >= 4 && isFrameId(ascii(ahead, 0, 4)));
  };
  return fits(safe) || !fits(plain) ? safe : plain;
}

// 태그 전체(머리 10바이트부터)를 틀 목록으로 나눈다.
// 결과: { version: 2 | 3 | 4, frames: [{ id, flags: [a, b], data, at }] }
//   data는 틀 머리 뒤의 내용(저장된 그대로), at은 data가 태그 안에서 시작하는 자리다 (태그 전체의 비동기화를 풀어 자리가 달라졌으면 -1).
// 태그가 없거나 읽을 수 없는 판이면 null
export function parseId3v2(tag) {
  if (!id3v2Length(tag)) return null;
  const version = tag[3];
  const flags = tag[5];
  if (version < 2 || version > 4) return null;
  // 2.2의 이 플래그는 압축인데 방식이 정해지지 않아 읽을 수 없다
  if (version === 2 && flags & 0x40) return null;
  let body = tag.subarray(10, Math.min(tag.length, 10 + syncsafe(tag, 6)));
  let shifted = false;
  // 2.2와 2.3은 태그 전체에 비동기화를 한 번에 건다. 2.4는 틀마다 따로 건다
  if (version < 4 && flags & 0x80) {
    body = deunsync(body);
    shifted = true;
  }
  let at = 0;
  // 확장 머리는 건너뛴다. 2.3: 크기(자기 4바이트 빼고), 2.4: 크기(syncsafe, 자기 포함)
  if (version >= 3 && flags & 0x40 && body.length >= 4) at = version === 4 ? syncsafe(body, 0) : u32(body, 0) + 4;
  const idLength = version === 2 ? 3 : 4;
  const headLength = version === 2 ? 6 : 10;
  const frames = [];
  while (at + headLength <= body.length) {
    const id = ascii(body, at, idLength);
    if (!isFrameId(id)) break; // 빈 채움에 닿았다
    let size;
    if (version === 2) size = u24(body, at + 3);
    else if (version === 3) size = u32(body, at + 4);
    else size = frameSize24(body, at);
    const start = at + headLength;
    if (start + size > body.length) break; // 망가진 틀. 여기까지만 읽는다
    if (size > 0) {
      frames.push({
        id,
        flags: version === 2 ? [0, 0] : [body[at + 8], body[at + 9]],
        data: body.subarray(start, start + size),
        at: shifted ? -1 : 10 + start,
      });
    }
    at = start + size;
  }
  return { version, frames };
}

// 틀의 내용을 읽을 수 있게 푼다. 결과: { body, at: body가 태그 안에서 시작하는 자리(-1이면 모름) }. 압축·암호화된 틀은 null
export function frameBody(version, frame) {
  let data = frame.data;
  let at = frame.at;
  const skip = (n) => {
    data = data.subarray(n);
    if (at >= 0) at += n;
  };
  const format = frame.flags[1];
  if (version === 3) {
    if (format & 0xc0) return null; // 압축(0x80), 암호화(0x40)
    if (format & 0x20) skip(1); // 묶음 표시
  } else if (version === 4) {
    if (format & 0x0c) return null; // 압축(0x08), 암호화(0x04)
    if (format & 0x40) skip(1); // 묶음 표시
    if (format & 0x01) skip(4); // 실제 길이(data length indicator)
    if (format & 0x02) {
      data = deunsync(data);
      at = -1;
    }
  }
  return { body: data, at };
}

// 글 조각을 읽는다. encoding: 0 라틴 문자(바이트 그대로) · 1 UTF-16(BOM) · 2 UTF-16BE · 3 UTF-8
function decodeBytes(encoding, bytes) {
  if (encoding === 0) return ascii(bytes, 0, bytes.length);
  let label = "utf-8";
  let from = 0;
  if (encoding === 1) {
    label = "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be";
    if ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe)) from = 2;
  } else if (encoding === 2) {
    label = "utf-16be";
  }
  try {
    return new TextDecoder(label, { ignoreBOM: true }).decode(bytes.subarray(from));
  } catch {
    return "";
  }
}

const dropEnd = (text) => {
  let end = text.length;
  while (end > 0 && text[end - 1] === NUL) end--;
  return text.slice(0, end);
};

// 글 틀(T로 시작)의 값들. 2.4는 한 틀에 값을 여러 개(0으로 나눠) 담을 수 있다.
// 결과: { encoding, values } (encoding이 0이면 바이트를 그대로 글자로 옮긴 것이라 한글이 깨져 있을 수 있다)
export function textValues(body) {
  if (!body?.length) return { encoding: 0, values: [] };
  const encoding = body[0];
  const text = dropEnd(decodeBytes(encoding, body.subarray(1)));
  // UTF-16으로 값을 여러 개 적으면 값마다 BOM이 붙기도 한다
  const values = text ? text.split(NUL).map((value) => (value.charCodeAt(0) === 0xfeff ? value.slice(1) : value)) : [];
  return { encoding, values };
}

// 설명 틀(COMM)과 가사 틀(USLT): 인코딩(1) + 언어(3) + 짧은 설명(끝 표시) + 본문
export function commentParts(body) {
  if (!body || body.length < 4) return null;
  const encoding = body[0];
  const wide = encoding === 1 || encoding === 2;
  let end = 4;
  if (wide) while (end + 1 < body.length && (body[end] !== 0 || body[end + 1] !== 0)) end += 2;
  else while (end < body.length && body[end] !== 0) end++;
  return {
    encoding,
    language: ascii(body, 1, 3),
    description: dropEnd(decodeBytes(encoding, body.subarray(4, end))),
    text: dropEnd(decodeBytes(encoding, body.subarray(Math.min(body.length, end + (wide ? 2 : 1))))),
  };
}

// 사용자 정의 글 틀(TXXX): 인코딩(1) + 이름(끝 표시) + 값
export function userTextParts(body) {
  if (!body || body.length < 2) return null;
  const encoding = body[0];
  const wide = encoding === 1 || encoding === 2;
  let end = 1;
  if (wide) while (end + 1 < body.length && (body[end] !== 0 || body[end + 1] !== 0)) end += 2;
  else while (end < body.length && body[end] !== 0) end++;
  return {
    encoding,
    description: dropEnd(decodeBytes(encoding, body.subarray(1, end))),
    text: dropEnd(decodeBytes(encoding, body.subarray(Math.min(body.length, end + (wide ? 2 : 1))))),
  };
}

// 그림 데이터의 첫 바이트들로 형식을 안다 (틀에 적힌 MIME이 틀린 파일이 있다)
function sniffImage(bytes, at) {
  if (bytes[at] === 0xff && bytes[at + 1] === 0xd8) return "image/jpeg";
  if (bytes[at] === 0x89 && bytes[at + 1] === 0x50 && bytes[at + 2] === 0x4e && bytes[at + 3] === 0x47) return "image/png";
  if (bytes[at] === 0x47 && bytes[at + 1] === 0x49 && bytes[at + 2] === 0x46) return "image/gif";
  if (bytes[at] === 0x42 && bytes[at + 1] === 0x4d) return "image/bmp";
  if (ascii(bytes, at, 4) === "RIFF" && ascii(bytes, at + 8, 4) === "WEBP") return "image/webp";
  return "";
}

// 그림 틀에서 종류와 그림 데이터의 자리를 읽는다. picture22가 true면 2.2의 PIC(그림 형식 3글자), 아니면 APIC(MIME).
// 결과: { mime, type: 그림 종류(3이 앞표지), start: body 안에서 그림이 시작하는 자리, length }. 그림이 주소로만 적혀 있으면 null
export function pictureParts(body, picture22 = false) {
  if (!body || body.length < 6) return null;
  const encoding = body[0];
  let at = 1;
  let mime = "";
  if (picture22) {
    mime = ascii(body, 1, 3).toLowerCase();
    at = 4;
  } else {
    let end = at;
    while (end < body.length && body[end] !== 0) end++;
    mime = ascii(body, at, end - at).toLowerCase();
    at = end + 1;
  }
  if (mime === "-->") return null;
  const type = body[at];
  at += 1;
  if (encoding === 1 || encoding === 2) {
    while (at + 1 < body.length && (body[at] !== 0 || body[at + 1] !== 0)) at += 2;
    at += 2;
  } else {
    while (at < body.length && body[at] !== 0) at++;
    at += 1;
  }
  if (at >= body.length) return null;
  if (mime === "jpg" || mime === "image/jpg") mime = "image/jpeg";
  else if (mime && !mime.includes("/")) mime = `image/${mime}`;
  return { mime: sniffImage(body, at) || mime || "image/jpeg", type, start: at, length: body.length - at };
}

// ---- 쓰기 ----

function isAscii(text) {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return false;
  return true;
}

// BOM(FF FE) + UTF-16LE
function utf16(text) {
  const out = new Uint8Array(2 + text.length * 2);
  out[0] = 0xff;
  out[1] = 0xfe;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out[2 + i * 2] = code & 255;
    out[3 + i * 2] = code >> 8;
  }
  return out;
}

// 글을 그 판에 맞게 적는다. 영문·숫자뿐이면 어디서나 같게 읽히는 0번 방식으로,
// 그 밖의 글자(한글, é 등)는 2.3이면 UTF-16(BOM), 2.4면 UTF-8로 적는다.
// 0번 방식(라틴 문자)에 128 이상의 글자를 적으면 한글 윈도우가 그 바이트를 한글로 읽어 깨진다.
// 결과: { encoding, bytes, empty: 빈 설명(끝 표시까지) }
function encodeText(version, text) {
  if (isAscii(text)) return { encoding: 0, bytes: fromAscii(text), empty: Uint8Array.of(0) };
  if (version === 4) return { encoding: 3, bytes: new TextEncoder().encode(text), empty: Uint8Array.of(0) };
  return { encoding: 1, bytes: utf16(text), empty: Uint8Array.of(0xff, 0xfe, 0, 0) };
}

const newFrame = (id, data) => ({ id, flags: [0, 0], data, at: -1 });

export function textFrame(version, id, text) {
  const { encoding, bytes } = encodeText(version, text);
  return newFrame(id, concat([Uint8Array.of(encoding), bytes]));
}

// 설명이 빈 COMM. 윈도우 탐색기의 "설명" 칸은 설명이 빈 COMM만 보여 준다
export function commentFrame(version, text, language = "eng") {
  const { encoding, bytes, empty } = encodeText(version, text);
  const lang = /^[a-zA-Z]{3}$/.test(language) ? language : "eng";
  return newFrame("COMM", concat([Uint8Array.of(encoding), fromAscii(lang), empty, bytes]));
}

// 앞표지 그림(APIC): 인코딩(0) + MIME(끝 0) + 그림 종류 + 설명(빈 글, 끝 0) + 그림
export function pictureFrame(mime, data, type = 3) {
  return newFrame("APIC", concat([Uint8Array.of(0), fromAscii(mime || "image/jpeg"), Uint8Array.of(0, type, 0), data]));
}

// 태그 뒤에 남겨 두는 빈 바이트. 다음에 태그가 조금 길어져도 다른 프로그램이 파일 전체를 다시 쓰지 않게 한다
export const PADDING = 1024;

// 틀 목록으로 태그를 만든다 (version은 3이나 4). 틀이 하나도 없으면 빈 배열, 곧 태그 없음이다.
// 비동기화·확장 머리·꼬리는 쓰지 않는다
export function buildId3v2(version, frames, padding = PADDING) {
  if (!frames.length) return new Uint8Array(0);
  const parts = [];
  for (const frame of frames) {
    const size = version === 4 ? toSyncsafe(frame.data.length) : toU32(frame.data.length);
    parts.push(fromAscii(frame.id), size, Uint8Array.of(frame.flags[0], frame.flags[1]), frame.data);
  }
  parts.push(new Uint8Array(padding));
  const body = concat(parts);
  return concat([fromAscii("ID3"), Uint8Array.of(version, 0, 0), toSyncsafe(body.length), body]);
}

// 2.2의 틀 이름(3글자)과 2.3의 이름(4글자). 내용의 모양은 같다 (그림 PIC만 다르다)
const NAMES22 = {
  BUF: "RBUF", CNT: "PCNT", COM: "COMM", CRA: "AENC", ETC: "ETCO", EQU: "EQUA", GEO: "GEOB", IPL: "IPLS", MCI: "MCDI",
  MLL: "MLLT", POP: "POPM", REV: "RVRB", RVA: "RVAD", SLT: "SYLT", STC: "SYTC", TAL: "TALB", TBP: "TBPM", TCM: "TCOM",
  TCO: "TCON", TCP: "TCMP", TCR: "TCOP", TDA: "TDAT", TDY: "TDLY", TEN: "TENC", TFT: "TFLT", TIM: "TIME", TKE: "TKEY",
  TLA: "TLAN", TLE: "TLEN", TMT: "TMED", TOA: "TOPE", TOF: "TOFN", TOL: "TOLY", TOR: "TORY", TOT: "TOAL", TP1: "TPE1",
  TP2: "TPE2", TP3: "TPE3", TP4: "TPE4", TPA: "TPOS", TPB: "TPUB", TRC: "TSRC", TRD: "TRDA", TRK: "TRCK", TS2: "TSO2",
  TSA: "TSOA", TSC: "TSOC", TSI: "TSIZ", TSP: "TSOP", TSS: "TSSE", TST: "TSOT", TT1: "TIT1", TT2: "TIT2", TT3: "TIT3",
  TXT: "TEXT", TXX: "TXXX", TYE: "TYER", UFI: "UFID", ULT: "USLT", WAF: "WOAF", WAR: "WOAR", WAS: "WOAS", WCM: "WCOM",
  WCP: "WCOP", WPB: "WPUB", WXX: "WXXX",
};

// 2.2의 틀들을 2.3의 틀로 바꾼다. 2.3에 짝이 없는 틀은 버린다
export function upgradeFrames22(frames) {
  const out = [];
  for (const frame of frames) {
    if (frame.id === "PIC") {
      const parts = pictureParts(frame.data, true);
      if (!parts) continue;
      // 인코딩과 설명은 그대로 두고 그림 형식 3글자만 MIME으로 바꾼다
      out.push(newFrame("APIC", concat([frame.data.subarray(0, 1), fromAscii(parts.mime), Uint8Array.of(0), frame.data.subarray(4)])));
    } else if (NAMES22[frame.id]) {
      out.push({ id: NAMES22[frame.id], flags: [0, 0], data: frame.data, at: frame.at });
    }
  }
  return out;
}

// ---- ID3v1 ----

// 파일 끝 128바이트를 읽는다. 글은 바이트를 그대로 글자로 옮긴 것이다 (한글은 대개 EUC-KR이라 깨져 보인다).
// 결과: { title, artist, album, year, comment, track, genre: 번호(255는 없음) }. ID3v1이 아니면 null
export function parseId3v1(tail) {
  if (!tail || tail.length < 128) return null;
  const bytes = tail.subarray(tail.length - 128);
  if (ascii(bytes, 0, 3) !== "TAG") return null;
  const text = (at, length) => {
    let end = at;
    while (end < at + length && bytes[end] !== 0) end++;
    return ascii(bytes, at, end - at).replace(/ +$/, "");
  };
  // 1.1판: 설명 칸의 끝 두 바이트가 0과 트랙 번호다
  const hasTrack = bytes[125] === 0 && bytes[126] !== 0;
  return {
    title: text(3, 30),
    artist: text(33, 30),
    album: text(63, 30),
    year: text(93, 4),
    comment: text(97, hasTrack ? 28 : 30),
    track: hasTrack ? String(bytes[126]) : "",
    genre: bytes[127],
  };
}

// ID3v1에 한글을 적을 때 쓰는 표: 글자 → EUC-KR(CP949) 두 바이트. 브라우저에는 이 방향의 변환이 없어서,
// 두 바이트 조합을 모두 읽어 보고(TextDecoder) 거꾸로 된 표를 한 번 만든다
let legacyTable = null;
function legacy() {
  if (legacyTable) return legacyTable;
  legacyTable = new Map();
  const decoder = new TextDecoder("euc-kr");
  const pair = new Uint8Array(2);
  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      pair[0] = lead;
      pair[1] = trail;
      const text = decoder.decode(pair);
      if (text.length !== 1) continue;
      const code = text.charCodeAt(0);
      if (code > 127 && code !== 0xfffd && !legacyTable.has(text)) legacyTable.set(text, [lead, trail]);
    }
  }
  return legacyTable;
}

// 글을 ID3v1 칸에 적을 바이트로 바꾼다 (영문은 그대로, 한글은 EUC-KR, 적을 수 없는 글자는 ?). 칸을 넘으면 글자 사이에서 자른다
function legacyBytes(text, max) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const bytes = code < 128 ? [code] : (legacy().get(ch) ?? [0x3f]);
    if (out.length + bytes.length > max) break;
    out.push(...bytes);
  }
  return out;
}

// 글 전체를 옛 방식(영문은 그대로, 한글은 EUC-KR) 바이트로 바꾼다. 그 방식으로 적을 수 없는 글자가 있으면 null.
// WAV의 INFO 칸이 EUC-KR로 적혀 있던 파일에 쓴다 (wav.js)
export function legacyText(text) {
  const out = [];
  for (const ch of text) {
    const code = ch.codePointAt(0);
    const bytes = code < 128 ? [code] : legacy().get(ch);
    if (!bytes) return null;
    out.push(...bytes);
  }
  return Uint8Array.from(out);
}

const V1_TEXT = { title: [3, 30], artist: [33, 30], album: [63, 30], year: [93, 4] };

// ID3v1 128바이트의 몇 칸만 고친 새 바이트를 만든다.
// changes: { title, artist, album, year, comment, track: 글, genre: 번호 } 가운데 바꿀 것만 넣는다. 빈 글이면 그 칸을 비운다
export function patchId3v1(tail, changes) {
  const out = tail.slice(tail.length - 128);
  const put = (at, length, text) => {
    out.fill(0, at, at + length);
    out.set(legacyBytes(text, length), at);
  };
  for (const [key, [at, length]] of Object.entries(V1_TEXT)) {
    if (changes[key] !== undefined) put(at, length, changes[key]);
  }
  // 1.1판은 설명 칸의 끝 두 바이트를 0과 트랙 번호로 쓴다. 그러면 설명은 28바이트까지다
  const hadTrack = out[125] === 0 && out[126] !== 0;
  let track = hadTrack ? out[126] : 0;
  if (changes.track !== undefined) {
    const n = Number.parseInt(changes.track, 10);
    track = n >= 1 && n <= 255 ? n : 0;
  }
  if (changes.comment !== undefined) put(97, track ? 28 : 30, changes.comment);
  else if (!track && hadTrack) out[126] = 0;
  if (track) {
    out[125] = 0;
    out[126] = track;
  }
  if (changes.genre !== undefined) out[127] = changes.genre;
  return out;
}
