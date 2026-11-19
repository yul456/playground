// 확장 프로그램 창(팝업·사이드바)의 "구글 검색" 줄: 고른 글자에 붙여 검색할 말 목록 (사용자 요청, 2026-11-19, 1.21.0).
// 사용자는 일하면서 페이지의 글자를 복사해 구글에 붙여 넣고 뒤에 정해진 말을 더해 찾는 일이 많다고 했다.
// 여기서 붙일 말을 더하고 빼면, 서비스 워커가 오른쪽 클릭 메뉴("구글 검색: 고른 글 가격")를 다시 만든다 (search-words.js, background.js).
// 더한 순서대로 메뉴에 나온다. 바꾸는 즉시 저장한다. 쓰는 법은 줄 이름에 마우스를 올리면 보인다 (늘 보이면 창이 길어진다).
// 붙일 말은 적은 그대로 고른 글 바로 뒤에 붙는다 (띄어 쓰려면 앞에 빈칸). 앞의 빈칸이 눈에 보이게 목록에는 고른 글 자리를 "…"로 보인다 ("…가격", "… 가격")
import { SEARCH_KEY, SEARCH_MAX, cleanWord, loadWords, saveWords } from "./search-words.js";

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
}
