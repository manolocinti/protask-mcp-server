#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, } from '@modelcontextprotocol/sdk/types.js';
import { ProTaskClient } from './api-client.js';
// Get token from environment
const PROTASK_TOKEN = process.env.PROTASK_TOKEN;
const PROTASK_API_URL = process.env.PROTASK_API_URL;
if (!PROTASK_TOKEN) {
    console.error('Error: PROTASK_TOKEN environment variable is required');
    process.exit(1);
}
const client = new ProTaskClient(PROTASK_TOKEN, PROTASK_API_URL);
// Define all tools
const tools = [
    // Auth
    {
        name: 'protask_get_me',
        description: 'Get current authenticated user information',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'protask_register_user',
        description: 'Register a new user in ProTask',
        inputSchema: {
            type: 'object',
            properties: {
                first_name: { type: 'string', description: 'User first name' },
                last_name: { type: 'string', description: 'User last name' },
                email: { type: 'string', description: 'User email address' },
                password: { type: 'string', description: 'User password (min 8 characters)' },
            },
            required: ['first_name', 'last_name', 'email', 'password'],
        },
    },
    {
        name: 'protask_list_users',
        description: 'List all users in ProTask',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    // Workspaces
    {
        name: 'protask_list_workspaces',
        description: 'List all workspaces the user has access to',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'protask_get_workspace',
        description: 'Get details of a specific workspace including projects',
        inputSchema: {
            type: 'object',
            properties: {
                workspace_id: { type: 'number', description: 'Workspace ID' },
            },
            required: ['workspace_id'],
        },
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
        description: 'Get members of a workspace',
        inputSchema: {
            type: 'object',
            properties: {
                workspace_id: { type: 'number', description: 'Workspace ID' },
            },
            required: ['workspace_id'],
        },
    },
    // Projects
    {
        name: 'protask_list_projects',
        description: 'List all projects the user has access to',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'protask_get_project',
        description: 'Get details of a specific project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
            },
            required: ['project_id'],
        },
    },
    {
        name: 'protask_create_project',
        description: 'Create a new project in a workspace',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Project title' },
                workspace_id: { type: 'number', description: 'Workspace ID' },
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
                project_id: { type: 'number', description: 'Project ID' },
                title: { type: 'string', description: 'New title' },
                description: { type: 'string', description: 'New description' },
            },
            required: ['project_id'],
        },
    },
    {
        name: 'protask_delete_project',
        description: 'Delete a project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
            },
            required: ['project_id'],
        },
    },
    // Board Lists
    {
        name: 'protask_list_board_lists',
        description: 'List all board lists (columns) in a project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
            },
            required: ['project_id'],
        },
    },
    {
        name: 'protask_create_board_list',
        description: 'Create a new board list (column) in a project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
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
                project_id: { type: 'number', description: 'Project ID' },
                list_id: { type: 'number', description: 'List ID' },
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
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
                list_id: { type: 'number', description: 'List ID' },
            },
            required: ['project_id', 'list_id'],
        },
    },
    // Labels
    {
        name: 'protask_list_labels',
        description: 'List all labels in a project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
            },
            required: ['project_id'],
        },
    },
    {
        name: 'protask_create_label',
        description: 'Create a new label in a project',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Project ID' },
                name: { type: 'string', description: 'Label name' },
                color: { type: 'string', description: 'Color hex code' },
            },
            required: ['project_id', 'name', 'color'],
        },
    },
    // Tasks
    {
        name: 'protask_list_tasks',
        description: 'List tasks, optionally filtered by project or list',
        inputSchema: {
            type: 'object',
            properties: {
                project_id: { type: 'number', description: 'Filter by project ID' },
                list_id: { type: 'number', description: 'Filter by list ID' },
            },
            required: [],
        },
    },
    {
        name: 'protask_get_task',
        description: 'Get details of a specific task including checklists, comments, etc.',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_create_task',
        description: 'Create a new task',
        inputSchema: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Task title' },
                list_id: { type: 'number', description: 'Board list ID' },
                project_id: { type: 'number', description: 'Project ID' },
                description: { type: 'string', description: 'Task description' },
                due_date: { type: 'string', description: 'Due date (YYYY-MM-DD format)' },
            },
            required: ['title', 'list_id', 'project_id'],
        },
    },
    {
        name: 'protask_update_task',
        description: 'Update a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                title: { type: 'string', description: 'New title' },
                description: { type: 'string', description: 'New description' },
                due_date: { type: 'string', description: 'New due date' },
                is_done: { type: 'boolean', description: 'Mark as done/undone' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_delete_task',
        description: 'Delete a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_move_task',
        description: 'Move a task to a different list',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                list_id: { type: 'number', description: 'Target list ID' },
                order: { type: 'number', description: 'Position in list (optional)' },
            },
            required: ['task_id', 'list_id'],
        },
    },
    {
        name: 'protask_add_task_assignee',
        description: 'Assign a user to a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                user_id: { type: 'number', description: 'User ID to assign' },
            },
            required: ['task_id', 'user_id'],
        },
    },
    {
        name: 'protask_remove_task_assignee',
        description: 'Remove a user assignment from a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                user_id: { type: 'number', description: 'User ID to remove' },
            },
            required: ['task_id', 'user_id'],
        },
    },
    {
        name: 'protask_add_task_label',
        description: 'Add a label to a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                label_id: { type: 'number', description: 'Label ID' },
            },
            required: ['task_id', 'label_id'],
        },
    },
    {
        name: 'protask_remove_task_label',
        description: 'Remove a label from a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                label_id: { type: 'number', description: 'Label ID' },
            },
            required: ['task_id', 'label_id'],
        },
    },
    // Checklists
    {
        name: 'protask_list_checklists',
        description: 'List all checklists in a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_create_checklist',
        description: 'Create a new checklist in a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                name: { type: 'string', description: 'Checklist name' },
            },
            required: ['task_id', 'name'],
        },
    },
    {
        name: 'protask_add_checklist_item',
        description: 'Add an item to a checklist',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                checklist_id: { type: 'number', description: 'Checklist ID' },
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
                task_id: { type: 'number', description: 'Task ID' },
                checklist_id: { type: 'number', description: 'Checklist ID' },
                item_id: { type: 'number', description: 'Item ID' },
                name: { type: 'string', description: 'New name' },
                checked: { type: 'boolean', description: 'Check/uncheck' },
            },
            required: ['task_id', 'checklist_id', 'item_id'],
        },
    },
    // Comments
    {
        name: 'protask_list_comments',
        description: 'List all comments on a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_create_comment',
        description: 'Add a comment to a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                comment: { type: 'string', description: 'Comment text' },
            },
            required: ['task_id', 'comment'],
        },
    },
    // Timers
    {
        name: 'protask_get_active_timer',
        description: 'Get the currently running timer (if any)',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'protask_get_my_timers',
        description: 'Get recent time entries for the current user',
        inputSchema: {
            type: 'object',
            properties: {},
            required: [],
        },
    },
    {
        name: 'protask_start_timer',
        description: 'Start a timer on a task (stops any active timer)',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                description: { type: 'string', description: 'Timer description' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_stop_timer',
        description: 'Stop the timer on a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
            },
            required: ['task_id'],
        },
    },
    {
        name: 'protask_add_manual_time',
        description: 'Add a manual time entry to a task',
        inputSchema: {
            type: 'object',
            properties: {
                task_id: { type: 'number', description: 'Task ID' },
                start: { type: 'string', description: 'Start datetime (ISO format)' },
                end: { type: 'string', description: 'End datetime (ISO format)' },
                description: { type: 'string', description: 'Time entry description' },
            },
            required: ['task_id', 'start', 'end'],
        },
    },
];
// Create server
const server = new Server({
    name: 'protask-mcp-server',
    version: '1.0.0',
}, {
    capabilities: {
        tools: {},
    },
});
// Handle list tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools };
});
// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
        let result;
        switch (name) {
            // Auth
            case 'protask_get_me':
                result = await client.me();
                break;
            case 'protask_register_user':
                result = await client.registerUser({
                    first_name: args?.first_name,
                    last_name: args?.last_name,
                    email: args?.email,
                    password: args?.password,
                    password_confirmation: args?.password,
                });
                break;
            case 'protask_list_users':
                result = await client.listUsers();
                break;
            // Workspaces
            case 'protask_list_workspaces':
                result = await client.listWorkspaces();
                break;
            case 'protask_get_workspace':
                result = await client.getWorkspace(args?.workspace_id);
                break;
            case 'protask_create_workspace':
                result = await client.createWorkspace(args);
                break;
            case 'protask_get_workspace_members':
                result = await client.getWorkspaceMembers(args?.workspace_id);
                break;
            // Projects
            case 'protask_list_projects':
                result = await client.listProjects();
                break;
            case 'protask_get_project':
                result = await client.getProject(args?.project_id);
                break;
            case 'protask_create_project':
                result = await client.createProject(args);
                break;
            case 'protask_update_project':
                result = await client.updateProject(args?.project_id, args);
                break;
            case 'protask_delete_project':
                result = await client.deleteProject(args?.project_id);
                break;
            // Board Lists
            case 'protask_list_board_lists':
                result = await client.listBoardLists(args?.project_id);
                break;
            case 'protask_create_board_list':
                result = await client.createBoardList(args?.project_id, args);
                break;
            case 'protask_update_board_list':
                result = await client.updateBoardList(args?.project_id, args?.list_id, args);
                break;
            case 'protask_delete_board_list':
                result = await client.deleteBoardList(args?.project_id, args?.list_id);
                break;
            // Labels
            case 'protask_list_labels':
                result = await client.listLabels(args?.project_id);
                break;
            case 'protask_create_label':
                result = await client.createLabel(args?.project_id, args);
                break;
            // Tasks
            case 'protask_list_tasks':
                result = await client.listTasks(args);
                break;
            case 'protask_get_task':
                result = await client.getTask(args?.task_id);
                break;
            case 'protask_create_task':
                result = await client.createTask(args);
                break;
            case 'protask_update_task':
                result = await client.updateTask(args?.task_id, args);
                break;
            case 'protask_delete_task':
                result = await client.deleteTask(args?.task_id);
                break;
            case 'protask_move_task':
                result = await client.moveTask(args?.task_id, args?.list_id, args?.order);
                break;
            case 'protask_add_task_assignee':
                result = await client.addTaskAssignee(args?.task_id, args?.user_id);
                break;
            case 'protask_remove_task_assignee':
                result = await client.removeTaskAssignee(args?.task_id, args?.user_id);
                break;
            case 'protask_add_task_label':
                result = await client.addTaskLabel(args?.task_id, args?.label_id);
                break;
            case 'protask_remove_task_label':
                result = await client.removeTaskLabel(args?.task_id, args?.label_id);
                break;
            // Checklists
            case 'protask_list_checklists':
                result = await client.listChecklists(args?.task_id);
                break;
            case 'protask_create_checklist':
                result = await client.createChecklist(args?.task_id, args);
                break;
            case 'protask_add_checklist_item':
                result = await client.addChecklistItem(args?.task_id, args?.checklist_id, args);
                break;
            case 'protask_update_checklist_item':
                result = await client.updateChecklistItem(args?.task_id, args?.checklist_id, args?.item_id, args);
                break;
            // Comments
            case 'protask_list_comments':
                result = await client.listComments(args?.task_id);
                break;
            case 'protask_create_comment':
                result = await client.createComment(args?.task_id, args);
                break;
            // Timers
            case 'protask_get_active_timer':
                result = await client.getActiveTimer();
                break;
            case 'protask_get_my_timers':
                result = await client.getMyTimers();
                break;
            case 'protask_start_timer':
                result = await client.startTimer(args?.task_id, args?.description);
                break;
            case 'protask_stop_timer':
                result = await client.stopTimer(args?.task_id);
                break;
            case 'protask_add_manual_time':
                result = await client.addManualTime(args?.task_id, args);
                break;
            default:
                return {
                    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                    isError: true,
                };
        }
        return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
    }
    catch (error) {
        return {
            content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}` }],
            isError: true,
        };
    }
});
// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('ProTask MCP Server running on stdio');
}
main().catch(console.error);
