import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { ProTaskClient, ProTaskUnauthorizedError } from './api-client.js';
import { createTokenVerifier, extractToken, requireToken, sendUnauthorized, sendVerifyFailure } from './auth.js';
import { PROTASK_API_URL, PROTASK_ISSUER, RESOURCE_URL } from './config.js';
import { toolResult, runMoveTask, isTrue, DESCRIPTIONS, SERVER_INSTRUCTIONS, NOTIFY_USER_IDS_SCHEMA } from './handoff.js';
// Define all tools
const tools = [
    // Auth
    { name: 'protask_get_me', description: 'Get current authenticated user information', inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'protask_list_users', description: DESCRIPTIONS.protask_list_users, inputSchema: { type: 'object', properties: {}, required: [] } },
    // Workspaces
    { name: 'protask_list_workspaces', description: DESCRIPTIONS.protask_list_workspaces, inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'protask_get_workspace', description: DESCRIPTIONS.protask_get_workspace, inputSchema: { type: 'object', properties: { workspace_id: { type: 'number', description: 'Workspace ID' } }, required: ['workspace_id'] } },
    { name: 'protask_create_workspace', description: 'Create a new workspace', inputSchema: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, website: { type: 'string' } }, required: ['name'] } },
    { name: 'protask_get_workspace_members', description: DESCRIPTIONS.protask_get_workspace_members, inputSchema: { type: 'object', properties: { workspace_id: { type: 'number' } }, required: ['workspace_id'] } },
    // Projects
    { name: 'protask_list_projects', description: DESCRIPTIONS.protask_list_projects, inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'protask_get_project', description: DESCRIPTIONS.protask_get_project, inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, required: ['project_id'] } },
    { name: 'protask_create_project', description: 'Create a new project', inputSchema: { type: 'object', properties: { title: { type: 'string' }, workspace_id: { type: 'number' }, description: { type: 'string' } }, required: ['title', 'workspace_id'] } },
    { name: 'protask_update_project', description: 'Update a project', inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' } }, required: ['project_id'] } },
    { name: 'protask_delete_project', description: 'Delete a project', inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, required: ['project_id'] } },
    // Board Lists
    { name: 'protask_list_board_lists', description: DESCRIPTIONS.protask_list_board_lists, inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, required: ['project_id'] } },
    { name: 'protask_create_board_list', description: 'Create a board list', inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' } }, required: ['project_id', 'name'] } },
    { name: 'protask_update_board_list', description: 'Update a board list', inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, list_id: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' } }, required: ['project_id', 'list_id'] } },
    { name: 'protask_delete_board_list', description: 'Delete a board list', inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, list_id: { type: 'number' } }, required: ['project_id', 'list_id'] } },
    // Labels
    { name: 'protask_list_labels', description: 'List labels in a project', inputSchema: { type: 'object', properties: { project_id: { type: 'number' } }, required: ['project_id'] } },
    { name: 'protask_create_label', description: 'Create a label', inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, name: { type: 'string' }, color: { type: 'string' } }, required: ['project_id', 'name', 'color'] } },
    // Tasks
    { name: 'protask_my_tasks', description: DESCRIPTIONS.protask_my_tasks, inputSchema: { type: 'object', properties: { include_done: { type: 'boolean', description: 'Also return tasks marked done (default: left out)' } }, required: [] } },
    { name: 'protask_find_colleague', description: DESCRIPTIONS.protask_find_colleague, inputSchema: { type: 'object', properties: { project_id: { type: 'number', description: 'Project where the task is or will be' }, name: { type: 'string', description: 'Name (or part of it) of the person' } }, required: ['project_id', 'name'] } },
    { name: 'protask_list_tasks', description: DESCRIPTIONS.protask_list_tasks, inputSchema: { type: 'object', properties: { project_id: { type: 'number' }, list_id: { type: 'number' } }, required: [] } },
    { name: 'protask_get_task', description: DESCRIPTIONS.protask_get_task, inputSchema: { type: 'object', properties: { task_id: { type: 'number' } }, required: ['task_id'] } },
    { name: 'protask_create_task', description: DESCRIPTIONS.protask_create_task, inputSchema: { type: 'object', properties: { title: { type: 'string' }, list_id: { type: 'number' }, project_id: { type: 'number' }, description: { type: 'string' }, due_date: { type: 'string' } }, required: ['title', 'list_id', 'project_id'] } },
    { name: 'protask_update_task', description: DESCRIPTIONS.protask_update_task, inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, title: { type: 'string' }, description: { type: 'string' }, due_date: { type: 'string' }, is_done: { type: 'boolean' } }, required: ['task_id'] } },
    { name: 'protask_delete_task', description: 'Delete a task', inputSchema: { type: 'object', properties: { task_id: { type: 'number' } }, required: ['task_id'] } },
    { name: 'protask_move_task', description: DESCRIPTIONS.protask_move_task, inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, list_id: { type: 'number', description: 'Target column id (alternative to list_name)' }, list_name: { type: 'string', description: 'Target column title (alternative to list_id)' }, message: { type: 'string', description: 'Short summary saved as a comment on the task' }, notify_user_ids: NOTIFY_USER_IDS_SCHEMA, order: { type: 'number' } }, required: ['task_id'] } },
    { name: 'protask_add_task_assignee', description: DESCRIPTIONS.protask_add_task_assignee, inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, user_id: { type: 'number' } }, required: ['task_id', 'user_id'] } },
    { name: 'protask_remove_task_assignee', description: 'Remove user from task', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, user_id: { type: 'number' } }, required: ['task_id', 'user_id'] } },
    { name: 'protask_add_task_label', description: 'Add label to task', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, label_id: { type: 'number' } }, required: ['task_id', 'label_id'] } },
    { name: 'protask_remove_task_label', description: 'Remove label from task', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, label_id: { type: 'number' } }, required: ['task_id', 'label_id'] } },
    // Checklists
    { name: 'protask_list_checklists', description: DESCRIPTIONS.protask_list_checklists, inputSchema: { type: 'object', properties: { task_id: { type: 'number' } }, required: ['task_id'] } },
    { name: 'protask_create_checklist', description: 'Create a checklist', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, name: { type: 'string' } }, required: ['task_id', 'name'] } },
    { name: 'protask_add_checklist_item', description: 'Add item to checklist', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, checklist_id: { type: 'number' }, name: { type: 'string' } }, required: ['task_id', 'checklist_id', 'name'] } },
    { name: 'protask_update_checklist_item', description: 'Update checklist item', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, checklist_id: { type: 'number' }, item_id: { type: 'number' }, name: { type: 'string' }, checked: { type: 'boolean' } }, required: ['task_id', 'checklist_id', 'item_id'] } },
    // Comments
    { name: 'protask_list_comments', description: DESCRIPTIONS.protask_list_comments, inputSchema: { type: 'object', properties: { task_id: { type: 'number' } }, required: ['task_id'] } },
    { name: 'protask_create_comment', description: DESCRIPTIONS.protask_create_comment, inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, comment: { type: 'string' } }, required: ['task_id', 'comment'] } },
    // Timers
    { name: 'protask_get_active_timer', description: DESCRIPTIONS.protask_get_active_timer, inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'protask_get_my_timers', description: DESCRIPTIONS.protask_get_my_timers, inputSchema: { type: 'object', properties: {}, required: [] } },
    { name: 'protask_start_timer', description: 'Start timer on task', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, description: { type: 'string' } }, required: ['task_id'] } },
    { name: 'protask_stop_timer', description: 'Stop timer on task', inputSchema: { type: 'object', properties: { task_id: { type: 'number' } }, required: ['task_id'] } },
    { name: 'protask_add_manual_time', description: 'Add manual time entry', inputSchema: { type: 'object', properties: { task_id: { type: 'number' }, start: { type: 'string' }, end: { type: 'string' }, description: { type: 'string' } }, required: ['task_id', 'start', 'end'] } },
];
// Handle tool execution
async function executeTool(client, name, args) {
    switch (name) {
        case 'protask_get_me': return await client.me();
        case 'protask_list_users': return await client.listUsers();
        case 'protask_list_workspaces': return await client.listWorkspaces();
        case 'protask_get_workspace': return await client.getWorkspace(args?.workspace_id);
        case 'protask_create_workspace': return await client.createWorkspace(args);
        case 'protask_get_workspace_members': return await client.getWorkspaceMembers(args?.workspace_id);
        case 'protask_list_projects': return await client.listProjects();
        case 'protask_get_project': return await client.getProject(args?.project_id);
        case 'protask_create_project': return await client.createProject(args);
        case 'protask_update_project': return await client.updateProject(args?.project_id, args);
        case 'protask_delete_project': return await client.deleteProject(args?.project_id);
        case 'protask_list_board_lists': return await client.listBoardLists(args?.project_id);
        case 'protask_create_board_list': return await client.createBoardList(args?.project_id, args);
        case 'protask_update_board_list': return await client.updateBoardList(args?.project_id, args?.list_id, args);
        case 'protask_delete_board_list': return await client.deleteBoardList(args?.project_id, args?.list_id);
        case 'protask_list_labels': return await client.listLabels(args?.project_id);
        case 'protask_create_label': return await client.createLabel(args?.project_id, args);
        case 'protask_list_tasks': return await client.listTasks(args);
        case 'protask_get_task': return await client.getTask(args?.task_id);
        case 'protask_create_task': return await client.createTask(args);
        case 'protask_update_task': return await client.updateTask(args?.task_id, args);
        case 'protask_delete_task': return await client.deleteTask(args?.task_id);
        case 'protask_move_task': return await runMoveTask(client, args);
        case 'protask_my_tasks': return await client.getMyTasks(isTrue(args?.include_done));
        case 'protask_find_colleague': return await client.findPeople(args?.project_id, args?.name);
        case 'protask_add_task_assignee': return await client.addTaskAssignee(args?.task_id, args?.user_id);
        case 'protask_remove_task_assignee': return await client.removeTaskAssignee(args?.task_id, args?.user_id);
        case 'protask_add_task_label': return await client.addTaskLabel(args?.task_id, args?.label_id);
        case 'protask_remove_task_label': return await client.removeTaskLabel(args?.task_id, args?.label_id);
        case 'protask_list_checklists': return await client.listChecklists(args?.task_id);
        case 'protask_create_checklist': return await client.createChecklist(args?.task_id, args);
        case 'protask_add_checklist_item': return await client.addChecklistItem(args?.task_id, args?.checklist_id, args);
        case 'protask_update_checklist_item': return await client.updateChecklistItem(args?.task_id, args?.checklist_id, args?.item_id, args);
        case 'protask_list_comments': return await client.listComments(args?.task_id);
        case 'protask_create_comment': return await client.createComment(args?.task_id, args);
        case 'protask_get_active_timer': return await client.getActiveTimer();
        case 'protask_get_my_timers': return await client.getMyTimers();
        case 'protask_start_timer': return await client.startTimer(args?.task_id, args?.description);
        case 'protask_stop_timer': return await client.stopTimer(args?.task_id);
        case 'protask_add_manual_time': return await client.addManualTime(args?.task_id, args);
        default: throw new Error(`Unknown tool: ${name}`);
    }
}
export function createApp(opts = {}) {
    const verifier = opts.verifier ?? createTokenVerifier({ apiUrl: PROTASK_API_URL });
    const sessions = new Map();
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
    app.use(express.json());
    // L'API ha risposto 401 durante un tool: il token è morto, si toglie dalla memoria e si risponde 401
    // (invece di un errore del tool dentro un 200) così il client rinnova il token o chiede il login
    const tokenMorto = (res, token, jsonRpc, id) => {
        verifier.forget(token);
        sendUnauthorized(res, { invalidToken: true, jsonRpc, id });
    };
    // Documento RFC 9728: dice ai client OAuth chi rilascia i token per questa risorsa
    const protectedResource = (req, res) => {
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
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', server: 'protask-mcp-server', version: '1.0.0' });
    });
    // List tools
    app.get('/mcp/tools', (req, res) => {
        res.json({ tools });
    });
    // Call tool directly
    app.post('/mcp/tools/:toolName', requireToken(verifier), async (req, res) => {
        const token = res.locals.token;
        const { toolName } = req.params;
        const client = new ProTaskClient(token, PROTASK_API_URL);
        try {
            const result = await executeTool(client, toolName, req.body || {});
            res.json({ success: !toolResult(result).isError, data: result });
        }
        catch (error) {
            if (error instanceof ProTaskUnauthorizedError) {
                tokenMorto(res, token, false);
                return;
            }
            res.status(500).json({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        }
    });
    // MCP JSON-RPC endpoint
    app.post('/mcp', requireToken(verifier, { jsonRpc: true }), async (req, res) => {
        const token = res.locals.token;
        const { method, params, id } = req.body;
        const client = new ProTaskClient(token, PROTASK_API_URL);
        try {
            let result;
            switch (method) {
                case 'initialize':
                    result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'protask-mcp-server', version: '1.0.0' }, instructions: SERVER_INSTRUCTIONS };
                    break;
                case 'tools/list':
                    result = { tools };
                    break;
                case 'tools/call':
                    const { name, arguments: args } = params;
                    result = toolResult(await executeTool(client, name, args || {}));
                    break;
                default:
                    res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
                    return;
            }
            res.json({ jsonrpc: '2.0', result, id });
        }
        catch (error) {
            if (error instanceof ProTaskUnauthorizedError) {
                tokenMorto(res, token, true, id);
                return;
            }
            res.json({ jsonrpc: '2.0', error: { code: -32000, message: error instanceof Error ? error.message : 'Unknown error' }, id });
        }
    });
    // SSE endpoint - MCP protocol
    app.get('/mcp/sse', requireToken(verifier), (req, res) => {
        const token = res.locals.token;
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
    app.post('/mcp/message', async (req, res) => {
        const sessionId = req.query.sessionId;
        const session = sessions.get(sessionId);
        if (!session) {
            // Senza sessione e senza token non c'è nulla da controllare: si manda al login. Con un token, la sessione è scaduta
            if (!extractToken(req)) {
                sendUnauthorized(res, { invalidToken: false, jsonRpc: true, id: req.body?.id });
                return;
            }
            res.status(400).json({ error: 'Invalid or expired session' });
            return;
        }
        const { method, params, id } = req.body;
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
            let result;
            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'protask-mcp-server', version: '1.0.0' },
                        instructions: SERVER_INSTRUCTIONS
                    };
                    break;
                case 'notifications/initialized':
                    // Client notification, no response needed
                    res.status(202).send('accepted');
                    return;
                case 'tools/list':
                    result = { tools };
                    break;
                case 'tools/call':
                    const { name, arguments: args } = params;
                    result = toolResult(await executeTool(session.client, name, args || {}));
                    break;
                case 'ping':
                    result = {};
                    break;
                default:
                    res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
                    return;
            }
            const response = { jsonrpc: '2.0', result, id };
            // Send response back via HTTP (mcp-remote expects this)
            res.json(response);
        }
        catch (error) {
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
    app.post('/mcp/sse', requireToken(verifier, { jsonRpc: true }), async (req, res) => {
        const token = res.locals.token;
        const client = new ProTaskClient(token, PROTASK_API_URL);
        const { method, params, id } = req.body;
        console.log(`[HTTP] Direct POST - Method: ${method}, ID: ${id}`);
        try {
            let result;
            switch (method) {
                case 'initialize':
                    result = {
                        protocolVersion: '2024-11-05',
                        capabilities: { tools: {} },
                        serverInfo: { name: 'protask-mcp-server', version: '1.0.0' },
                        instructions: SERVER_INSTRUCTIONS
                    };
                    break;
                case 'notifications/initialized':
                    res.status(202).send('accepted');
                    return;
                case 'tools/list':
                    result = { tools };
                    break;
                case 'tools/call':
                    const { name, arguments: args } = params;
                    result = toolResult(await executeTool(client, name, args || {}));
                    break;
                case 'ping':
                    result = {};
                    break;
                default:
                    res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
                    return;
            }
            res.json({ jsonrpc: '2.0', result, id });
        }
        catch (error) {
            if (error instanceof ProTaskUnauthorizedError) {
                tokenMorto(res, token, true, id);
                return;
            }
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
