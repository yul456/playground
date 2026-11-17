// 앨범 아트로 넣을 그림을 준비한다 (브라우저에서 돈다).
// 재생기들이 고루 읽는 형식은 JPG와 PNG라서, 그 밖의 그림(WebP, GIF, BMP 등)은 JPG로 바꿔 넣는다.

const JPEG_QUALITY = 0.92;

// 넣을 그림의 긴 변을 줄일 수 있는 크기(px). 0은 줄이지 않는다는 뜻이다
export const PICTURE_SIZES = [0, 1400, 1000, 600];

function sniff(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  return "";
}

// 그림 파일을 앨범 아트로 넣을 수 있게 준비한다. max가 있으면 긴 변이 그보다 클 때 그 크기로 줄인다(JPG로 다시 만든다).
// 결과: { mime, data: Uint8Array, width, height, size, url: 미리 볼 주소, name,
//         converted: 형식 때문에 JPG로 바꿨는지, from: 줄였으면 원래 크기 { width, height } }
// 그림으로 열 수 없으면 오류를 낸다
export async function preparePicture(file, max = 0) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`${file.name}은(는) 그림 파일이 아니거나 열 수 없는 형식입니다.`);
  }
  let { width, height } = bitmap;
  let data = new Uint8Array(await file.arrayBuffer());
  let mime = sniff(data);
  const converted = !mime;
  const long = Math.max(width, height);
  const from = max && long > max ? { width, height } : null;
  if (converted || from) {
    if (from) {
      width = Math.max(1, Math.round((width * max) / long));
      height = Math.max(1, Math.round((height * max) / long));
    }
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    // JPG에는 투명한 곳이 없어 흰 바탕에 그린다
    context.fillStyle = "#fff";
    context.fillRect(0, 0, width, height);
    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, width, height);
    data = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY })).arrayBuffer());
    mime = "image/jpeg";
  }
  bitmap.close();
  return { mime, data, width, height, size: data.length, url: URL.createObjectURL(new Blob([data], { type: mime })), name: file.name, converted, from };
}

// 받을 수 있는 그림 주소인지: https이거나 이 페이지와 같은 곳(개발·시험)
function allowed(url) {
  try {
    const parsed = new URL(url, location.href);
    return parsed.protocol === "https:" || parsed.origin === location.origin;
  } catch {
    return false;
  }
}

// 다른 사이트의 그림 주소에서 그림을 받아 준비한다(preparePicture). 그 서버가 다른 사이트에서 읽는 것을 허락해야(CORS) 받을 수 있다.
// 리퍼러는 보내지 않는다. 다른 사이트에서 걸어 온 요청을 막는 그림 서버가 있고, 이 페이지의 주소를 알릴 까닭도 없다
export async function fetchPicture(url, max = 0) {
  if (!allowed(url)) throw new Error("받을 수 없는 주소입니다.");
  const response = await fetch(url, { referrerPolicy: "no-referrer", credentials: "omit" });
  if (!response.ok) throw new Error(`그림 서버가 ${response.status}로 답했습니다.`);
  const blob = await response.blob();
  // 애플 뮤직에는 움직이는 표지(MP4)도 있다
  if (blob.type.startsWith("video/")) throw new Error("움직이는 표지(영상)는 앨범 아트로 넣을 수 없습니다.");
  let name = "cover";
  try {
    name = decodeURIComponent(new URL(url, location.href).pathname.split("/").pop()) || name;
  } catch {
    // 이름을 알 수 없으면 그냥 cover라고 한다
  }
  return preparePicture(new File([blob], name, { type: blob.type }), max);
}
