import { AppIcon } from '@/components/ui/AppIcon';
import { Button, Tooltip } from 'antd';
import type { ChatMessage } from '@/api/types';
import { backendUrl } from '@/api/client';
import { BrandMark } from '@/components/ui/BrandMark';
import { GlassSurface } from '@/components/ui/LiquidGlass';
import { useChat } from '@/store/chat';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from '@/store/ui';
import { useWorkspace } from '@/store/workspace';
import { classNames, formatTime } from '@/lib/format';
import { Markdown } from './Markdown';
import { ToolSteps } from './ToolSteps';

/** Normalise an image path/URL to a comparable workspace-relative key. */
function mediaKey(value: string): string {
  let u = (value || '').trim();
  const q = u.match(/[?&]path=([^&]+)/i);
  if (q) u = decodeURIComponent(q[1]);
  u = u.replace(/^https?:\/\/[^/]+/i, '');
  return u.replace(/\\/g, '/').replace(/^\/+/, '').toLowerCase();
}

/** Workspace image paths already embedded in a message's markdown. */
function embeddedImageKeys(content: string): Set<string> {
  const keys = new Set<string>();
  const re = /!\[[^\]]*\]\(\s*([^)\s]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) keys.add(mediaKey(m[1]));
  return keys;
}

function UserAttachments({ message }: { message: ChatMessage }) {
  const { openPreview } = useWorkspace();
  if (!message.attachments?.length) return null;
  return (
    <div className="user-msg-attachments">
      {message.attachments.map((att, i) => {
        const name = att.file_name ?? att.name ?? 'file';
        const isImage = att.file_type === 'image';
        const openable = att.file_type === 'workspace_ref' || att.is_dir;
        if (isImage) {
          return (
            <img
              key={i}
              src={att.url ?? `/api/file?path=${encodeURIComponent(att.file_path ?? att.path ?? '')}`}
              alt={name}
              className="user-msg-image"
            />
          );
        }
        return (
          <div
            key={i}
            className={classNames('user-msg-file', openable && 'is-openable')}
            onClick={openable ? () => void openPreview(att.file_path ?? att.path ?? '', name) : undefined}
          >
            <AppIcon className={classNames('fas', att.is_dir ? 'fa-folder' : att.file_type === 'video' ? 'fa-film' : 'fa-file-alt')} />
            {' '}
            {name}
          </div>
        );
      })}
    </div>
  );
}

