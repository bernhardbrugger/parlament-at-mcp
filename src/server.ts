import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ParlamentClient } from './client.js';
import { registerAbgeordnete } from './tools/abgeordnete.js';
import { registerAnfragen } from './tools/anfragen.js';
import { registerGegenstand } from './tools/gegenstand.js';
import { registerGegenstaende } from './tools/gegenstaende.js';
import { registerRede } from './tools/rede.js';
import { registerSitzung } from './tools/sitzung.js';
import { registerSitzungen } from './tools/sitzungen.js';

export const SERVER_NAME = 'parlament-at-mcp';
export const SERVER_VERSION = '0.3.0';

export function createServer(client: ParlamentClient = new ParlamentClient()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Daten des österreichischen Parlaments (offene Daten, CC BY 4.0, Quelle: Parlamentsdirektion). ' +
        'Tools liefern amtliche Informationen, keine Rechtsberatung. Bei Zitaten immer die url aus dem Ergebnis angeben. ' +
        'Typische Wege: Reden = parl_sitzungen (Nummer finden) -> parl_sitzung mit redner= (rede-Nummer) -> parl_rede; ' +
        'Gesetze = parl_gegenstaende -> parl_gegenstand (Stand im Verfahren); Anfragen = parl_anfragen -> parl_gegenstand (wer hat gefragt).',
    },
  );
  registerAbgeordnete(server, client);
  registerAnfragen(server, client);
  registerGegenstand(server, client);
  registerGegenstaende(server, client);
  registerSitzungen(server, client);
  registerSitzung(server, client);
  registerRede(server, client);
  return server;
}
