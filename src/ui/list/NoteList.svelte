<script lang="ts">
  import Icon from '../Icon.svelte';
  import NoteCard from './NoteCard.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { folderMenu, menuPos, tagMenu } from '../menus';
  import { tagKey } from '../../core/tags';
  import type { SortKey, ViewMode } from '../../core/types';

  const app = useApp();
  const mobile = $derived(app.layout === 'mobile');
  const showFolder = $derived(app.view.kind !== 'folder');
  const currentFolder = $derived(
    app.view.kind === 'folder' && app.view.id ? app.folderMap.get(app.view.id) ?? null : null,
  );

  const SORTS: { key: SortKey; label: string }[] = [
    { key: 'updated', label: '수정한 날짜' },
    { key: 'created', label: '만든 날짜' },
    { key: 'name', label: '이름' },
  ];
  const VIEWS: { mode: ViewMode; label: string }[] = [
    { mode: 'card', label: '카드형' },
    { mode: 'list', label: '목록형' },
    { mode: 'compact', label: '촘촘히' },
  ];

  function sortMenu(e: MouseEvent) {
    const d = app.device;
    void dialogs.menu(
      [
        ...SORTS.map((s) => ({
          label: `${s.label}${d.sortKey === s.key ? (d.sortDir === 'desc' ? '  ↓' : '  ↑') : ''}`,
          icon: d.sortKey === s.key ? 'check' : undefined,
          run: () =>
            void app.setDevice(
              d.sortKey === s.key
                ? { sortDir: d.sortDir === 'desc' ? 'asc' : 'desc' }
                : { sortKey: s.key, sortDir: s.key === 'name' ? 'asc' : 'desc' },
            ),
        })),
        ...VIEWS.map((v) => ({
          label: `보기: ${v.label}`,
          icon: d.viewMode === v.mode ? 'check' : undefined,
          run: () => void app.setDevice({ viewMode: v.mode }),
        })),
      ],
      menuPos(app, e),
      '정렬 및 보기',
    );
  }

  async function moveSelected() {
    const res = await dialogs.pickFolder(`노트 ${app.selected.length}개 이동`);
    if (res) await app.moveSelected(res.id);
  }

  /** 태그 필터에 태그 더하기(많이 쓴 태그 순) */
  function addTag(e: MouseEvent) {
    const v = app.view;
    if (v.kind !== 'tags') return;
    const chosen = new Set(v.tags.map(tagKey));
    const items = app.tagList
      .filter((t) => !chosen.has(tagKey(t.name)))
      .slice(0, 40)
      .map((t) => ({ label: `#${t.name}  (${t.count})`, run: () => app.setTagFilter([...v.tags, t.name], v.mode) }));
    if (!items.length) {
      app.toast('더할 태그가 없습니다.');
      return;
    }
    void dialogs.menu(items, menuPos(app, e), '태그 더하기');
  }

  const viewIcon = $derived(
    app.device.viewMode === 'card' ? 'cards' : app.device.viewMode === 'list' ? 'list' : 'compact',
  );
</script>

