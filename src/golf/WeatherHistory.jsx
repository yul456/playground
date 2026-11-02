import WeatherIcon from "../shared/WeatherIcon.jsx";
import { describeWeather } from "../shared/weatherCodes.js";
import { RAINY_ROUND_MM, WINDY_GUST, WINDY_SPEED, fmt, monthDayLabel, roundEnd, summarizeHistory } from "./roundWeather.js";

// 지난 몇 해 같은 날, 같은 라운드 시간의 날씨. 예보가 없는 먼 날짜를 고를 때 특히 쓸모 있다
export default function WeatherHistory({ history, loading, date, tee, holes }) {
  const past = history && summarizeHistory(history, tee, holes);
  if (!past) return null;
  const { years, rainy, temp } = past;

  return (
    <section className={`card weather-card${loading ? " loading" : ""}`}>
      <h2>지난 {years.length}년 같은 날 <small>{monthDayLabel(date)} {tee}~{roundEnd(tee, holes)}</small></h2>
      <p className="history-summary">
        {years.length}년 중 라운드 시간에 비가 온 해({RAINY_ROUND_MM}mm 이상)는 <strong>{rainy}번</strong>이고,
        기온은 평균 {fmt(temp[0])}~{fmt(temp[1])}°였습니다.
      </p>
      <div className="table-scroll">
        <table className="hour-table">
          <thead>
            <tr>
              <th scope="col">해</th>
              <th scope="col">날씨</th>
              <th scope="col">기온</th>
              <th scope="col">비</th>
              <th scope="col">바람(m/s)</th>
            </tr>
          </thead>
          <tbody>
            {years.map(({ year, s }) => {
              const [desc] = describeWeather(s.code);
              const windy = (s.wind?.wind ?? 0) >= WINDY_SPEED || (s.gust?.gust ?? 0) >= WINDY_GUST;
              return (
                <tr key={year}>
                  <th scope="row">{year}</th>
                  <td title={desc}><WeatherIcon code={s.code} aria-hidden="true" /> <span className="weather-desc">{desc}</span></td>
                  <td>{fmt(s.temp[0])}~{fmt(s.temp[1])}°</td>
                  <td className={s.rain >= RAINY_ROUND_MM ? "wet" : undefined}>{fmt(s.rain, 1)}mm</td>
                  <td className={windy ? "windy" : undefined}>
                    최대 {fmt(s.wind?.wind, 1)}<small>돌풍 {fmt(s.gust?.gust, 1)}</small>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="weather-note">
        관측소 기록이 아니라 넓은 격자로 계산한 재분석 자료(ERA5 등)라 실제와 조금 다를 수 있습니다. 날씨는 그 시간대에
        가장 궂었던 때를 보여 줍니다.
      </p>
    </section>
  );
}
