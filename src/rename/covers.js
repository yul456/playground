// 앨범 아트 찾기: MH Covers(https://covers.musichoarders.xyz)를 새 창으로 열고, 사용자가 거기서 고른 그림을 받는다.
// 그 사이트가 정한 연동 방식(INTEGRATIONS의 Remote protocol)을 쓴다. 그 사이트의 규칙:
//   - 완전히 자동으로 그림을 받아 오면 안 된다. 사용자가 그 사이트에서 직접 고르게 한다
//   - 공식 사이트를 열어 사용자가 쓰게 한다 (내부 API를 부르지 않는다)
//   - 이 기능이 그 프로젝트를 쓴다는 것과 전체 주소를 화면에 적는다
// 주소에 remote.port=browser를 붙여 열면, 사용자가 그림을 누를 때 그 사이트가 연 창(opener)에게
//   { type: "pick", action: "primary"(누름) | "secondary"(Shift+누름), bigCoverUrl, smallCoverUrl, source,
//     releaseInfo: { title, artist, date, url }, coverInfo: { format, width, height, size } }
// 를 JSON 글로 보낸다(postMessage). 이쪽에서는 { type: "text" | "error" | "close", text }를 객체로 보낼 수 있다.

export const COVERS_URL = "https://covers.musichoarders.xyz";
export const COVERS_NAME = "MH Covers";

// 찾을 곳(사용자 요청으로 한국·일본 가운데 고른다, 2026-11-17). country는 스토어의 지역, sources는 찾을 출처다(한 번에 9곳까지).
// 고른 그림을 이 화면이 받아 읽을 수 있는 출처만 넣었다. 그림 서버가 다른 사이트에서 읽는 것을 막는(CORS) 곳은 뺐다:
//   벅스, OTOTOY, BOOTH, 그리고 아이튠즈(일본 지역에서 큰 그림의 서버가 막혀 있고, 한국 지역은 음악 결과가 없다. 애플 뮤직과 같은 목록이다).
// 받아지는 것을 시험용 크롬에서 확인한 곳: 멜론, FLO, 애플 뮤직, 디저, 스포티파이, 아마존 뮤직, MusicBrainz, LINE MUSIC, TIDAL, Qobuz, THWiki
export const REGIONS = [
  { key: "kr", label: "한국", country: "kr", sources: ["melon", "flo", "applemusic", "deezer", "spotify", "amazonmusic", "musicbrainz"] },
  { key: "jp", label: "일본", country: "jp", sources: ["applemusic", "linemusic", "amazonmusic", "spotify", "tidal", "qobuz", "deezer", "musicbrainz", "thwiki"] },
];
export const regionOf = (key) => REGIONS.find((region) => region.key === key) ?? REGIONS[0];

// 화면에 보일 출처 이름
const SOURCE_NAMES = {
  melon: "멜론",
  bugs: "벅스",
  flo: "FLO",
  applemusic: "애플 뮤직",
  itunes: "아이튠즈",
  deezer: "디저",
  spotify: "스포티파이",
  amazonmusic: "아마존 뮤직",
  musicbrainz: "MusicBrainz",
  linemusic: "LINE MUSIC",
  tidal: "TIDAL",
  qobuz: "Qobuz",
  thwiki: "THWiki",
  ototoy: "OTOTOY",
  booth: "BOOTH",
};
export const sourceName = (source) => SOURCE_NAMES[source] || source || "그 출처";

// 검색 창의 주소. text는 그 창 위쪽에 보일 안내 글, region은 찾을 곳(REGIONS의 key)
export function searchUrl({ artist, album, text, dark, region }) {
  const { country, sources } = regionOf(region);
  const params = new URLSearchParams({
    "remote.port": "browser",
    "remote.agent": "Playground 파일 이름 바꾸기",
    "remote.text": text,
    country,
    sources: sources.join(","),
    theme: dark ? "dark" : "light",
  });
  if (artist) params.set("artist", artist);
  if (album) params.set("album", album);
  return `${COVERS_URL}/?${params}`;
}

// 구글 이미지 검색의 주소 (udm=2가 이미지 탭이다). MH Covers에서 못 찾은 그림을 사용자가 직접 찾을 때 연다.
// 구글은 연동 방식이 없어서 그림을 골라도 이 화면에 알려 주지 않는다. 사용자가 그림을 복사해 이 화면에 붙여 넣는다(App.jsx의 붙여넣기).
// 구글 검색 페이지는 자기를 연 페이지와의 연결도 끊는다(COOP. 연 쪽에서는 그 창이 닫힌 것으로 보인다. 크롬에서 확인, 2026-11-17).
// 그래서 이 화면이 그 창을 닫아 줄 수 없고, 연 창을 기억해 두지도 않는다
export function googleUrl({ artist, album }) {
  const query = [artist, album].map((text) => (text ?? "").trim()).filter(Boolean).join(" ");
  return `https://www.google.com/search?${new URLSearchParams({ udm: "2", q: query })}`;
}

// 검색 창이 보낸 소식에서 고른 그림을 읽는다. 그 사이트가 보낸 것이 아니거나 고르기 소식이 아니면 null
export function readPick(event, child) {
  if (event.origin !== COVERS_URL || !child || event.source !== child) return null;
  let data = event.data;
  if (typeof data === "string") {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!data || data.type !== "pick" || typeof data.bigCoverUrl !== "string") return null;
  return { url: data.bigCoverUrl, source: typeof data.source === "string" ? data.source : "", keepOpen: data.action === "secondary" };
}

// 검색 창에 소식을 보낸다 (그 창 위쪽의 안내 글, 오류 글, 닫기). 창이 이미 닫혔으면 아무 일도 없다
export function tell(child, message) {
  try {
    if (child && !child.closed) child.postMessage(message, "*");
  } catch {
    // 닫히는 중인 창에는 보낼 수 없다
  }
}
