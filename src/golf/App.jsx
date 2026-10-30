import { useState } from "react";
import { HUB_URL } from "../shared/site.js";
import HoleEntry from "./HoleEntry.jsx";
import PhotoImport from "./PhotoImport.jsx";
import Scorecard from "./Scorecard.jsx";
import Settlement from "./Settlement.jsx";
import Setup from "./Setup.jsx";
import useRound from "./useRound.js";

const TABS = [
  { key: "score", label: "스코어" },
  { key: "settle", label: "정산" },
  { key: "setup", label: "설정" },
];

export default function App() {
  const { round, update, setScore, setHole, setPlayerCount, importScan, newRound } = useRound();
  const [tab, setTab] = useState("score");

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>골프 스코어카드</h1>
        <p className="subtitle">홀마다 타수를 적고, 끝나면 내기를 정산합니다. 입력한 내용은 이 브라우저에 저장됩니다.</p>
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
      {tab === "setup" && (
        <Setup round={round} update={update} setPlayerCount={setPlayerCount} newRound={() => { newRound(); setTab("score"); }} />
      )}
    </main>
  );
}
