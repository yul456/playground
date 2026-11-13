// 고른 폴더 안에서 바꿀 사진을 찾고, 저장할 이름과 건너뛸 것을 정한다.
// 브라우저 API를 직접 부르지 않아 Node에서 시험할 수 있다 (폴더는 FileSystemDirectoryHandle처럼 생긴 것이면 된다).
import { partName } from "../shared/fileNames.js";
import { jpgMaxHeight, pngInfo, rowSplit } from "../shared/imageInfo.js";

// 폴더 읽기는 오디오 형식 바꾸기와 함께 쓴다 (shared/folderScan.js)
export { addFile, folderKey, groupFileList, pickedScan, scanDirectory } from "../shared/folderScan.js";

// 바꿀 방향. 지금은 PNG → JPG 하나다. 방향을 더하려면 여기에 넣고, 작업자(convertWorker.js)가 그 형식을 만들 수 있게 한다.
// source: 읽을 파일 이름, accept: 파일 고르기 창에 보일 형식, ext: 저장할 확장자, type: 만들 형식
export const DIRECTIONS = [
  { key: "png-jpg", from: "PNG", to: "JPG", source: /\.png$/i, accept: { "image/png": [".png"] }, ext: "jpg", type: "image/jpeg" },
];

export const directionOf = (key) => DIRECTIONS.find((direction) => direction.key === key) ?? DIRECTIONS[0];

// 바꿀 파일과 저장할 이름을 정한다. 바꿀 파일이 있는 폴더만 남긴다.
// 결과: [{ path, dir, items: [{ name, source: scan의 파일({ handle } 또는 { file }), out: 저장할 이름, outs: 저장할 이름들, exists }] }]
// 저장할 이름은 원본과 같은 폴더의 같은 이름에 확장자만 바꾼 것이다 (x.png → x.jpg).
// 너무 길어 여러 장으로 나누면 그 이름에 번호를 붙인다 (x_1.jpg, x_2.jpg …, measureFiles로 크기를 읽어 두었을 때).
// exists는 저장할 이름 가운데 하나라도 이미 있다는 뜻이고, 그런 파일은 덮어쓰지 않고 건너뛴다(사용자 결정).
// split이 false(너무 긴 그림은 바꾸지 않기)면 여러 장이 될 파일은 tooLong으로 표시하고 이름은 한 장짜리로 둔다.
// 윈도우는 대소문자가 달라도 같은 이름으로 본다
export function planFolders(scan, direction, split = true) {
  const plan = [];
  for (const folder of scan.folders) {
    const taken = new Set(folder.files.map((file) => file.name.toLowerCase()));
    const items = [];
    for (const file of folder.files) {
      if (!direction.source.test(file.name)) continue;
      const out = `${file.name.replace(/\.[^.]*$/, "")}.${direction.ext}`;
      const parts = partsFor(file.size, direction);
      const tooLong = !split && parts > 1;
      const outs = outNames(out, tooLong ? 1 : parts);
      const exists = !tooLong && outs.some((name) => taken.has(name.toLowerCase()));
      if (!tooLong) for (const name of outs) taken.add(name.toLowerCase());
      items.push({ name: file.name, source: file, out, outs, exists, tooLong });
    }
    if (items.length) plan.push({ path: folder.path, dir: folder.dir, items });
  }
  return plan;
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

// 이 크기의 그림을 바꾸면 몇 장이 되나. JPG 한 장에 담기에 너무 길면 작업자(convertWorker.js)처럼 나눈다
// (장수는 나누는 방법과 상관없이 같다). 크기를 모르면 한 장으로 본다
export function partsFor(size, direction) {
  if (!size || direction.type !== "image/jpeg") return 1;
  const maxHeight = jpgMaxHeight(size.width);
  return size.height > maxHeight ? rowSplit(size.height, maxHeight).count : 1;
}

// 저장할 이름들: 한 장이면 [x.jpg], 여러 장이면 [x_1.jpg, x_2.jpg …]
export const outNames = (out, parts) => (parts > 1 ? Array.from({ length: parts }, (_, k) => partName(out, k + 1)) : [out]);
