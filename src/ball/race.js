// 구슬 레이스 규칙: 이름마다 구슬을 하나씩 출발선에 세우고, 출발하면 물리 엔진(planck, Box2D)으로 굴린다.
// 결승선을 지난 구슬은 차례로 빠지고, mode가 "last"면 마지막까지 남은 구슬, "first"면 가장 먼저 도착한 구슬이 당첨이다.
// 출발 자리(slots)는 부르는 쪽이 무작위로 섞어 넘긴다. 코스가 어느 자리에 유리하든 자리를 고르게 섞으므로
// 누구나 당첨될 확률이 같다. 화면과 상관없는 계산만 있어 Node에서도 돌릴 수 있다
import { Box, Circle, Edge, World } from "planck";
import { BALL_RADIUS, GATE_Y, TOP_Y, WIDTH } from "./courses/kit.js";

export const MIN_BALLS = 2;
export const MAX_BALLS = 30;
// 출발선 한 줄에 세우는 구슬 수. 넘으면 그 위에 한 줄 더 세운다
const ROW_SIZE = 15;

// 물리 계산 간격(초). 화면 프레임과 상관없이 늘 같은 간격으로 계산한다
const STEP = 1 / 120;
// 중력(m/s², 아래쪽)의 기본값과 화면에서 고를 수 있는 범위. 기본값은 지구 중력(9.8)의 약 1.7배다.
// 구슬이 계산상 지름 0.76m로 커서, 중력이 약하면 큰 공이 느린 화면으로 떨어지듯 둥둥 떠 보인다
export const GRAVITY = 17;
export const MIN_GRAVITY = 8;
export const MAX_GRAVITY = 34;
// 너무 빨라지면 핀을 건너뛰고 화면에서 따라가기 어렵다
const MAX_SPEED = 20;
// 범퍼에 닿은 구슬은 적어도 이 속도(m/s)로 튕겨 나간다
const BUMPER_KICK = 7;
// 이 시간(초) 동안 이 거리(m)도 못 움직이면 끼인 것으로 보고 살짝 튕겨 준다
const STUCK_SECONDS = 2.5;
const STUCK_DISTANCE = 0.5;
// 그래도 끝나지 않으면 이 시간(초)에 결승선에 가까운 순서로 끝낸다
const TIME_LIMIT = 150;
// 당첨이 정해지기 직전으로 보는 결승선까지 거리(m). 화면을 느리게 보여 준다
const CLOSE_TO_GOAL = 7;

// 흰 이름표 옆에서도 잘 보이는 진한 색. 이웃한 색이 비슷하지 않게 섞어 둔다
const COLORS = [
  "#e11d48", "#2563eb", "#16a34a", "#ea580c", "#7c3aed", "#0891b2", "#db2777", "#65a30d",
  "#4f46e5", "#ca8a04", "#0d9488", "#9333ea", "#dc2626", "#0284c7", "#059669", "#c2410c",
];

// 출발 자리 slot(0부터)의 구슬 위치. 구슬 수와 상관없이 같은 간격으로 가운데에 모아 세운다.
// 적을 때 코스 폭 전체에 벌려 세우면 양 끝 구슬이 깔때기까지 늦게 와서 꼴찌가 되기 쉬웠다
const START_GAP = (WIDTH - 2) / ROW_SIZE;
export function startPosition(slot, count) {
  const row = Math.floor(slot / ROW_SIZE);
  const inRow = Math.min(ROW_SIZE, count - row * ROW_SIZE);
  return {
    x: WIDTH / 2 + ((slot % ROW_SIZE) - (inRow - 1) / 2) * START_GAP,
    y: GATE_Y - BALL_RADIUS - row * (BALL_RADIUS * 2 + 0.12),
  };
}

