import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// public/favicon.svg 로부터 PWA 아이콘(PNG)을 만든다: npm run icons
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#2e9e6b' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#2e9e6b' } },
  },
  images: ['public/favicon.svg'],
});
