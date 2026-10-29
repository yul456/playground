// 기능 폴더끼리 서로의 코드를 가져다 쓰지 않는지 검사한다.
// 기능 폴더(src/<기능>)는 자기 폴더와 src/shared만, src/shared는 자기 폴더만 가져다 쓸 수 있다.
// 이 규칙을 지키면 기능 하나를 별도 repo로 옮길 때 폴더 복사만으로 끝난다.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const SRC = resolve(import.meta.dirname, "../src");
const SHARED = "shared";
const IMPORT_PATTERN = /(?:from\s+|import\s*\(?\s*|@import\s+)["']([^"']+)["']/g;

function* sourceFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(jsx?|css)$/.test(entry.name)) yield path;
  }
}

// src 아래 경로의 첫 폴더 이름(기능 이름). src 밖이면 null
function areaOf(path) {
  const rel = relative(SRC, path);
  return rel.startsWith("..") ? null : rel.split(sep)[0];
}

const violations = [];
for (const file of sourceFiles(SRC)) {
  const area = areaOf(file);
  for (const [, specifier] of readFileSync(file, "utf8").matchAll(IMPORT_PATTERN)) {
    // 패키지(react, leaflet 등)는 검사하지 않는다
    if (!specifier.startsWith(".")) continue;
    const target = areaOf(resolve(dirname(file), specifier));
    const allowed = target === area || (target === SHARED && area !== SHARED);
    if (!allowed) violations.push(`${relative(SRC, file)} → ${specifier}`);
  }
}

if (violations.length) {
  console.error("다른 기능 폴더를 가져다 쓰는 import가 있습니다. 공통 코드는 src/shared로 옮겨 주세요.");
  for (const v of violations) console.error(`  src/${v}`);
  process.exit(1);
}
console.log("기능 폴더 경계 검사 통과");
