/* Shared constants ported from console.js. */
import type { FileKind, PermissionMode } from '@/api/types';
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  Brain,
  CalendarDays,
  Cog,
  MessagesSquare,
  Terminal,
  WandSparkles,
  Wifi,
} from 'lucide-react';

export type ViewId =
  | 'chat'
  | 'config'
  | 'skills'
  | 'memory'
  | 'knowledge'
  | 'channels'
  | 'tasks'
  | 'logs';

export interface ViewMeta {
  id: ViewId;
  group: 'chat' | 'manage' | 'monitor';
  icon: LucideIcon;
  groupKey: string;
  labelKey: string;
}

/*
 * Sidebar icons use the same lucide-react set as QwenPaw's console. Where
 * QwenPaw has an equivalent entry we reuse its exact icon:
 *   chat → MessagesSquare (QwenPaw "sessions"), skills → WandSparkles,
 *   channels → Wifi, tasks → CalendarDays, config → Cog.
 * memory / knowledge / logs have no QwenPaw counterpart, so they use the
 * closest lucide glyph (Brain / BookOpen / Terminal).
 */
export const VIEW_META: Record<ViewId, ViewMeta> = {
  chat: { id: 'chat', group: 'chat', icon: MessagesSquare, groupKey: 'nav_chat', labelKey: 'menu_chat' },
  config: { id: 'config', group: 'manage', icon: Cog, groupKey: 'nav_manage', labelKey: 'menu_config' },
  skills: { id: 'skills', group: 'manage', icon: WandSparkles, groupKey: 'nav_manage', labelKey: 'menu_skills' },
  memory: { id: 'memory', group: 'manage', icon: Brain, groupKey: 'nav_manage', labelKey: 'menu_memory' },
  knowledge: { id: 'knowledge', group: 'manage', icon: BookOpen, groupKey: 'nav_manage', labelKey: 'menu_knowledge' },
  channels: { id: 'channels', group: 'manage', icon: Wifi, groupKey: 'nav_manage', labelKey: 'menu_channels' },
  tasks: { id: 'tasks', group: 'manage', icon: CalendarDays, groupKey: 'nav_manage', labelKey: 'menu_tasks' },
  logs: { id: 'logs', group: 'monitor', icon: Terminal, groupKey: 'nav_monitor', labelKey: 'menu_logs' },
};

export const SIDEBAR_GROUPS: { key: 'chat' | 'manage' | 'monitor'; labelKey: string; views: ViewId[] }[] = [
  { key: 'chat', labelKey: 'nav_chat', views: ['chat'] },
  { key: 'manage', labelKey: 'nav_manage', views: ['config', 'skills', 'memory', 'knowledge', 'channels', 'tasks'] },
  { key: 'monitor', labelKey: 'nav_monitor', views: ['logs'] },
];

export interface PermissionMeta {
  key: string;
  descKey: string;
  icon: string;
}

export const PERMISSION_META: Record<PermissionMode, PermissionMeta> = {
  read_only: { key: 'perm_read_only', descKey: 'perm_read_only_desc', icon: 'fa-eye' },
  workspace_write: { key: 'perm_workspace_write', descKey: 'perm_workspace_write_desc', icon: 'fa-folder-open' },
  full_access: { key: 'perm_full_access', descKey: 'perm_full_access_desc', icon: 'fa-shield-halved' },
};

export interface SlashCommand {
  cmd: string;
  key: string;
  icon: string;
  insert?: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/help', key: 'slash_help', icon: 'fa-circle-question' },
  { cmd: '/status', key: 'slash_status', icon: 'fa-signal' },
  { cmd: '/context', key: 'slash_context', icon: 'fa-layer-group' },
  { cmd: '/context clear', key: 'slash_context_clear', icon: 'fa-eraser' },
  { cmd: '/compact', key: 'slash_compact', icon: 'fa-compress' },
  { cmd: '/skill list', key: 'slash_skill_list', icon: 'fa-puzzle-piece' },
  { cmd: '/skill list --remote', key: 'slash_skill_list_remote', icon: 'fa-cloud' },
  { cmd: '/skill search ', key: 'slash_skill_search', icon: 'fa-magnifying-glass' },
  { cmd: '/skill install ', key: 'slash_skill_install', icon: 'fa-download' },
  { cmd: '/skill uninstall ', key: 'slash_skill_uninstall', icon: 'fa-trash' },
  { cmd: '/skill info ', key: 'slash_skill_info', icon: 'fa-circle-info' },
  { cmd: '/skill enable ', key: 'slash_skill_enable', icon: 'fa-toggle-on' },
  { cmd: '/skill disable ', key: 'slash_skill_disable', icon: 'fa-toggle-off' },
  { cmd: '/memory dream', key: 'slash_memory_dream', icon: 'fa-seedling' },
  { cmd: '/knowledge', key: 'slash_knowledge', icon: 'fa-book' },
  { cmd: '/knowledge list', key: 'slash_knowledge_list', icon: 'fa-folder-tree' },
  { cmd: '/knowledge on', key: 'slash_knowledge_on', icon: 'fa-toggle-on' },
  { cmd: '/knowledge off', key: 'slash_knowledge_off', icon: 'fa-toggle-off' },
  { cmd: '/config', key: 'slash_config', icon: 'fa-sliders' },
  { cmd: '/cancel', key: 'slash_cancel', icon: 'fa-ban' },
  { cmd: '/steer ', key: 'slash_steer', icon: 'fa-arrow-turn-up' },
  { cmd: '/logs', key: 'slash_logs', icon: 'fa-terminal' },
  { cmd: '/version', key: 'slash_version', icon: 'fa-code-branch' },
];

export const WS_KIND_ICONS: Record<FileKind, string> = {
  directory: 'fa-folder',
  html: 'fa-file-code',
  markdown: 'fa-file-lines',
  image: 'fa-file-image',
  video: 'fa-file-video',
  audio: 'fa-file-audio',
  pdf: 'fa-file-pdf',
  csv: 'fa-file-csv',
  code: 'fa-file-code',
  office: 'fa-file-word',
  text: 'fa-file-lines',
  file: 'fa-file',
};

const WS_KIND_BY_EXT: Record<string, FileKind> = (() => {
  const map: Record<string, FileKind> = {};
  const groups: [FileKind, string[]][] = [
    ['html', ['html', 'htm']],
    ['markdown', ['md', 'markdown']],
    ['image', ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']],
    ['video', ['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v']],
    ['audio', ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']],
    ['pdf', ['pdf']],
    ['csv', ['csv', 'tsv']],
    ['code', ['py', 'js', 'ts', 'tsx', 'jsx', 'java', 'c', 'cpp', 'h', 'go', 'rs', 'rb', 'php', 'sh', 'sql', 'css', 'scss', 'json', 'yaml', 'yml', 'xml', 'toml', 'ini']],
    ['text', ['txt', 'log']],
    ['office', ['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx']],
  ];
  for (const [kind, exts] of groups) for (const ext of exts) map[ext] = kind;
  return map;
})();

export function fileKind(name: string): FileKind {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return WS_KIND_BY_EXT[ext] || 'file';
}

export const COMPOSER_MIN_H = 52;
export const COMPOSER_MAX_H = 220;
