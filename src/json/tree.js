// JSON 나무(parse.js의 node)에서 무엇을 펼쳐 둘지 정하고, 펼친 대로 화면에 보일 줄을 만든다.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
//
// 펼친 묶음(객체·배열)은 Set(open)에 node째로 넣어 둔다. 줄은 겹쳐 넣지 않고 한 줄씩 나란히 만든다(visibleRows).
// 화면이 줄을 겹쳐 그리면 깊게 겹친 글에서 화면 요소도 그만큼 겹쳐, 브라우저가 느려지거나 멈춘다.

// 묶음 하나에서 한 번에 보이는 항목 수. 나머지는 "더 보기"로 연다
export const CHUNK = 100;
// 한꺼번에 펼칠 때(붙여 넣었을 때, 모두 펼치기, 아래까지 펼치기) 새로 생기는 줄이 이 수를 넘지 않게 한다
export const ROW_BUDGET = 3000;

export const isContainer = (node) => node.type === "object" || node.type === "array";
// 펼칠 수 있는 것: 항목이 있는 객체·배열
export const canOpen = (node) => isContainer(node) && node.children.length > 0;

// 값의 수(객체·배열 자신도 하나로 센다)와 가장 깊이 겹친 단계(값 하나뿐이면 0, {}는 1, {"a":[1]}은 2)
export function stats(root) {
  let values = 0;
  let depth = 0;
  const stack = [[root, 0]];
  while (stack.length) {
    const [node, level] = stack.pop();
    values++;
    if (!isContainer(node)) continue;
    if (level + 1 > depth) depth = level + 1;
    for (const child of node.children) stack.push([child, level + 1]);
  }
  return { values, depth };
}

// start부터 아래로 wanted단계를 펼친다(open에 더한다). 한 단계씩 통째로 펼치고, 그 단계를 펼치면 줄이 budget을 넘으면 거기서 멈춘다.
// 첫 단계(start 자신)는 늘 펼친다. 묶음마다 처음 CHUNK개 항목만 보이므로 그 항목들만 따진다.
// 결과: { levels: 펼친 단계 수, limited: 줄이 많아 덜 펼쳤는지 }
function expandLevels(open, start, wanted, budget) {
  let level = canOpen(start) ? [start] : [];
  let rows = 0;
  let levels = 0;
  while (level.length && levels < wanted) {
    let cost = 0;
    const next = [];
    for (const node of level) {
      const count = Math.min(node.children.length, CHUNK);
      // 항목 줄 + 닫는 줄 (+ 더 보기 줄)
      cost += count + 1 + (node.children.length > CHUNK ? 1 : 0);
      for (let i = 0; i < count; i++) if (canOpen(node.children[i])) next.push(node.children[i]);
    }
    if (levels > 0 && rows + cost > budget) return { levels, limited: true };
    for (const node of level) open.add(node);
    rows += cost;
    levels++;
    level = next;
  }
  return { levels, limited: false };
}

// 처음 wanted단계까지(모두는 Infinity) 펼친 상태를 새로 만든다. 1이면 맨 바깥만 펼친다(모두 접기).
// 결과: { open, levels, limited }
export function openToDepth(root, wanted, budget = ROW_BUDGET) {
  const open = new Set();
  return { open, ...expandLevels(open, root, wanted, budget) };
}

// 묶음 하나를 펼치거나 접는다. 접어도 그 안에서 펼쳐 둔 것은 기억해서, 다시 펼치면 그대로 나온다
export function toggle(open, node) {
  const next = new Set(open);
  if (!next.delete(node)) next.add(node);
  return next;
}

// node와 그 아래를 모두 펼친다 (줄이 budget을 넘지 않는 단계까지). 결과: { open, limited }
export function openUnder(open, node, budget = ROW_BUDGET) {
  const next = new Set(open);
  const { limited } = expandLevels(next, node, Infinity, budget);
  return { open: next, limited };
}

// node와 그 아래를 모두 접는다
export function closeUnder(open, node) {
  const next = new Set(open);
  const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    next.delete(current);
    if (!isContainer(current)) continue;
    for (const child of current.children) if (canOpen(child)) stack.push(child);
  }
  return next;
}

// 줄마다 React key로 쓸 번호. 같은 node는 늘 같은 번호다
const ids = new WeakMap();
let lastId = 0;
function idOf(node) {
  let id = ids.get(node);
  if (!id) {
    id = ++lastId;
    ids.set(node, id);
  }
  return id;
}

// 객체에서 두 번 넘게 나오는 키들 (없으면 null). 화면에 "겹친 키"로 표시한다
const duplicates = new WeakMap();
function duplicateKeys(node) {
  if (!node.keys) return null;
  if (!duplicates.has(node)) {
    const seen = new Set();
    const twice = new Set();
    for (const key of node.keys) (seen.has(key) ? twice : seen).add(key);
    duplicates.set(node, twice.size ? twice : null);
  }
  return duplicates.get(node);
}

// 화면에 보일 줄을 위에서부터 만든다. open: 펼친 묶음들, shown: 묶음마다 보일 항목 수(없으면 CHUNK).
// 줄: { id, kind, node, depth, name, index, dup, comma, count, rest }
//   kind: "value" 값 하나(빈 객체·배열도) · "closed" 접힌 묶음 · "open" 펼친 묶음의 첫 줄 · "end" 펼친 묶음의 닫는 줄
//         · "more" 아직 보이지 않는 항목이 있다는 줄(rest개 남음, node는 그 묶음)
//   name: 객체 안이면 키, index: 배열 안이면 번호, dup: 같은 객체에 같은 키가 또 있는지
//   comma: 줄 끝에 쉼표가 붙는지 (펼친 묶음은 닫는 줄에 붙는다), count: 묶음의 항목 수
export function visibleRows(root, open, shown = new Map()) {
  const rows = [];
  // 펼친 묶음마다 { node, depth, next: 다음에 볼 항목, limit: 보일 항목 수, comma }
  const stack = [];
  const visit = (node, depth, parent, i) => {
    const row = { id: String(idOf(node)), kind: "value", node, depth, comma: parent ? i < parent.children.length - 1 : false };
    if (parent?.keys) {
      row.name = parent.keys[i];
      row.dup = duplicateKeys(parent)?.has(row.name) ?? false;
    } else if (parent) row.index = i;
    if (isContainer(node)) row.count = node.children.length;
    if (canOpen(node)) {
      if (open.has(node)) {
        stack.push({ node, depth, next: 0, limit: Math.min(node.children.length, shown.get(node) ?? CHUNK), comma: row.comma });
        row.kind = "open";
        row.comma = false;
      } else row.kind = "closed";
    }
    rows.push(row);
  };
  visit(root, 0, null, 0);
  while (stack.length) {
    const top = stack.at(-1);
    if (top.next < top.limit) {
      const i = top.next++;
      visit(top.node.children[i], top.depth + 1, top.node, i);
      continue;
    }
    stack.pop();
    const id = idOf(top.node);
    const rest = top.node.children.length - top.limit;
    if (rest > 0) rows.push({ id: `${id}m`, kind: "more", node: top.node, depth: top.depth + 1, rest });
    rows.push({ id: `${id}e`, kind: "end", node: top.node, depth: top.depth, comma: top.comma });
  }
  return rows;
}

// "더 보기"를 눌렀을 때 그 묶음에서 보일 항목 수를 add만큼 늘린 새 Map
export function showMore(shown, node, add) {
  const next = new Map(shown);
  next.set(node, Math.min(node.children.length, (shown.get(node) ?? CHUNK) + add));
  return next;
}
