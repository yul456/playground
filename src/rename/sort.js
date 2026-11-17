// 표의 줄을 정렬한다. 화면 코드가 없어 Node에서 시험할 수 있다.
//
// 정렬 기준(key): "name" 파일 이름 · "picture" 앨범 아트가 있는지 · 태그 칸의 이름(title, artist, album …)
// 사용자가 표의 머리글을 누를 때 한 번 정렬한다. 그 뒤에 칸을 고쳐도 줄은 그 자리에 있다
// (치는 동안 줄이 옮겨 다니지 않게. 다시 정렬하려면 머리글을 다시 누른다).
import { compareNames } from "../shared/fileNames.js";

// 화면에 보이는 값: 고친 것이 있으면 고친 값이다
const nameOf = (row) => (row.edit.base ?? row.base) + row.ext;
const isReady = (row) => row.tags?.state === "ready";
const tagOf = (row, key) => row.edit.tags?.[key] ?? row.tags.values[key] ?? "";
const hasPicture = (row) => (row.edit.picture === undefined ? row.tags.pictures > 0 : row.edit.picture !== null);

// 글 두 개를 견준다. 빈 글이 앞이고, 나머지는 윈도우 탐색기의 이름순이다 (숫자는 크기대로, 대소문자 안 가림)
const compareText = (a, b) => (a === "") - (b === "") ? (b === "") - (a === "") : compareNames(a, b);

// 트랙 "3/12"는 번호로 견준다. 빈 칸이 앞이고, 그다음이 번호 순서, 번호가 아닌 글("A1")은 맨 뒤에 글 순서로 둔다
function compareTrack(a, b) {
  const [x, y] = [Number.parseInt(a, 10), Number.parseInt(b, 10)];
  const rank = (text, n) => (text === "" ? 0 : Number.isNaN(n) ? 2 : 1);
  if (rank(a, x) !== rank(b, y)) return rank(a, x) - rank(b, y);
  return (rank(a, x) === 1 ? x - y : 0) || compareText(a, b);
}

// 줄들을 key로 정렬한 새 배열을 돌려준다.
//   폴더 묶음은 그대로 두고(폴더의 순서도 그대로) 그 안에서만 정렬한다. descending이면 거꾸로다.
//   name: 파일 이름순.  picture: 앨범 아트가 없는 줄이 앞(거꾸로면 있는 줄이 앞).
//   태그 칸: 그 칸의 글 순서. 빈 칸이 앞이다(거꾸로면 뒤). 트랙은 번호로 견준다.
//   태그가 없는 줄(오디오가 아닌 파일, 태그를 읽지 못한 파일)은 태그 칸·앨범 아트로 정렬할 때 늘 그 폴더의 맨 뒤에 둔다.
//   값이 같은 줄은 지금 순서를 지킨다. 그래서 트랙으로 정렬한 뒤 앨범으로 정렬하면 앨범마다 트랙 순서가 남는다
export function sortRows(rows, key, descending = false) {
  const sign = descending ? -1 : 1;
  let compare;
  if (key === "name") {
    compare = (a, b) => sign * compareNames(nameOf(a), nameOf(b));
  } else {
    const value = key === "picture" ? (a, b) => hasPicture(a) - hasPicture(b) : key === "track" ? (a, b) => compareTrack(tagOf(a, key), tagOf(b, key)) : (a, b) => compareText(tagOf(a, key), tagOf(b, key));
    compare = (a, b) => {
      if (!isReady(a) || !isReady(b)) return isReady(b) - isReady(a);
      return sign * value(a, b);
    };
  }
  // 고르게 정렬된다(stable): 견준 값이 같으면 원래 순서가 남는다
  return [...rows].sort((a, b) => a.folder - b.folder || compare(a, b));
}
