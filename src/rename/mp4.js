// M4A(MP4) 파일의 태그를 화면의 칸으로 읽고, 고친 칸만 다시 적는다.
// 브라우저 API 가운데 Blob·TextDecoder·TextEncoder만 써서 Node에서 시험할 수 있다.
//
// MP4는 상자(atom) 안에 상자가 든 모양이다. 상자 머리는 크기 4바이트 + 이름 4글자다
// (크기가 1이면 그 뒤 8바이트가 진짜 크기, 맨 바깥 상자의 크기가 0이면 파일 끝까지).
//   ftyp                파일 종류
//   moov                정보 (곡 길이, 소리 조각의 자리 표 …)
//     trak > mdia > minf > stbl
//       stco / co64     소리 덩어리마다 파일 안의 자리 (파일 맨 앞부터 센 바이트. stco는 32비트, co64는 64비트)
//     udta
//       meta            머리 뒤에 판·플래그 4바이트가 있다
//         hdlr          "mdir": 아이튠즈 방식 태그라는 표시
//         ilst          태그 항목들. 항목 하나 = 이름 상자(©nam 등) 안에 data 상자(값의 종류 4 + 지역 4 + 값)
//   mdat                소리
// 태그를 고치면 moov의 크기가 달라진다. moov가 mdat보다 앞에 있는 파일(받으면서 바로 재생하기 좋게 만든 것. 오디오 형식
// 바꾸기가 만든 M4A도 그렇다)은 소리가 그만큼 밀리므로, 자리 표의 값을 밀린 만큼 고친다. moov가 뒤에 있으면 고칠 것이 없다.
// 고치지 않은 항목과 다른 상자는 바이트 그대로 두고, 소리는 원래 파일의 그 자리를 그대로 가리킨다.
import { ascii, be32, bytesOf, concat, fromAscii, replaceItems, u16be, u32be } from "./bytes.js";
import { GENRES } from "./genres.js";
import { emptyValues, JOIN } from "./tags.js";

const NOT_MP4 = "M4A(MP4) 파일이 아닙니다.";
const BROKEN = "M4A의 구조를 읽을 수 없습니다.";
const FRAGMENTED = "조각으로 나뉜(fragmented) M4A입니다.";
const PROTECTED = "보호(DRM)가 걸린 M4A입니다.";
const OTHER_TAGS = "아이튠즈 방식이 아닌 태그가 들어 있습니다.";
const BAD_TRACK = "M4A의 트랙에는 숫자만 적을 수 있습니다 (3 또는 3/12).";
// moov는 통째로 읽는다. 이보다 크면 읽지 않는다
const MAX_MOOV = 256 * 1024 * 1024;
const EMPTY = new Uint8Array(0);

// 글로 적는 칸과 그 항목 이름. 트랙(trkn)·장르(©gen, gnre)·그림(covr)은 따로 다룬다
const TEXT_ITEMS = { title: "©nam", artist: "©ART", album: "©alb", albumArtist: "aART", year: "©day", composer: "©wrt", comment: "©cmt" };
const KEY_OF = Object.fromEntries(Object.entries(TEXT_ITEMS).map(([key, name]) => [name, key]));

// 바이트의 [start, end)를 상자들로 나눈다. 결과: [{ type, at, size, head: 머리 길이 }]. 딱 맞게 나뉘지 않으면 null
export function atomsIn(bytes, start, end) {
  const out = [];
  let at = start;
  while (at < end) {
    if (at + 8 > end) return null;
    let size = u32be(bytes, at);
    let head = 8;
    if (size === 1) {
      if (at + 16 > end) return null;
      size = u32be(bytes, at + 8) * 2 ** 32 + u32be(bytes, at + 12);
      head = 16;
    }
    if (size < head || at + size > end) return null;
    out.push({ type: ascii(bytes, at + 4, 4), at, size, head });
    at += size;
  }
  return out;
}

// 파일의 맨 바깥 상자들. 머리만 읽으며 건너간다. 파일 끝까지 딱 맞게 나뉘지 않으면 null
async function topAtoms(file) {
  const out = [];
  let at = 0;
  while (at < file.size) {
    const bytes = await bytesOf(file.slice(at, at + 16));
    if (bytes.length < 8 || out.length > 10000) return null;
    let size = u32be(bytes, 0);
    let head = 8;
    if (size === 1) {
      if (bytes.length < 16) return null;
      size = u32be(bytes, 8) * 2 ** 32 + u32be(bytes, 12);
      head = 16;
    } else if (size === 0) {
      size = file.size - at;
    }
    if (size < head || at + size > file.size) return null;
    out.push({ type: ascii(bytes, 4, 4), at, size, head });
    at += size;
  }
  return out;
}

