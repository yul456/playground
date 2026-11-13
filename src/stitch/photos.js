// 직접 고른 사진 목록을 다룬다: 순서, 같은 사진 빼기, 붙였을 때의 크기, 저장할 형식과 이름.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다.
// 사진 하나: { id, name, file, handle(파일 고르기 창으로 고른 것만), bytes, modified, width, height, error(열지 못하는 사진) }
import { compareNames, partName } from "../shared/fileNames.js";
import { jpgMaxHeight, sizeProblem, splitAtPhotos, widthProblem } from "../shared/imageInfo.js";

// 파일 이름순. 폴더로 붙일 때와 같은 순서다 (숫자는 크기대로: 1, 2, 10)
export const sortByName = (photos) => [...photos].sort((a, b) => compareNames(a.name, b.name));

// 같은 사진인지: 이름·크기·바뀐 때가 모두 같으면 같은 사진으로 본다
const sameKey = (photo) => `${photo.name}\n${photo.bytes}\n${photo.modified}`;

// 이미 고른 사진 뒤에 새로 고른 사진을 더한다. 이미 있는 사진은 더하지 않는다.
// { photos: 더한 목록, dropped: 겹쳐서 더하지 않은 사진 }
export function addPhotos(photos, added) {
  const seen = new Set(photos.map(sameKey));
  const kept = [];
  const dropped = [];
  for (const photo of added) {
    if (seen.has(sameKey(photo))) dropped.push(photo);
    else {
      seen.add(sameKey(photo));
      kept.push(photo);
    }
  }
  return { photos: [...photos, ...kept], dropped };
}

// from 자리의 사진을 to 자리로 옮긴다. 자리가 맞지 않으면 그대로 돌려준다
export function movePhoto(photos, from, to) {
  if (from === to || from < 0 || to < 0 || from >= photos.length || to >= photos.length) return photos;
  const next = [...photos];
  const [photo] = next.splice(from, 1);
  next.splice(to, 0, photo);
  return next;
}

// 붙일 사진(열지 못하는 사진은 뺀다)
export const usable = (photos) => photos.filter((photo) => !photo.error);

// 붙였을 때의 크기 { width, height }. 폭은 가장 넓은 사진, 높이는 모두 더한 값이다.
// 아직 크기를 재지 못한 사진이 있거나 붙일 사진이 없으면 null
export function stitchedSize(photos) {
  const list = usable(photos);
  if (!list.length || list.some((photo) => !photo.width)) return null;
  return { width: Math.max(...list.map((photo) => photo.width)), height: list.reduce((sum, photo) => sum + photo.height, 0) };
}

// 저장할 형식과 장수 { ext, note, parts }. 아직 크기를 다 재지 못했으면 null.
// JPG는 한 장에 담기에 너무 길면 사진과 사진 사이에서 나눠 여러 장(parts)으로 만든다. 작업자(stitchWorker.js)와 같은 규칙이다
// (장수는 나누는 방법과 상관없이 같다). split이 false(나누지 않기)거나 폭이 너무 넓어 JPG로 만들 수 없으면 png이고,
// note가 그 까닭이다
export function plannedFormat(format, photos, split = true) {
  const size = stitchedSize(photos);
  if (!size) return null;
  if (format !== "jpg") return { ext: "png", note: null, parts: 1 };
  const maxHeight = jpgMaxHeight(size.width);
  const note = widthProblem(size.width) ?? (!split && size.height > maxHeight ? sizeProblem(size.width, size.height) : null);
  if (note) return { ext: "png", note, parts: 1 };
  const parts = size.height > maxHeight ? splitAtPhotos(usable(photos).map((photo) => photo.height), maxHeight).length : 1;
  return { ext: "jpg", note: null, parts };
}

// 저장할 이름. 첫 사진 이름(확장자 빼고)에 붙일 말을 붙인다 (001.jpg → 001_합본.jpg).
// 여러 장으로 나누면(parts) 이 이름에 번호를 붙인 이름들로 저장한다 (001_합본_1.jpg, 001_합본_2.jpg …).
// 저장할 이름이 고른 사진과 같아지면 그 사진을 덮어쓰지 않도록 " (2)"처럼 번호를 붙인다. 윈도우는 대소문자가 달라도 같은 이름으로 본다
export function outputName(photos, suffix, ext, parts = 1) {
  const first = usable(photos)[0] ?? photos[0];
  const stem = [first ? first.name.replace(/\.[^.]*$/, "") : "", suffix].filter(Boolean).join("_") || "합본";
  const taken = new Set(photos.map((photo) => photo.name.toLowerCase()));
  const clashes = (name) => (parts > 1 ? partNames(name, parts) : [name]).some((each) => taken.has(each.toLowerCase()));
  let name = `${stem}.${ext}`;
  for (let n = 2; clashes(name); n++) name = `${stem} (${n}).${ext}`;
  return name;
}

// 여러 장으로 나눠 저장할 때의 이름들
export const partNames = (name, parts) => Array.from({ length: parts }, (_, k) => partName(name, k + 1));
