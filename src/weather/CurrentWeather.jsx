import { KIND_LABELS, describe, placeLabel } from "./api.js";

export default function CurrentWeather({ view }) {
  const c = view.weather.current;
  const [desc, icon] = describe(c.weather_code);

  return (
    <div className="card current">
      <div className="location">{placeLabel(view)} ({KIND_LABELS[view.kind]})</div>
      <div className="current-main">
        <span className="icon">{icon}</span>
        <span className="temp">{Math.round(c.temperature_2m)}°</span>
      </div>
      <div className="desc">{desc}</div>
      <dl className="details">
        <div><dt>체감</dt><dd>{Math.round(c.apparent_temperature)}°</dd></div>
        <div><dt>습도</dt><dd>{c.relative_humidity_2m}%</dd></div>
        <div><dt>바람</dt><dd>{c.wind_speed_10m.toFixed(1)} m/s</dd></div>
        <div><dt>강수</dt><dd>{c.precipitation} mm</dd></div>
      </dl>
      <div className="updated">
        업데이트: {view.updatedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
      </div>
    </div>
  );
}
