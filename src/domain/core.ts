import type {
  Activities,
  CalculatorState,
  CalculationLimits,
  ComboEvaluationRow,
  ComboItem,
  Coupon,
  DiscountActivity,
  FeeRule,
  FullReduction,
  MeasurementSettings,
  Platform,
  PriceBandRow,
  Product,
  RedAddOn,
  RedTier,
  Severity,
  StapleScenario,
  Store,
  StrategyTarget
} from './types';
import { average, normalizeDiscountRate, profitRateByBasis, roundMoney } from './money';

export const PLATFORMS: Platform[] = ['meituan', 'eleme'];
export const PLATFORM_NAMES: Record<Platform, string> = { meituan: '美团', eleme: '饿了么' };

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function currentStoreFrom(state: CalculatorState) {
  return state.stores.find(store => store.id === state.selectedStoreId) || state.stores[0];
}

export function effectiveFeeRule(state: CalculatorState, store = currentStoreFrom(state)): FeeRule {
  return store.usePlatformFee || !store.customFeeRule
    ? deepClone(state.platformRules)
    : { ...deepClone(state.platformRules), ...deepClone(store.customFeeRule) };
}

export function isProductListedOnPlatform(product: Product, platform: Platform) {
  return platform === 'meituan' ? product.meituanEnabled !== false : product.elemeEnabled !== false;
}

export function platformPrice(product: Product, platform: Platform) {
  const platformValue = platform === 'eleme' ? product.elemePrice : product.meituanPrice;
  const n = Number(platformValue);
  return n > 0 ? n : Number(product.price) || 0;
}

export function platformPackageFee(product: Product, platform: Platform) {
  const platformValue = platform === 'eleme' ? product.elemePackageFee : product.meituanPackageFee;
  if (platformValue !== '') return Math.max(0, Number(platformValue) || 0);
  return Math.max(0, Number(product.packageFee) || 0);
}

export function platformOriginalUnitPrice(product: Product, platform: Platform) {
  return roundMoney(platformPrice(product, platform) + platformPackageFee(product, platform));
}

export function productStapleServingCount(product: Pick<Product, 'stapleServingCount'>) {
  return Math.max(0, Math.floor(Number(product.stapleServingCount) || 0));
}

/**
 * 判断商品是否可作为一单商品组合的主组合锚点。
 *
 * @param product 商品分类、主食份数和单点不送配置。
 * @returns true 表示商品可独立作为饭团/套餐主组合参与点单。
 */
export function isMealMainProduct(product: Pick<Product, 'category' | 'stapleServingCount' | 'nonStandalone'>) {
  if (product.nonStandalone) return false;
  return product.category === 'staple' || product.category === 'setMeal' || productStapleServingCount(product) > 0;
}

/**
 * 计算主组合商品贡献的主食份数。
 *
 * @param product 商品分类、主食份数和单点不送配置。
 * @returns 非主组合商品返回 0；主组合商品至少按 1 份主食计算。
 */
export function mealMainStapleServingCount(product: Pick<Product, 'category' | 'stapleServingCount' | 'nonStandalone'>) {
  return isMealMainProduct(product) ? Math.max(1, productStapleServingCount(product)) : 0;
}

/**
 * 判断商品是否可进入凑单池。
 *
 * @param product 商品分类、主食份数和单点不送配置。
 * @returns true 表示商品按“单点不送”配置进入凑单池，可和主组合做笛卡尔合并。
 */
export function isMealAddOnProduct(product: Pick<Product, 'category' | 'stapleServingCount' | 'nonStandalone'>) {
  return product.nonStandalone && productStapleServingCount(product) <= 0;
}

/**
 * 判断数量组合是否包含至少一个主组合锚点。
 *
 * @param store 当前门店。
 * @param qtys 与门店商品顺序一致的购买数量。
 * @returns true 表示组合满足“饭团/套餐 + 可选凑单”的基础点单规则。
 */
export function comboHasMealMainAnchor(store: Store, qtys: number[]) {
  return qtys.some((qty, index) => qty > 0 && isMealMainProduct(store.products[index]));
}

export function comboStapleServingCount(items: ComboItem[]) {
  return items.reduce((sum, item) => sum + item.stapleServingCount * item.qty, 0);
}

