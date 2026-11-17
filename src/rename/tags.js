// MP3 태그를 화면의 칸(제목, 아티스트 …)으로 읽고, 고친 칸만 태그에 다시 적는다.
// 브라우저 API 가운데 Blob만 써서 Node에서 시험할 수 있다. 틀을 읽고 쓰는 일은 id3.js가 한다.
import { repairText } from "../shared/textRepair.js";
import { GENRES } from "./genres.js";
import {
  buildId3v2,
  commentFrame,
  commentParts,
  frameBody,
  id3v2Length,
  parseId3v1,
  parseId3v2,
  patchId3v1,
  pictureFrame,
  pictureParts,
  textFrame,
  textValues,
  upgradeFrames22,
  userTextParts,
} from "./id3.js";

// 화면에 보이는 칸과 그 칸을 담는 틀(2.3·2.4). 연도와 설명은 판이나 내용에 따라 틀이 달라 따로 다룬다
export const TAG_FIELDS = [
  { key: "title", label: "제목", frame: "TIT2" },
  { key: "artist", label: "아티스트", frame: "TPE1" },
  { key: "album", label: "앨범", frame: "TALB" },
  { key: "albumArtist", label: "앨범 아티스트", frame: "TPE2" },
  { key: "track", label: "트랙", frame: "TRCK" },
  { key: "year", label: "연도", frame: null },
  { key: "genre", label: "장르", frame: "TCON" },
  { key: "composer", label: "작곡가", frame: "TCOM" },
  { key: "comment", label: "설명", frame: null },
];

// 연도를 담는 틀. 2.3은 TYER, 2.4는 TDRC다. 판과 맞지 않는 쪽에 적은 파일도 있어 둘 다 본다
const yearFrames = (version) => (version === 4 ? ["TDRC", "TYER"] : ["TYER", "TDRC"]);
const framesOf = (field, version) => (field.key === "year" ? yearFrames(version) : [field.frame]);

// 값이 여러 개면 이 글자로 이어 보인다
const JOIN = "; ";

// 장르 칸의 번호 표기를 이름으로 푼다: "(13)" · "(13)Pop" · "13" → Pop, "(RX)" → Remix, "((글)" → (글)
function genreNames(values) {
  const out = [];
  const add = (name) => {
    if (name && !out.includes(name)) out.push(name);
  };
  const named = (ref) => (ref === "RX" ? "Remix" : ref === "CR" ? "Cover" : (GENRES[Number(ref)] ?? ""));
  for (const value of values) {
    let rest = value;
    for (;;) {
      if (rest.startsWith("((")) {
        rest = rest.slice(1);
        break;
      }
      const match = /^\((\d+|RX|CR)\)/.exec(rest);
      if (!match) break;
      add(named(match[1]) || match[0]);
      rest = rest.slice(match[0].length);
    }
    rest = rest.trim();
    add(/^(\d+|RX|CR)$/.test(rest) ? named(rest) || rest : rest);
  }
  return out;
}

// 장르 이름의 ID3v1 번호. 표에 없으면 255(없음)
const genreIndex = (name) => {
  const index = GENRES.findIndex((genre) => genre.toLowerCase() === name.trim().toLowerCase());
  return index < 0 ? 255 : index;
};

// 화면의 "설명" 칸으로 보는 틀이면 그 내용을 돌려준다.
//   - 설명이 빈 COMM: 태그 프로그램과 윈도우 탐색기가 쓰는 자리 (standard)
//   - 이름이 comment인 TXXX: ffmpeg가 설명을 적는 자리 (ffmpeg로 만든 파일, 그것을 쓰는 내려받기 프로그램)
// 설명이 붙은 COMM은 아이튠즈의 소리 크기·빈틈 정보 같은 것이라 건드리지 않는다
function commentOf(version, frame) {
  if (frame.id === "COMM") {
    const parts = commentParts(frameBody(version, frame)?.body);
    return parts && parts.description === "" ? { ...parts, standard: true } : null;
  }
  if (frame.id === "TXXX") {
    const parts = userTextParts(frameBody(version, frame)?.body);
    return parts && parts.description.toLowerCase() === "comment" ? { ...parts, standard: false } : null;
  }
  return null;
}

// 2.2는 2.3의 틀로 바꿔서 본다
const normalize = (parsed) =>
  parsed.version === 2 ? { version: 3, frames: upgradeFrames22(parsed.frames) } : { version: parsed.version, frames: parsed.frames };

