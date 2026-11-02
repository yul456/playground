// 칸 경계가 바늘을 지날 때 내는 딸깍 소리와 진동.
// 소리는 파일 없이 Web Audio로 만든다. 진동은 지원하는 기기(안드로이드 크롬 등)에서만 나고, 아이폰은 진동 API가 없다

const VOLUME = 0.3;
const CLICK_SECONDS = 0.03;
const VIBRATE_MS = 10;
// 빨리 돌 때 진동이 끊김 없이 이어져 한 덩어리가 되지 않도록 진동 사이를 이만큼 띄운다
const VIBRATE_GAP_MS = 70;

let context = null;
let output = null;
let click = null;
let lastVibrate = -Infinity;

// 딸깍 한 번: 부딪히는 순간의 아주 짧은 잡음과 금방 사라지는 높은 울림을 섞는다
function makeClick(ctx) {
  const rate = ctx.sampleRate;
  const buffer = ctx.createBuffer(1, Math.round(rate * CLICK_SECONDS), rate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / rate;
    const hit = (Math.random() * 2 - 1) * Math.exp(-t / 0.0012);
    const ring = Math.sin(2 * Math.PI * 1600 * t) * Math.exp(-t / 0.006);
    data[i] = 0.5 * hit + 0.5 * ring;
  }
  return buffer;
}

// 브라우저는 사용자가 누르기 전에는 소리를 막으므로 돌리기 버튼이나 소리 켜기를 누른 그때 부른다
export function unlockSound() {
  if (!window.AudioContext) return;
  if (!context) {
    context = new AudioContext();
    output = context.createGain();
    output.gain.value = VOLUME;
    output.connect(context.destination);
    click = makeClick(context);
  }
  if (context.state !== "running") context.resume();
}

export function playTick() {
  // 잠든(suspended) 동안 예약한 소리는 깨어날 때 한꺼번에 나므로 소리가 나는 상태일 때만 낸다
  if (context?.state === "running") {
    const source = context.createBufferSource();
    source.buffer = click;
    // 매번 똑같으면 기계음처럼 들리므로 높낮이를 조금씩 바꾼다
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    source.connect(output);
    source.start();
  }
  const now = performance.now();
  if (navigator.vibrate && now - lastVibrate >= VIBRATE_GAP_MS) {
    lastVibrate = now;
    navigator.vibrate(VIBRATE_MS);
  }
}
