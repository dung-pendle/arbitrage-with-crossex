import react from '@vitejs/plugin-react';
import type { PluginOption } from 'vite';
import { defineConfig } from 'vitest/config';

// Vite + Vitest config in one file. The /api proxy targets the Fastify backend
// (built in parallel — see the API contract mirrored in src/api/types.ts).
//
// `vite build --mode landing` builds the public landing site: it swaps in the
// main-landing.tsx entry (whose module graph contains no credentials/trading
// UI), uses a relative base so the bundle is mount-point agnostic, and injects
// the public page metadata. Vitest runs in mode `test`, so tests always see the
// terminal app.

const LANDING_TITLE = 'CrossEx-Boros Terminal — live fixed-rate arbitrage on Boros × Gate CrossEx';
const LANDING_DESCRIPTION =
  'Live delta-neutral funding-rate opportunities between Boros fixed rates and Gate CrossEx perps. ' +
  'A free, open-source terminal that runs on your own machine — your keys never leave it.';
// Public canonical URL for the deployed site — supplied at build time
// (`LANDING_URL=https://your-domain yarn build:landing`); no domain is baked in,
// and the canonical/og:url tags are omitted when it is unset.
const LANDING_URL = process.env.LANDING_URL ?? '';

function landingHtml(): PluginOption {
  return {
    name: 'landing-html',
    transformIndexHtml: {
      // 'pre' so the entry swap happens before Vite discovers the module graph.
      order: 'pre',
      handler(html: string) {
        const canonical = LANDING_URL
          ? [
              `    <link rel="canonical" href="${LANDING_URL}" />`,
              `    <meta property="og:url" content="${LANDING_URL}" />`,
            ]
          : [];
        return html
          .replace('/src/main.tsx', '/src/main-landing.tsx')
          .replace(/<title>.*<\/title>/, `<title>${LANDING_TITLE}</title>`)
          .replace(
            '  </head>',
            [
              `    <meta name="description" content="${LANDING_DESCRIPTION}" />`,
              `    <meta property="og:title" content="${LANDING_TITLE}" />`,
              `    <meta property="og:description" content="${LANDING_DESCRIPTION}" />`,
              `    <meta property="og:type" content="website" />`,
              ...canonical,
              `    <meta name="twitter:card" content="summary" />`,
              '  </head>',
            ].join('\n'),
          );
      },
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: mode === 'landing' ? './' : '/',
  plugins: [react(), ...(mode === 'landing' ? [landingHtml()] : [])],
  define: mode === 'landing' ? { 'import.meta.env.VITE_LANDING': JSON.stringify('1') } : {},
  server: {
    port: 8711,
    proxy: {
      '/api': { target: 'http://127.0.0.1:6688', changeOrigin: false },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}));
