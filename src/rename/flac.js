// FLAC 파일의 태그를 화면의 칸으로 읽고, 고친 칸만 다시 적는다.
// 브라우저 API 가운데 Blob·TextDecoder·TextEncoder만 써서 Node에서 시험할 수 있다.
//
// FLAC 파일은 "fLaC" 네 글자 뒤에 정보 묶음(metadata block)들이 오고, 그 뒤가 소리다.
//   묶음 머리 4바이트: 마지막 묶음 표시(맨 위 1비트) + 종류(7비트) + 내용 길이(3바이트)
//   종류: 0 STREAMINFO(늘 맨 앞) · 1 PADDING(빈 채움) · 3 SEEKTABLE(찾아가기 표) · 4 VORBIS_COMMENT(글 태그) · 6 PICTURE(그림)
// 글 태그는 "이름=값"(UTF-8)을 늘어놓은 것이라 한글이 깨질 일이 없다.
// 찾아가기 표의 자리는 첫 소리 조각부터 센 것이라, 태그 길이가 바뀌어 소리가 뒤로 밀려도 고칠 것이 없다.
// 고치지 않은 묶음과 고치지 않은 "이름=값"은 바이트 그대로 두고, 소리는 원래 파일의 그 자리를 그대로 가리킨다.
import { ascii, be32, bytesOf, concat, fromAscii, imageSize, le32, replaceItems, u32be, u32le } from "./bytes.js";
import { id3v2Length } from "./id3.js";
import { emptyValues, JOIN, TAG_FIELDS } from "./tags.js";

const STREAMINFO = 0;
const PADDING = 1;
const COMMENTS = 4;
const PICTURE = 6;
// 묶음 하나의 내용은 길이를 3바이트로 적어 16MB가 한계다
const MAX_BLOCK = 0xffffff;

const NOT_FLAC = "FLAC 파일이 아닙니다.";
const BROKEN = "FLAC의 정보 묶음을 읽을 수 없습니다.";

// 칸마다 보는 이름들. 앞의 것이 흔히 쓰는 이름이고, 뒤의 것은 그렇게 적는 프로그램이 있어 함께 본다
const NAMES = {
  title: ["TITLE"],
  artist: ["ARTIST"],
  album: ["ALBUM"],
  albumArtist: ["ALBUMARTIST", "ALBUM ARTIST", "ALBUM_ARTIST"],
  track: ["TRACKNUMBER"],
  year: ["DATE", "YEAR"],
  genre: ["GENRE"],
  composer: ["COMPOSER"],
  // ffmpeg는 설명을 DESCRIPTION에 적는다
  comment: ["COMMENT", "DESCRIPTION"],
};
// 전체 곡 수를 따로 적는 이름들
const TOTALS = ["TRACKTOTAL", "TOTALTRACKS"];
// 그림을 글 태그 안에 넣어 둔 것 (FLAC에서는 드물다). 그림을 바꾸거나 지울 때 함께 뺀다
const PICTURE_NAMES = ["METADATA_BLOCK_PICTURE", "COVERART", "COVERARTMIME"];

// 글 태그 묶음의 내용: 만든 프로그램 이름(길이 4바이트 + 글) + 개수(4바이트) + 항목들(길이 4바이트 + "이름=값"). 수는 작은 자리부터 적는다.
// 결과: { vendor: 바이트, entries: [{ name: 대문자 이름("="이 없는 항목은 ""), value, raw: "이름=값" 바이트 }] }. 읽을 수 없으면 null
export function parseComments(body) {
  if (!body || body.length < 8) return null;
  const vendorLength = u32le(body, 0);
  let at = 4 + vendorLength;
  if (at + 4 > body.length) return null;
  const vendor = body.subarray(4, at);
  const count = u32le(body, at);
  at += 4;
  const decoder = new TextDecoder("utf-8");
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (at + 4 > body.length) return null;
    const length = u32le(body, at);
    at += 4;
    if (at + length > body.length) return null;
    const raw = body.subarray(at, at + length);
    at += length;
    const equals = raw.indexOf(0x3d);
    if (equals <= 0) entries.push({ name: "", value: "", raw });
    else entries.push({ name: ascii(raw, 0, equals).toUpperCase(), value: decoder.decode(raw.subarray(equals + 1)), raw });
  }
  return { vendor, entries };
}

