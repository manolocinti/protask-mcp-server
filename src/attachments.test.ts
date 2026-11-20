import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { AddressInfo } from 'node:net';
import {
  downloadFile,
  isPublicAddress,
  loadLocalFile,
  payloadFromUpload,
  safeFileName,
  UploadLinkStore,
  MAX_ATTACHMENT_BYTES,
  UPLOAD_LINK_MAX_FILES,
} from './attachments.js';
import { ProTaskClient } from './api-client.js';
import { executeTool, toolsFor } from './tools.js';
import { toolResult } from './handoff.js';
import { createApp } from './app.js';
import type { TokenVerifier } from './auth.js';
import { PUBLIC_URL } from './config.js';

const API = 'https://protask.example/api/v1';
const fetchOriginale = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginale; });

type Upload = { path: string; method: string; file?: File; fields: string[] };

// Le chiamate a ProTask: GET /tasks/{id} risponde con un titolo, il POST multipart viene registrato.
// Quelle verso 127.0.0.1 (l'app di prova) passano
function stubApi(risposta: (u: Upload) => Response = () => Response.json({ data: { id: 1 } }, { status: 201 })) {
  const calls: Upload[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.startsWith('http://127.0.0.1:')) return fetchOriginale(url, init);
    const p = new URL(u).pathname.replace('/api/v1', '');
    const call: Upload = { path: p, method: init?.method ?? 'GET', fields: [] };
    if (init?.body instanceof FormData) {
      call.fields = [...init.body.keys()];
      call.file = init.body.get('file') as File;
      call.fields.push(`content-type:${init.headers['Content-Type'] ?? 'auto'}`);
    }
    calls.push(call);
    if (call.method === 'GET' && /^\/tasks\/\d+$/.test(p)) return Response.json({ data: { id: 7, title: 'Bug <login>' } });
    return risposta(call);
  }) as typeof fetch;
  return calls;
}

const client = () => new ProTaskClient('tok', API);
const run = async (name: string, args: unknown, ctx?: Parameters<typeof executeTool>[3]) =>
  toolResult(await executeTool(client(), name, args, ctx));
const testo = (r: { content: { text: string }[] }) => r.content[0].text;

// ---------------------------------------------------------------------------
// Indirizzi e nomi
// ---------------------------------------------------------------------------

test('isPublicAddress: rifiuta loopback, reti private, metadata cloud, IPv6 locali e IPv4 mappati', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '::1', '::', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'non-un-ip']) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isPublicAddress(ip), true, ip);
  }
});

test('safeFileName e payloadFromUpload: niente cartelle, nome di riserva, tipo validato', () => {
  assert.equal(safeFileName('../../etc/passwd'), 'passwd');
  assert.equal(safeFileName('C:\\Users\\a\\foto.png'), 'foto.png');
  assert.equal(safeFileName('..'), 'allegato');
  assert.equal(safeFileName('a\u0000b.txt'), 'ab.txt');
  const p = payloadFromUpload(Buffer.from('x'), encodeURIComponent('schermata è.png'), 'text/html; charset=utf-8');
  assert.equal(p.name, 'schermata è.png');
  assert.equal(p.type, 'image/png'); // tipo non valido -> dedotto dall'estensione
  assert.equal(payloadFromUpload(Buffer.from('x'), '%E0%A4%A', '').name, '%E0%A4%A');
});

// ---------------------------------------------------------------------------
// Path locale
// ---------------------------------------------------------------------------

let dir: string;
before(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'protask-att-')); });
after(async () => { await fs.rm(dir, { recursive: true, force: true }); });

test('loadLocalFile: legge nome, tipo e contenuto; rifiuta relativi, nascosti, cartelle e file troppo grandi', async () => {
  const f = path.join(dir, 'screen.png');
  await fs.writeFile(f, 'PNGDATA');
  const ok = await loadLocalFile(f);
  assert.equal(ok.name, 'screen.png');
  assert.equal(ok.type, 'image/png');
  assert.equal(Buffer.from(ok.data).toString(), 'PNGDATA');

  await assert.rejects(loadLocalFile('screen.png'), /assoluto/);
  await assert.rejects(loadLocalFile(path.join(dir, '.env')), /nascost/);
  await assert.rejects(loadLocalFile(path.join(os.homedir(), '.ssh', 'id_rsa')), /nascost/);
  await assert.rejects(loadLocalFile(dir), /non è un file/);
  await assert.rejects(loadLocalFile(path.join(dir, 'manca.png')), /non trovato/);

  // un link simbolico con nome innocuo che punta a un file nascosto
  await fs.mkdir(path.join(dir, '.segreti'));
  await fs.writeFile(path.join(dir, '.segreti', 'chiave'), 'x');
  await fs.symlink(path.join(dir, '.segreti', 'chiave'), path.join(dir, 'innocuo.txt'));
  await assert.rejects(loadLocalFile(path.join(dir, 'innocuo.txt')), /nascost/);

  const grande = path.join(dir, 'grande.bin');
  await fs.writeFile(grande, '');
  await fs.truncate(grande, MAX_ATTACHMENT_BYTES + 1);
  await assert.rejects(loadLocalFile(grande), /20 MB/);
});

