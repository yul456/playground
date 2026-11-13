// 오디오 파일의 태그(Mediabunny가 읽은 MetadataTags)에서 화면에 보일 것을 꺼내고, 저장하기 전과 후를 견준다.
// 오디오 자르기와 오디오 형식 바꾸기가 쓴다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

// 작곡가는 표준 칸이 없어 형식마다 원래 이름(raw)으로 들어 있다: ID3 TCOM, MP4 ©wrt, Vorbis comment(FLAC·OGG) COMPOSER
const COMPOSER_KEY = /^(©wrt|composer|tcom)$/i;

// 태그 값이 글이면 그대로, 글 여러 개(Vorbis comment에서 같은 이름이 되풀이됨)면 이어서 돌려준다
function textOf(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((v) => typeof v === "string")) return value.join(", ");
  return "";
}

export function composerOf(tags) {
  const raw = tags?.raw ?? {};
  const key = Object.keys(raw).find((k) => COMPOSER_KEY.test(k));
  return key ? textOf(raw[key]) : "";
}

// 앨범 아트: 앞표지(coverFront)가 있으면 그것, 없으면 첫 그림
export const coverOf = (tags) => tags?.images?.find((img) => img.kind === "coverFront") ?? tags?.images?.[0] ?? null;

// 태그 가운데 화면에 보일 것: 제목, 아티스트, 앨범, 작곡가, 앨범 아트
export function describeTags(tags) {
  const image = coverOf(tags);
  return {
    title: tags?.title ?? "",
    artist: tags?.artist ?? "",
    album: tags?.album ?? "",
    composer: composerOf(tags),
    cover: image && { data: image.data, mimeType: image.mimeType },
    count: Object.keys(tags?.raw ?? {}).length + (tags?.images?.length ?? 0),
  };
}

// 저장한 파일에서 빠진 태그 이름들 (저장한 뒤 원본과 견준다). before·after는 describeTags 결과
export function missingTags(before, after) {
  const names = { title: "제목", artist: "아티스트", album: "앨범", composer: "작곡가" };
  const missing = Object.keys(names)
    .filter((key) => before[key] && !after[key])
    .map((key) => names[key]);
  if (before.cover && !after.cover) missing.push("앨범 아트");
  return missing;
}
