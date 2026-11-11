import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import { ProTaskClient } from './api-client.js';
import { PROTASK_API_URL } from './config.js';
import { createStdioServer } from './stdio-server.js';
import { TOOLS } from './tools.js';

// Ogni token è valido: qui si prova il protocollo, la verifica sta in oauth.test.ts
const verifierOk: TokenVerifier = { verify: async () => 'ok', forget: () => {} };

let server: Server;
let base: string;

before(async () => {
  server = createApp({ verifier: verifierOk }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const fetchOriginale = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginale; });

// Le richieste all'app passano; quelle a ProTask vengono registrate e rispondono { data: {} }
function stubApi(): { path: string; method: string; body: any }[] {
  const calls: { path: string; method: string; body: any }[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1:')) return fetchOriginale(url, init);
    calls.push({ path: u.slice(PROTASK_API_URL.length), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(init.body) : undefined });
    return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer tok' };
const msg = (method: string, params?: unknown, id: number | undefined = 1) =>
  JSON.stringify(id === undefined ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', method, params, id });
const post = (path: string, body: string) => fetch(base + path, { method: 'POST', headers, body });

// Apre una sessione SSE e restituisce l'URL di /mcp/message
async function apriSse() {
  const res = await fetch(base + '/mcp/sse', { headers: { Authorization: 'Bearer tok' } });
  const lettore = res.body!.getReader();
  const decoder = new TextDecoder();
  let testo = '';
  while (!/data: (\S+)\n/.test(testo)) testo += decoder.decode((await lettore.read()).value);
  return { endpoint: /data: (\S+)\n/.exec(testo)![1].replace(/^http:\/\/[^/]+/, ''), lettore };
}

async function suTuttiGliEndpoint(fn: (path: string) => Promise<void>) {
  const { endpoint, lettore } = await apriSse();
  try {
    for (const path of ['/mcp', '/mcp/sse', endpoint]) await fn(path);
  } finally { await lettore.cancel(); }
}

test('ping: risultato vuoto su /mcp, POST /mcp/sse e /mcp/message', async () => {
  await suTuttiGliEndpoint(async (path) => {
    const res = await post(path, msg('ping', undefined, 4));
    assert.equal(res.status, 200, path);
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', result: {}, id: 4 }, path);
  });
});

test('notifiche: 202 senza corpo e senza errore JSON-RPC su tutti gli endpoint', async () => {
  await suTuttiGliEndpoint(async (path) => {
    for (const method of ['notifications/initialized', 'notifications/cancelled', 'notifications/roots/list_changed']) {
      const res = await post(path, msg(method, {}, undefined));
      assert.equal(res.status, 202, `${path} ${method}`);
      assert.equal(await res.text(), '', `${path} ${method}`);
    }
  });
});

test('metodo sconosciuto: -32601', async () => {
  await suTuttiGliEndpoint(async (path) => {
    const res = await post(path, msg('resources/list', {}, 2));
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', error: { code: -32601, message: 'Method not found: resources/list' }, id: 2 }, path);
  });
});

test('tools/call con tool sconosciuto o parametri mancanti: risultato con isError, non -32000', async () => {
  const calls = stubApi();
  await suTuttiGliEndpoint(async (path) => {
    for (const params of [
      { name: 'protask_register_user', arguments: {} },
      { name: 'protask_get_task', arguments: {} },
      { name: 'protask_get_task' },
      { name: 'protask_create_task', arguments: { title: 'T', list_id: 1, project_id: 2, priority: 'altissima' } },
    ]) {
      const res = await post(path, msg('tools/call', params, 3));
      assert.equal(res.status, 200);
      const body = await res.json() as { result?: { isError?: boolean; content: { text: string }[] }; error?: unknown };
      assert.equal(body.error, undefined, `${path} ${params.name}`);
      assert.equal(body.result?.isError, true, `${path} ${params.name}`);
    }
  });
  assert.equal(calls.length, 0, 'nessuna chiamata a ProTask');
});

test('tools/call senza nome del tool: -32602', async () => {
  await suTuttiGliEndpoint(async (path) => {
    const res = await post(path, msg('tools/call', {}, 5));
    const body = await res.json() as { error: { code: number } };
    assert.equal(body.error.code, -32602, path);
  });
});

test('richiesta senza method: -32600', async () => {
  const res = await post('/mcp', JSON.stringify({ jsonrpc: '2.0', id: 6 }));
  assert.equal(((await res.json()) as { error: { code: number } }).error.code, -32600);
});

test('tools/call valido su /mcp: la priorità a parola arriva come intero', async () => {
  const calls = stubApi();
  const res = await post('/mcp', msg('tools/call', { name: 'protask_create_task', arguments: { title: 'T', list_id: 1, project_id: 2, priority: 'urgente' } }));
  const body = await res.json() as { result: { isError?: boolean } };
  assert.equal(body.result.isError, undefined);
  assert.deepEqual(calls, [{ path: '/tasks', method: 'POST', body: { title: 'T', list_id: 1, project_id: 2, priority: 4 } }]);
});

test('/mcp/tools/:toolName con tool sconosciuto: 404', async () => {
  const res = await post('/mcp/tools/protask_register_user', '{}');
  assert.equal(res.status, 404);
  assert.equal(((await res.json()) as { success: boolean }).success, false);
});

test('/mcp/tools/:toolName con priorità non valida: success false senza chiamare ProTask', async () => {
  const calls = stubApi();
  const res = await post('/mcp/tools/protask_update_task', JSON.stringify({ task_id: 1, priority: 'boh' }));
  assert.equal(res.status, 200);
  const body = await res.json() as { success: boolean; data: { error: string } };
  assert.equal(body.success, false);
  assert.match(body.data.error, /priorità non valida/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Stesso elenco di tool su HTTP e stdio
// ---------------------------------------------------------------------------

async function clientStdio() {
  const [lato_client, lato_server] = InMemoryTransport.createLinkedPair();
  const server = createStdioServer(new ProTaskClient('tok', PROTASK_API_URL));
  await server.connect(lato_server);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(lato_client);
  return { client, chiudi: async () => { await client.close(); await server.close(); } };
}

test('elenco dei tool: HTTP (/mcp/tools, /mcp tools/list) e stdio danno lo stesso array TOOLS', async () => {
  const atteso = JSON.parse(JSON.stringify(TOOLS));

  const diretto = await (await fetch(base + '/mcp/tools')).json() as { tools: unknown };
  assert.deepEqual(diretto.tools, atteso);

  const rpc = await (await post('/mcp', msg('tools/list'))).json() as { result: { tools: unknown } };
  assert.deepEqual(rpc.result.tools, atteso);

  const s = await clientStdio();
  try {
    const { tools } = await s.client.listTools();
    assert.deepEqual(JSON.parse(JSON.stringify(tools)), atteso);
  } finally { await s.chiudi(); }
});

test('stdio: tool sconosciuto -> isError, priorità convertita come su HTTP', async () => {
  const calls = stubApi();
  const s = await clientStdio();
  try {
    const sconosciuto = await s.client.callTool({ name: 'protask_register_user', arguments: {} });
    assert.equal(sconosciuto.isError, true);
    const ok = await s.client.callTool({ name: 'protask_update_task', arguments: { task_id: 3, priority: 'bassa', foo: 1 } });
    assert.equal(ok.isError, undefined);
    assert.deepEqual(calls, [{ path: '/tasks/3', method: 'PUT', body: { priority: 1 } }]);
  } finally { await s.chiudi(); }
});
