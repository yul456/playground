// 페이지 안에서 사진 주소를 페이지에 나온 순서대로 모은다.
// chrome.scripting.executeScript가 이 함수의 코드만 떼어 페이지(프레임마다)에 넣어 돌린다. 그래서 함수 밖의 이름은 쓰면 안 된다
export function collectImages() {
  // 스크롤해야 불러오는 사진(lazy loading)이 진짜 주소를 넣어 두는 속성. 네이버 블로그는 data-lazy-src, 카페24 쇼핑몰은 ec-data-src
  const LAZY_SRC = [
    "data-lazy-src",
    "data-src",
    "data-original",
    "data-lazy",
    "data-url",
    "data-echo",
    "ec-data-src",
    "data-actualsrc",
    "data-hi-res-src",
    "data-full-src",
    "data-origin",
  ];
  const LAZY_SRCSET = ["data-srcset", "data-lazy-srcset"];
  const images = [];
  const seen = new Set();

  const toUrl = (value) => {
    if (typeof value !== "string" || !value.trim()) return null;
    try {
      const url = new URL(value.trim(), document.baseURI);
      if (url.protocol === "http:" || url.protocol === "https:") return url.href;
      if (url.protocol === "data:" && /^data:image\//i.test(url.href)) return url.href;
    } catch {
      // 주소가 아닌 값
    }
    return null;
  };

  // srcset("a.jpg 480w, b.jpg 960w" 또는 "a.jpg 1x, b.jpg 2x")에서 가장 큰 그림의 주소.
  // 주소 안에 쉼표가 들어 있을 수 있어(이미지 서버의 크기 지정, data: 주소) 쉼표로 바로 자르지 않는다
  const largest = (srcset) => {
    let best = null;
    let bestScore = -1;
    let i = 0;
    while (i < srcset.length) {
      while (i < srcset.length && /[\s,]/.test(srcset[i])) i++;
      let start = i;
      while (i < srcset.length && !/\s/.test(srcset[i])) i++;
      let url = srcset.slice(start, i);
      let descriptor = "";
      if (url.endsWith(",")) url = url.replace(/,+$/, "");
      else {
        start = i;
        while (i < srcset.length && srcset[i] !== ",") i++;
        descriptor = srcset.slice(start, i);
      }
      if (!url) continue;
      const w = descriptor.match(/(\d+(?:\.\d+)?)w/);
      const x = descriptor.match(/(\d+(?:\.\d+)?)x/);
      const score = w ? Number(w[1]) : x ? Number(x[1]) : 1;
      if (score > bestScore) {
        best = url;
        bestScore = score;
      }
    }
    return best;
  };

  const add = (url, info) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    images.push({ url, width: 0, height: 0, ...info });
  };

  const visitImage = (img) => {
    let lazy = null;
    for (const name of LAZY_SRC) {
      lazy = toUrl(img.getAttribute(name));
      if (lazy) break;
    }
    // srcset 후보(그림과 <picture>의 <source>)를 모아 가장 큰 것을 고른다
    const sets = [];
    const collectSets = (el) => {
      for (const name of ["srcset", ...LAZY_SRCSET]) {
        const value = el.getAttribute(name);
        if (value) sets.push(value);
      }
    };
    collectSets(img);
    if (img.parentElement?.localName === "picture") {
      for (const source of img.parentElement.children) if (source.localName === "source") collectSets(source);
    }
    const fromSet = sets.length ? toUrl(largest(sets.join(", "))) : null;
    const current = toUrl(img.currentSrc) ?? toUrl(img.getAttribute("src"));
    const url = fromSet ?? lazy ?? current;
    // 페이지가 이미 불러온 그림이면 실제 크기를 안다. 모르면 팝업이 미리보기를 불러와 잰다
    const loaded = url === current && img.complete && img.naturalWidth > 0;
    add(url, {
      width: loaded ? img.naturalWidth : 0,
      height: loaded ? img.naturalHeight : 0,
      alt: (img.alt || "").trim().slice(0, 200),
    });
  };

  const visitBackground = (el) => {
    const value = getComputedStyle(el).backgroundImage;
    if (!value || value === "none") return;
    for (const match of value.matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/g)) add(toUrl(match[2]), { background: true });
  };

  // 문서 순서대로 돈다. 웹 컴포넌트 안(열린 shadow root)은 그 요소 바로 다음 순서로 본다
  const walk = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el.localName === "img") visitImage(el);
      else if (el.localName === "input" && el.type === "image") add(toUrl(el.getAttribute("src")), {});
      visitBackground(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  if (document.documentElement) {
    visitBackground(document.documentElement);
    walk(document.documentElement);
  }
  // origin: 팝업이 맨 위 페이지와 같은 사이트의 프레임만 쓰려고 본다 (광고·다른 사이트 위젯은 뺀다)
  return { title: document.title, url: location.href, origin: location.origin, images };
}

