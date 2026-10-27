import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import preact from '@preact/preset-vite';
import manifest from './manifest.config';

export default defineConfig(({ mode }) => ({
  plugins: [preact(), crx({ manifest })],
  build: {
    sourcemap: mode === 'development',
    rollupOptions: {
      // SW 动态引用/代码跳转的页面，CRXJS 无法自动发现，显式注册构建
      input: {
        offscreen: 'src/offscreen/index.html',
        clips: 'src/clips/index.html',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  } as never,
}));
