<script lang="ts">
  import type { NoteMeta } from '../../core/types';
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { formatDate } from '../format';
  import { menuPos, noteMenu, setDragItem } from '../menus';
  import { swipeable } from '../swipe';

  let { note, showFolder = false }: { note: NoteMeta; showFolder?: boolean } = $props();
  const app = useApp();

  const active = $derived(app.openNoteId === note.id);
  const fav = $derived(app.favSet.has(note.id));
  const mode = $derived(app.device.viewMode);
  const folderName = $derived(note.folderId ? app.folderMap.get(note.folderId)?.name : null);

  // 본문 첫 이미지 썸네일(카드형·목록형에서만)
  let thumbUrl = $state<string | null>(null);
  $effect(() => {
    const name = note.thumb;
    const att = name ? app.findAttachment(name) : null;
    thumbUrl = null;
    if (!att || mode === 'compact') return;
    let alive = true;
    void app.attachmentUrl(att.name).then((u) => alive && (thumbUrl = u));
    return () => (alive = false);
  });

  function openMenu(e?: MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    void dialogs.menu(noteMenu(app, note), menuPos(app, e), note.name);
  }

  const selected = $derived(app.selectedSet.has(note.id));

  /** 터치로 길게 누르면 선택, 마우스 오른쪽 클릭은 메뉴 */
  function onContext(e: MouseEvent) {
    if (app.lastPointer === 'touch') {
      e.preventDefault();
      navigator.vibrate?.(15);
      app.toggleSelect(note.id);
    } else openMenu(e);
  }

  function onClick(e: MouseEvent) {
    if (e.shiftKey && (app.selecting || app.openNoteId)) {
      e.preventDefault();
      if (!app.selecting && app.openNoteId) app.toggleSelect(app.openNoteId);
      app.selectRange(note.id);
    } else if (e.ctrlKey || e.metaKey) {
      // PC: Ctrl/⌘ 클릭으로 여러 개 선택(처음엔 열려 있던 노트도 함께)
      if (!app.selecting && app.openNoteId && app.openNoteId !== note.id) app.toggleSelect(app.openNoteId);
      app.toggleSelect(note.id);
    } else if (app.selecting) app.toggleSelect(note.id);
    else app.open(note.id);
  }

  // 스와이프: 왼쪽 = 휴지통, 오른쪽 = 즐겨찾기
  let swipeDir = $state<'left' | 'right' | null>(null);
  let swipeRatio = $state(0);
</script>

