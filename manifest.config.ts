import { defineManifest } from '@crxjs/vite-plugin';

export default defineManifest({
  manifest_version: 3,
  name: '所见即所得收藏夹',
  description: '浏览即收藏，收藏即 Markdown —— 选中文本/图片一键存为结构化 Markdown 文件',
  version: '0.1.0',
  minimum_chrome_version: '109',
  permissions: ['contextMenus', 'downloads', 'storage', 'activeTab', 'scripting', 'offscreen'],
  host_permissions: ['<all_urls>'],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module' as const,
  },
  action: {
    default_popup: 'src/popup/index.html',
    default_title: '所见即所得收藏夹',
  },
  options_page: 'src/options/index.html',
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_idle',
    },
  ],
  commands: {
    'save-selection': {
      suggested_key: { default: 'Alt+S' },
      description: '保存当前选中文本',
    },
  },
  icons: {},
});
