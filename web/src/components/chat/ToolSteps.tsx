import { AppIcon } from '@/components/ui/AppIcon';
import { GlassSurface } from '@/components/ui/LiquidGlass';
import { useState } from 'react';
import { Button } from 'antd';
import type { ToolStep } from '@/api/types';
import { useI18n } from '@/i18n/useI18n';
import { classNames } from '@/lib/format';
import { Markdown } from './Markdown';

const TOOL_ICONS: Record<string, string> = {
  read: 'fa-file-lines',
  write: 'fa-file-pen',
  edit: 'fa-pen-to-square',
  bash: 'fa-terminal',
  ls: 'fa-folder-tree',
  web_search: 'fa-magnifying-glass',
  vision: 'fa-eye',
  memory: 'fa-brain',
  subagent: 'fa-robot',
};

function summarizeArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    const obj = args as Record<string, unknown>;
    const parts: string[] = [];
    for (const [k, v] of Object.entries(obj)) {
      parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
      if (parts.join(', ').length > 120) break;
    }
    return parts.join(', ').slice(0, 140);
  } catch {
    return '';
  }
}

function ToolItem({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const running = step.status === 'running';
  const failed = step.status === 'error';
  const icon = TOOL_ICONS[step.name ?? ''] ?? 'fa-wrench';
  const resultText =
    typeof step.result === 'string' ? step.result : step.result ? JSON.stringify(step.result, null, 2) : '';

  return (
    <GlassSurface className={classNames('agent-step', running && 'tool-streaming')} ring={12} pull={6} blur={8}>
      <Button
        type="text"
        block
        onClick={() => setOpen((v) => !v)}
        className="!h-auto !justify-start !gap-2 !p-0 text-xs text-slate-500 dark:text-slate-400"
      >
        <AppIcon className={classNames('fas flex-shrink-0 tool-icon', icon, running ? 'text-primary-400 animate-pulse' : failed ? 'text-red-400' : 'text-slate-400')} />
        <span className="font-medium text-slate-600 dark:text-slate-300">{step.name}</span>
        {!open ? <span className="truncate opacity-70">{summarizeArgs(step.args)}</span> : null}
        {running ? <span className="tool-live-output text-primary-400" /> : null}
        <AppIcon className={classNames('fas fa-chevron-right text-[9px] ml-auto transition-transform', open && 'rotate-90')} />
      </Button>
      {open ? (
        <div className="mt-1.5 pl-6 space-y-1.5">
          {step.args ? (
            <div className="tool-detail-section">
              <div className="tool-detail-label">args</div>
              <pre className="tool-detail-content">{typeof step.args === 'string' ? step.args : JSON.stringify(step.args, null, 2)}</pre>
            </div>
          ) : null}
          {resultText ? (
            <div className="tool-detail-section">
              <div className="tool-detail-label">result</div>
              <div className={classNames('tool-detail-content', failed && 'tool-error-text')}>{resultText}</div>
            </div>
          ) : null}
        </div>
      ) : null}
    </GlassSurface>
  );
}

export function ToolSteps({ reason, steps }: { reason?: string; steps?: ToolStep[] }) {
  const { t } = useI18n();
  const [thinkingOpen, setThinkingOpen] = useState(false);
  if ((!steps || steps.length === 0) && !reason) return null;

  return (
    <div className="agent-steps">
      {reason ? (
        <GlassSurface className={classNames('agent-step agent-thinking-step', thinkingOpen && 'expanded')} ring={12} pull={6} blur={8}>
          <Button
            type="text"
            block
            className="thinking-header !h-auto !justify-start !gap-2 !p-0"
            onClick={() => setThinkingOpen((v) => !v)}
          >
            <AppIcon className="fas fa-lightbulb text-amber-400 flex-shrink-0" />
            <span className="thinking-summary">{t('thinking_done')}</span>
            <AppIcon className={classNames('fas fa-chevron-right thinking-chevron', thinkingOpen && 'rotate-90')} />
          </Button>
          {thinkingOpen ? (
            <div className="thinking-full">
              <Markdown content={reason} />
            </div>
          ) : null}
        </GlassSurface>
      ) : null}
      {steps?.map((step, i) => (
        <ToolItem key={step.tool_call_id ?? `${step.name}-${i}`} step={step} />
      ))}
    </div>
  );
}
