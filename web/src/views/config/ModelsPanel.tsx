import { AppIcon } from '@/components/ui/AppIcon';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button as AntButton, Card as AntCard, Tag } from 'antd';
import { api } from '@/api';
import type {
  CapabilityState,
  ModelsResult,
  ProviderOverview,
} from '@/api/types';
import { useI18n } from '@/i18n/useI18n';
import type { Lang } from '@/i18n';
import { useUI } from '@/store/ui';
import { useChat } from '@/store/chat';
import { classNames } from '@/lib/format';
import {
  Card,
  Dropdown,
  Field,
  IconChip,
  LoadingRow,
  Modal,
  ModalFooter,
  ModalHeader,
  PrimaryButton,
  SecondaryButton,
  TextField,
} from '@/components/ui/primitives';

/* ------------------------------------------------------------------ types */

type ModelEntry = string | { value: string; label?: string; hint?: string };
type VoiceEntry = string | { value: string; label?: string; hint?: string };

interface CapState extends CapabilityState {
  configured_providers?: string[];
  fixed_provider?: string;
  provider_models?: Record<string, ModelEntry[]>;
  provider_voices?: Record<string, VoiceEntry[] | Record<string, VoiceEntry[]>>;
  current_voice?: string;
  current_dim?: number;
  reply_mode?: string;
  suggested_provider?: string;
  fallback_provider?: string;
  fallback_model?: string;
}

interface ProviderItem extends ProviderOverview {
  custom_name?: string;
}

interface CapProviderRef {
  id: string;
  label: string | Record<string, string>;
  configured: boolean;
  api_key_masked?: string;
}

interface Status {
  text: string;
  err: boolean;
}

interface CapDef {
  id: string;
  icon: string;
  needsModel: boolean;
  supportsAuto: boolean;
  titleKey: string;
  descKey: string;
  iconChip: string;
  iconGlyph: string;
}

const CAP_DEFS: CapDef[] = [
  {
    id: 'chat',
    icon: 'fa-microchip',
    needsModel: true,
    supportsAuto: false,
    titleKey: 'models_capability_chat',
    descKey: 'models_capability_chat_desc',
    iconChip: 'bg-primary-50 dark:bg-primary-900/30',
    iconGlyph: 'text-primary-500',
  },
  {
    id: 'vision',
    icon: 'fa-eye',
    needsModel: true,
    supportsAuto: true,
    titleKey: 'models_capability_vision',
    descKey: 'models_capability_vision_desc',
    iconChip: 'bg-blue-50 dark:bg-blue-900/30',
    iconGlyph: 'text-blue-500',
  },
  {
    id: 'image',
    icon: 'fa-image',
    needsModel: true,
    supportsAuto: true,
    titleKey: 'models_capability_image',
    descKey: 'models_capability_image_desc',
    iconChip: 'bg-blue-50 dark:bg-blue-900/30',
    iconGlyph: 'text-blue-500',
  },
  {
    id: 'asr',
    icon: 'fa-microphone',
    needsModel: true,
    supportsAuto: false,
    titleKey: 'models_capability_asr',
    descKey: 'models_capability_asr_desc',
    iconChip: 'bg-amber-50 dark:bg-amber-900/30',
    iconGlyph: 'text-amber-500',
  },
  {
    id: 'tts',
    icon: 'fa-volume-high',
    needsModel: true,
    supportsAuto: false,
    titleKey: 'models_capability_tts',
    descKey: 'models_capability_tts_desc',
    iconChip: 'bg-amber-50 dark:bg-amber-900/30',
    iconGlyph: 'text-amber-500',
  },
  {
    id: 'embedding',
    icon: 'fa-vector-square',
    needsModel: true,
    supportsAuto: false,
    titleKey: 'models_capability_embedding',
    descKey: 'models_capability_embedding_desc',
    iconChip: 'bg-purple-50 dark:bg-purple-900/30',
    iconGlyph: 'text-purple-500',
  },
  {
    id: 'search',
    icon: 'fa-magnifying-glass',
    needsModel: false,
    supportsAuto: false,
    titleKey: 'models_capability_search',
    descKey: 'models_capability_search_desc',
    iconChip: 'bg-orange-50 dark:bg-orange-900/30',
    iconGlyph: 'text-orange-500',
  },
];

const DARK_INVERT_LOGOS = new Set(['openai', 'moonshot', 'zhipu', 'custom']);

/* ---------------------------------------------------------------- helpers */

function labelOf(label: ProviderOverview['label'] | undefined, lang: Lang): string {
  if (label && typeof label === 'object') {
    return label[lang] || label.en || label.zh || Object.values(label)[0] || '';
  }
  return label || '';
}

function maskKey(value: string): string {
  if (!value || value.length <= 8) return value;
  return value.slice(0, 4) + '*'.repeat(value.length - 8) + value.slice(value.length - 4);
}