export function pricingScenarioForStapleCount(stapleCount: number): StapleScenario {
  const normalized = Math.max(0, Math.floor(Number(stapleCount) || 0));
  if (normalized >= 3) return 'multi';
  if (normalized === 2) return 'double';
  return 'single';
}

export function stapleScenarioName(scenario: StapleScenario) {
  return { single: '单人', double: '双人', multi: '多人' }[scenario];
}

export function stapleScenarioRange(scenario: StapleScenario): Pick<Store, 'stapleCountMin' | 'stapleCountMax'> {
  if (scenario === 'single') return { stapleCountMin: 1, stapleCountMax: 1 };
  if (scenario === 'double') return { stapleCountMin: 2, stapleCountMax: 2 };
  return { stapleCountMin: 3, stapleCountMax: '' };
}

export function stateWithStapleScenario(state: CalculatorState, scenario: StapleScenario): CalculatorState {
  const next = deepClone(state);
  const store = currentStoreFrom(next);
  const range = stapleScenarioRange(scenario);
  store.stapleCountMin = range.stapleCountMin;
  store.stapleCountMax = range.stapleCountMax;
  return next;
}

export function calculationTotalRange(store: Store) {
  const min = Math.max(0, Number(store.calculationTotalMin) || 0);
  const rawMax = store.calculationTotalMax === '' ? Infinity : Math.max(0, Number(store.calculationTotalMax) || 0);
  return { min, max: rawMax === Infinity ? Infinity : Math.max(min, rawMax) };
}

export function isInCalculationTotalRange(store: Store, total: number) {
  const range = calculationTotalRange(store);
  return total + 1e-9 >= range.min && total <= range.max + 1e-9;
}

export function stapleCountRange(store: Store) {
  const min = Math.max(0, Math.floor(Number(store.stapleCountMin) || 0));
  const max = store.stapleCountMax === '' ? Infinity : Math.max(min, Math.floor(Number(store.stapleCountMax) || 0));
  return { min, max };
}

export function isInStapleCountRange(store: Store, stapleCount: number) {
  const range = stapleCountRange(store);
  return stapleCount + 1e-9 >= range.min && stapleCount <= range.max + 1e-9;
}

function canContinueByStapleRange(store: Store, index: number, currentStapleCount: number, suffixMaxStaple: number[]) {
  const range = stapleCountRange(store);
  if (currentStapleCount > range.max + 1e-9) return false;
  return currentStapleCount + (suffixMaxStaple[index] || 0) + 1e-9 >= range.min;
}

function buildCalculationPriceBounds(store: Store, platforms: Platform[]) {
  const minPrices: number[] = [];
  const maxPrices: number[] = [];
  const stapleCounts: number[] = [];
  store.products.forEach(product => {
    const prices = platforms
      .filter(platform => isProductListedOnPlatform(product, platform))
      .map(platform => platformOriginalUnitPrice(product, platform));
    minPrices.push(prices.length ? Math.min(...prices) : 0);
    maxPrices.push(prices.length ? Math.max(...prices) : 0);
    stapleCounts.push(mealMainStapleServingCount(product));
  });
  const suffixMax: number[] = Array(store.products.length + 1).fill(0);
  const suffixMaxStaple: number[] = Array(store.products.length + 1).fill(0);
  for (let index = store.products.length - 1; index >= 0; index--) {
    suffixMax[index] = suffixMax[index + 1] + maxPrices[index] * store.maxQtyPerSku;
    suffixMaxStaple[index] = suffixMaxStaple[index + 1] + stapleCounts[index] * store.maxQtyPerSku;
  }
  return { minPrices, maxPrices, stapleCounts, suffixMax, suffixMaxStaple };
}

function canContinueByCalculationRange(store: Store, nextIndex: number, currentMinTotal: number, currentMaxTotal: number, suffixMax: number[]) {
  const range = calculationTotalRange(store);
  if (currentMinTotal > range.max + 1e-9) return false;
  return currentMaxTotal + suffixMax[nextIndex] + 1e-9 >= range.min;
}

export function calculationNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function yieldToWorker() {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

export const DEFAULT_CALCULATION_MAX_DURATION_MS = 30000;

export function normalizeCalculationMaxDuration(value?: number) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return DEFAULT_CALCULATION_MAX_DURATION_MS;
  return Math.max(1000, Math.floor(duration));
}

