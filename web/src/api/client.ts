/* Unified API surface for the console.
 *
 * The app talks to `api`, never to fetch directly. Two implementations exist:
 *   - createMockApi(): static fixtures + simulated streaming (used by default)
 *   - createHttpApi(): real calls to the Python web channel
 *
 * Flip VITE_USE_MOCK to 'false' (or set it in .env.local) to use the backend.
 * All request paths mirror channel/web/web_channel.py exactly.
 */
import {
  MOCK_VERSION,
  mockChannels,
  mockConfig,
  mockGraph,
  mockHistory,
  mockKnowledge,
  mockKnowledgeContent,
  mockMemoryContent,
  mockMemoryFiles,
  mockModels,
  mockPreviewContent,
  mockProjects,
  mockReply,
  mockSessions,
  mockSkills,
  mockTasks,
  mockTools,
  mockWorkspace,
  mockWorkspaceFiles,
} from './mockData';
import type {
  AppConfig,
  AuthCheckResult,
  AuthLoginResult,
  ChannelInfo,
  ChannelsResult,
  ChatMessage,
  KnowledgeGraphResult,
  KnowledgeListResult,
  KnowledgeReadResult,
  LogEvent,
  MemoryContentResult,
  MemoryResult,
  ModelsResult,
  PermissionMode,
  ProjectBrowseResult,
  ProjectsResult,
  QrLoginResult,
  ScheduledTask,
  SchedulerResult,
  SendMessageBody,
  SendMessageResult,
  Session,
  SessionHistoryResult,
  SessionListResult,
  SessionSettings,
  SessionSettingsUpdate,
  SkillInfo,
  SkillsResult,
  StreamEvent,
  StreamSubscription,
  ToolInfo,
  ToolsResult,
  UploadResult,
  WorkspaceEntry,
  WorkspaceMeta,
  WorkspaceTreeResult,
} from './types';

export interface Api {
  /* auth + meta */
  authCheck(): Promise<AuthCheckResult>;
  authLogin(password: string): Promise<AuthLoginResult>;
  authLogout(): Promise<void>;
  version(): Promise<{ version: string }>;

  /* chat */
  sendMessage(body: SendMessageBody): Promise<SendMessageResult>;
  cancel(requestId?: string): Promise<void>;
  steer(prompt: string, sessionId: string): Promise<SendMessageResult>;
  upload(form: FormData): Promise<UploadResult>;
  streamChat(
    requestId: string,
    onEvent: (event: StreamEvent) => void,
    onEnd?: (err?: Error) => void,
    afterSeq?: number,
  ): StreamSubscription;

  /* config */
  getConfig(): Promise<AppConfig>;
  saveConfig(body: Record<string, unknown>): Promise<{ status: string; error?: string }>;
  optimizePrompt(
    message: string,
    lang: string,
  ): Promise<{ status: string; message?: string; optimized?: string }>;

  /* sessions */
  listSessions(page: number, pageSize: number): Promise<SessionListResult>;
  getSession(sessionId: string): Promise<Session & { status?: string }>;
  updateSession(
    sessionId: string,
    body: { title?: string; pinned?: boolean },
  ): Promise<{ status: string }>;
  deleteSession(sessionId: string): Promise<{ status: string }>;
  clearContext(sessionId: string): Promise<{ status: string }>;
  generateTitle(sessionId: string, body: Record<string, unknown>): Promise<{ status: string }>;
  getSessionSettings(sessionId: string): Promise<SessionSettings>;
  updateSessionSettings(
    sessionId: string,
    body: SessionSettingsUpdate,
  ): Promise<SessionSettings>;
  history(
    sessionId: string,
    page: number,
    pageSize: number,
  ): Promise<SessionHistoryResult>;
  deleteMessages(
    sessionId: string,
    body: { seqs?: number[]; message_ids?: string[]; all?: boolean },
  ): Promise<{ status: string }>;

