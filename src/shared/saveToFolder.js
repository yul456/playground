// 다 만든 파일(Blob)을 사용자가 고른 폴더(FileSystemDirectoryHandle)나 저장 창에서 고른 파일(FileSystemFileHandle)에 저장한다.
// 사진 세로로 붙이기와 사진 형식 바꾸기가 쓴다.
// 화면 코드가 없어 Node에서 시험할 수 있다 (폴더·파일은 File System Access API처럼 생긴 것이면 된다).
//
// 크롬은 고른 폴더의 파일에 바로 쓰지 않는다. "이름.crswap" 임시 파일에 쓰다가 닫을 때 진짜 파일과 바꾼다.
// 그리고 write()를 부를 때마다 임시 파일을 열고, 쓰고, 닫는다. 파일을 조각마다 나눠 쓰면 조각 사이에는 임시 파일이
// 닫혀 있어서, 폴더를 지켜보는 다른 프로그램(백신, OneDrive 등)이 그때 파일을 열면 다음 조각을 쓰지 못한다.
// 윈도우 동영상 폴더에서 붙인 PNG 일부가 이렇게 실패했다(NoModificationAllowedError). 크롬은 다시 시도하지 않는다.
// 그래서 파일을 다 만든 뒤 write()를 한 번만 부른다. 쓰는 동안 임시 파일이 계속 열려 있어 끼어들 틈이 거의 없다.
// 닫을 때 임시 파일을 진짜 파일과 바꾸는 일도 같은 까닭으로 실패할 수 있어, 실패하면 잠깐 뒤 다시 저장해 본다

// 고른 폴더에 저장해 보는 횟수
export const SAVE_TRIES = 3;
// 다시 저장하기 전에 기다리는 시간(ms). 파일을 잡은 프로그램이 놓을 틈을 준다
const RETRY_WAITS = [1000, 2000];
// 다시 해도 소용없는 오류: 쓰기 권한이 없어짐, 디스크가 참, 쓸 수 없는 이름, 같은 이름의 폴더가 있음
const NO_RETRY = new Set(["NotAllowedError", "SecurityError", "QuotaExceededError", "TypeError", "TypeMismatchError"]);

// 저장하지 못한 까닭. 크롬이 내는 오류 문장은 영어이고 뜻을 알기 어려워, 오류 이름으로 골라 적는다
const REASONS = {
  NoModificationAllowedError: "다른 프로그램이 그 파일을 쓰고 있거나 보안 프로그램이 막았습니다.",
  InvalidStateError: "다 쓴 파일을 제자리에 넣지 못했습니다. 다른 프로그램이 그 파일을 열고 있거나 경로가 너무 깁니다.",
  AbortError: "브라우저나 보안 프로그램의 검사를 통과하지 못했습니다.",
  NotAllowedError: "폴더에 쓸 권한이 없습니다.",
  SecurityError: "폴더에 쓸 권한이 없습니다.",
  QuotaExceededError: "디스크에 빈 곳이 모자랍니다.",
  NotFoundError: "폴더나 파일이 없어졌습니다.",
  TypeMismatchError: "같은 이름의 폴더가 있습니다.",
};

// { text: 화면에 보일 까닭, detail: 오류 이름과 원래 문장 }
export function explainSaveError(err) {
  const name = err?.name || "Error";
  const message = err?.message || String(err ?? "");
  return { text: REASONS[name] ?? message, detail: `${name}: ${message}` };
}

// dir 폴더에 그 이름의 파일이 있는지
export async function fileExists(dir, name) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

// ms만큼 기다린다. 그 사이 멈추기를 누르면 바로 돌아온다
async function sleep(ms, stopped) {
  const until = Date.now() + ms;
  while (Date.now() < until && !stopped()) {
    await new Promise((resolve) => setTimeout(resolve, Math.min(100, until - Date.now())));
  }
}

