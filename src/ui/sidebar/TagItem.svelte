<script lang="ts">
  import type { TagNode } from '../../core/tags';
  import { tagKey } from '../../core/tags';
  import Icon from '../Icon.svelte';
  import TagItem from './TagItem.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { menuPos, tagMenu } from '../menus';

  let { node, depth = 0 }: { node: TagNode; depth?: number } = $props();
  const app = useApp();

  const expanded = $derived(app.device.expandedTags.includes(node.key));
  const selected = $derived(app.view.kind === 'tags' && app.view.tags.some((t) => tagKey(t) === node.key));

  function toggle() {
    const set = new Set(app.device.expandedTags);
    if (set.has(node.key)) set.delete(node.key);
    else set.add(node.key);
    void app.setDevice({ expandedTags: [...set] });
  }

  /** Ctrl/⌘ 클릭: 현재 태그 필터에 더하거나 빼기 */
  function click(e: MouseEvent) {
    const v = app.view;
    if ((e.ctrlKey || e.metaKey) && v.kind === 'tags') {
      const has = v.tags.some((t) => tagKey(t) === node.key);
      app.setTagFilter(has ? v.tags.filter((t) => tagKey(t) !== node.key) : [...v.tags, node.full], v.mode);
    } else app.openTag(node.full);
  }

  function openMenu(e?: MouseEvent) {
    e?.preventDefault();
    void dialogs.menu(tagMenu(app, node.full), menuPos(app, e), `#${node.full}`);
  }
</script>

<div class="row" class:active={selected} style:padding-left="{8 + depth * 16}px" role="treeitem" aria-selected={selected} tabindex="-1" oncontextmenu={openMenu}>
  <button class="twisty" class:open={expanded} class:hidden={!node.children.length} aria-label={expanded ? '접기' : '펼치기'} onclick={toggle}>
    <Icon name="chevron" size={16} />
  </button>
  <button class="label" onclick={click} title="Ctrl+클릭: 필터에 더하기/빼기">
    <span class="hash">#</span><span class="name">{node.name}</span>
    <span class="count">{node.count}</span>
  </button>
  <button class="more" aria-label="태그 메뉴" onclick={(e) => openMenu(e)}><Icon name="more" size={18} /></button>
</div>
{#if expanded}
  <div role="group">
    {#each node.children as child (child.key)}
      <TagItem node={child} depth={depth + 1} />
    {/each}
  </div>
{/if}

<style>
  .row {
    display: flex;
    align-items: center;
    min-height: 38px;
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
  .twisty {
    width: 28px;
    height: 38px;
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
    min-height: 38px;
    text-align: left;
    color: inherit;
  }
  .hash {
    color: var(--accent);
    font-weight: 700;
    margin-right: 4px;
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
    padding-left: 6px;
  }
  .more {
    width: 36px;
    height: 38px;
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
