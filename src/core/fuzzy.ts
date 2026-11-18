// 빠른 열기용 퍼지 매칭. 글자가 순서대로 들어 있으면 일치로 보고, 붙어 있거나 단어 첫 글자면 점수를 더 준다.
// 한글 초성 검색 지원: "ㅁㅋㄷ" → "마크다운"

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';

function choOf(ch: string): string | null {
  const c = ch.charCodeAt(0);
  if (c < 0xac00 || c > 0xd7a3) return null;
  return CHO[Math.floor((c - 0xac00) / 588)];
}

const isCho = (ch: string) => CHO.includes(ch);
const isWordStart = (s: string, i: number) => i === 0 || /[\s/_\-.()[\]]/.test(s[i - 1]);

export interface FuzzyMatch {
  score: number;
  /** 일치한 글자 위치 */
  indices: number[];
}

/** query가 target에 순서대로 들어 있으면 점수와 위치, 아니면 null */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  const q = query.normalize('NFC').toLocaleLowerCase('ko').replace(/\s+/g, '');
  if (!q) return { score: 0, indices: [] };
  const t = target.normalize('NFC').toLocaleLowerCase('ko');
  // 통째로 포함되면 가장 높게
  const sub = t.indexOf(q);
  if (sub >= 0) {
    return {
      score: 1000 - sub * 2 - (t.length - q.length) + (isWordStart(t, sub) ? 50 : 0),
      indices: Array.from({ length: q.length }, (_, i) => sub + i),
    };
  }
  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const qc of q) {
    let found = -1;
    for (let j = ti; j < t.length; j++) {
      if (t[j] === qc || (isCho(qc) && choOf(t[j]) === qc)) {
        found = j;
        break;
      }
    }
    if (found < 0) return null;
    score += 10;
    if (found === prev + 1) score += 15;
    if (isWordStart(t, found)) score += 12;
    score -= Math.min(found - ti, 10);
    indices.push(found);
    prev = found;
    ti = found + 1;
  }
  score -= Math.floor((t.length - q.length) / 4);
  return { score, indices };
}
