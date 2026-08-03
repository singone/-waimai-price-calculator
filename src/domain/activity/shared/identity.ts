import type { Coupon, FullReduction, Platform, RedAddOn } from '../../types';

export type ActivityComboKeyItem = {
  productId: string;
  quantity: number;
};

export type ActivityComboKeyInput = {
  storeId: string;
  platform: Platform;
  productVersion: string;
  comboConfigKey: string;
  items: ActivityComboKeyItem[];
};

export type ActivityRouteKeyInput = {
  platform: Platform;
  version?: string | number;
  fullReductionRules?: FullReduction[];
  couponRules?: Coupon[];
  redAddOnRules?: RedAddOn[];
};

function keyPart(value: string | number) {
  return encodeURIComponent(String(value));
}

function normalizedAmount(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.round(numberValue * 100) / 100 : 0;
}

/**
 * 规范化商品组合明细，用于生成稳定的商品组合 key。
 *
 * @param items 商品 id 与数量列表，允许输入未排序数据。
 * @returns 已过滤无效数量、按商品 id 升序排列后的组合明细。
 */
export function normalizeActivityComboItems(items: ActivityComboKeyItem[]) {
  return items
    .map(item => ({
      productId: String(item.productId || '').trim(),
      quantity: Math.max(0, Math.floor(Number(item.quantity) || 0))
    }))
    .filter(item => item.productId && item.quantity > 0)
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

/**
 * 生成商品组合缓存的稳定 key。
 *
 * @param input 门店、平台、商品版本、组合配置和商品明细。
 * @returns 可用于 IndexedDB 或后端数据库唯一约束的组合 key。
 */
export function buildActivityComboKey(input: ActivityComboKeyInput) {
  const itemKey = normalizeActivityComboItems(input.items)
    .map(item => `${keyPart(item.productId)}:${item.quantity}`)
    .join('|') || 'empty';
  return [
    'combo',
    keyPart(input.storeId),
    keyPart(input.platform),
    keyPart(input.productVersion),
    keyPart(input.comboConfigKey),
    itemKey
  ].join('::');
}

/**
 * 规范化满减规则集合，用于生成满减路线 key。
 *
 * @param rules 门店满减规则列表。
 * @returns 已过滤关闭或无效规则，并按门槛、减额升序排列后的规则列表。
 */
export function normalizeFullReductionRulesForKey(rules: FullReduction[] = []) {
  return rules
    .filter(rule => rule.enabled && normalizedAmount(rule.threshold) > 0 && normalizedAmount(rule.amount) > 0)
    .map(rule => ({
      threshold: normalizedAmount(rule.threshold),
      amount: normalizedAmount(rule.amount)
    }))
    .sort((a, b) => a.threshold - b.threshold || a.amount - b.amount);
}

/**
 * 规范化优惠券规则集合，用于生成优惠券路线 key。
 *
 * @param rules 优惠券规则列表。
 * @returns 已过滤关闭或无效规则，并按门槛、减额、名称升序排列后的规则列表。
 */
export function normalizeCouponRulesForKey(rules: Coupon[] = []) {
  return rules
    .filter(rule => rule.enabled && normalizedAmount(rule.threshold) > 0 && normalizedAmount(rule.amount) > 0)
    .map(rule => ({
      sceneKey: String(rule.sceneKey || ''),
      name: String(rule.name || ''),
      threshold: normalizedAmount(rule.threshold),
      amount: normalizedAmount(rule.amount)
    }))
    .sort((a, b) => a.threshold - b.threshold || a.amount - b.amount || a.sceneKey.localeCompare(b.sceneKey) || a.name.localeCompare(b.name, 'zh-CN'));
}

/**
 * 规范化神券/爆红包加码规则集合，用于生成完整活动路线 key。
 *
 * @param rules 神券或爆红包加码规则列表。
 * @returns 已过滤关闭或无效规则，并按门槛、加码金额升序排列后的规则列表。
 */
export function normalizeRedAddOnRulesForKey(rules: RedAddOn[] = []) {
  return rules
    .filter(rule => rule.enabled && normalizedAmount(rule.amount) > 0)
    .map(rule => ({
      threshold: normalizedAmount(rule.threshold),
      amount: normalizedAmount(rule.amount)
    }))
    .sort((a, b) => a.threshold - b.threshold || a.amount - b.amount);
}

/**
 * 生成完整活动路线的稳定 key。
 *
 * @param input 平台、版本、满减规则、优惠券规则和加码规则。
 * @returns 可与商品组合 key 共同组成活动核验结果唯一标识的活动路线 key。
 */
export function buildActivityRouteKey(input: ActivityRouteKeyInput) {
  const routeSnapshot = {
    platform: input.platform,
    version: String(input.version ?? 'v1'),
    full: normalizeFullReductionRulesForKey(input.fullReductionRules),
    coupon: normalizeCouponRulesForKey(input.couponRules),
    redAddOn: normalizeRedAddOnRulesForKey(input.redAddOnRules)
  };
  return `activity-route::${keyPart(JSON.stringify(routeSnapshot))}`;
}