// 태그를 화면의 칸으로 읽는다. parsed: parseId3v2의 결과(없으면 null), v1: parseId3v1의 결과(없으면 null).
// 결과: {
//   version: "ID3v2.3" 같은 이름("" 이면 태그 없음),
//   values: { title, artist, … } (없는 칸은 빈 글),
//   repaired: 깨진 한글을 바로잡아 보여 주는 칸들,
//   picture: 앞표지(없으면 첫 그림) { mime, at: 태그 안에서 그림이 시작하는 자리(-1이면 모름), length }, pictures: 그림 수,
// }
export function readTags(parsed, v1) {
  const values = Object.fromEntries(TAG_FIELDS.map((field) => [field.key, ""]));
  const repaired = [];
  // encoding이 0이면 바이트를 그대로 옮긴 글이라 한글이 깨져 있을 수 있다
  const fix = (key, texts, encoding) => {
    if (encoding !== 0) return texts;
    const fixed = texts.map(repairText);
    if (fixed.some((text, i) => text !== texts[i]) && !repaired.includes(key)) repaired.push(key);
    return fixed;
  };
  if (!parsed) {
    if (!v1) return { version: "", values, repaired, picture: null, pictures: 0 };
    for (const key of ["title", "artist", "album", "year", "comment", "track"]) values[key] = fix(key, [v1[key]], 0)[0];
    values.genre = GENRES[v1.genre] ?? "";
    return { version: "ID3v1", values, repaired, picture: null, pictures: 0 };
  }
  const { version, frames } = normalize(parsed);
  for (const field of TAG_FIELDS) {
    if (field.key === "comment") continue;
    const ids = framesOf(field, version);
    const frame = ids.map((id) => frames.find((item) => item.id === id)).find(Boolean);
    const body = frame && frameBody(version, frame)?.body;
    if (!body) continue;
    const found = textValues(body);
    const texts = fix(field.key, found.values, found.encoding);
    values[field.key] = (field.key === "genre" ? genreNames(texts) : texts).join(JOIN);
  }
  // 설명: COMM을 먼저 보고, 없으면 ffmpeg가 적은 TXXX를 본다
  const comments = frames.map((frame) => commentOf(version, frame)).filter(Boolean);
  const comment = comments.find((parts) => parts.standard) ?? comments[0];
  if (comment) values.comment = fix("comment", [comment.text], comment.encoding)[0];
  const pictures = [];
  for (const frame of frames) {
    if (frame.id !== "APIC") continue;
    const content = frameBody(version, frame);
    const parts = pictureParts(content?.body);
    if (parts) pictures.push({ mime: parts.mime, type: parts.type, at: content.at >= 0 ? content.at + parts.start : -1, length: parts.length });
  }
  const cover = pictures.find((item) => item.type === 3) ?? pictures[0] ?? null;
  return {
    version: `ID3v2.${parsed.version}`,
    values,
    repaired,
    picture: cover && { mime: cover.mime, at: cover.at, length: cover.length },
    pictures: pictures.length,
  };
}

