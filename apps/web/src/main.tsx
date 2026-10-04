import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.js';
import CreatorApp from './creator/app/CreatorApp.js';
import AccountGate from './app/AccountGate.js';
import AiUsagePage from './usage/AiUsagePage.js';
import { usePlayerRoute } from './app/player-navigation.js';
import './styles.css';

export function PlayerEntry() {
  const [route] = usePlayerRoute();
  const requireLogin = route.kind === 'story-play' || route.kind === 'playtest-detail' || route.kind === 'playtest-play';
  return <AccountGate requireLogin={requireLogin}><App /></AccountGate>;
}

const pathname = window.location.pathname;
createRoot(document.getElementById('root')!).render(<React.StrictMode>
  {pathname === '/usage' ? <AccountGate requireLogin><AiUsagePage /></AccountGate>
    : pathname === '/creator/usage' ? <AccountGate requireLogin><AiUsagePage admin /></AccountGate>
    : pathname.startsWith('/creator') ? <AccountGate requireLogin={false}><CreatorApp /></AccountGate>
    : <PlayerEntry />}
</React.StrictMode>);
