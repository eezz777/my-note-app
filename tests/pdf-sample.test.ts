import { describe, expect, it } from 'vitest';
import { makeSamplePdf } from '../src/demo/assets';

describe('샘플 PDF', () => {
  it('xref 오프셋이 실제 객체 위치와 맞는다', async () => {
    const text = await makeSamplePdf().text();
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const entries = text.slice(xrefAt).split('\n').slice(3).filter((l) => / n $/.test(l));
    entries.forEach((line, i) => {
      const off = Number(line.slice(0, 10));
      expect(text.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
    expect((text.match(/\/Type \/Page /g) ?? []).length).toBe(3);
  });
});
