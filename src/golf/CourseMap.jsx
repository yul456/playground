import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// 골프장을 고르기 전에는 남한 전체를 보여 준다
const KOREA_CENTER = [36.3, 127.8];
const KOREA_ZOOM = 6;
// 골프장 하나가 화면에 다 들어오는 배율 (가로 약 3km)
const COURSE_ZOOM = 14;

// 깃발 그림을 핀으로 쓴다. 이미지 파일이 아니라 번들러 경로 문제도 없다
const flagIcon = L.divIcon({ className: "course-pin", html: "⛳", iconSize: [28, 28], iconAnchor: [8, 26] });

export default function CourseMap({ course, onPick }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  // Leaflet 이벤트 안에서 항상 최신 함수를 쓰도록 ref에 담는다
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  // 지도를 눌러 고른 위치. 이때는 사용자가 맞춰 둔 배율을 그대로 둔다
  const clickedRef = useRef(null);

  useEffect(() => {
    const map = L.map(containerRef.current).setView(KOREA_CENTER, KOREA_ZOOM);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    map.on("click", (e) => {
      clickedRef.current = e.latlng;
      onPickRef.current(e.latlng.lat, e.latlng.lng);
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !course) return;
    const at = [course.lat, course.lon];
    if (markerRef.current) markerRef.current.setLatLng(at);
    else markerRef.current = L.marker(at, { icon: flagIcon, keyboard: false }).addTo(map);
    if (clickedRef.current?.equals(at)) map.panTo(at);
    else map.setView(at, COURSE_ZOOM);
    clickedRef.current = null;
  }, [course]);

  return <div ref={containerRef} className="course-map" />;
}