export function buildComments(vendor, entries) {
  const parts = [le32(vendor.length), vendor, le32(entries.length)];
  for (const entry of entries) parts.push(le32(entry.raw.length), entry.raw);
  return concat(parts);
}

const entryOf = (name, value) => ({ name, value, raw: concat([fromAscii(`${name}=`), new TextEncoder().encode(value)]) });
const valuesOf = (entries, name) => entries.filter((entry) => entry.name === name).map((entry) => entry.value);
// names 가운데 이 파일이 쓰는 이름 (없으면 undefined)
const usedName = (entries, names) => names.find((name) => entries.some((entry) => entry.name === name));

// 글 태그 항목들을 화면의 칸으로 읽는다. 같은 이름이 여러 번 나오면 "; "로 이어 보인다
export function commentValues(entries) {
  const values = emptyValues();
  for (const [key, names] of Object.entries(NAMES)) {
    const name = usedName(entries, names);
    if (name) values[key] = valuesOf(entries, name).join(JOIN);
  }
  // 트랙 "3"과 따로 적힌 전체 곡 수 "12"를 "3/12"로 보인다
  const total = usedName(entries, TOTALS);
  if (values.track && !values.track.includes("/") && total) {
    const count = valuesOf(entries, total)[0];
    if (count) values.track += `/${count}`;
  }
  return values;
}

// 고친 칸을 글 태그 항목들에 적는다. edits: { title: "새 글", album: "" (비우기), … } 가운데 고칠 것만.
// 고치지 않은 항목은 그대로 두고(바이트까지), 고친 항목은 원래 있던 자리에 둔다
export function editComments(entries, edits) {
  let list = [...entries];
  for (const [key, names] of Object.entries(NAMES)) {
    const value = edits[key];
    if (value === undefined) continue;
    // 그 파일이 쓰던 이름으로 적는다 (없었으면 흔히 쓰는 이름)
    const name = usedName(list, names) ?? names[0];
    if (key === "track") {
      // 원래 "3/12"를 한 항목에 적던 파일은 그대로 한 항목에, 아니면 번호와 전체 곡 수를 따로 적는다
      const joined = valuesOf(list, name).some((text) => text.includes("/"));
      const slash = value.indexOf("/");
      const number = joined || slash < 0 ? value : value.slice(0, slash).trim();
      const count = joined || slash < 0 ? "" : value.slice(slash + 1).trim();
      const totals = TOTALS.filter((total) => list.some((entry) => entry.name === total));
      list = replaceItems(list, (entry) => entry.name === name, number ? [entryOf(name, number)] : []);
      list = replaceItems(list, (entry) => TOTALS.includes(entry.name), count ? (totals.length ? totals : [TOTALS[0]]).map((total) => entryOf(total, count)) : []);
    } else if (key === "comment") {
      // COMMENT와 DESCRIPTION은 뜻이 조금 달라 둘 다 있는 파일이 있다. 화면에 보이던 쪽만 고친다
      list = replaceItems(list, (entry) => entry.name === name, value ? [entryOf(name, value)] : []);
    } else {
      list = replaceItems(list, (entry) => names.includes(entry.name), value ? [entryOf(name, value)] : []);
    }
  }
  if (edits.picture !== undefined) list = list.filter((entry) => !PICTURE_NAMES.includes(entry.name));
  return list;
}

