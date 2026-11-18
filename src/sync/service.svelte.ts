// 동기화 서비스: 언제 동기화할지 정하고(시작·포커스·온라인 복귀·60초마다·변경 3초 뒤·수동), 상태를 화면에 알린다.
import { SyncEngine, KV, type ConflictInfo, type SyncProgress } from './engine';
import { AuthError, OfflineError, type DriveLike } from '../drive/types';
import { preloadGis } from '../drive/auth';
import type { AppStore } from '../ui/state.svelte';

/** 로그인 기능(실제: GoogleAuth, 개발용 가짜도 같은 모양) */
export interface AuthLike {
  readonly valid: boolean;
  readonly hint?: string;
  onChange: () => void;
  signIn(prompt?: '' | 'consent' | 'select_account'): Promise<void>;
  signOut(): Promise<void>;
}

export type SyncState = 'idle' | 'syncing' | 'pending' | 'offline' | 'error' | 'auth';

const INTERVAL = 60_000;
const AFTER_CHANGE = 3_000;

export class SyncService {
  state = $state<SyncState>('idle');
  message = $state('');
  progress = $state<SyncProgress | null>(null);
  pending = $state(0);
  lastSync = $state<number | null>(null);
  initialDone = $state(true);
  email = $state('');

  readonly engine: SyncEngine;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private cleanup: (() => void)[] = [];

  constructor(
    private app: AppStore,
    readonly auth: AuthLike,
    readonly drive: DriveLike,
  ) {
    this.engine = new SyncEngine(app.repo, drive, {
      onProgress: (p) => (this.progress = p),
      onConflict: (c) => this.onConflict(c),
      beforePull: async () => {
        await app.editorFlush?.();
      },
      onSharedChanged: (s) => (app.shared = s),
    });
    this.email = auth.hint ?? '';
    auth.onChange = () => {
      if (!auth.valid && this.state !== 'syncing') this.setState('auth', '구글 로그인이 필요합니다.');
    };
  }

  async start() {
    preloadGis();
    this.initialDone = !!(await this.app.repo.db.kv.get(KV.initialDone))?.value;
    this.lastSync = ((await this.app.repo.db.kv.get(KV.lastSync))?.value as number | undefined) ?? null;
    const on = (t: EventTarget, ev: string, fn: () => void) => {
      t.addEventListener(ev, fn);
      this.cleanup.push(() => t.removeEventListener(ev, fn));
    };
    on(window, 'online', () => void this.syncNow());
    on(window, 'offline', () => this.setState('offline', '오프라인'));
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.syncNow();
    });
    on(window, 'focus', () => this.soon(500));
    this.interval = setInterval(() => void this.syncNow(), INTERVAL);
    await this.refreshPending();
    void this.syncNow();
  }

  stop() {
    this.cleanup.forEach((f) => f());
    if (this.interval) clearInterval(this.interval);
    if (this.timer) clearTimeout(this.timer);
  }

  /** 로컬에서 무언가 바뀌었을 때(노트 목록 갱신 시 호출) */
  onLocalChange() {
    void this.refreshPending().then(() => {
      if (this.pending > 0) this.soon(AFTER_CHANGE);
    });
  }

  private soon(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), ms);
  }

  private async refreshPending() {
    this.pending = await this.engine.pendingCount();
    if (this.state === 'idle' && this.pending > 0) this.state = 'pending';
    if (this.state === 'pending' && this.pending === 0) this.state = 'idle';
  }

  private setState(s: SyncState, msg = '') {
    this.state = s;
    this.message = msg;
  }

  async syncNow(manual = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!navigator.onLine) {
      this.setState('offline', '오프라인');
      await this.refreshPending();
      return;
    }
    if (!this.auth.valid) {
      this.setState('auth', '구글 로그인이 필요합니다.');
      await this.refreshPending();
      return;
    }
    this.setState('syncing');
    try {
      const r = await this.engine.sync();
      this.initialDone = true;
      this.lastSync = Date.now();
      await this.refreshPending();
      this.setState(this.pending ? 'pending' : 'idle');
      if (r.failed) this.setState('error', `일부 항목(${r.failed}개)을 동기화하지 못했습니다. 잠시 뒤 다시 시도합니다.`);
      if (manual) this.app.toast(r.failed ? `동기화 완료(실패 ${r.failed}개)` : '동기화했습니다.');
    } catch (e) {
      await this.refreshPending();
      if (e instanceof AuthError) this.setState('auth', e.message);
      else if (e instanceof OfflineError) this.setState('offline', '오프라인');
      else {
        console.error('동기화 오류', e);
        this.setState('error', e instanceof Error ? e.message : String(e));
        if (manual) this.app.toast(`동기화 오류: ${this.message}`, 'error');
      }
    }
  }

  /** "다시 로그인" 버튼(사용자 클릭 안에서 호출) */
  async relogin() {
    try {
      await this.auth.signIn('');
      await this.syncNow(true);
    } catch (e) {
      this.app.toast(e instanceof Error ? e.message : String(e), 'error');
    }
  }

  private onConflict(c: ConflictInfo) {
    const msg =
      c.kind === 'mine'
        ? `"${c.name}"을(를) 다른 기기에서 먼저 고쳤습니다. 이 기기에서 쓴 내용은 "${c.copyName}"에 따로 저장했습니다.`
        : `"${c.name}"을(를) 올리는 사이 다른 기기의 수정이 있었습니다. 그 내용은 "${c.copyName}"에 따로 저장했습니다.`;
    this.app.toast(msg, 'error', { label: '비교', run: () => (this.app.compare = { a: c.noteId, b: c.copyId }) }, 15000);
  }
}
