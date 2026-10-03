import { useState } from 'react';
import StoryCatalogPage from './StoryCatalogPage.js';
import StoryDetailPage from './StoryDetailPage.js';
import { GameplayPage } from './GameplayPage.js';
import { usePlayerRoute } from './player-navigation.js';

export { default as PlayerForm } from './PlayerForm.js';
export { gameDeepLink } from './GameplayPage.js';
export { GameplayPage } from './GameplayPage.js';

export default function App() {
  const [route, navigate] = usePlayerRoute();
  const [notice, setNotice] = useState('');
  if (route.kind === 'catalog') return <StoryCatalogPage onOpen={storyId => navigate({ kind: 'story-detail', storyId })} />;
  if (route.kind === 'story-detail') return <><StoryDetailPage key={route.storyId} storyId={route.storyId}
    onPlay={() => navigate({ kind: 'story-play', storyId: route.storyId })}
    onBack={() => navigate({ kind: 'catalog' })} />{notice && <div className="floating-alert notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}</>;
  if (route.kind === 'story-play') return <GameplayPage key={route.storyId} storyId={route.storyId}
    onExit={() => navigate({ kind: 'story-detail', storyId: route.storyId })}
    onNoSave={message => { setNotice(message); navigate({ kind: 'story-detail', storyId: route.storyId }, true); }} />;
  if (route.kind === 'playtest-detail' || route.kind === 'playtest-play') {
    const link = { projectId: route.projectId, playtestId: route.playtestId };
    return route.kind === 'playtest-detail' ? <><StoryDetailPage key={route.playtestId} storyId={route.projectId} playtest={link}
      onPlay={() => navigate({ ...link, kind: 'playtest-play' })}
      onBack={() => { window.location.href = `/creator/${encodeURIComponent(route.projectId)}`; }} />
      {notice && <div className="floating-alert notice" role="status">{notice}<button onClick={() => setNotice('')}>×</button></div>}</>
      : <GameplayPage key={route.playtestId} storyId={route.projectId} playtest={link}
        onExit={() => navigate({ ...link, kind: 'playtest-detail' })}
        onNoSave={message => { setNotice(message); navigate({ ...link, kind: 'playtest-detail' }, true); }} />;
  }
  return <main className="menu-screen page-enter"><h1>页面不存在</h1><button onClick={() => navigate({ kind: 'catalog' })}>返回故事目录</button></main>;
}
