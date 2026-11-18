// 노트/폴더 이름 규칙. 옵시디언·윈도우·안드로이드 모두에서 쓸 수 있는 파일 이름만 허용한다.

/** 파일 이름에 쓸 수 없는 문자 (옵시디언 링크 문법과 충돌하는 # ^ [ ] | 도 포함) */
export const FORBIDDEN_CHARS = /[\\/:*?"<>|#^[\]]/;
const FORBIDDEN_GLOBAL = /[\\/:*?"<>|#^[\]]/g;

export const MAX_NAME_LENGTH = 200;

/** 이름 검사. 문제가 있으면 한국어 오류 메시지, 없으면 null */
export function validateName(raw: string): string | null {
  const name = raw.trim();
  if (!name) return '이름을 입력하세요.';
  if (name === '.' || name === '..') return '사용할 수 없는 이름입니다.';
  if (name.startsWith('.')) return '이름은 점(.)으로 시작할 수 없습니다.';
  if (FORBIDDEN_CHARS.test(name)) return '다음 문자는 쓸 수 없습니다: \\ / : * ? " < > | # ^ [ ]';
  if (name.length > MAX_NAME_LENGTH) return `이름은 ${MAX_NAME_LENGTH}자 이하여야 합니다.`;
  return null;
}

/** 금지 문자를 제거해 안전한 이름으로 바꾼다(가져오기 등 자동 처리용) */
export function sanitizeName(raw: string, fallback = '제목 없음'): string {
  let name = raw.replace(FORBIDDEN_GLOBAL, ' ').replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '').trim();
  if (name.length > MAX_NAME_LENGTH) name = name.slice(0, MAX_NAME_LENGTH).trim();
  return name || fallback;
}

/** 대소문자 무시 비교용 키 (윈도우/안드로이드 파일 시스템 호환) */
export function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLocaleLowerCase('ko');
}

/**
 * 같은 폴더 안에서 겹치지 않는 이름을 만든다.
 * "회의록"이 있으면 "회의록 2", "회의록 3" … 순서로 시도한다.
 */
export function uniqueName(desired: string, existing: Iterable<string>): string {
  const taken = new Set<string>();
  for (const n of existing) taken.add(nameKey(n));
  const base = desired.trim();
  if (!taken.has(nameKey(base))) return base;
  // 이미 "이름 3" 형태면 숫자 부분을 떼어 낸 뒤 이어서 센다
  const m = base.match(/^(.*?) (\d+)$/);
  const stem = m ? m[1] : base;
  let i = m ? Number(m[2]) + 1 : 2;
  while (taken.has(nameKey(`${stem} ${i}`))) i++;
  return `${stem} ${i}`;
}
