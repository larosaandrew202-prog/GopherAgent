import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button as AntButton } from 'antd';
import { api } from '@/api';
import type { ChannelField, ChannelInfo, QrLoginResult } from '@/api';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from '@/store/ui';
import {
  Card,
  Dropdown,
  EmptyState,
  IconChip,
  LoadingRow,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  SegmentedTabs,
  TextField,
  Toggle,
  type DropdownOption,
} from '@/components/ui/primitives';
import { classNames } from '@/lib/format';

/* ------------------------------------------------------------------ types */

interface FieldState {
  value: string;
  /** Secret field whose existing value is still masked (untouched). */
  masked: boolean;
  type: string;
}

type ChannelForm = Record<string, FieldState>;
type ChannelForms = Record<string, ChannelForm>;

/* ---------------------------------------------------------------- helpers */

/** Tailwind cannot compile `bg-${color}-50`; map channel colors to static classes. */
const CHANNEL_COLORS: Record<string, { chip: string; glyph: string }> = {
  primary: { chip: 'bg-primary-50 dark:bg-primary-900/20', glyph: 'text-primary-500' },
  blue: { chip: 'bg-blue-50 dark:bg-blue-900/20', glyph: 'text-blue-500' },
  emerald: { chip: 'bg-emerald-50 dark:bg-emerald-900/20', glyph: 'text-emerald-500' },
  cyan: { chip: 'bg-cyan-50 dark:bg-cyan-900/20', glyph: 'text-cyan-500' },
  indigo: { chip: 'bg-indigo-50 dark:bg-indigo-900/20', glyph: 'text-indigo-500' },
  violet: { chip: 'bg-violet-50 dark:bg-violet-900/20', glyph: 'text-violet-500' },
  amber: { chip: 'bg-amber-50 dark:bg-amber-900/20', glyph: 'text-amber-500' },
  orange: { chip: 'bg-orange-50 dark:bg-orange-900/20', glyph: 'text-orange-500' },
  rose: { chip: 'bg-rose-50 dark:bg-rose-900/20', glyph: 'text-rose-500' },
  red: { chip: 'bg-red-50 dark:bg-red-900/20', glyph: 'text-red-500' },
  slate: { chip: 'bg-slate-100 dark:bg-slate-800/40', glyph: 'text-slate-500' },
};

function channelColor(color?: string) {
  return (color && CHANNEL_COLORS[color]) || CHANNEL_COLORS.primary;
}

function channelLabel(ch: ChannelInfo, lang: string): string {
  const label = ch.label;
  if (typeof label === 'string') return label || ch.name;
  if (label && typeof label === 'object') {
    const obj = label as Record<string, string>;
    return obj[lang] || obj.en || ch.name;
  }
  return ch.name;
}

function fieldLabel(f: ChannelField, lang: string): string {
  const label = f.label as unknown;
  if (typeof label === 'string') return label || f.key;
  if (label && typeof label === 'object') {
    const obj = label as Record<string, string>;
    return obj[lang] || obj.en || f.key;
  }
  return f.key;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function pickQr(d: QrLoginResult): string {
  return str(d.qrcode) || str(d.qr_image) || str(d.qrcode_url) || str(d.qr_url);
}

function pickStatus(d: QrLoginResult): string {
  return str(d.qr_status) || str(d.register_status) || str(d.login_status);
}

function buildFieldStates(fields?: ChannelField[]): ChannelForm {
  const out: ChannelForm = {};
  for (const f of fields ?? []) {
    const isSecret = f.type === 'secret';
    out[f.key] = {
      value: f.value == null ? '' : String(f.value),
      masked: isSecret && !!f.value,
      type: f.type,
    };
  }
  return out;
}

function buildInitialForms(channels: ChannelInfo[]): ChannelForms {
  const forms: ChannelForms = {};
  for (const ch of channels) forms[ch.name] = buildFieldStates(ch.fields);
  return forms;
}

function collectUpdates(form: ChannelForm | undefined): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (!form) return updates;
  for (const [key, st] of Object.entries(form)) {
    if (st.masked) continue;
    updates[key] = st.type === 'bool' ? st.value === '1' : st.value;
  }
  return updates;
}

/* ------------------------------------------------------------- fields UI */

