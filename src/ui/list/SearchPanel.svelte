<script lang="ts">
  // 전체 검색 화면(노트 목록 자리). 본문·제목·태그 통합 검색, 한글 부분 일치, 결과 미리보기와 하이라이트.
  import { tick } from 'svelte';
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import type { SearchResult } from '../../core/search';

  const app = useApp();
  const q = $derived(app.view.kind === 'search' ? app.view.q : '');

  let input: HTMLInputElement | undefined = $state();
  // 처음 값만 쓰고, 이후 동기화는 아래 $effect가 맡는다
  // svelte-ignore state_referenced_locally
  let value = $state(q);
  let results = $state<SearchResult[]>([]);
  let total = $state(0);
  let ms = $state(0);
  let busy = $state(false);
  let showHelp = $state(false);
  let seq = 0;

  // 주소(뒤로가기)로 검색어가 바뀌면 입력란도 맞춤
  $effect(() => {
    if (document.activeElement !== input) value = q;
  });

  // 포커스 요청(Ctrl+Shift+F, 검색 버튼)
  $effect(() => {
    void app.searchFocusSeq;
    void tick().then(() => {
      input?.focus();
      input?.select();
    });
  });

  // 검색 실행: 검색어나 노트 내용이 바뀌면 다시
  $effect(() => {
    const query = q;
    void app.notes; // 노트가 바뀌면 결과도 새로
    const my = ++seq;
    if (!query.trim()) {
      results = [];
      total = 0;
      return;
    }
    busy = true;
    const t = setTimeout(async () => {
      const r = await app.search!.search(query, 200);
      if (my !== seq) return;
      results = r.results;
      total = r.total;
      ms = r.ms;
      busy = false;
    }, 120);
    return () => clearTimeout(t);
  });

  function onInput() {
    app.setSearchQuery(value);
  }

  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Enter' && results[0]) openResult(results[0]);
    if (e.key === 'Escape') {
      value = '';
      app.setSearchQuery('');
    }
  }

  function openResult(r: SearchResult) {
    const line = r.snippets[0]?.line;
    if (line !== undefined) app.openAtLine(r.id, line);
    else app.open(r.id);
  }

  function addOp(op: string) {
    value = (value.trim() + ' ' + op).trimStart();
    app.setSearchQuery(value);
    input?.focus();
  }

  const folder = (p: string) => p.replace(/\//g, ' / ');
</script>

{#snippet hl(text: string, ranges: [number, number][])}
  {#each ranges as r, i}{text.slice(i === 0 ? 0 : ranges[i - 1][1], r[0])}<mark>{text.slice(r[0], r[1])}</mark>{/each}{text.slice(ranges.length ? ranges[ranges.length - 1][1] : 0)}
{/snippet}

<section class="search" aria-label="검색">
  <header class="bar">
    {#if app.sideAsDrawer}
      <button class="icon-btn" aria-label="메뉴 열기" onclick={() => (app.drawerOpen = true)}><Icon name="menu" /></button>
    {/if}
    <div class="box">
      <Icon name="search" size={18} />
      <input
        bind:this={input}
        bind:value
        oninput={onInput}
        onkeydown={onKey}
        type="search"
        enterkeyhint="search"
        placeholder="노트 검색 (제목·본문·태그)"
        aria-label="검색어"
      />
      {#if value}
        <button class="clear" aria-label="지우기" onclick={() => ((value = ''), app.setSearchQuery(''), input?.focus())}>✕</button>
      {/if}
    </div>
    <button class="icon-btn" class:active={showHelp} aria-label="검색 도움말" title="검색 도움말" onclick={() => (showHelp = !showHelp)}>?</button>
  </header>

  {#if showHelp || !value.trim()}
    <div class="help">
      <p>여러 단어는 <b>모두 포함</b>된 노트를 찾습니다. 한글은 일부만 써도 찾습니다.</p>
      <div class="ops">
        <button onclick={() => addOp('tag:')}><code>tag:업무</code> 태그</button>
        <button onclick={() => addOp('folder:')}><code>folder:프로젝트</code> 폴더</button>
        <button onclick={() => addOp('title:')}><code>title:회의</code> 제목</button>
        <button onclick={() => addOp('""')}><code>"주간 보고"</code> 구절</button>
        <button onclick={() => addOp('-')}><code>-취소</code> 제외</button>
      </div>
    </div>
  {/if}

  {#if value.trim()}
    <p class="summary" aria-live="polite">
      {#if busy && !results.length}찾는 중…{:else}노트 {total}개{#if total > results.length} (위 {results.length}개 표시){/if} · {ms}ms{/if}
    </p>
  {/if}

  <div class="items">
    {#each results as r (r.id)}
      <button class="result" onclick={() => openResult(r)} class:active={app.openNoteId === r.id}>
        <div class="title">{@render hl(r.title, r.titleRanges)}</div>
        <div class="meta">
          {#if r.path}<span class="folder"><Icon name="folder" size={12} />{folder(r.path)}</span>{/if}
          {#if r.hits}<span>본문 {r.hits}곳</span>{/if}
          {#each r.tags.slice(0, 3) as t (t)}<span class="tchip">#{t}</span>{/each}
        </div>
        {#each r.snippets as s (s.line + ':' + s.text)}
          <div class="snip">{@render hl(s.text, s.ranges)}</div>
        {/each}
      </button>
    {:else}
      {#if value.trim() && !busy}
        <div class="empty">
          <Icon name="search" size={36} />
          <p>"{value}"에 맞는 노트가 없습니다.</p>
        </div>
      {/if}
    {/each}
  </div>
</section>

<style>
  .search {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
  }
  .box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 6px 0 14px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text-3);
  }
  .box:focus-within {
    box-shadow: 0 0 0 2px var(--accent);
  }
  input {
    flex: 1;
    min-width: 0;
    border: 0;
    outline: none;
    background: none;
    font-size: 16px;
    color: var(--text);
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .clear {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--text-3);
  }
  .icon-btn.active {
    color: var(--accent);
  }
  .help {
    margin: 4px 14px 8px;
    font-size: 13px;
    color: var(--text-2);
  }
  .help p {
    margin: 4px 0 8px;
  }
  .ops {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ops button {
    min-height: 32px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-2);
    background: var(--surface);
  }
  .ops code {
    font-family: var(--mono);
    color: var(--accent-strong);
  }
  .summary {
    margin: 2px 16px 6px;
    font-size: 12px;
    color: var(--text-3);
  }
  .items {
    flex: 1;
    overflow-y: auto;
    padding: 4px 12px 80px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .result {
    display: block;
    width: 100%;
    text-align: left;
    padding: 12px 14px;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-1);
  }
  .result:hover {
    box-shadow: var(--shadow-2);
  }
  .result.active {
    box-shadow: 0 0 0 2px var(--accent), var(--shadow-1);
  }
  .title {
    font-weight: 650;
    font-size: 15px;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-3);
  }
  .folder {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .tchip {
    padding: 0 7px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    line-height: 20px;
  }
  .snip {
    margin-top: 6px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-2);
    word-break: break-word;
    white-space: pre-wrap;
  }
  mark {
    background: color-mix(in srgb, #f5d142 55%, transparent);
    color: inherit;
    border-radius: 3px;
    padding: 0 1px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 60px;
    color: var(--text-3);
  }
</style>
