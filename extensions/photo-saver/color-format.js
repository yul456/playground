// 찍은 색을 글로 적는 방법 (color.js가 쓴다). 브라우저 API가 없어 Node에서 시험할 수 있다
export const COLOR_FORMATS = ["hex", "rgb", "hsl"];
export const COLOR_MAX = 8;

// "#2563eb"·"2563EB"·"#abc" → "#2563EB". 색이 아니면 null
export function cleanHex(value) {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map((c) => c + c).join("");
  // 투명도가 붙어 오면(#rrggbbaa) 색만 쓴다
  if (/^[0-9a-f]{8}$/i.test(hex)) hex = hex.slice(0, 6);
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

const channels = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

function hsl([r, g, b]) {
  const [x, y, z] = [r / 255, g / 255, b / 255];
  const max = Math.max(x, y, z);
  const min = Math.min(x, y, z);
  const light = (max + min) / 2;
  const d = max - min;
  let hue = 0;
  let sat = 0;
  if (d > 0) {
    sat = d / (1 - Math.abs(2 * light - 1));
    if (max === x) hue = ((y - z) / d + 6) % 6;
    else if (max === y) hue = (z - x) / d + 2;
    else hue = (x - y) / d + 4;
    hue *= 60;
  }
  return [Math.round(hue) % 360, Math.round(sat * 100), Math.round(light * 100)];
}

// hex는 cleanHex를 거친 값
export function formatColor(hex, format) {
  const rgb = channels(hex);
  if (format === "rgb") return `rgb(${rgb.join(", ")})`;
  if (format === "hsl") {
    const [h, s, l] = hsl(rgb);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return hex;
}

// 색 위에 글자를 얹을 때 검은 글자가 나은지 (밝은 색이면 true)
export function isLight(hex) {
  const [r, g, b] = channels(hex);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

// 방금 찍은 색을 맨 앞에 두고 같은 색은 한 번만, COLOR_MAX개까지
export function addColor(list, hex) {
  return [hex, ...list.filter((c) => c !== hex)].slice(0, COLOR_MAX);
}

// 저장소에서 읽은 값을 다듬는다
export function cleanColors(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    const hex = cleanHex(item);
    if (hex && !out.includes(hex)) out.push(hex);
  }
  return out.slice(0, COLOR_MAX);
}
