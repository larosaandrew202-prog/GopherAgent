import { AppIcon } from '@/components/ui/AppIcon';
import { useEffect, useMemo, useRef } from 'react';
import { Button, Input, List, Segmented, Spin, Tooltip } from 'antd';
import { useUI } from '@/store/ui';
import { useWorkspace } from '@/store/workspace';
import { useI18n } from '@/i18n/useI18n';
import { renderMarkdown } from '@/lib/markdown';
import { WS_KIND_ICONS, fileKind } from '@/lib/constants';
import { formatSize } from '@/lib/format';
import { classNames } from '@/lib/format';
import hljs from 'highlight.js';

function PreviewBody({ content, kind, path }: { content: string; kind: string; path: string }) {
  if (kind === 'image') {
    return <img src={`/api/file?path=${encodeURIComponent(path)}`} alt="" className="max-w-full rounded-lg" />;
  }
  if (kind === 'video') {
    return <video controls src={`/api/file?path=${encodeURIComponent(path)}`} className="max-w-full rounded-lg" />;
  }
  if (kind === 'audio') {
    return <audio controls src={`/api/file?path=${encodeURIComponent(path)}`} className="w-full" />;
  }
  if (kind === 'pdf') {
    return <iframe title={path} src={`/api/file?path=${encodeURIComponent(path)}`} className="w-full h-[70vh]" />;
  }
  if (kind === 'html') {
    return <iframe title={path} srcDoc={content} className="w-full h-[70vh] bg-white rounded-lg" />;
  }
  if (kind === 'markdown') {
    return <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
  }
  if (kind === 'code') {
    let html: string;
    try {
      html = hljs.highlightAuto(content).value;
    } catch {
      html = content;
    }
    return (
      <pre className="text-xs overflow-x-auto">
        <code dangerouslySetInnerHTML={{ __html: html }} />
      </pre>
    );
  }
  return <pre className="text-xs whitespace-pre-wrap break-words">{content}</pre>;
}

/** Compact icon-only antd button used across the workspace toolbar. */
function IconButton({
  title,
  icon,
  onClick,
}: {
  title: string;
  icon: string;
  onClick: () => void;
}) {
  return (
    <Tooltip title={title}>
      <Button
        type="text"
        size="small"
        style={{ width: 26, height: 26, padding: 0 }}
        onClick={onClick}
        aria-label={title}
      >
        <AppIcon className={`fas ${icon}`} />
      </Button>
    </Tooltip>
  );
}

