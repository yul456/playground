// 오디오 파일 하나를 다른 형식으로 바꾼다 (Mediabunny). 소리를 풀어 새 형식으로 다시 만들고, 태그를 옮긴다.
// - 원본과 만들 소리 형식이 같으면(ADTS .aac → M4A 등) 다시 압축하지 않고 조각을 그대로 옮겨 담는다.
// - MP3·FLAC 인코더는 크롬에 없어 라이브러리(WASM)를 그 형식을 처음 만들 때 받는다. AAC는 크롬 것을 쓰고,
//   이 PC의 크롬이 그 설정으로 만들지 못하면(윈도우는 고를 수 있는 비트레이트가 적다) 라이브러리를 받는다.
// - MP3 태그는 Mediabunny가 쓰지 않게 하고 ID3v2.3으로 직접 붙인다 (id3.js). WAV에도 같은 태그를 "id3 " 조각으로 넣는다 (wavChunk.js).
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  canEncodeAudio,
  Conversion,
  ConversionCanceledError,
  FlacOutputFormat,
  Input,
  MATROSKA,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  Quality,
  WavOutputFormat,
  WEBM,
} from "mediabunny";
import { describeTags, missingTags } from "../shared/audioTags.js";
import { flacBitsFromDescription, losslessBits, lossyChannels, lossySampleRate, targetOf } from "./formats.js";
import { buildId3v23, stripId3v2 } from "./id3.js";
import { matroskaTitle, repairTags } from "./sourceTags.js";
import { id3Fields, outputTags } from "./tags.js";
import { insertBeforeData } from "./wavChunk.js";

export { ConversionCanceledError };

// 라이브러리 인코더를 등록한다. 크롬이 그 설정으로 만들 수 있으면 등록하지 않는다 (등록하면 크롬 것보다 먼저 쓰인다)
const LIBRARIES = {
  mp3: async () => (await import("@mediabunny/mp3-encoder")).registerMp3Encoder(),
  aac: async () => (await import("@mediabunny/aac-encoder")).registerAacEncoder(),
  flac: async () => (await import("@mediabunny/flac-encoder")).registerFlacEncoder(),
};
const registered = new Set();
// 어느 인코더로 만들었는지 (시험·화면 표시용): { mp3: 'library', aac: 'browser' … }
export const encoderUsed = {};

async function ensureEncoder(codec, config) {
  if (registered.has(codec)) {
    encoderUsed[codec] = "library";
    return;
  }
  if (await canEncodeAudio(codec, config)) {
    encoderUsed[codec] = "browser";
    return;
  }
  await LIBRARIES[codec]();
  registered.add(codec);
  encoderUsed[codec] = "library";
}

function outputFormat(target) {
  if (target.key === "mp3") return new Mp3OutputFormat();
  // 태그는 아이튠즈 방식(ilst)으로 쓴다. 애플 음악 앱과 윈도우가 읽는 방식이다
  if (target.key === "m4a") return new Mp4OutputFormat({ fastStart: "in-memory", metadataFormat: "mdir" });
  if (target.key === "flac") return new FlacOutputFormat();
  return new WavOutputFormat();
}

// 원본이 FLAC이면 그 비트 깊이 (디코더 설정의 STREAMINFO에서 읽는다)
async function flacBitsOf(track) {
  if (track.codec !== "flac") return null;
  const description = (await track.getDecoderConfig().catch(() => null))?.description;
  if (!description) return null;
  const bytes = ArrayBuffer.isView(description)
    ? new Uint8Array(description.buffer, description.byteOffset, description.byteLength)
    : new Uint8Array(description);
  return flacBitsFromDescription(bytes);
}