// moov 안의 자리 표들(stco, co64)과 보호된 파일의 표(saio). 구조를 읽을 수 없으면 오류를 낸다
const TABLE_PATH = ["trak", "mdia", "minf", "stbl"];
function offsetTables(bytes, start, end, depth = 0) {
  const children = atomsIn(bytes, start, end);
  if (!children) throw new Error(BROKEN);
  const out = [];
  for (const child of children) {
    if (depth < TABLE_PATH.length) {
      if (child.type === TABLE_PATH[depth]) out.push(...offsetTables(bytes, child.at + child.head, child.at + child.size, depth + 1));
    } else if (["stco", "co64", "saio"].includes(child.type)) {
      out.push(child);
    }
  }
  return out;
}

// moov(머리부터)에서 태그가 있는 자리를 찾는다.
// 결과: { why: 고칠 수 없는 까닭 } · { why: "", children: moov 안의 상자들, udta, udtaChildren, udtaTail, meta, metaChildren, metaStart, ilst, items }
//   (없는 상자는 null, 그 안의 목록은 빈 배열)
export function parseMoov(bytes, head = 8) {
  const children = atomsIn(bytes, head, bytes.length);
  if (!children) return { why: BROKEN };
  if (children.some((child) => child.type === "mvex")) return { why: FRAGMENTED };
  if (children.some((child) => child.type === "cmov")) return { why: BROKEN };
  try {
    if (offsetTables(bytes, head, bytes.length).some((table) => table.type === "saio")) return { why: PROTECTED };
  } catch {
    return { why: BROKEN };
  }
  const out = { why: "", children, udta: null, udtaChildren: [], udtaTail: EMPTY, meta: null, metaChildren: [], metaStart: 0, ilst: null, items: [] };
  out.udta = children.find((child) => child.type === "udta") ?? null;
  if (!out.udta) return out;
  const udtaStart = out.udta.at + out.udta.head;
  const udtaEnd = out.udta.at + out.udta.size;
  let inside = atomsIn(bytes, udtaStart, udtaEnd);
  // 퀵타임은 udta 끝에 0 네 바이트를 두기도 한다
  if (!inside && udtaEnd - udtaStart >= 4 && u32be(bytes, udtaEnd - 4) === 0) {
    inside = atomsIn(bytes, udtaStart, udtaEnd - 4);
    out.udtaTail = bytes.subarray(udtaEnd - 4, udtaEnd);
  }
  if (!inside) return { why: BROKEN };
  out.udtaChildren = inside;
  out.meta = inside.find((child) => child.type === "meta") ?? null;
  if (!out.meta) return out;
  // meta는 머리 뒤에 판·플래그 4바이트가 있다 (퀵타임 방식은 없다). 안의 상자들이 딱 맞게 나뉘는 쪽으로 읽는다
  const metaStart = out.meta.at + out.meta.head;
  const metaEnd = out.meta.at + out.meta.size;
  const skip = [4, 0].find((bytesToSkip) => metaStart + bytesToSkip <= metaEnd && atomsIn(bytes, metaStart + bytesToSkip, metaEnd));
  if (skip === undefined) return { why: BROKEN };
  out.metaStart = metaStart + skip;
  out.metaChildren = atomsIn(bytes, out.metaStart, metaEnd);
  // hdlr: 판·플래그 4 + 0 4바이트 + 종류 4글자. 아이튠즈 방식(mdir)이 아니면 항목의 모양이 다르다
  const handler = out.metaChildren.find((child) => child.type === "hdlr");
  if (handler && handler.size >= handler.head + 12 && ascii(bytes, handler.at + handler.head + 8, 4) !== "mdir") return { why: OTHER_TAGS };
  out.ilst = out.metaChildren.find((child) => child.type === "ilst") ?? null;
  if (!out.ilst) return out;
  const items = atomsIn(bytes, out.ilst.at + out.ilst.head, out.ilst.at + out.ilst.size);
  if (!items) return { why: BROKEN };
  out.items = items;
  return out;
}

// 항목 안의 값들(data 상자).
// 결과: [{ kind: 값의 종류(1 UTF-8 글 · 2 UTF-16 글 · 13 JPG · 14 PNG · 0 그 밖), at: 값이 시작하는 자리, length }]
function dataOf(bytes, item) {
  const children = atomsIn(bytes, item.at + item.head, item.at + item.size) ?? [];
  return children
    .filter((child) => child.type === "data" && child.size >= child.head + 8)
    .map((child) => ({ kind: u32be(bytes, child.at + child.head) & 0xffffff, at: child.at + child.head + 8, length: child.size - child.head - 8 }));
}