  /* workspace + projects */
  workspaceTree(path: string, opts?: { search?: string; root?: string }): Promise<WorkspaceTreeResult>;
  workspaceSearch(query: string, root?: string): Promise<WorkspaceTreeResult>;
  workspaceMeta(): Promise<WorkspaceMeta>;
  workspaceResolve(path: string): Promise<{ status: string; path?: string; content?: string }>;
  projects(sessionId: string): Promise<ProjectsResult>;
  selectProject(body: { session: string; project_dir?: string }): Promise<{ status: string }>;
  createProject(body: { session: string; name: string }): Promise<{ status: string; path?: string }>;
  browseProjects(path: string): Promise<ProjectBrowseResult>;
  reorderProjects(order: string[]): Promise<{ status: string }>;
  manageProject(body: { action: 'rename' | 'delete'; path: string; name?: string }): Promise<{ status: string }>;
  fileUrl(path: string): string;

  /* voice */
  asr(form: FormData): Promise<{ status: string; text?: string }>;
  tts(body: { text: string; provider?: string; model?: string; voice?: string }): Promise<{ status: string; url?: string }>;

  /* models */
  getModels(): Promise<ModelsResult>;
  modelsAction(body: Record<string, unknown>): Promise<{ status: string; message?: string }>;

  /* tools + skills */
  getTools(): Promise<ToolsResult>;
  getSkills(): Promise<SkillsResult>;
  toggleSkill(name: string, enabled: boolean): Promise<{ status: string }>;

  /* memory */
  getMemory(page: number, pageSize: number, category: string): Promise<MemoryResult>;
  getMemoryContent(filename: string, category: string): Promise<MemoryContentResult>;

  /* knowledge */
  knowledgeList(): Promise<KnowledgeListResult>;
  knowledgeRead(path: string): Promise<KnowledgeReadResult>;
  knowledgeGraph(): Promise<KnowledgeGraphResult>;
  knowledgeAction(body: Record<string, unknown>): Promise<{ status: string; message?: string }>;
  knowledgeImport(form: FormData): Promise<{ status: string; message?: string }>;

  /* channels */
  getChannels(lang?: string): Promise<ChannelsResult>;
  channelsAction(body: Record<string, unknown>): Promise<{ status: string; message?: string }>;
  weixinQrLogin(action?: 'get' | 'start'): Promise<QrLoginResult>;
  feishuRegister(action?: 'get' | 'start'): Promise<QrLoginResult>;

  /* scheduler */
  getScheduler(): Promise<SchedulerResult>;
  schedulerRun(taskId: string): Promise<{ status: string; message?: string }>;
  schedulerToggle(taskId: string, enabled: boolean): Promise<{ status: string }>;
  schedulerUpdate(task: Partial<ScheduledTask> & { id?: string }): Promise<{ status: string; task?: ScheduledTask }>;
  schedulerDelete(taskId: string): Promise<{ status: string }>;

  /* logs */
  streamLogs(onEvent: (event: LogEvent) => void): StreamSubscription;
}

/* ------------------------------------------------------------------ utils */

const USE_MOCK = (import.meta.env.VITE_USE_MOCK ?? 'true') !== 'false';
export const IS_MOCK = USE_MOCK;

/* Backend origin. When VITE_BACKEND_URL is set (e.g. http://localhost:9899)
 * every request is sent to that absolute address, so the built app works
 * against any backend without a dev proxy. When unset, requests stay
 * same-origin and rely on the Vite dev proxy. */
const BACKEND = ((import.meta.env.VITE_BACKEND_URL as string | undefined) ?? '')
  .trim()
  .replace(/\/+$/, '');

function apiUrl(path: string): string {
  return BACKEND ? `${BACKEND}${path}` : path;
}

/** Prefix a backend-relative URL (e.g. "/api/media?path=...") with the
 *  configured backend origin so media embedded in markdown resolves even when
 *  the console is served from a different origin (dev). */
