<script lang="ts">
  import { useApp } from './context';
  const app = useApp();
</script>

<div class="toasts" aria-live="polite">
  {#each app.toasts as t (t.id)}
    <div class="toast" class:error={t.kind === 'error'} role={t.kind === 'error' ? 'alert' : 'status'}>
      <span class="txt">{t.text}</span>
      {#if t.action}
        <button
          class="act"
          onclick={() => {
            t.action?.run();
            app.dismiss(t.id);
          }}>{t.action.label}</button
        >
      {/if}
      <button class="x" aria-label="닫기" onclick={() => app.dismiss(t.id)}>✕</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    z-index: 60;
    left: 50%;
    bottom: calc(96px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: min(520px, calc(100vw - 24px));
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 16px;
    min-height: 48px;
    border-radius: 14px;
    background: #2a302c;
    color: #f1f4f2;
    box-shadow: var(--shadow-2);
    font-size: 14px;
    animation: up 0.18s ease-out;
  }
  .toast.error {
    background: #7d2420;
  }
  .txt {
    flex: 1;
    line-height: 1.45;
  }
  .act {
    color: #8fe0b8;
    font-weight: 700;
    padding: 0 10px;
    min-height: 40px;
  }
  .toast.error .act {
    color: #ffd2cf;
  }
  .x {
    width: 36px;
    height: 36px;
    opacity: 0.7;
  }
  @keyframes up {
    from {
      transform: translateY(12px);
      opacity: 0;
    }
  }
</style>
