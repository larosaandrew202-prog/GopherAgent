import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from '@/api';

type AuthState = 'loading' | 'required' | 'authenticated';

interface AuthContextValue {
  state: AuthState;
  logoutVisible: boolean;
  login: (password: string) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>('loading');
  const [logoutVisible, setLogoutVisible] = useState(false);

  useEffect(() => {
    api
      .authCheck()
      .then((res) => {
        if (res.enabled && !res.authenticated) setState('required');
        else {
          setState('authenticated');
          setLogoutVisible(Boolean(res.enabled));
        }
      })
      .catch(() => setState('authenticated'));
  }, []);

  const login = useCallback(async (password: string) => {
    const res = await api.authLogin(password);
    if (res.status === 'success' && res.ok !== false) {
      setState('authenticated');
      setLogoutVisible(true);
      return true;
    }
    return false;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.authLogout();
    } finally {
      window.location.reload();
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ state, logoutVisible, login, logout }),
    [state, logoutVisible, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
