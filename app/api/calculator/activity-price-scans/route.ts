import { readBackendDatabase, updateBackendDatabase } from '../../../../src/server/database';
import { jsonError, jsonOk, requireBackendUser } from '../../../../src/server/http';

export const runtime = 'nodejs';

/**
 * 读取后台活动设计原价扫描缓存。
 */
export async function GET(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';
  if (!key) return jsonError('缺少活动扫描 key。');

  const database = await readBackendDatabase();
  return jsonOk({ record: database.activityPriceScans[key] || null });
}

/**
 * 保存后台活动设计原价扫描缓存。
 */
export async function PUT(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const record = body && typeof body === 'object' ? (body as { record?: { key?: unknown } }).record : null;
  const key = typeof record?.key === 'string' ? record.key : '';
  if (!record || !key) return jsonError('缺少需要保存的活动扫描记录。');

  await updateBackendDatabase(database => {
    database.activityPriceScans[key] = record;
  });
  return jsonOk({ ok: true });
}
