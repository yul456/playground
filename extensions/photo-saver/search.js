// 확장 프로그램 창(팝업·사이드바)의 "구글 검색" 줄: 고른 글자에 붙여 검색할 말 목록 (사용자 요청, 2026-11-19, 1.21.0).
// 사용자는 일하면서 페이지의 글자를 복사해 구글에 붙여 넣고 뒤에 정해진 말을 더해 찾는 일이 많다고 했다.
// 여기서 붙일 말을 더하고 빼면, 서비스 워커가 오른쪽 클릭 메뉴("구글 검색: 고른 글 가격")를 다시 만든다 (search-words.js, background.js).
// 더한 순서대로 메뉴에 나온다. 바꾸는 즉시 저장한다. 쓰는 법은 줄 이름에 마우스를 올리면 보인다 (늘 보이면 창이 길어진다).
// 붙일 말은 적은 그대로 고른 글 바로 뒤에 붙는다 (띄어 쓰려면 앞에 빈칸). 앞의 빈칸이 눈에 보이게 목록에는 고른 글 자리를 "…"로 보인다 ("…가격", "… 가격")
import { SEARCH_KEY, SEARCH_MAX, TRIM_KEY, cleanMarks, cleanWord, loadMarks, loadWords, saveWords } from "./search-words.js";

const $ = (id) => document.getElementById(id);

export function mountSearch() {
  let words = [];
  const input = $("searchWord");
  const list = $("searchWords");
  const note = $("searchNote");

  const say = (text, warn = false) => {
    note.textContent = text;
    note.classList.toggle("warn", warn);
    note.hidden = !text;
  };

  function render() {
    list.hidden = words.length === 0;
    list.replaceChildren(
      ...words.map((word) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        text.textContent = `…${word}`;
        text.title = `구글 검색: 고른글${word}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "빼기";
        remove.addEventListener("click", () => save(words.filter((w) => w !== word)));
        li.append(text, remove);
        return li;
      }),
    );
  }

  async function save(next) {
    words = next;
    render();
    await saveWords(next);
  }

  $("searchAdd").addEventListener("submit", async (event) => {
    event.preventDefault();
    const word = cleanWord(input.value);
    if (!word) return;
    if (words.includes(word)) {
      say(`"${word}"은(는) 이미 있습니다.`, true);
      return;
    }
    if (words.length >= SEARCH_MAX) {
      say(`붙일 말은 ${SEARCH_MAX}개까지 둘 수 있습니다.`, true);
      return;
    }
    input.value = "";
    say("");
    await save([...words, word]);
  });
  input.addEventListener("input", () => say(""));

  // 다른 창(팝업·사이드바)에서 바꾼 것도 맞춘다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[SEARCH_KEY]) return;
    loadWords().then((next) => {
      words = next;
      render();
    });
  });
  loadWords().then((next) => {
    words = next;
    render();
  });

  // 고른 글 옆 단추 (select-button.js가 글자를 고를 때마다 이 값을 읽는다). 처음엔 켬
  const selectButton = $("selectButton");
  chrome.storage.local
    .get("selectButton")
    .then((got) => {
      selectButton.checked = got.selectButton !== false;
    })
    .catch(() => {});
  selectButton.addEventListener("change", () => chrome.storage.local.set({ selectButton: selectButton.checked }).catch(() => {}));

  // 기호 떼기: 고른 글·복사한 글의 앞뒤에서 뗄 기호를 이어서 적어 둔다 (search-words.js의 cleanSelection. 사용자 요청, 2026-11-20, 1.26.0).
  // 적는 대로 바로 저장하고, 쓰는 쪽이 쓸 때마다 읽는다. 비우면 떼지 않는다. 빈칸·글자·숫자는 받지 않는다 (기호만. 같은 기호는 한 번만)
  const marks = $("trimChars");
  const marksNote = $("trimNote");
  const sayMarks = (text) => {
    marksNote.textContent = text;
    marksNote.classList.toggle("warn", Boolean(text));
    marksNote.hidden = !text;
  };
  function takeMarks() {
    const value = cleanMarks(marks.value);
    if (value !== marks.value) {
      // 받지 않는 글자는 그 자리에서 지운다. 커서는 지운 만큼 당긴다 (끝으로 튀지 않게)
      const caret = cleanMarks(marks.value.slice(0, marks.selectionStart ?? marks.value.length)).length;
      const typed = marks.value;
      marks.value = value;
      marks.setSelectionRange(Math.min(caret, value.length), Math.min(caret, value.length));
      sayMarks(/[\s\p{L}\p{N}\p{M}]/u.test(typed) ? "글자·숫자·빈칸은 넣을 수 없습니다. 기호만 이어서 적어 주세요 (예: -_)." : "");
    } else {
      sayMarks("");
    }
    chrome.storage.local.set({ [TRIM_KEY]: value }).catch(() => {});
  }
  // 한글처럼 조합해서 치는 글자는 조합이 끝난 뒤에 거른다 (치는 중에 칸을 고치면 입력기가 꼬인다)
  marks.addEventListener("input", (event) => {
    if (!event.isComposing) takeMarks();
  });
  marks.addEventListener("compositionend", takeMarks);
  loadMarks().then((value) => {
    marks.value = value;
  });
  // 다른 창(팝업·사이드바)에서 바꾼 것도 맞춘다 (이 칸에 치는 중이면 건드리지 않는다)
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[TRIM_KEY] || document.activeElement === marks) return;
    loadMarks().then((value) => {
      marks.value = value;
    });
  });
}
