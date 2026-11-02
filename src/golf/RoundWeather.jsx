import { useEffect, useState } from "react";
import CoursePicker from "./CoursePicker.jsx";
import RoundForecast from "./RoundForecast.jsx";
import WeatherHistory from "./WeatherHistory.jsx";
import { MAX_DAYS_AHEAD, ROUND_HOURS, addDays, isPlannableDate, roundEnd, todayIso } from "./roundWeather.js";
import useRoundWeather from "./useRoundWeather.js";

// 골프장·날짜·티오프는 다음에 열 때도 쓰도록 이 브라우저에 저장한다
const SETTINGS_KEY = "playground.golf.weather.v1";

const defaults = () => ({ course: null, date: addDays(todayIso(), 1), tee: "07:00", holes: 18 });

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved) {
      const settings = { ...defaults(), ...saved };
      // 이미 지난 날짜면 내일로 돌린다
      return settings.date < todayIso() ? { ...settings, date: defaults().date } : settings;
    }
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 처음 값으로 시작한다
  }
  return defaults();
}

// 골프 페이지의 "날씨" 탭: 골프장과 티오프 시간을 고르면 라운드 동안의 예보와 지난 해 같은 날 날씨를 보여 준다
export default function RoundWeather() {
  const [settings, setSettings] = useState(load);
  const { course, date, tee, holes } = settings;
  const { forecast, history, retry } = useRoundWeather(course, date);
  const errors = [forecast.error, history.error].filter(Boolean);
  const update = (patch) => setSettings((s) => ({ ...s, ...patch }));

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  return (
    <>
      <div className={`loading-bar${forecast.loading || history.loading ? " active" : ""}`} aria-hidden="true" />
      <CoursePicker course={course} onChange={(next) => update({ course: next })} />

      <section className="card">
        <h2>라운드</h2>
        <div className="round-inputs">
          <label>
            날짜
            <input
              type="date"
              value={date}
              min={todayIso()}
              max={addDays(todayIso(), MAX_DAYS_AHEAD)}
              onChange={(e) => e.target.value && update({ date: e.target.value })}
            />
          </label>
          <label>
            티오프
            <input type="time" value={tee} step="600" onChange={(e) => e.target.value && update({ tee: e.target.value })} />
          </label>
          <div className="holes-toggle" role="group" aria-label="홀 수">
            {[18, 9].map((n) => (
              <button
                key={n}
                type="button"
                className={holes === n ? "active" : ""}
                aria-pressed={holes === n}
                onClick={() => update({ holes: n })}
              >
                {n}홀
              </button>
            ))}
          </div>
        </div>
        <p className="muted round-end">끝나는 시간 약 {roundEnd(tee, holes)} ({ROUND_HOURS[holes]}시간 기준)</p>
      </section>

      {course && !isPlannableDate(date) && (
        <p className="weather-error" role="alert">오늘부터 1년 안의 날짜를 골라 주세요.</p>
      )}
      {course && isPlannableDate(date) && (
        <>
          {errors.length > 0 && (
            <div className="weather-error" role="alert">
              {errors.map((message) => <p key={message}>{message}</p>)}
              <button type="button" className="secondary" onClick={retry}>다시 시도</button>
            </div>
          )}
          <RoundForecast forecast={forecast.data} loading={forecast.loading} date={date} tee={tee} holes={holes} />
          <WeatherHistory history={history.data} loading={history.loading} date={date} tee={tee} holes={holes} />
        </>
      )}

      <p className="weather-credit">
        날씨: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>
        {" · "}골프장 목록·지도: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap 기여자</a>
      </p>
    </>
  );
}
