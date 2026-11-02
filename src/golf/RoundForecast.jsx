import WeatherIcon from "../shared/WeatherIcon.jsx";
import { describeWeather } from "../shared/weatherCodes.js";
import {
  FORECAST_DAYS, GRADE_LABELS, WET_CHANCE, WET_MM, WINDY_GUST, WINDY_SPEED,
  addDays, clockOf, dateLabel, daylightWarning, daysFromToday, fmt, rateRound, roundEnd, roundHours, summarize, todayIso,
  windName,
} from "./roundWeather.js";

// 바람이 불어 가는 쪽을 가리킨다. 풍향은 불어오는 쪽이라 ↓를 그만큼 돌린다
function WindArrow({ deg }) {
  if (deg == null) return null;
  return (
    <span className="wind-arrow" role="img" aria-label={windName(deg)} title={windName(deg)} style={{ transform: `rotate(${deg}deg)` }}>
      ↓
    </span>
  );
}

function HourRow({ row }) {
  const [desc] = describeWeather(row.code);
  const wet = (row.chance ?? 0) >= WET_CHANCE || (row.rain ?? 0) >= WET_MM;
  const windy = (row.wind ?? 0) >= WINDY_SPEED || (row.gust ?? 0) >= WINDY_GUST;
  return (
    <tr>
      <th scope="row">{row.hour}시</th>
      <td title={desc}><WeatherIcon code={row.code} aria-hidden="true" /> <span className="weather-desc">{desc}</span></td>
      <td>{fmt(row.temp)}°<small>체감 {fmt(row.feels)}°</small></td>
      <td className={wet ? "wet" : undefined}>
        {row.chance != null ? `${row.chance}%` : "–"}<small>{fmt(row.rain, 1)}mm</small>
      </td>
      <td className={windy ? "windy" : undefined}>
        <WindArrow deg={row.dir} /> {fmt(row.wind, 1)}<small>돌풍 {fmt(row.gust, 1)}</small>
      </td>
    </tr>
  );
}

// 고른 날 티오프부터 라운드가 끝날 때까지의 시간별 예보와 요약 (forecast: 16일 예보)
export default function RoundForecast({ forecast, loading, date, tee, holes }) {
  const end = roundEnd(tee, holes);

  if (daysFromToday(date) >= FORECAST_DAYS) {
    return (
      <section className="card">
        <h2>라운드 예보</h2>
        <p className="muted">
          예보는 {dateLabel(addDays(todayIso(), FORECAST_DAYS - 1))}까지만 나옵니다. 아래 지난 해 같은 날 날씨를 참고하세요.
        </p>
      </section>
    );
  }
  const day = forecast?.days.find((d) => d.date === date);
  if (!day) return null;

  const rows = roundHours(forecast.hours, date, tee, holes);
  const s = summarize(rows);
  if (!s) return null;
  const { grade, reason } = rateRound(s);
  const sunrise = clockOf(day.sunrise);
  const sunset = clockOf(day.sunset);
  const warning = daylightWarning(day, tee, holes);
  // 먼 날은 비 올 확률이 없고, 내내 0%면 몇 시라고 할 게 없다
  const rainy = s.chance?.chance > 0;
  const chance = !s.chance ? "확률 정보 없음" : rainy ? `최대 ${s.chance.chance}%` : "확률 0%";

  return (
    <section className={`card weather-card${loading ? " loading" : ""}`}>
      <h2>
        라운드 예보 <small>{dateLabel(date)} {tee}~{end}</small>{" "}
        <span className={`grade ${grade}`}>{GRADE_LABELS[grade]}{reason && ` · ${reason}`}</span>
      </h2>
      <dl className="weather-summary">
        <div>
          <dt>기온</dt>
          <dd>
            {fmt(s.temp[0])}~{fmt(s.temp[1])}°
            <small>체감 {s.feels ? `${fmt(s.feels[0])}~${fmt(s.feels[1])}°` : "–"}</small>
          </dd>
        </div>
        <div>
          <dt>비</dt>
          <dd>
            {chance}
            <small>{rainy && `${s.chance.hour}시 · `}합계 {fmt(s.rain, 1)}mm</small>
          </dd>
        </div>
        <div>
          <dt>바람</dt>
          <dd>
            {s.wind ? `최대 ${fmt(s.wind.wind, 1)}m/s` : "–"}
            <small>
              {s.wind && `${s.wind.hour}시 · `}돌풍 {fmt(s.gust?.gust, 1)}m/s{s.dir != null && ` · ${windName(s.dir)}`}
            </small>
          </dd>
        </div>
        <div>
          <dt>해</dt>
          <dd>일출 {sunrise}<small>일몰 {sunset}</small></dd>
        </div>
      </dl>
      {warning && <p className="weather-warning">{warning}</p>}

      <div className="table-scroll">
        <table className="hour-table">
          <thead>
            <tr>
              <th scope="col">시각</th>
              <th scope="col">날씨</th>
              <th scope="col">기온</th>
              <th scope="col">비</th>
              <th scope="col">바람(m/s)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => <HourRow key={`${row.date} ${row.hour}`} row={row} />)}
          </tbody>
        </table>
      </div>
      <p className="weather-note">
        파란 글씨는 비 올 확률 {WET_CHANCE}% 이상이거나 비가 {WET_MM}mm 넘게 오는 시각, 주황 글씨는 바람 {WINDY_SPEED}m/s나
        돌풍 {WINDY_GUST}m/s 이상인 시각입니다.
      </p>
    </section>
  );
}
