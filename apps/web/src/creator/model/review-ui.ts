export type CreatorWorkspace = 'library' | 'review';
export function workspaceForPath(role: 'author' | 'admin', pathname: string): CreatorWorkspace {
  return role === 'admin' && pathname === '/creator/review' ? 'review' : 'library';
}
export function reviewStatusLabel(project: { publishedAt: string | null; review: { status: string } | null }) {
  if (project.review?.status === 'pending') return project.publishedAt ? '旧版在线 · 新版待审' : '待审核';
  if (project.review?.status === 'rejected') return project.publishedAt ? '已驳回 · 旧版在线' : '审核驳回';
  return project.publishedAt ? '已发布' : '草稿';
}
