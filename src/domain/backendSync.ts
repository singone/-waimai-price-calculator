import type { Activities, CalculatorState, Coupon, Platform, Store } from './types';
import { activityConfigurationErrors, COUPON_CHANNELS, COUPON_TARGETS } from './activity/configuration';
import { deepClone, effectiveFeeRule } from './core';
import { PlatformUtils } from './platform';
import { PLATFORM_FEE_FIELDS } from './platformFeeFields';

export type BackendItem = {
  kind: 'fee' | 'product' | 'activity' | 'redTiers';
  field: string;
  value: unknown;
  productId?: string;
  productCode?: string;
  productName?: string;
};
export type BackendSnapshot = {
  version: 1;
  platform: Platform;
  storeName: string;
  observedAt: string;
  source: string;
  expiresAt?: string;
  unsupportedRules: string[];
  items: BackendItem[];
};
export type BackendDifference = {
  key: string;
  label: string;
  kind: BackendItem['kind'];
  field: string;
  productId?: string;
  before: unknown;
  beforeSaved: unknown;
  after: unknown;
  status: 'same' | 'change' | 'blocked';
  reason?: string;
};
export type BackendSyncRecord = {
  id: string;
  platform: Platform;
  source: string;
  observedAt: string;
  appliedAt: string;
  revertedAt?: string;
  changes: BackendDifference[];
};

