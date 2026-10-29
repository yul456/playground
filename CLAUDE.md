# Playground

React + Vite 멀티 페이지 앱. 기능마다 `<기능>/index.html` + `src/<기능>/`를 두고 GitHub Pages(`/playground/`)로 배포한다. 자세한 내용은 README.md.

## 반드시 지킬 것

- 기능 폴더(`src/<기능>/`)는 자기 폴더와 `src/shared/`만 import한다. 다른 기능 폴더를 import하지 않는다. `src/shared/`는 기능 폴더를 import하지 않는다. `npm run check`(빌드 전 자동 실행)가 검사한다.
- 여러 기능이 쓰는 코드는 `src/shared/`로 옮긴다. 기능 간 이동은 링크로 하고, 첫 화면 링크는 `src/shared/site.js`의 `HUB_URL`을 쓴다.
- 새 기능은 `vite.config.js`의 `input`과 `src/home/App.jsx`의 `FEATURES`에 함께 추가한다.
- 패키지를 추가하면 README.md "구조" 표에 어느 기능이 쓰는지 적는다.
- `vite.config.js`의 `base`는 저장소 이름과 같아야 한다.
- 개발 서버 포트는 5500 고정 (다른 프로젝트가 5173 사용).
- Node 26 (`.nvmrc`).

## 날씨 기능 주의점

- 위치 요청은 `enableHighAccuracy: true`를 유지한다. macOS 크롬에서 false면 캐시된 위치가 없을 때 응답이 오지 않는다.
- API 키가 필요한 서비스는 쓰지 않는다. GitHub Pages는 소스가 공개되어 키가 노출된다.
