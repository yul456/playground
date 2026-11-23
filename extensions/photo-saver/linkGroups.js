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

// 고른 묶음(글 목록)과 주소 모양은 다르지만 목록 안에서 같은 자리에 있는 링크들.
// 게시판은 공지나 일부 글만 주소 모양이 달라서(…/notice/3, 다른 게시판에서 옮긴 글 등) 목록 10개 가운데 8개만 묶이곤 한다.
// 같은 자리: 묶음의 링크 절반 이상이 쓰는 태그 겹(sig)과 같고, 그 링크들이 모두 같은 값인 겹의 순서(pos: 표의 몇째 칸인지,
// 페이지의 몇째 상자인지 등)도 같다. 글쓴이·댓글 수 링크는 칸이나 순서가 달라 빠지고, 다른 곳의 목록(옆의 인기 글 등)은 위쪽 겹의 순서가 달라 빠진다.
// 공지는 대개 목록 맨 위에 있어서 페이지에서의 앞뒤로는 가리지 않는다
export function alike(links, group) {
  if (!group) return [];
  const counts = new Map();
  for (const link of group.links) if (link.sig) counts.set(link.sig, (counts.get(link.sig) ?? 0) + 1);
  const [sig, count] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [];
  if (!sig || count < 3 || count * 2 < group.links.length) return [];
  const members = group.links.filter((link) => link.sig === sig);
  const fixed = members[0].pos.map((value, level) => (members.every((link) => link.pos[level] === value) ? value : null));
  const inGroup = new Set(group.links);
  return links.filter((link) => !inGroup.has(link) && link.sig === sig && fixed.every((value, level) => value === null || link.pos?.[level] === value));
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
