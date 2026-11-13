// MP3·WAV 말고 다른 형식(M4A·AAC·OGG·Opus·FLAC·WebM 등)은 Mediabunny로 자른다.
// 이 파일은 그런 파일을 열 때만 불러온다(라이브러리가 커서 MP3만 쓸 때는 받지 않는다).
// - 원래 형식으로 저장: 먼저 다시 압축하지 않고 조각(패킷)을 그대로 옮겨 자른다(손실 없음). 고른 구간 밖의 소리는 넣지 않도록
//   조각 경계 안쪽으로 맞춘다(boundaryPolicy 'shrink'). 그렇게 못 하는 경우에만 한 번 다시 압축한다(FLAC은 다시 압축해도 손실 없음).
// - WAV로 저장: 소리를 풀어 16비트 PCM으로 담는다(손실 없음, 파일이 크다).
// 태그(제목·아티스트·앨범·앨범 아트 등)는 Mediabunny가 그대로 옮긴다. 형식마다 담는 자리가 다르다(MP4 ilst, Ogg·FLAC Vorbis comment 등)
import {
  ADTS,
  ALL_FORMATS,
  AdtsOutputFormat,
  BlobSource,
  BufferTarget,
  Conversion,
  FLAC,
  FlacOutputFormat,
  Input,
  MATROSKA,
  MkvOutputFormat,
  MP3,
  Mp3OutputFormat,
  MP4,
  Mp4OutputFormat,
  OGG,
  OggOutputFormat,
  Output,
  QTFF,
  WAVE,
  WavOutputFormat,
  WEBM,
  WebMOutputFormat,
} from "mediabunny";
import { fixVorbisFraming, readOggTagNames } from "./oggTags.js";

// 읽은 형식에 맞는 같은 형식의 쓰기 설정
function sameFormat(format) {
  if (format === MP4 || format === QTFF) return new Mp4OutputFormat();
  if (format === ADTS) return new AdtsOutputFormat();
  if (format === OGG) return new OggOutputFormat();
  if (format === FLAC) return new FlacOutputFormat();
  if (format === WEBM) return new WebMOutputFormat();
  if (format === MATROSKA) return new MkvOutputFormat();
  if (format === MP3) return new Mp3OutputFormat();
  if (format === WAVE) return new WavOutputFormat();
  return null;
}

// 파일을 연다. { input, format(형식 이름), duration(초), tags, sameFormatSupported }
export async function openMedia(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const format = await input.getFormat();
  const track = await input.getPrimaryAudioTrack();
  if (!track) throw new Error("소리가 들어 있지 않은 파일입니다");
  const duration = await input.computeDuration([track]);
  const tags = await input.getMetadataTags().catch(() => ({}));
  return { input, formatName: format.name, duration, tags, sameFormatSupported: Boolean(sameFormat(format)), sampleRate: track.sampleRate, channels: track.numberOfChannels, codec: track.codec };
}

// 태그 가운데 화면에 보일 것: 제목, 아티스트, 앨범, 작곡가, 앨범 아트
export function describeTags(tags) {
  const raw = tags?.raw ?? {};
  const composerKey = Object.keys(raw).find((key) => /^(©wrt|composer|tcom)$/i.test(key));
  const composer = composerKey && typeof raw[composerKey] === "string" ? raw[composerKey] : "";
  const image = tags?.images?.find((img) => img.kind === "coverFront") ?? tags?.images?.[0] ?? null;
  return {
    title: tags?.title ?? "",
    artist: tags?.artist ?? "",
    album: tags?.album ?? "",
    composer,
    cover: image && { data: image.data, mimeType: image.mimeType },
    count: Object.keys(raw).length + (tags?.images?.length ?? 0),
  };
}

// 잘라 낸 파일에서 빠진 태그 이름들 (저장한 뒤 원본과 견준다). before·after는 describeTags 결과
export function missingTags(before, after) {
  const names = { title: "제목", artist: "아티스트", album: "앨범", composer: "작곡가" };
  const missing = Object.keys(names).filter((key) => before[key] && !after[key]).map((key) => names[key]);
  if (before.cover && !after.cover) missing.push("앨범 아트");
  return missing;
}

