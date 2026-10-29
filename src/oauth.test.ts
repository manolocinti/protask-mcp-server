import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { app, createApp } from './app.js';
import { createTokenVerifier, extractToken } from './auth.js';
import { ProTaskClient, ProTaskUnauthorizedError } from './api-client.js';
import { PROTASK_API_URL } from './config.js';

let server: Server;
let base: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function leggiMetadata(path: string) {
  const res = await fetch(base + path);
  assert.equal(res.status, 200);
  return await res.json() as Record<string, unknown>;
}

const ATTESO = {
  resource: 'https://protask-mcp.ilmarketing.net/mcp/sse',
  authorization_servers: ['https://protask.ilmarketing.net'],
  bearer_methods_supported: ['header'],
  scopes_supported: ['protask', 'offline_access'],
};

test('metadata su /.well-known/oauth-protected-resource/mcp/sse', async () => {
  const body = await leggiMetadata('/.well-known/oauth-protected-resource/mcp/sse');
  assert.equal(body.resource, ATTESO.resource);
  assert.deepEqual(body.authorization_servers, ATTESO.authorization_servers);
  assert.deepEqual(body.bearer_methods_supported, ATTESO.bearer_methods_supported);
  assert.deepEqual(body.scopes_supported, ATTESO.scopes_supported);
});

test('metadata anche su /.well-known/oauth-protected-resource', async () => {
  assert.deepEqual(await leggiMetadata('/.well-known/oauth-protected-resource'), ATTESO);
});

test('health risponde', async () => {
  const res = await fetch(base + '/health');
  assert.equal(res.status, 200);
});

// ---------------------------------------------------------------------------
// Task 9: 401 con WWW-Authenticate e controllo del token su ProTask
// ---------------------------------------------------------------------------

const fetchOriginale = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginale; });

// Letterali, non costruiti da config.ts: se cambia l'URL pubblico il test deve accorgersene
const SENZA_TOKEN = 'Bearer resource_metadata="https://protask-mcp.ilmarketing.net/.well-known/oauth-protected-resource/mcp/sse"';
const TOKEN_RIFIUTATO = `${SENZA_TOKEN}, error="invalid_token"`;

type Chiamata = { path: string; auth: string | undefined };
type Risposta = Response | Error;

// Stub di fetch per l'API di ProTask: le richieste del test all'app in ascolto passano all'originale.
// Il gestore riceve il percorso (es. "/auth/me") e dà la risposta, o un Error per simulare la rete giù
function stubApi(gestore: (path: string, n: number) => Risposta | Promise<Risposta>): Chiamata[] {
  const chiamate: Chiamata[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1:')) return fetchOriginale(url, init);
    assert.ok(u.startsWith(PROTASK_API_URL), `URL non previsto: ${u}`);
    const path = u.slice(PROTASK_API_URL.length);
    chiamate.push({ path, auth: init?.headers?.Authorization });
    const r = await gestore(path, chiamate.length);
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return chiamate;
}

const risposta = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const utenteOk = () => risposta({ data: { id: 1, name: 'Mario Rossi' } });
const contaMe = (chiamate: Chiamata[]) => chiamate.filter((c) => c.path === '/auth/me').length;

// Ogni test ha la sua app (e la sua memoria dei token), in ascolto su una porta libera
async function avvia(opts: { ttlMs?: number } = {}) {
  const verifier = createTokenVerifier({ apiUrl: PROTASK_API_URL, ...opts });
  const srv = createApp({ verifier }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => srv.once('listening', resolve));
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const chiudi = async () => {
    srv.closeAllConnections();
    await new Promise<void>((resolve) => srv.close(() => resolve()));
  };
  return { url, verifier, chiudi };
}

const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  JSON.stringify({ jsonrpc: '2.0', method, params, id });
const intest = (token?: string) => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
});

