// Unica definizione dei tool MCP e unico dispatcher, usati da tutti i trasporti:
// HTTP (src/app.ts: /mcp, /mcp/sse, /mcp/message, /mcp/tools) e stdio (src/stdio-server.ts).

import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { ProTaskClient, ProTaskUnauthorizedError } from './api-client.js';
import { runMoveTask, isTrue, DESCRIPTIONS, NOTIFY_USER_IDS_SCHEMA } from './handoff.js';
import {
  ToolInputError,
  parsePriority,
  parseTaskFilters,
  parseObject,
  PRIORITY_WORD_LIST,
  DUE_VALUES,
} from './filters.js';

type Args = Record<string, unknown>;

const id = (description: string) => ({ type: 'number', description });
const noArgs = { type: 'object' as const, properties: {}, required: [] };

const PRIORITY_SCHEMA = {
  anyOf: [
    { type: 'integer', minimum: 0, maximum: 4 },
    { type: 'string', enum: PRIORITY_WORD_LIST },
  ],
  description: 'Priority: 0 none, 1 low, 2 medium, 3 high, 4 urgent; the number or the word (nessuna/bassa/media/alta/urgente, none/low/medium/high/urgent)',
};

const DUE_DATE_SCHEMA = { type: 'string', description: 'Due date: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"' };

// Filtri comuni a protask_list_tasks e protask_my_tasks
const FILTER_PROPERTIES = {
  priority: {
    anyOf: [
      { type: 'array', items: { anyOf: [{ type: 'integer', minimum: 0, maximum: 4 }, { type: 'string' }] } },
      { type: 'string' },
      { type: 'integer', minimum: 0, maximum: 4 },
    ],
    description: 'Only these priorities: 0-4 or words (nessuna/bassa/media/alta/urgente, none/low/medium/high/urgent), as an array or comma-separated string, e.g. ["alta","urgente"] or "3,4"',
  },
  due: {
    anyOf: [
      { type: 'array', items: { type: 'string', enum: DUE_VALUES } },
      { type: 'string' },
    ],
    description: 'Due date filter, array or comma-separated: over (scaduti / overdue), next_day (entro domani / by tomorrow), next_week (entro una settimana / within a week), next_month (entro un mese / within a month), null (senza scadenza / no due date)',
  },
  due_from: { type: 'string', description: 'Due date from (YYYY-MM-DD)' },
  due_to: { type: 'string', description: 'Due date to (YYYY-MM-DD)' },
};

