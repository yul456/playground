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
// 고른 글: 줄 바꿈·여러 칸은 한 칸으로, 앞뒤 빈칸은 뗀다
export const cleanSelection = (text) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, SELECTION_MAX);

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

// 고른 글 바로 뒤에 붙일 말을 붙인 구글 검색 주소
export const searchUrl = (text, word) => `https://www.google.com/search?q=${encodeURIComponent(`${cleanSelection(text)}${cleanWord(word)}`.trim())}`;
