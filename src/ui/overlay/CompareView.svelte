<script lang="ts">
  // 충돌 비교·병합: 원본 노트(a)와 충돌 사본(b)을 나란히 보여 주고 고르게 한다.
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { diffLines } from '../../core/diff';

  const app = useApp();
  const ids = $derived(app.compare);
  let a = $state('');
  let b = $state('');
  let tab = $state<'diff' | 'a' | 'b'>('diff');
  let merged = $state('');
  let editing = $state(false);

  const noteA = $derived(ids ? app.noteById.get(ids.a) : null);
  const noteB = $derived(ids ? app.noteById.get(ids.b) : null);
  const diff = $derived(diffLines(a, b));

  $effect(() => {
    const cur = ids;
    if (!cur) return;
    void (async () => {
      a = await app.repo.getContent(cur.a);
      b = await app.repo.getContent(cur.b);
      merged = b;
      editing = false;
    })();
  });

  const close = () => (app.compare = null);

  async function keepA() {
    if (!ids) return;
    await app.run(() => app.repo.trashNote(ids.b));
    app.toast(`"${noteA?.name}"을(를) 유지하고 사본은 휴지통으로 옮겼습니다.`);
    close();
  }

  async function useText(t: string, label: string) {
    if (!ids) return;
    const target = ids;
    await app.run(async () => {
      await app.repo.saveContent(target.a, t);
      await app.repo.trashNote(target.b);
    });
    app.toast(`${label} 내용을 "${noteA?.name}"에 저장하고 사본은 휴지통으로 옮겼습니다.`);
    close();
    app.open(target.a);
  }
</script>

{#if ids && noteA && noteB}
  <div class="scrim" role="presentation" onclick={close}></div>
  <div class="cmp" role="dialog" aria-label="충돌 비교">
    <header>
      <h2>충돌 비교</h2>
      <button class="icon-btn" aria-label="닫기" onclick={close}><Icon name="close" /></button>
    </header>
    <p class="desc">
      <span class="tag a">원본</span> {noteA.name}<br />
      <span class="tag b">사본</span> {noteB.name}
    </p>
    <div class="tabs" role="tablist">
      <button role="tab" aria-selected={tab === 'diff'} class:on={tab === 'diff'} onclick={() => (tab = 'diff')}>바뀐 줄</button>
      <button role="tab" aria-selected={tab === 'a'} class:on={tab === 'a'} onclick={() => (tab = 'a')}>원본 전체</button>
      <button role="tab" aria-selected={tab === 'b'} class:on={tab === 'b'} onclick={() => (tab = 'b')}>사본 전체</button>
    </div>
    <div class="body">
      {#if editing}
        <textarea class="merge" bind:value={merged} aria-label="합친 내용"></textarea>
      {:else if tab === 'diff'}
        <div class="diff">
          {#each diff as l, i (i)}
            <div class="dl {l.kind}"><span class="sign">{l.kind === 'del' ? '−' : l.kind === 'add' ? '+' : ' '}</span>{l.text || ' '}</div>
          {/each}
        </div>
        <p class="legend"><span class="dl del">− 원본에만 있음</span> <span class="dl add">+ 사본에만 있음</span></p>
      {:else}
        <pre class="full">{tab === 'a' ? a : b}</pre>
      {/if}
    </div>
    <footer>
      {#if editing}
        <button class="btn" onclick={() => (editing = false)}>취소</button>
        <button class="btn primary" onclick={() => useText(merged, '합친')}>합친 내용 저장</button>
      {:else}
        <button class="btn" onclick={close}>둘 다 유지</button>
        <button class="btn" onclick={() => (editing = true)}>직접 합치기</button>
        <button class="btn" onclick={keepA}>원본 유지</button>
        <button class="btn primary" onclick={() => useText(b, '사본')}>사본으로 바꾸기</button>
      {/if}
    </footer>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 57;
    background: rgba(10, 15, 12, 0.4);
  }
  .cmp {
    position: fixed;
    z-index: 58;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(860px, calc(100vw - 16px));
    height: min(86dvh, 760px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 20px;
    box-shadow: var(--shadow-2);
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    padding: 10px 10px 0 20px;
  }
  h2 {
    flex: 1;
    margin: 0;
    font-size: 18px;
  }
  .desc {
    margin: 6px 20px 8px;
    font-size: 13px;
    color: var(--text-2);
    line-height: 1.8;
  }
  .tag {
    display: inline-block;
    padding: 0 8px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 700;
    color: #fff;
  }
  .tag.a {
    background: var(--danger);
  }
  .tag.b {
    background: var(--accent);
  }
  .tabs {
    display: flex;
    gap: 4px;
    padding: 0 16px 8px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 999px;
    font-size: 13px;
    color: var(--text-2);
  }
  .tabs button.on {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .body {
    flex: 1;
    overflow: auto;
    padding: 10px 14px;
  }
  .diff,
  .full {
    font-family: var(--mono);
    font-size: 13px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    margin: 0;
  }
  .dl {
    padding: 0 6px;
    border-radius: 4px;
  }
  .dl.del {
    background: color-mix(in srgb, var(--danger) 16%, transparent);
  }
  .dl.add {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .sign {
    display: inline-block;
    width: 1.4em;
    color: var(--text-3);
  }
  .legend {
    font-size: 12px;
    color: var(--text-3);
    display: flex;
    gap: 10px;
  }
  .merge {
    width: 100%;
    height: 100%;
    min-height: 300px;
    font-family: var(--mono);
    font-size: 13px;
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 10px;
    background: var(--surface-2);
    resize: none;
  }
  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 6px;
    padding: 10px 14px calc(12px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--border);
  }
</style>
