import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const RULES =
  'Regeln: Zitiere wörtlich nur aus den Tool-Ergebnissen, nenne zu jeder Aussage die Quelle (url) und mache keine Rechtsberatung. ' +
  'Wenn ein Tool nichts findet, sag das offen, statt etwas zu vermuten.';

function user(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

const gp = z.string().max(8).optional().describe('Gesetzgebungsperiode, z. B. XXVIII (sonst die aktuelle, 28)');

/**
 * Ready-made research workflows. Each prompt only tells the model WHICH tools to chain and how to report;
 * all data still comes from the tools.
 */
export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'rede_recherchieren',
    {
      title: 'Was hat jemand im Nationalrat gesagt?',
      description: 'Findet Reden einer Person (optional zu einem Thema) und fasst sie mit Zitaten und Quellen zusammen.',
      argsSchema: {
        redner: z.string().min(2).describe('Name der Person, z. B. Herbert Kickl'),
        thema: z.string().optional().describe('Thema oder Gesetz, auf das sich die Rede bezieht'),
        gp,
      },
    },
    ({ redner, thema, gp: period }) =>
      user(
        `Recherchiere, was ${redner} im Nationalrat${thema ? ` zum Thema "${thema}"` : ''} gesagt hat (Gesetzgebungsperiode ${period ?? 'XXVIII'}).\n` +
          `1. parl_reden_person mit dem Namen: finde passende Sitzungen (Thema und Datum der Reden).\n` +
          `2. parl_sitzung mit gremium, gp, nummer und redner="${redner}": hol die rede-Nummer.\n` +
          `3. parl_rede mit dieser Nummer: lies die Rede (bei langen Reden mit offset weiterlesen).\n` +
          `Fasse die Kernaussagen in 5 Punkten zusammen, gib 2-3 wörtliche Zitate (mit Zwischenrufen nur, wenn sie wichtig sind) und nenne Sitzung, Datum und Quelle.\n${RULES}`,
      ),
  );

  server.registerPrompt(
    'faktencheck',
    {
      title: 'Aussage prüfen: Was wurde im Parlament wirklich gesagt?',
      description:
        'Prüft eine Aussage oder ein Zitat gegen die Plenarprotokolle, Abstimmungen und Anfragen und trennt dabei "wurde so gesagt" von "stimmt sachlich".',
      argsSchema: {
        aussage: z.string().min(5).describe('Die Aussage oder das Zitat, z. B. "Kickl hat im Nationalrat gesagt, ..."'),
        redner: z.string().optional().describe('Wer soll es gesagt haben (Name oder Teil davon)'),
        gp,
      },
    },
    ({ aussage, redner, gp: period }) =>
      user(
        `Prüfe diese Aussage: "${aussage}"${redner ? ` (Redner: ${redner})` : ''} (Gesetzgebungsperiode ${period ?? 'alle'}).
` +
          `1. Zerlege sie in einzelne prüfbare Teile und unterscheide: (a) "X hat gesagt ...", (b) eine Sachbehauptung, (c) eine Behauptung zu einer Abstimmung oder einem Gesetz.
` +
          `2. Zu (a): parl_suche mit bereich="reden", modus="phrase" und einem wörtlichen Auszug${redner ? `, redner="${redner}"` : ''}; findet sich nichts, mit modus="alle" und Schlüsselwörtern, auch mit gp, von und bis eingrenzen. ` +
          `Lies jeden relevanten Treffer mit parl_rede im Wortlaut (zwischenrufe=true) und prüfe den Zusammenhang davor und danach: Ist das Zitat vollständig, verkürzt oder sinnentstellt? Gib den Absatz an, z. B. [12].
` +
          `3. Zu (c): parl_beschluesse (Abstimmung nach Parteien), parl_gegenstand (Stand im Verfahren), parl_anfragen oder parl_suche mit bereich="gegenstaende" bzw. "pressemeldungen".
` +
          `4. Zu (b): Das Parlament belegt nur, was gesagt oder beschlossen wurde. Prüfe die Sachbehauptung mit einer eigenen Recherche in verlässlichen Quellen (amtliche Statistik, Rechnungshof, Ministerien, seriöse Medien), falls du dazu Werkzeuge hast; sonst sag offen, dass dieser Teil ungeprüft bleibt.
` +
          `Antworte in zwei getrennten Teilen: A) Was wurde gesagt oder beschlossen (mit wörtlichem Zitat, Redner, Sitzung, Datum, Absatznummer, url), B) Stimmt es sachlich (mit Quellen). ` +
          `Urteil je Teil: belegt / teilweise belegt / nicht belegt / widerlegt / nicht prüfbar. Beachte: Protokolle können vorläufig und nicht autorisiert sein, Zwischenrufe gehören nicht zur Rede, und ein Treffer belegt nie, dass die Aussage richtig ist.
${RULES}`,
      ),
  );

  server.registerPrompt(
    'gesetz_verfolgen',
    {
      title: 'Wo steht ein Gesetz im Verfahren?',
      description: 'Findet eine Regierungsvorlage oder einen Antrag und erklärt Stand, Abstimmung und nächste Schritte.',
      argsSchema: {
        gesetz: z.string().min(2).describe('Name oder amtliches Schlagwort des Gesetzes, z. B. Verwaltungsverfahren'),
        gp,
      },
    },
    ({ gesetz, gp: period }) =>
      user(
        `Wo steht "${gesetz}" im Gesetzgebungsverfahren (Gesetzgebungsperiode ${period ?? 'XXVIII'})?\n` +
          `1. parl_gegenstaende (art RV, dann ANTR) mit schlagwort; wenn nichts kommt, ohne schlagwort die neuesten Treffer prüfen.\n` +
          `2. parl_gegenstand mit gp und der Zitation des besten Treffers.\n` +
          `Berichte: Einbringer, aktueller Stand (Ausschuss, Nationalrat, Bundesrat, Bundesgesetzblatt), Abstimmungsergebnis nach Parteien, die wichtigsten Dokumente.\n${RULES}`,
      ),
  );

  server.registerPrompt(
    'anfragen_zum_thema',
    {
      title: 'Parlamentarische Anfragen zu einem Thema',
      description: 'Sucht Anfragen und Beantwortungen zu einem Thema und nennt, wer gefragt und wer geantwortet hat.',
      argsSchema: {
        thema: z.string().min(2).describe('Suchbegriff im Betreff, z. B. Polizeischutz'),
        gp,
      },
    },
    ({ thema, gp: period }) =>
      user(
        `Welche parlamentarischen Anfragen gab es zu "${thema}" (Gesetzgebungsperiode ${period ?? 'XXVIII'}) und wie wurden sie beantwortet?\n` +
          `1. parl_anfragen mit suche, art anfrage; danach nochmals mit art beantwortung.\n` +
          `2. parl_gegenstand für die 3-5 relevantesten Treffer: wer hat eingebracht (Partei), wer hat beantwortet, welche PDFs gibt es.\n` +
          `Gib eine Tabelle (Nummer, Datum, Einbringer/Partei, Ministerium, Status) und fasse zusammen, welche Parteien das Thema aufgreifen.\n${RULES}`,
      ),
  );

  server.registerPrompt(
    'ausschuss_ueberblick',
    {
      title: 'Überblick über einen Ausschuss',
      description: 'Zeigt Vorsitz, Aufgaben, letzte Tagesordnungen und aktuelle Gegenstände eines Ausschusses.',
      argsSchema: {
        ausschuss: z.string().min(2).describe('Namensteil des Ausschusses, z. B. Finanz'),
        gp,
      },
    },
    ({ ausschuss, gp: period }) =>
      user(
        `Gib einen Überblick über den Ausschuss "${ausschuss}" (Gesetzgebungsperiode ${period ?? 'XXVIII'}).\n` +
          `1. parl_ausschuesse mit gp und suche (bei mehreren Treffern die Namen auflisten und den passendsten wählen).\n` +
          `2. Für Mitglieder des Vorsitzes optional parl_person.\n` +
          `Berichte: Aufgabe, Vorsitz mit Parteien, letzte Tagesordnungen (Links) und die zuletzt zugewiesenen Gegenstände.\n${RULES}`,
      ),
  );

  server.registerPrompt(
    'abgeordnete_profil',
    {
      title: 'Profil einer Politikerin oder eines Politikers',
      description: 'Fasst Mandate, Funktionen, Lebenslauf und die jüngsten Reden einer Person zusammen.',
      argsSchema: { name: z.string().min(2).describe('Name der Person') },
    },
    ({ name }) =>
      user(
        `Erstelle ein sachliches Profil von ${name}.\n` +
          `1. parl_abgeordnete mit name (bei Mehrdeutigkeit die Kandidaten nennen und nachfragen).\n` +
          `2. parl_person: Mandate mit Zeiträumen, Klub, politische Funktionen, Werdegang.\n` +
          `3. parl_reden_person (limit 5): Themen der jüngsten Reden.\n` +
          `Bleib bei den Fakten aus dem Parlament; die Biografie beruht auf Eigenangaben - weise darauf hin.\n${RULES}`,
      ),
  );
}
