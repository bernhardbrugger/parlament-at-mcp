import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ParlamentClient } from './client.js';
import { registerAbgeordnete } from './tools/abgeordnete.js';
import { registerAnfragen } from './tools/anfragen.js';
import { registerAusschuesse } from './tools/ausschuesse.js';
import { registerGegenstand } from './tools/gegenstand.js';
import { registerGegenstaende } from './tools/gegenstaende.js';
import { registerPerson } from './tools/person.js';
import { registerRede } from './tools/rede.js';
import { registerSitzung } from './tools/sitzung.js';
import { registerSitzungen } from './tools/sitzungen.js';

export const SERVER_NAME = 'parlament-at-mcp';
export const SERVER_VERSION = '0.4.0';

export function createServer(client: ParlamentClient = new ParlamentClient()): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        'Daten des österreichischen Parlaments (offene Daten, CC BY 4.0, Quelle: Parlamentsdirektion). ' +
        'Tools liefern amtliche Informationen, keine Rechtsberatung. Bei Zitaten immer die url aus dem Ergebnis angeben. ' +
        'Typische Wege: Reden = parl_sitzungen (Nummer finden) -> parl_sitzung mit redner= (rede-Nummer) -> parl_rede; ' +
        'Gesetze = parl_gegenstaende -> parl_gegenstand (Stand im Verfahren); Anfragen = parl_anfragen -> parl_gegenstand (wer hat gefragt); ' +
        'Personen = parl_abgeordnete -> parl_person (Lebenslauf) / parl_reden_person (alle Reden); Ausschüsse = parl_ausschuesse (mit suche= inkl. Vorsitz).',
    },
  );
  registerAbgeordnete(server, client);
  registerAnfragen(server, client);
  registerGegenstand(server, client);
  registerGegenstaende(server, client);
  registerSitzungen(server, client);
  registerSitzung(server, client);
  registerRede(server, client);
  registerAusschuesse(server, client);
  registerPerson(server, client);
  return server;
}
