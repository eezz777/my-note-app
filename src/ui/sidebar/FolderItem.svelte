<script lang="ts">
  import type { FolderNode } from '../../core/tree';
  import Icon from '../Icon.svelte';
  import FolderItem from './FolderItem.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { dropOnFolder, folderMenu, hasDragItem, menuPos, setDragItem } from '../menus';

  let { node }: { node: FolderNode } = $props();
  const app = useApp();

  let dragOver = $state(false);
  const f = $derived(node.folder);
  const expanded = $derived(app.device.expanded.includes(f.id));
  const active = $derived(app.view.kind === 'folder' && app.view.id === f.id);
  const count = $derived(app.folderCounts.get(f.id) ?? 0);

  function openMenu(e?: MouseEvent) {
    e?.preventDefault();
    void dialogs.menu(folderMenu(app, f), menuPos(app, e), f.name);
  }
</script>

<div
  class="row"
  class:active
  class:drag-over={dragOver}
  style:padding-left="{8 + node.depth * 16}px"
  role="treeitem"
  aria-selected={active}
  aria-expanded={node.children.length ? expanded : undefined}
  tabindex="-1"
  draggable={app.layout !== 'mobile'}
  ondragstart={(e) => setDragItem(e, { type: 'folder', id: f.id })}
  ondragover={(e) => {
    if (hasDragItem(e)) {
      e.preventDefault();
      dragOver = true;
    }
  }}
  ondragleave={() => (dragOver = false)}
  ondrop={(e) => {
    e.preventDefault();
    dragOver = false;
    void dropOnFolder(app, e, f.id);
  }}
  oncontextmenu={openMenu}
>
  <button
    class="twisty"
    class:open={expanded}
    class:hidden={!node.children.length}
    aria-label={expanded ? '접기' : '펼치기'}
    onclick={() => app.toggleExpanded(f.id)}
  >
    <Icon name="chevron" size={16} />
  </button>
  <button class="label" onclick={() => app.setView({ kind: 'folder', id: f.id })}>
    <Icon name="folder" size={19} />
    <span class="name">{f.name}</span>
    {#if count}<span class="count">{count}</span>{/if}
  </button>
  <button class="more" aria-label="폴더 메뉴" onclick={(e) => openMenu(e)}>
    <Icon name="more" size={18} />
  </button>
</div>

{#if expanded}
  <div role="group">
    {#each node.children as child (child.folder.id)}
      <FolderItem node={child} />
    {/each}
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    min-height: 40px;
    border-radius: var(--radius-sm);
    margin: 1px 0;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .row:hover {
    background: var(--hover);
  }
  .row.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  .row.drag-over {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
  }
  .twisty {
    width: 28px;
    height: 40px;
    display: grid;
    place-items: center;
    color: var(--text-3);
    transition: transform 0.15s;
  }
  .twisty.open {
    transform: rotate(90deg);
  }
  .twisty.hidden {
    visibility: hidden;
  }
  .label {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 40px;
    text-align: left;
    color: inherit;
  }
  .name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
  }
  .more {
    width: 36px;
    height: 40px;
    display: grid;
    place-items: center;
    color: var(--text-3);
    opacity: 0;
  }
  .row:hover .more,
  .row.active .more {
    opacity: 1;
  }
  @media (hover: none) {
    .more {
      opacity: 1;
    }
  }
  /* 터치 화면: 펼치기 버튼과 줄 높이를 손가락 크기에 맞춤 */
  @media (pointer: coarse) {
    .row,
    .label {
      min-height: 44px;
    }
    .twisty {
      width: 40px;
      height: 44px;
    }
  }
</style>