function textOf(bytes, data) {
  let text = "";
  try {
    text = new TextDecoder(data.kind === 2 ? "utf-16be" : "utf-8").decode(bytes.subarray(data.at, data.at + data.length));
  } catch {
    return "";
  }
  // 글 끝에 0을 붙여 적은 파일이 있다
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 0) end--;
  return text.slice(0, end);
}

// 그림의 형식. 적힌 종류가 틀린 파일이 있어 첫 바이트들을 먼저 본다
function pictureMime(bytes, data) {
  const at = data.at;
  if (bytes[at] === 0xff && bytes[at + 1] === 0xd8) return "image/jpeg";
  if (bytes[at] === 0x89 && ascii(bytes, at + 1, 3) === "PNG") return "image/png";
  if (ascii(bytes, at, 3) === "GIF") return "image/gif";
  if (ascii(bytes, at, 2) === "BM") return "image/bmp";
  return { 13: "image/jpeg", 14: "image/png", 27: "image/bmp" }[data.kind] ?? "image/jpeg";
}

// 읽은 것(readMp4의 결과)을 화면에 보일 태그로 바꾼다.
// 결과: { version, values, repaired, picture: 첫 그림 { mime, at: 파일 안의 자리, length }, pictures: 그림 수 }
export function mp4Tags(source) {
  const { bytes, at: moovAt } = source.moov;
  const values = emptyValues();
  const pictures = [];
  let genreNumber = 0;
  for (const item of source.items) {
    const found = dataOf(bytes, item);
    if (!found.length) continue;
    const key = item.type === "©gen" ? "genre" : KEY_OF[item.type];
    if (key) {
      if (!values[key]) values[key] = found.map((data) => textOf(bytes, data)).filter(Boolean).join(JOIN);
    } else if (item.type === "trkn") {
      // 0 0 + 번호(2바이트) + 전체 곡 수(2바이트) + 0 0
      const { at, length } = found[0];
      const number = length >= 4 ? u16be(bytes, at + 2) : 0;
      const total = length >= 6 ? u16be(bytes, at + 4) : 0;
      if (number || total) values.track = total ? `${number}/${total}` : String(number);
    } else if (item.type === "gnre") {
      // 장르를 번호로 적은 것 (ID3v1 번호 + 1)
      if (found[0].length >= 2) genreNumber = u16be(bytes, found[0].at + found[0].length - 2);
    } else if (item.type === "covr") {
      for (const data of found) pictures.push({ mime: pictureMime(bytes, data), at: moovAt + data.at, length: data.length });
    }
  }
  if (!values.genre && genreNumber) values.genre = GENRES[genreNumber - 1] ?? "";
  return { version: "MP4", values, repaired: [], picture: pictures[0] ?? null, pictures: pictures.length };
}

// ---- 쓰기 ----

const atom = (type, ...parts) => {
  const body = concat(parts);
  return concat([be32(8 + body.length), fromAscii(type), body]);
};
const dataAtom = (kind, value) => atom("data", be32(kind), be32(0), value);
const textItem = (name, text) => atom(name, dataAtom(1, new TextEncoder().encode(text)));

function trackItem(text) {
  const match = /^\s*(\d+)\s*(?:\/\s*(\d+)\s*)?$/.exec(text);
  const number = match ? Number(match[1]) : -1;
  const total = match?.[2] ? Number(match[2]) : 0;
  if (number < 0 || number > 65535 || total > 65535) throw new Error(BAD_TRACK);
  return atom("trkn", dataAtom(0, Uint8Array.of(0, 0, number >> 8, number & 255, total >> 8, total & 255, 0, 0)));
}

const coverItem = (mime, data) => atom("covr", dataAtom(mime === "image/png" ? 14 : 13, data));

// 고친 칸을 태그 항목들에 적는다.
//   bytes: moov, items: 지금 항목들(parseMoov의 items)
//   edits: { title: "새 글", album: "" (비우기), …, picture: null (그림 지우기) | { mime, data } (앞표지로 넣기) } 가운데 고칠 것만
// 결과: 새 항목들의 바이트 목록. 고치지 않은 항목은 그대로 두고, 고친 항목은 원래 있던 자리에 둔다 (없던 항목은 끝에 붙인다)
export function editItems(bytes, items, edits) {
  let list = items.map((item) => ({ type: item.type, raw: bytes.subarray(item.at, item.at + item.size) }));
  const set = (types, made) => {
    list = replaceItems(list, (item) => types.includes(item.type), made ? [{ type: types[0], raw: made }] : []);
  };
  for (const [key, name] of Object.entries(TEXT_ITEMS)) {
    if (edits[key] !== undefined) set([name], edits[key] ? textItem(name, edits[key]) : null);
  }
  // 장르는 글(©gen)로 적는다. 번호로 적혀 있던 것(gnre)은 뺀다
  if (edits.genre !== undefined) set(["©gen", "gnre"], edits.genre ? textItem("©gen", edits.genre) : null);
  if (edits.track !== undefined) set(["trkn"], edits.track ? trackItem(edits.track) : null);
  if (edits.picture !== undefined) set(["covr"], edits.picture ? coverItem(edits.picture.mime, edits.picture.data) : null);
  return list.map((item) => item.raw);
}

