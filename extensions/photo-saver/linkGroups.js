// 페이지에서 모은 링크를 주소 모양으로 묶는다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// 게시판의 글 링크는 번호만 다르고 모양이 같아서(…/view?no=101, …/view?no=102) 한 묶음이 되고,
// 메뉴·쪽 번호·광고 링크는 다른 묶음이 된다. 보통 가장 큰 묶음이 글 목록이다

// 주소의 모양: 경로의 숫자는 #으로, 물음표 뒤 값은 숫자가 들어 있으면 #으로 바꾼다 (이름과 순서는 그대로)
export function linkShape(url) {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\d+/g, "#");
    const pairs = [...u.searchParams].map(([key, value]) => `${key}=${/\d/.test(value) ? "#" : value}`);
    return `${u.host}${path}${pairs.length ? `?${pairs.join("&")}` : ""}`;
  } catch {
    return url;
  }
}

// 링크([{ url, text }])를 모양별로 묶는다. 큰 묶음부터, 크기가 같으면 페이지에 먼저 나온 것부터.
// [{ shape, links, first: 처음 나온 순서, suggested: 글 목록으로 보이는 묶음(가장 크고 3개 이상)인지 }]
export function groupLinks(links) {
  const groups = new Map();
  links.forEach((link, index) => {
    const shape = linkShape(link.url);
    if (!groups.has(shape)) groups.set(shape, { shape, links: [], first: index, suggested: false });
    groups.get(shape).links.push(link);
  });
  const list = [...groups.values()].sort((a, b) => b.links.length - a.links.length || a.first - b.first);
  if (list[0]?.links.length >= 3) list[0].suggested = true;
  return list;
}

// 묶음 이름으로 보일 모양. 지금 페이지와 같은 호스트면 호스트를 뺀다
export function shapeLabel(shape, pageUrl) {
  try {
    const host = new URL(pageUrl).host;
    if (shape.startsWith(`${host}/`)) return shape.slice(host.length);
  } catch {
    // 페이지 주소를 모르면 그대로
  }
  return shape;
}

// 거르기 칸의 글이 링크의 글이나 주소에 들어 있는지 (대소문자 가리지 않음)
export function matchesFilter(link, filter) {
  const needle = filter.trim().toLowerCase();
  if (!needle) return true;
  return link.text.toLowerCase().includes(needle) || decodeSafe(link.url).toLowerCase().includes(needle);
}

function decodeSafe(url) {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}
