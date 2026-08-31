#!/usr/bin/env node

import { randomBytes, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const DATABASE_VERSION = 1;
const DEFAULT_ADMIN_ID = 'admin';
const DEFAULT_ADMIN_USERNAME = process.env.WAIMAI_ADMIN_USERNAME || 'admin';
const DEFAULT_DATABASE_PATH = process.env.WAIMAI_BACKEND_DB_PATH
  ? path.resolve(process.env.WAIMAI_BACKEND_DB_PATH)
  : path.join(process.cwd(), '.data', 'backend-db.json');
const GENERATED_PASSWORD_FILE = 'admin-password.txt';

let args;
let databasePath;
let databaseDirectory;
let adminUsername;

/**
 * 解析初始化脚本参数，避免引入额外命令行依赖。
 */
function parseArgs(argv) {
  const parsed = {
    dbPath: '',
    username: '',
    password: process.env.WAIMAI_ADMIN_PASSWORD || '',
    resetAdminPassword: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--reset-admin-password') {
      parsed.resetAdminPassword = true;
      continue;
    }
    if (arg === '--db-path') {
      parsed.dbPath = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--db-path=')) {
      parsed.dbPath = arg.slice('--db-path='.length);
      continue;
    }
    if (arg === '--username') {
      parsed.username = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--username=')) {
      parsed.username = arg.slice('--username='.length);
      continue;
    }
    if (arg === '--password') {
      parsed.password = requireArgValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith('--password=')) {
      parsed.password = arg.slice('--password='.length);
      continue;
    }
    throw new Error(`未知参数：${arg}`);
  }

  return parsed;
}

/**
 * 读取需要跟随参数名出现的参数值。
 */
function requireArgValue(argv, index, name) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} 缺少参数值。`);
  }
  return value;
}

/**
 * 输出命令帮助信息。
 */
function printHelp() {
  console.log(`后台数据库初始化脚本

用法：
  npm run db:init
  npm run db:init -- --db-path /data/waimai/backend-db.json --username admin --password your-password

参数：
  --db-path <path>          后台 JSON 数据库路径，默认读取 WAIMAI_BACKEND_DB_PATH 或 .data/backend-db.json
  --username <name>         管理员用户名，默认读取 WAIMAI_ADMIN_USERNAME 或 admin
  --password <password>     管理员密码，默认读取 WAIMAI_ADMIN_PASSWORD；未提供时自动生成
  --reset-admin-password    已存在管理员时重置密码
  -h, --help                查看帮助
`);
}

/**
 * 读取并归一化已有数据库；文件不存在时返回空数据库。
 */
function readDatabase() {
  if (!existsSync(databasePath)) return createEmptyDatabase();
  const content = readFileSync(databasePath, 'utf8');
  const parsed = JSON.parse(content);
  return normalizeDatabase(parsed);
}

/**
 * 创建当前后台接口需要的最小数据库结构。
 */
function createEmptyDatabase() {
  return {
    version: DATABASE_VERSION,
    users: {},
    sessions: {},
    calculatorState: null,
    measurements: {},
    measurementChunks: {},
    activityPriceScans: {},
    updatedAt: new Date().toISOString()
  };
}

/**
 * 将旧文件或手工文件补齐为当前数据库版本。
 */
function normalizeDatabase(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    version: DATABASE_VERSION,
    users: recordOrEmpty(source.users),
    sessions: recordOrEmpty(source.sessions),
    calculatorState: source.calculatorState ?? null,
    measurements: recordOrEmpty(source.measurements),
    measurementChunks: recordOrEmpty(source.measurementChunks),
    activityPriceScans: recordOrEmpty(source.activityPriceScans),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : new Date().toISOString()
  };
}

/**
 * 确保对象字段是普通记录，否则回退为空对象。
 */
function recordOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * 确保默认管理员存在，必要时生成或重置密码。
 */
function ensureAdminUser(database) {
  const existingUser = Object.values(database.users).find(user => user?.username === adminUsername);
  if (existingUser && !args.resetAdminPassword) {
    return { action: 'kept', passwordPath: null };
  }

  const passwordResult = resolveAdminPassword();
  const now = new Date().toISOString();
  const userId = existingUser?.id || uniqueUserId(database, DEFAULT_ADMIN_ID);
  database.users[userId] = {
    id: userId,
    username: adminUsername,
    passwordHash: hashPassword(passwordResult.password),
    createdAt: existingUser?.createdAt || now,
    updatedAt: now
  };

  return {
    action: existingUser ? 'reset' : 'created',
    passwordPath: passwordResult.passwordPath
  };
}

/**
 * 生成不会覆盖已有用户的管理员 id。
 */
function uniqueUserId(database, baseId) {
  if (!database.users[baseId]) return baseId;
  let index = 2;
  while (database.users[`${baseId}-${index}`]) index += 1;
  return `${baseId}-${index}`;
}

/**
 * 解析管理员密码；未显式提供时生成随机密码并保存到数据库同目录。
 */
function resolveAdminPassword() {
  if (args.password) return { password: args.password, passwordPath: null };

  const passwordPath = path.join(databaseDirectory, GENERATED_PASSWORD_FILE);
  if (existsSync(passwordPath)) {
    const existing = readFileSync(passwordPath, 'utf8').trim();
    if (existing) return { password: existing, passwordPath };
  }

  const generated = randomBytes(12).toString('base64url');
  mkdirSync(databaseDirectory, { recursive: true });
  writeFileSync(passwordPath, `${generated}\n`, 'utf8');
  return { password: generated, passwordPath };
}

/**
 * 使用和后台登录逻辑一致的 scrypt 算法生成密码摘要。
 */
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * 原子写入数据库文件，避免部署或重启中断时留下半截 JSON。
 */
function writeDatabase(database) {
  mkdirSync(databaseDirectory, { recursive: true });
  database.updatedAt = new Date().toISOString();
  const tempPath = `${databasePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(database, null, 2)}\n`, 'utf8');
  renameSync(tempPath, databasePath);
}

/**
 * 执行数据库初始化流程并输出部署需要的信息。
 */
function main() {
  args = parseArgs(process.argv.slice(2));
  databasePath = path.resolve(args.dbPath || DEFAULT_DATABASE_PATH);
  databaseDirectory = path.dirname(databasePath);
  adminUsername = args.username || DEFAULT_ADMIN_USERNAME;

  if (args.help) {
    printHelp();
    return;
  }

  const database = readDatabase();
  const adminResult = ensureAdminUser(database);
  writeDatabase(database);

  console.log('后台数据库已初始化。');
  console.log(`数据库文件：${databasePath}`);
  console.log(`管理员账号：${adminUsername}`);
  if (adminResult.passwordPath) {
    console.log(`管理员密码文件：${adminResult.passwordPath}`);
  } else if (adminResult.action === 'kept') {
    console.log('管理员密码：沿用已有数据库记录。');
  } else {
    console.log('管理员密码：使用命令参数或环境变量。');
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
