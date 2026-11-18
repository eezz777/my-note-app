<script lang="ts">
  // 쌓인 대화상자/메뉴를 순서대로 그린다. Esc는 맨 위 것만 닫는다.
  import DialogView, { cancelDialog } from './DialogView.svelte';
  import { dialogs } from '../dialogs.svelte';

  function onKey(e: KeyboardEvent) {
    const top = dialogs.stack.at(-1);
    if (top && e.key === 'Escape') {
      e.preventDefault();
      cancelDialog(top);
    }
  }
</script>

<svelte:window onkeydown={onKey} />

{#each dialogs.stack as d ((d as { key?: number }).key)}
  <DialogView {d} />
{/each}
