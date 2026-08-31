import { promises as fs } from 'node:fs';
import path from 'node:path';

export type BackendUserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
};

export type BackendSessionRecord = {
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
};

export type BackendDatabase = {
  version: 1;
  users: Record<string, BackendUserRecord>;
  sessions: Record<string, BackendSessionRecord>;
  calculatorState: unknown | null;
  measurements: Record<string, unknown>;
  measurementChunks: Record<string, unknown>;
  activityPriceScans: Record<string, unknown>;
  updatedAt: string;
};

const DEFAULT_DATABASE: BackendDatabase = {
  version: 1,
  users: {},
  sessions: {},
  calculatorState: null,
  measurements: {},
  measurementChunks: {},
  activityPriceScans: {},
  updatedAt: new Date(0).toISOString()
};

const databaseFilePath = process.env.WAIMAI_BACKEND_DB_PATH
  ? path.resolve(process.env.WAIMAI_BACKEND_DB_PATH)
  : path.join(process.cwd(), '.data', 'backend-db.json');

let writeQueue = Promise.resolve();

/**
 * 返回后台 JSON 数据库文件路径，用于日志和本地排查。
 */
export function backendDatabasePath() {
  return databaseFilePath;
}

/**
 * 返回后台数据库目录，供初始化本地随机凭据使用。
 */
export function backendDatabaseDirectory() {
  return path.dirname(databaseFilePath);
}

/**
 * 读取后台数据库；文件不存在时返回空库结构。
 */
export async function readBackendDatabase(): Promise<BackendDatabase> {
  try {
    const text = await fs.readFile(databaseFilePath, 'utf8');
    return normalizeBackendDatabase(JSON.parse(text));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_DATABASE, updatedAt: new Date().toISOString() };
    }
    throw error;
  }
}

/**
 * 串行更新数据库并以临时文件替换方式写入，降低并发写入损坏风险。
 */
export function updateBackendDatabase<T>(mutator: (database: BackendDatabase) => T | Promise<T>) {
  const task = writeQueue.then(async () => {
    const database = await readBackendDatabase();
    const result = await mutator(database);
    database.updatedAt = new Date().toISOString();
    await writeBackendDatabase(database);
    return result;
  });
  writeQueue = task.then(() => undefined, () => undefined);
  return task;
}

async function writeBackendDatabase(database: BackendDatabase) {
  await fs.mkdir(path.dirname(databaseFilePath), { recursive: true });
  const tempPath = `${databaseFilePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  await fs.rename(tempPath, databaseFilePath);
}

function normalizeBackendDatabase(value: unknown): BackendDatabase {
  const source = value && typeof value === 'object' ? value as Partial<BackendDatabase> : {};
  return {
    version: 1,
    users: recordOrEmpty(source.users),
    sessions: recordOrEmpty(source.sessions),
    calculatorState: source.calculatorState ?? null,
    measurements: recordOrEmpty(source.measurements),
    measurementChunks: recordOrEmpty(source.measurementChunks),
    activityPriceScans: recordOrEmpty(source.activityPriceScans),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString()
  };
}

function recordOrEmpty<T = unknown>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, T>
    : {};
}
