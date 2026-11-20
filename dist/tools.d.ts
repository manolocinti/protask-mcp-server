import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ProTaskClient } from './api-client.js';
import { type UploadLinkStore } from './attachments.js';
type Args = Record<string, unknown>;
/** Tutti i tool, nell'ordine in cui li vede il client. Stesso array per HTTP e stdio. */
export declare const TOOLS: Tool[];
/**
 * Dove gira il server. stdio: sul computer dell'utente, quindi file_path ha senso e non c'è un web
 * per il link di caricamento. http: sul VPS, quindi file_path leggerebbe il disco del server.
 */
export interface ToolContext {
    transport: 'stdio' | 'http';
    uploadLinks?: UploadLinkStore;
}
/** I tool che vede il client su quel trasporto (sottoinsieme di TOOLS). */
export declare const toolsFor: (transport: ToolContext["transport"]) => Tool[];
/**
 * Corpo di una richiesta costruito solo dalle chiavi dello schema del tool (meno quelle del percorso):
 * argomenti inventati dal modello non arrivano all'API. Le chiavi assenti o undefined non si mandano.
 */
export declare function bodyFromSchema(toolName: string, args: Args, exclude?: string[]): Args;
export declare const isKnownTool: (name: string) => boolean;
/**
 * Esegue un tool e restituisce il risultato dell'API. Tool sconosciuto, parametri obbligatori mancanti o
 * argomenti non validi tornano come `{ error }` (toolResult li segna isError). Lancia solo
 * ProTaskUnauthorizedError, così il trasporto HTTP risponde 401 e il client rinnova il token.
 */
export declare function executeTool(client: ProTaskClient, name: string, rawArgs: unknown, ctx?: ToolContext): Promise<unknown>;
export {};
