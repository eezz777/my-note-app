<script lang="ts">
  // 사이드바 아래 동기화 상태: 동기화됨 / 대기 중 / 동기화 중 / 오프라인 / 오류 / 로그인 필요 + 지금 동기화
  import Icon from './Icon.svelte';
  import { useApp } from './context';
  import { formatDate } from './format';

  const app = useApp();
  const s = $derived(app.sync);

  // "2분 전" 같은 표시를 30초마다 갱신
  let now = $state(Date.now());
  $effect(() => {
    const t = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(t);
  });

  function ago(t: number | null) {
    if (!t) return '';
    const sec = Math.round((now - t) / 1000);
    if (sec < 60) return '방금';
    if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
    return formatDate(t);
  }

  const label = $derived.by(() => {
    if (!s) return '데모 모드 · 이 기기에만 저장';
    switch (s.state) {
      case 'syncing':
        return '동기화 중…';
      case 'pending':
        return `올릴 변경 ${s.pending}개 · 곧 동기화`;
      case 'offline':
        return s.pending ? `오프라인 · 변경 ${s.pending}개 대기(이 기기에 저장됨)` : '오프라인 · 이 기기에 저장됨';
      case 'auth':
        return '로그인 필요 · 변경은 이 기기에 저장됨';
      case 'error':
        return `동기화 오류: ${s.message}`;
      default:
        return `동기화됨${s.lastSync ? ' · ' + ago(s.lastSync) : ''}`;
    }
  });
  const color = $derived(
    !s ? '#e0a63a' : { idle: 'var(--accent)', syncing: '#3f7fd1', pending: '#e0a63a', offline: 'var(--text-3)', auth: 'var(--danger)', error: 'var(--danger)' }[s.state],
  );
</script>

<div class="status" title={s?.email ? `구글드라이브: ${s.email}` : label}>
  <span class="dot" class:spin={s?.state === 'syncing'} style:background={color}></span>
  <span class="txt">{label}</span>
  {#if s}
    {#if s.state === 'auth'}
      <button class="mini" onclick={() => s.relogin()}>다시 로그인</button>
    {:else}
      <button class="mini icon" aria-label="지금 동기화" title="지금 동기화" disabled={s.state === 'syncing'} onclick={() => s.syncNow(true)}>
        <Icon name="restore" size={16} />
      </button>
    {/if}
  {/if}
</div>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 4px 4px 12px;
    font-size: 12px;
    color: var(--text-3);
    min-height: 40px;
  }
  .txt {
    flex: 1;
    min-width: 0;
    line-height: 1.35;
  }
  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .dot.spin {
    animation: pulse 1s ease-in-out infinite;
  }
  .mini {
    flex: none;
    min-height: 32px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-strong);
    border: 1px solid var(--border);
  }
  .mini.icon {
    width: 36px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 0;
    color: var(--text-2);
  }
  .mini:disabled {
    opacity: 0.4;
  }
  @keyframes pulse {
    50% {
      opacity: 0.3;
    }
  }
</style>
