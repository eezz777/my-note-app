<script lang="ts">
  import { icons, type IconName } from './icons';
  let { name, size = 22, filled = false }: { name: IconName; size?: number; filled?: boolean } = $props();
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={filled ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.8"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"><path d={icons[name]} /></svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
