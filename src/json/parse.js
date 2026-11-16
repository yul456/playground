// JSON 글을 읽어 화면에 보일 나무(node)로 만든다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
//
// 내장 JSON.parse를 쓰지 않고 직접 읽는 까닭 (보는 도구는 글에 적힌 그대로 보여야 한다):
// - 큰 수가 바뀐다: 12345678901234567890 → 12345678901234567000, 0.1234567890123456789 → 0.12345678901234568
// - 키 순서가 바뀐다: 숫자처럼 생긴 키("10", "9")가 크기순으로 맨 앞에 온다
// - 같은 키가 두 번 나오면 앞의 것이 사라진다
// - 틀린 자리를 줄·칸으로 알려 주고, 흔한 실수(작은따옴표, 끝의 쉼표, 주석 등)를 짚어 주려고
// 받아들이는 글은 JSON.parse와 같다(엄격한 JSON). 다만 MAX_DEPTH보다 깊게 겹친 글은 읽지 않는다. 시험에서 둘을 맞춰 본다.
//
// node: { type: "object", keys: [글], children: [node] } (keys[i]가 children[i]의 키. 적힌 순서 그대로이고, 같은 키가 또 나와도 둘 다 둔다)
//     · { type: "array", children: [node] }
//     · { type: "string", value } · { type: "number", raw: 적힌 글 그대로 } · { type: "boolean", value } · { type: "null" }

// index: 틀린 자리(글자 위치). opened: 닫히지 않은 괄호를 연 자리(글이 중간에 끝났거나 다른 괄호로 닫았을 때)
export class JsonError extends Error {
  constructor(message, index, opened = null) {
    super(message);
    this.name = "JsonError";
    this.index = index;
    this.opened = opened;
  }
}

// 객체·배열을 이보다 깊게 겹친 글은 읽지 않는다. 겹친 만큼 함수를 겹쳐 불러서, 너무 깊으면 브라우저의 호출 한계를 넘는다
export const MAX_DEPTH = 500;

const isDigit = (code) => code >= 48 && code <= 57;
const isLowSurrogate = (code) => code >= 0xdc00 && code <= 0xdfff;
const isHighSurrogate = (code) => code >= 0xd800 && code <= 0xdbff;
// 눈에 안 보이지만 JSON이 빈 곳으로 치지 않는 글자 (줄 바꿈 없는 공백, 폭 없는 공백, 전각 공백 등)
const isInvisible = (code) =>
  code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200d) || code === 0x2028 || code === 0x2029 ||
  code === 0x202f || code === 0x205f || code === 0x2060 || code === 0x3000 || code === 0xfeff;
const WORD = /^[\p{L}_$][\p{L}\p{N}_$]*/u;
const ESCAPES = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };
const clip = (word) => (word.length > 30 ? `${word.slice(0, 30)}…` : word);

