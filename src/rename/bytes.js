// 바이트를 읽고 쓰는 작은 도구들. FLAC·M4A·WAV 태그 코드(flac.js, mp4.js, wav.js)가 함께 쓴다.
// 브라우저 API 가운데 Blob만 써서 Node에서 시험할 수 있다.

// 파일(File·Blob)의 한 부분을 바이트로 읽는다
export const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// 바이트를 그대로 글자로 옮긴다 (이름 4글자 같은 것). 128 이상의 바이트는 그 번호의 글자가 된다
export function ascii(bytes, at, length) {
  let text = "";
  for (let i = 0; i < length; i++) text += String.fromCharCode(bytes[at + i]);
  return text;
}
export const fromAscii = (text) => Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 255);

// 큰 자리부터 적은 수(big endian)
export const u16be = (bytes, at) => (bytes[at] << 8) | bytes[at + 1];
export const u32be = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
export const be16 = (n) => Uint8Array.of((n >>> 8) & 255, n & 255);
export const be32 = (n) => Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

// 작은 자리부터 적은 수(little endian)
export const u32le = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
export const le32 = (n) => Uint8Array.of(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255);

// 바이트 조각들을 하나로 잇는다
export function concat(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

// 목록에서 match에 맞는 것을 모두 빼고, 첫 번째가 있던 자리에 made들을 넣는다 (그런 것이 없었으면 끝에 붙인다).
// made가 비어 있으면 빼기만 한다. 태그 항목을 고칠 때 다른 항목의 순서를 그대로 두려고 쓴다
export function replaceItems(list, match, made) {
  const first = list.findIndex(match);
  const kept = [];
  list.forEach((item, index) => {
    if (index === first) kept.push(...made);
    if (!match(item)) kept.push(item);
  });
  if (first < 0) kept.push(...made);
  return kept;
}

// 그림 데이터의 머리에서 크기와 색 깊이를 읽는다 (JPG·PNG). 모르면 0으로 둔다.
// 결과: { width, height, depth: 화소 하나의 비트 수 }
export function imageSize(data) {
  const unknown = { width: 0, height: 0, depth: 0 };
  if (data.length > 26 && data[0] === 0x89 && ascii(data, 1, 3) === "PNG" && ascii(data, 12, 4) === "IHDR") {
    const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[data[25]] ?? 3;
    return { width: u32be(data, 16), height: u32be(data, 20), depth: data[24] * channels };
  }
  if (data[0] !== 0xff || data[1] !== 0xd8) return unknown;
  // JPG: 조각(marker)을 건너가며 그림 크기가 든 조각(SOF)을 찾는다
  let at = 2;
  while (at + 9 < data.length) {
    if (data[at] !== 0xff) return unknown;
    const marker = data[at + 1];
    if (marker === 0xff) {
      at += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    const isSize = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSize) return { width: u16be(data, at + 7), height: u16be(data, at + 5), depth: data[at + 4] * data[at + 9] };
    at += 2 + u16be(data, at + 2);
  }
  return unknown;
}
