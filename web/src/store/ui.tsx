import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { App } from 'antd';
import type { ViewId } from '@/lib/constants';

export interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
  hideCancel?: boolean;
}

export interface PromptOptions {
  title: string;
  label?: string;
  initialValue?: string;
  placeholder?: string;
  okText?: string;
  cancelText?: string;
}

interface ModalState {
  confirm: ConfirmOptions | null;
  prompt: PromptOptions | null;
  resolve: ((value: unknown) => void) | null;
}

interface UIContextValue {
  view: ViewId;
  navigateTo: (view: ViewId) => void;
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  closeSidebar: () => void;
  sessionPanelOpen: boolean;
  toggleSessionPanel: () => void;
  closeSessionPanel: () => void;
  workspacePanelOpen: boolean;
  setWorkspacePanelOpen: (open: boolean) => void;
  toggleWorkspacePanel: () => void;
  toast: (message: string, kind?: Toast['kind']) => void;
  modal: ModalState;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  prompt: (opts: PromptOptions) => Promise<string | null>;
  resolveModal: (value: unknown) => void;
  dismissModal: () => void;
}

const UIContext = createContext<UIContextValue | null>(null);

const SESSION_PANEL_KEY = 'cow_session_panel_open';

export function UIProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<ViewId>('chat');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(() => {
    try {
      return localStorage.getItem(SESSION_PANEL_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [workspacePanelOpen, setWorkspacePanelOpenState] = useState(false);
  const [modal, setModal] = useState<ModalState>({ confirm: null, prompt: null, resolve: null });
  const { message } = App.useApp();

  const navigateTo = useCallback((next: ViewId) => {
    setView(next);
    setSidebarOpen(false);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  const toggleSessionPanel = useCallback(() => {
    setSessionPanelOpen((v) => {
      const next = !v;
      try {
        localStorage.setItem(SESSION_PANEL_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const closeSessionPanel = useCallback(() => {
    setSessionPanelOpen(false);
    try {
      localStorage.setItem(SESSION_PANEL_KEY, '0');
    } catch {
      /* ignore */
    }
  }, []);

  const setWorkspacePanelOpen = useCallback((open: boolean) => setWorkspacePanelOpenState(open), []);
  const toggleWorkspacePanel = useCallback(() => setWorkspacePanelOpenState((v) => !v), []);

  const toast = useCallback(
    (text: string, kind: Toast['kind'] = 'info') => {
      const show = kind === 'error' ? message.error : kind === 'success' ? message.success : message.info;
      show(text);
    },
    [message],
  );

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setModal({ confirm: opts, prompt: null, resolve: (v) => resolve(Boolean(v)) });
      }),
    [],
  );

  const prompt = useCallback(
    (opts: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setModal({ confirm: null, prompt: opts, resolve: (v) => resolve((v as string) ?? null) });
      }),
    [],
  );

  const resolveModal = useCallback((value: unknown) => {
    setModal((m) => {
      m.resolve?.(value);
      return { confirm: null, prompt: null, resolve: null };
    });
  }, []);

  const dismissModal = useCallback(() => {
    setModal((m) => {
      if (m.confirm) m.resolve?.(false);
      else m.resolve?.(null);
      return { confirm: null, prompt: null, resolve: null };
    });
  }, []);

  const value = useMemo<UIContextValue>(
    () => ({
      view,
      navigateTo,
      sidebarOpen,
      toggleSidebar,
      closeSidebar,
      sessionPanelOpen,
      toggleSessionPanel,
      closeSessionPanel,
      workspacePanelOpen,
      setWorkspacePanelOpen,
      toggleWorkspacePanel,
      toast,
      modal,
      confirm,
      prompt,
      resolveModal,
      dismissModal,
    }),
    [
      view,
      navigateTo,
      sidebarOpen,
      toggleSidebar,
      closeSidebar,
      sessionPanelOpen,
      toggleSessionPanel,
      closeSessionPanel,
      workspacePanelOpen,
      setWorkspacePanelOpen,
      toggleWorkspacePanel,
      toast,
      modal,
      confirm,
      prompt,
      resolveModal,
      dismissModal,
    ],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI must be used within a UIProvider');
  return ctx;
}
