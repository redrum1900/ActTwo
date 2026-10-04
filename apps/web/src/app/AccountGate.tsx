import { createContext, useContext, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Modal } from 'antd';
import type { Account } from '../creator/api/client.js';
import { accountClient } from './account-client.js';

type PendingAction = () => void | Promise<void>;

export function createLoginQueue() {
  let pending: PendingAction | null = null;
  return {
    defer(action: PendingAction) { pending = action; },
    async resume() { const action = pending; pending = null; if (action) await action(); },
    cancel() { pending = null; },
  };
}

interface AccountContextValue {
  account: Account | null;
  loading: boolean;
  requestLogin: (action: PendingAction) => void;
  login: (username: string, password: string) => Promise<Account>;
  register: (username: string, password: string) => Promise<Account>;
  logout: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount() {
  const value = useContext(AccountContext);
  if (!value) throw new Error('账号状态未初始化');
  return value;
}

export function AccountForm({ mode, username, password, error, submitting, requireLogin, onSubmit, onUsername, onPassword, onToggleMode, onCancel }: {
  mode: 'login' | 'register'; username: string; password: string; error: string; submitting: boolean; requireLogin: boolean;
  onSubmit: (event: FormEvent) => void; onUsername: (value: string) => void; onPassword: (value: string) => void;
  onToggleMode: () => void; onCancel: () => void;
}) {
  return <form className="account-panel" onSubmit={onSubmit}>
    <div className="eyebrow">ACT II / ACCOUNT</div>
    <p>使用同一个账号游玩和创作，存档会跟随你的账号。</p>
    <label>用户名<input autoComplete="username" value={username} onChange={event => onUsername(event.target.value)} required /></label>
    <label>密码<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
      minLength={mode === 'register' ? 10 : undefined} value={password} onChange={event => onPassword(event.target.value)} required /></label>
    {error && <p className="account-error" role="alert">{error}</p>}
    <button className="button button-primary" type="submit" disabled={submitting}>{submitting ? '请稍候…' : mode === 'login' ? '登录并继续 ↗' : '注册并继续 ↗'}</button>
    <button className="account-mode" type="button" onClick={onToggleMode}>
      {mode === 'login' ? '没有账号？注册' : '已有账号？登录'}</button>
    {!requireLogin && <button className="account-cancel" type="button" onClick={onCancel}>暂不登录</button>}
  </form>;
}

export default function AccountGate({ children, requireLogin }: { children: ReactNode; requireLogin: boolean }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const queue = useRef(createLoginQueue());
  useEffect(() => { void accountClient.me().then(async user => {
    setAccount(user); await queue.current.resume();
  }).catch(() => {}).finally(() => setLoading(false)); }, []);
  const authenticate = async (selectedMode: 'login' | 'register', name: string, secret: string) => {
    const user = selectedMode === 'login' ? await accountClient.login(name, secret) : await accountClient.register(name, secret);
    setAccount(user); setOpen(false); setPassword(''); setError('');
    await queue.current.resume();
    return user;
  };
  const requestLogin = (action: PendingAction) => {
    if (account) { void action(); return; }
    queue.current.defer(action); setOpen(true); setError('');
  };
  const logout = async () => {
    await accountClient.logout(); queue.current.cancel(); setAccount(null); setOpen(false);
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError('');
    try { await authenticate(mode, username, password); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); }
    finally { setSubmitting(false); }
  };
  const showForm = open || (requireLogin && !account);
  return <AccountContext.Provider value={{ account, loading, requestLogin,
    login: (name, secret) => authenticate('login', name, secret), register: (name, secret) => authenticate('register', name, secret), logout }}>
    {(!requireLogin || account) && children}
    <Modal className="account-dialog" title={mode === 'login' ? '登录 ACT II' : '创建账号'} open={showForm}
      onCancel={() => { if (!requireLogin) { queue.current.cancel(); setOpen(false); } }}
      closable={!requireLogin} mask={{ closable: !requireLogin }} footer={null} destroyOnHidden><AccountForm mode={mode}
      username={username} password={password} error={error} submitting={submitting} requireLogin={requireLogin}
      onSubmit={submit} onUsername={setUsername} onPassword={setPassword}
      onToggleMode={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}
      onCancel={() => { queue.current.cancel(); setOpen(false); }} /></Modal>
  </AccountContext.Provider>;
}
