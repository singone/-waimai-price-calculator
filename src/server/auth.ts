import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cookies } from 'next/headers';
import type { NextResponse } from 'next/server';
import {
  backendDatabaseDirectory,
  readBackendDatabase,
  updateBackendDatabase,
  type BackendDatabase,
  type BackendSessionRecord,
  type BackendUserRecord
} from './database';

export const BACKEND_SESSION_COOKIE = 'waimai_backend_session';

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const DEFAULT_ADMIN_USERNAME = process.env.WAIMAI_ADMIN_USERNAME || 'admin';
const GENERATED_PASSWORD_FILE = 'admin-password.txt';

export type BackendSessionUser = {
  id: string;
  username: string;
};

/**
 * 校验用户名密码，首次使用时自动初始化默认管理员。
 */
export async function authenticateBackendUser(username: string, password: string): Promise<BackendSessionUser | null> {
  await ensureDefaultAdminUser();
  const database = await readBackendDatabase();
  const user = Object.values(database.users).find(item => item.username === username);
  if (!user || !verifyPassword(password, user.passwordHash)) return null;
  return { id: user.id, username: user.username };
}

/**
 * 创建后台登录会话，并返回需要写入 cookie 的 token。
 */
export async function createBackendSession(user: BackendSessionUser) {
  const token = randomBytes(32).toString('hex');
  const now = new Date();
  const record: BackendSessionRecord = {
    token,
    userId: user.id,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  };
  await updateBackendDatabase(database => {
    database.sessions[token] = record;
  });
  return { token, maxAge: SESSION_MAX_AGE_SECONDS };
}

/**
 * 从 httpOnly cookie 读取当前后台会话。
 */
export async function getBackendSessionUser(): Promise<BackendSessionUser | null> {
  const token = (await cookies()).get(BACKEND_SESSION_COOKIE)?.value;
  if (!token) return null;
  const database = await readBackendDatabase();
  const session = database.sessions[token];
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    await deleteBackendSession(token);
    return null;
  }
  const user = database.users[session.userId];
  return user ? { id: user.id, username: user.username } : null;
}

/**
 * 删除当前请求对应的后台会话。
 */
export async function deleteCurrentBackendSession() {
  const token = (await cookies()).get(BACKEND_SESSION_COOKIE)?.value;
  if (token) await deleteBackendSession(token);
}

/**
 * 在响应里写入后台登录 cookie。
 */
export function setBackendSessionCookie(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set({
    name: BACKEND_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.WAIMAI_COOKIE_SECURE === 'true',
    path: '/',
    maxAge
  });
}

/**
 * 在响应里清除后台登录 cookie。
 */
export function clearBackendSessionCookie(response: NextResponse) {
  response.cookies.delete(BACKEND_SESSION_COOKIE);
}

async function ensureDefaultAdminUser() {
  await updateBackendDatabase(database => {
    if (Object.keys(database.users).length > 0) return;
    const now = new Date().toISOString();
    const user: BackendUserRecord = {
      id: 'admin',
      username: DEFAULT_ADMIN_USERNAME,
      passwordHash: hashPassword(initialAdminPassword()),
      createdAt: now,
      updatedAt: now
    };
    database.users[user.id] = user;
  });
}

function initialAdminPassword() {
  const configuredPassword = process.env.WAIMAI_ADMIN_PASSWORD;
  if (configuredPassword) return configuredPassword;
  const passwordPath = `${backendDatabaseDirectory()}/${GENERATED_PASSWORD_FILE}`;
  try {
    const existing = readFileSync(passwordPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // 首次启动时文件不存在，下面生成随机密码。
  }
  const generated = randomBytes(12).toString('base64url');
  mkdirSync(backendDatabaseDirectory(), { recursive: true });
  writeFileSync(passwordPath, `${generated}\n`, 'utf8');
  return generated;
}

async function deleteBackendSession(token: string) {
  await updateBackendDatabase(database => {
    deleteExpiredSessions(database);
    delete database.sessions[token];
  });
}

function deleteExpiredSessions(database: BackendDatabase) {
  const now = Date.now();
  Object.entries(database.sessions).forEach(([token, session]) => {
    if (new Date(session.expiresAt).getTime() <= now) {
      delete database.sessions[token];
    }
  });
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, passwordHash: string) {
  const [salt, hash] = passwordHash.split(':');
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
