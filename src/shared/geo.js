// 위치를 찾지 못한 이유(GeolocationPositionError)를 안내 문장으로 바꾼다 (날씨, 골프 라운드 날씨)
export function geoErrorMessage(err) {
  switch (err.code) {
    case 1: return "위치 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.";
    case 2: return "현재 위치를 확인할 수 없습니다.";
    case 3: return "위치 확인 시간이 초과되었습니다. 다시 시도해 주세요.";
    default: return err.message || "위치 정보를 가져오지 못했습니다.";
  }
}
