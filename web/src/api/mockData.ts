/* Static fixtures backing the mock API layer.
 *
 * These let the React console run standalone (no Python backend) while
 * exercising the same shapes the real endpoints return. Replace the
 * VITE_USE_MOCK flag in src/api/client.ts to talk to the live backend. */
import type {
  AppConfig,
  ChannelInfo,
  ChatMessage,
  KnowledgeGraphResult,
  KnowledgeListResult,
  MemoryFile,
  ModelsResult,
  ScheduledTask,
  Session,
  SkillInfo,
  ToolInfo,
  WorkspaceEntry,
} from './types';

export const MOCK_VERSION = '2.0.0-mock';

export const mockConfig: AppConfig = {
  status: 'success',
  model: 'gpt-4o-mini',
  bot_type: 'openai',
  reasoning_effort: 'high',
  reasoning_effort_by_model: {
    'gpt-4o-mini': ['low', 'medium', 'high'],
    'claude-3-5-sonnet': ['low', 'medium', 'high'],
  },
  agent_max_context_tokens: 50000,
  agent_max_context_turns: 20,
  agent_max_steps: 20,
  enable_thinking: true,
  subagent_enabled: true,
  self_evolution_enabled: false,
  permission_modes: ['read_only', 'workspace_write', 'full_access'],
  agent_permission_mode: 'full_access',
  web_password_masked: '',
  providers: {
    openai: { label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
    deepseek: { label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
    claudeAPI: { label: 'Claude', models: ['claude-3-5-sonnet', 'claude-3-opus'] },
    gemini: { label: 'Gemini', models: ['gemini-2.0-flash', 'gemini-1.5-pro'] },
    moonshot: { label: 'Moonshot', models: ['moonshot-v1-8k', 'kimi-k2'] },
    dashscope: { label: 'DashScope', models: ['qwen-plus', 'qwen-max'] },
    doubao: { label: 'Doubao', models: ['doubao-pro-32k'] },
    zhipu: { label: 'Zhipu', models: ['glm-4-plus', 'glm-4v'] },
    minimax: { label: 'MiniMax', models: ['abab6.5s-chat'] },
    qianfan: { label: 'Qianfan', models: ['ernie-4.0'] },
    custom: { label: 'Custom', models: [] },
  },
  api_bases: { openai: 'https://api.openai.com/v1' },
  api_keys: { openai: 'sk-••••••••' },
};

export const mockTools: ToolInfo[] = [
  { name: 'read', description: 'Read a file from the workspace', enabled: true, icon: 'fa-file-lines' },
  { name: 'write', description: 'Create or overwrite a file', enabled: true, icon: 'fa-file-pen' },
  { name: 'edit', description: 'Replace text inside a file', enabled: true, icon: 'fa-pen-to-square' },
  { name: 'bash', description: 'Run a shell command', enabled: true, icon: 'fa-terminal' },
  { name: 'ls', description: 'List directory contents', enabled: true, icon: 'fa-folder-tree' },
  { name: 'web_search', description: 'Search the web', enabled: true, icon: 'fa-magnifying-glass' },
  { name: 'vision', description: 'Understand images', enabled: true, icon: 'fa-eye' },
  { name: 'memory', description: 'Read and write long-term memory', enabled: true, icon: 'fa-brain' },
];

export const mockSkills: SkillInfo[] = [
  {
    name: 'web-report',
    title: 'Web Report',
    description: 'Search the web and generate a visual HTML report.',
    enabled: true,
    version: '1.2.0',
    author: 'CowAgent',
    icon: 'fa-chart-line',
  },
  {
    name: 'pdf-tools',
    title: 'PDF Tools',
    description: 'Extract text and tables from PDF documents.',
    enabled: true,
    version: '0.9.1',
    author: 'community',
    icon: 'fa-file-pdf',
  },
  {
    name: 'scheduler-helper',
    title: 'Scheduler Helper',
    description: 'Create and manage scheduled reminders in natural language.',
    enabled: false,
    version: '0.4.0',
    author: 'community',
    icon: 'fa-clock',
  },
  {
    name: 'image-gen',
    title: 'Image Generation',
    description: 'Generate images from a prompt.',
    enabled: false,
    version: '1.0.0',
    author: 'CowAgent',
    icon: 'fa-image',
  },
];

export const mockMemoryFiles: MemoryFile[] = [
  { filename: 'MEMORY.md', type: 'global', size: 4210, updated_at: '2026-10-01 09:12' },
  { filename: '2026-10-03.md', type: 'daily', size: 1892, updated_at: '2026-10-03 22:41' },
  { filename: '2026-10-02.md', type: 'daily', size: 2340, updated_at: '2026-10-02 21:03' },
  { filename: 'dream-2026-09-30.md', type: 'dream', size: 980, updated_at: '2026-09-30 03:00' },
  { filename: 'evolution-2026-09-29.md', type: 'evolution', size: 1533, updated_at: '2026-09-29 18:20' },
];

export const mockMemoryContent = `# Long-term Memory

## User preferences
- Prefers concise, well-structured answers.
- Works primarily in Chinese and English.
- Interested in building agent applications.

## Ongoing projects
- **gopher-agent-console** — React rewrite of the CowAgent web console.
`;

export const mockKnowledge: KnowledgeListResult = {
  status: 'success',
  stats: { pages: 5, size: 20480 },
  root_files: [
    { name: 'index.md', title: 'Index', size: 1200, updated_at: '2026-10-01 10:00' },
  ],
  tree: [
    {
      dir: 'tech',
      title: 'Technology',
      files: [
        { name: 'react.md', title: 'React notes', size: 3200, updated_at: '2026-09-28 14:20' },
        { name: 'python-async.md', title: 'Python asyncio', size: 2600, updated_at: '2026-09-25 09:40' },
      ],
      children: [
        {
          dir: 'agents',
          title: 'Agents',
          files: [{ name: 'react-patterns.md', title: 'Agent design patterns', size: 4100, updated_at: '2026-10-02 16:10' }],
        },
      ],
    },
    {
      dir: 'life',
      title: 'Life',
      files: [{ name: 'reading.md', title: 'Reading list', size: 900, updated_at: '2026-09-20 20:00' }],
    },
  ],
};

export const mockKnowledgeContent = `# React notes

Hooks are functions that let you use state and other React features.

## useState
\`\`\`tsx
const [count, setCount] = useState(0);
\`\`\`

## useEffect runs after render and can subscribe to external systems.
`;

export const mockGraph: KnowledgeGraphResult = {
  status: 'success',
  nodes: [
    { id: 'index', label: 'Index', group: 'root' },
    { id: 'react', label: 'React notes', group: 'tech' },
    { id: 'asyncio', label: 'Python asyncio', group: 'tech' },
    { id: 'patterns', label: 'Agent patterns', group: 'tech' },
    { id: 'reading', label: 'Reading list', group: 'life' },
  ],
  links: [
    { source: 'index', target: 'react' },
    { source: 'index', target: 'asyncio' },
    { source: 'react', target: 'patterns' },
    { source: 'index', target: 'reading' },
  ],
};

export const mockChannels: ChannelInfo[] = [
  {
    name: 'web',
    label: { zh: '网页', en: 'Web' },
    active: true,
    configured: true,
    icon: 'fa-globe',
    color: 'primary',
    fields: [],
  },
  {
    name: 'feishu',
    label: { zh: '飞书', en: 'Feishu' },
    active: false,
    configured: false,
    icon: 'fa-comment-dots',
    color: 'blue',
    fields: [
      { key: 'app_id', label: 'App ID', type: 'text', value: '' },
      { key: 'app_secret', label: 'App Secret', type: 'secret', value: '' },
    ],
  },
  {
    name: 'weixin',
    label: { zh: '微信', en: 'WeChat' },
    active: false,
    configured: false,
    icon: 'fa-comment',
    color: 'emerald',
    login_status: 'logged_out',
    fields: [],
  },
];

export const mockTasks: ScheduledTask[] = [
  {
    id: 'task-daily-standup',
    name: 'Daily standup reminder',
    enabled: true,
    next_run_at: Date.now() + 1000 * 60 * 60 * 9,
    schedule: { type: 'cron', expression: '0 9 * * 1-5' },
    action: { type: 'send_message', channel_type: 'web', content: 'Time for standup!' },
  },
  {
    id: 'task-hourly-check',
    name: 'Hourly server check',
    enabled: true,
    next_run_at: Date.now() + 1000 * 60 * 42,
    schedule: { type: 'interval', seconds: 3600 },
    action: { type: 'agent_task', channel_type: 'web', task_description: 'Check server health and report anomalies.' },
  },
  {
    id: 'task-once',
    name: 'One-off reminder',
    enabled: false,
    next_run_at: Date.now() + 1000 * 60 * 60 * 24,
    schedule: { type: 'once', time: '2026-10-06T09:00:00' },
    action: { type: 'send_message', channel_type: 'web', content: 'Review the quarterly report.' },
  },
];

export const mockSessions: Session[] = [
  { session_id: 'session_demo_1', title: '前端 React 改造方案', updated_at: Date.now() - 1000 * 60 * 12, pinned: true, message_count: 8 },
  { session_id: 'session_demo_2', title: 'Build a visual report', updated_at: Date.now() - 1000 * 60 * 60 * 3, message_count: 14 },
  { session_id: 'session_demo_3', title: '知识库整理', updated_at: Date.now() - 1000 * 60 * 60 * 26, project_dir: 'E:/code/demo', project_name: 'demo', message_count: 5 },
  { session_id: 'session_demo_4', title: 'Weekly memory review', updated_at: Date.now() - 1000 * 60 * 60 * 72, message_count: 22 },
];

export const mockProjects = [
  { path: 'E:/code/demo', name: 'demo', session_count: 1 },
  { path: 'E:/code/CowAgent', name: 'CowAgent', session_count: 3 },
];

export const mockHistory: ChatMessage[] = [
  { seq: 1, role: 'user', content: '你好，帮我看看工作空间里有哪些文件？', timestamp: Date.now() - 1000 * 60 * 15 },
  {
    seq: 2,
    role: 'assistant',
    content: '好的，我先列出工作空间的内容。',
    timestamp: Date.now() - 1000 * 60 * 14,
    steps: [
      { type: 'tool', name: 'ls', args: { path: '.' }, result: 'docs/  src/  README.md', status: 'done' },
    ],
  },
  { seq: 3, role: 'user', content: '把 README 的核心内容总结一下。', timestamp: Date.now() - 1000 * 60 * 12 },
  {
    seq: 4,
    role: 'assistant',
    content:
      'README 主要包含三部分：\n\n1. **项目简介** — 一个本地优先的 AI Agent。\n2. **快速开始** — 安装依赖并运行 `python app.py`。\n3. **配置说明** — 通过 `config.json` 选择模型与通道。\n\n需要我展开其中某一部分吗？',
    timestamp: Date.now() - 1000 * 60 * 11,
  },
];

export const mockWorkspace: WorkspaceEntry[] = [
  { name: 'src', path: 'src', type: 'dir', kind: 'directory' },
  { name: 'docs', path: 'docs', type: 'dir', kind: 'directory' },
  { name: 'README.md', path: 'README.md', type: 'file', kind: 'markdown', size: 2100 },
  { name: 'app.py', path: 'app.py', type: 'file', kind: 'code', size: 320 },
  { name: 'logo.png', path: 'logo.png', type: 'file', kind: 'image', size: 18000 },
  { name: 'report.html', path: 'report.html', type: 'file', kind: 'html', size: 5400 },
];

export const mockWorkspaceFiles: Record<string, WorkspaceEntry[]> = {
  src: [
    { name: 'main.py', path: 'src/main.py', type: 'file', kind: 'code', size: 1200 },
    { name: 'utils.py', path: 'src/utils.py', type: 'file', kind: 'code', size: 800 },
  ],
  docs: [
    { name: 'guide.md', path: 'docs/guide.md', type: 'file', kind: 'markdown', size: 1400 },
    { name: 'design.pdf', path: 'docs/design.pdf', type: 'file', kind: 'pdf', size: 42000 },
  ],
};

export const mockPreviewContent: Record<string, string> = {
  'README.md': '# Gopher Agent\n\nA local-first AI agent.\n\n## Quick start\n\n```bash\npython app.py\n```\n',
  'app.py': 'def main():\n    print("hello from gopher agent")\n',
  'report.html': '<h1>Visual Report</h1><p>Generated by the mock API.</p>',
  'src/main.py': 'from utils import greet\n\n\ndef main():\n    greet("world")\n',
  'docs/guide.md': '# Guide\n\n1. Install\n2. Configure\n3. Run\n',
};

export const mockModels: ModelsResult = {
  status: 'success',
  providers: [
    {
      id: 'openai',
      label: 'OpenAI',
      configured: true,
      is_custom: false,
      api_key_field: 'open_ai_api_key',
      api_base_field: 'open_ai_api_base',
      api_key_masked: 'sk-••••••••',
      api_base: 'https://api.openai.com/v1',
      api_base_default: 'https://api.openai.com/v1',
      models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    },
    {
      id: 'deepseek',
      label: 'DeepSeek',
      configured: true,
      is_custom: false,
      api_key_masked: 'sk-••••••••',
      api_base: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
    },
    {
      id: 'claudeAPI',
      label: 'Claude',
      configured: false,
      is_custom: false,
      api_base: '',
      api_base_default: 'https://api.anthropic.com',
      models: ['claude-3-5-sonnet', 'claude-3-opus'],
    },
    {
      id: 'gemini',
      label: 'Gemini',
      configured: false,
      is_custom: false,
      api_base: '',
      models: ['gemini-2.0-flash', 'gemini-1.5-pro'],
    },
    {
      id: 'moonshot',
      label: 'Moonshot',
      configured: false,
      is_custom: false,
      models: ['moonshot-v1-8k'],
    },
    {
      id: 'zhipu',
      label: 'Zhipu',
      configured: false,
      is_custom: false,
      models: ['glm-4-plus'],
    },
    {
      id: 'custom',
      label: 'Custom',
      configured: false,
      is_custom: true,
      custom_id: 'custom:local',
      api_base: 'http://localhost:8000/v1',
      models: [],
    },
  ],
  capabilities: {
    chat: {
      editable: true,
      current_provider: 'openai',
      current_model: 'gpt-4o-mini',
      providers: ['openai', 'deepseek', 'claudeAPI', 'gemini', 'moonshot', 'zhipu', 'custom:local'],
    },
    vision: {
      editable: true,
      current_provider: 'openai',
      current_model: 'gpt-4o',
      providers: ['openai', 'claudeAPI', 'gemini', 'zhipu'],
    },
    image: {
      editable: true,
      current_provider: '',
      current_model: '',
      providers: ['openai', 'gemini'],
    },
    asr: {
      editable: true,
      current_provider: 'openai',
      current_model: 'whisper-1',
      providers: ['openai', 'dashscope'],
    },
    tts: {
      editable: true,
      current_provider: 'openai',
      current_model: 'tts-1',
      voice: 'alloy',
      voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
      providers: ['openai', 'minimax'],
    },
    embedding: {
      editable: true,
      current_provider: 'openai',
      current_model: 'text-embedding-3-small',
      providers: ['openai', 'zhipu', 'dashscope'],
    },
    search: {
      editable: true,
      strategy: 'auto',
      providers: ['bocha'],
    },
  },
};

/** A canned assistant reply streamed back by the mock chat endpoint. */
export const mockReply = `当然可以。下面是一个**示例回复**，用来演示流式渲染、Markdown 和工具调用步骤。

1. 首先我会分析你的需求；
2. 然后给出可执行的方案；
3. 最后附上一段代码。

\`\`\`tsx
export function Hello({ name }: { name: string }) {
  return <div>Hello, {name}!</div>;
}
\`\`\`

如果需要，我可以进一步展开任意一步。`;
