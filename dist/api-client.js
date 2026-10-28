/**
 * ProTask API Client
 */
import { escapeCommentHtml } from './handoff.js';
const BASE_URL = process.env.PROTASK_API_URL || 'https://protask.ilmarketing.net/api/v1';
export class ProTaskClient {
    token;
    baseUrl;
    constructor(token, baseUrl) {
        this.token = token;
        this.baseUrl = baseUrl || BASE_URL;
    }
    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const headers = {
            'Authorization': `Bearer ${this.token}`,
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };
        try {
            const response = await fetch(url, {
                ...options,
                headers,
                redirect: 'manual',
            });
            // Handle redirects explicitly to preserve auth headers
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                if (location) {
                    const redirectResponse = await fetch(location, {
                        ...options,
                        headers,
                    });
                    const data = await redirectResponse.json();
                    if (!redirectResponse.ok) {
                        return {
                            error: `HTTP ${redirectResponse.status}: ${data.message || data.error || 'Request failed'}`,
                            errors: data.errors,
                        };
                    }
                    return data;
                }
            }
            const text = await response.text();
            let data;
            try {
                data = JSON.parse(text);
            }
            catch {
                return {
                    error: `API returned non-JSON response (HTTP ${response.status}): ${text.substring(0, 200)}`,
                };
            }
            if (!response.ok) {
                return {
                    error: `HTTP ${response.status}: ${data.message || data.error || 'Request failed'}`,
                    errors: data.errors,
                };
            }
            return data;
        }
        catch (error) {
            return {
                error: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    // Auth
    async me() {
        return this.request('/auth/me');
    }
    async registerUser(data) {
        return this.request('/auth/register', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    // Users
    async listUsers() {
        return this.request('/users');
    }
    // Current user's tasks (compact; open only unless includeDone)
    async getMyTasks(includeDone) {
        return this.request(`/me/tasks${includeDone ? '?include_done=1' : ''}`);
    }
    // People of a project, filtered by name/email
    async findPeople(projectId, q) {
        return this.request(`/projects/${projectId}/people?q=${encodeURIComponent(q)}`);
    }
    // Workspaces
    async listWorkspaces() {
        return this.request('/workspaces');
    }
    async getWorkspace(id) {
        return this.request(`/workspaces/${id}`);
    }
    async createWorkspace(data) {
        return this.request('/workspaces', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async getWorkspaceMembers(workspaceId) {
        return this.request(`/workspaces/${workspaceId}/members`);
    }
    // Projects
    async listProjects() {
        return this.request('/projects');
    }
    async getProject(id) {
        return this.request(`/projects/${id}`);
    }
    async createProject(data) {
        return this.request('/projects', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async updateProject(id, data) {
        return this.request(`/projects/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    async deleteProject(id) {
        return this.request(`/projects/${id}`, { method: 'DELETE' });
    }
    // Board Lists
    async listBoardLists(projectId) {
        return this.request(`/projects/${projectId}/lists`);
    }
    async createBoardList(projectId, data) {
        return this.request(`/projects/${projectId}/lists`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async updateBoardList(projectId, listId, data) {
        return this.request(`/projects/${projectId}/lists/${listId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    async deleteBoardList(projectId, listId) {
        return this.request(`/projects/${projectId}/lists/${listId}`, { method: 'DELETE' });
    }
    // Labels
    async listLabels(projectId) {
        return this.request(`/projects/${projectId}/labels`);
    }
    async createLabel(projectId, data) {
        return this.request(`/projects/${projectId}/labels`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    // Tasks
    async listTasks(filters) {
        const params = new URLSearchParams();
        if (filters?.project_id)
            params.append('project_id', String(filters.project_id));
        if (filters?.list_id)
            params.append('list_id', String(filters.list_id));
        const query = params.toString() ? `?${params.toString()}` : '';
        return this.request(`/tasks${query}`);
    }
    async getTask(id) {
        return this.request(`/tasks/${id}`);
    }
    async createTask(data) {
        return this.request('/tasks', {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async updateTask(id, data) {
        return this.request(`/tasks/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    }
    async deleteTask(id) {
        return this.request(`/tasks/${id}`, { method: 'DELETE' });
    }
    async moveTask(taskId, data) {
        return this.request(`/tasks/${taskId}/move`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
    async addTaskAssignee(taskId, userId) {
        return this.request(`/tasks/${taskId}/assignees`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId }),
        });
    }
    async removeTaskAssignee(taskId, userId) {
        return this.request(`/tasks/${taskId}/assignees/${userId}`, { method: 'DELETE' });
    }
    async addTaskLabel(taskId, labelId) {
        return this.request(`/tasks/${taskId}/labels`, {
            method: 'POST',
            body: JSON.stringify({ label_id: labelId }),
        });
    }
    async removeTaskLabel(taskId, labelId) {
        return this.request(`/tasks/${taskId}/labels/${labelId}`, { method: 'DELETE' });
    }
    // Checklists
    async listChecklists(taskId) {
        return this.request(`/tasks/${taskId}/checklists`);
    }
    async createChecklist(taskId, data) {
        return this.request(`/tasks/${taskId}/checklists`, {
            method: 'POST',
            body: JSON.stringify({ title: data.name }),
        });
    }
    async addChecklistItem(taskId, checklistId, data) {
        return this.request(`/tasks/${taskId}/checklists/${checklistId}/items`, {
            method: 'POST',
            body: JSON.stringify({ title: data.name }),
        });
    }
    async updateChecklistItem(taskId, checklistId, itemId, data) {
        const payload = {};
        if (data.name !== undefined)
            payload.title = data.name;
        if (data.checked !== undefined)
            payload.is_done = data.checked;
        return this.request(`/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
        });
    }
    // Comments
    async listComments(taskId) {
        return this.request(`/tasks/${taskId}/comments`);
    }
    async createComment(taskId, data) {
        return this.request(`/tasks/${taskId}/comments`, {
            method: 'POST',
            // il web mostra i commenti con v-html: il testo va escapato e gli a capo diventano <br>.
            // Se manca o non è una stringa passa com'è, così ProTask risponde 422 invece di salvare "undefined"
            body: JSON.stringify({
                body: typeof data.comment === 'string' ? escapeCommentHtml(data.comment) : data.comment,
            }),
        });
    }
    // Timers
    async getActiveTimer() {
        return this.request('/timers/active');
    }
    async getMyTimers() {
        return this.request('/timers/my');
    }
    async startTimer(taskId, description) {
        return this.request(`/tasks/${taskId}/timers/start`, {
            method: 'POST',
            body: JSON.stringify({ description }),
        });
    }
    async stopTimer(taskId) {
        return this.request(`/tasks/${taskId}/timers/stop`, {
            method: 'POST',
        });
    }
    async addManualTime(taskId, data) {
        return this.request(`/tasks/${taskId}/timers`, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }
}
