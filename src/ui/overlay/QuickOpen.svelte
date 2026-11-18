<script lang="ts">
  // 빠른 열기(Ctrl+P): 노트 이름 퍼지 검색, 한글 초성 검색. 없으면 새 노트 만들기, 전체 검색으로 넘기기.
  import { onMount, tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { fuzzyMatch } from '../../core/fuzzy';
  import { nameKey } from '../../core/names';
  import type { NoteMeta } from '../../core/types';

  const app = useApp();
  let q = $state('');
  let sel = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let listEl: HTMLDivElement | undefined = $state();

  type Item =
    | { kind: 'note'; note: NoteMeta; indices: number[]; path: string }
    | { kind: 'create'; name: string }
    | { kind: 'search'; q: string };

  const items = $derived.by<Item[]>(() => {
    const query = q.trim();
    const notes = app.liveNotes;
    let list: Item[];
    if (!query) {
      // 검색어가 없으면 최근 수정한 노트
      list = [...notes]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 30)
        .map((n) => ({ kind: 'note', note: n, indices: [], path: app.folderPathText(n.folderId) }));
    } else {
      const scored: { n: NoteMeta; s: number; idx: number[] }[] = [];
      for (const n of notes) {
        const m = fuzzyMatch(query, n.name);
        if (m) scored.push({ n, s: m.score, idx: m.indices });
        else {
          // 이름에 없으면 "폴더/이름"으로도 시도(점수는 낮게)
          const p = fuzzyMatch(query, app.folderPathText(n.folderId).replace(/ \/ /g, '/') + '/' + n.name);
          if (p) scored.push({ n, s: p.score - 200, idx: [] });
        }
      }
      scored.sort((a, b) => b.s - a.s || b.n.updatedAt - a.n.updatedAt);
      list = scored.slice(0, 50).map((x) => ({ kind: 'note', note: x.n, indices: x.idx, path: app.folderPathText(x.n.folderId) }));
      const exact = notes.some((n) => nameKey(n.name) === nameKey(query));
      // 초성만 친 경우(ㅁㅋㄷ)는 노트 이름으로 쓸 일이 없으니 만들기 제안 생략
      if (!exact && !/^[ㄱ-ㅎ\s]+$/.test(query)) list.push({ kind: 'create', name: query });
      list.push({ kind: 'search', q: query });
    }
    return list;
  });

  $effect(() => {
    void q;
    sel = 0;
  });

  onMount(() => {
    void tick().then(() => input?.focus());
  });

  function close() {
    app.quickOpen = false;
  }

  async function choose(it: Item) {
    close();
    if (it.kind === 'note') app.open(it.note.id);
    else if (it.kind === 'search') app.openSearch(it.q);
    else {
      const folder = app.currentFolderId();
      const created = await app.run(() => app.repo.createNote(folder, it.name));
      if (created) app.open(created.id);
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return; // 한글 조합 중 Enter는 글자 확정
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      sel = Math.min(items.length - 1, sel + 1);
      scrollSel();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, sel - 1);
      scrollSel();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (items[sel]) void choose(items[sel]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function scrollSel() {
    void tick().then(() => listEl?.querySelector('.sel')?.scrollIntoView({ block: 'nearest' }));
  }
</script>

{#snippet marked(text: string, idx: number[])}
  {#each [...text] as ch, i}{#if idx.includes(i)}<b>{ch}</b>{:else}{ch}{/if}{/each}
{/snippet}

<div class="scrim" role="presentation" onclick={close}></div>
<div class="qo" role="dialog" aria-label="빠른 열기">
  <div class="inbox">
    <Icon name="search" size={18} />
    <input bind:this={input} bind:value={q} onkeydown={onKey} placeholder="노트 이름으로 열기 (초성도 가능: ㅁㅋㄷ)" aria-label="노트 이름" enterkeyhint="go" />
    <kbd>Esc</kbd>
  </div>
  {#if !q.trim()}<div class="hint">최근 수정한 노트</div>{/if}
  <div class="list" bind:this={listEl} role="listbox">
    {#each items as it, i (it.kind === 'note' ? it.note.id : it.kind + i)}
      <button class="row" class:sel={i === sel} role="option" aria-selected={i === sel} onmouseenter={() => (sel = i)} onclick={() => choose(it)}>
        {#if it.kind === 'note'}
          <Icon name="note" size={17} />
          <span class="name">{@render marked(it.note.name, it.indices)}</span>
          <span class="path">{it.path}</span>
        {:else if it.kind === 'create'}
          <Icon name="plus" size={17} />
          <span class="name">새 노트 만들기: <b>{it.name}</b></span>
        {:else}
          <Icon name="search" size={17} />
          <span class="name">본문에서 "{it.q}" 검색</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 52;
    background: rgba(10, 15, 12, 0.3);
  }
  .qo {
    position: fixed;
    z-index: 53;
    left: 50%;
    top: max(8vh, env(safe-area-inset-top));
    transform: translateX(-50%);
    width: min(600px, calc(100vw - 20px));
    max-height: min(70dvh, 560px);
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border-radius: 18px;
    box-shadow: var(--shadow-2);
    overflow: hidden;
    animation: pop 0.14s ease-out;
  }
  .inbox {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    min-height: 54px;
    border-bottom: 1px solid var(--border);
    color: var(--text-3);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 17px;
    color: var(--text);
  }
  kbd {
    font-family: var(--mono);
    font-size: 11px;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 1px 6px;
  }
  .hint {
    padding: 8px 16px 2px;
    font-size: 12px;
    color: var(--text-3);
  }
  .list {
    overflow-y: auto;
    padding: 6px;
  }
  .row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: 10px;
    text-align: left;
    color: var(--text-2);
  }
  .row.sel {
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  .name {
    flex: 1;
    min-width: 0;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .name :global(b),
  .name b {
    color: var(--accent-strong);
  }
  .path {
    flex: none;
    max-width: 40%;
    font-size: 12px;
    color: var(--text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -6px);
    }
  }
</style>
