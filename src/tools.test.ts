import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, executeTool, isKnownTool, bodyFromSchema } from './tools.js';
import { toolResult } from './handoff.js';
import { parsePriority, parsePriorityFilter, parseDueFilter, parseDate } from './filters.js';
import { ProTaskClient } from './api-client.js';

type Call = { url: URL; method: string; body: any };

const fetchOriginale = globalThis.fetch;
afterEach(() => { globalThis.fetch = fetchOriginale; });

const API = 'https://protask.example/api/v1';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Ogni chiamata all'API risponde con il gestore (default { data: {} }) e viene registrata
function stubApi(gestore: (call: Call) => Response = () => json({ data: {} })): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    const call = { url: new URL(String(url)), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return gestore(call);
  }) as typeof fetch;
  return calls;
}

const client = () => new ProTaskClient('tok', API);
const run = async (name: string, args: unknown) => toolResult(await executeTool(client(), name, args));
const path = (c: Call) => c.url.pathname.replace('/api/v1', '');

// ---------------------------------------------------------------------------
// Elenco dei tool
// ---------------------------------------------------------------------------

const ATTESI = [
  'protask_get_me', 'protask_list_users',
  'protask_list_workspaces', 'protask_get_workspace', 'protask_create_workspace', 'protask_get_workspace_members',
  'protask_list_projects', 'protask_get_project', 'protask_create_project', 'protask_update_project', 'protask_delete_project',
  'protask_list_board_lists', 'protask_create_board_list', 'protask_update_board_list', 'protask_delete_board_list',
  'protask_list_labels', 'protask_create_label',
  'protask_my_tasks', 'protask_find_colleague', 'protask_list_tasks', 'protask_get_task', 'protask_create_task',
  'protask_update_task', 'protask_delete_task', 'protask_move_task', 'protask_add_task_assignee',
  'protask_remove_task_assignee', 'protask_add_task_label', 'protask_remove_task_label',
  'protask_list_custom_fields', 'protask_get_task_custom_fields', 'protask_set_task_custom_fields',
  'protask_list_checklists', 'protask_create_checklist', 'protask_add_checklist_item', 'protask_update_checklist_item',
  'protask_list_comments', 'protask_create_comment',
  'protask_get_active_timer', 'protask_get_my_timers', 'protask_start_timer', 'protask_stop_timer', 'protask_add_manual_time',
];

test('TOOLS: elenco atteso, nomi unici, niente register_user, ogni tool ha il suo gestore', () => {
  const nomi = TOOLS.map((t) => t.name);
  assert.deepEqual([...nomi].sort(), [...ATTESI].sort());
  assert.equal(new Set(nomi).size, nomi.length);
  assert.ok(!nomi.includes('protask_register_user'));
  for (const t of TOOLS) {
    assert.ok(isKnownTool(t.name), t.name);
    assert.ok(t.description && t.description.length > 10, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name);
    for (const r of t.inputSchema.required ?? []) assert.ok(r in (t.inputSchema.properties ?? {}), `${t.name}.${r}`);
  }
  assert.equal(isKnownTool('protask_register_user'), false);
});

test('TOOLS: create_comment non ha notify_user_ids, get_task cita custom_fields, create/update hanno priority', () => {
  const by = (n: string) => TOOLS.find((t) => t.name === n)!;
  assert.ok(!('notify_user_ids' in (by('protask_create_comment').inputSchema.properties ?? {})));
  assert.match(by('protask_get_task').description!, /custom_fields/);
  for (const n of ['protask_create_task', 'protask_update_task']) {
    const props = by(n).inputSchema.properties as Record<string, any>;
    assert.ok(props.priority, n);
    assert.match(props.due_date.description, /YYYY-MM-DD HH:MM/, n);
  }
  for (const n of ['protask_list_tasks', 'protask_my_tasks']) {
    const props = by(n).inputSchema.properties as Record<string, any>;
    for (const k of ['priority', 'due', 'due_from', 'due_to']) assert.ok(props[k], `${n}.${k}`);
    assert.match(props.due.description, /scaduti/);
    assert.match(props.due.description, /senza scadenza/);
  }
  const set = by('protask_set_task_custom_fields').description!;
  for (const parola of ['text', 'number', 'YYYY-MM-DD', 'url', 'select', 'checkbox', 'protask_list_custom_fields']) {
    assert.ok(set.includes(parola), parola);
  }
});

// ---------------------------------------------------------------------------
// Errori del tool (isError) senza chiamare l'API
// ---------------------------------------------------------------------------

