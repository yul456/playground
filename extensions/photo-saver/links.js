// 확장 프로그램 창(팝업·사이드바)의 "링크" 줄: 지금 페이지의 링크를 열린 탭 받기 목록(queue.js)에 넣는다.
// - 고르기: 사이드바에서 켜면 페이지의 링크를 누를 때 열지 않고 목록에 넣거나 뺀다(picker.js를 페이지에 넣고 port로 주고받는다).
//   팝업은 페이지를 누르면 닫혀서, 팝업에서 누르면 사이드바를 열고 그쪽에서 켠다(pickOnOpen)
// - 이 페이지 링크: 페이지의 링크를 주소 모양으로 묶어(linkGroups.js) 체크박스로 보이고, 고른 것을 목록에 넣는다.
//   가장 큰 묶음(글 목록으로 보이는 것)을 처음에 골라 둔다
import { wrapWindowOpen } from "./collect.js";
import { findLinks } from "./core.js";
import { groupLinks, matchesFilter, shapeLabel } from "./linkGroups.js";
import { QUEUE_MAX, loadQueue, queueAdd, queueToggle, watchQueue } from "./queue.js";

const PORT_NAME = "photo-saver-picker";
const PICK_FLAG = "pickOnOpen";

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

// inPanel: 사이드바인지, openPanel(): 팝업에서 사이드바를 여는 함수(popup.js, 누른 그때 불러야 한다)
export function mountLinks({ inPanel, openPanel }) {
  let tabId = null;
  let queue = []; // 목록의 주소들 [{ url, title }]
  let picking = false;
  let port = null;
  let pickRun = 0; // 고르기를 켠 차례. 탭을 빨리 바꾸면 늦게 끝난 앞 탭의 준비를 버린다
  // 이 페이지 링크: { page, groups, chosen: Set(url), open: Set(shape) }
  let view = null;
  let viewRun = 0;

  const inQueue = () => new Set(queue.map((page) => page.url));

  function showCount() {
    $("queueCount").textContent = queue.length ? `목록에 ${queue.length}개` : "";
  }

  // 고르기 -------------------------------------------------------------------

  function showPicking() {
    const button = $("pickLinks");
    button.setAttribute("aria-pressed", String(picking));
    button.textContent = picking ? "고르기 끄기" : "고르기";
    button.title = inPanel
      ? "페이지에서 링크를 눌러 열린 탭 받기 목록에 넣습니다"
      : "사이드바를 열고, 페이지에서 링크를 눌러 열린 탭 받기 목록에 넣습니다";
    $("pickHint").hidden = !picking;
  }

  function pickNote(text) {
    $("pickHint").textContent = text;
    $("pickHint").hidden = false;
  }

  function stopPicker() {
    pickRun++;
    port?.disconnect();
    port = null;
  }

  // 지금 탭에 picker.js를 넣고 연결한다. 탭을 바꾸거나 페이지가 넘어가면 다시 부른다
  async function startPicker() {
    stopPicker();
    if (!picking || tabId == null) return;
    const run = pickRun;
    try {
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["picker.js"] });
      // 새 창으로 여는 글을 잡으려고 페이지 쪽 공간에 window.open 감싸기를 넣는다 (넣지 못해도 고르기는 된다)
      await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, world: "MAIN", func: wrapWindowOpen }).catch(() => {});
    } catch {
      if (run === pickRun) pickNote("이 페이지에서는 링크를 고를 수 없습니다 (크롬 설정·웹 스토어 같은 페이지).");
      return;
    }
    if (run !== pickRun) return;
    pickNote("페이지에서 글을 누르면 열지 않고 열린 탭 받기 목록에 넣고, 다시 누르면 뺍니다. 버튼으로 여는 글도 넘어가려는 주소를 잡아 넣습니다. 넣은 링크는 초록 테두리로 보입니다. 다른 쪽으로 가려면 고르기를 끄고 누르세요.");
    const next = chrome.tabs.connect(tabId, { name: PORT_NAME });
    port = next;
    next.onDisconnect.addListener(() => {
      if (port === next) port = null;
    });
    next.onMessage.addListener(async (message) => {
      if (message?.type !== "pick") return;
      const result = await queueToggle({ url: message.url, title: message.text }).catch((err) => ({ error: err.message }));
      let text = "";
      if (result?.error) text = `넣지 못했습니다: ${result.error}`;
      else if (result.full) text = `목록이 가득 찼습니다 (${QUEUE_MAX}개)`;
      else if (result.invalid) text = "웹 주소가 아니라 넣을 수 없습니다";
      else text = result.inList ? `목록에 넣었습니다 (목록 ${result.pages.length}개)` : `목록에서 뺐습니다 (목록 ${result.pages.length}개)`;
      if (result?.pages) {
        queue = result.pages;
        showCount();
        renderView();
      }
      if (port === next) next.postMessage({ type: "picked", url: message.url, inList: Boolean(result?.inList), text, to: message.from });
    });
    next.postMessage({ type: "marks", urls: queue.map((page) => page.url) });
  }

  function setPicking(on) {
    picking = on;
    showPicking();
    if (on) startPicker();
    else stopPicker();
  }

  $("pickLinks").addEventListener("click", () => {
    if (inPanel) {
      setPicking(!picking);
      return;
    }
    // 팝업: 사이드바를 열고 그쪽에서 고르기를 켠다. 사이드바는 누른 그때만 열 수 있어서 기다리지 않고 부른다
    chrome.storage.local.set({ [PICK_FLAG]: true });
    openPanel();
  });

  // 이 페이지 링크 ------------------------------------------------------------

  function linksNote(text, warn = false) {
    $("linksNote").textContent = text;
    $("linksNote").classList.toggle("warn", warn);
  }

  async function showLinks() {
    const run = ++viewRun;
    $("links").hidden = false;
    $("linkGroups").replaceChildren();
    $("linksTitle").textContent = "이 페이지 링크";
    linksNote("링크를 찾는 중…");
    $("addLinks").disabled = true;
    let page;
    try {
      page = await findLinks(tabId);
    } catch {
      if (run === viewRun) linksNote("이 페이지에서는 링크를 읽을 수 없습니다 (크롬 설정·웹 스토어 같은 페이지).", true);
      return;
    }
    if (run !== viewRun) return;
    const groups = groupLinks(page.links);
    const suggested = groups.find((group) => group.suggested);
    const have = inQueue();
    view = {
      page,
      groups,
      chosen: new Set(suggested ? suggested.links.map((link) => link.url).filter((url) => !have.has(url)) : []),
      open: new Set(suggested ? [suggested.shape] : []),
    };
    linksNote(suggested ? "글 목록으로 보이는 가장 큰 묶음을 골라 두었습니다." : "");
    renderView();
  }

  // 묶음과 링크를 그린다. 거르기 칸에 맞는 링크만 보이고, 묶음 체크박스는 보이는 링크를 한꺼번에 켜고 끈다
  function renderView() {
    if (!view || $("links").hidden) return;
    const filter = $("linkFilter").value;
    const have = inQueue();
    const total = view.page.links.length;
    $("linksTitle").textContent = `이 페이지 링크 ${total}개 · 묶음 ${view.groups.length}개`;
    const nodes = [];
    for (const group of view.groups) {
      const shown = group.links.filter((link) => matchesFilter(link, filter));
      if (!shown.length) continue;
      const pickable = shown.filter((link) => !have.has(link.url));
      const on = pickable.filter((link) => view.chosen.has(link.url)).length;
      const box = el("input", { type: "checkbox", checked: pickable.length > 0 && on === pickable.length, disabled: !pickable.length });
      box.indeterminate = on > 0 && on < pickable.length;
      box.addEventListener("change", () => {
        for (const link of pickable) {
          if (box.checked) view.chosen.add(link.url);
          else view.chosen.delete(link.url);
        }
        renderView();
      });
      const isOpen = view.open.has(group.shape) || Boolean(filter.trim());
      const toggle = el("button", { type: "button", className: "link group-toggle", textContent: isOpen ? "접기" : "펼치기" });
      toggle.addEventListener("click", () => {
        if (view.open.has(group.shape)) view.open.delete(group.shape);
        else view.open.add(group.shape);
        renderView();
      });
      const label = shapeLabel(group.shape, view.page.url);
      const head = el("div", { className: "group-head" }, [
        el("label", { className: "group-name", title: label }, [box, el("span", { textContent: label })]),
        el("span", { className: "group-count", textContent: `${shown.length}개${group.suggested ? " · 글 목록?" : ""}` }),
        toggle,
      ]);
      const children = [head];
      if (isOpen) {
        const list = el("ul", { className: "group-links" });
        for (const link of shown) {
          const listed = have.has(link.url);
          const linkBox = el("input", { type: "checkbox", checked: listed || view.chosen.has(link.url), disabled: listed });
          linkBox.addEventListener("change", () => {
            if (linkBox.checked) view.chosen.add(link.url);
            else view.chosen.delete(link.url);
            renderView();
          });
          let path = link.url;
          try {
            const parsed = new URL(link.url);
            path = decodeURI(parsed.pathname + parsed.search);
          } catch {
            // 그대로
          }
          list.append(
            el("li", { className: listed ? "listed" : "" }, [
              el("label", { title: link.url }, [linkBox, el("span", { className: "link-text", textContent: link.text || path })]),
              listed ? el("span", { className: "link-tag", textContent: "목록에 있음" }) : "",
            ]),
          );
        }
        children.push(list);
      }
      nodes.push(el("div", { className: "link-group" }, children));
    }
    $("linkGroups").replaceChildren(...nodes);
    if (!nodes.length) $("linkGroups").append(el("p", { className: "hint", textContent: total ? "거르기에 맞는 링크가 없습니다." : "이 페이지에는 링크가 없습니다." }));
    const count = [...view.chosen].filter((url) => !have.has(url)).length;
    $("addLinks").disabled = !count;
    $("addLinks").textContent = count ? `${count}개를 열린 탭 받기 목록에 넣기` : "열린 탭 받기 목록에 넣기";
  }

  async function addChosen() {
    if (!view) return;
    const have = inQueue();
    const byUrl = new Map(view.page.links.map((link) => [link.url, link]));
    const pages = [...view.chosen].filter((url) => !have.has(url)).map((url) => ({ url, title: byUrl.get(url)?.text ?? "" }));
    if (!pages.length) return;
    $("addLinks").disabled = true;
    const result = await queueAdd(pages).catch((err) => ({ error: err.message }));
    if (result?.error) {
      linksNote(`넣지 못했습니다: ${result.error}`, true);
      renderView();
      return;
    }
    queue = result.pages;
    showCount();
    view.chosen.clear();
    let text = `${result.added}개를 넣었습니다 (목록 ${queue.length}개). 열린 탭 받기에서 받으세요.`;
    if (result.full) text += ` 목록이 가득 차 ${result.full}개는 넣지 못했습니다.`;
    linksNote(text, Boolean(result.full));
    renderView();
    port?.postMessage({ type: "marks", urls: queue.map((page) => page.url) });
  }

  $("showLinks").addEventListener("click", showLinks);
  $("closeLinks").addEventListener("click", () => {
    viewRun++;
    view = null;
    $("links").hidden = true;
  });
  $("linkFilter").addEventListener("input", renderView);
  $("addLinks").addEventListener("click", addChosen);

  // 목록 ---------------------------------------------------------------------

  // 다른 곳(열린 탭 받기 화면, 오른쪽 클릭 메뉴)에서 목록을 바꾸면 수와 표시를 맞춘다
  watchQueue((pages) => {
    queue = pages;
    showCount();
    renderView();
    port?.postMessage({ type: "marks", urls: queue.map((page) => page.url) });
  });

  // 팝업에서 "고르기"를 눌러 사이드바를 열었으면 고르기를 켠다 (사이드바가 먼저 열려도 놓치지 않게 바뀜도 듣는다)
  if (inPanel) {
    const takeFlag = async () => {
      const flag = (await chrome.storage.local.get(PICK_FLAG))[PICK_FLAG];
      if (!flag) return;
      await chrome.storage.local.remove(PICK_FLAG);
      setPicking(true);
    };
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "local" && changes[PICK_FLAG]?.newValue) takeFlag();
    });
    takeFlag();
  }

  loadQueue().then((pages) => {
    queue = pages;
    showCount();
  });
  showPicking();
  $("pickHint").hidden = true;

  return {
    // 지금 탭이 바뀌거나 다른 페이지로 넘어갔다 (popup.js follow). 고르기 중이면 새 페이지에 다시 넣고, 링크 목록이 열려 있으면 다시 읽는다
    setTab(id) {
      tabId = id;
      if (picking) startPicker();
      if (!$("links").hidden) showLinks();
    },
  };
}
