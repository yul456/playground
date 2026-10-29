import { useEffect, useRef, useState } from "react";
import { DEFAULT_PARS, HOLES } from "./golf.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.golf.round.v1";

const emptyScores = () => Array(HOLES).fill(null);
const defaultName = (i) => `플레이어${i + 1}`;

// 지금 보고 있는 홀에서 아직 안 적은 칸을 파로 채운다.
// 대부분 파로 끝나니 버디·보기일 때만 +/−를 누르면 되게 한다
function withParFilled(round) {
  const { hole, pars, scores } = round;
  if (scores.every((s) => s[hole] != null)) return round;
  return { ...round, scores: scores.map((s) => s.map((v, h) => (h === hole && v == null ? pars[h] : v))) };
}

export function createRound(prev) {
  const players = prev?.players ?? [0, 1, 2, 3].map(defaultName);
  return withParFilled({
    players,
    pars: prev?.pars ?? DEFAULT_PARS,
    scores: players.map(emptyScores),
    bets: prev?.bets ?? { strokeRate: 1000, skinAmount: 0 },
    awards: [],
    hole: 0,
  });
}

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved?.players?.length && saved.scores?.length === saved.players.length) return withParFilled(saved);
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 새 라운드로 시작한다
  }
  return createRound();
}

// 라운드 중 화면을 닫거나 새로고침해도 이어서 쓸 수 있게 브라우저에 저장한다
export default function useRound() {
  const [round, setRound] = useState(load);
  // 마지막으로 저장하거나 받아 온 값. 같은 값을 다시 저장해 탭끼리 주고받기를 반복하지 않게 한다
  const lastSaved = useRef(null);

  useEffect(() => {
    const json = JSON.stringify(round);
    if (json === lastSaved.current) return;
    lastSaved.current = json;
    try {
      localStorage.setItem(STORAGE_KEY, json);
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [round]);

  // 같은 페이지를 다른 탭에서도 열어 두면 서로 덮어쓰지 않도록, 다른 탭에서 저장한 내용을 받아 온다
  useEffect(() => {
    function onStorage(e) {
      if (e.key !== STORAGE_KEY || !e.newValue || e.newValue === lastSaved.current) return;
      try {
        const next = JSON.parse(e.newValue);
        lastSaved.current = e.newValue;
        setRound(next);
      } catch {
        // 깨진 값은 무시한다
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = (patch) => setRound((r) => ({ ...r, ...(typeof patch === "function" ? patch(r) : patch) }));

  return {
    round,
    update,
    setScore: (player, hole, score) => update((r) => ({
      scores: r.scores.map((s, i) => (i === player ? s.map((v, h) => (h === hole ? score : v)) : s)),
    })),
    setHole: (hole) => setRound((r) => withParFilled({ ...r, hole: Math.min(HOLES - 1, Math.max(0, hole)) })),
    setPlayerCount: (count) => setRound((r) => withParFilled({
      ...r,
      players: Array.from({ length: count }, (_, i) => r.players[i] ?? defaultName(i)),
      scores: Array.from({ length: count }, (_, i) => r.scores[i] ?? emptyScores()),
      // 없어진 참가자가 받은 특별상은 지운다
      awards: r.awards.filter((a) => a.winner < count),
    })),
    newRound: () => setRound((r) => createRound(r)),
  };
}
