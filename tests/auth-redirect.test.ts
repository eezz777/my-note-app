// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { consumeRedirect, prefersRedirect, takeRedirectResult } from '../src/drive/auth';

const CID = '123-abc.apps.googleusercontent.com';

function pretendSent(state: string, back = '#/all') {
  sessionStorage.setItem('mynotes.oauthRedirect', JSON.stringify({ state, clientId: CID, intent: 'connect', back }));
}

describe('페이지 이동 로그인에서 돌아오기', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState(null, '', '/');
  });

  it('보낸 요청과 state가 같으면 토큰을 저장하고 주소에서 토큰을 지운다', () => {
    pretendSent('s1', '#/folder/f1');
    history.replaceState(null, '', '/#access_token=tok&token_type=Bearer&expires_in=3599&scope=https://www.googleapis.com/auth/drive.file&state=s1');
    consumeRedirect();
    expect(location.hash).toBe('#/folder/f1');
    const saved = JSON.parse(localStorage.getItem(`mynotes.token.${CID}`)!);
    expect(saved.token).toBe('tok');
    expect(saved.exp).toBeGreaterThan(Date.now() + 3500_000);
    expect(takeRedirectResult()).toEqual({ clientId: CID, intent: 'connect' });
    expect(takeRedirectResult()).toBeNull();
    expect(sessionStorage.getItem('mynotes.oauthRedirect')).toBeNull();
  });

  it('state가 다르면(위조된 링크) 토큰을 받지 않는다', () => {
    pretendSent('s1');
    history.replaceState(null, '', '/#access_token=evil&expires_in=3599&state=other');
    consumeRedirect();
    expect(localStorage.getItem(`mynotes.token.${CID}`)).toBeNull();
    expect(takeRedirectResult()?.error).toBeTruthy();
    expect(location.hash).not.toContain('evil');
  });

  it('요청 기록이 없으면 받지 않는다', () => {
    history.replaceState(null, '', '/#access_token=tok&state=s1');
    consumeRedirect();
    expect(localStorage.length).toBe(0);
    expect(takeRedirectResult()?.error).toBeTruthy();
  });

  it('거부하면 오류를 알려 준다', () => {
    pretendSent('s2');
    history.replaceState(null, '', '/#error=access_denied&state=s2');
    consumeRedirect();
    expect(takeRedirectResult()?.error).toContain('허용되지');
  });

  it('토큰이 없는 보통 주소는 건드리지 않는다', () => {
    history.replaceState(null, '', '/#/folder/abc/n/xyz');
    consumeRedirect();
    expect(location.hash).toBe('#/folder/abc/n/xyz');
    expect(takeRedirectResult()).toBeNull();
    expect(prefersRedirect()).toBe(false);
  });
});