function isCustomProviderCard(p: ProviderItem): boolean {
  return !!(p && p.is_custom && p.custom_name);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** cap.providers is either string[] (mock) or [{id,label,configured}] (backend). */
function providerRefs(cap: CapState): CapProviderRef[] {
  const raw = cap.providers as unknown;
  if (!Array.isArray(raw)) return [];
  const configuredSet = new Set(cap.configured_providers || []);
  return raw.map((item) => {
    if (typeof item === 'string') {
      return { id: item, label: item, configured: configuredSet.has(item) };
    }
    const o = asRecord(item);
    const id = String(o.id ?? '');
    return {
      id,
      label: (o.label as string | Record<string, string>) ?? id,
      configured: !!o.configured || configuredSet.has(id),
      api_key_masked: typeof o.api_key_masked === 'string' ? o.api_key_masked : undefined,
    };
  });
}

function normalizeModels(raw: ModelEntry[]): { value: string; label: string; hint?: string }[] {
  return raw.map((entry) =>
    typeof entry === 'string'
      ? { value: entry, label: entry }
      : { value: entry.value, label: entry.label || entry.value, hint: entry.hint },
  );
}

function baseModelList(
  providerId: string,
  cap: CapState,
  providers: ProviderItem[],
): { value: string; label: string; hint?: string }[] {
  const map = cap.provider_models || {};
  let raw: ModelEntry[] = [];
  if (map[providerId]) raw = map[providerId].slice();
  else if (providerId.startsWith('custom:') && map.custom) raw = map.custom.slice();
  else {
    const p = providers.find((x) => x.id === providerId);
    raw = ((p?.models as string[] | undefined) || []).slice();
  }
  return normalizeModels(raw);
}

function voiceList(
  providerId: string,
  modelId: string,
  cap: CapState,
): { value: string; label: string; hint?: string }[] {
  const map = cap.provider_voices || {};
  let raw: unknown = map[providerId];
  if (!raw) return [];
  if (!Array.isArray(raw) && typeof raw === 'object') {
    const keyed = asRecord(raw);
    raw = keyed[modelId] || keyed[Object.keys(keyed)[0]] || [];
  }
  if (!Array.isArray(raw)) return [];
  return normalizeModels(raw as VoiceEntry[]);
}

/* ------------------------------------------------------------ provider logo */

function ProviderLogo({ providerId, label, size = 32 }: { providerId: string; label: string; size?: number }) {
  const [state, setState] = useState<'loading' | 'ok' | 'err'>('loading');
  const initial = (label || providerId || '?').slice(0, 1).toUpperCase();
  const invert = DARK_INVERT_LOGOS.has(providerId);
  return (
    <span
      className="relative flex items-center justify-center rounded-lg bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-slate-300 flex-shrink-0 overflow-hidden"
      style={{ width: size, height: size }}
    >
      {state !== 'ok' ? <span className="text-xs font-bold">{initial}</span> : null}
      {state !== 'err' ? (
        <img
          src={`/assets/logos/${encodeURIComponent(providerId)}.svg`}
          alt=""
          aria-hidden="true"
          className={classNames('absolute inset-0 m-auto provider-logo-img', invert && 'provider-logo-invert-dark')}
          style={{ width: Math.round(size * 0.65), height: Math.round(size * 0.65) }}
          onLoad={() => setState('ok')}
          onError={() => setState('err')}
        />
      ) : null}
    </span>
  );
}

/* ---------------------------------------------------------- capability card */

interface CapabilityCardProps {
  def: CapDef;
  cap: CapState;
  providers: ProviderItem[];
  onSaved: (id: string, patch: Partial<CapState>) => void;
  onConfigureProvider: (providerId: string) => void;
  onConfigureSearch: (ref: CapProviderRef) => void;
  onAddSearchProvider: (items: CapProviderRef[]) => void;
  onSearchSaved: (id: string, patch: Partial<CapState>) => void;
}

function CapabilityCard({
  def,
  cap,
  providers,
  onSaved,
  onConfigureProvider,
  onConfigureSearch,
  onAddSearchProvider,
  onSearchSaved,
}: CapabilityCardProps) {
  const { t, lang } = useI18n();
  const { confirm, navigateTo, toast } = useUI();
  const { setDraft } = useChat();

  const optionList = useMemo(() => {
    const known = new Map(providers.map((p) => [p.id, p]));
    // Backends may send `cap.providers` either as provider-id strings
    // (preferred) or as objects. Normalize both so a stray object never
    // reaches React as a child (which would blank the whole page).
    const raw: unknown = cap.providers;
    const explicit = Array.isArray(raw) && raw.length ? raw : null;
    const objectConfigured = new Set<string>();
    let ids: string[];
    if (explicit) {
      ids = [];
      for (const item of explicit) {
        if (typeof item === 'string') {
          ids.push(item);
        } else if (item && typeof item === 'object') {
          const obj = item as { id?: unknown; configured?: unknown };
          const id = obj.id == null ? '' : String(obj.id);
          if (id) {
            ids.push(id);
            if (obj.configured) objectConfigured.add(id);
          }
        }
      }
    } else {
      ids = providers.map((p) => p.id);
    }
    if (cap.current_provider && !ids.includes(cap.current_provider)) ids = [cap.current_provider, ...ids];
    const opts = ids.map((pid) => {
      const meta = known.get(pid);
      const tracked = !!meta;
      const configured = !tracked || !!meta.configured || objectConfigured.has(pid);
      return {
        value: pid,
        label: meta ? labelOf(meta.label, lang) : pid,
        tracked,
        configured,
        isAuto: false,
      };
    });
    opts.sort((a, b) => (a.configured === b.configured ? 0 : a.configured ? -1 : 1));
    const hasAnyConfigured = opts.some((o) => o.configured);
    if ((cap.strategy === 'auto' || cap.strategy === 'specified') && hasAnyConfigured && def.supportsAuto) {
      opts.unshift({ value: '', label: t('models_strategy_auto'), tracked: false, configured: true, isAuto: true });
    }
    return opts;
  }, [cap.providers, cap.current_provider, cap.strategy, providers, lang, t, def.supportsAuto]);

  const hasConfiguredOpt = optionList.some((o) => !o.isAuto && o.configured);
  const noSelection = !cap.current_provider && !cap.suggested_provider;

  const [provider, setProvider] = useState<string>(() => {
    if (!hasConfiguredOpt) return '';
    if (def.supportsAuto && cap.strategy === 'auto') return '';
    return cap.current_provider || cap.suggested_provider || (noSelection ? '' : optionList[0]?.value || '');
  });
  const [modelChoice, setModelChoice] = useState<string>(() => {
    const list = baseModelList(cap.current_provider || '', cap, providers);
    const saved = cap.current_model || '';
    if (saved && list.some((m) => m.value === saved)) return saved;
    if (saved) return '__custom__';
    return list[0]?.value || '__custom__';
  });
  const [customModel, setCustomModel] = useState<string>(() => {
    const list = baseModelList(cap.current_provider || '', cap, providers);
    const saved = cap.current_model || '';
    return saved && !list.some((m) => m.value === saved) ? saved : '';
  });
  const [voiceChoice, setVoiceChoice] = useState<string>(() => {
    const list = voiceList(cap.current_provider || '', cap.current_model || '', cap);
    const saved = cap.current_voice || '';
    if (saved && list.some((v) => v.value === saved)) return saved;
    if (saved) return '__custom__';
    return list[0]?.value || '';
  });
  const [customVoice, setCustomVoice] = useState<string>(() => {
    const list = voiceList(cap.current_provider || '', cap.current_model || '', cap);
    const saved = cap.current_voice || '';
    return saved && !list.some((v) => v.value === saved) ? saved : '';
  });
  const [replyMode, setReplyMode] = useState<string>(() => cap.reply_mode || 'off');
  const [strategy, setStrategy] = useState<string>(() =>
    (cap.configured_providers || []).length || providerRefs(cap).some((r) => r.configured)
      ? cap.strategy || 'auto'
      : '',
  );
  const [fixedProvider, setFixedProvider] = useState<string>(() => {
    const refs = providerRefs(cap);
    const configured = refs.filter((r) => r.configured).map((r) => r.id);
    const list = cap.configured_providers && cap.configured_providers.length ? cap.configured_providers : configured;
    return cap.fixed_provider || list[0] || '';
  });
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const flash = useCallback(
    (key: string, err: boolean) => {
      setStatus({ text: t(key), err });
      if (!err) setTimeout(() => setStatus(null), 2500);
    },
    [t],
  );

  const modelEntries = useMemo(() => {
    const list = baseModelList(provider, cap, providers);
    list.push({ value: '__custom__', label: t('config_custom_option') });
    return list;
  }, [provider, cap, providers, t]);

  const voiceEntries = useMemo(() => {
    const list = voiceList(provider, modelChoice, cap);
    if (list.length) list.push({ value: '__custom__', label: t('config_custom_option') });
    return list;
  }, [provider, modelChoice, cap, t]);

  const currentModelValue = () => (modelChoice === '__custom__' ? customModel.trim() : modelChoice);
  const currentVoiceValue = () => (voiceChoice === '__custom__' ? customVoice.trim() : voiceChoice);

  const onProviderSelect = (value: string) => {
    const opt = optionList.find((o) => o.value === value);
    if (opt && !opt.configured && opt.tracked && !opt.isAuto) {
      onConfigureProvider(value);
      return;
    }
    setProvider(value);
    if (value === '' && def.supportsAuto) return;
    const list = baseModelList(value, cap, providers);
    setModelChoice(list[0]?.value || '__custom__');
    setCustomModel('');
    if (def.id === 'tts') {
      const vs = voiceList(value, list[0]?.value || '', cap);
      setVoiceChoice(vs[0]?.value || '');
      setCustomVoice('');
    }
  };

  const onModelSelect = (value: string) => {
    setModelChoice(value);
    if (value !== '__custom__') setCustomModel('');
    if (def.id === 'tts') {
      const vs = voiceList(provider, value, cap);
      setVoiceChoice(vs[0]?.value || '');
      setCustomVoice('');
    }
  };

  const persist = async (): Promise<boolean> => {
    const isAuto = provider === '' && def.supportsAuto;
    const model = isAuto || (def.id === 'embedding' && !provider) ? '' : currentModelValue();
    const voice = def.id === 'tts' && !isAuto ? currentVoiceValue() : '';
    const payload: Record<string, unknown> = {
      action: 'set_capability',
      capability: def.id,
      provider_id: provider,
      provider,
      model,
    };
    if (def.id === 'tts') payload.voice = voice;
    const res = await api.modelsAction(payload);
    if (res.status === 'success') {
      onSaved(def.id, {
        current_provider: provider,
        current_model: model,
        ...(def.id === 'tts' ? { current_voice: voice } : {}),
      });
      return true;
    }
    return false;
  };

  const save = async () => {
    setSaving(true);
    try {
      if (def.id === 'search') {
        const res = await api.modelsAction({
          action: 'set_capability',
          capability: 'search',
          strategy: strategy || 'auto',
          provider: strategy === 'fixed' ? fixedProvider : '',
        });
        if (res.status === 'success') {
          onSearchSaved('search', {
            strategy: strategy || 'auto',
            fixed_provider: strategy === 'fixed' ? fixedProvider : '',
            current_provider: strategy === 'fixed' ? fixedProvider : '',
          });
          flash('models_save_success', false);
        } else {
          flash('models_save_failed', true);
        }
        return;
      }

      if (def.id === 'embedding') {
        const before = (cap.current_provider || '').trim();
        const after = (provider || '').trim();
        if (before !== after) {
          const ok = await confirm({
            title: t('models_embedding_change_title'),
            message: t('models_embedding_change_msg'),
            okText: t('save'),
            cancelText: t('cancel'),
          });
          if (!ok) return;
          const done = await persist();
          if (done) {
            const go = await confirm({
              title: t('models_embedding_saved_title'),
              message: t('models_embedding_saved_msg'),
              okText: t('models_embedding_saved_ok'),
              hideCancel: true,
            });
            if (go) {
              navigateTo('chat');
              setDraft('/memory rebuild-index');
            }
          } else {
            flash('models_save_failed', true);
          }
          return;
        }
      }

      const done = await persist();
      if (done) flash('models_save_success', false);
      else flash('models_save_failed', true);
    } catch {
      flash('models_save_failed', true);
    } finally {
      setSaving(false);
    }
  };

  const changeReplyMode = async (mode: string) => {
    setReplyMode(mode);
    try {
      await api.modelsAction({ action: 'set_voice_reply_mode', mode });
      onSaved(def.id, { reply_mode: mode });
      toast(t('models_save_success'), 'success');
    } catch {
      toast(t('models_save_failed'), 'error');
    }
  };

  const renderHint = () => {
    if (provider !== '' || !def.supportsAuto) return null;
    const fbProv = cap.fallback_provider || '';
    const fbModel = cap.fallback_model || '';
    if (!fbProv && !fbModel) return null;
    const meta = providers.find((p) => p.id === fbProv);
    const fbLabel = meta ? labelOf(meta.label, lang) : fbProv;
    const text = fbModel ? `${fbLabel} / ${fbModel}` : fbLabel;
    return (
      <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500 min-w-0">
        <AppIcon className="fas fa-circle-info text-[10px] flex-shrink-0" />
        <span className="flex-shrink-0">{t('models_auto_using')}</span>
        <span className="font-mono text-slate-500 dark:text-slate-400 truncate">{text}</span>
      </p>
    );
  };

  const placeholder = !hasConfiguredOpt
    ? t('models_pending_config')
    : noSelection && !(def.supportsAuto && cap.strategy === 'auto')
      ? t('models_pick_provider')
      : '--';

  const showModelPicker = def.needsModel && (def.id === 'embedding' ? provider !== '' : !(provider === '' && def.supportsAuto));

  const body = def.id === 'search' ? (
    <>
      <Field label={t('models_search_strategy_label')}>
        <Dropdown
          options={[
            { value: 'auto', label: t('models_strategy_auto') },
            { value: 'fixed', label: t('models_search_strategy_fixed') },
          ]}
          value={strategy}
          placeholder={t('models_pending_config')}
          onChange={setStrategy}
        />
      </Field>
      {strategy === 'fixed' && hasConfiguredOpt ? (
        <Field label={t('models_provider')}>
          <Dropdown
            options={providerRefs(cap).map((r) => ({ value: r.id, label: labelOf(r.label, lang) }))}
            value={fixedProvider}
            onChange={setFixedProvider}
          />
        </Field>
      ) : null}
      <SearchSummary
        refs={providerRefs(cap)}
        onEdit={(ref) => onConfigureSearch(ref)}
        onAdd={() => onAddSearchProvider(providerRefs(cap).filter((r) => !r.configured))}
      />
      <div className="flex items-center justify-end gap-3 pt-1">
        <span className={classNames('text-xs', status ? (status.err ? 'text-red-500' : 'text-primary-500') : 'opacity-0 text-primary-500')}>
          {status?.text || ''}
        </span>
        <PrimaryButton onClick={save} disabled={saving}>
          {t('save')}
        </PrimaryButton>
      </div>
    </>
  ) : (
    <>
      {def.id === 'tts' ? (
        <Field label={t('voice_reply_mode_label')}>
          <Dropdown
            options={[
              { value: 'off', label: t('voice_reply_off') },
              { value: 'voice_if_voice', label: t('voice_reply_if_voice') },
              { value: 'always', label: t('voice_reply_always') },
            ]}
            value={replyMode}
            onChange={changeReplyMode}
          />
        </Field>
      ) : null}

      {!(def.id === 'tts' && replyMode === 'off') ? (
        <>
          <Field label={t('models_provider')}>
            <Dropdown
              options={optionList.map((o) => ({ value: o.value, label: o.label }))}
              value={provider}
              placeholder={placeholder}
              onChange={onProviderSelect}
            />
          </Field>

          {def.needsModel && showModelPicker ? (
            <Field label={t('models_model')}>
              <Dropdown
                options={modelEntries.map((m) => ({ value: m.value, label: m.label }))}
                value={modelChoice}
                onChange={onModelSelect}
              />
              {modelChoice === '__custom__' ? (
                <div className="mt-2">
                  <TextField
                    value={customModel}
                    placeholder="custom model name"
                    onChange={(e) => setCustomModel(e.target.value)}
                  />
                </div>
              ) : null}
            </Field>
          ) : null}

          {def.id === 'tts' && voiceEntries.length ? (
            <Field label={t('models_voice')}>
              <Dropdown
                options={voiceEntries.map((v) => ({ value: v.value, label: v.label }))}
                value={voiceChoice}
                onChange={(value) => {
                  setVoiceChoice(value);
                  if (value !== '__custom__') setCustomVoice('');
                }}
              />
              {voiceChoice === '__custom__' ? (
                <div className="mt-2">
                  <TextField
                    value={customVoice}
                    placeholder="voice id"
                    onChange={(e) => setCustomVoice(e.target.value)}
                  />
                </div>
              ) : null}
            </Field>
          ) : null}

          {def.id === 'embedding' && cap.current_dim ? (
            <p className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-slate-500">
              <AppIcon className="fas fa-cube text-[10px]" />
              <span>
                {t('models_dim_label')}: <span className="font-mono">{cap.current_dim}</span>
              </span>
            </p>
          ) : null}

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="flex-1 min-w-0">{renderHint()}</div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <span className={classNames('text-xs', status ? (status.err ? 'text-red-500' : 'text-primary-500') : 'opacity-0 text-primary-500')}>
                {status?.text || ''}
              </span>
              <PrimaryButton onClick={save} disabled={saving}>
                {t('save')}
              </PrimaryButton>
            </div>
          </div>
        </>
      ) : null}
    </>
  );

  return (
    <Card className="p-6" id={`models-card-${def.id}`}>
      <div className="flex items-start gap-3 mb-5">
        <IconChip icon={def.icon} className={def.iconChip} glyph={def.iconGlyph} />
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-800 dark:text-slate-100">{t(def.titleKey)}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t(def.descKey)}</p>
        </div>
      </div>
      <div className="space-y-4">{body}</div>
    </Card>
  );
}

/* --------------------------------------------------------- search summary */

function SearchSummary({
  refs,
  onEdit,
  onAdd,
}: {
  refs: CapProviderRef[];
  onEdit: (ref: CapProviderRef) => void;
  onAdd: () => void;
}) {
  const { t, lang } = useI18n();
  const configured = refs.filter((r) => r.configured);
  const missing = refs.filter((r) => !r.configured);

  return (
    <div className="flex items-center flex-wrap gap-2 text-xs text-slate-500 dark:text-slate-400">
      {configured.length === 0 ? (
        <>
          <AppIcon className="fas fa-circle-info text-[10px] text-amber-500" />
          <span>{t('models_search_none_configured')}</span>
        </>
      ) : (
        <>
          <span>{t('models_search_available_label')}</span>
          {configured.map((r) => (
            <Tag
              key={r.id}
              color="success"
              style={{ cursor: 'pointer', margin: 0 }}
              title={t('models_search_edit_hint')}
              onClick={() => onEdit(r)}
            >
              <span className="inline-flex items-center gap-1">
                <AppIcon className="fas fa-check text-[10px]" />
                {labelOf(r.label, lang)}
              </span>
            </Tag>
          ))}
        </>
      )}
      {missing.length ? (
        <Tag
          style={{ cursor: 'pointer', margin: 0 }}
          onClick={onAdd}
        >
          <span className="inline-flex items-center gap-1">
            <AppIcon className="fas fa-plus text-[10px]" />
            {t('models_search_add_provider')}
          </span>
        </Tag>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------- vendor modal */

interface VendorModalProps {
  providers: ProviderItem[];
  initialProviderId: string;
  onClose: () => void;
  onConfigureCustom: () => void;
  onSave: (providerId: string, apiBase: string, apiKey: string) => Promise<boolean>;
  onClear: (providerId: string) => Promise<void>;
}

function VendorModal({
  providers,
  initialProviderId,
  onClose,
  onConfigureCustom,
  onSave,
  onClear,
}: VendorModalProps) {
  const { t, lang } = useI18n();
  const adding = !initialProviderId;
  const builtin = useMemo(() => providers.filter((p) => !isCustomProviderCard(p)), [providers]);

  const pickerOpts = useMemo(() => {
    const opts = builtin.map((p) => ({ value: p.id, label: labelOf(p.label, lang) }));
    if (!opts.some((o) => o.value === 'custom')) {
      opts.push({ value: 'custom', label: t('models_custom_vendor_label') });
    }
    return opts;
  }, [builtin, lang, t]);

  const defaultId = useMemo(() => {
    const unc = builtin.find((p) => !p.configured);
    return (unc && unc.id) || (builtin[0] && builtin[0].id) || 'custom';
  }, [builtin]);

  const [providerId, setProviderId] = useState(adding ? defaultId : initialProviderId);
  const meta = providers.find((p) => p.id === providerId);
  const [apiKey, setApiKey] = useState('');
  const [masked, setMasked] = useState(false);
  const [apiBase, setApiBase] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const fill = useCallback(
    (id: string) => {
      const m = providers.find((p) => p.id === id);
      setProviderId(id);
      setApiBase(m?.api_base || '');
      const mk = m?.api_key_masked || '';
      setApiKey(mk);
      setMasked(!!mk);
      setStatus(null);
    },
    [providers],
  );

  useEffect(() => {
    fill(adding ? defaultId : initialProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (value: string) => {
    if (value === 'custom') {
      onConfigureCustom();
      return;
    }
    fill(value);
  };

  const save = async () => {
    if (!providerId) return;
    let key = apiKey.trim();
    if (masked) key = '';
    if (!key && !masked) {
      // First-time setup with no key entered → nudge the user.
      setStatus({ text: t('models_save_failed'), err: true });
      return;
    }
    setSaving(true);
    try {
      const ok = await onSave(providerId, apiBase.trim(), key);
      if (ok) onClose();
      else setStatus({ text: t('models_save_failed'), err: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" z="z-[200]">
      <div className="p-6">
        <ModalHeader
          icon="fa-key"
          title={meta ? labelOf(meta.label, lang) : t('models_provider')}
          subtitle={meta ? meta.id : undefined}
        />
        {adding ? (
          <div className="mb-4">
            <Field label={t('models_provider')}>
              <Dropdown options={pickerOpts} value={providerId} onChange={onPick} />
            </Field>
          </div>
        ) : null}
        <div className="space-y-4">
          <Field label="API Key">
            <TextField
              value={apiKey}
              autoComplete="off"
              className={masked ? 'cfg-key-masked' : ''}
              placeholder="sk-..."
              onChange={(e) => {
                setApiKey(e.target.value);
                setMasked(false);
              }}
              onFocus={() => {
                if (masked) {
                  setApiKey('');
                  setMasked(false);
                }
              }}
            />
          </Field>
          {meta?.api_base_field || meta?.api_base_default || apiBase ? (
            <Field label="API Base">
              <TextField
                value={apiBase}
                placeholder={meta?.api_base_default || meta?.api_base_placeholder || 'https://...../v1'}
                onChange={(e) => setApiBase(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
      </div>
      <ModalFooter>
        <div className="mr-auto flex items-center gap-3">
          {meta?.configured ? (
            <SecondaryButton
              className="!border-transparent !bg-transparent !px-3 !text-red-500 dark:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-900/20"
              onClick={() => onClear(providerId)}
              disabled={saving}
            >
              {t('models_clear_credential')}
            </SecondaryButton>
          ) : null}
          <span className={classNames('text-xs', status?.err ? 'text-red-500' : 'text-primary-500')}>
            {status?.text || ''}
          </span>
        </div>
        <SecondaryButton onClick={onClose} disabled={saving}>
          {t('cancel')}
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={saving}>
          {t('save')}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

/* --------------------------------------------------- custom provider modal */

interface CustomProviderModalProps {
  providers: ProviderItem[];
  editId: string;
  onClose: () => void;
  onSave: (payload: { name: string; apiBase: string; apiKey: string; id?: string }) => Promise<boolean>;
  onDelete: (id: string) => Promise<void>;
}

function CustomProviderModal({ providers, editId, onClose, onSave, onDelete }: CustomProviderModalProps) {
  const { t } = useI18n();
  const editing = !!editId;
  const card = editing ? providers.find((p) => p.custom_id === editId) : undefined;
  const [name, setName] = useState(card?.custom_name || '');
  const [apiBase, setApiBase] = useState(card?.api_base || '');
  const [apiKey, setApiKey] = useState(card?.api_key_masked || '');
  const [masked, setMasked] = useState(!!(card?.configured && card?.api_key_masked));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const save = async () => {
    if (!name.trim()) {
      setStatus({ text: t('models_custom_name_required'), err: true });
      return;
    }
    if (!editing && !apiBase.trim()) {
      setStatus({ text: t('models_custom_base_required'), err: true });
      return;
    }
    let key = apiKey.trim();
    if (masked) key = '';
    setSaving(true);
    try {
      const ok = await onSave({ name: name.trim(), apiBase: apiBase.trim(), apiKey: key, id: editId || undefined });
      if (ok) onClose();
      else setStatus({ text: t('models_save_failed'), err: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" z="z-[200]">
      <div className="p-6">
        <ModalHeader
          icon="fa-sliders"
          title={editing ? t('models_custom_edit_title') : t('models_custom_add_title')}
        />
        <div className="space-y-4">
          <Field label={t('models_custom_name')}>
            <TextField value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="API Base">
            <TextField
              value={apiBase}
              placeholder="https://...../v1"
              onChange={(e) => setApiBase(e.target.value)}
            />
          </Field>
          <Field label="API Key">
            <TextField
              value={apiKey}
              autoComplete="off"
              className={masked ? 'cfg-key-masked' : ''}
              onChange={(e) => {
                setApiKey(e.target.value);
                setMasked(false);
              }}
              onFocus={() => {
                if (masked) {
                  setApiKey('');
                  setMasked(false);
                }
              }}
            />
          </Field>
        </div>
      </div>
      <ModalFooter>
        <div className="mr-auto flex items-center gap-3">
          {editing ? (
            <SecondaryButton
              className="!border-transparent !bg-transparent !px-3 !text-red-500 dark:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-900/20"
              onClick={() => onDelete(editId)}
              disabled={saving}
            >
              {t('models_custom_delete')}
            </SecondaryButton>
          ) : null}
          <span className={classNames('text-xs', status?.err ? 'text-red-500' : 'text-primary-500')}>
            {status?.text || ''}
          </span>
        </div>
        <SecondaryButton onClick={onClose} disabled={saving}>
          {t('cancel')}
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={saving}>
          {t('save')}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

/* ---------------------------------------------------------- bocha modal */

function BochaModal({
  maskedKey,
  onClose,
  onSave,
  onClear,
}: {
  maskedKey: string;
  onClose: () => void;
  onSave: (apiKey: string) => Promise<boolean>;
  onClear: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [apiKey, setApiKey] = useState(maskedKey);
  const [masked, setMasked] = useState(!!maskedKey);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  const save = async () => {
    if (masked) {
      onClose();
      return;
    }
    const key = apiKey.trim();
    if (!key) return;
    setSaving(true);
    try {
      const ok = await onSave(key);
      if (ok) onClose();
      else setStatus({ text: t('models_save_failed'), err: true });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" z="z-[200]">
      <div className="p-6">
        <ModalHeader icon="fa-magnifying-glass" iconChip="bg-orange-50 dark:bg-orange-900/30" iconGlyph="text-orange-500" title={t('models_search_bocha_title')} subtitle={t('models_search_bocha_desc')} />
        <Field label="API Key">
          <TextField
            value={apiKey}
            autoComplete="off"
            className={masked ? 'cfg-key-masked' : ''}
            placeholder="sk-..."
            onChange={(e) => {
              setApiKey(e.target.value);
              setMasked(false);
            }}
            onFocus={() => {
              if (masked) {
                setApiKey('');
                setMasked(false);
              }
            }}
          />
        </Field>
      </div>
      <ModalFooter>
        <div className="mr-auto flex items-center gap-3">
          {maskedKey ? (
            <SecondaryButton
              className="!border-transparent !bg-transparent !px-3 !text-red-500 dark:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-900/20"
              onClick={() => onClear()}
              disabled={saving}
            >
              {t('models_clear_credential')}
            </SecondaryButton>
          ) : null}
          <span className={classNames('text-xs', status?.err ? 'text-red-500' : 'text-primary-500')}>
            {status?.text || ''}
          </span>
        </div>
        <SecondaryButton onClick={onClose} disabled={saving}>
          {t('cancel')}
        </SecondaryButton>
        <PrimaryButton onClick={save} disabled={saving}>
          {t('save')}
        </PrimaryButton>
      </ModalFooter>
    </Modal>
  );
}

/* ------------------------------------------------------- search add modal */

function SearchAddModal({
  items,
  onPick,
  onClose,
}: {
  items: CapProviderRef[];
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  return (
    <Modal open onClose={onClose} maxWidth="max-w-md" z="z-[200]">
      <div className="p-6">
        <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-1">
          {t('models_search_add_provider')}
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{t('models_search_add_desc')}</p>
        <div className="space-y-2">
          {items.map((item) => (
            <AntButton
              key={item.id}
              type="text"
              block
              onClick={() => onPick(item.id)}
              className="!h-auto !justify-between !px-3 !py-2.5 !bg-slate-50 dark:!bg-white/5 text-sm text-slate-700 dark:text-slate-200"
            >
              <span>{labelOf(item.label, lang)}</span>
              <AppIcon className="fas fa-chevron-right text-[10px] text-slate-400" />
            </AntButton>
          ))}
        </div>
      </div>
      <ModalFooter>
        <SecondaryButton onClick={onClose}>{t('cancel')}</SecondaryButton>
      </ModalFooter>
    </Modal>
  );
}

/* --------------------------------------------------------------- panel */

export function ModelsPanel() {
  const { t, lang } = useI18n();
  const { toast, confirm } = useUI();

  const [data, setData] = useState<ModelsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [vendorModal, setVendorModal] = useState<{ providerId: string } | null>(null);
  const [customModal, setCustomModal] = useState<{ editId: string } | null>(null);
  const [bochaModal, setBochaModal] = useState<{ maskedKey: string } | null>(null);
  const [searchAdd, setSearchAdd] = useState<CapProviderRef[] | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .getModels()
      .then((res) => {
        if (res.status !== 'success') {
          setError(t('models_save_failed'));
          return;
        }
        setData(res);
        setError('');
      })
      .catch(() => setError(t('models_save_failed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const providers = (data?.providers || []) as ProviderItem[];
  const capabilities = (data?.capabilities || {}) as Record<string, CapState>;
  const configuredProviders = providers.filter((p) => p.configured || isCustomProviderCard(p));

  const patchProvider = useCallback((id: string, patch: Partial<ProviderItem>) => {
    setData((prev) =>
      prev ? { ...prev, providers: prev.providers.map((p) => (p.id === id ? { ...p, ...patch } : p)) } : prev,
    );
  }, []);

  const patchCapability = useCallback((id: string, patch: Partial<CapState>) => {
    setData((prev) =>
      prev
        ? { ...prev, capabilities: { ...prev.capabilities, [id]: { ...(prev.capabilities[id] as CapState), ...patch } } }
        : prev,
    );
  }, []);

  /* ---------------------------------------------------------- vendor ops */

  const handleVendorSave = async (providerId: string, apiBase: string, apiKey: string): Promise<boolean> => {
    const payload: Record<string, unknown> = { action: 'set_provider', provider_id: providerId, api_base: apiBase };
    if (apiKey) payload.api_key = apiKey;
    const res = await api.modelsAction(payload);
    if (res.status === 'success') {
      setData((prev) => {
        if (!prev) return prev;
        const exists = prev.providers.some((p) => p.id === providerId);
        if (!exists) {
          const entry: ProviderItem = {
            id: providerId,
            label: providerId,
            configured: true,
            api_base: apiBase,
            api_key_masked: apiKey ? maskKey(apiKey) : '',
          };
          return { ...prev, providers: [...prev.providers, entry] };
        }
        return {
          ...prev,
          providers: prev.providers.map((p) =>
            p.id === providerId
              ? {
                  ...p,
                  configured: true,
                  api_base: apiBase,
                  ...(apiKey ? { api_key_masked: maskKey(apiKey) } : {}),
                }
              : p,
          ),
        };
      });
      toast(t('models_save_success'), 'success');
      return true;
    }
    toast(t('models_save_failed'), 'error');
    return false;
  };

  const handleVendorClear = async (providerId: string) => {
    const ok = await confirm({
      title: t('models_clear_confirm_title'),
      message: t('models_clear_confirm_msg'),
      okText: t('models_clear_credential'),
      cancelText: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    const res = await api.modelsAction({ action: 'delete_provider', provider_id: providerId });
    if (res.status === 'success') {
      patchProvider(providerId, { configured: false, api_key_masked: '', api_base: '' });
      toast(t('models_cleared'), 'success');
      setVendorModal(null);
    } else {
      toast(t('models_clear_failed'), 'error');
    }
  };

  /* ---------------------------------------------------- custom provider ops */

  const handleCustomSave = async (payload: {
    name: string;
    apiBase: string;
    apiKey: string;
    id?: string;
  }): Promise<boolean> => {
    const body: Record<string, unknown> = {
      action: 'set_custom_provider',
      name: payload.name,
      api_base: payload.apiBase,
    };
    if (payload.apiKey) body.api_key = payload.apiKey;
    if (payload.id) body.id = payload.id;
    const res = await api.modelsAction(body);
    if (res.status !== 'success') {
      toast(t('models_save_failed'), 'error');
      return false;
    }
    if (payload.id) {
      setData((prev) =>
        prev
          ? {
              ...prev,
              providers: prev.providers.map((p) =>
                p.custom_id === payload.id
                  ? {
                      ...p,
                      custom_name: payload.name,
                      label: payload.name,
                      api_base: payload.apiBase,
                      configured: true,
                      ...(payload.apiKey ? { api_key_masked: maskKey(payload.apiKey) } : {}),
                    }
                  : p,
              ),
            }
          : prev,
      );
    } else {
      const newId = `custom:${Date.now().toString(36)}`;
      const entry: ProviderItem = {
        id: newId,
        label: payload.name,
        configured: true,
        is_custom: true,
        custom_id: newId,
        custom_name: payload.name,
        api_base: payload.apiBase,
        api_key_masked: payload.apiKey ? maskKey(payload.apiKey) : '',
        models: [],
      };
      setData((prev) => (prev ? { ...prev, providers: [...prev.providers, entry] } : prev));
    }
    toast(t('models_save_success'), 'success');
    return true;
  };

  const handleCustomDelete = async (id: string) => {
    const ok = await confirm({
      title: t('models_custom_delete_confirm_title'),
      message: t('models_custom_delete_confirm_msg'),
      okText: t('models_custom_delete'),
      cancelText: t('cancel'),
      danger: true,
    });
    if (!ok) return;
    const res = await api.modelsAction({ action: 'delete_custom_provider', id });
    if (res.status === 'success') {
      setData((prev) => (prev ? { ...prev, providers: prev.providers.filter((p) => p.custom_id !== id) } : prev));
      toast(t('models_cleared'), 'success');
      setCustomModal(null);
    } else {
      toast(t('models_clear_failed'), 'error');
    }
  };

  /* --------------------------------------------------------- search ops */

  const searchCap = capabilities.search || ({} as CapState);
  const searchRefs = providerRefs(searchCap);

  const openSearchAdd = (items: CapProviderRef[]) => {
    if (!items.length) return;
    if (items.length === 1) {
      launchSearchProvider(items[0].id);
      return;
    }
    setSearchAdd(items);
  };

  const launchSearchProvider = (id: string) => {
    if (id === 'bocha') {
      const ref = searchRefs.find((r) => r.id === 'bocha');
      setBochaModal({ maskedKey: ref?.configured ? '••••••••' : '' });
    } else {
      setVendorModal({ providerId: id });
    }
  };

  const handleBochaSave = async (apiKey: string): Promise<boolean> => {
    const res = await api.modelsAction({ action: 'set_search_credential', api_key: apiKey });
    if (res.status === 'success') {
      const ids = new Set(searchRefs.filter((r) => r.configured).map((r) => r.id));
      ids.add('bocha');
      patchCapability('search', { configured_providers: [...ids] });
      toast(t('models_save_success'), 'success');
      return true;
    }
    toast(t('models_save_failed'), 'error');
    return false;
  };

  const handleBochaClear = async () => {
    const res = await api.modelsAction({ action: 'set_search_credential', api_key: '' });
    if (res.status === 'success') {
      const ids = searchRefs.filter((r) => r.configured && r.id !== 'bocha').map((r) => r.id);
      patchCapability('search', { configured_providers: ids });
      toast(t('models_cleared'), 'success');
      setBochaModal(null);
    } else {
      toast(t('models_clear_failed'), 'error');
    }
  };

  /* ------------------------------------------------------------- render */

  if (loading && !data) return <LoadingRow label={t('models_title')} />;
  if (error && !data) return <p className="text-sm text-red-400 py-8 text-center">{error}</p>;

  return (
    <div className="grid gap-6" id="models-content">
      {/* Vendors */}
      <Card className="p-6">
        <div className="flex items-start gap-3 mb-5">
          <IconChip icon="fa-key" className="bg-primary-50 dark:bg-primary-900/30" glyph="text-primary-500" />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-800 dark:text-slate-100">{t('models_section_vendors')}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{t('models_section_vendors_desc')}</p>
          </div>
          <PrimaryButton className="!px-3 !py-1.5 !text-xs" onClick={() => setVendorModal({ providerId: '' })}>
            <span className="inline-flex items-center gap-1.5">
              <AppIcon className="fas fa-plus text-[10px]" />
              {t('models_add_vendor')}
            </span>
          </PrimaryButton>
        </div>
        {configuredProviders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 px-4 rounded-lg border border-dashed border-slate-200 dark:border-white/10">
            <p className="text-sm text-slate-500 dark:text-slate-400 text-center">{t('models_not_configured')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {configuredProviders.map((p) => (
              <AntCard
                key={p.id}
                hoverable
                size="small"
                className="group"
                styles={{ body: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' } }}
                onClick={() =>
                  isCustomProviderCard(p)
                    ? setCustomModal({ editId: p.custom_id || '' })
                    : setVendorModal({ providerId: p.id })
                }
              >
                <ProviderLogo providerId={p.id} label={labelOf(p.label, lang)} size={28} />
                <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                  {labelOf(p.label, lang)}
                </span>
                <AppIcon className="fas fa-pen-to-square text-[11px] text-slate-400 dark:text-slate-500 group-hover:text-primary-500 transition-colors" />
              </AntCard>
            ))}
          </div>
        )}
      </Card>

      {/* Capabilities */}
      {CAP_DEFS.map((def) => (
        <CapabilityCard
          key={def.id}
          def={def}
          cap={capabilities[def.id] || ({} as CapState)}
          providers={providers}
          onSaved={patchCapability}
          onConfigureProvider={(pid) => setVendorModal({ providerId: pid })}
          onConfigureSearch={(ref) => launchSearchProvider(ref.id)}
          onAddSearchProvider={openSearchAdd}
          onSearchSaved={patchCapability}
        />
      ))}

      {vendorModal ? (
        <VendorModal
          providers={providers}
          initialProviderId={vendorModal.providerId}
          onClose={() => setVendorModal(null)}
          onConfigureCustom={() => {
            setVendorModal(null);
            setCustomModal({ editId: '' });
          }}
          onSave={handleVendorSave}
          onClear={handleVendorClear}
        />
      ) : null}

      {customModal ? (
        <CustomProviderModal
          providers={providers}
          editId={customModal.editId}
          onClose={() => setCustomModal(null)}
          onSave={handleCustomSave}
          onDelete={handleCustomDelete}
        />
      ) : null}

      {bochaModal ? (
        <BochaModal
          maskedKey={bochaModal.maskedKey}
          onClose={() => setBochaModal(null)}
          onSave={handleBochaSave}
          onClear={handleBochaClear}
        />
      ) : null}

      {searchAdd ? (
        <SearchAddModal
          items={searchAdd}
          onPick={(id) => {
            setSearchAdd(null);
            launchSearchProvider(id);
          }}
          onClose={() => setSearchAdd(null)}
        />
      ) : null}
    </div>
  );
}
