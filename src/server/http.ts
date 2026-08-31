import { NextResponse } from 'next/server';
import { getBackendSessionUser } from './auth';

/**
 * 返回标准 JSON 成功响应。
 */
export function jsonOk<T>(payload: T, init?: ResponseInit) {
  return NextResponse.json(payload, init);
}

/**
 * 返回标准 JSON 错误响应。
 */
export function jsonError(message: string, status = 400) {
  return NextResponse.json({ message }, { status });
}

/**
 * 校验后台登录态，接口未登录时统一返回 401。
 */
export async function requireBackendUser() {
  const user = await getBackendSessionUser();
  if (!user) return { user: null, response: jsonError('请先登录后台模式。', 401) };
  return { user, response: null };
}
