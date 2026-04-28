import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'bcb-translater',
    description: 'Fast LLM translation and summarization with structure preservation',
    permissions: ['storage', 'contextMenus', 'activeTab'],
    host_permissions: ['<all_urls>'],
    commands: {
      'translate-selection': {
        suggested_key: { default: 'Alt+T' },
        description: 'Translate selected text',
      },
      'summarize-selection': {
        suggested_key: { default: 'Alt+S' },
        description: 'Summarize selected text',
      },
    },
    action: { default_popup: 'popup.html', default_title: 'bcb-translater' },
  },
});
