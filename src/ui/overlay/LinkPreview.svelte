<script lang="ts">
  // [[링크]] 미리보기 팝업. PC는 링크 근처에 뜨고, 폰은 아래에서 올라오는 시트로 뜬다.
  import { useApp } from '../context';
  import Icon from '../Icon.svelte';
  import { findSection, splitTarget } from '../../core/links';
  import { renderMarkdown } from '../../render/markdown';
  import { hydrate } from '../../render/hydrate';

  const app = useApp();
  const p = $derived(app.preview);
  const mobile = $derived(app.layout === 'mobile');

  let body: HTMLDivElement | undefined = $state();
  let title = $state('');
  let status = $state<'loading' | 'ok' | 'missing'>('loading');
  let html = $state('');
  let targetId: string | null = null;

  $effect(() => {
    const cur = p;
    if (!cur) return;
    const { name, sub } = splitTarget(cur.raw);
    status = 'loading';
    let alive = true;
    void (async () => {
      const n = name ? app.findNote(name, cur.fromFolder) : null;
      if (!n) {
        title = name;
        status = 'missing';
        return;
      }
      const text = await app.repo.getContent(n.id);
      if (!alive) return;
      targetId = n.id;
      title = n.name + (sub ? ` › ${sub.replace(/^\^/, '¶ ')}` : '');
      const sec = findSection(text, sub);
      html = sec ? renderMarkdown(sec.text.slice(0, 20000)) : '<p class="muted">해당 부분을 찾을 수 없습니다.</p>';
      status = 'ok';
    })();
    return () => (alive = false);
  });

  $effect(() => {
    void html;
    if (status === 'ok' && body) return hydrate(body, app.editorHost);
  });

  // 화면 안에 들어오도록 위치 계산(PC)
  const style = $derived.by(() => {
    if (!p || mobile) return '';
    const w = Math.min(440, innerWidth - 16);
    const left = Math.max(8, Math.min(p.rect.left, innerWidth - w - 8));
    const below = innerHeight - p.rect.bottom > 300 || p.rect.top < 300;
    // 링크가 화면 가장자리에 걸쳐 있어도 팝업은 화면 안에 들어오게
    if (below) {
      const top = Math.min(Math.max(8, p.rect.bottom + 6), innerHeight - 160);
      return `left:${left}px;top:${top}px;width:${w}px;max-height:${Math.max(150, Math.min(420, innerHeight - top - 8))}px`;
    }
    const bottom = Math.min(Math.max(8, innerHeight - p.rect.top + 6), innerHeight - 160);
    return `left:${left}px;bottom:${bottom}px;width:${w}px;max-height:${Math.max(150, Math.min(420, innerHeight - bottom - 8))}px`;
  });

  function open() {
    if (!p) return;
    const raw = p.raw;
    app.preview = null;
    if (app.editorHost) app.editorHost.openWikiLink(raw);
    else if (targetId) app.open(targetId);
  }
</script>

{#if p}
  {#if mobile}
    <div class="scrim" role="presentation" onclick={() => (app.preview = null)}></div>
  {/if}
  <div
    class="pop"
    class:sheet={mobile}
    {style}
    role="dialog"
    aria-label="링크 미리보기"
    tabindex="-1"
    onmouseenter={() => app.keepPreview()}
    onmouseleave={() => app.hidePreviewSoon()}
  >
    <div class="head">
      <Icon name="note" size={16} />
      <span class="t">{title}</span>
      {#if status !== 'missing'}<button class="btn small" onclick={open}>열기</button>{/if}
      {#if mobile}<button class="icon-btn" aria-label="닫기" onclick={() => (app.preview = null)}><Icon name="close" size={18} /></button>{/if}
    </div>
    <div class="body md-body" bind:this={body}>
      {#if status === 'loading'}
        <p class="muted">불러오는 중…</p>
      {:else if status === 'missing'}
        <p class="muted">아직 없는 노트입니다. 링크를 누르면 새로 만듭니다.</p>
      {:else}
        {@html html}
      {/if}
    </div>
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    z-index: 55;
    background: rgba(10, 15, 12, 0.3);
  }
  .pop {
    position: fixed;
    z-index: 56;
    display: flex;
    flex-direction: column;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 14px;
    box-shadow: var(--shadow-2);
    overflow: hidden;
    animation: fade 0.12s;
    font-size: 14px;
  }
  .pop.sheet {
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 70dvh;
    border-radius: 22px 22px 0 0;
    padding-bottom: env(safe-area-inset-bottom);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 8px 8px 14px;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
  }
  .t {
    flex: 1;
    min-width: 0;
    font-weight: 650;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btn.small {
    min-height: 32px;
    padding: 0 12px;
    color: var(--accent-strong);
  }
  .body {
    overflow-y: auto;
    padding: 10px 16px 14px;
    --font-size: 14px;
  }
  @keyframes fade {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
</style>
