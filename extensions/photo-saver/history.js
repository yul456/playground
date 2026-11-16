// 크롬 다운로드 목록(chrome://downloads)에 남는 기록을 줄인다.
// 사진 한 장을 받을 때마다 크롬 다운로드 목록에 기록이 하나 생긴다. 크롬은 받은 기록을 스스로 지우지 않고(취소·실패한 것만 90일 뒤에 지운다),
// 켤 때마다 기록을 모두 읽어 들인다. 여러 페이지를 받다 보면 기록이 수천·수만 개로 늘어 크롬이 무거워진다.
// 2026-11-16 사용자와 정했다: 다른 다운로드 확장 프로그램을 쓰다 크롬이 점점 느려져 다시 설치한 적이 있다고 했다. 옵션 없이 늘 한다.
// - 받는 대로: 폴더(페이지)마다 기록 하나만 남기고 나머지는 지운다 (background.js의 end)
// - 지난 기록: 전에 받아 쌓인 기록을 같은 기준으로 정리한다 (열린 탭 받기 화면의 단추. 아래 tidyPlan)
// 기록만 지운다(chrome.downloads.erase). 받은 파일은 건드리지 않는다.
// 폴더마다 하나를 남기는 까닭: 같은 이름 폴더에 받은 적이 있는지 아는 것(background.js의 freeFolder)과 "폴더 열기"가 기록을 쓴다.
// 브라우저 API를 쓰지 않는 부분(tidyPlan)은 Node에서 시험할 수 있다
import { BASE_FOLDER } from "./names.js";

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "페이지 사진" 폴더 아래에 받은 기록을 찾는 정규식 (chrome.downloads.search의 filenameRegex). 폴더 구분은 / 와 \ 둘 다 본다
export const BASE_REGEX = `[\\\\/]${escapeRegex(BASE_FOLDER)}[\\\\/]`;

const dirOf = (path) => path.replace(/[\\/][^\\/]*$/, "");
const inBase = (dir) => new RegExp(`[\\\\/]${escapeRegex(BASE_FOLDER)}$`).test(dir);

// 지난 기록 가운데 무엇을 지울지 정한다. items: chrome.downloads.search 결과, extensionId: 이 확장 프로그램의 id.
// 결과: { total: 이 확장 프로그램이 "페이지 사진"에 받은 기록 수, erase: [지울 기록의 id], keep: 남길 기록 수 }
// - 이 확장 프로그램이 받은 것만 다룬다(byExtensionId). 받는 중인 것은 건드리지 않는다
// - 페이지마다의 폴더는 파일이 남아 있는 기록 하나만 남긴다 (가장 먼저 받은 것)
// - "페이지 사진" 바로 안의 파일(이어 붙인 그림)은 파일이 남아 있으면 기록을 남긴다 (그림마다 하나라 많지 않다)
// - 받지 못한 기록과 파일이 없어진 기록은 지운다
export function tidyPlan(items, extensionId) {
  const mine = items.filter((item) => item.byExtensionId === extensionId && item.state !== "in_progress" && item.filename);
  const erase = [];
  const folders = new Map(); // 폴더 경로 → 남길 기록
  for (const item of mine) {
    if (item.state !== "complete" || item.exists === false) {
      erase.push(item.id);
      continue;
    }
    const dir = dirOf(item.filename);
    if (inBase(dir)) continue;
    const kept = folders.get(dir);
    if (!kept) folders.set(dir, item);
    else if (String(item.startTime) < String(kept.startTime)) {
      erase.push(kept.id);
      folders.set(dir, item);
    } else erase.push(item.id);
  }
  return { total: mine.length, erase, keep: mine.length - erase.length };
}

// 파일이 없어졌다는 소식(onChanged의 exists)을 기다린다. 첫 소식은 firstMs까지 기다리고(없으면 없어진 파일이 없는 것으로 본다),
// 오기 시작하면 quietMs 동안 잠잠해질 때까지 기다린다 (길어도 maxMs).
// 크롬은 이 확인을 급하지 않은 일로 돌려서 파일 3개에도 1초 가까이 걸렸다 (0.7초만 기다렸을 때는 놓쳤다)
function settleExists(firstMs = 3000, quietMs = 1000, maxMs = 15000) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(quiet);
      clearTimeout(limit);
      chrome.downloads.onChanged.removeListener(onChanged);
      resolve();
    };
    const onChanged = (delta) => {
      if (!delta.exists) return;
      clearTimeout(quiet);
      quiet = setTimeout(done, quietMs);
    };
    let quiet = setTimeout(done, firstMs);
    const limit = setTimeout(done, maxMs);
    chrome.downloads.onChanged.addListener(onChanged);
  });
}

// 지난 기록을 찾아 지울 것을 정한다.
// search()는 파일이 남아 있는지 확인을 시키기만 하고 결과에는 전에 알던 값을 준다. 그래서 한 번 불러 확인을 시키고,
// 없어졌다는 소식이 잠잠해진 뒤에 다시 읽는다. 크롬은 이 확인을 10초에 한 번만 해서(kFileExistenceRateLimitSeconds),
// 방금 지운 파일은 아직 남아 있는 것으로 보일 수 있다. 그때는 그 기록을 남길 뿐이고, 나중에 다시 누르면 지워진다
export async function findTidy() {
  const query = { filenameRegex: BASE_REGEX, limit: 0 };
  const settled = settleExists();
  await chrome.downloads.search(query);
  await settled;
  return tidyPlan(await chrome.downloads.search(query), chrome.runtime.id);
}

// 기록을 목록에서 지운다 (파일은 그대로). 한 번에 CHUNK개씩 지우고 그때마다 onProgress(지운 수)를 부른다
const CHUNK = 50;
export async function eraseRecords(ids, onProgress) {
  for (let i = 0; i < ids.length; i += CHUNK) {
    await Promise.all(ids.slice(i, i + CHUNK).map((id) => chrome.downloads.erase({ id }).catch(() => {})));
    onProgress?.(Math.min(ids.length, i + CHUNK));
  }
}
