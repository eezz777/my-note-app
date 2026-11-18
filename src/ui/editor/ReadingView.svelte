<script lang="ts">
  // 읽기 모드: 노트를 렌더링해 보여 준다. 체크박스 클릭, 링크 이동, 첨부 임베드를 처리한다.
  import { renderNote } from '../../render/markdown';
  import { hydrate } from '../../render/hydrate';
  import { parseWikiTarget } from '../../editor/markdown-ext';
  import { kindOf } from '../../core/attachments';
  import type { EditorHost } from '../../editor/host';

  let {
    text,
    host,
    deps,
    ontoggletask,
  }: { text: string; host: EditorHost; deps?: unknown; ontoggletask: (line: number) => void } = $props();

  let el: HTMLDivElement | undefined = $state();
  const html = $derived(renderNote(text));

  $effect(() => {
    void html;
    void deps; // 첨부·노트 목록이 바뀌면 다시 그리기
    if (!el) return;
    for (const a of el.querySelectorAll<HTMLElement>('a.wikilink')) {
      const { name } = parseWikiTarget(a.dataset.wikilink ?? '');
      const isFile = kindOf(name) !== 'note';
      if (isFile) a.classList.add('attachment-link');
      const exists = isFile ? !!host.findAttachment(name) : host.noteExists(name);
      a.classList.toggle('unresolved', !!name && !exists);
    }
    return hydrate(el, host);
  });

  function onclick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.classList.contains('task-box')) {
      e.preventDefault();
      ontoggletask(Number(target.dataset.line));
      return;
    }
    const a = target.closest('a');
    if (!a) return;
    e.preventDefault();
    if (a.dataset.tag) host.openTag(a.dataset.tag);
    else if (a.dataset.wikilink) host.openWikiLink(a.dataset.wikilink, e.ctrlKey || e.metaKey);
    else {
      const href = a.getAttribute('href') ?? '';
      if (href.startsWith('#')) {
        // 각주 등 문서 안 이동
        el?.querySelector(href.replace(/:/g, '\\:'))?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (href) host.openUrl(href);
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md-body reading" bind:this={el} {onclick}>
  {@html html}
</div>

<style>
  .reading {
    padding-bottom: 40vh;
    user-select: text;
  }
</style>