// ---------------------------------------------------------------------------
// Download da URL
// ---------------------------------------------------------------------------

let web: http.Server;
let webBase: string;
before(async () => {
  web = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: '/files/report' }); res.end(); return; }
    if (req.url === '/loop') { res.writeHead(302, { Location: '/loop' }); res.end(); return; }
    if (req.url === '/files/report') {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Report Q3.pdf"' });
      res.end('%PDF');
      return;
    }
    if (req.url === '/senza-nome') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end('png'); return; }
    if (req.url === '/enorme') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); // senza Content-Length
      const blocco = Buffer.alloc(1024 * 1024);
      let n = 0;
      const scrivi = () => { while (n < 25 && res.write(blocco)) n++; if (n < 25) res.once('drain', scrivi); else res.end(); };
      scrivi();
      res.on('error', () => {});
      return;
    }
    res.writeHead(404); res.end();
  }).listen(0, '127.0.0.1');
  await new Promise<void>((r) => web.once('listening', r));
  webBase = `http://127.0.0.1:${(web.address() as AddressInfo).port}`;
});
after(async () => { web.closeAllConnections(); await new Promise<void>((r) => web.close(() => r())); });

const tutti = { allowed: () => true };

test('downloadFile: segue i redirect, nome da Content-Disposition, estensione dal tipo', async () => {
  const f = await downloadFile(`${webBase}/redirect`, tutti);
  assert.equal(f.name, 'Report Q3.pdf');
  assert.equal(f.type, 'application/pdf');
  assert.equal(Buffer.from(f.data).toString(), '%PDF');

  const g = await downloadFile(`${webBase}/senza-nome`, tutti);
  assert.equal(g.name, 'senza-nome.png');
});

test('downloadFile: rifiuta troppi redirect, HTTP 404, protocolli non http, file oltre 20 MB', async () => {
  await assert.rejects(downloadFile(`${webBase}/loop`, tutti), /troppi redirect/);
  await assert.rejects(downloadFile(`${webBase}/nulla`, tutti), /HTTP 404/);
  await assert.rejects(downloadFile('file:///etc/passwd'), /solo indirizzi http/);
  await assert.rejects(downloadFile('ftp://example.com/a'), /solo indirizzi http/);
  await assert.rejects(downloadFile('non è un url'), /url non valido/);
  await assert.rejects(downloadFile(`${webBase}/enorme`, tutti), /20 MB/);
});

test('downloadFile: senza deroga non scarica da loopback, né per IP né per nome', async () => {
  await assert.rejects(downloadFile(`${webBase}/files/report`), /non pubblico/);
  const port = new URL(webBase).port;
  await assert.rejects(downloadFile(`http://localhost:${port}/files/report`), /non pubblico/);
  await assert.rejects(downloadFile(`http://[::1]:${port}/x`), /non pubblico/);
});

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

test('toolsFor: il remoto non espone file_path, il locale non ha il link di caricamento', () => {
  const remoto = toolsFor('http').find((t) => t.name === 'protask_upload_attachment')!;
  assert.ok(!('file_path' in (remoto.inputSchema.properties ?? {})));
  assert.ok(toolsFor('http').some((t) => t.name === 'protask_attachment_upload_link'));
  const locale = toolsFor('stdio').find((t) => t.name === 'protask_upload_attachment')!;
  assert.ok('file_path' in (locale.inputSchema.properties ?? {}));
  assert.ok(!toolsFor('stdio').some((t) => t.name === 'protask_attachment_upload_link'));
});

test('upload_attachment: file_path sul remoto -> errore che indica il link, nessuna chiamata', async () => {
  const calls = stubApi();
  const r = await run('protask_upload_attachment', { task_id: 7, file_path: '/tmp/x.png' });
  assert.equal(r.isError, true);
  assert.match(testo(r), /protask_attachment_upload_link/);
  const vuoto = await run('protask_upload_attachment', { task_id: 7 });
  assert.match(testo(vuoto), /manca url/);
  assert.deepEqual(calls, []);
});

