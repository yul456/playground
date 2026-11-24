// 녹화한 파일을 다시 담는다 (Mediabunny). 영상과 소리는 다시 압축하지 않고 그대로 옮긴다.
// 브라우저가 녹화하며 쓴 파일은 길이가 적혀 있지 않거나(WebM) 조각으로 나뉘어 있어서(MP4),
// 재생기에 따라 전체 길이가 안 보이거나 원하는 곳으로 건너뛰지 못한다. 다시 담으면 길이와 찾아가기 표가 들어간다.
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, WebMOutputFormat } from "mediabunny";

// blob(녹화한 파일)을 ext(mp4 · webm) 형식으로 다시 담는다. 결과: { blob, duration(초) }. 못 하면 오류를 던진다
export async function tidyRecording(blob, ext, type) {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const output = new Output({
      format: ext === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(),
      target: new BufferTarget(),
    });
    const conversion = await Conversion.init({ input, output, showWarnings: false });
    if (!conversion.isValid) throw new Error("다시 담을 수 없는 형식입니다");
    // 다시 압축하게 되면(옮겨 담지 못하는 형식) 오래 걸리고 화질이 깎이므로 하지 않는다
    if (conversion.utilizedTracks.length === 0 || conversion.discardedTracks.length) throw new Error("옮기지 못한 줄기가 있습니다");
    await conversion.execute();
    const made = new Blob([output.target.buffer], { type });
    const check = new Input({ source: new BlobSource(made), formats: ALL_FORMATS });
    try {
      return { blob: made, duration: await check.computeDuration() };
    } finally {
      check.dispose();
    }
  } finally {
    input.dispose();
  }
}
