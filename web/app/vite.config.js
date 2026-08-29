import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  server: {
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      // Hot-loaded modules + REST endpoints live on the Node controller (3000).
      // Proxying makes the URLs work as relative paths in browser code.
      '/loaded':          'http://localhost:3000',
      '/browser-modules': 'http://localhost:3000',
      '/osc':             'http://localhost:3000',
      '/mappings':        'http://localhost:3000',
      '/mood':            'http://localhost:3000',
      '/presets':         'http://localhost:3000',
      '/director':        'http://localhost:3000',
      '/session':         'http://localhost:3000',
      '/music':           'http://localhost:3000',
      '/moves-list':      'http://localhost:3000',
      '/shapes-list':     'http://localhost:3000',
      // Audience submission service (brief 11) — approve queue + approved
      // shape files + event QR. The render/controller side reads ONLY
      // /submit-api/api/approved/* and the queue/thumb/moderate endpoints.
      '/submit-api': {
        target: 'http://localhost:3210',
        rewrite: (p) => p.replace(/^\/submit-api/, ''),
      },
      // WebSocket bridge
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main:       resolve(__dirname, 'index.html'),
        controller: resolve(__dirname, 'controller.html'),
        bench:      resolve(__dirname, 'bench.html'),
        puppet:     resolve(__dirname, 'puppet.html'),
        ncaDemo:    resolve(__dirname, 'nca.html'),
      },
    },
  },
});
