// 늘 푸는 사이트의 프레임마다 페이지가 뜰 때 돈다 (unlock-sites.js가 등록하는 콘텐츠 스크립트, 격리된 공간).
// 글자를 못 고르게 한 꾸밈을 덮는 사용자 스타일을 넣어 달라고 서비스 워커에 부탁한다. 콘텐츠 스크립트에 딸린 꾸밈은 사이트와 같은 단계(author)라
// 사이트의 !important를 이기지 못할 수 있어서, 서비스 워커가 insertCSS의 사용자 스타일(origin USER)로 넣는다
chrome.runtime.sendMessage({ type: "unlock-css" }).catch(() => {});
