import type { FormEvent } from 'react';

export interface CreatorAuthViewProps {
  authMode: 'login' | 'register';
  username: string;
  password: string;
  message: string;
  onAuthenticate: (event: FormEvent) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onToggleAuthMode: () => void;
}

export function CreatorAuthView({ authMode, username, password, message, onAuthenticate, onUsernameChange,
  onPasswordChange, onToggleAuthMode }: CreatorAuthViewProps) {
  return <main className="creator-auth"><div className="creator-auth-copy"><div className="creator-kicker">WRITE YOUR OWN WORLD</div>
    <h1>让故事，<br /><em>从这里开始。</em></h1><p>创建角色、地点和规则，随时保存草稿。完成校验后提交审核，通过后故事会出现在玩家目录。</p>
    <div className="creator-auth-lines"><span>01 / 定义世界</span><span>02 / 塑造角色</span><span>03 / 提交审核</span></div></div>
    <form className="creator-auth-card" onSubmit={onAuthenticate}><div className="creator-kicker">AUTHOR ACCESS</div><h2>{authMode === 'login' ? '欢迎回来' : '创建创作者账号'}</h2>
      <label>用户名<input autoComplete="username" value={username} onChange={event => onUsernameChange(event.target.value)} required /></label>
      <label>密码<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password}
        onChange={event => onPasswordChange(event.target.value)} minLength={authMode === 'register' ? 10 : undefined} required /></label>
      <button className="creator-primary" type="submit">{authMode === 'login' ? '登录创作中心' : '注册并开始创作'} <span>↗</span></button>
      <button className="creator-text-button" type="button" onClick={onToggleAuthMode}>
        {authMode === 'login' ? '没有账号？注册一个' : '已有账号？返回登录'}</button>{message && <p className="creator-error" role="alert">{message}</p>}</form></main>;
}
