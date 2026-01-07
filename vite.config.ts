import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import { copyFileSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  plugins: [
    crx({ manifest }),
    // NOTE: kuromoji dictionary copy removed - now using Yomitan-style deinflection
    {
      name: 'copy-css',
      closeBundle() {
        // Copy content script styles
        const srcDir = 'src/styles';
        const destDir = 'dist/src/styles';

        try {
          mkdirSync(destDir, { recursive: true });
          const files = readdirSync(srcDir).filter(f => f.endsWith('.css'));
          files.forEach(file => {
            copyFileSync(join(srcDir, file), join(destDir, file));
          });
          console.log(`✅ Copied ${files.length} CSS files to dist/src/styles`);
        } catch (e) {
          console.error('Failed to copy CSS files:', e);
        }

        // Copy sidepanel CSS
        try {
          const sidepanelDestDir = 'dist/src/sidepanel';
          mkdirSync(sidepanelDestDir, { recursive: true });
          copyFileSync('src/sidepanel/sidepanel.css', join(sidepanelDestDir, 'sidepanel.css'));
          console.log(`✅ Copied sidepanel.css to dist/src/sidepanel`);
        } catch (e) {
          console.error('Failed to copy sidepanel CSS:', e);
        }

        // Copy shared component CSS
        try {
          const componentsDestDir = 'dist/src/shared/components';
          mkdirSync(componentsDestDir, { recursive: true });
          copyFileSync('src/shared/components/seer-components.css', join(componentsDestDir, 'seer-components.css'));
          console.log(`✅ Copied seer-components.css to dist/src/shared/components`);
        } catch (e) {
          console.error('Failed to copy shared component CSS:', e);
        }
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        options: 'src/options/options.html',
        sidepanel: 'src/sidepanel/sidepanel.html',
      }
    }
  }
});
