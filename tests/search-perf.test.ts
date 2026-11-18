// 노트 수천 개에서도 검색이 빠른지 확인(느린 컴퓨터를 고려해 기준은 넉넉하게)
import { describe, expect, it } from 'vitest';
import { prepare, searchDocs } from '../src/core/search';
import { fuzzyMatch } from '../src/core/fuzzy';

const WORDS = '회의 프로젝트 디자인 일정 보고 검토 아이디어 독서 여행 운동 계획 정리 메모 업무 개인 가이드 마크다운 링크 태그 검색'.split(' ');
function rnd(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

describe('검색 성능', () => {
  const r = rnd(42);
  const N = 5000;
  const docs = Array.from({ length: N }, (_, i) => {
    const body = Array.from({ length: 300 }, () => WORDS[Math.floor(r() * WORDS.length)]).join(' ') + `\n고유어${i}`;
    return prepare({ id: String(i), title: `노트 ${i} ${WORDS[i % WORDS.length]}`, path: `폴더${i % 50}`, tags: [WORDS[i % 7]], body, updatedAt: i });
  });
  const totalKB = Math.round(docs.reduce((s, d) => s + d.body.length, 0) / 1024);

  it(`노트 ${N}개(본문 약 ${totalKB}KB) 전체 검색`, () => {
    const t = performance.now();
    const res = searchDocs(docs, '고유어4321');
    const ms = performance.now() - t;
    expect(res.results[0].id).toBe('4321');
    console.log(`  전체 검색: ${ms.toFixed(1)}ms`);
    expect(ms).toBeLessThan(500);
  });

  it('흔한 단어(거의 모든 노트 일치)도 결과 제한으로 빠르게', () => {
    const t = performance.now();
    const res = searchDocs(docs, '회의 디자인', 200);
    const ms = performance.now() - t;
    console.log(`  흔한 단어 검색: ${ms.toFixed(1)}ms, 일치 ${res.total}개`);
    expect(res.results.length).toBe(200);
    expect(ms).toBeLessThan(1500);
  });

  it('빠른 열기 퍼지 매칭 5000개', () => {
    const t = performance.now();
    let n = 0;
    for (const d of docs) if (fuzzyMatch('ㄴㅌ43', d.title)) n++;
    const ms = performance.now() - t;
    console.log(`  퍼지 매칭: ${ms.toFixed(1)}ms, 일치 ${n}개`);
    expect(n).toBeGreaterThan(0);
    expect(ms).toBeLessThan(200);
  });
});