export function calculationStopWarning(summary: Pick<ComboEnumerationSummary, 'stopped' | 'stoppedReason'>, maxChecks: number, maxDurationMs: number) {
  if (!summary.stopped) return null;
  if (summary.stoppedReason === 'maxDuration') {
    return `已达到最长计算时间 ${Math.round(maxDurationMs / 1000)} 秒，已停止继续枚举。`;
  }
  return `已达到最多检查组合数 ${maxChecks}，已停止继续枚举。`;
}

export type ComboEnumerationSummary = {
  checked: number;
  validCombos: number;
  stopped: boolean;
  stoppedReason?: 'maxChecks' | 'maxDuration';
};

export async function enumerateStoreCombosAsync(
  store: Store,
  platforms: Platform[],
  visit: (qtys: number[]) => void,
  onProgress?: (summary: ComboEnumerationSummary) => void,
  limits?: CalculationLimits
): Promise<ComboEnumerationSummary> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeCalculationMaxDuration(limits?.maxDurationMs);
  const priceBounds = buildCalculationPriceBounds(store, platforms);
  const qtys = Array(store.products.length).fill(0);
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: ComboEnumerationSummary['stoppedReason'];
  let visitedNodes = 0;
  let lastYieldAt = calculationNow();
  let lastProgressAt = calculationNow();

  function stop(reason: NonNullable<ComboEnumerationSummary['stoppedReason']>) {
    stopped = true;
    stoppedReason = reason;
  }

  function stopIfTimedOut(now = calculationNow()) {
    if (!stopped && now - startedAt >= maxDurationMs) stop('maxDuration');
    return stopped;
  }

  async function maybeYield(force = false) {
    visitedNodes++;
    const now = calculationNow();
    if (stopIfTimedOut(now)) return;
    const shouldYield = force || visitedNodes % 600 === 0 || now - lastYieldAt >= 16;
    if (!shouldYield) return;
    lastYieldAt = now;
    if (onProgress && now - lastProgressAt >= 120) {
      lastProgressAt = now;
      onProgress({ checked, validCombos, stopped, stoppedReason });
    }
    await yieldToWorker();
  }

  async function dfs(index: number, totalQty: number, currentMinTotal: number, currentMaxTotal: number, currentStapleCount: number): Promise<void> {
    if (stopped) return;
    await maybeYield();
    if (!canContinueByCalculationRange(store, index, currentMinTotal, currentMaxTotal, priceBounds.suffixMax)) return;
    if (!canContinueByStapleRange(store, index, currentStapleCount, priceBounds.suffixMaxStaple)) return;
    if (index === store.products.length) {
      if (totalQty === 0) return;
      checked++;
      if (checked > store.maxChecks) {
        stop('maxChecks');
        return;
      }
      if (stopIfTimedOut()) return;
      if (!comboHasMealMainAnchor(store, qtys)) return;
      if (!isInStapleCountRange(store, currentStapleCount)) return;
      validCombos++;
      visit(qtys.slice());
      await maybeYield(checked % 200 === 0);
      return;
    }
    const canSellOnSelectedPlatforms = platforms.some(platform => isProductListedOnPlatform(store.products[index], platform));
    const maxQty = canSellOnSelectedPlatforms ? Math.min(store.maxQtyPerSku, store.maxItems - totalQty) : 0;
    for (let qty = 0; qty <= maxQty; qty++) {
      qtys[index] = qty;
      const nextMinTotal = currentMinTotal + priceBounds.minPrices[index] * qty;
      const nextMaxTotal = currentMaxTotal + priceBounds.maxPrices[index] * qty;
      const nextStapleCount = currentStapleCount + priceBounds.stapleCounts[index] * qty;
      if (canContinueByCalculationRange(store, index + 1, nextMinTotal, nextMaxTotal, priceBounds.suffixMax)) {
        await dfs(index + 1, totalQty + qty, nextMinTotal, nextMaxTotal, nextStapleCount);
      }
      if (stopped) return;
    }
    qtys[index] = 0;
  }

  if (store.products.length) await dfs(0, 0, 0, 0, 0);
  onProgress?.({ checked, validCombos, stopped, stoppedReason });
  return { checked, validCombos, stopped, stoppedReason };
}

