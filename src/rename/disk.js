// 고친 것을 실제 파일에 적는다: 이름 바꾸기(FileSystemFileHandle.move)와 MP3 태그 저장.
// 화면 코드는 없지만 File System Access API를 쓰므로 브라우저에서 돈다 (시험은 e2e.mjs가 OPFS 폴더로, real-folder.mjs가 진짜 폴더로 한다).
//
// 이름은 move(그 파일이 든 폴더, 새 이름)으로 바꾼다. 새 이름만 넘기는 move(새 이름)은 고른 폴더 바로 안의 파일에서는 되지만
// 그 안의 폴더(하위 폴더)에 든 파일에서는 크롬이 거부한다(NotAllowedError. 크롬 157, 진짜 폴더에서 확인. OPFS에서는 둘 다 된다).
// 폴더를 함께 넘기면 그 폴더 핸들의 쓰기 권한으로 판단해서 하위 폴더에서도 된다.
import { explainSaveError, saveToFile } from "../shared/saveToFolder.js";
import { parseId3v1 } from "./id3.js";
import { nameKey, planRenames } from "./names.js";
import { readMp3, readTags, rewriteMp3 } from "./tags.js";

// 이 브라우저가 고른 폴더의 파일 이름을 바꿀 수 있는지 (크롬·엣지)
export const canRename = () => typeof globalThis.FileSystemFileHandle?.prototype?.move === "function";

// 이름을 바꾸지 못한 까닭. 크롬이 내는 문장은 영어이고 뜻을 알기 어려워 오류 이름으로 골라 적는다
const RENAME_REASONS = {
  TypeError: "브라우저가 받지 않는 이름입니다.",
  InvalidModificationError: "같은 이름의 파일이 이미 있습니다.",
  TypeMismatchError: "같은 이름의 폴더가 있습니다.",
  NoModificationAllowedError: "다른 프로그램이 그 파일을 쓰고 있습니다.",
  InvalidStateError: "다른 프로그램이 그 파일을 쓰고 있습니다.",
  NotAllowedError: "폴더에 쓸 권한이 없습니다.",
  SecurityError: "폴더에 쓸 권한이 없습니다.",
  NotFoundError: "파일이 없어졌습니다.",
  AbortError: "브라우저나 보안 프로그램의 검사를 통과하지 못했습니다.",
};
const explainRename = (error) => ({
  text: RENAME_REASONS[error?.name] ?? error?.message ?? String(error),
  detail: `${error?.name ?? "Error"}: ${error?.message ?? ""}`,
});

// 그 이름을 다른 파일이 쓰고 있으면 오류를 낸다. 폴더에 쓸 권한이 있으면 move()가 같은 이름의 파일을 말없이 덮어쓰기 때문에,
// 폴더를 읽은 뒤에 생긴 파일까지 바꾸기 직전에 한 번 더 본다
async function assertFree(dir, name, current) {
  // 대소문자만 바꾸는 것이면 윈도우·맥에서는 그 이름으로 자기 자신이 나온다
  if (nameKey(name) === nameKey(current)) return;
  try {
    await dir.getFileHandle(name);
  } catch (error) {
    if (error.name === "NotFoundError") return;
    throw error;
  }
  throw new DOMException("이미 있는 이름", "InvalidModificationError");
}

