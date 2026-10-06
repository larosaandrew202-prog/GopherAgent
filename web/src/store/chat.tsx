import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/api';
import type {
  Attachment,
  ChatMessage,
  MediaItem,
  PermissionMode,
  Session,
  SessionProject,
  StreamEvent,
  StreamSubscription,
  ToolStep,
} from '@/api/types';
import { generateSessionId } from '@/lib/format';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from './ui';

const SESSION_ID_KEY = 'cow_session_id';

function loadOrCreateSessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
  } catch {
    /* ignore */
  }
  const created = generateSessionId();
  try {
    localStorage.setItem(SESSION_ID_KEY, created);
  } catch {
    /* ignore */
  }
  return created;
}

export type { MediaItem } from '@/api/types';

export interface StreamingState {
  requestId: string;
  content: string;
  reasoning: string;
  steps: ToolStep[];
  media: MediaItem[];
  startedAt: number;
}

interface ChatContextValue {
  sessionId: string;
  messages: ChatMessage[];
  streaming: StreamingState | null;
  isSending: boolean;
  hasMoreHistory: boolean;
  historyLoading: boolean;

  draft: string;
  setDraft: (value: string) => void;
  attachments: Attachment[];
  uploadingCount: number;
  addFiles: (files: FileList | File[]) => Promise<void>;
  removeAttachment: (index: number) => void;
  clearAttachments: () => void;

  sendMessage: (text?: string, isVoice?: boolean) => Promise<void>;
  cancel: () => Promise<void>;
  steer: (text: string) => Promise<void>;
  newChat: (activate?: boolean) => void;
  switchSession: (id: string) => Promise<void>;
  clearContext: () => Promise<void>;
  editMessage: (seq: number, content: string) => Promise<void>;
  regenerate: (seq: number) => Promise<void>;
  deleteMessages: (seqs: number[]) => Promise<void>;
  loadMoreHistory: () => Promise<void>;

  sessions: Session[];
  projects: SessionProject[];
  sessionsLoading: boolean;
  sessionsHasMore: boolean;
  loadSessions: (reset?: boolean) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;

  permission: PermissionMode | 'global';
  sessionModel: { provider: string; model: string } | null;
  globalPermission: PermissionMode;
  globalModel: { provider: string; model: string } | null;
  setPermission: (mode: PermissionMode) => Promise<void>;
  setSessionModel: (provider: string, model: string) => Promise<void>;
  clearSessionModel: () => Promise<void>;

