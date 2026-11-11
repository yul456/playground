// 확장 프로그램이 복사해 쓰는 파일이 원본과 같은지 검사한다 (npm run check에서 돈다).
// 확장 프로그램 폴더는 빌드 없이 그대로 설치하므로 src/의 파일을 import하지 못하고 복사해 둔다
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
// [원본, 복사본]
const COPIES = [["src/stitch/png.js", "extensions/photo-saver/png.js"]];

const different = COPIES.filter(([from, to]) => readFileSync(resolve(ROOT, from), "utf8") !== readFileSync(resolve(ROOT, to), "utf8"));
if (different.length) {
  console.error("복사해 둔 파일이 원본과 다릅니다. 원본을 고쳤으면 복사본에도 똑같이 복사해 주세요.");
  for (const [from, to] of different) console.error(`  ${from} → ${to}`);
  process.exit(1);
}
console.log("복사해 둔 파일 검사 통과");
