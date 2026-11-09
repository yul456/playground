import GolfLayout from "./GolfLayout.jsx";
import RoundWeather from "./RoundWeather.jsx";

// 골프 메뉴의 "라운드 날씨" 페이지 (golf/weather/). 공유 링크(?lat=…)도 이 페이지로 온다
export default function WeatherApp() {
  return (
    <GolfLayout
      page="weather"
      title="골프 라운드 날씨"
      subtitle="골프장과 티오프 시간을 고르면 라운드하기 좋은 날, 그날 라운드 동안의 예보, 지난해 같은 날 날씨를 보여 줍니다."
    >
      <RoundWeather />
    </GolfLayout>
  );
}