export function backendUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path) || path.startsWith('data:')) return path;
  return apiUrl(path);
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function uid(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

/* ============================================================== MOCK API */

function createMockApi(): Api {
  const sessions: Session[] = [...mockSessions];
  const memory: MemoryResult = {
    status: 'success',
    list: [...mockMemoryFiles],
    total: mockMemoryFiles.length,
    page: 1,
    page_size: 20,
  };
  const tasks: ScheduledTask[] = [...mockTasks];
  const channels: ChannelInfo[] = [...mockChannels];
  const models: ModelsResult = structuredClone(mockModels);
  const skills: SkillInfo[] = [...mockSkills];
  const tools: ToolInfo[] = [...mockTools];
  const config: AppConfig = structuredClone(mockConfig);
  let currentProject: string | null = null;

  /* Chat stream plans keyed by request id. */
  const streamPlans = new Map<string, StreamEvent[]>();

  function buildReplyPlan(sessionId: string, prompt: string): StreamEvent[] {
    const intro = prompt.trim()
      ? `收到你的消息：“${prompt.trim().slice(0, 60)}”。\n\n`
      : '';
    const full = intro + mockReply;
    const events: StreamEvent[] = [];
    let seq = 0;
    const push = (e: Partial<StreamEvent> & { type: StreamEvent['type'] }) =>
      events.push({ ...e, seq: ++seq } as StreamEvent);

    // A little reasoning first.
    const reasoning = '我先理解一下你的需求，然后组织一个清晰的回答……';
    for (let i = 0; i < reasoning.length; i += 6) {
      push({ type: 'reasoning', content: reasoning.slice(i, i + 6) });
    }
    // One tool call.
    push({ type: 'tool_start', tool_call_id: 'tool_1', name: 'ls', args: { path: '.' }, content: 'ls' });
    push({ type: 'tool_progress', tool_call_id: 'tool_1', content: 'docs/  src/  README.md' });
    push({ type: 'tool_end', tool_call_id: 'tool_1', name: 'ls', result: 'docs/  src/  README.md', status: 'done' });
    push({ type: 'message_end', has_tool_calls: true });

    // Then the answer, chunked.
    for (let i = 0; i < full.length; i += 4) {
      push({ type: 'delta', content: full.slice(i, i + 4) });
    }
    push({ type: 'done', content: full, session_id: sessionId });
    push({ type: 'stream_end' });
    return events;
  }

  return {
    async authCheck() {
      return { status: 'success', enabled: false, authenticated: true };
    },
    async authLogin() {
      return { status: 'success', ok: true };
    },
    async authLogout() {
      await delay(100);
    },
    async version() {
      return { version: MOCK_VERSION };
    },

    async sendMessage(body) {
      const requestId = uid('req');
      const text = body.message ?? '';
      if (text.trim().toLowerCase() === '/cancel') {
        return { status: 'success', request_id: '', stream: false, inline_reply: 'Cancelled.' };
      }
      streamPlans.set(requestId, buildReplyPlan(body.session_id, text));
      return { status: 'success', request_id: requestId, stream: true };
    },
    async cancel() {
      await delay(80);
    },
    async steer(prompt) {
      return { status: 'success', request_id: '', stream: false, steered: true, inline_reply: `引导已注入：${prompt}` };
    },
    async upload(form) {
      const files: UploadResult['files'] = [];
      form.forEach((value, key) => {
        if (value instanceof File) {
          files.push({
            file_name: value.name,
            file_path: `uploads/${value.name}`,
            file_type: value.type.startsWith('image/') ? 'image' : 'file',
            size: value.size,
          });
        } else if (key === 'relative_paths') {
          /* ignore */
        }
      });
      await delay(300);
      return { status: 'success', files };
    },
    streamChat(requestId, onEvent, onEnd, afterSeq = 0) {
      const plan = streamPlans.get(requestId) ?? buildReplyPlan('', '');
      let i = 0;
      let closed = false;
      let timer: ReturnType<typeof setTimeout> | null = null;

      const step = () => {
        if (closed) return;
        while (i < plan.length && (plan[i].seq ?? 0) <= afterSeq) i++;
        if (i >= plan.length) {
          onEnd?.();
          return;
        }
        onEvent(plan[i]);
        i++;
        timer = setTimeout(step, 18);
      };
      timer = setTimeout(step, 120);

      return {
        close() {
          closed = true;
          if (timer) clearTimeout(timer);
        },
      };
    },

    async getConfig() {
      return structuredClone(config);
    },
    async saveConfig(body) {
      Object.assign(config, body);
      await delay(150);
      return { status: 'success' };
    },
    async optimizePrompt(message) {
      await delay(500);
      return {
        status: 'success',
        message: `请详细说明以下需求，并给出可执行的步骤：${message}`,
        optimized: `请详细说明以下需求，并给出可执行的步骤：${message}`,
      };
    },

    async listSessions(page, pageSize) {
      const start = (page - 1) * pageSize;
      const slice = sessions.slice(start, start + pageSize);
      return {
        status: 'success',
        sessions: slice,
        total: sessions.length,
        has_more: start + pageSize < sessions.length,
        projects: mockProjects,
        project_order: mockProjects.map((p) => p.path),
      };
    },
    async getSession(sessionId) {
      const s = sessions.find((x) => x.session_id === sessionId);
      return { status: 'success', ...(s ?? { session_id: sessionId, title: '' }) };
    },
    async updateSession(sessionId, body) {
      const s = sessions.find((x) => x.session_id === sessionId);
      if (s) Object.assign(s, body);
      return { status: 'success' };
    },
    async deleteSession(sessionId) {
      const idx = sessions.findIndex((x) => x.session_id === sessionId);
      if (idx >= 0) sessions.splice(idx, 1);
      return { status: 'success' };
    },
    async clearContext() {
      return { status: 'success' };
    },
    async generateTitle() {
      return { status: 'success' };
    },
    async getSessionSettings() {
      return {
        status: 'success',
        permission: 'global',
        model: null,
        global_permission: (config.agent_permission_mode as PermissionMode) ?? 'full_access',
        global_model: { provider: config.bot_type ?? 'openai', model: config.model ?? '' },
      };
    },
    async updateSessionSettings(_sessionId, body) {
      return { status: 'success', ...body };
    },
    async history(_sessionId, page, pageSize) {
      const start = (page - 1) * pageSize;
      return {
        status: 'success',
        messages: page === 1 ? mockHistory : [],
        has_more: false,
        total: mockHistory.length,
        page,
      };
    },
    async deleteMessages() {
      return { status: 'success' };
    },

    async workspaceTree(path, opts) {
      const search = opts?.search;
      if (search) return this.workspaceSearch(search, opts?.root);
      const entries = path && mockWorkspaceFiles[path] ? mockWorkspaceFiles[path] : mockWorkspace;
      return { status: 'success', path, entries, root: opts?.root };
    },
    async workspaceSearch(query) {
      const all = [
        ...mockWorkspace,
        ...Object.values(mockWorkspaceFiles).flat(),
      ];
      const q = query.toLowerCase();
      return {
        status: 'success',
        entries: all.filter((e) => e.name.toLowerCase().includes(q)),
      };
    },
    async workspaceMeta() {
      return { status: 'success', root: 'E:/code/demo', default_workspace: '~/cow', projects_root: 'E:/code' };
    },
    async workspaceResolve(path) {
      const content = mockPreviewContent[path] ?? `# ${path}\n\n(mock preview)`;
      return { status: 'success', path, content };
    },
    async projects() {
      return {
        status: 'success',
        current: currentProject,
        recents: mockProjects,
        default_workspace: '~/cow',
        projects_root: 'E:/code',
        projects: mockProjects,
      };
    },
    async selectProject(body) {
      currentProject = body.project_dir ?? null;
      return { status: 'success' };
    },
    async createProject(body) {
      return { status: 'success', path: `E:/code/${body.name}` };
    },
    async browseProjects(path) {
      return {
        status: 'success',
        path: path || 'E:/code',
        parent: 'E:/',
        entries: [
          { name: 'demo', path: 'E:/code/demo', type: 'dir', kind: 'directory' },
          { name: 'CowAgent', path: 'E:/code/CowAgent', type: 'dir', kind: 'directory' },
        ],
      };
    },
    async reorderProjects() {
      return { status: 'success' };
    },
    async manageProject() {
      return { status: 'success' };
    },
    fileUrl(path) {
      return `/api/file?path=${encodeURIComponent(path)}`;
    },

    async asr() {
      await delay(400);
      return { status: 'success', text: '这是语音识别的模拟文本。' };
    },
    async tts() {
      return { status: 'success', url: '' };
    },

    async getModels() {
      return structuredClone(models);
    },
    async modelsAction(body) {
      const action = body.action as string;
      if (action === 'set_capability') {
        const cap = models.capabilities[body.capability as string];
        if (cap) {
          cap.current_provider = body.provider as string;
          cap.current_model = body.model as string;
        }
      }
      await delay(150);
      return { status: 'success' };
    },

    async getTools() {
      return { status: 'success', tools: [...tools] };
    },
    async getSkills() {
      return { status: 'success', skills: [...skills] };
    },
    async toggleSkill(name, enabled) {
      const sk = skills.find((s) => s.name === name);
      if (sk) sk.enabled = enabled;
      return { status: 'success' };
    },

    async getMemory(page, pageSize, category) {
      const list =
        category === 'evolution'
          ? memory.list.filter((f) => f.type === 'evolution' || f.type === 'dream')
          : memory.list;
      return { ...memory, list, total: list.length, page, page_size: pageSize };
    },
    async getMemoryContent() {
      return { status: 'success', content: mockMemoryContent };
    },

    async knowledgeList() {
      return structuredClone(mockKnowledge);
    },
    async knowledgeRead(path) {
      return { status: 'success', content: mockKnowledgeContent, path, title: path.split('/').pop() };
    },
    async knowledgeGraph() {
      return structuredClone(mockGraph);
    },
    async knowledgeAction() {
      await delay(200);
      return { status: 'success' };
    },
    async knowledgeImport() {
      await delay(300);
      return { status: 'success' };
    },

    async getChannels() {
      return { status: 'success', channels: structuredClone(channels) };
    },
    async channelsAction() {
      await delay(150);
      return { status: 'success' };
    },
    async weixinQrLogin() {
      return {
        status: 'success',
        login_status: 'waiting',
        qr_url: 'https://example.com/qr',
        qrcode: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><text x="80" y="88" font-size="14" text-anchor="middle" fill="#333">MOCK QR</text></svg>'),
      };
    },
    async feishuRegister() {
      return {
        status: 'success',
        login_status: 'waiting',
        qrcode: 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#fff"/><text x="80" y="88" font-size="14" text-anchor="middle" fill="#333">FEISHU</text></svg>'),
      };
    },

    async getScheduler() {
      return { status: 'success', tasks: structuredClone(tasks) };
    },
    async schedulerRun(taskId) {
      await delay(300);
      return { status: 'success', message: taskId };
    },
    async schedulerToggle(taskId, enabled) {
      const task = tasks.find((t) => t.id === taskId);
      if (task) task.enabled = enabled;
      return { status: 'success' };
    },
    async schedulerUpdate(task) {
      const idx = tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) tasks[idx] = { ...tasks[idx], ...task } as ScheduledTask;
      else if (task.id) tasks.push(task as ScheduledTask);
      await delay(200);
      return { status: 'success' };
    },
    async schedulerDelete(taskId) {
      const idx = tasks.findIndex((t) => t.id === taskId);
      if (idx >= 0) tasks.splice(idx, 1);
      return { status: 'success' };
    },

    streamLogs(onEvent) {
      onEvent({ type: 'init' });
      const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR'];
      let n = 0;
      const timer = setInterval(() => {
        n++;
        const level = levels[Math.floor(Math.random() * levels.length)];
        const line = `2026-10-04 10:${String(n % 60).padStart(2, '0')}:${String((n * 7) % 60).padStart(2, '0')} [${level}] [WebChannel] mock log line #${n} — streaming works.`;
        onEvent({ type: 'line', line, level });
      }, 900);
      return { close: () => clearInterval(timer) };
    },
  };
}

