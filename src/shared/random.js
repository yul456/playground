// 공정한 무작위 뽑기. Math.random 대신 crypto를 쓴다

const cryptoUint32 = () => crypto.getRandomValues(new Uint32Array(1))[0];

// 0 이상 n 미만의 정수를 고르게 뽑는다.
// 나머지 연산 때문에 앞쪽 수가 조금 더 자주 나오지 않도록, 고르게 나눠떨어지지 않는 범위의 값은 버리고 다시 뽑는다
export function randomIndex(n, randomUint32 = cryptoUint32) {
  const limit = Math.floor(2 ** 32 / n) * n;
  let x = randomUint32();
  while (x >= limit) x = randomUint32();
  return x % n;
}

// 모든 순서가 같은 확률로 나오도록 섞은 새 배열 (Fisher–Yates). pick(n)은 0 이상 n 미만을 고르게 뽑는 함수
export function shuffle(items, pick = randomIndex) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
