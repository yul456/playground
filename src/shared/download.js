// 만든 파일(Blob)을 브라우저의 다운로드 폴더로 받게 한다.

// 다운로드한 파일 주소(blob URL)를 풀 때까지의 시간. "여러 파일 다운로드" 허용 창을 늦게 눌러도 받을 수 있게 넉넉히 둔다
const URL_MS = 5 * 60_000;

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), URL_MS);
}