  currentProject: string | null;
  recentProjects: SessionProject[];
  defaultWorkspace: string;
  projectsRoot: string;
  selectProject: (path?: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  refreshProjects: () => Promise<void>;
  activeRequestId: string | null;
}

const ChatContext = createContext<ChatContextValue | null>(null);

const HISTORY_PAGE_SIZE = 20;

export function ChatProvider({ children }: { children: ReactNode }) {
  const { lang, t } = useI18n();
  const { toast } = useUI();

  const [sessionId, setSessionId] = useState<string>(loadOrCreateSessionId);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [historyPage, setHistoryPage] = useState(0);
  const [hasMoreHistory, setHasMoreHistory] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [projects, setProjects] = useState<SessionProject[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsHasMore, setSessionsHasMore] = useState(false);
  const sessionsPage = useRef(1);

  const [permission, setPermissionState] = useState<PermissionMode | 'global'>('global');
  const [sessionModel, setSessionModelState] = useState<{ provider: string; model: string } | null>(null);
  const [globalPermission, setGlobalPermission] = useState<PermissionMode>('full_access');
  const [globalModel, setGlobalModel] = useState<{ provider: string; model: string } | null>(null);

  const [currentProject, setCurrentProject] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<SessionProject[]>([]);
  const [defaultWorkspace, setDefaultWorkspace] = useState('');
  const [projectsRoot, setProjectsRoot] = useState('');

  const subRef = useRef<StreamSubscription | null>(null);
  const bufRef = useRef<StreamingState | null>(null);

  /* ------------------------------------------------------------- helpers */

  const finalizeStream = useCallback((sid: string, fallbackText = '') => {
    const buf = bufRef.current;
    subRef.current?.close();
    subRef.current = null;
    bufRef.current = null;
    if (buf) {
      const content = buf.content || fallbackText;
      if (content || buf.steps.length || buf.media.length) {
        const finalMsg: ChatMessage = {
          role: 'assistant',
          content,
          timestamp: Date.now(),
          requestId: buf.requestId,
          steps: buf.steps.length ? buf.steps : undefined,
          thinking: buf.reasoning || undefined,
          media: buf.media.length ? buf.media : undefined,
        };
        if (sessionIdRef.current === sid) setMessages((m) => [...m, finalMsg]);
      }
    }
    setStreaming(null);
    setActiveRequestId(null);
    setIsSending(false);
  }, []);

  const handleStreamEvent = useCallback(
    (sid: string, event: StreamEvent) => {
      const buf = bufRef.current;
      if (!buf) return;
      switch (event.type) {
        case 'reasoning':
          buf.reasoning += event.content ?? '';
          break;
        case 'delta':
        case 'text':
          buf.content += event.content ?? '';
          break;
        case 'message_end':
          break;
        case 'tool_start': {
          buf.steps.push({
            type: 'tool',
            name: (event.name as string) ?? 'tool',
            tool_call_id: event.tool_call_id as string,
            args: event.args,
            status: 'running',
          });
          break;
        }
        case 'tool_progress': {
          const step = buf.steps.find((s) => s.tool_call_id === event.tool_call_id);
          if (step) step.result = event.content;
          break;
        }
        case 'tool_end': {
          const step = buf.steps.find((s) => s.tool_call_id === event.tool_call_id);
          if (step) {
            step.status = (event.status as ToolStep['status']) ?? 'done';
            step.result = event.result ?? step.result;
          }
          break;
        }
        case 'subagent_step':
          buf.steps.push({ type: 'tool', name: (event.name as string) ?? 'subagent', result: event, status: 'done' });
          break;
        case 'tool_media': {
          const list = Array.isArray(event.media) ? (event.media as Array<Record<string, unknown>>) : [];
          for (const m of list) {
            buf.media.push({
              type: (m.type as MediaItem['type']) ?? 'image',
              url: (m.url as string) ?? '',
              path: (m.path as string) ?? '',
              mime: (m.mime as string) ?? '',
              name: (m.name as string) ?? '',
            });
          }
          break;
        }
        case 'image':
        case 'video':
        case 'file':
          buf.media.push({
            type: event.type as MediaItem['type'],
            url: (event.url as string) ?? (event.path as string) ?? '',
            name: (event.name as string) ?? (event.file_name as string),
          });
          break;
        case 'done': {
          // The backend sends the authoritative final text with only the images
          // generated in this turn. Use it so any stale image the model echoed
          // from history disappears once the turn completes.
          const finalText = (event.content as string) ?? '';
          if (finalText) buf.content = finalText;
          finalizeStream(sid, buf.content);
          return;
        }
        case 'cancelled':
          finalizeStream(sid, buf.content || t('tip_cancelled'));
          return;
        case 'error':
          toast((event.message as string) || t('error_send'), 'error');
          finalizeStream(sid, buf.content);
          return;
        case 'stream_end':
          finalizeStream(sid, buf.content);
          return;
        default:
          break;
      }
      if (sessionIdRef.current === sid) {
        setStreaming({ ...buf, steps: [...buf.steps], media: [...buf.media] });
      }
    },
    [finalizeStream, t, toast],
  );

  const startStream = useCallback(
    (requestId: string, sid: string) => {
      const initial: StreamingState = {
        requestId,
        content: '',
        reasoning: '',
        steps: [],
        media: [],
        startedAt: Date.now(),
      };
      bufRef.current = initial;
      setStreaming(initial);
      setActiveRequestId(requestId);
      subRef.current = api.streamChat(
        requestId,
        (event) => handleStreamEvent(sid, event),
        (err) => {
          if (err) toast(t('error_send'), 'error');
          finalizeStream(sid);
        },
      );
    },
    [handleStreamEvent, finalizeStream, toast, t],
  );

  /* -------------------------------------------------------- chat actions */

  const sendMessage = useCallback(
    async (textArg?: string, isVoice = false) => {
      const text = (textArg ?? draft).trim();
      if (!text || isSending) return;
      const sid = sessionIdRef.current;
      const atts = attachments.filter((a) => !a._uploading);
      const userMsg: ChatMessage = {
        role: 'user',
        content: text,
        timestamp: Date.now(),
        attachments: atts.length ? atts : undefined,
      };
      setMessages((m) => [...m, userMsg]);
      setDraft('');
      setAttachments([]);
      setIsSending(true);
      try {
        const res = await api.sendMessage({
          session_id: sid,
          message: text,
          attachments: atts,
          stream: true,
          is_voice: isVoice,
          lang,
        });
        if (res.inline_reply) {
          setMessages((m) => [...m, { role: 'assistant', content: res.inline_reply as string, timestamp: Date.now() }]);
          setIsSending(false);
          return;
        }
        if (res.request_id) startStream(res.request_id, sid);
        else setIsSending(false);
      } catch {
        toast(t('error_send'), 'error');
        setIsSending(false);
      }
    },
    [draft, isSending, attachments, lang, startStream, toast, t],
  );

  const cancel = useCallback(async () => {
    try {
      await api.cancel(activeRequestId ?? undefined);
    } finally {
      subRef.current?.close();
      finalizeStream(sessionIdRef.current, bufRef.current?.content ?? t('tip_cancelled'));
    }
  }, [activeRequestId, finalizeStream, t]);

  const steer = useCallback(
    async (text: string) => {
      const sid = sessionIdRef.current;
      try {
        const res = await api.steer(text, sid);
        if (res.inline_reply) toast(res.inline_reply, 'success');
      } catch {
        toast(t('error_send'), 'error');
      }
    },
    [toast, t],
  );

  const loadHistory = useCallback(
    async (sid: string, page: number) => {
      setHistoryLoading(true);
      try {
        const data = await api.history(sid, page, HISTORY_PAGE_SIZE);
        const list = [...(data.messages ?? [])].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
        setMessages((prev) => (page === 1 ? list : [...list, ...prev]));
        setHistoryPage(page);
        setHasMoreHistory(Boolean(data.has_more));
      } catch {
        /* ignore */
      } finally {
        setHistoryLoading(false);
      }
    },
    [],
  );

  const switchSession = useCallback(
    async (id: string) => {
      if (id === sessionIdRef.current) return;
      subRef.current?.close();
      subRef.current = null;
      bufRef.current = null;
      setStreaming(null);
      setActiveRequestId(null);
      setMessages([]);
      setSessionId(id);
      sessionIdRef.current = id;
      try {
        localStorage.setItem(SESSION_ID_KEY, id);
      } catch {
        /* ignore */
      }
      await loadHistory(id, 1);
      try {
        const settings = await api.getSessionSettings(id);
        setPermissionState(settings.permission ?? 'global');
        setSessionModelState(settings.model ?? null);
      } catch {
        /* ignore */
      }
    },
    [loadHistory],
  );

  const newChat = useCallback(
    (activate = true) => {
      const sid = generateSessionId();
      subRef.current?.close();
      subRef.current = null;
      bufRef.current = null;
      setStreaming(null);
      setActiveRequestId(null);
      setMessages([]);
      setSessionId(sid);
      sessionIdRef.current = sid;
      try {
        localStorage.setItem(SESSION_ID_KEY, sid);
      } catch {
        /* ignore */
      }
      setPermissionState('global');
      setSessionModelState(null);
      if (activate) void loadHistory(sid, 1);
    },
    [loadHistory],
  );

  const clearContext = useCallback(async () => {
    const sid = sessionIdRef.current;
    await api.clearContext(sid);
    setMessages((m) => [
      ...m,
      { role: 'system', content: t('context_cleared'), timestamp: Date.now(), divider: true },
    ]);
  }, [t]);

  const editMessage = useCallback(
    async (seq: number, content: string) => {
      const sid = sessionIdRef.current;
      setMessages((m) => m.filter((msg) => (msg.seq ?? 0) <= seq - 1));
      await api.deleteMessages(sid, { seqs: messages.filter((msg) => (msg.seq ?? 0) >= seq).map((msg) => msg.seq ?? 0) });
      await sendMessage(content);
    },
    [messages, sendMessage],
  );

  const regenerate = useCallback(
    async (seq: number) => {
      const sid = sessionIdRef.current;
      await api.deleteMessages(sid, { seqs: [seq] });
      setMessages((m) => m.filter((msg) => msg.seq !== seq));
      await sendMessage(t('regenerate_response'));
    },
    [sendMessage, t],
  );

  const deleteMessages = useCallback(async (seqs: number[]) => {
    const sid = sessionIdRef.current;
    await api.deleteMessages(sid, { seqs });
    setMessages((m) => m.filter((msg) => !msg.seq || !seqs.includes(msg.seq)));
  }, []);

  const loadMoreHistory = useCallback(async () => {
    if (historyLoading || !hasMoreHistory) return;
    await loadHistory(sessionIdRef.current, historyPage + 1);
  }, [historyLoading, hasMoreHistory, historyPage, loadHistory]);

  /* ------------------------------------------------------ session list */

  const loadSessions = useCallback(
    async (reset = false) => {
      setSessionsLoading(true);
      try {
        const page = reset ? 1 : sessionsPage.current;
        const data = await api.listSessions(page, 50);
        const list = data.sessions ?? [];
        setSessions((prev) => (reset ? list : [...prev, ...list]));
        setProjects(data.projects ?? []);
        setSessionsHasMore(Boolean(data.has_more));
        sessionsPage.current = page + 1;
      } catch {
        /* ignore */
      } finally {
        setSessionsLoading(false);
      }
    },
    [],
  );

  const renameSession = useCallback(
    async (id: string, title: string) => {
      await api.updateSession(id, { title });
      setSessions((list) => list.map((s) => (s.session_id === id ? { ...s, title } : s)));
    },
    [],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await api.deleteSession(id);
      setSessions((list) => list.filter((s) => s.session_id !== id));
      if (id === sessionIdRef.current) newChat();
    },
    [newChat],
  );

