import { HUB_URL } from "../shared/site.js";

// 골프 메뉴의 페이지들. 주소는 golf/ 아래에 있고, 서로 옮겨 다닐 수 있게 위쪽에 메뉴를 둔다
const PAGES = [
  { key: "scorecard", href: "../scorecard/", label: "⛳ 스코어카드" },
  { key: "weather", href: "../weather/", label: "🌦️ 라운드 날씨" },
  { key: "3d", href: "../3d/", label: "🏔️ 3D 코스" },
];

// 골프 페이지 공통 틀: 첫 화면으로 가는 링크, 제목, 골프 메뉴
export default function GolfLayout({ page, title, subtitle, children }) {
  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>{title}</h1>
        <p className="subtitle">{subtitle}</p>
      </header>
      <nav className="golf-menu" aria-label="골프 메뉴">
        {PAGES.map((p) => (
          <a key={p.key} href={p.href} className={p.key === page ? "active" : ""} aria-current={p.key === page ? "page" : undefined}>
            {p.label}
          </a>
        ))}
      </nav>
      {children}
    </main>
  );
}