export function parseOrderMinutes(value: string) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24 && minute === 0) return 1440;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

export function calculateTimeFee(value: string) {
  const minutes = parseOrderMinutes(value);
  if (minutes === null) return 0;
  if (minutes > 0 && minutes <= 120) return 0.8;
  if (minutes > 120 && minutes <= 360) return 1;
  if (minutes > 1260 && minutes <= 1440) return 0.3;
  return 0;
}

export function calculateFreightSubsidy(rule: FeeRule, distanceValue: number) {
  const distance = Math.max(0, Number(distanceValue) || 0);
  if (distance <= 3) return roundMoney(rule.freightWithin3);
  if (distance <= 5) return roundMoney(rule.freightWithin5);
  return roundMoney(rule.freightAbove5);
}

export function calculateServiceFee(rule: FeeRule, store: Store, priceBasis: number) {
  const distance = Math.max(0, Number(store.deliveryDistance) || 0);
  const extraUnits = distance <= 3 ? 0 : Math.ceil(((distance - 3) * 10) - 1e-9);
  const distanceFee = roundMoney(rule.baseDeliveryFee + extraUnits * rule.extraDeliveryFee);
  const basis = Math.max(0, Number(priceBasis) || 0);
  let priceFee = 0;
  if (basis > 25) priceFee = 5 * rule.midPriceRate + (basis - 25) * rule.highPriceRate;
  else if (basis > 20) priceFee = (basis - 20) * rule.midPriceRate;
  return roundMoney(distanceFee + priceFee + calculateTimeFee(store.orderTime));
}

export function buildFeeSummary(state: CalculatorState, store: Store, finalPay: number) {
  const rule = effectiveFeeRule(state, store);
  const commission = roundMoney(Math.max(finalPay * (rule.commissionRate / 100), rule.minCommission));
  const serviceFee = calculateServiceFee(rule, store, finalPay);
  const freightSubsidy = calculateFreightSubsidy(rule, store.deliveryDistance);
  return { commission, serviceFee, freightSubsidy };
}

export function pricingTierName(tier: StrategyTarget['tier']) {
  if (!tier) return '未匹配策略';
  return `实付${roundMoney(tier.payMin)}-${tier.payMax >= 9999 ? '不限' : roundMoney(tier.payMax)}`;
}

export function pricingStrategyTargetForPay(state: CalculatorState, store: Store, finalPay: number, stapleCount: number): StrategyTarget {
  const scenario = pricingScenarioForStapleCount(stapleCount);
  const strategy = effectiveFeeRule(state, store).pricingStrategy;
  const rows = (strategy[scenario] || [])
    .filter(row => row.enabled)
    .sort((a, b) => a.payMin - b.payMin || a.payMax - b.payMax);
  const tier = rows.find((row, index) => {
    const isLast = index === rows.length - 1;
    return finalPay + 1e-9 >= row.payMin && (isLast || finalPay <= row.payMax + 1e-9);
  }) || rows[rows.length - 1] || null;
  return {
    scenario,
    scenarioName: stapleScenarioName(scenario),
    tier,
    tierName: pricingTierName(tier),
    requiredPayRate: Math.max(0, Number(tier?.payRateMin) || 0) / 100,
    targetPayRate: Math.max(0, Number(tier?.payRateTarget) || 0) / 100,
    requiredNetRate: Math.max(0, Number(tier?.netRateMin) || 0) / 100,
    targetNetRate: Math.max(0, Number(tier?.netRateTarget) || 0) / 100
  };
}

export function activityMatchesProduct(activity: DiscountActivity, product: Product) {
  const text = String(activity.productNames || '').trim();
  if (!text) return true;
  return text.split(/[,，、\s]+/).filter(Boolean).some(keyword => product.name.includes(keyword));
}

