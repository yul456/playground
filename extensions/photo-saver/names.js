// 저장할 폴더·파일 이름을 다룬다. 팝업(popup.js)과 받기(background.js)가 함께 쓴다

// 받은 사진을 모아 두는 폴더. 다운로드 폴더 안에 두고, 그 안에 페이지마다 폴더를 하나씩 만든다.
// 크롬은 다운로드 폴더 자체를 웹 페이지에서 고르지 못하게 막는다. 한 단계를 더 두면 사진 세로로 붙이기에서
// 이 폴더를 골라 받은 페이지들을 한꺼번에 붙일 수 있다
export const BASE_FOLDER = "페이지 사진";

// 크롬이 다운로드 파일 이름에 받지 않는 글자: 윈도우에서 못 쓰는 글자, ~, 제어·서식 문자
const BAD_CHARS = /[\\/:*?"<>|~\p{Cc}\p{Cf}]/gu;
// 윈도우가 예약해 둔 이름
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
const MAX_LENGTH = 60;

// 페이지 제목 등으로 폴더 이름을 만든다. 못 쓰는 글자는 빼고 너무 길면 자른다
export function cleanFolderName(text, fallback = "사진") {
  let name = String(text ?? "")
    .replace(BAD_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim();
  name = Array.from(name).slice(0, MAX_LENGTH).join("");
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");
  if (RESERVED.test(name)) name = `${name}_`;
  return name || fallback;
}

// 받은 그림의 종류(MIME)에 맞는 확장자
const MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/apng": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/x-ms-bmp": "bmp",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tif",
  "image/jxl": "jxl",
};
const IMAGE_EXT = /\.(jpe?g|jfif|png|apng|gif|webp|avif|bmp|svg|ico|heic|heif|tiff?|jxl)$/i;
const SAME_EXT = { jpeg: "jpg", jfif: "jpg", apng: "png", tiff: "tif" };
const tidy = (ext) => SAME_EXT[ext.toLowerCase()] ?? ext.toLowerCase();

export function extFromMime(mime) {
  return MIME_EXT[String(mime ?? "").split(";")[0].trim().toLowerCase()] ?? null;
}

export function extFromName(name) {
  const match = String(name ?? "").match(IMAGE_EXT);
  return match ? tidy(match[1]) : null;
}

// 그림을 알아보는 이름. 빼 둔 이름을 기억하고 다른 페이지에서 맞춰 볼 때 쓴다.
// - 주소 끝이 그림 파일 이름이면(photo.jpg) 그 이름(소문자). 경로가 달라도 이름이 같으면 같은 그림으로 본다
// - 주소 끝이 파일 이름이 아니면(…/계정/아바타/128, getImage.php?id=5) 주소 전체("//호스트/경로?쿼리").
//   끝 부분만 보면 크기 숫자(128)나 "image" 같은 말이라, 서로 다른 그림이 모두 같은 이름이 된다
export function imageName(url) {
  if (!/^https?:/i.test(url)) return null;
  try {
    const { host, pathname, search } = new URL(url);
    let last = pathname.split("/").filter(Boolean).pop() ?? "";
    try {
      last = decodeURIComponent(last);
    } catch {
      // %가 잘못 들어간 이름은 그대로 쓴다
    }
    if (IMAGE_EXT.test(last)) return last.toLowerCase();
    return `//${host}${pathname}${search}`;
  } catch {
    return null;
  }
}

// 지금 기준으로 맞춰 볼 수 있는 이름인가. 1.1.0은 확장자 없는 주소도 끝 부분만 기억했다("128"). 그런 이름은 버린다
export const validName = (name) => IMAGE_EXT.test(name) || name.startsWith("//");

// 주소(또는 출처)가 속한 사이트. 페이지 안의 틀(iframe)이 같은 사이트의 것인지 볼 때 쓴다.
// 도메인의 뒤쪽 두 마디(map.naver.com → naver.com)이고, 나라 도메인에서 둘째 마디가 흔한 분류 이름이면
// 세 마디다(shop.example.co.kr → example.co.kr). 공개 접미사 목록(PSL) 없이 어림으로 정한다.
// IP 주소·localhost는 호스트 그대로, 알 수 없으면(출처가 "null"인 틀 등) null
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "or", "ne", "go", "gov", "ac", "edu", "re", "pe", "mil"]);
export function siteOf(url) {
  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  if (!host) return null;
  if (/^[\d.]+$/.test(host) || host.startsWith("[")) return host; // IP 주소
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const [second, top] = labels.slice(-2);
  const take = top.length === 2 && SECOND_LEVEL.has(second) ? 3 : 2;
  return labels.slice(-take).join(".");
}

// 주소에 %XX로 적힌 파일 이름을 글자로 바꾼다. 대개 UTF-8이고, 옛 한글 주소는 EUC-KR이다
// (네이버 지도의 병원 사진 이름이 "4%C3%FE_MRI…"처럼 그대로 나왔다). 둘 다 아니면 그대로 둔다
function decodeName(text) {
  if (!text.includes("%")) return text;
  try {
    return decodeURIComponent(text);
  } catch {
    // UTF-8이 아니다
  }
  try {
    const bytes = [];
    for (let i = 0; i < text.length; i++) {
      const hex = text.slice(i + 1, i + 3);
      if (text[i] === "%" && /^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 2;
      } else if (text.charCodeAt(i) < 0x80) {
        bytes.push(text.charCodeAt(i));
      } else {
        return text; // 글자와 %XX가 섞여 있으면 바이트로 되돌릴 수 없다
      }
    }
    return new TextDecoder("euc-kr", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

// 주소에 적힌 원래 파일 이름에서 확장자를 뗀 것. 사진을 원본 이름으로 받을 때 쓴다 (확장자는 받아 본 종류로 붙인다).
// 주소 끝이 파일 이름이 아니면 물음표 뒤에 든 주소에서 찾는다 (이미지 서버의 …/common/?src=https://…/photo.jpg).
// 그래도 없으면 null (번호로 받는다)
export function originalBase(url) {
  if (!/^https?:/i.test(url)) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  for (const text of [parsed.pathname, ...parsed.searchParams.values()]) {
    const last = decodeName(text.split(/[?#]/)[0].split("/").filter(Boolean).pop() ?? "");
    if (!IMAGE_EXT.test(last)) continue;
    const base = cleanFolderName(last.replace(IMAGE_EXT, ""), "");
    if (base) return base;
  }
  return null;
}

// 주소로 확장자를 짐작한다. data: 주소는 그 안에 적힌 종류로
export function extFromUrl(url) {
  if (url.startsWith("data:")) return extFromMime(url.slice(5).split(/[;,]/)[0]);
  try {
    return extFromName(new URL(url).pathname);
  } catch {
    return null;
  }
}