// 한 번 저장해 본다. open()은 쓸 파일(FileSystemFileHandle)을 돌려준다.
// 다 쓰고 닫아야 진짜 파일이 바뀌므로, 실패하면 원래 있던 파일은 그대로다
async function writeOnce(open, blob, hold) {
  const handle = await open();
  const writable = await handle.createWritable();
  hold(writable);
  try {
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    // 쓰다 만 임시 파일을 버린다. 이미 오류가 난 스트림이면 할 일이 없다
    await writable.abort().catch(() => {});
    throw err;
  } finally {
    hold(null);
  }
}

// 저장하지 못했을 때, 저장하려고 만든 빈 파일을 지운다. 내용이 있으면 그대로 둔다
async function removeIfEmpty(dir, name) {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    if (file.size === 0) await dir.removeEntry(name);
  } catch {
    // 파일이 없거나 지우지 못하면 그대로 둔다
  }
}

// 저장 창에서 고른 파일이 비어 있으면 지운다. 저장 창은 새 이름을 고르면 빈 파일을 먼저 만들어 둔다.
// 파일을 스스로 지우는 remove()는 크롬 110부터 있다. 내용이 있으면 그대로 둔다
export async function removeEmptyFile(handle) {
  try {
    if ((await handle.getFile()).size === 0) await handle.remove?.();
  } catch {
    // 지우지 못하면 그대로 둔다
  }
}

// 저장해 보고, 실패하면 SAVE_TRIES번까지 다시 해 본다. 결과: { ok: true, tries } · { ok: false, error, tries }
async function saveWithRetries(open, blob, { stopped, onTry, hold, wait }) {
  let error;
  let tries = 0;
  while (tries < SAVE_TRIES && !stopped()) {
    if (tries > 0) {
      await wait(RETRY_WAITS[Math.min(tries, RETRY_WAITS.length) - 1], stopped);
      if (stopped()) break;
    }
    tries++;
    onTry(tries);
    try {
      await writeOnce(open, blob, hold);
      return { ok: true, tries };
    } catch (err) {
      error = err;
      if (NO_RETRY.has(err?.name)) break;
    }
  }
  return { ok: false, error, tries };
}

const withDefaults = ({ stopped = () => false, onTry = () => {}, hold = () => {}, wait = sleep } = {}) => ({ stopped, onTry, hold, wait });

// dir 폴더에 name이라는 이름으로 blob을 저장한다. 실패하면 SAVE_TRIES번까지 다시 해 본다.
// options:
//   stopped()      멈추기를 눌렀는지
//   onTry(n)       n번째 시도를 시작할 때 부른다 (1부터)
//   hold(writable) 쓰는 중인 스트림을 알려 준다. 멈출 때 abort하라는 것이고, 다 쓰면 null을 넘긴다
//   wait(ms, stopped) 다시 하기 전에 기다리는 함수 (시험에서 바꾼다)
// 결과: { ok: true, tries } · { ok: false, cancelled: true } · { ok: false, error, tries }
export async function saveToFolder(dir, name, blob, options = {}) {
  const settings = withDefaults(options);
  // 원래 있던 파일이면 실패해도 지우지 않는다
  const existed = await fileExists(dir, name);
  const result = await saveWithRetries(() => dir.getFileHandle(name, { create: true }), blob, settings);
  if (result.ok) return result;
  if (!existed) await removeIfEmpty(dir, name);
  return settings.stopped() ? { ok: false, cancelled: true } : result;
}

// 저장 창(showSaveFilePicker)에서 고른 파일 하나에 blob을 저장한다. options와 결과는 saveToFolder와 같다.
// 끝내 저장하지 못했는데 그 파일이 비어 있으면(저장 창이 만들어 둔 것) 지운다
export async function saveToFile(handle, blob, options = {}) {
  const settings = withDefaults(options);
  const result = await saveWithRetries(async () => handle, blob, settings);
  if (result.ok) return result;
  await removeEmptyFile(handle);
  return settings.stopped() ? { ok: false, cancelled: true } : result;
}