export function applyProductDiscounts(units: Array<{ product: Product; price: number }>, activities: DiscountActivity[], maxDiscountItems: number | '') {
  const enabled = activities.filter(activity => activity.enabled);
  if (!enabled.length) return 0;
  const candidates: Array<{ unitIndex: number; activityIndex: number; amount: number }> = [];
  enabled.forEach((activity, activityIndex) => {
    units.forEach((unit, unitIndex) => {
      if (!activityMatchesProduct(activity, unit.product)) return;
      const discounted = roundMoney(unit.price * normalizeDiscountRate(activity.discountRate));
      const amount = roundMoney(unit.price - discounted);
      if (amount > 0) candidates.push({ unitIndex, activityIndex, amount });
    });
  });
  candidates.sort((a, b) => b.amount - a.amount);
  const globalLimit = maxDiscountItems === '' ? Infinity : Math.max(0, Number(maxDiscountItems) || 0);
  const activityLimits = enabled.map(activity => activity.itemLimit === '' ? Infinity : Math.max(0, Number(activity.itemLimit) || 0));
  const usedUnits = new Set<number>();
  let usedGlobal = 0;
  let total = 0;
  for (const candidate of candidates) {
    if (usedGlobal >= globalLimit) break;
    if (usedUnits.has(candidate.unitIndex)) continue;
    if (activityLimits[candidate.activityIndex] <= 0) continue;
    usedUnits.add(candidate.unitIndex);
    usedGlobal++;
    activityLimits[candidate.activityIndex]--;
    total += candidate.amount;
  }
  return roundMoney(total);
}

export function buildPlatformTotals(store: Store, platform: Platform, qtys: number[], activities?: Activities) {
  const units: Array<{ product: Product; price: number }> = [];
  const items: ComboItem[] = [];
  let originalTotal = 0;
  let costTotal = 0;
  let hasUnlistedProduct = false;
  store.products.forEach((product, index) => {
    const qty = qtys[index] || 0;
    if (qty <= 0) return;
    if (!isProductListedOnPlatform(product, platform)) {
      hasUnlistedProduct = true;
      return;
    }
    const price = platformPrice(product, platform);
    const packageFee = platformPackageFee(product, platform);
    const cost = Number(product.cost) || 0;
    originalTotal += (price + packageFee) * qty;
    costTotal += cost * qty;
    items.push({
      productId: product.id,
      name: product.name,
      qty,
      price,
      packageFee,
      cost,
      category: product.category,
      stapleServingCount: productStapleServingCount(product),
      nonStandalone: product.nonStandalone
    });
    for (let unitIndex = 0; unitIndex < qty; unitIndex++) units.push({ product, price });
  });
  if (hasUnlistedProduct) return { items: [], originalTotal: 0, costTotal: 0, productDiscount: 0, afterProductDiscount: 0 };
  const discount = activities ? applyProductDiscounts(units, activities.discountActivities, store.maxDiscountItems) : 0;
  return {
    items,
    originalTotal: roundMoney(originalTotal),
    costTotal: roundMoney(costTotal),
    productDiscount: roundMoney(discount),
    afterProductDiscount: roundMoney(originalTotal - discount)
  };
}

export function bestFullReduction(rows: FullReduction[], basis: number): FullReduction {
  return rows
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0] || { enabled: true, threshold: 0, amount: 0 };
}

export function bestBaseRed(state: CalculatorState, platform: Platform, basis: number): RedTier & { amount: number } {
  const tier = state.platformRules.redTiers[platform]
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => b.max - a.max || b.threshold - a.threshold)[0];
  if (!tier) return { enabled: true, threshold: 0, min: 0, max: 0, amount: 0 };
  return { ...tier, amount: roundMoney(Math.max(0, Number(tier.max) || 0)) };
}

export function bestRedAddOn(rows: RedAddOn[], basis: number): RedAddOn {
  return rows
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0] || { enabled: true, threshold: 0, amount: 0 };
}

export function eligibleCouponOptions(coupons: Coupon[], basis: number, maxCoupons: number) {
  const eligible = coupons.filter(coupon => coupon.enabled && basis + 1e-9 >= coupon.threshold);
  const limit = Math.max(0, Math.floor(Number(maxCoupons) || 0));
  const options: Array<{ coupons: Coupon[]; amount: number }> = [{ coupons: [], amount: 0 }];
  if (limit <= 0 || !eligible.length) return options;

  const stack: Array<{ start: number; chosen: Coupon[]; amount: number }> = [{ start: 0, chosen: [], amount: 0 }];
  while (stack.length) {
    const current = stack.pop() as { start: number; chosen: Coupon[]; amount: number };
    if (current.chosen.length >= limit) continue;
    for (let i = eligible.length - 1; i >= current.start; i--) {
      const coupon = eligible[i];
      const next = current.chosen.concat(coupon);
      const nextAmount = roundMoney(current.amount + coupon.amount);
      options.push({ coupons: next, amount: nextAmount });
      stack.push({ start: i + 1, chosen: next, amount: nextAmount });
    }
  }
  return options;
}

