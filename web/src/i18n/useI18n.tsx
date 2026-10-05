import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  normalizeLang,
  persistLang,
  resolveInitialLang,
  translate,
  type Lang,
} from './index';

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  backendDefault,
}: {
  children: ReactNode;
  backendDefault?: string;
}) {
  const [lang, setLangState] = useState<Lang>(() => resolveInitialLang(backendDefault));

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    persistLang(next);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
  }, [lang]);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(lang, key, vars),
    [lang],
  );

  const value = useMemo<I18nContextValue>(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within an I18nProvider');
  return ctx;
}

/** Convenience hook returning just the translate function. */
export function useT() {
  return useI18n().t;
}

export { normalizeLang, resolveInitialLang };
