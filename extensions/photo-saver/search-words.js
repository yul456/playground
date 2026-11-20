// 고른 글자에 붙여 구글 검색할 말 (사용자 요청, 2026-11-19, 1.21.0). 확장 프로그램 창(search.js)과 서비스 워커(background.js)가 함께 쓴다.
// 페이지에서 글자를 고르고 오른쪽 클릭하면 붙일 말마다 "구글 검색: 고른글가격" 같은 메뉴가 나오고, 누르면 새 탭에서 "고른 글 + 붙일 말"로 구글 검색을 연다.
// 붙일 말은 적은 그대로 고른 글 바로 뒤에 붙인다. 띄어 쓰려면 붙일 말 앞에 빈칸을 넣는다 (사용자 결정, 2026-11-19: 띄어쓰기 없이 찾는 경우가 많다고 했다).
// 목록은 chrome.storage.local의 searchWords에 둔다 (메뉴에 보이는 순서). 서비스 워커가 목록이 바뀔 때 오른쪽 클릭 메뉴를 다시 만든다.
// 설정 세트에는 넣지 않는다 (서비스 워커는 세트가 든 localStorage를 읽지 못한다)

export const SEARCH_KEY = "searchWords";
export const SEARCH_MAX = 20;
export const WORD_MAX = 50;
// 고른 글은 이만큼까지만 검색에 쓴다 (주소가 너무 길어지지 않게)
export const SELECTION_MAX = 1000;

// 붙일 말: 적은 그대로 둔다 (앞의 빈칸은 띄어 쓰는 표시다). 빈칸 비슷한 글자(탭, 줄 바꿈 등)는 빈칸으로 바꾸고, 보이지 않는 끝의 빈칸만 뗀다
export const cleanWord = (text) => String(text ?? "").replace(/\s/g, " ").trimEnd().slice(0, WORD_MAX);
// 긴 글은 앞쪽만 쓴다. 자른 끝에 짝 잃은 반쪽 글자(이모지 등의 앞 절반)가 남으면 뗀다 (주소로 바꿀 때 오류가 난다)
function cut(text) {
  const out = text.slice(0, SELECTION_MAX);
  const last = out.charCodeAt(out.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? out.slice(0, -1) : out;
}
// 줄 바꿈·여러 칸은 한 칸으로, 앞뒤 빈칸은 뗀다 (기호는 그대로 둔다)
export const tidyText = (text) => cut(String(text ?? "").replace(/\s+/g, " ").trim());

// 고른 글·복사한 글의 앞뒤에서 뗄 기호 (창의 "기호 떼기" 칸. 사용자 요청, 2026-11-20, 1.26.0).
// 사용자는 윈도우 탐색기의 이름 칸에서 필요한 부분을 더블클릭해 복사해 쓰는데, "399-xxx"의 399를 더블클릭하면 "399-"까지 골라져서
// 복사하기 전에 고른 곳을 손봐야 했다. 탐색기가 고르는 방식은 확장 프로그램이 바꿀 수 없어서, 그대로 복사해도 되게 쓰는 쪽에서 뗀다.
// 처음엔 내가 정한 기호 묶음(- _ . , 괄호 등)을 켜고 끄는 칸으로 만들었는데, 사용자가 뗄 기호를 직접 적어 두는 쪽을 바랐다
// ("내가 원하는 기호를 넣어두면 걔들은 제외하고 하게 할 수 있나? 저렇게 온오프 말고"). 그래서 적어 둔 기호만 뗀다. 비우면 떼지 않는다.
// chrome.storage.local의 trimChars에 기호를 이어 붙인 글로 둔다 ("-_"). 저장한 적이 없으면 사용자가 말한 "-" 하나다 (처음 값은 내가 정했다).
// select-button.js는 이 모듈을 가져다 쓸 수 없어 같은 처음 값을 따로 적어 둔다. 고치면 함께 고친다.
export const TRIM_KEY = "trimChars";
export const TRIM_DEFAULT = "-";
export const TRIM_MAX = 30;

// 적은 것에서 기호만 남긴다: 빈칸·글자·숫자는 뺀다 (글의 앞뒤 글자가 떨어져 나가지 않게). 같은 기호는 한 번만, TRIM_MAX개까지
export function cleanMarks(text) {
  const marks = [];
  for (const ch of String(text ?? "")) {
    if (marks.length >= TRIM_MAX) break;
    if (/[\s\p{L}\p{N}\p{M}]/u.test(ch) || marks.includes(ch)) continue;
    marks.push(ch);
  }
  return marks.join("");
}

export async function loadMarks() {
  try {
    const stored = (await chrome.storage.local.get(TRIM_KEY))[TRIM_KEY];
    return typeof stored === "string" ? cleanMarks(stored) : TRIM_DEFAULT;
  } catch {
    return TRIM_DEFAULT;
  }
}

// 고른 글·복사한 글을 쓸 글로 다듬는다: 줄 바꿈·여러 칸은 한 칸으로 하고, 앞뒤에 붙은 빈칸과 marks의 기호를 뗀다.
// marks는 부르는 쪽이 loadMarks로 읽어 넘긴다 (없으면 빈칸만 다듬는다: tidyText와 같다).
// - 앞뒤에 몇 개가 붙어 있든, 빈칸이 섞여 있든 뗀다: marks가 "-_"일 때 "399-" → "399", "- 399 _" → "399"
// - 가운데의 기호는 건드리지 않는다: "399-xxx"를 통째로 복사하면 그대로
// - 적어 두지 않은 기호는 그대로 둔다: marks가 "-"일 때 "399." → "399."
export function cleanSelection(text, marks = "") {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!marks) return cut(flat);
  const drop = new Set(marks);
  const edge = (ch) => ch === " " || drop.has(ch);
  // 긴 글은 앞쪽만 쓰므로, 앞의 기호를 먼저 떼고 자른 뒤에 끝의 기호를 뗀다 (자른 끝에 걸린 기호도 떼인다)
  let start = 0;
  for (const ch of flat) {
    if (!edge(ch)) break;
    start += ch.length;
  }
  const chars = Array.from(cut(flat.slice(start)));
  let end = chars.length;
  while (end > 0 && edge(chars[end - 1])) end--;
  return chars.slice(0, end).join("");
}

export async function loadWords() {
  try {
    const list = (await chrome.storage.local.get(SEARCH_KEY))[SEARCH_KEY];
    if (!Array.isArray(list)) return [];
    const words = [];
    for (const item of list) {
      const word = cleanWord(item);
      if (word && !words.includes(word)) words.push(word);
    }
    return words.slice(0, SEARCH_MAX);
  } catch {
    return [];
  }
}

export const saveWords = (list) => chrome.storage.local.set({ [SEARCH_KEY]: list.slice(0, SEARCH_MAX) });

// 고른 글 바로 뒤에 붙일 말을 붙인 구글 검색 주소. 고른 글은 부르는 쪽이 cleanSelection으로 다듬어 넘긴다 (여기서는 기호를 떼지 않는다)
export const searchUrl = (text, word) => `https://www.google.com/search?q=${encodeURIComponent(`${tidyText(text)}${cleanWord(word)}`.trim())}`;
