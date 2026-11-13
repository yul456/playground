// 그림 파일 머리에서 크기를 읽고, 그 크기를 JPG로 만들 수 있는지 본다. JPG 한 장에 담지 못하는 긴 그림은 나눌 자리를 정한다.
// 사진 형식 바꾸기와 사진 세로로 붙이기가 쓴다.
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

// JPG 한 장에 담을 수 있는 가장 긴 높이. 폭이 넓으면 캔버스의 화소 수 한계 때문에 더 짧다
export const jpgMaxHeight = (width) => Math.min(JPG_MAX_SIDE, Math.floor(MAX_PIXELS / Math.max(1, width)));

// 나눌 자리를 찾을 때, 고르게 나눈 자리에서 앞뒤로 이만큼(줄)까지 더 나은 줄을 찾는다
const SPLIT_RADIUS = 3000;

// 이 크기의 그림을 JPG 한 장으로 만들지 못하면 그 까닭을 돌려준다. 만들 수 있으면 null
export function sizeProblem(width, height) {
  const size = `${width.toLocaleString("ko-KR")}×${height.toLocaleString("ko-KR")}px`;
  if (width > JPG_MAX_SIDE || height > JPG_MAX_SIDE) {
    return `한 변이 ${JPG_MAX_SIDE.toLocaleString("ko-KR")}px을 넘어 JPG로 만들 수 없습니다 (${size})`;
  }
  if (width * height > MAX_PIXELS) return `화소가 너무 많아 브라우저가 다루지 못합니다 (${size})`;
  return null;
}

// 높이가 길어 JPG 한 장에 담지 못하는 그림은 여러 장으로 나눠 만든다. 폭이 너무 넓은 그림만은 나눠도 JPG로 만들 수 없다.
// 그럴 때의 까닭을 돌려준다. 나눠서라도 만들 수 있으면 null
export function widthProblem(width) {
  if (width <= JPG_MAX_SIDE) return null;
  return `폭이 ${JPG_MAX_SIDE.toLocaleString("ko-KR")}px을 넘어 JPG로 만들 수 없습니다 (폭 ${width.toLocaleString("ko-KR")}px)`;
}

// 세로로 이어 붙일 사진들을 사진과 사진 사이에서 나눈다. heights: 위에서부터 사진마다의 높이, maxHeight: 한 장의 가장 긴 높이.
// 장수를 가장 적게 하고, 그 장수 안에서 가장 긴 장이 가장 짧아지게(고르게) 나눈다.
// 한 장보다 긴 사진은 그 사진 안을 고르게 자른다.
// 돌려주는 것: 장마다 [시작 줄, 끝 줄] (끝 줄은 들지 않는다). 모두 이어 붙인 그림의 줄 번호다
export function splitAtPhotos(heights, maxHeight) {
  // 자를 수 있는 자리(사진 경계)로 나뉜 조각들의 높이
  const pieces = [];
  for (const height of heights) {
    const n = Math.ceil(height / maxHeight);
    for (let k = 0; k < n; k++) pieces.push(Math.round(((k + 1) * height) / n) - Math.round((k * height) / n));
  }
  const total = pieces.reduce((sum, piece) => sum + piece, 0);
  // 한 장을 cap 줄까지 채우며 앞에서부터 담으면 몇 장이 되나
  const countWith = (cap) => {
    let parts = 1;
    let sum = 0;
    for (const piece of pieces) {
      if (sum + piece > cap) {
        parts++;
        sum = piece;
      } else sum += piece;
    }
    return parts;
  };
  const fewest = countWith(maxHeight);
  // 같은 장수로 나뉘는 가장 작은 cap을 찾는다. 그만큼 장마다의 길이가 고르다
  let low = Math.max(...pieces, Math.ceil(total / fewest));
  let high = maxHeight;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (countWith(mid) <= fewest) high = mid;
    else low = mid + 1;
  }
  const parts = [];
  let start = 0;
  let sum = 0;
  for (const piece of pieces) {
    if (sum + piece > low) {
      parts.push([start, start + sum]);
      start += sum;
      sum = piece;
    } else sum += piece;
  }
  parts.push([start, start + sum]);
  return parts;
}

// 사진 경계를 모르는 긴 그림(이미 이어 붙인 PNG 등)을 나눌 자리. 높이를 고르게 나눈 자리(targets: 다음 장이 시작하는 줄)와,
// 그 자리에서 앞뒤로 더 나은 줄(빈 줄 등)을 찾아도 되는 줄 수(radius)를 돌려준다. 장수는 가장 적게(높이 ÷ 한 장의 가장 긴 높이) 하고,
// radius는 자를 자리를 옮겨도 한 장이 maxHeight를 넘지 않을 만큼만 준다
export function evenSplit(height, maxHeight) {
  const count = Math.ceil(height / maxHeight);
  const room = Math.floor((maxHeight - height / count) / 2);
  const targets = Array.from({ length: count - 1 }, (_, k) => Math.round(((k + 1) * height) / count));
  return { count, targets, radius: Math.max(0, Math.min(SPLIT_RADIUS, room)) };
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
