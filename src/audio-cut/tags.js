// 화면에 보여 줄 태그(제목·아티스트·앨범·작곡가·앨범 아트)를 읽는다. 저장할 때는 태그를 고치지 않고 그대로 옮긴다(mp3.js·wav.js).
// MP3: 파일 앞의 ID3v2(2.2·2.3·2.4), WAV: LIST INFO 조각과 id3 조각. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));
const syncsafe = (bytes, at) => ((bytes[at] & 127) << 21) | ((bytes[at + 1] & 127) << 14) | ((bytes[at + 2] & 127) << 7) | (bytes[at + 3] & 127);
const u32 = (bytes, at) => ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;

// ID3 글자: 0 Latin-1, 1 UTF-16(BOM), 2 UTF-16BE, 3 UTF-8. 끝의 0은 뺀다
function decodeText(encoding, body) {
  let label = "latin1";
  if (encoding === 1) label = "utf-16";
  else if (encoding === 2) label = "utf-16be";
  else if (encoding === 3) label = "utf-8";
  try {
    return new TextDecoder(label).decode(body).replace(/\0+$/, "").split("\0")[0].trim();
  } catch {
    return "";
  }
}

// 그림 틀(APIC·PIC)에서 그림 데이터와 종류를 꺼낸다
function picture(id, body) {
  const encoding = body[0];
  let at = 1;
  let mimeType = "image/jpeg";
  if (id === "PIC") {
    mimeType = ascii(body, 1, 3).toUpperCase() === "PNG" ? "image/png" : "image/jpeg";
    at = 4;
  } else {
    const end = body.indexOf(0, 1);
    mimeType = ascii(body, 1, end - 1).toLowerCase() || "image/jpeg";
    if (!mimeType.includes("/")) mimeType = `image/${mimeType}`;
    at = end + 1;
  }
  const kind = body[at];
  at += 1;
  // 설명 글(인코딩에 따라 끝 표시가 0 하나 또는 둘)
  if (encoding === 1 || encoding === 2) {
    while (at + 1 < body.length && (body[at] !== 0 || body[at + 1] !== 0)) at += 2;
    at += 2;
  } else {
    while (at < body.length && body[at] !== 0) at++;
    at += 1;
  }
  return { kind, mimeType, data: body.slice(at) };
}

const FIELDS = { TIT2: "title", TT2: "title", TPE1: "artist", TP1: "artist", TALB: "album", TAL: "album", TCOM: "composer", TCM: "composer" };

// ID3v2 태그를 읽는다. { title, artist, album, composer, cover: { data, mimeType }, frames: 틀 수, version }. 없으면 null
export function readId3(bytes, start = 0) {
  if (bytes.length < start + 10 || ascii(bytes, start, 3) !== "ID3") return null;
  const version = bytes[start + 3];
  const flags = bytes[start + 5];
  const end = Math.min(bytes.length, start + 10 + syncsafe(bytes, start + 6));
  const tags = { title: "", artist: "", album: "", composer: "", cover: null, frames: 0, version: `2.${version}` };
  let at = start + 10;
  // 확장 머리는 건너뛴다
  if (flags & 0x40) at += version === 4 ? syncsafe(bytes, at) : u32(bytes, at) + 4;
  const idLength = version === 2 ? 3 : 4;
  const headLength = version === 2 ? 6 : 10;
  let covers = [];
  while (at + headLength <= end) {
    const id = ascii(bytes, at, idLength);
    if (!/^[A-Z0-9]{3,4}$/.test(id)) break; // 빈 채움(padding)에 닿았다
    let size;
    if (version === 2) size = (bytes[at + 3] << 16) | (bytes[at + 4] << 8) | bytes[at + 5];
    else if (version === 4) size = syncsafe(bytes, at + 4);
    else size = u32(bytes, at + 4);
    let body = bytes.subarray(at + headLength, Math.min(end, at + headLength + size));
    // 2.4: 틀 머리에 실제 길이가 따로 적힌 경우(data length indicator) 그 4바이트를 건너뛴다
    if (version === 4 && bytes[at + 9] & 1) body = body.subarray(4);
    tags.frames++;
    if (FIELDS[id] && !tags[FIELDS[id]]) tags[FIELDS[id]] = decodeText(body[0], body.subarray(1));
    if (id === "APIC" || id === "PIC") covers.push(picture(id, body));
    at += headLength + size;
  }
  // 앞표지(종류 3)를 먼저, 없으면 첫 그림
  covers = covers.filter((c) => c.data.length);
  const cover = covers.find((c) => c.kind === 3) ?? covers[0];
  if (cover) tags.cover = { data: cover.data, mimeType: cover.mimeType };
  return tags;
}

// WAV의 LIST INFO 조각(INAM 제목, IART 아티스트, IPRD 앨범)과 id3 조각을 읽는다. wav는 wav.js의 parseWav 결과
export function readWavTags(bytes, wav) {
  const tags = { title: "", artist: "", album: "", composer: "", cover: null, frames: 0 };
  for (const chunk of wav.chunks) {
    const body = bytes.subarray(chunk.at + 8, chunk.at + 8 + chunk.size);
    if (chunk.id === "LIST" && ascii(body, 0, 4) === "INFO") {
      let at = 4;
      while (at + 8 <= body.length) {
        const id = ascii(body, at, 4);
        const size = body[at + 4] | (body[at + 5] << 8) | (body[at + 6] << 16) | (body[at + 7] << 24);
        const text = new TextDecoder("utf-8").decode(body.subarray(at + 8, at + 8 + size)).replace(/\0+$/, "").trim();
        if (id === "INAM") tags.title ||= text;
        if (id === "IART") tags.artist ||= text;
        if (id === "IPRD") tags.album ||= text;
        tags.frames++;
        at += 8 + size + (size & 1);
      }
    }
    if (chunk.id.toLowerCase() === "id3 ") {
      const id3 = readId3(body);
      if (id3) {
        for (const key of ["title", "artist", "album", "composer"]) tags[key] ||= id3[key];
        tags.cover ??= id3.cover;
        tags.frames += id3.frames;
      }
    }
  }
  return tags;
}
