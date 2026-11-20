import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { ProTaskClient, ProTaskUnauthorizedError } from './api-client.js';
import { createTokenVerifier, extractToken, requireToken, sendUnauthorized, sendVerifyFailure, type TokenVerifier } from './auth.js';
import { PROTASK_API_URL, PROTASK_ISSUER, RESOURCE_URL } from './config.js';
import { toolResult, SERVER_INSTRUCTIONS } from './handoff.js';
import { toolsFor, executeTool, isKnownTool, type ToolContext } from './tools.js';
import {
  MAX_ATTACHMENT_BYTES,
  UploadLinkStore,
  payloadFromUpload,
  renderExpiredPage,
  renderUploadPage,
  uploadPageHeaders,
} from './attachments.js';

// Active SSE session (ogni app ha le sue, vedi createApp)
interface SSESession {
  res: Response;
  token: string;
  client: ProTaskClient;
  stop: () => void; // ferma il ping di keep-alive
}

const INITIALIZE_RESULT = {
  protocolVersion: '2024-11-05',
  capabilities: { tools: {} },
  serverInfo: { name: 'protask-mcp-server', version: '1.0.0' },
  instructions: SERVER_INSTRUCTIONS,
};

type RpcOutcome = { accepted: true } | { accepted?: false; body: Record<string, unknown> };

const rpcError = (code: number, message: string, id: unknown): RpcOutcome =>
  ({ body: { jsonrpc: '2.0', error: { code, message }, id: id ?? null } });

/**
 * Un messaggio JSON-RPC MCP, uguale per /mcp, POST /mcp/sse e /mcp/message.
 * Le notifiche (notifications/*) non hanno risposta: 202. Tool sconosciuti, parametri mancanti
 * ed errori dell'API tornano come risultato del tool con isError. Lancia solo ProTaskUnauthorizedError.
 */
export async function handleRpc(
  client: ProTaskClient,
  message: unknown,
  ctx: ToolContext = { transport: 'http' }
): Promise<RpcOutcome> {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) {
    return rpcError(-32600, 'Invalid Request', null);
  }
  const { method, params, id } = message as { method?: unknown; params?: any; id?: unknown };
  if (typeof method !== 'string') return rpcError(-32600, 'Invalid Request', id);
  if (method.startsWith('notifications/')) return { accepted: true };

  let result: unknown;
  switch (method) {
    case 'initialize':
      result = INITIALIZE_RESULT;
      break;
    case 'ping':
      result = {};
      break;
    case 'tools/list':
      result = { tools: toolsFor(ctx.transport) };
      break;
    case 'tools/call': {
      if (typeof params?.name !== 'string') return rpcError(-32602, 'Invalid params: manca il nome del tool (params.name)', id);
      result = toolResult(await executeTool(client, params.name, params.arguments ?? {}, ctx));
      break;
    }
    default:
      return rpcError(-32601, `Method not found: ${method}`, id);
  }
  return { body: { jsonrpc: '2.0', result, id } };
}

function sendRpc(res: Response, outcome: RpcOutcome) {
  if (outcome.accepted) res.status(202).end();
  else res.json(outcome.body);
}

