// 첫 화면에 보여줄 기능 목록. 새 기능 페이지를 만들면 여기와 vite.config.js에 추가한다
const FEATURES = [
  {
    path: "weather/",
    icon: "🌤️",
    title: "날씨",
    description: "현재 위치나 지도에서 고른 곳의 날씨와 7일 예보를 봅니다.",
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
          <li key={feature.path}>
            <a className="card feature-card" href={`${import.meta.env.BASE_URL}${feature.path}`}>
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
