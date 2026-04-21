import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    fs: {
      // Allow serving files from the data directory outside project root
      allow: ['.', path.resolve(__dirname, '../data')],
    },
  },
  resolve: {
    alias: {
      '@data': path.resolve(__dirname, '../data'),
      '@engine': path.resolve(__dirname, 'src/engine'),
    },
  },
});
