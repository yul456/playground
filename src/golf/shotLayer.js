import * as maplibregl from "maplibre-gl";

// 공 궤적을 지도 안에 3D로 그리는 레이어 (MapLibre 사용자 정의 레이어, WebGL2).
// 지도의 선 레이어는 땅에 붙어서만 그려져서, 공중에 뜬 선은 직접 그린다.
// - 선 굵기는 화면 픽셀로 정해 멀리서도 가까이서도 같은 굵기로 보인다
// - 지형과 앞뒤를 따져("3d") 언덕 뒤로 넘어가는 부분은 가려진다
// - 좌표는 묶음마다 첫 점을 원점으로 한 미터 단위로 넣는다. 지도 좌표(0~1)를 그대로 32비트 실수로 넣으면
//   2m쯤씩 끊겨 공이 덜컹거린다
//
// show(key, arcs, starts)로 묶음(홀, 거리 재기)마다 궤적을 바꾼다. arcs[i]는
// { points: [[경도, 위도]…], heights: [그릴 높이(m)…], ground: [그 아래 땅 높이(m)…], ms }이고,
// starts[i] 시각(performance.now 기준)부터 ms 동안 공이 날아가며 선을 그린다. starts가 없거나 null인 궤적은 다 그린 채로 둔다

const LINE_VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform vec2 u_half;
uniform float u_width;
in vec3 a_pos;
in vec3 a_next;
in float a_side;
in float a_t;
out float v_t;
void main() {
  v_t = a_t;
  vec4 p = u_matrix * vec4(a_pos, 1.0);
  vec4 q = u_matrix * vec4(a_next, 1.0);
  if (p.w <= 0.0 || q.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 d = (q.xy / q.w - p.xy / p.w) * u_half;
  vec2 dir = length(d) > 0.0001 ? normalize(d) : vec2(1.0, 0.0);
  vec2 offset = vec2(-dir.y, dir.x) * a_side * u_width * 0.5 / u_half;
  gl_Position = vec4(p.xy + offset * p.w, p.z, p.w);
}`;

const LINE_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 u_color;
uniform float u_reveal;
in float v_t;
out vec4 fragColor;
void main() {
  if (v_t > u_reveal) discard;
  fragColor = u_color;
}`;

const POINT_VERTEX = `#version 300 es
uniform mat4 u_matrix;
uniform float u_size;
in vec3 a_pos;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  gl_PointSize = u_size;
}`;

const POINT_FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 u_fill;
uniform vec4 u_ring;
uniform float u_ring_at;
out vec4 fragColor;
void main() {
  float r = length(gl_PointCoord * 2.0 - 1.0);
  if (r > 1.0) discard;
  fragColor = (r > u_ring_at ? u_ring : u_fill) * (1.0 - smoothstep(0.86, 1.0, r));
}`;

// 색은 투명도를 미리 곱한 값이다 (지도가 그렇게 섞는다). 크기는 CSS 픽셀.
// 선은 빨강에 흰 테두리다. 흰 선은 바탕 지도의 길(흰 선에 회색 테두리)과 헷갈렸다
const OUTLINE = { width: 6, color: [0.75, 0.75, 0.75, 0.75] };
const CORE = { width: 3, color: [0.94, 0.27, 0.27, 1] };
const BALL = { size: 12, fill: [1, 1, 1, 1], ring: [0.11, 0.15, 0.2, 1], ringAt: 0.7 };
const SHADOW = { size: 9, fill: [0, 0, 0, 0.3], ring: [0, 0, 0, 0.3], ringAt: 1 };
// 공 그림자를 땅보다 조금 띄워 지형에 묻히지 않게 한다 (m)
const SHADOW_LIFT = 0.6;
// 선 꼭짓점 하나: 위치 3, 다음 점 3, 왼쪽·오른쪽 1, 궤적에서의 위치(0~1) 1
const STRIDE = 8;

function compile(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertexSource],
    [gl.FRAGMENT_SHADER, fragmentSource],
  ]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(`공 궤적 셰이더: ${gl.getShaderInfoLog(shader)}`);
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`공 궤적 셰이더: ${gl.getProgramInfoLog(program)}`);
  const locations = {};
  const uniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uniforms; i++) {
    const { name } = gl.getActiveUniform(program, i);
    locations[name] = gl.getUniformLocation(program, name);
  }
  const attributes = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < attributes; i++) {
    const { name } = gl.getActiveAttrib(program, i);
    locations[name] = gl.getAttribLocation(program, name);
  }
  return { program, locations };
}

// 지도 행렬(0~1 지도 좌표 → 화면)에 원점 이동과 미터 크기를 곱한다. 64비트로 계산한 뒤 32비트로 넘긴다.
// 지도 좌표의 y는 남쪽으로 커지므로 북쪽(+y) 미터를 뒤집는다
function localMatrix(m, { ox, oy, scale }) {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) {
    out[r] = m[r] * scale;
    out[4 + r] = -m[4 + r] * scale;
    out[8 + r] = m[8 + r] * scale;
    out[12 + r] = m[r] * ox + m[4 + r] * oy + m[12 + r];
  }
  return out;
}

const lerp = (a, b, t) => a + (b - a) * t;

export function createShotLayer() {
  let map = null;
  let gl = null;
  let line = null;
  let point = null;
  let pointBuffer = null;
  let pointVao = null;
  const groups = new Map();

  function bindLine(group) {
    group.buffer = gl.createBuffer();
    group.vao = gl.createVertexArray();
    gl.bindVertexArray(group.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, group.buffer);
    const { a_pos, a_next, a_side, a_t } = line.locations;
    const bytes = STRIDE * 4;
    for (const [location, size, offset] of [
      [a_pos, 3, 0],
      [a_next, 3, 3],
      [a_side, 1, 6],
      [a_t, 1, 7],
    ]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, bytes, offset * 4);
    }
  }

  function release(group) {
    if (!gl) return;
    if (group.buffer) gl.deleteBuffer(group.buffer);
    if (group.vao) gl.deleteVertexArray(group.vao);
  }

  // 시각 now에 i번 궤적을 얼마나(0~1) 그렸는지. 아직 시작 전이면 0보다 작다
  function revealOf(group, i, now) {
    const start = group.starts?.[i];
    if (start == null) return 1;
    return Math.min(1, (now - start) / group.arcs[i].ms);
  }

  function show(key, arcs, starts = null) {
    const old = groups.get(key);
    if (old) release(old);
    groups.delete(key);
    if (arcs.length) {
      const origin = maplibregl.MercatorCoordinate.fromLngLat(arcs[0].points[0], 0);
      const scale = origin.meterInMercatorCoordinateUnits();
      const local = (lngLat, z) => {
        const m = maplibregl.MercatorCoordinate.fromLngLat(lngLat, 0);
        return [(m.x - origin.x) / scale, (origin.y - m.y) / scale, z];
      };
      const data = [];
      const items = arcs.map((arc) => {
        const first = data.length / STRIDE;
        const pts = arc.points.map((p, i) => local(p, arc.heights[i]));
        const n = pts.length - 1;
        pts.forEach((p, i) => {
          // 마지막 점은 앞 점을 다음 점으로 삼으므로 왼쪽·오른쪽을 뒤집는다
          const next = i < n ? pts[i + 1] : pts[i - 1];
          const flip = i < n ? 1 : -1;
          for (const side of [-1, 1]) data.push(...p, ...next, side * flip, i / n);
        });
        return { first, count: (n + 1) * 2, pts, ground: arc.ground, ms: arc.ms };
      });
      groups.set(key, { ox: origin.x, oy: origin.y, scale, arcs: items, starts, data: new Float32Array(data), buffer: null, vao: null });
    }
    map?.triggerRepaint();
  }

  const clear = (key) => show(key, []);

  const layer = {
    id: "golf-shots",
    type: "custom",
    renderingMode: "3d",
    onAdd(mapInstance, context) {
      map = mapInstance;
      gl = context;
      line = compile(gl, LINE_VERTEX, LINE_FRAGMENT);
      point = compile(gl, POINT_VERTEX, POINT_FRAGMENT);
      pointBuffer = gl.createBuffer();
      pointVao = gl.createVertexArray();
      gl.bindVertexArray(pointVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
      gl.enableVertexAttribArray(point.locations.a_pos);
      gl.vertexAttribPointer(point.locations.a_pos, 3, gl.FLOAT, false, 12, 0);
      gl.bindVertexArray(null);
    },
    onRemove() {
      for (const group of groups.values()) release(group);
      groups.clear();
      gl?.deleteProgram(line?.program);
      gl?.deleteProgram(point?.program);
      gl?.deleteBuffer(pointBuffer);
      gl?.deleteVertexArray(pointVao);
      map = null;
      gl = null;
    },
    render(context, options) {
      if (!groups.size) return;
      const now = performance.now();
      const ratio = map.getPixelRatio();
      const half = [gl.drawingBufferWidth / 2, gl.drawingBufferHeight / 2];
      let moving = false;
      // 지형과 앞뒤는 따지되(지도가 맞춰 둔 깊이 시험), 선끼리 가리지 않게 깊이는 쓰지 않는다
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      for (const group of groups.values()) {
        if (!group.vao) {
          bindLine(group);
          gl.bufferData(gl.ARRAY_BUFFER, group.data, gl.STATIC_DRAW);
        }
        const matrix = localMatrix(options.defaultProjectionData.mainMatrix, group);
        const reveals = group.arcs.map((_, i) => revealOf(group, i, now));
        if (reveals.some((r) => r < 1)) moving = true;

        gl.useProgram(line.program);
        gl.bindVertexArray(group.vao);
        gl.uniformMatrix4fv(line.locations.u_matrix, false, matrix);
        gl.uniform2fv(line.locations.u_half, half);
        for (const style of [OUTLINE, CORE]) {
          gl.uniform1f(line.locations.u_width, style.width * ratio);
          gl.uniform4fv(line.locations.u_color, style.color);
          group.arcs.forEach((arc, i) => {
            if (reveals[i] <= 0) return;
            gl.uniform1f(line.locations.u_reveal, reveals[i]);
            gl.drawArrays(gl.TRIANGLE_STRIP, arc.first, arc.count);
          });
        }

        // 날아가는 중인 공과 그 아래 그림자
        const balls = [];
        const shadows = [];
        group.arcs.forEach((arc, i) => {
          const t = reveals[i];
          if (t <= 0 || t >= 1) return;
          const at = t * (arc.pts.length - 1);
          const k = Math.min(arc.pts.length - 2, Math.floor(at));
          const f = at - k;
          const [x0, y0, z0] = arc.pts[k];
          const [x1, y1, z1] = arc.pts[k + 1];
          const x = lerp(x0, x1, f);
          const y = lerp(y0, y1, f);
          balls.push(x, y, lerp(z0, z1, f));
          shadows.push(x, y, lerp(arc.ground[k], arc.ground[k + 1], f) + SHADOW_LIFT);
        });
        if (balls.length) {
          gl.useProgram(point.program);
          gl.bindVertexArray(pointVao);
          gl.bindBuffer(gl.ARRAY_BUFFER, pointBuffer);
          gl.uniformMatrix4fv(point.locations.u_matrix, false, matrix);
          for (const [style, list] of [
            [SHADOW, shadows],
            [BALL, balls],
          ]) {
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(list), gl.DYNAMIC_DRAW);
            gl.uniform1f(point.locations.u_size, style.size * ratio);
            gl.uniform4fv(point.locations.u_fill, style.fill);
            gl.uniform4fv(point.locations.u_ring, style.ring);
            gl.uniform1f(point.locations.u_ring_at, style.ringAt);
            gl.drawArrays(gl.POINTS, 0, list.length / 3);
          }
        }
      }
      gl.bindVertexArray(null);
      if (moving) map.triggerRepaint();
    },
  };

  return { layer, show, clear };
}
