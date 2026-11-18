// 그림 파일 머리를 읽는다: 보이는 크기(JPG의 회전 정보까지 따진다), 색 정보 조각.
// 자른 그림을 브라우저 인코더로 만들면 원본의 색 정보(아이폰 스크린샷의 Display P3 등)가 빠진다.
// 그래서 원본 화소를 색 변환 없이 풀어 자르고, 원본의 색 정보 조각을 결과에 옮겨 넣는다. 그러면 PNG는 자른 곳 말고는
// 화소와 색 정보가 원본과 같다 (크롬 157: PNG에는 색 정보 조각을 쓰지 않고, JPG에는 sRGB 정보(APP2)를 넣는다).
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다. read(start, end)는 파일의 그 범위 바이트(Uint8Array)를 돌려준다

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// 옮겨 넣을 PNG 조각: 색 정보(iCCP·sRGB·gAMA·cHRM·cICP)와 인쇄 해상도(pHYs).
// 회전 정보(eXIf)는 옮기지 않는다. 자를 때 이미 돌려 놓았다
const PNG_KEEP = new Set(["iCCP", "sRGB", "gAMA", "cHRM", "cICP", "pHYs"]);
const ICC_ID = [73, 67, 67, 95, 80, 82, 79, 70, 73, 76, 69, 0]; // "ICC_PROFILE\0"
const EXIF_ID = [69, 120, 105, 102, 0, 0]; // "Exif\0\0"

const typeOf = (bytes, at) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
const startsWith = (bytes, at, id) => id.every((value, i) => bytes[at + i] === value);

export const isPngBytes = (head) => head.length >= 8 && PNG_SIGNATURE.every((value, i) => head[i] === value);
export const isJpegBytes = (head) => head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;

// PNG 조각들을 그림 데이터(IDAT) 앞까지 돈다: [{ type, at, length }]
async function pngChunks(read) {
  const chunks = [];
  for (let at = 8, count = 0; count < 500; count++) {
    const head = await read(at, at + 8);
    if (head.length < 8) break;
    const type = typeOf(head, 4);
    const length = u32(head, 0);
    if (type === "IDAT" || type === "IEND") break;
    chunks.push({ type, at, length });
    at += 12 + length;
  }
  return chunks;
}

// JPG 조각들을 그림 데이터(SOS) 앞까지 돈다: [{ marker, at, length }] (length는 표시 2바이트 뒤의 길이 칸 값)
async function jpegSegments(read) {
  const segments = [];
  for (let at = 2, count = 0; count < 500; count++) {
    const head = await read(at, at + 4);
    if (head.length < 4 || head[0] !== 0xff) break;
    const marker = head[1];
    if (marker === 0xff) {
      at += 1; // 채움 바이트
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break;
    const length = (head[2] << 8) | head[3];
    segments.push({ marker, at, length });
    at += 2 + length;
  }
  return segments;
}

// JPG의 회전 정보(EXIF Orientation, 1~8). 없으면 1
async function jpegOrientation(read, segments) {
  for (const { marker, at, length } of segments) {
    if (marker !== 0xe1 || length < 16) continue;
    const body = await read(at + 4, at + 2 + length);
    if (!startsWith(body, 0, EXIF_ID)) continue;
    const tiff = 6;
    const little = body[tiff] === 0x49;
    const u16 = (i) => (little ? body[i] | (body[i + 1] << 8) : (body[i] << 8) | body[i + 1]);
    const u32le = (i) => (little ? (body[i] | (body[i + 1] << 8) | (body[i + 2] << 16) | (body[i + 3] << 24)) >>> 0 : u32(body, i));
    const ifd = tiff + u32le(tiff + 4);
    if (ifd + 2 > body.length) return 1;
    const count = u16(ifd);
    for (let k = 0; k < count; k++) {
      const entry = ifd + 2 + k * 12;
      if (entry + 12 > body.length) break;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 1;
      }
    }
    return 1;
  }
  return 1;
}