// 페이지 안에서 링크(<a href>, <area href>)를 페이지에 나온 순서대로 모은다. 열린 shadow root 안도 본다.
// 웹 주소(http·https)만, # 뒤는 떼고 같은 주소는 한 번만, 지금 페이지 자신은 뺀다.
// 글은 링크 안의 글(textContent), 없으면 title·aria-label·그림 설명(alt).
// collectImages처럼 함수 코드만 떼어 프레임마다 넣으므로 함수 밖의 이름을 쓰면 안 된다
export function collectLinks() {
  const links = [];
  const seen = new Set();
  const strip = (value) => {
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol !== "http:" && url.protocol !== "https:") return null;
      url.hash = "";
      return url.href;
    } catch {
      return null;
    }
  };
  const here = strip(location.href);
  const visit = (el) => {
    const href = el.getAttribute("href");
    if (!href) return;
    const url = strip(href.trim());
    if (!url || url === here || seen.has(url)) return;
    seen.add(url);
    const text = (el.textContent || el.getAttribute("title") || el.getAttribute("aria-label") || el.querySelector?.("img[alt]")?.alt || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 200);
    links.push({ url, text });
  };
  const walk = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el.localName === "a" || el.localName === "area") visit(el);
      if (el.shadowRoot) walk(el.shadowRoot);
    }
  };
  if (document.documentElement) walk(document.documentElement);
  return { title: document.title, url: location.href, origin: location.origin, links };
}

// 오른쪽 클릭 메뉴로 넣은 링크의 글을 찾는다 (크롬은 링크 주소만 알려 준다). 함수 밖의 이름을 쓰면 안 된다
export function linkTextOf(linkUrl) {
  for (const a of document.querySelectorAll("a[href], area[href]")) {
    if (a.href !== linkUrl) continue;
    const text = (a.textContent || a.getAttribute("title") || a.querySelector("img[alt]")?.alt || "").replace(/\s+/g, " ").trim();
    if (text) return text.slice(0, 200);
  }
  return "";
}

// 페이지 아래쪽에 잠깐 알림 글을 띄운다 (오른쪽 클릭 메뉴로 넣었을 때). 함수 밖의 이름을 쓰면 안 된다
export function showToast(text) {
  const id = "photo-saver-toast";
  document.getElementById(id)?.remove();
  const box = document.createElement("div");
  box.id = id;
  box.textContent = text;
  box.setAttribute("role", "status");
  box.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:24px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "max-width:80vw",
    "padding:10px 16px",
    "border-radius:10px",
    "background:rgba(28,39,51,.92)",
    "color:#fff",
    "font:14px/1.4 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif",
    "box-shadow:0 4px 16px rgba(0,0,0,.25)",
    "pointer-events:none",
  ].join(";");
  (document.body || document.documentElement).append(box);
  setTimeout(() => box.remove(), 2500);
}

// 링크 고르기 중에 페이지가 새 창(window.open)으로 글을 열면, 열지 않고 그 주소를 알린다(photo-saver-open 이벤트, picker.js가 듣는다).
// 페이지 쪽 공간(MAIN)에 넣어야 페이지의 window.open을 감쌀 수 있다(links.js가 world: "MAIN"으로 넣는다).
// 고르기 중(html의 data-photo-saver-picking)이 아니면 원래대로 연다. 함수 밖의 이름을 쓰면 안 된다
export function wrapWindowOpen() {
  if (window.__photoSaverOpen) return;
  window.__photoSaverOpen = true;
  const original = window.open;
  window.open = function open(url, ...rest) {
    if (!document.documentElement.hasAttribute("data-photo-saver-picking") || url == null || url === "") return original.call(this, url, ...rest);
    let href = "";
    try {
      href = new URL(String(url), document.baseURI).href;
    } catch {
      // 주소가 아닌 값
    }
    document.dispatchEvent(new CustomEvent("photo-saver-open", { detail: href }));
    return null;
  };
}
