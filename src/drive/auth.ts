// 구글 로그인(Google Identity Services 토큰 방식). 서버·비밀키 없이 브라우저에서 액세스 토큰만 받는다.
// 권한 범위는 drive.file(이 앱이 만든 파일만)으로 가장 좁게.
// GIS 스크립트는 구글 로그인 서비스 자체라 번들에 넣을 수 없어 accounts.google.com 에서 불러온다(로그인할 때만).
import { AuthError } from './types';

export const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_SRC = 'https://accounts.google.com/gsi/client';

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(o?: { prompt?: string; login_hint?: string }): void;
}
interface GoogleOAuth2 {
  initTokenClient(o: {
    client_id: string;
    scope: string;
    callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): TokenClient;
  revoke(token: string, done?: () => void): void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GoogleOAuth2 } };
  }
}

let scriptPromise: Promise<void> | null = null;
/** 로그인 버튼을 누르기 전에 미리 불러 둔다(버튼 클릭 직후 팝업이 막히지 않도록) */
export function preloadGis() {
  if (navigator.onLine) void loadGis().catch(() => {});
}
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error('구글 로그인 도구를 불러오지 못했습니다. 인터넷 연결을 확인하세요.'));
    };
    document.head.append(s);
  });
  return scriptPromise;
}

interface Saved {
  token: string;
  exp: number;
  hint?: string;
}

// ---------- 페이지 이동 방식 로그인 ----------
// 일부 PC 브라우저(확장 프로그램·팝업 설정)에서는 로그인 팝업이 열리자마자 닫힌다.
// 그럴 때는 이 페이지에서 구글 로그인 화면으로 이동했다가 토큰을 들고 돌아온다(OAuth 토큰 방식, 서버 불필요).
// 돌아올 주소(리디렉션 URI)는 구글 콘솔의 "승인된 리디렉션 URI"에 등록해야 한다.

const REDIRECT_KEY = 'mynotes.oauthRedirect';
/** 한 번 페이지 이동 방식으로 로그인하면 이 기기에서는 계속 그 방식을 쓴다 */
const PREFER_REDIRECT_KEY = 'mynotes.loginRedirect';

export type RedirectIntent = 'connect' | 'relogin';
export interface RedirectResult {
  clientId: string;
  intent: RedirectIntent;
  error?: string;
}

/** 로그인 후 돌아올 주소(앱 첫 화면) */
export function redirectUri(): string {
  return location.origin + import.meta.env.BASE_URL;
}

export function prefersRedirect(): boolean {
  return localStorage.getItem(PREFER_REDIRECT_KEY) === '1';
}

/** 구글 로그인 화면으로 이동(돌아오면 consumeRedirect가 처리) */
export function signInRedirect(clientId: string, intent: RedirectIntent, prompt: '' | 'consent' | 'select_account' = '', hint?: string): void {
  const state = crypto.randomUUID();
  sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ state, clientId, intent, back: location.hash }));
  localStorage.setItem(PREFER_REDIRECT_KEY, '1');
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (prompt) p.set('prompt', prompt);
  if (hint) p.set('login_hint', hint);
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

let redirectResult: RedirectResult | null = null;

/**
 * 앱 시작 때(화면을 그리기 전에) 부른다. 주소 #에 구글이 붙여 준 토큰이 있으면 저장하고 주소를 원래대로 돌린다.
 * state 값이 이 기기에서 보낸 요청과 같을 때만 받아들인다(위조된 링크 방지).
 */
