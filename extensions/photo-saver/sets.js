// 설정 세트를 고르고, 새로 만들고, 이름을 바꾸고, 지우는 줄. 확장 프로그램 창(popup.js)과 열린 탭 받기(batch.js)가 함께 쓴다.
// 세트를 저장하고 바꾸는 일은 core.js가 한다. 이름을 묻는 칸은 줄 아래에 직접 띄운다
// (확장 프로그램 창에서는 prompt·confirm 창을 띄우면 창이 닫히거나 가려질 수 있다)
import { addSet, listSets, removeSet, renameSet, switchSet } from "./core.js";

// root 안에 줄을 만든다. 세트가 바뀌어 옵션을 다시 읽어야 할 때 onChange를 부른다.
// { refresh(): 세트 목록을 다시 읽는다, setDisabled(끄기): 받는 중처럼 바꾸면 안 될 때 }
export function mountSets(root, onChange) {
  const make = (tag, props = {}, ...children) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };
  const select = make("select", { id: "setSelect" });
  const add = make("button", { type: "button", className: "link", id: "setNew", textContent: "새 세트" });
  const rename = make("button", { type: "button", className: "link", id: "setRename", textContent: "이름 바꾸기" });
  const remove = make("button", { type: "button", className: "link", id: "setDelete", textContent: "지우기" });
  const bar = make("div", { className: "set-bar" }, make("label", { className: "set-pick" }, "설정 세트 ", select), add, rename, remove);

  const label = make("span", { className: "set-label", id: "setLabel" });
  const input = make("input", { id: "setName", maxLength: 20, spellcheck: false, autocomplete: "off", placeholder: "세트 이름" });
  const ok = make("button", { type: "button", id: "setOk" });
  const cancel = make("button", { type: "button", className: "secondary", id: "setCancel", textContent: "취소" });
  const error = make("span", { className: "set-error", id: "setError" });
  const edit = make("div", { className: "set-edit", hidden: true }, label, input, ok, cancel, error);
  root.replaceChildren(bar, edit);

  let action = null; // 지금 묻는 일: new(새 세트) · rename(이름 바꾸기) · delete(지우기)
  let disabled = false;

  function refresh() {
    const { active, names } = listSets();
    select.replaceChildren(...names.map((name) => make("option", { value: name, textContent: name })));
    select.value = active;
    for (const control of [select, add, rename]) control.disabled = disabled;
    remove.disabled = disabled || names.length <= 1;
    remove.title = names.length <= 1 ? "세트가 하나뿐이라 지울 수 없습니다" : "";
    if (disabled) close();
  }

  function open(kind) {
    const { active } = listSets();
    action = kind;
    error.textContent = "";
    input.hidden = kind === "delete";
    input.value = kind === "rename" ? active : "";
    label.textContent =
      kind === "new" ? "지금 설정을 복사해 새 세트를 만듭니다." : kind === "rename" ? `"${active}" 세트의 새 이름` : `"${active}" 세트를 지울까요?`;
    ok.textContent = kind === "new" ? "만들기" : kind === "rename" ? "바꾸기" : "지우기";
    edit.hidden = false;
    if (kind !== "delete") {
      input.focus();
      input.select();
    }
  }

  function close() {
    action = null;
    edit.hidden = true;
  }

  function submit() {
    const kind = action;
    try {
      if (kind === "new") addSet(input.value);
      else if (kind === "rename") renameSet(input.value);
      else if (kind === "delete") removeSet();
      else return;
    } catch (err) {
      error.textContent = err.message;
      return;
    }
    close();
    refresh();
    // 지우면 남은 세트의 설정으로 바뀐다. 새 세트는 지금 설정을 복사한 것이고 이름 바꾸기는 설정을 건드리지 않는다
    if (kind === "delete") onChange();
  }

  select.addEventListener("change", () => {
    const changed = switchSet(select.value);
    refresh();
    if (changed) onChange();
  });
  add.addEventListener("click", () => open("new"));
  rename.addEventListener("click", () => open("rename"));
  remove.addEventListener("click", () => open("delete"));
  ok.addEventListener("click", submit);
  cancel.addEventListener("click", close);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });

  refresh();
  return {
    refresh,
    setDisabled(value) {
      disabled = value;
      refresh();
    },
  };
}
