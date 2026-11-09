import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../shared/base.css";
import "./golf.css";

// 골프 메뉴 페이지(스코어카드·라운드 날씨·3D 코스)마다 같은 방식으로 화면을 붙인다
export function mount(App) {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
