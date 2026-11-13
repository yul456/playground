// 원본에서 읽은 태그를 바로잡는다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
//
// 1) 깨진 한글 고치기
//    태그를 바이트 그대로(라틴 문자로) 읽는 자리가 있다: WAV의 LIST INFO, ID3의 ISO-8859-1 칸, ID3v1.
//    한국에서 만든 파일은 그 자리에 UTF-8(ffmpeg 등)이나 EUC-KR(CP949, 예전 윈도우 프로그램)로 한글을 적은 것이 많아서,
//    그대로 옮기면 "WAV ê³¡"처럼 깨진 글이 새 파일에 들어간다.
//    라틴 문자 범위(0~255)의 글자만 있고 128 이상이 섞여 있으면 그 바이트를 UTF-8로 읽어 보고, 안 되면 EUC-KR로 읽어
//    한글이 나올 때 그것을 쓴다. 유럽 글자(é, ö 등) 뒤에는 대개 영문자나 빈칸이 와서 두 방식 모두 틀린 바이트가 되므로
//    "Björk", "Café" 같은 이름은 그대로 남는다.
//
// 2) WebM·MKA의 제목
//    ffmpeg(yt-dlp 등)는 제목을 Matroska의 Segment Info에 있는 Title에 넣는데, Mediabunny는 Tags만 읽어 제목을 놓친다.
//    파일 앞부분에서 그 Title을 직접 읽는다.

const HANGUL = /[가-힣]/;

export function repairText(text) {
  if (typeof text !== "string" || !/[\u0080-ÿ]/.test(text) || /[^\u0000-ÿ]/.test(text)) return text;
  const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0));
  for (const encoding of ["utf-8", "euc-kr"]) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(bytes);
      if (encoding === "utf-8" || HANGUL.test(decoded)) return decoded;
    } catch {
      // 이 방식으로는 읽히지 않는다
    }
  }
  return text;
}

// 글로 된 태그를 모두 바로잡은 새 태그 (그림, 숫자, 날짜는 그대로)
export function repairTags(tags) {
  const out = { ...tags };
  for (const [key, value] of Object.entries(out)) if (typeof value === "string") out[key] = repairText(value);
  if (tags?.raw) {
    out.raw = Object.fromEntries(
      Object.entries(tags.raw).map(([key, value]) => [key, Array.isArray(value) ? value.map(repairText) : repairText(value)]),
    );
  }
  return out;
}

// EBML 수(VINT). 첫 바이트의 앞쪽 0의 개수 + 1이 길이다. 원소 이름(ID)은 표시 비트를 남긴 채로 읽는다
function vint(bytes, at, keepMarker) {
  const first = bytes[at];
  if (!first) return null;
  let length = 1;
  while (!(first & (0x80 >> (length - 1)))) length++;
  if (at + length > bytes.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  for (let i = 1; i < length; i++) value = value * 256 + bytes[at + i];
  // 크기의 값 비트가 모두 1이면 "크기 모름"이다
  const unknown = !keepMarker && value === 2 ** (7 * length) - 1;
  return { value: unknown ? Infinity : value, length };
}

function element(bytes, at) {
  const id = vint(bytes, at, true);
  if (!id) return null;
  const size = vint(bytes, at + id.length, false);
  if (!size) return null;
  return { id: id.value, dataAt: at + id.length + size.length, size: size.value };
}

const EBML = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const INFO = 0x1549a966;
const TITLE = 0x7ba9;
const CLUSTER = 0x1f43b675;

// Matroska·WebM 파일 앞부분(bytes)에서 Segment Info의 Title을 읽는다. 없으면 ""
export function matroskaTitle(bytes) {
  const header = element(bytes, 0);
  if (!header || header.id !== EBML || header.size === Infinity) return "";
  const segment = element(bytes, header.dataAt + header.size);
  if (!segment || segment.id !== SEGMENT) return "";
  const segmentEnd = Math.min(bytes.length, segment.dataAt + segment.size);
  let at = segment.dataAt;
  while (at < segmentEnd) {
    const child = element(bytes, at);
    // 소리 조각(Cluster)이 나오면 그 앞에 Info가 없는 것이다
    if (!child || child.id === CLUSTER || child.size === Infinity) return "";
    if (child.id === INFO) {
      const end = Math.min(bytes.length, child.dataAt + child.size);
      for (let p = child.dataAt; p < end; ) {
        const field = element(bytes, p);
        if (!field || field.size === Infinity) return "";
        if (field.id === TITLE) return new TextDecoder().decode(bytes.subarray(field.dataAt, Math.min(end, field.dataAt + field.size))).trim();
        p = field.dataAt + field.size;
      }
      return "";
    }
    at = child.dataAt + child.size;
  }
  return "";
}
