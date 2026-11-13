// 고른 폴더 안에서 바꿀 사진을 찾고, 저장할 이름과 건너뛸 것을 정한다.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다 (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).
import { compareNames, comparePaths, isSkippedFolder, partName } from "../shared/fileNames.js";
import { evenSplit, jpgMaxHeight, pngInfo } from "../shared/imageInfo.js";

// 바꿀 방향. 지금은 PNG → JPG 하나다. 방향을 더하려면 여기에 넣고, 작업자(convertWorker.js)가 그 형식을 만들 수 있게 한다.
// source: 읽을 파일 이름, accept: 파일 고르기 창에 보일 형식, ext: 저장할 확장자, type: 만들 형식
export const DIRECTIONS = [
  { key: "png-jpg", from: "PNG", to: "JPG", source: /\.png$/i, accept: { "image/png": [".png"] }, ext: "jpg", type: "image/jpeg" },
];

export const directionOf = (key) => DIRECTIONS.find((direction) => direction.key === key) ?? DIRECTIONS[0];

// 고른 폴더(root) 아래를 모두 돌며 폴더마다 { path, dir, files }를 만든다.
// path는 고른 폴더부터의 폴더 이름들([]이면 고른 폴더 자체), dir은 그 폴더(바꾼 파일을 저장할 곳),
// files는 그 폴더 바로 안의 파일 { name, handle }이다.
// 바꿀 형식이 아닌 파일도 담아 둔다. 같은 이름의 결과가 이미 있는지 보는 데 쓰고, 방향을 바꿔도 폴더를 다시 읽지 않는다
export async function scanDirectory(root) {
  const folders = [];
  async function walk(dir, path) {
    const files = [];
    const subs = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "directory") {
        if (!isSkippedFolder(entry.name)) subs.push(entry);
      } else if (!entry.name.startsWith(".")) {
        files.push({ name: entry.name, handle: entry });
      }
    }
    files.sort((a, b) => compareNames(a.name, b.name));
    folders.push({ path, dir, files });
    subs.sort((a, b) => compareNames(a.name, b.name));
    for (const sub of subs) await walk(sub, [...path, sub.name]);
  }
  await walk(root, []);
  return { name: root.name, folders };
}

// <input webkitdirectory>로 받은 파일 목록에서 같은 모양을 만든다 (폴더에 바로 쓸 수 없는 브라우저용. dir은 null, 파일은 { name, file }).
// webkitRelativePath는 "a/1/x.png"처럼 고른 폴더 이름부터 시작한다
export function groupFileList(list) {
  const byFolder = new Map();
  let name = "";
  for (const file of list) {
    const parts = file.webkitRelativePath.split("/");
    name ||= parts[0];
    const path = parts.slice(1, -1);
    if (file.name.startsWith(".") || path.some(isSkippedFolder)) continue;
    const key = path.join("/");
    if (!byFolder.has(key)) byFolder.set(key, { path, dir: null, files: [] });
    byFolder.get(key).files.push({ name: file.name, file });
  }
  const folders = [...byFolder.values()].sort((a, b) => comparePaths(a.path, b.path));
  for (const folder of folders) folder.files.sort((a, b) => compareNames(a.name, b.name));
  return { name, folders };
}

// 직접 고른 파일을 폴더 하나처럼 만든다 (scanDirectory와 같은 모양에 picked 표시). entries: [{ name, handle 또는 file }].
// 고른 파일의 폴더에는 쓸 권한이 없어 dir은 없다. 저장할 폴더는 바꿀 때 묻는다. 파일 이름순으로 놓는다
export function pickedScan(entries) {
  const files = entries.filter((entry) => !entry.name.startsWith(".")).sort((a, b) => compareNames(a.name, b.name));
  return { name: "고른 파일", picked: true, folders: [{ path: [], dir: null, files }] };
}

