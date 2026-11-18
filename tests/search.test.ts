import { describe, expect, it } from 'vitest';
import { parseQuery, prepare, searchDocs } from '../src/core/search';
import { fuzzyMatch } from '../src/core/fuzzy';

describe('parseQuery', () => {
  it('단어·구절·제외·연산자', () => {
    expect(parseQuery('회의 "주간 보고" -취소 tag:#업무/회의 folder:프로젝트 title:Plan')).toEqual({
      terms: ['회의', '주간 보고'],
      excludes: ['취소'],
      tags: ['업무/회의'],
      folders: ['프로젝트'],
      titles: ['plan'],
    });
  });
});

const docs = [
  { id: '1', title: '주간 회의록', path: '업무/회의록', tags: ['업무/회의'], body: '오늘 회의에서 디자인 시안을 검토했다.\n다음 회의는 금요일.', updatedAt: 1 },
  { id: '2', title: '디자인 가이드', path: '업무/프로젝트 A', tags: ['디자인'], body: '포인트 컬러는 녹색. 회의 때 확정.', updatedAt: 2 },
  { id: '3', title: '장보기', path: '개인', tags: [], body: '우유 계란 커피', updatedAt: 3 },
  { id: '4', title: 'Plan', path: '', tags: ['영어'], body: 'Planning notes. PLAN b.', updatedAt: 4 },
].map(prepare);

describe('searchDocs', () => {
  it('한글 부분 일치, 제목 일치가 위로', () => {
    const { results, total } = searchDocs(docs, '회의');
    expect(total).toBe(2);
    expect(results[0].id).toBe('1');
    expect(results[0].titleRanges).toEqual([[3, 5]]);
    expect(results[0].snippets[0].text).toBe('오늘 회의에서 디자인 시안을 검토했다.');
    expect(results[0].snippets[0].ranges).toEqual([[3, 5]]);
    expect(results[0].snippets[1].line).toBe(1);
  });
  it('여러 단어는 모두 포함(AND), 제외', () => {
    expect(searchDocs(docs, '회의 디자인').results.map((r) => r.id).sort()).toEqual(['1', '2']);
    expect(searchDocs(docs, '회의 -시안').results.map((r) => r.id)).toEqual(['2']);
    expect(searchDocs(docs, '회의 우유').total).toBe(0);
  });
  it('연산자', () => {
    expect(searchDocs(docs, 'tag:업무').results.map((r) => r.id)).toEqual(['1']);
    expect(searchDocs(docs, 'folder:프로젝트').results.map((r) => r.id)).toEqual(['2']);
    expect(searchDocs(docs, '회의 folder:업무 title:가이드').results.map((r) => r.id)).toEqual(['2']);
  });
  it('대소문자 무시, 태그 이름도 검색', () => {
    expect(searchDocs(docs, 'plan').results[0].snippets[0].ranges.length).toBe(2);
    expect(searchDocs(docs, '영어').results.map((r) => r.id)).toEqual(['4']);
  });
  it('빈 검색어는 결과 없음', () => {
    expect(searchDocs(docs, '   ').total).toBe(0);
  });
});

describe('fuzzyMatch', () => {
  it('연속 포함이 가장 높고, 순서대로 흩어진 글자도 찾는다', () => {
    const a = fuzzyMatch('회의', '주간 회의록')!;
    const b = fuzzyMatch('주회', '주간 회의록')!;
    expect(a.indices).toEqual([3, 4]);
    expect(b.indices).toEqual([0, 3]);
    expect(a.score).toBeGreaterThan(b.score);
    expect(fuzzyMatch('회주', '주간 회의록')).toBeNull();
  });
  it('초성 검색', () => {
    expect(fuzzyMatch('ㅁㅋㄷ', '마크다운 가이드')!.indices).toEqual([0, 1, 2]);
    expect(fuzzyMatch('ㄱㅇㄷ', '마크다운 가이드')!.indices).toEqual([5, 6, 7]);
    expect(fuzzyMatch('ㅎㅇ', '장보기')).toBeNull();
  });
});