// 만들 소리의 설정 (Mediabunny Conversion의 audio). copy: 다시 압축하지 않고 옮겨 담는지
async function audioOptions(track, target, kbps) {
  const codec = track.codec;
  if (codec && codec === target.codec) return { copy: true, options: { codec } };
  if (target.lossy) {
    const config = {
      numberOfChannels: lossyChannels(track.numberOfChannels),
      sampleRate: lossySampleRate(track.sampleRate),
      quality: new Quality({ bitrate: kbps * 1000 }),
    };
    await ensureEncoder(target.codec, config);
    return { copy: false, options: { codec: target.codec, ...config } };
  }
  const bits = losslessBits(codec, await flacBitsOf(track));
  if (target.key === "flac") {
    await ensureEncoder("flac", { numberOfChannels: track.numberOfChannels, sampleRate: track.sampleRate });
    // FLAC 인코더는 받은 소리의 형식으로 비트 깊이를 정한다 (s16 → 16비트, s32 → 24비트)
    return { copy: false, options: { codec: "flac", sampleFormat: bits > 16 ? "s32" : "s16" } };
  }
  return { copy: false, options: { codec: bits > 16 ? "pcm-s24" : "pcm-s16" } };
}

const REASONS = {
  unknown_source_codec: "소리 형식을 알 수 없습니다",
  undecodable_source_codec: "이 브라우저가 이 소리 형식을 풀지 못합니다",
  no_encodable_target_codec: "이 브라우저가 이 형식으로 만들지 못합니다",
};

// 원본의 태그. 깨진 한글을 바로잡고, WebM·MKA는 Mediabunny가 읽지 않는 제목을 직접 읽는다 (sourceTags.js)
async function sourceTags(file, input) {
  const tags = repairTags(await input.getMetadataTags().catch(() => ({})));
  if (!tags.title) {
    const format = await input.getFormat().catch(() => null);
    if (format === WEBM || format === MATROSKA) {
      const title = matroskaTitle(new Uint8Array(await file.slice(0, 1 << 16).arrayBuffer()));
      if (title) tags.title = title;
    }
  }
  return tags;
}

async function readTags(blob) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    return await input.getMetadataTags();
  } catch {
    return {};
  } finally {
    input.dispose?.();
  }
}

// file(File·Blob)을 targetKey 형식으로 바꾼다. kbps: MP3·M4A의 비트레이트.
// onProgress(0~1), onStart(conversion): 멈출 때 conversion.cancel()을 부르라고 넘긴다.
// 결과: { blob, copied: 다시 압축하지 않고 옮겨 담았는지, missing: 옮기지 못한 태그 이름들, source: { codec, sampleRate, channels } }.
// 멈추면 ConversionCanceledError를 던진다
export async function convertFile(file, targetKey, kbps, { onProgress, onStart } = {}) {
  const target = targetOf(targetKey);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("소리가 들어 있지 않은 파일입니다");
    const tags = await sourceTags(file, input);
    const { copy, options } = await audioOptions(track, target, kbps);
    const output = new Output({ format: outputFormat(target), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      audio: options,
      video: { discard: true },
      // MP3는 태그를 직접 붙이므로 Mediabunny가 쓰지 않게 비운다
      tags: target.key === "mp3" ? {} : outputTags(tags, target.key),
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const audio = conversion.discardedTracks.find((d) => d.track.type === "audio");
      throw new Error((audio && REASONS[audio.reason]) || "이 파일을 바꾸지 못합니다");
    }
    onStart?.(conversion);
    conversion.onProgress = (p) => onProgress?.(p);
    await conversion.execute();
    let bytes = new Uint8Array(output.target.buffer);
    if (target.key === "mp3") {
      const tag = buildId3v23(id3Fields(tags));
      const audio = stripId3v2(bytes);
      bytes = new Uint8Array(tag.length + audio.length);
      bytes.set(tag);
      bytes.set(audio, tag.length);
    } else if (target.key === "wav") {
      // LIST INFO(Mediabunny가 쓴다)에는 라틴 문자 값만 들어가서, 한글·작곡가·앨범 아트는 ID3 조각으로 넣는다
      bytes = insertBeforeData(bytes, "id3 ", buildId3v23(id3Fields(tags)));
    }
    const blob = new Blob([bytes], { type: target.mime });
    // 저장할 파일을 다시 읽어, 원본에 있던 태그 가운데 빠진 것을 알린다
    const missing = missingTags(describeTags(tags), describeTags(await readTags(blob)));
    return { blob, copied: copy, missing, source: { codec: track.codec, sampleRate: track.sampleRate, channels: track.numberOfChannels } };
  } finally {
    input.dispose?.();
  }
}