const ACTIVITY_FIELDS = ['fullReductions', 'coupons', 'redAddOns', 'discountActivities', 'jingdongSubsidyCoupons'] as const;
const ACTIVITY_LABELS: Record<string, string> = {
  fullReductions: '门店满减', coupons: '商家承担的订单券', redAddOns: '红包加码',
  discountActivities: '商品折扣', jingdongSubsidyCoupons: '京东补贴券', redTiers: '商家承担的基础红包阶梯'
};
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('数据格式错误，应为对象。');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}不能为空。`);
  return value.trim();
}
function number(value: unknown, label: string, max = 1000000): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`${label}必须是 0 至 ${max} 的有效数字。空白不能视为 0。`);
  return value;
}
function boolean(value: unknown) {
  if (typeof value !== 'boolean') throw new Error('启用状态必须明确为 true 或 false。');
  return value;
}
function rows(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value) || value.length > 1000) throw new Error('活动规则应为列表，最多 1000 项。');
  return value.map(item => {
    const row = object(item);
    const enabled = boolean(row.enabled);
    if (field === 'redTiers') {
      const min = number(row.min, '红包最低承担');
      const max = number(row.max, '红包最高承担');
      if (max < min) throw new Error('红包最高承担不能小于最低承担。');
      return { enabled, threshold: number(row.threshold, '门槛'), min, max };
    }
    if (field === 'discountActivities') {
      const discountRate = number(row.discountRate, '折扣', 10);
      const itemLimit = row.itemLimit === '' ? '' : number(row.itemLimit, '折扣件数', 1000);
      if (itemLimit !== '' && !Number.isInteger(itemLimit)) throw new Error('折扣件数应为整数。');
      return { enabled, name: text(row.name, '活动名称'), productNames: text(row.productNames, '商品关键字'), discountRate, itemLimit };
    }
    const threshold = number(row.threshold, '门槛');
    const amount = number(row.amount, '金额');
    if (field === 'jingdongSubsidyCoupons') {
      if (row.kind !== 'large' && row.kind !== 'small') throw new Error('京东券类型应为 large 或 small。');
      const merchantAmount = number(row.merchantAmount, '商家承担');
      const merchantExtraAmount = number(row.merchantExtraAmount, '商家加码');
      const platformAmount = number(row.platformAmount, '平台承担');
      if (Math.abs(merchantAmount + platformAmount - amount) > 0.01) throw new Error('京东券的商家承担与平台承担之和应等于券面额，加码单列。');
      return { enabled, threshold, amount, name: text(row.name, '券名称'), kind: row.kind, merchantAmount, merchantExtraAmount, platformAmount, stackableWithLarge: boolean(row.stackableWithLarge) };
    }
    if (field === 'coupons') {
      if (row.channel !== undefined && !COUPON_CHANNELS.some(option => option.value === row.channel)) throw new Error('未知订单券发放渠道。');
      if (row.targetUser !== undefined && !COUPON_TARGETS.some(option => option.value === row.targetUser)) throw new Error('未知订单券人群。');
      return { enabled, threshold, amount, name: text(row.name, '券名称'),
        channel: row.channel as Coupon['channel'], targetUser: row.targetUser as Coupon['targetUser'],
        usageSuggestion: row.usageSuggestion === undefined || row.usageSuggestion === '' ? undefined : text(row.usageSuggestion, '核对备注'),
        stackableWithCoupons: row.stackableWithCoupons === undefined ? undefined : boolean(row.stackableWithCoupons) };
    }
    return { enabled, threshold, amount };
  });
}

/** 校验来自后台摘录或导出文件的有限字段，不执行文件中的指令。 */
export function parseBackendSnapshot(value: unknown): BackendSnapshot {
  const raw = object(value);
  if (raw.version !== 1 || !PlatformUtils.ALL_PLATFORMS.includes(raw.platform as Platform)) throw new Error('平台或数据版本不支持。');
  const observedAt = text(raw.observedAt, '采集时间');
  if (!Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now() + 60000) throw new Error('采集时间无效或在未来。');
  const source = text(raw.source, '来源／后台路径');
  if (/token=|access_token|password=|authorization|cookie=/i.test(source)) throw new Error('来源中包含登录凭证，请仅填写后台菜单路径或无凭证链接。');
  const expiresAt = raw.expiresAt ? text(raw.expiresAt, '有效期') : undefined;
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.parse(observedAt))) throw new Error('有效期必须晚于采集时间。');
  if (!Array.isArray(raw.items) || raw.items.length === 0 || raw.items.length > 1000) throw new Error('请提供 1 至 1000 项后台数据。');
  if (raw.unsupportedRules !== undefined && (!Array.isArray(raw.unsupportedRules) || raw.unsupportedRules.some(item => typeof item !== 'string'))) throw new Error('特殊规则应为文字列表。');
  const items: BackendItem[] = raw.items.map(value => {
    const item = object(value);
    const field = text(item.field, '项目');
    if (item.kind === 'fee') {
      if (!PLATFORM_FEE_FIELDS.some(([key]) => key === field)) throw new Error(`不支持的费用字段：${field}`);
      return { kind: 'fee', field, value: number(item.value, field, field === 'commissionRate' ? 100 : 10000) };
    }
    if (item.kind === 'product') {
      if (!['price', 'packageFee', 'enabled'].includes(field)) throw new Error(`不支持的商品字段：${field}`);
      const productId = typeof item.productId === 'string' ? item.productId.trim() : undefined;
      const productCode = typeof item.productCode === 'string' ? item.productCode.trim() : undefined;
      const productName = typeof item.productName === 'string' ? item.productName.trim() : undefined;
      if (!productId && !productCode && !productName) throw new Error('商品须提供工具商品 ID、商家编码或名称。');
      return { kind: 'product', field, value: field === 'enabled' ? boolean(item.value) : number(item.value, field), productId, productCode, productName };
    }
    if (item.kind === 'redTiers') return { kind: 'redTiers', field: 'redTiers', value: rows(item.value, 'redTiers') };
    if (item.kind === 'activity' && ACTIVITY_FIELDS.includes(field as typeof ACTIVITY_FIELDS[number])) {
      if (field === 'jingdongSubsidyCoupons' && raw.platform !== 'jingdong') throw new Error('京东补贴券只能同步到京东。');
      const value = rows(item.value, field);
      const check = { fullReductions: [], coupons: [], redAddOns: [], discountActivities: [], jingdongSubsidyCoupons: [], [field]: value } as Activities;
      const errors = activityConfigurationErrors(check);
      if (errors.length) throw new Error(errors.join('；'));
      return { kind: 'activity', field, value };
    }
    throw new Error(`未知项目类型或不支持的活动：${field}`);
  });
  return { version: 1, platform: raw.platform as Platform, storeName: text(raw.storeName, '后台门店名称'), observedAt, source, expiresAt, unsupportedRules: (raw.unsupportedRules as string[] || []).filter(item => item.trim()), items };
}
const equal = (left: unknown, right: unknown) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
const normalizeName = (value: string) => value.replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')');
function productField(platform: Platform, field: string) {
  return field === 'price' ? PlatformUtils.priceField(platform) : field === 'packageFee' ? PlatformUtils.packageFeeField(platform) : `${platform}Enabled` as const;
}
function savedValue(store: Store, platform: Platform, change: Pick<BackendDifference, 'kind' | 'field' | 'productId'>): unknown {
  if (change.kind === 'product') return store.products.find(item => item.id === change.productId)?.[productField(platform, change.field)];
  if (change.kind === 'activity') return store.activities[platform][change.field as keyof Activities];
  const rule = store.platformFeeOverrides?.[platform];
  return change.kind === 'redTiers' ? rule?.redTiers?.[platform] : rule?.[change.field as keyof typeof rule];
}

export function compareBackendSnapshot(state: CalculatorState, store: Store, snapshot: BackendSnapshot): BackendDifference[] {
  const scopeError = normalizeName(store.name) !== normalizeName(snapshot.storeName) ? '后台门店名称与当前门店不一致，请先选择对应门店。'
    : snapshot.expiresAt && Date.parse(snapshot.expiresAt) <= Date.now() ? '后台数据已过有效期，需要重新核查。'
      : snapshot.unsupportedRules.length ? `存在尚未支持的特殊规则：${snapshot.unsupportedRules.join('；')}` : '';
  const result = snapshot.items.map((item): BackendDifference => {
    let before: unknown;
    let productId: string | undefined;
    let label = ACTIVITY_LABELS[item.field] || PLATFORM_FEE_FIELDS.find(([field]) => field === item.field)?.[1] || item.field;
    let reason = scopeError;
    if (item.kind === 'product') {
      const matches = store.products.filter(product => item.productId ? product.id === item.productId
        : item.productCode ? product.merchantProductCode === item.productCode || (snapshot.platform === 'jingdong' && product.jingdongSkuCode === item.productCode)
          : product.name === item.productName);
      if (matches.length !== 1) reason ||= matches.length ? '商品匹配不唯一，请使用商品 ID 或商家编码。' : '未找到商品，请先在商品维护中建立商品或核对编码。';
      const product = matches.length === 1 ? matches[0] : undefined;
      productId = product?.id;
      if (product) before = item.field === 'price' ? PlatformUtils.price(product, snapshot.platform) : item.field === 'packageFee' ? PlatformUtils.packageFee(product, snapshot.platform) : PlatformUtils.isListed(product, snapshot.platform);
      label = `${item.productName || product?.name || item.productCode || item.productId} · ${{ price: '售价', packageFee: '包装费', enabled: '上架状态' }[item.field]}`;
    } else if (item.kind === 'activity') before = store.activities[snapshot.platform][item.field as keyof Activities];
    else {
      const rule = effectiveFeeRule(state, store, snapshot.platform);
      before = item.kind === 'redTiers' ? rule.redTiers[snapshot.platform] : rule[item.field as keyof typeof rule];
    }
    const key = `${item.kind}:${productId || item.productCode || item.productName || ''}:${item.field}`;
    return { key, label, kind: item.kind, field: item.field, productId, before: before ?? null,
      beforeSaved: savedValue(store, snapshot.platform, { ...item, productId }) ?? null,
      after: deepClone(item.value), status: reason ? 'blocked' : equal(before, item.value) ? 'same' : 'change', reason: reason || undefined };
  });
  const counts = new Map<string, number>();
  result.forEach(row => counts.set(row.key, (counts.get(row.key) || 0) + 1));
  return result.map(row => counts.get(row.key)! > 1 ? { ...row, status: 'blocked', reason: '同一项目在后台摘录中出现多次，请去除重复后再核对。' } : row);
}
function writeValue(store: Store, platform: Platform, change: BackendDifference, value: unknown) {
  if (change.kind === 'product') {
    const product = store.products.find(item => item.id === change.productId);
    if (!product) throw new Error('商品已变更，请重新核对。');
    const field = productField(platform, change.field);
    (product as unknown as Record<string, unknown>)[field] = value;
  } else if (change.kind === 'activity') {
    (store.activities[platform] as unknown as Record<string, unknown>)[change.field] = deepClone(value);
  } else {
    const rule = store.platformFeeOverrides?.[platform] || {};
    if (change.kind === 'redTiers') {
      const tiers = { ...rule.redTiers };
      if (value === null) delete tiers[platform]; else tiers[platform] = deepClone(value) as typeof tiers[Platform];
      rule.redTiers = tiers as NonNullable<typeof rule.redTiers>;
    } else if (value === null) delete (rule as Record<string, unknown>)[change.field];
    else (rule as Record<string, unknown>)[change.field] = value;
    store.platformFeeOverrides = { ...store.platformFeeOverrides, [platform]: rule };
  }
}

/** 应用前重新比较，防止预览后配置发生变化；只写勾选项目。 */
export function applyBackendSnapshot(state: CalculatorState, storeId: string, raw: BackendSnapshot, keys: string[], expected?: BackendDifference[]): CalculatorState {
  const snapshot = parseBackendSnapshot(raw);
  const next = deepClone(state);
  const store = next.stores.find(item => item.id === storeId);
  if (!store) throw new Error('门店已不存在。');
  const differences = compareBackendSnapshot(next, store, snapshot);
  if (!keys.length || new Set(keys).size !== keys.length) throw new Error('请选择不重复的同步项目。');
  const changes = keys.map(key => differences.find(item => item.key === key));
  if (changes.some(item => !item || item.status !== 'change')) throw new Error('选中项目已变更或不满足同步条件，请重新核对。');
  if (expected && changes.some(change => {
    const previous = expected.find(item => item.key === change?.key);
    return !previous || !equal(previous.before, change?.before) || !equal(previous.beforeSaved, change?.beforeSaved) || !equal(previous.after, change?.after);
  })) throw new Error('预览后工具配置发生变化，请重新核对后再同步。');
  for (const change of changes as BackendDifference[]) writeValue(store, snapshot.platform, change, change.after);
  store.backendSyncHistory = (store.backendSyncHistory || []).concat({ id: crypto.randomUUID(), platform: snapshot.platform, source: snapshot.source, observedAt: snapshot.observedAt, appliedAt: new Date().toISOString(), changes: changes as BackendDifference[] });
  return next;
}

export function revertBackendSync(state: CalculatorState, storeId: string, recordId: string): CalculatorState {
  const next = deepClone(state);
  const store = next.stores.find(item => item.id === storeId);
  const record = store?.backendSyncHistory?.find(item => item.id === recordId);
  if (!store || !record || record.revertedAt) throw new Error('该记录不存在或已撤回。');
  if (record.changes.some(change => !equal(savedValue(store, record.platform, change), change.after))) throw new Error('同步后的项目又被修改，不能直接撤回，以免覆盖新数据。请重新核对。');
  record.changes.forEach(change => writeValue(store, record.platform, change, change.beforeSaved));
  record.revertedAt = new Date().toISOString();
  return next;
}

export function backendSyncRecordStatus(store: Store, record: BackendSyncRecord): 'reverted' | 'current' | 'changed' {
  if (record.revertedAt) return 'reverted';
  return record.changes.every(change => equal(savedValue(store, record.platform, change), change.after)) ? 'current' : 'changed';
}
