import { useEffect, useState } from "react";
import Confetti from "../shared/Confetti.jsx";
import { HUB_URL } from "../shared/site.js";
import { playTick, unlockSound } from "./tickSound.js";
import Wheel from "./Wheel.jsx";
import { MAX_ITEMS, MIN_ITEMS, randomIndex, spinTarget } from "./wheel.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.wheel.v1";
const PRESETS = [
  { name: "점심 메뉴", items: ["김치찌개", "짜장면", "돈까스", "국밥", "초밥", "햄버거", "칼국수", "비빔밥"] },
  { name: "참가자 4명", items: ["참가자1", "참가자2", "참가자3", "참가자4"] },
  { name: "숫자 1~6", items: ["1", "2", "3", "4", "5", "6"] },
];
// 한 번 돌리는 시간과 최소 바퀴 수. 처음 0.7초쯤 빨라졌다가(최고 초당 2.4바퀴 정도) 나머지 동안 천천히 멈춘다
const SPIN_MS = 5000;
const SPIN_TURNS = 4;
const CONFETTI_MS = 3500;
const MAX_HISTORY = 100;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    // sound는 나중에 더한 설정이라 그 전에 저장한 값에는 없다. 없으면 켠다
    if (typeof saved?.text === "string") return { text: saved.text, removePicked: Boolean(saved.removePicked), sound: saved.sound !== false };
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return { text: PRESETS[0].items.join("\n"), removePicked: false, sound: true };
}

// 한 줄에 하나씩. 빈 줄과 앞뒤 공백은 뺀다
const linesOf = (text) => text.split("\n").map((line) => line.trim()).filter(Boolean);

