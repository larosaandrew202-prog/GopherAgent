import type { ReactNode } from 'react';
import { useUI } from '@/store/ui';
import { useAuth } from '@/store/auth';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { SessionPanel } from './SessionPanel';
import { LoginOverlay } from './LoginOverlay';
import { ModalHost } from './ModalHost';
import { ChatView } from '@/components/chat/ChatView';
import { ConfigView } from '@/views/config/ConfigView';
import { SkillsView } from '@/views/skills/SkillsView';
import { MemoryView } from '@/views/memory/MemoryView';
import { KnowledgeView } from '@/views/knowledge/KnowledgeView';
import { ChannelsView } from '@/views/channels/ChannelsView';
import { TasksView } from '@/views/tasks/TasksView';
import { LogsView } from '@/views/logs/LogsView';
import type { ViewId } from '@/lib/constants';

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
      <div id="app" className={hidden ? 'hidden' : 'relative flex h-screen'}>
        <div aria-hidden="true" className="sidebar-ambient pointer-events-none absolute left-2 top-2 bottom-2 w-52 rounded-2xl" />
        <Sidebar />
        <SessionPanel />
        <div id="main-content" className="flex-1 flex flex-col min-w-0 h-screen">
          <Header />
          <div id="content-area" className="flex-1 overflow-hidden">
            <div id={`view-${view}`} className="view active">
              {renderView(view)}
            </div>
          </div>
        </div>
      </div>
      <ModalHost />
    </>
  );
}
