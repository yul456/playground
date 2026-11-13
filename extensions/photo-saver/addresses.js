// 열린 탭 받기에 더할 주소를 만든다: 번호로 한꺼번에(rangeUrls), 한 줄에 하나씩(listUrls).
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다

// 한 번에 더할 수 있는 주소 수. 1~10000처럼 잘못 넣어 페이지를 지나치게 많이 여는 일을 막는다
export const MAX_ADD = 200;

// 주소 하나를 읽어 정리한 주소(href)를 돌려준다. 웹 주소(http·https)가 아니면 null.
// "site.com/a"처럼 https://를 빠뜨린 것은 붙여 준다. 이때는 점이 있는 이름(또는 localhost)만 주소로 본다(낱말을 주소로 잘못 보지 않게)
export function parseUrl(text) {
  const value = String(text ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (/^https?:$/.test(url.protocol) && url.hostname) return url.href;
  } catch {
    // 앞에 https://를 붙여 본다
  }
  try {
    const url = new URL(`https://${value}`);
    if (url.hostname.includes(".") || url.hostname === "localhost") return url.href;
  } catch {
    // 주소가 아니다
  }
  return null;
}

// 화면에 보일 주소. %로 바꿔 적은 한글 등을 되돌린다
export function showUrl(url) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

// 주소 앞부분 + 번호 + 뒷부분으로 주소를 만든다. 번호는 시작부터 끝까지 1씩(끝이 작으면 거꾸로), 끝을 비우면 시작 하나.
// 시작이나 끝을 001처럼 0으로 시작하게 넣으면 그 자릿수로 맞춘다(001, 002 … 010). 아주 큰 번호도 그대로 다룬다(BigInt).
// 결과: { urls } 또는 { urls: [], error }
export function rangeUrls({ prefix = "", from = "", to = "", suffix = "" }) {
  const head = prefix.trim();
  const tail = suffix.trim();
  const a = from.trim();
  const b = to.trim() || a;
  if (!head) return { urls: [], error: "주소 앞부분을 넣으세요" };
  if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return { urls: [], error: "번호는 숫자로 넣으세요" };
  const start = BigInt(a);
  const end = BigInt(b);
  const count = (end >= start ? end - start : start - end) + 1n;
  if (count > BigInt(MAX_ADD)) return { urls: [], error: `한 번에 ${MAX_ADD}개까지 넣을 수 있습니다 (지금 ${count}개)` };
  const width = /^0\d/.test(a) || /^0\d/.test(b) ? Math.max(a.length, b.length) : 0;
  const step = end >= start ? 1n : -1n;
  const urls = [];
  for (let n = start; ; n += step) {
    const url = parseUrl(`${head}${String(n).padStart(width, "0")}${tail}`);
    if (!url) return { urls: [], error: "주소 앞부분이 웹 주소가 아닙니다. https://로 시작하는 주소를 넣으세요" };
    urls.push(url);
    if (n === end) break;
  }
  return { urls };
}

// 한 줄에 하나씩(빈칸으로 나눠도 된다) 넣은 주소를 읽는다. 같은 주소는 한 번만.
// 결과: { urls, invalid: 주소가 아니라서 뺀 수 } 또는 너무 많으면 error
export function listUrls(text) {
  const urls = [];
  let invalid = 0;
  for (const token of String(text ?? "").split(/\s+/)) {
    if (!token) continue;
    const url = parseUrl(token);
    if (!url) invalid++;
    else if (!urls.includes(url)) urls.push(url);
  }
  if (urls.length > MAX_ADD) return { urls: [], invalid, error: `한 번에 ${MAX_ADD}개까지 넣을 수 있습니다 (지금 ${urls.length}개)` };
  return { urls, invalid };
}

// 넣을 주소를 짧게 알린다: 첫 주소 ~ 끝 주소 (n개)
export function describeUrls(urls) {
  if (!urls.length) return "";
  if (urls.length === 1) return `${showUrl(urls[0])} (1개)`;
  return `${showUrl(urls[0])} ~ ${showUrl(urls.at(-1))} (${urls.length}개)`;
}
