<script lang="ts">
  // 화면 위쪽 안내: 로그인 만료(편집 내용은 안전) / 첫 동기화 진행률
  import { useApp } from './context';
  import { prefersRedirect } from '../drive/auth';

  const app = useApp();
  const s = $derived(app.sync);
  const p = $derived(s?.progress);
  const showInitial = $derived(!!s && !s.initialDone && !!p);
  const pct = $derived(p && p.total ? Math.round((p.done / p.total) * 100) : null);
  const phaseText = $derived(
    !p ? '' : p.phase === 'prepare' ? '드라이브 폴더 준비 중…' : p.phase === 'list' ? `노트 목록 받는 중… ${p.done ? p.done + '개' : ''}` : p.phase === 'download' ? `노트 내용 받는 중… ${p.done} / ${p.total}` : `올리는 중… ${p.done} / ${p.total}`,
  );
</script>

{#if s?.state === 'auth'}
  <div class="banner warn" role="alert">
    <span>구글 로그인이 만료되었습니다. 편집한 내용은 이 기기에 안전하게 저장되어 있고, 다시 로그인하면 이어서 동기화합니다.</span>
    <div class="actions">
      <button class="btn primary" onclick={() => s.relogin()}>다시 로그인</button>
      {#if s.auth.signInRedirect && !prefersRedirect()}
        <button class="link" onclick={() => s.loginByRedirect()}>로그인 창이 안 뜨나요?</button>
      {/if}
    </div>
  </div>
{:else if showInitial}
  <div class="banner" role="status">
    <div class="info">
      <b>구글드라이브와 처음 동기화하는 중</b>
      <span>{phaseText} · 중간에 앱을 닫아도 다음에 이어서 받습니다.</span>
      <div class="bar"><div class="fill" class:indet={pct === null} style:width={pct === null ? '30%' : `${pct}%`}></div></div>
    </div>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    z-index: 35;
    left: 50%;
    top: calc(8px + env(safe-area-inset-top));
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 16px));
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 12px 12px 16px;
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow-2);
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-2);
  }
  .banner.warn {
    border: 1.5px solid var(--danger);
  }
  .actions {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }
  .link {
    font-size: 12px;
    color: var(--text-3);
    text-decoration: underline;
    padding: 4px;
  }
  .info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .info b {
    color: var(--text);
  }
  .bar {
    height: 6px;
    border-radius: 999px;
    background: var(--surface-2);
    overflow: hidden;
    margin-top: 4px;
  }
  .fill {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 0.3s;
  }
  .fill.indet {
    animation: indet 1.2s ease-in-out infinite;
  }
  @keyframes indet {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(340%);
    }
  }
</style>
