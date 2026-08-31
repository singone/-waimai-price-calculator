'use client';

export type PersistenceMode = 'local' | 'backend';

export type BackendAuthSession = {
  authenticated: boolean;
  user: { username: string } | null;
};

/**
 * 请求后台接口并统一处理 JSON 错误。
 */
export async function backendRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String((payload as { message?: unknown }).message || '后台接口请求失败。'));
  }
  return payload as T;
}

/**
 * 读取当前后台登录状态。
 */
export function loadBackendSession() {
  return backendRequest<BackendAuthSession>('/api/auth/session');
}

/**
 * 使用用户名密码登录后台模式。
 */
export function loginBackend(username: string, password: string) {
  return backendRequest<BackendAuthSession>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password })
  });
}

/**
 * 退出后台模式登录。
 */
export function logoutBackend() {
  return backendRequest<BackendAuthSession>('/api/auth/logout', { method: 'POST' });
}
