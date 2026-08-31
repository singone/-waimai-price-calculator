import { readBackendDatabase, updateBackendDatabase } from '../../../../src/server/database';
import { jsonError, jsonOk, requireBackendUser } from '../../../../src/server/http';

export const runtime = 'nodejs';

/**
 * 按记录 key 读取后台测算结果。
 */
export async function GET(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';
  if (!key) return jsonError('缺少测算结果 key。');

  const database = await readBackendDatabase();
  return jsonOk({ record: database.measurements[key] || null });
}

/**
 * 保存后台测算结果主记录。
 */
export async function PUT(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const record = body && typeof body === 'object' ? (body as { record?: { key?: unknown } }).record : null;
  const key = typeof record?.key === 'string' ? record.key : '';
  if (!record || !key) return jsonError('缺少需要保存的测算结果记录。');

  await updateBackendDatabase(database => {
    database.measurements[key] = record;
  });
  return jsonOk({ ok: true });
}
