// MP3에 붙일 ID3v2.3 태그를 만든다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// Mediabunny는 ID3v2.4로 쓰는데, 윈도우와 오래된 기기(카오디오 등)가 가장 잘 읽는 판은 v2.3이라 태그는 직접 쓴다.
// 태그 프로그램(Mp3tag 등)도 같은 까닭으로 v2.3을 기본으로 쓴다.
// 글은 라틴 문자만 있으면 ISO-8859-1, 한글 등이 있으면 UTF-16(BOM)으로 쓴다. v2.3은 UTF-8을 담지 못한다.

const latin1 = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 255);
const isLatin1 = (text) => /^[\u0000-ÿ]*$/.test(text);

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

function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// [인코딩 바이트, 글 바이트, 끝 표시(빈 글 뒤에 붙일 0)]
function encode(text) {
  return isLatin1(text) ? [0, latin1(text), Uint8Array.of(0)] : [1, utf16(text), Uint8Array.of(0, 0)];
}

// 프레임: 이름 4바이트 + 크기 4바이트(v2.3은 보통 정수, v2.4와 달리 syncsafe가 아니다) + 플래그 2바이트 + 내용
function frame(id, body) {
  const out = new Uint8Array(10 + body.length);
  out.set(latin1(id), 0);
  new DataView(out.buffer).setUint32(4, body.length);
  out.set(body, 10);
  return out;
}

const textFrame = (id, text) => {
  const [encoding, bytes] = encode(text);
  return frame(id, concat([Uint8Array.of(encoding), bytes]));
};

// 설명과 언어가 붙는 프레임(COMM 설명, USLT 가사). 설명은 비워 둔다. 윈도우 탐색기는 설명이 빈 COMM만 보여 준다
function languageFrame(id, text) {
  const [encoding, bytes] = encode(text);
  const emptyDescription = encoding === 1 ? Uint8Array.of(0xff, 0xfe, 0, 0) : Uint8Array.of(0);
  return frame(id, concat([Uint8Array.of(encoding), latin1("eng"), emptyDescription, bytes]));
}

// 그림(APIC): 인코딩(0) + MIME(끝 0) + 그림 종류(앞표지 3, 뒤표지 4, 그 밖 0) + 설명(빈 글, 끝 0) + 그림
function pictureFrame(image) {
  const type = image.kind === "coverFront" ? 3 : image.kind === "coverBack" ? 4 : 0;
  const mime = image.mimeType === "image/jpg" ? "image/jpeg" : image.mimeType || "image/jpeg";
  return frame("APIC", concat([Uint8Array.of(0), latin1(mime), Uint8Array.of(0, type, 0), image.data]));
}

// 태그 크기는 7비트씩 4바이트(syncsafe)로 적는다
const syncsafe = (n) => Uint8Array.of((n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127);

// fields: { title, subtitle, artist, album, albumArtist, composer, genre, year, track, disc, bpm, comment, lyrics, images }
// (모두 글이고 images만 [{ data, mimeType, kind }]). 빈 칸은 쓰지 않는다.
// padding: 태그 뒤에 남겨 둘 빈 바이트. 태그 프로그램이 나중에 태그를 고칠 때 파일 전체를 다시 쓰지 않게 한다
export function buildId3v23(fields, { padding = 1024 } = {}) {
  const frames = [];
  const text = (id, value) => value && frames.push(textFrame(id, String(value)));
  text("TIT2", fields.title);
  text("TIT3", fields.subtitle);
  text("TPE1", fields.artist);
  text("TALB", fields.album);
  text("TPE2", fields.albumArtist);
  text("TCOM", fields.composer);
  text("TCON", fields.genre);
  text("TYER", fields.year);
  text("TRCK", fields.track);
  text("TPOS", fields.disc);
  text("TBPM", fields.bpm);
  if (fields.comment) frames.push(languageFrame("COMM", fields.comment));
  if (fields.lyrics) frames.push(languageFrame("USLT", fields.lyrics));
  for (const image of fields.images ?? []) frames.push(pictureFrame(image));
  const body = concat([...frames, new Uint8Array(padding)]);
  return concat([latin1("ID3"), Uint8Array.of(3, 0, 0), syncsafe(body.length), body]);
}

// 맨 앞의 ID3v2 태그를 뗀다 (여러 개면 모두). 남은 것이 소리 조각이다
export function stripId3v2(bytes) {
  let at = 0;
  while (bytes.length >= at + 10 && bytes[at] === 0x49 && bytes[at + 1] === 0x44 && bytes[at + 2] === 0x33) {
    const size = (bytes[at + 6] << 21) | (bytes[at + 7] << 14) | (bytes[at + 8] << 7) | bytes[at + 9];
    const footer = bytes[at + 3] === 4 && bytes[at + 5] & 0x10 ? 10 : 0;
    at += 10 + size + footer;
  }
  return at ? bytes.subarray(at) : bytes;
}