test('executeTool: tool sconosciuto -> isError, nessuna chiamata', async () => {
  const calls = stubApi();
  const r = await run('protask_register_user', { email: 'x' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /Tool sconosciuto/);
  assert.equal(calls.length, 0);
});

test('executeTool: parametri obbligatori mancanti -> isError con i nomi', async () => {
  const calls = stubApi();
  const r = await run('protask_create_task', { title: 'T', list_id: null });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /list_id, project_id/);
  const r2 = await run('protask_get_task', undefined);
  assert.equal(r2.isError, true);
  assert.match(r2.content[0].text, /task_id/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Priorità e corpo di create/update
// ---------------------------------------------------------------------------

test('create_task: priorità a parola diventa intero', async () => {
  const casi: [unknown, number][] = [['alta', 3], ['URGENT', 4], [' bassa ', 1], ['media', 2], ['none', 0], ['2', 2], [0, 0], [4, 4]];
  for (const [valore, atteso] of casi) {
    const calls = stubApi();
    const r = await run('protask_create_task', { title: 'T', list_id: 1, project_id: 2, priority: valore });
    assert.equal(r.isError, undefined, String(valore));
    assert.equal(calls[0].method, 'POST');
    assert.equal(path(calls[0]), '/tasks');
    assert.equal(calls[0].body.priority, atteso, String(valore));
  }
});

test('update_task: priorità "high" -> 3, task_id non nel corpo', async () => {
  const calls = stubApi();
  await run('protask_update_task', { task_id: 9, priority: 'high' });
  assert.equal(calls[0].method, 'PUT');
  assert.equal(path(calls[0]), '/tasks/9');
  assert.deepEqual(calls[0].body, { priority: 3 });
});

test('priorità non valida -> isError chiaro e nessuna chiamata', async () => {
  for (const valore of ['altissima', 5, -1, 2.5, true, '']) {
    const calls = stubApi();
    const r = await run('protask_update_task', { task_id: 9, priority: valore });
    assert.equal(r.isError, true, String(valore));
    assert.match(r.content[0].text, /priorità non valida/);
    assert.match(r.content[0].text, /nessuna\/bassa\/media\/alta\/urgente/);
    assert.equal(calls.length, 0, String(valore));
  }
});

test('create_task: solo le chiavi dello schema arrivano all API', async () => {
  const calls = stubApi();
  await run('protask_create_task', {
    title: 'T', list_id: 1, project_id: 2, description: 'd', due_date: '2026-12-31 10:00', priority: 'alta',
    user_id: 5, is_archived: 1, workspace_id: 3, created_by: 99, foo: 'bar',
  });
  assert.deepEqual(calls[0].body, {
    title: 'T', list_id: 1, project_id: 2, description: 'd', due_date: '2026-12-31 10:00', priority: 3,
  });
});

test('update_task: solo le chiavi dello schema, senza task_id', async () => {
  const calls = stubApi();
  await run('protask_update_task', { task_id: 9, title: 'Nuovo', is_done: true, list_id: 4, project_id: 7, order: 1, assignees: [1] });
  assert.deepEqual(calls[0].body, { title: 'Nuovo', is_done: true });
});

test('update_task: priority null non viene mandata', async () => {
  const calls = stubApi();
  await run('protask_update_task', { task_id: 9, title: 'x', priority: null });
  assert.deepEqual(calls[0].body, { title: 'x' });
});

test('create_task: la descrizione resta escapata', async () => {
  const calls = stubApi();
  await run('protask_create_task', { title: 'T', list_id: 1, project_id: 2, description: 'a & b\nc' });
  assert.equal(calls[0].body.description, 'a &amp; b<br>c');
});

test('bodyFromSchema: tool sconosciuto -> corpo vuoto', () => {
  assert.deepEqual(bodyFromSchema('nessuno', { a: 1 }), {});
});

// ---------------------------------------------------------------------------
// Filtri
// ---------------------------------------------------------------------------

test('list_tasks: filtri nella query string', async () => {
  const calls = stubApi();
  await run('protask_list_tasks', {
    project_id: 5, priority: ['alta', 'urgente'], due: 'over, null', due_from: '2026-11-01', due_to: '2026-11-30',
  });
  const u = calls[0].url;
  assert.equal(calls[0].method, 'GET');
  assert.equal(path(calls[0]), '/tasks');
  assert.equal(u.searchParams.get('project_id'), '5');
  assert.equal(u.searchParams.get('priority'), '3,4');
  assert.equal(u.searchParams.get('due'), 'over,null');
  assert.equal(u.searchParams.get('due_from'), '2026-11-01');
  assert.equal(u.searchParams.get('due_to'), '2026-11-30');
  assert.equal(u.searchParams.has('list_id'), false);
});

test('list_tasks: senza filtri nessuna query string', async () => {
  const calls = stubApi();
  await run('protask_list_tasks', {});
  assert.equal(calls[0].url.search, '');
});

test('my_tasks: include_done e filtri; senza argomenti /me/tasks come prima', async () => {
  const calls = stubApi();
  await run('protask_my_tasks', { include_done: 'true', priority: '3,4', due: ['next_week', null] });
  const u = calls[0].url;
  assert.equal(path(calls[0]), '/me/tasks');
  assert.equal(u.searchParams.get('include_done'), '1');
  assert.equal(u.searchParams.get('priority'), '3,4');
  assert.equal(u.searchParams.get('due'), 'next_week,null');

  await run('protask_my_tasks', {});
  assert.equal(calls[1].url.href, `${API}/me/tasks`);
  await run('protask_my_tasks', { priority: 2 });
  assert.equal(calls[2].url.searchParams.get('priority'), '2');
});

test('filtri non validi -> isError e nessuna chiamata', async () => {
  const calls = stubApi();
  const casi: Record<string, unknown>[] = [
    { due: 'domani' },
    { due: ['over', 'yesterday'] },
    { priority: ['alta', 'boh'] },
    { due_from: '01/11/2026' },
    { due_to: '2026-02-30' },
  ];
  for (const args of casi) {
    const r = await run('protask_list_tasks', args);
    assert.equal(r.isError, true, JSON.stringify(args));
  }
  const r = await run('protask_my_tasks', { due: 'presto' });
  assert.match(r.content[0].text, /over, next_day, next_week, next_month, null/);
  assert.equal(calls.length, 0);
});

test('filters: casi limite', () => {
  assert.equal(parsePriority('Urgente'), 4);
  assert.throws(() => parsePriority('3.0'));
  assert.equal(parsePriorityFilter(['3', 3, 'alta']), '3');
  assert.equal(parsePriorityFilter(''), undefined);
  assert.equal(parsePriorityFilter([]), undefined);
  assert.equal(parseDueFilter('OVER,next_month'), 'over,next_month');
  assert.equal(parseDueFilter(undefined), undefined);
  assert.equal(parseDate('due_from', '2024-02-29'), '2024-02-29');
  assert.throws(() => parseDate('due_from', '2025-02-29'));
});

// ---------------------------------------------------------------------------
// Campi personalizzati
// ---------------------------------------------------------------------------

test('custom fields: endpoint, metodo e corpo', async () => {
  const calls = stubApi();
  await run('protask_list_custom_fields', {});
  await run('protask_get_task_custom_fields', { task_id: 7 });
  await run('protask_set_task_custom_fields', { task_id: 7, values: { budget: 1200, canale: null, 3: 'x' }, extra: 1 });
  assert.deepEqual(calls.map((c) => [c.method, path(c)]), [
    ['GET', '/custom-fields'],
    ['GET', '/tasks/7/custom-fields'],
    ['PUT', '/tasks/7/custom-fields'],
  ]);
  assert.deepEqual(calls[2].body, { values: { 3: 'x', budget: 1200, canale: null } });
});

test('custom fields: values come stringa JSON viene letto', async () => {
  const calls = stubApi();
  await run('protask_set_task_custom_fields', { task_id: 7, values: '{"tags": ["a", "b"]}' });
  assert.deepEqual(calls[0].body, { values: { tags: ['a', 'b'] } });
});

test('custom fields: values non oggetto o vuoto -> isError senza chiamate', async () => {
  const calls = stubApi();
  for (const values of [['a'], 'testo', 3, {}]) {
    const r = await run('protask_set_task_custom_fields', { task_id: 7, values });
    assert.equal(r.isError, true, JSON.stringify(values));
  }
  const r = await run('protask_set_task_custom_fields', { task_id: 7 });
  assert.match(r.content[0].text, /values/);
  assert.equal(calls.length, 0);
});

test('custom fields: errore 422 dell API -> isError', async () => {
  stubApi(() => json({ message: 'Il campo budget deve essere un numero', errors: { 'values.budget': ['numero'] } }, 422));
  const r = await run('protask_set_task_custom_fields', { task_id: 7, values: { budget: 'tanti' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /HTTP 422/);
});

// ---------------------------------------------------------------------------
// Comportamenti di prima, passando dal dispatcher unico
// ---------------------------------------------------------------------------

test('move_task e create_comment passano dal dispatcher come prima', async () => {
  const calls = stubApi((c) => {
    if (path(c) === '/tasks/5') return json({ data: { project_id: 9 } });
    if (path(c) === '/projects/9/lists') return json({ data: [{ id: 1, title: 'Fatto' }] });
    return json({ data: {}, comment_id: 1, notified_user_ids: [3] });
  });
  const r = await run('protask_move_task', { task_id: 5, list_name: 'fatto', message: 'ok', notify_user_ids: [3] });
  assert.equal(r.isError, undefined);
  assert.deepEqual(calls[2].body, { list_id: 1, message: 'ok', notify_user_ids: [3] });

  await run('protask_create_comment', { task_id: 5, comment: '<b>x</b>\ny' });
  assert.deepEqual(calls[3].body, { body: '&lt;b&gt;x&lt;/b&gt;<br>y' });
});