export function UserMessage({ message }: { message: ChatMessage }) {
  const { editMessage, deleteMessages } = useChat();
  const { confirm, toast } = useUI();
  const { t } = useI18n();
  const { openPreview } = useWorkspace();

  const onEdit = () => {
    if (!message.seq) return;
    const next = window.prompt(t('edit_message'), message.content);
    if (next != null && next.trim() && next !== message.content) {
      void editMessage(message.seq, next);
    }
  };

  const onDelete = async () => {
    if (!message.seq) return;
    const ok = await confirm({ title: t('delete_message_title'), message: t('delete_message_confirm'), danger: true });
    if (ok) await deleteMessages([message.seq]);
  };

  return (
    <div className="flex justify-end px-4 sm:px-6 py-3 user-message-group">
      <div className="max-w-[75%] sm:max-w-[60%]">
        <GlassSurface
          className="bg-primary-500/80 text-white rounded-2xl px-4 py-2.5 text-sm leading-relaxed msg-content user-bubble"
          ring={14}
          pull={7}
          blur={10}
        >
          <UserAttachments message={message} />
          {message.content ? <Markdown content={message.content} /> : null}
        </GlassSurface>
        <div className="flex items-center justify-end gap-2 mt-1.5">
          <Tooltip title={t('edit_message')}>
            <Button
              type="text"
              size="small"
              className="edit-msg-btn"
              style={{ height: 'auto', padding: 2 }}
              onClick={onEdit}
            >
              <AppIcon className="fas fa-pen-to-square" />
            </Button>
          </Tooltip>
          <Tooltip title={t('delete_message_title')}>
            <Button
              type="text"
              size="small"
              className="delete-msg-btn"
              style={{ height: 'auto', padding: 2 }}
              onClick={onDelete}
            >
              <AppIcon className="fas fa-trash" />
            </Button>
          </Tooltip>
          <span className="text-xs text-slate-400 dark:text-slate-500">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

export function AssistantMessage({
  message,
  streaming = false,
}: {
  message: ChatMessage;
  streaming?: boolean;
}) {
  const { t } = useI18n();
  const { openPreview } = useWorkspace();
  const hasBody = message.content || message.steps?.length || streaming;
  // Skip gallery images that the reply already embeds in its markdown, so the
  // same generated picture is never shown twice.
  const embedded = embeddedImageKeys(message.content || '');
  const media = (message.media ?? []).filter((m) => {
    const key = mediaKey(m.path || m.url || '');
    return !key || !embedded.has(key);
  });
  return (
    <div className="flex gap-3 px-4 sm:px-6 py-3 bot-message-group">
      <BrandMark className="w-8 h-8" />
      <div className="min-w-0 flex-1 max-w-[85%]">
        <div className="bg-gradient-to-b from-white/65 to-white/45 dark:from-[#1A1A1A]/60 dark:to-[#1A1A1A]/45 border border-slate-200/70 dark:border-white/10 rounded-2xl px-4 py-3 text-sm leading-relaxed msg-content text-slate-700 dark:text-slate-200 shadow-sm">
          <ToolSteps reason={message.thinking} steps={message.steps} />
          {hasBody ? (
            streaming && !message.content ? (
              <div className="flex items-center gap-1.5 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse-dot" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse-dot [animation-delay:0.2s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-primary-400 animate-pulse-dot [animation-delay:0.4s]" />
              </div>
            ) : (
              <Markdown content={message.content} className={streaming ? 'sse-streaming' : ''} />
            )
          ) : null}
          {message.content ? (
            <div className="flex items-center gap-2 mt-1.5">
              <Tooltip title="Copy">
                <Button
                  type="text"
                  size="small"
                  style={{ height: 'auto', padding: 2 }}
                  onClick={() => void navigator.clipboard.writeText(message.content)}
                >
                  <AppIcon className="fas fa-copy" />
                </Button>
              </Tooltip>
              <Tooltip title={t('speak_msg')}>
                <Button
                  type="text"
                  size="small"
                  className="speak-msg-btn"
                  style={{ height: 'auto', padding: 2 }}
                >
                  <AppIcon className="fas fa-volume-up" />
                </Button>
              </Tooltip>
            </div>
          ) : null}
        </div>
        {media.length ? (
          <div className="assistant-media">
            {media.map((m, i) => {
              const src = backendUrl(m.url ?? '');
              if (!src) return null;
              if (m.type === 'image') {
                return (
                  <a key={i} href={src} target="_blank" rel="noopener noreferrer">
                    <img
                      src={src}
                      alt={m.name || 'generated image'}
                      className="assistant-media-img"
                    />
                  </a>
                );
              }
              return (
                <a
                  key={i}
                  href={src}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="assistant-media-file"
                >
                  <AppIcon className="fas fa-file-lines mr-1" />
                  {m.name || 'file'}
                </a>
              );
            })}
          </div>
        ) : null}
        {message.attachments?.length ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.attachments.map((att, i) => (
              <Button
                key={i}
                type="link"
                size="small"
                style={{ padding: 0, height: 'auto' }}
                onClick={() => void openPreview(att.file_path ?? att.path ?? '', att.file_name ?? att.name)}
              >
                <AppIcon className="fas fa-file-lines mr-1" /> {att.file_name ?? att.name}
              </Button>
            ))}
          </div>
        ) : null}
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-xs text-slate-400 dark:text-slate-500">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    </div>
  );
}

export function ContextDivider({ message }: { message: ChatMessage }) {
  return (
    <div className="flex items-center justify-center py-3 px-6">
      <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
        <span className="h-px w-8 bg-slate-200 dark:bg-white/10" />
        {message.content}
        <span className="h-px w-8 bg-slate-200 dark:bg-white/10" />
      </div>
    </div>
  );
}
