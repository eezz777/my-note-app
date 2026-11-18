import { describe, expect, it } from 'vitest';
import { diffLines } from '../src/core/diff';

describe('diffLines', () => {
  it('바뀐 줄만 표시', () => {
    const d = diffLines('a\nb\nc\nd', 'a\nB\nc\nd\ne');
    expect(d.map((x) => `${x.kind[0]}:${x.text}`)).toEqual(['s:a', 'd:b', 'a:B', 's:c', 's:d', 'a:e']);
  });
  it('같으면 모두 same', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.kind === 'same')).toBe(true);
  });
});
