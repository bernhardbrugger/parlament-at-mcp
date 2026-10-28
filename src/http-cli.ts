#!/usr/bin/env node
import { createHttpApp } from './http.js';

const host = process.env['HOST'] ?? '127.0.0.1';
const port = Number(process.env['PORT'] ?? 3000);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`Invalid PORT: ${process.env['PORT']}`);
  process.exit(1);
}

// Loopback binding gets DNS-rebinding protection for free; anything else must say which Host headers it expects.
const configured = (process.env['ALLOWED_HOSTS'] ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);
const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
const allowedHosts = configured.length ? configured : loopback ? [`127.0.0.1:${port}`, `localhost:${port}`] : undefined;
if (!allowedHosts) {
  console.error(
    'parlament-at-mcp: listening on a non-loopback address without ALLOWED_HOSTS - no Host header check. Put a reverse proxy in front.',
  );
}

const server = createHttpApp(allowedHosts ? { allowedHosts } : {});
server.listen(port, host, () => {
  console.error(`parlament-at-mcp ready: http://${host}:${port}/mcp (health: /healthz)`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
