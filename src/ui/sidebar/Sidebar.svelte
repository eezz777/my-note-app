<script lang="ts">
  import Icon from '../Icon.svelte';
  import FolderItem from './FolderItem.svelte';
  import TagItem from './TagItem.svelte';
  import SyncStatus from '../SyncStatus.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { dropOnFolder, hasDragItem, newFolderFlow } from '../menus';
  import type { IconName } from '../icons';
  import type { View } from '../state.svelte';

  const app = useApp();
  let rootOver = $state(false);

  const v = $derived(app.view);
  const favCount = $derived(app.liveNotes.filter((n) => app.favSet.has(n.id)).length);
  const rootCount = $derived(app.folderCounts.get(null) ?? 0);

  function isActive(view: View) {
    if (view.kind !== v.kind) return false;
    return view.kind !== 'folder' || (v.kind === 'folder' && v.id === view.id);
  }
</script>

{#snippet navItem(view: View, icon: IconName, label: string, count?: number)}
  <button class="nav" class:active={isActive(view)} onclick={() => app.setView(view)}>
    <Icon name={icon} size={20} />
    <span class="nav-label">{label}</span>
    {#if count}<span class="count">{count}</span>{/if}
  </button>
{/snippet}

<nav class="sidebar" aria-label="탐색">
  <div class="brand">
    <span class="logo" aria-hidden="true">
      <svg viewBox="0 0 32 32" width="28" height="28"
        ><rect x="3" y="3" width="26" height="26" rx="8" fill="var(--accent)" /><path
          d="M10 22V10l6 7 6-7v12"
          fill="none"
          stroke="#fff"
          stroke-width="2.6"
          stroke-linecap="round"
          stroke-linejoin="round"
        /></svg
      >
    </span>
    <span class="brand-name">마이노트</span>
    {#if app.layout === 'desktop'}
      <button
        class="icon-btn collapse"
        aria-label={app.device.sidebarCollapsed ? '사이드바 고정' : '사이드바 접기'}
        title={app.device.sidebarCollapsed ? '사이드바 고정 (Ctrl+\\)' : '사이드바 접기 (Ctrl+\\)'}
        onclick={() => {
          app.drawerOpen = false;
          void app.setDevice({ sidebarCollapsed: !app.device.sidebarCollapsed });
        }}
      >
        <Icon name={app.device.sidebarCollapsed ? 'pin' : 'back'} size={18} />
      </button>
    {/if}
  </div>

  <button class="searchbox" onclick={() => app.openSearch()} title="전체 검색 (Ctrl+Shift+F) · 빠른 열기 (Ctrl+P)">
    <Icon name="search" size={18} /><span>검색</span><kbd>Ctrl P</kbd>
  </button>

  <div class="scroll">
    {@render navItem({ kind: 'all' }, 'notes', '모든 노트', app.liveNotes.length)}
    {@render navItem({ kind: 'fav' }, 'star', '즐겨찾기', favCount)}
    {@render navItem({ kind: 'graph' }, 'graph', '그래프')}

    <div class="section">
      <span>폴더</span>
      <button class="icon-btn small" aria-label="새 폴더" title="새 폴더" onclick={() => newFolderFlow(app, null)}>
        <Icon name="folderPlus" size={18} />
      </button>
    </div>

    <div role="tree" aria-label="폴더">
      {#each app.tree as node (node.folder.id)}
        <FolderItem {node} />
      {/each}
    </div>

    <!-- 폴더 밖(루트) 노트. 여기로 끌어다 놓으면 최상위로 이동 -->
    <div
      class="root-drop"
      class:drag-over={rootOver}
      role="group"
      ondragover={(e) => {
        if (hasDragItem(e)) {
          e.preventDefault();
          rootOver = true;
        }
      }}
      ondragleave={() => (rootOver = false)}
      ondrop={(e) => {
        e.preventDefault();
        rootOver = false;
        void dropOnFolder(app, e, null);
      }}
    >
      {@render navItem({ kind: 'folder', id: null }, 'home', '폴더 밖 노트', rootCount)}
    </div>

    <div class="section"><span>태그</span></div>
    <div role="tree" aria-label="태그">
      {#each app.tagIndex.roots as node (node.key)}
        <TagItem {node} />
      {:else}
        <p class="placeholder">본문에 #태그 를 쓰면 여기에 모입니다.</p>
      {/each}
    </div>
  </div>

  <div class="bottom">
    {@render navItem({ kind: 'trash' }, 'trash', '휴지통')}
    <button class="nav" onclick={() => dialogs.settings()}>
      <Icon name="settings" size={20} />
      <span class="nav-label">설정</span>
    </button>
    <SyncStatus />
  </div>
</nav>

<style>
  .sidebar {
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--sidebar);
    padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 10px 14px;
    padding-top: calc(12px + env(safe-area-inset-top));
  }
  .brand-name {
    flex: 1;
    font-weight: 700;
    font-size: 18px;
    letter-spacing: -0.02em;
  }
  .icon-btn.collapse {
    min-width: 36px;
    min-height: 36px;
    color: var(--text-3);
  }
  .searchbox {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 42px;
    margin: 0 2px 8px;
    padding: 0 12px;
    border-radius: 999px;
    background: var(--surface);
    box-shadow: var(--shadow-1);
    color: var(--text-3);
    text-align: left;
  }
  .searchbox span {
    flex: 1;
  }
  .searchbox kbd {
    font-family: var(--mono);
    font-size: 10px;
    border: 1px solid var(--border);
    border-radius: 5px;
    padding: 1px 5px;
  }
  @media (hover: none) {
    .searchbox kbd {
      display: none;
    }
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }
  .nav {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: var(--touch);
    padding: 0 12px;
    border-radius: var(--radius-sm);
    color: var(--text);
    text-align: left;
  }
  .nav:hover {
    background: var(--hover);
  }
  .nav.active {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .nav-label {
    flex: 1;
  }
  .count {
    font-size: 12px;
    color: var(--text-3);
  }
  .section {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin: 16px 4px 4px 12px;
    font-size: 12px;
    font-weight: 700;
    color: var(--text-3);
    letter-spacing: 0.04em;
  }
  .icon-btn.small {
    min-width: 36px;
    min-height: 36px;
  }
  .root-drop {
    border-radius: var(--radius-sm);
  }
  .root-drop.drag-over {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
  }
  .placeholder {
    margin: 4px 12px;
    font-size: 13px;
    color: var(--text-3);
  }
  .bottom {
    border-top: 1px solid var(--border);
    padding-top: 6px;
  }
</style>
