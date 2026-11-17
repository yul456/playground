// 태그를 고칠 수 있는 오디오 형식마다 읽기와 쓰기를 고른다. 화면 코드가 없어 Node에서 시험할 수 있다.
//   mp3  ID3v2 + ID3v1 (tags.js, id3.js)        flac  Vorbis comment + 그림 묶음 (flac.js)
//   m4a  아이튠즈 방식 항목 (mp4.js)            wav   ID3 조각 + INFO 칸 (wav.js)
// 오디오 형식 바꾸기가 만드는 네 형식이다. 어느 형식이든 태그가 든 부분만 새로 쓰고 소리는 그대로 옮긴다.
import { flacTags, readFlac, rewriteFlac } from "./flac.js";
import { parseId3v1 } from "./id3.js";
import { mp4Tags, readMp4, rewriteMp4 } from "./mp4.js";
import { readMp3, readTags, rewriteMp3 } from "./tags.js";
import { readWav, rewriteWav, wavTags } from "./wav.js";

// 확장자 → 형식. m4b(오디오북)는 M4A와 같은 모양이다
const BY_EXTENSION = { mp3: "mp3", flac: "flac", m4a: "m4a", m4b: "m4a", wav: "wav" };
// 화면에 적는 이름
export const TAG_FORMAT_NAMES = "MP3·M4A·FLAC·WAV";

// 그 이름의 파일이 태그를 고칠 수 있는 형식이면 형식 이름, 아니면 null
export function tagFormat(name) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? (BY_EXTENSION[name.slice(dot + 1).toLowerCase()] ?? null) : null;
}

const FORMATS = {
  mp3: {
    async read(file) {
      const source = await readMp3(file);
      if (source.unreadable) return { why: "읽을 수 없는 태그이거나 MP3가 아닌 파일입니다." };
      return { why: "", tags: readTags(source.parsed, source.tail && parseId3v1(source.tail)) };
    },
    rewrite: rewriteMp3,
  },
  flac: {
    async read(file) {
      const source = await readFlac(file);
      return source.why ? { why: source.why } : { why: "", tags: flacTags(source) };
    },
    rewrite: rewriteFlac,
  },
  m4a: {
    async read(file) {
      const source = await readMp4(file);
      return source.why ? { why: source.why } : { why: "", tags: mp4Tags(source) };
    },
    rewrite: rewriteMp4,
  },
  wav: {
    async read(file) {
      const source = await readWav(file);
      return source.why ? { why: source.why } : { why: "", tags: wavTags(source) };
    },
    rewrite: rewriteWav,
  },
};

// 파일(File이나 Blob)의 태그를 화면에 보일 모양으로 읽는다. format은 tagFormat의 결과다.
// 결과: { why: 고칠 수 없는 까닭 } · { why: "", tags: { version, values, repaired, picture: { mime, at: 파일 안의 자리, length }, pictures } }
export const readAudioTags = (file, format) => FORMATS[format].read(file);

// 고친 칸을 적은 새 파일 내용(Blob)을 만든다. 고칠 수 없는 파일이면 오류를 낸다.
//   edits: { title: "새 글", album: "" (비우기), …, picture: null (그림 지우기) | { mime, data } (앞표지로 넣기) } 가운데 고칠 것만
export const rewriteAudioTags = (file, format, edits) => FORMATS[format].rewrite(file, edits);
