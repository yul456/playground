# Playground

React + Vite 멀티 페이지 앱. 기능마다 `<기능>/index.html` + `src/<기능>/`를 두고 GitHub Pages(`/playground/`)로 배포한다. 자세한 내용은 README.md.

## 반드시 지킬 것

- 기능 폴더(`src/<기능>/`)는 자기 폴더와 `src/shared/`만 import한다. 다른 기능 폴더를 import하지 않는다. `src/shared/`는 기능 폴더를 import하지 않는다. `npm run check`(빌드 전 자동 실행)가 검사한다.
- 여러 기능이 쓰는 코드는 `src/shared/`로 옮긴다. 기능 간 이동은 링크로 하고, 첫 화면 링크는 `src/shared/site.js`의 `HUB_URL`을 쓴다.
- localStorage 키는 `playground.<기능>.`으로 시작한다 (모든 기능과 다른 repo가 yul456.github.io 저장소를 함께 씀).
- 새 기능은 `vite.config.js`의 `input`과 `src/home/App.jsx`의 `FEATURES`에 함께 추가한다.
- 패키지를 추가하면 README.md "구조" 표에 어느 기능이 쓰는지 적는다.
- `vite.config.js`의 `base`는 저장소 이름과 같아야 한다.
- 개발 서버 포트는 5500 고정 (다른 프로젝트가 5173 사용).
- Node 26 (`.nvmrc`).

## 골프 사진 인식 주의점

- 스마트스코어 스코어카드 전용이다 (앱 화면 캡처, 출력용 카드, 사진 배경 카드). 표 찾기와 숫자 읽기는 브라우저 API 없이 `src/golf/scanLayout.js`에 있어 Node에서 시험할 수 있다.
- 카드 모양마다 규칙을 따로 두지 않고, "1 2 3 … 9" 홀 번호 줄을 찾아 그 칸에 맞춰 아래 줄(PAR, 참가자)을 읽는다.
- 숫자는 범용 OCR(Tesseract) 대신 `digitTemplates.js` 숫자 모양 견본과 비교해 읽는다. Tesseract는 이 앱의 0과 한 자리 숫자를 자주 놓쳤다.
- −1·−2는 아이콘 색(노랑·분홍)으로 판별하고, 아이콘의 짙은 그림자는 글자에서 뺀다.
- 견본이나 판별 기준을 바꾸면 정답을 아는 카드들(원본, 0.5~3배 크기, 저화질 JPEG)로 정확도를 다시 확인한다.

## 날씨 기능 주의점

- 위치 요청은 `enableHighAccuracy: true`를 유지한다. macOS 크롬에서 false면 캐시된 위치가 없을 때 응답이 오지 않는다.
- API 키가 필요한 서비스는 쓰지 않는다. GitHub Pages는 소스가 공개되어 키가 노출된다.
