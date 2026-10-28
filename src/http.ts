import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ParlamentClient } from './client.js';
import { createServer, SERVER_NAME, SERVER_VERSION } from './server.js';

export interface HttpOptions {
  /** Shared by all requests, so the 1 request/second pause and the caches hold across clients. */
  client?: ParlamentClient;
  /** Accepted `Host` header values (DNS-rebinding protection). Empty/undefined = no check. */
  allowedHosts?: string[];
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY = 1_000_000;

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string, headers: Record<string, string> = {}): void {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null }, headers);
}

async function readBody(req: IncomingMessage, limit: number): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Stateless Streamable-HTTP endpoint for remote use: `POST /mcp` (JSON responses, no sessions, no SSE) and `GET /healthz`.
 * Every request gets its own MCP server instance; only the Parliament client is shared.
 *
 * Not meant to face the open internet as is: put it behind a reverse proxy that adds TLS, authentication and rate limiting.
 * Every call fans out to the Parliament's servers (throttled to one request per second, but still).
 */
export function createHttpApp(opts: HttpOptions = {}): Server {
  const client = opts.client ?? new ParlamentClient();
  const allowed = opts.allowedHosts?.length ? new Set(opts.allowedHosts.map((h) => h.toLowerCase())) : null;
  const maxBody = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;

  return createHttpServer((req, res) => {
    void (async () => {
      try {
        if (allowed && !allowed.has((req.headers.host ?? '').toLowerCase())) {
          rpcError(res, 403, -32000, 'Forbidden: host not allowed');
          return;
        }
        const path = (req.url ?? '/').split('?')[0];

        if (path === '/healthz' && req.method === 'GET') {
          sendJson(res, 200, { status: 'ok', name: SERVER_NAME, version: SERVER_VERSION });
          return;
        }
        if (path !== '/mcp') {
          sendJson(res, 404, { error: 'Not found. The MCP endpoint is POST /mcp.' });
          return;
        }
        if (req.method !== 'POST') {
          rpcError(res, 405, -32000, 'Method not allowed: this server is stateless, use POST /mcp.', { Allow: 'POST' });
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(await readBody(req, maxBody));
        } catch (e) {
          if ((e as { status?: number }).status === 413) rpcError(res, 413, -32000, 'Request body too large');
          else rpcError(res, 400, -32700, 'Parse error: body is not valid JSON');
          return;
        }

        const server = createServer(client);
        const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
        res.on('close', () => {
          void transport.close();
          void server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
      } catch (e) {
        console.error('parlament-at-mcp http error:', e);
        if (!res.headersSent) rpcError(res, 500, -32603, 'Internal server error');
      }
    })();
  });
}
