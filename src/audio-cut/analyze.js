// 파형을 그리고 앞뒤 조용한 부분을 찾으려고 소리를 풀어 0.01초마다의 크기를 잰다.
// 메모리를 아끼려고 8,000Hz로 낮춰 푼다(긴 파일도 가볍다). 듣기는 원래 파일로 하므로 음질과는 상관없다.

const ANALYSIS_RATE = 8000;
export const STEP_SECONDS = 0.01;

// { duration, peak: 칸마다 가장 큰 소리(0~1), rms: 칸마다 평균 세기 } 소리를 풀지 못하면 오류
export async function analyze(file) {
  const context = new OfflineAudioContext(1, 1, ANALYSIS_RATE);
  const audio = await context.decodeAudioData(await file.arrayBuffer());
  const step = Math.max(1, Math.round(audio.sampleRate * STEP_SECONDS));
  const count = Math.ceil(audio.length / step);
  const peak = new Float32Array(count);
  const power = new Float32Array(count);
  for (let channel = 0; channel < audio.numberOfChannels; channel++) {
    const data = audio.getChannelData(channel);
    for (let i = 0; i < count; i++) {
      let max = 0;
      let sum = 0;
      const end = Math.min(data.length, (i + 1) * step);
      for (let k = i * step; k < end; k++) {
        const v = data[k];
        const a = v < 0 ? -v : v;
        if (a > max) max = a;
        sum += v * v;
      }
      if (max > peak[i]) peak[i] = max;
      power[i] += sum / Math.max(1, end - i * step) / audio.numberOfChannels;
    }
  }
  const rms = power.map(Math.sqrt);
  return { duration: audio.duration, peak, rms };
}

// 소리 크기 기준(가장 큰 칸보다 몇 dB 작은 소리까지 조용하다고 볼지)
export const QUIET_LEVELS = [
  { db: -50, label: "아주 작은 소리만" },
  { db: -40, label: "보통" },
  { db: -30, label: "조금 큰 잡음까지" },
];

// 앞뒤의 조용한 부분을 뺀 구간 { start, end }(초). 그 기준보다 큰 소리가 0.05초 넘게 이어지는 첫 곳과 끝 곳을 찾고,
// 소리가 잘리지 않게 앞뒤로 margin초를 남긴다. 큰 소리가 없으면 null
export function findSound(analysis, db = -40, margin = 0.1) {
  const { rms, duration } = analysis;
  let loudest = 0;
  for (const v of rms) if (v > loudest) loudest = v;
  if (!loudest) return null;
  const limit = loudest * 10 ** (db / 20);
  const need = Math.ceil(0.05 / STEP_SECONDS);
  const loud = (i) => rms[i] > limit;
  let first = -1;
  for (let i = 0, run = 0; i < rms.length; i++) {
    run = loud(i) ? run + 1 : 0;
    if (run >= need) {
      first = i - need + 1;
      break;
    }
  }
  let last = -1;
  for (let i = rms.length - 1, run = 0; i >= 0; i--) {
    run = loud(i) ? run + 1 : 0;
    if (run >= need) {
      last = i + need - 1;
      break;
    }
  }
  if (first < 0 || last < first) return null;
  return {
    start: Math.max(0, first * STEP_SECONDS - margin),
    end: Math.min(duration, (last + 1) * STEP_SECONDS + margin),
  };
}
