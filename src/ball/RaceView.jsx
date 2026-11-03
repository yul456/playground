import { useEffect, useRef, useState } from "react";
import { BALL_RADIUS, bottomOf, GATE_Y, TOP_Y, WIDTH } from "./courses/kit.js";

// 당첨이 곧 정해질 때 느리게 보여 주는 배속
const SLOW = 0.3;
// 따라가는 구슬을 화면 위에서 이만큼 내려온 곳에 둔다 (화면 높이 비율)
const FOCUS_AT = 0.42;
// 지도에서 고른 곳으로 화면이 옮겨 가는 빠르기 (구슬을 따라갈 때는 4)
const LOOK_RATE = 12;
// 캔버스 이름표에 쓰는 최대 글자 수. 전체 이름은 아래 목록에 나온다
const LABEL_CHARS = 8;

const BUMPER_COLOR = "#f59e0b";
const BUMPER_FLASH = "#fde047";
const WINNER_RING = "#f59e0b";

// 화면 색은 CSS 변수에서 읽는다. 어두운 화면 설정을 바꾸면 다시 읽는다
function readColors(el) {
  const css = getComputedStyle(el);
  const v = (name) => css.getPropertyValue(name).trim();
  return { bg: v("--bg"), card: v("--card"), text: v("--text"), muted: v("--muted"), border: v("--border"), accent: v("--accent"), font: css.fontFamily };
}

// 캔버스 실제 픽셀 크기를 화면 크기에 맞추고, 1m가 몇 px인지(s)와 화면에 보이는 높이(m)를 돌려준다
function fit(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const s = w / WIDTH;
  return { w, h, dpr, s, vh: h / s };
}

const clampCamera = (y, vh, bottom) => Math.min(Math.max(y, TOP_Y), Math.max(TOP_Y, bottom - vh));

// 높이 span 안에 구슬이 가장 많이 들어가는 구간의 가운데. 수가 같으면 결승선에 가까운 쪽
function crowdY(balls, span) {
  const ys = balls.map((m) => m.y).sort((a, b) => a - b);
  let best = { count: 0, y: ys[0] };
  for (let i = 0, j = 0; i < ys.length; i++) {
    while (ys[i] - ys[j] > span) j++;
    if (i - j + 1 >= best.count) best = { count: i - j + 1, y: (ys[i] + ys[j]) / 2 };
  }
  return best.y;
}

// 화면이 맞출 높이(y)와 그 높이를 화면 위에서부터 어디쯤(at, 비율) 둘지.
// 고른 이름 → 당첨 구슬 → 규칙에 따라 정한다. 고른 이름의 구슬이 여러 개면 결승선에 가장 가까운 구슬을 따라간다.
// "마지막까지 남은 구슬"이면 누가 남을지가 볼거리라 구슬이 가장 많이 모인 곳을, "가장 먼저 도착한 구슬"이면
// 결승선에 가장 가까운 구슬을 따라간다
function focusOf(race, follow, vh) {
  if (!race.started) return null;
  const chosen = follow != null ? race.groups[follow].balls.filter((m) => !m.finish) : [];
  if (chosen.length) return { y: Math.max(...chosen.map((m) => m.y)), at: FOCUS_AT };
  if (race.winner) return { y: race.winner.y, at: 0.5 };
  if (race.mode === "last") return { y: crowdY(race.running(), vh * 0.8), at: 0.5 };
  return { y: race.leader().y, at: FOCUS_AT };
}

const shortName = (name) => ([...name].length > LABEL_CHARS ? `${[...name].slice(0, LABEL_CHARS - 1).join("")}…` : name);

function circle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, 2 * Math.PI);
}

