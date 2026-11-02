import WeatherIcon from "../shared/WeatherIcon.jsx";
import { describeWeather } from "../shared/weatherCodes.js";
import { GRADE_LABELS, RATING, dateLabel, fmt, parseDate, rateRound, roundHours, summarize, todayIso } from "./roundWeather.js";

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekendClass = (weekday) => (weekday === 0 ? "sun" : weekday === 6 ? "sat" : "");

// 앞으로 16일을 달력처럼 놓고, 같은 티오프 시간대의 날씨로 날마다 좋음·보통·나쁨을 칠한다. 누르면 그날로 바꾼다
export default function GoodDays({ forecast, loading, date, tee, holes, onPick }) {
  if (!forecast) return null;
  const rated = forecast.days
    .map((d) => {
      const s = summarize(roundHours(forecast.hours, d.date, tee, holes));
      return s && { date: d.date, s, ...rateRound(s) };
    })
    .filter(Boolean);
  if (!rated.length) return null;
  const today = todayIso();
  // 첫 주는 첫날의 요일 칸부터 채운다
  const blanks = parseDate(rated[0].date).getDay();

  return (
    <section className={`card weather-card${loading ? " loading" : ""}`}>
      <h2>라운드하기 좋은 날 <small>티오프 {tee} · {holes}홀 기준</small></h2>
      <div className="good-days">
        {WEEKDAYS.map((name, i) => <span key={name} className={`weekday ${weekendClass(i)}`}>{name}</span>)}
        {Array.from({ length: blanks }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
        {rated.map((d, i) => {
          const at = parseDate(d.date);
          const [desc] = describeWeather(d.s.code);
          // 첫 칸과 매달 1일에는 월도 적는다
          const label = i === 0 || at.getDate() === 1 ? `${at.getMonth() + 1}/${at.getDate()}` : at.getDate();
          const summary = `${dateLabel(d.date)} ${GRADE_LABELS[d.grade]}${d.reason ? `, ${d.reason}` : ""}, ${desc} ${fmt(d.s.temp[0])}~${fmt(d.s.temp[1])}°`;
          return (
            <button
              key={d.date}
              type="button"
              className={`good-day ${d.grade}${d.date === date ? " selected" : ""}${d.date === today ? " today" : ""}`}
              aria-pressed={d.date === date}
              aria-label={summary}
              title={summary}
              onClick={() => onPick(d.date)}
            >
              <span className={`day-num ${weekendClass(at.getDay())}`}>{label}</span>
              <WeatherIcon code={d.s.code} className="day-icon" aria-hidden="true" />
              <span className="day-temp">{fmt(d.s.temp[0])}~{fmt(d.s.temp[1])}°</span>
            </button>
          );
        })}
      </div>
      <p className="good-days-legend">
        <span className="grade good">좋음</span> <span className="grade fair">보통</span> <span className="grade bad">나쁨</span>
        {" "}날짜를 누르면 그날 예보를 봅니다. 1주일 넘게 남은 날은 예보가 자주 바뀝니다.
      </p>
      <details className="weather-note">
        <summary>색을 정하는 기준</summary>
        티오프부터 끝날 때까지의 날씨로 정합니다. 비 올 확률 {RATING.chance.fair}%, 비 {RATING.rain.fair}mm, 바람{" "}
        {RATING.wind.fair}m/s, 돌풍 {RATING.gust.fair}m/s 이상이거나 체감 {RATING.cold.fair}° 이하, 기온 {RATING.hot.fair}° 이상 중
        하나라도 있으면 보통입니다. 비 올 확률 {RATING.chance.bad}%, 비 {RATING.rain.bad}mm, 바람 {RATING.wind.bad}m/s, 돌풍{" "}
        {RATING.gust.bad}m/s 이상이거나 체감 {RATING.cold.bad}° 이하, 기온 {RATING.hot.bad}° 이상 중 하나라도 있으면 나쁨입니다.
      </details>
    </section>
  );
}
