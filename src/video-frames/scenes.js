// 영상에서 장면이 바뀌는 곳을 찾고, 장면마다 한 장을 고른다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
//
// 영상을 1초에 몇 번씩 아주 작게(SIG_W×SIG_H) 줄여 본 모양(signature: 화소마다 색상·채도·밝기)을 시각 순서대로 받아,
//  1) 끊긴 곳: 바로 앞 모양과의 차이가 앞뒤 둘레의 차이(가운데값)보다 갑자기 크게 튀는 곳 (화면이 계속 움직이는 장면에서는 차이가 늘 커서,
//     차이의 크기만 보면 움직이는 내내 장면이 바뀐 것으로 잘못 본다. 그래서 둘레보다 몇 배 튀는지를 본다)
//  2) 천천히 바뀐 곳: 장면이 시작할 때의 모양에서 조금씩 멀어져 많이 달라진 곳 (서서히 바뀌는 전환, 카메라가 돌아 다른 것이 보일 때)
// 을 새 장면으로 본다. 번쩍임처럼 잠깐(FLASH초 안에) 바뀌었다가 바로 앞 장면으로 돌아오면 장면을 나누지 않는다.
// 장면 수에서 고른 길이(min)보다 짧은 장면은 보이지 않는다.
// 장면마다 그 장면다운 한 장을 고른다: 모양이 장면의 평균에 가깝고, 앞뒤와의 차이가 작은(움직임·전환 중이 아닌) 화면.
// 한 번도 멈추지 않고 SETTLE초 안에 끝나는 장면은 전환(서서히 바뀌는 중간)으로 보고 뺀다. 영상 전체가 늘 움직이거나 잡음이 많으면
// (바로 앞과의 차이의 가운데값이 크면) 그만큼 기준을 올려, 그런 영상의 짧은 장면은 빼지 않는다.
// 거의 한 가지 색인 화면(검은 화면 등)만 있는 장면은 검색에 쓸모가 없어 뺀다.

export const SIG_W = 32;
export const SIG_H = 18;
const N = SIG_W * SIG_H;

// 장면을 얼마나 잘게 나눌지 (화면의 "장면 수"). 차이는 0~255 (화소마다 색상·채도·밝기 차이의 평균)
// - cut: 끊긴 곳으로 볼 차이의 최솟값, ratio: 앞뒤 둘레의 차이보다 몇 배 튀어야 끊긴 곳인지
// - drift: 장면이 시작할 때의 모양과 이만큼 달라지면 새 장면. 장면이 시작하고 gap초가 지난 뒤부터 본다
//   (카메라가 움직이는 장면이 잘게 나뉘지 않게)
// - min: 이보다(초) 짧은 장면은 보이지 않는다
export const AMOUNTS = {
  fewer: { cut: 30, ratio: 3.5, drift: 72, gap: 2.5, min: 2 },
  normal: { cut: 20, ratio: 3, drift: 60, gap: 1.5, min: 0.8 },
  more: { cut: 12, ratio: 2.5, drift: 46, gap: 0.6, min: 0.3 },
};
export const AMOUNT_LABELS = { fewer: "적게", normal: "보통", more: "많이" };
// 끊긴 곳을 볼 때 앞뒤로 견주는 모양 수
export const WINDOW = 2;
// 거의 한 가지 색인 화면: 밝기의 표준편차가 이보다 작다
const FLAT = 6;
// 고를 한 장의 점수에서 움직임(앞뒤와의 차이)을 얼마나 무겁게 볼지
const MOTION_WEIGHT = 1.5;
// 장면이 시작하고 화면이 멈출 때까지(바로 앞과의 차이가 STILL보다 작아질 때까지, 길어도 SETTLE초) 시작할 때의 모양을 따라 옮긴다.
// 서서히 바뀌는 전환으로 시작한 장면은 전환이 끝난 화면과 견주어야, 전환이 끝난 뒤 곧바로 또 장면이 바뀐 것으로 보지 않는다
const SETTLE = 2;
const STILL = 4;
// 장면이 바뀌었다가 이보다(초) 빨리 바로 앞 장면으로 돌아오면 번쩍임으로 보고 나누지 않는다
const FLASH = 1;

