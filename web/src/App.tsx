import { I18nProvider } from '@/i18n/useI18n';
import { ThemeProvider } from '@/theme/useTheme';
import { AntdProvider } from '@/theme/AntdProvider';
import { UIProvider } from '@/store/ui';
import { AuthProvider } from '@/store/auth';
import { ChatProvider } from '@/store/chat';
import { WorkspaceProvider } from '@/store/workspace';
import { Shell } from '@/components/layout/Shell';

export function App() {
  return (
    <ThemeProvider>
      <I18nProvider>
        <AntdProvider>
          <UIProvider>
            <AuthProvider>
              <ChatProvider>
                <WorkspaceProvider>
                  <Shell />
                </WorkspaceProvider>
              </ChatProvider>
            </AuthProvider>
          </UIProvider>
        </AntdProvider>
      </I18nProvider>
    </ThemeProvider>
  );
}
