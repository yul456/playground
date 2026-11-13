// 고른 폴더 안에서 사진이 든 폴더를 찾아 묶고, 저장할 파일 이름을 정한다.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다 (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).

import { compareNames, comparePaths, isSkippedFolder } from "../shared/fileNames.js";

// 붙일 사진의 확장자. HEIC·TIFF는 크롬·엣지가 열지 못하지만 목록에 넣어 "열지 못해 뺀 사진"으로 알려 준다
const IMAGE_NAME = /\.(jpe?g|jfif|png|gif|webp|bmp|avif|heic|heif|tiff?)$/i;

export const isImageName = (name) => !name.startsWith(".") && IMAGE_NAME.test(name);

// 고른 폴더(root) 아래를 모두 돌며 사진이 든 하위 폴더마다 묶음 { path, files }를 만든다. path는 고른 폴더부터의 폴더 이름들이다.
// 고른 폴더 바로 안의 사진은 rootFiles로 따로 둔다 (지난 결과를 빼야 해서 planGroups에서 묶는다).
// existing은 고른 폴더 바로 안의 모든 파일 이름(소문자)으로, 덮어쓸 파일을 미리 알려 줄 때 쓴다
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
  return { name: root.name, groups, rootFiles, existing };
}

// <input webkitdirectory>로 받은 파일 목록에서 같은 묶음을 만든다 (폴더에 바로 쓸 수 없는 브라우저용).
// webkitRelativePath는 "a/a1/1.jpg"처럼 고른 폴더 이름부터 시작한다
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
  return { name, groups, rootFiles, existing: new Set() };
}

// 파일 이름 뒤에 붙일 말에서 윈도우 파일 이름에 못 쓰는 글자를 뺀다
export const cleanSuffix = (text) =>
  text
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "")
    .trim()
    .replace(/[. ]+$/, "");

// 저장할 파일 이름을 짓는 방식.
// folder: 그 폴더 이름만 쓴다 (a/a1 → a1_합본.png, a/1 → 1_합본.png, a/1/x → x_합본.png)
// parent: 바로 위 폴더 이름을 앞에 붙인다 (a/1 → a_1_합본.png, a/1/x → 1_x_합본.png). 폴더 이름이 1, 2처럼 짧을 때 쓴다
export const NAMINGS = ["folder", "parent"];

// 저장 형식(확장자). jpg는 사진에 알맞고 작다. JPG 한 장에 담기에 너무 긴 묶음은 사진 사이에서 나눠
// 여러 장(1_합본_1.jpg, 1_합본_2.jpg …)으로 저장되고, 폭이 너무 넓은 묶음만 png로 저장된다.
// png는 화질을 하나도 잃지 않지만 크다
export const FORMATS = ["jpg", "png"];

// 묶음마다 저장할 파일 이름. 고른 폴더 자체(path [])는 브라우저가 그 위 폴더를 알려 주지 않아 늘 고른 폴더 이름만 쓴다(a_합본.png).
// 이름이 겹치면 " (2)"처럼 번호를 붙인다. 윈도우는 대소문자가 달라도 같은 이름으로 본다
export function outputNames(groups, suffix, rootName = "", naming = "folder", ext = "png") {
  const used = new Set();
  return groups.map(({ path }) => {
    const folders = [rootName, ...path].filter(Boolean);
    const base = [...folders.slice(naming === "parent" ? -2 : -1), suffix].filter(Boolean).join("_") || "합본";
    let name = `${base}.${ext}`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).${ext}`;
    used.add(name.toLowerCase());
    return name;
  });
}

// 실제로 만들 묶음과 저장할 이름을 정한다. scan은 scanDirectory·groupFileList의 결과다.
// 고른 폴더 바로 안에 사진이 있으면 고른 폴더 자체도 한 묶음(path [])으로 맨 앞에 둔다 (a → a_합본.jpg).
// 결과는 모두 고른 폴더에 저장되므로, 고른 폴더의 사진에서 이 화면이 만들었을 이름의 그림은 뺀다.
// 지금 붙일 말과 전에 쓴 붙일 말(pastSuffixes), 두 이름 방식, 두 저장 형식으로 만들 이름을 모두 본다.
// 붙일 말이나 이름 방식, 저장 형식을 바꿔 다시 돌려도 지난 결과가 붙지 않게 하려는 것이다.
// 길어서 JPG 여러 장으로 나눠 저장한 결과(그 이름에 _1, _2 …를 붙인 JPG)도 뺀다. 번호 앞에 0이 붙은 이름(제주_001.jpg)은
// 이 화면이 만들지 않으므로 사진으로 본다.
// ext는 이번에 저장할 형식이다. JPG로 만들 수 없는 묶음은 화면 쪽이 저장할 때 확장자를 png로 바꾼다
export function planGroups(scan, suffix, pastSuffixes = [], naming = "folder", ext = "png") {
  const all = [{ path: [], files: scan.rootFiles }, ...scan.groups];
  const ours = new Set();
  for (const s of [suffix, ...pastSuffixes]) {
    for (const n of NAMINGS) {
      for (const format of FORMATS) for (const name of outputNames(all, s, scan.name, n, format)) ours.add(name.toLowerCase());
    }
  }
  const isOurs = (name) => {
    const lower = name.toLowerCase();
    if (ours.has(lower)) return true;
    const part = /^(.*)_[1-9]\d*(\.jpg)$/.exec(lower);
    return Boolean(part) && ours.has(part[1] + part[2]);
  };
  const photos = scan.rootFiles.filter((f) => !isOurs(f.name));
  const groups = photos.length
    ? [{ path: [], files: photos, excluded: scan.rootFiles.length - photos.length }, ...scan.groups]
    : scan.groups;
  return { groups, names: outputNames(groups, suffix, scan.name, naming, ext) };
}

// 묶음마다 고르기 상태를 기억할 이름. 고른 폴더 자체는 "."
export const groupKey = (group) => group.path.join("/") || ".";