<div class="swipe-wrap mode-{mode}" class:swiping={swipeDir}>
  {#if swipeDir}
    <div class="swipe-bg {swipeDir}" class:armed={swipeRatio >= 1} aria-hidden="true">
      {#if swipeDir === 'right'}
        <span class="sw-icon"><Icon name="star" filled={!fav} size={22} />{fav ? '즐겨찾기 해제' : '즐겨찾기'}</span>
      {:else}
        <span class="sw-icon">휴지통<Icon name="trash" size={22} /></span>
      {/if}
    </div>
  {/if}
<div
  class="card {mode}"
  class:active={active && !app.selecting}
  class:selected
  role="listitem"
  draggable={app.layout !== 'mobile' && (!app.selecting || selected)}
  ondragstart={(e) =>
    selected && app.selected.length > 1
      ? setDragItem(e, { type: 'notes', ids: app.selected })
      : setDragItem(e, { type: 'note', id: note.id })}
  oncontextmenu={onContext}
  use:swipeable={{
    enabled: () => !app.selecting,
    onLeft: () => void app.trashNote(note.id),
    onRight: () => void app.toggleFavorite(note.id),
    onDrag: (d, r) => {
      swipeDir = d;
      swipeRatio = r;
    },
  }}
>
  {#if app.selecting}
    <span class="check" class:on={selected} aria-hidden="true">{#if selected}<Icon name="check" size={16} />{/if}</span>
  {/if}
  <button class="main" onclick={onClick} aria-pressed={app.selecting ? selected : undefined}>
    <div class="title-row">
      {#if fav}<span class="pin" title="즐겨찾기"><Icon name="star" size={15} filled /></span>{/if}
      <span class="title">{note.name}</span>
      {#if mode === 'compact'}<span class="date">{formatDate(note.updatedAt)}</span>{/if}
    </div>
    {#if mode !== 'compact'}
      {#if note.preview}
        <p class="preview">{note.preview}</p>
      {:else}
        <p class="preview empty">내용 없음</p>
      {/if}
      {#if note.tags?.length}
        <div class="tags">
          {#each note.tags.slice(0, 3) as t (t)}<span class="tchip">#{t}</span>{/each}
          {#if note.tags.length > 3}<span class="tmore">+{note.tags.length - 3}</span>{/if}
        </div>
      {/if}
      <div class="meta">
        <span>{formatDate(note.updatedAt)}</span>
        {#if showFolder && folderName}
          <span class="folder"><Icon name="folder" size={13} />{folderName}</span>
        {/if}
      </div>
    {/if}
  </button>
  {#if thumbUrl}
    <img class="thumb" src={thumbUrl} alt="" loading="lazy" decoding="async" />
  {/if}
  {#if !app.selecting}
    <button class="more" aria-label="노트 메뉴" onclick={(e) => openMenu(e)}>
      <Icon name="more" size={18} />
    </button>
  {/if}
</div>
</div>

<style>
  .swipe-wrap {
    position: relative;
    border-radius: var(--radius);
  }
  .swipe-wrap.swiping {
    overflow: hidden;
  }
  .swipe-wrap.swiping .card {
    background: var(--surface);
  }
  .swipe-wrap.mode-list,
  .swipe-wrap.mode-compact {
    border-radius: 0;
  }
  .swipe-bg {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 22px;
    color: #fff;
    font-weight: 700;
    font-size: 14px;
    transition: background 0.15s;
  }
  .swipe-bg.right {
    justify-content: flex-start;
    background: color-mix(in srgb, #e0a63a 55%, var(--surface));
  }
  .swipe-bg.left {
    justify-content: flex-end;
    background: color-mix(in srgb, var(--danger) 55%, var(--surface));
  }
  .swipe-bg.right.armed {
    background: #e0a63a;
  }
  .swipe-bg.left.armed {
    background: var(--danger);
  }
  .sw-icon {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .check {
    flex: none;
    width: 24px;
    height: 24px;
    margin: 16px 0 0 14px;
    border-radius: 50%;
    border: 2px solid var(--text-3);
    display: grid;
    place-items: center;
    color: var(--on-accent);
  }
  .check.on {
    background: var(--accent);
    border-color: var(--accent);
  }
  .card.selected {
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
    box-shadow: 0 0 0 2px var(--accent), var(--shadow-1);
  }
  .card.list.selected,
  .card.compact.selected {
    box-shadow: none;
  }
  .card.compact .check {
    margin-top: 9px;
  }
  .card {
    position: relative;
    display: flex;
    align-items: flex-start;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-1);
    transition: box-shadow 0.15s, background 0.15s;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .card:hover {
    box-shadow: var(--shadow-2);
  }
  .card.active {
    box-shadow: 0 0 0 2px var(--accent), var(--shadow-1);
  }
  .main {
    flex: 1;
    min-width: 0;
    padding: 14px 4px 14px 16px;
    text-align: left;
  }
  .title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .title {
    flex: 1;
    font-weight: 650;
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pin {
    color: #e0a63a;
  }
  .preview {
    margin: 6px 0 0;
    color: var(--text-2);
    font-size: 14px;
    line-height: 1.5;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
  .preview.empty {
    color: var(--text-3);
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 8px;
    overflow: hidden;
    max-height: 24px;
  }
  .tchip {
    font-size: 12px;
    line-height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-strong);
    white-space: nowrap;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tmore {
    font-size: 12px;
    line-height: 22px;
    color: var(--text-3);
  }
  .meta {
    display: flex;
    gap: 12px;
    margin-top: 10px;
    font-size: 12px;
    color: var(--text-3);
  }
  .folder {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .date {
    font-size: 12px;
    color: var(--text-3);
    flex: none;
  }
  .thumb {
    flex: none;
    width: 64px;
    height: 64px;
    margin: 14px 0 14px 8px;
    border-radius: 10px;
    object-fit: cover;
    background: var(--surface-2);
  }
  .card.list .thumb {
    width: 52px;
    height: 52px;
  }
  .more {
    width: 40px;
    height: 44px;
    margin: 4px 4px 0 0;
    display: grid;
    place-items: center;
    color: var(--text-3);
    border-radius: 50%;
  }
  .more:hover {
    background: var(--hover);
  }

  /* 목록형: 그림자 대신 구분선 */
  .card.list,
  .card.compact {
    border-radius: 0;
    box-shadow: none;
    background: transparent;
    border-bottom: 1px solid var(--border);
  }
  .card.list .preview {
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }
  .card.list.active,
  .card.compact.active {
    background: var(--accent-soft);
    box-shadow: none;
  }
  .card.compact .main {
    padding: 10px 4px 10px 16px;
  }
  .card.compact .title {
    font-size: 15px;
    font-weight: 550;
  }
  .card.compact .more {
    height: 40px;
    margin-top: 0;
  }
</style>
