import { useEffect, useRef, useState } from 'react';
import { Button, Input, type InputRef } from 'antd';
import { useAuth } from '@/store/auth';
import { BrandMark } from '@/components/ui/BrandMark';

export function LoginOverlay() {
  const { state, login } = useAuth();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<InputRef>(null);

  useEffect(() => {
    if (state === 'required') inputRef.current?.focus();
  }, [state]);

  if (state !== 'required') return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await login(password);
      if (!ok) {
        setError('密码错误');
        setPassword('');
        inputRef.current?.focus();
      }
    } catch {
      setError('网络错误，请重试');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[200] bg-gray-50 dark:bg-[#141414] flex items-center justify-center">
      <div className="w-full max-w-sm mx-4">
        <div className="flex flex-col items-center mb-8">
          <BrandMark className="w-16 h-16 mb-4 shadow-lg" rounded="rounded-2xl" glyph="text-2xl" />
          <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Gopher Agent</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">请输入密码以访问控制台</p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <Input.Password
            ref={inputRef}
            autoComplete="current-password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            size="large"
          />
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          <Button type="primary" htmlType="submit" loading={busy} block size="large">
            登录
          </Button>
        </form>
      </div>
    </div>
  );
}