export function consumeRedirect(): void {
  const h = location.hash;
  if (!/^#(.*&)?(access_token|error)=/.test(h)) return;
  const p = new URLSearchParams(h.slice(1));
  let req: { state: string; clientId: string; intent: RedirectIntent; back?: string } | null = null;
  try {
    req = JSON.parse(sessionStorage.getItem(REDIRECT_KEY) ?? 'null');
  } catch {
    req = null;
  }
  sessionStorage.removeItem(REDIRECT_KEY);
  // 토큰이 주소에 남지 않게 바로 지운다
  history.replaceState(null, '', location.pathname + location.search + (req?.back ?? ''));
  if (!req || p.get('state') !== req.state) {
    redirectResult = { clientId: req?.clientId ?? '', intent: req?.intent ?? 'connect', error: '로그인 응답을 확인할 수 없습니다. 다시 시도하세요.' };
    return;
  }
  const err = p.get('error');
  if (err) {
    redirectResult = {
      clientId: req.clientId,
      intent: req.intent,
      error: err === 'access_denied' ? '로그인이 취소되었거나 허용되지 않았습니다.' : `로그인하지 못했습니다(${err}).`,
    };
    return;
  }
  const token = p.get('access_token');
  if (!token || !(p.get('scope') ?? SCOPE).includes(SCOPE)) {
    redirectResult = { clientId: req.clientId, intent: req.intent, error: '드라이브 권한을 받지 못했습니다. "허용"을 눌러 주세요.' };
    return;
  }
  const key = `mynotes.token.${req.clientId}`;
  let prev: Saved | null = null;
  try {
    prev = JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    prev = null;
  }
  const saved: Saved = { token, exp: Date.now() + Number(p.get('expires_in') ?? 3600) * 1000, hint: prev?.hint };
  localStorage.setItem(key, JSON.stringify(saved));
  redirectResult = { clientId: req.clientId, intent: req.intent };
}

/** 페이지 이동 로그인 결과(한 번만 꺼낼 수 있음) */
export function takeRedirectResult(): RedirectResult | null {
  const r = redirectResult;
  redirectResult = null;
  return r;
}

export class GoogleAuth {
  private client: TokenClient | null = null;
  private pending: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private saved: Saved | null = null;
  /** 토큰 상태가 바뀔 때(로그인/만료) */
  onChange: () => void = () => {};

  constructor(
    readonly clientId: string,
    private storageKey = `mynotes.token.${clientId}`,
  ) {
    try {
      this.saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null');
    } catch {
      this.saved = null;
    }
  }

  /** 지금 쓸 수 있는 토큰이 있는지(만료 1분 전까지) */
  get valid(): boolean {
    return !!this.saved?.token && Date.now() < this.saved.exp - 60_000;
  }

  get hint(): string | undefined {
    return this.saved?.hint;
  }

  setHint(email: string) {
    if (this.saved) {
      this.saved.hint = email;
      this.persist();
    }
  }

  /** 드라이브 요청에 쓸 토큰(없으면 AuthError: 화면에서 "다시 로그인"을 눌러야 함) */
  async getToken(): Promise<string> {
    if (this.valid) return this.saved!.token;
    throw new AuthError('구글 로그인이 만료되었습니다.');
  }

  /** 토큰 무효화(401을 받았을 때) */
  invalidate() {
    if (this.saved) {
      this.saved.exp = 0;
      this.persist();
    }
    this.onChange();
  }

  /**
   * 로그인 창을 띄워 토큰을 받는다. 반드시 버튼 클릭 같은 사용자 동작 안에서 불러야 한다
   * (브라우저가 그 외의 팝업을 막기 때문).
   * prompt: 처음엔 'consent', 다시 로그인할 땐 ''(이미 허용했으면 바로 닫힘)
   */
  async signIn(prompt: '' | 'consent' | 'select_account' = ''): Promise<void> {
    if (prefersRedirect()) {
      // 이 기기는 팝업이 안 되므로 바로 페이지 이동(돌아오면 앱이 새로 시작됨)
      this.signInRedirect('relogin', prompt);
      return new Promise<void>(() => {});
    }
    await loadGis();
    const oauth2 = window.google!.accounts!.oauth2!;
    this.client ??= oauth2.initTokenClient({
      client_id: this.clientId,
      scope: SCOPE,
      callback: (r) => {
        const p = this.pending;
        this.pending = null;
        if (r.error || !r.access_token) {
          p?.reject(new AuthError(r.error_description || r.error || '로그인하지 못했습니다.'));
          return;
        }
        this.saved = { token: r.access_token, exp: Date.now() + (r.expires_in ?? 3600) * 1000, hint: this.saved?.hint };
        this.persist();
        this.onChange();
        p?.resolve();
      },
      error_callback: (e) => {
        const p = this.pending;
        this.pending = null;
        const msg =
          e.type === 'popup_closed'
            ? '로그인 창이 닫혔습니다.'
            : e.type === 'popup_failed_to_open'
              ? '로그인 창이 차단되었습니다. 브라우저의 팝업 차단을 확인하세요.'
              : e.message || '로그인하지 못했습니다.';
        p?.reject(new AuthError(msg));
      },
    });
    return new Promise<void>((resolve, reject) => {
      this.pending?.reject(new AuthError('다른 로그인 요청으로 대체되었습니다.'));
      this.pending = { resolve, reject };
      this.client!.requestAccessToken({ prompt, login_hint: this.saved?.hint });
    });
  }

  /** 팝업 대신 페이지 이동으로 로그인 */
  signInRedirect(intent: RedirectIntent = 'relogin', prompt: '' | 'consent' | 'select_account' = '') {
    signInRedirect(this.clientId, intent, prompt, this.saved?.hint);
  }

  /** 로그아웃: 토큰을 취소하고 지운다 */
  async signOut(): Promise<void> {
    const t = this.saved?.token;
    this.saved = null;
    localStorage.removeItem(this.storageKey);
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t);
    this.onChange();
  }

  private persist() {
    if (this.saved) localStorage.setItem(this.storageKey, JSON.stringify(this.saved));
  }
}

/** 설정된 클라이언트 ID(앱에 입력한 값 → 배포 시 넣은 값 순) */
export function configuredClientId(): string {
  return localStorage.getItem('mynotes.clientId') || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '';
}

export function isValidClientId(id: string): boolean {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(id.trim());
}
