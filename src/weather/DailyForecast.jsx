import WeatherIcon from "../shared/WeatherIcon.jsx";
import { describeWeather } from "../shared/weatherCodes.js";
import { formatDay } from "./api.js";

export default function DailyForecast({ daily }) {
  return (
    <ul className="daily">
      {daily.time.map((day, i) => {
        const [desc] = describeWeather(daily.weather_code[i]);
        const rain = daily.precipitation_probability_max[i];
        return (
          <li key={day} title={desc}>
            <span className="day">{formatDay(day, i)}</span>
            <WeatherIcon code={daily.weather_code[i]} className="day-icon" />
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
