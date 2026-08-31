import { getBackendSessionUser } from '../../../../src/server/auth';
import { jsonOk } from '../../../../src/server/http';

export const runtime = 'nodejs';

/**
 * 返回当前后台登录状态。
 */
export async function GET() {
  const user = await getBackendSessionUser();
  return jsonOk({
    authenticated: Boolean(user),
    user: user ? { username: user.username } : null
  });
}
