import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api';
import type { ChannelInfo, ScheduledTask } from '@/api';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from '@/store/ui';
import {
  Card,
  EmptyState,
  Field,
  LoadingRow,
  Modal,
  ModalHeader,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  TextArea,
  TextField,
  Toggle,
  type DropdownOption,
} from '@/components/ui/primitives';
import { Button as AntButton, Select as AntSelect } from 'antd';
import { classNames } from '@/lib/format';

/* ------------------------------------------------------------------ types */

type ScheduleType = 'cron' | 'interval' | 'once';
type ActionType = 'send_message' | 'agent_task';

/* ---------------------------------------------------------------- helpers */

function channelLabel(ch: ChannelInfo, lang: string): string {
  const label = ch.label;
  if (typeof label === 'string') return label || ch.name;
  if (label && typeof label === 'object') {
    const obj = label as Record<string, string>;
    return obj[lang] || obj.en || ch.name;
  }
  return ch.name;
}

function formatDateTime(value: number | string | undefined): string {
  if (value == null || value === '' || value === 0) return '--';
  // Backends may send Unix seconds or milliseconds; normalize seconds to ms.
  const normalized = typeof value === 'number' && value < 1e12 ? value * 1000 : value;
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? '--' : d.toLocaleString();
}

function intervalText(seconds: number): string {
  if (!seconds || seconds <= 0) return '0s';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function nextRunLabel(lang: string): string {
  if (lang === 'en') return 'Next run';
  if (lang === 'zh-Hant') return '下次執行';
  return '下次执行';
}

function emptyLabel(lang: string): string {
  if (lang === 'en') return 'No scheduled tasks';
  if (lang === 'zh-Hant') return '暫無定時任務';
  return '暂无定时任务';
}

function ScheduleLabel({ task }: { task: ScheduledTask }) {
  const { t } = useI18n();
  const schedule = task.schedule ?? {};
  if (schedule.type === 'cron') {
    return <span className="text-xs font-mono text-slate-400">{schedule.expression || ''}</span>;
  }
  if (schedule.type === 'interval') {
    return <span className="text-xs text-slate-400">{intervalText(schedule.seconds || 0)}</span>;
  }
  const at = (schedule.run_at ?? schedule.time) as string | number | undefined;
  return (
    <span className="text-xs text-slate-400">
      {at ? formatDateTime(at) : schedule.type || t('task_schedule_once')}
    </span>
  );
}

/* --------------------------------------------------------------- task card */

function TaskCard({
  task,
  running,
  onOpen,
  onToggle,
  onRun,
}: {
  task: ScheduledTask;
  running: boolean;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
  onRun: () => void;
}) {
  const { t, lang } = useI18n();
  const enabled = task.enabled !== false;
  const action = task.action ?? {};
  const content = action.content || action.task_description || '';

  return (
    <Card
      className={classNames('p-4 cursor-pointer', !enabled && 'opacity-50')}
      onClick={onOpen}
    >
      <div className="flex items-center gap-2 mb-2">
        <span
          className={classNames(
            'w-2 h-2 rounded-full',
            enabled ? 'bg-primary-400' : 'bg-slate-300 dark:bg-slate-600',
          )}
        />
        <span className="font-medium text-sm text-slate-700 dark:text-slate-200 truncate">
          {task.name || task.id || '--'}
        </span>
        <div className="flex-1" />
        <ScheduleLabel task={task} />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-2 line-clamp-2">{content}</p>
      <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
        <span>
          <AppIcon className="fas fa-clock mr-1" />
          {nextRunLabel(lang)}: {formatDateTime(task.next_run_at as number | string | undefined)}
        </span>
        <div className="flex-1" />
        <AntButton
          type="text"
          size="small"
          disabled={running}
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
        >
          <AppIcon className={classNames('fas mr-1', running ? 'fa-spinner fa-spin' : 'fa-play')} />
          {t('task_run_now')}
        </AntButton>
        <div onClick={(e) => e.stopPropagation()}>
          <Toggle checked={enabled} onChange={onToggle} />
        </div>
      </div>
    </Card>
  );
}

/* ----------------------------------------------------------- edit modal */

function TaskEditModal({
  task,
  onClose,
  onSaved,
}: {
  task: ScheduledTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const { confirm } = useUI();

  const schedule = task.schedule ?? {};
  const action = task.action ?? {};

  const [name, setName] = useState(task.name || '');
  const [enabled, setEnabled] = useState(task.enabled !== false);
  const [scheduleType, setScheduleType] = useState<ScheduleType>((schedule.type as ScheduleType) || 'cron');
  const [cron, setCron] = useState(schedule.expression || '');
  const [interval, setIntervalSec] = useState(schedule.seconds != null ? String(schedule.seconds) : '');
  const [onceTime, setOnceTime] = useState(() => {
    const raw = (schedule.run_at ?? schedule.time) as string | undefined;
    if (!raw) return '';
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}` : '';
  });
  const [actionType, setActionType] = useState<ActionType>((action.type as ActionType) || 'send_message');
  const [channelType, setChannelType] = useState(action.channel_type || 'web');
  const [channelOptions, setChannelOptions] = useState<DropdownOption[]>([{ value: 'web', label: 'Web' }]);
  const [content, setContent] = useState(action.content || action.task_description || '');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus(''), 3000);
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .getChannels(lang)
      .then((data) => {
        if (!alive) return;
        const all = data.channels ?? [];
        const opts = all
          .filter((c) => c.active)
          .map((c) => ({ value: c.name, label: channelLabel(c, lang) }));
        const names = opts.map((o) => o.value);
        if (!names.includes('web')) opts.unshift({ value: 'web', label: 'Web' });
        const sel = action.channel_type || 'web';
        if (sel && !names.includes(sel) && sel !== 'web') {
          const ch = all.find((c) => c.name === sel);
          opts.push({ value: sel, label: ch ? channelLabel(ch, lang) : sel });
        }
        setChannelOptions(opts);
        setChannelType(sel);
      })
      .catch(() => {
        if (alive) setChannelOptions([{ value: 'web', label: 'Web' }]);
      });
    return () => {
      alive = false;
    };
  }, [lang, action.channel_type]);

  const L = {
    name: lang === 'en' ? 'Please enter task name' : '请输入任务名称',
    cron: lang === 'en' ? 'Please enter cron expression' : '请输入 Cron 表达式',
    cronBad:
      lang === 'en'
        ? 'Invalid cron expression, expected 5 or 6 fields (min hour day month weekday)'
        : 'Cron 表达式格式错误，应为 5 或 6 个字段（分 时 日 月 周）',
    interval: lang === 'en' ? 'Interval must be at least 60 seconds' : '间隔秒数最小为 60 秒',
    once: lang === 'en' ? 'Please select execution time' : '请选择执行时间',
    onceBad: lang === 'en' ? 'Invalid execution time format' : '执行时间格式错误',
    onceFuture: lang === 'en' ? 'Execution time must be in the future' : '执行时间必须在当前时间之后',
    content: lang === 'en' ? 'Please enter content' : '请输入内容',
    saveFailed: lang === 'en' ? 'Save failed' : '保存失败',
    net: lang === 'en' ? 'Network error' : '网络错误',
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      flash(L.name);
      return;
    }

    const schedulePayload: NonNullable<ScheduledTask['schedule']> = { type: scheduleType };
    if (scheduleType === 'cron') {
      const expr = cron.trim();
      if (!expr) {
        flash(L.cron);
        return;
      }
      const fields = expr.split(/\s+/);
      if (fields.length < 5 || fields.length > 6) {
        flash(L.cronBad);
        return;
      }
      schedulePayload.expression = expr;
    } else if (scheduleType === 'interval') {
      const seconds = parseInt(interval, 10);
      if (!seconds || seconds < 60) {
        flash(L.interval);
        return;
      }
      schedulePayload.seconds = seconds;
    } else {
      if (!onceTime) {
        flash(L.once);
        return;
      }
      const selected = new Date(onceTime);
      if (Number.isNaN(selected.getTime())) {
        flash(L.onceBad);
        return;
      }
      if (selected <= new Date()) {
        flash(L.onceFuture);
        return;
      }
      schedulePayload.run_at = onceTime;
    }

    const trimmedContent = content.trim();
    if (!trimmedContent) {
      flash(L.content);
      return;
    }

    const actionPayload: NonNullable<ScheduledTask['action']> = {
      type: actionType,
      channel_type: channelType,
      receiver: '',
      receiver_name: '',
      is_group: false,
      notify_session_id: '',
    };
    if (actionType === 'send_message') actionPayload.content = trimmedContent;
    else actionPayload.task_description = trimmedContent;

    // Preserve the original receiver identity (channel is read-only when editing).
    if (task.action) {
      actionPayload.receiver = (task.action.receiver as string) || '';
      actionPayload.receiver_name = (task.action.receiver_name as string) || '';
      actionPayload.is_group = Boolean(task.action.is_group);
      actionPayload.notify_session_id = (task.action.notify_session_id as string) || '';
      if (channelType === 'dingtalk' && task.action.dingtalk_sender_staff_id) {
        actionPayload.dingtalk_sender_staff_id = task.action.dingtalk_sender_staff_id;
      }
    }

    setSaving(true);
    try {
      const res = await api.schedulerUpdate({
        id: task.id,
        name: trimmedName,
        enabled,
        schedule: schedulePayload,
        action: actionPayload,
      });
      if (res.status === 'success') onSaved();
      else flash((res as { message?: string }).message || L.saveFailed);
    } catch {
      flash(L.net);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: t('task_delete_confirm_title'),
      message: t('task_delete_confirm_msg'),
      okText: t('task_delete_btn'),
      cancelText: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await api.schedulerDelete(task.id);
      if (res.status === 'success') onSaved();
      else flash((res as { message?: string }).message || L.saveFailed);
    } catch {
      flash(L.net);
    }
  };

  const contentLabel = actionType === 'send_message' ? t('task_message_content') : t('task_task_description');

  return (
    <Modal open onClose={onClose} maxWidth="max-w-2xl" z="z-[100]">
      <div className="p-6 max-h-[90vh] overflow-y-auto">
        <ModalHeader icon="fa-clock" title={t('task_edit_title')} subtitle={task.id} />

        <div className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Field label={t('task_name')}>
                <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder={t('task_name')} />
              </Field>
            </div>
            <div className="flex items-center gap-2 pb-[2px]">
              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">{t('task_enabled')}</label>
              <Toggle size="md" checked={enabled} onChange={setEnabled} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('task_schedule_type')}>
              <AntSelect
                value={scheduleType}
                onChange={(value) => setScheduleType(value as ScheduleType)}
                style={{ width: '100%' }}
                options={[
                  { value: 'cron', label: t('task_schedule_cron') },
                  { value: 'interval', label: t('task_schedule_interval') },
                  { value: 'once', label: t('task_schedule_once') },
                ]}
              />
            </Field>
            {scheduleType === 'cron' ? (
              <Field label={t('task_cron_expression')} hint={t('task_cron_hint')}>
                <TextField value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" />
              </Field>
            ) : scheduleType === 'interval' ? (
              <Field label={t('task_interval_seconds')} hint={t('task_interval_hint')}>
                <TextField
                  type="number"
                  min={60}
                  value={interval}
                  onChange={(e) => setIntervalSec(e.target.value)}
                  placeholder="3600"
                />
              </Field>
            ) : (
              <Field label={t('task_once_time')}>
                <TextField
                  type="datetime-local"
                  step={1}
                  value={onceTime}
                  onChange={(e) => setOnceTime(e.target.value)}
                />
              </Field>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label={t('task_action_type')}>
              <AntSelect
                value={actionType}
                onChange={(value) => setActionType(value as ActionType)}
                style={{ width: '100%' }}
                options={[
                  { value: 'send_message', label: t('task_action_send_message') },
                  { value: 'agent_task', label: t('task_action_agent_task') },
                ]}
              />
            </Field>
            <Field label={t('task_channel_type')} hint={t('task_channel_hint')}>
              <AntSelect
                value={channelType}
                disabled
                onChange={(value) => setChannelType(value)}
                style={{ width: '100%' }}
                options={channelOptions}
              />
            </Field>
          </div>

          <Field label={contentLabel}>
            <TextArea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={contentLabel}
            />
          </Field>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-slate-100 dark:border-white/5">
        <AntButton type="text" danger onClick={handleDelete}>
          {t('task_delete_btn')}
        </AntButton>
        <span className="flex-1 text-xs text-primary-500 text-left truncate">{status}</span>
        <SecondaryButton onClick={onClose}>{t('cancel')}</SecondaryButton>
        <PrimaryButton disabled={saving} onClick={handleSave}>
          {t('save')}
        </PrimaryButton>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------ main view */

export function TasksView() {
  const { t, lang } = useI18n();
  const { confirm, toast } = useUI();

  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<ScheduledTask | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getScheduler();
      setTasks(data.tasks ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTasks();
  }, [loadTasks]);

  const handleToggle = useCallback(
    async (task: ScheduledTask, enabled: boolean) => {
      setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, enabled } : x)));
      try {
        await api.schedulerToggle(task.id, enabled);
      } catch {
        setTasks((prev) => prev.map((x) => (x.id === task.id ? { ...x, enabled: !enabled } : x)));
        toast(t('task_run_failed'), 'error');
      }
    },
    [t, toast],
  );

  const handleRun = useCallback(
    async (task: ScheduledTask) => {
      const ok = await confirm({
        title: t('task_run_confirm_title'),
        message: `${task.name || task.id}: ${t('task_run_confirm_msg')}`,
        okText: t('task_run_now'),
      });
      if (!ok) return;
      setRunningId(task.id);
      try {
        const res = await api.schedulerRun(task.id);
        if (res.status === 'success') toast(t('task_run_started'), 'success');
        else toast(res.message || t('task_run_failed'), 'error');
      } catch {
        toast(t('task_run_failed'), 'error');
      } finally {
        setRunningId(null);
      }
    },
    [confirm, t, toast],
  );

  const handleSaved = useCallback(() => {
    setEditing(null);
    void loadTasks();
  }, [loadTasks]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <PageHeader title={t('tasks_title')} desc={t('tasks_desc')}>
          <SecondaryButton onClick={() => void loadTasks()} aria-label="refresh" className="px-3 py-2">
            <AppIcon className={classNames('fas fa-refresh text-xs', loading && 'fa-spin')} />
          </SecondaryButton>
        </PageHeader>

        {loading ? (
          <LoadingRow label={t('tasks_title')} />
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="fa-clock"
            iconClass="bg-rose-50 dark:bg-rose-900/20 text-rose-400"
            title={emptyLabel(lang)}
          />
        ) : (
          <div className="grid gap-4">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                running={runningId === task.id}
                onOpen={() => setEditing(task)}
                onToggle={(enabled) => void handleToggle(task, enabled)}
                onRun={() => void handleRun(task)}
              />
            ))}
          </div>
        )}
      </div>

      {editing ? (
        <TaskEditModal task={editing} onClose={() => setEditing(null)} onSaved={handleSaved} />
      ) : null}
    </div>
  );
}
