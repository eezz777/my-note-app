<script lang="ts">
  // 모든 노트의 관계 그래프 화면(사이드바 "그래프")
  import Icon from '../Icon.svelte';
  import GraphCanvas from './GraphCanvas.svelte';
  import { useApp } from '../context';
  import { buildGraph } from '../../core/graph';

  const app = useApp();

  const graph = $derived(buildGraph(app.liveNotes, app.nameIndex, { tags: app.device.graphTags, missing: app.device.graphMissing }));
  const noteCount = $derived(graph.nodes.filter((n) => n.kind === 'note').length);
  const linkCount = $derived(graph.edges.filter((e) => e.kind === 'link').length);
</script>

<section class="graph-page" aria-label="그래프">
  <header class="bar">
    {#if app.sideAsDrawer}
      <button class="icon-btn" aria-label="메뉴 열기" onclick={() => (app.drawerOpen = true)}>
        <Icon name="menu" />
      </button>
    {/if}
    <h1 class="title">그래프</h1>
    <span class="count">노트 {noteCount} · 링크 {linkCount}</span>
  </header>
  <div class="opts">
    <label class="chip" class:on={app.device.graphTags}>
      <input type="checkbox" checked={app.device.graphTags} onchange={(e) => app.setDevice({ graphTags: e.currentTarget.checked })} />
      태그
    </label>
    <label class="chip" class:on={app.device.graphMissing}>
      <input type="checkbox" checked={app.device.graphMissing} onchange={(e) => app.setDevice({ graphMissing: e.currentTarget.checked })} />
      없는 노트
    </label>
  </div>
  <div class="canvas">
    {#if graph.nodes.length}
      <GraphCanvas {graph} current={app.openNoteId} onopen={(id) => app.open(id)} ontag={(t) => app.openTag(t)} />
    {:else}
      <div class="empty">
        <Icon name="graph" size={40} />
        <p>노트가 없습니다.</p>
      </div>
    {/if}
  </div>
</section>

<style>
  .graph-page {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
  }
  .title {
    margin: 0 0 0 8px;
    font-size: 20px;
    font-weight: 700;
  }
  .count {
    margin-left: auto;
    padding-right: 8px;
    font-size: 13px;
    color: var(--text-3);
  }
  .opts {
    display: flex;
    gap: 6px;
    padding: 0 14px 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 0 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-2);
    cursor: pointer;
    user-select: none;
  }
  .chip input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }
  .chip.on {
    background: var(--accent-soft);
    border-color: transparent;
    color: var(--accent-strong);
    font-weight: 600;
  }
  .chip:has(input:focus-visible) {
    outline: 2px solid var(--accent);
  }
  .canvas {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 80px;
    color: var(--text-3);
  }
</style>
