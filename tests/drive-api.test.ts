import { afterEach, describe, expect, it, vi } from 'vitest';
import { DriveApi, parseBatch } from '../src/drive/api';
import { AuthError } from '../src/drive/types';

afterEach(() => vi.unstubAllGlobals());

describe('parseBatch', () => {
  it('배치 응답을 항목별 상태·본문으로 나눈다', () => {
    const body = [
      '--batch_abc',
      'Content-Type: application/http',
      'Content-ID: <response-item0>',
      '',
      'HTTP/1.1 200 OK',
      'Content-Type: application/json; charset=UTF-8',
      '',
      '{"id":"A","name":"a.md"}',
      '--batch_abc',
      'Content-Type: application/http',
      'Content-ID: <response-item1>',
      '',
      'HTTP/1.1 404 Not Found',
      '',
      '{"error":{"code":404}}',
      '--batch_abc--',
    ].join('\r\n');
    const parts = parseBatch(body, 'multipart/mixed; boundary=batch_abc');
    expect(parts.map((p) => [p.contentId, p.status])).toEqual([
      ['response-item0', 200],
      ['response-item1', 404],
    ]);
    expect(parts[0].body).toEqual({ id: 'A', name: 'a.md' });
  });
});

describe('DriveApi 재시도', () => {
  it('429는 기다렸다 다시, 401은 로그인 만료로', async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'rate' } }), { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ startPageToken: '42' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const api = new DriveApi(async () => 'tok');
    const p = api.getStartPageToken();
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toBe('42');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer tok');
    vi.useRealTimers();

    const onUnauth = vi.fn();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    const api2 = new DriveApi(async () => 'old', onUnauth);
    await expect(api2.getStartPageToken()).rejects.toBeInstanceOf(AuthError);
    expect(onUnauth).toHaveBeenCalled();
  });

  it('없는 파일은 null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: 'nf' } }), { status: 404 })));
    expect(await new DriveApi(async () => 't').getMeta('x')).toBeNull();
  });
});
