import { AppIcon } from '@/components/ui/AppIcon';
/* Knowledge view — ported from console.js ~10412-11327 and chat.html ~1054-1174.
 *
 * Documents tab: searchable, expandable file tree (root files + nested groups)
 * with hover rename/move/delete actions, plus a Markdown content viewer.
 * Graph tab: lazily rendered d3 force-directed graph with zoom/drag + legend. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as d3 from 'd3';
import { api } from '@/api';
import type { GraphNode, KnowledgeFile, KnowledgeGroup } from '@/api/types';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from '@/store/ui';
import { Markdown } from '@/components/chat/Markdown';
import {
  Card,
  Dropdown,
  EmptyState,
  LoadingRow,
  Modal,
  ModalFooter,
  ModalHeader,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SegmentedTabs,
  Spinner,
} from '@/components/ui/primitives';
import { Button as AntButton, Dropdown as AntDropdown, Input } from 'antd';
import { classNames } from '@/lib/format';

const KNOWLEDGE_IMPORT_MAX_FILES = 100;
const KNOWLEDGE_IMPORT_MAX_FILE_SIZE = 10 * 1024 * 1024;
const KNOWLEDGE_IMPORT_MAX_TOTAL_SIZE = 200 * 1024 * 1024;

/* ------------------------------------------------------------- helpers */

function knowledgeCategoryPaths(groups: KnowledgeGroup[], parent = ''): string[] {
  const paths: string[] = [];
  for (const group of groups) {
    const path = parent ? `${parent}/${group.dir}` : group.dir;
    paths.push(path, ...knowledgeCategoryPaths(group.children || [], path));
  }
  return paths;
}

function findKnowledgeFileTitle(
  path: string,
  tree: KnowledgeGroup[],
  rootFiles: KnowledgeFile[],
): string | null {
  if (!path) return null;
  const rootHit = rootFiles.find((f) => f.name === path);
  if (rootHit) return rootHit.title || rootHit.name;
  const walk = (groups: KnowledgeGroup[], parentPath: string): string | null => {
    for (const group of groups) {
      const groupPath = parentPath ? `${parentPath}/${group.dir}` : group.dir;
      const hit = (group.files || []).find((f) => `${groupPath}/${f.name}` === path);
      if (hit) return hit.title || hit.name;
      const childHit = walk(group.children || [], groupPath);
      if (childHit !== null) return childHit;
    }
    return null;
  };
  return walk(tree, '');
}

function hasFilterMatch(groups: KnowledgeGroup[], lowerFilter: string): boolean {
  for (const g of groups) {
    for (const f of g.files || []) {
      if (f.title.toLowerCase().includes(lowerFilter) || f.name.toLowerCase().includes(lowerFilter)) {
        return true;
      }
    }
    if (hasFilterMatch(g.children || [], lowerFilter)) return true;
  }
  return false;
}

function countFiles(group: KnowledgeGroup): number {
  let count = (group.files || []).length;
  for (const child of group.children || []) count += countFiles(child);
  return count;
}

function matchesFile(file: KnowledgeFile, lowerFilter: string): boolean {
  if (!lowerFilter) return true;
  return (
    file.title.toLowerCase().includes(lowerFilter) || file.name.toLowerCase().includes(lowerFilter)
  );
}

function validateImportFiles(files: File[], zh: boolean): string {
  if (!files || !files.length) return zh ? '请选择文件' : 'Choose files';
  if (files.length > KNOWLEDGE_IMPORT_MAX_FILES) {
    return zh
      ? `一次最多导入 ${KNOWLEDGE_IMPORT_MAX_FILES} 个文件`
      : `Import at most ${KNOWLEDGE_IMPORT_MAX_FILES} files at a time`;
  }
  let total = 0;
  for (const file of files) {
    total += file.size || 0;
    if ((file.size || 0) > KNOWLEDGE_IMPORT_MAX_FILE_SIZE) {
      return zh ? `${file.name} 超过 10MB` : `${file.name} exceeds 10MB`;
    }
  }
  if (total > KNOWLEDGE_IMPORT_MAX_TOTAL_SIZE) {
    return zh ? '单次导入总大小不能超过 200MB' : 'Total import size cannot exceed 200MB';
  }
  return '';
}

interface ActionResult {
  status: string;
  message?: string;
  payload?: Record<string, unknown>;
}

type DialogValue = string | { filename: string; content: string };

interface DialogState {
  mode: 'input' | 'select' | 'document';
  title: string;
  subtitle: string;
  label: string;
  hint: string;
  icon: string;
  category: string;
  choices: string[];
  value: string;
  filename: string;
  content: string;
  error: string;
  validate: (value: DialogValue) => string;
  onSubmit: (value: DialogValue) => boolean | Promise<boolean>;
}

interface KnowledgeViewer {
  path: string;
  title: string;
  content: string;
}

/* =========================================================== Graph panel */

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  category: string;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  source: string | SimNode;
  target: string | SimNode;
}

const nodeIdOf = (end: string | SimNode): string => (typeof end === 'string' ? end : end.id);
const nodeCoord = (value: number | undefined): number => (typeof value === 'number' ? value : 0);

