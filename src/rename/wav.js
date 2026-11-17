// WAV 파일의 태그를 화면의 칸으로 읽고, 고친 칸만 다시 적는다.
// 브라우저 API 가운데 Blob·TextDecoder·TextEncoder만 써서 Node에서 시험할 수 있다.
//
// WAV(RIFF)는 "RIFF" + 크기 4바이트 + "WAVE" 뒤에 조각(chunk)들이 온다.
// 조각 = 이름 4글자 + 크기 4바이트(작은 자리부터) + 내용. 내용이 홀수 바이트면 0 한 바이트를 덧붙여 짝수로 맞춘다.
//   fmt         소리 형식
//   data        소리
//   LIST(INFO)  WAV의 원래 태그 칸. 이름 4글자(INAM 제목, IART 아티스트 …) + 글.
//               글자 방식(인코딩)이 정해져 있지 않고, 작곡가·앨범 아티스트·그림을 담지 못한다
//   id3 (ID3 )  MP3와 같은 ID3v2 태그를 통째로 넣은 조각. 한글과 모든 칸, 앨범 아트를 온전히 담는다
//               (오디오 형식 바꾸기가 만든 WAV에도 이 조각이 있다)
// 프로그램마다 읽는 곳이 달라서 두 곳을 함께 맞춘다. 모든 칸은 ID3 조각에 적고,
// INFO가 담을 수 있는 칸(제목·아티스트·앨범·트랙·연도·장르·설명)은 INFO에도 적는다.
// 다만 INFO에는 어느 프로그램에서나 같게 읽히는 영문·숫자 값만 적는다. 한글 같은 글자는 읽는 프로그램이 어떤 방식으로
// 풀지 알 수 없어 깨져 보일 수 있으므로 그 칸을 INFO에서 빼고 ID3 조각에만 둔다 (오디오 형식 바꾸기가 만든 WAV도 그렇다).
// 원래 INFO에 한글이 적혀 있던 파일만 그 파일이 쓰던 방식(UTF-8이나 EUC-KR)으로 적는다.
// 고치지 않은 조각은 바이트 그대로 두고, 소리는 원래 파일의 그 자리를 그대로 가리킨다.
import { repairText } from "../shared/textRepair.js";
import { ascii, bytesOf, concat, fromAscii, le32, replaceItems, u32le } from "./bytes.js";
import { id3v2Length, legacyText, parseId3v2 } from "./id3.js";
import { applyTagEdits, emptyValues, readTags, TAG_FIELDS } from "./tags.js";

const NOT_WAV = "WAV 파일이 아닙니다.";
const TOO_BIG = "4GB가 넘는 WAV(RF64)입니다.";
const BROKEN = "WAV의 조각을 읽을 수 없습니다.";
const BAD_INFO = "WAV의 태그 칸(INFO)을 읽을 수 없습니다.";
const BAD_ID3 = "WAV에 든 ID3 태그를 읽을 수 없습니다.";

// INFO가 담는 칸과 그 이름. 트랙은 ITRK가 흔하고 ffmpeg는 IPRT에 적는다
const INFO_IDS = { title: ["INAM"], artist: ["IART"], album: ["IPRD"], track: ["ITRK", "IPRT"], year: ["ICRD"], genre: ["IGNR"], comment: ["ICMT"] };

const isId3 = (chunk) => chunk.id.toLowerCase() === "id3 ";
const isInfo = (chunk) => chunk.id === "LIST" && chunk.list === "INFO";

// LIST 조각의 "INFO" 뒤 내용을 항목들로 나눈다.
// 결과: [{ id, text: 글의 바이트(끝의 0은 뺀다), whole: 그 항목 전체(이름·크기 포함) }]. 읽을 수 없으면 null
export function parseInfo(body) {
  const out = [];
  let at = 0;
  while (at + 8 <= body.length) {
    const size = u32le(body, at + 4);
    const end = at + 8 + size;
    if (end > body.length) return null;
    let stop = at + 8;
    while (stop < end && body[stop] !== 0) stop++;
    const next = Math.min(body.length, end + (size & 1));
    out.push({ id: ascii(body, at, 4), text: body.subarray(at + 8, stop), whole: body.subarray(at, next) });
    at = next;
  }
  return out;
}

const hasHigh = (bytes) => bytes.some((byte) => byte > 127);
const latin = (bytes) => ascii(bytes, 0, bytes.length);

// INFO의 글을 읽는다. 글자 방식이 적혀 있지 않아서 UTF-8로 읽어 보고, 안 되면 EUC-KR로 읽어 한글이 나올 때 그것을 쓴다
const infoText = (bytes) => repairText(latin(bytes));

