// 첫 화면에 보여줄 기능 목록. 새 기능 페이지를 만들면 여기와 vite.config.js에 추가한다
// path: 이 repo 안의 기능 폴더, url: 별도 repo로 분리한 기능의 전체 주소
const FEATURES = [
  {
    path: "weather/",
    icon: "🌤️",
    title: "날씨",
    description: "현재 위치나 지도에서 고른 곳의 날씨와 7일 예보를 봅니다.",
  },
  {
    path: "ladder/",
    icon: "🪜",
    title: "사다리 타기",
    description: "이름과 결과를 넣고 사다리를 타서 누가 뭐가 나오는지 정합니다.",
  },
  {
    path: "wheel/",
    icon: "🎡",
    title: "돌림판",
    description: "항목을 넣고 돌림판을 돌려 하나를 뽑습니다. 점심 메뉴 고르기, 순서 정하기에 씁니다.",
  },
  {
    path: "ball/",
    icon: "🏁",
    title: "구슬 레이스",
    description: "이름 붙은 구슬들을 한꺼번에 굴려 마지막까지 남은 구슬(또는 1등)을 뽑습니다.",
  },
  {
    path: "mines/",
    icon: "💣",
    title: "지뢰찾기",
    description: "숫자를 단서로 지뢰를 피해 칸을 모두 엽니다. 초급·중급·고급 난이도와 최고 기록이 있습니다.",
  },
  {
    path: "baseball/",
    icon: "⚾",
    title: "숫자 야구",
    description: "컴퓨터가 정한 서로 다른 숫자 3~4개를 스트라이크·볼 힌트로 9회 안에 맞힙니다.",
  },
  {
    path: "sudoku/",
    icon: "🔢",
    title: "스도쿠",
    description: "가로줄·세로줄·상자마다 1~9를 한 번씩 넣습니다. 난이도 넷, 메모, 힌트, 최고 기록이 있고 문제는 매번 새로 만듭니다.",
  },
  {
    path: "reversi/",
    icon: "⚫",
    title: "리버시",
    description: "상대 돌을 사이에 끼워 뒤집는 판 놀이입니다. 컴퓨터(쉬움·보통·어려움)와 두거나 둘이서 둡니다.",
  },
  {
    path: "golf/scorecard/",
    icon: "⛳",
    title: "골프 스코어카드",
    description: "홀마다 타수를 적어 타당·스킨스·니어리스트 내기를 정산합니다. 스마트스코어 스코어카드 사진도 읽습니다.",
  },
  {
    path: "golf/weather/",
    icon: "🌦️",
    title: "골프 라운드 날씨",
    description: "골프장과 티오프 시간을 고르면 라운드하기 좋은 날, 그날 예보, 지난해 같은 날 날씨를 보여 줍니다.",
  },
  {
    path: "golf/3d/",
    icon: "🏔️",
    title: "골프 3D 코스",
    description: "골프장 지형을 3D로 보고, 홀마다 길이·오르막 내리막을 확인하며 코스를 날아서 둘러봅니다.",
  },
  {
    path: "stitch/",
    icon: "🖼️",
    title: "사진 세로로 붙이기",
    description:
      "폴더를 고르면 그 폴더와 안의 폴더마다 사진을 파일 이름순으로 세로로 이어 붙여 한 장씩 저장합니다. 사진을 직접 골라 붙일 수도 있습니다.",
  },
  {
    path: "convert/",
    icon: "🔄",
    title: "사진 형식 바꾸기",
    description: "폴더를 고르면 그 폴더와 안의 폴더에 있는 PNG를 JPG로 바꿔 원본과 같은 자리에 저장합니다.",
  },
  {
    path: "photo-compare/",
    icon: "🔍",
    title: "사진 비교",
    description: "같은 그림의 여러 파일을 나란히 놓고 같은 자리를 함께 옮겨 가며 봅니다. 원본을 고르면 JPG 품질별로 바꿨을 때의 모습과 용량을 보여 줍니다.",
  },
  {
    path: "crop/",
    icon: "📐",
    title: "사진 자르기",
    description: "사진 속 직선 경계에 맞춰 위·아래·옆을 화소 단위로 정확히 잘라 냅니다. 같은 크기의 사진은 한꺼번에 자르고 한 번에 저장합니다.",
  },
  {
    path: "video-frames/",
    icon: "🎞️",
    title: "영상 장면 뽑기",
    description: "영상에서 장면이 바뀔 때마다 한 장씩 뽑거나 원하는 장면을 골라 사진으로 만듭니다. 뽑은 그림으로 구글 이미지 검색을 하거나 저장합니다.",
  },
  {
    path: "gif/",
    icon: "🎬",
    title: "움짤 만들기",
    description: "영상에서 구간을 골라 움직이는 GIF로 만듭니다. 폭·초당 장수·화질을 고릅니다.",
  },
  {
    path: "screen-record/",
    icon: "⏺️",
    title: "화면 녹화",
    description: "창이나 화면을 골라 녹화해 영상 파일(MP4·WebM)로 저장합니다. PC의 크롬·엣지에서 됩니다.",
  },
  {
    path: "photo-saver/",
    icon: "📥",
    title: "페이지 도우미",
    description:
      "크롬 확장 프로그램입니다. 웹 페이지의 사진·영상을 한꺼번에 받거나 이어 붙여 받고, 오른쪽 클릭 막기를 풀고, 보기 싫은 부분을 숨기고, 고른 글자나 복사한 글로 구글 검색이나 정해 둔 주소를 엽니다.",
  },
  {
    path: "audio-cut/",
    icon: "✂️",
    title: "오디오 자르기",
    description: "오디오 파일의 앞뒤 잡음 같은 부분을 잘라 내고 저장합니다. MP3는 다시 압축하지 않아 음질과 태그가 그대로입니다.",
  },
  {
    path: "audio-convert/",
    icon: "🎵",
    title: "오디오 형식 바꾸기",
    description: "오디오 파일을 MP3·M4A·FLAC·WAV 가운데 고른 형식으로 바꿉니다. 폴더째 한꺼번에 바꾸고, 앨범 아트 같은 태그도 옮깁니다. 영상에서 소리만 뽑을 수도 있습니다.",
  },
  {
    path: "rename/",
    icon: "🏷️",
    title: "파일 이름 바꾸기",
    description: "폴더의 파일 이름을 표에서 고치거나 한꺼번에 바꿉니다. 오디오(MP3·M4A·FLAC·WAV)는 제목·앨범 같은 태그와 앨범 아트도 함께 고칩니다.",
  },
  {
    path: "json/",
    icon: "📋",
    title: "JSON 보기",
    description: "JSON 글을 붙여 넣으면 구조대로 보여 줍니다. 항목마다 펼치거나 접어서 볼 수 있습니다.",
  },
  {
    path: "diff/",
    icon: "📝",
    title: "글 비교",
    description: "글 두 개를 붙여 넣으면 달라진 줄과 글자를 표시합니다. 나란히 또는 한 줄로 봅니다.",
  },
];

export default function App() {
  return (
    <main className="container">
      <header>
        <h1>Playground</h1>
        <p className="subtitle">이것저것 만들어 보는 도구 모음입니다.</p>
      </header>

      <ul className="feature-list">
        {FEATURES.map((feature) => (
          <li key={feature.url ?? feature.path}>
            <a className="card feature-card" href={feature.url ?? `${import.meta.env.BASE_URL}${feature.path}`}>
              <span className="feature-icon" aria-hidden="true">{feature.icon}</span>
              <span>
                <span className="feature-title">{feature.title}</span>
                <span className="feature-desc">{feature.description}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
