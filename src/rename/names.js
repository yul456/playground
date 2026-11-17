// 파일 이름 바꾸기의 규칙: 이름 검사, 한꺼번에 고치기(찾아 바꾸기, 틀로 채우기), 바꾸는 순서.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
//
// 크롬·엣지는 고른 폴더 안의 파일 이름을 FileSystemFileHandle.move()로 바꾼다 (복사하지 않고 이름만 바꾼다. disk.js).
// 폴더에 쓸 권한이 있으면 같은 이름의 파일을 말없이 덮어쓰므로(크로미움 GetRenamePermission의 kAllowOverwrite),
// 겹치는 이름은 여기서 미리 막는다.

// 이름을 바탕 이름과 확장자(점 포함)로 나눈다. 확장자는 마지막 점부터이고, 점이 없거나 점으로 시작하는 이름은 확장자가 없다
export function splitName(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? { base: name.slice(0, dot), ext: name.slice(dot) } : { base: name, ext: "" };
}

// 같은 이름인지 견줄 때 쓰는 열쇠. 윈도우와 맥은 대소문자를 가리지 않고, 맥은 한글 자모를 풀어 적은 이름(NFD)도 같은 이름으로 본다
export const nameKey = (name) => name.normalize("NFC").toLowerCase();

// 윈도우가 이름에 받지 않는 글자
const ILLEGAL = /["*/:<>?\\|]/g;
// 줄 바꿈 같은 제어 글자와 보이지 않는 서식 글자. 크롬이 이런 글자가 든 이름을 받지 않는다 (base::i18n::IsFilenameLegal)
const INVISIBLE = /[\p{Cc}\p{Cf}]/gu;
// 윈도우의 장치 이름. 확장자가 붙어도(CON.txt) 쓸 수 없다
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
export const MAX_NAME = 255;

// 이 이름을 쓸 수 없으면 까닭을 돌려준다 (쓸 수 있으면 null). base는 바탕 이름, ext는 그대로 둘 확장자
export function nameProblem(base, ext = "") {
  const name = base + ext;
  if (!base.trim()) return "이름이 비어 있습니다";
  const bad = [...new Set(name.match(ILLEGAL) ?? [])];
  if (bad.length) return `이름에 쓸 수 없는 글자가 있습니다: ${bad.join(" ")}`;
  if (name.search(INVISIBLE) >= 0) return "보이지 않는 글자(줄 바꿈 등)가 들어 있습니다";
  if (/^[\s.~]/.test(name)) return "이름은 빈칸, 점, ~로 시작할 수 없습니다";
  if (/[\s.~]$/.test(name)) return "이름은 빈칸, 점, ~로 끝날 수 없습니다";
  if (RESERVED.test(name.split(".")[0].trim())) return "윈도우에서 쓸 수 없는 이름입니다";
  if (name.length > MAX_NAME) return `이름이 너무 깁니다 (${MAX_NAME}자까지)`;
  return null;
}

// 이름 칸에 친 글에서 이름에 쓸 수 없는 글자를 뺀다. 그런 글자는 처음부터 입력되지 않게 하려는 것이다 (사용자 요청, 2026-11-17).
// 결과: { text: 뺀 글, removed: 뺀 글자를 알리는 말("" 이면 뺀 것이 없다) }
export function cleanName(raw) {
  const text = raw.replace(ILLEGAL, "").replace(INVISIBLE, "");
  if (text === raw) return { text, removed: "" };
  const bad = [...new Set(raw.match(ILLEGAL) ?? [])];
  return { text, removed: bad.length ? bad.join(" ") : "줄 바꿈 같은 보이지 않는 글자" };
}

// 태그 값처럼 밖에서 온 글을 이름에 넣을 때: 쓸 수 없는 글자는 _로 바꾸고 보이지 않는 글자는 뺀다
export const safePart = (text) => String(text ?? "").replace(ILLEGAL, "_").replace(INVISIBLE, "");

// 틀로 만든 이름의 앞뒤를 다듬는다 (앞의 빈칸·점·~, 뒤의 빈칸)
export const tidyBase = (base) => base.replace(/^[\s.~]+/, "").replace(/\s+$/, "");

// 찾아 바꾸기. 정규식이 아니라 글자 그대로 찾고, 찾은 곳을 모두 바꾼다. 찾을 글자가 비면 그대로 둔다
export function replaceText(text, find, replacement, { ignoreCase = false } = {}) {
  if (!find) return text;
  if (!ignoreCase) return text.split(find).join(replacement);
  const lower = text.toLowerCase();
  const needle = find.toLowerCase();
  // 소문자로 바꾸면 길이가 달라지는 드문 글자가 있으면 자리가 어긋나므로 대소문자를 가려서 찾는다
  if (lower.length !== text.length || needle.length !== find.length) return text.split(find).join(replacement);
  let out = "";
  let at = 0;
  for (;;) {
    const hit = lower.indexOf(needle, at);
    if (hit < 0) break;
    out += text.slice(at, hit) + replacement;
    at = hit + needle.length;
  }
  return out + text.slice(at);
}

// 틀의 {칸}을 값으로 바꾼다. values: { 이름: "…", 번호: "001", 제목: "…" }.
// 결과: { text, unknown: 모르는 칸 이름들, used: 쓴 칸 이름들 }
export function fillPattern(pattern, values) {
  const unknown = [];
  const used = [];
  const text = pattern.replace(/\{([^{}]*)\}/g, (whole, inner) => {
    const key = inner.trim();
    if (!Object.hasOwn(values, key)) {
      unknown.push(key);
      return whole;
    }
    used.push(key);
    return values[key] ?? "";
  });
  return { text, unknown, used };
}

// 틀에 적힌 칸 이름들 (값 없이 틀만 보고 안다)
export const patternKeys = (pattern) => [...pattern.matchAll(/\{([^{}]*)\}/g)].map((match) => match[1].trim());

export const padNumber = (n, digits) => String(n).padStart(digits, "0");

// 트랙 번호 칸("3", "3/12")에서 번호만 꺼내 두 자리로 맞춘다. 번호가 아니면 그대로
export function trackNumber(text) {
  const match = /^\s*(\d+)/.exec(text ?? "");
  return match ? match[1].padStart(2, "0") : String(text ?? "").trim();
}

// 맞물린 이름(a ↔ b)을 풀 때 잠깐 쓰는 이름. 확장자는 그대로 둔다 (확장자가 바뀌면 크롬이 파일 검사를 한다)
const tempName = (file, n) => `rename-tmp-${n}${splitName(file.from).ext}`;

// 한 폴더의 이름 바꾸기 계획을 세운다.
//   files:  그 폴더의 모든 파일 [{ id, from: 지금 이름, to: 바꿀 이름 }] (안 바꾸는 파일은 to가 from과 같다)
//   others: 그 폴더에 있는 다른 이름들 (하위 폴더, 목록에 없는 숨김 파일)
// 결과: { problems: Map(id → 까닭), steps: [{ id, name, temp }] }
//   problems에 든 파일은 바꾸지 않는다. steps는 이 순서대로 하나씩 이름을 바꾸면 된다 (temp는 잠깐 쓰는 이름)
export function planRenames(files, others = []) {
  const problems = new Map();
  const taken = new Set(others.map(nameKey));
  // 문제가 생긴 파일은 지금 이름에 그대로 남는다. 그러면 그 이름으로 가려던 다른 파일이 새로 걸릴 수 있어, 더 걸리는 것이 없을 때까지 다시 본다
  for (;;) {
    const before = new Set(problems.keys());
    const stays = (file) => before.has(file.id) || file.to === file.from;
    const targets = new Map();
    for (const file of files) {
      const key = nameKey(stays(file) ? file.from : file.to);
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push(file);
    }
    for (const file of files) {
      if (stays(file)) continue;
      const key = nameKey(file.to);
      if (taken.has(key)) {
        problems.set(file.id, "같은 이름의 폴더나 숨김 파일이 있습니다");
        continue;
      }
      const same = targets.get(key).filter((other) => other !== file);
      if (same.length) problems.set(file.id, same.some(stays) ? "같은 이름의 파일이 이미 있습니다" : "다른 파일과 같은 이름이 됩니다");
    }
    if (problems.size === before.size) break;
  }

  // 순서: 가려는 이름을 다른 파일이 아직 쓰고 있으면 그 파일이 먼저 비켜야 한다. 서로 맞물리면 하나를 임시 이름에 둔다
  const pending = files.filter((file) => file.to !== file.from && !problems.has(file.id)).map((file) => ({ ...file, now: file.from }));
  const holder = new Map();
  for (const file of files) holder.set(nameKey(file.from), file.id);
  const steps = [];
  let count = 0;
  while (pending.length) {
    const index = pending.findIndex((file) => {
      const by = holder.get(nameKey(file.to));
      return by === undefined || by === file.id;
    });
    if (index >= 0) {
      const [file] = pending.splice(index, 1);
      holder.delete(nameKey(file.now));
      holder.set(nameKey(file.to), file.id);
      steps.push({ id: file.id, name: file.to, temp: false });
      continue;
    }
    const file = pending[0];
    let name;
    do {
      count++;
      name = tempName(file, count);
    } while (holder.has(nameKey(name)) || taken.has(nameKey(name)));
    holder.delete(nameKey(file.now));
    holder.set(nameKey(name), file.id);
    file.now = name;
    steps.push({ id: file.id, name, temp: true });
  }
  return { problems, steps };
}
