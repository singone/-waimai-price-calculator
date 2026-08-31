import { NextResponse } from 'next/server';
import {
  authenticateBackendUser,
  createBackendSession,
  setBackendSessionCookie
} from '../../../../src/server/auth';
import { jsonError } from '../../../../src/server/http';

export const runtime = 'nodejs';

/**
 * 使用账号密码登录后台模式。
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');
  if (!username || !password) return jsonError('请输入用户名和密码。');

  const user = await authenticateBackendUser(username, password);
  if (!user) return jsonError('用户名或密码错误。', 401);

  const session = await createBackendSession(user);
  const response = NextResponse.json({
    authenticated: true,
    user: { username: user.username }
  });
  setBackendSessionCookie(response, session.token, session.maxAge);
  return response;
}