// 보이는 크기 { width, height }. JPG는 회전 정보가 5~8(옆으로 누운 사진)이면 폭과 높이를 바꾼다.
// PNG·JPG가 아니면(WebP 등) null이라 그림을 열어 크기를 본다
export async function imageSize(read) {
  const head = await read(0, 33);
  if (isPngBytes(head)) {
    if (typeOf(head, 12) !== "IHDR") return null;
    return { width: u32(head, 16), height: u32(head, 20) };
  }
  if (!isJpegBytes(head)) return null;
  const segments = await jpegSegments(read);
  for (const { marker, at } of segments) {
    // SOF0~SOF15 가운데 C4(DHT)·C8(JPG)·CC(DAC)는 크기 조각이 아니다
    if (marker < 0xc0 || marker > 0xcf || marker === 0xc4 || marker === 0xc8 || marker === 0xcc) continue;
    const sof = await read(at + 4, at + 9);
    if (sof.length < 5) return null;
    const height = (sof[1] << 8) | sof[2];
    const width = (sof[3] << 8) | sof[4];
    return (await jpegOrientation(read, segments)) >= 5 ? { width: height, height: width } : { width, height };
  }
  return null;
}

// 원본 PNG에서 옮겨 넣을 조각들(조각 통째, 길이·이름·CRC 포함)
export async function pngColorChunks(read) {
  const head = await read(0, 8);
  if (!isPngBytes(head)) return [];
  const kept = [];
  for (const { type, at, length } of await pngChunks(read)) {
    if (PNG_KEEP.has(type)) kept.push(await read(at, at + 12 + length));
  }
  return kept;
}

// 원본 JPG의 색 정보(APP2 ICC_PROFILE) 조각들. 큰 정보는 여러 조각으로 나뉘어 있다
export async function jpegIccSegments(read) {
  const head = await read(0, 3);
  if (!isJpegBytes(head)) return [];
  const kept = [];
  for (const { marker, at, length } of await jpegSegments(read)) {
    if (marker !== 0xe2) continue;
    const segment = await read(at, at + 2 + length);
    if (startsWith(segment, 4, ICC_ID)) kept.push(segment);
  }
  return kept;
}

const join = (parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

// 브라우저가 만든 PNG(bytes)에 원본의 조각들을 넣는다. 머리(IHDR) 바로 뒤에 넣고, 같은 종류의 조각이 있으면 뺀다
export function withPngChunks(bytes, chunks) {
  if (!chunks.length || !isPngBytes(bytes) || typeOf(bytes, 12) !== "IHDR") return bytes;
  const parts = [bytes.subarray(0, 33)];
  const types = new Set(chunks.map((chunk) => typeOf(chunk, 4)));
  parts.push(...chunks);
  let at = 33;
  while (at + 12 <= bytes.length) {
    const length = u32(bytes, at);
    const type = typeOf(bytes, at + 4);
    const end = at + 12 + length;
    if (!types.has(type)) parts.push(bytes.subarray(at, end));
    at = end;
    if (type === "IEND") break;
  }
  return join(parts);
}

// 브라우저가 만든 JPG(bytes)의 색 정보(APP2 ICC_PROFILE)를 원본의 것으로 바꾼다. 원본에 없으면 그대로 둔다
export function withJpegIcc(bytes, segments) {
  if (!segments.length || !isJpegBytes(bytes)) return bytes;
  const head = [bytes.subarray(0, 2)];
  let at = 2;
  let inserted = false;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda) break;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const end = at + 2 + length;
    const isIcc = marker === 0xe2 && startsWith(bytes, at + 4, ICC_ID);
    // JFIF(APP0) 뒤, 다른 조각들 앞에 넣는다
    if (!inserted && marker !== 0xe0) {
      head.push(...segments);
      inserted = true;
    }
    if (!isIcc) head.push(bytes.subarray(at, end));
    at = end;
  }
  if (!inserted) head.push(...segments);
  return join([...head, bytes.subarray(at)]);
}