export function parseJson(text, { maxDepth = MAX_DEPTH } = {}) {
  const length = text.length;
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0; // 맨 앞의 BOM은 건너뛴다
  const opens = []; // 아직 닫히지 않은 괄호를 연 자리

  // 글이 끝난 자리에서 틀렸으면 닫히지 않은 괄호를 연 자리도 알린다
  const fail = (message, index = at, opened = index >= length ? (opens.at(-1) ?? null) : null) => {
    throw new JsonError(message, index, opened);
  };

  // 빈칸, 탭, 줄바꿈 (JSON이 빈 곳으로 치는 네 글자)
  const skip = () => {
    for (; at < length; at++) {
      const code = text.charCodeAt(at);
      if (code !== 32 && code !== 10 && code !== 13 && code !== 9) break;
    }
  };

  // 지금 자리에서 값이 시작되는지 (쉼표가 빠졌는지 알아보는 데 쓴다)
  const valueAhead = () => {
    const code = text.charCodeAt(at);
    if (code === 34 || code === 123 || code === 91 || code === 45 || isDigit(code)) return true;
    return text.startsWith("true", at) || text.startsWith("false", at) || text.startsWith("null", at);
  };

  // 지금 자리의 글자가 흔한 실수면 그것을 짚는 말을 돌려준다 (아니면 null).
  // where: "key" 키가 올 자리 · "start" 글의 맨 앞 · 그 밖은 값이나 구두점이 올 자리
  const mistake = (where) => {
    const char = text[at];
    if (char === "'") return "작은따옴표(')는 쓸 수 없습니다. 문자열과 키는 큰따옴표(\")로 묶어야 합니다.";
    if ("“”‘’".includes(char)) return `둥근 따옴표(${char})가 있습니다. 곧은 큰따옴표(")로 바꿔야 합니다.`;
    if (text.startsWith("//", at) || text.startsWith("/*", at)) return "주석은 JSON에 쓸 수 없습니다.";
    if (isInvisible(text.charCodeAt(at))) {
      return "보이지 않는 특수 문자(특수 공백 등)가 있습니다. 웹 페이지나 문서에서 복사하면 섞이기도 합니다. 지우거나 보통 빈칸으로 바꾸세요.";
    }
    const word = WORD.exec(text.slice(at, at + 60))?.[0];
    if (where === "key") return word ? `키는 큰따옴표로 묶어야 합니다 (예: "${clip(word)}").` : null;
    if (char === "+") return "+ 부호는 쓸 수 없습니다.";
    if (char === ".") return "소수점 앞에 숫자가 있어야 합니다 (예: 0.5).";
    if (char === "<" && where === "start") return "JSON이 아니라 HTML이나 XML로 보입니다.";
    if (!word) return null;
    if (word === "None" || word === "True" || word === "False") return `파이썬 표기(${word})입니다. JSON에서는 null·true·false로 적습니다.`;
    if (word === "undefined" || word === "NaN" || word === "Infinity") return `JSON에 없는 값(${word})입니다.`;
    if (/^(true|false|null)$/i.test(word)) return `소문자(${word.toLowerCase()})로 적어야 합니다.`;
    if (where === "start") return `따옴표 없는 글자(${clip(word)})로 시작합니다. JSON 앞에 다른 글이 붙어 있으면 지워 주세요.`;
    return `따옴표 없는 글자(${clip(word)})가 있습니다. 문자열은 큰따옴표로 묶어야 합니다.`;
  };

  // 와야 할 것(expected)이 아닌 글자가 있다
  const unexpected = (expected, where) => {
    if (at >= length) fail(`글이 중간에 끝났습니다. ${expected} 와야 합니다.`, length);
    const char = String.fromCodePoint(text.codePointAt(at));
    fail(mistake(where) ?? `${expected} 와야 하는데 다른 글자(${JSON.stringify(char)})가 있습니다.`);
  };

  function parseString() {
    const start = at;
    at++; // 여는 큰따옴표
    let out = "";
    let from = at; // 아직 옮기지 않은 조각의 시작
    for (;;) {
      if (at >= length) fail("문자열이 끝나지 않았습니다 (닫는 큰따옴표가 없습니다).", start, opens.at(-1) ?? null);
      const code = text.charCodeAt(at);
      if (code === 34) {
        out += text.slice(from, at);
        at++;
        return out;
      }
      if (code === 92) {
        out += text.slice(from, at);
        const next = text[at + 1];
        if (next === "u") {
          const hex = text.slice(at + 2, at + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail("\\u 뒤에는 16진수 네 자리가 와야 합니다 (예: \\uac00).");
          out += String.fromCharCode(parseInt(hex, 16));
          at += 6;
        } else {
          if (next === undefined) fail("문자열이 끝나지 않았습니다 (닫는 큰따옴표가 없습니다).", start, opens.at(-1) ?? null);
          const plain = ESCAPES[next];
          if (plain === undefined || !Object.hasOwn(ESCAPES, next)) {
            fail(`역슬래시(\\) 뒤에는 " \\ / b f n r t u만 올 수 있습니다. 역슬래시 글자 자체는 \\\\로 적습니다.`);
          }
          out += plain;
          at += 2;
        }
        from = at;
      } else if (code < 32) {
        if (code === 10 || code === 13) {
          fail("문자열 안에 줄바꿈이 있습니다. 줄바꿈은 \\n으로 적어야 합니다 (닫는 큰따옴표가 빠졌을 수도 있습니다).");
        }
        if (code === 9) fail("문자열 안에 탭 문자가 있습니다. 탭은 \\t로 적어야 합니다.");
        fail("문자열 안에 쓸 수 없는 제어 문자가 있습니다.");
      } else at++;
    }
  }

  function parseNumber() {
    const start = at;
    if (text.charCodeAt(at) === 45) at++;
    const first = text.charCodeAt(at);
    if (first === 48) {
      at++;
      const next = text.charCodeAt(at);
      if (isDigit(next)) fail("0으로 시작하는 숫자는 쓸 수 없습니다. 앞의 0을 빼거나, 따옴표로 묶어 문자열로 적으세요.", start);
      if (next === 120 || next === 88) fail("16진수(0x…)는 JSON에 쓸 수 없습니다.", start);
    } else if (isDigit(first)) {
      while (isDigit(text.charCodeAt(at))) at++;
    } else fail(at >= length ? "글이 중간에 끝났습니다. - 뒤에 숫자가 와야 합니다." : "- 뒤에 숫자가 와야 합니다.");
    if (text.charCodeAt(at) === 46) {
      at++;
      if (!isDigit(text.charCodeAt(at))) fail("소수점 뒤에 숫자가 있어야 합니다.");
      while (isDigit(text.charCodeAt(at))) at++;
    }
    const e = text.charCodeAt(at);
    if (e === 101 || e === 69) {
      at++;
      const sign = text.charCodeAt(at);
      if (sign === 43 || sign === 45) at++;
      if (!isDigit(text.charCodeAt(at))) fail("지수(e) 뒤에 숫자가 있어야 합니다.");
      while (isDigit(text.charCodeAt(at))) at++;
    }
    return { type: "number", raw: text.slice(start, at) };
  }

  function parseObject(depth) {
    opens.push(at);
    at++; // {
    const keys = [];
    const children = [];
    skip();
    if (text.charCodeAt(at) !== 125) {
      for (;;) {
        if (text.charCodeAt(at) !== 34) unexpected("키(큰따옴표로 묶은 이름)가", "key");
        keys.push(parseString());
        skip();
        if (text.charCodeAt(at) !== 58) unexpected("키 뒤에 쌍점(:)이");
        at++;
        skip();
        children.push(parseValue(depth + 1));
        skip();
        const code = text.charCodeAt(at);
        if (code === 125) break;
        if (code !== 44) {
          if (code === 93) fail("객체가 닫히지 않았습니다. 닫는 중괄호(})가 와야 하는데 닫는 대괄호(])가 있습니다.", at, opens.at(-1));
          if (valueAhead()) fail("항목 사이에 쉼표(,)가 빠졌습니다.");
          unexpected("쉼표(,)나 닫는 중괄호(})가");
        }
        const comma = at;
        at++;
        skip();
        if (text.charCodeAt(at) === 125) fail("마지막 항목 뒤에 쉼표가 있습니다. 끝의 쉼표는 JSON에 쓸 수 없습니다.", comma);
      }
    }
    at++; // }
    opens.pop();
    return { type: "object", keys, children };
  }

  function parseArray(depth) {
    opens.push(at);
    at++; // [
    const children = [];
    skip();
    if (text.charCodeAt(at) !== 93) {
      for (;;) {
        children.push(parseValue(depth + 1));
        skip();
        const code = text.charCodeAt(at);
        if (code === 93) break;
        if (code !== 44) {
          if (code === 125) fail("배열이 닫히지 않았습니다. 닫는 대괄호(])가 와야 하는데 닫는 중괄호(})가 있습니다.", at, opens.at(-1));
          if (valueAhead()) fail("항목 사이에 쉼표(,)가 빠졌습니다.");
          unexpected("쉼표(,)나 닫는 대괄호(])가");
        }
        const comma = at;
        at++;
        skip();
        if (text.charCodeAt(at) === 93) fail("마지막 항목 뒤에 쉼표가 있습니다. 끝의 쉼표는 JSON에 쓸 수 없습니다.", comma);
      }
    }
    at++; // ]
    opens.pop();
    return { type: "array", children };
  }

  // depth: 이 값을 감싼 객체·배열의 수
  function parseValue(depth) {
    const code = text.charCodeAt(at);
    if (code === 123 || code === 91) {
      if (depth >= maxDepth) fail(`객체·배열이 너무 깊게 겹쳐 있습니다 (${maxDepth}단계까지 읽습니다).`);
      return code === 123 ? parseObject(depth) : parseArray(depth);
    }
    if (code === 34) return { type: "string", value: parseString() };
    if (code === 45 || isDigit(code)) return parseNumber();
    if (text.startsWith("true", at)) {
      at += 4;
      return { type: "boolean", value: true };
    }
    if (text.startsWith("false", at)) {
      at += 5;
      return { type: "boolean", value: false };
    }
    if (text.startsWith("null", at)) {
      at += 4;
      return { type: "null" };
    }
    if (code === 44) fail("값이 와야 할 자리에 쉼표(,)가 있습니다.");
    return unexpected("값이", depth === 0 ? "start" : undefined);
  }

  try {
    skip();
    if (at >= length) fail("글이 비어 있습니다.", 0, null);
    const root = parseValue(0);
    skip();
    if (at < length) {
      // 값은 끝났는데 글이 남았다
      const code = text.charCodeAt(at);
      if (text.startsWith("//", at) || text.startsWith("/*", at)) fail("주석은 JSON에 쓸 수 없습니다.");
      if (valueAhead()) fail("JSON 값이 끝난 뒤에 값이 또 있습니다. 한 번에 JSON 하나만 볼 수 있습니다.");
      if (code === 125 || code === 93) fail(`짝이 없는 닫는 괄호(${text[at]})가 있습니다. 닫는 괄호가 하나 더 많습니다.`);
      if (code === 44) fail("JSON 값이 끝난 뒤에 쉼표(,)가 있습니다. 여러 값을 보려면 대괄호([ ])로 묶어 배열로 만드세요.");
      fail(`JSON 값이 끝난 뒤에 글자가 더 있습니다 (${JSON.stringify(String.fromCodePoint(text.codePointAt(at)))}).`);
    }
    return root;
  } catch (error) {
    // 호출이 너무 깊어졌다 (maxDepth를 크게 주었거나 호출 한계가 작은 브라우저)
    if (error instanceof RangeError) throw new JsonError("객체·배열이 너무 깊게 겹쳐 있어 읽지 못했습니다.", 0);
    throw error;
  }
}

// 글자 위치(index)가 몇 번째 줄 몇 번째 칸인지. 줄과 칸은 1부터 세고, 칸은 글자 수다(이모지처럼 두 칸을 쓰는 글자도 하나).
// lineStart·lineEnd는 그 줄의 처음과 끝(줄바꿈 앞) 자리
export function locate(text, index) {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf("\n"); i >= 0 && i < index; i = text.indexOf("\n", i + 1)) {
    line++;
    lineStart = i + 1;
  }
  let lineEnd = text.indexOf("\n", index);
  if (lineEnd < 0) lineEnd = text.length;
  if (lineEnd > index && text.charCodeAt(lineEnd - 1) === 13) lineEnd--;
  let column = 1;
  for (let i = lineStart; i < index; i++) if (!isLowSurrogate(text.charCodeAt(i))) column++;
  return { line, column, lineStart, lineEnd };
}

// 틀린 자리 앞뒤의 글을 잘라 보인다. 한 줄로 된 긴 글도 볼 수 있게 그 줄에서 앞뒤 width 글자만 쓴다.
// { before, mark: 틀린 글자(줄이나 글의 끝이면 ""), after }
export function excerpt(text, index, width = 50) {
  const { lineStart, lineEnd } = locate(text, index);
  const at = Math.min(index, lineEnd);
  const markEnd = at < lineEnd ? at + (isHighSurrogate(text.charCodeAt(at)) && at + 1 < lineEnd ? 2 : 1) : at;
  let from = Math.max(lineStart, at - width);
  if (from > lineStart && isLowSurrogate(text.charCodeAt(from))) from++;
  let to = Math.min(lineEnd, markEnd + width);
  if (to < lineEnd && isHighSurrogate(text.charCodeAt(to - 1))) to--;
  return {
    before: (from > lineStart ? "…" : "") + text.slice(from, at),
    mark: text.slice(at, markEnd),
    after: text.slice(markEnd, Math.max(markEnd, to)) + (to < lineEnd ? "…" : ""),
  };
}
