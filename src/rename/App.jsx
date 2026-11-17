import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { number } from "../shared/format.js";
import { HUB_URL } from "../shared/site.js";
import Batch, { NAME_KEY, NUMBER_KEY } from "./Batch.jsx";
import { googleUrl, readPick, REGIONS, releaseTags, searchUrl, sourceName, tell } from "./covers.js";
import { canRename, loadTags, renameFiles, saveTags } from "./disk.js";
import { kindOf, scanFolder } from "./folder.js";
import { TAG_FORMAT_NAMES, tagFormat } from "./formats.js";
import { fillPattern, nameProblem, padNumber, patternKeys, planRenames, replaceText, safePart, splitName, tidyBase, trackNumber } from "./names.js";
import { fetchPicture, isCopiedBitmap, PICTURE_SIZES, preparePicture } from "./picture.js";
import { draggingFiles, FileRow, pictureInfo } from "./Rows.jsx";
import { TAG_FIELDS } from "./tags.js";

// localStorage 키는 기능 이름을 앞에 붙여 다른 기능과 겹치지 않게 한다
const STORAGE_KEY = "playground.rename.v1";
// 한 번에 그리는 줄 수. 더 보기를 누르면 이만큼씩 더 그린다 (고치기와 저장은 그리지 않은 줄에도 적용된다)
const PAGE = 300;
// 태그를 한꺼번에 읽는 파일 수
const READERS = 4;
// 이 크기를 넘는 그림을 넣으면 파일마다 그만큼 커진다고 알린다
const BIG_PICTURE = 1_000_000;

// 설정: { subfolders: 고른 폴더 안의 폴더(하위 폴더)까지 읽을지, showTags: 오디오 태그 칸을 보일지,
//   start·digits: 틀의 {번호}가 시작하는 수와 자릿수,
//   artMax: 넣을 그림의 긴 변이 이보다 크면 줄인다(px, 0이면 그대로. picture.js PICTURE_SIZES),
//   coverRegion: 앨범 아트를 찾을 곳(covers.js REGIONS의 key: kr 한국 · jp 일본),
//   coverFill: 찾은 그림을 고르면 넣을 것(picture 그림만 · all 그림과 그 음반의 앨범·아티스트·연도) }
const COVER_FILLS = ["picture", "all"];
function loadSettings() {
  const settings = { subfolders: true, showTags: true, start: 1, digits: 2, artMax: 0, coverRegion: REGIONS[0].key, coverFill: COVER_FILLS[0] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (typeof saved?.subfolders === "boolean") settings.subfolders = saved.subfolders;
    if (typeof saved?.showTags === "boolean") settings.showTags = saved.showTags;
    if (Number.isInteger(saved?.start) && saved.start >= 0) settings.start = saved.start;
    if (Number.isInteger(saved?.digits) && saved.digits >= 1 && saved.digits <= 6) settings.digits = saved.digits;
    if (PICTURE_SIZES.includes(saved?.artMax)) settings.artMax = saved.artMax;
    if (REGIONS.some((region) => region.key === saved?.coverRegion)) settings.coverRegion = saved.coverRegion;
    if (COVER_FILLS.includes(saved?.coverFill)) settings.coverFill = saved.coverFill;
  } catch {
    // 저장소를 못 쓰는 환경(사생활 보호 모드 등)이면 기본값으로 시작한다
  }
  return settings;
}

// 크롬·엣지만 고른 폴더의 파일을 고칠 수 있다 (File System Access API)
const canPickFolder = () => typeof window.showDirectoryPicker === "function";

// ---- 줄(row) 하나를 고친 새 줄을 만드는 함수들. 고친 것은 edit에 모아 두고 저장할 때 파일에 적는다 ----
// 줄: { id, folder: 폴더 번호, handle, name: 지금 이름, base, ext, kind: "audio"·"file",
//       format: 태그를 고칠 수 있는 형식(formats.js tagFormat: mp3 · flac · m4a · wav, 아니면 null), checked,
//       tags: 그 형식의 태그(disk.js loadTags, 읽는 중이면 { state: "loading" }, format이 없으면 null),
//       edit: { base, tags: { 칸: 글 }, picture }, result }
const baseOf = (row) => row.edit.base ?? row.base;
const tagOf = (row, key) => row.edit.tags?.[key] ?? row.tags.values[key];
const isReady = (row) => row.tags?.state === "ready";
const nameEdited = (row) => row.edit.base !== undefined;
const tagsEdited = (row) => Boolean(row.edit.tags) || row.edit.picture !== undefined;

function withBase(row, value) {
  if (value === baseOf(row)) return row;
  const edit = { ...row.edit };
  if (value === row.base) delete edit.base;
  else edit.base = value;
  return { ...row, edit, result: null };
}

// force: 지금 보이는 글과 같아도 저장할 것으로 친다 (깨진 한글을 바로잡아 보여 주던 칸을 바로잡은 대로 저장할 때)
function withTag(row, key, value, force = false) {
  if (!isReady(row)) return row;
  const same = value === row.tags.values[key] && !force;
  if (same ? row.edit.tags?.[key] === undefined : row.edit.tags?.[key] === value) return row;
  const tags = { ...row.edit.tags };
  if (same) delete tags[key];
  else tags[key] = value;
  const edit = { ...row.edit };
  if (Object.keys(tags).length) edit.tags = tags;
  else delete edit.tags;
  return { ...row, edit, result: null };
}

// picture: undefined 그대로 둠 · null 지움 · { mime, data, … } 넣음
function withPicture(row, picture) {
  if (!isReady(row)) return row;
  const next = picture === null && !row.tags.pictures ? undefined : picture;
  if (next === row.edit.picture) return row;
  const edit = { ...row.edit };
  if (next === undefined) delete edit.picture;
  else edit.picture = next;
  return { ...row, edit, result: null };
}

// 이름을 바꿀 수 없는 줄과 그 까닭: 쓸 수 없는 이름, 같은 폴더의 다른 이름과 겹침
function findIssues(rows, folders) {
  const issues = new Map();
  const byFolder = new Map();
  for (const row of rows) {
    if (!byFolder.has(row.folder)) byFolder.set(row.folder, []);
    byFolder.get(row.folder).push(row);
  }
  for (const [folder, list] of byFolder) {
    if (!list.some(nameEdited)) continue;
    const files = list.map((row) => {
      let to = row.name;
      if (nameEdited(row)) {
        const problem = nameProblem(row.edit.base, row.ext);
        if (problem) issues.set(row.id, problem);
        else to = row.edit.base + row.ext;
      }
      return { id: row.id, from: row.name, to };
    });
    for (const [id, text] of planRenames(files, folders[folder].others).problems) issues.set(id, text);
  }
  return issues;
}

