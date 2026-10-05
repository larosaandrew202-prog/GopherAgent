import { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox } from 'antd';
import { api, type LogEvent } from '@/api';
import { useI18n } from '@/i18n/useI18n';

type LevelKey = 'debug' | 'info' | 'warning' | 'error' | 'critical';
type LevelClass = '' | `log-line-${LevelKey}`;

interface LogLine {
  text: string;
  level: LevelClass;
}

/** Maximum number of rendered lines before the oldest are dropped. */
const MAX_LINES = 2000;

const LEVELS: Array<{ key: LevelKey; label: string; labelClass: string }> = [
  { key: 'debug', label: 'DEBUG', labelClass: 'text-slate-400' },
  { key: 'info', label: 'INFO', labelClass: 'text-blue-400' },
  { key: 'warning', label: 'WARNING', labelClass: 'text-yellow-400' },
  { key: 'error', label: 'ERROR', labelClass: 'text-red-400' },
  { key: 'critical', label: 'CRITICAL', labelClass: 'text-white font-bold' },
];

const DEFAULT_FILTERS: Record<LevelKey, boolean> = {
  debug: true,
  info: true,
  warning: true,
  error: true,
  critical: true,
};

/** Mirrors the original `logLevelClass()` detection order. */
function detectLevel(line: string): LevelClass {
  if (/\[CRITICAL\]/.test(line)) return 'log-line-critical';
  if (/\[ERROR\]/.test(line)) return 'log-line-error';
  if (/\[WARNING\]/.test(line)) return 'log-line-warning';
  if (/\[INFO\]/.test(line)) return 'log-line-info';
  if (/\[DEBUG\]/.test(line)) return 'log-line-debug';
  return '';
}

export function LogsView() {
  const { t } = useI18n();

  const [lines, setLines] = useState<LogLine[]>([]);
  const [errorText, setErrorText] = useState('');
  const [filters, setFilters] = useState<Record<LevelKey, boolean>>(DEFAULT_FILTERS);

  const outputRef = useRef<HTMLDivElement>(null);

  // Split a chunk into lines and append them, inheriting the previous line's
  // level for continuation lines that carry no explicit marker (as in the
  // original `appendLogLines`).
  const appendText = (text: string) => {
    const parts = text.split('\n');
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();

    setLines((prev) => {
      let lastLevel: LevelClass = '';
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].level) {
          lastLevel = prev[i].level;
          break;
        }
      }

      const appended = parts.map((part) => {
        const detected = detectLevel(part);
        const level = detected || lastLevel;
        if (detected) lastLevel = detected;
        return { text: part, level };
      });

      const merged = [...prev, ...appended];
      return merged.length > MAX_LINES ? merged.slice(merged.length - MAX_LINES) : merged;
    });
  };

  useEffect(() => {
    const sub = api.streamLogs((event: LogEvent) => {
      if (event.type === 'init') {
        setErrorText('');
        setLines([]);
        appendText(typeof event.line === 'string' ? event.line : '');
      } else if (event.type === 'line') {
        appendText(typeof event.line === 'string' ? event.line : '');
      } else if (event.type === 'error') {
        setLines([]);
        setErrorText(typeof event.line === 'string' ? event.line : 'Error loading logs');
      }
    });

    return () => sub.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to the bottom whenever new lines arrive.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  const hidden = useMemo(() => {
    const set = new Set<LevelClass>();
    (Object.keys(filters) as LevelKey[]).forEach((key) => {
      if (!filters[key]) set.add(`log-line-${key}`);
    });
    return set;
  }, [filters]);

  const toggleFilter = (key: LevelKey) => {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100">{t('logs_title')}</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{t('logs_desc')}</p>
          </div>
        </div>

        {/* Log Terminal */}
        <div className="bg-slate-900 rounded-xl border border-slate-700 overflow-hidden shadow-lg">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-800 border-b border-slate-700">
            <div className="flex gap-1.5">
              <span className="w-3 h-3 rounded-full bg-red-500/80" />
              <span className="w-3 h-3 rounded-full bg-amber-500/80" />
              <span className="w-3 h-3 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-xs text-slate-400 ml-2 font-mono">run.log</span>
            <div className="flex-1" />
            <div className="flex items-center gap-3 mr-2">
              {LEVELS.map(({ key, label, labelClass }) => (
                <Checkbox
                  key={key}
                  checked={filters[key]}
                  onChange={() => toggleFilter(key)}
                >
                  <span className={`text-xs ${labelClass}`}>{label}</span>
                </Checkbox>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs text-slate-500">{t('logs_live')}</span>
            </div>
          </div>

          <div
            id="log-output"
            ref={outputRef}
            className="p-4 overflow-y-auto font-mono text-xs leading-relaxed text-slate-300 whitespace-pre-wrap break-all"
            style={{ height: 'calc(100vh - 272px)' }}
          >
            {errorText ? (
              <p className="text-red-400">{errorText}</p>
            ) : lines.length === 0 ? (
              <p className="text-slate-500">{t('logs_coming_msg')}</p>
            ) : (
              lines.map((line, i) => (
                <span
                  key={i}
                  className={`log-line ${line.level}`}
                  style={hidden.has(line.level) ? { display: 'none' } : undefined}
                >
                  {line.text}
                  {'\n'}
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
