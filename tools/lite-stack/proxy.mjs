// Minimal stand-in for the Supabase API gateway (Kong) in the lite stack.
// Routes /auth/v1 -> Supabase Auth, /rest/v1 -> PostgREST, and serves email templates.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesDir = path.resolve(here, '../../supabase/templates');

const port = Number(process.env.LITE_API_PORT ?? 54321);
const routes = [
  { prefix: '/auth/v1', target: `http://127.0.0.1:${process.env.LITE_AUTH_PORT ?? 9999}` },
  { prefix: '/rest/v1', target: `http://127.0.0.1:${process.env.LITE_REST_PORT ?? 54330}` },
];

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers':
    'authorization, x-client-info, apikey, content-type, prefer, range, accept-profile, content-profile, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'access-control-expose-headers': 'content-range, content-profile, x-supabase-api-version',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.url?.startsWith('/templates/')) {
    const file = path.join(templatesDir, path.basename(req.url.split('?')[0]));
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
    return;
  }

  const route = routes.find((r) => req.url?.startsWith(r.prefix));
  if (!route) {
    res.writeHead(404, corsHeaders);
    res.end(JSON.stringify({ message: 'no route' }));
    return;
  }

  const upstream = new URL(req.url.slice(route.prefix.length) || '/', route.target);
  const headers = { ...req.headers, host: upstream.host };
  // Kong forwards the apikey as the bearer token when no Authorization header is sent.
  if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;

  const proxyReq = http.request(upstream, { method: req.method, headers }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode ?? 502, { ...proxyRes.headers, ...corsHeaders });
    proxyRes.pipe(res);
  });
  proxyReq.on('error', (err) => {
    res.writeHead(502, corsHeaders);
    res.end(JSON.stringify({ message: `upstream error: ${err.message}` }));
  });
  req.pipe(proxyReq);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`lite-stack API gateway listening on http://127.0.0.1:${port}`);
});