// 아이튠즈 방식 태그라는 표시: 판·플래그 4 + 0 4 + "mdir" + "appl" + 0 9바이트
const HANDLER = atom("hdlr", new Uint8Array(8), fromAscii("mdirappl"), new Uint8Array(9));

// 새 항목들을 넣은 moov를 만든다. ilst·meta·udta가 없던 파일은 새로 만들어 끝에 붙인다
function rebuildMoov(source, items) {
  const { bytes } = source.moov;
  const raw = (child) => bytes.subarray(child.at, child.at + child.size);
  const swap = (children, old, made) => {
    const parts = children.map((child) => (child === old ? made : raw(child)));
    if (!old) parts.push(made);
    return parts;
  };
  const ilst = atom("ilst", ...items);
  const meta = source.meta
    ? atom("meta", bytes.subarray(source.meta.at + source.meta.head, source.metaStart), ...swap(source.metaChildren, source.ilst, ilst))
    : atom("meta", be32(0), HANDLER, ilst);
  const udta = atom("udta", ...swap(source.udtaChildren, source.meta, meta), source.udtaTail);
  return atom("moov", ...swap(source.children, source.udta, udta));
}

// moov(머리부터)의 자리 표에서 from 이상인 자리를 delta만큼 민다. moov 뒤에 있는 소리가 밀린 만큼이다
export function shiftOffsets(moov, from, delta) {
  if (!delta) return;
  for (const table of offsetTables(moov, 8, moov.length)) {
    const wide = table.type === "co64";
    const step = wide ? 8 : 4;
    const first = table.at + table.head + 8;
    const count = u32be(moov, table.at + table.head + 4);
    if (first + count * step > table.at + table.size) throw new Error(BROKEN);
    for (let i = 0; i < count; i++) {
      const at = first + i * step;
      const value = wide ? u32be(moov, at) * 2 ** 32 + u32be(moov, at + 4) : u32be(moov, at);
      if (value < from) continue;
      const moved = value + delta;
      if (moved < 0 || (!wide && moved > 0xffffffff)) throw new Error("파일이 4GB에 가까워 태그를 더 넣을 수 없습니다.");
      if (wide) moov.set(be32(Math.floor(moved / 2 ** 32)), at);
      moov.set(be32(moved % 2 ** 32), wide ? at + 4 : at);
    }
  }
}

// M4A 파일(File이나 Blob)에서 태그가 든 moov를 읽는다. 소리는 읽지 않는다.
// 결과: { why: 고칠 수 없는 까닭 } · { why: "", moov: { at, size, bytes }, …parseMoov의 결과 }
export async function readMp4(file) {
  if (ascii(await bytesOf(file.slice(4, 8)), 0, 4) !== "ftyp") return { why: NOT_MP4 };
  const top = await topAtoms(file);
  if (!top) return { why: BROKEN };
  if (top.some((item) => item.type === "moof")) return { why: FRAGMENTED };
  const moovs = top.filter((item) => item.type === "moov");
  if (moovs.length !== 1 || moovs[0].size > MAX_MOOV || !top.some((item) => item.type === "mdat")) return { why: BROKEN };
  const [moov] = moovs;
  const bytes = await bytesOf(file.slice(moov.at, moov.at + moov.size));
  const found = parseMoov(bytes, moov.head);
  return found.why ? { why: found.why } : { ...found, moov: { at: moov.at, size: moov.size, bytes } };
}

// 고친 칸을 적은 새 파일 내용(Blob)을 만든다. moov만 새로 만들고, 나머지는 원래 파일의 그 자리를 그대로 가리킨다
export async function rewriteMp4(file, edits) {
  const source = await readMp4(file);
  if (source.why) throw new Error(`${source.why} 고치지 않았습니다.`);
  const type = file.type || "audio/mp4";
  const items = editItems(source.moov.bytes, source.items, edits);
  // 태그가 없던 파일에서 없는 칸을 비우는 것뿐이면 그대로 둔다
  if (!source.ilst && !items.length) return file.slice(0, file.size, type);
  const moov = rebuildMoov(source, items);
  const end = source.moov.at + source.moov.size;
  shiftOffsets(moov, end, moov.length - source.moov.size);
  return new Blob([file.slice(0, source.moov.at), moov, file.slice(end)], { type });
}