test('senza token 401 con resource_metadata', async () => {
  const chiamate = stubApi(() => utenteOk());
  const s = await avvia();
  try {
    const casi: [string, string, string | undefined][] = [
      ['POST', '/mcp/sse', rpc('initialize')],
      ['GET', '/mcp/sse', undefined],
      ['POST', '/mcp', rpc('initialize')],
      ['POST', '/mcp/tools/protask_get_me', '{}'],
      ['POST', '/mcp/message?sessionId=inesistente', rpc('initialize')],
    ];
    for (const [method, path, body] of casi) {
      const res = await fetch(s.url + path, { method, headers: intest(), body });
      assert.equal(res.status, 401, `${method} ${path}`);
      assert.equal(res.headers.get('www-authenticate'), SENZA_TOKEN, `${method} ${path}`);
    }
    // il corpo resta quello di oggi: JSON-RPC -32001 dove c'era già
    const res = await fetch(s.url + '/mcp', { method: 'POST', headers: intest(), body: rpc('initialize', {}, 7) });
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', error: { code: -32001, message: 'Authorization required' }, id: 7 });
    const res2 = await fetch(s.url + '/mcp/sse', { headers: intest() });
    assert.deepEqual(await res2.json(), { error: 'Authorization required' });
    assert.equal(chiamate.length, 0, 'senza token non si chiama ProTask');
  } finally { await s.chiudi(); }
});

test('token rifiutato: 401 con invalid_token', async () => {
  stubApi(() => risposta({ message: 'Unauthenticated.' }, 401));
  const s = await avvia();
  try {
    for (const [path, body] of [['/mcp', rpc('tools/list')], ['/mcp/sse', rpc('tools/list')], ['/mcp/tools/protask_get_me', '{}']]) {
      const res = await fetch(s.url + path, { method: 'POST', headers: intest('scaduto'), body });
      assert.equal(res.status, 401, path);
      assert.equal(res.headers.get('www-authenticate'), TOKEN_RIFIUTATO, path);
    }
    const sse = await fetch(s.url + '/mcp/sse', { headers: intest('scaduto') });
    assert.equal(sse.status, 401);
    assert.equal(sse.headers.get('www-authenticate'), TOKEN_RIFIUTATO);
  } finally { await s.chiudi(); }
});

test('memoria 60 s: due initialize con lo stesso token chiamano /auth/me una volta sola', async () => {
  const chiamate = stubApi(() => utenteOk());
  const s = await avvia();
  try {
    for (let i = 0; i < 2; i++) {
      const res = await fetch(s.url + '/mcp/sse', { method: 'POST', headers: intest('tok-memoria'), body: rpc('initialize', {}, i) });
      assert.equal(res.status, 200);
    }
    assert.equal(contaMe(chiamate), 1);
    assert.equal(chiamate[0].auth, 'Bearer tok-memoria');
    // un altro token ha la sua verifica
    await fetch(s.url + '/mcp/sse', { method: 'POST', headers: intest('altro-token'), body: rpc('initialize') });
    assert.equal(contaMe(chiamate), 2);
  } finally { await s.chiudi(); }
});

test('richieste in parallelo con lo stesso token: una sola chiamata a /auth/me', async () => {
  const chiamate = stubApi(() => utenteOk());
  const v = createTokenVerifier({ apiUrl: PROTASK_API_URL });
  const esiti = await Promise.all([v.verify('t'), v.verify('t'), v.verify('t')]);
  assert.deepEqual(esiti, ['ok', 'ok', 'ok']);
  assert.equal(contaMe(chiamate), 1);
});

test('ProTask giu: 503 e non 401, e l esito non si ricorda', async () => {
  const guasti: Array<() => Risposta> = [
    () => new Error('fetch failed'),
    () => risposta({ message: 'Service Unavailable' }, 503),
    () => risposta({ message: 'Too Many Attempts.' }, 429),
  ];
  for (const guasto of guasti) {
    let giu = true;
    const chiamate = stubApi(() => (giu ? guasto() : utenteOk()));
    const s = await avvia();
    try {
      const res = await fetch(s.url + '/mcp', { method: 'POST', headers: intest('tok'), body: rpc('initialize', {}, 5) });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get('www-authenticate'), null);
      assert.deepEqual(await res.json(), {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'ProTask non raggiungibile, riprova tra poco' },
        id: 5,
      });
      // tornato su, la richiesta dopo passa: il guasto non e stato messo in memoria
      giu = false;
      const res2 = await fetch(s.url + '/mcp', { method: 'POST', headers: intest('tok'), body: rpc('initialize') });
      assert.equal(res2.status, 200);
      assert.equal(contaMe(chiamate), 2);
    } finally { await s.chiudi(); }
  }
});

test('timeout di ProTask: unavailable', async () => {
  globalThis.fetch = ((_url: any, init: any) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  })) as typeof fetch;
  const v = createTokenVerifier({ apiUrl: PROTASK_API_URL, timeoutMs: 30 });
  assert.equal(await v.verify('tok'), 'unavailable');
});

