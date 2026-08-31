import { readBackendDatabase, updateBackendDatabase } from '../../../../src/server/database';
import { jsonError, jsonOk, requireBackendUser } from '../../../../src/server/http';

export const runtime = 'nodejs';

/**
 * 读取后台保存的计算器状态。
 */
export async function GET() {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const database = await readBackendDatabase();
  return jsonOk({ state: database.calculatorState });
}

/**
 * 保存整份计算器状态到后台数据库。
 */
export async function PUT(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object' || !('state' in body)) {
    return jsonError('缺少需要保存的状态数据。');
  }
  await updateBackendDatabase(database => {
    database.calculatorState = (body as { state: unknown }).state;
  });
  return jsonOk({ ok: true });
}
