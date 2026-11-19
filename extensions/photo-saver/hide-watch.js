// 오른쪽 클릭한 요소를 기억해 둔다 (보기 싫은 부분 숨기기, 1.20.0). 모든 웹 페이지의 프레임마다 페이지가 뜰 때 들어간다 (manifest의 content_scripts).
// 크롬의 오른쪽 클릭 메뉴는 누른 자리에 무엇이 있었는지 확장 프로그램에 알려 주지 않아서, "이 부분 숨기기"를 누르면 hide-core.js가 여기 기억해 둔 것을 숨긴다.
// 보기만 한다: 이벤트를 막거나 바꾸지 않아 크롬의 메뉴와 사이트의 자체 오른쪽 클릭 메뉴는 그대로 돈다. 아무것도 밖으로 보내지 않는다.
// 같은 확장 프로그램의 콘텐츠 스크립트는 프레임마다 같은 공간(격리된 공간)을 써서, 여기 적은 self.__photoSaverContext를 hide-core.js가 읽는다
(() => {
  if (self.__photoSaverWatch) return;
  self.__photoSaverWatch = true;
  const note = (event) => {
    if (event.target instanceof Element) self.__photoSaverContext = { el: event.target, at: Date.now() };
  };
  // 사람이 누른 것만 (페이지가 스크립트로 만든 contextmenu가 누른 곳을 바꾸지 않게)
  addEventListener("contextmenu", (event) => event.isTrusted && note(event), true);
  // 오른쪽 클릭 막기 풀기(unlock-page.js)가 이것보다 먼저 창의 capture 단계에서 contextmenu를 멈추면 여기 오지 않는다. 그때는 그쪽이 이 이름으로 알려 준다
  addEventListener("photo-saver-contextmenu", note, true);
})();
