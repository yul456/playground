// 숫자 야구 규칙: 0~9 중 서로 다른 숫자 몇 개로 정답을 정하고, 칠 때마다 스트라이크·볼을 센다.
// 화면 코드가 없어 Node에서도 돌릴 수 있다. 함수는 받은 판을 고치지 않고 새 판을 돌려준다
import { shuffle } from "../shared/random.js";

// 고를 수 있는 자릿수와 기회(야구처럼 9회)
export const LENGTHS = [3, 4];
export const MAX_TRIES = 9;
const DIGITS = [..."0123456789"];

// 서로 다른 숫자 length개. 맨 앞이 0이어도 된다. pick은 시험용 난수(없으면 crypto)
export function newSecret(length, pick) {
  return shuffle(DIGITS, pick).slice(0, length).join("");
}

// 숫자와 자리가 모두 맞으면 스트라이크, 숫자만 있고 자리가 다르면 볼
export function score(secret, guess) {
  let strikes = 0;
  let balls = 0;
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === secret[i]) strikes++;
    else if (secret.includes(guess[i])) balls++;
  }
  return { strikes, balls };
}

// 자릿수가 맞고 서로 다른 숫자로만 되어 있는지
export const isValidGuess = (guess, length) =>
  guess.length === length && /^\d+$/.test(guess) && new Set(guess).size === length;

export const wasTried = (game, guess) => game.guesses.some((g) => g.guess === guess);

export function newGame(length, pick) {
  // status: playing → won, 또는 lost(9회를 다 쓰거나 포기)
  return { length, secret: newSecret(length, pick), guesses: [], status: "playing", gaveUp: false };
}

// guess로 한 번 친다. 맞히면 won, 9회를 다 쓰면 lost. 잘못된 숫자나 이미 쳐 본 숫자는 기회를 쓰지 않는다
export function play(game, guess) {
  if (game.status !== "playing" || !isValidGuess(guess, game.length) || wasTried(game, guess)) return game;
  const result = { guess, ...score(game.secret, guess) };
  const guesses = [...game.guesses, result];
  let status = "playing";
  if (result.strikes === game.length) status = "won";
  else if (guesses.length >= MAX_TRIES) status = "lost";
  return { ...game, guesses, status };
}

export const giveUp = (game) => (game.status === "playing" ? { ...game, status: "lost", gaveUp: true } : game);
