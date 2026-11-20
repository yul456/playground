// 영상 파일을 열고, 장면을 찾으려고 작게 줄여 보고, 고른 시각의 화면을 원래 크기 그림으로 만든다 (Mediabunny).
// 영상은 이 브라우저 안에서만 다룬다. 크롬의 WebCodecs가 푸는 코덱(H.264, VP9, AV1, 기기에 따라 HEVC)이면 된다.
// 화면의 시각은 Mediabunny의 시각(영상 안의 표시 시각, 초)이다. 영상이 0초가 아닌 시각에서 시작할 수 있어 start를 함께 둔다
import { ALL_FORMATS, BlobSource, CanvasSink, Input, UnsupportedInputFormatError, VideoSampleSink } from "mediabunny";
import { SIG_H, SIG_W, signature } from "./scenes.js";

// 열지 못한 까닭: format(모르는 파일 형식) · no-video(영상이 없음) · read(읽다가 오류)
export class VideoOpenError extends Error {
  constructor(kind, cause) {
    super(cause?.message ?? kind);
    this.kind = kind;
    this.cause = cause;
  }
}

// 영상을 연다. { input, track, start, duration, width, height, codec, fps, decodable }
// decodable: 이 브라우저가 이 영상의 코덱을 풀 수 있는지 (못 풀면 장면을 뽑을 수 없다. 재생기는 될 수도 있다)
export async function openVideo(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new VideoOpenError("no-video");
    const [start, end, decodable] = await Promise.all([track.getFirstTimestamp(), track.computeDuration(), track.canDecode()]);
    let fps = 30;
    try {
      fps = (await track.computePacketStats(120)).averagePacketRate || 30;
    } catch {
      // 모르면 30으로 본다 (한 프레임씩 옮길 때만 쓴다)
    }
    return {
      input,
      track,
      start,
      duration: Math.max(0, end - start),
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec,
      fps,
      decodable,
      canvasSink: null,
    };
  } catch (err) {
    input.dispose();
    if (err instanceof VideoOpenError) throw err;
    if (err instanceof UnsupportedInputFormatError) throw new VideoOpenError("format", err);
    throw new VideoOpenError("read", err);
  }
}

export const closeVideo = (video) => video?.input.dispose();

// 장면을 찾을 때 1초에 몇 번 볼지. 영상이 길면 덜 본다 (장면은 그보다 길다). 영상의 초당 화면 수보다 많이 보지는 않는다
export function sampleRate(video) {
  const rate = video.duration <= 600 ? 10 : video.duration <= 3600 ? 5 : 2;
  return Math.max(1, Math.min(rate, Math.round(video.fps) || rate));
}

// 영상을 처음부터 1초에 rate번씩 아주 작게(SIG_W×SIG_H) 줄여 본 모양을 하나씩 내준다: { t, sig }.
// stopped()가 참이 되면 그만둔다. 같은 화면을 두 번 내주지 않는다
export async function* sampleVideo(video, rate, stopped) {
  const sink = new VideoSampleSink(video.track);
  // 작은 칸에 그리면 줄이는 일은 그래픽 카드가 하고, 읽어 오는 것은 작은 칸뿐이다
  const canvas = new OffscreenCanvas(SIG_W, SIG_H);
  const ctx = canvas.getContext("2d");
  const end = video.start + video.duration;
  const step = 1 / rate;
  function* times() {
    for (let k = 0; video.start + k * step < end; k++) yield video.start + k * step;
  }
  let last = null;
  for await (const sample of sink.samplesAtTimestamps(times())) {
    if (!sample) continue;
    try {
      if (sample.timestamp === last) continue;
      last = sample.timestamp;
      ctx.clearRect(0, 0, SIG_W, SIG_H);
      sample.draw(ctx, 0, 0, SIG_W, SIG_H);
      yield { t: sample.timestamp, sig: signature(ctx.getImageData(0, 0, SIG_W, SIG_H).data) };
    } finally {
      sample.close();
    }
    if (stopped()) return;
  }
}

function canvasToBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("그림을 만들지 못했습니다"))), type, quality);
  });
}

// t초(영상 안의 시각)에 보이는 화면을 원래 크기 그림으로 만든다: { t(그 화면이 시작하는 시각), blob, width, height }.
// 그 시각에 화면이 없으면 null. 한 번에 하나씩 부른다 (그림 칸 하나를 돌려 쓴다)
export async function captureFrame(video, t, type, quality) {
  video.canvasSink ??= new CanvasSink(video.track, { poolSize: 1 });
  const wrapped = await video.canvasSink.getCanvas(t);
  if (!wrapped) return null;
  const blob = await canvasToBlob(wrapped.canvas, type, quality);
  return { t: wrapped.timestamp, blob, width: wrapped.canvas.width, height: wrapped.canvas.height };
}

// 재생기(<video>)에 지금 보이는 화면을 그림으로 만든다. 이 브라우저가 Mediabunny로 풀 수 없는 영상을 재생기는 틀 때 쓴다
export async function captureElement(element, type, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = element.videoWidth;
  canvas.height = element.videoHeight;
  canvas.getContext("2d").drawImage(element, 0, 0);
  const blob = await canvasToBlob(canvas, type, quality);
  return { blob, width: canvas.width, height: canvas.height };
}
