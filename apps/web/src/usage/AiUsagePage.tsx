import { useEffect, useState } from 'react';
import { api } from '../app/api.js';
import type { AiCallRecord } from '../../../api/src/infrastructure/ai/ai-audit.js';

interface UsageResponse { rows: AiCallRecord[]; nextCursor: string | null; summary: Record<string, unknown>[]; auditHealth?: { failedWrites: number } }
const count = (value: number | null | undefined) => value == null ? '未知' : value.toLocaleString('zh-CN');

export default function AiUsagePage({ admin = false }: { admin?: boolean }) {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ accountId: '', storyId: '', source: '', model: '', purpose: '', from: '', to: '' });
  const [cursor, setCursor] = useState('');
  useEffect(() => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value && (admin || key !== 'accountId')) query.set(key, value);
    if (cursor) query.set('cursor', cursor);
    void api<UsageResponse>(`/usage/${admin ? 'admin' : 'me'}?${query}`).then(setData).catch(reason => setError(reason.message));
  }, [admin, filters, cursor]);
  return <main className="usage-page"><a href={admin ? '/creator' : '/'}>← 返回</a>
    <h1>{admin ? '全部 AI 调用' : '我的 AI 用量'}</h1>
    <p>仅统计接入后发生的请求。上游未提供的用量显示“未知”。</p>
    {admin && data?.auditHealth?.failedWrites ? <p role="alert">部分审计写入失败：{data.auditHealth.failedWrites} 次，请检查服务日志。</p> : null}
    <div className="usage-filters">
      {admin && <label>用户 ID<input value={filters.accountId} onChange={event => { setCursor(''); setFilters({ ...filters, accountId: event.target.value }); }} /></label>}
      <label>故事 ID<input value={filters.storyId} onChange={event => { setCursor(''); setFilters({ ...filters, storyId: event.target.value }); }} /></label>
      <label>来源<select value={filters.source} onChange={event => { setCursor(''); setFilters({ ...filters, source: event.target.value }); }}>
        <option value="">全部</option><option value="formal">正式</option><option value="playtest">试玩</option><option value="import">导入</option></select></label>
      <label>模型<input value={filters.model} onChange={event => { setCursor(''); setFilters({ ...filters, model: event.target.value }); }} /></label>
      <label>用途<input value={filters.purpose} onChange={event => { setCursor(''); setFilters({ ...filters, purpose: event.target.value }); }} /></label>
      <label>起始月份<input type="month" value={filters.from} onChange={event => { setCursor(''); setFilters({ ...filters, from: event.target.value }); }} /></label>
      <label>结束月份<input type="month" value={filters.to} onChange={event => { setCursor(''); setFilters({ ...filters, to: event.target.value }); }} /></label>
    </div>
    {error && <p role="alert">{error}</p>}
    <h2>逐次调用</h2>
    <div className="usage-table-wrap"><table><thead><tr><th>时间</th>{admin && <th>用户</th>}<th>故事</th><th>故事名称</th><th>来源</th><th>模型／用途</th><th>输入</th><th>输出</th><th>缓存写入</th><th>缓存命中</th><th>结果</th></tr></thead>
      <tbody>{(data?.rows ?? []).map(row => <tr key={row.id}><td>{row.startedAt}</td>{admin && <td>{row.accountId ?? '系统'}</td>}
        <td>{row.storyId ?? '—'}</td><td>{row.storyTitle ?? '—'}</td><td>{row.playtestDeleted ? '试玩记录已删除' : row.source}</td>
        <td>{row.model}／{row.purpose}</td><td>{count(row.inputTokens)}</td><td>{count(row.outputTokens)}</td>
        <td>{count(row.cacheWriteTokens)}</td><td>{count(row.cacheReadTokens)}</td><td>{row.outcome}</td></tr>)}</tbody></table></div>
    {data?.nextCursor && <button onClick={() => setCursor(data.nextCursor!)}>下一页</button>}
    <h2>月度汇总</h2><pre>{JSON.stringify(data?.summary ?? [], null, 2)}</pre>
  </main>;
}
