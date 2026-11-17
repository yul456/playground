// 고른 폴더를 폴더별 파일 목록으로 읽는다. 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다
// (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).
// 공통의 scanDirectory(shared/folderScan.js)와 달리 목록에 올리지 않는 이름들(others)도 담는다. 바꿀 이름이 그것들과 겹치는지 봐야 한다.
import { compareNames, isSkippedFolder } from "../shared/fileNames.js";

// 태그를 고칠 수 있는 형식은 지금 MP3뿐이다. 다른 오디오는 이름만 바꾼다
const AUDIO = new Set(["m4a", "m4b", "aac", "flac", "ogg", "oga", "opus", "wav", "wma", "aiff", "aif", "ape", "mka", "mp2", "amr", "ac3", "dsf", "wv"]);

// "mp3" · "audio"(다른 오디오) · "file"(그 밖)
export function kindOf(name) {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "file";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "mp3") return "mp3";
  return AUDIO.has(ext) ? "audio" : "file";
}

// 목록에 올리지 않는 파일: 숨김 파일(.으로 시작), 크롬이 저장하는 중에 두는 임시 파일, 윈도우가 폴더마다 두는 파일
const HIDDEN = new Set(["desktop.ini", "thumbs.db"]);
const isHidden = (name) => name.startsWith(".") || name.toLowerCase().endsWith(".crswap") || HIDDEN.has(name.toLowerCase());

// 고른 폴더(root)와 그 아래 폴더를 돌며 폴더마다 { path, dir, files, others }를 만든다.
// path는 고른 폴더부터의 폴더 이름들([]이면 고른 폴더 자체), files는 그 폴더 바로 안의 파일 { name, handle } (이름순),
// others는 그 폴더에 있는 다른 이름들(하위 폴더, 숨김 파일)이다.
// deep이 false면 고른 폴더 바로 안의 파일만 읽는다 (하위 폴더는 others에 이름만 담는다)
export async function scanFolder(root, { deep = true } = {}) {
  const folders = [];
  async function walk(dir, path) {
    const files = [];
    const subs = [];
    const others = [];
    for await (const entry of dir.values()) {
      if (entry.kind === "directory") {
        others.push(entry.name);
        if (!isSkippedFolder(entry.name)) subs.push(entry);
      } else if (isHidden(entry.name)) {
        others.push(entry.name);
      } else {
        files.push({ name: entry.name, handle: entry });
      }
    }
    files.sort((a, b) => compareNames(a.name, b.name));
    folders.push({ path, dir, files, others });
    if (!deep) return;
    subs.sort((a, b) => compareNames(a.name, b.name));
    for (const sub of subs) await walk(sub, [...path, sub.name]);
  }
  await walk(root, []);
  return { name: root.name, folders };
}