// 한 폴더의 파일 이름을 바꾼다.
//   files:  그 폴더의 모든 파일 [{ id, handle, from: 지금 이름, to: 바꿀 이름 }] (안 바꾸는 파일은 to가 from과 같다)
//   others: 그 폴더의 다른 이름들 (하위 폴더, 숨김 파일)
//   options: { stopped(): 멈추기를 눌렀는지, onDone(): 파일 하나를 바꿀 때마다 }
// 결과: Map(id → { ok: true, name } · { ok: false, text, detail, name }). name은 지금 디스크의 이름이다.
// 멈춰서 손대지 못한 파일은 결과에 없다
export async function renameFiles(dir, files, others, { stopped = () => false, onDone = () => {} } = {}) {
  const { problems, steps } = planRenames(files, others);
  const byId = new Map(files.map((file) => [file.id, file]));
  const now = new Map(files.map((file) => [file.id, file.from]));
  const results = new Map();
  for (const [id, text] of problems) results.set(id, { ok: false, text, detail: "", name: byId.get(id).from });
  for (const step of steps) {
    if (stopped()) break;
    // 앞 단계에서 실패한 파일은 더 건드리지 않는다
    if (results.get(step.id)?.ok === false) continue;
    const file = byId.get(step.id);
    try {
      await assertFree(dir, step.name, now.get(step.id));
      await file.handle.move(dir, step.name);
      now.set(step.id, step.name);
      if (!step.temp) {
        results.set(step.id, { ok: true, name: step.name });
        onDone();
      }
    } catch (error) {
      results.set(step.id, { ok: false, ...explainRename(error), name: now.get(step.id) });
    }
  }
  // 임시 이름에 남은 파일(맞물린 이름을 풀다가 실패했거나 멈춘 것)은 원래 이름으로 돌려놓는다
  for (const file of files) {
    const name = now.get(file.id);
    if (name === file.from || name === file.to) continue;
    try {
      await assertFree(dir, file.from, name);
      await file.handle.move(dir, file.from);
      now.set(file.id, file.from);
      const failed = results.get(file.id);
      results.set(file.id, { ok: false, text: failed?.text ?? "멈췄습니다.", detail: failed?.detail ?? "", name: file.from });
    } catch (error) {
      results.set(file.id, { ok: false, text: `이름을 바꾸다 멈춰 지금 이름이 ${name}입니다. ${explainRename(error).text}`, detail: "", name });
    }
  }
  return results;
}

// MP3 파일의 태그를 화면에 보일 모양으로 읽는다.
// 결과: { state: "ready", version, values, repaired, picture, pictures, file, size, modified } · { state: "unreadable", … }
//   file은 그때의 파일(그림을 보일 때 그 자리를 가리킨다), size·modified는 저장하기 전에 파일이 그대로인지 보는 데 쓴다
export async function loadTags(handle) {
  const file = await handle.getFile();
  const source = await readMp3(file);
  const stamp = { file, size: file.size, modified: file.lastModified };
  if (source.unreadable) return { state: "unreadable", ...stamp };
  return { state: "ready", ...readTags(source.parsed, source.tail && parseId3v1(source.tail)), ...stamp };
}

// 고친 칸(edits, tags.js applyTagEdits 참고)을 그 파일에 저장하고, 저장한 파일의 태그를 다시 읽어 돌려준다.
// 소리 데이터는 그대로 옮긴다. 크롬은 임시 파일에 다 쓴 뒤 닫을 때 진짜 파일과 바꾸므로, 실패하면 원래 파일이 그대로 남는다.
// 결과: { ok: true, tags } · { ok: false, cancelled: true } · { ok: false, text, detail }
export async function saveTags(handle, known, edits, options = {}) {
  try {
    const file = await handle.getFile();
    if (file.size !== known.size || file.lastModified !== known.modified) {
      return { ok: false, text: "읽은 뒤에 파일이 바뀌었습니다. 폴더를 다시 읽어 주세요.", detail: "" };
    }
    const blob = await rewriteMp3(file, edits);
    const saved = await saveToFile(handle, blob, { ...options, existing: true });
    if (saved.cancelled) return { ok: false, cancelled: true };
    if (!saved.ok) return { ok: false, ...explainSaveError(saved.error) };
    return { ok: true, tags: await loadTags(handle) };
  } catch (error) {
    return { ok: false, text: error?.message ?? String(error), detail: `${error?.name ?? "Error"}: ${error?.message ?? ""}` };
  }
}
