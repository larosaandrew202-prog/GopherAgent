import { lazy, Suspense, type ReactNode } from 'react';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SessionPanel } from './SessionPanel';
import { LoginOverlay } from './LoginOverlay';
import { ModalHost } from './ModalHost';
import { ChatView } from '@/components/chat/ChatView';
import type { ViewId } from '@/lib/constants';

// Secondary views live in their own chunks and are fetched on first visit.
// Chat is the primary view, so it stays eager (no loading flash on startup).
const ConfigView = lazy(() => import('@/views/config/ConfigView').then((m) => ({ default: m.ConfigView })));
const SkillsView = lazy(() => import('@/views/skills/SkillsView').then((m) => ({ default: m.SkillsView })));
const MemoryView = lazy(() => import('@/views/memory/MemoryView').then((m) => ({ default: m.MemoryView })));
const KnowledgeView = lazy(() => import('@/views/knowledge/KnowledgeView').then((m) => ({ default: m.KnowledgeView })));
const ChannelsView = lazy(() => import('@/views/channels/ChannelsView').then((m) => ({ default: m.ChannelsView })));
const TasksView = lazy(() => import('@/views/tasks/TasksView').then((m) => ({ default: m.TasksView })));
const LogsView = lazy(() => import('@/views/logs/LogsView').then((m) => ({ default: m.LogsView })));

function renderView(view: ViewId): ReactNode {
  switch (view) {
    case 'chat':
      return <ChatView />;
    case 'config':
      return <ConfigView />;
    case 'skills':
      return <SkillsView />;
    case 'memory':
      return <MemoryView />;
    case 'knowledge':
      return <KnowledgeView />;
    case 'channels':
      return <ChannelsView />;
    case 'tasks':
      return <TasksView />;
    case 'logs':
      return <LogsView />;
    default:
      return null;
  }
}

export function Shell() {
  const { view } = useUI();
  const { state } = useAuth();
  const hidden = state === 'required';

  return (
    <>
      <LoginOverlay />
      <div id="app" className={hidden ? 'hidden' : 'relative flex h-dvh'}>
        <Sidebar />
        <SessionPanel />
        <div id="main-content" className="flex-1 flex flex-col min-w-0 h-full">
          <Header />
          <div id="content-area" className="flex-1 overflow-hidden">
            <div id={`view-${view}`} className="view active">
              <Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">加载中…</div>}>
                {renderView(view)}
              </Suspense>
            </div>
          </div>
        </div>
      </div>
      <ModalHost />
    </>
  );
}
