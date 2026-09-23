import { fileURLToPath, URL } from 'node:url';
import type { ServerResponse } from 'node:http';
import { defineConfig, type ProxyOptions, type UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.INKFLOW_API_URL ?? 'http://localhost:4310';

/** Scene model + renderer (also used by dashboard template previews). */
const RENDER_PACKAGES = /[\\/]packages[\\/](renderer|scene|elements|geometry|diagram-engine)[\\/]/;
/** Editor-only engine packages. */
const EDITOR_PACKAGES = /[\\/]packages[\\/](canvas-engine|collaboration|exporters|importers)[\\/]/;

function manualChunks(id: string): string | undefined {
  if (id.includes('/node_modules/')) {
    if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router)[\\/]/.test(id))
      return 'react';
    if (/[\\/]node_modules[\\/](@radix-ui|radix-ui|cmdk|@floating-ui)[\\/]/.test(id))
      return 'radix';
    if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) return 'query';
    return undefined;
  }
  if (RENDER_PACKAGES.test(id)) return 'render-core';
  if (EDITOR_PACKAGES.test(id)) return 'editor-engine';
  return undefined;
}

/** Proxies `/api` (HTTP + WebSocket) to the backend; answers 502 JSON when it is down. */
const apiProxy: ProxyOptions = {
  target: API_TARGET,
  changeOrigin: false,
  ws: true,
  configure(proxy) {
    proxy.on('error', (error, _req, res) => {
      const response = res as ServerResponse | { destroy?: () => void };
      if ('writeHead' in response && typeof response.writeHead === 'function') {
        if (!response.headersSent) {
          response.writeHead(502, { 'content-type': 'application/json' });
        }
        response.end(
          JSON.stringify({
            error: { code: 'SERVICE_UNAVAILABLE', message: `API unavailable (${error.message})` },
          }),
        );
      } else {
        response.destroy?.();
      }
    });
  },
};

export const viteConfig: UserConfig = {
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Resolve workspace packages to their TypeScript sources (keeps Vite's default conditions).
    conditions: ['source', 'module', 'browser', 'development|production'],
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': apiProxy },
  },
  preview: {
    port: 4173,
    strictPort: true,
    proxy: { '/api': apiProxy },
  },
  build: {
    target: 'es2022',
    // Container builds disable sourcemaps to fit small build VMs (INKFLOW_SOURCEMAP=false).
    sourcemap: process.env.INKFLOW_SOURCEMAP !== 'false',
    chunkSizeWarningLimit: 900,
    // Keep memory low for small container build VMs (gzip-size reporting buffers every chunk).
    reportCompressedSize: process.env.INKFLOW_SOURCEMAP !== 'false',
    rollupOptions: {
      output: { manualChunks },
      onwarn(warning, warn) {
        // Third-party packages ship `/* @__PURE__ */` comments Rollup cannot place; harmless noise.
        if (warning.code === 'INVALID_ANNOTATION' && warning.id?.includes('node_modules')) return;
        warn(warning);
      },
    },
  },
};

export default defineConfig(viteConfig);
