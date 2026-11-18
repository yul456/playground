import { useEffect, useRef, useState } from "react";

// 목록의 작은 그림. 화면 가까이 온 줄의 그림만 3장씩 읽고, 잘라 낼 곳은 어둡게 보인다. 폭 44·높이 120px 안에 맞춘다
const WIDTH = 44;
const HEIGHT = 120;
const LIMIT = 3;
let running = 0;
const queue = [];

function pump() {
  while (running < LIMIT && queue.length) {
    const job = queue.shift();
    if (job.cancelled) continue;
    running++;
    job
      .run()
      .then(job.done, () => job.done(null))
      .finally(() => {
        running--;
        pump();
      });
  }
}

export default function Thumb({ load, width, height, crop }) {
  const ref = useRef(null);
  const [bitmap, setBitmap] = useState(null);
  const fit = Math.min(WIDTH / width, HEIGHT / height);
  const w = Math.max(1, Math.round(width * fit));
  const h = Math.max(1, Math.round(height * fit));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    let job = null;
    let made = null;
    let alive = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || job) return;
        observer.disconnect();
        job = {
          // 칸 크기의 두 배로 줄여 연다 (긴 그림을 폭에만 맞춰 줄이면 높이가 수천 px이 된다)
          run: async () => createImageBitmap(await load(), { resizeWidth: w * 2, resizeHeight: h * 2, resizeQuality: "medium", imageOrientation: "from-image" }),
          done: (bmp) => {
            if (!alive) {
              bmp?.close();
              return;
            }
            made = bmp;
            setBitmap(bmp);
          },
        };
        queue.push(job);
        pump();
      },
      { rootMargin: "300px" },
    );
    observer.observe(canvas);
    return () => {
      alive = false;
      observer.disconnect();
      if (job) job.cancelled = true;
      made?.close();
    };
  }, [load]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(0, 0, w, h);
    if (!bitmap) return;
    ctx.drawImage(bitmap, 0, 0, w, h);
    const sx = w / width;
    const sy = h / height;
    ctx.fillStyle = "rgba(15, 23, 42, 0.65)";
    ctx.fillRect(0, 0, w, crop.top * sy);
    ctx.fillRect(0, h - crop.bottom * sy, w, crop.bottom * sy);
    ctx.fillRect(0, crop.top * sy, crop.left * sx, h - (crop.top + crop.bottom) * sy);
    ctx.fillRect(w - crop.right * sx, crop.top * sy, crop.right * sx, h - (crop.top + crop.bottom) * sy);
  }, [bitmap, crop.top, crop.bottom, crop.left, crop.right, width, height, w, h]);

  return <canvas ref={ref} className="cr-thumb" style={{ width: w, height: h }} aria-hidden="true" />;
}
