// 이 사이트가 만든 그림 파일에 넣는 보이지 않는 표시.
// 사진 세로로 붙이기는 결과를 고른 폴더에 저장한다. 붙일 말을 비우면 결과 이름이 폴더 이름과 같아서(제주.jpg),
// 이름만으로는 그 폴더에 원래 있던 사진과 이 화면이 전에 만든 결과를 가릴 수 없다. 그래서 만든 그림에 표시를 넣고,
// 표시가 있는 파일만 지난 결과로 본다 (붙일 사진에서 빼고, 다시 만들 때 덮어쓴다).
// PNG에는 글 조각(tEXt, Software), JPG에는 주석 조각(COM)으로 넣는다. 화소는 건드리지 않는다.
// Blob만 써서 Node에서도 돈다.

const TEXT = "playground-stitch";
// 표시를 찾을 때 파일 앞에서 읽는 양. 표시는 파일 머리 바로 뒤에 넣으므로 이만큼이면 넉넉하다
const HEAD_BYTES = 1024;

const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// PNG 글 조각의 데이터: 이름 + 0 + 글
const PNG_TEXT = Uint8Array.from([...ascii("Software"), 0, ...ascii(TEXT)]);
const JPG_TEXT = ascii(TEXT);
// PNG 머리: 시그니처 8바이트 + IHDR 조각 25바이트(길이 4 + 종류 4 + 데이터 13 + CRC 4)
const PNG_HEAD = 33;

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

const matches = (bytes, at, expected) => expected.every((value, i) => bytes[at + i] === value);
const isPng = (bytes) => matches(bytes, 0, PNG_SIGNATURE);
const isJpg = (bytes) => bytes[0] === 0xff && bytes[1] === 0xd8;
const typeAt = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

// PNG 조각: 길이(4) + 종류(4) + 데이터 + CRC(종류와 데이터의 검사값)
function pngTextChunk() {
  const out = new Uint8Array(12 + PNG_TEXT.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, PNG_TEXT.length);
  out.set(ascii("tEXt"), 4);
  out.set(PNG_TEXT, 8);
  view.setUint32(8 + PNG_TEXT.length, crc32(out.subarray(4, 8 + PNG_TEXT.length)));
  return out;
}

// JPG 주석 조각: FF FE + 길이(2, 길이 자신을 포함) + 글
function jpgComment() {
  const out = new Uint8Array(4 + JPG_TEXT.length);
  out[0] = 0xff;
  out[1] = 0xfe;
  new DataView(out.buffer).setUint16(2, JPG_TEXT.length + 2);
  out.set(JPG_TEXT, 4);
  return out;
}

// 그림 파일(Blob·File) 앞쪽에 표시가 있는지 본다. PNG·JPG가 아니거나 읽지 못하는 모양이면 false
export async function hasMark(blob) {
  const bytes = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  if (isPng(bytes)) {
    const view = new DataView(bytes.buffer);
    // 조각을 차례로 본다. 그림 데이터(IDAT)가 시작되면 그만 본다
    for (let at = 8; at + 8 <= bytes.length; ) {
      const length = view.getUint32(at);
      const type = typeAt(bytes, at + 4);
      if (type === "IDAT") return false;
      if (type === "tEXt" && length === PNG_TEXT.length && matches(bytes, at + 8, PNG_TEXT)) return true;
      at += 12 + length;
    }
    return false;
  }
  if (isJpg(bytes)) {
    // 조각을 차례로 본다: FF + 종류 + 길이(2). 그림 데이터(SOS, FF DA)가 시작되면 그만 본다
    for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff; ) {
      const kind = bytes[at + 1];
      if (kind === 0xda) return false;
      const length = (bytes[at + 2] << 8) | bytes[at + 3];
      if (kind === 0xfe && length === JPG_TEXT.length + 2 && matches(bytes, at + 4, JPG_TEXT)) return true;
      at += 2 + length;
    }
  }
  return false;
}

// 다 만든 그림(Blob)에 표시를 넣은 새 Blob을 돌려준다. 그림 데이터는 복사하지 않고 그대로 가리킨다.
// PNG·JPG가 아니거나 이미 표시가 있으면 받은 것을 그대로 돌려준다
export async function addMark(blob) {
  const head = new Uint8Array(await blob.slice(0, PNG_HEAD).arrayBuffer());
  let at = 0;
  let piece = null;
  if (isPng(head) && head.length === PNG_HEAD && typeAt(head, 12) === "IHDR") {
    // 머리(IHDR) 바로 뒤에 넣는다
    at = PNG_HEAD;
    piece = pngTextChunk();
  } else if (isJpg(head) && head.length >= 6) {
    // 첫 머리 조각(JFIF의 APP0, Exif의 APP1)은 파일 맨 앞에 있어야 해서 그 뒤에 넣는다. 없으면 시작 표시(SOI) 바로 뒤에 넣는다
    at = head[2] === 0xff && (head[3] & 0xf0) === 0xe0 ? 4 + ((head[4] << 8) | head[5]) : 2;
    piece = jpgComment();
  }
  if (!piece || (await hasMark(blob))) return blob;
  return new Blob([blob.slice(0, at), piece, blob.slice(at)], { type: blob.type });
}
