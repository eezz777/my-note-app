import { mount } from 'svelte';
import './ui/app.css';
import './render/md.css';
import './editor/editor.css';
import App from './ui/App.svelte';
import { initPwa } from './ui/pwa';
import { consumeRedirect } from './drive/auth';

// 저장 공간을 브라우저가 임의로 비우지 않도록 영구 저장을 요청한다(설치된 PWA는 대개 허용됨)
void navigator.storage?.persist?.();

// 첫 화면부터 지난번 테마로 그려 하얀 화면이 번쩍이지 않게 한다(설정 로딩 전)
try {
  const look = JSON.parse(localStorage.getItem('mynotes.look') ?? '{}') as { theme?: string; accent?: string; fontSize?: number };
  const dark = look.theme === 'dark' || ((look.theme ?? 'system') === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  const root = document.documentElement;
  root.dataset.theme = dark ? 'dark' : 'light';
  if (look.accent) root.style.setProperty('--accent', look.accent);
  if (look.fontSize) root.style.setProperty('--font-size', `${look.fontSize}px`);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#141716' : '#f4f5f3');
} catch {
  /* 저장된 값이 없거나 깨졌으면 기본값 */
}

// 구글 로그인 화면에서 토큰을 들고 돌아왔으면 먼저 받아 둔다(주소의 #를 라우터가 읽기 전에)
consumeRedirect();

const app = mount(App, { target: document.getElementById('app')! });
initPwa();
export default app;
