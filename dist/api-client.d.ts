/**
 * ProTask API Client
 */
import type { MoveData } from './handoff.js';
interface ApiResponse<T = unknown> {
    data?: T;
    success?: boolean;
    error?: string;
    errors?: Record<string, string[]>;
    message?: string;
}
export declare class ProTaskClient {
    private token;
    private baseUrl;
    constructor(token: string, baseUrl?: string);
    private request;
    me(): Promise<ApiResponse<unknown>>;
    registerUser(data: {
        first_name: string;
        last_name: string;
        email: string;
        password: string;
        password_confirmation: string;
    }): Promise<ApiResponse<unknown>>;
    listUsers(): Promise<ApiResponse<unknown>>;
    getMyTasks(includeDone?: boolean): Promise<ApiResponse<unknown>>;
    findPeople(projectId: number, q: string): Promise<ApiResponse<unknown>>;
    listWorkspaces(): Promise<ApiResponse<unknown>>;
    getWorkspace(id: number): Promise<ApiResponse<unknown>>;
    createWorkspace(data: {
        name: string;
        description?: string;
        website?: string;
    }): Promise<ApiResponse<unknown>>;
    getWorkspaceMembers(workspaceId: number): Promise<ApiResponse<unknown>>;
    listProjects(): Promise<ApiResponse<unknown>>;
    getProject(id: number): Promise<ApiResponse<unknown>>;
    createProject(data: {
        title: string;
        workspace_id: number;
        description?: string;
    }): Promise<ApiResponse<unknown>>;
    updateProject(id: number, data: {
        title?: string;
        description?: string;
    }): Promise<ApiResponse<unknown>>;
    deleteProject(id: number): Promise<ApiResponse<unknown>>;
    listBoardLists(projectId: number): Promise<ApiResponse<unknown>>;
    createBoardList(projectId: number, data: {
        name: string;
        color?: string;
    }): Promise<ApiResponse<unknown>>;
    updateBoardList(projectId: number, listId: number, data: {
        name?: string;
        color?: string;
    }): Promise<ApiResponse<unknown>>;
    deleteBoardList(projectId: number, listId: number): Promise<ApiResponse<unknown>>;
    listLabels(projectId: number): Promise<ApiResponse<unknown>>;
    createLabel(projectId: number, data: {
        name: string;
        color: string;
    }): Promise<ApiResponse<unknown>>;
    listTasks(filters?: {
        project_id?: number;
        list_id?: number;
    }): Promise<ApiResponse<unknown>>;
    getTask(id: number): Promise<ApiResponse<unknown>>;
    createTask(data: {
        title: string;
        list_id: number;
        project_id: number;
        description?: string;
        due_date?: string;
    }): Promise<ApiResponse<unknown>>;
    updateTask(id: number, data: {
        title?: string;
        description?: string;
        due_date?: string;
        is_done?: boolean;
    }): Promise<ApiResponse<unknown>>;
    deleteTask(id: number): Promise<ApiResponse<unknown>>;
    moveTask(taskId: number, data: MoveData): Promise<ApiResponse<unknown>>;
    addTaskAssignee(taskId: number, userId: number): Promise<ApiResponse<unknown>>;
    removeTaskAssignee(taskId: number, userId: number): Promise<ApiResponse<unknown>>;
    addTaskLabel(taskId: number, labelId: number): Promise<ApiResponse<unknown>>;
    removeTaskLabel(taskId: number, labelId: number): Promise<ApiResponse<unknown>>;
    listChecklists(taskId: number): Promise<ApiResponse<unknown>>;
    createChecklist(taskId: number, data: {
        name: string;
    }): Promise<ApiResponse<unknown>>;
    addChecklistItem(taskId: number, checklistId: number, data: {
        name: string;
    }): Promise<ApiResponse<unknown>>;
    updateChecklistItem(taskId: number, checklistId: number, itemId: number, data: {
        name?: string;
        checked?: boolean;
    }): Promise<ApiResponse<unknown>>;
    listComments(taskId: number): Promise<ApiResponse<unknown>>;
    createComment(taskId: number, data: {
        comment: string;
    }): Promise<ApiResponse<unknown>>;
    getActiveTimer(): Promise<ApiResponse<unknown>>;
    getMyTimers(): Promise<ApiResponse<unknown>>;
    startTimer(taskId: number, description?: string): Promise<ApiResponse<unknown>>;
    stopTimer(taskId: number): Promise<ApiResponse<unknown>>;
    addManualTime(taskId: number, data: {
        start: string;
        end: string;
        description?: string;
    }): Promise<ApiResponse<unknown>>;
}
export {};
