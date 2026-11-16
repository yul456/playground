// "예시 넣기"가 넣는 글. 값의 종류(문자열·숫자·참거짓·null), 겹친 객체와 배열, JSON.parse가 바꿔 버리는 큰 수를 담았다
export const SAMPLE = `{
  "id": 9007199254740993,
  "title": "주말 라운드",
  "date": "2026-11-21",
  "confirmed": true,
  "memo": null,
  "course": {
    "name": "예시 컨트리클럽",
    "holes": 18,
    "par": 72
  },
  "players": [
    { "name": "김하나", "handicap": 12, "scores": [4, 5, 3, 4, 6, 4, 3, 5, 4] },
    { "name": "이두리", "handicap": 18.5, "scores": [5, 6, 4, 5, 5, 4, 4, 6, 5] }
  ],
  "tags": ["주말", "4인", "카트"]
}`;
