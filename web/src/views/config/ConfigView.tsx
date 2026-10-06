import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Button as AntButton } from 'antd';
import { api } from '@/api';
import type { AppConfig, PermissionMode, ProviderConfig } from '@/api/types';
import { LANGS, LANG_LABELS, type Lang } from '@/i18n';
import { useI18n } from '@/i18n/useI18n';
import { useUI } from '@/store/ui';
import { PERMISSION_META } from '@/lib/constants';
import {
  Card,
  Dropdown,
  Field,
  IconChip,
  LoadingRow,
  PageHeader,
  PrimaryButton,
  SegmentedTabs,
  TextField,
  Toggle,
} from '@/components/ui/primitives';
import { ModelsPanel } from './ModelsPanel';

/* ------------------------------------------------------------------ types */

interface ReasoningOption {
  value: string;
  label?: string;
}
interface ReasoningInfo {
  supported?: boolean;
  options?: ReasoningOption[];
  default?: string;
}

/** Provider entry as returned by /config (looser than ProviderOverview). */
interface ConfigProvider extends ProviderConfig {
  api_key_field?: string;
  api_base_key?: string;
  api_base_default?: string;
  api_base_placeholder?: string;
  reasoning?: ReasoningInfo;
  reasoning_by_model?: Record<string, ReasoningInfo>;
}

interface Status {
  text: string;
  err: boolean;
}

const TASK_NOTIFY_KEY = 'cow_task_notify';
const TASK_NOTIFY_SOUND_KEY = 'cow_task_notify_sound';

function readLocalFlag(key: string, fallback = true): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v !== '0';
  } catch {
    return fallback;
  }
}

function writeLocalFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function labelOf(label: ProviderConfig['label'], lang: Lang): string {
  if (label && typeof label === 'object') {
    return label[lang] || label.en || label.zh || Object.values(label)[0] || '';
  }
  return label || '';
}

function detectProvider(model: string, providers: Record<string, ProviderConfig>): string {
  if (!model) return Object.keys(providers)[0] || '';
  for (const [pid, p] of Object.entries(providers)) {
    if (p.models && p.models.includes(model)) return pid;
  }
  return Object.keys(providers)[0] || '';
}

function maskKey(value: string): string {
  if (!value || value.length <= 8) return value;
  return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(value.length - 4);
}

/**
 * Resolve the credential fields for a provider. The backend always supplies
 * api_key_field / api_base_key; the mock config keys them by provider id, so
 * fall back to that shape when the explicit metadata is absent.
 */
function providerFields(p: ConfigProvider | undefined, pid: string, data: AppConfig) {
  const has = (obj: Record<string, string> | undefined, key: string) =>
    !!obj && Object.prototype.hasOwnProperty.call(obj, key);
  return {
    keyField:
      p?.api_key_field || (pid && has(data.api_keys, pid) ? pid : undefined),
    baseKey:
      p?.api_base_key || (pid && has(data.api_bases, pid) ? pid : undefined),
    baseDefault: p?.api_base_default,
    basePlaceholder: p?.api_base_placeholder,
  };
}

/** Render the muted question-mark tip used by config labels. */
function Tip({ tipKey }: { tipKey: string }) {
  return (
    <span className="cfg-tip" data-tip-key={tipKey}>
      <AppIcon className="fas fa-circle-question" />
    </span>
  );
}

