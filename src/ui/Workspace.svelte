<script lang="ts">
  import { onMount } from 'svelte';
  import Shell from './Shell.svelte';
  import { provideApp } from './context';
  import type { AppStore } from './state.svelte';
  import { applyUpdate, listenPwa } from './pwa';

  let { app }: { app: AppStore } = $props();
  // svelte-ignore state_referenced_locally
  provideApp(app);

  onMount(() => {
    void app.start().then(() => app.sync?.start());
    // 개발 중 디버깅용
    if (import.meta.env.DEV) (window as unknown as { __app: AppStore }).__app = app;
    // 새 버전이 배포되면 사용자가 눌러서 적용(편집 중 갑자기 새로고침되지 않게)
    const unlisten = listenPwa({
      onNeedRefresh: () => app.toast('새 버전이 있습니다.', 'info', { label: '업데이트', run: applyUpdate }, 60000),
      onOfflineReady: () => app.toast('오프라인에서도 사용할 수 있습니다.'),
    });
    return () => {
      unlisten();
      app.stop();
    };
  });
</script>

<Shell />
