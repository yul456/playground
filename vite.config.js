import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // GitHub Pages 프로젝트 사이트 주소(yul456.github.io/playground/)에 맞춘 기준 경로
  base: "/playground/",
  plugins: [react()],
  // 다른 프로젝트가 기본 포트(5173)를 쓰고 있어 5500으로 고정한다
  server: { port: 5500, strictPort: true },
  preview: { port: 5500, strictPort: true },
  build: {
    // 골프 3D 코스 탭의 지도 라이브러리(MapLibre, 약 1MB)는 그 탭을 열 때만 따로 받는 덩어리라 크기 경고 기준을 올린다
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      // 기능마다 페이지(HTML)를 따로 둔다. 새 기능을 만들면 여기에 추가
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        weather: resolve(import.meta.dirname, "weather/index.html"),
        ladder: resolve(import.meta.dirname, "ladder/index.html"),
        wheel: resolve(import.meta.dirname, "wheel/index.html"),
        ball: resolve(import.meta.dirname, "ball/index.html"),
        mines: resolve(import.meta.dirname, "mines/index.html"),
        baseball: resolve(import.meta.dirname, "baseball/index.html"),
        // 골프는 메뉴 세 개로 나뉜다. golf/index.html은 예전 주소를 알맞은 메뉴로 보내는 페이지
        golf: resolve(import.meta.dirname, "golf/index.html"),
        golfScorecard: resolve(import.meta.dirname, "golf/scorecard/index.html"),
        golfWeather: resolve(import.meta.dirname, "golf/weather/index.html"),
        golf3d: resolve(import.meta.dirname, "golf/3d/index.html"),
      },
    },
  },
});