// 이 파일의 INFO가 쓰는 글자 방식: "utf-8" · "euc-kr" · "latin1"(서유럽 글자) · ""(영문뿐이라 알 수 없다)
function infoEncoding(entries) {
  let found = "";
  for (const entry of entries) {
    if (!hasHigh(entry.text)) continue;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(entry.text);
      found ||= "utf-8";
    } catch {
      return infoText(entry.text) === latin(entry.text) ? "latin1" : "euc-kr";
    }
  }
  return found;
}

// INFO에 적을 글의 바이트. 영문·숫자는 그대로 적고, 그 밖의 글자는 그 파일의 INFO가 쓰던 방식으로만 적는다.
// 그렇게 적을 수 없으면 null이다 (그 칸은 INFO에서 뺀다. ID3 조각에는 온전히 들어간다)
function infoBytes(text, encoding) {
  if (!hasHigh(new TextEncoder().encode(text))) return fromAscii(text);
  if (encoding === "utf-8") return new TextEncoder().encode(text);
  if (encoding === "euc-kr") return legacyText(text);
  if (encoding === "latin1" && [...text].every((ch) => ch.codePointAt(0) < 256)) return fromAscii(text);
  return null;
}

// 항목 하나: 이름 + 크기 + 글 + 끝의 0 (홀수 바이트면 0을 하나 더). 윈도우 탐색기는 끝의 0이 없으면 마지막 글자를 보이지 않는다고 한다
function infoEntry(id, text) {
  const size = text.length + 1;
  const whole = new Uint8Array(8 + size + (size & 1));
  whole.set(fromAscii(id), 0);
  whole.set(le32(size), 4);
  whole.set(text, 8);
  return { id, text, whole };
}

// INFO 항목들을 화면의 칸으로 읽는다 (INFO가 담는 칸만)
export function infoValues(entries) {
  const values = {};
  for (const [key, ids] of Object.entries(INFO_IDS)) {
    const entry = ids.map((id) => entries.find((item) => item.id === id)).find(Boolean);
    if (entry) values[key] = infoText(entry.text);
  }
  return values;
}

// 고친 칸을 INFO 항목들에 적는다. 고치지 않은 항목은 그대로 두고, 고친 항목은 원래 있던 자리에 둔다.
// 비운 칸과 INFO에 적을 수 없는 글(infoBytes 참고)은 그 항목을 뺀다
export function editInfo(entries, edits, encoding) {
  let list = [...entries];
  for (const [key, ids] of Object.entries(INFO_IDS)) {
    const value = edits[key];
    if (value === undefined) continue;
    const id = ids.find((name) => list.some((entry) => entry.id === name)) ?? ids[0];
    const bytes = value ? infoBytes(value, encoding) : null;
    list = replaceItems(list, (entry) => ids.includes(entry.id), bytes ? [infoEntry(id, bytes)] : []);
  }
  return list;
}

// WAV 파일(File이나 Blob)에서 조각들의 자리와 태그가 든 조각을 읽는다. 소리는 읽지 않는다.
// 결과: { why: 고칠 수 없는 까닭 } · { why: "", chunks: [{ id, at: 조각 머리의 자리, size: 내용 길이, list: LIST의 종류 }],
//         info: { chunk, entries } | null, id3: { chunk, parsed: parseId3v2의 결과(빈 조각이면 null) } | null }
export async function readWav(file) {
  const head = await bytesOf(file.slice(0, 12));
  const magic = ascii(head, 0, 4);
  if (magic === "RF64" || magic === "BW64" || (magic === "RIFF" && file.size > 0xffffffff)) return { why: TOO_BIG };
  if (head.length < 12 || magic !== "RIFF" || ascii(head, 8, 4) !== "WAVE") return { why: NOT_WAV };
  const chunks = [];
  let at = 12;
  while (at + 8 <= file.size) {
    if (chunks.length > 10000) return { why: BROKEN };
    const bytes = await bytesOf(file.slice(at, at + 12));
    const chunk = { id: ascii(bytes, 0, 4), at, size: u32le(bytes, 4), list: "" };
    const end = at + 8 + chunk.size;
    // 크기를 적지 않고 녹음을 끝낸 파일(크기가 0이거나 가장 큰 값)은 여기서 걸린다
    if (end > file.size) return { why: BROKEN };
    if (chunk.id === "LIST" && chunk.size >= 4) chunk.list = ascii(bytes, 8, 4);
    chunks.push(chunk);
    at = end + (chunk.size & 1);
  }
  if (!chunks.some((chunk) => chunk.id === "fmt ") || !chunks.some((chunk) => chunk.id === "data")) return { why: BROKEN };
  const out = { why: "", chunks, info: null, id3: null };
  const infoChunk = chunks.find(isInfo);
  if (infoChunk) {
    const entries = parseInfo(await bytesOf(file.slice(infoChunk.at + 12, infoChunk.at + 8 + infoChunk.size)));
    if (!entries) return { why: BAD_INFO };
    out.info = { chunk: infoChunk, entries };
  }
  const id3Chunk = chunks.find(isId3);
  if (id3Chunk) {
    const body = await bytesOf(file.slice(id3Chunk.at + 8, id3Chunk.at + 8 + id3Chunk.size));
    const length = id3v2Length(body.subarray(0, 10));
    const parsed = length && length <= body.length ? parseId3v2(body.subarray(0, length)) : null;
    if (body.length >= 10 && !parsed) return { why: BAD_ID3 };
    out.id3 = { chunk: id3Chunk, parsed };
  }
  return out;
}

