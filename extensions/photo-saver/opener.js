// 확장 프로그램 아이콘을 누르면 무엇을 열지: 팝업(기본) · 사이드바(크롬 사이드 패널, 크롬 116부터).
// 팝업에서 "사이드바로 열기"를 누르면 사이드바가 되고, 사이드바에서 "팝업으로 돌아가기"를 누르면 팝업이 된다.
// 팝업 창(popup.js)과 서비스 워커(background.js)가 함께 쓴다.
// 이 값은 설정 세트에 넣지 않고 chrome.storage.local에 따로 둔다. 브라우저를 켤 때 서비스 워커가 다시 맞춰야 하는데,
// 서비스 워커는 다른 옵션이 든 localStorage를 읽지 못한다

export const OPEN_IN = ["popup", "panel"];
const KEY = "openIn";

export async function loadOpenIn() {
  try {
    const value = (await chrome.storage.local.get(KEY))[KEY];
    return OPEN_IN.includes(value) ? value : "popup";
  } catch {
    return "popup";
  }
}

export const saveOpenIn = (value) => chrome.storage.local.set({ [KEY]: value });

// 아이콘을 누를 때의 동작을 맞춘다. 팝업을 비워 두면 아이콘을 누를 때 사이드바가 열린다(openPanelOnActionClick)
export async function applyOpenIn(value) {
  await chrome.action.setPopup({ popup: value === "panel" ? "" : "popup.html" });
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: value === "panel" });
}
