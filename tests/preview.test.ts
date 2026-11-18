import { describe, expect, it } from 'vitest';
import { makePreview } from '../src/core/preview';

describe('makePreview', () => {
  it('마크다운 기호·표 구분선을 걷어 낸다', () => {
    const t = '---\ntags: [a]\n---\n# 제목\n| 이름 | 설명 |\n| --- | :---: |\n| 굵게 | **x** |\n- [ ] 할 일 ^abc\n> [!note] 콜아웃\n[[노트|별칭]] ![[a.png]]';
    expect(makePreview(t)).toBe('제목 이름 설명 굵게 x 할 일 콜아웃 별칭');
  });
});