<section class="list-pane" aria-label="노트 목록">
  {#if app.selecting}
    {@const allFav = app.selected.every((id) => app.favSet.has(id))}
    <header class="bar selbar">
      <button class="icon-btn" aria-label="선택 취소" title="선택 취소 (Esc)" onclick={() => app.clearSelection()}><Icon name="close" /></button>
      <span class="title">{app.selected.length}개 선택</span>
      <button class="icon-btn" aria-label="모두 선택" title="모두 선택" onclick={() => app.selectAll()}><Icon name="check" /></button>
      <button class="icon-btn" aria-label={allFav ? '즐겨찾기 해제' : '즐겨찾기'} title={allFav ? '즐겨찾기 해제' : '즐겨찾기'} onclick={() => app.favoriteSelected()}>
        <Icon name="star" filled={allFav} />
      </button>
      <button class="icon-btn" aria-label="이동" title="이동" onclick={moveSelected}><Icon name="move" /></button>
      <button class="icon-btn danger" aria-label="휴지통으로" title="휴지통으로" onclick={() => app.trashSelected()}><Icon name="trash" /></button>
    </header>
  {:else}
  <header class="bar">
    {#if app.sideAsDrawer}
      <button class="icon-btn" aria-label="메뉴 열기" onclick={() => (app.drawerOpen = true)}>
        <Icon name="menu" />
      </button>
    {/if}
    <h1 class="title">{app.viewTitle}</h1>
    <button class="icon-btn" aria-label="검색" title="검색 (Ctrl+Shift+F)" onclick={() => app.openSearch()}>
      <Icon name="search" />
    </button>
    <button class="icon-btn" aria-label="정렬 및 보기" title="정렬 및 보기" onclick={sortMenu}>
      <Icon name={viewIcon} />
    </button>
    {#if currentFolder}
      <button
        class="icon-btn"
        aria-label="폴더 메뉴"
        onclick={(e) => dialogs.menu(folderMenu(app, currentFolder), menuPos(app, e), currentFolder.name)}
      >
        <Icon name="more" />
      </button>
    {/if}
    {#if !mobile}
      <button class="icon-btn new" aria-label="새 노트" title="새 노트 (Ctrl+Alt+N)" onclick={() => app.newNote()}>
        <Icon name="plus" />
      </button>
    {/if}
  </header>
  {/if}

  {#if app.view.kind === 'tags'}
    {@const v = app.view}
    <div class="tagbar">
      {#each v.tags as t (t)}
        <span class="chip">
          <button class="chip-name" onclick={(e) => dialogs.menu(tagMenu(app, t), menuPos(app, e), `#${t}`)}>#{t}</button>
          <button
            class="chip-x"
            aria-label="#{t} 빼기"
            onclick={() => app.setTagFilter(v.tags.filter((x) => x !== t), v.mode)}>✕</button
          >
        </span>
      {/each}
      <button class="chip add" onclick={addTag}>＋ 태그</button>
      {#if v.tags.length > 1}
        <div class="seg" role="radiogroup" aria-label="태그 조합">
          <button role="radio" aria-checked={v.mode === 'and'} class:on={v.mode === 'and'} onclick={() => app.setTagFilter(v.tags, 'and')}>모두 포함</button>
          <button role="radio" aria-checked={v.mode === 'or'} class:on={v.mode === 'or'} onclick={() => app.setTagFilter(v.tags, 'or')}>하나라도</button>
        </div>
      {/if}
    </div>
  {/if}

  {#if currentFolder || app.view.kind === 'folder'}
    <p class="path">{currentFolder ? app.folderPathText(currentFolder.id) : '어느 폴더에도 속하지 않은 노트'}</p>
  {/if}

  <div class="items {app.device.viewMode}" role="list">
    {#each app.listNotes as note (note.id)}
      <NoteCard {note} {showFolder} />
    {:else}
      {#if app.loaded}
        <div class="empty">
          <Icon name="note" size={40} />
          <p>{app.view.kind === 'fav' ? '즐겨찾기한 노트가 없습니다.' : '노트가 없습니다.'}</p>
          {#if app.view.kind !== 'fav'}
            <button class="btn primary" onclick={() => app.newNote()}><Icon name="plus" size={18} /> 새 노트</button>
          {/if}
        </div>
      {/if}
    {/each}
  </div>

  {#if mobile && !app.selecting}
    <button class="fab" aria-label="새 노트" onclick={() => app.newNote()}>
      <Icon name="plus" size={28} />
    </button>
  {/if}
</section>

<style>
  .list-pane {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--bg);
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 8px 8px 4px 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
  }
  .title {
    flex: 1;
    margin: 0 0 0 8px;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.02em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .icon-btn.new {
    color: var(--accent);
  }
  .selbar {
    background: var(--accent-soft);
    border-radius: 0 0 18px 18px;
  }
  .selbar .title {
    color: var(--accent-strong);
    font-size: 18px;
  }
  .icon-btn.danger {
    color: var(--danger);
  }
  .tagbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 2px 14px 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-size: 14px;
    font-weight: 600;
  }
  .chip-name {
    padding: 0 4px 0 12px;
    min-height: 32px;
  }
  .chip-x {
    width: 28px;
    min-height: 32px;
    font-size: 12px;
    opacity: 0.7;
  }
  .chip.add {
    padding: 0 12px;
    background: transparent;
    border: 1.5px dashed var(--border);
    color: var(--text-2);
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 999px;
    padding: 2px;
    margin-left: auto;
  }
  .seg button {
    min-height: 28px;
    padding: 0 10px;
    border-radius: 999px;
    font-size: 13px;
    color: var(--text-2);
  }
  .seg button.on {
    background: var(--accent);
    color: var(--on-accent);
  }
  .path {
    margin: 0 16px 6px;
    font-size: 12px;
    color: var(--text-3);
  }
  .items {
    flex: 1;
    overflow-y: auto;
    padding: 6px 12px 96px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .items.list,
  .items.compact {
    gap: 0;
    padding-left: 4px;
    padding-right: 4px;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    margin-top: 80px;
    color: var(--text-3);
  }
  .fab {
    position: absolute;
    right: 20px;
    bottom: calc(24px + env(safe-area-inset-bottom));
    width: 60px;
    height: 60px;
    border-radius: 20px;
    display: grid;
    place-items: center;
    background: var(--accent);
    color: var(--on-accent);
    box-shadow: var(--shadow-2);
  }
  .fab:active {
    transform: scale(0.96);
  }
</style>
