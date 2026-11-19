// 보이지 않는 문서(offscreen document). 서비스 워커는 Blob 주소(URL.createObjectURL)를 만들지 못해서
// 세로로 이어 붙이기는 여기서 하고, 다 만든 그림의 Blob 주소를 서비스 워커에 넘겨 받게 한다.
// 이 문서에서는 chrome.runtime(메시지)만 쓸 수 있다.
// 오른쪽 클릭 메뉴의 "복사한 글로"(1.23.0)에서는 클립보드의 글도 여기서 읽는다. 서비스 워커는 클립보드를 읽지 못하고,
// 이 문서는 초점을 받을 수 없어 navigator.clipboard 대신 글 칸에 붙여 넣어(execCommand paste, clipboardRead 권한) 읽는다
import { stitchImages } from "./stitch.js";

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.target !== "offscreen") return false;
  if (message.type === "stitch") run(message);
  else if (message.type === "revoke") URL.revokeObjectURL(message.url);
  else if (message.type === "clipboard-read") reply(readClipboard());
  return false;
});

function readClipboard() {
  const box = document.createElement("textarea");
  document.body.append(box);
  box.focus();
  document.execCommand("paste");
  const text = box.value;
  box.remove();
  return text;
}

async function run({ jobId, urls, format, quality, split, splitMode }) {
  const send = (message) => chrome.runtime.sendMessage({ target: "background", jobId, ...message }).catch(() => {});
  try {
    const result = await stitchImages(urls, (progress) => send({ type: "stitch-progress", ...progress }), { format, quality, split, splitMode });
    const { width, height, bytes, count, failed, note } = result;
    // format은 실제로 만든 형식이다 (JPG를 바랐어도 폭이 너무 넓거나, 너무 긴데 나누지 않기로 했으면 png).
    // parts는 장마다의 Blob 주소다. JPG 한 장에 담기에 너무 길면 여러 장으로 나뉘어 온다
    const parts = result.parts.map((part) => ({ url: URL.createObjectURL(part.blob), height: part.height, bytes: part.blob.size }));
    send({ type: "stitch-done", parts, width, height, bytes, count, failed, format: result.format, note });
  } catch (err) {
    send({ type: "stitch-error", message: err?.message || String(err) });
  }
}
