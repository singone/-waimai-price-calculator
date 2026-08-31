import { readBackendDatabase, updateBackendDatabase } from '../../../../src/server/database';
import { jsonError, jsonOk, requireBackendUser } from '../../../../src/server/http';

export const runtime = 'nodejs';

/**
 * 读取后台测算结果分片。
 */
export async function GET(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const { searchParams } = new URL(request.url);
  const key = searchParams.get('key') || '';
  if (!key) return jsonError('缺少测算分片 key。');

  const database = await readBackendDatabase();
  return jsonOk({ record: database.measurementChunks[key] || null });
}

/**
 * 保存后台测算结果分片。
 */
export async function PUT(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const record = body && typeof body === 'object' ? (body as { record?: { key?: unknown } }).record : null;
  const key = typeof record?.key === 'string' ? record.key : '';
  if (!record || !key) return jsonError('缺少需要保存的测算分片。');

  await updateBackendDatabase(database => {
    database.measurementChunks[key] = record;
  });
  return jsonOk({ ok: true });
}

/**
 * 删除旧测算结果关联分片，避免后台数据库持续膨胀。
 */
export async function DELETE(request: Request) {
  const auth = await requireBackendUser();
  if (auth.response) return auth.response;

  const body = await request.json().catch(() => null);
  const keys = Array.isArray((body as { keys?: unknown } | null)?.keys)
    ? (body as { keys: unknown[] }).keys.filter((key): key is string => typeof key === 'string')
    : [];
  await updateBackendDatabase(database => {
    keys.forEach(key => {
      delete database.measurementChunks[key];
    });
  });
  return jsonOk({ ok: true, deleted: keys.length });
}
