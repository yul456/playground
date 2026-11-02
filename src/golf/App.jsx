import { Suspense, lazy, useState } from "react";
import { HUB_URL } from "../shared/site.js";
import HoleEntry from "./HoleEntry.jsx";
import PhotoImport from "./PhotoImport.jsx";
import Scorecard from "./Scorecard.jsx";
import Settlement from "./Settlement.jsx";
import Setup from "./Setup.jsx";
import useRound from "./useRound.js";

// 날씨 탭은 지도(Leaflet)와 골프장 목록이 커서 탭을 처음 열 때 불러온다
const RoundWeather = lazy(() => import("./RoundWeather.jsx"));

const TABS = [
  { key: "score", label: "스코어" },
  { key: "settle", label: "정산" },
  { key: "weather", label: "날씨" },
  { key: "setup", label: "설정" },
];

export default function App() {
  const { round, update, setScore, setHole, setPlayerCount, importScan, newRound } = useRound();
  // 라운드 날씨 공유 링크(?lat=…)로 들어오면 날씨 탭부터 연다
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).has("lat") ? "weather" : "score"));

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>골프 스코어카드</h1>
        <p className="subtitle">홀마다 타수를 적고, 끝나면 내기를 정산합니다. 라운드 날씨도 미리 볼 수 있습니다. 입력한 내용은 이 브라우저에 저장됩니다.</p>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={tab === t.key ? "active" : ""}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "score" && (
        <>
          <PhotoImport players={round.players} onApply={importScan} />
          <HoleEntry round={round} setScore={setScore} setHole={setHole} />
          <Scorecard round={round} setScore={setScore} onPickHole={(h) => { setHole(h); window.scrollTo({ top: 0, behavior: "smooth" }); }} />
        </>
      )}
      {tab === "settle" && <Settlement round={round} update={update} />}
      {tab === "weather" && (
        <Suspense fallback={<p className="muted">날씨 화면을 불러오는 중…</p>}>
          <RoundWeather />
        </Suspense>
      )}
      {tab === "setup" && (
        <Setup round={round} update={update} setPlayerCount={setPlayerCount} newRound={() => { newRound(); setTab("score"); }} />
      )}
    </main>
  );
}
