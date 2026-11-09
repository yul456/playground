import Course3D from "./Course3D.jsx";
import GolfLayout from "./GolfLayout.jsx";

// 골프 메뉴의 "3D 코스" 페이지 (golf/3d/)
export default function Course3DApp() {
  return (
    <GolfLayout
      page="3d"
      title="골프 3D 코스"
      subtitle="골프장 지형을 3D로 보고, 홀마다 길이와 오르막·내리막을 확인하며 코스를 날아서 둘러봅니다."
    >
      <Course3D />
    </GolfLayout>
  );
}
