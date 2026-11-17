// 깨진 한글 고치기. 브라우저 API 가운데 TextDecoder만 써서 Node에서 시험할 수 있다.
// 오디오 형식 바꾸기(원본 태그 바로잡기)와 파일 이름 바꾸기(MP3 태그 보기)가 쓴다.
//
// 태그를 바이트 그대로(라틴 문자로) 읽는 자리가 있다: WAV의 LIST INFO, ID3의 ISO-8859-1 칸, ID3v1.
// 한국에서 만든 파일은 그 자리에 UTF-8(ffmpeg 등)이나 EUC-KR(CP949, 예전 윈도우 프로그램)로 한글을 적은 것이 많아서,
// 그대로 읽으면 "WAV ê³¡"처럼 깨진 글이 된다.
// 라틴 문자 범위(0~255)의 글자만 있고 128 이상이 섞여 있으면 그 바이트를 UTF-8로 읽어 보고, 안 되면 EUC-KR로 읽어
// 한글이 나올 때 그것을 쓴다. 유럽 글자(é, ö 등) 뒤에는 대개 영문자나 빈칸이 와서 두 방식 모두 틀린 바이트가 되므로
// "Björk", "Café" 같은 이름은 그대로 남는다.

const HANGUL = /[가-힣]/;

// 라틴 문자 범위의 글자만 있으면서 128 이상인 글자가 하나라도 있는지
function looksRaw(text) {
  let high = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 255) return false;
    if (code >= 128) high = true;
  }
  return high;
}

export function repairText(text) {
  if (typeof text !== "string" || !looksRaw(text)) return text;
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
