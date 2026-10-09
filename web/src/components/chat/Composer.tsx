import { AppIcon } from '@/components/ui/AppIcon';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dropdown, Input, Tooltip, type MenuProps } from 'antd';
import type { TextAreaRef } from 'antd/es/input/TextArea';
import { api } from '@/api';
import type { CapabilityState, ProviderOverview } from '@/api/types';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useI18n } from '@/i18n/useI18n';
import { PERMISSION_META, SLASH_COMMANDS } from '@/lib/constants';
import { classNames } from '@/lib/format';
import type { PermissionMode } from '@/api/types';

const PERMISSION_ORDER: PermissionMode[] = ['read_only', 'workspace_write', 'full_access'];

/** Compact icon-only antd text button with a tooltip. */
function IconBtn({
  icon,
  title,
  onClick,
}: {
  icon: string;
  title: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip title={title}>
      <Button
        type="text"
        style={{ minWidth: 30, width: 30, height: 30, padding: 0, color: '#9a9892' }}
        onClick={onClick}
      >
        <AppIcon className={`fas ${icon}`} />
      </Button>
    </Tooltip>
  );
}

export function Composer() {
  const { t } = useI18n();
  const { toast, confirm } = useUI();
  const {
    draft,
    setDraft,
    sendMessage,
    cancel,
    steer,
    isSending,
    activeRequestId,
    attachments,
    uploadingCount,
    addFiles,
    removeAttachment,
    newChat,
    clearContext,
    permission,
    setPermission,
    sessionModel,
    setSessionModel,
    globalModel,
    clearSessionModel,
    sessionId,
    recentProjects,
    defaultWorkspace,
    currentProject,
    selectProject,
    createProject,
  } = useChat();

  const textareaRef = useRef<TextAreaRef>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [modelOptions, setModelOptions] = useState<{ provider: string; model: string; label: string }[]>([]);

  const slashItems = useMemo(() => {
    if (!draft.startsWith('/')) return [];
    const filter = draft.slice(1).toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.cmd.slice(1).toLowerCase().includes(filter));
  }, [draft]);

  const slashVisible = slashItems.length > 0 && !draft.includes('\n');

  const mentionQuery = useMemo(() => {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(draft);
    return match ? match[1] : null;
  }, [draft]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashVisible]);

  const pickSlash = (cmd: string) => {
    setDraft(cmd.endsWith(' ') ? cmd : `${cmd} `);
    textareaRef.current?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % slashItems.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length);
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        pickSlash(slashItems[slashIndex].cmd);
        return;
      }
      if (e.key === 'Escape') {
        setDraft('');
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !isSending) {
      e.preventDefault();
      void sendMessage();
    }
  };

  const loadModelOptions = async () => {
    if (modelOptions.length > 0) return;
    try {
      const data = await api.getModels();
      const cap: CapabilityState | undefined = data.capabilities.chat;
      const providers = (data.providers ?? []).filter(
        (p: ProviderOverview) => p.configured || p.is_custom,
      );
      const opts: { provider: string; model: string; label: string }[] = [];
      const providerIds = cap?.providers ?? [];
      for (const p of providers) {
        if (providerIds.length && !providerIds.includes(p.id)) continue;
        for (const model of p.models ?? []) {
          opts.push({
            provider: p.id,
            model,
            label: `${typeof p.label === 'string' ? p.label : p.id} · ${model}`,
          });
        }
      }
      setModelOptions(opts);
    } catch {
      /* ignore */
    }
  };

  const onNewProject = async () => {
    const name = window.prompt(t('ws_sel_new_placeholder'));
    if (name && name.trim() && !/[/\\]/.test(name)) await createProject(name.trim());
  };

  const runOptimize = async () => {
    if (!draft.trim()) {
      toast(t('optimize_empty'), 'error');
      return;
    }
    try {
      const res = await api.optimizePrompt(draft, 'zh');
      const optimized = res.optimized ?? res.message;
      if (optimized) setDraft(optimized);
    } catch {
      toast(t('optimize_error'), 'error');
    }
  };

  const onSteer = async () => {
    const text = draft.trim();
    if (!text) return;
    await steer(text);
    setDraft('');
  };

  const permLabel = permission === 'global' ? t('perm_full_access') : t(PERMISSION_META[permission].key);
  const modelLabel = sessionModel ? `${sessionModel.provider} · ${sessionModel.model}` : globalModel ? `${globalModel.provider} · ${globalModel.model}` : t('model_unset');

  const attachMenu: MenuProps = {
    items: [
      { key: 'file', icon: <AppIcon className="fas fa-file-arrow-up" />, label: t('attach_menu_file') },
      { key: 'folder', icon: <AppIcon className="fas fa-folder-plus" />, label: t('attach_menu_folder') },
    ],
    onClick: ({ key }) => {
      if (key === 'file') fileInputRef.current?.click();
      else if (key === 'folder') folderInputRef.current?.click();
    },
  };

  const wsMenu: MenuProps = {
    selectable: true,
    selectedKeys: [currentProject ?? '__default__'],
    items: [
      { key: '__default__', icon: <AppIcon className="fas fa-house" />, label: t('ws_default_workspace') },
      ...(recentProjects.length
        ? [
            { type: 'divider' as const },
            { key: '__recents__', disabled: true, label: t('ws_sel_recents') },
            ...recentProjects.map((p) => ({
              key: p.path,
              icon: <AppIcon className="fas fa-folder" />,
              label: (
                <div>
                  <div>{p.name}</div>
                  <div className="text-xs text-slate-400">{p.path}</div>
                </div>
              ),
            })),
          ]
        : []),
      { type: 'divider' as const },
      { key: '__new__', icon: <AppIcon className="fas fa-plus" />, label: t('ws_sel_new') },
      {
        key: '__note__',
        disabled: true,
        label: <span className="text-[10px] text-slate-400">{defaultWorkspace}</span>,
      },
    ],
    onClick: ({ key }) => {
      if (key === '__default__') void selectProject(undefined);
      else if (key === '__new__') void onNewProject();
      else if (!key.startsWith('__')) void selectProject(key);
    },
  };

  const permMenu: MenuProps = {
    selectable: true,
    selectedKeys: [permission],
    items: [
      { key: 'global', icon: <AppIcon className="fas fa-globe" />, label: t('perm_follow_global') },
      ...PERMISSION_ORDER.map((mode) => ({
        key: mode,
        icon: <AppIcon className={classNames('fas', PERMISSION_META[mode].icon)} />,
        label: (
          <div>
            <div>{t(PERMISSION_META[mode].key)}</div>
            <div className="text-xs text-slate-400">{t(PERMISSION_META[mode].descKey)}</div>
          </div>
        ),
      })),
    ],
    onClick: ({ key }) => {
      if (key === 'global') void setPermission('full_access');
      else void setPermission(key as PermissionMode);
    },
  };

  const modelMenu: MenuProps = {
    selectable: true,
    selectedKeys: [sessionModel ? `${sessionModel.provider}:${sessionModel.model}` : '__global__'],
    items: [
      {
        key: '__global__',
        icon: <AppIcon className="fas fa-globe" />,
        label: (
          <div>
            <div>{t('model_follow_global')}</div>
            {globalModel ? (
              <div className="text-xs text-slate-400">
                {globalModel.provider} · {globalModel.model}
              </div>
            ) : null}
          </div>
        ),
      },
      ...modelOptions.map((opt) => ({
        key: `${opt.provider}:${opt.model}`,
        icon: <AppIcon className="fas fa-microchip" />,
        label: (
          <div>
            <div>{opt.model}</div>
            <div className="text-xs text-slate-400">{opt.provider}</div>
          </div>
        ),
      })),
    ],
    onClick: ({ key }) => {
      if (key === '__global__') {
        void clearSessionModel();
        return;
      }
      const idx = key.indexOf(':');
      if (idx > 0) void setSessionModel(key.slice(0, idx), key.slice(idx + 1));
    },
  };

  return (
    <div className="flex-shrink-0 border-t border-slate-200 dark:border-white/10 bg-white dark:bg-[#1F1F1F] px-4 py-3">
      <div className="max-w-3xl mx-auto">
        <div className="composer-card">
          {attachments.length ? (
            <div className="attachment-preview">
              {attachments.map((att, i) => (
                <div key={att.id ?? i} className="att-chip">
                  <AppIcon className={classNames('fas mr-1', att.file_type === 'image' ? 'fa-image' : 'fa-file')} />
                  <span className="truncate max-w-[120px]">{att.file_name ?? att.name}</span>
                  {att._uploading ? <AppIcon className="fas fa-spinner fa-spin ml-1 text-[10px]" /> : null}
                  <button className="att-remove" onClick={() => removeAttachment(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <Input.TextArea
            ref={textareaRef}
            className="composer-textarea"
            autoSize={{ minRows: 1, maxRows: 10 }}
            value={draft}
            placeholder={t('input_placeholder')}
            style={{ border: 'none', background: 'transparent', boxShadow: 'none', padding: '2px 4px', resize: 'none' }}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setMentionOpen(false)}
          />

          <div className="composer-toolbar">
            <div className="composer-group">
              <IconBtn icon="fa-plus" title={t('tip_new_chat')} onClick={() => newChat()} />
              <IconBtn icon="fa-trash-can" title={t('tip_clear_context')} onClick={() => void clearContext()} />
              <Dropdown trigger={['click']} placement="topLeft" menu={attachMenu}>
                <Button
                  type="text"
                  title={t('tip_attach')}
                  style={{ minWidth: 30, width: 30, height: 30, padding: 0, color: '#9a9892' }}
                >
                  <AppIcon className="fas fa-paperclip" />
                </Button>
              </Dropdown>
              <span className="composer-divider" />
              <Dropdown trigger={['click']} placement="topLeft" menu={wsMenu}>
                <button type="button" className="composer-chip">
                  <AppIcon className="fas fa-folder-open" />
                  <span className="composer-chip-label">
                    {currentProject ? currentProject.split(/[\\/]/).pop() : t('ws_default_workspace')}
                  </span>
                  <AppIcon className="fas fa-chevron-down composer-chip-caret" />
                </button>
              </Dropdown>
              <Dropdown trigger={['click']} placement="topLeft" menu={permMenu}>
                <button type="button" className="composer-chip">
                  <AppIcon className="fas fa-shield-halved" />
                  <span className="composer-chip-label">{permLabel}</span>
                  <AppIcon className="fas fa-chevron-down composer-chip-caret" />
                </button>
              </Dropdown>
            </div>

            <div className="composer-group composer-group-end">
              <Dropdown
                trigger={['click']}
                placement="topRight"
                menu={modelMenu}
                onOpenChange={(open) => {
                  if (open) void loadModelOptions();
                }}
              >
                <button type="button" className="composer-chip">
                  <AppIcon className="fas fa-microchip" />
                  <span className="composer-chip-label max-w-[160px] truncate">{modelLabel}</span>
                  <AppIcon className="fas fa-chevron-down composer-chip-caret" />
                </button>
              </Dropdown>
              <IconBtn icon="fa-magic" title={t('optimize_idle_title')} onClick={() => void runOptimize()} />
              <IconBtn
                icon="fa-microphone"
                title={t('mic_idle_title')}
                onClick={() => toast('语音输入需连接真实后端（当前为 Mock）', 'info')}
              />
              {activeRequestId ? (
                <Tooltip title={t('steer_active')}>
                  <Button
                    style={{
                      width: 32,
                      height: 32,
                      padding: 0,
                      borderRadius: 9,
                      color: '#0958D9',
                      borderColor: '#91CAFF',
                      background: 'transparent',
                    }}
                    onClick={() => void onSteer()}
                  >
                    <AppIcon className="fas fa-arrow-turn-up text-sm" />
                  </Button>
                </Tooltip>
              ) : null}
              {isSending ? (
                <Tooltip title={t('tip_cancel')}>
                  <Button
                    danger
                    type="primary"
                    style={{ width: 32, height: 32, padding: 0, borderRadius: 9 }}
                    onClick={() => void cancel()}
                  >
                    <AppIcon className="fas fa-stop text-sm" />
                  </Button>
                </Tooltip>
              ) : (
                <Button
                  type="primary"
                  disabled={!draft.trim() || uploadingCount > 0}
                  style={{ width: 32, height: 32, padding: 0, borderRadius: 9 }}
                  onClick={() => void sendMessage()}
                >
                  <AppIcon className="fas fa-paper-plane text-sm" />
                </Button>
              )}
            </div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            className="hidden"
            multiple
            // @ts-expect-error non-standard directory attributes
            webkitdirectory=""
            directory=""
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />

          {slashVisible ? (
            <div className="slash-menu">
              {slashItems.map((cmd, i) => (
                <button
                  key={cmd.cmd}
                  type="button"
                  className={classNames('slash-menu-item w-full', i === slashIndex && 'active')}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pickSlash(cmd.cmd);
                  }}
                >
                  <AppIcon className={classNames('fas', cmd.icon)} />
                  <span className="font-mono">{cmd.cmd}</span>
                  <span className="text-slate-400 ml-2">{t(cmd.key)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="text-[11px] text-slate-400 dark:text-slate-600 mt-1.5 px-1 font-mono truncate">
          {sessionId}
        </div>
      </div>
    </div>
  );
}