// 그림 묶음의 앞부분: 종류(4) + MIME 길이(4) + MIME + 설명 길이(4) + 설명 + 폭·높이·색 깊이·색 수(각 4) + 그림 길이(4) + 그림. 수는 큰 자리부터 적는다.
// 결과: { type: 그림 종류(3이 앞표지), mime, start: 묶음 내용 안에서 그림이 시작하는 자리, length } · 더 읽어야 알 수 있으면 { need: 읽을 바이트 수 }
function pictureHead(bytes) {
  if (bytes.length < 8) return { need: 8 };
  const mimeLength = u32be(bytes, 4);
  let at = 8 + mimeLength;
  if (bytes.length < at + 4) return { need: at + 4 };
  at += 4 + u32be(bytes, at);
  if (bytes.length < at + 20) return { need: at + 20 };
  return { type: u32be(bytes, 0), mime: ascii(bytes, 8, mimeLength), start: at + 20, length: u32be(bytes, at + 16) };
}

// 그림 묶음에서 그림의 자리를 읽는다. 결과: { type, mime, at: 파일 안에서 그림이 시작하는 자리, length } · 읽을 수 없거나 주소만 적힌 그림이면 null
async function readPicture(file, at, length) {
  let head = pictureHead(await bytesOf(file.slice(at, at + Math.min(length, 512))));
  if (head.need) {
    if (head.need > length) return null;
    head = pictureHead(await bytesOf(file.slice(at, at + head.need)));
  }
  // MIME이 "-->"이면 그림 대신 그림의 주소가 적혀 있다
  if (head.need || head.mime === "-->" || head.start + head.length > length) return null;
  return { type: head.type, mime: head.mime || "image/jpeg", at: at + head.start, length: head.length };
}

// 앞표지 그림 묶음의 내용
function pictureBlock(mime, data) {
  const type = mime || "image/jpeg";
  const size = imageSize(data);
  return concat([be32(3), be32(type.length), fromAscii(type), be32(0), be32(size.width), be32(size.height), be32(size.depth), be32(0), be32(data.length), data]);
}

// FLAC 파일(File이나 Blob)에서 정보 묶음들의 자리를 읽는다. 소리와 그림 데이터는 읽지 않는다.
// 결과: { why: 고칠 수 없는 까닭("" 이면 고칠 수 있다), prefix: "fLaC" 앞에 붙은 바이트 수(ID3v2),
//         blocks: [{ type, at: 내용이 시작하는 자리, length, comments(글 태그면), picture(그림이면) }], audioAt: 소리가 시작하는 자리 }
export async function readFlac(file) {
  // 맨 앞에 ID3v2 태그를 붙여 둔 파일이 있다 (FLAC 재생기는 건너뛴다). 그 뒤부터 본다
  const prefix = Math.min(id3v2Length(await bytesOf(file.slice(0, 10))), file.size);
  if (ascii(await bytesOf(file.slice(prefix, prefix + 4)), 0, 4) !== "fLaC") return { why: NOT_FLAC };
  const blocks = [];
  let at = prefix + 4;
  for (let last = false; !last; ) {
    const head = await bytesOf(file.slice(at, at + 4));
    if (head.length < 4 || blocks.length > 1000) return { why: BROKEN };
    last = Boolean(head[0] & 0x80);
    const block = { type: head[0] & 0x7f, at: at + 4, length: (head[1] << 16) | (head[2] << 8) | head[3] };
    if (block.type === 127 || block.at + block.length > file.size) return { why: BROKEN };
    if (block.type === COMMENTS) {
      block.comments = parseComments(await bytesOf(file.slice(block.at, block.at + block.length)));
      if (!block.comments) return { why: "FLAC의 글 태그를 읽을 수 없습니다." };
    }
    if (block.type === PICTURE) block.picture = await readPicture(file, block.at, block.length);
    blocks.push(block);
    at = block.at + block.length;
  }
  if (blocks[0].type !== STREAMINFO || blocks[0].length !== 34) return { why: BROKEN };
  // 소리 조각은 1111 1111 1111 10 비트로 시작한다. 아니면 묶음을 잘못 읽은 것이다
  const sync = await bytesOf(file.slice(at, at + 2));
  if (sync.length === 2 && !(sync[0] === 0xff && (sync[1] & 0xfc) === 0xf8)) return { why: BROKEN };
  return { why: "", prefix, blocks, audioAt: at };
}

