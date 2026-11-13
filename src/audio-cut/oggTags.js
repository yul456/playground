// Ogg 파일(Vorbis·Opus)의 태그 칸(두 번째 패킷)을 읽고 고친다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// Mediabunny(1.62)는 OGG Vorbis를 쓸 때 태그 칸(comment header) 끝의 표시 1바이트(framing bit)를 빠뜨린다.
// FFmpeg는 그 1바이트를 빼고 읽어 마지막 태그를 버리고, libvorbis는 이 칸이 틀렸다며 파일을 거부한다.
// 그래서 잘라 낸 OGG Vorbis에는 그 1바이트를 채워 넣는다(fixVorbisFraming).

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
const u32le = (bytes, at) => (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;

// 첫 스트림의 앞 패킷 두 개를 꺼낸다 (Ogg 쪽(page)의 조각 표(lacing)를 따라 잇는다)
function firstPackets(bytes, wanted = 2) {
  const packets = [];
  let parts = [];
  let at = 0;
  while (at + 27 <= bytes.length && packets.length < wanted) {
    if (ascii(bytes, at, 4) !== "OggS") return null;
    const segments = bytes[at + 26];
    let body = at + 27 + segments;
    for (let i = 0; i < segments && packets.length < wanted; i++) {
      const lace = bytes[at + 27 + i];
      parts.push(bytes.subarray(body, body + lace));
      body += lace;
      if (lace < 255) {
        const size = parts.reduce((sum, part) => sum + part.length, 0);
        const packet = new Uint8Array(size);
        let offset = 0;
        for (const part of parts) {
          packet.set(part, offset);
          offset += part.length;
        }
        packets.push(packet);
        parts = [];
      }
    }
    let pageSize = 27 + segments;
    for (let i = 0; i < segments; i++) pageSize += bytes[at + 27 + i];
    at += pageSize;
  }
  return packets.length === wanted ? packets : null;
}

// 태그 이름들(소문자). Ogg가 아니거나 태그 칸을 찾지 못하면 null
export function readOggTagNames(bytes) {
  const packets = firstPackets(bytes);
  if (!packets) return null;
  const packet = packets[1];
  let at;
  if (packet[0] === 3 && ascii(packet, 1, 6) === "vorbis") at = 7;
  else if (ascii(packet, 0, 8) === "OpusTags") at = 8;
  else return null;
  if (at + 4 > packet.length) return [];
  at += 4 + u32le(packet, at); // 만든 프로그램 이름
  if (at + 4 > packet.length) return [];
  const count = u32le(packet, at);
  at += 4;
  const names = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > packet.length) break;
    const length = u32le(packet, at);
    at += 4;
    if (at + length > packet.length) break;
    const text = new TextDecoder("utf-8").decode(packet.subarray(at, at + length));
    names.push(text.split("=")[0].toLowerCase());
    at += length;
  }
  return names;
}

// Ogg 쪽(page)의 CRC (다항식 0x04C11DB7, 처음 값 0)
const OGG_CRC = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1;
    table[i] = r >>> 0;
  }
  return table;
})();
export function oggCrc(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) crc = ((crc << 8) ^ OGG_CRC[((crc >>> 24) ^ bytes[i]) & 255]) >>> 0;
  return crc;
}

// Vorbis 태그 칸이 표시 1바이트 없이 끝나면 채워 넣은 새 파일을, 고칠 것이 없으면 받은 그대로 돌려준다.
// 태그 칸이 끝나는 쪽(page)만 다시 만들고(조각 표 한 칸 +1, CRC 다시 계산) 나머지는 그대로 둔다
export function fixVorbisFraming(bytes) {
  // 태그 칸(두 번째 패킷)이 끝나는 쪽과 그 조각 번호, 패킷 내용을 찾는다
  let at = 0;
  let packetIndex = 0;
  let parts = [];
  while (at + 27 <= bytes.length) {
    if (ascii(bytes, at, 4) !== "OggS") return bytes;
    const segments = bytes[at + 26];
    let body = at + 27 + segments;
    for (let i = 0; i < segments; i++) {
      const lace = bytes[at + 27 + i];
      if (packetIndex === 1) parts.push(bytes.subarray(body, body + lace));
      body += lace;
      if (lace < 255) {
        if (packetIndex === 1) return addFramingBit(bytes, at, i, body, parts);
        packetIndex++;
        parts = [];
      }
    }
    let pageSize = 27 + segments;
    for (let i = 0; i < segments; i++) pageSize += bytes[at + 27 + i];
    at += pageSize;
  }
  return bytes;
}

// pageAt 쪽의 segment번째 조각에서 끝나는 태그 칸(parts)에 표시 1바이트가 없으면 넣는다. packetEnd는 그 패킷이 끝나는 자리
function addFramingBit(bytes, pageAt, segment, packetEnd, parts) {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const packet = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    packet.set(part, offset);
    offset += part.length;
  }
  if (packet[0] !== 3 || ascii(packet, 1, 6) !== "vorbis") return bytes;
  // 태그를 끝까지 읽은 자리 (만든 프로그램 이름, 태그 수, 태그들)
  let p = 7;
  if (p + 4 > size) return bytes;
  p += 4 + u32le(packet, p);
  if (p + 4 > size) return bytes;
  const count = u32le(packet, p);
  p += 4;
  for (let i = 0; i < count; i++) {
    if (p + 4 > size) return bytes;
    p += 4 + u32le(packet, p);
  }
  if (p > size) return bytes;
  if (p < size && packet[p] & 1) return bytes; // 표시가 있다
  if (p < size) return bytes; // 표시 자리에 다른 값이 있으면 건드리지 않는다
  const segments = bytes[pageAt + 26];
  const lace = bytes[pageAt + 27 + segment];
  if (lace >= 254) return bytes; // 조각을 하나 더 만들어야 하는 드문 경우는 그대로 둔다
  let pageSize = 27 + segments;
  for (let i = 0; i < segments; i++) pageSize += bytes[pageAt + 27 + i];
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes.subarray(0, packetEnd));
  out[packetEnd] = 1;
  out.set(bytes.subarray(packetEnd), packetEnd + 1);
  out[pageAt + 27 + segment] = lace + 1;
  // 이 쪽의 CRC를 다시 계산한다 (CRC 칸을 0으로 두고 쪽 전체에 대해)
  out.fill(0, pageAt + 22, pageAt + 26);
  const crc = oggCrc(out.subarray(pageAt, pageAt + pageSize + 1));
  out[pageAt + 22] = crc & 255;
  out[pageAt + 23] = (crc >>> 8) & 255;
  out[pageAt + 24] = (crc >>> 16) & 255;
  out[pageAt + 25] = crc >>> 24;
  return out;
}
