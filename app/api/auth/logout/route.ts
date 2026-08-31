import { NextResponse } from 'next/server';
import {
  clearBackendSessionCookie,
  deleteCurrentBackendSession
} from '../../../../src/server/auth';

export const runtime = 'nodejs';

/**
 * 退出后台模式并清除登录态。
 */
export async function POST() {
  await deleteCurrentBackendSession();
  const response = NextResponse.json({
    authenticated: false,
    user: null
  });
  clearBackendSessionCookie(response);
  return response;
}
