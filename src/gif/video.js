// 영상 파일을 열고, 고른 시각들의 화면을 줄인 크기의 화소로 내준다 (Mediabunny).
// 영상은 이 브라우저 안에서만 다룬다. 크롬의 WebCodecs가 푸는 코덱(H.264, VP9, AV1, 기기에 따라 HEVC)이면 된다.
import { ALL_FORMATS, BlobSource, CanvasSink, Input, UnsupportedInputFormatError } from "mediabunny";

// 열지 못한 까닭: format(모르는 파일 형식) · no-video(영상이 없음) · read(읽다가 오류)
export class VideoOpenError extends Error {
  constructor(kind, cause) {
    super(cause?.message ?? kind);
    this.kind = kind;
  }
}

// 영상을 연다. { input, track, start(첫 화면의 시각), duration, width, height, decodable }
// 영상이 0초가 아닌 시각에서 시작할 수 있어 start를 함께 둔다 (재생기의 시각 + start = 영상 안의 시각)
export async function openVideo(file) {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new VideoOpenError("no-video");
    const [start, end, decodable] = await Promise.all([track.getFirstTimestamp(), track.computeDuration(), track.canDecode()]);
    return { input, track, start, duration: Math.max(0, end - start), width: track.displayWidth, height: track.displayHeight, decodable };
  } catch (err) {
    input.dispose();
    if (err instanceof VideoOpenError) throw err;
    throw new VideoOpenError(err instanceof UnsupportedInputFormatError ? "format" : "read", err);
  }
}

export const closeVideo = (video) => video?.input.dispose();

// times(영상 안의 시각들, 늘어나는 순서)의 화면을 width×height로 줄여 하나씩 내준다: Uint8ClampedArray(RGBA) 또는 null(그 시각에 화면이 없음).
// 줄이는 일은 그림 칸(canvas)이 하고, 화소는 그 칸에서 읽는다. 내준 배열은 다음 것을 받기 전까지만 쓴다
export async function* renderFrames(video, times, width, height) {
  const sink = new CanvasSink(video.track, { width, height, fit: "fill", poolSize: 1 });
  for await (const wrapped of sink.canvasesAtTimestamps(times)) {
    if (!wrapped) {
      yield null;
      continue;
    }
    const ctx = wrapped.canvas.getContext("2d", { willReadFrequently: true });
    yield ctx.getImageData(0, 0, width, height).data;
  }
}
