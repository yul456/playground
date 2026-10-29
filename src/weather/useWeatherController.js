import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LOCATION, fetchPlaceName, fetchWeather, geoErrorMessage } from "./api.js";

// 위치 찾기·날씨 조회 흐름을 관리한다.
// 현재 위치를 먼저 찾고, 위치를 읽을 수 없을 때만 기본 위치를 보여준다.
export default function useWeatherController() {
  // 지금 보여주는 위치와 날씨. kind: "default"(기본) | "mine"(현재 위치) | "picked"(지도에서 선택)
  // 아직 아무 위치도 보여주지 않았으면 null
  const [view, setView] = useState(null);
  const [locating, setLocating] = useState(false);
  const [requests, setRequests] = useState(0);
  const [status, setStatus] = useState(null);

  const viewRef = useRef(null);
  // 응답이 순서대로 오지 않아도 마지막 요청만 화면에 반영한다
  const seqRef = useRef(0);
  const watchIdRef = useRef(null);
  const slowTimerRef = useRef(null);
  const statusTimerRef = useRef(null);

  // 상태 setter와 ref만 쓰므로 한 번만 만들어 둔다
  const actions = useMemo(() => {
    function showStatus(message, isError = false) {
      clearTimeout(statusTimerRef.current);
      setStatus({ message, isError });
      // 오류는 다음 동작까지 남겨 두고, 일반 안내는 잠시 뒤 사라진다
      if (!isError) statusTimerRef.current = setTimeout(() => setStatus(null), 6000);
    }

    function hideStatus() {
      clearTimeout(statusTimerRef.current);
      setStatus(null);
    }

    async function showWeather(lat, lon, kind) {
      const seq = ++seqRef.current;
      setRequests((n) => n + 1);
      let weather, placeName;
      try {
        [weather, placeName] = await Promise.all([
          fetchWeather(lat, lon),
          kind === "default" ? DEFAULT_LOCATION.name : fetchPlaceName(lat, lon),
        ]);
      } finally {
        setRequests((n) => n - 1);
      }
      if (seq !== seqRef.current) return;
      const next = { lat, lon, kind, placeName, weather, updatedAt: new Date() };
      viewRef.current = next;
      setView(next);
    }

    async function loadDefault() {
      try {
        await showWeather(DEFAULT_LOCATION.lat, DEFAULT_LOCATION.lon, "default");
      } catch (err) {
        showStatus(err.message, true);
      }
    }

    function stopLocating() {
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
      clearTimeout(slowTimerRef.current);
      setLocating(false);
    }

    async function onPosition(position) {
      stopLocating();
      const { latitude: lat, longitude: lon } = position.coords;
      try {
        await showWeather(lat, lon, "mine");
        hideStatus();
      } catch (err) {
        showStatus(err.message, true);
      }
    }

    function onPositionError(err) {
      // 권한 거부만 포기하고, 위치를 아직 못 잡은 경우(2, 3)는 계속 기다린다
      if (err.code !== 1) return;
      stopLocating();
      if (!viewRef.current) {
        loadDefault();
        showStatus(`${geoErrorMessage(err)} 기본 위치의 날씨를 보여줍니다.`);
      } else {
        showStatus(`${geoErrorMessage(err)} 지도에서 위치를 직접 선택할 수도 있습니다.`);
      }
    }

    function locate() {
      if (!("geolocation" in navigator)) {
        if (!viewRef.current) loadDefault();
        showStatus("이 브라우저는 위치 정보를 지원하지 않습니다. 지도에서 위치를 선택해 주세요.");
        return;
      }
      stopLocating();
      setLocating(true);
      // getCurrentPosition은 시간 초과 시 바로 끝나므로, 위치가 늦게 잡혀도 받을 수 있게 watchPosition을 쓴다
      watchIdRef.current = navigator.geolocation.watchPosition(onPosition, onPositionError, {
        // macOS 크롬에서 false면 캐시된 위치가 없을 때 응답이 오지 않는다
        enableHighAccuracy: true,
        maximumAge: 5 * 60 * 1000,
      });
      slowTimerRef.current = setTimeout(() => {
        // 로딩 바가 끝없이 돌지 않게 멈추고, 위치는 뒤에서 계속 기다린다
        setLocating(false);
        if (!viewRef.current) {
          loadDefault();
          showStatus("현재 위치를 확인하지 못해 기본 위치를 보여줍니다. 확인되면 자동으로 바뀝니다.");
        } else {
          showStatus("현재 위치 확인이 늦어지고 있습니다. 확인되면 자동으로 바뀝니다.");
        }
      }, 15000);
    }

    async function pick(lat, lon) {
      // 사용자가 직접 고른 위치를 늦게 잡힌 현재 위치가 덮어쓰지 않게 위치 찾기를 멈춘다
      stopLocating();
      try {
        await showWeather(lat, lon, "picked");
        hideStatus();
      } catch (err) {
        showStatus(err.message, true);
      }
    }

    function skipToDefault() {
      // 위치 확인을 기다리지 않고 기본 위치를 보겠다고 고른 것이므로 위치 찾기를 멈춘다
      stopLocating();
      loadDefault();
    }

    async function refresh() {
      const current = viewRef.current;
      if (current.kind === "mine") {
        locate();
        return;
      }
      // 위치 찾기가 끝났는데(거부 등) 기본 위치를 보고 있다면 한 번 더 시도
      if (current.kind === "default" && watchIdRef.current === null) locate();
      try {
        await showWeather(current.lat, current.lon, current.kind);
      } catch (err) {
        showStatus(err.message, true);
      }
    }

    // 브라우저 설정에서 위치 권한을 바꾸면 새로고침 없이 반영한다. 해제 함수를 돌려준다
    function watchPermission() {
      let permission = null;
      let cancelled = false;
      const onChange = () => {
        const current = viewRef.current;
        if (permission.state === "granted" && (!current || current.kind === "default")) locate();
        if (permission.state === "denied") {
          stopLocating();
          if (!current || current.kind === "mine") loadDefault();
          showStatus("위치 권한이 꺼졌습니다. 지도에서 위치를 직접 선택할 수 있습니다.");
        }
      };
      navigator.permissions?.query({ name: "geolocation" })
        .then((result) => {
          if (cancelled) return;
          permission = result;
          permission.addEventListener("change", onChange);
        })
        // permissions API 미지원 브라우저는 버튼으로만 다시 시도
        .catch(() => {});
      return () => {
        cancelled = true;
        permission?.removeEventListener("change", onChange);
      };
    }

    return { showStatus, hideStatus, locate, stopLocating, pick, skipToDefault, refresh, watchPermission };
  }, []);

  useEffect(() => {
    actions.locate();
    const unwatch = actions.watchPermission();
    return () => {
      actions.stopLocating();
      unwatch();
      clearTimeout(statusTimerRef.current);
    };
  }, [actions]);

  return { view, locating, requests, status, actions };
}