  const togglePin = useCallback(
    async (id: string) => {
      const session = sessions.find((s) => s.session_id === id);
      const pinned = !session?.pinned;
      await api.updateSession(id, { pinned });
      setSessions((list) => list.map((s) => (s.session_id === id ? { ...s, pinned } : s)));
    },
    [sessions],
  );

  /* --------------------------------------------------------- settings */

  const setPermission = useCallback(async (mode: PermissionMode) => {
    const sid = sessionIdRef.current;
    setPermissionState(mode);
    try {
      await api.updateSessionSettings(sid, { permission: mode });
    } catch {
      setPermissionState('global');
    }
  }, []);

  const setSessionModel = useCallback(async (provider: string, model: string) => {
    const sid = sessionIdRef.current;
    setSessionModelState({ provider, model });
    try {
      await api.updateSessionSettings(sid, { model: { provider, model } });
    } catch {
      setSessionModelState(null);
    }
  }, []);

  const clearSessionModel = useCallback(async () => {
    const sid = sessionIdRef.current;
    setSessionModelState(null);
    try {
      await api.updateSessionSettings(sid, { model: null });
    } catch {
      /* ignore */
    }
  }, []);

  /* --------------------------------------------------------- projects */

  const refreshProjects = useCallback(async () => {
    try {
      const data = await api.projects(sessionIdRef.current);
      setCurrentProject(data.current ?? null);
      setRecentProjects(data.recents ?? data.projects ?? []);
      setDefaultWorkspace(data.default_workspace ?? '');
      setProjectsRoot(data.projects_root ?? '');
    } catch {
      /* ignore */
    }
  }, []);

