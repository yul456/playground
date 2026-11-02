import { FOG_CODES, describeWeather } from "./weatherCodes.js";

// 날씨 아이콘(이모지). 안개는 구름 이모지를 조금 올리고 아래에 안개 줄을 그린다 (base.css의 .weather-icon.fog).
// 비·눈 아이콘처럼 "구름 + 아래에 무언가" 모양이 되어 다른 아이콘과 어울린다
export default function WeatherIcon({ code, className = "", ...rest }) {
  const [, icon] = describeWeather(code);
  const fog = FOG_CODES.has(code);
  return (
    <span className={`weather-icon${fog ? " fog" : ""}${className ? ` ${className}` : ""}`} {...rest}>
      {fog ? <span>{icon}</span> : icon}
    </span>
  );
}
