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
    rolldownOptions: {
      // 기능마다 페이지(HTML)를 따로 둔다. 새 기능을 만들면 여기에 추가
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        weather: resolve(import.meta.dirname, "weather/index.html"),
        ladder: resolve(import.meta.dirname, "ladder/index.html"),
        golf: resolve(import.meta.dirname, "golf/index.html"),
      },
    },
  },
});
