import { describe, expect, it } from 'vitest';
import { linkMention, linksTo, unlinkedMentions } from '../src/core/backlinks';
import { buildNameIndex } from '../src/core/links';

const idx = buildNameIndex([
  { id: 't', name: '회의', folderId: null, path: '' },
  { id: 'o', name: '회의', folderId: 'f', path: '업무' },
]);

describe('linksTo', () => {
  it('대상 노트로 해석되는 링크만, 문맥과 줄 번호', () => {
    const text = '첫 줄\n오늘 [[회의#안건|회의 안건]] 정리\n[[업무/회의]]';
    const ms = linksTo(text, 't', null, idx);
    expect(ms).toHaveLength(1);
    expect(ms[0].line).toBe(1);
    expect(ms[0].context).toBe('오늘 [[회의#안건|회의 안건]] 정리');
    expect(ms[0].context.slice(...ms[0].hl)).toBe('[[회의#안건|회의 안건]]');
  });
});

describe('unlinkedMentions', () => {
  it('링크·코드·URL 밖의 이름(조사 허용)', () => {
    const text = '회의를 했다. [[회의]] `회의` https://x.com/회의 [회의](u) 그리고 회의록';
    const ms = unlinkedMentions(text, '회의');
    expect(ms.map((m) => text.slice(m.from, m.to + 1))).toEqual(['회의를', '회의록']);
  });
  it('영문은 단어 경계', () => {
    const ms = unlinkedMentions('Plan and planning, PLAN.', 'plan');
    expect(ms).toHaveLength(2);
  });
  it('링크로 만들기', () => {
    const text = '어제 회의 메모';
    const m = unlinkedMentions(text, '회의')[0];
    expect(linkMention(text, m, '회의')).toBe('어제 [[회의]] 메모');
    expect(linkMention('PLAN!', { from: 0, to: 4 }, 'Plan')).toBe('[[Plan|PLAN]]!');
  });
});
