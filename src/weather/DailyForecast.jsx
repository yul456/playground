import { describe, formatDay } from "./api.js";

export default function DailyForecast({ daily }) {
  return (
    <ul className="daily">
      {daily.time.map((day, i) => {
        const [desc, icon] = describe(daily.weather_code[i]);
        const rain = daily.precipitation_probability_max[i];
        return (
          <li key={day} title={desc}>
            <span className="day">{formatDay(day, i)}</span>
            <span className="day-icon">{icon}</span>
            <span className="rain">{rain != null ? `💧 ${rain}%` : ""}</span>
            <span className="range">
              <span className="max">{Math.round(daily.temperature_2m_max[i])}°</span>
              {" / "}
              <span className="min">{Math.round(daily.temperature_2m_min[i])}°</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
