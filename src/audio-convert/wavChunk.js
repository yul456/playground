// WAV(RIFF) 파일에 조각(chunk)을 넣는다. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다.
// WAV의 기본 태그 칸(LIST INFO)은 라틴 문자만 담을 수 있어(Mediabunny도 한글 값은 쓰지 않는다) 한글 제목이 빠진다.
// 그래서 MP3와 같은 ID3v2.3 태그를 "id3 " 조각으로 함께 넣는다. 한글·작곡가·앨범 아트가 들어가고,
// foobar2000·MusicBee·VLC 같은 재생기와 FFmpeg가 읽는다 (윈도우 탐색기는 LIST INFO만 읽는 것으로 안다).

const ascii = (bytes, at, length) => String.fromCharCode(...bytes.subarray(at, at + length));

// data 조각 바로 앞에 id 조각을 넣고 RIFF 크기를 고친 새 파일을 돌려준다.
// data 앞에 두면 data 뒤를 읽지 않는 프로그램도 찾는다. RF64(4GB 넘는 WAV)는 그대로 돌려준다
export function insertBeforeData(bytes, id, payload) {
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") return bytes;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 12;
  while (at + 8 <= bytes.length && ascii(bytes, at, 4) !== "data") {
    const size = view.getUint32(at + 4, true);
    at += 8 + size + (size & 1);
  }
  if (at + 8 > bytes.length) throw new Error("WAV의 소리 조각(data)을 찾지 못했습니다");
  const pad = payload.length & 1; // 조각은 짝수 바이트로 맞춘다
  const chunk = new Uint8Array(8 + payload.length + pad);
  for (let i = 0; i < 4; i++) chunk[i] = id.charCodeAt(i);
  new DataView(chunk.buffer).setUint32(4, payload.length, true);
  chunk.set(payload, 8);
  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, at));
  out.set(chunk, at);
  out.set(bytes.subarray(at), at + chunk.length);
  new DataView(out.buffer).setUint32(4, view.getUint32(4, true) + chunk.length, true);
  return out;
}
