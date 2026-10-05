import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useState } from 'react';
import { Button, Table } from 'antd';
import { api } from '@/api';
import type { MemoryFile } from '@/api';
import { useI18n } from '@/i18n/useI18n';
import {
  Badge,
  EmptyState,
  LoadingRow,
  PageHeader,
  SegmentedTabs,
} from '@/components/ui/primitives';
import { Markdown } from '@/components/chat/Markdown';
import { formatSize } from '@/lib/format';

const PAGE_SIZE = 20;

type Category = 'memory' | 'evolution';

interface ViewerState {
  filename: string;
  category: string;
}

const EMPTY_MEMORY = { zh: '暂无记忆文件', en: 'No memory files' };
const EMPTY_EVOLUTION = { zh: '暂无进化记录', en: 'No evolution records yet' };

function typeBadge(type: string | undefined) {
  if (type === 'global') {
    return (
      <Badge className="bg-primary-50 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
        Global
      </Badge>
    );
  }
  if (type === 'evolution') {
    return (
      <Badge className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400">
        Evolution
      </Badge>
    );
  }
  if (type === 'dream') {
    return (
      <Badge className="bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400">
        Dream
      </Badge>
    );
  }
  return (
    <Badge className="bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">
      Daily
    </Badge>
  );
}

export function MemoryView() {
  const { t, lang } = useI18n();
  const isZh = lang !== 'en';

  const [category, setCategory] = useState<Category>('memory');
  const [page, setPage] = useState(1);
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [viewerContent, setViewerContent] = useState('');
  const [viewerLoading, setViewerLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .getMemory(page, PAGE_SIZE, category)
      .then((data) => {
        if (!alive) return;
        setFiles(data.list || []);
        setTotal(data.total || 0);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setFiles([]);
        setTotal(0);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [category, page]);

  const changeTab = useCallback((id: string) => {
    setCategory(id === 'dreams' ? 'evolution' : 'memory');
    setPage(1);
    setViewer(null);
  }, []);

  const openFile = useCallback(async (file: MemoryFile) => {
    // In the merged evolution tab, resolve each file by its own origin
    // (evolution logs vs dream diaries live in different dirs).
    const fileCategory =
      file.type === 'dream' || file.type === 'evolution' ? file.type : undefined;
    const resolved = fileCategory ?? 'memory';
    setViewer({ filename: file.filename, category: resolved });
    setViewerContent('');
    setViewerLoading(true);
    try {
      const res = await api.getMemoryContent(file.filename, resolved);
      if (res.status === 'success') setViewerContent(res.content || '');
    } catch {
      setViewerContent('');
    } finally {
      setViewerLoading(false);
    }
  }, []);

  const closeViewer = useCallback(() => setViewer(null), []);

  const showEmpty = !loading && total === 0;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {viewer ? (
          /* Panel: file viewer (replaces list) */
          <div>
            <div className="flex items-center gap-3 mb-6">
              <Button onClick={closeViewer}>
                <AppIcon className="fas fa-arrow-left text-xs mr-1" />
                <span>{t('memory_back')}</span>
              </Button>
              <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 font-mono truncate">
                {viewer.filename}
              </h2>
            </div>
            <div className="bg-white dark:bg-[#1F1F1F] rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
              <div
                className="p-5 overflow-y-auto text-sm text-slate-700 dark:text-slate-200"
                style={{ maxHeight: 'calc(100vh - 220px)' }}
              >
                {viewerLoading ? (
                  <LoadingRow />
                ) : (
                  <Markdown content={viewerContent} />
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Panel: list */
          <div>
            <PageHeader title={t('memory_title')} desc={t('memory_desc')}>
              <SegmentedTabs
                active={category === 'evolution' ? 'dreams' : 'files'}
                onChange={changeTab}
                tabs={[
                  { id: 'files', label: t('memory_tab_files'), icon: 'fa-file-lines' },
                  { id: 'dreams', label: t('memory_tab_dreams'), icon: 'fa-seedling' },
                ]}
              />
            </PageHeader>

            {loading ? (
              <EmptyState
                icon="fa-brain"
                iconClass="bg-purple-50 dark:bg-purple-900/20 text-purple-400"
                title={t('memory_loading')}
                desc={t('memory_loading_desc')}
              />
            ) : null}

            {showEmpty ? (
              <EmptyState
                icon={category === 'evolution' ? 'fa-seedling' : 'fa-brain'}
                iconClass={
                  category === 'evolution'
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-400'
                    : 'bg-purple-50 dark:bg-purple-900/20 text-purple-400'
                }
                title={
                  category === 'evolution'
                    ? isZh
                      ? EMPTY_EVOLUTION.zh
                      : EMPTY_EVOLUTION.en
                    : isZh
                      ? EMPTY_MEMORY.zh
                      : EMPTY_MEMORY.en
                }
              />
            ) : null}

            {!loading && total > 0 ? (
              <Table<MemoryFile>
                rowKey="filename"
                size="middle"
                dataSource={files}
                onRow={(record) => ({ onClick: () => void openFile(record) })}
                rowClassName="cursor-pointer"
                pagination={{
                  current: page,
                  pageSize: PAGE_SIZE,
                  total,
                  showSizeChanger: false,
                  size: 'small',
                  onChange: setPage,
                }}
                columns={[
                  {
                    title: t('memory_col_name'),
                    dataIndex: 'filename',
                    render: (value: string) => (
                      <span className="font-mono text-slate-700 dark:text-slate-200">{value}</span>
                    ),
                  },
                  {
                    title: t('memory_col_type'),
                    dataIndex: 'type',
                    render: (value: string) => typeBadge(value),
                  },
                  {
                    title: t('memory_col_size'),
                    dataIndex: 'size',
                    render: (value: number) => (
                      <span className="text-slate-500 dark:text-slate-400">{formatSize(value)}</span>
                    ),
                  },
                  {
                    title: t('memory_col_updated'),
                    dataIndex: 'updated_at',
                    render: (value: string) => (
                      <span className="text-slate-500 dark:text-slate-400">{value}</span>
                    ),
                  },
                ]}
              />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
