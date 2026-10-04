import { api } from './api.js';
import type { Account } from '../creator/api/client.js';

export const accountClient = {
  me: () => api<Account>('/creator/me'),
  login: (username: string, password: string) => api<Account>('/creator/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) => api<Account>('/creator/register', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => api<{ ok: boolean }>('/creator/logout', { method: 'POST' }),
};