function KnowledgeGraphPanel({ onOpenNode }: { onOpenNode: (id: string, label: string) => void }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(onOpenNode);
  openRef.current = onOpenNode;
  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    const render = (rawNodes: GraphNode[], rawLinks: { source: string; target: string }[]) => {
      const nodes: SimNode[] = rawNodes.map((n) => ({
        id: n.id,
        label: (typeof n.label === 'string' && n.label) || n.id,
        category: String((n as { category?: unknown }).category ?? n.group ?? 'default'),
      }));
      const links: SimLink[] = rawLinks.map((l) => ({ source: l.source, target: l.target }));

      const width = container.clientWidth || 800;
      const height = container.clientHeight || 600;

      const catCount: Record<string, number> = {};
      nodes.forEach((n) => {
        catCount[n.category] = (catCount[n.category] || 0) + 1;
      });
      const categories = Object.keys(catCount).sort(
        (a, b) => catCount[b] - catCount[a] || a.localeCompare(b),
      );
      const colorScale = d3.scaleOrdinal<string, string>(d3.schemeTableau10).domain(categories);

      const connCount: Record<string, number> = {};
      nodes.forEach((n) => {
        connCount[n.id] = 0;
      });
      links.forEach((l) => {
        const s = nodeIdOf(l.source);
        const tg = nodeIdOf(l.target);
        connCount[s] = (connCount[s] || 0) + 1;
        connCount[tg] = (connCount[tg] || 0) + 1;
      });
      const getNodeRadius = (d: SimNode) => Math.max(5, Math.min(16, 5 + (connCount[d.id] || 0) * 2));

      container.innerHTML = '';
      container.style.position = 'relative';

      const svg = d3.select(container).append('svg').attr('width', width).attr('height', height);
      const g = svg.append('g');

      let currentZoomScale = 1;
      let fittedScale = 1;

      const updateLabelVisibility = () => {
        if (!label) return;
        if (currentZoomScale < fittedScale * 0.9) {
          label.attr('opacity', 0);
          return;
        }
        label
          .attr('opacity', 1)
          .attr('font-size', 10 / currentZoomScale)
          .attr('dx', (d) => getNodeRadius(d) + 4 / currentZoomScale)
          .attr('dy', 3 / currentZoomScale);
      };

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 5])
        .on('zoom', (event) => {
          g.attr('transform', event.transform.toString());
          currentZoomScale = event.transform.k;
          updateLabelVisibility();
        });
      svg.call(zoom);

      const simulation = d3
        .forceSimulation<SimNode>(nodes)
        .force(
          'link',
          d3
            .forceLink<SimNode, SimLink>(links)
            .id((d) => d.id)
            .distance(90),
        )
        .force('charge', d3.forceManyBody<SimNode>().strength(-180))
        .force('center', d3.forceCenter<SimNode>(width / 2, height / 2))
        .force('x', d3.forceX<SimNode>(width / 2).strength(0.06))
        .force('y', d3.forceY<SimNode>(height / 2).strength(0.06))
        .force('collision', d3.forceCollide<SimNode>().radius((d) => getNodeRadius(d) + 30));

      const link = g
        .append('g')
        .selectAll<SVGLineElement, SimLink>('line')
        .data(links)
        .join('line')
        .attr('stroke', '#9a9892')
        .attr('stroke-opacity', 0.3)
        .attr('stroke-width', 1);

      const node = g
        .append('g')
        .selectAll<SVGCircleElement, SimNode>('circle')
        .data(nodes)
        .join('circle')
        .attr('r', (d) => getNodeRadius(d))
        .attr('fill', (d) => colorScale(d.category))
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('cursor', 'pointer')
        .call(
          d3
            .drag<SVGCircleElement, SimNode>()
            .on('start', (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            })
            .on('drag', (event, d) => {
              d.fx = event.x;
              d.fy = event.y;
            })
            .on('end', (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            }),
        );

      const label = g
        .append('g')
        .selectAll<SVGTextElement, SimNode>('text')
        .data(nodes)
        .join('text')
        .text((d) => (d.label.length > 15 ? `${d.label.slice(0, 14)}…` : d.label))
        .attr('class', 'knowledge-graph-label')
        .attr('font-size', 9)
        .attr('dx', (d) => getNodeRadius(d) + 4)
        .attr('dy', 3)
        .style('pointer-events', 'none');

      /* Tooltip */
      const tooltip = document.createElement('div');
      tooltip.className = 'knowledge-graph-tooltip';
      container.appendChild(tooltip);

      const connected = (a: string, b: string) =>
        links.some((l) => {
          const s = nodeIdOf(l.source);
          const tg = nodeIdOf(l.target);
          return (s === a && tg === b) || (tg === a && s === b);
        });

      node
        .on('mouseover', (event, d) => {
          tooltip.textContent = `${d.label} (${d.category})`;
          tooltip.style.opacity = '1';
          tooltip.style.left = `${event.offsetX + 12}px`;
          tooltip.style.top = `${event.offsetY - 8}px`;
          link.attr('stroke-opacity', (l) => {
            const s = nodeIdOf(l.source);
            const tg = nodeIdOf(l.target);
            return s === d.id || tg === d.id ? 0.8 : 0.1;
          });
          node.attr('opacity', (n) => (n.id === d.id || connected(d.id, n.id) ? 1 : 0.2));
          label.attr('opacity', (n) => (n.id === d.id || connected(d.id, n.id) ? 1 : 0.1));
        })
        .on('mousemove', (event) => {
          tooltip.style.left = `${event.offsetX + 12}px`;
          tooltip.style.top = `${event.offsetY - 8}px`;
        })
        .on('mouseout', () => {
          tooltip.style.opacity = '0';
          link.attr('stroke-opacity', 0.3);
          node.attr('opacity', 1);
          label.attr('opacity', 1);
        })
        .on('click', (_event, d) => {
          openRef.current(d.id, d.label);
        });

      const endNode = (end: string | SimNode): SimNode =>
        typeof end === 'string'
          ? nodes.find((n) => n.id === end) ?? ({ x: 0, y: 0 } as SimNode)
          : end;

      simulation.on('tick', () => {
        link
          .attr('x1', (d) => nodeCoord(endNode(d.source).x))
          .attr('y1', (d) => nodeCoord(endNode(d.source).y))
          .attr('x2', (d) => nodeCoord(endNode(d.target).x))
          .attr('y2', (d) => nodeCoord(endNode(d.target).y));
        node.attr('cx', (d) => nodeCoord(d.x)).attr('cy', (d) => nodeCoord(d.y));
        label.attr('x', (d) => nodeCoord(d.x)).attr('y', (d) => nodeCoord(d.y));
      });

      /* Auto fit-to-view when the simulation settles */
      simulation.on('end', () => {
        const pad = 16;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -Infinity;
        let y1 = -Infinity;
        nodes.forEach((n) => {
          const nx = nodeCoord(n.x);
          const ny = nodeCoord(n.y);
          if (nx < x0) x0 = nx;
          if (ny < y0) y0 = ny;
          if (nx > x1) x1 = nx;
          if (ny > y1) y1 = ny;
        });
        const bw = x1 - x0 + pad * 2;
        const bh = y1 - y0 + pad * 2;
        if (bw > 0 && bh > 0) {
          const scale = Math.min(width / bw, height / bh, 4);
          fittedScale = scale;
          const tx = width / 2 - ((x0 + x1) / 2) * scale;
          const ty = height / 2 - ((y0 + y1) / 2) * scale;
          const target = d3.zoomIdentity.translate(tx, ty).scale(scale);
          svg
            .transition()
            .duration(500)
            .call(
              zoom.transform as unknown as (selection: unknown, transform: d3.ZoomTransform) => void,
              target,
            );
        }
      });

      /* Legend */
      const legendDiv = document.createElement('div');
      legendDiv.className = 'knowledge-graph-legend';
      categories.forEach((cat) => {
        const item = document.createElement('span');
        item.className = 'knowledge-graph-legend-item';
        const dot = document.createElement('span');
        dot.className = 'knowledge-graph-legend-dot';
        dot.style.background = colorScale(cat);
        item.appendChild(dot);
        item.appendChild(document.createTextNode(cat));
        legendDiv.appendChild(item);
      });
      container.appendChild(legendDiv);
    };

    void (async () => {
      try {
        const data = await api.knowledgeGraph();
        if (cancelled) return;
        const rawNodes = data.nodes || [];
        const rawLinks = (data.links || []) as { source: string; target: string }[];
        if (!rawNodes.length) {
          setState('empty');
          return;
        }
        setState('ready');
        render(rawNodes, rawLinks);
      } catch {
        if (!cancelled) setState('error');
      }
    })();

    return () => {
      cancelled = true;
      if (containerRef.current) containerRef.current.innerHTML = '';
    };
  }, []);

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <div
          id="knowledge-graph-container"
          ref={containerRef}
          className="relative w-full h-[60vh] md:h-[calc(100vh-220px)]"
        />
        {state !== 'ready' ? (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
            {state === 'loading' ? (
              <span className="flex items-center gap-2">
                <Spinner />
                {t('knowledge_loading')}
              </span>
            ) : state === 'empty' ? (
              <div className="flex flex-col items-center">
                <AppIcon className="fas fa-diagram-project text-3xl mb-3 opacity-40" />
                <p className="text-sm">{t('knowledge_empty_hint')}</p>
              </div>
            ) : (
              <span>{t('knowledge_loading')}</span>
            )}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/* =========================================================== Main view */

export function KnowledgeView() {
  const { t, lang } = useI18n();
  const { navigateTo, confirm } = useUI();
  const zh = lang !== 'en';

  const [tab, setTab] = useState<'docs' | 'graph'>('docs');
  const [graphOpened, setGraphOpened] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [empty, setEmpty] = useState(false);

  const [tree, setTree] = useState<KnowledgeGroup[]>([]);
  const [rootFiles, setRootFiles] = useState<KnowledgeFile[]>([]);
  const [stats, setStats] = useState<{ pages?: number; size?: number }>({});

  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [viewer, setViewer] = useState<KnowledgeViewer | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [mobileContentOpen, setMobileContentOpen] = useState(false);

  const importInputRef = useRef<HTMLInputElement>(null);

  const [dragOver, setDragOver] = useState(false);
  const [status, setStatus] = useState<{ msg: string; error: boolean; persistent: boolean } | null>(
    null,
  );
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /* ------------------------------------------------------------- loading */

  const openFile = useCallback(async (path: string, title: string) => {
    setCurrentFile(path);
    setViewerOpen(true);
    if (typeof window !== 'undefined' && window.innerWidth < 768) setMobileContentOpen(true);
    setViewer(null);
    setViewerLoading(true);
    try {
      const data = await api.knowledgeRead(path);
      if (data.status === 'success') {
        setViewer({ path, title: data.title || title, content: data.content || '' });
      }
    } catch {
      /* ignore */
    } finally {
      setViewerLoading(false);
    }
  }, []);

  const load = useCallback(
    async (targetPath?: string) => {
      try {
        const data = await api.knowledgeList();
        if (data.status !== 'success') {
          setInitialized(true);
          return;
        }
        const nextTree = data.tree || [];
        const nextRootFiles = data.root_files || [];
        setTree(nextTree);
        setRootFiles(nextRootFiles);
        setStats(data.stats || {});

        const totalPages = data.stats?.pages || 0;
        const isEmpty =
          totalPages === 0 && nextTree.length === 0 && nextRootFiles.length === 0;
        setEmpty(isEmpty);
        setInitialized(true);

        if (isEmpty) {
          setViewerOpen(false);
          return;
        }

        if (targetPath) {
          openFile(targetPath, findKnowledgeFileTitle(targetPath, nextTree, nextRootFiles) ?? targetPath);
          return;
        }

        if (typeof window !== 'undefined' && window.innerWidth >= 768) {
          const firstFile = nextRootFiles[0];
          const firstGroup = !firstFile
            ? nextTree.find((grp) => (grp.files || []).length > 0)
            : undefined;
          if (firstFile) {
            void openFile(firstFile.name, firstFile.title);
          } else if (firstGroup) {
            const gf = firstGroup.files[0];
            void openFile(`${firstGroup.dir}/${gf.name}`, gf.title);
          }
        }
      } catch {
        setInitialized(true);
      }
    },
    [openFile],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (tab === 'graph') setGraphOpened(true);
  }, [tab]);

  useEffect(() => {
    if (!status || status.persistent) return;
    const id = window.setTimeout(() => setStatus(null), 3500);
    return () => window.clearTimeout(id);
  }, [status]);

  /* --------------------------------------------------------- action utils */

  const resultMessage = useCallback(
    (action: string, payload?: Record<string, unknown>): string => {
      const num = (v: unknown) => Number(v ?? 0);
      if (!zh) {
        return action === 'create_category'
          ? 'Category created'
          : action === 'create_document'
            ? 'Document created'
            : action === 'rename_category'
              ? 'Category renamed'
              : action === 'delete_category'
                ? 'Category deleted'
                : action === 'import_documents'
                  ? `${num(payload?.imported)} imported · ${num(payload?.skipped)} skipped · ${num(payload?.failed)} failed`
                  : action === 'move_documents'
                    ? `${num(payload?.moved)} document moved`
                    : `${num(payload?.deleted)} document deleted`;
      }
      return action === 'create_category'
        ? '分类已创建'
        : action === 'create_document'
          ? '文档已创建'
          : action === 'rename_category'
            ? '分类已重命名'
            : action === 'delete_category'
              ? '分类已删除'
              : action === 'import_documents'
                ? `导入 ${num(payload?.imported)} 个，跳过 ${num(payload?.skipped)} 个，失败 ${num(payload?.failed)} 个`
                : action === 'move_documents'
                  ? `已移动 ${num(payload?.moved)} 个文档`
                  : `已删除 ${num(payload?.deleted)} 个文档`;
    },
    [zh],
  );

  const runAction = useCallback(
    async (
      action: string,
      payload: Record<string, unknown>,
      openPathResolver?: (payload?: Record<string, unknown>) => string | null,
    ): Promise<unknown | null> => {
      setStatus({ msg: zh ? '处理中...' : 'Working...', error: false, persistent: true });
      try {
        const result = (await api.knowledgeAction({ action, payload })) as ActionResult;
        if (result.status !== 'success') {
          setStatus({
            msg: result.message || (zh ? '操作失败' : 'Operation failed'),
            error: true,
            persistent: false,
          });
          void load();
          return null;
        }
        setStatus({ msg: resultMessage(action, result.payload), error: false, persistent: false });
        const openPath = openPathResolver ? openPathResolver(result.payload) : null;
        void load(openPath || undefined);
        return result.payload ?? true;
      } catch {
        setStatus({
          msg: zh ? '请求失败，请稍后重试' : 'Request failed, please try again',
          error: true,
          persistent: false,
        });
        return null;
      }
    },
    [zh, resultMessage, load],
  );

  /* --------------------------------------------------------------- dialog */

  const openDialog = useCallback(
    (opts: Partial<DialogState> & Pick<DialogState, 'title' | 'onSubmit'>) => {
      setDialog({
        mode: 'input',
        subtitle: '',
        label: '',
        hint: '',
        icon: 'fa-folder',
        category: '',
        choices: [],
        value: '',
        filename: '',
        content: '',
        error: '',
        validate: (v) =>
          typeof v === 'string' && !v.trim() ? (zh ? '此项不能为空' : 'This field is required') : '',
        ...opts,
      });
    },
    [zh],
  );

  const closeDialog = useCallback(() => setDialog(null), []);

  const submitDialog = useCallback(async () => {
    const d = dialog;
    if (!d) return;
    const raw: DialogValue =
      d.mode === 'select'
        ? d.value
        : d.mode === 'document'
          ? { filename: d.filename.trim(), content: d.content }
          : d.value;
    const value: DialogValue = d.mode === 'input' ? (raw as string).trim() : raw;
    const error = d.validate(value);
    if (error) {
      setDialog({ ...d, error });
      return;
    }
    setSubmitting(true);
    try {
      const shouldClose = await d.onSubmit(value);
      if (shouldClose) setDialog(null);
    } finally {
      setSubmitting(false);
    }
  }, [dialog]);

  const createCategory = useCallback(() => {
    openDialog({
      title: t('knowledge_new_category'),
      subtitle: zh ? '分类会创建为 knowledge/ 下的目录' : 'Creates a directory under knowledge/',
      label: zh ? '分类路径' : 'Category path',
      hint: zh ? '支持嵌套路径，例如 research/ai' : 'Nested paths are supported, e.g. research/ai',
      icon: 'fa-folder-plus',
      onSubmit: async (v) => (await runAction('create_category', { path: v as string })) !== null,
    });
  }, [openDialog, t, zh, runAction]);

  const openDocumentEditor = useCallback(
    (category: string) => {
      openDialog({
        title: t('knowledge_new_document'),
        subtitle: zh ? `保存到 ${category}` : `Save to ${category}`,
        mode: 'document',
        category,
        icon: 'fa-file-circle-plus',
        hint: zh
          ? '文件名可省略 .md 后缀；保存后会自动同步索引。'
          : 'The .md suffix is optional. Index sync runs after saving.',
        validate: (value) => {
          const v = value as { filename: string; content: string };
          if (!v.filename) return zh ? '文件名不能为空' : 'Filename is required';
          if (/\.[^.]+$/i.test(v.filename) && !/\.md$/i.test(v.filename)) {
            return zh ? '新建文档仅支持 .md 文件名' : 'New documents must be .md files';
          }
          if (!v.content.trim()) return zh ? '内容不能为空' : 'Content is required';
          if (new Blob([v.content]).size > KNOWLEDGE_IMPORT_MAX_FILE_SIZE) {
            return zh ? '内容不能超过 10MB' : 'Content cannot exceed 10MB';
          }
          return '';
        },
        onSubmit: async (value) => {
          const v = value as { filename: string; content: string };
          const safeName = v.filename.endsWith('.md') ? v.filename : `${v.filename}.md`;
          const res = await runAction(
            'create_document',
            { path: `${category}/${safeName}`, content: v.content, overwrite: false },
            (payload) => (payload?.path as string) || `${category}/${safeName}`,
          );
          return res !== null;
        },
      });
    },
    [openDialog, t, zh, runAction],
  );

  const createDocument = useCallback(() => {
    const categories = knowledgeCategoryPaths(tree);
    if (!categories.length) {
      setStatus({
        msg: zh ? '请先创建分类' : 'Create a category first',
        error: true,
        persistent: false,
      });
      return;
    }
    openDialog({
      title: t('knowledge_new_document'),
      subtitle: zh ? '先选择分类，然后输入文件名' : 'Choose a category, then enter a filename',
      label: zh ? '目标分类' : 'Destination category',
      mode: 'select',
      choices: categories,
      value: categories[0] ?? '',
      icon: 'fa-file-circle-plus',
      onSubmit: (value) => {
        openDocumentEditor(value as string);
        return false;
      },
    });
  }, [openDialog, openDocumentEditor, t, zh, tree]);

  const runImport = useCallback(
    async (files: File[], targetCategory: string): Promise<boolean> => {
      const validationError = validateImportFiles(files, zh);
      if (validationError) {
        setStatus({ msg: validationError, error: true, persistent: false });
        return false;
      }
      const supported = files.filter((file) => /\.(md|txt)$/i.test(file.name || ''));
      if (!supported.length) {
        setStatus({
          msg: zh ? '请选择 .md 或 .txt 文件' : 'Choose .md or .txt files',
          error: true,
          persistent: false,
        });
        return false;
      }
      const form = new FormData();
      form.append('target_category', targetCategory);
      form.append('conflict_strategy', 'rename');
      supported.forEach((file) => form.append('files', file, file.name));
      setStatus({ msg: zh ? '正在导入...' : 'Importing...', error: false, persistent: true });
      try {
        const result = (await api.knowledgeImport(form)) as ActionResult;
        if (result.status !== 'success') {
          setStatus({
            msg: result.message || (zh ? '导入失败' : 'Import failed'),
            error: true,
            persistent: false,
          });
          void load();
          return false;
        }
        setStatus({
          msg: resultMessage('import_documents', result.payload),
          error: false,
          persistent: false,
        });
        const results = result.payload?.results as
          | { status: string; path: string }[]
          | undefined;
        const firstImported = results?.find((item) => item.status === 'imported');
        void load(firstImported ? firstImported.path : undefined);
        return true;
      } catch {
        setStatus({
          msg: zh ? '导入请求失败' : 'Import request failed',
          error: true,
          persistent: false,
        });
        return false;
      }
    },
    [load, resultMessage, zh],
  );

  const openImportDialog = useCallback(
    (files: File[]) => {
      const validationError = validateImportFiles(files, zh);
      if (validationError) {
        setStatus({ msg: validationError, error: true, persistent: false });
        return;
      }
      const choices = knowledgeCategoryPaths(tree);
      openDialog({
        title: t('knowledge_import_documents'),
        subtitle: zh ? `已选择 ${files.length} 个文件` : `${files.length} file(s) selected`,
        label: zh ? '目标分类' : 'Destination category',
        hint: choices.length
          ? zh
            ? '支持 Markdown 和 TXT，TXT 会转成 Markdown 文档'
            : 'Markdown and TXT are supported. TXT is converted to Markdown.'
          : zh
            ? '请先创建一个分类'
            : 'Create a category first',
        mode: 'select',
        choices,
        value: choices[0] ?? '',
        icon: 'fa-file-arrow-up',
        onSubmit: (target) => runImport(files, target as string),
      });
    },
    [openDialog, runImport, t, tree, zh],
  );

  const selectImportFiles = useCallback(() => {
    const input = importInputRef.current;
    if (!input) return;
    input.value = '';
    input.click();
  }, []);

  const renameCategory = useCallback(
    (path: string) => {
      openDialog({
        title: zh ? '重命名分类' : 'Rename category',
        subtitle: path,
        label: zh ? '新的分类路径' : 'New category path',
        value: path,
        icon: 'fa-pen',
        validate: (v) =>
          v === path ? (zh ? '请输入不同的分类路径' : 'Enter a different category path') : '',
        onSubmit: async (v) => (await runAction('rename_category', { path, new_path: v })) !== null,
      });
    },
    [openDialog, runAction, zh],
  );

  const deleteCategory = useCallback(
    async (path: string) => {
      const ok = await confirm({
        title: zh ? '删除分类' : 'Delete category',
        message: zh
          ? `确认删除“${path}”及其中全部文档？`
          : `Delete "${path}" and all of its documents?`,
        okText: t('confirm_yes'),
        cancelText: t('confirm_cancel'),
        danger: true,
      });
      if (ok) void runAction('delete_category', { path, confirm: true });
    },
    [confirm, runAction, t, zh],
  );

  const deleteDocument = useCallback(
    async (path: string) => {
      const ok = await confirm({
        title: zh ? '删除文档' : 'Delete document',
        message: zh ? `确认删除“${path}”？` : `Delete "${path}"?`,
        okText: t('confirm_yes'),
        cancelText: t('confirm_cancel'),
        danger: true,
      });
      if (ok) void runAction('delete_documents', { paths: [path] });
    },
    [confirm, runAction, t, zh],
  );

  const moveDocument = useCallback(
    (path: string) => {
      const currentCategory = path.includes('/') ? path.split('/').slice(0, -1).join('/') : '';
      const choices = knowledgeCategoryPaths(tree).filter((value) => value !== currentCategory);
      openDialog({
        title: zh ? '移动文档' : 'Move document',
        subtitle: path,
        label: zh ? '目标分类' : 'Destination category',
        hint: choices.length ? '' : zh ? '请先创建其他分类' : 'Create another category first',
        mode: 'select',
        choices,
        value: choices[0] ?? '',
        icon: 'fa-arrow-right-arrow-left',
        onSubmit: async (target) =>
          (await runAction('move_documents', {
            paths: [path],
            target_category: target,
          })) !== null,
      });
    },
    [openDialog, runAction, tree, zh],
  );

  const onImportChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = '';
      if (files.length) openImportDialog(files);
    },
    [openImportDialog],
  );

  const openGraphNode = useCallback(
    (id: string, label: string) => {
      setTab('docs');
      void openFile(id, label);
    },
    [openFile],
  );

  const insertTemplate = useCallback(() => {
    setDialog((prev) => {
      if (!prev || prev.content.trim()) return prev;
      const title = (prev.filename || 'untitled').replace(/\.md$/i, '');
      const content = zh
        ? `# ${title}\n\n## 摘要\n\n\n## 关键点\n\n- \n\n## 参考\n\n`
        : `# ${title}\n\n## Summary\n\n\n## Key points\n\n- \n\n## References\n\n`;
      return { ...prev, content };
    });
  }, [zh]);

  /* ----------------------------------------------------------- rendering */

  const statsText = useMemo(() => {
    const totalPages = stats.pages || 0;
    const size = stats.size || 0;
    const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)} KB`;
    return `${totalPages} pages · ${sizeStr}`;
  }, [stats]);

  const lowerFilter = search.trim().toLowerCase();

  const toggleGroup = useCallback((path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const fileActions = (path: string): ReactNode => {
    if (path === 'index.md' || path === 'log.md') return null;
    return (
      <span className="knowledge-actions">
        <span
          role="button"
          tabIndex={0}
          title={zh ? '移动' : 'Move'}
          className="knowledge-action"
          onClick={(e) => {
            e.stopPropagation();
            moveDocument(path);
          }}
        >
          <AppIcon className="fas fa-arrow-right-arrow-left" />
        </span>
        <span
          role="button"
          tabIndex={0}
          title={zh ? '删除' : 'Delete'}
          className="knowledge-action danger"
          onClick={(e) => {
            e.stopPropagation();
            void deleteDocument(path);
          }}
        >
          <AppIcon className="fas fa-trash" />
        </span>
      </span>
    );
  };

  const categoryActions = (path: string): ReactNode => (
    <span className="knowledge-actions">
      <span
        role="button"
        tabIndex={0}
        title={zh ? '重命名' : 'Rename'}
        className="knowledge-action"
        onClick={(e) => {
          e.stopPropagation();
          renameCategory(path);
        }}
      >
        <AppIcon className="fas fa-pen" />
      </span>
      <span
        role="button"
        tabIndex={0}
        title={zh ? '删除' : 'Delete'}
        className="knowledge-action danger"
        onClick={(e) => {
          e.stopPropagation();
          void deleteCategory(path);
        }}
      >
        <AppIcon className="fas fa-trash" />
      </span>
    </span>
  );

  const renderFile = (path: string, title: string, padLeft: number): ReactNode => (
    <AntButton
      key={path}
      data-path={path}
      type="text"
      block
      style={{ paddingLeft: padLeft, height: 'auto' }}
      className={classNames('knowledge-tree-file !justify-start !gap-2 !py-1 !pr-2', currentFile === path && 'active')}
      onClick={() => void openFile(path, title)}
    >
      <AppIcon className="fas fa-file-lines text-[10px] text-slate-400" />
      <span className="truncate">{title}</span>
      {fileActions(path)}
    </AntButton>
  );

  const renderGroups = (
    groups: KnowledgeGroup[],
    parentPath: string,
    depth: number,
  ): ReactNode =>
    groups.map((group) => {
      const groupPath = parentPath ? `${parentPath}/${group.dir}` : group.dir;
      const files = (group.files || []).filter((f) => matchesFile(f, lowerFilter));
      const children = group.children || [];
      const hasMatchingChildren = lowerFilter
        ? hasFilterMatch(children, lowerFilter)
        : children.length > 0;
      if (files.length === 0 && !hasMatchingChildren && lowerFilter) return null;

      const open = lowerFilter ? true : !collapsed.has(groupPath);
      const indent = depth * 12;
      return (
        <div key={groupPath} className={classNames('knowledge-tree-group', open && 'open')}>
          <AntButton
            type="text"
            block
            className="knowledge-tree-group-btn !justify-start !gap-2 !py-1 !pr-2"
            style={{ paddingLeft: 8 + indent, height: 'auto' }}
            onClick={() => toggleGroup(groupPath)}
          >
            <AppIcon className="fas fa-chevron-right chevron" />
            <AppIcon className="fas fa-folder text-amber-400 text-[11px]" />
            <span>{group.dir}</span>
            <span className="ml-auto text-[10px] text-slate-400">{countFiles(group)}</span>
            {categoryActions(groupPath)}
          </AntButton>
          <div className="knowledge-tree-group-items">
            {files.map((f) => renderFile(`${groupPath}/${f.name}`, f.title, 24 + indent))}
            {renderGroups(children, groupPath, depth + 1)}
          </div>
        </div>
      );
    });

  const visibleRootFiles = rootFiles.filter((f) => matchesFile(f, lowerFilter));
  const showDocsPanel = initialized && !empty;
  const showEmptyState = (!initialized || empty) && tab === 'docs';

  return (
    <>
      <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden p-4 md:p-8 lg:p-10 md:flex md:flex-col">
        <div className="w-full max-w-[1600px] mx-auto md:flex-1 md:min-h-0 md:flex md:flex-col">
          <PageHeader title={t('knowledge_title')} desc={t('knowledge_desc')}>
            <span
              id="knowledge-stats"
              className="text-xs text-slate-400 dark:text-slate-500 hidden sm:inline"
            >
              {statsText}
            </span>
            <span
              id="knowledge-action-status"
              className={classNames(
                'text-xs transition-opacity duration-200',
                status ? (status.error ? 'text-red-500' : 'text-primary-500') : 'opacity-0',
              )}
            >
              {status?.msg ?? ''}
            </span>
            <SegmentedTabs
              tabs={[
                { id: 'docs', label: t('knowledge_tab_docs'), icon: 'fa-folder-tree' },
                { id: 'graph', label: t('knowledge_tab_graph'), icon: 'fa-diagram-project' },
              ]}
              active={tab}
              onChange={(id) => setTab(id as 'docs' | 'graph')}
            />
            <AntDropdown
              trigger={['click']}
              placement="bottomRight"
              menu={{
                items: [
                  {
                    key: 'category',
                    label: t('knowledge_new_category'),
                    icon: <AppIcon className="fas fa-folder-plus" />,
                  },
                  {
                    key: 'document',
                    label: t('knowledge_new_document'),
                    icon: <AppIcon className="fas fa-file-circle-plus" />,
                  },
                  {
                    key: 'import',
                    label: t('knowledge_import_documents'),
                    icon: <AppIcon className="fas fa-file-arrow-up" />,
                  },
                ],
                onClick: ({ key }) => {
                  if (key === 'category') createCategory();
                  else if (key === 'document') createDocument();
                  else if (key === 'import') selectImportFiles();
                },
              }}
            >
              <AntButton type="primary" size="small">
                <AppIcon className="fas fa-plus" />
                <span>{t('knowledge_new')}</span>
                <AppIcon className="fas fa-chevron-down text-[9px] ml-0.5" />
              </AntButton>
            </AntDropdown>
            <input
              id="knowledge-import-input"
              ref={importInputRef}
              type="file"
              className="hidden"
              multiple
              accept=".md,.txt,text/markdown,text/plain"
              onChange={onImportChange}
            />
          </PageHeader>

          {/* Empty / loading state */}
          {showEmptyState ? (
            <EmptyState
              icon="fa-book"
              iconClass="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-400"
              title={initialized ? t('knowledge_empty_hint') : t('knowledge_loading')}
              desc={t('knowledge_loading_desc')}
            >
              {initialized ? (
                <div id="knowledge-empty-guide" className="mt-6 max-w-sm text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
                    {t('knowledge_empty_guide')}
                  </p>
                  <AntButton type="primary" onClick={() => navigateTo('chat')}>
                    <AppIcon className="fas fa-message text-xs mr-1" />
                    <span>{t('knowledge_go_chat')}</span>
                  </AntButton>
                </div>
              ) : null}
            </EmptyState>
          ) : null}

          {/* Documents panel */}
          <div
            id="knowledge-panel-docs"
            className={classNames(
              'md:flex-1 md:min-h-0',
              (!showDocsPanel || tab !== 'docs') && 'hidden',
              dragOver && 'knowledge-import-drag-over',
            )}
            onDragEnter={(e) => {
              if (e.dataTransfer?.types.includes('Files')) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer?.types.includes('Files')) {
                e.preventDefault();
                setDragOver(true);
              }
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const files = Array.from(e.dataTransfer?.files ?? []);
              if (files.length) openImportDialog(files);
            }}
          >
            <div className="flex flex-col md:flex-row gap-4 md:gap-6 md:h-full">
              {/* File tree */}
              <div
                id="knowledge-sidebar"
                className={classNames(
                  'w-full md:w-72 lg:w-80 flex-shrink-0 md:h-full',
                  mobileContentOpen && 'hidden md:block',
                )}
              >
                <Card className="overflow-hidden flex flex-col md:h-full">
                  <div className="px-4 py-3 border-b border-slate-200 dark:border-white/10 flex-shrink-0">
                    <div className="relative">
                      <Input
                        id="knowledge-search"
                        placeholder="Search..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        allowClear
                        prefix={<AppIcon className="fas fa-search text-slate-400 text-xs" />}
                      />
                    </div>
                  </div>
                  <div
                    id="knowledge-tree"
                    className="p-2 overflow-y-auto flex-1 max-h-[50vh] md:max-h-none"
                  >
                    {visibleRootFiles.map((f) => renderFile(f.name, f.title, 8))}
                    {renderGroups(tree, '', 0)}
                  </div>
                </Card>
              </div>

              {/* Content viewer */}
              <div className="flex-1 min-w-0 md:h-full">
                <div
                  id="knowledge-content-placeholder"
                  className={classNames(
                    'flex flex-col items-center justify-center py-20 md:h-full text-slate-400 dark:text-slate-500 bg-white dark:bg-[#1F1F1F] rounded-xl border border-slate-200 dark:border-white/10',
                    viewerOpen && 'hidden',
                  )}
                >
                  <AppIcon className="fas fa-file-lines text-3xl mb-3 opacity-40" />
                  <p className="text-sm">{t('knowledge_select_hint')}</p>
                </div>
                <div
                  id="knowledge-content-viewer"
                  className={classNames('md:h-full', !viewerOpen && 'hidden')}
                >
                  <Card className="overflow-hidden flex flex-col md:h-full">
                    <div className="flex items-center gap-3 px-4 md:px-5 py-3 border-b border-slate-200 dark:border-white/10 flex-shrink-0">
                      <AntButton
                        type="text"
                        size="small"
                        className="md:hidden"
                        onClick={() => setMobileContentOpen(false)}
                      >
                        <AppIcon className="fas fa-arrow-left text-xs" />
                      </AntButton>
                      <AppIcon className="fas fa-file-lines text-slate-400 text-sm hidden md:inline" />
                      <span
                        id="knowledge-viewer-title"
                        className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate"
                      >
                        {viewer?.title ?? ''}
                      </span>
                      <span
                        id="knowledge-viewer-path"
                        className="text-xs text-slate-400 dark:text-slate-500 ml-auto font-mono truncate hidden md:inline"
                      >
                        {viewer?.path ?? ''}
                      </span>
                    </div>
                    <div
                      id="knowledge-viewer-body"
                      className="p-4 md:p-5 overflow-y-auto flex-1 max-h-[60vh] md:max-h-none text-sm text-slate-700 dark:text-slate-200"
                    >
                      {viewerLoading ? (
                        <LoadingRow />
                      ) : (
                        <Markdown content={viewer?.content ?? ''} />
                      )}
                    </div>
                  </Card>
                </div>
              </div>
            </div>
          </div>

          {/* Graph panel */}
          <div
            id="knowledge-panel-graph"
            className={classNames(tab !== 'graph' && 'hidden')}
          >
            {graphOpened ? <KnowledgeGraphPanel onOpenNode={openGraphNode} /> : null}
          </div>
        </div>
      </div>

      {/* Knowledge action dialog */}
      <Modal
        open={!!dialog}
        onClose={closeDialog}
        maxWidth={dialog?.mode === 'document' ? 'max-w-3xl' : 'max-w-md'}
      >
        {dialog ? (
          <>
            <div className="p-6">
              <ModalHeader
                icon={dialog.icon}
                iconChip="bg-emerald-50 dark:bg-emerald-900/20"
                iconGlyph="text-emerald-500"
                title={dialog.title}
                subtitle={dialog.subtitle || undefined}
              />

              {dialog.mode === 'input' ? (
                <>
                  {dialog.label ? (
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {dialog.label}
                    </label>
                  ) : null}
                  <Input
                    autoFocus
                    value={dialog.value}
                    onChange={(e) => setDialog({ ...dialog, value: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void submitDialog();
                    }}
                  />
                </>
              ) : null}

              {dialog.mode === 'select' ? (
                <>
                  {dialog.label ? (
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {dialog.label}
                    </label>
                  ) : null}
                  <Dropdown
                    className="w-full"
                    options={dialog.choices.map((c) => ({ value: c, label: c }))}
                    value={dialog.value}
                    onChange={(value) => setDialog({ ...dialog, value })}
                    placeholder={dialog.choices[0] ?? '--'}
                  />
                </>
              ) : null}

              {dialog.mode === 'document' ? (
                <div className="space-y-3">
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/15 border border-emerald-100 dark:border-emerald-800/40 px-3 py-2">
                    <div className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-0.5">
                      {zh ? '目标分类' : 'Destination category'}
                    </div>
                    <div className="text-xs font-mono text-emerald-700 dark:text-emerald-300 break-all">
                      {`knowledge/${dialog.category}/`}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1.5">
                      {zh ? '文件名' : 'Filename'}
                    </label>
                    <Input
                      autoFocus
                      placeholder="note.md"
                      value={dialog.filename}
                      onChange={(e) => setDialog({ ...dialog, filename: e.target.value })}
                    />
                  </div>
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-sm font-medium text-slate-600 dark:text-slate-300">
                        {zh ? 'Markdown 内容' : 'Markdown content'}
                      </label>
                      <AntButton type="link" size="small" onClick={insertTemplate} style={{ padding: 0 }}>
                        {zh ? '插入模板' : 'Insert template'}
                      </AntButton>
                    </div>
                    <Input.TextArea
                      rows={14}
                      value={dialog.content}
                      onChange={(e) => setDialog({ ...dialog, content: e.target.value })}
                      className="font-mono"
                      style={{ minHeight: 320, lineHeight: 1.55 }}
                    />
                  </div>
                </div>
              ) : null}

              {dialog.hint ? (
                <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">{dialog.hint}</p>
              ) : null}
              {dialog.error ? <p className="mt-2 text-xs text-red-500">{dialog.error}</p> : null}
            </div>
            <ModalFooter>
              <SecondaryButton onClick={closeDialog}>{t('cancel')}</SecondaryButton>
              <PrimaryButton
                onClick={() => void submitDialog()}
                disabled={submitting || (dialog.mode === 'select' && dialog.choices.length === 0)}
              >
                {t('ok')}
              </PrimaryButton>
            </ModalFooter>
          </>
        ) : null}
      </Modal>
    </>
  );
}
