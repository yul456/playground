// 고른 폴더 안에서 사진이 든 폴더를 찾아 묶고, 저장할 파일 이름을 정한다.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다 (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).

// 붙일 사진의 확장자. HEIC·TIFF는 크롬·엣지가 열지 못하지만 목록에 넣어 "열지 못해 뺀 사진"으로 알려 준다
const IMAGE_NAME = /\.(jpe?g|jfif|png|gif|webp|bmp|avif|heic|heif|tiff?)$/i;
// 윈도우가 드라이브마다 두는 시스템 폴더
const SYSTEM_FOLDERS = new Set(["$recycle.bin", "system volume information"]);

export const isImageName = (name) => !name.startsWith(".") && IMAGE_NAME.test(name);
const isSkippedFolder = (name) => name.startsWith(".") || SYSTEM_FOLDERS.has(name.toLowerCase());

// 윈도우 탐색기 이름순처럼 숫자는 크기대로(1, 2, 10) 놓고 대소문자는 가리지 않는다
const collator = new Intl.Collator("ko", { numeric: true, sensitivity: "base" });
export const compareNames = (a, b) => collator.compare(a, b);

function comparePaths(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const order = compareNames(a[i], b[i]);
    if (order) return order;
  }
  return a.length - b.length;
}

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

// 묶음마다 저장할 파일 이름. 고른 폴더 자체(path [])는 브라우저가 그 위 폴더를 알려 주지 않아 늘 고른 폴더 이름만 쓴다(a_합본.png).
// 이름이 겹치면 " (2)"처럼 번호를 붙인다. 윈도우는 대소문자가 달라도 같은 이름으로 본다
export function outputNames(groups, suffix, rootName = "", naming = "folder") {
  const used = new Set();
  return groups.map(({ path }) => {
    const folders = [rootName, ...path].filter(Boolean);
    const base = [...folders.slice(naming === "parent" ? -2 : -1), suffix].filter(Boolean).join("_") || "합본";
    let name = `${base}.png`;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base} (${n}).png`;
    used.add(name.toLowerCase());
    return name;
  });
}

// 실제로 만들 묶음과 저장할 이름을 정한다. scan은 scanDirectory·groupFileList의 결과다.
// 고른 폴더 바로 안에 사진이 있으면 고른 폴더 자체도 한 묶음(path [])으로 맨 앞에 둔다 (a → a_합본.png).
// 결과는 모두 고른 폴더에 저장되므로, 고른 폴더의 사진에서 이 화면이 만들었을 이름의 그림은 뺀다.
// 지금 붙일 말과 전에 쓴 붙일 말(pastSuffixes), 두 이름 방식으로 만들 이름을 모두 본다.
// 붙일 말이나 이름 방식을 바꿔 다시 돌려도 지난 결과가 붙지 않게 하려는 것이다
export function planGroups(scan, suffix, pastSuffixes = [], naming = "folder") {
  const all = [{ path: [], files: scan.rootFiles }, ...scan.groups];
  const ours = new Set();
  for (const s of [suffix, ...pastSuffixes]) {
    for (const n of NAMINGS) for (const name of outputNames(all, s, scan.name, n)) ours.add(name.toLowerCase());
  }
  const photos = scan.rootFiles.filter((f) => !ours.has(f.name.toLowerCase()));
  const groups = photos.length
    ? [{ path: [], files: photos, excluded: scan.rootFiles.length - photos.length }, ...scan.groups]
    : scan.groups;
  return { groups, names: outputNames(groups, suffix, scan.name, naming) };
}

// 묶음마다 고르기 상태를 기억할 이름. 고른 폴더 자체는 "."
export const groupKey = (group) => group.path.join("/") || ".";
