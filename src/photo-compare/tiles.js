// 비교 화면은 그림을 칸(타일)으로 나눠 그린다. 화면에 보이는 칸만 만들고, 만든 칸은 기억해 두고 다시 쓴다.
// 그래서 세로가 아주 긴 그림도 보이는 부분만큼만 일한다 (캔버스 한 장의 한계 65,535px와도 상관없다).
//
// JPG 품질별 그림도 칸마다 따로 JPG로 만들어 보인다. JPG는 16×16 칸(색 정보를 반으로 줄여 담을 때)마다 따로 압축되므로,
// 실제 파일의 칸 경계에 맞춰 잘라 둘레에 16px 여유를 두고 만들면 그 칸은 통째로 만든 파일과 화소까지 같다
// (2026-11-18 크롬 157에서 품질 100·95·90·85로 확인). 여유가 없으면 색 정보를 풀 때 이웃 칸을 보기 때문에
// 가장자리 화소가 달라지고, 칸 경계가 8px 어긋나면 화소의 절반쯤이 달라진다.
// 높이가 길어 여러 장으로 나눠 저장되는 그림은 장마다 JPG가 따로라서, 칸 경계도 장의 첫 줄부터 센다.
// 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다

// 칸 한 변(그림 화소). BLOCK의 배수여야 칸이 JPG 압축 칸과 맞는다
export const TILE = 512;
// JPG 압축 칸의 한 변 (색 정보를 반으로 줄여 담으면 16, 품질 100처럼 그대로 담으면 8)
export const BLOCK = 16;
// 칸 둘레에 더 넣어 만드는 여유
export const MARGIN = 16;

// cuts: 장을 나누는 줄 [0, …, 높이] (shared/rowCuts.js의 findCuts). 장 k는 [cuts[k], cuts[k + 1]) 줄이다.
// y줄이 든 장의 번호
export function partAt(cuts, y) {
  let low = 0;
  let high = cuts.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (cuts[mid] <= y) low = mid;
    else high = mid - 1;
  }
  return low;
}

// 그림 좌표의 사각형 rect({ x, y, w, h })에 걸치는 칸들. 위에서 아래로, 같은 줄은 왼쪽에서 오른쪽으로.
// 칸: { part: 장, row: 장 안의 칸 줄, col: 칸 칸, x, y, w, h } (그림 좌표. 그림 오른쪽 끝과 장 끝의 칸은 작다)
export function tilesIn(rect, width, cuts) {
  const tiles = [];
  const height = cuts.at(-1);
  const x0 = Math.max(0, Math.floor(rect.x));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y0 = Math.max(0, Math.floor(rect.y));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  if (x0 >= x1 || y0 >= y1) return tiles;
  for (let part = partAt(cuts, y0); part < cuts.length - 1 && cuts[part] < y1; part++) {
    const top = cuts[part];
    const bottom = cuts[part + 1];
    const rowFrom = Math.floor((Math.max(y0, top) - top) / TILE);
    const rowTo = Math.floor((Math.min(y1, bottom) - 1 - top) / TILE);
    for (let row = rowFrom; row <= rowTo; row++) {
      const y = top + row * TILE;
      const h = Math.min(TILE, bottom - y);
      for (let col = Math.floor(x0 / TILE); col <= Math.floor((x1 - 1) / TILE); col++) {
        const x = col * TILE;
        tiles.push({ part, row, col, x, y, w: Math.min(TILE, width - x), h });
      }
    }
  }
  return tiles;
}

// 칸을 기억할 이름. version: 어느 그림인지(base · q95 · f1 …)
export const tileKey = (version, tile) => `${version}|${tile.part}|${tile.row}|${tile.col}`;

// 품질별 JPG 칸을 만들 때 원본에서 잘라 낼 자리. 칸 둘레에 MARGIN만큼 더하되 그 장과 그림 밖으로는 나가지 않는다.
// 칸이 장의 첫 줄부터 BLOCK에 맞춰 있으니 잘라 낸 자리의 왼쪽·위도 BLOCK에 맞는다. 오른쪽·아래는 BLOCK의 배수이거나
// 실제 파일의 끝(그림의 오른쪽 끝, 장의 끝)이라 인코더가 끝을 채우는 방법도 실제 파일과 같다
export function encodeRect(tile, width, cuts) {
  const top = cuts[tile.part];
  const bottom = cuts[tile.part + 1];
  const x = Math.max(0, tile.x - MARGIN);
  const y = Math.max(top, tile.y - MARGIN);
  const right = Math.min(width, tile.x + tile.w + MARGIN);
  const end = Math.min(bottom, tile.y + tile.h + MARGIN);
  return { x, y, w: right - x, h: end - y };
}

// 그림을 화면에 놓는 자리. view: 보는 자리(보이는 곳의 왼쪽 위, 그림 좌표), zoom: 그림 화소 하나를 화면 화소 몇 개로 그릴지,
// size: 캔버스 크기(화면 화소). 그림이 칸보다 좁으면 가운데에, 낮으면 위에 놓는다.
// 돌려주는 것: { left, top: 그림의 (0, 0)이 놓이는 캔버스 자리, rect: 보이는 그림 사각형 }
export function placement(view, zoom, size, image) {
  const fitsX = image.w * zoom <= size.w;
  const fitsY = image.h * zoom <= size.h;
  const left = fitsX ? Math.floor((size.w - image.w * zoom) / 2) : -Math.round(view.x) * zoom;
  const top = fitsY ? 0 : -Math.round(view.y) * zoom;
  const rect = {
    x: fitsX ? 0 : Math.round(view.x),
    y: fitsY ? 0 : Math.round(view.y),
    w: fitsX ? image.w : Math.ceil(size.w / zoom),
    h: fitsY ? image.h : Math.ceil(size.h / zoom),
  };
  return { left, top, rect };
}

// 보는 자리가 그림 밖으로 나가지 않게 맞춘다 (소수 자리는 그대로 둔다. 끌 때 조금씩 움직인 것을 모으려고)
export function clampView(view, zoom, size, image) {
  const maxX = Math.max(0, image.w - size.w / zoom);
  const maxY = Math.max(0, image.h - size.h / zoom);
  return { x: Math.min(maxX, Math.max(0, view.x)), y: Math.min(maxY, Math.max(0, view.y)) };
}
