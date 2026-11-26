// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

/**
 * Dev-only Vite middleware that mounts `functions/api/audit.ts` at POST /api/audit during `astro dev`.
 * Production builds stay 100% static into `./dist` so Cloudflare Pages serves static HTML + Functions seamlessly.
 */
function devPagesAuditMiddleware() {
  return {
    name: 'dev-cloudflare-pages-audit',
    /** @param {import('vite').ViteDevServer} server */
    configureServer(server) {
      server.middlewares.use('/api/audit', async (req, res, next) => {
        if (req.method !== 'POST' && req.method !== 'OPTIONS') {
          return next();
        }

        try {
          const mod = await server.ssrLoadModule('/functions/api/audit.ts');

          const incomingHeaders = {};
          for (const [key, val] of Object.entries(req.headers)) {
            if (typeof val === 'string') {
              incomingHeaders[key] = val;
            } else if (Array.isArray(val)) {
              incomingHeaders[key] = val.join(', ');
            }
          }

          if (req.method === 'OPTIONS' && typeof mod.onRequestOptions === 'function') {
            const request = new Request('http://localhost/api/audit', {
              method: 'OPTIONS',
              headers: incomingHeaders,
            });
            const response = await mod.onRequestOptions({ request, env: process.env });
            res.statusCode = response.status;
            response.headers.forEach((value, key) => res.setHeader(key, value));
            res.end();
            return;
          }

          const chunks = [];
          for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
          }
          const rawBody = Buffer.concat(chunks).toString('utf-8');

          const request = new Request('http://localhost/api/audit', {
            method: 'POST',
            headers: {
              ...incomingHeaders,
              'content-type': req.headers['content-type'] || 'application/json',
            },
            body: rawBody,
          });

          const response = await mod.onRequestPost({ request, env: process.env });
          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(await response.text());
        } catch (err) {
          console.error('[dev-api-audit] Error handling /api/audit:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: 'Local /api/audit middleware error.' }));
        }
      });
    },
  };
}

export default defineConfig({
  build: {
    inlineStylesheets: 'always',
  },
  vite: {
    plugins: [tailwindcss(), devPagesAuditMiddleware()],
  },
});