/** Tutti i tool, nell'ordine in cui li vede il client. Stesso array per HTTP e stdio. */
export const TOOLS: Tool[] = [
  // Auth
  { name: 'protask_get_me', description: 'Get current authenticated user information', inputSchema: noArgs },
  { name: 'protask_list_users', description: DESCRIPTIONS.protask_list_users, inputSchema: noArgs },

  // Workspaces
  { name: 'protask_list_workspaces', description: DESCRIPTIONS.protask_list_workspaces, inputSchema: noArgs },
  {
    name: 'protask_get_workspace',
    description: DESCRIPTIONS.protask_get_workspace,
    inputSchema: { type: 'object', properties: { workspace_id: id('Workspace ID') }, required: ['workspace_id'] },
  },
  {
    name: 'protask_create_workspace',
    description: 'Create a new workspace',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Workspace name' },
        description: { type: 'string', description: 'Workspace description' },
        website: { type: 'string', description: 'Website URL' },
      },
      required: ['name'],
    },
  },
  {
    name: 'protask_get_workspace_members',
    description: DESCRIPTIONS.protask_get_workspace_members,
    inputSchema: { type: 'object', properties: { workspace_id: id('Workspace ID') }, required: ['workspace_id'] },
  },

  // Projects
  { name: 'protask_list_projects', description: DESCRIPTIONS.protask_list_projects, inputSchema: noArgs },
  {
    name: 'protask_get_project',
    description: DESCRIPTIONS.protask_get_project,
    inputSchema: { type: 'object', properties: { project_id: id('Project ID') }, required: ['project_id'] },
  },
  {
    name: 'protask_create_project',
    description: 'Create a new project in a workspace',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Project title' },
        workspace_id: id('Workspace ID'),
        description: { type: 'string', description: 'Project description' },
      },
      required: ['title', 'workspace_id'],
    },
  },
  {
    name: 'protask_update_project',
    description: 'Update a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: id('Project ID'),
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description' },
      },
      required: ['project_id'],
    },
  },
  {
    name: 'protask_delete_project',
    description: 'Delete a project',
    inputSchema: { type: 'object', properties: { project_id: id('Project ID') }, required: ['project_id'] },
  },

  // Board Lists
  {
    name: 'protask_list_board_lists',
    description: DESCRIPTIONS.protask_list_board_lists,
    inputSchema: { type: 'object', properties: { project_id: id('Project ID') }, required: ['project_id'] },
  },
  {
    name: 'protask_create_board_list',
    description: 'Create a new board list (column) in a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: id('Project ID'),
        name: { type: 'string', description: 'List name' },
        color: { type: 'string', description: 'Color hex code (e.g. #6366f1)' },
      },
      required: ['project_id', 'name'],
    },
  },
  {
    name: 'protask_update_board_list',
    description: 'Update a board list',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: id('Project ID'),
        list_id: id('List ID'),
        name: { type: 'string', description: 'New name' },
        color: { type: 'string', description: 'New color' },
      },
      required: ['project_id', 'list_id'],
    },
  },
  {
    name: 'protask_delete_board_list',
    description: 'Delete a board list and all its tasks',
    inputSchema: {
      type: 'object',
      properties: { project_id: id('Project ID'), list_id: id('List ID') },
      required: ['project_id', 'list_id'],
    },
  },

  // Labels
  {
    name: 'protask_list_labels',
    description: 'List all labels in a project',
    inputSchema: { type: 'object', properties: { project_id: id('Project ID') }, required: ['project_id'] },
  },
  {
    name: 'protask_create_label',
    description: 'Create a new label in a project',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: id('Project ID'),
        name: { type: 'string', description: 'Label name' },
        color: { type: 'string', description: 'Color hex code' },
      },
      required: ['project_id', 'name', 'color'],
    },
  },

  // Tasks
  {
    name: 'protask_my_tasks',
    description: DESCRIPTIONS.protask_my_tasks,
    inputSchema: {
      type: 'object',
      properties: {
        include_done: { type: 'boolean', description: 'Also return tasks marked done (default: left out)' },
        ...FILTER_PROPERTIES,
      },
      required: [],
    },
  },
  {
    name: 'protask_find_colleague',
    description: DESCRIPTIONS.protask_find_colleague,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: id('Project where the task is or will be'),
        name: { type: 'string', description: 'Name (or part of it) of the person' },
      },
      required: ['project_id', 'name'],
    },
  },
  {
    name: 'protask_list_tasks',
    description: DESCRIPTIONS.protask_list_tasks,
    inputSchema: {
      type: 'object',
      properties: {
        project_id: id('Filter by project ID'),
        list_id: id('Filter by list ID'),
        ...FILTER_PROPERTIES,
      },
      required: [],
    },
  },
  {
    name: 'protask_get_task',
    description: DESCRIPTIONS.protask_get_task,
    inputSchema: { type: 'object', properties: { task_id: id('Task ID') }, required: ['task_id'] },
  },
  {
    name: 'protask_create_task',
    description: DESCRIPTIONS.protask_create_task,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Task title' },
        list_id: id('Board list ID'),
        project_id: id('Project ID'),
        description: { type: 'string', description: 'Task description (plain text)' },
        due_date: DUE_DATE_SCHEMA,
        priority: PRIORITY_SCHEMA,
      },
      required: ['title', 'list_id', 'project_id'],
    },
  },
  {
    name: 'protask_update_task',
    description: DESCRIPTIONS.protask_update_task,
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('Task ID'),
        title: { type: 'string', description: 'New title' },
        description: { type: 'string', description: 'New description (plain text, replaces the whole description)' },
        due_date: { ...DUE_DATE_SCHEMA, description: 'New due date: "YYYY-MM-DD" or "YYYY-MM-DD HH:MM"' },
        is_done: { type: 'boolean', description: 'Mark as done/undone' },
        priority: PRIORITY_SCHEMA,
      },
      required: ['task_id'],
    },
  },
  {
    name: 'protask_delete_task',
    description: 'Delete a task',
    inputSchema: { type: 'object', properties: { task_id: id('Task ID') }, required: ['task_id'] },
  },
  {
    name: 'protask_move_task',
    description: DESCRIPTIONS.protask_move_task,
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('Task ID'),
        list_id: id('Target column id (alternative to list_name)'),
        list_name: { type: 'string', description: 'Target column title (alternative to list_id)' },
        project_id: id('Target project id, only to move the task into another project'),
        message: { type: 'string', description: 'Short summary saved as a comment on the task' },
        notify_user_ids: NOTIFY_USER_IDS_SCHEMA,
        order: { type: 'number', description: 'Position in list (optional)' },
      },
      required: ['task_id'],
    },
  },
  {
    name: 'protask_add_task_assignee',
    description: DESCRIPTIONS.protask_add_task_assignee,
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), user_id: id('User ID to assign') },
      required: ['task_id', 'user_id'],
    },
  },
  {
    name: 'protask_remove_task_assignee',
    description: 'Remove a user assignment from a task',
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), user_id: id('User ID to remove') },
      required: ['task_id', 'user_id'],
    },
  },
  {
    name: 'protask_add_task_label',
    description: 'Add a label to a task',
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), label_id: id('Label ID') },
      required: ['task_id', 'label_id'],
    },
  },
  {
    name: 'protask_remove_task_label',
    description: 'Remove a label from a task',
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), label_id: id('Label ID') },
      required: ['task_id', 'label_id'],
    },
  },

  // Custom fields
  { name: 'protask_list_custom_fields', description: DESCRIPTIONS.protask_list_custom_fields, inputSchema: noArgs },
  {
    name: 'protask_get_task_custom_fields',
    description: DESCRIPTIONS.protask_get_task_custom_fields,
    inputSchema: { type: 'object', properties: { task_id: id('Task ID') }, required: ['task_id'] },
  },
  {
    name: 'protask_set_task_custom_fields',
    description: DESCRIPTIONS.protask_set_task_custom_fields,
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('Task ID'),
        values: {
          type: 'object',
          additionalProperties: true,
          description: 'Map of field id or slug to value; null or "" clears the field. Example: {"budget": 1200, "scadenza_cliente": "2026-12-31"}',
        },
      },
      required: ['task_id', 'values'],
    },
  },

  // Checklists
  {
    name: 'protask_list_checklists',
    description: DESCRIPTIONS.protask_list_checklists,
    inputSchema: { type: 'object', properties: { task_id: id('Task ID') }, required: ['task_id'] },
  },
  {
    name: 'protask_create_checklist',
    description: 'Create a new checklist in a task',
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), name: { type: 'string', description: 'Checklist name' } },
      required: ['task_id', 'name'],
    },
  },
  {
    name: 'protask_add_checklist_item',
    description: 'Add an item to a checklist',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('Task ID'),
        checklist_id: id('Checklist ID'),
        name: { type: 'string', description: 'Item name' },
      },
      required: ['task_id', 'checklist_id', 'name'],
    },
  },
  {
    name: 'protask_update_checklist_item',
    description: 'Update a checklist item (check/uncheck or rename)',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('Task ID'),
        checklist_id: id('Checklist ID'),
        item_id: id('Item ID'),
        name: { type: 'string', description: 'New name' },
        checked: { type: 'boolean', description: 'Check/uncheck' },
      },
      required: ['task_id', 'checklist_id', 'item_id'],
    },
  },

  // Comments
  {
    name: 'protask_list_comments',
    description: DESCRIPTIONS.protask_list_comments,
    inputSchema: { type: 'object', properties: { task_id: id('Task ID') }, required: ['task_id'] },
  },
  {
    name: 'protask_create_comment',
    description: DESCRIPTIONS.protask_create_comment,
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), comment: { type: 'string', description: 'Comment text' } },
      required: ['task_id', 'comment'],
    },
  },

  // Timers
  { name: 'protask_get_active_timer', description: DESCRIPTIONS.protask_get_active_timer, inputSchema: noArgs },
  { name: 'protask_get_my_timers', description: DESCRIPTIONS.protask_get_my_timers, inputSchema: noArgs },
  {
    name: 'protask_start_timer',
    description: 'Start a timer on a task (stops any active timer)',
    inputSchema: {
      type: 'object',
      properties: { task_id: id('Task ID'), description: { type: 'string', description: 'Timer description' } },
      required: ['task_id'],
    },
  },
  {
    name: 'protask_stop_timer',
    description: 'Stop the timer on a task',
    inputSchema: { type: 'object', properties: { task_id: id('Task ID') }, required: ['task_id'] },
  },
  {
    name: 'protask_add_manual_time',
    description: 'Add a manual time entry to a task',
    inputSchema: {
      type: 'object',
      properties: {
        task_id: id('Task ID'),
        start: { type: 'string', description: 'Start datetime (ISO format)' },
        end: { type: 'string', description: 'End datetime (ISO format)' },
        description: { type: 'string', description: 'Time entry description' },
      },
      required: ['task_id', 'start', 'end'],
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

/**
 * Corpo di una richiesta costruito solo dalle chiavi dello schema del tool (meno quelle del percorso):
 * argomenti inventati dal modello non arrivano all'API. Le chiavi assenti o undefined non si mandano.
 */
export function bodyFromSchema(toolName: string, args: Args, exclude: string[] = []): Args {
  const props = TOOL_BY_NAME.get(toolName)?.inputSchema.properties ?? {};
  const body: Args = {};
  for (const key of Object.keys(props)) {
    if (exclude.includes(key) || args[key] === undefined) continue;
    body[key] = args[key];
  }
  return body;
}

// Corpo di create/update task: whitelist dallo schema, priorità convertita in intero (null resta assente)
function taskBody(toolName: string, args: Args, exclude: string[] = []): Args {
  const body = bodyFromSchema(toolName, args, exclude);
  if (body.priority === null) delete body.priority;
  else if (body.priority !== undefined) body.priority = parsePriority(body.priority);
  return body;
}

type Handler = (client: ProTaskClient, args: Args) => Promise<unknown>;

const HANDLERS: Record<string, Handler> = {
  // Auth
  protask_get_me: (c) => c.me(),
  protask_list_users: (c) => c.listUsers(),
  // Workspaces
  protask_list_workspaces: (c) => c.listWorkspaces(),
  protask_get_workspace: (c, a) => c.getWorkspace(a.workspace_id as number),
  protask_create_workspace: (c, a) => c.createWorkspace(a as { name: string; description?: string; website?: string }),
  protask_get_workspace_members: (c, a) => c.getWorkspaceMembers(a.workspace_id as number),
  // Projects
  protask_list_projects: (c) => c.listProjects(),
  protask_get_project: (c, a) => c.getProject(a.project_id as number),
  protask_create_project: (c, a) => c.createProject(a as { title: string; workspace_id: number; description?: string }),
  protask_update_project: (c, a) => c.updateProject(a.project_id as number, a as { title?: string; description?: string }),
  protask_delete_project: (c, a) => c.deleteProject(a.project_id as number),
  // Board lists
  protask_list_board_lists: (c, a) => c.listBoardLists(a.project_id as number),
  protask_create_board_list: (c, a) => c.createBoardList(a.project_id as number, a as { name: string; color?: string }),
  protask_update_board_list: (c, a) =>
    c.updateBoardList(a.project_id as number, a.list_id as number, a as { name?: string; color?: string }),
  protask_delete_board_list: (c, a) => c.deleteBoardList(a.project_id as number, a.list_id as number),
  // Labels
  protask_list_labels: (c, a) => c.listLabels(a.project_id as number),
  protask_create_label: (c, a) => c.createLabel(a.project_id as number, a as { name: string; color: string }),
  // Tasks
  protask_list_tasks: (c, a) =>
    c.listTasks({ project_id: a.project_id as number, list_id: a.list_id as number, ...parseTaskFilters(a) }),
  protask_get_task: (c, a) => c.getTask(a.task_id as number),
  protask_create_task: (c, a) =>
    c.createTask(taskBody('protask_create_task', a) as { title: string; list_id: number; project_id: number }),
  protask_update_task: (c, a) => c.updateTask(a.task_id as number, taskBody('protask_update_task', a, ['task_id'])),
  protask_delete_task: (c, a) => c.deleteTask(a.task_id as number),
  protask_move_task: (c, a) => runMoveTask(c, a),
  protask_my_tasks: (c, a) => c.getMyTasks({ include_done: isTrue(a.include_done), ...parseTaskFilters(a) }),
  protask_find_colleague: (c, a) => c.findPeople(a.project_id as number, a.name as string),
  protask_add_task_assignee: (c, a) => c.addTaskAssignee(a.task_id as number, a.user_id as number),
  protask_remove_task_assignee: (c, a) => c.removeTaskAssignee(a.task_id as number, a.user_id as number),
  protask_add_task_label: (c, a) => c.addTaskLabel(a.task_id as number, a.label_id as number),
  protask_remove_task_label: (c, a) => c.removeTaskLabel(a.task_id as number, a.label_id as number),
  // Custom fields
  protask_list_custom_fields: (c) => c.listCustomFields(),
  protask_get_task_custom_fields: (c, a) => c.getTaskCustomFields(a.task_id as number),
  protask_set_task_custom_fields: async (c, a) => {
    const values = parseObject('values', a.values);
    if (Object.keys(values).length === 0) {
      throw new ToolInputError('values è vuoto: indica almeno un campo (id o slug) e il suo valore');
    }
    return c.setTaskCustomFields(a.task_id as number, values);
  },
  // Checklists
  protask_list_checklists: (c, a) => c.listChecklists(a.task_id as number),
  protask_create_checklist: (c, a) => c.createChecklist(a.task_id as number, a as { name: string }),
  protask_add_checklist_item: (c, a) =>
    c.addChecklistItem(a.task_id as number, a.checklist_id as number, a as { name: string }),
  protask_update_checklist_item: (c, a) =>
    c.updateChecklistItem(a.task_id as number, a.checklist_id as number, a.item_id as number, a as { name?: string; checked?: boolean }),
  // Comments
  protask_list_comments: (c, a) => c.listComments(a.task_id as number),
  protask_create_comment: (c, a) => c.createComment(a.task_id as number, a as { comment: string }),
  // Timers
  protask_get_active_timer: (c) => c.getActiveTimer(),
  protask_get_my_timers: (c) => c.getMyTimers(),
  protask_start_timer: (c, a) => c.startTimer(a.task_id as number, a.description as string | undefined),
  protask_stop_timer: (c, a) => c.stopTimer(a.task_id as number),
  protask_add_manual_time: (c, a) =>
    c.addManualTime(a.task_id as number, a as { start: string; end: string; description?: string }),
};

export const isKnownTool = (name: string): boolean => TOOL_BY_NAME.has(name) && name in HANDLERS;

const isMissing = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Esegue un tool e restituisce il risultato dell'API. Tool sconosciuto, parametri obbligatori mancanti o
 * argomenti non validi tornano come `{ error }` (toolResult li segna isError). Lancia solo
 * ProTaskUnauthorizedError, così il trasporto HTTP risponde 401 e il client rinnova il token.
 */
export async function executeTool(client: ProTaskClient, name: string, rawArgs: unknown): Promise<unknown> {
  const tool = TOOL_BY_NAME.get(name);
  const handler = HANDLERS[name];
  if (!tool || !handler) {
    return { error: `Tool sconosciuto: ${name}. Chiedi l'elenco dei tool (tools/list) e usa uno di quei nomi` };
  }
  const args: Args =
    typeof rawArgs === 'object' && rawArgs !== null && !Array.isArray(rawArgs) ? (rawArgs as Args) : {};

  const missing = (tool.inputSchema.required ?? []).filter((k) => isMissing(args[k]));
  if (missing.length) return { error: `parametri obbligatori mancanti: ${missing.join(', ')}` };

  try {
    return await handler(client, args);
  } catch (error) {
    if (error instanceof ProTaskUnauthorizedError) throw error;
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
