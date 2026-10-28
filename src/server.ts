import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ParlamentClient } from './client.js';
import { registerAbgeordnete } from './tools/abgeordnete.js';
import { registerAnfragen } from './tools/anfragen.js';
import { registerGegenstand } from './tools/gegenstand.js';

export const SERVER_NAME = 'parlament-at-mcp';
export const SERVER_VERSION = '0.2.0';

export function createServer(client: ParlamentClient = new ParlamentClient()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Daten des österreichischen Parlaments (offene Daten, CC BY 4.0, Quelle: Parlamentsdirektion). ' +
        'Tools liefern amtliche Informationen, keine Rechtsberatung. Bei Zitaten immer die url aus dem Ergebnis angeben.',
    },
  );
  registerAbgeordnete(server, client);
  registerAnfragen(server, client);
  registerGegenstand(server, client);
  return server;
}
