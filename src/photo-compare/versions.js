// 사진 비교에 올릴 그림(판)과 설정. 브라우저 API를 쓰지 않아 Node에서 시험할 수 있다
import { compareNames, partRange } from "../shared/fileNames.js";
import { JPG_QUALITIES } from "../shared/jpgQuality.js";
import { SPLIT_MODES } from "../shared/imageInfo.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
export const STORAGE_KEY = "playground.photo-compare.v1";

// 보는 방법: side(나란히, 기본), flip(번갈아: 한 칸에서 같은 자리를 바꿔 가며 본다. 차이를 찾기에는 이쪽이 낫다)
export const MODES = ["side", "flip"];
export const MODE_LABELS = { side: "나란히", flip: "번갈아" };
// 배율: 그림 화소 하나를 화면 화소 몇 개로 그릴지. 1이 실제 크기다. 줄여 보면 JPG의 흠이 가려져 1보다 작은 배율은 두지 않는다
export const ZOOMS = [1, 2, 4];

// 판의 이름: base(원본), q100·q95…(원본을 그 품질의 JPG로 바꾼 것), f1·f2…(견줄 파일)
export const qualityId = (quality) => `q${quality}`;
export const QUALITY_IDS = JPG_QUALITIES.map(qualityId);
// 숨겨 둘 수 있고 설정에 저장하는 판 (견줄 파일은 열 때마다 다르므로 저장하지 않는다)
const SAVED_IDS = new Set(["base", ...QUALITY_IDS]);

// 설정: { hidden: 보지 않을 판(base·q100…), mode: 보는 방법, zoom: 배율, splitMode: 긴 그림을 나누는 방법(shared/imageInfo.js) }
export function readSettings(saved) {
  const settings = { hidden: [], mode: MODES[0], zoom: ZOOMS[0], splitMode: SPLIT_MODES[0] };
  if (!saved || typeof saved !== "object") return settings;
  if (Array.isArray(saved.hidden)) settings.hidden = [...new Set(saved.hidden.filter((id) => SAVED_IDS.has(id)))];
  if (MODES.includes(saved.mode)) settings.mode = saved.mode;
  if (ZOOMS.includes(saved.zoom)) settings.zoom = saved.zoom;
  if (SPLIT_MODES.includes(saved.splitMode)) settings.splitMode = saved.splitMode;
  return settings;
}

// 나눠 저장한 파일 이름(x_1.jpg, x_2.jpg …, shared/fileNames.js의 partName). 번호 앞에 0은 붙이지 않는다
const PART_NAME = /^(.*)_([1-9]\d*)(\.[^./]+)$/;

// 고른 파일들을 견줄 판으로 묶는다. 나눠 저장한 파일(x_1.jpg ~ x_3.jpg)을 함께 고르면 위에서부터 이어 한 그림으로 본다.
// 같은 이름(x)과 확장자의 번호가 1부터 빠짐없이 둘 이상 있을 때만 묶고, 아니면 하나씩 따로 둔다.
// 돌려주는 것: [{ name: 화면에 보일 이름, files: [File …] (위에서부터), size: 합친 바이트 }] (이름순)
export function groupFiles(files) {
  const sets = new Map();
  const groups = [];
  for (const file of files) {
    const match = PART_NAME.exec(file.name);
    if (!match) {
      groups.push([file]);
      continue;
    }
    const key = `${match[1]}${match[3]}`.toLowerCase();
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push({ n: Number(match[2]), file });
  }
  for (const list of sets.values()) {
    list.sort((a, b) => a.n - b.n);
    const whole = list.length > 1 && list.every((item, i) => item.n === i + 1);
    if (whole) groups.push(list.map((item) => item.file));
    else for (const item of list) groups.push([item.file]);
  }
  groups.sort((a, b) => compareNames(a[0].name, b[0].name));
  return groups.map((list) => ({
    name: partRange(list.map((file) => file.name)),
    files: list,
    size: list.reduce((sum, file) => sum + file.size, 0),
  }));
}

// 원본으로 쓸 파일 하나를 고른다 (판을 고르지 않고 여러 파일을 한꺼번에 끌어다 놓았을 때).
// 화질이 깎이지 않은 PNG를 먼저, 없으면 이름순으로 첫 파일. 나눠 저장한 묶음은 원본이 될 수 없다
export function chooseBase(groups) {
  const singles = groups.filter((group) => group.files.length === 1);
  return singles.find((group) => isPng(group.files[0])) ?? singles[0] ?? null;
}

const isPng = (file) => file.type === "image/png" || /\.png$/i.test(file.name);

// 파일 형식을 화면에 보일 짧은 이름 (PNG, JPG …). 모르면 확장자
export function formatName(file) {
  const byType = { "image/png": "PNG", "image/jpeg": "JPG", "image/webp": "WebP", "image/gif": "GIF", "image/bmp": "BMP", "image/avif": "AVIF" };
  if (byType[file.type]) return byType[file.type];
  const ext = /\.([^./]+)$/.exec(file.name)?.[1];
  return ext ? ext.toUpperCase().replace("JPEG", "JPG") : "그림";
}

// 원본과 크기가 같지 않아 견줄 수 없으면 그 까닭. 같으면 null
export function sizeMismatch(base, version) {
  if (base.width === version.width && base.height === version.height) return null;
  const px = (size) => `${size.width.toLocaleString("ko-KR")}×${size.height.toLocaleString("ko-KR")}px`;
  return `원본과 크기가 달라 견줄 수 없습니다 (원본 ${px(base)}, 이 그림 ${px(version)})`;
}
