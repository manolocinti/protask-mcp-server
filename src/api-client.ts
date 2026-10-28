/**
 * ProTask API Client
 */

import { escapeCommentHtml, htmlToText, type MoveData } from './handoff.js';

const BASE_URL = process.env.PROTASK_API_URL || 'https://protask.ilmarketing.net/api/v1';

// La descrizione del task si mostra con v-html come i commenti: va escapata allo stesso modo.
// Prima si riporta a testo, perché spesso è la descrizione riletta da get_task (già HTML)
function withEscapedDescription<T extends { description?: string }>(data: T): T {
  return typeof data.description === 'string'
    ? { ...data, description: escapeCommentHtml(htmlToText(data.description)) }
    : data;
}

// Stesso host, anche passando da http a https: il token non va mandato altrove
function sameHost(from: URL, to: URL): boolean {
  if (to.origin === from.origin) return true;
  return to.hostname === from.hostname && from.protocol === 'http:' && to.protocol === 'https:';
}

interface ApiResponse<T = unknown> {
  data?: T;
  success?: boolean;
  error?: string;
  errors?: Record<string, string[]>;
  message?: string;
}

export class ProTaskClient {
  private token: string;
  private baseUrl: string;

  constructor(token: string, baseUrl?: string) {
    this.token = token;
    this.baseUrl = baseUrl || BASE_URL;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;

    const headers: Record<string, string> = {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    try {
      // Redirect seguiti a mano (massimo 3) per tenere l'header Authorization, solo sullo stesso host
      let current = new URL(url);
      let response = await fetch(current.href, { ...options, headers, redirect: 'manual' });
      for (let hops = 0; response.status >= 300 && response.status < 400; hops++) {
        const location = response.headers.get('location');
        if (!location) break;
        const target = new URL(location, current);
        if (!sameHost(current, target)) {
          return { error: `HTTP ${response.status}: redirect verso ${target.origin} non seguito (il token resta su ${current.origin})` };
        }
        if (hops === 3) {
          return { error: `HTTP ${response.status}: troppi redirect` };
        }
        current = target;
        response = await fetch(current.href, { ...options, headers, redirect: 'manual' });
      }

      const text = await response.text();
      // 204, o DELETE senza corpo: nessun dato da leggere. Un 200 vuoto su altre chiamate resta un errore
      if (response.status === 204 || (response.ok && text.trim() === '' && options.method === 'DELETE')) {
        return { success: true };
      }

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
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
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Auth
  async me() {
    return this.request('/auth/me');
  }

  async registerUser(data: {
    first_name: string;
    last_name: string;
    email: string;
    password: string;
    password_confirmation: string;
  }) {
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
  async getMyTasks(includeDone?: boolean) {
    return this.request(`/me/tasks${includeDone ? '?include_done=1' : ''}`);
  }

  // People of a project, filtered by name/email
  async findPeople(projectId: number, q: string) {
    return this.request(`/projects/${projectId}/people?q=${encodeURIComponent(q)}`);
  }

  // Workspaces
  async listWorkspaces() {
    return this.request('/workspaces');
  }

  async getWorkspace(id: number) {
    return this.request(`/workspaces/${id}`);
  }

  async createWorkspace(data: { name: string; description?: string; website?: string }) {
    return this.request('/workspaces', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getWorkspaceMembers(workspaceId: number) {
    return this.request(`/workspaces/${workspaceId}/members`);
  }

  // Projects
  async listProjects() {
    return this.request('/projects');
  }

  async getProject(id: number) {
    return this.request(`/projects/${id}`);
  }

  async createProject(data: {
    title: string;
    workspace_id: number;
    description?: string;
  }) {
    return this.request('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(id: number, data: { title?: string; description?: string }) {
    return this.request(`/projects/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(id: number) {
    return this.request(`/projects/${id}`, { method: 'DELETE' });
  }

  // Board Lists
  async listBoardLists(projectId: number) {
    return this.request(`/projects/${projectId}/lists`);
  }

  async createBoardList(projectId: number, data: { name: string; color?: string }) {
    return this.request(`/projects/${projectId}/lists`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBoardList(projectId: number, listId: number, data: { name?: string; color?: string }) {
    return this.request(`/projects/${projectId}/lists/${listId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteBoardList(projectId: number, listId: number) {
    return this.request(`/projects/${projectId}/lists/${listId}`, { method: 'DELETE' });
  }

  // Labels
  async listLabels(projectId: number) {
    return this.request(`/projects/${projectId}/labels`);
  }

  async createLabel(projectId: number, data: { name: string; color: string }) {
    return this.request(`/projects/${projectId}/labels`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // Tasks
  async listTasks(filters?: { project_id?: number; list_id?: number }) {
    const params = new URLSearchParams();
    if (filters?.project_id) params.append('project_id', String(filters.project_id));
    if (filters?.list_id) params.append('list_id', String(filters.list_id));
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request(`/tasks${query}`);
  }

  async getTask(id: number) {
    return this.request(`/tasks/${id}`);
  }

  async createTask(data: {
    title: string;
    list_id: number;
    project_id: number;
    description?: string;
    due_date?: string;
  }) {
    return this.request('/tasks', {
      method: 'POST',
      body: JSON.stringify(withEscapedDescription(data)),
    });
  }

  async updateTask(id: number, data: {
    title?: string;
    description?: string;
    due_date?: string;
    is_done?: boolean;
  }) {
    return this.request(`/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify(withEscapedDescription(data)),
    });
  }

  async deleteTask(id: number) {
    return this.request(`/tasks/${id}`, { method: 'DELETE' });
  }

  async moveTask(taskId: number, data: MoveData) {
    return this.request(`/tasks/${taskId}/move`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async addTaskAssignee(taskId: number, userId: number) {
    return this.request(`/tasks/${taskId}/assignees`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  }

  async removeTaskAssignee(taskId: number, userId: number) {
    return this.request(`/tasks/${taskId}/assignees/${userId}`, { method: 'DELETE' });
  }

  async addTaskLabel(taskId: number, labelId: number) {
    return this.request(`/tasks/${taskId}/labels`, {
      method: 'POST',
      body: JSON.stringify({ label_id: labelId }),
    });
  }

  async removeTaskLabel(taskId: number, labelId: number) {
    return this.request(`/tasks/${taskId}/labels/${labelId}`, { method: 'DELETE' });
  }

  // Checklists
  async listChecklists(taskId: number) {
    return this.request(`/tasks/${taskId}/checklists`);
  }

  async createChecklist(taskId: number, data: { name: string }) {
    return this.request(`/tasks/${taskId}/checklists`, {
      method: 'POST',
      body: JSON.stringify({ title: data.name }),
    });
  }

  async addChecklistItem(taskId: number, checklistId: number, data: { name: string }) {
    return this.request(`/tasks/${taskId}/checklists/${checklistId}/items`, {
      method: 'POST',
      body: JSON.stringify({ title: data.name }),
    });
  }

  async updateChecklistItem(taskId: number, checklistId: number, itemId: number, data: { name?: string; checked?: boolean }) {
    const payload: Record<string, unknown> = {};
    if (data.name !== undefined) payload.title = data.name;
    if (data.checked !== undefined) payload.is_done = data.checked;
    return this.request(`/tasks/${taskId}/checklists/${checklistId}/items/${itemId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Comments
  async listComments(taskId: number) {
    return this.request(`/tasks/${taskId}/comments`);
  }

  async createComment(taskId: number, data: { comment: string }) {
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

  async startTimer(taskId: number, description?: string) {
    return this.request(`/tasks/${taskId}/timers/start`, {
      method: 'POST',
      body: JSON.stringify({ description }),
    });
  }

  async stopTimer(taskId: number) {
    return this.request(`/tasks/${taskId}/timers/stop`, {
      method: 'POST',
    });
  }

  async addManualTime(taskId: number, data: { start: string; end: string; description?: string }) {
    return this.request(`/tasks/${taskId}/timers`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }
}