test('upload_attachment: file_path in locale -> POST multipart con il campo file, nome sostituibile', async () => {
  const f = path.join(dir, 'cattura.png');
  await fs.writeFile(f, 'IMG');
  const calls = stubApi();
  const r = await run('protask_upload_attachment', { task_id: 7, file_path: f, file_name: 'login-rotto.png' }, { transport: 'stdio' });
  assert.equal(r.isError, undefined, testo(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/tasks/7/attachments');
  assert.equal(calls[0].method, 'POST');
  assert.deepEqual(calls[0].fields, ['file', 'content-type:auto']); // niente application/json: il boundary lo mette fetch
  assert.equal(calls[0].file!.name, 'login-rotto.png');
  assert.equal(calls[0].file!.type, 'image/png');
  assert.equal(await calls[0].file!.text(), 'IMG');

  const due = await run('protask_upload_attachment', { task_id: 7, file_path: f, url: 'https://x.it/a' }, { transport: 'stdio' });
  assert.match(testo(due), /uno solo/);
});

test('upload_attachment: errore di validazione di ProTask torna come errore del tool', async () => {
  const f = path.join(dir, 'v.png');
  await fs.writeFile(f, 'x');
  stubApi(() => Response.json({ message: 'The file failed to upload.' }, { status: 422 }));
  const r = await run('protask_upload_attachment', { task_id: 7, file_path: f }, { transport: 'stdio' });
  assert.equal(r.isError, true);
  assert.match(testo(r), /422/);
});

test('attachment_upload_link: in locale o senza archivio -> errore; sul remoto -> link pubblico con titolo e scadenza', async () => {
  stubApi();
  assert.equal((await run('protask_attachment_upload_link', { task_id: 7 }, { transport: 'stdio' })).isError, true);
  assert.equal((await run('protask_attachment_upload_link', { task_id: 7 })).isError, true);

  const links = new UploadLinkStore();
  const r = await run('protask_attachment_upload_link', { task_id: 7 }, { transport: 'http', uploadLinks: links });
  assert.equal(r.isError, undefined, testo(r));
  const out = JSON.parse(testo(r));
  assert.ok(out.upload_url.startsWith(`${PUBLIC_URL}/upload/`), out.upload_url);
  assert.equal(out.task_title, 'Bug <login>');
  assert.equal(out.max_files, UPLOAD_LINK_MAX_FILES);
  const code = out.upload_url.split('/').pop();
  assert.ok(code.length >= 32);
  assert.equal(links.get(code)!.taskId, 7);
});

test('UploadLinkStore: il link scade dopo 15 minuti', () => {
  let t = 1_000;
  const links = new UploadLinkStore(() => t);
  const { code } = links.create(client(), 1, 'x');
  t += 14 * 60_000;
  assert.ok(links.get(code));
  t += 2 * 60_000;
  assert.equal(links.get(code), undefined);
});

// ---------------------------------------------------------------------------
// Pagina e POST /upload/:code
// ---------------------------------------------------------------------------

const verifierOk: TokenVerifier = { verify: async () => 'ok', forget: () => {} };

async function avviaApp() {
  const server = createApp({ verifier: verifierOk }).listen(0, '127.0.0.1');
  await new Promise<void>((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { base, chiudi: async () => { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); } };
}

async function creaLink(base: string): Promise<string> {
  const res = await fetch(base + '/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer tok' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'protask_attachment_upload_link', arguments: { task_id: 7 } } }),
  });
  const body = await res.json() as { result: { content: { text: string }[] } };
  return new URL(JSON.parse(body.result.content[0].text).upload_url).pathname;
}

test('pagina di caricamento: titolo escapato, CSP, no-store; codice sconosciuto -> 404', async () => {
  const app = await avviaApp();
  try {
    stubApi();
    const p = await creaLink(app.base);
    const res = await fetch(app.base + p);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Bug &lt;login&gt;/);
    assert.ok(!html.includes('Bug <login>'));
    assert.match(res.headers.get('content-security-policy')!, /default-src 'none'/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');

    assert.equal((await fetch(app.base + '/upload/inventato')).status, 404);
    assert.equal((await fetch(app.base + '/upload/inventato', { method: 'POST', body: 'x' })).status, 404);
  } finally { await app.chiudi(); }
});

test('POST /upload/:code: carica il file come byte (anche un .json), con nome e tipo dalla pagina', async () => {
  const app = await avviaApp();
  try {
    const calls = stubApi();
    const p = await creaLink(app.base);
    const res = await fetch(app.base + p, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-File-Name': encodeURIComponent('dati è.json'), 'X-File-Type': 'application/json' },
      body: '{"a":1}',
    });
    assert.equal(res.status, 201, await res.clone().text());
    assert.deepEqual(await res.json(), { ok: true, name: 'dati è.json', size: 7 });
    const up = calls.find((c) => c.method === 'POST')!;
    assert.equal(up.path, '/tasks/7/attachments');
    assert.equal(up.file!.name, 'dati è.json');
    assert.equal(await up.file!.text(), '{"a":1}');

    assert.equal((await fetch(app.base + p, { method: 'POST', body: '' })).status, 400);
  } finally { await app.chiudi(); }
});

test('POST /upload/:code: oltre 20 MB -> 413; token scaduto su ProTask -> 401 e link revocato; limite di file', async () => {
  const app = await avviaApp();
  try {
    stubApi();
    const p = await creaLink(app.base);
    const grande = await fetch(app.base + p, { method: 'POST', body: Buffer.alloc(MAX_ATTACHMENT_BYTES + 1) });
    assert.equal(grande.status, 413);

    for (let i = 0; i < UPLOAD_LINK_MAX_FILES; i++) {
      assert.equal((await fetch(app.base + p, { method: 'POST', body: 'x' })).status, 201);
    }
    assert.equal((await fetch(app.base + p, { method: 'POST', body: 'x' })).status, 404);

    const q = await creaLink(app.base);
    stubApi(() => new Response('', { status: 401 }));
    const scaduto = await fetch(app.base + q, { method: 'POST', body: 'x' });
    assert.equal(scaduto.status, 401);
    assert.equal((await fetch(app.base + q)).status, 404);
  } finally { await app.chiudi(); }
});
