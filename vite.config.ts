/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';
import { pdfjsAssets } from './pdfjs-assets.ts';

// GitHub Pages(프로젝트 페이지)는 /저장소이름/ 아래에서 서비스되므로 배포 시 BASE_PATH로 지정한다.
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  base,
  // 개발 서버가 실행 중에 의존성을 다시 묶으며 페이지를 반쯤 새로고침하는 일을 막기 위해 미리 묶을 목록
  optimizeDeps: {
    include: [
      'dexie',
      'fflate',
      '@codemirror/autocomplete',
      'pdfjs-dist',
      'katex',
      'markdown-it',
      'markdown-it-footnote',
      'dompurify',
      '@codemirror/state',
      '@codemirror/view',
      '@codemirror/commands',
      '@codemirror/language',
      '@codemirror/lang-markdown',
      '@codemirror/language-data',
      '@codemirror/search',
      '@lezer/highlight',
      '@lezer/markdown',
    ],
  },
  plugins: [
    svelte(),
    pdfjsAssets(),
    VitePWA({
      // 편집 중 자동 새로고침으로 입력이 끊기지 않도록, 새 버전은 사용자가 눌러서 적용한다.
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: '마이노트',
        short_name: '마이노트',
        description: '구글드라이브에 저장하는 개인 마크다운 노트',
        lang: 'ko',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#f6f7f5',
        theme_color: '#2e9e6b',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 앱 셸 전체를 미리 캐시해 오프라인에서도 열리게 한다(구글 API 요청은 캐시하지 않음).
        // pdf.js 보조 파일 중 한글 PDF에 필요한 cmaps·표준 글꼴도 미리 받아 둔다.
        globPatterns: [
          '**/*.{js,css,html,svg,png,ico,woff2,mjs}',
          'pdfjs/cmaps/*',
          'pdfjs/standard_fonts/*',
          'pdfjs/iccs/*',
        ],
        globIgnores: ['pdfjs/wasm/**'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: 'index.html',
        // 특수 이미지 디코더(wasm)는 처음 쓸 때 받아서 보관
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/pdfjs/wasm/'),
            handler: 'CacheFirst',
            options: { cacheName: 'pdfjs-wasm' },
          },
        ],
      },
    }),
  ],
  // 편집기(CodeMirror)와 렌더러를 한 번에 받아 오프라인 캐시에 넣으므로 큰 묶음을 허용
  build: { chunkSizeWarningLimit: 900 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
