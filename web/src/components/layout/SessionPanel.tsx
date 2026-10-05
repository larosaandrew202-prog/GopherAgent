import { AppIcon } from '@/components/ui/AppIcon';
import { useEffect, useMemo, useState } from 'react';
import { Button, Dropdown, Spin, type MenuProps } from 'antd';
import { useChat } from '@/store/chat';
import { useUI } from '@/store/ui';
import { useI18n } from '@/i18n/useI18n';
import type { Session } from '@/api/types';
import { classNames, timeGroup } from '@/lib/format';

interface Group {
  key: string;
  label: string;
  icon: string;
  sessions: Session[];
  project?: boolean;
}

export function SessionPanel() {
  const { t } = useI18n();
  const { view, sessionPanelOpen, closeSessionPanel, confirm, prompt } = useUI();
  const {
    sessions,
    sessionId,
    loadSessions,
    sessionsLoading,
    newChat,
    switchSession,
    renameSession,
    deleteSession,
    togglePin,
  } = useChat();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  // History is a chat-only affordance: never show it on other views.
  const panelVisible = sessionPanelOpen && view === 'chat';

  useEffect(() => {
    if (panelVisible && sessions.length === 0) void loadSessions(true);
  }, [panelVisible, sessions.length, loadSessions]);

  const groups = useMemo<Group[]>(() => {
    const pinned = sessions.filter((s) => s.pinned);
    const rest = sessions.filter((s) => !s.pinned);
    const byProject = new Map<string, Session[]>();
    const loose: Session[] = [];
    for (const s of rest) {
      if (s.project_dir) {
        const list = byProject.get(s.project_dir) ?? [];
        list.push(s);
        byProject.set(s.project_dir, list);
      } else {
        loose.push(s);
      }
    }
    const result: Group[] = [];
    if (pinned.length) {
      result.push({ key: '__pinned__', label: t('session_pinned_group'), icon: 'fa-thumbtack', sessions: pinned });
    }
    for (const [dir, list] of byProject) {
      const name = list[0]?.project_name || dir.split(/[\\/]/).pop() || dir;
      result.push({ key: `project:${dir}`, label: name, icon: 'fa-folder', sessions: list, project: true });
    }
    const buckets: Record<string, Session[]> = {};
    for (const s of loose) {
      const label = timeGroup(s.updated_at ?? s.last_message_at ?? s.created_at, {
        today: t('today'),
        yesterday: t('yesterday'),
        earlier: t('earlier'),
      });
      (buckets[label] ??= []).push(s);
    }
    for (const label of [t('today'), t('yesterday'), t('earlier')]) {
      if (buckets[label]?.length) {
        result.push({ key: `time:${label}`, label, icon: 'fa-clock', sessions: buckets[label] });
      }
    }
    return result;
  }, [sessions, t]);

  const onRename = async (s: Session) => {
    const next = await prompt({ title: t('rename_session'), initialValue: s.title || '' });
    if (next != null && next.trim()) await renameSession(s.session_id, next.trim());
  };

  const onDelete = async (s: Session) => {
    const ok = await confirm({
      title: t('delete_session_title'),
      message: t('delete_session_confirm'),
      danger: true,
    });
    if (ok) await deleteSession(s.session_id);
  };

  const sessionMenu = (s: Session): MenuProps => ({
    items: [
      {
        key: 'pin',
        label: t(s.pinned ? 'unpin_session' : 'pin_session'),
        icon: <AppIcon className="fas fa-thumbtack" />,
      },
      {
        key: 'rename',
        label: t('rename_session'),
        icon: <AppIcon className="fas fa-pen" />,
      },
      { type: 'divider' },
      {
        key: 'delete',
        danger: true,
        label: t('delete_session_title'),
        icon: <AppIcon className="fas fa-trash-can" />,
      },
    ],
    onClick: ({ key, domEvent }) => {
      domEvent.stopPropagation();
      if (key === 'pin') void togglePin(s.session_id);
      else if (key === 'rename') void onRename(s);
      else if (key === 'delete') void onDelete(s);
    },
  });

  return (
    <>
      <aside className={classNames('session-panel', !panelVisible && 'hidden')}>
        <div className="session-panel-header">
          <span className="session-panel-title">{t('session_history')}</span>
          <Button
            type="text"
            size="small"
            style={{ width: 28, height: 28, padding: 0 }}
            onClick={closeSessionPanel}
            title="Close"
          >
            <AppIcon className="fas fa-times" />
          </Button>
        </div>
        <div className="px-3 pt-2.5">
          <Button
            block
            type="dashed"
            icon={<AppIcon className="fas fa-plus" />}
            onClick={() => newChat()}
          >
            {t('new_chat')}
          </Button>
        </div>
        <div className="session-list">
          {sessionsLoading && sessions.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <Spin size="small" />
            </div>
          ) : null}
          {groups.map((group) => {
            const isCollapsed = collapsed[group.key];
            return (
              <div key={group.key}>
                <div
                  className={classNames('session-group-label', group.project && 'session-group-project')}
                  onClick={
                    group.project
                      ? () => setCollapsed((c) => ({ ...c, [group.key]: !isCollapsed }))
                      : undefined
                  }
                >
                  {group.project ? (
                    <AppIcon className={classNames('fas fa-chevron-down session-group-caret', isCollapsed && 'collapsed')} />
                  ) : null}
                  <AppIcon className={classNames('fas session-group-icon', group.icon)} />
                  <span className="session-group-name">{group.label}</span>
                  <span className="session-group-count">{group.sessions.length}</span>
                </div>
                {!isCollapsed
                  ? group.sessions.map((s) => (
                      <div
                        key={s.session_id}
                        className={classNames(
                          'session-item',
                          s.session_id === sessionId && 'active',
                          s.pinned && 'pinned',
                          group.project && 'session-item-indent',
                        )}
                        onClick={() => switchSession(s.session_id)}
                      >
                        <AppIcon className={classNames('fas session-icon', s.pinned ? 'fa-thumbtack' : 'fa-message')} />
                        <span className="session-title" title={s.title || t('untitled_session')}>
                          {s.title || t('untitled_session')}
                        </span>
                        <Dropdown trigger={['click']} menu={sessionMenu(s)} placement="bottomRight">
                          <button
                            type="button"
                            className="session-more"
                            onClick={(e) => e.stopPropagation()}
                            aria-label={t('session_history')}
                          >
                            <AppIcon className="fas fa-ellipsis" />
                          </button>
                        </Dropdown>
                      </div>
                    ))
                  : null}
              </div>
            );
          })}
        </div>
      </aside>
      {panelVisible ? (
        <div className="session-panel-overlay lg:hidden" onClick={closeSessionPanel} />
      ) : null}
    </>
  );
}
