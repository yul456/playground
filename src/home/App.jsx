// 첫 화면에 보여줄 기능 목록. 새 기능 페이지를 만들면 여기와 vite.config.js에 추가한다
// path: 이 repo 안의 기능 폴더, url: 별도 repo로 분리한 기능의 전체 주소
const FEATURES = [
  {
    path: "weather/",
    icon: "🌤️",
    title: "날씨",
    description: "현재 위치나 지도에서 고른 곳의 날씨와 7일 예보를 봅니다.",
  },
  {
    path: "ladder/",
    icon: "🪜",
    title: "사다리 타기",
    description: "이름과 결과를 넣고 사다리를 타서 누가 뭐가 나오는지 정합니다.",
  },
  {
    path: "wheel/",
    icon: "🎡",
    title: "돌림판",
    description: "항목을 넣고 돌림판을 돌려 하나를 뽑습니다. 점심 메뉴 고르기, 순서 정하기에 씁니다.",
  },
  {
    path: "ball/",
    icon: "🏁",
    title: "구슬 레이스",
    description: "이름 붙은 구슬들을 한꺼번에 굴려 마지막까지 남은 구슬(또는 1등)을 뽑습니다.",
  },
  {
    path: "mines/",
    icon: "💣",
    title: "지뢰찾기",
    description: "숫자를 단서로 지뢰를 피해 칸을 모두 엽니다. 초급·중급·고급 난이도와 최고 기록이 있습니다.",
  },
  {
    path: "baseball/",
    icon: "⚾",
    title: "숫자 야구",
    description: "컴퓨터가 정한 서로 다른 숫자 3~4개를 스트라이크·볼 힌트로 9회 안에 맞힙니다.",
  },
  {
    path: "golf/",
    icon: "⛳",
    title: "골프 스코어카드",
    description: "홀마다 타수를 적어 타당·스킨스·니어리스트 내기를 정산하고, 골프장의 라운드 날씨를 미리 봅니다.",
  },
];

export default function App() {
  return (
    <main className="container">
      <header>
        <h1>Playground</h1>
        <p className="subtitle">이것저것 만들어 보는 도구 모음입니다.</p>
      </header>

      <ul className="feature-list">
        {FEATURES.map((feature) => (
          <li key={feature.url ?? feature.path}>
            <a className="card feature-card" href={feature.url ?? `${import.meta.env.BASE_URL}${feature.path}`}>
              <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
              <span>
                <span className="feature-title">{feature.title}</span>
                <span className="feature-desc">{feature.description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