// 읽은 것(readWav의 결과)을 화면에 보일 태그로 바꾼다. ID3 조각의 값을 먼저 쓰고, 거기 없는 칸은 INFO의 값을 쓴다.
// 결과: { version, values, repaired, picture: { mime, at: 파일 안의 자리(-1이면 모름), length }, pictures }
export function wavTags(source) {
  const tag = source.id3?.parsed ? readTags(source.id3.parsed, null) : null;
  const values = tag ? { ...tag.values } : emptyValues();
  for (const [key, text] of Object.entries(source.info ? infoValues(source.info.entries) : {})) {
    if (!values[key]) values[key] = text;
  }
  const picture = tag?.picture ? { ...tag.picture, at: tag.picture.at < 0 ? -1 : source.id3.chunk.at + 8 + tag.picture.at } : null;
  return {
    version: [tag?.version, source.info && "INFO"].filter(Boolean).join(" + "),
    values,
    repaired: tag?.repaired ?? [],
    picture,
    pictures: tag?.pictures ?? 0,
  };
}

// 고친 칸을 적은 새 파일 내용(Blob)을 만든다.
//   edits: { title: "새 글", album: "" (비우기), …, picture: null (그림 지우기) | { mime, data } (앞표지로 넣기) } 가운데 고칠 것만
// ID3 조각과 INFO 조각을 함께 고친다. 없던 조각은 소리(data) 앞에 새로 만든다 (data 뒤를 읽지 않는 프로그램도 찾게)
export async function rewriteWav(file, edits) {
  const source = await readWav(file);
  if (source.why) throw new Error(`${source.why} 고치지 않았습니다.`);
  const shown = wavTags(source).values;
  const textEdits = Object.fromEntries(TAG_FIELDS.filter((field) => edits[field.key] !== undefined).map((field) => [field.key, edits[field.key]]));

  // ID3 조각: 없던 파일은 INFO에만 있던 값도 새 태그에 옮겨 적는다
  const changes = { ...edits };
  if (!source.id3?.parsed) {
    for (const key of Object.keys(INFO_IDS)) if (changes[key] === undefined && shown[key]) changes[key] = shown[key];
  }
  const { tag } = applyTagEdits(source.id3?.parsed ?? null, null, changes);

  // INFO 조각: 있던 파일은 고친 칸만 맞추고, 없던 파일은 지금 값으로 새로 만든다
  const entries = source.info
    ? editInfo(source.info.entries, textEdits, infoEncoding(source.info.entries))
    : editInfo([], Object.fromEntries(Object.entries({ ...shown, ...textEdits }).filter(([, text]) => text)), "");
  const info = entries.length ? concat([fromAscii("INFO"), ...entries.map((entry) => (entry.whole.length & 1 ? concat([entry.whole, Uint8Array.of(0)]) : entry.whole))]) : null;

  const pieces = [];
  const pad = (length) => {
    if (length & 1) pieces.push(Uint8Array.of(0));
  };
  const put = (id, body) => {
    pieces.push(fromAscii(id), le32(body.length), body);
    pad(body.length);
  };
  const keep = (chunk) => {
    pieces.push(file.slice(chunk.at, chunk.at + 8 + chunk.size));
    pad(chunk.size);
  };
  let infoDone = false;
  let id3Done = false;
  const putInfo = () => {
    if (!infoDone && info) put("LIST", info);
    infoDone = true;
  };
  const putId3 = () => {
    if (!id3Done && tag.length) put(source.id3?.chunk.id ?? "id3 ", tag);
    id3Done = true;
  };
  const data = source.chunks.find((chunk) => chunk.id === "data");
  for (const chunk of source.chunks) {
    // 같은 조각이 또 있으면 첫 것만 남긴다
    if (isInfo(chunk)) putInfo();
    else if (isId3(chunk)) putId3();
    else {
      if (chunk === data) {
        if (!source.info) putInfo();
        if (!source.id3) putId3();
      }
      keep(chunk);
    }
  }
  const total = 4 + pieces.reduce((sum, piece) => sum + (piece.size ?? piece.length), 0);
  if (total > 0xffffffff) throw new Error("WAV는 4GB를 넘을 수 없어 태그를 더 넣지 못했습니다.");
  return new Blob([fromAscii("RIFF"), le32(total), fromAscii("WAVE"), ...pieces], { type: file.type || "audio/wav" });
}
