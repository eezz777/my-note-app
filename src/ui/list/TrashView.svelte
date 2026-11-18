<script lang="ts">
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import { dialogs } from '../dialogs.svelte';
  import { formatDate } from '../format';
  import { byId, descendantFolderIds } from '../../core/tree';

  const app = useApp();

  // 휴지통 최상위 항목(휴지통 폴더 안의 항목은 폴더와 함께 보관됨)
  const items = $derived.by(() => {
    const map = byId(app.folders);
    const hidden = (id: string | null) => {
      let cur = id;
      while (cur) {
        const f = map.get(cur);
        if (!f) return false;
        if (f.trashed) return true;
        cur = f.parentId;
      }
      return false;
    };
    const folders = app.folders.filter((f) => f.trashed && !hidden(f.parentId));
    const notes = app.notes.filter((n) => n.trashed && !hidden(n.folderId));
    return [
      ...folders.map((f) => ({ type: 'folder' as const, id: f.id, name: f.name, at: f.trashedAt ?? f.updatedAt })),
      ...notes.map((n) => ({ type: 'note' as const, id: n.id, name: n.name, at: n.trashedAt ?? n.updatedAt })),
    ].sort((a, b) => b.at - a.at);
  });

  function innerCount(folderId: string): number {
    const ids = descendantFolderIds(folderId, app.folders);
    return app.notes.filter((n) => n.folderId && ids.has(n.folderId)).length;
  }

  async function restore(it: { type: 'folder' | 'note'; id: string }) {
    await app.run(() => (it.type === 'folder' ? app.repo.restoreFolder(it.id) : app.repo.restoreNote(it.id)));
    app.toast('복원했습니다.');
  }

  async function remove(it: { type: 'folder' | 'note'; id: string; name: string }) {
    const extra = it.type === 'folder' ? ` 폴더 안의 노트 ${innerCount(it.id)}개도 함께 삭제됩니다.` : '';
    const where = app.sync ? ' 구글드라이브에서도 지워집니다.' : '';
    const ok = await dialogs.confirm('영구 삭제', `"${it.name}"을(를) 영구 삭제할까요? 되돌릴 수 없습니다.${where}${extra}`, {
      okLabel: '영구 삭제',
      danger: true,
    });
    if (!ok) return;
    await app.run(() => (it.type === 'folder' ? app.repo.deleteFolderForever(it.id) : app.repo.deleteNoteForever(it.id)));
  }

  async function emptyAll() {
    const ok = await dialogs.confirm('휴지통 비우기', `휴지통의 항목 ${items.length}개를 모두 영구 삭제할까요? 되돌릴 수 없습니다.`, {
      okLabel: '모두 삭제',
      danger: true,
    });
    if (ok) await app.run(() => app.repo.emptyTrash());
  }
</script>

<section class="trash" aria-label="휴지통">
  <header class="bar">
    {#if app.sideAsDrawer}
      <button class="icon-btn" aria-label="메뉴 열기" onclick={() => (app.drawerOpen = true)}>
        <Icon name="menu" />
      </button>
    {/if}
    <h1 class="title">휴지통</h1>
    {#if items.length}
      <button class="btn danger" onclick={emptyAll}>비우기</button>
    {/if}
  </header>

  <div class="items" role="list">
    {#each items as it (it.id)}
      <div class="row" role="listitem">
        <Icon name={it.type === 'folder' ? 'folder' : 'note'} size={20} />
        <div class="info">
          <div class="name">{it.name}</div>
          <div class="sub">
            {formatDate(it.at)}에 삭제{#if it.type === 'folder'} · 노트 {innerCount(it.id)}개{/if}
          </div>
        </div>
        <button class="icon-btn" aria-label="복원" title="복원" onclick={() => restore(it)}>
          <Icon name="restore" />
        </button>
        <button class="icon-btn danger" aria-label="영구 삭제" title="영구 삭제" onclick={() => remove(it)}>
          <Icon name="trash" />
        </button>
      </div>
    {:else}
      <div class="empty">
        <Icon name="trash" size={40} />
        <p>휴지통이 비어 있습니다.</p>
      </div>
    {/each}
  </div>
</section>

<style>
  .trash {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .bar {
    display: flex;
    align-items: center;
    padding: 8px;
    padding-top: calc(8px + env(safe-area-inset-top));
  }
  .title {
    flex: 1;
    margin: 0 0 0 8px;
    font-size: 20px;
    font-weight: 700;
  }
  .items {
    flex: 1;
    overflow-y: auto;
    padding: 6px 12px 40px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 4px 6px 14px;
    background: var(--surface);
    border-radius: var(--radius);
    box-shadow: var(--shadow-1);
    margin-bottom: 8px;
    color: var(--text-2);
  }
  .info {
    flex: 1;
    min-width: 0;
  }
  .name {
    color: var(--text);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    font-size: 12px;
    color: var(--text-3);
    margin-top: 2px;
  }
  .icon-btn.danger {
    color: var(--danger);
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 80px;
    color: var(--text-3);
  }
</style>
