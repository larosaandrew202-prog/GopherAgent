/* Shared domain types for the Gopher Agent console.
 *
 * These mirror the JSON shapes returned by channel/web/web_channel.py. Many
 * responses are loose by design (the backend evolves independently), so
 * optional fields and index signatures are used where the contract is not
 * strict. */

export type Role = 'user' | 'assistant' | 'system';

export type PermissionMode = 'read_only' | 'workspace_write' | 'full_access';

export type FileKind =
  | 'directory'
  | 'html'
  | 'markdown'
  | 'image'
  | 'video'
  | 'audio'
  | 'pdf'
  | 'csv'
  | 'code'
  | 'office'
  | 'text'
  | 'file';

/* ------------------------------------------------------------------ chat */

export interface Attachment {
  id?: string;
  file_name?: string;
  name?: string;
  file_path?: string;
  path?: string;
  file_type?: string;
  size?: number;
  url?: string;
  file_count?: number;
  is_dir?: boolean;
  _uploading?: boolean;
}

export interface ToolCall {
  id?: string;
  name: string;
  args?: unknown;
  arguments?: unknown;
}

export interface ToolStep {
  type: 'tool';
  name?: string;
  tool_call_id?: string;
  args?: unknown;
  result?: unknown;
  status?: 'running' | 'done' | 'error' | 'cancelled';
  substeps?: unknown[];
}

/** Sequence of events the backend uses to reconstruct an assistant turn. */
export interface StreamEvent {
  type:
    | 'reasoning'
    | 'delta'
    | 'message_end'
    | 'tool_start'
    | 'tool_progress'
    | 'tool_end'
    | 'subagent_step'
    | 'image'
    | 'text'
    | 'video'
    | 'file'
    | 'artifact'
    | 'phase'
    | 'cancelled'
    | 'done'
    | 'voice_attach'
    | 'stream_end'
    | 'resync_required'
    | 'error'
    | string;
  seq?: number;
  content?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id?: string;
  seq?: number;
  role: Role;
  content: string;
  timestamp: number;
  requestId?: string;
  tool_calls?: ToolCall[];
  steps?: ToolStep[];
  thinking?: string;
  attachments?: Attachment[];
  audioUrl?: string;
  /** Local-only marker used to render the "context cleared" divider. */
  divider?: boolean;
  deleted?: boolean;
}

export interface SendMessageBody {
  session_id: string;
  message: string;
  attachments?: Attachment[];
  stream?: boolean;
  is_voice?: boolean;
  steer?: boolean;
  agent_id?: string;
  lang?: string;
}

export interface SendMessageResult {
  status: string;
  request_id: string;
  stream?: boolean;
  inline_reply?: string;
  steered?: boolean;
  message?: string;
}

export interface UploadResult {
  status: string;
  files?: Attachment[];
  message?: string;
}

/* --------------------------------------------------------------- sessions */

export interface Session {
  session_id: string;
  title: string;
  created_at?: number | string;
  updated_at?: number | string;
  last_message_at?: number | string;
  pinned?: boolean;
  project_dir?: string | null;
  project_name?: string | null;
  agent_id?: string;
  message_count?: number;
}

export interface SessionProject {
  path: string;
  name: string;
  session_count?: number;
}

export interface SessionListResult {
  status: string;
  sessions: Session[];
  total?: number;
  has_more?: boolean;
  projects?: SessionProject[];
  project_order?: string[];
}

export interface SessionHistoryResult {
  status: string;
  messages: ChatMessage[];
  has_more?: boolean;
  total?: number;
  page?: number;
}

export interface SessionSettings {
  status?: string;
  permission?: PermissionMode | 'global' | null;
  model?: { provider: string; model: string } | null;
  global_permission?: PermissionMode;
  global_model?: { provider: string; model: string } | null;
}

export interface SessionSettingsUpdate {
  permission?: PermissionMode | 'global' | null;
  model?: { provider: string; model: string } | null;
}

/* ------------------------------------------------------------ workspace */

export interface WorkspaceEntry {
  name: string;
  path: string;
  type: 'file' | 'dir';
  kind?: FileKind;
  size?: number;
  mtime?: number | string;
  children?: WorkspaceEntry[];
}

export interface WorkspaceTreeResult {
  status: string;
  root?: string;
  path?: string;
  entries: WorkspaceEntry[];
  truncated?: boolean;
}

export interface WorkspaceMeta {
  status: string;
  root?: string;
  default_workspace?: string;
  projects_root?: string;
}

export interface ProjectBrowseResult {
  status: string;
  path: string;
  parent?: string;
  entries: WorkspaceEntry[];
  drives?: string[];
  is_dir?: boolean;
}

export interface ProjectsResult {
  status: string;
  current?: string | null;
  recents?: SessionProject[];
  default_workspace?: string;
  projects_root?: string;
  projects?: SessionProject[];
}

/* ---------------------------------------------------------------- config */

export interface ProviderConfig {
  label: string | Record<string, string>;
  models?: string[];
  [key: string]: unknown;
}