function ChannelFields({
  fields,
  form,
  lang,
  onChange,
}: {
  fields: ChannelField[];
  form: ChannelForm;
  lang: string;
  onChange: (key: string, patch: Partial<FieldState>) => void;
}) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const st = form[f.key] ?? { value: '', masked: false, type: f.type };
        if (f.type === 'bool') {
          return (
            <div key={f.key}>
              <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
                {fieldLabel(f, lang)}
              </label>
              <Toggle checked={st.value === '1'} onChange={(v) => onChange(f.key, { value: v ? '1' : '' })} />
            </div>
          );
        }
        const masked = f.type === 'secret' && st.masked;
        return (
          <div key={f.key}>
            <label className="block text-sm font-medium text-slate-600 dark:text-slate-400 mb-1.5">
              {fieldLabel(f, lang)}
            </label>
            <TextField
              type={f.type === 'number' ? 'number' : 'text'}
              value={st.value}
              placeholder={fieldLabel(f, lang)}
              className={masked ? 'cfg-key-masked' : ''}
              onFocus={() => {
                if (masked) onChange(f.key, { value: '', masked: false });
              }}
              onChange={(e) => onChange(f.key, { value: e.target.value })}
            />
          </div>
        );
      })}
    </div>
  );
}

/* --------------------------------------------------------- weixin QR login */

