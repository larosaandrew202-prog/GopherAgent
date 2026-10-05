import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { SkillInfo, ToolInfo } from '@/api';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from '@/store/ui';
import {
  Badge,
  EmptyState,
  LoadingRow,
  PageHeader,
  Toggle,
} from '@/components/ui/primitives';
import { classNames } from '@/lib/format';

/* Tool icon map ported from console.js::TOOL_ICONS. */
const TOOL_ICONS: Record<string, string> = {
  bash: 'fa-terminal',
  edit: 'fa-pen-to-square',
  read: 'fa-file-lines',
  write: 'fa-file-pen',
  ls: 'fa-folder-open',
  send: 'fa-paper-plane',
  web_search: 'fa-magnifying-glass',
  browser: 'fa-globe',
  env_config: 'fa-key',
  scheduler: 'fa-clock',
  memory_get: 'fa-brain',
  memory_search: 'fa-brain',
};

function getToolIcon(name: string): string {
  return TOOL_ICONS[name] || 'fa-wrench';
}

/** Resolve a field that may be a plain string or a { lang: text } map. */
function localized(value: string | Record<string, string> | undefined, lang: string): string {
  if (!value) return '--';
  if (typeof value === 'string') return value || '--';
  return value[lang] || value.en || value.zh || '--';
}

/** The original renders `sk.display_name || sk.name`; `title` is the typed
 *  equivalent returned by the mock/backend. */
function skillLabel(sk: SkillInfo, lang: string): string {
  const dn = typeof sk.display_name === 'string' ? sk.display_name : '';
  if (dn) return dn;
  if (typeof sk.title === 'string' && sk.title) return sk.title;
  if (sk.title && typeof sk.title === 'object') {
    const map = sk.title as Record<string, string>;
    return map[lang] || map.en || map.zh || sk.name;
  }
  return sk.name;
}

type Status = 'loading' | 'ok' | 'error';

const EMPTY_TOOLS = { zh: '暂无内置工具', en: 'No built-in tools' };
const EMPTY_SKILLS = { zh: '暂无技能', en: 'No skills found' };
const FAILED = { zh: '加载失败', en: 'Failed to load' };

export function SkillsView() {
  const { t, lang } = useI18n();
  const { toast } = useUI();
  const isZh = lang !== 'en';

  const [tools, setTools] = useState<ToolInfo[]>([]);
  const [toolsStatus, setToolsStatus] = useState<Status>('loading');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillsStatus, setSkillsStatus] = useState<Status>('loading');
  const [toggling, setToggling] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    api
      .getTools()
      .then((data) => {
        if (!alive) return;
        if (data.status !== 'success') {
          setToolsStatus('error');
          return;
        }
        setTools(data.tools || []);
        setToolsStatus('ok');
      })
      .catch(() => {
        if (alive) setToolsStatus('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getSkills()
      .then((data) => {
        if (!alive) return;
        if (data.status !== 'success') {
          setSkillsStatus('error');
          return;
        }
        setSkills(data.skills || []);
        setSkillsStatus('ok');
      })
      .catch(() => {
        if (alive) setSkillsStatus('error');
      });
    return () => {
      alive = false;
    };
  }, []);

  const handleToggle = useCallback(
    async (sk: SkillInfo) => {
      const next = !sk.enabled;
      setToggling((prev) => new Set(prev).add(sk.name));
      try {
        const res = await api.toggleSkill(sk.name, next);
        if (res.status === 'success') {
          setSkills((list) =>
            list.map((s) => (s.name === sk.name ? { ...s, enabled: next } : s)),
          );
        } else {
          toast(t('skill_toggle_error'), 'error');
        }
      } catch {
        toast(t('skill_toggle_error'), 'error');
      } finally {
        setToggling((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(sk.name);
          return nextSet;
        });
      }
    },
    [t, toast],
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <PageHeader title={t('skills_title')} desc={t('skills_desc')} />

        {/* Built-in Tools Section */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('tools_section_title')}
            </span>
            {toolsStatus === 'ok' && tools.length > 0 ? (
              <Badge>{tools.length}</Badge>
            ) : null}
          </div>

          {toolsStatus === 'loading' ? <LoadingRow label={t('tools_loading')} /> : null}

          {toolsStatus === 'error' ? (
            <div className="flex items-center gap-2 py-4 text-slate-400 dark:text-slate-500 text-sm">
              <span>{isZh ? FAILED.zh : FAILED.en}</span>
            </div>
          ) : null}

          {toolsStatus === 'ok' && tools.length === 0 ? (
            <div className="flex items-center gap-2 py-4 text-slate-400 dark:text-slate-500 text-sm">
              <span>{isZh ? EMPTY_TOOLS.zh : EMPTY_TOOLS.en}</span>
            </div>
          ) : null}

          {toolsStatus === 'ok' && tools.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {tools.map((tool) => (
                <div
                  key={tool.name}
                  className="bg-white dark:bg-[#1F1F1F] rounded-xl border border-slate-200 dark:border-white/10 p-4 flex items-start gap-3"
                >
                  <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center flex-shrink-0">
                    <AppIcon
                      className={classNames(
                        'fas text-blue-500 dark:text-blue-400 text-sm',
                        getToolIcon(tool.name),
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-slate-700 dark:text-slate-200 font-mono">
                        {tool.name}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 line-clamp-2">
                      {localized(tool.description, lang)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {/* Skills Section */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
              {t('skills_section_title')}
            </span>
            {skillsStatus === 'ok' && skills.length > 0 ? (
              <Badge>{skills.length}</Badge>
            ) : null}
          </div>

          {skillsStatus === 'loading' ? (
            <EmptyState
              icon="fa-bolt"
              iconClass="bg-amber-50 dark:bg-amber-900/20 text-amber-400"
              title={t('skills_loading')}
              desc={t('skills_loading_desc')}
            />
          ) : null}

          {skillsStatus === 'error' ? (
            <EmptyState
              icon="fa-bolt"
              iconClass="bg-amber-50 dark:bg-amber-900/20 text-amber-400"
              title={isZh ? FAILED.zh : FAILED.en}
            />
          ) : null}

          {skillsStatus === 'ok' && skills.length === 0 ? (
            <EmptyState
              icon="fa-bolt"
              iconClass="bg-amber-50 dark:bg-amber-900/20 text-amber-400"
              title={isZh ? EMPTY_SKILLS.zh : EMPTY_SKILLS.en}
              desc={t('skills_loading_desc')}
            />
          ) : null}

          {skillsStatus === 'ok' && skills.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              {skills.map((sk) => (
                <div
                  key={sk.name}
                  className="bg-white dark:bg-[#1F1F1F] rounded-xl border border-slate-200 dark:border-white/10 p-4 flex items-start gap-3 transition-opacity"
                  style={toggling.has(sk.name) ? { opacity: 0.5 } : undefined}
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-900/20 flex items-center justify-center flex-shrink-0">
                    <AppIcon
                      className={classNames(
                        'fas fa-bolt text-sm',
                        sk.enabled
                          ? 'text-primary-400'
                          : 'text-slate-300 dark:text-slate-600',
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-sm text-slate-700 dark:text-slate-200 truncate flex-1">
                        {skillLabel(sk, lang)}
                      </span>
                      <Toggle
                        checked={sk.enabled}
                        onChange={() => void handleToggle(sk)}
                      />
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-500 line-clamp-2">
                      {localized(sk.description, lang)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
