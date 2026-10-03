import { api, post, postChatStream, type GameDetail, type SessionPayload } from './api.js';

export interface PlaytestLink { projectId: string; playtestId: string }
export const playtestPath = ({ projectId, playtestId }: PlaytestLink) =>
  `/creator/projects/${encodeURIComponent(projectId)}/playtests/${encodeURIComponent(playtestId)}`;

export function playtestClient(link: PlaytestLink) {
  const path = playtestPath(link);
  return {
    detail: () => api<{ detail: GameDetail; started: boolean }>(path),
    current: () => api<SessionPayload>(`${path}/current`),
    start: (player: Record<string, string | string[]>) => post<SessionPayload>(`${path}/new`, { player }),
    action: (body: object, revision: number) => post<SessionPayload>(`${path}/action`, { ...body, revision }),
    chat: (body: object, handlers: { onDraft: (delta: string) => void; onStatus?: (text: string) => void }) =>
      postChatStream(`${path}/chat/stream`, body, handlers),
  };
}

export function playtestDeepLink(pathname: string): PlaytestLink | null {
  const match = /^\/playtest\/([^/]+)\/([^/]+)(?:\/play)?\/?$/.exec(pathname);
  return match ? { projectId: decodeURIComponent(match[1]), playtestId: decodeURIComponent(match[2]) } : null;
}
