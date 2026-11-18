// 고른 폴더 안에서 사진이 든 폴더를 찾아 묶고, 저장할 파일 이름을 정한다.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다 (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).

import { compareNames, comparePaths, isSkippedFolder, partName } from "../shared/fileNames.js";
import { hasMark } from "../shared/resultMark.js";

// 붙일 사진의 확장자. HEIC·TIFF는 크롬·엣지가 열지 못하지만 목록에 넣어 "열지 못해 뺀 사진"으로 알려 준다
const IMAGE_NAME = /\.(jpe?g|jfif|png|gif|webp|bmp|avif|heic|heif|tiff?)$/i;

export const isImageName = (name) => !name.startsWith(".") && IMAGE_NAME.test(name);

// 고른 폴더(root) 아래를 모두 돌며 사진이 든 하위 폴더마다 묶음 { path, files }를 만든다. path는 고른 폴더부터의 폴더 이름들이다.
// 고른 폴더 바로 안의 사진은 rootFiles로 따로 둔다 (지난 결과를 빼야 해서 planGroups에서 묶는다).
// existing은 고른 폴더 바로 안의 모든 파일 이름(소문자)으로, 같은 이름의 파일이 있는지 미리 볼 때 쓴다.
// marked는 그 가운데 이 화면이 만든 표시가 있는 그림의 이름(소문자)이다 (findMarked)
export async function scanDirectory(root) {
  const groups = [];
  const existing = new Set();
  let rootFiles = [];
  async function walk(dir, path) {
    const files = [];
    const folders = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "directory") {
        if (!isSkippedFolder(entry.name)) folders.push(entry);
        continue;
      }
      if (!path.length) existing.add(entry.name.toLowerCase());
      if (isImageName(entry.name)) files.push(entry);
    }
    files.sort((a, b) => compareNames(a.name, b.name));
    if (!path.length) rootFiles = files;
    else if (files.length) groups.push({ path, files });
    folders.sort((a, b) => compareNames(a.name, b.name));
    for (const folder of folders) await walk(folder, [...path, folder.name]);
  }
  await walk(root, []);
  return { name: root.name, groups, rootFiles, existing, marked: await findMarked(rootFiles) };
}

