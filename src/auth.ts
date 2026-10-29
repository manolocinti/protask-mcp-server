import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { RESOURCE_METADATA_URL } from './config.js';

export type VerifyResult = 'ok' | 'invalid' | 'unavailable';

export interface TokenVerifier {
  verify(token: string): Promise<VerifyResult>;
  forget(token: string): void;
}

// Header WWW-Authenticate (RFC 9728): dice al client dove leggere come fare il login OAuth
export function wwwAuthenticate(invalidToken: boolean): string {
  return `Bearer resource_metadata="${RESOURCE_METADATA_URL}"` + (invalidToken ? ', error="invalid_token"' : '');
}

// Legge il token da "Authorization: Bearer <token>" (schema senza maiuscole)
export function extractToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;
  return parts[1];
}

// Controlla il token su ProTask (GET /auth/me). Si ricorda solo l'esito positivo, per ttlMs: la chiave è
// lo sha256 del token, mai il token in chiaro. Solo un 401 vale «token rifiutato»; timeout, rete, 5xx, 429
// e ogni altra risposta imprevista sono «unavailable»: non si chiede un nuovo login per un disservizio
export function createTokenVerifier(
  { apiUrl, ttlMs = 60_000, max = 1000, timeoutMs = 5_000 }:
  { apiUrl: string; ttlMs?: number; max?: number; timeoutMs?: number },
): TokenVerifier {
  const accepted = new Map<string, number>(); // sha256 -> scadenza (ms), in ordine di inserimento
  const pending = new Map<string, Promise<VerifyResult>>(); // richieste in corso per lo stesso token

  const key = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

  const remember = (k: string) => {
    const now = Date.now();
    accepted.delete(k);
    if (accepted.size >= max) {
      for (const [old, expires] of accepted) if (expires <= now) accepted.delete(old);
      // ancora pieno: via la più vecchia
      if (accepted.size >= max) accepted.delete(accepted.keys().next().value as string);
    }
    accepted.set(k, now + ttlMs);
  };

  const ask = async (token: string): Promise<VerifyResult> => {
    try {
      const response = await fetch(`${apiUrl}/auth/me`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'manual', // il token non segue i redirect
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.status === 401) return 'invalid';
      return response.ok ? 'ok' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  };

  return {
    async verify(token) {
      const k = key(token);
      const expires = accepted.get(k);
      if (expires !== undefined) {
        if (expires > Date.now()) return 'ok';
        accepted.delete(k);
      }
      let inCorso = pending.get(k);
      if (!inCorso) {
        inCorso = ask(token).then((result) => {
          if (result === 'ok') remember(k);
          return result;
        }).finally(() => pending.delete(k));
        pending.set(k, inCorso);
      }
      return inCorso;
    },
    forget(token) {
      accepted.delete(key(token));
    },
  };
}

// 401 per mancanza di token o token rifiutato. Il corpo resta quello di sempre: JSON-RPC -32001 dove c'era
export function sendUnauthorized(res: Response, opts: { invalidToken: boolean; jsonRpc?: boolean; id?: unknown }): void {
  res.setHeader('WWW-Authenticate', wwwAuthenticate(opts.invalidToken));
  res.status(401).json(opts.jsonRpc
    ? { jsonrpc: '2.0', error: { code: -32001, message: 'Authorization required' }, id: opts.id }
    : { error: 'Authorization required' });
}

// 503: ProTask non risponde, non si fa rifare il login
export function sendUnavailable(res: Response, id?: unknown): void {
  res.status(503).json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'ProTask non raggiungibile, riprova tra poco' },
    id: id ?? null,
  });
}

// Middleware: token presente e accettato da ProTask, altrimenti 401 (o 503). Il token va in res.locals.token.
// jsonRpc sceglie il corpo del 401: JSON-RPC sulle route che lo avevano già
export function requireToken(verifier: TokenVerifier, { jsonRpc = false }: { jsonRpc?: boolean } = {}) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const id = req.body?.id;
    const token = extractToken(req);
    if (!token) {
      sendUnauthorized(res, { invalidToken: false, jsonRpc, id });
      return;
    }
    const result = await verifier.verify(token);
    if (result === 'invalid') {
      sendUnauthorized(res, { invalidToken: true, jsonRpc, id });
      return;
    }
    if (result === 'unavailable') {
      sendUnavailable(res, id);
      return;
    }
    res.locals.token = token;
    next();
  };
}
