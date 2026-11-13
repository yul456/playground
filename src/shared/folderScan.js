// 고른 폴더(또는 고른 파일들)를 폴더별 파일 목록으로 읽는다. 사진 형식 바꾸기와 오디오 형식 바꾸기가 쓴다.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다 (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).
import { compareNames, comparePaths, isSkippedFolder } from "./fileNames.js";

// 고른 폴더(root) 아래를 모두 돌며 폴더마다 { path, dir, files }를 만든다.
// path는 고른 폴더부터의 폴더 이름들([]이면 고른 폴더 자체), dir은 그 폴더(바꾼 파일을 저장할 곳),
// files는 그 폴더 바로 안의 파일 { name, handle }이다.
// 바꿀 형식이 아닌 파일도 담아 둔다. 같은 이름의 결과가 이미 있는지 보는 데 쓰고, 바꿀 형식을 바꿔도 폴더를 다시 읽지 않는다
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

// 폴더에 파일이 새로 생긴 것을 적는다. 바꾼 결과를 저장한 뒤 다시 돌리면 "이미 있음"으로 알아본다
export function addFile(scan, path, name) {
  const key = path.join("/");
  return {
    ...scan,
    folders: scan.folders.map((folder) => (folder.path.join("/") === key ? { ...folder, files: [...folder.files, { name }] } : folder)),
  };
}

// 폴더마다 고르기 상태를 기억할 이름. 고른 폴더 자체는 "."
export const folderKey = (folder) => folder.path.join("/") || ".";