test('tool con 401: HTTP 401 invalid_token, e la richiesta dopo richiama /auth/me', async () => {
  let apiGiu401 = false;
  const chiamate = stubApi((path) => {
    if (path === '/auth/me') return utenteOk();
    return apiGiu401 ? risposta({ message: 'Unauthenticated.' }, 401) : risposta({ data: [] });
  });
  const s = await avvia();
  try {
    const chiama = (path: string, body: string) => fetch(s.url + path, { method: 'POST', headers: intest('tok-tool'), body });
    const tool = rpc('tools/call', { name: 'protask_my_tasks', arguments: {} });

    assert.equal((await chiama('/mcp/sse', tool)).status, 200);
    assert.equal(contaMe(chiamate), 1);

    apiGiu401 = true;
    for (const [path, body] of [['/mcp', tool], ['/mcp/sse', tool], ['/mcp/tools/protask_my_tasks', '{}']]) {
      const res = await chiama(path, body);
      assert.equal(res.status, 401, path);
      assert.equal(res.headers.get('www-authenticate'), TOKEN_RIFIUTATO, path);
    }
    // il primo 401 ha tolto la voce dalla memoria: le due richieste dopo hanno richiamato /auth/me
    assert.equal(contaMe(chiamate), 3);
  } finally { await s.chiudi(); }
});

// Apre GET /mcp/sse e restituisce l'URL dell'evento "endpoint" con il lettore ancora aperto
async function apriSse(url: string, token: string) {
  const res = await fetch(url + '/mcp/sse', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const lettore = res.body!.getReader();
  const decoder = new TextDecoder();
  let testo = '';
  while (!/data: (\S+)\n/.test(testo)) {
    const { value, done } = await lettore.read();
    assert.ok(!done, 'il flusso SSE si e chiuso prima dell evento endpoint');
    testo += decoder.decode(value);
  }
  return { endpoint: /data: (\S+)\n/.exec(testo)![1], lettore };
}

test('sessione SSE con token rifiutato: /mcp/message 401 e la sessione sparisce', async () => {
  let rifiuta = false;
  stubApi(() => (rifiuta ? risposta({ message: 'Unauthenticated.' }, 401) : utenteOk()));
  const s = await avvia({ ttlMs: 50 });
  try {
    const { endpoint, lettore } = await apriSse(s.url, 'tok-sse');
    assert.match(endpoint, /\/mcp\/message\?sessionId=/);

    // finche il token vale, la sessione lavora (senza header Authorization sul POST)
    const ok = await fetch(endpoint, { method: 'POST', headers: intest(), body: rpc('ping') });
    assert.equal(ok.status, 200);

    // scade la memoria e ProTask rifiuta il token
    rifiuta = true;
    await new Promise((r) => setTimeout(r, 100));
    const res = await fetch(endpoint, { method: 'POST', headers: intest(), body: rpc('ping') });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), TOKEN_RIFIUTATO);

    // la sessione e chiusa: il flusso SSE finisce e un nuovo POST non la trova piu
    const fine = await lettore.read();
    assert.equal(fine.done, true);
    const dopo = await fetch(endpoint, { method: 'POST', headers: intest('tok-sse'), body: rpc('ping') });
    assert.equal(dopo.status, 400);
  } finally { await s.chiudi(); }
});

test('sessione SSE: forget() fa richiamare ProTask alla richiesta dopo', async () => {
  let rifiuta = false;
  const chiamate = stubApi(() => (rifiuta ? risposta({}, 401) : utenteOk()));
  const s = await avvia();
  try {
    const { endpoint, lettore } = await apriSse(s.url, 'tok-forget');
    assert.equal((await fetch(endpoint, { method: 'POST', headers: intest(), body: rpc('ping') })).status, 200);
    assert.equal(contaMe(chiamate), 1, 'ancora in memoria');
    s.verifier.forget('tok-forget');
    rifiuta = true;
    assert.equal((await fetch(endpoint, { method: 'POST', headers: intest(), body: rpc('ping') })).status, 401);
    assert.equal(contaMe(chiamate), 2);
    await lettore.cancel();
  } finally { await s.chiudi(); }
});

