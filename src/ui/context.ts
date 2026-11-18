import { getContext, setContext } from 'svelte';
import type { AppStore } from './state.svelte';

const KEY = Symbol('app');

export function provideApp(app: AppStore) {
  setContext(KEY, app);
}

export function useApp(): AppStore {
  return getContext<AppStore>(KEY);
}