// course(courses/ 폴더의 코스 데이터)에서 names[i]의 구슬은 출발 자리 slots[i]에 선다.
// random은 출발 위치·미는 힘·바람개비 시작 각도처럼 판마다 모양을 다르게 하는 데만 쓴다
export function createRace({ names, slots, course, mode = "last", gravity = GRAVITY, random = Math.random }) {
  const world = new World({ gravity: { x: 0, y: gravity } });

  const ground = world.createBody();
  for (const [[x1, y1], [x2, y2]] of course.segments) {
    ground.createFixture({ shape: new Edge({ x: x1, y: y1 }, { x: x2, y: y2 }), friction: 0.03, restitution: 0.25 });
  }
  for (const [x, y, r] of course.pins) {
    ground.createFixture({ shape: new Circle({ x, y }, r), restitution: 0.4 });
  }
  const bumpers = course.bumpers.map(([x, y, r]) => {
    const bumper = { kind: "bumper", x, y, r, hitAt: -Infinity };
    ground.createFixture({ shape: new Circle({ x, y }, r), restitution: 0.8, userData: bumper });
    return bumper;
  });
  // 바람개비는 판마다 다른 각도에서 시작한다. 같은 자리에서 출발해도 매번 다르게 흘러가게 한다
  const spinners = course.spinners.map((spec) => {
    const body = world.createKinematicBody({ position: { x: spec.x, y: spec.y }, angle: random() * Math.PI });
    const arms = spec.arms ?? 1;
    // 막대가 여러 개면(십자 등) 같은 축에 고르게 돌려 붙인다
    for (let i = 0; i < arms; i++) {
      body.createFixture({ shape: new Box(spec.half, 0.15, { x: 0, y: 0 }, (i * Math.PI) / arms), friction: 0.1, restitution: 0.4 });
    }
    if (!spec.swing) body.setAngularVelocity(spec.speed);
    // swing이면 tick마다 속도를 바꿔 좌우로 흔든다. 흔드는 박자도 판마다 다르게 시작한다
    return { ...spec, arms, body, phase: random() * 2 * Math.PI };
  });

  // 같은 이름은 한 사람의 구슬 여러 개로 보고 같은 색·번호를 준다. 번호는 이름이 처음 나온 순서다.
  // groups[i] = { index, name, number, color, balls }
  const groups = [];
  const groupIndex = new Map();
  for (const name of names) {
    if (groupIndex.has(name)) continue;
    groupIndex.set(name, groups.length);
    groups.push({ index: groups.length, name, number: groups.length + 1, color: COLORS[groups.length % COLORS.length], balls: [] });
  }

  const balls = names.map((name, id) => {
    const group = groups[groupIndex.get(name)];
    const at = startPosition(slots[id], names.length);
    at.x += (random() - 0.5) * 0.16;
    // 출발할 때 옆으로 조금씩 다르게 밀어 준다. 자리만으로 결과가 거의 정해지지 않게 한다
    const push = { x: (random() - 0.5) * 3, y: random() };
    const body = world.createDynamicBody({ position: at, linearVelocity: push, linearDamping: 0.08, angularDamping: 0.5, allowSleep: false });
    // x·y·angle: 마지막으로 계산한 위치와 구른 각도(라디안), finish: 도착하면 { order, time }, anchor·movedAt: 끼임 확인용
    const ball = {
      kind: "ball",
      id,
      name,
      group: group.index,
      number: group.number,
      color: group.color,
      body,
      x: at.x,
      y: at.y,
      angle: 0,
      finish: null,
      anchor: at,
      movedAt: 0,
    };
    body.createFixture({ shape: new Circle(BALL_RADIUS), density: 1, friction: 0.02, restitution: 0.35, userData: ball });
    group.balls.push(ball);
    return ball;
  });

  // 물리 계산 도중에는 속도를 바꾸면 안 되므로 범퍼에 닿은 구슬을 모아 두었다가 계산 뒤에 튕긴다
  const kicks = [];
  world.on("begin-contact", (contact) => {
    const a = contact.getFixtureA().getUserData();
    const b = contact.getFixtureB().getUserData();
    if (a?.kind === "bumper" && b?.kind === "ball") kicks.push([b, a]);
    if (b?.kind === "bumper" && a?.kind === "ball") kicks.push([a, b]);
  });

  const order = [];
  // 코스를 고칠 때 보는 값: 끼여서 튕겨 준 횟수와 자리, 벽을 뚫고 나간 횟수
  const stats = { nudges: 0, stuckAt: [], escapes: 0 };
  let time = 0;
  let pending = 0;
  let started = false;
  let winner = null;

  const running = () => balls.filter((m) => !m.finish);
  const leader = () => running().reduce((a, b) => (a && a.y >= b.y ? a : b), null);

  function kick(m, bumper) {
    const dx = m.x - bumper.x;
    const dy = m.y - bumper.y;
    const d = Math.hypot(dx, dy) || 1;
    const v = m.body.getLinearVelocity();
    const along = (v.x * dx + v.y * dy) / d;
    if (along < BUMPER_KICK) {
      const add = BUMPER_KICK - along;
      m.body.setLinearVelocity({ x: v.x + (dx / d) * add, y: v.y + (dy / d) * add });
    }
    bumper.hitAt = time;
  }

  function move(m, events) {
    const v = m.body.getLinearVelocity();
    const speed = Math.hypot(v.x, v.y);
    if (speed > MAX_SPEED) m.body.setLinearVelocity({ x: (v.x * MAX_SPEED) / speed, y: (v.y * MAX_SPEED) / speed });
    let p = m.body.getPosition();
    // 혹시 벽을 뚫고 나가면 코스 가운데로 되돌린다
    if (p.x < -1 || p.x > WIDTH + 1 || p.y < TOP_Y - 6) {
      m.body.setPosition({ x: WIDTH / 2, y: Math.max(p.y, GATE_Y + 1) });
      m.body.setLinearVelocity({ x: 0, y: 0 });
      p = m.body.getPosition();
      stats.escapes++;
    }
    m.x = p.x;
    m.y = p.y;
    m.angle = m.body.getAngle();
    if (m.y > course.goalY) {
      m.finish = { order: order.length + 1, time };
      order.push(m);
      world.destroyBody(m.body);
      events.push({ type: "finish", ball: m });
      return;
    }
    if (Math.hypot(m.x - m.anchor.x, m.y - m.anchor.y) > STUCK_DISTANCE) {
      m.anchor = { x: m.x, y: m.y };
      m.movedAt = time;
    } else if (time - m.movedAt > STUCK_SECONDS) {
      m.body.setLinearVelocity({ x: (random() - 0.5) * 8, y: -5 });
      m.movedAt = time;
      stats.nudges++;
      stats.stuckAt.push([m.x, m.y]);
    }
  }

  function decide(events) {
    const left = running();
    if (mode === "first" && order.length > 0) winner = order[0];
    else if (mode === "last" && left.length === 1) winner = left[0];
    // 마지막 두 구슬이 같은 계산 간격에 함께 도착하면 나중에 센 구슬을 남은 것으로 본다
    else if (mode === "last" && left.length === 0) winner = order[order.length - 1];
    else if (time > TIME_LIMIT) {
      const byGoal = [...left].sort((a, b) => b.y - a.y);
      winner = mode === "first" ? byGoal[0] : byGoal[byGoal.length - 1];
    }
    if (winner) events.push({ type: "done", winner });
  }

  function tick(events) {
    // 흔들이: 한쪽으로 계속 돌면 위에서 떨어지는 구슬을 늘 같은 쪽으로 쳐 내므로, swing(라디안)만큼 좌우로 왕복한다
    for (const s of spinners) {
      if (s.swing) s.body.setAngularVelocity(s.swing * ((2 * Math.PI) / s.period) * Math.cos((2 * Math.PI * time) / s.period + s.phase));
    }
    world.step(STEP, 8, 3);
    time += STEP;
    for (const [m, bumper] of kicks.splice(0)) if (!m.finish) kick(m, bumper);
    for (const m of balls) if (!m.finish) move(m, events);
    decide(events);
  }

  return {
    course,
    mode,
    balls,
    groups,
    bumpers,
    spinners,
    order,
    stats,
    get time() {
      return time;
    },
    get started() {
      return started;
    },
    get winner() {
      return winner;
    },
    running,
    leader,
    start() {
      started = true;
    },
    // dt초만큼 계산을 진행하고 그동안 생긴 일([{ type: "finish" | "done", ... }])을 돌려준다.
    // 탭을 가렸다 돌아와도 밀린 시간을 한꺼번에 계산하지 않도록 한 번에 0.25초까지만 따라잡는다
    step(dt) {
      const events = [];
      if (!started || winner) return events;
      pending = Math.min(pending + dt, 0.25);
      while (pending >= STEP && !winner) {
        tick(events);
        pending -= STEP;
      }
      return events;
    },
    // 당첨이 곧 정해지는 순간인지. 이때 화면을 느리게 보여 준다
    isDeciding() {
      if (!started || winner) return false;
      const lead = leader();
      if (!lead || lead.y < course.goalY - CLOSE_TO_GOAL) return false;
      return mode === "first" || running().length === 2;
    },
  };
}
