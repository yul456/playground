// 바꿀 형식, 목록에 올릴 파일, 저장할 이름, 만들 소리의 설정(샘플레이트·채널·비트 깊이)을 정한다.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.

// 바꿀 형식. codec: 만들 소리 형식(Mediabunny 이름, WAV는 비트 깊이에 따라 pcm-s16·pcm-s24),
// lossy: 손실 압축이라 비트레이트를 고른다 (bitrates의 첫째가 기본값, kbps)
export const TARGETS = [
  {
    key: "mp3",
    label: "MP3",
    ext: "mp3",
    codec: "mp3",
    mime: "audio/mpeg",
    lossy: true,
    bitrates: [320, 256, 192, 128],
    hint: "휴대폰·컴퓨터·차·오래된 기기 어디서나 재생됩니다. 잘 모르겠으면 이것을 고르세요.",
  },
  {
    key: "m4a",
    label: "M4A",
    ext: "m4a",
    codec: "aac",
    mime: "audio/mp4",
    lossy: true,
    bitrates: [256, 192, 128],
    hint: "아이폰·맥의 음악 앱에 잘 맞고, 같은 크기면 MP3보다 음질이 조금 낫습니다. 오래된 기기는 못 틀 수 있습니다.",
  },
  {
    key: "flac",
    label: "FLAC",
    ext: "flac",
    codec: "flac",
    mime: "audio/flac",
    lossy: false,
    hint: "음질이 그대로이고(손실 없음) WAV의 절반쯤 크기라 보관용으로 좋습니다. 못 여는 기기·프로그램이 있습니다.",
  },
  {
    key: "wav",
    label: "WAV",
    ext: "wav",
    codec: "pcm",
    mime: "audio/wav",
    lossy: false,
    hint: "음질이 그대로이고(손실 없음) 가장 큽니다. 편집 프로그램에 넣을 때 씁니다. 태그를 읽지 못하는 프로그램이 많습니다.",
  },
];

export const targetOf = (key) => TARGETS.find((target) => target.key === key) ?? TARGETS[0];

// 비트레이트 설명. 크기는 비트레이트로 계산한 값이다 (320kbps = 1초에 40KB)
export const BITRATE_HINTS = {
  mp3: {
    320: "MP3에서 가장 좋은 음질입니다. 1분에 약 2.4MB.",
    256: "대부분 320과 귀로 구분하기 어렵습니다. 1분에 약 1.9MB.",
    192: "보통 음질입니다. 1분에 약 1.4MB.",
    128: "작지만 좋은 이어폰으로 들으면 차이가 날 수 있습니다. 1분에 약 1MB.",
  },
  m4a: {
    256: "애플 뮤직에서 받는 곡과 같은 비트레이트입니다. 1분에 약 1.9MB.",
    192: "대부분 256과 귀로 구분하기 어렵습니다. 1분에 약 1.4MB.",
    128: "작지만 좋은 이어폰으로 들으면 차이가 날 수 있습니다. 1분에 약 1MB.",
  },
};

// 목록에 올릴 오디오 파일 (크롬이 풀 수 있는 형식). .mp4·.mov는 대개 동영상이라 넣지 않는다
export const SOURCE_EXTENSIONS = ["mp3", "m4a", "aac", "flac", "wav", "ogg", "oga", "opus", "weba", "webm", "mka"];

export const extensionOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] ?? "").toLowerCase();
export const isAudioFile = (name) => SOURCE_EXTENSIONS.includes(extensionOf(name));
// 저장할 이름: 같은 이름에 확장자만 바꾼다 (x.m4a → x.mp3)
export const outName = (name, target) => `${name.replace(/\.[^.]*$/, "")}.${target.ext}`;

// 바꿀 파일과 저장할 이름을 정한다. 바꿀 파일이 있는 폴더만 남긴다.
// 결과: { folders: [{ path, dir, items: [{ name, source: scan의 파일, out: 저장할 이름, exists }] }], same: 이미 그 형식인 파일 수 }
// 이미 바꿀 형식인 파일(MP3로 바꿀 때 x.mp3)은 바꾸지 않는다. 다시 압축하면 음질만 깎인다.
// exists는 같은 이름의 결과가 이미 있다는 뜻이고, 그런 파일은 덮어쓰지 않고 건너뛴다.
// 한 폴더의 x.m4a와 x.ogg처럼 저장할 이름이 겹치면 앞의 것만 바꾸고 뒤의 것은 exists가 된다.
// 윈도우는 대소문자가 달라도 같은 이름으로 본다
export function planFolders(scan, target) {
  const folders = [];
  let same = 0;
  for (const folder of scan.folders) {
    const taken = new Set(folder.files.map((file) => file.name.toLowerCase()));
    const items = [];
    for (const file of folder.files) {
      if (!isAudioFile(file.name)) continue;
      if (extensionOf(file.name) === target.ext) {
        same++;
        continue;
      }
      const out = outName(file.name, target);
      const exists = taken.has(out.toLowerCase());
      taken.add(out.toLowerCase());
      items.push({ name: file.name, source: file, out, exists });
    }
    if (items.length) folders.push({ path: folder.path, dir: folder.dir, items });
  }
  return { folders, same };
}

// MP3·AAC로 만들 때의 샘플레이트. 흔한 32k·44.1k·48k는 그대로 두고, 다른 값은 44.1k 계열이면 44,100, 아니면 48,000으로 바꾼다.
// MP3는 24k 이하에서 고를 수 있는 비트레이트가 160kbps까지라, 낮은 샘플레이트(음성 녹음 등)도 올려서 만든다
export function lossySampleRate(rate) {
  if ([32000, 44100, 48000].includes(rate)) return rate;
  return rate % 11025 === 0 ? 44100 : 48000;
}

// MP3·AAC로 만들 때의 채널 수. 3채널 이상(5.1 등)은 스테레오로 줄인다
export const lossyChannels = (channels) => Math.min(Math.max(channels || 2, 1), 2);

// FLAC·WAV로 만들 때의 비트 깊이. 원본이 24비트 이상인 손실 없는 형식이면 24, 아니면(16비트, 손실 압축) 16.
// codec은 원본의 소리 형식(Mediabunny 이름), flacBits는 원본이 FLAC일 때 그 비트 깊이
export function losslessBits(codec, flacBits) {
  if (codec === "flac") return flacBits > 16 ? 24 : 16;
  if (/^pcm-(s24|s32|f32|f64)/.test(codec ?? "")) return 24;
  return 16;
}

// FLAC 디코더 설정(description: 'fLaC' + STREAMINFO 블록)에서 비트 깊이를 읽는다. 읽지 못하면 null.
// STREAMINFO는 블록 크기(16+16비트), 조각 크기(24+24), 샘플레이트(20), 채널-1(3), 비트 깊이-1(5) … 순서다
export function flacBitsFromDescription(bytes) {
  if (!bytes) return null;
  let at = 0;
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) at = 4; // "fLaC"
  at += 4; // 블록 머리 (종류 1바이트 + 길이 3바이트)
  if (bytes.length < at + 14) return null;
  return (((bytes[at + 12] & 1) << 4) | (bytes[at + 13] >> 4)) + 1;
}