export function bestCouponOption(coupons: Coupon[], basis: number, maxCoupons: number) {
  const limit = Math.max(0, Math.floor(Number(maxCoupons) || 0));
  if (limit <= 0) return { coupons: [], amount: 0 };
  const selected = coupons
    .filter(coupon => coupon.enabled && basis + 1e-9 >= coupon.threshold)
    .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, limit);
  return {
    coupons: selected,
    amount: roundMoney(selected.reduce((sum, coupon) => sum + Math.max(0, Number(coupon.amount) || 0), 0))
  };
}

export function severityRank(severity: Severity) {
  return { none: 0, config: 1, medium: 2, high: 3, critical: 4 }[severity];
}

export function buildRiskInfo(row: Omit<ComboEvaluationRow, 'risk'>) {
  const reasons: string[] = [];
  let severity: Severity = 'none';
  if (row.profit < 0) {
    severity = 'critical';
    reasons.push('亏损');
  }
  if (row.netProfitRate === null || row.netProfitRate + 1e-9 < row.requiredNetRate) {
    severity = severityRank(severity) > severityRank('medium') ? severity : 'medium';
    reasons.push('到手利润率低于下限');
  }
  if (row.profitRate === null || row.profitRate + 1e-9 < row.requiredPayRate) {
    severity = severityRank(severity) > severityRank('medium') ? severity : 'medium';
    reasons.push('实付利润率低于下限');
  }
  if (row.profitSpace < -1e-9) {
    severity = severityRank(severity) > severityRank('high') ? severity : 'high';
    reasons.push('利润空间为负');
  }
  if (row.ignored) reasons.push(row.ignoreReason);
  return {
    hasRisk: severity !== 'none',
    severity,
    severityRank: severityRank(severity),
    reasons: reasons.length ? reasons : ['正常'],
    target: null,
    thresholdRate: row.requiredPayRate,
    rateGap: row.profitRate === null ? null : row.profitRate - row.requiredPayRate,
    netThresholdRate: row.requiredNetRate,
    netRateGap: row.netProfitRate === null ? null : row.netProfitRate - row.requiredNetRate
  };
}

export function payRange(settings: Pick<MeasurementSettings, 'payMin' | 'payMax'>) {
  const min = Math.max(0, Number(settings.payMin) || 0);
  const max = settings.payMax === '' ? Infinity : Math.max(min, Number(settings.payMax) || 0);
  return { min, max };
}

export function isInPayRange(settings: Pick<MeasurementSettings, 'payMin' | 'payMax'>, finalPay: number) {
  const range = payRange(settings);
  return finalPay + 1e-9 >= range.min && finalPay <= range.max + 1e-9;
}

