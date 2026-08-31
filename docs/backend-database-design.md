# 后台数据库设计

## 目标

当前后台模式采用 JSON 文件数据库，部署时不依赖额外数据库服务，适合单门店或少量门店先上线验证。数据库初始化由 `npm run db:init` 完成，应用启动后通过后台 API 读写同一份数据。

后续如果迁移 PostgreSQL，优先替换 `src/server/database.ts` 和 `src/data/backendDataRepository.ts` 的存储实现，页面、计算逻辑和登录入口不需要跟着重写。

## 存储位置

默认数据库路径：

```text
.data/backend-db.json
```

可通过环境变量覆盖：

```text
WAIMAI_BACKEND_DB_PATH=/data/waimai/backend-db.json
```

`.data/` 已加入 `.gitignore`，数据库和随机生成的管理员密码不会进入版本库。

## 数据结构

```json
{
  "version": 1,
  "users": {},
  "sessions": {},
  "calculatorState": null,
  "measurements": {},
  "measurementChunks": {},
  "activityPriceScans": {},
  "updatedAt": "2026-08-28T00:00:00.000Z"
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 数据库结构版本，当前为 `1`。 |
| `users` | object | 后台管理员用户表，key 为用户 id。 |
| `sessions` | object | 登录会话表，key 为 session token。 |
| `calculatorState` | object/null | 当前整份计算器配置，包括门店、商品、平台规则、活动策略等。 |
| `measurements` | object | 测算结果主记录缓存，key 由门店和测算场景生成。 |
| `measurementChunks` | object | 大体量测算结果分片，避免单条记录过大。 |
| `activityPriceScans` | object | 活动设计里的原价扫描结果缓存。 |
| `updatedAt` | string | 最近一次数据库写入时间。 |

## 用户记录

```json
{
  "id": "admin",
  "username": "admin",
  "passwordHash": "salt:hash",
  "createdAt": "2026-08-28T00:00:00.000Z",
  "updatedAt": "2026-08-28T00:00:00.000Z"
}
```

密码不明文入库，使用 `scrypt` 生成摘要。首次初始化时：

- 优先使用 `--password` 参数。
- 其次使用 `WAIMAI_ADMIN_PASSWORD`。
- 都没有时生成随机密码，并写入数据库同目录的 `admin-password.txt`。

## 会话记录

```json
{
  "token": "session-token",
  "userId": "admin",
  "createdAt": "2026-08-28T00:00:00.000Z",
  "expiresAt": "2026-09-04T00:00:00.000Z"
}
```

登录成功后服务端写入 httpOnly cookie。接口读取 cookie 校验会话，过期会话会在访问时清理。

## API 与数据表对应

| 接口 | 方法 | 数据字段 | 登录要求 |
| --- | --- | --- | --- |
| `/api/auth/session` | GET | `sessions`、`users` | 否 |
| `/api/auth/login` | POST | `users`、`sessions` | 否 |
| `/api/auth/logout` | POST | `sessions` | 是 |
| `/api/calculator/state` | GET/PUT | `calculatorState` | 是 |
| `/api/calculator/measurements` | GET/PUT | `measurements` | 是 |
| `/api/calculator/measurement-chunks` | GET/PUT/DELETE | `measurementChunks` | 是 |
| `/api/calculator/activity-price-scans` | GET/PUT | `activityPriceScans` | 是 |

## 服务器初始化命令

最小初始化：

```bash
npm run db:init
```

指定服务器数据目录和管理员密码：

```bash
WAIMAI_BACKEND_DB_PATH=/data/waimai/backend-db.json \
WAIMAI_ADMIN_USERNAME=admin \
WAIMAI_ADMIN_PASSWORD='your-strong-password' \
npm run db:init
```

一键准备生产运行产物：

```bash
WAIMAI_BACKEND_DB_PATH=/data/waimai/backend-db.json \
WAIMAI_ADMIN_USERNAME=admin \
WAIMAI_ADMIN_PASSWORD='your-strong-password' \
npm run server:prepare
```

生产启动：

```bash
WAIMAI_BACKEND_DB_PATH=/data/waimai/backend-db.json \
WAIMAI_COOKIE_SECURE=true \
npm start
```

如果服务端不是 HTTPS，`WAIMAI_COOKIE_SECURE` 不要设置为 `true`，否则浏览器不会保存登录 cookie。

## PostgreSQL 迁移边界

`docs/database-schema.sql` 是后续关系型数据库版本的设计稿。当前线上先使用 JSON 文件库，迁移 PostgreSQL 时建议保持下面的接口契约不变：

- `loadCalculatorState` / `saveCalculatorState`
- `loadMeasurementRecord` / `saveMeasurementRecord`
- `loadMeasurementRows`
- `saveActivityPriceScanRecord`
- 登录、退出、读取会话接口

这样页面维护门店、商品、活动和系统策略的代码不用修改，只替换后台存储适配层。
