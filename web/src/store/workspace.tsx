import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/api';
import type { FileKind, WorkspaceEntry } from '@/api/types';
import { fileKind } from '@/lib/constants';
import { useUI } from './ui';

export interface PreviewFile {
  path: string;
  title: string;
  content: string;
  kind: FileKind;
}

interface WorkspaceContextValue {
  tab: 'preview' | 'files';
  setTab: (tab: 'preview' | 'files') => void;
  preview: PreviewFile | null;
  previewLoading: boolean;
  openPreview: (path: string, title?: string) => Promise<void>;
  closePreview: () => void;
  entries: WorkspaceEntry[];
  currentDir: string;
  root: string;
  treeLoading: boolean;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  loadTree: (path?: string) => Promise<void>;
  search: (q: string) => Promise<void>;
  refresh: () => Promise<void>;
  openExternal: () => void;
  download: () => void;
  copyPath: () => Promise<void>;
  openWorkspace: () => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { setWorkspacePanelOpen, navigateTo, toast } = useUI();
  const [tab, setTab] = useState<'preview' | 'files'>('preview');
  const [preview, setPreview] = useState<PreviewFile | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [root, setRoot] = useState('');
  const [treeLoading, setTreeLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const openPreview = useCallback(
    async (path: string, title?: string) => {
      const kind = fileKind(path);
      setTab('preview');
      setWorkspacePanelOpen(true);
      setPreviewLoading(true);
      try {
        const res = await api.workspaceResolve(path);
        setPreview({
          path,
          title: title ?? path.split('/').pop() ?? path,
          content: res.content ?? '',
          kind,
        });
      } catch {
        toast('预览失败', 'error');
        setPreview({ path, title: title ?? path, content: '', kind });
      } finally {
        setPreviewLoading(false);
      }
    },
    [setWorkspacePanelOpen, toast],
  );

  const closePreview = useCallback(() => setPreview(null), []);

  const loadTree = useCallback(async (path = '') => {
    setTreeLoading(true);
    try {
      const res = await api.workspaceTree(path);
      setEntries(res.entries ?? []);
      setCurrentDir(res.path ?? path);
      if (res.root) setRoot(res.root);
    } catch {
      setEntries([]);
    } finally {
      setTreeLoading(false);
    }
  }, []);

  const search = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q) {
      await loadTree(currentDir);
      return;
    }
    setTreeLoading(true);
    try {
      const res = await api.workspaceSearch(q);
      setEntries(res.entries ?? []);
    } finally {
      setTreeLoading(false);
    }
  }, [currentDir, loadTree]);

  const refresh = useCallback(async () => {
    if (searchQuery) await search(searchQuery);
    else await loadTree(currentDir);
  }, [searchQuery, search, loadTree, currentDir]);

  const openExternal = useCallback(() => {
    if (preview) window.open(api.fileUrl(preview.path), '_blank', 'noopener');
  }, [preview]);

  const download = useCallback(() => {
    if (!preview) return;
    const a = document.createElement('a');
    a.href = api.fileUrl(preview.path);
    a.download = preview.title;
    a.click();
  }, [preview]);

  const copyPath = useCallback(async () => {
    if (!preview) return;
    try {
      await navigator.clipboard.writeText(preview.path);
      toast('已复制路径', 'success');
    } catch {
      /* ignore */
    }
  }, [preview, toast]);

  // Keep the workspace in the chat view.
  const openWorkspace = useCallback(() => {
    navigateTo('chat');
    setWorkspacePanelOpen(true);
    void loadTree(currentDir);
  }, [currentDir, loadTree, navigateTo, setWorkspacePanelOpen]);

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      tab,
      setTab,
      preview,
      previewLoading,
      openPreview,
      closePreview,
      entries,
      currentDir,
      root,
      treeLoading,
      searchQuery,
      setSearchQuery,
      loadTree,
      search,
      refresh,
      openExternal,
      download,
      copyPath,
      openWorkspace,
    }),
    [
      tab,
      preview,
      previewLoading,
      openPreview,
      closePreview,
      entries,
      currentDir,
      root,
      treeLoading,
      searchQuery,
      loadTree,
      search,
      refresh,
      openExternal,
      download,
      copyPath,
      openWorkspace,
    ],
  );

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return ctx;
}