export function createComboEvaluationRow(
  state: CalculatorState,
  store: Store,
  platform: Platform,
  items: ComboItem[],
  totals: { originalTotal: number; afterProductDiscount: number; costTotal: number; productDiscount: number },
  discounts: {
    full: FullReduction;
    coupons: Coupon[];
    couponAmount: number;
    baseRed: RedTier & { amount: number };
    redAddOn: RedAddOn;
  },
  finalPay: number,
  ignored = false,
  ignoreReason = ''
): ComboEvaluationRow {
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const profit = roundMoney(netPay - totals.costTotal);
  const stapleCount = comboStapleServingCount(items);
  const target = pricingStrategyTargetForPay(state, store, finalPay, stapleCount);
  const profitRate = profitRateByBasis(profit, finalPay);
  const netProfitRate = profitRateByBasis(profit, netPay);
  const costProfitRate = profitRateByBasis(profit, totals.costTotal);
  const paySpace = profitRate === null ? -Infinity : roundMoney(profit - finalPay * target.targetPayRate);
  const netSpace = netProfitRate === null ? -Infinity : roundMoney(profit - netPay * target.targetNetRate);
  const profitSpace = Number.isFinite(paySpace) && Number.isFinite(netSpace) ? Math.min(paySpace, netSpace) : roundMoney(profit);
  const baseRow = {
    key: '',
    platform,
    platformName: PLATFORM_NAMES[platform],
    items,
    scenario: target.scenario,
    scenarioName: target.scenarioName,
    originalTotal: totals.originalTotal,
    afterProductDiscount: totals.afterProductDiscount,
    finalPay,
    netPay,
    cost: totals.costTotal,
    activityAmount: roundMoney(totals.productDiscount + discounts.full.amount + discounts.couponAmount + discounts.baseRed.amount + discounts.redAddOn.amount + fee.freightSubsidy),
    commission: fee.commission,
    serviceFee: fee.serviceFee,
    freightSubsidy: fee.freightSubsidy,
    profit,
    profitRate,
    netProfitRate,
    costProfitRate,
    targetPayRate: target.targetPayRate,
    targetNetRate: target.targetNetRate,
    requiredPayRate: target.requiredPayRate,
    requiredNetRate: target.requiredNetRate,
    profitSpace,
    profitRateGap: netProfitRate === null ? null : netProfitRate - target.targetNetRate,
    productDiscount: totals.productDiscount,
    full: discounts.full,
    coupons: discounts.coupons,
    couponAmount: discounts.couponAmount,
    baseRed: discounts.baseRed,
    redAddOn: discounts.redAddOn,
    ignored,
    ignoreReason
  };
  const comboKey = items
    .slice()
    .sort((a, b) => a.productId.localeCompare(b.productId) || a.name.localeCompare(b.name, 'zh-CN'))
    .map(item => `${item.productId || item.name}:${item.qty}`)
    .join('|');
  const couponKey = discounts.coupons
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN') || a.threshold - b.threshold || a.amount - b.amount)
    .map(coupon => `${coupon.name}:${roundMoney(coupon.threshold)}:${roundMoney(coupon.amount)}`)
    .join('|');
  const key = [
    platform,
    comboKey,
    `pay:${roundMoney(finalPay)}`,
    `full:${roundMoney(discounts.full.threshold)}:${roundMoney(discounts.full.amount)}`,
    `coupon:${couponKey || 'none'}:${roundMoney(discounts.couponAmount)}`,
    `baseRed:${roundMoney(discounts.baseRed.threshold)}:${roundMoney(discounts.baseRed.amount)}`,
    `redAddOn:${roundMoney(discounts.redAddOn.threshold)}:${roundMoney(discounts.redAddOn.amount)}`,
    ignored ? `ignored:${ignoreReason}` : 'active'
  ].join('::');
  const withKey = { ...baseRow, key };
  return { ...withKey, risk: buildRiskInfo(withKey) };
}

export function evaluateComboWithCurrentActivities(
  state: CalculatorState,
  store: Store,
  platform: Platform,
  qtys: number[],
  settings: Pick<MeasurementSettings, 'payMin' | 'payMax' | 'ignoreOutOfPayRange'>
) {
  const activity = store.activities[platform];
  const totals = buildPlatformTotals(store, platform, qtys, activity);
  if (!totals.items.length) return [];
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return [];
  if (totals.afterProductDiscount + 1e-9 < store.startPrice) return [];
  const full = bestFullReduction(activity.fullReductions, totals.afterProductDiscount);
  const afterFull = Math.max(0, roundMoney(totals.afterProductDiscount - full.amount));
  const couponOption = bestCouponOption(activity.coupons, afterFull, store.maxCoupons);
  const afterCoupon = Math.max(0, roundMoney(afterFull - couponOption.amount));
  const baseRed = bestBaseRed(state, platform, afterCoupon);
  const addOn = bestRedAddOn(activity.redAddOns, afterCoupon);
  const finalPay = Math.max(0, roundMoney(afterCoupon - baseRed.amount - addOn.amount));
  const inRange = isInPayRange(settings, finalPay);
  if (!inRange && !settings.ignoreOutOfPayRange) return [];
  return [createComboEvaluationRow(
    state,
    store,
    platform,
    totals.items,
    { originalTotal: totals.originalTotal, afterProductDiscount: totals.afterProductDiscount, costTotal: totals.costTotal, productDiscount: totals.productDiscount },
    { full, coupons: couponOption.coupons, couponAmount: couponOption.amount, baseRed, redAddOn: addOn },
    finalPay,
    !inRange,
    !inRange ? '超出目标支付价范围，已忽略' : ''
  )];
}

