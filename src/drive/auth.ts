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
