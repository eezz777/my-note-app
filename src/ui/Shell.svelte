<script lang="ts">
  // 반응형 레이아웃
  //  - 데스크톱(≥1024px): 사이드바 | 노트 목록 | 편집기 (3단)
  //  - 태블릿(720~1023px): 노트 목록 | 편집기, 사이드바는 드로어
  //  - 모바일(<720px): 한 화면씩(목록 ↔ 편집기), 사이드바는 드로어
  import Sidebar from './sidebar/Sidebar.svelte';
  import NoteList from './list/NoteList.svelte';
  import TrashView from './list/TrashView.svelte';
  import NoteEditor from './editor/NoteEditor.svelte';
  import DialogHost from './overlay/DialogHost.svelte';
  import Toasts from './Toasts.svelte';
  import LinkPreview from './overlay/LinkPreview.svelte';
  import SearchPanel from './list/SearchPanel.svelte';
  import GraphView from './graph/GraphView.svelte';
  import QuickOpen from './overlay/QuickOpen.svelte';
  import CompareView from './overlay/CompareView.svelte';
  import VersionsView from './overlay/VersionsView.svelte';
  import SyncBanner from './SyncBanner.svelte';
  import { useApp } from './context';

  const app = useApp();
  const mobile = $derived(app.layout === 'mobile');
  const showEditor = $derived(!mobile || app.openNoteId !== null);
  const showList = $derived(!mobile || app.openNoteId === null);

  // 테마/포인트 색/글꼴 크기 적용
  $effect(() => {
    const root = document.documentElement;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = app.device.theme === 'dark' || (app.device.theme === 'system' && mq.matches);
      root.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141716' : '#f4f5f3');
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  });
  $effect(() => {
    document.documentElement.style.setProperty('--accent', app.shared.accent);
  });
  $effect(() => {
    document.documentElement.style.setProperty('--font-size', `${app.device.fontSize}px`);
  });
  // 다음 실행 때 첫 화면부터 같은 테마로 그리도록 기억(main.ts가 읽음)
  $effect(() => {
    localStorage.setItem('mynotes.look', JSON.stringify({ theme: app.device.theme, accent: app.shared.accent, fontSize: app.device.fontSize }));
  });

  // 드로어 밀어서 닫기(왼쪽으로 스와이프)
  let touchX = 0;

  // 전역 단축키: Ctrl+P 빠른 열기, Ctrl+Shift+F 전체 검색, Ctrl+Alt+N 새 노트, Ctrl+\ 사이드바, Esc 선택 해제
  function onKey(e: KeyboardEvent) {
    if (e.isComposing) return;
    if (e.key === 'Escape' && app.selecting && !document.querySelector('.dialog, .menu, .qo')) {
      app.clearSelection();
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (e.key === '\\' && app.layout === 'desktop') {
      e.preventDefault();
      void app.setDevice({ sidebarCollapsed: !app.device.sidebarCollapsed });
      return;
    }
    if (k === 'p' && !e.shiftKey && !e.altKey) {
      e.preventDefault(); // 브라우저 인쇄 대신
      e.stopPropagation();
      app.quickOpen = !app.quickOpen;
    } else if (k === 'f' && e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      app.quickOpen = false;
      app.openSearch();
    } else if (k === 'n' && e.altKey) {
      e.preventDefault();
      void app.newNote();
    }
  }
</script>

<svelte:window onkeydowncapture={onKey} onpointerdowncapture={(e) => (app.lastPointer = e.pointerType as 'mouse' | 'touch' | 'pen')} />

<div class="shell {app.layout}">
  {#if !app.sideAsDrawer}
    <aside class="side"><Sidebar /></aside>
  {:else if app.drawerOpen}
    <div class="drawer-scrim" role="presentation" onclick={() => (app.drawerOpen = false)}></div>
    <aside
      class="drawer"
      ontouchstart={(e) => (touchX = e.touches[0].clientX)}
      ontouchend={(e) => {
        if (touchX - e.changedTouches[0].clientX > 60) app.drawerOpen = false;
      }}
    >
      <Sidebar />
    </aside>
  {/if}

  {#if showList}
    <div class="list" class:wide={app.view.kind === 'graph'}>
      {#if app.view.kind === 'trash'}<TrashView />{:else if app.view.kind === 'search'}<SearchPanel />{:else if app.view.kind === 'graph'}<GraphView />{:else}<NoteList />{/if}
    </div>
  {/if}
  {#if showEditor}
    <main class="editor"><NoteEditor /></main>
  {/if}
</div>

<SyncBanner />
<LinkPreview />
{#if app.quickOpen}<QuickOpen />{/if}
{#if app.compare}<CompareView />{/if}
{#if app.versionsFor}<VersionsView />{/if}
<DialogHost />
<Toasts />

<style>
  .shell {
    height: 100dvh;
    display: flex;
    overflow: hidden;
  }
  .side {
    width: 260px;
    flex: none;
    border-right: 1px solid var(--border);
  }
  .list {
    width: 340px;
    flex: none;
    border-right: 1px solid var(--border);
  }
  .editor {
    flex: 1;
    min-width: 0;
  }
  .shell.tablet .list {
    width: 300px;
  }
  /* 그래프는 목록 자리를 넓게 쓴다(편집기와 반씩) */
  .shell:not(.mobile) .list.wide {
    width: auto;
    flex: 1 1 0;
    min-width: 0;
  }
  .shell.mobile .list,
  .shell.mobile .editor {
    width: 100%;
    flex: 1;
    border: 0;
  }
  .drawer-scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgba(10, 15, 12, 0.38);
    animation: fade 0.18s;
  }
  .drawer {
    position: fixed;
    z-index: 41;
    left: 0;
    top: 0;
    bottom: 0;
    width: min(300px, 84vw);
    box-shadow: var(--shadow-2);
    border-radius: 0 22px 22px 0;
    overflow: hidden;
    animation: slide 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes slide {
    from {
      transform: translateX(-100%);
    }
  }
  @keyframes fade {
    from {
      opacity: 0;
    }
  }
</style>
