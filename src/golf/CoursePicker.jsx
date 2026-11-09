import { useState } from "react";
import { geoErrorMessage } from "../shared/geo.js";
import CourseMap from "./CourseMap.jsx";
import { nearestCourse, searchCourses } from "./roundWeather.js";

// 골프장 고르기: 이름 검색, 현재 위치, 지도에서 직접 고르기.
// map이 false면 지도 없이 고른다(3D 코스 탭은 아래에 3D 지도가 따로 있다). badge(골프장)가 글자를 돌려주면 검색 결과에 붙인다
export default function CoursePicker({ course, onChange, map = true, badge }) {
  const [query, setQuery] = useState("");
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState(null);
  const results = searchCourses(query);

  function choose(next) {
    onChange(next);
    setQuery("");
    setMessage(null);
  }

  // 고른 곳 가까이에 알려진 골프장이 있으면 그 이름을 붙인다
  function pickAt(lat, lon) {
    const near = nearestCourse(lat, lon);
    choose({ name: near?.name ?? "지도에서 고른 곳", region: near?.region ?? "", lat, lon });
  }

  function locate() {
    if (!("geolocation" in navigator)) {
      setMessage("이 브라우저는 위치 정보를 지원하지 않습니다. 지도에서 골라 주세요.");
      return;
    }
    setLocating(true);
    setMessage(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        pickAt(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setLocating(false);
        setMessage(geoErrorMessage(err));
      },
      // macOS 크롬에서 false면 캐시된 위치가 없을 때 응답이 오지 않는다
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 5 * 60 * 1000 },
    );
  }

  return (
    <section className="card">
      <h2>골프장</h2>
      <form
        className="course-search"
        onSubmit={(e) => {
          e.preventDefault();
          if (results[0]) choose(results[0]);
        }}
      >
        <input
          type="search"
          value={query}
          placeholder="골프장 이름 검색"
          aria-label="골프장 이름"
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="secondary" onClick={locate} disabled={locating}>
          {locating ? "확인 중…" : "📍 현재 위치"}
        </button>
      </form>

      {query.trim() && (results.length ? (
        <ul className="course-results">
          {results.map((c) => (
            <li key={`${c.name} ${c.lat}`}>
              <button type="button" onClick={() => choose(c)}>
                <span>
                  {c.name}
                  {badge?.(c) && <span className="course-badge">{badge(c)}</span>}
                </span>
                <span className="region">{c.region}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted course-hint">목록에 없는 골프장입니다.{map && " 지도에서 위치를 눌러 고를 수 있습니다."}</p>
      ))}
      {message && <p className="weather-error" role="alert">{message}</p>}

      <p className="course-current">
        {course ? (
          <>
            ⛳ <strong>{course.name}</strong>{" "}
            <span className="muted">{course.region || `${course.lat.toFixed(3)}, ${course.lon.toFixed(3)}`}</span>
          </>
        ) : (
          <span className="muted">골프장 이름을 검색하거나 {map ? "지도를 눌러" : "현재 위치로"} 고르세요.</span>
        )}
      </p>
      {map && <CourseMap course={course} onPick={pickAt} />}
    </section>
  );
}
