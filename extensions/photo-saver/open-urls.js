// 확장 프로그램 창(팝업·사이드바)의 "주소 열기" 줄: 고른 글자를 넣어 열 주소 목록 (사용자 요청, 2026-11-19, 1.22.0).
// 주소에 {a}처럼 고른 글이 들어갈 자리를 적어 더하면, 서비스 워커가 오른쪽 클릭 메뉴("열기: aaa.com/고른글/b")를 다시 만든다
// (url-templates.js, background.js). 더한 순서대로 메뉴에 나온다. 바꾸는 즉시 저장한다
import { URL_KEY, URL_MAX, loadTemplates, parseTemplate, saveTemplates, templateLabel } from "./url-templates.js";

const $ = (id) => document.getElementById(id);

export function mountOpenUrls() {
  let templates = [];
  const input = $("urlTemplate");
  const list = $("urlTemplates");
  const note = $("urlNote");

  const say = (text, warn = false) => {
    note.textContent = text;
    note.classList.toggle("warn", warn);
    note.hidden = !text;
  };

  function render() {
    list.hidden = templates.length === 0;
    list.replaceChildren(
      ...templates.map((template) => {
        const li = document.createElement("li");
        const text = document.createElement("span");
        // 바꿀 자리는 적은 그대로 보인다 ({a}). 앞의 https://만 뗀다
        text.textContent = template.replace(/^https?:\/\//i, "");
        text.title = `열기: ${templateLabel(template).replaceAll("%s", "고른글")}\n${template}`;
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "×";
        remove.title = "빼기";
        remove.addEventListener("click", () => save(templates.filter((t) => t !== template)));
        li.append(text, remove);
        return li;
      }),
    );
  }

  async function save(next) {
    templates = next;
    render();
    await saveTemplates(next);
  }

  $("urlAdd").addEventListener("submit", async (event) => {
    event.preventDefault();
    const { template, error } = parseTemplate(input.value);
    if (!template) {
      say(error, Boolean(error));
      return;
    }
    if (templates.includes(template)) {
      say("이미 있는 주소입니다.", true);
      return;
    }
    if (templates.length >= URL_MAX) {
      say(`주소는 ${URL_MAX}개까지 둘 수 있습니다.`, true);
      return;
    }
    input.value = "";
    say("");
    await save([...templates, template]);
  });
  input.addEventListener("input", () => say(""));

  // 다른 창(팝업·사이드바)에서 바꾼 것도 맞춘다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !changes[URL_KEY]) return;
    loadTemplates().then((next) => {
      templates = next;
      render();
    });
  });
  loadTemplates().then((next) => {
    templates = next;
    render();
  });
}
