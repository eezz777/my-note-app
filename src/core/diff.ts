// 줄 단위 비교(LCS). 충돌 비교·이전 버전 보기에 쓴다.

export type DiffLine = { kind: 'same' | 'del' | 'add'; text: string };

/** a(이전) → b(이후) 줄 비교. 아주 긴 문서는 앞뒤 같은 부분을 먼저 걷어 내 계산량을 줄인다. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n');
  const B = b.split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length;
  let eb = B.length;
  while (ea > s && eb > s && A[ea - 1] === B[eb - 1]) (ea--, eb--);
  const head: DiffLine[] = A.slice(0, s).map((text) => ({ kind: 'same', text }));
  const tail: DiffLine[] = A.slice(ea).map((text) => ({ kind: 'same', text }));
  const x = A.slice(s, ea);
  const y = B.slice(s, eb);
  // 너무 크면 통째로 삭제/추가로 표시(브라우저가 멈추지 않게)
  if (x.length * y.length > 4_000_000) {
    return [...head, ...x.map((text) => ({ kind: 'del' as const, text })), ...y.map((text) => ({ kind: 'add' as const, text })), ...tail];
  }
  const m = x.length;
  const n = y.length;
  const L = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) L[i][j] = x[i] === y[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const mid: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) (mid.push({ kind: 'same', text: x[i] }), i++, j++);
    else if (L[i + 1][j] >= L[i][j + 1]) mid.push({ kind: 'del', text: x[i++] });
    else mid.push({ kind: 'add', text: y[j++] });
  }
  while (i < m) mid.push({ kind: 'del', text: x[i++] });
  while (j < n) mid.push({ kind: 'add', text: y[j++] });
  return [...head, ...mid, ...tail];
}
