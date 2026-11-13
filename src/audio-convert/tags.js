// 원본의 태그(Mediabunny MetadataTags)를 바꿀 형식에 맞게 다시 만든다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// 원본 형식의 원래 이름(raw: ID3 프레임 이름, MP4 원자 이름 등)을 그대로 넘기면 다른 형식에 엉뚱한 칸이 생긴다
// (예: M4A에 TIT2라는 칸, FLAC에 TIT2=… 줄). 그래서 표준 칸만 옮기고, 작곡가는 그 형식의 이름으로 넣는다.
import { composerOf } from "../shared/audioTags.js";

// Mediabunny가 형식마다 알아서 옮겨 쓰는 표준 칸. 날짜는 아래(dateTextOf)에서 따로 옮긴다
const STANDARD = [
  "title",
  "description",
  "artist",
  "album",
  "albumArtist",
  "genre",
  "comment",
  "lyrics",
  "trackNumber",
  "tracksTotal",
  "discNumber",
  "discsTotal",
  "beatsPerMinute",
];

// 작곡가를 담는 이름: M4A ©wrt, FLAC(Vorbis comment) COMPOSER. WAV(LIST INFO)에는 작곡가 칸이 없다
const COMPOSER_KEYS = { m4a: "©wrt", flac: "COMPOSER" };
// 날짜를 담는 이름
const DATE_KEYS = { m4a: "©day", flac: "DATE", wav: "ICRD" };
// 원본에서 날짜를 담는 이름: ID3 TDRC(v2.4)·TYER(v2.3), MP4 ©day, Vorbis comment DATE·YEAR, WAV ICRD
const SOURCE_DATE_KEY = /^(tdrc|tyer|©day|date|year|icrd)$/i;

// 날짜는 원본에 적힌 글 그대로 옮긴다. Mediabunny는 날짜를 Date로 바꿔 쓰므로 연도만 있던 "2019"가 "2019-01-01"이 된다
export function dateTextOf(tags) {
  const raw = tags?.raw ?? {};
  for (const key of Object.keys(raw)) {
    const value = Array.isArray(raw[key]) ? raw[key][0] : raw[key];
    if (SOURCE_DATE_KEY.test(key) && typeof value === "string" && value.trim()) return value.trim();
  }
  const date = tags?.date;
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : "";
}

// 그림을 정리한다. M4A는 앞표지(coverFront)만 담으므로, 앞표지가 따로 없으면 첫 그림을 앞표지로 한다
export function normalizeImages(images) {
  if (!images?.length) return [];
  const list = images.map((image) => ({ ...image, mimeType: image.mimeType === "image/jpg" ? "image/jpeg" : image.mimeType }));
  if (!list.some((image) => image.kind === "coverFront")) list[0] = { ...list[0], kind: "coverFront" };
  return list;
}

// M4A·FLAC·WAV로 만들 때 Mediabunny에 넘길 태그 (MP3는 buildId3v23으로 직접 쓴다)
export function outputTags(tags, targetKey) {
  const out = {};
  for (const key of STANDARD) {
    const value = tags?.[key];
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  // WAV(LIST INFO)는 그림을 담지 못한다 (WAV의 그림은 convert.js가 ID3 조각으로 넣는다)
  const images = normalizeImages(tags?.images);
  if (images.length && targetKey !== "wav") out.images = images;
  const raw = {};
  const composer = composerOf(tags);
  if (composer && COMPOSER_KEYS[targetKey]) raw[COMPOSER_KEYS[targetKey]] = composer;
  const date = dateTextOf(tags);
  if (date && DATE_KEYS[targetKey]) raw[DATE_KEYS[targetKey]] = date;
  if (Object.keys(raw).length) out.raw = raw;
  return out;
}

// ID3v2.3의 연도 칸(TYER)은 네 자리 연도만 담는다
const yearOf = (tags) => /^\d{4}/.exec(dateTextOf(tags))?.[0] ?? "";

// n/전체 꼴 (전체를 모르면 n)
const numberText = (n, total) => (n ? (total ? `${n}/${total}` : String(n)) : "");

// MP3의 ID3v2.3 태그에 쓸 칸 (id3.js buildId3v23)
export function id3Fields(tags) {
  return {
    title: tags?.title ?? "",
    subtitle: tags?.description ?? "",
    artist: tags?.artist ?? "",
    album: tags?.album ?? "",
    albumArtist: tags?.albumArtist ?? "",
    composer: composerOf(tags),
    genre: tags?.genre ?? "",
    year: yearOf(tags),
    track: numberText(tags?.trackNumber, tags?.tracksTotal),
    disc: numberText(tags?.discNumber, tags?.discsTotal),
    bpm: tags?.beatsPerMinute ? String(tags.beatsPerMinute) : "",
    comment: tags?.comment ?? "",
    lyrics: tags?.lyrics ?? "",
    images: normalizeImages(tags?.images),
  };
}