  const selectProject = useCallback(
    async (path?: string) => {
      await api.selectProject({ session: sessionIdRef.current, project_dir: path });
      setCurrentProject(path ?? null);
      await refreshProjects();
    },
    [refreshProjects],
  );

  const createProject = useCallback(
    async (name: string) => {
      const res = await api.createProject({ session: sessionIdRef.current, name });
      if (res.path) {
        setCurrentProject(res.path);
        await refreshProjects();
      }
    },
    [refreshProjects],
  );

  /* ------------------------------------------------------- attachments */

  const addFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const files = Array.from(fileList);
      if (!files.length) return;
      const placeholders: Attachment[] = files.map((file) => ({
        id: `${file.name}-${Math.random().toString(36).slice(2, 7)}`,
        file_name: file.name,
        name: file.name,
        file_type: file.type.startsWith('image/') ? 'image' : 'file',
        size: file.size,
        _uploading: true,
      }));
      setAttachments((a) => [...a, ...placeholders]);
      setUploadingCount((c) => c + 1);
      try {
        const form = new FormData();
        files.forEach((f) => form.append('files', f));
        const res = await api.upload(form);
        setAttachments((a) =>
          a.map((item) => {
            const placeholder = placeholders.find((p) => p.id === item.id);
            if (!placeholder) return item;
            const uploaded = res.files?.find((f) => (f.file_name ?? '') === item.file_name);
            return uploaded ? { ...uploaded, id: item.id } : { ...item, _uploading: false };
          }),
        );
      } catch {
        setAttachments((a) => a.filter((item) => !placeholders.some((p) => p.id === item.id)));
        toast(t('error_send'), 'error');
      } finally {
        setUploadingCount((c) => Math.max(0, c - 1));
      }
    },
    [toast, t],
  );

  const removeAttachment = useCallback((index: number) => {
    setAttachments((a) => a.filter((_, i) => i !== index));
  }, []);

  const clearAttachments = useCallback(() => setAttachments([]), []);

  /* ----------------------------------------------------------- bootstrap */

  useEffect(() => {
    void loadHistory(sessionIdRef.current, 1);
    void api
      .getSessionSettings(sessionIdRef.current)
      .then((settings) => {
        setPermissionState(settings.permission ?? 'global');
        setSessionModelState(settings.model ?? null);
        setGlobalPermission(settings.global_permission ?? 'full_access');
        setGlobalModel(settings.global_model ?? null);
      })
      .catch(() => {});
    void refreshProjects();
  }, [loadHistory, refreshProjects]);

  const value = useMemo<ChatContextValue>(
    () => ({
      sessionId,
      messages,
      streaming,
      isSending,
      hasMoreHistory,
      historyLoading,
      draft,
      setDraft,
      attachments,
      uploadingCount,
      addFiles,
      removeAttachment,
      clearAttachments,
      sendMessage,
      cancel,
      steer,
      newChat,
      switchSession,
      clearContext,
      editMessage,
      regenerate,
      deleteMessages,
      loadMoreHistory,
      sessions,
      projects,
      sessionsLoading,
      sessionsHasMore,
      loadSessions,
      renameSession,
      deleteSession,
      togglePin,
      permission,
      sessionModel,
      globalPermission,
      globalModel,
      setPermission,
      setSessionModel,
      clearSessionModel,
      currentProject,
      recentProjects,
      defaultWorkspace,
      projectsRoot,
      selectProject,
      createProject,
      refreshProjects,
      activeRequestId,
    }),
    [
      sessionId,
      messages,
      streaming,
      isSending,
      hasMoreHistory,
      historyLoading,
      draft,
      attachments,
      uploadingCount,
      addFiles,
      removeAttachment,
      clearAttachments,
      sendMessage,
      cancel,
      steer,
      newChat,
      switchSession,
      clearContext,
      editMessage,
      regenerate,
      deleteMessages,
      loadMoreHistory,
      sessions,
      projects,
      sessionsLoading,
      sessionsHasMore,
      loadSessions,
      renameSession,
      deleteSession,
      togglePin,
      permission,
      sessionModel,
      globalPermission,
      globalModel,
      setPermission,
      setSessionModel,
      clearSessionModel,
      currentProject,
      recentProjects,
      defaultWorkspace,
      projectsRoot,
      selectProject,
      createProject,
      refreshProjects,
      activeRequestId,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within a ChatProvider');
  return ctx;
}
