import { AppIcon } from '@/components/ui/AppIcon';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from 'antd';
import { useI18n } from '@/i18n/useI18n';
import { BrandMark } from '@/components/ui/BrandMark';
import { LiquidGlassFilter, useLiquidGlass } from '@/components/ui/LiquidGlass';
import { useUI } from '@/store/ui';
import { SIDEBAR_GROUPS, VIEW_META } from '@/lib/constants';
import { classNames } from '@/lib/format';

export function Sidebar() {
  const { t } = useI18n();
  const { view, navigateTo, sidebarOpen, closeSidebar } = useUI();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const asideRef = useRef<HTMLElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const glass = useLiquidGlass({ width: size.w, height: size.h, ring: 28, pull: 20, blur: 8 });

  // Liquid-glass highlight that slides to whichever menu item is active.
  const navRef = useRef<HTMLElement>(null);
  const [ind, setInd] = useState({ top: 0, left: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const compute = () => {
      const active = nav.querySelector<HTMLElement>('.sidebar-item.active');
      if (!active) return;
      const nr = nav.getBoundingClientRect();
      const ar = active.getBoundingClientRect();
      setInd({
        top: ar.top - nr.top + nav.scrollTop,
        left: ar.left - nr.left,
        width: ar.width,
        height: ar.height,
      });
    };
    compute();
    // Re-align once the group collapse/expand max-height animation settles.
    const timer = window.setTimeout(compute, 380);
    return () => window.clearTimeout(timer);
  }, [view, collapsed, size.w, size.h]);
  const indicatorGlass = useLiquidGlass({ width: ind.width, height: ind.height, ring: 14, pull: 7, blur: 5 });

  return (
    <>
      <LiquidGlassFilter {...glass} />
      <LiquidGlassFilter {...indicatorGlass} />
      <aside
        ref={asideRef}
        style={glass.style}
        className={classNames(
          'sidebar-glass z-50 w-52 flex flex-col rounded-2xl overflow-hidden',
          'border border-[#eae8e7] dark:border-white/10 shadow-xl shadow-black/5 dark:shadow-black/40',
          'bg-[#f9f8f4]/70 text-slate-600 dark:bg-[#141414]/60 dark:text-neutral-400',
          'transform transition-transform duration-300 ease-in-out',
          // Mobile: floating overlay panel inset from the viewport edges.
          'fixed left-2 top-2 bottom-2',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: in-flow floating panel with a margin on every side.
          'lg:relative lg:left-auto lg:top-auto lg:bottom-auto lg:translate-x-0',
          'lg:h-[calc(100vh-1rem)] lg:my-2 lg:ml-2 lg:mr-2',
        )}
      >
        <div className="flex items-center gap-3 px-5 h-14 border-b border-[#eae8e7] dark:border-white/10 flex-shrink-0">
          <BrandMark className="w-8 h-8" />
          <div className="flex flex-col min-w-0">
            <span className="font-semibold text-sm truncate text-slate-800 dark:text-white">Gopher Agent</span>
            <span className="text-xs text-slate-400 dark:text-neutral-500">{t('console')}</span>
          </div>
        </div>

        <nav ref={navRef} className="relative flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {SIDEBAR_GROUPS.map((group) => {
            const isOpen = collapsed[group.key] !== true;
            return (
              <div key={group.key} className={classNames('menu-group', isOpen && 'open')}>
                <Button
                  type="text"
                  block
                  onClick={() => setCollapsed((c) => ({ ...c, [group.key]: isOpen }))}
                  className="!h-auto !justify-start !gap-2 !px-3 !py-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:!text-slate-800 dark:text-neutral-500 dark:hover:!text-neutral-300"
                >
                  <AppIcon className="fas fa-chevron-right text-[10px] chevron" />
                  <span>{t(group.labelKey)}</span>
                </Button>
                <div className="menu-group-items pl-2">
                  {group.views.map((viewId) => {
                    const meta = VIEW_META[viewId];
                    const Icon = meta.icon;
                    return (
                      <a
                        key={viewId}
                        onClick={() => {
                          navigateTo(viewId);
                          closeSidebar();
                        }}
                        className={classNames(
                          'sidebar-item relative z-[1] flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer',
                          'transition-all duration-150 text-[14px] text-slate-600 hover:bg-black/5 hover:text-slate-900 dark:text-neutral-400 dark:hover:bg-white/5 dark:hover:text-neutral-200',
                          view === viewId && 'active',
                        )}
                        data-view={viewId}
                      >
                        <span className="item-icon w-5 flex items-center justify-center">
                          <Icon size={15} strokeWidth={2} />
                        </span>
                        <span>{t(meta.labelKey)}</span>
                      </a>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {ind.width > 0 ? (
            <span
              aria-hidden="true"
              className="sidebar-glass-indicator"
              style={{
                ...indicatorGlass.style,
                transform: `translate(${ind.left}px, ${ind.top}px)`,
                width: ind.width,
                height: ind.height,
              }}
            />
          ) : null}
        </nav>

        <div className="px-4 py-3 border-t border-[#eae8e7] dark:border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-neutral-600">
            <AppIcon className="fas fa-circle text-[6px] text-primary-400" />
            <span>Gopher Agent</span>
          </div>
        </div>
      </aside>

      {sidebarOpen ? (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden cursor-pointer"
          onClick={closeSidebar}
        />
      ) : null}
    </>
  );
}
