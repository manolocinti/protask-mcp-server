import express, { Express } from 'express';
import { ProTaskClient } from './api-client.js';
import { type TokenVerifier } from './auth.js';
type RpcOutcome = {
    accepted: true;
} | {
    accepted?: false;
    body: Record<string, unknown>;
};
/**
 * Un messaggio JSON-RPC MCP, uguale per /mcp, POST /mcp/sse e /mcp/message.
 * Le notifiche (notifications/*) non hanno risposta: 202. Tool sconosciuti, parametri mancanti
 * ed errori dell'API tornano come risultato del tool con isError. Lancia solo ProTaskUnauthorizedError.
 */
export declare function handleRpc(client: ProTaskClient, message: unknown): Promise<RpcOutcome>;
export declare function createApp(opts?: {
    verifier?: TokenVerifier;
}): Express;
export declare const app: express.Express;
export {};
