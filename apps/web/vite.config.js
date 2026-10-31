import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// VITE_* values are compiled into the public bundle. Never put secrets in them.
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const apiOrigin = env.VITE_API_ORIGIN || '';
  // Leave VITE_API_ORIGIN empty in development: the dev server proxies /api (below), so cookies and
  // CORS just work on any local port. A localhost origin must never reach a production bundle.
  if (command === 'build' && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(apiOrigin)) {
    throw new Error(`VITE_API_ORIGIN is ${apiOrigin}, which only works on this machine. Clear it (the dev server proxies /api) or set the deployed API origin for this build.`);
  }

  // Production builds get a strict CSP meta tag as a baseline; the hosting layer should
  // also send it as a header (see public/_headers), which additionally enforces frame-ancestors.
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://res.cloudinary.com",
    "font-src 'self'",
    `connect-src 'self'${apiOrigin ? ` ${apiOrigin}` : ''}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'townant-csp',
        apply: 'build',
        transformIndexHtml: (html) => html.replace('<!--CSP-->', `<meta http-equiv="Content-Security-Policy" content="${csp}" />`),
      },
    ],
    server: {
      port: 5173,
      // API_PROXY_TARGET lets a second local stack (e.g. browser checks) run beside the usual one.
      proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://localhost:4000', changeOrigin: false } },
    },
    build: { sourcemap: false, target: 'es2022' },
  };
});
