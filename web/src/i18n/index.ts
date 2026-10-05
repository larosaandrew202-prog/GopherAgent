import { I18N, type Lang, type I18nKey } from './dictionary';

export { I18N };
export type { Lang, I18nKey };

export const LANGS: Lang[] = ['zh', 'zh-Hant', 'en'];

export const LANG_LABELS: Record<Lang, string> = {
  zh: '简体中文',
  'zh-Hant': '繁體中文',
  en: 'English',
};

export const LANG_SHORT: Record<Lang, string> = {
  zh: '中',
  'zh-Hant': '繁',
  en: 'EN',
};

/**
 * Map an arbitrary locale string (zh-CN, en-US, fr ...) to 'zh' / 'zh-Hant' /
 * 'en', or '' when unrecognized so callers can fall through to the next source.
 */
export function normalizeLang(raw?: string | null): Lang | '' {
  if (!raw) return '';
  const v = String(raw).trim().toLowerCase().replace('_', '-');
  if (v === 'auto') return '';
  if (v === 'zh-hant' || v.startsWith('zh-hant-') || v === 'zh-tw' || v === 'zh-hk') {
    return 'zh-Hant';
  }
  if (v.startsWith('zh')) return 'zh';
  if (v.startsWith('en')) return 'en';
  return '';
}

/**
 * Resolve the console language by priority:
 * user choice (localStorage) -> backend-detected -> browser -> 'zh'.
 */
export function resolveInitialLang(backendDefault?: string): Lang {
  const stored =
    typeof localStorage !== 'undefined' ? localStorage.getItem('cow_lang') : null;
  return (
    normalizeLang(stored) ||
    normalizeLang(backendDefault) ||
    normalizeLang(
      typeof navigator !== 'undefined'
        ? navigator.language || (navigator.languages && navigator.languages[0])
        : '',
    ) ||
    'zh'
  );
}

const LANG_KEY = 'cow_lang';

export function persistLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* ignore */
  }
}

/** Translate a key for a language, interpolating `{name}` style variables. */
export function translate(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = I18N[lang] as Record<string, string> | undefined;
  const fallback = I18N.en as Record<string, string>;
  let text = table?.[key] ?? fallback?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return text;
}