export function WorkspacePanel() {
  const { t } = useI18n();
  const { workspacePanelOpen, setWorkspacePanelOpen } = useUI();
  const {
    tab,
    setTab,
    preview,
    previewLoading,
    entries,
    currentDir,
    treeLoading,
    searchQuery,
    setSearchQuery,
    loadTree,
    search,
    refresh,
    openExternal,
    download,
    copyPath,
    openPreview,
  } = useWorkspace();

  const width = useRef(420);
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (workspacePanelOpen) void loadTree(currentDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspacePanelOpen]);

  const crumbs = useMemo(() => {
    if (!currentDir) return [] as { label: string; path: string }[];
    const parts = currentDir.split(/[\\/]/).filter(Boolean);
    const acc: { label: string; path: string }[] = [];
    let path = '';
    for (const part of parts) {
      path = path ? `${path}/${part}` : part;
      acc.push({ label: part, path });
    }
    return acc;
  }, [currentDir]);

  if (!workspacePanelOpen) return null;

  return (
    <aside ref={panelRef} className="workspace-panel" style={{ width: `${width.current}px` }}>
      <div className="workspace-inner">
        <div className="workspace-header">
          <div className="workspace-tabs">
            <Segmented
              value={tab}
              onChange={(value) => setTab(value as 'preview' | 'files')}
              options={[
                {
                  value: 'preview',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <AppIcon className="fas fa-eye" />
                      <span>{t('ws_tab_preview')}</span>
                    </span>
                  ),
                },
                {
                  value: 'files',
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      <AppIcon className="fas fa-folder-tree" />
                      <span>{t('ws_tab_files')}</span>
                    </span>
                  ),
                },
              ]}
            />
          </div>
          <div className="workspace-header-actions">
            {preview ? (
              <>
                <IconButton title={t('ws_open_external')} icon="fa-up-right-from-square" onClick={openExternal} />
                <IconButton title={t('ws_download')} icon="fa-download" onClick={download} />
                <IconButton title={t('ws_copy_path')} icon="fa-link" onClick={copyPath} />
              </>
            ) : null}
            <IconButton title={t('ws_close')} icon="fa-xmark" onClick={() => setWorkspacePanelOpen(false)} />
          </div>
        </div>

        <div className={classNames('workspace-body', tab === 'preview' && 'active')}>
          {preview ? (
            <>
              <div className="workspace-file-title">{preview.title}</div>
              <div className="workspace-preview-content">
                {previewLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Spin size="small" />
                  </div>
                ) : (
                  <PreviewBody content={preview.content} kind={preview.kind} path={preview.path} />
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-slate-400 dark:text-slate-500 text-sm gap-2">
              <AppIcon className="fas fa-file-circle-question text-2xl opacity-40" />
              <span>{t('ws_preview_empty')}</span>
            </div>
          )}
        </div>

        <div className={classNames('workspace-body', tab === 'files' && 'active')}>
          <div className="workspace-files-toolbar">
            <div className="workspace-search">
              <AppIcon className="fas fa-magnifying-glass" />
              <Input
                variant="borderless"
                spellCheck={false}
                placeholder={t('ws_search_placeholder')}
                value={searchQuery}
                onChange={(e) => void search(e.target.value)}
              />
            </div>
            <IconButton title={t('ws_refresh')} icon="fa-rotate-right" onClick={() => void refresh()} />
          </div>
          <div className="workspace-breadcrumb">
            <IconButton title={t('ws_tab_files')} icon="fa-house" onClick={() => void loadTree('')} />
            {crumbs.map((crumb) => (
              <span key={crumb.path} className="flex items-center gap-1">
                <AppIcon className="fas fa-chevron-right text-[9px] text-slate-300 dark:text-slate-600" />
                <Button
                  type="link"
                  size="small"
                  style={{ padding: 0, height: 'auto' }}
                  onClick={() => void loadTree(crumb.path)}
                >
                  {crumb.label}
                </Button>
              </span>
            ))}
          </div>
          <div className="workspace-file-list">
            {treeLoading ? (
              <div className="flex items-center justify-center py-6">
                <Spin size="small" />
              </div>
            ) : (
              <List
                size="small"
                split={false}
                dataSource={entries}
                locale={{
                  emptyText: (
                    <span className="text-xs text-slate-400 dark:text-slate-500">
                      {searchQuery ? t('ws_no_results') : t('ws_empty_dir')}
                    </span>
                  ),
                }}
                renderItem={(entry) => {
                  const kind = entry.kind ?? (entry.type === 'dir' ? 'directory' : fileKind(entry.name));
                  return (
                    <List.Item
                      style={{ padding: '6px 8px', borderRadius: 6, cursor: 'pointer' }}
                      onClick={() => {
                        if (entry.type === 'dir') void loadTree(entry.path);
                        else void openPreview(entry.path, entry.name);
                      }}
                    >
                      <div className="flex items-center gap-2 w-full text-xs text-slate-600 dark:text-slate-300">
                        <AppIcon className={classNames('fas w-4 text-center', WS_KIND_ICONS[kind])} />
                        <span className="flex-1 truncate">{entry.name}</span>
                        {entry.size ? <span className="text-slate-400">{formatSize(entry.size)}</span> : null}
                      </div>
                    </List.Item>
                  );
                }}
              />
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
