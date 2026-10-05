import { AppIcon } from '@/components/ui/AppIcon';
import { Button, Dropdown } from 'antd';
import { useI18n } from '@/i18n/useI18n';
import { useTheme } from '@/theme/useTheme';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { useWorkspace } from '@/store/workspace';
import { useAuth } from '@/store/auth';
import { LANGS, LANG_LABELS, LANG_SHORT } from '@/i18n';
import { VIEW_META } from '@/lib/constants';

/** Icon-only antd text button that keeps the compact square header shape. */
const ICON_BTN = '!p-2 !h-auto';

export function Header() {
  const { t, lang, setLang } = useI18n();
  const { theme, toggleTheme } = useTheme();
  const { view, toggleSidebar, sessionPanelOpen, toggleSessionPanel } = useUI();
  const { currentProject } = useChat();
  const { openWorkspace, loadTree } = useWorkspace();
  const { logoutVisible, logout } = useAuth();
  const meta = VIEW_META[view];

  return (
    <header className="h-14 flex items-center gap-3 px-4 border-b border-slate-200 dark:border-white/10 bg-white dark:bg-[#1F1F1F] flex-shrink-0 z-10">
      <Button
        type="text"
        className={`lg:hidden ${ICON_BTN}`}
        onClick={toggleSidebar}
        aria-label="Menu"
      >
        <AppIcon className="fas fa-bars text-slate-600 dark:text-slate-300" />
      </Button>

      {view === 'chat' ? (
        <Button
          type="text"
          className={sessionPanelOpen ? `${ICON_BTN} bg-slate-100 dark:bg-white/10` : ICON_BTN}
          onClick={toggleSessionPanel}
          aria-label={t('session_history')}
        >
          <AppIcon className="fas fa-clock-rotate-left text-slate-500 dark:text-slate-400" />
        </Button>
      ) : null}

      {view === 'chat' ? (
        <Button
          type="text"
          className={ICON_BTN}
          onClick={() => {
            void loadTree('');
            openWorkspace();
          }}
          data-tooltip={t('ws_toggle')}
          data-tooltip-pos="bottom"
          aria-label={t('ws_toggle')}
        >
          <AppIcon className="fas fa-folder-tree text-slate-500 dark:text-slate-400" />
        </Button>
      ) : null}

      <div className="hidden lg:flex items-center gap-2 text-sm min-w-0">
        <span className="text-slate-400 dark:text-slate-500 truncate">{t(meta.groupKey)}</span>
        <AppIcon className="fas fa-chevron-right text-[10px] text-slate-300 dark:text-slate-600" />
        <span className="font-medium text-slate-700 dark:text-slate-200 truncate">{t(meta.labelKey)}</span>
        {view === 'chat' && currentProject ? (
          <>
            <AppIcon className="fas fa-chevron-right text-[10px] text-slate-300 dark:text-slate-600" />
            <span className="text-xs text-slate-400 dark:text-slate-500 font-mono truncate">{currentProject}</span>
          </>
        ) : null}
      </div>

      <div className="flex-1" />

      {/* Language selector */}
      <Dropdown
        trigger={['click']}
        placement="bottomRight"
        menu={{
          items: LANGS.map((code) => ({ key: code, label: LANG_LABELS[code] })),
          onClick: ({ key }) => setLang(key as (typeof LANGS)[number]),
          selectedKeys: [lang],
        }}
      >
        <Button type="text">
          <AppIcon className="fas fa-globe text-xs" />
          <span>{LANG_SHORT[lang]}</span>
          <AppIcon className="fas fa-chevron-down text-[10px] opacity-60" />
        </Button>
      </Dropdown>

      <Button type="text" className={ICON_BTN} onClick={toggleTheme} aria-label="Theme">
        <AppIcon className={theme === 'dark' ? 'fas fa-moon' : 'fas fa-sun'} />
      </Button>

      {logoutVisible ? (
        <Button
          type="text"
          danger
          className={ICON_BTN}
          onClick={logout}
          title={t('logout')}
        >
          <AppIcon className="fas fa-sign-out-alt text-base" />
        </Button>
      ) : null}
    </header>
  );
}
