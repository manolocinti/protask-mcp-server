import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { app } from './app.js';

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