function ToggleRow({
  label,
  tipKey,
  checked,
  onChange,
}: {
  label: ReactNode;
  tipKey?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <label className="flex items-center gap-1.5 text-sm font-medium text-slate-600 dark:text-slate-400">
        <span>{label}</span>
        {tipKey ? <Tip tipKey={tipKey} /> : null}
      </label>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function StatusText({ status }: { status: Status | null }) {
  return (
    <span
      className={
        'text-xs transition-opacity duration-300 ' +
        (status ? (status.err ? 'text-red-500' : 'text-primary-500') : 'opacity-0 text-primary-500')
      }
    >
      {status ? status.text : ''}
    </span>
  );
}

/* ------------------------------------------------------------------ view */

export function ConfigView() {
  const { t, lang, setLang } = useI18n();
  const { toast } = useUI();

  const [config, setConfig] = useState<AppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'basic' | 'models'>('basic');

  /* --- model config --- */
  const [provider, setProvider] = useState('');
  const [modelChoice, setModelChoice] = useState('');
  const [customModel, setCustomModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiKeyMasked, setApiKeyMasked] = useState(false);
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiBase, setApiBase] = useState('');
  const [modelStatus, setModelStatus] = useState<Status | null>(null);

  /* --- agent config --- */
  const [maxTokens, setMaxTokens] = useState(50000);
  const [maxTurns, setMaxTurns] = useState(20);
  const [maxSteps, setMaxSteps] = useState(20);
  const [thinking, setThinking] = useState(false);
  const [reasoningEffort, setReasoningEffort] = useState('high');
  const [reasoningByModel, setReasoningByModel] = useState<Record<string, unknown>>({});
  const [subagent, setSubagent] = useState(true);
  const [selfEvolution, setSelfEvolution] = useState(false);
  const [agentStatus, setAgentStatus] = useState<Status | null>(null);

  /* --- security --- */
  const [permission, setPermission] = useState<PermissionMode>('full_access');
  const [password, setPassword] = useState('');
  const [passwordMasked, setPasswordMasked] = useState(false);
  const [securityStatus, setSecurityStatus] = useState<Status | null>(null);

  /* --- system --- */
  const [notify, setNotify] = useState(() => readLocalFlag(TASK_NOTIFY_KEY));
  const [notifySound, setNotifySound] = useState(() => readLocalFlag(TASK_NOTIFY_SOUND_KEY));
  const [notifyBlocked, setNotifyBlocked] = useState(false);

  /* --- image generation --- */
  const [imgEnabled, setImgEnabled] = useState(false);
  const [imgProvider, setImgProvider] = useState('auto');
  const [imgModel, setImgModel] = useState('');
  const [imgSize, setImgSize] = useState('auto');
  const [imgQuality, setImgQuality] = useState('auto');
  const [imgMax, setImgMax] = useState(1);
  const [imgFallback, setImgFallback] = useState(true);
  const [imgKey, setImgKey] = useState('');
  const [imgKeyMasked, setImgKeyMasked] = useState(false);
  const [imgBase, setImgBase] = useState('');
  const [imageStatus, setImageStatus] = useState<Status | null>(null);

  const initFromConfig = useCallback((data: AppConfig) => {
    setConfig(data);
    setReasoningByModel((data.reasoning_effort_by_model as Record<string, unknown>) || {});
    setReasoningEffort(data.reasoning_effort || 'high');

    const providers = data.providers || {};
    const detected =
      data.bot_type && providers[data.bot_type]
        ? data.bot_type
        : detectProvider(data.model || '', providers);
    const pid = detected || Object.keys(providers)[0] || '';
    const p = providers[pid] as ConfigProvider | undefined;

    setProvider(pid);
    const model = data.model || '';
    if (p && p.models && p.models.includes(model)) {
      setModelChoice(model);
      setCustomModel('');
    } else if (model) {
      setModelChoice('__custom__');
      setCustomModel(model);
    } else {
      setModelChoice(p?.models?.[0] || '__custom__');
      setCustomModel('');
    }

    const fields = providerFields(p, pid, data);
    const masked = fields.keyField ? data.api_keys?.[fields.keyField] || '' : '';
    setApiKey(masked);
    setApiKeyMasked(!!masked);
    setApiKeyVisible(false);
    setApiBase((fields.baseKey && data.api_bases?.[fields.baseKey]) || fields.baseDefault || '');

    setMaxTokens(data.agent_max_context_tokens || 50000);
    setMaxTurns(data.agent_max_context_turns || 20);
    setMaxSteps(data.agent_max_steps || 20);
    setThinking(data.enable_thinking === true);
    setSubagent(data.subagent_enabled !== false);
    setSelfEvolution(data.self_evolution_enabled === true);

    setPermission((data.agent_permission_mode as PermissionMode) || 'full_access');
    const maskedPwd = data.web_password_masked || '';
    setPassword(maskedPwd);
    setPasswordMasked(!!maskedPwd);

    setImgEnabled(data.image_enabled === true);
    setImgProvider((data.image_provider as string) || 'auto');
    setImgModel((data.image_model as string) || '');
    setImgSize((data.image_size as string) || 'auto');
    setImgQuality((data.image_quality as string) || 'auto');
    setImgMax(Number(data.image_max_per_call) || 1);
    setImgFallback(data.image_fallback !== false);
    const maskedImgKey = (data.image_api_key_masked as string) || '';
    setImgKey(maskedImgKey);
    setImgKeyMasked(!!maskedImgKey);
    setImgBase((data.image_api_base as string) || '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .getConfig()
      .then((data) => {
        if (cancelled) return;
        initFromConfig(data);
      })
      .catch(() => {
        if (!cancelled) toast(t('config_save_error'), 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const denied = typeof Notification !== 'undefined' && Notification.permission === 'denied';
    setNotifyBlocked(notify && denied);
  }, [notify]);

  const flash = useCallback(
    (setter: (s: Status | null) => void, key: string, err: boolean) => {
      setter({ text: t(key), err });
      if (!err) setTimeout(() => setter(null), 2500);
    },
    [t],
  );

  /* --------------------------------------------------------- derived data */

  const providerOptions = useMemo(
    () =>
      Object.entries(config?.providers || {}).map(([id, p]) => ({
        value: id,
        label: labelOf(p.label, lang),
      })),
    [config, lang],
  );

  const providerMeta = (config?.providers?.[provider] as ConfigProvider | undefined) || undefined;
  const modelFields = config ? providerFields(providerMeta, provider, config) : undefined;

  const modelOptions = useMemo(() => {
    const list = (providerMeta?.models || []).map((m) => ({ value: m, label: m }));
    list.push({ value: '__custom__', label: t('config_custom_option') });
    return list;
  }, [providerMeta, t]);

  const selectedModel = modelChoice === '__custom__' ? customModel.trim() : modelChoice;

  const reasoningOptions = useMemo<ReasoningOption[]>(() => {
    const byModel = providerMeta?.reasoning_by_model || {};
    const info = (selectedModel && byModel[selectedModel]) || providerMeta?.reasoning || {};
    return info.supported ? info.options || [] : [];
  }, [providerMeta, selectedModel]);

  const effectiveReasoning = useMemo(() => {
    if (!reasoningOptions.length) return reasoningEffort;
    const values = reasoningOptions.map((o) => o.value);
    if (values.includes(reasoningEffort)) return reasoningEffort;
    const savedKey = `${provider}:${selectedModel.trim().toLowerCase()}`;
    const saved = reasoningByModel[savedKey] || reasoningByModel[`${provider}:${selectedModel}`];
    if (typeof saved === 'string' && values.includes(saved)) return saved;
    return providerMeta?.reasoning_by_model?.[selectedModel]?.default || reasoningOptions[0].value;
  }, [reasoningOptions, reasoningEffort, reasoningByModel, provider, selectedModel, providerMeta]);

  const permissionOptions = useMemo(() => {
    const offered = config?.permission_modes && config.permission_modes.length
      ? config.permission_modes
      : (Object.keys(PERMISSION_META) as PermissionMode[]);
    return (Object.keys(PERMISSION_META) as PermissionMode[])
      .filter((mode) => offered.includes(mode))
      .map((mode) => ({ value: mode, label: t(PERMISSION_META[mode].key) }));
  }, [config, t]);

  const imageProviderOptions = useMemo(
    () => [{ value: 'auto', label: 'auto' }, ...providerOptions],
    [providerOptions],
  );
  const imageSizeOptions = useMemo(
    () => ['auto', '512', '1K', '2K', '4K'].map((v) => ({ value: v, label: v })),
    [],
  );
  const imageQualityOptions = useMemo(
    () => ['auto', 'low', 'medium', 'high'].map((v) => ({ value: v, label: v })),
    [],
  );

  /* ------------------------------------------------------------ handlers */

  const onProviderChange = (pid: string) => {
    const p = config?.providers?.[pid] as ConfigProvider | undefined;
    setProvider(pid);
    setModelChoice(p?.models?.[0] || '__custom__');
    setCustomModel('');
    const fields = config ? providerFields(p, pid, config) : undefined;
    const masked = fields?.keyField ? config?.api_keys?.[fields.keyField] || '' : '';
    setApiKey(masked);
    setApiKeyMasked(!!masked);
    setApiKeyVisible(false);
    setApiBase((fields?.baseKey && config?.api_bases?.[fields.baseKey]) || fields?.baseDefault || '');
  };

  const onModelChoiceChange = (value: string) => {
    setModelChoice(value);
    if (value !== '__custom__') setCustomModel('');
  };

  const saveModelConfig = async () => {
    const model = selectedModel;
    if (!model) return;
    const data = config;
    if (!data) return;
    const p = providerMeta;
    const fields = providerFields(p, provider, data);
    const updates: Record<string, unknown> = {
      model,
      bot_type: provider,
    };
    if (fields.baseKey && apiBase.trim()) updates[fields.baseKey] = apiBase.trim();
    let newKey = '';
    if (fields.keyField && apiKey.trim() && !apiKeyMasked) {
      newKey = apiKey.trim();
      updates[fields.keyField] = newKey;
    }

    const res = await api.saveConfig({ updates });
    if (res.status === 'success') {
      setConfig((prev) => {
        if (!prev) return prev;
        const next: AppConfig = {
          ...prev,
          model,
          bot_type: provider,
        };
        if (fields.baseKey && apiBase.trim()) {
          next.api_bases = { ...prev.api_bases, [fields.baseKey]: apiBase.trim() };
        }
        if (fields.keyField && newKey) {
          next.api_keys = { ...prev.api_keys, [fields.keyField]: maskKey(newKey) };
        }
        return next;
      });
      if (fields.keyField && newKey) {
        setApiKey(maskKey(newKey));
        setApiKeyMasked(true);
      }
      flash(setModelStatus, 'config_saved', false);
    } else {
      flash(setModelStatus, 'config_save_error', true);
    }
  };

  const saveAgentConfig = async () => {
    const effortKey = `${provider}:${selectedModel.trim().toLowerCase()}`;
    const merged = { ...reasoningByModel, [effortKey]: effectiveReasoning };
    const updates: Record<string, unknown> = {
      agent_max_context_tokens: maxTokens || 50000,
      agent_max_context_turns: maxTurns || 20,
      agent_max_steps: maxSteps || 20,
      enable_thinking: thinking,
      reasoning_effort_by_model: merged,
      subagent_enabled: subagent,
      self_evolution_enabled: selfEvolution,
    };
    const res = await api.saveConfig({ updates });
    if (res.status === 'success') {
      setReasoningByModel(merged);
      setConfig((prev) => (prev ? { ...prev, ...updates } : prev));
      flash(setAgentStatus, 'config_saved', false);
    } else {
      flash(setAgentStatus, 'config_save_error', true);
    }
  };

  const saveImageConfig = async () => {
    const updates: Record<string, unknown> = {
      image_enabled: imgEnabled,
      image_provider: imgProvider,
      image_model: imgModel.trim(),
      image_size: imgSize,
      image_quality: imgQuality,
      image_max_per_call: imgMax || 1,
      image_fallback: imgFallback,
      image_api_base: imgBase.trim(),
    };
    const newKey = imgKey.trim() && !imgKeyMasked ? imgKey.trim() : '';
    if (newKey) updates.image_api_key = newKey;
    const res = await api.saveConfig({ updates });
    if (res.status === 'success') {
      setConfig((prev) => (prev ? { ...prev, ...updates } : prev));
      if (newKey) {
        setImgKey(maskKey(newKey));
        setImgKeyMasked(true);
      }
      flash(setImageStatus, 'config_saved', false);
    } else {
      flash(setImageStatus, 'config_save_error', true);
    }
  };

  const onPermissionChange = async (mode: string) => {
    const pm = mode as PermissionMode;
    setPermission(pm);
    const res = await api.saveConfig({ updates: { agent_permission_mode: pm } });
    if (res.status === 'success') {
      setConfig((prev) => (prev ? { ...prev, agent_permission_mode: pm } : prev));
      flash(setSecurityStatus, 'config_saved', false);
    } else {
      flash(setSecurityStatus, 'config_save_error', true);
    }
  };

  const savePasswordConfig = async () => {
    if (passwordMasked) {
      flash(setSecurityStatus, 'config_saved', false);
      return;
    }
    const newPwd = password.trim();
    const res = (await api.saveConfig({ updates: { web_password: newPwd } })) as {
      status: string;
      warning?: string;
    };
    if (res.status === 'success') {
      if (newPwd) {
        setPassword(maskKey(newPwd));
        setPasswordMasked(true);
        flash(setSecurityStatus, 'config_password_changed', false);
      } else {
        setPassword('');
        setPasswordMasked(false);
        setConfig((prev) => (prev ? { ...prev, web_password_masked: '' } : prev));
        if (res.warning === 'password_cleared_with_public_host') {
          flash(setSecurityStatus, 'config_password_security_warning', true);
        } else {
          flash(setSecurityStatus, 'config_password_cleared', false);
        }
      }
    } else {
      flash(setSecurityStatus, 'config_save_error', true);
    }
  };

  const onNotifyChange = (value: boolean) => {
    setNotify(value);
    writeLocalFlag(TASK_NOTIFY_KEY, value);
    if (value && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission()
        .then((perm) => setNotifyBlocked(perm === 'denied'))
        .catch(() => undefined);
    } else {
      setNotifyBlocked(value && typeof Notification !== 'undefined' && Notification.permission === 'denied');
    }
  };

  const onNotifySoundChange = (value: boolean) => {
    setNotifySound(value);
    writeLocalFlag(TASK_NOTIFY_SOUND_KEY, value);
  };

  /* --------------------------------------------------------------- render */

  const showCustomModel = modelChoice === '__custom__';
  const showReasoning = thinking && reasoningOptions.length > 0;

  const cardHeader = (icon: string, chip: string, glyph: string, title: string, right?: ReactNode) => (
    <div className="flex items-center gap-3 mb-5">
      <IconChip icon={icon} className={chip} glyph={glyph} />
      <h3 className="font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      {right}
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        <PageHeader title={t('config_title')} desc={t('config_desc')} />

        <div className="mb-6">
          <SegmentedTabs
            tabs={[
              { id: 'basic', label: t('settings_tab_basic'), icon: 'fa-sliders' },
              { id: 'models', label: t('settings_tab_models'), icon: 'fa-microchip' },
            ]}
            active={tab}
            onChange={(id) => setTab(id === 'models' ? 'models' : 'basic')}
          />
        </div>

        {tab === 'basic' ? (
          loading || !config ? (
            <LoadingRow label={t('config_title')} />
          ) : (
            <div className="grid gap-6">
              {/* -------------------------------------------------- Model */}
              <Card className="p-6">
                {cardHeader(
                  'fa-microchip',
                  'bg-primary-50 dark:bg-primary-900/30',
                  'text-primary-500',
                  t('config_model'),
                  <AntButton
                    type="link"
                    size="small"
                    onClick={() => setTab('models')}
                    className="ml-auto"
                    style={{ padding: 0 }}
                  >
                    <span>{t('config_model_advanced')}</span>
                    <AppIcon className="fas fa-arrow-right text-[10px]" />
                  </AntButton>,
                )}
                <div className="space-y-5">
                  <Field label={t('config_provider')}>
                    <Dropdown options={providerOptions} value={provider} onChange={onProviderChange} />
                    {provider === 'custom' ? (
                      <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                        <AppIcon className="fas fa-info-circle mr-1" />
                        {t('config_custom_tip')}
                      </p>
                    ) : null}
                  </Field>

                  <Field label={t('config_model_name')}>
                    <Dropdown options={modelOptions} value={modelChoice} onChange={onModelChoiceChange} />
                    {showCustomModel ? (
                      <div className="mt-2">
                        <TextField
                          value={customModel}
                          onChange={(e) => setCustomModel(e.target.value)}
                          placeholder={t('config_custom_model_hint')}
                        />
                      </div>
                    ) : null}
                  </Field>

                  {modelFields?.keyField ? (
                    <Field label="API Key">
                      <div className="relative">
                        <TextField
                          value={apiKey}
                          autoComplete="off"
                          className={apiKeyMasked && !apiKeyVisible ? 'cfg-key-masked' : ''}
                          placeholder="sk-..."
                          onChange={(e) => {
                            setApiKey(e.target.value);
                            setApiKeyMasked(false);
                          }}
                          onFocus={() => {
                            if (apiKeyMasked) {
                              setApiKey('');
                              setApiKeyMasked(false);
                              setApiKeyVisible(false);
                            }
                          }}
                        />
                        <AntButton
                          type="text"
                          size="small"
                          onClick={() => setApiKeyVisible((v) => !v)}
                          className="!absolute right-2.5 top-1/2 -translate-y-1/2"
                          style={{ padding: 4 }}
                        >
                          <AppIcon className={`fas ${apiKeyVisible ? 'fa-eye-slash' : 'fa-eye'} text-xs`} />
                        </AntButton>
                      </div>
                    </Field>
                  ) : null}

                  {modelFields?.baseKey ? (
                    <Field label="API Base">
                      <TextField
                        value={apiBase}
                        onChange={(e) => setApiBase(e.target.value)}
                        placeholder={modelFields.basePlaceholder || 'https://...'}
                      />
                    </Field>
                  ) : null}

                  <div className="flex items-center justify-end gap-3 pt-1">
                    <StatusText status={modelStatus} />
                    <PrimaryButton onClick={saveModelConfig}>{t('config_save')}</PrimaryButton>
                  </div>
                </div>
              </Card>

              {/* -------------------------------------------------- Agent */}
              <Card className="p-6">
                {cardHeader(
                  'fa-robot',
                  'bg-emerald-50 dark:bg-emerald-900/30',
                  'text-emerald-500',
                  t('config_agent'),
                )}
                <div className="space-y-4">
                  <Field label={t('config_max_tokens')} tip="config_max_tokens_hint">
                    <TextField
                      type="number"
                      min={1000}
                      max={10000000}
                      step={1000}
                      value={maxTokens}
                      onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 0)}
                    />
                  </Field>
                  <Field label={t('config_max_turns')} tip="config_max_turns_hint">
                    <TextField
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      value={maxTurns}
                      onChange={(e) => setMaxTurns(parseInt(e.target.value, 10) || 0)}
                    />
                  </Field>
                  <Field label={t('config_max_steps')} tip="config_max_steps_hint">
                    <TextField
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      value={maxSteps}
                      onChange={(e) => setMaxSteps(parseInt(e.target.value, 10) || 0)}
                    />
                  </Field>
                  <ToggleRow
                    label={t('config_enable_thinking')}
                    tipKey="config_enable_thinking_hint"
                    checked={thinking}
                    onChange={setThinking}
                  />
                  {showReasoning ? (
                    <Field label={t('config_reasoning_effort')} tip="config_reasoning_effort_hint">
                      <Dropdown
                        options={reasoningOptions.map((o) => ({
                          value: o.value,
                          label: o.label || o.value,
                        }))}
                        value={effectiveReasoning}
                        onChange={setReasoningEffort}
                      />
                    </Field>
                  ) : null}
                  <ToggleRow
                    label={t('config_subagent')}
                    tipKey="config_subagent_hint"
                    checked={subagent}
                    onChange={setSubagent}
                  />
                  <ToggleRow
                    label={t('config_self_evolution')}
                    tipKey="config_self_evolution_hint"
                    checked={selfEvolution}
                    onChange={setSelfEvolution}
                  />
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <StatusText status={agentStatus} />
                    <PrimaryButton onClick={saveAgentConfig}>{t('config_save')}</PrimaryButton>
                  </div>
                </div>
              </Card>

              {/* ------------------------------------------ Image generation */}
              <Card className="p-6">
                {cardHeader(
                  'fa-image',
                  'bg-fuchsia-50 dark:bg-fuchsia-900/30',
                  'text-fuchsia-500',
                  t('config_image'),
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500 -mt-3 mb-4">
                  {t('config_image_desc')}
                </p>
                <div className="space-y-4">
                  <ToggleRow
                    label={t('config_image_enabled')}
                    checked={imgEnabled}
                    onChange={setImgEnabled}
                  />
                  <Field label={t('config_image_provider')} tip="config_image_provider_hint">
                    <Dropdown
                      options={imageProviderOptions}
                      value={imgProvider}
                      onChange={setImgProvider}
                    />
                  </Field>
                  <Field label={t('config_image_model')} tip="config_image_model_hint">
                    <TextField
                      value={imgModel}
                      onChange={(e) => setImgModel(e.target.value)}
                      placeholder="gpt-image-1 / seedream-5.0-lite / qwen-image-2.0"
                    />
                  </Field>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label={t('config_image_size')} tip="config_image_size_hint">
                      <Dropdown options={imageSizeOptions} value={imgSize} onChange={setImgSize} />
                    </Field>
                    <Field label={t('config_image_quality')} tip="config_image_quality_hint">
                      <Dropdown
                        options={imageQualityOptions}
                        value={imgQuality}
                        onChange={setImgQuality}
                      />
                    </Field>
                  </div>
                  <Field label={t('config_image_max')}>
                    <TextField
                      type="number"
                      min={1}
                      max={4}
                      step={1}
                      value={imgMax}
                      onChange={(e) => setImgMax(parseInt(e.target.value, 10) || 1)}
                    />
                  </Field>
                  <ToggleRow
                    label={t('config_image_fallback')}
                    checked={imgFallback}
                    onChange={setImgFallback}
                  />
                  <Field label={t('config_image_key')} tip="config_image_key_hint">
                    <TextField
                      type="password"
                      autoComplete="off"
                      className={imgKeyMasked ? 'cfg-key-masked' : ''}
                      value={imgKey}
                      placeholder="sk-..."
                      onChange={(e) => {
                        setImgKey(e.target.value);
                        setImgKeyMasked(false);
                      }}
                      onFocus={() => {
                        if (imgKeyMasked) {
                          setImgKey('');
                          setImgKeyMasked(false);
                        }
                      }}
                    />
                  </Field>
                  <Field label={t('config_image_base')}>
                    <TextField
                      value={imgBase}
                      onChange={(e) => setImgBase(e.target.value)}
                      placeholder="https://..."
                    />
                  </Field>
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <StatusText status={imageStatus} />
                    <PrimaryButton onClick={saveImageConfig}>{t('config_save')}</PrimaryButton>
                  </div>
                </div>
              </Card>

              {/* ----------------------------------------------- Security */}
              <Card className="p-6">
                {cardHeader(
                  'fa-lock',
                  'bg-amber-50 dark:bg-amber-900/30',
                  'text-amber-500',
                  t('config_security'),
                )}
                <div className="space-y-4">
                  <Field label={t('config_permission')} tip="config_permission_hint">
                    <Dropdown
                      options={permissionOptions}
                      value={permission}
                      onChange={onPermissionChange}
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                      {t('config_permission_desc')}
                    </p>
                  </Field>
                  <Field label={t('config_password')}>
                    <TextField
                      type="password"
                      autoComplete="new-password"
                      className={passwordMasked ? 'cfg-key-masked' : ''}
                      value={password}
                      placeholder={passwordMasked ? '••••••••' : ''}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        setPasswordMasked(false);
                      }}
                      onFocus={() => {
                        if (passwordMasked) {
                          setPassword('');
                          setPasswordMasked(false);
                        }
                      }}
                    />
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">
                      {t('config_password_hint')}
                    </p>
                  </Field>
                  <div className="flex items-center justify-end gap-3 pt-1">
                    <StatusText status={securityStatus} />
                    <PrimaryButton onClick={savePasswordConfig}>{t('config_save')}</PrimaryButton>
                  </div>
                </div>
              </Card>

              {/* ------------------------------------------------- System */}
              <Card className="p-6">
                {cardHeader('fa-sliders-h', 'bg-sky-50 dark:bg-sky-900/30', 'text-sky-500', t('config_system'))}
                <div className="space-y-4">
                  <Field label={t('config_language')} tip="config_language_hint">
                    <Dropdown
                      options={LANGS.map((code) => ({ value: code, label: LANG_LABELS[code] }))}
                      value={lang}
                      onChange={(value) => setLang(value as Lang)}
                    />
                  </Field>
                  <ToggleRow
                    label={t('config_task_notify')}
                    tipKey="config_task_notify_hint"
                    checked={notify}
                    onChange={onNotifyChange}
                  />
                  <ToggleRow
                    label={t('config_task_notify_sound')}
                    tipKey="config_task_notify_sound_hint"
                    checked={notifySound}
                    onChange={onNotifySoundChange}
                  />
                  {notifyBlocked ? (
                    <div className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
                      <AppIcon className="fas fa-triangle-exclamation mt-0.5" />
                      <span>{t('config_task_notify_blocked')}</span>
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>
          )
        ) : (
          <ModelsPanel />
        )}
      </div>
    </div>
  );
}
