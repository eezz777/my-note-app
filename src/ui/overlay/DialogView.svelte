<script lang="ts" module>
  import type { DialogReq } from '../dialogs.svelte';
  /** 취소로 닫기(종류별 기본 응답) */
  export function cancelDialog(d: DialogReq) {
    if (d.kind === 'prompt') d.resolve(null);
    else if (d.kind === 'confirm') d.resolve(false);
    else if (d.kind === 'folder') d.resolve(null);
    else d.resolve();
  }
</script>

<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import FolderPicker from './FolderPicker.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import type { IconName } from '../icons';

  let { d }: { d: DialogReq } = $props();

  // 대화상자마다 새 컴포넌트가 만들어지므로 초기값만 쓰면 된다
  // svelte-ignore state_referenced_locally
  let input = $state(d.kind === 'prompt' ? d.value : '');
  let inputEl: HTMLInputElement | undefined = $state();
  let menuEl: HTMLDivElement | undefined = $state();
  let menuStyle = $state('');

  onMount(async () => {
    await tick();
    if (d.kind === 'prompt') {
      inputEl?.focus();
      inputEl?.select();
    }
    if (d.kind === 'menu' && d.at && menuEl) {
      // 화면 밖으로 나가지 않게 위치 보정
      const r = menuEl.getBoundingClientRect();
      const x = Math.max(8, Math.min(d.at.x, innerWidth - r.width - 8));
      const y = d.at.y + r.height > innerHeight - 8 ? Math.max(8, d.at.y - r.height) : d.at.y;
      menuStyle = `left:${x}px;top:${y}px`;
    }
  });

  const promptError = $derived(d.kind === 'prompt' && d.validate && input.trim() ? d.validate(input) : null);
  const cancel = () => cancelDialog(d);

  function submitPrompt(e: Event) {
    e.preventDefault();
    if (d.kind !== 'prompt' || !input.trim() || promptError) return;
    d.resolve(input.trim());
  }
</script>

{#if d.kind === 'menu'}
  <div class="scrim light" role="presentation" onclick={cancel} oncontextmenu={(e) => { e.preventDefault(); cancel(); }}></div>
  <div
    bind:this={menuEl}
    class="menu"
    class:sheet={!d.at}
    style={d.at ? menuStyle || `left:${d.at.x}px;top:${d.at.y}px;visibility:hidden` : ''}
    role="menu"
  >
    {#if !d.at && d.title}<div class="sheet-title">{d.title}</div>{/if}
    {#each d.items as item}
      <button
        class="menu-item"
        class:danger={item.danger}
        role="menuitem"
        disabled={item.disabled}
        onclick={() => {
          d.resolve();
          item.run();
        }}
      >
        <span class="mi-icon">{#if item.icon}<Icon name={item.icon as IconName} size={19} />{/if}</span>
        {item.label}
      </button>
    {/each}
  </div>
{:else}
  <div class="scrim" role="presentation" onclick={cancel}></div>
  <div class="dialog" class:wide={d.kind === 'settings' || d.kind === 'folder'} role="dialog" aria-modal="true">
    {#if d.kind === 'prompt'}
      <form onsubmit={submitPrompt}>
        <h2>{d.title}</h2>
        <input
          bind:this={inputEl}
          class="text-input"
          bind:value={input}
          placeholder={d.placeholder}
          aria-invalid={!!promptError}
          enterkeyhint="done"
        />
        <p class="err">{promptError ?? ''}</p>
        <div class="actions">
          <button type="button" class="btn" onclick={cancel}>취소</button>
          <button type="submit" class="btn primary" disabled={!input.trim() || !!promptError}>{d.okLabel ?? '확인'}</button>
        </div>
      </form>
    {:else if d.kind === 'confirm'}
      <h2>{d.title}</h2>
      <p class="msg">{d.message}</p>
      <div class="actions">
        <button class="btn" onclick={cancel}>{d.cancelLabel ?? '취소'}</button>
        <button class="btn primary" class:danger={d.danger} onclick={() => d.resolve(true)}>{d.okLabel ?? '확인'}</button>
      </div>
    {:else if d.kind === 'folder'}
      <FolderPicker req={d} oncancel={cancel} />
    {:else if d.kind === 'settings'}
      <SettingsPanel onclose={cancel} />
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(10, 15, 12, 0.38);
    z-index: 50;
    animation: fade 0.15s;
  }
  .scrim.light {
    background: transparent;
  }
  .dialog {
    position: fixed;
    z-index: 51;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(420px, calc(100vw - 32px));
    max-height: calc(100dvh - 48px);
    overflow: auto;
    background: var(--surface);
    border-radius: 22px;
    box-shadow: var(--shadow-2);
    padding: 22px 22px 14px;
    animation: pop 0.16s ease-out;
  }
  .dialog.wide {
    width: min(480px, calc(100vw - 24px));
    padding: 0;
  }
  h2 {
    margin: 0 0 14px;
    font-size: 18px;
  }
  .msg {
    color: var(--text-2);
    line-height: 1.6;
    margin: 0 0 8px;
    white-space: pre-line;
  }
  .err {
    min-height: 20px;
    margin: 6px 2px 0;
    font-size: 13px;
    color: var(--danger);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 8px;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .menu {
    position: fixed;
    z-index: 51;
    min-width: 200px;
    background: var(--surface);
    border-radius: 14px;
    box-shadow: var(--shadow-2);
    padding: 6px;
    animation: fade 0.1s;
  }
  .menu.sheet {
    left: 0;
    right: 0;
    bottom: 0;
    border-radius: 22px 22px 0 0;
    padding: 10px 10px calc(14px + env(safe-area-inset-bottom));
    animation: up 0.18s ease-out;
  }
  .sheet-title {
    padding: 8px 14px 10px;
    font-weight: 700;
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .menu-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    padding: 0 14px 0 8px;
    border-radius: 10px;
    text-align: left;
  }
  .menu.sheet .menu-item {
    min-height: 50px;
    font-size: 16px;
  }
  .menu-item:hover {
    background: var(--hover);
  }
  .menu-item.danger,
  .menu-item.danger .mi-icon {
    color: var(--danger);
  }
  .mi-icon {
    width: 22px;
    display: grid;
    place-items: center;
    color: var(--text-3);
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -48%) scale(0.97);
    }
  }
  @keyframes up {
    from {
      transform: translateY(40px);
      opacity: 0;
    }
  }
</style>
