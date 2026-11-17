// 그림 파일의 작은 미리보기 (이름 칸 앞). 마우스를 올리면 크게 보인다.
//
// 사진 폴더에는 큰 그림이 수백 장일 수 있어서:
//   - 화면에 보이는(가까이 온) 줄의 그림만 읽는다. 화면 밖으로 나가면 아직 시작하지 않은 것은 그만둔다
//   - 한 번에 몇 장씩만 읽고, 줄인 그림(긴 변 260px, JPG)만 남긴다. 원본을 주소로 걸어 두면 이름을 바꾼 뒤에 다시 읽다가 실패한다
//   - 저장하는 동안에는 읽지 않는다 (pauseThumbs). 이 화면이 읽고 있는 파일의 이름을 바꾸려다 막히지 않게 하려는 것이다
import { memo, useEffect, useRef, useState } from "react";

// 미리보기 그림의 긴 변(px). 마우스를 올렸을 때 보이는 큰 그림의 크기다
const SIZE = 260;
// 한 번에 읽는 파일 수
const LOADERS = 3;

// 파일 핸들 → { url, width, height } (다 만든 것) · { failed: true } (그림으로 열 수 없는 파일)
const cache = new Map();
// 파일 핸들 → 그 그림을 기다리는 칸들이 넘긴 함수
const waiting = new Map();
// 읽을 차례를 기다리는 파일 핸들
const pending = [];
let running = 0;
let paused = false;
let idle = null;

// SVG는 createImageBitmap이 파일에서 바로 열지 못해 <img>로 읽는다
async function decode(blob, name) {
  try {
    return await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch (error) {
    if (!name.toLowerCase().endsWith(".svg")) throw error;
    const url = URL.createObjectURL(new Blob([blob], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

async function make(handle) {
  // 파일을 먼저 다 읽는다. 여기서 실패하면(이름을 바꾸는 중 등) 그림 탓이 아니라서 나중에 다시 해 본다
  let bytes;
  try {
    bytes = await (await handle.getFile()).arrayBuffer();
  } catch {
    return { failed: true, retry: true };
  }
  try {
    const image = await decode(new Blob([bytes]), handle.name);
    const width = image.width || SIZE;
    const height = image.height || SIZE;
    const scale = Math.min(1, SIZE / Math.max(width, height));
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close?.();
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
    return { url: URL.createObjectURL(blob), width, height };
  } catch {
    return { failed: true };
  }
}

function pump() {
  while (!paused && running < LOADERS && pending.length) {
    const handle = pending.shift();
    running++;
    make(handle).then((thumb) => {
      running--;
      // 다시 해 볼 것은 기억하지 않는다
      if (!thumb.retry) cache.set(handle, thumb);
      const callbacks = waiting.get(handle) ?? [];
      waiting.delete(handle);
      // 기다리던 칸이 그사이 다 없어졌으면 만든 그림은 기억해 두기만 한다
      for (const callback of callbacks) callback(thumb);
      if (!running && idle) {
        idle();
        idle = null;
      }
      pump();
    });
  }
}

// 그 파일의 미리보기를 달라고 한다. 다 되면 done(미리보기)을 부른다. 결과: 그만 기다리게 하는 함수
function request(handle, done) {
  if (cache.has(handle)) {
    done(cache.get(handle));
    return () => {};
  }
  if (!waiting.has(handle)) {
    waiting.set(handle, new Set());
    pending.push(handle);
  }
  waiting.get(handle).add(done);
  pump();
  return () => {
    const callbacks = waiting.get(handle);
    if (!callbacks) return;
    callbacks.delete(done);
    // 아무도 기다리지 않고 아직 시작하지 않았으면 읽지 않는다
    const at = pending.indexOf(handle);
    if (!callbacks.size && at >= 0) {
      pending.splice(at, 1);
      waiting.delete(handle);
    }
  };
}

// 저장하는 동안 미리보기 읽기를 멈춘다. 읽고 있던 것이 끝나면 풀리는 약속을 돌려준다
export function pauseThumbs() {
  paused = true;
  if (!running) return Promise.resolve();
  return new Promise((resolve) => {
    const before = idle;
    idle = () => {
      before?.();
      resolve();
    };
  });
}
export function resumeThumbs() {
  paused = false;
  pump();
}

// 폴더를 새로 읽을 때 만들어 둔 미리보기를 모두 버린다
export function clearThumbs() {
  for (const thumb of cache.values()) if (thumb.url) URL.revokeObjectURL(thumb.url);
  cache.clear();
  waiting.clear();
  pending.length = 0;
  paused = false;
}

// 그림 파일 한 줄의 미리보기. handle은 그 줄의 파일 핸들(이름을 바꿔도 같은 객체다)
export const Thumb = memo(function Thumb({ handle, name }) {
  const [thumb, setThumb] = useState(() => cache.get(handle) ?? null);
  const [preview, setPreview] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (thumb && !thumb.retry) return undefined;
    // 읽다가 실패한 것은 조금 뒤에 다시 해 본다
    if (thumb?.retry) {
      const timer = setTimeout(() => setThumb(null), 1500);
      return () => clearTimeout(timer);
    }
    let cancel = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.some((entry) => entry.isIntersecting);
        if (near && !cancel) cancel = request(handle, setThumb);
        else if (!near && cancel) {
          cancel();
          cancel = null;
        }
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      cancel?.();
    };
  }, [handle, thumb]);

  const showPreview = (event) => {
    if (!thumb?.url) return;
    const box = event.currentTarget.getBoundingClientRect();
    setPreview({ left: Math.min(box.right + 10, window.innerWidth - 270), top: Math.max(8, Math.min(box.top - 100, window.innerHeight - 270)) });
  };
  let state = "waiting";
  if (thumb?.url) state = "ready";
  else if (thumb?.failed && !thumb.retry) state = "failed";
  return (
    <span
      ref={ref}
      className="rn-thumb"
      data-state={state}
      title={thumb?.url ? `${name} · ${thumb.width}×${thumb.height}` : state === "failed" ? "그림으로 열 수 없는 파일입니다" : undefined}
      onMouseEnter={showPreview}
      onMouseLeave={() => setPreview(null)}
    >
      {thumb?.url && <img src={thumb.url} alt="" />}
      {state === "failed" && <span aria-hidden="true">?</span>}
      {preview && thumb?.url && <img className="rn-art-big" src={thumb.url} alt="" style={preview} />}
    </span>
  );
});
