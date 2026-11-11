// 폴더 안 파일을 ZIP 하나로 묶는다 (vite.config.js가 페이지 사진 받기 확장 프로그램을 묶을 때 쓴다).
// 파일을 폴더 이름 없이 ZIP 맨 위에 둔다. 윈도우 "압축 풀기"는 ZIP 이름으로 폴더를 만들어 풀어서,
// 안에 폴더가 또 있으면 photo-saver\photo-saver처럼 두 겹이 된다
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";

// 늘 같은 ZIP이 나오도록 파일 날짜는 2026-01-01 00:00으로 둔다 (DOS 날짜 형식)
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;
const DOS_TIME = 0;
const UTF8_NAMES = 0x0800;

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue; // .DS_Store 등
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

export function zipFolder(dir) {
  const parts = [];
  const central = [];
  let offset = 0;
  const paths = [...files(dir)].sort();
  for (const path of paths) {
    const name = Buffer.from(relative(dir, path).split(sep).join("/"));
    const data = readFileSync(path);
    const packed = deflateRawSync(data, { level: 9 });
    const deflate = packed.length < data.length;
    const body = deflate ? packed : data;
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // 풀 때 필요한 버전 2.0
    local.writeUInt16LE(UTF8_NAMES, 6);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    parts.push(local, name, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4); // 만든 버전
    entry.writeUInt16LE(20, 6); // 풀 때 필요한 버전
    entry.writeUInt16LE(UTF8_NAMES, 8);
    entry.writeUInt16LE(deflate ? 8 : 0, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, name);

    offset += local.length + name.length + body.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(paths.length, 8);
  end.writeUInt16LE(paths.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}