export interface AppConfig {
  status?: string;
  providers?: Record<string, ProviderConfig>;
  api_bases?: Record<string, string>;
  api_keys?: Record<string, string>;
  model?: string;
  bot_type?: string;
  reasoning_effort?: string;
  reasoning_effort_by_model?: Record<string, string[]>;
  agent_max_context_tokens?: number;
  agent_max_context_turns?: number;
  agent_max_steps?: number;
  enable_thinking?: boolean;
  subagent_enabled?: boolean;
  self_evolution_enabled?: boolean;
  permission_modes?: PermissionMode[];
  agent_permission_mode?: PermissionMode;
  web_password_masked?: string;
  [key: string]: unknown;
}

/* ---------------------------------------------------------------- models */

export interface ProviderOverview {
  id: string;
  label: string | Record<string, string>;
  configured: boolean;
  is_custom?: boolean;
  custom_id?: string;
  api_key_field?: string;
  api_base_field?: string;
  api_key_masked?: string;
  api_base?: string;
  api_base_default?: string;
  api_base_placeholder?: string;
  models?: string[];
  [key: string]: unknown;
}

export interface CapabilityState {
  editable?: boolean;
  current_provider?: string;
  current_model?: string;
  providers?: string[];
  provider_options?: { id: string; label: string; configured?: boolean }[];
  models?: string[];
  strategy?: string;
  voice?: string;
  voices?: string[];
  [key: string]: unknown;
}

export interface ModelsResult {
  status: string;
  providers: ProviderOverview[];
  capabilities: Record<string, CapabilityState>;
}

/* ------------------------------------------------------ tools and skills */

export interface ToolInfo {
  name: string;
  label?: string | Record<string, string>;
  description?: string | Record<string, string>;
  enabled?: boolean;
  icon?: string;
  [key: string]: unknown;
}

export interface SkillInfo {
  name: string;
  title?: string | Record<string, string>;
  description?: string | Record<string, string>;
  enabled: boolean;
  path?: string;
  version?: string;
  author?: string;
  icon?: string;
  [key: string]: unknown;
}

export interface ToolsResult {
  status: string;
  tools: ToolInfo[];
}

export interface SkillsResult {
  status: string;
  skills: SkillInfo[];
}

/* ---------------------------------------------------------------- memory */

export interface MemoryFile {
  filename: string;
  type?: 'global' | 'evolution' | 'dream' | 'daily' | string;
  size: number;
  updated_at?: string;
  [key: string]: unknown;
}

export interface MemoryResult {
  status: string;
  list: MemoryFile[];
  total: number;
  page?: number;
  page_size?: number;
}

export interface MemoryContentResult {
  status: string;
  content: string;
  filename?: string;
}

/* ------------------------------------------------------------- knowledge */

export interface KnowledgeFile {
  name: string;
  title: string;
  size?: number;
  updated_at?: string;
}

export interface KnowledgeGroup {
  dir: string;
  title: string;
  files: KnowledgeFile[];
  children?: KnowledgeGroup[];
}

export interface KnowledgeListResult {
  status: string;
  tree: KnowledgeGroup[];
  root_files: KnowledgeFile[];
  stats: { pages?: number; size?: number };
}

export interface KnowledgeReadResult {
  status: string;
  content: string;
  title?: string;
  path?: string;
}

export interface GraphNode {
  id: string;
  label?: string;
  group?: string | number;
  [key: string]: unknown;
}

export interface GraphLink {
  source: string;
  target: string;
  [key: string]: unknown;
}

export interface KnowledgeGraphResult {
  status: string;
  nodes: GraphNode[];
  links: GraphLink[];
}

/* -------------------------------------------------------------- channels */

export interface ChannelField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'bool' | 'number' | string;
  value?: string | number | boolean;
  placeholder?: string;
  options?: string[];
  [key: string]: unknown;
}

export interface ChannelInfo {
  name: string;
  label: string | Record<string, string>;
  active: boolean;
  configured?: boolean;
  icon?: string;
  color?: string;
  fields?: ChannelField[];
  login_status?: string;
  [key: string]: unknown;
}

export interface ChannelsResult {
  status: string;
  channels: ChannelInfo[];
}

export interface QrLoginResult {
  status: string;
  qrcode?: string;
  qr_url?: string;
  login_status?: string;
  message?: string;
  [key: string]: unknown;
}

/* ------------------------------------------------------------ scheduler */

export interface ScheduledTask {
  id: string;
  name: string;
  enabled?: boolean;
  next_run_at?: number | string;
  schedule?: {
    type?: 'cron' | 'interval' | 'once' | string;
    expression?: string;
    seconds?: number;
    time?: string;
    [key: string]: unknown;
  };
  action?: {
    type?: 'send_message' | 'agent_task' | string;
    channel_type?: string;
    content?: string;
    task_description?: string;
    receiver?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SchedulerResult {
  status: string;
  tasks: ScheduledTask[];
}

/* ------------------------------------------------------------------ auth */

export interface AuthCheckResult {
  status?: string;
  enabled: boolean;
  authenticated: boolean;
}

export interface AuthLoginResult {
  status: string;
  ok?: boolean;
  token?: string;
  error?: string;
}

/* ------------------------------------------------------------- streaming */

export type StreamListener = (event: StreamEvent) => void;

export interface StreamSubscription {
  close: () => void;
}

/* ------------------------------------------------------------- log stream */

export interface LogEvent {
  type: 'init' | 'line' | 'error' | string;
  line?: string;
  level?: string;
  [key: string]: unknown;
}