test('minuscolo e notifiche: bearer minuscolo passa, notifications/initialized senza token da 401', async () => {
  stubApi(() => utenteOk());
  const s = await avvia();
  try {
    const conMinuscolo = await fetch(s.url + '/mcp/sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: 'bearer tok-minuscolo' },
      body: rpc('initialize'),
    });
    assert.equal(conMinuscolo.status, 200);

    const ok = await fetch(s.url + '/mcp/sse', { method: 'POST', headers: intest('tok-minuscolo'), body: rpc('notifications/initialized', undefined, null) });
    assert.equal(ok.status, 202);

    for (const path of ['/mcp/sse', '/mcp']) {
      const senza = await fetch(s.url + path, { method: 'POST', headers: intest(), body: rpc('notifications/initialized', undefined, null) });
      assert.equal(senza.status, 401, path);
      assert.equal(senza.headers.get('www-authenticate'), SENZA_TOKEN, path);
    }
  } finally { await s.chiudi(); }
});

test('CORS espone WWW-Authenticate', async () => {
  stubApi(() => utenteOk());
  const s = await avvia();
  try {
    const res = await fetch(s.url + '/mcp', { method: 'POST', headers: { ...intest(), Origin: 'https://claude.ai' }, body: rpc('initialize') });
    assert.equal(res.status, 401);
    assert.match(res.headers.get('access-control-expose-headers') ?? '', /WWW-Authenticate/i);
  } finally { await s.chiudi(); }
});

test('token del profilo: un token qualsiasi accettato da /auth/me funziona come prima', async () => {
  const chiamate = stubApi(() => utenteOk());
  const s = await avvia();
  try {
    const res = await fetch(s.url + '/mcp', {
      method: 'POST',
      headers: intest('1|token-statico-del-profilo'),
      body: rpc('tools/call', { name: 'protask_get_me', arguments: {} }),
    });
    assert.equal(res.status, 200);
    const corpo = await res.json() as { result: { content: { text: string }[] } };
    assert.match(corpo.result.content[0].text, /Mario Rossi/);
    // verifica + tool: due chiamate a /auth/me, entrambe con il token del profilo
    assert.deepEqual(chiamate.map((c) => c.auth), ['Bearer 1|token-statico-del-profilo', 'Bearer 1|token-statico-del-profilo']);
  } finally { await s.chiudi(); }
});

test('app diverse non condividono le sessioni', async () => {
  stubApi(() => utenteOk());
  const a = await avvia();
  const b = await avvia();
  try {
    const { endpoint, lettore } = await apriSse(a.url, 'tok-a');
    const sulla_b = endpoint.replace(a.url, b.url);
    const res = await fetch(sulla_b, { method: 'POST', headers: intest('tok-a'), body: rpc('ping') });
    assert.equal(res.status, 400);
    await lettore.cancel();
  } finally { await a.chiudi(); await b.chiudi(); }
});

test('api-client lancia sul 401', async () => {
  stubApi(() => risposta({ message: 'Unauthenticated.' }, 401));
  await assert.rejects(() => new ProTaskClient('tok', PROTASK_API_URL).me(), ProTaskUnauthorizedError);
});

test('api-client non lancia sul 404', async () => {
  stubApi(() => risposta({ message: 'Not found' }, 404));
  const r = await new ProTaskClient('tok', PROTASK_API_URL).getTask(99);
  assert.match(String(r.error), /^HTTP 404/);
});

// ---------------------------------------------------------------------------
// Task 9, giro 1
// ---------------------------------------------------------------------------

test('forget durante una verifica in corso: l esito vecchio non torna in memoria', async () => {
  let sblocca!: () => void;
  const bloccata = new Promise<void>((resolve) => { sblocca = resolve; });
  // la prima chiamata resta in attesa e poi risponde 200; le successive rispondono 401
  const chiamate = stubApi((_path, n) => (n === 1 ? bloccata.then(utenteOk) : risposta({}, 401)));

  const v = createTokenVerifier({ apiUrl: PROTASK_API_URL });
  const prima = v.verify('tok');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(chiamate.length, 1);

  v.forget('tok');
  assert.equal(await v.verify('tok'), 'invalid'); // nuova chiamata, non quella in corso
  assert.equal(chiamate.length, 2);

  sblocca();
  assert.equal(await prima, 'ok'); // chi aspettava prima del forget riceve il suo esito...
  assert.equal(await v.verify('tok'), 'invalid'); // ...ma non e finito in memoria
  assert.equal(chiamate.length, 3);
});

