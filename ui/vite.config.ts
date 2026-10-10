import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ui = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('..', import.meta.url));

// The Vite process is not started with `node --env-file`, so the credential
// files the served inspector reads never reach it and the upload action would
// stay disabled in dev. Load them here, in the same order as `pnpm run ui`, so
// `pnpm run ui:dev` behaves like the inspector it proxies to.
function loadEventEnv(): void {
  for (const file of [join(repo, '.env'), join(repo, 'build-the-builder/env.sh')]) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Absent or unreadable; the action reports the missing key itself.
    }
  }
}

// The dev server needs the same read-only API the production build is served
// against. Start it in-process and proxy /api to it so `pnpm run ui:dev` works
// as a single command instead of needing a second terminal.
function inspectorApi(port: number): Plugin {
  return {
    name: 'freya-inspector-api',
    configureServer(server) {
      loadEventEnv();
      void (async () => {
        const { createUiServer } = await import('../src/ui/server.ts');
        const kit = join(repo, 'build-the-builder');
        const experiments = join(repo, 'experiments');
        const api = createUiServer({
          root: experiments,
          port,
          host: '127.0.0.1',
          // Same upload configuration as the served inspector; credentials stay
          // in this process and the browser only receives ids.
          upload: { root: experiments, kit },
          // Same generation configuration, so New run works in dev.
          generation: { root: experiments, kit, openapi: join(kit, 'tools/openapi.json') },
        });
        api.on('error', (error: NodeJS.ErrnoException) => {
          // A stale dev server already owns the port; reuse it rather than
          // taking the whole dev server down.
          if (error.code === 'EADDRINUSE') {
            server.config.logger.info(`  ➜  reusing inspector API on http://127.0.0.1:${port}`);
            return;
          }
          server.config.logger.error(`  ➜  inspector API failed: ${error.message}`);
        });
        api.listen(port, '127.0.0.1', () => {
          server.config.logger.info(`  ➜  inspector API on http://127.0.0.1:${port}`);
        });
      })();
    },
  };
}

const API_PORT = 4318;

// The inspector is served as static files by src/ui/server.ts, so the build
// emits relative assets and the Node process never imports this bundle.
export default defineConfig({
  // Pin the root so the build behaves the same from the repo root or ui/.
  root: ui,
  base: './',
  plugins: [react(), tailwindcss(), inspectorApi(API_PORT)],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    proxy: { '/api': { target: `http://127.0.0.1:${API_PORT}`, changeOrigin: false } },
    // `root` is pinned to ui/, but the Geist font resolves through the repo's
    // node_modules, which the dev server would otherwise refuse to serve.
    fs: { allow: [repo] },
  },
  build: { outDir: 'dist', emptyOutDir: true, assetsDir: 'assets' },
});