function WeixinQrPanel({ onConnected }: { onConnected: () => void }) {
  const { t } = useI18n();
  const [qr, setQr] = useState('');
  const [status, setStatus] = useState<'loading' | 'waiting' | 'scanned' | 'success' | 'fail'>('loading');
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const connectedRef = useRef(onConnected);
  connectedRef.current = onConnected;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await api.weixinQrLogin('get');
        if (!alive) return;
        if (data.status !== 'success') {
          setStatus('fail');
          setError(str(data.message));
          return;
        }
        const src = pickQr(data);
        if (src) setQr(src);
        setStatus('waiting');
        setTick((x) => x + 1);
      } catch {
        if (alive) setStatus('fail');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'waiting' && status !== 'scanned') return;
    const timer = setTimeout(async () => {
      try {
        const data = await api.weixinQrLogin('start');
        if (data.status !== 'success') {
          setTick((x) => x + 1);
          return;
        }
        const rs = pickStatus(data);
        const src = pickQr(data);
        if (src) setQr(src);
        if (rs === 'confirmed' || rs === 'success') {
          setStatus('success');
          connectedRef.current();
        } else if (rs === 'scanned' || rs === 'scaned') {
          setStatus('scanned');
        } else if (rs === 'expired') {
          setStatus('waiting');
        } else if (rs === 'fail' || rs === 'error') {
          setStatus('fail');
        } else {
          setStatus('waiting');
        }
        setTick((x) => x + 1);
      } catch {
        setTick((x) => x + 1);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [status, tick]);

  if (status === 'fail') {
    return (
      <p className="text-sm text-red-500 text-center py-4">
        {t('weixin_scan_fail')}
        {error ? `: ${error}` : ''}
      </p>
    );
  }

  if (status === 'success') {
    return (
      <div className="flex flex-col items-center py-4">
        <div className="w-12 h-12 rounded-full bg-primary-50 dark:bg-primary-900/30 flex items-center justify-center mb-3">
          <AppIcon className="fas fa-check text-primary-500 text-lg" />
        </div>
        <p className="text-sm font-medium text-primary-600 dark:text-primary-400">{t('weixin_scan_success')}</p>
      </div>
    );
  }

  const statusText =
    status === 'scanned'
      ? t('weixin_scan_scanned')
      : status === 'loading'
        ? t('weixin_scan_loading')
        : t('weixin_scan_waiting');
  const statusColor = status === 'scanned' ? 'text-primary-500' : 'text-slate-500 dark:text-slate-400';

  return (
    <div className="flex flex-col items-center py-2">
      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">{t('weixin_scan_title')}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500 mb-4">{t('weixin_scan_desc')}</p>
      {!qr ? (
        <LoadingRow label={t('weixin_scan_loading')} />
      ) : (
        <div className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 dark:border-slate-700 mb-3">
          <img src={qr} alt="QR Code" className="w-52 h-52" style={{ imageRendering: 'pixelated' }} />
        </div>
      )}
      <p className={classNames('text-xs mb-1', statusColor)}>{statusText}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500">{t('weixin_qr_tip')}</p>
    </div>
  );
}

/* ------------------------------------------------------ feishu one-click */

function FeishuScanPanel({ isActive, onRegistered }: { isActive: boolean; onRegistered: () => void }) {
  const { t } = useI18n();
  const [status, setStatus] = useState<'idle' | 'loading' | 'downloading' | 'waiting' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');
  const [qr, setQr] = useState('');
  const [link, setLink] = useState('');
  const [tick, setTick] = useState(0);
  const registeredRef = useRef(onRegistered);
  registeredRef.current = onRegistered;

  const start = useCallback(async () => {
    setStatus('loading');
    setMessage('');
    setQr('');
    setLink('');
    try {
      const data = await api.feishuRegister('get');
      if (data.status !== 'success') {
        setStatus('error');
        setMessage(str(data.message) || t('feishu_scan_fail'));
        return;
      }
      if (str(data.register_status) === 'downloading') {
        setStatus('downloading');
        setTick((x) => x + 1);
        return;
      }
      const src = pickQr(data);
      if (src) setQr(src);
      setLink(str(data.qrcode_url) || str(data.qr_url));
      setStatus('waiting');
      setTick((x) => x + 1);
    } catch {
      setStatus('error');
      setMessage(t('feishu_scan_fail'));
    }
  }, [t]);

  useEffect(() => {
    if (status !== 'waiting' && status !== 'downloading') return;
    const timer = setTimeout(async () => {
      try {
        const data = await api.feishuRegister('start');
        if (data.status !== 'success') {
          setStatus('error');
          setMessage(str(data.message) || t('feishu_scan_fail'));
          return;
        }
        const rs = str(data.register_status);
        const src = pickQr(data);
        if (src) setQr(src);
        if (rs === 'downloading') {
          setStatus('downloading');
          setTick((x) => x + 1);
        } else if (rs === 'done') {
          setStatus('done');
          registeredRef.current();
        } else if (rs === 'expired') {
          setStatus('error');
          setMessage(t('feishu_scan_expired'));
        } else if (rs === 'denied') {
          setStatus('error');
          setMessage(t('feishu_scan_denied'));
        } else if (rs === 'error') {
          setStatus('error');
          setMessage(str(data.message) || t('feishu_scan_fail'));
        } else {
          setStatus('waiting');
          setTick((x) => x + 1);
        }
      } catch {
        setTick((x) => x + 1);
      }
    }, 2000);
    return () => clearTimeout(timer);
  }, [status, tick, t]);

  if (status === 'idle') {
    return (
      <div className="flex flex-col items-center py-4">
        <p className="text-sm text-slate-600 dark:text-slate-300 mb-3 text-center">
          {isActive ? t('feishu_scan_replace_desc') : t('feishu_scan_desc')}
        </p>
        <PrimaryButton onClick={start}>
          <AppIcon className="fas fa-qrcode mr-2" />
          {t('feishu_scan_btn')}
        </PrimaryButton>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-4">{t('feishu_scan_loading')}</p>
    );
  }

  if (status === 'downloading') {
    return (
      <div className="flex flex-col items-center gap-2 py-6">
        <AppIcon className="fas fa-spinner fa-spin text-slate-400" />
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('feishu_sdk_downloading')}</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">{t('feishu_sdk_downloading_tip')}</p>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="flex flex-col items-center py-2">
        <div className="w-10 h-10 rounded-full bg-emerald-50 dark:bg-emerald-900/30 flex items-center justify-center mb-2">
          <AppIcon className="fas fa-check text-emerald-500 text-lg" />
        </div>
        <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{t('feishu_scan_success')}</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="flex flex-col items-center gap-2 py-2">
        <p className="text-sm text-red-500 text-center">{message || t('feishu_scan_fail')}</p>
        <AntButton onClick={start}>
          <AppIcon className="fas fa-rotate-right mr-1" />
          {t('feishu_scan_retry')}
        </AntButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3">
      {qr ? (
        <img
          src={qr}
          alt="QR"
          className="w-44 h-44 rounded-lg border border-slate-200 dark:border-white/10 bg-white p-2"
        />
      ) : (
        <div className="w-44 h-44 rounded-lg border border-dashed border-slate-300 flex items-center justify-center text-xs text-slate-400">
          QR
        </div>
      )}
      <p className="text-xs text-amber-500">{t('feishu_scan_waiting')}</p>
      <p className="text-xs text-slate-400 dark:text-slate-500">{t('feishu_scan_tip')}</p>
      {link ? (
        <a
          href={link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-500 hover:text-blue-600 underline"
        >
          {t('feishu_scan_open_link')}
        </a>
      ) : null}
    </div>
  );
}

function FeishuPanel({
  channel,
  lang,
  form,
  saving,
  isActive,
  onFieldChange,
  onSave,
  onConnect,
  onRegistered,
}: {
  channel?: ChannelInfo;
  lang: string;
  form: ChannelForm;
  saving: boolean;
  isActive: boolean;
  onFieldChange: (key: string, patch: Partial<FieldState>) => void;
  onSave: () => void;
  onConnect: () => void;
  onRegistered: () => void;
}) {
  const { t } = useI18n();
  const fields = channel?.fields ?? [];
  const hasCreds = fields.some((f) => f.key === 'feishu_app_id' && f.value) &&
    fields.some((f) => f.key === 'feishu_app_secret' && f.value);
  const [mode, setMode] = useState<'scan' | 'manual'>(hasCreds ? 'manual' : 'scan');

  return (
    <div>
      <div className="flex justify-center mb-5">
        <SegmentedTabs
          tabs={[
            { id: 'scan', label: t('feishu_mode_scan') },
            { id: 'manual', label: t('feishu_mode_manual') },
          ]}
          active={mode}
          onChange={(id) => setMode(id as 'scan' | 'manual')}
        />
      </div>
      {mode === 'scan' ? (
        <FeishuScanPanel isActive={isActive} onRegistered={onRegistered} />
      ) : (
        <div className="space-y-4">
          <ChannelFields fields={fields} form={form} lang={lang} onChange={onFieldChange} />
          <div className="flex items-center justify-end gap-3 pt-1">
            <PrimaryButton disabled={saving} onClick={isActive ? onSave : onConnect}>
              {isActive ? t('channels_save') : t('channels_connect_btn')}
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------ active card */

function ActiveChannelCard({
  channel,
  lang,
  form,
  saving,
  onFieldChange,
  onSave,
  onDisconnect,
  onConnect,
}: {
  channel: ChannelInfo;
  lang: string;
  form: ChannelForm;
  saving: boolean;
  onFieldChange: (key: string, patch: Partial<FieldState>) => void;
  onSave: () => void;
  onDisconnect: () => void;
  onConnect: (updates: Record<string, unknown>) => void;
}) {
  const { t } = useI18n();
  const [weixinOpen, setWeixinOpen] = useState(false);
  const color = channelColor(channel.color);
  const label = channelLabel(channel, lang);
  const fields = channel.fields ?? [];

  const weixinWaiting =
    channel.name === 'weixin' && !!channel.login_status && channel.login_status !== 'logged_in';

  let statusDot = 'bg-primary-400';
  let statusText: ReactNode = <span className="text-xs text-primary-500">{t('channels_connected')}</span>;
  if (weixinWaiting) {
    statusDot = 'bg-amber-400 animate-pulse';
    statusText =
      channel.login_status === 'scanned' ? (
        <span className="text-xs text-primary-500">{t('weixin_scan_scanned')}</span>
      ) : (
        <span className="text-xs text-amber-500">{t('weixin_scan_waiting')}</span>
      );
  }

  const isFeishu = channel.name === 'feishu';
  const hasBody = isFeishu || weixinWaiting || fields.length > 0;

  return (
    <Card className="p-6">
      <div className={classNames('flex items-center gap-4', hasBody && 'mb-5')}>
        <IconChip icon={channel.icon || 'fa-tower-broadcast'} className={color.chip} glyph={color.glyph} size="w-10 h-10" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-800 dark:text-slate-100">{label}</span>
            <span className={classNames('w-2 h-2 rounded-full', statusDot)} />
            {statusText}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">{channel.name}</p>
        </div>
        <AntButton danger onClick={onDisconnect} className="flex-shrink-0">
          {t('channels_disconnect')}
        </AntButton>
      </div>

      {isFeishu ? (
        <FeishuPanel
          channel={channel}
          lang={lang}
          form={form}
          saving={saving}
          isActive
          onFieldChange={onFieldChange}
          onSave={onSave}
          onConnect={() => onConnect(collectUpdates(form))}
          onRegistered={() => onConnect({})}
        />
      ) : weixinWaiting ? (
        weixinOpen ? (
          <WeixinQrPanel onConnected={() => onConnect({})} />
        ) : (
          <div className="flex flex-col items-center py-2">
            <PrimaryButton onClick={() => setWeixinOpen(true)}>{t('weixin_scan_title')}</PrimaryButton>
          </div>
        )
      ) : fields.length > 0 ? (
        <div className="space-y-4">
          <ChannelFields fields={fields} form={form} lang={lang} onChange={onFieldChange} />
          <div className="flex items-center justify-end gap-3 pt-1">
            <PrimaryButton disabled={saving} onClick={onSave}>
              {t('channels_save')}
            </PrimaryButton>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------ main view */

export function ChannelsView() {
  const { t, lang } = useI18n();
  const { toast, confirm } = useUI();

  const [channels, setChannels] = useState<ChannelInfo[]>([]);
  const [forms, setForms] = useState<ChannelForms>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [addChannel, setAddChannel] = useState('');
  const [savingName, setSavingName] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await api.getChannels(lang);
      const list = data.channels ?? [];
      setChannels(list);
      setForms(buildInitialForms(list));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, [lang]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeChannels = useMemo(() => channels.filter((c) => c.active), [channels]);
  const availableChannels = useMemo(() => channels.filter((c) => !c.active), [channels]);

  const setField = useCallback((chName: string, key: string, patch: Partial<FieldState>) => {
    setForms((prev) => {
      const current = prev[chName]?.[key] ?? { value: '', masked: false, type: 'text' };
      return { ...prev, [chName]: { ...(prev[chName] ?? {}), [key]: { ...current, ...patch } } };
    });
  }, []);

  const handleSave = useCallback(
    async (chName: string) => {
      const updates = collectUpdates(forms[chName]);
      setSavingName(chName);
      try {
        const res = await api.channelsAction({
          action: 'save',
          channel: chName,
          config: updates,
          updates,
        });
        const restarted = (res as { restarted?: boolean }).restarted;
        if (res.status === 'success') {
          toast(restarted ? t('channels_restarted') : t('channels_saved'), 'success');
        } else {
          toast(res.message || t('channels_save_error'), 'error');
        }
      } catch {
        toast(t('channels_save_error'), 'error');
      } finally {
        setSavingName(null);
      }
    },
    [forms, t, toast],
  );

  const handleConnect = useCallback(
    async (chName: string, updates: Record<string, unknown>) => {
      try {
        const res = await api.channelsAction({
          action: 'connect',
          channel: chName,
          config: updates,
          updates,
        });
        if (res.status === 'success') {
          setChannels((prev) =>
            prev.map((c) =>
              c.name === chName
                ? { ...c, active: true, login_status: chName === 'weixin' ? 'logged_in' : c.login_status }
                : c,
            ),
          );
          setShowAdd(false);
          setAddChannel('');
          toast(t('channels_connected'), 'success');
        } else {
          toast(res.message || t('channels_save_error'), 'error');
        }
      } catch {
        toast(t('channels_save_error'), 'error');
      }
    },
    [t, toast],
  );

  const handleDisconnect = useCallback(
    async (chName: string) => {
      const ch = channels.find((c) => c.name === chName);
      const label = ch ? channelLabel(ch, lang) : chName;
      const ok = await confirm({
        title: t('channels_disconnect'),
        message: `${label}: ${t('channels_disconnect_confirm')}`,
        okText: t('channels_disconnect'),
        cancelText: t('channels_cancel'),
        danger: true,
      });
      if (!ok) return;
      try {
        await api.channelsAction({ action: 'disconnect', channel: chName });
        setChannels((prev) =>
          prev.map((c) => (c.name === chName ? { ...c, active: false, login_status: 'logged_out' } : c)),
        );
      } catch {
        toast(t('channels_save_error'), 'error');
      }
    },
    [channels, confirm, lang, t, toast],
  );

  const addOptions: DropdownOption[] = useMemo(
    () => availableChannels.map((ch) => ({ value: ch.name, label: `${channelLabel(ch, lang)} (${ch.name})` })),
    [availableChannels, lang],
  );

  const addChannelInfo = channels.find((c) => c.name === addChannel);

  const closeAdd = useCallback(() => {
    setShowAdd(false);
    setAddChannel('');
  }, []);

  const renderAddBody = () => {
    if (!addChannel) return null;

    if (addChannel === 'weixin') {
      return <WeixinQrPanel onConnected={() => handleConnect('weixin', {})} />;
    }

    if (addChannel === 'feishu') {
      return (
        <FeishuPanel
          channel={addChannelInfo}
          lang={lang}
          form={forms[addChannel] ?? {}}
          saving={false}
          isActive={false}
          onFieldChange={(key, patch) => setField(addChannel, key, patch)}
          onSave={() => {}}
          onConnect={() => handleConnect(addChannel, collectUpdates(forms[addChannel]))}
          onRegistered={() => handleConnect('feishu', {})}
        />
      );
    }

    return (
      <div className="space-y-4">
        <ChannelFields
          fields={addChannelInfo?.fields ?? []}
          form={forms[addChannel] ?? {}}
          lang={lang}
          onChange={(key, patch) => setField(addChannel, key, patch)}
        />
        <div className="flex items-center justify-end gap-3 pt-2">
          <SecondaryButton onClick={closeAdd}>{t('channels_cancel')}</SecondaryButton>
          <PrimaryButton onClick={() => handleConnect(addChannel, collectUpdates(forms[addChannel]))}>
            {t('channels_connect_btn')}
          </PrimaryButton>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <PageHeader title={t('channels_title')} desc={t('channels_desc')}>
          <PrimaryButton onClick={() => (showAdd ? closeAdd() : setShowAdd(true))}>
            <AppIcon className="fas fa-plus text-xs mr-1" />
            <span>{t('channels_add')}</span>
          </PrimaryButton>
        </PageHeader>

        {loading ? (
          <LoadingRow label={t('channels_title')} />
        ) : loadError ? (
          <p className="text-sm text-red-400 py-8 text-center">Failed to load channels</p>
        ) : activeChannels.length === 0 ? (
          <EmptyState
            icon="fa-tower-broadcast"
            iconClass="bg-blue-50 dark:bg-blue-900/20 text-blue-400"
            title={t('channels_empty')}
            desc={t('channels_empty_desc')}
          />
        ) : (
          <div className="grid gap-4">
            {activeChannels.map((ch) => (
              <ActiveChannelCard
                key={ch.name}
                channel={ch}
                lang={lang}
                form={forms[ch.name] ?? {}}
                saving={savingName === ch.name}
                onFieldChange={(key, patch) => setField(ch.name, key, patch)}
                onSave={() => handleSave(ch.name)}
                onDisconnect={() => handleDisconnect(ch.name)}
                onConnect={(updates) => handleConnect(ch.name, updates)}
              />
            ))}
          </div>
        )}

        {showAdd ? (
          <Card className="mt-4 p-6 border-primary-200 dark:border-primary-800">
            <div className="flex items-center gap-3 mb-5">
              <IconChip icon="fa-plus" size="w-9 h-9" />
              <h3 className="font-semibold text-slate-800 dark:text-slate-100">{t('channels_add')}</h3>
            </div>
            {availableChannels.length === 0 ? (
              <div className="text-center">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  {lang === 'en' ? 'All channels are already connected' : '所有通道均已接入'}
                </p>
                <AntButton type="link" size="small" onClick={closeAdd} style={{ padding: 0 }} className="mt-3">
                  {t('channels_cancel')}
                </AntButton>
              </div>
            ) : (
              <>
                <div className="mb-4">
                  <Dropdown
                    options={addOptions}
                    value={addChannel}
                    onChange={setAddChannel}
                    placeholder={t('channels_select_placeholder')}
                  />
                </div>
                {renderAddBody()}
              </>
            )}
          </Card>
        ) : null}
      </div>
    </div>
  );
}