function drawCourse(ctx, race, view, camY, colors) {
  const { s } = view;
  const { goalY, segments, pins } = race.course;
  const X = (x) => x * s;
  const Y = (y) => (y - camY) * s;
  const top = camY - 1;
  const bottom = camY + view.vh + 1;
  const visible = (y1, y2) => Math.max(y1, y2) >= top && Math.min(y1, y2) <= bottom;

  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, view.w, view.h);

  // 결승선: 체크무늬 띠
  if (visible(goalY, goalY + 1)) {
    const cell = 0.5;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col * cell < WIDTH; col++) {
        ctx.fillStyle = (row + col) % 2 ? colors.text : colors.card;
        ctx.fillRect(X(col * cell), Y(goalY + row * cell), cell * s + 0.5, cell * s + 0.5);
      }
    }
  }

  // 출발 전: 구슬이 서 있는 출발선
  if (!race.started && visible(GATE_Y, GATE_Y)) {
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(0, Y(GATE_Y));
    ctx.lineTo(view.w, Y(GATE_Y));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = colors.muted;
  ctx.lineWidth = Math.max(2, 0.12 * s);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const [[x1, y1], [x2, y2]] of segments) {
    if (!visible(y1, y2)) continue;
    ctx.moveTo(X(x1), Y(y1));
    ctx.lineTo(X(x2), Y(y2));
  }
  ctx.stroke();

  ctx.fillStyle = colors.muted;
  for (const [x, y, r] of pins) {
    if (!visible(y - r, y + r)) continue;
    circle(ctx, X(x), Y(y), Math.max(1.5, r * s));
    ctx.fill();
  }

  for (const bumper of race.bumpers) {
    if (!visible(bumper.y - bumper.r, bumper.y + bumper.r)) continue;
    const flash = race.time - bumper.hitAt < 0.15;
    ctx.fillStyle = flash ? BUMPER_FLASH : BUMPER_COLOR;
    circle(ctx, X(bumper.x), Y(bumper.y), bumper.r * s * (flash ? 1.08 : 1));
    ctx.fill();
    ctx.fillStyle = colors.card;
    circle(ctx, X(bumper.x), Y(bumper.y), bumper.r * s * 0.45);
    ctx.fill();
  }

  for (const spinner of race.spinners) {
    if (!visible(spinner.y - spinner.half, spinner.y + spinner.half)) continue;
    ctx.save();
    ctx.translate(X(spinner.x), Y(spinner.y));
    ctx.rotate(spinner.body.getAngle());
    ctx.fillStyle = colors.accent;
    for (let i = 0; i < spinner.arms; i++) {
      ctx.beginPath();
      ctx.roundRect(-spinner.half * s, -0.15 * s, spinner.half * 2 * s, 0.3 * s, 0.15 * s);
      ctx.fill();
      ctx.rotate(Math.PI / spinner.arms);
    }
    ctx.restore();
    ctx.fillStyle = colors.text;
    circle(ctx, X(spinner.x), Y(spinner.y), 0.2 * s);
    ctx.fill();
  }
}

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawBalls(ctx, race, view, camY, colors, follow, spinNumbers, now) {
  const { s } = view;
  const r = BALL_RADIUS * s;
  const top = camY - 2;
  const bottom = camY + view.vh + 2;
  const shown = race.balls.filter((m) => (!m.finish || m === race.winner) && m.y >= top && m.y <= bottom);
  const important = (m) => m === race.winner || m.group === follow;
  ctx.textAlign = "center";
  ctx.lineJoin = "round";

  // 고른 구슬과 당첨 구슬은 다른 구슬에 가리지 않게 마지막에 그린다
  for (const m of [...shown].sort((a, b) => important(a) - important(b))) {
    const x = m.x * s;
    const y = (m.y - camY) * s;
    if (m === race.winner) {
      ctx.strokeStyle = WINNER_RING;
      ctx.lineWidth = 3;
      circle(ctx, x, y, r + 5 + 3 * Math.sin(now / 160));
      ctx.stroke();
    } else if (m.group === follow) {
      ctx.strokeStyle = colors.accent;
      ctx.lineWidth = 2.5;
      circle(ctx, x, y, r + 4);
      ctx.stroke();
    }
    ctx.fillStyle = m.color;
    circle(ctx, x, y, r);
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 구르는 것이 보이도록 테두리 안쪽에 구슬과 함께 도는 흰 줄을 긋는다
    ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.beginPath();
    ctx.arc(x, y, r * 0.75, m.angle, m.angle + 0.9);
    ctx.stroke();
    // 구슬 번호. 아래 목록의 번호와 같아서 이름표가 안 보일 때도 누구인지 알 수 있다 (구슬이 너무 작으면 생략).
    // spinNumbers면 구슬과 함께 돌고, 아니면 늘 똑바로 서 있어 읽기 쉽다
    if (r >= 8) {
      ctx.save();
      ctx.translate(x, y);
      if (spinNumbers) ctx.rotate(m.angle);
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${Math.round(r * 0.95)}px ${colors.font}`;
      ctx.textBaseline = "middle";
      ctx.fillText(String(m.number), 0, 0.5);
      ctx.restore();
    }
  }

  // 이름표는 다른 이름표나 구슬을 가리지 않는 것만 단다. 당첨·고른 구슬, 그다음 결승선에 가까운 구슬부터
  // 자리를 주고, 위가 막히면 아래에 단다
  const fontPx = Math.round(Math.min(13, Math.max(10, s * 0.36)));
  ctx.font = `600 ${fontPx}px ${colors.font}`;
  ctx.textBaseline = "top";
  const placed = shown.map((m) => ({ x: m.x * s - r, y: (m.y - camY) * s - r, w: r * 2, h: r * 2 }));
  for (const m of [...shown].sort((a, b) => important(b) - important(a) || b.y - a.y)) {
    const label = m === race.winner ? `🏆 ${shortName(m.name)}` : shortName(m.name);
    const w = ctx.measureText(label).width + 4;
    const x = m.x * s;
    const y = (m.y - camY) * s;
    for (const boxY of [y - r - fontPx - 4, y + r + 2]) {
      const box = { x: x - w / 2, y: boxY, w, h: fontPx + 2 };
      if (placed.some((p) => overlaps(p, box))) continue;
      placed.push(box);
      ctx.lineWidth = 3;
      ctx.strokeStyle = colors.bg;
      ctx.strokeText(label, x, boxY + 1);
      ctx.fillStyle = colors.text;
      ctx.fillText(label, x, boxY + 1);
      break;
    }
  }
}

// 오른쪽 좁은 띠에 코스 전체와 구슬 위치, 지금 보고 있는 범위를 줄여 그린다
function drawMinimap(mini, race, view, camY, colors, follow) {
  const dpr = window.devicePixelRatio || 1;
  const w = mini.clientWidth;
  const h = mini.clientHeight;
  if (mini.width !== Math.round(w * dpr) || mini.height !== Math.round(h * dpr)) {
    mini.width = Math.round(w * dpr);
    mini.height = Math.round(h * dpr);
  }
  const ctx = mini.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const kx = w / WIDTH;
  const ky = h / (bottomOf(race.course) - TOP_Y);
  const X = (x) => x * kx;
  const Y = (y) => (y - TOP_Y) * ky;
  ctx.fillStyle = colors.card;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = colors.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [[x1, y1], [x2, y2]] of race.course.segments) {
    ctx.moveTo(X(x1), Y(y1));
    ctx.lineTo(X(x2), Y(y2));
  }
  ctx.stroke();
  ctx.fillStyle = BUMPER_COLOR;
  for (const bumper of race.bumpers) ctx.fillRect(X(bumper.x) - 1.5, Y(bumper.y) - 1.5, 3, 3);
  ctx.fillStyle = colors.text;
  ctx.fillRect(0, Y(race.course.goalY), w, 2);

  ctx.globalAlpha = 0.15;
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, Y(camY), w, view.vh * ky);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.accent;
  ctx.strokeRect(0.5, Y(camY) + 0.5, w - 1, view.vh * ky - 1);

  for (const m of race.balls) {
    if (m.finish && m !== race.winner) continue;
    const big = m.group === follow || m === race.winner;
    ctx.fillStyle = m.color;
    circle(ctx, X(m.x), Y(m.y), big ? 3.5 : 2.5);
    ctx.fill();
  }
}

// 코스와 구슬을 그리고, 화면이 구슬을 따라 내려간다. 경주 계산(race.step)도 여기서 화면 프레임마다 진행한다.
// follow: 따라갈 이름 묶음 번호(race.groups 순서, 없으면 자동), spinNumbers: 구슬 번호도 구슬과 함께 돌릴지,
// slowMotion: 당첨이 곧 정해질 때 느리게 보여 줄지, onEvents: 도착·당첨 같은 일이 생기면 부른다
export default function RaceView({ race, follow, spinNumbers, slowMotion, onEvents }) {
  const canvasRef = useRef(null);
  const miniRef = useRef(null);
  // 애니메이션 도중에 바뀌어도 마지막 값을 쓰도록 ref에 담는다
  const followRef = useRef(follow);
  followRef.current = follow;
  const spinNumbersRef = useRef(spinNumbers);
  spinNumbersRef.current = spinNumbers;
  const slowMotionRef = useRef(slowMotion);
  slowMotionRef.current = slowMotion;
  const onEventsRef = useRef(onEvents);
  onEventsRef.current = onEvents;
  // 오른쪽 지도를 눌러 직접 고른 곳(코스 y, 화면 가운데에 둔다). null이면 자동으로 따라간다.
  // 끄는 동안 프레임마다 바뀌므로 ref에 두고, "자동으로 보기" 버튼을 보일지만 상태로 둔다
  const lookRef = useRef(null);
  const [looking, setLooking] = useState(false);
  const look = (y) => {
    lookRef.current = y;
    setLooking(y != null);
  };

  // 이름을 고르거나 풀면 직접 보던 곳 대신 그 이름(또는 자동)을 따라간다
  useEffect(() => look(null), [follow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const mini = miniRef.current;
    const ctx = canvas.getContext("2d");
    let colors = readColors(canvas);
    const scheme = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => {
      colors = readColors(canvas);
    };
    scheme.addEventListener("change", onScheme);

    look(null);
    let started = race.started;
    let decided = Boolean(race.winner);
    let camY = TOP_Y;
    let speed = 1;
    let last = performance.now();
    let frame = 0;
    const loop = (now) => {
      // 탭을 가렸다 돌아오면 그 사이 시간은 건너뛴다
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // 계산은 늘 같은 간격으로 하고 보여 주는 속도만 바꾸므로, 슬로 모션을 켜든 끄든 결과는 같다
      speed += ((slowMotionRef.current && race.isDeciding() ? SLOW : 1) - speed) * Math.min(1, dt * 5);
      const events = race.step(dt * speed);
      if (events.length) onEventsRef.current(events);
      // 출발하거나 당첨이 정해지면 직접 보던 곳 대신 경주를 따라간다
      if (race.started !== started || Boolean(race.winner) !== decided) {
        started = race.started;
        decided = Boolean(race.winner);
        look(null);
      }

      const view = fit(canvas);
      const bottom = bottomOf(race.course);
      let target;
      if (lookRef.current != null) {
        target = clampCamera(lookRef.current - view.vh / 2, view.vh, bottom);
      } else {
        const focus = focusOf(race, followRef.current, view.vh);
        target = clampCamera(focus ? focus.y - view.vh * focus.at : TOP_Y, view.vh, bottom);
      }
      // 지도에서 고른 곳으로는 손가락을 따라가도록 빠르게 옮긴다
      camY += (target - camY) * (1 - Math.exp(-dt * (lookRef.current != null ? LOOK_RATE : 4)));

      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
      drawCourse(ctx, race, view, camY, colors);
      drawBalls(ctx, race, view, camY, colors, followRef.current, spinNumbersRef.current, now);
      drawMinimap(mini, race, view, camY, colors, followRef.current);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(frame);
      scheme.removeEventListener("change", onScheme);
    };
  }, [race]);

  // 지도에서 누르거나 끄는 높이를 코스 y로 바꿔 그곳을 보여 준다
  function lookAt(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    look(TOP_Y + ratio * (bottomOf(race.course) - TOP_Y));
  }

  return (
    <div className="race-stage">
      <div className="race-main">
        <canvas ref={canvasRef} className="race-canvas" role="img" aria-label="구슬 레이스 코스" />
        {looking && (
          <button type="button" className="race-auto" onClick={() => look(null)}>
            자동으로 보기
          </button>
        )}
      </div>
      <canvas
        ref={miniRef}
        className="race-minimap"
        aria-hidden="true"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          lookAt(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && lookAt(e)}
      />
    </div>
  );
}
