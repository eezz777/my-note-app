<script lang="ts">
  // 목차(현재 노트 제목들)와 백링크(이 노트를 가리키는 노트 + 링크 안 된 언급)
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { findHeadings } from '../../core/links';
  import { linkMention, linksTo, unlinkedMentions, type Mention } from '../../core/backlinks';
  import { nameKey } from '../../core/names';
  import type { NoteMeta } from '../../core/types';
  import { buildGraph, neighborhood } from '../../core/graph';
  import GraphCanvas from '../graph/GraphCanvas.svelte';

  let { note, text, ongo, onclose }: { note: NoteMeta; text: string; ongo: (line: number) => void; onclose?: () => void } = $props();
  const app = useApp();

  const tab = $derived(app.device.panelTab);
  const headings = $derived(findHeadings(text));
  const minLevel = $derived(Math.min(...headings.map((h) => h.level), 6));

  // ---------- 백링크 ----------
  interface Group {
    id: string;
    name: string;
    folder: string;
    items: Mention[];
  }
  let backlinks = $state<Group[]>([]);
  let loading = $state(false);
  let mentions = $state<Group[] | null>(null);
  let mentionsLoading = $state(false);

  // 이 노트를 가리킬 가능성이 있는 노트(링크 색인으로 먼저 거름)
  const candidates = $derived.by(() => {
    const k = nameKey(note.name);
    return app.liveNotes.filter((n) => n.id !== note.id && (n.links ?? []).some((l) => l.split('/').pop()!.trim() === k));
  });

  $effect(() => {
    if (tab !== 'backlinks') return;
    const id = note.id;
    const cands = candidates;
    const index = app.nameIndex;
    let alive = true;
    loading = true;
    void (async () => {
      const out: Group[] = [];
      for (const c of cands) {
        const t = await app.repo.getContent(c.id);
        const items = linksTo(t, id, c.folderId, index);
        if (items.length) out.push({ id: c.id, name: c.name, folder: app.folderPathText(c.folderId), items });
      }
      if (alive) {
        backlinks = out.sort((a, b) => a.name.localeCompare(b.name, 'ko'));
        loading = false;
      }
    })();
    return () => (alive = false);
  });

  // 노트가 바뀌면 언급 검색 결과 초기화
  $effect(() => {
    void note.id;
    mentions = null;
  });

  async function findMentions() {
    mentionsLoading = true;
    const others = app.liveNotes.filter((n) => n.id !== note.id);
    const contents = await app.repo.db.contents.bulkGet(others.map((n) => n.id));
    const out: Group[] = [];
    others.forEach((n, i) => {
      const items = unlinkedMentions(contents[i]?.text ?? '', note.name);
      if (items.length) out.push({ id: n.id, name: n.name, folder: app.folderPathText(n.folderId), items });
    });
    mentions = out;
    mentionsLoading = false;
  }

  async function makeLink(g: Group, m: Mention) {
    const done = await app.run(async () => {
      const t = await app.repo.getContent(g.id);
      // 그 사이 내용이 바뀌었으면 다시 찾아 같은 위치인지 확인
      if (t.slice(m.from, m.to).toLocaleLowerCase('ko') !== note.name.toLocaleLowerCase('ko')) throw new Error('노트 내용이 바뀌었습니다. 다시 찾아 주세요.');
      await app.repo.saveContent(g.id, linkMention(t, m, app.linkNameFor(note.id, app.noteById.get(g.id)?.folderId ?? null)));
      return true;
    });
    if (done) {
      app.toast(`"${g.name}"의 언급을 링크로 바꿨습니다.`);
      await findMentions();
    }
  }

  // ---------- 현재 노트 주변 그래프 ----------
  const localGraph = $derived(
    neighborhood(
      buildGraph(app.liveNotes, app.nameIndex, { tags: app.device.graphTags, missing: app.device.graphMissing }),
      note.id,
      app.device.graphDepth,
    ),
  );

  function openFromGraph(id: string) {
    if (id === note.id) return;
    onclose?.();
    app.open(id);
  }

  function openAt(id: string, line: number) {
    onclose?.();
    app.openAtLine(id, line);
  }
</script>