// 고친 칸을 태그에 적는다.
//   parsed: 지금 태그(parseId3v2의 결과, 없으면 null), tail: 파일 끝의 ID3v1 128바이트(없으면 null)
//   edits: { title: "새 글", album: "" (비우기), …, picture: null (그림 지우기) | { mime, data } (앞표지로 넣기) } 가운데 고칠 것만
// 결과: { tag: 새 ID3v2 태그 바이트(틀이 하나도 안 남으면 빈 배열), tail: 새 ID3v1 바이트(없던 파일은 null) }
// 2.4 태그는 2.4로, 나머지(2.3, 2.2, 태그 없음)는 2.3으로 쓴다. 고치지 않은 틀은 바이트 그대로 둔다
export function applyTagEdits(parsed, tail, edits) {
  const source = parsed ? normalize(parsed) : { version: 3, frames: [] };
  const version = source.version;
  let frames = [...source.frames];
  const v1 = tail ? parseId3v1(tail) : null;
  const changes = { ...edits };
  // ID3v2가 없던 파일은 ID3v1에만 있던 값도 새 태그에 옮겨 적는다. ID3v2가 생기면 프로그램들이 ID3v1을 보지 않기 때문이다
  if (!parsed && v1) {
    const old = readTags(null, v1).values;
    for (const field of TAG_FIELDS) if (changes[field.key] === undefined && old[field.key]) changes[field.key] = old[field.key];
  }
  // match에 맞는 틀을 모두 빼고, 첫 번째가 있던 자리에 made를 넣는다 (그런 틀이 없었으면 끝에 붙인다). made가 없으면 빼기만 한다
  const replace = (match, made) => {
    const first = frames.findIndex(match);
    const kept = [];
    frames.forEach((frame, index) => {
      if (index === first && made) kept.push(made);
      if (!match(frame)) kept.push(frame);
    });
    if (first < 0 && made) kept.push(made);
    frames = kept;
  };
  for (const field of TAG_FIELDS) {
    const value = changes[field.key];
    if (value === undefined) continue;
    if (field.key === "comment") {
      // 설명으로 보던 틀을 모두 빼고 COMM 하나로 적는다 (언어는 원래 COMM의 것을 쓴다)
      const old = frames.map((frame) => commentOf(version, frame)).find((parts) => parts?.standard);
      replace((frame) => Boolean(commentOf(version, frame)), value ? commentFrame(version, value, old?.language) : null);
    } else {
      const ids = framesOf(field, version);
      replace((frame) => ids.includes(frame.id), value ? textFrame(version, ids[0], value) : null);
    }
  }
  if (changes.picture !== undefined) {
    replace((frame) => frame.id === "APIC", changes.picture ? pictureFrame(changes.picture.mime, changes.picture.data) : null);
  }
  let newTail = null;
  if (tail && v1) {
    // ID3v1의 같은 칸도 맞춘다. 고친 칸만 바꾸고 나머지는 그대로 둔다
    const patch = {};
    for (const key of ["title", "artist", "album", "year", "comment", "track"]) if (edits[key] !== undefined) patch[key] = edits[key];
    if (edits.genre !== undefined) patch.genre = genreIndex(edits.genre);
    newTail = Object.keys(patch).length ? patchId3v1(tail, patch) : tail.slice(tail.length - 128);
  }
  return { tag: buildId3v2(version, frames), tail: newTail };
}

const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

// 소리 데이터가 다른 형식(M4A, FLAC, OGG, WAV, WebM)으로 시작하는지. 확장자만 .mp3인 파일 앞에 태그를 붙이면 그 파일이 망가진다
function isForeign(bytes) {
  const text = String.fromCharCode(...bytes.subarray(0, 12));
  if (text.startsWith("fLaC") || text.startsWith("OggS") || text.startsWith("RIFF") || text.slice(4, 8) === "ftyp") return true;
  return bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}

// MP3 파일(File이나 Blob)에서 태그가 있는 자리만 읽는다. 소리 데이터는 읽지 않는다.
// 결과: { tagLength: 파일 앞의 ID3v2가 차지한 바이트(바로 뒤에 붙은 다른 ID3v2 태그까지), parsed, tail, unreadable }
//   unreadable: 태그가 있지만 읽을 수 없는 판이거나, 소리 데이터가 MP3가 아닌 다른 형식이다 (고치지 않는다)
export async function readMp3(file) {
  const first = Math.min(id3v2Length(await bytesOf(file.slice(0, 10))), file.size);
  const parsed = first ? parseId3v2(await bytesOf(file.slice(0, first))) : null;
  // 태그 바로 뒤에 ID3v2 태그가 또 붙은 파일이 있다. 프로그램들은 맨 앞 것을 읽으므로 뒤의 것은 저장할 때 뺀다
  let tagLength = first;
  for (let i = 0; i < 4 && first; i++) {
    const more = id3v2Length(await bytesOf(file.slice(tagLength, tagLength + 10)));
    if (!more || tagLength + more > file.size) break;
    tagLength += more;
  }
  const tail = file.size - tagLength >= 128 ? await bytesOf(file.slice(file.size - 128)) : null;
  const foreign = isForeign(await bytesOf(file.slice(tagLength, tagLength + 12)));
  return { tagLength, parsed, tail: tail && parseId3v1(tail) ? tail : null, unreadable: Boolean(first && !parsed) || foreign };
}

// 고친 칸을 적은 새 파일 내용(Blob)을 만든다. 소리 데이터는 원래 파일의 그 자리를 그대로 가리킨다 (메모리에 올리지 않는다)
export async function rewriteMp3(file, edits) {
  const source = await readMp3(file);
  if (source.unreadable) throw new Error("읽을 수 없는 태그이거나 MP3가 아닌 파일이라 고치지 않았습니다");
  const { tag, tail } = applyTagEdits(source.parsed, source.tail, edits);
  const parts = [tag, file.slice(source.tagLength, source.tail ? file.size - 128 : file.size)];
  if (tail) parts.push(tail);
  return new Blob(parts, { type: file.type || "audio/mpeg" });
}
