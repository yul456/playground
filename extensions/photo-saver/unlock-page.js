// 오른쪽 클릭·글자 고르기·복사·끌기를 막아 둔 페이지를 푼다. 페이지 쪽 공간(MAIN)에서 돈다 (모듈이 아닌 그냥 스크립트):
// - 늘 푸는 사이트는 페이지가 뜨기 시작할 때(document_start) 프레임마다 콘텐츠 스크립트로 돈다 (unlock-sites.js가 등록)
// - "막기 풀기" 단추는 지금 페이지의 프레임마다 executeScript로 넣는다 (unlock.js)
// 사이트는 이 이벤트들을 받아 기본 동작을 막는다(preventDefault, oncontextmenu="return false" 등). 그래서 창(window)의 capture 단계,
// 곧 사이트 코드보다 먼저 받아 더 퍼지지 않게 한다(stopImmediatePropagation). 크롬의 기본 동작(메뉴 띄우기, 글자 고르기, 복사)은 막지 않는다.
// 왼쪽 버튼과 다른 단축키는 건드리지 않는다(페이지의 단추·메뉴는 그대로 돈다).
// 사이트가 먼저 창의 capture 단계에 단 처리기는 그 뒤에 단 이것보다 먼저 돈다. 페이지가 뜰 때 넣는 늘 풀기는 사이트 코드보다 먼저라 그것도 막고,
// 다 뜬 뒤에 넣는 단추는 그것을 막지 못한다.
// 마지막 값이 executeScript의 결과다: 이미 풀었으면 { again: true }
(() => {
  if (window.__photoSaverUnlocked) return { again: true };
  window.__photoSaverUnlocked = true;
  const stop = (event) => event.stopImmediatePropagation();
  for (const type of ["selectstart", "dragstart", "copy", "cut"]) window.addEventListener(type, stop, true);
  // 오른쪽 클릭: 숨기기(hide-watch.js)가 누른 곳을 기억하도록 먼저 알리고 멈춘다. 이것이 그쪽보다 먼저 돌면 그쪽에 contextmenu가 가지 않는다
  window.addEventListener(
    "contextmenu",
    (event) => {
      event.target?.dispatchEvent?.(new CustomEvent("photo-saver-contextmenu"));
      event.stopImmediatePropagation();
    },
    true,
  );
  // 오른쪽 버튼을 누를 때 경고 창을 띄우거나 막는 사이트
  const rightButton = (event) => {
    if (event.button === 2) event.stopImmediatePropagation();
  };
  for (const type of ["mousedown", "mouseup", "pointerdown", "pointerup", "auxclick"]) window.addEventListener(type, rightButton, true);
  // 복사·전체 고르기·잘라 내기 단축키를 막는 사이트
  const copyKeys = (event) => {
    if ((event.ctrlKey || event.metaKey) && ["c", "a", "x"].includes(String(event.key).toLowerCase())) event.stopImmediatePropagation();
  };
  window.addEventListener("keydown", copyKeys, true);
  // 속성으로 단 것도 비운다 (위에서 이미 닿지 않지만, 페이지가 이 값을 읽어 다른 일을 하는 경우가 있다). 페이지가 뜰 때는 아직 body가 없다
  for (const target of [window, document, document.documentElement, document.body]) {
    if (!target) continue;
    for (const name of ["oncontextmenu", "onselectstart", "ondragstart", "oncopy", "oncut"]) {
      try {
        target[name] = null;
      } catch {
        // 바꿀 수 없게 막아 둔 값
      }
    }
  }
  return { again: false };
})();
