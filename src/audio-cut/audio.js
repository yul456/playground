// 오디오 파일을 열고 자르는 길을 정한다.
// - MP3·WAV: 직접 자른다(mp3.js·wav.js). 다시 압축하지 않고 태그를 바이트 그대로 옮긴다
// - 그 밖의 형식: Mediabunny로 자른다(media.js, 그런 파일을 열 때만 받는다)
import { cutMp3, frameAt, parseMp3, timeOfFrame } from "./mp3.js";
import { readId3, readWavTags } from "./tags.js";
import { cutWav, parseWav } from "./wav.js";

const EMPTY_TAGS = { title: "", artist: "", album: "", composer: "", cover: null, frames: 0 };

export const extensionOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] ?? "").toLowerCase();

// 저장 창에 보일 형식
export const MIME = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  webm: "audio/webm",
  mka: "audio/x-matroska",
};

// 파일을 연다. { kind: 'mp3' | 'wav' | 'media', ext, tags, label: 형식 설명, ... }
export async function openAudio(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ext = extensionOf(file.name);
  const head = String.fromCharCode(...bytes.subarray(0, 4));
  // MP3: 이름이 .mp3이거나, ID3 태그 또는 MP3 조각으로 시작하는 파일 (다른 형식의 머리로 시작하면 보지 않는다)
  if (!/^(RIFF|OggS|fLaC|\x1aE\xdf\xa3)/.test(head) && !/^ftyp/.test(String.fromCharCode(...bytes.subarray(4, 8)))) {
    const mp3 = parseMp3(bytes);
    if (mp3 && (ext === "mp3" || head.startsWith("ID3") || mp3.frames.length > 10)) {
      const layer = mp3.layer === 3 ? "MP3" : `MPEG 레이어 ${mp3.layer}`;
      return { kind: "mp3", ext: ext || "mp3", bytes, mp3, tags: readId3(bytes) ?? EMPTY_TAGS, label: `${layer} · ${mp3.sampleRate.toLocaleString()}Hz` };
    }
  }
  const wav = parseWav(bytes);
  if (wav) {
    const kind = wav.format === 3 ? "부동소수" : `${wav.bitsPerSample}비트`;
    return { kind: "wav", ext: "wav", bytes, wav, tags: readWavTags(bytes, wav), label: `WAV · ${wav.sampleRate.toLocaleString()}Hz · ${kind}` };
  }
  const media = await import("./media.js");
  const opened = await media.openMedia(file);
  return {
    kind: "media",
    ext: ext || "bin",
    media,
    tags: media.describeTags(opened.tags),
    sameFormat: opened.sameFormatSupported,
    label: `${opened.formatName}${opened.codec ? ` (${opened.codec})` : ""} · ${opened.sampleRate.toLocaleString()}Hz`,
  };
}

// MP3는 조각(약 0.026초) 경계에 맞춰서만 자를 수 있다. 고른 시각을 실제로 자를 시각으로 맞춘다
export function snap(opened, start, end) {
  if (opened.kind !== "mp3") return { start, end };
  return { start: timeOfFrame(opened.mp3, frameAt(opened.mp3, start)), end: timeOfFrame(opened.mp3, frameAt(opened.mp3, end)) };
}

// [start, end]초를 잘라 낸다. as: 'same'(원래 형식) · 'wav'(MP3·WAV 말고 다른 형식만).
// { blob, ext, reencoded: 다시 압축했는지, missing: 빠진 태그 이름들 }
export async function cutAudio(file, opened, start, end, as, onProgress) {
  if (opened.kind === "mp3") {
    const out = cutMp3(opened.bytes, opened.mp3, frameAt(opened.mp3, start), frameAt(opened.mp3, end));
    return { blob: new Blob([out], { type: MIME.mp3 }), ext: opened.ext, reencoded: false, missing: [] };
  }
  if (opened.kind === "wav") {
    const { sampleRate } = opened.wav;
    const out = cutWav(opened.bytes, opened.wav, start * sampleRate, end * sampleRate);
    return { blob: new Blob([out], { type: MIME.wav }), ext: "wav", reencoded: false, missing: [] };
  }
  const made = await opened.media.cutMedia(file, start, end, as, onProgress);
  const after = await opened.media.readTags(made.blob);
  return { blob: made.blob, ext: as === "wav" ? "wav" : opened.ext, reencoded: made.reencoded, missing: opened.media.missingTags(opened.tags, after) };
}
