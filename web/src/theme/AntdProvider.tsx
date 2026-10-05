import type { ReactNode } from 'react';
import { App as AntApp, ConfigProvider, theme as antdTheme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import zhTW from 'antd/locale/zh_TW';
import enUS from 'antd/locale/en_US';
import { useTheme } from './useTheme';
import { useI18n } from '@/i18n/useI18n';

/**
 * Wires Ant Design's ConfigProvider to the console theme and language so antd
 * components follow the existing dark/light toggle and locale.
 */
export function AntdProvider({ children }: { children: ReactNode }) {
  const { isDark } = useTheme();
  const { lang } = useI18n();
  const locale = lang === 'zh-Hant' ? zhTW : lang === 'en' ? enUS : zhCN;

  return (
    <ConfigProvider
      locale={locale}
      theme={{
        algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: isDark ? '#4096FF' : '#1677FF',
          borderRadius: 10,
          borderRadiusLG: 16,
          fontFamily:
            'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        },
      }}
    >
      <AntApp component={false}>{children}</AntApp>
    </ConfigProvider>
  );
}
