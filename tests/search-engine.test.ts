import { describe, expect, it, vi } from 'vitest';
import { SearchEngine } from '../src/search/engine';

describe('SearchEngine 증분 갱신', () => {
  it('바뀐 노트만 본문을 다시 읽고, 없어진 노트는 뺀다', async () => {
    const bodies: Record<string, string> = { a: '사과 회의', b: '바나나' };
    const load = vi.fn(async (ids: string[]) => ids.map((id) => bodies[id]));
    const e = new SearchEngine(load);
    const meta = (id: string, u: number, title = id) => ({ id, title, path: '', tags: [], updatedAt: u });

    await e.sync([meta('a', 1), meta('b', 1)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await e.search('회의')).results.map((r) => r.id)).toEqual(['a']);

    // 이름만 바뀜: 본문 재로딩 없음
    await e.sync([meta('a', 1, '새 이름'), meta('b', 1)]);
    expect(load).toHaveBeenCalledTimes(1);
    expect((await e.search('새 이름')).results.map((r) => r.id)).toEqual(['a']);

    // b 본문 변경 + a 삭제
    bodies.b = '바나나 회의';
    await e.sync([meta('b', 2)]);
    expect(load).toHaveBeenLastCalledWith(['b']);
    expect((await e.search('회의')).results.map((r) => r.id)).toEqual(['b']);
    expect(e.size).toBe(1);
  });
});