{#snippet hlText(m: Mention)}
  {m.context.slice(0, m.hl[0])}<mark>{m.context.slice(m.hl[0], m.hl[1])}</mark>{m.context.slice(m.hl[1])}
{/snippet}

<div class="panel">
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected={tab === 'outline'} class:on={tab === 'outline'} onclick={() => app.setDevice({ panelTab: 'outline' })}>목차</button>
    <button role="tab" aria-selected={tab === 'backlinks'} class:on={tab === 'backlinks'} onclick={() => app.setDevice({ panelTab: 'backlinks' })}>
      백링크{#if tab === 'backlinks' && !loading}<span class="n">{backlinks.reduce((s, g) => s + g.items.length, 0)}</span>{/if}
    </button>
    <button role="tab" aria-selected={tab === 'graph'} class:on={tab === 'graph'} onclick={() => app.setDevice({ panelTab: 'graph' })}>그래프</button>
    {#if onclose}<button class="icon-btn x" aria-label="닫기" onclick={onclose}><Icon name="close" /></button>{/if}
  </div>

  {#if tab === 'graph'}
    <div class="local-opts">
      <span>연결 단계</span>
      {#each [1, 2] as d (d)}
        <button class="seg" class:on={app.device.graphDepth === d} onclick={() => app.setDevice({ graphDepth: d as 1 | 2 })}>{d}</button>
      {/each}
      <span class="hint">{localGraph.nodes.length - 1}개 연결</span>
    </div>
    <div class="local-graph">
      {#key note.id}
        <GraphCanvas graph={localGraph} current={note.id} labelsAlways={localGraph.nodes.length <= 40} onopen={openFromGraph} ontag={(t) => {
          onclose?.();
          app.openTag(t);
        }} />
      {/key}
    </div>
  {:else}
  <div class="content">
    {#if tab === 'outline'}
      {#each headings as h (h.from)}
        <button class="outline-item" style:padding-left="{10 + (h.level - minLevel) * 14}px" class:top={h.level === minLevel} onclick={() => ongo(h.line)}>
          {h.text}
        </button>
      {:else}
        <p class="empty">제목(# 제목)이 없습니다.</p>
      {/each}
    {:else}
      <section>
        <h4>연결된 노트</h4>
        {#if loading}
          <p class="empty">찾는 중…</p>
        {:else}
          {#each backlinks as g (g.id)}
            <div class="group">
              <button class="gname" onclick={() => openAt(g.id, g.items[0].line)}><Icon name="note" size={15} /> {g.name}</button>
              {#if g.folder}<div class="gfolder">{g.folder}</div>{/if}
              {#each g.items as m (m.from)}
                <button class="ctx" onclick={() => openAt(g.id, m.line)}>{@render hlText(m)}</button>
              {/each}
            </div>
          {:else}
            <p class="empty">이 노트를 가리키는 링크가 없습니다.</p>
          {/each}
        {/if}
      </section>
      <section>
        <h4>링크 안 된 언급</h4>
        {#if mentions === null}
          <button class="btn find" onclick={findMentions} disabled={mentionsLoading}>
            {mentionsLoading ? '찾는 중…' : `"${note.name}" 언급 찾기`}
          </button>
        {:else}
          {#each mentions as g (g.id)}
            <div class="group">
              <button class="gname" onclick={() => openAt(g.id, g.items[0].line)}><Icon name="note" size={15} /> {g.name}</button>
              {#each g.items as m (m.from)}
                <div class="mrow">
                  <button class="ctx" onclick={() => openAt(g.id, m.line)}>{@render hlText(m)}</button>
                  <button class="linkit" title="[[링크]]로 만들기" onclick={() => makeLink(g, m)}>링크</button>
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty">언급이 없습니다.</p>
          {/each}
        {/if}
      </section>
    {/if}
  </div>
  {/if}
</div>

<style>
  .panel {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 10px;
    border-bottom: 1px solid var(--border);
  }
  .tabs button[role='tab'] {
    min-height: 34px;
    padding: 0 12px;
    border-radius: 999px;
    color: var(--text-2);
    font-weight: 600;
    font-size: 14px;
  }
  .tabs button.on {
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  .n {
    margin-left: 6px;
    font-size: 12px;
    opacity: 0.8;
  }
  .x {
    margin-left: auto;
  }
  .content {
    flex: 1;
    overflow-y: auto;
    padding: 8px 8px 40px;
  }
  .outline-item {
    display: block;
    width: 100%;
    text-align: left;
    min-height: 36px;
    padding: 6px 10px;
    border-radius: 8px;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.4;
  }
  .outline-item.top {
    color: var(--text);
    font-weight: 600;
  }
  .outline-item:hover {
    background: var(--hover);
  }
  section + section {
    margin-top: 18px;
  }
  h4 {
    margin: 6px 6px 8px;
    font-size: 12px;
    color: var(--text-3);
    letter-spacing: 0.04em;
  }
  .group {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 6px;
    margin-bottom: 8px;
  }
  .gname {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    min-height: 34px;
    padding: 0 6px;
    font-weight: 650;
    font-size: 14px;
    text-align: left;
    color: var(--accent-strong);
  }
  .gfolder {
    font-size: 11px;
    color: var(--text-3);
    padding: 0 8px 4px 27px;
  }
  .ctx {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    border-radius: 8px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--text-2);
    word-break: break-word;
  }
  .ctx:hover {
    background: var(--hover);
  }
  .ctx :global(mark) {
    background: color-mix(in srgb, #f5d142 50%, transparent);
    color: inherit;
    border-radius: 3px;
  }
  .mrow {
    display: flex;
    align-items: flex-start;
    gap: 4px;
  }
  .linkit {
    flex: none;
    min-height: 30px;
    padding: 0 10px;
    margin-top: 3px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 12px;
    color: var(--accent-strong);
  }
  .find {
    width: 100%;
    border: 1.5px dashed var(--border);
  }
  .local-opts {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px 4px;
    font-size: 13px;
    color: var(--text-3);
  }
  .seg {
    min-width: 32px;
    min-height: 28px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-2);
  }
  .seg.on {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-strong);
    font-weight: 600;
  }
  .hint {
    margin-left: auto;
  }
  .local-graph {
    flex: 1;
    min-height: 260px;
    position: relative;
  }
  .empty {
    color: var(--text-3);
    font-size: 13px;
    padding: 6px 8px;
    margin: 0;
  }
</style>
