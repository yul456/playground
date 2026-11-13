import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { zipFolder } from "./scripts/zip-folder.mjs";

// 페이지 사진 받기 크롬 확장 프로그램. 빌드 없이 이 폴더째 설치하고, 사이트에는 ZIP으로 묶어 안내 페이지 옆에 둔다
const PHOTO_SAVER = resolve(import.meta.dirname, "extensions/photo-saver");
const PHOTO_SAVER_ZIP = "photo-saver/photo-saver.zip";

function photoSaverZip() {
  return {
    name: "photo-saver-zip",
    configureServer(server) {
      // 확장 프로그램 버전(manifest.json)이 바뀌면 개발 서버를 다시 띄운다. 안내 페이지에 적는 버전(아래 define)은
      // 서버가 뜰 때 한 번 읽어서, 다시 띄우지 않으면 예전 버전이 그대로 보였다
      const manifest = resolve(PHOTO_SAVER, "manifest.json");
      server.watcher.add(manifest);
      server.watcher.on("change", (file) => {
        if (resolve(file) === manifest) server.restart();
      });
      // 개발 서버에서는 받을 때마다 새로 묶는다
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split("?")[0].endsWith(`/${PHOTO_SAVER_ZIP}`)) return next();
        res.setHeader("Content-Type", "application/zip");
        res.end(zipFolder(PHOTO_SAVER));
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: PHOTO_SAVER_ZIP, source: zipFolder(PHOTO_SAVER) });
    },
  };
}

export default defineConfig({
  // GitHub Pages 프로젝트 사이트 주소(yul456.github.io/playground/)에 맞춘 기준 경로
  base: "/playground/",
  plugins: [react(), photoSaverZip()],
  define: {
    // 안내 페이지에 적는 확장 프로그램 버전
    __PHOTO_SAVER_VERSION__: JSON.stringify(JSON.parse(readFileSync(resolve(PHOTO_SAVER, "manifest.json"), "utf8")).version),
  },
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
        stitch: resolve(import.meta.dirname, "stitch/index.html"),
        convert: resolve(import.meta.dirname, "convert/index.html"),
        photoSaver: resolve(import.meta.dirname, "photo-saver/index.html"),
        audioCut: resolve(import.meta.dirname, "audio-cut/index.html"),
        audioConvert: resolve(import.meta.dirname, "audio-convert/index.html"),
        // 골프는 메뉴 세 개로 나뉜다. golf/index.html은 예전 주소를 알맞은 메뉴로 보내는 페이지
        golf: resolve(import.meta.dirname, "golf/index.html"),
        golfScorecard: resolve(import.meta.dirname, "golf/scorecard/index.html"),
        golfWeather: resolve(import.meta.dirname, "golf/weather/index.html"),
        golf3d: resolve(import.meta.dirname, "golf/3d/index.html"),
      },
    },
  },
});
