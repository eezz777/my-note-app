// 로컬 ID 생성. 드라이브 연동 시에는 드라이브가 미리 발급한 ID(files.generateIds)를 쓸 예정.
export function newId(prefix = 'l'): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += b.toString(36).padStart(2, '0');
  return `${prefix}_${s}`;
}