// RGBA 화소(SIG_W×SIG_H)의 모양: [색상 N개][채도 N개][밝기 N개], 모두 0~255. 색상은 한 바퀴를 256으로 나눈다
export function signature(rgba) {
  const sig = new Uint8Array(N * 3);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const max = Math.max(r, g, b);
    const d = max - Math.min(r, g, b);
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
    }
    sig[i] = Math.round((h * 256) / 6) & 255;
    sig[N + i] = max ? Math.round((d * 255) / max) : 0;
    sig[2 * N + i] = max;
  }
  return sig;
}

// 두 모양의 차이 (0~255). 색상은 둘레를 돌아 가까운 쪽으로 재고, 채도가 낮은(회색에 가까운) 화소의 색상은 거의 치지 않는다.
// 회색 화소의 색상은 압축 잡음에 마구 흔들려서다
export function difference(a, b) {
  let sum = 0;
  for (let i = 0; i < N; i++) {
    let dh = Math.abs(a[i] - b[i]);
    if (dh > 128) dh = 256 - dh;
    const sat = Math.min(a[N + i], b[N + i]);
    sum += (dh * 2 * sat) / 255 + Math.abs(a[N + i] - b[N + i]) + Math.abs(a[2 * N + i] - b[2 * N + i]);
  }
  return sum / (3 * N);
}

// 밝기가 얼마나 고르게 퍼져 있나 (표준편차). 거의 한 가지 색인 화면이면 작다
export function spread(sig) {
  let sum = 0;
  let sq = 0;
  for (let i = 2 * N; i < 3 * N; i++) {
    sum += sig[i];
    sq += sig[i] * sig[i];
  }
  const mean = sum / N;
  return Math.sqrt(Math.max(0, sq / N - mean * mean));
}