// Ogg 태그 이름 가운데 화면에 보이는 칸에 해당하는 것
const OGG_NAMES = { title: ["title"], artist: ["artist"], album: ["album"], composer: ["composer"] };

// 만든 파일(Blob)의 태그를 읽는다. Ogg는 다른 재생기처럼 엄격하게 다시 읽어, 그렇게 읽히지 않는 태그는 없는 것으로 친다
export async function readTags(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const tags = describeTags(await input.getMetadataTags().catch(() => ({})));
  const names = readOggTagNames(new Uint8Array(await blob.slice(0, 1 << 20).arrayBuffer()));
  if (names) {
    for (const [field, keys] of Object.entries(OGG_NAMES)) if (!keys.some((key) => names.includes(key))) tags[field] = "";
  }
  return tags;
}

const reasonText = {
  unknown_source_codec: "이 소리 형식을 알 수 없습니다",
  undecodable_source_codec: "이 브라우저가 이 소리 형식을 풀지 못합니다",
  no_encodable_target_codec: "이 브라우저가 이 형식으로 다시 압축하지 못합니다",
  cannot_copy: "다시 압축하지 않고는 자를 수 없습니다",
};

async function run(file, output, trim, extra, onProgress) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const conversion = await Conversion.init({ input, output, trim, video: { discard: true }, showWarnings: false, ...extra });
  if (!conversion.isValid) {
    const audio = conversion.discardedTracks.find((d) => d.track.type === "audio");
    return { ok: false, reason: (audio && reasonText[audio.reason]) || "이 파일을 자르지 못합니다" };
  }
  conversion.onProgress = (progress) => onProgress?.(progress);
  await conversion.execute();
  return { ok: true, buffer: output.target.buffer };
}

// [start, end] 초를 잘라 낸다. as: 'same'(원래 형식) · 'wav'.
// 결과: { blob, ext, reencoded: 다시 압축했는지, note }
export async function cutMedia(file, start, end, as, onProgress) {
  const trim = { start, end };
  if (as === "wav") {
    const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });
    const made = await run(file, output, trim, { audio: { codec: "pcm-s16" } }, onProgress);
    if (!made.ok) throw new Error(made.reason);
    return { blob: new Blob([made.buffer], { type: "audio/wav" }), ext: "wav", reencoded: false };
  }
  const probe = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const format = await probe.getFormat();
  if (!sameFormat(format)) throw new Error("이 형식은 원래 형식으로 저장하지 못합니다. WAV로 저장해 주세요");
  // FLAC을 다시 압축해야 할 때 쓸 인코더 (브라우저에 FLAC 인코더가 없다). FLAC 파일일 때만 받는다
  if (format === FLAC) {
    const { registerFlacEncoder } = await import("@mediabunny/flac-encoder");
    registerFlacEncoder();
  }
  // 1) 다시 압축하지 않고 조각을 그대로 옮긴다. 고른 구간 밖의 소리는 넣지 않는다
  const copy = { mode: "forced", shiftTolerance: Infinity, boundaryPolicy: "shrink" };
  let output = new Output({ format: sameFormat(format), target: new BufferTarget() });
  let made = await run(file, output, trim, { copy }, onProgress);
  let reencoded = false;
  // 2) 그렇게 못 하면 한 번 다시 압축한다
  if (!made.ok) {
    output = new Output({ format: sameFormat(format), target: new BufferTarget() });
    made = await run(file, output, trim, { copy: false }, onProgress);
    reencoded = true;
  }
  if (!made.ok) throw new Error(`${made.reason}. WAV로 저장해 주세요`);
  let bytes = new Uint8Array(made.buffer);
  // OGG Vorbis는 Mediabunny가 빠뜨리는 태그 칸 끝의 1바이트를 채운다 (oggTags.js). Opus 등은 그대로 돌려받는다
  if (format === OGG) bytes = fixVorbisFraming(bytes);
  return { blob: new Blob([bytes], { type: output.format.mimeType }), ext: null, reencoded };
}
