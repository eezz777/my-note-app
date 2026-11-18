import { describe, expect, it, vi } from 'vitest';
import { AutoSaver } from '../src/ui/editor/autosave';

describe('AutoSaver', () => {
  it('입력이 멈춘 뒤 한 번만 저장한다', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue(true);
    const s = new AutoSaver(save, () => {}, 1000);
    s.schedule('a', '1');
    s.schedule('a', '12');
    s.schedule('a', '123');
    await vi.advanceTimersByTimeAsync(1100);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('a', '123');
    vi.useRealTimers();
  });

  it('노트를 빠르게 바꿔도 두 노트 모두 저장한다', async () => {
    const save = vi.fn().mockResolvedValue(true);
    const s = new AutoSaver(save, () => {});
    s.schedule('a', 'A');
    s.schedule('b', 'B');
    await s.flush();
    expect(save.mock.calls).toEqual([
      ['a', 'A'],
      ['b', 'B'],
    ]);
  });

  it('저장에 실패하면 내용을 보존하고 재시도한다', async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockRejectedValueOnce(new Error('디스크 오류')).mockResolvedValue(true);
    const states: string[] = [];
    const s = new AutoSaver(save, (st) => states.push(st));
    s.schedule('a', '중요한 내용');
    await s.flush();
    expect(s.hasPending()).toBe(true);
    await vi.advanceTimersByTimeAsync(1100);
    expect(save).toHaveBeenLastCalledWith('a', '중요한 내용');
    expect(s.hasPending()).toBe(false);
    expect(states).toContain('error');
    expect(states.at(-1)).toBe('saved');
    vi.useRealTimers();
  });
});
