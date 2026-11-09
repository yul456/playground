# Playground

이것저것 만들어 보는 도구 모음입니다. React + Vite로 기능마다 페이지를 따로 빌드해 GitHub Pages에 배포합니다.

- 사이트: https://yul456.github.io/playground/
- 날씨: https://yul456.github.io/playground/weather/
- 사다리 타기: https://yul456.github.io/playground/ladder/
- 돌림판: https://yul456.github.io/playground/wheel/
- 구슬 레이스: https://yul456.github.io/playground/ball/
- 지뢰찾기: https://yul456.github.io/playground/mines/
- 숫자 야구: https://yul456.github.io/playground/baseball/
- 골프 스코어카드: https://yul456.github.io/playground/golf/scorecard/
- 골프 라운드 날씨: https://yul456.github.io/playground/golf/weather/
- 골프 3D 코스: https://yul456.github.io/playground/golf/3d/

## 실행

Node 26을 씁니다 (`.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5500/playground/
npm run build      # 경계 검사 후 dist/ 생성
npm run preview    # 빌드 결과를 5500 포트에서 확인
```

다른 프로젝트가 5173 포트를 쓰고 있어 개발 서버는 5500으로 고정했습니다.

## 구조

```
index.html              첫 화면(기능 목록) 입구
weather/index.html      날씨 기능 입구
ladder/index.html       사다리 타기 입구
wheel/index.html        돌림판 입구
ball/index.html         구슬 레이스 입구
mines/index.html        지뢰찾기 입구
baseball/index.html     숫자 야구 입구
golf/index.html         예전 골프 주소. 날씨 공유 링크(?lat=…)는 golf/weather/로, 나머지는 golf/scorecard/로 넘긴다
golf/scorecard/        골프 스코어카드 입구 (index.html)
golf/weather/          골프 라운드 날씨 입구
golf/3d/               골프 3D 코스 입구
src/
  shared/               여러 기능이 함께 쓰는 것 (base.css, site.js, weatherCodes.js, WeatherIcon.jsx, geo.js, Confetti.jsx, random.js)
  home/                 첫 화면. FEATURES 배열에 기능 카드를 둔다
  weather/              날씨 기능
  ladder/               사다리 타기
  wheel/                돌림판
  ball/                 구슬 레이스 (코스 데이터는 ball/courses/에 하나씩)
  mines/                지뢰찾기
  baseball/             숫자 야구
  golf/                 골프 메뉴 세 페이지(스코어카드·라운드 날씨·3D 코스)가 함께 쓰는 폴더 (3D 코스 데이터는 golf/courses3d/)
scripts/
  check-boundaries.mjs  기능 폴더 경계 검사 (npm run build 전에 자동 실행)
  golf-courses.mjs      국내 골프장 목록(src/golf/golfCourses.js)을 OpenStreetMap에서 새로 받는다 (손으로 실행)
  golf-3d.mjs           골프 3D 코스의 홀·그린 데이터(src/golf/courses3d/)를 OpenStreetMap에서 새로 받는다 (golf-courses.mjs 다음에 손으로 실행)
  ball-sim.mjs          구슬 레이스를 화면 없이 여러 판 돌려 한 판 길이·끼임·자리 쏠림을 본다 (코스를 고친 뒤 손으로 실행)
vite.config.js          기준 경로(/playground/), 포트, 기능 페이지 목록
```

| 기능 | 폴더 | 이 기능이 쓰는 패키지 |
|---|---|---|
| 날씨 | `src/weather/`, `weather/` | `leaflet` |
| 사다리 타기 | `src/ladder/`, `ladder/` | 없음 |
| 돌림판 | `src/wheel/`, `wheel/` | 없음 |
| 구슬 레이스 | `src/ball/`, `ball/` | `planck` (물리 엔진, Box2D를 자바스크립트로 옮긴 것) |
| 지뢰찾기 | `src/mines/`, `mines/` | 없음 |
| 숫자 야구 | `src/baseball/`, `baseball/` | 없음 |
| 골프 (스코어카드·라운드 날씨·3D 코스) | `src/golf/`, `golf/` | `leaflet` (라운드 날씨 지도), `maplibre-gl` (3D 코스 지도). 사진 인식은 패키지 없이 숫자 모양 견본 `digitTemplates.js`와 비교하는 자체 코드 |

새 패키지를 추가하면 위 표에 어느 기능이 쓰는지 적어 둡니다. 기능을 분리할 때 옮길 패키지를 고르는 기준이 됩니다.

골프장 목록 `src/golf/golfCourses.js`와 3D 코스 데이터 `src/golf/courses3d/`는 OpenStreetMap 데이터(© OpenStreetMap 기여자, ODbL)입니다. 화면에 출처를 표시하고, `node scripts/golf-courses.mjs`와 `node scripts/golf-3d.mjs`로 새로 받습니다.

## 규칙: 기능 폴더 경계

- 기능 폴더(`src/<기능>/`)는 **자기 폴더와 `src/shared/`만** 가져다 씁니다. 다른 기능 폴더는 가져다 쓰지 않습니다.
- `src/shared/`는 기능 폴더를 가져다 쓰지 않습니다.
- 여러 기능이 쓰게 된 코드는 `src/shared/`로 옮깁니다.
- 브라우저 저장소(localStorage) 키는 `playground.<기능>.`으로 시작한다. 모든 기능이 같은 주소(yul456.github.io)를 써서 저장소를 함께 쓰기 때문이다.
- 기능 사이 이동은 import가 아니라 링크(`<a href>`)로 합니다. 첫 화면으로 돌아가는 링크는 `src/shared/site.js`의 `HUB_URL`을 씁니다.

`npm run build` 전에 `npm run check`가 자동으로 돌아 이 규칙을 어기면 빌드가 멈춥니다. 이 규칙을 지키면 기능 하나를 별도 repo로 옮길 때 폴더 복사만으로 끝납니다.

## 기능 추가

1. `새기능/index.html`을 만든다 (`weather/index.html`을 복사해 script 경로만 `/src/새기능/main.jsx`로 바꾼다).
2. `src/새기능/main.jsx`, `App.jsx`를 만든다. `main.jsx`에서 `../shared/base.css`를 불러온다.
3. `vite.config.js`의 `input`에 `새기능: resolve(import.meta.dirname, "새기능/index.html")`을 추가한다.
4. `src/home/App.jsx`의 `FEATURES`에 `{ path: "새기능/", ... }`을 추가한다.
5. 위 "구조" 표에 기능과 패키지를 적는다.

## 배포

main에 푸시하면 `.github/workflows/pages.yml`이 빌드해서 GitHub Pages에 올립니다.
저장소 Settings → Pages → Source는 **GitHub Actions**여야 합니다.
`vite.config.js`의 `base`는 저장소 이름(`/playground/`)과 같아야 합니다.

## 기능을 별도 repo로 분리하기

날씨 기능을 `weather` repo로 옮기는 경우를 예로 듭니다. 새 주소는 `https://yul456.github.io/weather/`가 됩니다.
같은 `yul456.github.io` 주소 아래라서 위치 권한과 브라우저 저장소는 그대로 이어집니다.

### 1. 커밋 기록을 유지한 채 폴더만 꺼내기

[git-filter-repo](https://github.com/newren/git-filter-repo)가 필요합니다 (`brew install git-filter-repo`). 반드시 새로 clone한 사본에서 합니다.

```bash
git clone https://github.com/yul456/playground.git weather
cd weather
git filter-repo --path src/weather/ --path src/shared/ --path weather/index.html --path .nvmrc --path-rename weather/index.html:index.html
```

### 2. 새 repo에서 정리

- `index.html`의 script 경로를 `/src/weather/main.jsx` 그대로 둔다 (경로가 루트 기준이라 바꿀 필요 없음).
- `package.json`: playground에서 복사하고, 위 "구조" 표를 보고 이 기능이 쓰는 패키지만 남긴다 (`react`, `react-dom`, `leaflet`, `vite`, `@vitejs/plugin-react`).
- `vite.config.js`: playground에서 복사하고 `base: "/weather/"`, `input`은 `index.html` 하나만 둔다.
- `scripts/check-boundaries.mjs`, `.github/workflows/pages.yml`: 그대로 복사한다.
- `src/shared/site.js`의 `HUB_URL`을 `"https://yul456.github.io/playground/"`로 바꾼다.
- GitHub에 `weather` repo를 만들어 push하고, Settings → Pages → Source를 **GitHub Actions**로 바꾼다.

### 3. playground에서 정리

- `src/weather/`, `weather/index.html`을 지우고 `vite.config.js`의 `input`에서 `weather`를 뺀다.
- `src/home/App.jsx`의 `FEATURES`에서 `path: "weather/"`를 `url: "https://yul456.github.io/weather/"`로 바꾼다.
- 예전 주소로 들어오는 사람을 새 주소로 보내는 페이지를 `public/weather/index.html`에 둔다. `public/` 아래 파일은 빌드 때 그대로 복사된다.

  ```html
  <!doctype html>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=https://yul456.github.io/weather/">
  <link rel="canonical" href="https://yul456.github.io/weather/">
  <a href="https://yul456.github.io/weather/">새 주소로 이동</a>
  ```

- 위 "구조" 표에서 날씨 행을 빼고, 다른 기능이 쓰지 않는 패키지만 지운다 (`leaflet`은 골프도 쓰므로 남긴다).
