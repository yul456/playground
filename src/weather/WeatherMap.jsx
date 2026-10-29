import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import markerIcon from "leaflet/dist/images/marker-icon.png";
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png";
import markerShadow from "leaflet/dist/images/marker-shadow.png";
import { KIND_LABELS } from "./api.js";

// 동 단위가 한눈에 보이는 배율 (지도 가로 약 7km 범위)
const MAP_ZOOM = 14;

// 번들러를 거치면 Leaflet이 기본 핀 이미지 경로를 찾지 못해 직접 지정한다
const pinIcon = L.icon({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

// 핀을 누르면 뜨는 메뉴: 주소·좌표 복사, 길찾기
// Leaflet 팝업은 React 바깥에서 그려지므로 DOM으로 직접 만든다
function buildPopup(view, onCopy) {
  const { lat, lon, placeName, kind } = view;
  const coords = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const title = placeName || KIND_LABELS[kind];
  // 카카오 링크는 쉼표로 값을 구분하므로 이름에서 쉼표를 뺀다
  const destName = title.replaceAll(",", " ");

  const el = document.createElement("div");
  el.className = "marker-popup";
  el.innerHTML = `
    <div class="popup-title"></div>
    <div class="popup-coords"></div>
    <div class="popup-actions">
      <button type="button" data-copy="address">주소 복사</button>
      <button type="button" data-copy="coords">좌표 복사</button>
      <a class="naver" target="_blank" rel="noopener">네이버 길찾기</a>
      <a class="kakao" target="_blank" rel="noopener">카카오 길찾기</a>
    </div>`;
  el.querySelector(".popup-title").textContent = title;
  el.querySelector(".popup-coords").textContent = coords;

  const address = el.querySelector('[data-copy="address"]');
  if (placeName) address.addEventListener("click", () => onCopy(placeName, "주소"));
  else address.disabled = true;
  el.querySelector('[data-copy="coords"]').addEventListener("click", () => onCopy(coords, "좌표"));

  // 도착지만 넘기면 출발지는 각 지도 서비스가 사용자의 현재 위치로 잡는다
  el.querySelector(".naver").href = "https://map.naver.com/index.nhn?" + new URLSearchParams({
    elng: lon, elat: lat, etext: destName, menu: "route", pathType: 0,
  });
  el.querySelector(".kakao").href =
    `https://map.kakao.com/link/to/${encodeURIComponent(destName)},${lat},${lon}`;
  return el;
}

export default function WeatherMap({ view, onPick, onSkip, onCopy }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const lastOpenedRef = useRef(null);
  // Leaflet 이벤트 안에서 항상 최신 값을 쓰도록 ref에 담는다
  const latest = useRef({ view, onPick, onCopy });
  latest.current = { view, onPick, onCopy };

  useEffect(() => {
    if (!view) return;
    const { lat, lon, kind } = view;

    // 지도는 처음 보여줄 위치(현재 위치 또는 기본 위치)가 정해지면 그 자리에서 만든다
    // 미리 기본 위치로 만들어 두면 현재 위치로 옮겨 갈 때 지도가 크게 튄다
    if (!mapRef.current) {
      const map = L.map(containerRef.current).setView([lat, lon], MAP_ZOOM);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const marker = L.marker([lat, lon], { icon: pinIcon })
        .addTo(map)
        .bindPopup(() => buildPopup(latest.current.view, latest.current.onCopy), { minWidth: 220 });
      // 지도를 끌거나 확대·축소하는 동안에는 핀 메뉴를 숨겼다가, 움직임이 끝나면(관성 이동 포함) 다시 보여준다
      const container = map.getContainer();
      map.on("dragstart zoomstart", () => container.classList.add("moving"));
      map.on("moveend", () => container.classList.remove("moving"));
      map.on("click", (e) => {
        marker.closePopup();
        marker.setLatLng(e.latlng);
        latest.current.onPick(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([lat, lon]);
      // 지도에서 직접 고른 위치는 사용자가 맞춰 둔 배율을 유지한다
      if (kind === "picked") mapRef.current.panTo([lat, lon]);
      else mapRef.current.setView([lat, lon], MAP_ZOOM);
    }

    // 현재 위치나 지도에서 고른 위치는 지역명까지 받아 온 뒤 핀 메뉴를 바로 열어 준다.
    // 새로고침으로 같은 위치를 다시 받을 때는 열지 않는다
    if (kind !== "default" && !lastOpenedRef.current?.equals([lat, lon])) markerRef.current.openPopup();
    lastOpenedRef.current = L.latLng(lat, lon);
  }, [view]);

  useEffect(() => () => {
    mapRef.current?.remove();
    mapRef.current = null;
    markerRef.current = null;
    lastOpenedRef.current = null;
  }, []);

  return (
    <div className="map-wrap">
      <div ref={containerRef} className="map" />
      {/* 위치가 정해지기 전까지 지도 자리를 같은 크기로 채워 둔다 */}
      {!view && (
        <div className="map-placeholder">
          <p>현재 위치를 확인하는 중…</p>
          <p className="hint">위치 권한 요청이 뜨면 허용해 주세요.</p>
          <button type="button" className="secondary" onClick={onSkip}>기본 위치로 보기</button>
        </div>
      )}
    </div>
  );
}