export function bandKey(value: number, size: number) {
  const step = Math.max(1, Number(size) || 5);
  const min = Math.floor(value / step) * step;
  const max = min + step;
  return { key: `${min}-${max}`, label: `${roundMoney(min)}-${roundMoney(max)}`, min, max };
}

export function summarizePriceBands(
  rows: ComboEvaluationRow[],
  size: number,
  basis: 'pay' | 'original',
  options?: { groupByScenario?: boolean }
): PriceBandRow[] {
  const groups = new Map<string, ComboEvaluationRow[]>();
  const groupByScenario = options?.groupByScenario !== false;
  rows.forEach(row => {
    if (row.ignored) return;
    const value = basis === 'pay' ? row.finalPay : row.originalTotal;
    const band = bandKey(value, size);
    const key = groupByScenario
      ? [basis, row.platform, row.scenario, band.key].join('::')
      : [basis, row.platform, band.key].join('::');
    const current = groups.get(key) || [];
    current.push(row);
    groups.set(key, current);
  });
  return Array.from(groups.entries()).map(([key, group]) => {
    const first = group[0];
    const value = basis === 'pay' ? first.finalPay : first.originalTotal;
    const band = bandKey(value, size);
    let profitRateSum = 0;
    let profitRateCount = 0;
    let minProfitRate: number | null = null;
    let maxProfitRate: number | null = null;
    let profitSum = 0;
    let minProfit: number | null = null;
    let maxProfit: number | null = null;
    for (const row of group) {
      profitSum += row.profit;
      minProfit = minProfit === null ? row.profit : Math.min(minProfit, row.profit);
      maxProfit = maxProfit === null ? row.profit : Math.max(maxProfit, row.profit);
      if (row.netProfitRate !== null) {
        profitRateSum += row.netProfitRate;
        profitRateCount++;
        minProfitRate = minProfitRate === null ? row.netProfitRate : Math.min(minProfitRate, row.netProfitRate);
        maxProfitRate = maxProfitRate === null ? row.netProfitRate : Math.max(maxProfitRate, row.netProfitRate);
      }
    }
    const avgProfitRate = profitRateCount ? profitRateSum / profitRateCount : null;
    const avgProfitSpace = average(group.map(row => row.profitSpace)) || 0;
    const riskCount = group.filter(row => row.risk.hasRisk).length;
    const lowCount = group.filter(row => row.profitSpace < -1e-9 || (row.netProfitRate !== null && row.netProfitRate + 1e-9 < row.targetNetRate)).length;
    const suggestion = avgProfitSpace < -1e-9
      ? '活动穿透，需收紧优惠或调价'
      : lowCount > 0
        ? '存在低利润组合，需查看明细'
        : avgProfitRate !== null && maxProfitRate !== null && minProfitRate !== null && maxProfitRate - minProfitRate > 0.12
          ? '同价位利润离散，建议收拢'
          : avgProfitSpace > 1
            ? '存在可释放活动空间'
            : '结构正常';
    return {
      key,
      label: band.label,
      min: band.min,
      max: band.max,
      platform: first.platform,
      platformName: first.platformName,
      scenario: first.scenario,
      scenarioName: groupByScenario ? first.scenarioName : '全部组合',
      comboCount: group.length,
      ignoredCount: 0,
      avgOriginalTotal: average(group.map(row => row.originalTotal)) || 0,
      avgFinalPay: average(group.map(row => row.finalPay)) || 0,
      avgNetPay: average(group.map(row => row.netPay)) || 0,
      avgCost: average(group.map(row => row.cost)) || 0,
      avgProfit: group.length ? roundMoney(profitSum / group.length) : 0,
      minProfit,
      maxProfit,
      avgProfitRate,
      minProfitRate,
      maxProfitRate,
      avgProfitSpace,
      lowCount,
      riskCount,
      suggestion
    };
  }).sort((a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') || a.min - b.min);
}

export function buildProductFilter(store: Store, keyword: string) {
  const normalized = String(keyword || '').trim().toLowerCase();
  if (!normalized) return null;
  return new Set(store.products.filter(product => product.name.toLowerCase().includes(normalized)).map(product => product.id));
}