export function createApp(opts: { verifier?: TokenVerifier } = {}): Express {
  const verifier = opts.verifier ?? createTokenVerifier({ apiUrl: PROTASK_API_URL });
  const sessions = new Map<string, SSESession>();
  const app = express();
  // Dietro nginx sulla stessa macchina: ci si fida di X-Forwarded-For solo se la connessione arriva da loopback,
  // e si prende l'ultimo indirizzo non loopback (quello che nginx ha visto). Con `true` si userebbe il primo
  // valore, che il client può falsificare: aggirerebbe il limite per IP o bloccherebbe l'IP di un altro
  app.set('trust proxy', 'loopback');
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
    exposedHeaders: ['WWW-Authenticate'],
  }));
  const uploadLinks = new UploadLinkStore();
  const ctx: ToolContext = { transport: 'http', uploadLinks };

  // Pagina del link di caricamento (protask_attachment_upload_link). Il codice nel path è l'unica
  // credenziale: chi lo ha può allegare file a quel task per 15 minuti. Prima di express.json(), così
  // un file .json caricato arriva come byte e non viene interpretato
  app.get('/upload/:code', (req: Request, res: Response) => {
    const nonce = crypto.randomBytes(16).toString('base64');
    const link = uploadLinks.get(req.params.code);
    res.status(link ? 200 : 404).set(uploadPageHeaders(nonce));
    res.send(link ? renderUploadPage({ taskTitle: link.taskTitle, expiresAt: link.expiresAt, nonce }) : renderExpiredPage(nonce));
  });

  const rawBody = express.raw({ type: () => true, limit: MAX_ATTACHMENT_BYTES });
  app.post('/upload/:code', (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    const code = req.params.code;
    if (!uploadLinks.get(code)) {
      res.status(404).json({ error: 'link scaduto o non valido: chiedi a Claude un nuovo link' });
      return;
    }
    rawBody(req, res, async (err?: unknown) => {
      if (err) {
        const status = (err as { status?: number }).status;
        res.status(status === 413 ? 413 : 400).json({
          error: status === 413 ? `file oltre ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` : 'caricamento non leggibile',
        });
        return;
      }
      // Si rilegge: il link può essere scaduto o esaurito mentre arrivava il file
      const link = uploadLinks.get(code);
      if (!link) {
        res.status(404).json({ error: 'link scaduto o non valido: chiedi a Claude un nuovo link' });
        return;
      }
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) {
        res.status(400).json({ error: 'file vuoto' });
        return;
      }
      link.uploaded++;
      try {
        const file = payloadFromUpload(body, req.get('X-File-Name'), req.get('X-File-Type'));
        const result = (await link.client.uploadAttachment(link.taskId, file)) as { error?: string };
        if (result.error) {
          link.uploaded--;
          res.status(502).json({ error: `ProTask ha rifiutato il file: ${result.error}` });
          return;
        }
        res.status(201).json({ ok: true, name: file.name, size: body.length });
      } catch (error) {
        if (error instanceof ProTaskUnauthorizedError) {
          uploadLinks.revoke(code);
          res.status(401).json({ error: 'la sessione ProTask è scaduta: chiedi a Claude un nuovo link' });
          return;
        }
        link.uploaded--;
        res.status(500).json({ error: 'errore durante il caricamento' });
      }
    });
  });

  app.use(express.json());

  // L'API ha risposto 401 durante un tool: il token è morto, si toglie dalla memoria e si risponde 401
  // (invece di un errore del tool dentro un 200) così il client rinnova il token o chiede il login
  const tokenMorto = (res: Response, token: string, jsonRpc: boolean, id?: unknown) => {
    verifier.forget(token);
    sendUnauthorized(res, { invalidToken: true, jsonRpc, id });
  };

  // Documento RFC 9728: dice ai client OAuth chi rilascia i token per questa risorsa
  const protectedResource = (req: Request, res: Response) => {
    res.json({
      resource: RESOURCE_URL,
      authorization_servers: [PROTASK_ISSUER],
      bearer_methods_supported: ['header'],
      scopes_supported: ['protask', 'offline_access'],
    });
  };
  app.get('/.well-known/oauth-protected-resource/mcp/sse', protectedResource);
  app.get('/.well-known/oauth-protected-resource', protectedResource);

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', server: 'protask-mcp-server', version: '1.0.0' });
  });

  // List tools
  app.get('/mcp/tools', (req: Request, res: Response) => {
    res.json({ tools: toolsFor('http') });
  });

  // Call tool directly
  app.post('/mcp/tools/:toolName', requireToken(verifier), async (req: Request, res: Response) => {
    const token: string = res.locals.token;
    const { toolName } = req.params;
    if (!isKnownTool(toolName)) {
      res.status(404).json({ success: false, error: `Tool sconosciuto: ${toolName}` });
      return;
    }
    const client = new ProTaskClient(token, PROTASK_API_URL);
    try {
      const result = await executeTool(client, toolName, req.body || {}, ctx);
      res.json({ success: !toolResult(result).isError, data: result });
    } catch (error) {
      if (error instanceof ProTaskUnauthorizedError) { tokenMorto(res, token, false); return; }
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // MCP JSON-RPC endpoint
  app.post('/mcp', requireToken(verifier, { jsonRpc: true }), async (req: Request, res: Response) => {
    const token: string = res.locals.token;
    const client = new ProTaskClient(token, PROTASK_API_URL);
    try {
      sendRpc(res, await handleRpc(client, req.body, ctx));
    } catch (error) {
      if (error instanceof ProTaskUnauthorizedError) { tokenMorto(res, token, true, req.body?.id); return; }
      res.json({ jsonrpc: '2.0', error: { code: -32000, message: error instanceof Error ? error.message : 'Unknown error' }, id: req.body?.id ?? null });
    }
  });

  // SSE endpoint - MCP protocol
  app.get('/mcp/sse', requireToken(verifier), (req: Request, res: Response) => {
    const token: string = res.locals.token;

    // Generate unique session ID
    const sessionId = crypto.randomUUID();

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.flushHeaders();

    // Create client and store session
    const client = new ProTaskClient(token, PROTASK_API_URL);

    // Send endpoint event - this tells the client where to POST messages
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const endpointUrl = `${baseUrl}/mcp/message?sessionId=${sessionId}`;
    res.write(`event: endpoint\ndata: ${endpointUrl}\n\n`);

    console.log(`[SSE] Session ${sessionId} connected`);

    // Keep-alive ping
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(`:ping\n\n`);
      }
    }, 15000);
    sessions.set(sessionId, { res, token, client, stop: () => clearInterval(keepAlive) });

    // Cleanup on close
    req.on('close', () => {
      clearInterval(keepAlive);
      sessions.delete(sessionId);
      console.log(`[SSE] Session ${sessionId} disconnected`);
    });
  });

  // Message endpoint - receives JSON-RPC requests from mcp-remote
  app.post('/mcp/message', async (req: Request, res: Response) => {
    const sessionId = req.query.sessionId as string;
    const session = sessions.get(sessionId);

    if (!session) {
      // Senza sessione e senza token non c'è nulla da controllare: si manda al login. Con un token, la sessione è scaduta
      if (!extractToken(req)) { sendUnauthorized(res, { invalidToken: false, jsonRpc: true, id: req.body?.id }); return; }
      res.status(400).json({ error: 'Invalid or expired session' });
      return;
    }

    const { method, id } = req.body ?? {};

    // Si controlla il token con cui è stata aperta la sessione; se ProTask lo rifiuta la sessione si chiude
    const chiudiSessione = () => {
      session.stop();
      sessions.delete(sessionId);
      session.res.end();
    };
    const verdict = await verifier.verify(session.token, req.ip ?? 'sconosciuto');
    if (verdict === 'invalid') {
      chiudiSessione();
      sendUnauthorized(res, { invalidToken: true, jsonRpc: true, id });
      return;
    }
    if (verdict !== 'ok') {
      sendVerifyFailure(res, verdict, id);
      return;
    }

    console.log(`[MSG] Session ${sessionId} - Method: ${method}, ID: ${id}`);

    try {
      sendRpc(res, await handleRpc(session.client, req.body, ctx));
    } catch (error) {
      if (error instanceof ProTaskUnauthorizedError) {
        chiudiSessione();
        tokenMorto(res, session.token, true, id);
        return;
      }
      console.error(`[ERR] Session ${sessionId}:`, error);
      res.json({
        jsonrpc: '2.0',
        error: { code: -32000, message: error instanceof Error ? error.message : 'Unknown error' },
        id
      });
    }
  });

  // Also support POST to /mcp/sse for Streamable HTTP transport
  app.post('/mcp/sse', requireToken(verifier, { jsonRpc: true }), async (req: Request, res: Response) => {
    const token: string = res.locals.token;
    const client = new ProTaskClient(token, PROTASK_API_URL);
    const { method, id } = req.body ?? {};

    console.log(`[HTTP] Direct POST - Method: ${method}, ID: ${id}`);

    try {
      sendRpc(res, await handleRpc(client, req.body, ctx));
    } catch (error) {
      if (error instanceof ProTaskUnauthorizedError) { tokenMorto(res, token, true, id); return; }
      console.error(`[ERR] Direct POST:`, error);
      res.json({
        jsonrpc: '2.0',
        error: { code: -32000, message: error instanceof Error ? error.message : 'Unknown error' },
        id
      });
    }
  });

  return app;
}

export const app = createApp();
