import { useEffect, useState } from "react";
import { fetchForecast, fetchHistory, isPlannableDate } from "./roundWeather.js";

const IDLE = { data: null, loading: false, error: null };

// fetcher를 delay 뒤에 불러 결과를 setter에 넣는다. 새 값이 올 때까지 이전 값을 흐리게 보여 줘
// 화면이 비었다 찼다 하지 않게 한다. effect 정리 함수를 돌려준다
function load(fetcher, setter, delay = 0) {
  let cancelled = false;
  setter((s) => ({ ...s, loading: true, error: null }));
  const timer = setTimeout(() => {
    fetcher().then(
      (data) => !cancelled && setter({ data, loading: false, error: null }),
      (err) => !cancelled && setter({ data: null, loading: false, error: err.message }),
    );
  }, delay);
  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}

// 고른 골프장의 16일 예보(골프장이 바뀔 때만)와 고른 날짜의 지난 해 같은 날 날씨(날짜가 바뀔 때마다)를 받아 온다
export default function useRoundWeather(course, date) {
  const [forecast, setForecast] = useState(IDLE);
  const [history, setHistory] = useState(IDLE);
  // "다시 시도"를 누르면 올려서 같은 조건으로 다시 받는다
  const [attempt, setAttempt] = useState(0);
  const lat = course?.lat;
  const lon = course?.lon;

  useEffect(() => {
    if (lat == null) return undefined;
    return load(() => fetchForecast({ lat, lon }), setForecast);
  }, [lat, lon, attempt]);

  useEffect(() => {
    if (lat == null) return undefined;
    if (!isPlannableDate(date)) {
      setHistory(IDLE);
      return undefined;
    }
    // 날짜를 키보드로 고치는 동안 생기는 중간 값마다 부르지 않도록 잠깐 기다렸다 부른다
    return load(() => fetchHistory({ lat, lon }, date), setHistory, 300);
  }, [lat, lon, date, attempt]);

  return { forecast, history, retry: () => setAttempt((n) => n + 1) };
}
