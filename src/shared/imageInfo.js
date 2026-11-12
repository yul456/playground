// 그림 파일 머리에서 크기를 읽고, 그 크기를 JPG로 만들 수 있는지 본다. 사진 형식 바꾸기와 사진 세로로 붙이기가 쓴다.
// (확장 프로그램은 src/를 import하지 못해 extensions/photo-saver/imageInfo.js에 복사해 둔다. scripts/check-copies.mjs가 같은지 본다)
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다.
// read(start, end)는 파일의 그 범위 바이트(Uint8Array)를 돌려주는 함수다

// 크롬의 JPG 인코더가 담는 가장 긴 변(libjpeg의 한계). JPG 형식의 한계 65,535가 아니다.
// 이보다 긴 캔버스를 JPG로 만들면 오류 없이 65,500px에서 잘려 나온다 (크롬 157에서 확인)
export const JPG_MAX_SIDE = 65500;
// 크롬 캔버스가 다룰 수 있는 화소 수 (16,384 × 16,384). 넘으면 캔버스가 만들어지지 않는다
export const MAX_PIXELS = 16384 * 16384;

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const chunkType = (text) => (text.charCodeAt(0) << 24) | (text.charCodeAt(1) << 16) | (text.charCodeAt(2) << 8) | text.charCodeAt(3);
const IHDR = chunkType("IHDR");
const IDAT = chunkType("IDAT");
const IEND = chunkType("IEND");
const TRNS = chunkType("tRNS");

// 이 크기의 그림을 JPG로 만들지 못하면 그 까닭을 돌려준다. 만들 수 있으면 null
export function sizeProblem(width, height) {
  const size = `${width.toLocaleString("ko-KR")}×${height.toLocaleString("ko-KR")}px`;
  if (width > JPG_MAX_SIDE || height > JPG_MAX_SIDE) {
    return `한 변이 ${JPG_MAX_SIDE.toLocaleString("ko-KR")}px을 넘어 JPG로 만들 수 없습니다 (${size})`;
  }
  if (width * height > MAX_PIXELS) return `화소가 너무 많아 브라우저가 다루지 못합니다 (${size})`;
  return null;
}

// PNG 파일 머리를 읽는다. { width, height, alpha: 투명한 화소가 있을 수 있음 }. PNG가 아니면 null
export async function pngInfo(read) {
  const head = await read(0, 33);
  if (head.length < 33 || PNG_SIGNATURE.some((value, i) => head[i] !== value)) return null;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (view.getUint32(12) !== IHDR) return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  // 색 종류 4(회색+투명도)와 6(RGB+투명도)은 투명도가 따로 있다
  const colorType = head[25];
  if (colorType === 4 || colorType === 6) return { width, height, alpha: true };
  // 나머지(회색·RGB·색상표)는 tRNS 조각이 있을 때만 투명한 화소가 있다. tRNS는 그림 데이터(IDAT)보다 앞에 온다.
  // 끝까지 찾지 못하면(파일이 이상하면) 투명할 수 있다고 본다
  for (let offset = 33, count = 0; count < 200; count++) {
    const chunk = await read(offset, offset + 8);
    if (chunk.length < 8) break;
    const header = new DataView(chunk.buffer, chunk.byteOffset, 8);
    const type = header.getUint32(4);
    if (type === TRNS) break;
    if (type === IDAT || type === IEND) return { width, height, alpha: false };
    offset += 12 + header.getUint32(0);
  }
  return { width, height, alpha: true };
}

// JPG 파일 머리에서 크기 { width, height }를 읽는다. 찾지 못하면 null
export async function jpegSize(read) {
  const start = await read(0, 2);
  if (start.length < 2 || start[0] !== 0xff || start[1] !== 0xd8) return null;
  for (let offset = 2, count = 0; count < 100; count++) {
    // 조각마다 표시(FF xx), 길이(2바이트)가 오고, 크기 조각(SOF)은 이어서 정밀도(1), 높이(2), 폭(2)이 온다
    const head = await read(offset, offset + 9);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    // SOF0~SOF15 가운데 C4(DHT)·C8(JPG)·CC(DAC)는 크기 조각이 아니다
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (head.length < 9) return null;
      return { height: (head[5] << 8) | head[6], width: (head[7] << 8) | head[8] };
    }
    // 그림 데이터가 시작되거나(DA) 파일이 끝나면(D9) 크기 조각이 없는 것이다
    if (marker === 0xda || marker === 0xd9) return null;
    offset += 2 + ((head[2] << 8) | head[3]);
  }
  return null;
}
