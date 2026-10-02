import type { CreatorWorkspace } from './review-ui.js';

export function CreatorNavigation({ role, workspace, onLibrary, onReview }: {
  role: 'author' | 'admin'; workspace: CreatorWorkspace; onLibrary: () => void; onReview: () => void;
}) {
  return <nav className="creator-header-nav" aria-label="创作中心导航">
    <button type="button" aria-pressed={workspace === 'library'} onClick={onLibrary}>故事创作</button>
    {role === 'admin' && <button type="button" aria-pressed={workspace === 'review'} onClick={onReview}>审核</button>}
  </nav>;
}
