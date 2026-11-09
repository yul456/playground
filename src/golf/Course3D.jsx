import { useEffect, useMemo, useState } from "react";
import CourseMap3D from "./CourseMap3D.jsx";
import CoursePicker from "./CoursePicker.jsx";
import { arrangeHoles, courseKey, heightsAt, lineLength, slopeText } from "./course3d.js";
import { GOLF_COURSES } from "./golfCourses.js";

// 골프장마다 홀·그린 데이터 파일. OpenStreetMap에 홀이나 그린이 그려진 골프장만 있다 (scripts/golf-3d.mjs가 만든다).
// 파일마다 따로 묶여서 고른 골프장 것만 받는다
const COURSE_FILES = import.meta.glob("./courses3d/*.json", { import: "default" });
const fileOf = (course) => (course ? COURSE_FILES[`./courses3d/${courseKey(course)}.json`] : undefined);

const SETTINGS_KEY = "playground.golf.course3d.v1";
// 아직 고른 골프장이 없으면 먼저 보여 줄 골프장 (사용자가 가장 먼저 챙기는 곳)
const FIRST_COURSE = "킹즈락CC";

function firstCourse() {
  const row = GOLF_COURSES.find(([name]) => name === FIRST_COURSE);
  if (!row) return null;
  const [name, lat, lon, region] = row;
  return { name, lat, lon, region };
}

function loadCourse() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY));
    if (saved?.course) return saved.course;
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 처음 골프장으로 시작한다
  }
  return firstCourse();
}

// 골프 페이지의 "3D 코스" 탭: 골프장 주변 지형을 3D로 보여 주고, 홀 데이터가 있으면 홀마다
// 길이·오르막 내리막을 보여 주며 티에서 그린까지 날아간다
export default function Course3D() {
  const [course, setCourse] = useState(loadCourse);
  // 골프장 데이터: { key, status: loading | ready | none | error, data }
  const [file, setFile] = useState(null);
  // 홀마다 [티 높이, 그린 높이](m)
  const [heights, setHeights] = useState(null);
  // 고른 홀: { index, nonce }. 같은 홀을 다시 눌러도 다시 날도록 nonce를 바꾼다
  const [selected, setSelected] = useState(null);
  // 지도가 지금 보여 주는 홀(고른 홀이나 둘러보는 중인 홀). 목록에서 표시한다
  const [active, setActive] = useState(null);
  const key = course ? courseKey(course) : null;
  const loaded = file?.key === key && file.status === "ready" ? file.data : null;
  // 홀 순서와 목록 이름을 정한다. 지도와 목록이 같은 순서(번호)로 홀을 가리킨다
  const data = useMemo(() => (loaded ? { ...loaded, holes: arrangeHoles(loaded.holes) } : null), [loaded]);
  const status = !course ? null : file?.key === key ? file.status : "loading";

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ course }));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [course]);

  useEffect(() => {
    setSelected(null);
    setActive(null);
    setHeights(null);
    const load = fileOf(course);
    if (!course) return undefined;
    if (!load) {
      setFile({ key, status: "none", data: null });
      return undefined;
    }
    let cancelled = false;
    load().then(
      (loaded) => !cancelled && setFile({ key, status: "ready", data: loaded }),
      () => !cancelled && setFile({ key, status: "error", data: null }),
    );
    return () => {
      cancelled = true;
    };
  }, [course, key]);

  // 홀마다 티와 그린의 지형 높이를 읽는다
  useEffect(() => {
    if (!data?.holes.length) return undefined;
    const controller = new AbortController();
    const points = data.holes.flatMap((hole) => [hole.coords[0], hole.coords.at(-1)]);
    heightsAt(points, controller.signal).then(
      (values) => setHeights(data.holes.map((_, i) => [values[2 * i], values[2 * i + 1]])),
      () => {
        // 높이를 못 읽으면 오르막·내리막만 빼고 보여 준다
        if (!controller.signal.aborted) setHeights([]);
      },
    );
    return () => controller.abort();
  }, [data]);

  // 홀마다 목록과 지도 위 설명에 함께 쓰는 정보
  const rows = (data?.holes ?? []).map((hole, i) => {
    const length = `${Math.round(lineLength(hole.coords))}m`;
    const slope = heights ? slopeText(heights[i] ? heights[i][1] - heights[i][0] : null) : null;
    return { par: hole.par ? `파${hole.par}` : "", length, slope, info: [hole.label, hole.par && `파${hole.par}`, length, slope].filter(Boolean).join(" · ") };
  });

  let note = null;
  if (status === "loading") note = "골프장 데이터를 불러오는 중…";
  else if (status === "error") note = "골프장 데이터를 불러오지 못했습니다. 새로고침해 주세요.";
  else if (status === "none") note = "OpenStreetMap에 홀·그린이 그려지지 않은 골프장이라 지형만 보여 줍니다.";
  else if (data && !data.holes.length && !Object.values(data.areas).some((list) => list.length)) {
    note = "OpenStreetMap에 골프장 경계만 있고 홀·그린은 그려져 있지 않아, 지형과 경계(점선)만 보여 줍니다.";
  } else if (data && !data.holes.length) note = "그린·벙커만 그려져 있고 홀 선은 없는 골프장입니다.";
  else if (data) note = "홀을 누르면 티 뒤에서 그린까지 날아갑니다. 지도에서 홀 선을 눌러도 되고, 지도를 만지면 멈춥니다.";

  return (
    <>
      <CoursePicker course={course} onChange={setCourse} map={false} badge={(c) => (fileOf(c) ? "코스 정보" : null)} />
      <section className="card">
        <h2>3D 코스</h2>
        {course ? (
          <CourseMap3D
            course={course}
            data={data}
            selected={selected}
            info={rows.map((r) => r.info)}
            onActive={setActive}
            onPick={(index) => setSelected({ index, nonce: Date.now() })}
          />
        ) : (
          <p className="muted">골프장을 고르면 주변 지형을 3D로 보여 줍니다. 끌어서 옮기고, 오른쪽 버튼이나 두 손가락으로 돌리고 기울일 수 있습니다.</p>
        )}
        {note && <p className="course3d-note">{note}</p>}
        {data?.holes.length > 0 && (
          <ol className="hole3d-list">
            {data.holes.map((hole, i) => (
              <li key={i}>
                <button
                  type="button"
                  className={active === i ? "active" : ""}
                  aria-pressed={active === i}
                  onClick={() => setSelected({ index: i, nonce: Date.now() })}
                >
                  <strong>{hole.label}</strong>
                  <span>{rows[i].par}</span>
                  <span>{rows[i].length}</span>
                  <span className="slope">{heights ? rows[i].slope ?? "" : "높이 재는 중"}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
        {data?.holes.length > 0 && (
          <p className="weather-note">
            길이는 지도에 그려진 홀 선(보통 티에서 그린 가운데까지)의 길이입니다. 오르막·내리막은 약 30m 간격의 지형 자료로 잰
            티와 그린의 높이 차라 몇 m 정도 틀릴 수 있습니다.
          </p>
        )}
        {data && <p className="weather-credit">골프장 데이터 © OpenStreetMap 기여자 (ODbL), {data.updated} 기준</p>}
      </section>
    </>
  );
}