/* ============================================================== HTTP API */

function createHttpApi(): Api {
  const jsonHeaders = { 'Content-Type': 'application/json' };
  const credentials: RequestCredentials = BACKEND ? 'include' : 'same-origin';

  async function get<T>(url: string): Promise<T> {
    const res = await fetch(apiUrl(url), { credentials });
    return (await res.json()) as T;
  }
  async function post<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(apiUrl(url), {
      method: 'POST',
      credentials,
      headers: jsonHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  return {
    authCheck: () => get<AuthCheckResult>('/auth/check'),
    authLogin: (password) => post<AuthLoginResult>('/auth/login', { password }),
    authLogout: async () => {
      await post('/auth/logout');
    },
    version: () => get<{ version: string }>('/api/version'),

    sendMessage: (body) => post<SendMessageResult>('/message', body),
    cancel: async (requestId) => {
      await post('/cancel', requestId ? { request_id: requestId } : {});
    },
    steer: (prompt, sessionId) => post<SendMessageResult>('/message', { message: prompt, session_id: sessionId, steer: true, stream: false }),
    upload: async (form) => {
      const res = await fetch(apiUrl('/upload'), { method: 'POST', credentials, body: form });
      return (await res.json()) as UploadResult;
    },
    streamChat(requestId, onEvent, onEnd, afterSeq = 0) {
      const url = apiUrl(`/stream?request_id=${encodeURIComponent(requestId)}${afterSeq ? `&after_seq=${afterSeq}` : ''}`);
      const es = new EventSource(url, { withCredentials: !!BACKEND });
      es.onmessage = (msg) => {
        try {
          const data = JSON.parse(msg.data) as StreamEvent;
          onEvent(data);
          if (data.type === 'stream_end') es.close();
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        es.close();
        onEnd?.(new Error('stream error'));
      };
      return { close: () => es.close() };
    },

    getConfig: () => get<AppConfig>('/config'),
    saveConfig: (body) => post('/config', body),
    optimizePrompt: (message, lang) => post('/api/prompt/optimize', { message, lang }),

    listSessions: (page, pageSize) => get<SessionListResult>(`/api/sessions?page=${page}&page_size=${pageSize}`),
    getSession: (sessionId) => get(`/api/sessions/${encodeURIComponent(sessionId)}`),
    updateSession: (sessionId, body) =>
      fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`), {
        method: 'PUT',
        credentials,
        headers: jsonHeaders,
        body: JSON.stringify(body),
      }).then((r) => r.json()),
    deleteSession: (sessionId) =>
      fetch(apiUrl(`/api/sessions/${encodeURIComponent(sessionId)}`), {
        method: 'DELETE',
        credentials,
      }).then((r) => r.json()),
    clearContext: (sessionId) => post(`/api/sessions/${encodeURIComponent(sessionId)}/clear_context`),
    generateTitle: (sessionId, body) => post(`/api/sessions/${encodeURIComponent(sessionId)}/generate_title`, body),
    getSessionSettings: (sessionId) => get<SessionSettings>(`/api/sessions/${encodeURIComponent(sessionId)}/settings`),
    updateSessionSettings: (sessionId, body) => post<SessionSettings>(`/api/sessions/${encodeURIComponent(sessionId)}/settings`, body),
    history: (sessionId, page, pageSize) =>
      get<SessionHistoryResult>(`/api/history?session_id=${encodeURIComponent(sessionId)}&page=${page}&page_size=${pageSize}`),
    deleteMessages: (sessionId, body) => post('/api/messages/delete', { session_id: sessionId, ...body }),

    workspaceTree: (path, opts) => {
      const params = new URLSearchParams();
      if (path) params.set('path', path);
      if (opts?.root) params.set('root', opts.root);
      return get<WorkspaceTreeResult>(`/api/workspace/tree?${params.toString()}`);
    },
    workspaceSearch: (query, root) => {
      const params = new URLSearchParams({ q: query });
      if (root) params.set('root', root);
      return get<WorkspaceTreeResult>(`/api/workspace/search?${params.toString()}`);
    },
    workspaceMeta: () => get<WorkspaceMeta>('/api/workspace/meta'),
    workspaceResolve: (path) => get(`/api/workspace/resolve?path=${encodeURIComponent(path)}`),
    projects: (sessionId) => get<ProjectsResult>(`/api/projects?session=${encodeURIComponent(sessionId)}`),
    selectProject: (body) => post('/api/projects/select', body),
    createProject: (body) => post('/api/projects/create', body),
    browseProjects: (path) => get<ProjectBrowseResult>(`/api/projects/browse?path=${encodeURIComponent(path || '')}`),
    reorderProjects: (order) => post('/api/projects/order', { order }),
    manageProject: (body) => post('/api/projects/manage', body),
    fileUrl: (path) => apiUrl(`/api/file?path=${encodeURIComponent(path)}`),

    asr: async (form) => {
      const res = await fetch(apiUrl('/api/voice/asr'), { method: 'POST', credentials, body: form });
      return res.json();
    },
    tts: (body) => post('/api/voice/tts', body),

    getModels: () => get<ModelsResult>('/api/models'),
    modelsAction: (body) => post('/api/models', body),

    getTools: () => get<ToolsResult>('/api/tools'),
    getSkills: () => get<SkillsResult>('/api/skills'),
    toggleSkill: (name, enabled) => post('/api/skills', { name, enabled }),

    getMemory: (page, pageSize, category) =>
      get<MemoryResult>(`/api/memory?page=${page}&page_size=${pageSize}&category=${category}`),
    getMemoryContent: (filename, category) =>
      get<MemoryContentResult>(`/api/memory/content?filename=${encodeURIComponent(filename)}&category=${category}`),

    knowledgeList: () => get<KnowledgeListResult>('/api/knowledge/list'),
    knowledgeRead: (path) => get<KnowledgeReadResult>(`/api/knowledge/read?path=${encodeURIComponent(path)}`),
    knowledgeGraph: () => get<KnowledgeGraphResult>('/api/knowledge/graph'),
    knowledgeAction: (body) => post('/api/knowledge/action', body),
    knowledgeImport: async (form) => {
      const res = await fetch(apiUrl('/api/knowledge/import'), { method: 'POST', credentials, body: form });
      return res.json();
    },

    getChannels: (lang) => get<ChannelsResult>(`/api/channels${lang ? `?lang=${lang}` : ''}`),
    channelsAction: (body) => post('/api/channels', body),
    weixinQrLogin: (action) => (action === 'start' ? post<QrLoginResult>('/api/weixin/qrlogin', {}) : get<QrLoginResult>('/api/weixin/qrlogin')),
    feishuRegister: (action) => (action === 'start' ? post<QrLoginResult>('/api/feishu/register', {}) : get<QrLoginResult>('/api/feishu/register')),

    getScheduler: () => get<SchedulerResult>('/api/scheduler'),
    schedulerRun: (taskId) => post('/api/scheduler/run', { task_id: taskId }),
    schedulerToggle: (taskId, enabled) => post('/api/scheduler/toggle', { task_id: taskId, enabled }),
    schedulerUpdate: (task) => post('/api/scheduler/update', task),
    schedulerDelete: (taskId) => post('/api/scheduler/delete', { task_id: taskId }),

    streamLogs(onEvent) {
      const es = new EventSource(apiUrl('/api/logs'), { withCredentials: !!BACKEND });
      es.onmessage = (msg) => {
        try {
          onEvent(JSON.parse(msg.data) as LogEvent);
        } catch {
          onEvent({ type: 'line', line: msg.data });
        }
      };
      return { close: () => es.close() };
    },
  };
}

export const api: Api = USE_MOCK ? createMockApi() : createHttpApi();
