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
- 견본이나 판별 기준을 바꾸면 정답을 아는 카드들(원본, 0.5~3배 크기, 저화질 JPEG)로 정확도를 다시 확인한다. 카드와 정답은 `local-tests/golf-scan/`에 있고 거기서 `npm test`로 돌린다. 개인 스코어카드라 git에서 빼 두어 이 컴퓨터에만 있다.

## 골프 라운드 날씨 주의점

- 골프장 이름 검색은 받아 둔 목록(`src/golf/golfCourses.js`)에서 페이지 안에서 한다. OpenStreetMap 검색(Nominatim)은 이름이 정확히 같아야 찾고, 입력하는 대로 검색(자동완성)하는 것이 이용 정책상 금지다. 목록은 `node scripts/golf-courses.mjs`로 새로 받는다 (Overpass, 2~3분).
- Open-Meteo 예보는 오늘부터 16일째까지만 받을 수 있다 (그 뒤 날짜는 400 오류). 그 뒤 날짜는 지난 해 같은 날 기록만 보여 준다.
- 예보는 골프장마다 16일 치를 한 번에 받아(`fetchForecast`) "라운드하기 좋은 날" 달력과 그날 예보가 함께 쓴다. 날짜를 바꿔도 예보는 다시 받지 않는다. 좋음·보통·나쁨 기준은 `roundWeather.js`의 `RATING`.
- 공유 링크는 `golf/?lat=…&lon=…&d=YYYYMMDD&t=HHMM&h=18|9`다. 골프장 이름은 좌표로 목록에서 다시 찾는다. 링크로 들어오면 날씨 탭을 열고, 설정을 읽은 뒤 주소에서 지운다.
- 지난 날씨(archive API)는 한 해에 한 번씩 불러야 하고, 동시에 많이 부르면 429(Too many concurrent requests)가 난다. 그래서 두 해씩 부르고, 429면 잠시 뒤 다시 부른다.
- 골프장 목록과 지도는 OpenStreetMap 데이터(ODbL)라 화면에 출처를 표시한다.

## 돌림판 주의점

- 결과는 돌리기 전에 `randomIndex`(crypto, 나머지 편향 없음)로 먼저 뽑고, 바늘이 그 칸 안쪽(경계 15% 밖)에 멈추도록 `spinTarget`으로 회전 각도를 정한다. 회전 애니메이션이 결과를 정하지 않는다.
- 회전은 CSS transition이 아니라 requestAnimationFrame으로 매 프레임 원판 각도를 바꾼다. 실제 돌림판처럼 처음에 빨라졌다가 천천히 멈추는 움직임(`spinProgress`)은 CSS 곡선 하나로 만들 수 없다. 돌리는 동안 React는 다시 그리지 않고, 끝나면 멈춘 각도를 상태에 넣는다.
- 딸깍 소리는 파일 없이 Web Audio로 만든다(`tickSound.js`). 브라우저는 사용자가 누르기 전에는 소리를 막으므로 AudioContext는 돌리기 버튼이나 소리 켜기를 누른 그때 만들고 깨운다(`unlockSound`). 잠든(suspended) 동안 예약한 소리는 깨어날 때 한꺼번에 나므로 running일 때만 소리를 낸다.

## 날씨 기능 주의점

- 위치 요청은 `enableHighAccuracy: true`를 유지한다. macOS 크롬에서 false면 캐시된 위치가 없을 때 응답이 오지 않는다.
- API 키가 필요한 서비스는 쓰지 않는다. GitHub Pages는 소스가 공개되어 키가 노출된다.
- 날씨 아이콘은 이모지를 바로 넣지 말고 `src/shared/WeatherIcon.jsx`로 그린다. 안개 이모지(🌫️)가 애플 기기에서 흐릿한 회색 네모로 보여서, 구름 이모지 아래에 안개 줄을 그린다.