// 읽은 것(readFlac의 결과)을 화면에 보일 태그로 바꾼다.
// 결과: { version, values, repaired, picture: 앞표지(없으면 첫 그림) { mime, at: 파일 안의 자리, length }, pictures: 그림 수 }
export function flacTags(source) {
  const comments = source.blocks.find((block) => block.type === COMMENTS)?.comments;
  const pictures = source.blocks.filter((block) => block.type === PICTURE && block.picture).map((block) => block.picture);
  const cover = pictures.find((item) => item.type === 3) ?? pictures[0] ?? null;
  return {
    version: "FLAC",
    values: comments ? commentValues(comments.entries) : emptyValues(),
    repaired: [],
    picture: cover && { mime: cover.mime, at: cover.at, length: cover.length },
    pictures: pictures.length,
  };
}

// 고친 칸을 적은 새 파일 내용(Blob)을 만든다.
//   edits: { title: "새 글", album: "" (비우기), …, picture: null (그림 지우기) | { mime, data } (앞표지로 넣기) } 가운데 고칠 것만
// 고치지 않은 묶음은 원래 파일의 그 자리를 그대로 가리킨다 (메모리에 올리지 않는다)
export async function rewriteFlac(file, edits) {
  const source = await readFlac(file);
  if (source.why) throw new Error(`${source.why} 고치지 않았습니다.`);
  const textEdited = TAG_FIELDS.some((field) => edits[field.key] !== undefined);
  const pictureEdited = edits.picture !== undefined;
  const keep = (block) => ({ type: block.type, body: file.slice(block.at, block.at + block.length), length: block.length });
  const made = (type, body) => ({ type, body, length: body.length });
  const newPicture = edits.picture ? made(PICTURE, pictureBlock(edits.picture.mime, edits.picture.data)) : null;
  let out = [];
  let hadComments = false;
  let hadPicture = false;
  for (const block of source.blocks) {
    if (block.type === COMMENTS && !hadComments) {
      hadComments = true;
      out.push(textEdited || pictureEdited ? made(COMMENTS, buildComments(block.comments.vendor, editComments(block.comments.entries, edits))) : keep(block));
    } else if (block.type === PICTURE && pictureEdited) {
      // 그림을 바꾸면 원래 있던 그림은 모두 빼고, 첫 그림이 있던 자리에 앞표지 하나를 넣는다
      if (!hadPicture && newPicture) out.push(newPicture);
      hadPicture = true;
    } else {
      out.push(keep(block));
    }
  }
  // 새로 만드는 묶음은 빈 채움(PADDING) 앞에 둔다
  const insert = (block) => {
    const padding = out.findIndex((item) => item.type === PADDING);
    out = padding < 0 ? [...out, block] : [...out.slice(0, padding), block, ...out.slice(padding)];
  };
  if (!hadComments && textEdited) {
    const entries = editComments([], edits);
    if (entries.length) insert(made(COMMENTS, buildComments(fromAscii("Playground"), entries)));
  }
  if (!hadPicture && newPicture) insert(newPicture);
  const parts = [file.slice(0, source.prefix + 4)];
  out.forEach((block, index) => {
    if (block.length > MAX_BLOCK) throw new Error(block.type === PICTURE ? "FLAC에는 16MB가 넘는 그림을 넣을 수 없습니다." : "FLAC의 태그가 16MB를 넘습니다.");
    const flag = index === out.length - 1 ? 0x80 : 0;
    parts.push(Uint8Array.of(flag | block.type, (block.length >>> 16) & 255, (block.length >>> 8) & 255, block.length & 255), block.body);
  });
  parts.push(file.slice(source.audioAt));
  return new Blob(parts, { type: file.type || "audio/flac" });
}