// 바꿀 파일과 저장할 이름을 정한다. 바꿀 파일이 있는 폴더만 남긴다.
// 결과: [{ path, dir, items: [{ name, source: scan의 파일({ handle } 또는 { file }), out: 저장할 이름, outs: 저장할 이름들, exists }] }]
// 저장할 이름은 원본과 같은 폴더의 같은 이름에 확장자만 바꾼 것이다 (x.png → x.jpg).
// 너무 길어 여러 장으로 나누면 그 이름에 번호를 붙인다 (x_1.jpg, x_2.jpg …, measureFiles로 크기를 읽어 두었을 때).
// exists는 저장할 이름 가운데 하나라도 이미 있다는 뜻이고, 그런 파일은 덮어쓰지 않고 건너뛴다(사용자 결정).
// 윈도우는 대소문자가 달라도 같은 이름으로 본다
export function planFolders(scan, direction) {
  const plan = [];
  for (const folder of scan.folders) {
    const taken = new Set(folder.files.map((file) => file.name.toLowerCase()));
    const items = [];
    for (const file of folder.files) {
      if (!direction.source.test(file.name)) continue;
      const out = `${file.name.replace(/\.[^.]*$/, "")}.${direction.ext}`;
      const outs = outNames(out, partsFor(file.size, direction));
      const exists = outs.some((name) => taken.has(name.toLowerCase()));
      for (const name of outs) taken.add(name.toLowerCase());
      items.push({ name: file.name, source: file, out, outs, exists });
    }
    if (items.length) plan.push({ path: folder.path, dir: folder.dir, items });
  }
  return plan;
}

// 폴더에 파일이 새로 생긴 것을 적는다. 바꾼 결과를 저장한 뒤 다시 돌리면 "이미 있음"으로 알아본다
export function addFile(scan, path, name) {
  const key = path.join("/");
  return {
    ...scan,
    folders: scan.folders.map((folder) => (folder.path.join("/") === key ? { ...folder, files: [...folder.files, { name }] } : folder)),
  };
}

// 바꿀 파일마다 그림 크기를 파일 머리에서 읽어 size({ width, height }, 읽지 못하면 null)로 붙인다.
// 너무 길어 JPG 여러 장으로 나눌 파일을 미리 알아, 저장할 이름과 "이미 있음"을 바로 보이려는 것이다.
// 파일마다 앞부분 몇십 바이트만 읽는다. 지금 방향(PNG → JPG)만 있어 PNG 머리를 읽는다
export async function measureFiles(scan, direction) {
  const read = (blob) => async (start, end) => new Uint8Array(await blob.slice(start, end).arrayBuffer());
  const measure = async (file) => {
    if (!direction.source.test(file.name) || file.size !== undefined) return file;
    try {
      const blob = file.file ?? (await file.handle.getFile());
      const info = await pngInfo(read(blob));
      return { ...file, size: info && { width: info.width, height: info.height } };
    } catch {
      // 읽지 못하면 크기를 모르는 채로 둔다 (한 장으로 보고, 바꿀 때 연 크기로 다시 정한다)
      return { ...file, size: null };
    }
  };
  const folders = [];
  for (const folder of scan.folders) folders.push({ ...folder, files: await Promise.all(folder.files.map(measure)) });
  return { ...scan, folders };
}

// 이 크기의 그림을 바꾸면 몇 장이 되나. JPG 한 장에 담기에 너무 길면 작업자(convertWorker.js)처럼 높이를 고르게 나눈다.
// 크기를 모르면 한 장으로 본다
export function partsFor(size, direction) {
  if (!size || direction.type !== "image/jpeg") return 1;
  const maxHeight = jpgMaxHeight(size.width);
  return size.height > maxHeight ? evenSplit(size.height, maxHeight).count : 1;
}

// 저장할 이름들: 한 장이면 [x.jpg], 여러 장이면 [x_1.jpg, x_2.jpg …]
export const outNames = (out, parts) => (parts > 1 ? Array.from({ length: parts }, (_, k) => partName(out, k + 1)) : [out]);

// 폴더마다 고르기 상태를 기억할 이름. 고른 폴더 자체는 "."
export const folderKey = (folder) => folder.path.join("/") || ".";
