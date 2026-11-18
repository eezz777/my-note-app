<script lang="ts">
  // 시작 화면: 저장 방식(구글드라이브 / 데모)을 고른다. 선택은 이 기기에 기억한다.
  import Workspace from './Workspace.svelte';
  import { AppStore } from './state.svelte';
  import { NotesDb, dbNameFor } from '../store/db';
  import { Repo } from '../store/repo';
  import { seedDemo } from '../demo/seed';
  import { seedDemoAssets } from '../demo/assets';
  import { GoogleAuth, configuredClientId, isValidClientId, preloadGis } from '../drive/auth';
  import { DriveApi } from '../drive/api';
  import { SyncService } from '../sync/service.svelte';

  const MODE_KEY = 'mynotes.mode';
  const ACCOUNT_KEY = 'mynotes.account';
  let app = $state<AppStore | null>(null);
  let error = $state<string | null>(null);
  let generation = $state(0);

  // 드라이브 연결 화면
  let showConnect = $state(false);
  let clientId = $state(configuredClientId());
  let connecting = $state(false);
  let connectError = $state('');

  async function startDemo() {
    try {
      const db = new NotesDb(dbNameFor('demo'));
      const repo = new Repo(db);
      if (!(await db.kv.get('seeded'))) await seedDemo(repo);
      await seedDemoAssets(repo).catch((e) => console.warn('샘플 첨부 생성 실패', e));
      await repo.ensureIndex();
      const store = new AppStore(repo);
      store.onResetDemo = async () => {
        store.stop();
        app = null;
        db.close();
        await NotesDb.delete(dbNameFor('demo'));
        history.replaceState(null, '', location.pathname);
        generation++;
        await startDemo();
      };
      store.onSwitchMode = switchMode;
      localStorage.setItem(MODE_KEY, 'demo');
      app = store;
    } catch (e) {
      console.error(e);
      error = `저장소를 열 수 없습니다: ${e instanceof Error ? e.message : e}. 브라우저의 시크릿 모드이거나 저장 공간이 부족할 수 있습니다.`;
    }
  }

  async function startDrive(account: string, cid: string) {
    try {
      const auth = new GoogleAuth(cid);
      const db = new NotesDb(dbNameFor({ account }));
      const repo = new Repo(db);
      await repo.ensureIndex();
      const store = new AppStore(repo);
      const api = new DriveApi(
        () => auth.getToken(),
        () => auth.invalidate(),
      );
      store.sync = new SyncService(store, auth, api);
      store.onSwitchMode = switchMode;
      store.onSignOut = async (wipe) => {
        store.stop();
        await auth.signOut();
        app = null;
        if (wipe) {
          db.close();
          await NotesDb.delete(dbNameFor({ account }));
        }
        localStorage.removeItem(MODE_KEY);
        localStorage.removeItem(ACCOUNT_KEY);
        history.replaceState(null, '', location.pathname);
      };
      localStorage.setItem(MODE_KEY, 'drive');
      localStorage.setItem(ACCOUNT_KEY, account);
      app = store;
    } catch (e) {
      console.error(e);
      error = `저장소를 열 수 없습니다: ${e instanceof Error ? e.message : e}`;
    }
  }

  /** 모드 바꾸기(설정 화면에서) */
  async function switchMode(to: 'demo' | 'connect') {
    app?.stop();
    app = null;
    history.replaceState(null, '', location.pathname);
    generation++;
    if (to === 'demo') await startDemo();
    else {
      localStorage.removeItem(MODE_KEY);
      openConnect();
    }
  }

  function openConnect() {
    showConnect = true;
    connectError = '';
    preloadGis();
  }

  /** "연결" 버튼: 로그인 창은 반드시 클릭 직후에 열려야 하므로 이 함수는 클릭에서 바로 부른다 */
  async function connect() {
    const cid = clientId.trim();
    if (!isValidClientId(cid)) {
      connectError = '클라이언트 ID 형식이 아닙니다. "숫자-문자.apps.googleusercontent.com" 형태여야 합니다.';
      return;
    }
    localStorage.setItem('mynotes.clientId', cid);
    connecting = true;
    connectError = '';
    try {
      const auth = new GoogleAuth(cid);
      await auth.signIn('consent');
      const me = await new DriveApi(() => auth.getToken()).about();
      auth.setHint(me.emailAddress);
      await startDrive(me.permissionId, cid);
      showConnect = false;
    } catch (e) {
      connectError = e instanceof Error ? e.message : String(e);
    } finally {
      connecting = false;
    }
  }

  /**
   * 개발 서버 전용: 가짜 드라이브(메모리)로 동기화 화면을 시험한다. 주소에 ?fakedrive
   * window.__fakeDrive 로 "다른 기기의 수정"을 흉내 낼 수 있다. 배포본에는 포함되지 않는다.
   */
  async function startFakeDrive() {
    const { FakeDrive } = await import('../drive/fake');
    const drive = new FakeDrive();
    (window as unknown as { __fakeDrive: unknown }).__fakeDrive = drive;
    const auth = {
      valid: true,
      hint: 'fake@example.com',
      onChange: () => {},
      async signIn() {
        this.valid = true;
      },
      async signOut() {
        this.valid = false;
      },
    };
    (window as unknown as { __fakeAuth: unknown }).__fakeAuth = auth;
    await NotesDb.delete('mynotes-fakedrive');
    const repo = new Repo(new NotesDb('mynotes-fakedrive'));
    const store = new AppStore(repo);
    store.sync = new SyncService(store, auth, drive);
    store.onSwitchMode = switchMode;
    app = store;
  }

  // 지난번 모드로 바로 시작
  const savedMode = localStorage.getItem(MODE_KEY);
  const fake = import.meta.env.DEV && new URLSearchParams(location.search).has('fakedrive');
  if (fake) void startFakeDrive();
  else if (savedMode === 'demo') void startDemo();
  else if (savedMode === 'drive') {
    const account = localStorage.getItem(ACCOUNT_KEY);
    const cid = configuredClientId();
    if (account && cid) void startDrive(account, cid);
  }
  const autoStarting = fake || savedMode === 'demo' || (savedMode === 'drive' && !!localStorage.getItem(ACCOUNT_KEY) && !!configuredClientId());
