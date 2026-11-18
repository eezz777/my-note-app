<script lang="ts">
  // 서식 툴바. 버튼을 눌러도 편집기 포커스(모바일 키보드)가 유지되도록 mousedown 기본 동작을 막는다.
  import { undo, redo } from '@codemirror/commands';
  import type { Command } from '@codemirror/view';
  import Icon from '../Icon.svelte';
  import type { IconName } from '../icons';
  import { commands } from '../../editor/setup';
  import type { EditorController } from '../../editor/controller';

  let {
    ctl,
    mobile,
    onattach,
    onhidekeyboard,
  }: {
    ctl: EditorController | null;
    mobile: boolean;
    onattach: (kind: 'image' | 'pdf' | 'file') => void;
    onhidekeyboard?: () => void;
  } = $props();

  const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

  interface Btn {
    icon: IconName;
    label: string;
    run: Command | (() => void);
    key?: string;
    mobileOnly?: boolean;
  }

  const buttons: (Btn | '|')[] = [
    { icon: 'undo', label: '실행 취소', run: undo, key: `${mod}Z`, mobileOnly: true },
    { icon: 'redo', label: '다시 실행', run: redo, key: `${mod}Y`, mobileOnly: true },
    { icon: 'heading', label: '제목', run: commands.heading },
    { icon: 'bold', label: '굵게', run: commands.bold, key: `${mod}B` },
    { icon: 'italic', label: '기울임', run: commands.italic, key: `${mod}I` },
    { icon: 'strike', label: '취소선', run: commands.strike, key: `${mod}Shift+X` },
    { icon: 'highlighter', label: '형광펜', run: commands.highlight, key: `${mod}Shift+H` },
    '|',
    { icon: 'bullets', label: '글머리 목록', run: commands.bullet, key: `${mod}Shift+8` },
    { icon: 'numbered', label: '번호 목록', run: commands.ordered, key: `${mod}Shift+7` },
    { icon: 'checkbox', label: '체크박스', run: commands.task, key: `${mod}Shift+9 / ${mod}Enter 완료` },
    { icon: 'quoteIcon', label: '인용', run: commands.quote },
    '|',
    { icon: 'link', label: '링크', run: commands.link, key: `${mod}K` },
    { icon: 'tag', label: '태그', run: commands.tag },
    { icon: 'image', label: '이미지', run: () => onattach('image') },
    { icon: 'pdf', label: 'PDF', run: () => onattach('pdf') },
    { icon: 'paperclip', label: '파일 첨부', run: () => onattach('file') },
    { icon: 'table', label: '표', run: commands.table },
    { icon: 'codeIcon', label: '코드', run: commands.code, key: `${mod}\`` },
    { icon: 'hr', label: '구분선', run: commands.hr },
  ];

  const shown = $derived(buttons.filter((b) => b === '|' || !b.mobileOnly || mobile));

  function press(b: Btn) {
    if (!ctl) return;
    if (b.run.length === 0) (b.run as () => void)();
    else ctl.run(b.run as Command);
  }
</script>

<div class="toolbar" class:mobile role="toolbar" aria-label="서식">
  <div class="scroll">
    {#each shown as b}
      {#if b === '|'}
        <span class="sep"></span>
      {:else}
        <button
          class="tb"
          title={b.key ? `${b.label} (${b.key})` : b.label}
          aria-label={b.label}
          onmousedown={(e) => e.preventDefault()}
          onclick={() => press(b)}
        >
          <Icon name={b.icon} size={20} />
        </button>
      {/if}
    {/each}
  </div>
  {#if mobile && onhidekeyboard}
    <button class="tb hide" aria-label="키보드 닫기" onmousedown={(e) => e.preventDefault()} onclick={onhidekeyboard}>
      <Icon name="keyboardHide" size={20} />
    </button>
  {/if}
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    border-bottom: 1px solid var(--border);
    background: var(--surface);
  }
  .toolbar.mobile {
    border-bottom: 0;
    border-top: 1px solid var(--border);
    background: var(--surface-2);
    padding-bottom: env(safe-area-inset-bottom);
  }
  .scroll {
    flex: 1;
    display: flex;
    align-items: center;
    overflow-x: auto;
    scrollbar-width: none;
    padding: 2px 6px;
  }
  .scroll::-webkit-scrollbar {
    display: none;
  }
  .tb {
    flex: none;
    width: 40px;
    height: 40px;
    display: grid;
    place-items: center;
    border-radius: 10px;
    color: var(--text-2);
  }
  .mobile .tb {
    width: 46px;
    height: 46px;
  }
  .tb:hover {
    background: var(--hover);
    color: var(--text);
  }
  .tb:active {
    background: var(--accent-soft);
    color: var(--accent-strong);
  }
  .sep {
    flex: none;
    width: 1px;
    height: 22px;
    background: var(--border);
    margin: 0 4px;
  }
  .hide {
    border-left: 1px solid var(--border);
    border-radius: 0;
  }
</style>