// 그림들 가운데 이 화면이 만든 표시(shared/resultMark.js)가 있는 것의 이름(소문자). 결과는 jpg·png로만 저장하므로 그 둘만 연다.
// files는 파일 핸들이나 File이다. 파일 앞쪽만 조금 읽고, 여러 개를 함께 읽는다. 읽지 못한 파일은 표시가 없는 것으로 본다
export async function findMarked(files) {
  const marked = new Set();
  const candidates = files.filter((f) => /\.(jpg|png)$/i.test(f.name));
  let next = 0;
  const read = async () => {
    while (next < candidates.length) {
      const entry = candidates[next++];
      try {
        const file = typeof entry.getFile === "function" ? await entry.getFile() : entry;
        if (await hasMark(file)) marked.add(entry.name.toLowerCase());
      } catch {
        // 그사이 지워졌거나 읽을 수 없는 파일
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, read));
  return marked;
}

// <input webkitdirectory>로 받은 파일 목록에서 같은 묶음을 만든다 (폴더에 바로 쓸 수 없는 브라우저용).
// webkitRelativePath는 "a/a1/1.jpg"처럼 고른 폴더 이름부터 시작한다.
// 표시가 있는 그림(marked)은 파일을 읽어야 알 수 있어서 부르는 쪽이 findMarked(rootFiles)로 채운다
export function groupFileList(files) {
  const byFolder = new Map();
  let name = "";
  const rootFiles = [];
  for (const file of files) {
    const parts = file.webkitRelativePath.split("/");
    name ||= parts[0];
    const path = parts.slice(1, -1);
    if (!isImageName(file.name) || path.some(isSkippedFolder)) continue;
    if (!path.length) {
      rootFiles.push(file);
      continue;
    }
    const key = path.join("/");
    if (!byFolder.has(key)) byFolder.set(key, { path, files: [] });
    byFolder.get(key).files.push(file);
  }
  const groups = [...byFolder.values()].sort((a, b) => comparePaths(a.path, b.path));
  for (const group of groups) group.files.sort((a, b) => compareNames(a.name, b.name));
  rootFiles.sort((a, b) => compareNames(a.name, b.name));
  return { name, groups, rootFiles, existing: new Set(), marked: new Set() };
}

// 파일 이름 뒤에 붙일 말에서 윈도우 파일 이름에 못 쓰는 글자를 빼고, 끝의 빈칸과 점을 뗀다.
// 붙일 말은 적은 그대로 이름 뒤에 붙으므로 앞과 가운데의 빈칸은 그대로 둔다 (" 합본" → "1 합본.jpg")
export const cleanSuffix = (text) =>
  text
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .replace(/[. ]+$/, "");

// 저장할 파일 이름을 짓는 방식. 붙일 말은 그 뒤에 적은 그대로 붙는다 (붙일 말이 "_합본"이면 1_합본.jpg, 없으면 1.jpg).
// folder: 그 폴더 이름만 쓴다 (a/a1 → a1.jpg, a/1 → 1.jpg, a/1/x → x.jpg)
// parent: 바로 위 폴더 이름을 앞에 붙인다 (a/1 → a_1.jpg, a/1/x → 1_x.jpg). 폴더 이름이 1, 2처럼 짧을 때 쓴다
export const NAMINGS = ["folder", "parent"];

// 저장 형식(확장자). jpg는 사진에 알맞고 작다. JPG 한 장에 담기에 너무 긴 묶음은 사진 사이에서 나눠
// 여러 장(1_1.jpg, 1_2.jpg …)으로 저장되고, 폭이 너무 넓은 묶음만 png로 저장된다.
// png는 화질을 하나도 잃지 않지만 크다
export const FORMATS = ["jpg", "png"];

// 전에는 이름 뒤에 "_"와 붙일 말을 붙였고 기본 붙일 말이 "합본"이었다 (1_합본.jpg). 그때 만든 결과에는 표시가 없어서
// 이름으로 알아본다 (planGroups의 oldSuffixes). 화면 쪽이 저장해 둔 그때의 붙일 말들에 이 값을 더해 넘긴다
export const OLD_SUFFIX = "_합본";

// 묶음의 바탕 이름(확장자와 번호를 뺀 이름). 폴더 이름(이름 방식에 따라 위 폴더 이름도)에 붙일 말을 적은 그대로 붙인다.
// 고른 폴더 자체(path [])는 브라우저가 그 위 폴더를 알려 주지 않아 늘 고른 폴더 이름만 쓴다
function baseName(path, suffix, rootName, naming) {
  const folders = [rootName, ...path].filter(Boolean);
  const stem = folders.slice(naming === "parent" ? -2 : -1).join("_");
  return (stem ? stem + suffix : suffix.trimStart()) || "합본";
}

// 묶음마다 저장할 파일 이름. 이름이 겹치면 " (2)"처럼 번호를 붙인다. 윈도우는 대소문자가 달라도 같은 이름으로 본다.
// taken(소문자 이름)이 true인 이름도 피한다 (고른 폴더에 있는, 이 화면이 만들지 않은 파일의 이름)
export function outputNames(groups, suffix, rootName = "", naming = "folder", ext = "png", taken = () => false) {
  const used = new Set();
  return groups.map(({ path }) => {
    const base = baseName(path, suffix, rootName, naming);
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()) || taken(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// 그림 이름에서 이 화면이 붙이는 번호를 떼어 본 바탕 이름 후보들(소문자). jpg·png가 아니면 없다.
//   "1 (2)_3.jpg" → "1 (2)_3", "1 (2)", "1"
// 나눠 저장한 번호(_3)는 JPG에만 붙고 앞에 0이 없다. 이름이 겹쳐 붙인 번호는 " (2)"부터다
function stemsOf(name) {
  const file = /^(.*)\.(jpg|png)$/.exec(name.toLowerCase());
  if (!file) return [];
  const stems = [file[1]];
  const part = file[2] === "jpg" ? /^(.*)_[1-9]\d*$/.exec(file[1]) : null;
  if (part) stems.push(part[1]);
  for (const stem of [...stems]) {
    const numbered = /^(.*) \((?:[2-9]|[1-9]\d+)\)$/.exec(stem);
    if (numbered) stems.push(numbered[1]);
  }
  return stems;
}

// 실제로 저장할 이름들을 정한다. planned는 계획한 이름, ext는 실제로 만든 형식(JPG로 만들 수 없었으면 png), parts는 장수다.
// 여러 장이면 이름에 번호를 붙인다 (1.jpg → 1_1.jpg, 1_2.jpg). 그렇게 정한 이름 가운데 하나라도 쓸 수 없으면(blocked: 고른 폴더에
// 있는 다른 파일, 이번에 다른 묶음이 쓰는 이름) 바탕 이름의 번호를 올린다 (1 (2)_1.jpg …). 계획한 이름을 쓸 수 있으면 그대로다
export function finalNames(planned, ext, parts, blocked = () => false) {
  const stem = planned.replace(/\.[^.]*$/, "");
  const numbered = /^(.*) \(([2-9]|[1-9]\d+)\)$/.exec(stem);
  const base = numbered ? numbered[1] : stem;
  for (let n = numbered ? Number(numbered[2]) : 1; n < 10000; n++) {
    const single = `${n === 1 ? base : `${base} (${n})`}.${ext}`;
    const names = parts > 1 ? Array.from({ length: parts }, (_, k) => partName(single, k + 1)) : [single];
    if (!names.some((name) => blocked(name.toLowerCase()))) return names;
  }
  throw new Error("저장할 이름을 정하지 못했습니다");
}

// 실제로 만들 묶음과 저장할 이름을 정한다. scan은 scanDirectory·groupFileList의 결과다.
// 고른 폴더 바로 안에 사진이 있으면 고른 폴더 자체도 한 묶음(path [])으로 맨 앞에 둔다 (a → a.jpg).
// 결과는 모두 고른 폴더에 저장되므로, 고른 폴더의 사진에서 이 화면이 전에 만든 그림(지난 결과)은 뺀다. 지난 결과는 둘이다.
//   - 이 화면이 넣은 표시(shared/resultMark.js, scan.marked)가 있고, 이름이 지금 붙일 말이나 전에 쓴 붙일 말(pastSuffixes)로
//     이 폴더에서 만들 이름인 그림. 두 이름 방식, 두 형식, 이름이 겹쳐 붙인 번호( (2)), 나눠 저장한 번호(_1, _2 …)를 모두 본다.
//     붙일 말이나 이름 방식, 저장 형식을 바꿔 다시 돌려도 지난 결과가 붙지 않게 하려는 것이다.
//   - 표시를 넣기 전에 만든 그림: 이름이 그때의 붙일 말(oldSuffixes)로 만들 이름과 같은 것. 나눠 저장한 이름(그 이름에 _1, _2 …를
//     붙인 JPG)도 본다. 번호 앞에 0이 붙은 이름(제주_합본_01.jpg)은 이 화면이 만들지 않으므로 사진으로 본다.
// 표시가 없는 그림은 이름이 결과 이름과 같아도 사진으로 본다. 붙일 말을 비우면 결과 이름이 폴더 이름과 같아서(제주.jpg, 나누면
// 제주_1.jpg) 이름만으로는 원래 있던 사진과 가릴 수 없다.
// 저장할 이름(names)은 고른 폴더에 있는 다른 파일(지난 결과가 아닌 것)의 이름을 피해 번호를 붙인다(avoided). 지난 결과와 이름이
// 같으면 그대로 두어 덮어쓴다.
// ext는 이번에 저장할 형식이다. JPG로 만들 수 없는 묶음은 화면 쪽이 저장할 때 확장자를 png로 바꾼다 (finalNames).
// isOurs(이름)는 그 이름의 파일이 지난 결과인지 알려 준다 (저장할 때 다른 파일을 덮어쓰지 않는 데 쓴다)
export function planGroups(scan, suffix, pastSuffixes = [], naming = "folder", ext = "png", oldSuffixes = [OLD_SUFFIX]) {
  const all = [{ path: [], files: scan.rootFiles }, ...scan.groups];
  const marked = scan.marked ?? new Set();
  const existing = scan.existing ?? new Set();
  // 표시가 있는 그림: 지금 붙일 말이나 전에 쓴 붙일 말로 이 폴더에서 나올 바탕 이름
  const bases = new Set();
  for (const s of [suffix, ...pastSuffixes]) {
    for (const n of NAMINGS) for (const { path } of all) bases.add(baseName(path, s, scan.name, n).toLowerCase());
  }
  // 표시를 넣기 전에 만든 그림: 그때의 붙일 말로 만들 이름 그대로 (빈 붙일 말은 이름만으로 가릴 수 없어 보지 않는다)
  const oldNames = new Set();
  for (const s of oldSuffixes.filter(Boolean)) {
    for (const n of NAMINGS) {
      for (const format of FORMATS) for (const name of outputNames(all, s, scan.name, n, format)) oldNames.add(name.toLowerCase());
    }
  }
  const isOld = (lower) => {
    if (oldNames.has(lower)) return true;
    const part = /^(.*)_[1-9]\d*(\.jpg)$/.exec(lower);
    return Boolean(part) && oldNames.has(part[1] + part[2]);
  };
  const isOurs = (name) => {
    const lower = name.toLowerCase();
    return isOld(lower) || (marked.has(lower) && stemsOf(lower).some((stem) => bases.has(stem)));
  };
  const photos = scan.rootFiles.filter((f) => !isOurs(f.name));
  const groups = photos.length
    ? [{ path: [], files: photos, excluded: scan.rootFiles.length - photos.length }, ...scan.groups]
    : scan.groups;
  const taken = (lower) => existing.has(lower) && !isOurs(lower);
  const names = outputNames(groups, suffix, scan.name, naming, ext, taken);
  const plain = outputNames(groups, suffix, scan.name, naming, ext);
  return { groups, names, avoided: names.map((name, i) => name !== plain[i]), isOurs };
}

// 묶음마다 고르기 상태를 기억할 이름. 고른 폴더 자체는 "."
export const groupKey = (group) => group.path.join("/") || ".";
