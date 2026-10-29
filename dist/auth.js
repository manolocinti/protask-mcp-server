import crypto from 'crypto';
import { RESOURCE_METADATA_URL } from './config.js';
// Header WWW-Authenticate (RFC 9728): dice al client dove leggere come fare il login OAuth
export function wwwAuthenticate(invalidToken) {
    return `Bearer resource_metadata="${RESOURCE_METADATA_URL}"` + (invalidToken ? ', error="invalid_token"' : '');
}
// Legge il token da "Authorization: Bearer <token>" (schema senza maiuscole, uno o piu spazi dopo)
export function extractToken(req) {
    const match = /^bearer +(\S+)$/i.exec(req.headers.authorization ?? '');
    return match ? match[1] : null;
}
// Controlla il token su ProTask (GET /auth/me). Si ricorda solo l'esito positivo, per ttlMs: la chiave è
// lo sha256 del token, mai il token in chiaro. Solo un 401 vale «token rifiutato»; timeout, rete, 5xx, 429
// sono «unavailable»; ogni altro stato imprevisto è «rejected»: in nessun caso si chiede un nuovo login.
// Per ogni IP del client si contano gli esiti 'invalid' (finestra fissa di invalidWindowMs): oltre maxInvalid,
// un token non in memoria come 'ok' riceve {retryAfter} senza chiamare ProTask. ProTask vede tutte le verifiche
// dall'IP di questo server e limita le anonime a 60/min: senza questo tetto, chi manda token inventati
// esaurirebbe il limite e i colleghi con il token scaduto non riceverebbero piu il 401 che fa partire il refresh
export function createTokenVerifier({ apiUrl, ttlMs = 60_000, max = 1000, timeoutMs = 5_000, maxInvalid = 20, invalidWindowMs = 60_000, maxIps = 10_000 }) {
    const accepted = new Map(); // sha256 -> scadenza (ms), in ordine di inserimento
    const invalidPerIp = new Map(); // ip -> esiti 'invalid' nella finestra
    const pending = new Map(); // richieste in corso per lo stesso token
    const key = (token) => crypto.createHash('sha256').update(token).digest('hex');
    const remember = (k) => {
        const now = Date.now();
        accepted.delete(k);
        if (accepted.size >= max) {
            for (const [old, expires] of accepted)
                if (expires <= now)
                    accepted.delete(old);
            // ancora pieno: via la più vecchia
            if (accepted.size >= max)
                accepted.delete(accepted.keys().next().value);
        }
        accepted.set(k, now + ttlMs);
    };
    // secondi da aspettare se l'IP ha esaurito gli 'invalid' della finestra, altrimenti 0
    const throttledFor = (ip) => {
        const entry = invalidPerIp.get(ip);
        if (!entry || entry.resetAt <= Date.now() || entry.count < maxInvalid)
            return 0;
        return Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000));
    };
    const countInvalid = (ip) => {
        const now = Date.now();
        const entry = invalidPerIp.get(ip);
        if (entry && entry.resetAt > now) {
            entry.count++;
            return;
        }
        invalidPerIp.delete(ip);
        if (invalidPerIp.size >= maxIps) {
            for (const [old, e] of invalidPerIp)
                if (e.resetAt <= now)
                    invalidPerIp.delete(old);
            // ancora pieno: via il più vecchio
            if (invalidPerIp.size >= maxIps)
                invalidPerIp.delete(invalidPerIp.keys().next().value);
        }
        invalidPerIp.set(ip, { count: 1, resetAt: now + invalidWindowMs });
    };
    const ask = async (token) => {
        try {
            const response = await fetch(`${apiUrl}/auth/me`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
                redirect: 'manual', // il token non segue i redirect
                signal: AbortSignal.timeout(timeoutMs),
            });
            // il corpo non serve: si scarta sempre, perche la connessione torni libera
            await response.body?.cancel().catch(() => undefined);
            if (response.status === 401)
                return 'invalid';
            if (response.ok)
                return 'ok';
            return response.status >= 500 || response.status === 429 ? 'unavailable' : { rejected: response.status };
        }
        catch {
            return 'unavailable';
        }
    };
    return {
        async verify(token, ip) {
            const k = key(token);
            const expires = accepted.get(k);
            if (expires !== undefined) {
                if (expires > Date.now())
                    return 'ok'; // un token già valido passa sempre, anche da un IP bloccato
                accepted.delete(k);
            }
            if (ip !== undefined) {
                const retryAfter = throttledFor(ip);
                if (retryAfter > 0)
                    return { retryAfter };
            }
            let inCorso = pending.get(k);
            if (!inCorso) {
                const questa = ask(token).then((result) => {
                    // se nel frattempo c'e stato un forget() la voce non e piu questa: l'esito non si ricorda
                    if (result === 'ok' && pending.get(k) === questa)
                        remember(k);
                    return result;
                }).finally(() => { if (pending.get(k) === questa)
                    pending.delete(k); });
                inCorso = questa;
                pending.set(k, questa);
            }
            const result = await inCorso;
            if (result === 'invalid' && ip !== undefined)
                countInvalid(ip);
            return result;
        },
        forget(token) {
            const k = key(token);
            accepted.delete(k);
            pending.delete(k); // una verifica gia partita non rimette 'ok' in memoria
        },
    };
}
// 401 per mancanza di token o token rifiutato. Il corpo resta quello di sempre: JSON-RPC -32001 dove c'era
export function sendUnauthorized(res, opts) {
    res.setHeader('WWW-Authenticate', wwwAuthenticate(opts.invalidToken));
    res.status(401).json(opts.jsonRpc
        ? { jsonrpc: '2.0', error: { code: -32001, message: 'Authorization required' }, id: opts.id }
        : { error: 'Authorization required' });
}
// 503 quando la verifica non da ne 'ok' ne 'invalid': non si fa rifare il login. Il messaggio distingue
// il disservizio dallo stato imprevisto di /auth/me. 429 con Retry-After se l'IP ha troppi token non validi
export function sendVerifyFailure(res, result, id) {
    if (typeof result === 'object' && 'retryAfter' in result) {
        res.setHeader('Retry-After', String(result.retryAfter));
        res.status(429).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Troppi token non validi da questo indirizzo, riprova tra un minuto' },
            id: id ?? null,
        });
        return;
    }
    const message = result === 'unavailable'
        ? 'ProTask non raggiungibile, riprova tra poco'
        : `ProTask ha rifiutato la verifica del token (HTTP ${result.rejected})`;
    res.status(503).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: id ?? null });
}
// Middleware: token presente e accettato da ProTask, altrimenti 401 (o 503). Il token va in res.locals.token.
// jsonRpc sceglie il corpo del 401: JSON-RPC sulle route che lo avevano già
export function requireToken(verifier, { jsonRpc = false } = {}) {
    return async (req, res, next) => {
        const id = req.body?.id;
        const token = extractToken(req);
        if (!token) {
            sendUnauthorized(res, { invalidToken: false, jsonRpc, id });
            return;
        }
        const result = await verifier.verify(token, req.ip ?? 'sconosciuto');
        if (result === 'invalid') {
            sendUnauthorized(res, { invalidToken: true, jsonRpc, id });
            return;
        }
        if (result !== 'ok') {
            sendVerifyFailure(res, result, id);
            return;
        }
        res.locals.token = token;
        next();
    };
}
