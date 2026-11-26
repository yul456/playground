// 확장 프로그램 창(팝업·사이드바)의 "색 찍기" 줄 (사용자 요청, 2026-11-26, 1.31.0).
// - "화면에서 색 찍기": 크롬의 EyeDropper로 화면의 한 점을 찍는다. 웹 페이지 밖(다른 프로그램, 바탕화면)도 찍힌다.
//   창에서 바로 연다. 팝업은 찍는 동안 닫히지 않았다 (창이 뜨는 시험용 크롬, 맥에서 확인. 찍는 클릭까지는 확인하지 못했다)
// - 찍으면 고른 적는 법(HEX·RGB·HSL)으로 바로 복사하고, 최근 색 8개를 기억한다. 색을 누르면 다시 복사한다
// - 권한은 늘리지 않는다. 복사는 창에서 한다 (navigator.clipboard, 안 되면 글 칸을 골라 execCommand)
// 최근 색과 적는 법은 chrome.storage.local에 두고 설정 세트와 따로다
import { COLOR_FORMATS, addColor, cleanColors, cleanHex, formatColor, isLight } from "./color-format.js";

const COLORS_KEY = "pickedColors";
const FORMAT_KEY = "colorFormat";
const $ = (id) => document.getElementById(id);

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 창에 초점이 없으면 거절된다. 글 칸에 넣고 골라 복사해 본다
    const area = document.createElement("textarea");
    area.value = text;
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

export function mountColor() {
  const bar = $("colorBar");
  // EyeDropper가 없는 브라우저(크롬 95 전)에서는 줄을 보이지 않는다
  if (!("EyeDropper" in window)) return;
  bar.hidden = false;
  const button = $("colorPick");
  const select = $("colorFormat");
  const list = $("colorList");
  const clear = $("colorClear");
  const note = $("colorNote");
  let colors = [];
  let format = "hex";
  let picking = false;

  const say = (text, warn = false) => {
    note.textContent = text;
    note.classList.toggle("warn", warn);
    note.hidden = !text;
  };

  async function copy(hex) {
    const text = formatColor(hex, format);
    say((await copyText(text)) ? `${text} 을 복사했습니다.` : `${text} (복사하지 못했습니다. 색을 눌러 다시 복사해 보세요.)`);
  }

  function render() {
    select.value = format;
    list.hidden = colors.length === 0;
    clear.hidden = colors.length === 0;
    list.replaceChildren(
      ...colors.map((hex) => {
        const li = document.createElement("li");
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "color-chip";
        chip.style.background = hex;
        chip.style.color = isLight(hex) ? "#111" : "#fff";
        chip.textContent = formatColor(hex, format);
        chip.title = "누르면 복사합니다";
        chip.addEventListener("click", () => copy(hex));
        li.append(chip);
        return li;
      }),
    );
  }

  button.addEventListener("click", async () => {
    if (picking) return;
    picking = true;
    button.disabled = true;
    say("화면에서 색을 찍을 곳을 누르세요. Esc를 누르면 그만둡니다.");
    try {
      const result = await new window.EyeDropper().open();
      const hex = cleanHex(result?.sRGBHex);
      if (!hex) say("색을 읽지 못했습니다.", true);
      else {
        colors = addColor(colors, hex);
        render();
        chrome.storage.local.set({ [COLORS_KEY]: colors }).catch(() => {});
        await copy(hex);
      }
    } catch (e) {
      // Esc로 그만두면 AbortError다
      if (e?.name === "AbortError") say("");
      else say("색 찍기를 열지 못했습니다.", true);
    }
    picking = false;
    button.disabled = false;
  });

  select.addEventListener("change", () => {
    format = COLOR_FORMATS.includes(select.value) ? select.value : "hex";
    chrome.storage.local.set({ [FORMAT_KEY]: format }).catch(() => {});
    render();
  });

  clear.addEventListener("click", () => {
    colors = [];
    chrome.storage.local.set({ [COLORS_KEY]: [] }).catch(() => {});
    say("");
    render();
  });

  // 다른 창(팝업·사이드바)에서 바꾼 것도 맞춘다
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[COLORS_KEY]) colors = cleanColors(changes[COLORS_KEY].newValue);
    if (changes[FORMAT_KEY] && COLOR_FORMATS.includes(changes[FORMAT_KEY].newValue)) format = changes[FORMAT_KEY].newValue;
    if (changes[COLORS_KEY] || changes[FORMAT_KEY]) render();
  });
  chrome.storage.local.get([COLORS_KEY, FORMAT_KEY]).then((saved) => {
    colors = cleanColors(saved[COLORS_KEY]);
    if (COLOR_FORMATS.includes(saved[FORMAT_KEY])) format = saved[FORMAT_KEY];
    render();
  });
}
