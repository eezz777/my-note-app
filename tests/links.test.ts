import { describe, expect, it } from 'vitest';
import {
  buildNameIndex,
  ensureBlockId,
  findBlocks,
  findHeadings,
  findLinks,
  findSection,
  linkKeys,
  linkNameFor,
  resolveName,
  rewriteLinks,
  type NoteRef,
} from '../src/core/links';

describe('findLinks', () => {
  it('링크·임베드·제목·별칭, 코드 안은 제외', () => {
    const t = '[[A]] ![[B#제목|300]] [[폴더/C#^abc|보기]]\n`[[코드]]`\n```\n[[블록]]\n```';
    const ls = findLinks(t);
    expect(ls.map((l) => [l.name, l.sub, l.alias, l.embed])).toEqual([
      ['A', null, null, false],
      ['B', '제목', '300', true],
      ['폴더/C', '^abc', '보기', false],
    ]);
  });
  it('색인 키는 노트 링크만(첨부 제외), 소문자', () => {
    expect(linkKeys('[[Note]] [[note#x]] ![[a.png]] [[v1.2 회의]]')).toEqual(['note', 'v1.2 회의']);
  });
});

const notes: NoteRef[] = [
  { id: '1', name: '회의', folderId: 'f1', path: '업무' },
  { id: '2', name: '회의', folderId: null, path: '' },
  { id: '3', name: '회의', folderId: 'f2', path: '개인/일기' },
  { id: '4', name: '유일', folderId: 'f2', path: '개인/일기' },
];
const idx = buildNameIndex(notes);

describe('resolveName', () => {
  it('같은 폴더 → 루트 순서', () => {
    expect(resolveName('회의', 'f1', idx)?.id).toBe('1');
    expect(resolveName('회의', 'fX', idx)?.id).toBe('2');
    expect(resolveName('유일', null, idx)?.id).toBe('4');
    expect(resolveName('없음', null, idx)).toBeNull();
  });
  it('경로 지정', () => {
    expect(resolveName('일기/회의', null, idx)?.id).toBe('3');
    expect(resolveName('개인/일기/회의.md', null, idx)?.id).toBe('3');
    expect(resolveName('업무/회의', null, idx)?.id).toBe('1');
    expect(resolveName('기/회의', null, idx)).toBeNull(); // 폴더 이름 일부만 일치하면 안 됨
  });
  it('가장 짧은 링크 이름', () => {
    expect(linkNameFor(notes[0], 'f1', idx)).toBe('회의');
    expect(linkNameFor(notes[0], null, idx)).toBe('업무/회의');
    expect(linkNameFor(notes[3], null, idx)).toBe('유일');
  });
});

const DOC = `---
tags: [a]
---
# 제목1
첫 문단 첫 줄
첫 문단 둘째 줄 ^p1

## 하위
- 항목 하나
- 항목 둘 ^li2

\`\`\`
# 코드 안 제목
코드 문단
\`\`\`
# 제목2
끝 문단`;

describe('제목·문단', () => {
  it('제목(코드 안 제외)', () => {
    expect(findHeadings(DOC).map((h) => `${h.level}:${h.text}:${h.line}`)).toEqual(['1:제목1:3', '2:하위:7', '1:제목2:15']);
  });
  it('블록', () => {
    expect(findBlocks(DOC).map((b) => `${b.startLine}-${b.line}:${b.id ?? ''}:${b.text}`)).toEqual([
      '4-5:p1:첫 문단 첫 줄\n첫 문단 둘째 줄',
      '8-8::- 항목 하나',
      '9-9:li2:- 항목 둘',
      '16-16::끝 문단',
    ]);
  });
  it('구간 찾기', () => {
    expect(findSection(DOC, '제목1')).toMatchObject({ startLine: 3, endLine: 14 });
    expect(findSection(DOC, '하위')!.text).toBe('## 하위\n- 항목 하나\n- 항목 둘 ^li2\n\n```\n# 코드 안 제목\n코드 문단\n```');
    expect(findSection(DOC, '^p1')!.text).toBe('첫 문단 첫 줄\n첫 문단 둘째 줄');
    expect(findSection(DOC, '^없음')).toBeNull();
    expect(findSection(DOC, null)!.startLine).toBe(3);
  });
  it('블록 ID 보장', () => {
    const r = ensureBlockId(DOC, 8, 'new1')!;
    expect(r.id).toBe('new1');
    expect(r.text.split('\n')[8]).toBe('- 항목 하나 ^new1');
    expect(ensureBlockId(DOC, 4)!.id).toBe('p1'); // 이미 있음(문단 첫 줄을 골라도)
    expect(ensureBlockId(DOC, 3)).toBeNull(); // 제목 줄
  });
});

describe('rewriteLinks', () => {
  it('이름만 바꾸고 #제목·|별칭·임베드는 유지', () => {
    const t = '[[회의]] [[회의#안건|보기]] ![[회의#^x]] [[다른]]';
    const out = rewriteLinks(t, (l) => (l.name === '회의' ? '정기 회의' : null));
    expect(out).toBe('[[정기 회의]] [[정기 회의#안건|보기]] ![[정기 회의#^x]] [[다른]]');
  });
});