test('sessione SSE: tools/call con 401 dell API chiude la sessione e fa richiamare /auth/me', async () => {
  let apiMorta = false;
  const chiamate = stubApi((path) => {
    if (path === '/auth/me') return utenteOk();
    return apiMorta ? risposta({ message: 'Unauthenticated.' }, 401) : risposta({ data: [] });
  });
  const s = await avvia();
  try {
    const { endpoint, lettore } = await apriSse(s.url, 'tok-sse-tool');
    const tool = rpc('tools/call', { name: 'protask_my_tasks', arguments: {} });
    assert.equal((await fetch(endpoint, { method: 'POST', headers: intest(), body: tool })).status, 200);
    assert.equal(contaMe(chiamate), 1);

    apiMorta = true;
    const res = await fetch(endpoint, { method: 'POST', headers: intest(), body: tool });
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), TOKEN_RIFIUTATO);

    // sessione chiusa e rimossa
    assert.equal((await lettore.read()).done, true);
    const dopo = await fetch(endpoint, { method: 'POST', headers: intest('tok-sse-tool'), body: rpc('ping') });
    assert.equal(dopo.status, 400);

    // forget chiamato: la richiesta dopo con lo stesso token richiama /auth/me
    const prima = contaMe(chiamate);
    await fetch(s.url + '/mcp', { method: 'POST', headers: intest('tok-sse-tool'), body: rpc('initialize') });
    assert.equal(contaMe(chiamate), prima + 1);
  } finally { await s.chiudi(); }
});

test('sessione SSE: /auth/me in 503 sulla verifica da 503 e la sessione resta', async () => {
  let giu = false;
  stubApi(() => (giu ? risposta({ message: 'Service Unavailable' }, 503) : utenteOk()));
  const s = await avvia({ ttlMs: 50 });
  try {
    const { endpoint, lettore } = await apriSse(s.url, 'tok-sse-503');
    await new Promise((r) => setTimeout(r, 100)); // la memoria scade
    giu = true;
    const res = await fetch(endpoint, { method: 'POST', headers: intest(), body: rpc('ping', undefined, 3) });
    assert.equal(res.status, 503);
    assert.equal(res.headers.get('www-authenticate'), null);
    assert.equal(((await res.json()) as { error: { code: number } }).error.code, -32000);

    // la sessione e ancora li: tornato su ProTask, lo stesso endpoint risponde
    giu = false;
    const ok = await fetch(endpoint, { method: 'POST', headers: intest(), body: rpc('ping') });
    assert.equal(ok.status, 200);
    await lettore.cancel();
  } finally { await s.chiudi(); }
});

test('/auth/me in 403: 503 con un messaggio diverso da "non raggiungibile", e non si ricorda', async () => {
  let stato = 403;
  const chiamate = stubApi(() => (stato === 200 ? utenteOk() : risposta({ message: 'Forbidden' }, stato)));
  const s = await avvia();
  try {
    for (const rifiuto of [403, 404, 302]) {
      stato = rifiuto;
      const res = await fetch(s.url + '/mcp', { method: 'POST', headers: intest('tok-403'), body: rpc('initialize', {}, 9) });
      assert.equal(res.status, 503, String(rifiuto));
      assert.equal(res.headers.get('www-authenticate'), null);
      assert.deepEqual(await res.json(), {
        jsonrpc: '2.0',
        error: { code: -32000, message: `ProTask ha rifiutato la verifica del token (HTTP ${rifiuto})` },
        id: 9,
      });
    }
    assert.equal(contaMe(chiamate), 3);
    stato = 200;
    assert.equal((await fetch(s.url + '/mcp', { method: 'POST', headers: intest('tok-403'), body: rpc('initialize') })).status, 200);
  } finally { await s.chiudi(); }
});

test('extractToken: uno o piu spazi dopo Bearer, il resto rifiutato come prima', () => {
  const da = (authorization?: string) => extractToken({ headers: { authorization } } as any);
  assert.equal(da('Bearer tok'), 'tok');
  assert.equal(da('bearer tok'), 'tok');
  assert.equal(da('BEARER   tok'), 'tok');
  assert.equal(da('Bearer  tok'), 'tok');
  for (const no of [undefined, '', 'Bearer', 'Bearer ', 'Basic tok', 'Bearer tok extra', 'Bearertok', ' Bearer tok']) {
    assert.equal(da(no), null, String(no));
  }
});

test('/auth/me: il corpo della risposta viene sempre scartato', async () => {
  for (const stato of [200, 401, 403, 503]) {
    let annullato = false;
    globalThis.fetch = (async () => new Response(
      new ReadableStream({ pull(c) { c.enqueue(new Uint8Array([1])); }, cancel() { annullato = true; } }),
      { status: stato },
    )) as typeof fetch;
    await createTokenVerifier({ apiUrl: PROTASK_API_URL }).verify('tok');
    assert.equal(annullato, true, `stato ${stato}`);
  }
});
