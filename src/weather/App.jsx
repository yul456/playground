import CurrentWeather from "./CurrentWeather.jsx";
import DailyForecast from "./DailyForecast.jsx";
import WeatherMap from "./WeatherMap.jsx";
import useWeatherController from "./useWeatherController.js";

export default function App() {
  const { view, locating, requests, status, actions } = useWeatherController();

  async function copy(text, what) {
    try {
      await navigator.clipboard.writeText(text);
      actions.showStatus(`${what}를 복사했습니다: ${text}`);
    } catch {
      actions.showStatus(`${what}를 복사하지 못했습니다.`, true);
    }
  }

  return (
    <>
      {/* 로딩·안내는 화면 위에 떠 있게 해 지도·날씨 위치가 밀리지 않게 한다 */}
      <div className={`loading-bar${locating || requests > 0 ? " active" : ""}`} aria-hidden="true" />
      <div className={`card toast${status?.isError ? " error" : ""}`} role="status" aria-live="polite" hidden={!status}>
        {status?.message}
      </div>

      <main className={`container${requests > 0 ? " loading-weather" : ""}`}>
        <a className="back-link" href={import.meta.env.BASE_URL}>← Playground</a>
        <header>
          <h1>내 위치 날씨</h1>
          <p className="subtitle">위치 권한을 허용하면 현재 위치의 날씨를 보여줍니다.</p>
        </header>

        <section className="card map-card">
          <div className="map-header">
            <span>지도를 클릭하면 그 위치의 날씨를, 핀을 누르면 복사·길찾기 메뉴를 보여줍니다.</span>
            <button type="button" className="secondary" onClick={actions.locate}>📍 내 위치로</button>
          </div>
          <WeatherMap view={view} onPick={actions.pick} onSkip={actions.skipToDefault} onCopy={copy} />
        </section>

        {view && (
          <section className="weather">
            <CurrentWeather view={view} />
            <h2>7일 예보</h2>
            <DailyForecast daily={view.weather.daily} />
            <button type="button" className="secondary refresh" onClick={actions.refresh}>새로고침</button>
          </section>
        )}

        <footer>
          날씨 데이터: <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>
          {" · "}지도: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>
        </footer>
      </main>
    </>
  );
}