// 장면에서 고를 한 장 (samples[from..to)): 모양이 장면의 평균에 가까울수록, 앞뒤 모양과의 차이(움직임)가 작을수록 좋다
function pickOf(samples, diff, from, to) {
  if (to - from <= 1) return from;
  const mean = new Float32Array(N * 3);
  for (let k = from; k < to; k++) {
    const sig = samples[k].sig;
    for (let i = 0; i < mean.length; i++) mean[i] += sig[i];
  }
  for (let i = 0; i < mean.length; i++) mean[i] /= to - from;
  let best = from;
  let bestScore = Infinity;
  for (let k = from; k < to; k++) {
    const sig = samples[k].sig;
    let sum = 0;
    for (let i = 0; i < mean.length; i++) sum += Math.abs(sig[i] - mean[i]);
    const motion = k + 1 < samples.length ? (diff[k] + diff[k + 1]) / 2 : diff[k];
    const score = sum / mean.length + MOTION_WEIGHT * motion;
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

// samples: [{ t(초), sig }] (시각 순서). 바로 앞 모양과의 차이는 diffs[k]로 미리 셈해 넘길 수 있다 (없으면 여기서 센다).
// done: 영상을 끝까지 읽었는지. 읽는 중이면 끝쪽 장면은 아직 바뀔 수 있어 열린 장면으로 둔다(closed: false).
// 결과: [{ start, end, pick, at, reason: "start" | "cut" | "drift", flat, closed }] (start·end·pick은 시각, at은 고른 모양의 번호)
export function detectScenes(samples, params, { diffs = null, done = true } = {}) {
  const n = samples.length;
  if (!n) return [];
  const diff = diffs ?? samples.map((s, k) => (k ? difference(samples[k - 1].sig, s.sig) : 0));
  // 끊긴 곳은 뒤쪽 WINDOW개를 봐야 정할 수 있다. 읽는 중이면 그만큼은 아직 정하지 않는다
  const decided = done ? n : Math.max(0, n - WINDOW);
  // 장면이 시작하는 곳들: { k, t, reason, ref(견줄 모양: 장면이 시작해 화면이 멈췄을 때의 모양), settled }
  const starts = [{ k: 0, t: samples[0].t, reason: "start", ref: samples[0].sig, settled: false }];
  for (let k = 1; k < decided; k++) {
    const t = samples[k].t;
    const current = starts[starts.length - 1];
    // 앞뒤 둘레의 차이: 가운데값 (둘레에 다른 끊긴 곳이 하나 끼어 있어도 흔들리지 않게)
    const near = [];
    for (let j = Math.max(1, k - WINDOW); j <= Math.min(n - 1, k + WINDOW); j++) if (j !== k) near.push(diff[j]);
    near.sort((a, b) => a - b);
    const around = near.length ? (near[(near.length - 1) >> 1] + near[near.length >> 1]) / 2 : 0;
    const cut = diff[k] >= params.cut && diff[k] >= params.ratio * Math.max(around, 1);
    if (!current.settled) {
      current.ref = samples[k].sig;
      if (diff[k] < STILL || t - current.t >= SETTLE) current.settled = true;
    }
    if (cut) {
      // 번쩍임: 잠깐 바뀐 장면이 끝나고 바로 앞 장면으로 돌아왔다. 잠깐 바뀐 장면을 없애고 앞 장면을 이어 간다
      const before = starts[starts.length - 2];
      if (t - current.t < FLASH && before && difference(before.ref, samples[k].sig) < params.cut) starts.pop();
      else starts.push({ k, t, reason: "cut", ref: samples[k].sig, settled: false });
      continue;
    }
    if (current.settled && t - current.t >= params.gap && difference(current.ref, samples[k].sig) >= params.drift) {
      starts.push({ k, t, reason: "drift", ref: samples[k].sig, settled: false });
    }
  }
  // 화면이 멈췄다고 볼 차이: STILL, 영상이 늘 움직이면 차이의 가운데값의 두 배
  const sorted = Float32Array.from(diff).sort();
  const still = Math.max(STILL, 2 * sorted[Math.floor(sorted.length / 2)]);
  const scenes = [];
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s].k;
    const last = s + 1 < starts.length;
    const to = last ? starts[s + 1].k : n;
    const at = pickOf(samples, diff, from, to);
    let calmest = Infinity;
    for (let k = from + 1; k < to; k++) calmest = Math.min(calmest, diff[k]);
    const start = samples[from].t;
    const end = last ? samples[to].t : samples[n - 1].t;
    scenes.push({
      start,
      end,
      pick: samples[at].t,
      at,
      reason: starts[s].reason,
      flat: spread(samples[at].sig) < FLAT,
      // 끝난 장면인데 한 번도 멈추지 않고 짧게 끝났다: 전환
      passing: last && end - start < SETTLE && calmest > still,
      closed: last || done,
    });
  }
  // 검은 화면처럼 한 가지 색뿐인 장면, 전환, 고른 길이보다 짧은 장면은 뺀다 (읽는 중인 마지막 장면은 길이를 아직 모른다).
  // 다 빠지면 한 가지 색이 아닌 가장 긴 장면, 그것도 없으면 첫 장면은 둔다
  const kept = scenes.filter((scene) => !scene.flat && !scene.passing && (!scene.closed || scene.end - scene.start >= params.min || scene.end === scene.start));
  if (kept.length || !done) return kept;
  const colored = scenes.filter((scene) => !scene.flat);
  return colored.length ? [colored.reduce((a, b) => (b.end - b.start > a.end - a.start ? b : a))] : scenes.slice(0, 1);
}

// 일정한 간격으로 뽑을 시각들 (start부터 every초마다, 끝 전까지). 많아도 limit개까지
export function everyTimes(start, duration, every, limit) {
  const times = [];
  const step = Math.max(0.1, every);
  for (let k = 0; k * step < duration - 1e-9 && times.length < limit; k++) times.push(start + Math.round(k * step * 1e6) / 1e6);
  return times;
}
