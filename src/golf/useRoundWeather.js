import { useEffect, useState } from "react";
import { FORECAST_DAYS, daysFromToday, fetchForecast, fetchHistory, isPlannableDate } from "./roundWeather.js";

const IDLE = { data: null, loading: false, error: null };

// 고른 골프장·날짜의 시간별 예보와 지난 해 같은 날 날씨를 받아 온다.
// 둘은 따로 도착하는 대로 보여 주고, 예보가 나오지 않는 날(16일 뒤)은 지난 날씨만 받는다
export default function useRoundWeather(course, date) {
  const [forecast, setForecast] = useState(IDLE);
  const [history, setHistory] = useState(IDLE);
  // "다시 시도"를 누르면 올려서 같은 조건으로 다시 받는다
  const [attempt, setAttempt] = useState(0);
  const lat = course?.lat;
  const lon = course?.lon;

  useEffect(() => {
    if (lat == null) return undefined;
    if (!isPlannableDate(date)) {
      setForecast(IDLE);
      setHistory(IDLE);
      return undefined;
    }
    let cancelled = false;
    const place = { lat, lon };
    const load = (fetcher, setter) => fetcher().then(
      (data) => !cancelled && setter({ data, loading: false, error: null }),
      (err) => !cancelled && setter({ data: null, loading: false, error: err.message }),
    );
    // 새 값이 올 때까지 이전 값을 흐리게 보여 줘 화면이 비었다 찼다 하지 않게 한다
    setForecast((s) => ({ ...s, loading: true, error: null }));
    setHistory((s) => ({ ...s, loading: true, error: null }));
    // 날짜를 키보드로 고치는 동안 생기는 중간 값마다 부르지 않도록 잠깐 기다렸다 부른다
    const timer = setTimeout(() => {
      const hasForecast = daysFromToday(date) < FORECAST_DAYS;
      load(() => (hasForecast ? fetchForecast(place, date) : Promise.resolve(null)), setForecast);
      load(() => fetchHistory(place, date), setHistory);
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [lat, lon, date, attempt]);

  return { forecast, history, retry: () => setAttempt((n) => n + 1) };
}