export default function App() {
  const [settings, setSettings] = useState(load);
  const { text, removePicked, sound } = settings;
  const lines = linesOf(text);
  const items = lines.slice(0, MAX_ITEMS);
  // 이번에 돌림판에서 뺀 항목(items 번호). 목록을 고치면 비운다
  const [excluded, setExcluded] = useState([]);
  const [rotation, setRotation] = useState(0);
  // 돌아가는 동안: { pool: 이번 판의 칸들, winner: 뽑힌 칸 번호, from·to: 시작·끝 각도, duration }
  const [spin, setSpin] = useState(null);
  // 마지막 결과: { label, index: items 번호, id }
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [confettiId, setConfettiId] = useState(null);

  const available = items.map((label, index) => ({ label, index })).filter((item) => !excluded.includes(item.index));
  // "뽑힌 항목 빼기"면 방금 뽑힌 항목은 결과를 보는 동안만 남겨 두고 다음 판을 돌릴 때 뺀다
  const next = removePicked && result ? available.filter((item) => item.index !== result.index) : available;
  const shown = spin ? spin.pool : available;
  const highlight = !spin && result ? shown.findIndex((item) => item.index === result.index) : null;
  const leftOut = items.length - next.length;
  const canSpin = !spin && next.length >= MIN_ITEMS;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  useEffect(() => {
    if (!confettiId) return undefined;
    const timer = setTimeout(() => setConfettiId(null), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [confettiId]);

  function startSpin() {
    if (!canSpin) return;
    if (sound) unlockSound();
    // 결과는 돌리기 전에 먼저 뽑고, 원판은 그 칸에 멈추도록 돌린다
    const winner = randomIndex(next.length);
    // 움직임 줄이기를 켠 사람에게는 짧게 돈다
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const to = spinTarget(rotation, next.length, winner, { turns: calm ? 1 : SPIN_TURNS });
    if (next !== available) setExcluded((list) => [...list, result.index]);
    setResult(null);
    setConfettiId(null);
    setSpin({ pool: next, winner, from: rotation, to, duration: calm ? 1500 : SPIN_MS });
  }

  function finishSpin() {
    if (!spin) return;
    const picked = spin.pool[spin.winner];
    const id = Date.now();
    setRotation(spin.to);
    setSpin(null);
    setResult({ ...picked, id });
    setHistory((list) => [...list, picked.label].slice(-MAX_HISTORY));
    setConfettiId(id);
  }

  function changeText(value) {
    setSettings((s) => ({ ...s, text: value }));
    // 목록이 바뀌면 칸 번호가 달라지므로 빼 둔 항목과 마지막 결과 표시를 비운다
    setExcluded([]);
    setResult(null);
  }

  function putBackAll() {
    setExcluded([]);
    setResult(null);
  }

  function changeSound(on) {
    // 돌아가는 도중에 켜도 바로 소리가 나도록 누른 그때 소리를 깨운다
    if (on) unlockSound();
    setSettings((s) => ({ ...s, sound: on }));
  }

  let hint = "가운데 버튼을 눌러 돌려 보세요.";
  if (items.length < MIN_ITEMS) hint = `항목을 ${MIN_ITEMS}개 이상 넣어 주세요.`;
  else if (next.length < MIN_ITEMS) hint = "남은 항목이 하나뿐입니다. 모두 다시 넣고 돌려 주세요.";

  return (
    <main className="container">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>돌림판</h1>
        <p className="subtitle">항목을 넣고 가운데 버튼을 누르면 돌림판이 돌아가 하나를 뽑습니다.</p>
      </header>

      <section className="card wheel-card">
        <Wheel
          labels={shown.map((item) => item.label)}
          rotation={rotation}
          spin={spin}
          highlight={highlight}
          canSpin={canSpin}
          onSpin={startSpin}
          onSpinEnd={finishSpin}
          onTick={sound ? playTick : undefined}
        />
        <p className="wheel-result" role="status">
          {spin ? "돌아가는 중…" : result ? <>🎉 <strong key={result.id}>{result.label}</strong></> : hint}
        </p>
        {result && !spin && next.length < MIN_ITEMS && items.length >= MIN_ITEMS && <p className="wheel-note">{hint}</p>}
        <div className="wheel-options">
          <label>
            <input
              type="checkbox"
              checked={removePicked}
              disabled={Boolean(spin)}
              onChange={(e) => setSettings((s) => ({ ...s, removePicked: e.target.checked }))}
            />
            뽑힌 항목은 다음 판에서 빼기
          </label>
          <label>
            <input type="checkbox" checked={sound} onChange={(e) => changeSound(e.target.checked)} />
            딸깍 소리
          </label>
          {leftOut > 0 && (
            <span>
              빠진 항목 {leftOut}개
              <button type="button" className="secondary" onClick={putBackAll} disabled={Boolean(spin)}>모두 다시 넣기</button>
            </span>
          )}
        </div>
      </section>

      <section className="card">
        <h2>항목 <small>{items.length}개</small></h2>
        <div className="presets">
          {PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className="secondary"
              disabled={Boolean(spin)}
              onClick={() => changeText(preset.items.join("\n"))}
            >
              {preset.name}
            </button>
          ))}
        </div>
        <textarea
          className="items-input"
          value={text}
          rows={8}
          disabled={Boolean(spin)}
          aria-label="돌림판 항목, 한 줄에 하나씩"
          onChange={(e) => changeText(e.target.value)}
        />
        <p className="items-hint">
          한 줄에 하나씩 적습니다. 같은 항목을 여러 줄 넣으면 그만큼 잘 나옵니다. {MIN_ITEMS}~{MAX_ITEMS}개까지 쓸 수 있습니다.
          {lines.length > MAX_ITEMS && ` 지금 ${lines.length}개라 앞의 ${MAX_ITEMS}개만 돌림판에 올립니다.`}
        </p>
      </section>

      {history.length > 0 && (
        <section className="card">
          <div className="history-head">
            <h2>뽑힌 차례</h2>
            <button type="button" className="secondary" onClick={() => setHistory([])} disabled={Boolean(spin)}>지우기</button>
          </div>
          <ol className="history">
            {history.map((label, i) => (
              <li key={i}><span className="order">{i + 1}</span>{label}</li>
            ))}
          </ol>
        </section>
      )}

      {confettiId && <Confetti key={confettiId} />}
    </main>
  );
}