// 틀의 {칸}에 넣을 값들. 파일 이름을 만들 때는 태그 값에서 이름에 못 쓰는 글자를 바꾼다
function patternValues(row, n, digits, forName) {
  const part = forName ? safePart : (text) => text;
  const values = { [NAME_KEY]: baseOf(row), [NUMBER_KEY]: padNumber(n, digits) };
  for (const field of TAG_FIELDS) {
    const text = isReady(row) ? tagOf(row, field.key) : "";
    values[field.label] = part(field.key === "track" ? trackNumber(text) : text);
  }
  return values;
}
const TAG_LABELS = new Set(TAG_FIELDS.map((field) => field.label));

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  // 고른 폴더: { name, dir, folders: [{ path, dir, others }] } (folder.js scanFolder)
  const [source, setSource] = useState(null);
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState("idle"); // idle · scanning · ready · saving
  const [view, setView] = useState("all"); // all · audio
  const [limit, setLimit] = useState(PAGE);
  const [notice, setNotice] = useState("");
  const [batchNote, setBatchNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  // 저장하는 동안: { done, total, text }
  const [progress, setProgress] = useState(null);
  // 저장한 뒤의 한 줄 요약
  const [summary, setSummary] = useState("");
  // 방금 저장하기 전의 값 { names: Map(id → 바탕 이름), tags: Map(id → { 칸: 글 }) }. 되돌리기에 쓴다
  const [lastSave, setLastSave] = useState(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  // 앨범 아트를 찾는 중(covers.js): { child: 검색 창(구글은 그 창을 잡고 있을 수 없어 null), ids: 그림을 넣을 줄들, label: 그 줄들을 가리키는 말 }
  const searchRef = useRef(null);
  // 찾는 동안 화면에 알릴 말 { label, paste: 그림을 붙여 넣기를 기다리는 중인지(구글) }
  const [searching, setSearching] = useState(null);
  const stopRef = useRef(false);
  const savingRef = useRef(null);
  // 태그 읽기를 그만두게 하는 번호 (폴더를 새로 읽으면 올린다)
  const readRun = useRef(0);
  // 넣을 그림을 미리 보려고 만든 주소들. 폴더를 새로 읽을 때 푼다
  const pictureUrls = useRef(new Set());
  const allRef = useRef(null);
  const saving = status === "saving";
  const busy = saving || status === "scanning";
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // 저장 실패는 무시한다. 화면에서는 계속 쓸 수 있다
    }
  }, [settings]);

  const visible = useMemo(() => (view === "audio" ? rows.filter((row) => row.kind !== "file") : rows), [rows, view]);
  const issues = useMemo(() => (source ? findIssues(rows, source.folders) : new Map()), [rows, source]);
  const counts = useMemo(() => {
    const out = { names: 0, tags: 0, pictures: 0, repaired: 0, tagged: 0, audio: 0, reading: 0 };
    for (const row of rows) {
      if (nameEdited(row)) out.names++;
      if (tagsEdited(row)) out.tags++;
      if (row.edit.picture !== undefined) out.pictures++;
      if (row.format) out.tagged++;
      if (row.kind !== "file") out.audio++;
      if (row.tags?.state === "loading") out.reading++;
      if (isReady(row) && row.tags.repaired.some((key) => row.edit.tags?.[key] === undefined)) out.repaired++;
    }
    return out;
  }, [rows]);
  const pending = counts.names + counts.tags;
  const hasTags = counts.tagged > 0;
  const showTags = settings.showTags && visible.some((row) => row.format);
  const checked = useMemo(() => visible.filter((row) => row.checked), [visible]);
  const tagChecked = useMemo(() => checked.filter(isReady).length, [checked]);
  // 한꺼번에 앨범 아트를 찾을 때 미리 채워 둘 검색어: 체크한 파일 가운데 태그를 읽은 첫 파일의 태그
  const firstTagged = checked.find(isReady);
  const suggestArtist = firstTagged ? tagOf(firstTagged, "artist") || tagOf(firstTagged, "albumArtist") : "";
  const suggestAlbum = firstTagged ? tagOf(firstTagged, "album") || tagOf(firstTagged, "title") : "";

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = checked.length > 0 && checked.length < visible.length;
  }, [checked.length, visible.length]);

  // 고친 것이 남아 있거나 저장하는 중에 탭을 닫으려 하면 브라우저가 한 번 묻게 한다
  useEffect(() => {
    if (!pending && !saving) return undefined;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending, saving]);

  // 그림 파일을 칸 밖에 떨어뜨려도 브라우저가 그 그림을 열어 이 화면을 떠나지 않게 한다
  useEffect(() => {
    const guard = (event) => {
      if (draggingFiles(event)) event.preventDefault();
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  const updateRow = useCallback((id, change) => setRows((list) => list.map((row) => (row.id === id ? change(row) : row))), []);

  // 줄마다 change를 적용하고 바뀐 줄 수를 돌려준다. change는 같은 줄에 여러 번 불려도 같은 결과를 내야 한다
  function changeRows(change) {
    const count = rowsRef.current.reduce((sum, row) => sum + (change(row) !== row ? 1 : 0), 0);
    if (count) setRows((list) => list.map(change));
    return count;
  }

  // 그림 파일을 읽어 앨범 아트로 넣을 준비를 한다. 실패하면 알리고 null
  async function readPicture(file, options) {
    try {
      const picture = await preparePicture(file, settingsRef.current.artMax, options);
      pictureUrls.current.add(picture.url);
      return picture;
    } catch (error) {
      setNotice(error.message);
      return null;
    }
  }
  const pictureNote = (picture) =>
    `${picture.name} (${pictureInfo(picture)})${picture.from ? ` · ${picture.from.width}×${picture.from.height}에서 줄였습니다` : picture.converted ? " · JPG로 바꿔 넣습니다" : ""}${
      picture.size > BIG_PICTURE ? " · 그림이 커서 파일마다 그만큼 커집니다" : ""
    }`;

  // ---- 앨범 아트 찾기: 검색 사이트를 새 창으로 열고, 사용자가 거기서 고른 그림을 받는다 (covers.js) ----
  function stopSearch() {
    const search = searchRef.current;
    if (!search) return;
    searchRef.current = null;
    setSearching(null);
    if (!search.child) return;
    tell(search.child, { type: "close" });
    try {
      search.child.close();
    } catch {
      // 이미 닫힌 창이다
    }
  }

  // 검색 창 위쪽에 보일 안내 글. 고르면 무엇을 넣는지(설정의 coverFill)를 함께 알린다
  const searchText = (label) =>
    `그림을 누르면 ${settingsRef.current.coverFill === "all" ? "그 그림과 음반 정보(앨범·아티스트·연도)를 " : ""}${label}에 넣고 이 창을 닫습니다. Shift를 누른 채 누르면 창을 닫지 않습니다.`;

  // 검색 창을 연다. 버튼을 누른 그 자리에서 불러야 브라우저가 새 창을 막지 않는다
  function openSearch(ids, artist, album, label) {
    setNotice("");
    if (searchRef.current && !searchRef.current.child) stopSearch();
    const dark = Boolean(window.matchMedia?.("(prefers-color-scheme: dark)").matches);
    const child = window.open(searchUrl({ artist, album, text: searchText(label), dark, region: settingsRef.current.coverRegion }), "playground-rename-covers", "popup,width=1240,height=860");
    if (!child) {
      setNotice("검색 창을 열지 못했습니다. 브라우저가 새 창을 막았으면 주소창 오른쪽에서 허용해 주세요.");
      return;
    }
    // artist: 찾을 때 넣은 아티스트. 그 사이트가 준 이름을 고칠 때 견줘 본다 (covers.js releaseTags)
    searchRef.current = { child, ids, label, artist };
    setSearching({ label });
  }

  // 고르면 넣을 것을 바꾼다. 검색 창이 열려 있으면 그 창의 안내 글도 맞춘다
  function changeCoverFill(coverFill) {
    settingsRef.current = { ...settingsRef.current, coverFill };
    setSettings((current) => ({ ...current, coverFill }));
    const search = searchRef.current;
    if (search?.child) tell(search.child, { type: "text", text: searchText(search.label) });
  }

  // 구글 이미지 검색을 새 탭으로 열고, 사용자가 거기서 복사한 그림을 붙여 넣기를 기다린다.
  // 구글 페이지는 자기를 연 페이지와의 연결을 끊어서 그 탭을 닫아 줄 수 없다. 사용자가 닫고 돌아와 붙여 넣는다
  function openGoogle(ids, artist, album, label) {
    setNotice("");
    stopSearch();
    window.open(googleUrl({ artist, album }), "_blank", "noopener,noreferrer");
    searchRef.current = { child: null, ids, label };
    setSearching({ label, paste: true });
  }

  // 검색 창에서 그림을 골랐다는 소식이 오면 그 그림을 받아 줄들에 넣는다
  const pickRef = useRef(null);
  pickRef.current = async (event) => {
    const search = searchRef.current;
    const pick = readPick(event, search?.child);
    if (!pick) return;
    const waiting = searchText(search.label);
    if (busyRef.current) {
      tell(search.child, { type: "error", text: "지금은 저장하는 중이라 그림을 넣을 수 없습니다. 저장이 끝난 뒤 다시 눌러 주세요." });
      return;
    }
    tell(search.child, { type: "error", text: null });
    tell(search.child, { type: "text", text: "그림을 받는 중입니다…" });
    let picture;
    try {
      picture = await fetchPicture(pick.url, settingsRef.current.artMax);
    } catch (error) {
      // 받기 자체가 막히면(TypeError) 그 그림 서버가 다른 사이트에서 읽는 것을 허락하지 않는 것이다 (벅스 등)
      const text =
        error instanceof TypeError
          ? `${sourceName(pick.source)}의 그림은 브라우저가 바로 받아 오지 못합니다. 그 그림을 저장한 뒤 표의 그림 칸에 끌어다 놓으세요.`
          : `그림을 받지 못했습니다. ${error.message}`;
      tell(search.child, { type: "error", text });
      tell(search.child, { type: "text", text: waiting });
      setNotice(text);
      return;
    }
    pictureUrls.current.add(picture.url);
    // 설정에 따라 그 음반의 정보(앨범·아티스트·연도)도 태그에 넣는다. 있던 값은 바뀐다
    const fill = settingsRef.current.coverFill === "all" ? releaseTags(pick.release, pick.source, search.artist) : {};
    const count = changeRows((row) => {
      if (!search.ids.has(row.id)) return row;
      let next = withPicture(row, picture);
      for (const [key, value] of Object.entries(fill)) next = withTag(next, key, value);
      return next;
    });
    const filled = [fill.album && `앨범 "${fill.album}"`, fill.artist ? `아티스트 "${fill.artist}"` : fill.albumArtist && `앨범 아티스트 "${fill.albumArtist}"`, fill.year && `연도 "${fill.year}"`].filter(Boolean);
    let also = "";
    if (settingsRef.current.coverFill === "all") also = filled.length ? ` 태그도 넣었습니다(${filled.join(" · ")}).` : " 그 그림에는 음반 정보가 없어 태그는 그대로입니다.";
    setNotice("");
    setBatchNote(`${sourceName(pick.source)}에서 찾은 그림을 ${number(count)}개 파일에 넣었습니다: ${pictureNote(picture)}.${also} 저장을 눌러야 파일에 적힙니다.`);
    if (pick.keepOpen) tell(search.child, { type: "text", text: `${search.label}에 넣었습니다. 다른 그림을 누르면 바꿉니다.` });
    else if (searchRef.current === search) stopSearch();
  };
  useEffect(() => {
    const onMessage = (event) => pickRef.current(event);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      // 이 화면을 떠나면 검색 창도 닫는다
      const search = searchRef.current;
      searchRef.current = null;
      try {
        search?.child?.close();
      } catch {
        // 이미 닫힌 창이다
      }
    };
  }, []);
  // 사용자가 검색 창을 직접 닫았는지 본다
  useEffect(() => {
    if (!searching) return undefined;
    const timer = setInterval(() => {
      if (searchRef.current?.child?.closed) {
        searchRef.current = null;
        setSearching(null);
      }
    }, 700);
    return () => clearInterval(timer);
  }, [searching]);

  // ---- 붙여넣기: 복사한 그림을 앨범 아트로 넣는다 ----
  // 다른 사이트에서 그림을 오른쪽 클릭해 "이미지 복사"한 것이나 탐색기에서 복사한 그림 파일을 받는다. 길은 둘이다.
  //   단축키(Ctrl+V): 넣을 곳을 차례로 정한다. 앨범 아트를 찾는 중이면 그 줄들 → 마우스가 올라가 있는 그림 칸의 줄 →
  //     마우스가 올라가 있는 "앨범 아트" 칸이면 체크한 줄들 → 글을 치던 줄. 어디에도 해당하지 않으면 넣지 않고 알린다
  //   "붙여넣기" 버튼: 그 버튼이 가리키는 줄(들)에 넣는다. 찾는 중인 곡이 따로 있어도 누른 줄에 들어간다.
  //     찾다가 다른 곡의 그림을 발견했을 때 쓴다 (사용자 요청, 2026-11-17)

  // 복사한 그림(file)을 줄들(ids)에 넣는다. 찾던 줄에 넣었으면 찾기를 끝내고, 다른 줄에만 넣었으면 찾기는 그대로 둔다
  async function placeCopied(file, ids) {
    const ready = rowsRef.current.filter((row) => ids.has(row.id) && isReady(row));
    if (!ready.length) {
      setNotice("그 파일에는 앨범 아트를 넣을 수 없습니다.");
      return;
    }
    setNotice("");
    // 화면의 그림을 복사한 것은 이름이 없다. 그런 그림은 JPG가 더 작으면 JPG로 넣는다
    const copied = isCopiedBitmap(file);
    const picture = await readPicture(copied ? new File([file], "복사한 그림", { type: file.type }) : file, { compact: copied });
    if (!picture) return;
    changeRows((row) => (ids.has(row.id) ? withPicture(row, picture) : row));
    const where = ready.length === 1 ? `"${ready[0].name}"에` : `${number(ready.length)}개 파일에`;
    setBatchNote(`붙여 넣은 그림을 ${where} 넣었습니다: ${pictureNote(picture)}. 저장을 눌러야 파일에 적힙니다.`);
    const search = searchRef.current;
    if (search && ready.some((row) => search.ids.has(row.id))) stopSearch();
  }

  const pasteRef = useRef(null);
  pasteRef.current = async (event) => {
    const file = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
    if (!file || !rowsRef.current.length) return;
    // 글을 치는 칸에 글을 붙여 넣는 것이면 그대로 둔다. 엑셀·워드에서 복사한 글에는 그 모양을 찍은 그림도 함께 들어 있다
    if (event.target?.closest?.("input, textarea, select") && event.clipboardData.getData("text/plain")) return;
    event.preventDefault();
    if (busyRef.current) {
      setNotice("저장하는 중에는 그림을 넣을 수 없습니다. 저장이 끝난 뒤 다시 붙여 넣어 주세요.");
      return;
    }
    let ids = searchRef.current?.ids ?? null;
    if (!ids) {
      const under = [...document.querySelectorAll(":hover")].at(-1) ?? null;
      const rowOf = (element) => {
        const id = Number(element?.closest?.("tr[data-row]")?.dataset.row ?? NaN);
        return Number.isNaN(id) ? null : new Set([id]);
      };
      if (under?.closest(".rn-art-cell")) ids = rowOf(under);
      else if (under?.closest(".rn-drop")) ids = targetIds();
      else ids = rowOf(document.activeElement);
    }
    if (!ids) {
      setNotice('복사한 그림을 넣을 곡을 알 수 없습니다. 그 곡의 "붙여넣기"를 누르거나, 그림 칸에 마우스를 올리고 다시 붙여 넣으세요.');
      return;
    }
    await placeCopied(file, ids);
  };
  useEffect(() => {
    const onPaste = (event) => pasteRef.current(event);
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // "붙여넣기" 버튼: 클립보드의 그림을 읽어(브라우저가 처음 한 번 허락을 묻는다) 줄들(ids)에 넣는다.
  // 화면의 그림을 복사한 것만 읽힌다. 탐색기에서 복사한 그림 파일은 이 길로는 보이지 않아 단축키로 붙여 넣어야 한다
  async function pasteInto(ids) {
    setNotice("");
    let blob = null;
    try {
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.includes("image/png") ? "image/png" : item.types.find((name) => name.startsWith("image/"));
        if (!type) continue;
        blob = await item.getType(type);
        break;
      }
    } catch (error) {
      setNotice(
        error?.name === "NotAllowedError"
          ? "브라우저가 클립보드를 보는 것을 허용하지 않았습니다. 주소창 왼쪽의 사이트 설정에서 클립보드를 허용하거나, 그림 칸에 마우스를 올리고 Ctrl+V로 붙여 넣으세요."
          : `클립보드를 읽지 못했습니다. ${error?.message ?? ""}`,
      );
      return;
    }
    if (!blob) {
      setNotice('클립보드에 그림이 없습니다. 그림을 오른쪽 클릭해 "이미지 복사"를 먼저 누르세요. 그림 파일을 복사한 것이면 그림 칸에 마우스를 올리고 Ctrl+V로 붙여 넣으세요.');
      return;
    }
    // 화면의 그림을 복사한 것으로 다룬다 (isCopiedBitmap)
    await placeCopied(new File([blob], blob.type === "image/png" ? "image.png" : "복사한 그림", { type: blob.type }), ids);
  }
  const canPaste = typeof navigator.clipboard?.read === "function";

  // 줄이 쓰는 함수들. 늘 같은 객체여야 바뀐 줄만 다시 그린다
  const actionsRef = useRef(null);
  actionsRef.current ??= {
    toggle: (id) => updateRow(id, (row) => ({ ...row, checked: !row.checked })),
    // removed: 치다가 걸러 낸 글자(Rows.jsx typedName). 그 줄에 잠깐 알린다
    setBase: (id, value, removed = "") =>
      updateRow(id, (row) => {
        const next = withBase(row, value);
        const hint = removed ? `이름에 쓸 수 없는 글자(${removed})는 넣지 않았습니다` : "";
        return (next.hint ?? "") === hint ? next : { ...next, hint };
      }),
    setTag: (id, key, value) => updateRow(id, (row) => withTag(row, key, value)),
    setPicture: (id, picture) => updateRow(id, (row) => withPicture(row, picture)),
    dropPicture: (id, file) => actionsRef.current.onDropPicture(id, file),
    findPicture: (id) => actionsRef.current.onFindPicture(id, false),
    googlePicture: (id) => actionsRef.current.onFindPicture(id, true),
    pastePicture: (id) => actionsRef.current.onPastePicture(id),
    // 이 브라우저가 버튼으로 클립보드의 그림을 읽을 수 있는지
    canPaste,
  };
  actionsRef.current.onPastePicture = (id) => pasteInto(new Set([id]));
  // 그 줄의 태그로 앨범 아트를 찾는다. 앨범이 비어 있으면 제목으로, 태그가 하나도 없으면 파일 이름으로 찾는다.
  // google이면 구글 이미지 검색에서, 아니면 MH Covers에서 찾는다
  actionsRef.current.onFindPicture = (id, google) => {
    const row = rowsRef.current.find((item) => item.id === id);
    if (!row || !isReady(row)) return;
    const artist = (tagOf(row, "artist") || tagOf(row, "albumArtist")).trim();
    const album = (tagOf(row, "album") || tagOf(row, "title")).trim() || (artist ? "" : baseOf(row));
    (google ? openGoogle : openSearch)(new Set([id]), artist, album, `"${row.name}"`);
  };
  actionsRef.current.onDropPicture = async (id, file) => {
    setNotice("");
    const picture = await readPicture(file);
    if (!picture) return;
    updateRow(id, (row) => withPicture(row, picture));
    setBatchNote(`넣을 그림: ${pictureNote(picture)}`);
  };
  const actions = actionsRef.current;

  // 태그를 고칠 수 있는 파일의 태그를 몇 개씩 읽어 줄에 채운다. 읽은 것은 조금씩 모아 한 번에 화면에 넣는다
  function readAllTags(list) {
    const run = ++readRun.current;
    const queue = list.filter((row) => row.format);
    const ready = new Map();
    let timer = null;
    const flush = () => {
      timer = null;
      if (run !== readRun.current || !ready.size) return;
      const batch = new Map(ready);
      ready.clear();
      setRows((current) => current.map((row) => (batch.has(row.id) && row.tags?.state === "loading" ? { ...row, tags: batch.get(row.id) } : row)));
    };
    let next = 0;
    const worker = async () => {
      while (next < queue.length && run === readRun.current) {
        const row = queue[next++];
        let tags;
        try {
          tags = await loadTags(row.handle, row.format);
        } catch (error) {
          tags = { state: "error", message: error?.message ?? String(error) };
        }
        ready.set(row.id, tags);
        timer ??= setTimeout(flush, 150);
      }
    };
    for (let i = 0; i < READERS; i++) worker();
  }

  async function openFolder(dir, deep = settings.subfolders) {
    setStatus("scanning");
    setNotice("");
    setBatchNote("");
    setSummary("");
    setLastSave(null);
    setConfirming(false);
    readRun.current++;
    stopSearch();
    for (const url of pictureUrls.current) URL.revokeObjectURL(url);
    pictureUrls.current.clear();
    try {
      const scan = await scanFolder(dir, { deep });
      const list = [];
      scan.folders.forEach((folder, index) => {
        for (const file of folder.files) {
          const kind = kindOf(file.name);
          const format = tagFormat(file.name);
          list.push({
            id: list.length,
            folder: index,
            handle: file.handle,
            name: file.name,
            ...splitName(file.name),
            kind,
            format,
            checked: true,
            tags: format ? { state: "loading" } : null,
            edit: {},
            result: null,
          });
        }
      });
      setSource({ name: scan.name, dir, folders: scan.folders.map((folder) => ({ path: folder.path, dir: folder.dir, others: folder.others })) });
      setRows(list);
      setLimit(PAGE);
      setStatus("ready");
      readAllTags(list);
    } catch (error) {
      setSource(null);
      setRows([]);
      setStatus("idle");
      setNotice(`폴더를 읽지 못했습니다. ${error.message}`);
    }
  }

  // 하위 폴더를 읽을지 바꾼다. 폴더를 읽어 둔 채면 바로 다시 읽는다 (고친 것이 있으면 이 옵션은 꺼져 있다)
  function changeSubfolders(deep) {
    setSettings((current) => ({ ...current, subfolders: deep }));
    if (source) openFolder(source.dir, deep);
  }

  async function pickFolder() {
    setNotice("");
    let dir;
    try {
      dir = await window.showDirectoryPicker({ id: "rename", mode: "readwrite" });
    } catch (error) {
      if (error.name === "AbortError") return; // 고르지 않고 닫음
      const blocked = error.name === "NotAllowedError" || error.name === "SecurityError";
      setNotice(blocked ? "이 브라우저는 폴더의 파일을 고치지 못하게 되어 있습니다(회사 PC 정책 등)." : `폴더를 열지 못했습니다. ${error.message}`);
      return;
    }
    await openFolder(dir);
  }

  // ---- 한꺼번에 고치기 (체크했고 지금 보이는 줄에만) ----
  const targetIds = () => new Set(rowsRef.current.filter((row) => row.checked && (view === "all" || row.kind !== "file")).map((row) => row.id));
  const labelOf = (target) => (target === "name" ? "이름" : TAG_FIELDS.find((field) => field.key === target).label);

  function applyReplace({ target, find, to, ignoreCase }) {
    const ids = targetIds();
    const count = changeRows((row) => {
      if (!ids.has(row.id)) return row;
      if (target === "name") return withBase(row, replaceText(baseOf(row), find, to, { ignoreCase }));
      return isReady(row) ? withTag(row, target, replaceText(tagOf(row, target), find, to, { ignoreCase })) : row;
    });
    setBatchNote(count ? `${number(count)}개 파일의 ${labelOf(target)}을(를) 고쳤습니다. 저장을 눌러야 파일에 적힙니다.` : `"${find}"이(가) 든 ${labelOf(target)}이(가) 없습니다.`);
  }

  // 틀을 적용할 줄과 줄마다의 번호(폴더마다 위에서부터)를 정한다
  function patternPlan(target, pattern) {
    const keys = patternKeys(pattern);
    const unknown = keys.filter((key) => key !== NAME_KEY && key !== NUMBER_KEY && !TAG_LABELS.has(key));
    const needsTags = target !== "name" || keys.some((key) => TAG_LABELS.has(key));
    const ids = targetIds();
    const numbers = new Map();
    const counters = new Map();
    let skipped = 0;
    for (const row of rowsRef.current) {
      if (!ids.has(row.id)) continue;
      if (needsTags && !isReady(row)) {
        skipped++;
        continue;
      }
      const n = counters.get(row.folder) ?? settings.start;
      numbers.set(row.id, n);
      counters.set(row.folder, n + 1);
    }
    return { unknown, numbers, skipped };
  }
  const patternResult = (row, n, target, pattern) => {
    const { text } = fillPattern(pattern, patternValues(row, n, settings.digits, target === "name"));
    return target === "name" ? tidyBase(text) : text.trim();
  };

  function applyPattern({ target, pattern }) {
    const { unknown, numbers, skipped } = patternPlan(target, pattern);
    if (unknown.length) {
      setBatchNote(`모르는 칸이 있습니다: ${unknown.map((key) => `{${key}}`).join(" ")}`);
      return;
    }
    const count = changeRows((row) => {
      if (!numbers.has(row.id)) return row;
      const text = patternResult(row, numbers.get(row.id), target, pattern);
      if (target === "name") return text ? withBase(row, text) : row;
      return withTag(row, target, text);
    });
    const parts = [count ? `${number(count)}개 파일의 ${labelOf(target)}을(를) 채웠습니다. 저장을 눌러야 파일에 적힙니다.` : "바뀐 것이 없습니다."];
    if (skipped) parts.push(`태그를 읽을 수 없는 파일 ${number(skipped)}개는 건너뛰었습니다.`);
    setBatchNote(parts.join(" "));
  }

  // 틀을 첫 파일에 적용하면 어떻게 되는지
  function patternExample(target, pattern) {
    if (!pattern.trim()) return "";
    const { unknown, numbers } = patternPlan(target, pattern);
    if (unknown.length) return "";
    const row = rowsRef.current.find((item) => numbers.has(item.id));
    if (!row) return "";
    const text = patternResult(row, numbers.get(row.id), target, pattern);
    return target === "name" ? `${row.name} → ${text}${row.ext}` : text;
  }

  function applyClear(keys) {
    const ids = targetIds();
    const count = changeRows((row) => {
      if (!ids.has(row.id) || !isReady(row)) return row;
      let next = row;
      for (const field of TAG_FIELDS) if (keys.has(field.key)) next = withTag(next, field.key, "");
      if (keys.has("picture")) next = withPicture(next, null);
      return next;
    });
    setBatchNote(count ? `${number(count)}개 파일에서 고른 칸을 비웠습니다. 저장을 눌러야 파일에 적힙니다.` : "비울 것이 없습니다 (이미 비어 있습니다).");
  }

  async function applyPicture(file) {
    setNotice("");
    const picture = await readPicture(file);
    if (!picture) return;
    const ids = targetIds();
    const count = changeRows((row) => (ids.has(row.id) ? withPicture(row, picture) : row));
    setBatchNote(`${number(count)}개 파일에 넣을 그림: ${pictureNote(picture)}. 저장을 눌러야 파일에 적힙니다.`);
  }

  // 체크한 파일 가운데 태그를 고칠 수 있는 것 모두에 넣을 앨범 아트를 찾는다 (google이면 구글 이미지 검색에서)
  function findPictures({ artist, album }, google = false) {
    const ids = targetIds();
    const ready = new Set(rowsRef.current.filter((row) => ids.has(row.id) && isReady(row)).map((row) => row.id));
    if (ready.size) (google ? openGoogle : openSearch)(ready, artist.trim(), album.trim(), `체크한 파일 ${number(ready.size)}개`);
  }

  // 깨진 한글을 바로잡아 보여 주던 칸을 바로잡은 대로 저장할 것으로 표시한다
  function markRepaired() {
    const count = changeRows((row) => {
      if (!isReady(row)) return row;
      let next = row;
      for (const key of row.tags.repaired) if (next.edit.tags?.[key] === undefined) next = withTag(next, key, row.tags.values[key], true);
      return next;
    });
    setBatchNote(`${number(count)}개 파일의 깨진 한글 태그를 바로잡아 저장하도록 표시했습니다. 저장을 눌러야 파일에 적힙니다.`);
  }

  function discard() {
    changeRows((row) => (Object.keys(row.edit).length || row.result || row.hint ? { ...row, edit: {}, result: null, hint: "" } : row));
    setConfirming(false);
    setBatchNote("");
  }

  // 방금 저장하기 전의 이름과 태그를 표에 다시 채운다. 저장을 누르면 그대로 되돌아간다
  function undoLast() {
    const { names, tags } = lastSave;
    changeRows((row) => {
      let next = row;
      if (names.has(row.id)) next = withBase(next, names.get(row.id));
      for (const [key, value] of Object.entries(tags.get(row.id) ?? {})) next = withTag(next, key, value);
      return next;
    });
    setLastSave(null);
    setSummary("");
    setBatchNote("저장하기 전의 이름과 태그를 표에 다시 채웠습니다. 저장을 누르면 되돌아갑니다 (앨범 아트는 되돌리지 못합니다).");
  }

  function toggleAll() {
    const ids = new Set(visible.map((row) => row.id));
    const on = checked.length !== visible.length;
    changeRows((row) => (ids.has(row.id) && row.checked !== on ? { ...row, checked: on } : row));
  }
  function toggleFolder(folder, on) {
    const ids = new Set(visible.filter((row) => row.folder === folder).map((row) => row.id));
    changeRows((row) => (ids.has(row.id) && row.checked !== on ? { ...row, checked: on } : row));
  }

  // ---- 저장: 태그를 먼저 적고 이름을 바꾼다 ----
  async function save() {
    setConfirming(false);
    setStatus("saving");
    setSummary("");
    setNotice("");
    setBatchNote("");
    stopRef.current = false;
    const stopped = () => stopRef.current;
    const snapshot = rowsRef.current;
    const blocked = findIssues(snapshot, source.folders);
    const tagRows = snapshot.filter((row) => isReady(row) && tagsEdited(row));
    const nameRows = canRename() ? snapshot.filter((row) => nameEdited(row) && !blocked.has(row.id)) : [];
    const total = tagRows.length + nameRows.length;
    const undo = { names: new Map(), tags: new Map() };
    const tally = { tags: 0, names: 0, failed: 0 };
    let done = 0;

    for (const row of tagRows) {
      if (stopped()) break;
      setProgress({ done, total, text: `태그 저장 중: ${row.name}` });
      const edits = {};
      for (const [key, value] of Object.entries(row.edit.tags ?? {})) edits[key] = value.trim();
      if (row.edit.picture !== undefined) edits.picture = row.edit.picture && { mime: row.edit.picture.mime, data: row.edit.picture.data };
      const result = await saveTags(row.handle, row.format, row.tags, edits, {
        stopped,
        hold: (writable) => {
          savingRef.current = writable;
        },
      });
      if (result.cancelled) break;
      done++;
      if (result.ok) {
        tally.tags++;
        const before = Object.fromEntries(Object.keys(row.edit.tags ?? {}).map((key) => [key, row.tags.values[key]]));
        if (Object.keys(before).length) undo.tags.set(row.id, before);
        updateRow(row.id, (current) => ({
          ...current,
          tags: result.tags,
          edit: current.edit.base === undefined ? {} : { base: current.edit.base },
          result: { ...current.result, tags: { ok: true } },
        }));
      } else {
        tally.failed++;
        updateRow(row.id, (current) => ({ ...current, result: { ...current.result, tags: { ok: false, text: result.text, detail: result.detail } } }));
      }
    }

    const folders = [...new Set(nameRows.map((row) => row.folder))];
    for (const folder of folders) {
      if (stopped()) break;
      const want = new Map(nameRows.filter((row) => row.folder === folder).map((row) => [row.id, row.edit.base + row.ext]));
      const files = snapshot
        .filter((row) => row.folder === folder)
        .map((row) => ({ id: row.id, handle: row.handle, from: row.name, to: want.get(row.id) ?? row.name }));
      setProgress({ done, total, text: "이름 바꾸는 중" });
      const results = await renameFiles(source.folders[folder].dir, files, source.folders[folder].others, {
        stopped,
        onDone: () => {
          done++;
          setProgress({ done, total, text: "이름 바꾸는 중" });
        },
      });
      const before = new Map(snapshot.filter((row) => results.has(row.id)).map((row) => [row.id, row.base]));
      for (const [id, result] of results) {
        if (result.ok) {
          tally.names++;
          undo.names.set(id, before.get(id));
        } else {
          tally.failed++;
        }
      }
      setRows((current) =>
        current.map((row) => {
          const result = results.get(row.id);
          if (!result) return row;
          // 실패했어도 디스크의 이름이 달라졌을 수 있다 (임시 이름에 남은 경우)
          const named = result.name === row.name ? row : { ...row, name: result.name, ...splitName(result.name) };
          if (!result.ok) return { ...named, result: { ...row.result, name: { ok: false, text: result.text, detail: result.detail } } };
          const edit = { ...row.edit };
          delete edit.base;
          return { ...named, edit, result: { ...row.result, name: { ok: true } } };
        }),
      );
      // 이름을 바꾼 오디오는 태그를 다시 읽는다. 전에 읽어 둔 파일은 옛 이름을 가리켜 그림을 보이지 못하고,
      // 바뀐 시각이 달라졌으면 다음 저장 때 "읽은 뒤에 파일이 바뀌었다"고 잘못 막는다
      for (const row of snapshot) {
        if (!results.get(row.id)?.ok || !row.format) continue;
        const tags = await loadTags(row.handle, row.format).catch(() => null);
        if (tags) updateRow(row.id, (current) => (current.tags?.state === "loading" ? current : { ...current, tags }));
      }
    }

    const parts = [];
    if (tally.tags) parts.push(`태그 ${number(tally.tags)}개 파일`);
    if (tally.names) parts.push(`이름 ${number(tally.names)}개`);
    let text = parts.length ? `${parts.join(", ")}을(를) 저장했습니다.` : "저장한 것이 없습니다.";
    if (tally.failed) text += ` ${number(tally.failed)}개는 저장하지 못했습니다. 줄마다 까닭이 적혀 있습니다.`;
    if (stopRef.current) text += " 멈췄습니다.";
    if (!canRename() && snapshot.some(nameEdited)) text += " 이 브라우저는 파일 이름을 바꾸지 못합니다 (최신 크롬·엣지에서 됩니다).";
    setSummary(text);
    setLastSave(undo.names.size || undo.tags.size ? undo : null);
    setProgress(null);
    setStatus("ready");
  }

  function stop() {
    stopRef.current = true;
    savingRef.current?.abort().catch(() => {});
  }

  // 목록이 떠 있으면 알림은 늘 보이는 아래 저장 칸에 적는다 (긴 목록을 내려 보는 중에도 보이게)
  const listed = Boolean(source) && status !== "scanning" && rows.length > 0;
  const shown = visible.slice(0, limit);
  const folderCount = new Set(visible.map((row) => row.folder)).size;
  const problemCount = issues.size;
  const pendingText = [counts.names && `이름 ${number(counts.names)}개`, counts.tags && `태그 ${number(counts.tags)}개 파일`].filter(Boolean).join(" · ");
  let lastFolder = -1;

  return (
    <main className="container rn-page">
      <a className="back-link" href={HUB_URL}>← Playground</a>
      <header>
        <h1>파일 이름 바꾸기</h1>
        <p className="subtitle">
          폴더를 고르면 그 안의 파일 이름을 표에서 고치거나 한꺼번에 바꿔 저장합니다. 오디오({TAG_FORMAT_NAMES})는 제목·앨범
          같은 태그와 앨범 아트도 함께 고칩니다. 파일은 이 PC 밖으로 나가지 않고 브라우저 안에서만 처리합니다.
        </p>
      </header>

      <section className="card">
        {canPickFolder() ? (
          <div className="rn-actions">
            <button type="button" onClick={pickFolder} disabled={busy}>
              {source ? "다른 폴더 고르기" : "폴더 고르기"}
            </button>
            {source && (
              <button
                type="button"
                className="secondary"
                onClick={() => openFolder(source.dir)}
                disabled={busy || pending > 0}
                title={pending ? "고친 것을 저장하거나 취소한 뒤에 다시 읽을 수 있습니다" : undefined}
              >
                폴더 다시 읽기
              </button>
            )}
            <label className="rn-option" title={pending ? "고친 것을 저장하거나 취소한 뒤에 바꿀 수 있습니다" : undefined}>
              <input type="checkbox" checked={settings.subfolders} disabled={busy || pending > 0} onChange={(event) => changeSubfolders(event.target.checked)} />
              하위 폴더도 포함
            </label>
          </div>
        ) : (
          <p className="rn-warn">이 브라우저에서는 쓸 수 없습니다. 폴더의 파일을 고치는 기능은 크롬·엣지(PC)에만 있습니다.</p>
        )}
        {!source && canPickFolder() && (
          <p className="rn-hint">
            {settings.subfolders ? "고른 폴더와 그 안의 폴더(하위 폴더)에 있는 파일을 모두 보여 줍니다." : "고른 폴더 바로 안의 파일만 보여 줍니다."} 저장을
            누르기 전에는 아무것도 바뀌지 않습니다.
          </p>
        )}
        {notice && !listed && (
          <p className="rn-warn" role="alert">
            {notice}
          </p>
        )}
      </section>

      {status === "scanning" && <section className="card rn-muted">폴더를 살펴보는 중…</section>}

      {source && status !== "scanning" && rows.length === 0 && (
        <section className="card">{settings.subfolders ? "이 폴더와 그 안의 폴더에는 파일이 없습니다." : "이 폴더 바로 안에는 파일이 없습니다. 하위 폴더도 포함을 켜면 안의 폴더까지 읽습니다."}</section>
      )}

      {source && status !== "scanning" && rows.length > 0 && (
        <>
          <Batch
            disabled={busy}
            hasTags={hasTags}
            count={checked.length}
            tagCount={tagChecked}
            numbering={settings}
            onNumbering={(change) => setSettings((current) => ({ ...current, ...change }))}
            onReplace={applyReplace}
            onPattern={applyPattern}
            onClear={applyClear}
            onPicture={applyPicture}
            artMax={settings.artMax}
            onArtMax={(artMax) => setSettings((current) => ({ ...current, artMax }))}
            region={settings.coverRegion}
            onRegion={(coverRegion) => setSettings((current) => ({ ...current, coverRegion }))}
            fill={settings.coverFill}
            onFill={changeCoverFill}
            suggestArtist={suggestArtist}
            suggestAlbum={suggestAlbum}
            onFind={findPictures}
            onGoogle={(query) => findPictures(query, true)}
            canPaste={canPaste}
            onPaste={() => pasteInto(targetIds())}
            onPasteSearch={() => searchRef.current && pasteInto(searchRef.current.ids)}
            searching={searching}
            onStopSearch={stopSearch}
            example={patternExample}
            note={batchNote}
          />

          <section className="card rn-list">
            <div className="rn-summary">
              <h2>{source.name}</h2>
              <span className="rn-muted">
                파일 {number(rows.length)}개{counts.audio > 0 && ` · 오디오 ${number(counts.audio)}개`}
                {counts.reading > 0 && ` · 태그 읽는 중 (${number(counts.reading)}개 남음)`}
              </span>
            </div>
            <div className="rn-views">
              {counts.audio > 0 && counts.audio < rows.length && (
                <>
                  <label>
                    <input type="radio" name="rn-view" checked={view === "all"} disabled={saving} onChange={() => setView("all")} />
                    모든 파일
                  </label>
                  <label>
                    <input type="radio" name="rn-view" checked={view === "audio"} disabled={saving} onChange={() => setView("audio")} />
                    오디오만
                  </label>
                </>
              )}
              {hasTags && (
                <label>
                  <input
                    type="checkbox"
                    checked={settings.showTags}
                    onChange={(event) => setSettings((current) => ({ ...current, showTags: event.target.checked }))}
                  />
                  태그 칸 보기
                </label>
              )}
            </div>
            {counts.repaired > 0 && (
              <p className="rn-repair">
                한글이 깨진 채 적힌 태그를 {number(counts.repaired)}개 파일에서 바로잡아 보여 주고 있습니다(파일은 그대로).
                <button type="button" className="rn-link" disabled={busy} onClick={markRepaired}>
                  바로잡은 대로 저장하도록 표시
                </button>
              </p>
            )}

            <div className="rn-scroll">
              <table className={showTags ? "rn-table wide" : "rn-table"}>
                <thead>
                  <tr>
                    <th className="rn-check">
                      <input
                        ref={allRef}
                        type="checkbox"
                        checked={checked.length === visible.length && visible.length > 0}
                        disabled={busy}
                        aria-label="모두 고르기"
                        onChange={toggleAll}
                      />
                    </th>
                    <th className="rn-name">
                      파일 이름 <span className="rn-muted">({number(checked.length)}/{number(visible.length)} 고름)</span>
                    </th>
                    {showTags && (
                      <>
                        <th className="rn-art-cell">앨범 아트</th>
                        {TAG_FIELDS.map((field) => (
                          <th key={field.key} className={`rn-tag rn-${field.key}`}>
                            {field.label}
                          </th>
                        ))}
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => {
                    const head = row.folder !== lastFolder && folderCount > 1;
                    lastFolder = row.folder;
                    const folder = source.folders[row.folder];
                    const inFolder = head ? visible.filter((item) => item.folder === row.folder) : [];
                    const on = inFolder.filter((item) => item.checked).length;
                    return [
                      head && (
                        <tr key={`folder-${row.folder}`} className="rn-folder">
                          <td className="rn-check">
                            <input
                              type="checkbox"
                              checked={on === inFolder.length}
                              ref={(element) => {
                                if (element) element.indeterminate = on > 0 && on < inFolder.length;
                              }}
                              disabled={busy}
                              aria-label={`${folder.path.join(" / ") || source.name} 폴더의 파일 모두 고르기`}
                              onChange={() => toggleFolder(row.folder, on !== inFolder.length)}
                            />
                          </td>
                          <td colSpan={showTags ? TAG_FIELDS.length + 2 : 1}>
                            {folder.path.length ? folder.path.join(" / ") : `${source.name} (고른 폴더)`}
                            <span className="rn-muted"> · {number(inFolder.length)}개</span>
                          </td>
                        </tr>
                      ),
                      <FileRow key={row.id} row={row} issue={issues.get(row.id)} showTags={showTags} busy={busy} actions={actions} />,
                    ];
                  })}
                </tbody>
              </table>
            </div>
            {visible.length > limit && (
              <button type="button" className="secondary rn-more" onClick={() => setLimit(limit + PAGE)}>
                {number(Math.min(PAGE, visible.length - limit))}개 더 보기 (남은 {number(visible.length - limit)}개)
              </button>
            )}

            <div className="rn-footer">
              {notice && (
                <p className="rn-warn rn-footer-warn" role="alert">
                  {notice}
                </p>
              )}
              {saving && progress && (
                <div className="rn-bar">
                  <span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                </div>
              )}
              {confirming && !saving && (
                <div className="rn-confirm" role="alertdialog" aria-label="저장 확인">
                  <p>
                    원본 파일을 바로 고칩니다: {pendingText}.
                    {counts.pictures > 0 && " 앨범 아트를 바꾸거나 지운 것은 되돌릴 수 없습니다."}
                    {problemCount > 0 && ` 이름에 문제가 있는 ${number(problemCount)}개는 이름을 바꾸지 않습니다.`}
                  </p>
                  <button type="button" onClick={save}>
                    저장하기
                  </button>
                  <button type="button" className="secondary" onClick={() => setConfirming(false)}>
                    취소
                  </button>
                </div>
              )}
              <div className="rn-footer-line">
                {saving ? (
                  <>
                    <button type="button" className="secondary" onClick={stop}>
                      멈추기
                    </button>
                    <span className="rn-muted">
                      {progress ? `${number(progress.done)}/${number(progress.total)} · ${progress.text}` : "저장하는 중…"}
                    </span>
                  </>
                ) : (
                  <>
                    <button type="button" onClick={() => setConfirming(true)} disabled={!pending || confirming}>
                      저장
                    </button>
                    <button type="button" className="secondary" onClick={discard} disabled={!pending}>
                      고친 것 취소
                    </button>
                    <span className="rn-muted">
                      {pending ? `고친 것: ${pendingText} (아직 저장 전)` : "고친 것이 없습니다."}
                      {problemCount > 0 && <b className="rn-error"> 이름 문제 {number(problemCount)}개</b>}
                    </span>
                  </>
                )}
              </div>
              {summary && !saving && (
                <p className="rn-done" role="status">
                  {summary}
                  {lastSave && (
                    <button type="button" className="rn-link" onClick={undoLast}>
                      방금 저장한 것 되돌리기
                    </button>
                  )}
                </p>
              )}
            </div>
          </section>
        </>
      )}

      <section className="rn-notes">
        <h2>알아 둘 것</h2>
        <ul>
          <li>
            <b>원본 파일을 바로 고칩니다.</b> 저장을 누르면 고른 폴더의 파일 이름과 태그가 바뀝니다. 그 전까지는 표에서 무엇을
            고쳐도 파일은 그대로입니다. 바뀐 칸은 색으로 표시됩니다.
          </li>
          <li>
            이름은 확장자를 뺀 부분만 고칩니다. 같은 폴더에 같은 이름이 생기면(대소문자만 달라도) 그 파일은 바꾸지 않고
            알립니다. 이름에 쓸 수 없는 글자(\ / : * ? " &lt; &gt; |)는 이름 칸에 입력되지 않습니다.
          </li>
          <li>
            찾아 바꾸기는 글자 그대로 찾아 모두 바꿉니다. 틀로 채우기는 {"{번호} {이름}"}처럼 칸을 섞어 이름이나 태그를
            만듭니다. 번호는 폴더마다 표의 위에서부터 매깁니다.
          </li>
          <li>
            태그는 {TAG_FORMAT_NAMES}를 고칩니다. 소리는 다시 압축하지 않고 그대로 옮기며, 고치지 않은 태그도 그대로 둡니다.
            다른 오디오(OGG, WMA 등)는 이름만 바꿀 수 있습니다.
          </li>
          <li>
            M4A의 트랙에는 숫자만 적을 수 있습니다(3 또는 3/12). WAV는 태그를 파일 안의 두 곳(ID3, INFO)에 함께 적는데,
            한글로 된 값과 작곡가·앨범 아티스트·앨범 아트는 ID3 쪽에만 들어갑니다. 그래서 WAV의 태그는 프로그램에 따라 일부만
            보일 수 있습니다.
          </li>
          <li>
            앨범 아트는 표의 그림 칸에 그림 파일을 끌어다 놓거나 그림을 눌러 바꿉니다. 여러 파일에 같은 그림을 넣으려면
            위의 "앨범 아트"에 끌어다 놓으세요. 그림 위에 마우스를 올리면 크게 보입니다.
          </li>
          <li>
            앨범 아트 "찾기"는 <a href="https://covers.musichoarders.xyz" target="_blank" rel="noreferrer">MH Covers (https://covers.musichoarders.xyz)</a>
            를 새 창으로 엽니다. 거기서 찾은 그림 가운데 하나를 누르면 이 화면에 넣을 그림으로 들어옵니다. 그 곡의
            아티스트와 앨범 이름이 그 사이트로 전달됩니다. 찾을 곳은 한국(멜론·FLO·애플 뮤직 등)과 일본(애플 뮤직·LINE
            MUSIC·아마존 뮤직 등) 가운데 고릅니다. "고르면 넣을 것"을 "그림과 앨범·아티스트·연도"로 바꾸면 고른 그림이 실린
            음반의 앨범 이름·아티스트·발매 연도도 태그에 넣습니다(있던 값은 바뀝니다. 곡 제목·트랙·장르는 오지 않습니다).
            사이트마다 적는 방식이 달라서 저장하기 전에 바뀐 칸을 확인하세요. 벅스·OTOTOY·BOOTH의 그림은 브라우저가 바로 받아 오지 못해서, 저장한 뒤
            끌어다 놓아야 합니다.
          </li>
          <li>
            거기서 못 찾은 그림은 "구글"로 찾을 수 있습니다. 그 곡의 아티스트·앨범으로 구글 이미지 검색을 새 탭에 엽니다(검색어가
            구글로 전달됩니다). 구글은 고른 그림을 이 화면에 알려 주지 않아서, 그림을 오른쪽 클릭해 "이미지 복사"를 누르고 그
            탭을 닫은 뒤 이 화면에서 붙여 넣어야 합니다. Ctrl+V를 누르면 찾던 곡에 들어가고, 다른 곡에 넣으려면 그 곡의
            "붙여넣기"를 누릅니다. "붙여넣기"를 처음 누르면 브라우저가 클립보드를 봐도 되는지 묻습니다. 복사한 그림은 JPG가 더
            작으면 JPG로 바꿔 넣습니다.
          </li>
          <li>
            찾은 그림은 3000px·4MB쯤 되는 것도 있습니다. 그대로 넣으면 파일마다 그만큼 커지므로, "앨범 아트"의 넣을 그림
            크기에서 줄여 넣을 수 있습니다(끌어다 놓은 그림에도 적용됩니다).
          </li>
          <li>
            "방금 저장한 것 되돌리기"는 이름과 글로 된 태그를 저장하기 전 값으로 표에 다시 채웁니다. 앨범 아트는 되돌리지
            못하니 필요하면 원본을 따로 복사해 두세요.
          </li>
          <li>
            한글이 깨진 채 적힌 태그(예전 프로그램이 EUC-KR로 적은 것)는 바로잡아 보여 줍니다. 그 칸을 고치거나 "바로잡은
            대로 저장하도록 표시"를 눌러 저장하면 어느 프로그램에서나 한글로 보입니다.
          </li>
          <li>파일을 재생기나 다른 프로그램이 열고 있으면 저장하지 못합니다. 그 줄에 까닭이 나옵니다.</li>
          <li>
            크롬·엣지는 이 화면에서 이름을 바꾸거나 태그를 저장한 파일에 "인터넷에서 받은 파일" 표시를 붙입니다. 사진·음악·글
            파일은 상관없지만, 워드·엑셀 같은 문서는 열 때 "제한된 보기"로 열릴 수 있습니다(편집 사용을 누르면 됩니다).
            실행 파일(exe 등)과 바로 가기는 브라우저가 이름을 바꾸지 못하게 막습니다.
          </li>
          <li>파일은 윈도우 탐색기의 이름순(숫자는 크기대로, 영문이 한글보다 앞)으로 놓습니다. 번호는 이 순서대로 매깁니다.</li>
          <li>바탕화면·문서·다운로드 폴더 자체는 크롬·엣지가 고르지 못하게 막습니다. 그 안의 폴더를 고르세요.</li>
          <li>"하위 폴더도 포함"을 끄면 고른 폴더 바로 안의 파일만 읽습니다. 켜면 안의 폴더까지 모두 읽어 폴더마다 묶어 보입니다.</li>
          <li>크롬·엣지(PC)에서만 쓸 수 있습니다. 폴더 이름은 바꾸지 못합니다.</li>
        </ul>
      </section>
    </main>
  );
}