</script>

{#if app}
  {#key generation}
    <Workspace {app} />
  {/key}
{:else if error}
  <div class="welcome"><p class="err">{error}</p></div>
{:else if !autoStarting || showConnect || generation > 0}
  <div class="welcome">
    <div class="card">
      <svg viewBox="0 0 32 32" width="64" height="64" aria-hidden="true"
        ><rect x="3" y="3" width="26" height="26" rx="8" fill="var(--accent)" /><path
          d="M10 22V10l6 7 6-7v12"
          fill="none"
          stroke="#fff"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
      <h1>마이노트</h1>
      <p class="sub">내 구글드라이브에 저장하는 마크다운 노트</p>
      {#if showConnect}
        <label class="field">
          <span>구글 클라우드 <b>클라이언트 ID</b></span>
          <input
            class="text-input"
            bind:value={clientId}
            placeholder="123456789-abc...apps.googleusercontent.com"
            autocomplete="off"
            spellcheck="false"
            onkeydown={(e) => e.key === 'Enter' && !e.isComposing && connect()}
          />
          <small>만드는 방법은 README의 "3. 구글드라이브 연결 준비"를 보세요. 비밀값이 아니므로 공개되어도 괜찮습니다.</small>
        </label>
        {#if connectError}<p class="err">{connectError}</p>{/if}
        <button class="btn primary big" disabled={connecting} onclick={connect}>
          {connecting ? '로그인 창에서 계속하세요…' : '구글 계정으로 로그인'}
        </button>
        <button class="btn big outline" onclick={() => (showConnect = false)}>뒤로</button>
        <p class="note">권한은 "이 앱이 만든 파일만 보기·수정"(drive.file) 하나만 요청합니다. 다른 드라이브 파일에는 접근하지 않습니다.</p>
      {:else}
        <button class="btn primary big" onclick={openConnect}>구글드라이브 연결</button>
        <button class="btn big outline" onclick={startDemo}>데모 모드로 둘러보기</button>
        <p class="note">데모 모드는 샘플 노트가 들어 있으며, 이 기기 브라우저에만 저장됩니다.</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .welcome {
    min-height: 100dvh;
    display: grid;
    place-items: center;
    padding: 24px;
  }
  .card {
    width: min(420px, 100%);
    background: var(--surface);
    border-radius: 28px;
    box-shadow: var(--shadow-2);
    padding: 36px 28px 28px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  h1 {
    margin: 8px 0 0;
    font-size: 26px;
  }
  .sub {
    margin: 0 0 18px;
    color: var(--text-2);
  }
  .field {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
    font-size: 14px;
    color: var(--text-2);
  }
  .field small {
    color: var(--text-3);
    font-size: 12px;
    line-height: 1.5;
  }
  .big {
    width: 100%;
    min-height: 50px;
  }
  .outline {
    border: 1.5px solid var(--border);
  }
  .btn:disabled {
    opacity: 0.6;
    cursor: default;
  }
  .note {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--text-3);
    line-height: 1.5;
  }
  .err {
    color: var(--danger);
    font-size: 13px;
    margin: 0;
    line-height: 1.5;
  }
</style>
