<script lang="ts">
  // 이동할 폴더 고르기(모바일 "이동" 메뉴, 데스크톱에서도 사용)
  import Icon from '../Icon.svelte';
  import { useApp } from '../context';
  import type { DialogReq } from '../dialogs.svelte';
  import type { FolderNode } from '../../core/tree';
  import { isSelfOrDescendant } from '../../core/tree';
  import { newFolderFlow } from '../menus';

  let { req, oncancel }: { req: Extract<DialogReq, { kind: 'folder' }>; oncancel: () => void } = $props();
  const app = useApp();

  let selected = $state<string | null>(null);
  let touched = $state(false);
  let open = $state(new Set<string>(app.device.expanded));

  // 모든 폴더를 평평한 목록으로(펼친 것만)
  const rows = $derived.by(() => {
    const out: FolderNode[] = [];
    const walk = (nodes: FolderNode[]) => {
      for (const n of nodes) {
        out.push(n);
        if (open.has(n.folder.id)) walk(n.children);
      }
    };
    walk(app.tree);
    return out;
  });

  function disabled(id: string | null): boolean {
    if (id === (req.current ?? null)) return true;
    return !!req.exclude && id !== null && isSelfOrDescendant(req.exclude, id, app.folderMap);
  }

  function toggle(id: string) {
    const s = new Set(open);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    open = s;
  }

  async function addFolder() {
    const parent = touched ? selected : null;
    await newFolderFlow(app, parent);
    if (parent) open = new Set([...open, parent]);
  }
</script>

<div class="picker">
  <h2>{req.title}</h2>
  <div class="tree" role="listbox" aria-label="대상 폴더">
    <button
      class="row"
      class:sel={touched && selected === null}
      disabled={disabled(null)}
      role="option"
      aria-selected={touched && selected === null}
      onclick={() => {
        selected = null;
        touched = true;
      }}
    >
      <span class="tw"></span><Icon name="home" size={19} /> 최상위 (폴더 밖)
    </button>
    {#each rows as n (n.folder.id)}
      <div class="row-wrap" style:padding-left="{n.depth * 18}px">
        <button
          class="tw"
          class:open={open.has(n.folder.id)}
          class:hidden={!n.children.length}
          aria-label="펼치기"
          onclick={() => toggle(n.folder.id)}><Icon name="chevron" size={15} /></button
        >
        <button
          class="row"
          class:sel={touched && selected === n.folder.id}
          disabled={disabled(n.folder.id)}
          role="option"
          aria-selected={touched && selected === n.folder.id}
          onclick={() => {
            selected = n.folder.id;
            touched = true;
          }}
        >
          <Icon name="folder" size={19} />
          <span class="nm">{n.folder.name}</span>
        </button>
      </div>
    {/each}
  </div>
  <div class="actions">
    <button class="btn" onclick={addFolder}><Icon name="folderPlus" size={18} /> 새 폴더</button>
    <span class="sp"></span>
    <button class="btn" onclick={oncancel}>취소</button>
    <button class="btn primary" disabled={!touched} onclick={() => req.resolve({ id: selected })}>여기로 이동</button>
  </div>
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    max-height: calc(100dvh - 48px);
  }
  h2 {
    margin: 0;
    padding: 20px 22px 10px;
    font-size: 18px;
  }
  .tree {
    flex: 1;
    overflow-y: auto;
    padding: 0 10px;
    min-height: 120px;
    max-height: 55dvh;
  }
  .row-wrap {
    display: flex;
    align-items: center;
  }
  .row {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: 10px;
    text-align: left;
  }
  .row:hover:not(:disabled) {
    background: var(--hover);
  }
  .row:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .row.sel {
    background: var(--accent-soft);
    color: var(--accent-strong);
    font-weight: 600;
  }
  .nm {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tw {
    width: 28px;
    height: 44px;
    display: grid;
    place-items: center;
    color: var(--text-3);
    flex: none;
    transition: transform 0.15s;
  }
  .tw.open {
    transform: rotate(90deg);
  }
  .tw.hidden {
    visibility: hidden;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 14px 14px;
    border-top: 1px solid var(--border);
  }
  .sp {
    flex: 1;
  }
  .btn:disabled {
    opacity: 0.45;
  }
</style>
