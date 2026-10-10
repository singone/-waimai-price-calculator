import type {
  CalculatorState,
  CalculationLimits,
  FeeRule,
  Platform,
  PricingBaseRedAmountMode,
  PricingEvaluationResult,
  PricingEvaluationRule,
  PricingEvaluationSettings,
  PricingPlanKey,
  PricingPlanRuleDetail,
  PricingProductRow,
  PricingStrategyKind,
  Product,
  ProductCategory,
  RedTier,
  Severity,
  Store
} from '../types';
import {
  bestCouponOption,
  bestFullReduction,
  bestRedAddOn,
  calculateFreightSubsidy,
  calculateServiceFee,
  calculationNow,
  currentStoreFrom,
  effectiveFeeRule,
  isMealAddOnProduct,
  isMealMainProduct,
  isProductListedOnPlatform,
  normalizeCalculationMaxDuration,
  platformOriginalUnitPrice,
  platformPackageFee,
  platformPrice,
  PLATFORM_NAMES,
  PLATFORMS,
  pricingScenarioForStapleCount,
  stapleScenarioName
} from '../core';
import { ceilMoneyStep, roundMoney } from '../money';
import { DEFAULT_PRICING_PLAN_KEYS, PRICING_PLAN_PRESETS, type PricingPlanPreset } from './pricingPlans';

const PRICE_SUGGESTION_TOLERANCE = 0.3;
const PRICE_SEARCH_MAX = 999.9;
const PRICE_SEARCH_STEP = 0.1;

type NormalizedPricingSettings = {
  productNameKeyword: string;
  originalMin: number;
  originalMax: number | '';
  enabledPlanKeys: PricingPlanKey[];
  stapleTargetCostShare: number;
  setMealTargetCostShare: number;
  addOnTargetCostShare: number;
  addOnStapleRatioShare: number;
  addOnMinimumOriginalPrice: number;
  addOnPromotionRiskShare: number;
  setMealDiscountRate: number;
  fixedActivityCost: number;
  baseRedAmountMode: PricingBaseRedAmountMode;
};

type EffectivePricingPlanSettings = NormalizedPricingSettings & {
  planKey: PricingPlanKey;
  planName: string;
  planDescription: string;
};

type PricingExpense = {
  baseRed: RedTier & { amount: number };
  baseRedAmount: number;
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
  fixedActivityCost: number;
  platformExpenseTotal: number;
  finalPay: number;
  commissionDeliveryFee: number;
  netRevenue: number;
};

type SetMealComponentSummary = {
  originalTotal: number;
  costTotal: number;
  itemCount: number;
  missingCount: number;
};

type AddOnPricingFloor = {
  costShareFloor: number;
  referenceOriginalPrice: number | null;
  stapleRatioFloor: number | null;
  minimumOriginalPrice: number;
  promotionRiskAmount: number;
  promotionRiskFloor: number;
  finalOriginalFloor: number;
  pricingBasisName: string;
};

type PromotionRiskAmounts = {
  fullReductionAmount: number;
  couponAmount: number;
  baseRedAmount: number;
  redAddOnAmount: number;
};

function categoryName(category: ProductCategory) {
  return {
    staple: '主食',
    snackDrink: '小吃饮料',
    addOn: '加料',
    setMeal: '套餐',
    other: '其他'
  }[category] || '其他';
}

function strategyName(kind: PricingStrategyKind) {
  return {
    staple: '主食',
    addOn: '凑单商品',
    setMeal: '套餐',
    other: '其他'
  }[kind];
}

function nonNegativeAmount(value: unknown, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function ratePercent(value: unknown, fallback: number, max = 300) {
  const n = Number(value);
  const normalized = Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(max, normalized)) / 100;
}

function normalizeBaseRedAmountMode(value: unknown, fallback: PricingBaseRedAmountMode): PricingBaseRedAmountMode {
  return value === 'min' || value === 'average' || value === 'max' ? value : fallback;
}

function normalizePricingPlanKeys(value: unknown): PricingPlanKey[] {
  const allowed = new Set<PricingPlanKey>(DEFAULT_PRICING_PLAN_KEYS);
  const rows = Array.isArray(value) ? value : DEFAULT_PRICING_PLAN_KEYS;
  const keys = rows
    .filter((item): item is PricingPlanKey => allowed.has(item as PricingPlanKey))
    .filter((item, index, list) => list.indexOf(item) === index);
  return keys.length ? keys : DEFAULT_PRICING_PLAN_KEYS;
}

function clampRate(value: number, max = 3) {
  return Math.max(0, Math.min(max, value));
}

function settingsForPlan(settings: NormalizedPricingSettings, preset: PricingPlanPreset): EffectivePricingPlanSettings {
  return {
    ...settings,
    planKey: preset.key,
    planName: preset.name,
    planDescription: preset.description,
    stapleTargetCostShare: clampRate(settings.stapleTargetCostShare + preset.stapleTargetCostShareOffset, 1),
    setMealTargetCostShare: clampRate(settings.setMealTargetCostShare + preset.setMealTargetCostShareOffset, 1),
    addOnTargetCostShare: clampRate(settings.addOnTargetCostShare + preset.addOnTargetCostShareOffset, 1),
    addOnStapleRatioShare: clampRate(settings.addOnStapleRatioShare + preset.addOnStapleRatioShareOffset, 1),
    addOnPromotionRiskShare: clampRate(settings.addOnPromotionRiskShare + preset.addOnPromotionRiskShareOffset, 1),
    setMealDiscountRate: clampRate(settings.setMealDiscountRate + preset.setMealDiscountRateOffset)
  };
}

function selectedPricingPlans(settings: NormalizedPricingSettings) {
  const selected = new Set(settings.enabledPlanKeys);
  return PRICING_PLAN_PRESETS
    .filter(preset => selected.has(preset.key))
    .map(preset => settingsForPlan(settings, preset));
}

function planRuleDetailForSettings(settings: EffectivePricingPlanSettings): PricingPlanRuleDetail {
  return {
    planKey: settings.planKey,
    planName: settings.planName,
    planDescription: settings.planDescription,
    stapleTargetCostShare: settings.stapleTargetCostShare,
    setMealTargetCostShare: settings.setMealTargetCostShare,
    addOnTargetCostShare: settings.addOnTargetCostShare,
    addOnStapleRatioShare: settings.addOnStapleRatioShare,
    addOnMinimumOriginalPrice: settings.addOnMinimumOriginalPrice,
    addOnPromotionRiskShare: settings.addOnPromotionRiskShare,
    setMealDiscountRate: settings.setMealDiscountRate,
    fixedActivityCost: settings.fixedActivityCost,
    baseRedAmountMode: settings.baseRedAmountMode
  };
}

function normalizeSettings(settings: PricingEvaluationSettings, rule: PricingEvaluationRule): NormalizedPricingSettings {
  const raw = settings as PricingEvaluationSettings & { fixedCostAllocation?: number };
  const originalMin = nonNegativeAmount(raw.originalMin);
  const rawOriginalMax = raw.originalMax === '' ? '' : nonNegativeAmount(raw.originalMax, originalMin);
  return {
    productNameKeyword: String(raw.productNameKeyword || '').trim(),
    originalMin,
    originalMax: rawOriginalMax === '' ? '' : Math.max(originalMin, rawOriginalMax),
    enabledPlanKeys: normalizePricingPlanKeys(raw.enabledPlanKeys),
    stapleTargetCostShare: ratePercent(raw.stapleTargetCostShare, rule.stapleTargetCostShare, 100),
    setMealTargetCostShare: ratePercent(raw.setMealTargetCostShare, rule.setMealTargetCostShare, 100),
    addOnTargetCostShare: ratePercent(raw.addOnTargetCostShare, rule.addOnTargetCostShare, 100),
    addOnStapleRatioShare: ratePercent(raw.addOnStapleRatioShare, rule.addOnStapleRatioShare, 100),
    addOnMinimumOriginalPrice: nonNegativeAmount(raw.addOnMinimumOriginalPrice, rule.addOnMinimumOriginalPrice),
    addOnPromotionRiskShare: ratePercent(raw.addOnPromotionRiskShare, rule.addOnPromotionRiskShare, 100),
    setMealDiscountRate: ratePercent(raw.setMealDiscountRate, rule.setMealDiscountRate),
    fixedActivityCost: nonNegativeAmount(raw.fixedActivityCost ?? raw.fixedCostAllocation, rule.fixedActivityCost),
    baseRedAmountMode: normalizeBaseRedAmountMode(raw.baseRedAmountMode, rule.baseRedAmountMode)
  };
}

function classifyPricingStrategy(product: Product): PricingStrategyKind {
  const stapleCount = Math.max(0, Math.floor(Number(product.stapleServingCount) || 0));
  if (product.category === 'setMeal') return 'setMeal';
  if (isMealAddOnProduct(product) || product.category === 'addOn' || (product.category === 'snackDrink' && stapleCount <= 0)) return 'addOn';
  if (isMealMainProduct(product) || product.category === 'staple') return 'staple';
  if (stapleCount <= 0) return 'addOn';
  return 'other';
}

function targetCostShareForProduct(kind: PricingStrategyKind, rule: PricingEvaluationRule, settings: NormalizedPricingSettings) {
  if (kind === 'staple') return settings.stapleTargetCostShare;
  if (kind === 'setMeal') return settings.setMealTargetCostShare;
  if (kind === 'addOn') return settings.addOnTargetCostShare;
  return ratePercent(rule.fallbackTargetCostShare, rule.fallbackTargetCostShare, 100);
}

function pricingStrategySortRank(product: Product) {
  const kind = classifyPricingStrategy(product);
  if (kind === 'staple') return 0;
  if (kind === 'other') return 1;
  if (kind === 'addOn') return 2;
  return 3;
}

function maxSeverity(a: Severity, b: Severity): Severity {
  const rank = { none: 0, config: 1, medium: 2, high: 3, critical: 4 };
  return rank[b] > rank[a] ? b : a;
}

function redTierAmount(tier: RedTier, mode: PricingBaseRedAmountMode) {
  const min = nonNegativeAmount(tier.min);
  const max = Math.max(min, nonNegativeAmount(tier.max));
  if (mode === 'min') return roundMoney(min);
  if (mode === 'average') return roundMoney((min + max) / 2);
  return roundMoney(max);
}

function bestBaseRedForMode(rule: FeeRule, platform: Platform, basis: number, mode: PricingBaseRedAmountMode): RedTier & { amount: number } {
  const tier = (rule.redTiers[platform] || [])
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => redTierAmount(b, mode) - redTierAmount(a, mode) || b.threshold - a.threshold)[0];
  if (!tier) return { enabled: true, threshold: 0, min: 0, max: 0, amount: 0 };
  return { ...tier, amount: redTierAmount(tier, mode) };
}

function pricingExpense(rule: FeeRule, store: Store, platform: Platform, originalPrice: number, settings: NormalizedPricingSettings, baseRedAmountFloor = 0): PricingExpense {
  const matchedBaseRed = bestBaseRedForMode(rule, platform, originalPrice, settings.baseRedAmountMode);
  const baseRedFloor = roundMoney(baseRedAmountFloor);
  const baseRed = matchedBaseRed.amount + 1e-9 >= baseRedFloor
    ? matchedBaseRed
    : { enabled: true, threshold: matchedBaseRed.threshold, min: baseRedFloor, max: baseRedFloor, amount: baseRedFloor };
  const freightSubsidy = calculateFreightSubsidy(rule, store.deliveryDistance);
  const fixedActivityCost = roundMoney(settings.fixedActivityCost);
  const finalPay = Math.max(0, roundMoney(originalPrice - baseRed.amount - freightSubsidy - fixedActivityCost));
  const commission = roundMoney(Math.max(finalPay * (rule.commissionRate / 100), rule.minCommission));
  const serviceFee = calculateServiceFee(rule, store, finalPay);
  const commissionDeliveryFee = roundMoney(commission + serviceFee);
  const platformExpenseTotal = roundMoney(baseRed.amount + commission + serviceFee + freightSubsidy + fixedActivityCost);
  const netRevenue = roundMoney(finalPay - commission - serviceFee);
  return {
    baseRed,
    baseRedAmount: baseRed.amount,
    commission,
    serviceFee,
    freightSubsidy,
    fixedActivityCost,
    platformExpenseTotal,
    finalPay,
    commissionDeliveryFee,
    netRevenue,
  };
}

function addOnPricingExpense(originalPrice: number): PricingExpense {
  return {
    baseRed: { enabled: true, threshold: 0, min: 0, max: 0, amount: 0 },
    baseRedAmount: 0,
    commission: 0,
    serviceFee: 0,
    freightSubsidy: 0,
    fixedActivityCost: 0,
    platformExpenseTotal: 0,
    finalPay: roundMoney(originalPrice),
    commissionDeliveryFee: 0,
    netRevenue: roundMoney(originalPrice),
  };
}

function costShareInfoFor(expense: PricingExpense, cost: number) {
  const profit = roundMoney(expense.netRevenue - cost);
  return {
    profit,
    netTakeRate: expense.finalPay > 0 ? expense.netRevenue / expense.finalPay : null,
    costShare: expense.finalPay > 0 ? cost / expense.finalPay : null
  };
}

function firstPassingOriginalPrice(
  minimumOriginalPrice: number,
  cost: number,
  targetCostShare: number,
  evaluate: (originalPrice: number) => PricingExpense
) {
  let candidate = ceilMoneyStep(Math.max(0.01, minimumOriginalPrice), PRICE_SEARCH_STEP);
  while (candidate <= PRICE_SEARCH_MAX + 1e-9) {
    const expense = evaluate(candidate);
    const { costShare } = costShareInfoFor(expense, cost);
    if (costShare !== null && costShare <= targetCostShare + 1e-9) return { originalPrice: candidate, expense };
    candidate = roundMoney(candidate + PRICE_SEARCH_STEP);
  }
  const expense = evaluate(candidate);
  return { originalPrice: candidate, expense };
}

function applySuggestionTolerance(rawSuggestedPrice: number, currentPrice: number) {
  return Math.abs(rawSuggestedPrice - currentPrice) <= PRICE_SUGGESTION_TOLERANCE
    ? currentPrice
    : rawSuggestedPrice;
}

function isInOriginalRange(settings: NormalizedPricingSettings, originalPrice: number) {
  const max = settings.originalMax === '' ? Infinity : Math.max(settings.originalMin, Number(settings.originalMax) || 0);
  return originalPrice + 1e-9 >= settings.originalMin && originalPrice <= max + 1e-9;
}

function bundleSummaryForProduct(
  product: Product,
  productById: Map<string, Product>,
  platform: Platform,
  suggestedOriginalByProductId: Map<string, number>
): SetMealComponentSummary | null {
  const bundleItems = product.bundleItems || [];
  const choiceGroups = product.bundleChoiceGroups || [];
  if (!bundleItems.length && !choiceGroups.length) return null;
  let originalTotal = 0;
  let costTotal = 0;
  let itemCount = 0;
  let missingCount = 0;

  function bundleItemTotals(item: NonNullable<Product['bundleItems']>[number]) {
    const component = productById.get(item.productId);
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    if (!component || component.id === product.id) {
      return { original: 0, cost: 0, qty, missing: qty };
    }
    return {
      original: (suggestedOriginalByProductId.get(component.id) ?? platformOriginalUnitPrice(component, platform)) * qty,
      cost: nonNegativeAmount(component.cost) * qty,
      qty,
      missing: 0
    };
  }

  for (const item of bundleItems) {
    const totals = bundleItemTotals(item);
    if (totals.missing) {
      missingCount += totals.missing;
      continue;
    }
    originalTotal += totals.original;
    costTotal += totals.cost;
    itemCount += totals.qty;
  }

  for (const group of choiceGroups) {
    const selectionQty = Math.max(1, Math.floor(Number(group.selectionQty) || 1));
    const optionTotals = group.items
      .map(bundleItemTotals)
      .filter(totals => {
        if (totals.missing) {
          missingCount += totals.missing;
          return false;
        }
        return true;
      });
    if (!optionTotals.length) {
      missingCount += selectionQty;
      continue;
    }
    if (optionTotals.length < selectionQty) missingCount += selectionQty - optionTotals.length;
    originalTotal += optionTotals
      .slice()
      .sort((a, b) => b.original - a.original)
      .slice(0, selectionQty)
      .reduce((sum, totals) => sum + totals.original, 0);
    costTotal += optionTotals
      .slice()
      .sort((a, b) => b.cost - a.cost)
      .slice(0, selectionQty)
      .reduce((sum, totals) => sum + totals.cost, 0);
    itemCount += Math.min(selectionQty, optionTotals.length);
  }
  if (!itemCount) return null;
  return {
    originalTotal: roundMoney(originalTotal),
    costTotal: roundMoney(costTotal),
    itemCount,
    missingCount
  };
}

function buildStaplePriceCostRatio(
  products: Product[],
  platform: Platform,
  suggestedOriginalByProductId: Map<string, number>
) {
  let originalTotal = 0;
  let costTotal = 0;
  for (const product of products) {
    if (classifyPricingStrategy(product) !== 'staple') continue;
    const cost = nonNegativeAmount(product.cost);
    const originalPrice = suggestedOriginalByProductId.get(product.id) ?? platformOriginalUnitPrice(product, platform);
    if (cost <= 0 || originalPrice <= 0) continue;
    originalTotal += originalPrice;
    costTotal += cost;
  }
  return costTotal > 0 ? originalTotal / costTotal : null;
}

function promotionRiskAmountsForOriginalTotal(
  rule: FeeRule,
  store: Store,
  platform: Platform,
  originalTotal: number,
  mode: PricingBaseRedAmountMode
): PromotionRiskAmounts {
  const activity = store.activities[platform];
  const full = bestFullReduction(activity.fullReductions, originalTotal);
  const couponOption = bestCouponOption(activity.coupons, originalTotal, store.maxCoupons);
  const baseRed = bestBaseRedForMode(rule, platform, originalTotal, mode);
  const redAddOn = bestRedAddOn(activity.redAddOns, originalTotal);
  return {
    fullReductionAmount: roundMoney(full.amount),
    couponAmount: couponOption.amount,
    baseRedAmount: baseRed.amount,
    redAddOnAmount: roundMoney(redAddOn.amount)
  };
}

function promotionRiskIncrement(before: PromotionRiskAmounts, after: PromotionRiskAmounts) {
  return roundMoney(Math.max(
    0,
    after.fullReductionAmount - before.fullReductionAmount,
    after.couponAmount - before.couponAmount,
    after.baseRedAmount - before.baseRedAmount,
    after.redAddOnAmount - before.redAddOnAmount
  ));
}

function maxAddOnPromotionRiskAmount(params: {
  rule: FeeRule;
  store: Store;
  platform: Platform;
  stapleProducts: Product[];
  suggestedOriginalByProductId: Map<string, number>;
  addOnOriginalPrice: number;
  baseRedAmountMode: PricingBaseRedAmountMode;
}) {
  const { rule, store, platform, stapleProducts, suggestedOriginalByProductId, addOnOriginalPrice, baseRedAmountMode } = params;
  let riskAmount = 0;
  for (const product of stapleProducts) {
    if (classifyPricingStrategy(product) !== 'staple') continue;
    const stapleOriginalPrice = suggestedOriginalByProductId.get(product.id) ?? platformOriginalUnitPrice(product, platform);
    if (stapleOriginalPrice <= 0) continue;
    const beforePromotion = promotionRiskAmountsForOriginalTotal(rule, store, platform, stapleOriginalPrice, baseRedAmountMode);
    const afterPromotion = promotionRiskAmountsForOriginalTotal(
      rule,
      store,
      platform,
      roundMoney(stapleOriginalPrice + addOnOriginalPrice),
      baseRedAmountMode
    );
    riskAmount = Math.max(riskAmount, promotionRiskIncrement(beforePromotion, afterPromotion));
  }
  return roundMoney(Math.max(0, riskAmount));
}

function pricingBasisNameFor(floors: Array<{ name: string; value: number | null }>) {
  const values = floors.map(item => item.value ?? 0);
  const maxValue = Math.max(...values);
  return floors
    .filter(item => item.value !== null && Math.abs(item.value - maxValue) < 0.001)
    .map(item => item.name)
    .join(' / ');
}

function addOnPricingFloor(params: {
  cost: number;
  targetCostShare: number;
  staplePriceCostRatio: number | null;
  addOnStapleRatioShare: number;
  addOnMinimumOriginalPrice: number;
  addOnPromotionRiskShare: number;
  promotionRiskAmount: number;
}): AddOnPricingFloor {
  const {
    cost,
    targetCostShare,
    staplePriceCostRatio,
    addOnStapleRatioShare,
    addOnMinimumOriginalPrice,
    addOnPromotionRiskShare,
    promotionRiskAmount
  } = params;
  const costShareFloor = roundMoney(targetCostShare > 0 ? cost / targetCostShare : cost);
  const referenceOriginalPrice = staplePriceCostRatio === null ? null : roundMoney(cost * staplePriceCostRatio);
  const stapleRatioFloor = referenceOriginalPrice === null
    ? null
    : roundMoney(costShareFloor + Math.max(0, referenceOriginalPrice - costShareFloor) * addOnStapleRatioShare);
  const minimumOriginalPrice = roundMoney(addOnMinimumOriginalPrice);
  const promotionRiskFloor = roundMoney(costShareFloor + promotionRiskAmount * addOnPromotionRiskShare);
  const finalOriginalFloor = Math.max(
    costShareFloor,
    stapleRatioFloor ?? 0,
    minimumOriginalPrice,
    promotionRiskFloor
  );
  return {
    costShareFloor,
    referenceOriginalPrice,
    stapleRatioFloor,
    minimumOriginalPrice,
    promotionRiskAmount,
    promotionRiskFloor,
    finalOriginalFloor,
    pricingBasisName: pricingBasisNameFor([
      { name: '成本占比底价', value: costShareFloor },
      { name: '主食比例价', value: stapleRatioFloor },
      { name: '品类最低售价', value: minimumOriginalPrice },
      { name: '阶梯风险底价', value: promotionRiskFloor }
    ])
  };
}

function severityForCostShare(
  currentCostShare: number | null,
  targetCostShare: number,
  suggestedIncrease: number,
  configReasons: string[]
) {
  const reasons: string[] = [...configReasons];
  let severity: Severity = configReasons.length ? 'config' : 'none';
  if (currentCostShare === null) {
    severity = maxSeverity(severity, 'config');
    reasons.push('支付价无法计算成本占比');
  } else if (currentCostShare - targetCostShare > 1e-9) {
    severity = maxSeverity(severity, 'high');
    reasons.push('成本占比高于目标');
  } else if (suggestedIncrease > PRICE_SUGGESTION_TOLERANCE) {
    severity = maxSeverity(severity, 'high');
    reasons.push('当前售价低于策略建议价');
  } else if (suggestedIncrease < -PRICE_SUGGESTION_TOLERANCE) {
    reasons.push('成本占比已达标，可评估降价空间');
  }
  if (!reasons.length) reasons.push('当前成本占比符合目标');
  return { severity, reasons };
}

function rowForProduct(params: {
  store: Store;
  rule: FeeRule;
  pricingRule: PricingEvaluationRule;
  settings: EffectivePricingPlanSettings;
  platform: Platform;
  product: Product;
  staplePriceCostRatio: number | null;
  stapleProducts: Product[];
  productById: Map<string, Product>;
  suggestedOriginalByProductId: Map<string, number>;
}): PricingProductRow {
  const { store, rule, pricingRule, settings, platform, product, staplePriceCostRatio: planStaplePriceCostRatio, stapleProducts, productById, suggestedOriginalByProductId } = params;
  const kind = classifyPricingStrategy(product);
  const currentPrice = platformPrice(product, platform);
  const packageFee = platformPackageFee(product, platform);
  const currentOriginalPrice = platformOriginalUnitPrice(product, platform);
  const productCost = nonNegativeAmount(product.cost);
  const scenario = pricingScenarioForStapleCount(product.stapleServingCount);
  const targetCostShare = targetCostShareForProduct(kind, pricingRule, settings);
  let pricingCost = productCost;
  let minimumOriginalPrice = Math.max(packageFee, productCost);
  let targetOriginalFloor = minimumOriginalPrice;
  let componentOriginalTotal: number | null = null;
  let componentCostTotal: number | null = null;
  let discountAmount = 0;
  let staplePriceCostRatio: number | null = null;
  let addOnReferenceOriginalPrice: number | null = null;
  let addOnCostShareFloor: number | null = null;
  let addOnStapleRatioFloor: number | null = null;
  let addOnMinimumOriginalPrice: number | null = null;
  let addOnPromotionRiskAmount: number | null = null;
  let addOnPromotionRiskFloor: number | null = null;
  let addOnPricingFloorValue: number | null = null;
  let addOnPricingBasisName: string | null = null;
  let setMealDiscountRate: number | null = null;
  const configReasons: string[] = [];

  if (productCost <= 0) configReasons.push('商品成本未维护');

  if (kind === 'addOn') {
    staplePriceCostRatio = planStaplePriceCostRatio;
    const preliminaryAddOnFloor = addOnPricingFloor({
      cost: productCost,
      targetCostShare,
      staplePriceCostRatio,
      addOnStapleRatioShare: settings.addOnStapleRatioShare,
      addOnMinimumOriginalPrice: settings.addOnMinimumOriginalPrice,
      addOnPromotionRiskShare: settings.addOnPromotionRiskShare,
      promotionRiskAmount: 0
    });
    const promotionRiskAmount = maxAddOnPromotionRiskAmount({
      rule,
      store,
      platform,
      stapleProducts,
      suggestedOriginalByProductId,
      addOnOriginalPrice: preliminaryAddOnFloor.finalOriginalFloor,
      baseRedAmountMode: settings.baseRedAmountMode
    });
    const addOnFloor = addOnPricingFloor({
      cost: productCost,
      targetCostShare,
      staplePriceCostRatio,
      addOnStapleRatioShare: settings.addOnStapleRatioShare,
      addOnMinimumOriginalPrice: settings.addOnMinimumOriginalPrice,
      addOnPromotionRiskShare: settings.addOnPromotionRiskShare,
      promotionRiskAmount
    });
    addOnReferenceOriginalPrice = addOnFloor.referenceOriginalPrice;
    addOnCostShareFloor = addOnFloor.costShareFloor;
    addOnStapleRatioFloor = addOnFloor.stapleRatioFloor;
    addOnMinimumOriginalPrice = addOnFloor.minimumOriginalPrice;
    addOnPromotionRiskAmount = addOnFloor.promotionRiskAmount;
    addOnPromotionRiskFloor = addOnFloor.promotionRiskFloor;
    addOnPricingFloorValue = addOnFloor.finalOriginalFloor;
    addOnPricingBasisName = addOnFloor.pricingBasisName;
    if (staplePriceCostRatio === null) configReasons.push('缺少可参考的主食定价比例，已仅按成本占比计算');
    minimumOriginalPrice = Math.max(packageFee, productCost, addOnFloor.finalOriginalFloor);
    targetOriginalFloor = minimumOriginalPrice;
  } else if (kind === 'setMeal') {
    setMealDiscountRate = settings.setMealDiscountRate;
    const summary = bundleSummaryForProduct(product, productById, platform, suggestedOriginalByProductId);
    if (summary) {
      componentOriginalTotal = summary.originalTotal;
      componentCostTotal = summary.costTotal;
      pricingCost = summary.costTotal;
      discountAmount = roundMoney(summary.originalTotal * settings.setMealDiscountRate);
      targetOriginalFloor = roundMoney(summary.originalTotal - discountAmount);
      minimumOriginalPrice = Math.max(packageFee, targetOriginalFloor);
      if (summary.missingCount) configReasons.push('套餐组成存在失效商品');
    } else {
      configReasons.push('套餐未配置组成，已按套餐自身成本计算');
      targetOriginalFloor = productCost;
      minimumOriginalPrice = Math.max(packageFee, targetOriginalFloor);
    }
  }

  const expenseForKind = kind === 'addOn'
    ? addOnPricingExpense
    : (originalPrice: number) => pricingExpense(rule, store, platform, originalPrice, settings);
  const currentExpense = expenseForKind(currentOriginalPrice);
  const currentCostShareInfo = costShareInfoFor(currentExpense, pricingCost);
  const suggestedExpenseForKind = kind === 'addOn'
    ? expenseForKind
    : (originalPrice: number) => pricingExpense(rule, store, platform, originalPrice, settings, currentExpense.baseRedAmount);
  const suggestedMinimumOriginalPrice = currentExpense.baseRedAmount > 0
    ? Math.max(minimumOriginalPrice, targetOriginalFloor, currentExpense.baseRed.threshold)
    : Math.max(minimumOriginalPrice, targetOriginalFloor);
  const suggested = firstPassingOriginalPrice(
    suggestedMinimumOriginalPrice,
    pricingCost,
    targetCostShare,
    suggestedExpenseForKind
  );
  const rawSuggestedPrice = Math.max(0, roundMoney(suggested.originalPrice - packageFee));
  const suggestedPrice = applySuggestionTolerance(rawSuggestedPrice, currentPrice);
  const suggestedOriginalPrice = roundMoney(suggestedPrice + packageFee);
  const suggestedIncrease = roundMoney(suggestedPrice - currentPrice);
  const costShareSpace = currentCostShareInfo.costShare === null
    ? null
    : targetCostShare - currentCostShareInfo.costShare;
  const severity = severityForCostShare(
    currentCostShareInfo.costShare,
    targetCostShare,
    suggestedIncrease,
    configReasons
  );
  const reasons = [...severity.reasons];
  if (kind === 'addOn') {
    if (addOnPromotionRiskAmount && addOnPromotionRiskAmount > 0) {
      reasons.push(`主食加小吃最多新增优惠 ¥${addOnPromotionRiskAmount.toFixed(2)}`);
    }
    if (addOnPricingBasisName) reasons.push(`凑单取价依据：${addOnPricingBasisName}`);
  }

  return {
    key: `${settings.planKey}:${platform}:${product.id}`,
    planKey: settings.planKey,
    planName: settings.planName,
    planDescription: settings.planDescription,
    platform,
    platformName: PLATFORM_NAMES[platform],
    productId: product.id,
    productName: product.name,
    category: product.category,
    categoryName: categoryName(product.category),
    strategyKind: kind,
    strategyName: strategyName(kind),
    scenario,
    scenarioName: stapleScenarioName(scenario),
    currentPrice,
    packageFee,
    currentOriginalPrice,
    productCost,
    componentOriginalTotal,
    componentCostTotal,
    discountAmount,
    fixedActivityCost: currentExpense.fixedActivityCost,
    baseRedAmount: currentExpense.baseRedAmount,
    commission: currentExpense.commission,
    serviceFee: currentExpense.serviceFee,
    freightSubsidy: currentExpense.freightSubsidy,
    platformExpenseTotal: currentExpense.platformExpenseTotal,
    finalPay: currentExpense.finalPay,
    commissionDeliveryFee: currentExpense.commissionDeliveryFee,
    netRevenue: currentExpense.netRevenue,
    netTakeRate: currentCostShareInfo.netTakeRate,
    costShare: currentCostShareInfo.costShare,
    targetCostShare,
    costShareSpace,
    staplePriceCostRatio,
    addOnReferenceOriginalPrice,
    addOnCostShareFloor,
    addOnStapleRatioFloor,
    addOnMinimumOriginalPrice,
    addOnPromotionRiskAmount,
    addOnPromotionRiskFloor,
    addOnPricingFloor: addOnPricingFloorValue,
    addOnPricingBasisName,
    setMealDiscountRate,
    currentProfit: currentCostShareInfo.profit,
    targetOriginalPrice: suggested.originalPrice,
    suggestedPrice,
    suggestedOriginalPrice,
    suggestedIncrease,
    suggestedIncreaseRate: currentPrice > 0 ? suggestedIncrease / currentPrice : null,
    severity: severity.severity,
    reasons
  };
}

export async function runPricingEvaluationCalculation(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: PricingEvaluationSettings,
  limits?: CalculationLimits
): Promise<PricingEvaluationResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeCalculationMaxDuration(limits?.maxDurationMs);
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');

  const rule = effectiveFeeRule(state, store);
  const pricingRule = rule.pricingEvaluation;
  const normalizedSettings = normalizeSettings(settings, pricingRule);
  const pricingPlans = selectedPricingPlans(normalizedSettings);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const keyword = normalizedSettings.productNameKeyword.toLowerCase();
  const productRows: PricingProductRow[] = [];
  const productById = new Map(store.products.map(product => [product.id, product]));
  let checked = 0;
  let stoppedByDuration = false;

  platformLoop:
  for (const platform of platforms) {
    const platformReferenceProducts = store.products.filter(product => isProductListedOnPlatform(product, platform));
    const platformProducts = store.products.filter(product => {
      if (!isProductListedOnPlatform(product, platform)) return false;
      if (keyword && !product.name.toLowerCase().includes(keyword)) return false;
      if (!isInOriginalRange(normalizedSettings, platformOriginalUnitPrice(product, platform))) return false;
      return true;
    });
    const orderedProducts = platformProducts
      .slice()
      .sort((a, b) => pricingStrategySortRank(a) - pricingStrategySortRank(b));

    for (const planSettings of pricingPlans) {
      const suggestedOriginalByProductId = new Map<string, number>();
      let planStaplePriceCostRatio: number | null | undefined;
      for (const product of orderedProducts) {
        if (calculationNow() - startedAt >= maxDurationMs) {
          stoppedByDuration = true;
          break platformLoop;
        }
        if (pricingStrategySortRank(product) >= 2 && planStaplePriceCostRatio === undefined) {
          planStaplePriceCostRatio = buildStaplePriceCostRatio(platformReferenceProducts, platform, suggestedOriginalByProductId);
        }
        checked++;
        const row = rowForProduct({
          store,
          rule,
          pricingRule,
          settings: planSettings,
          platform,
          product,
          staplePriceCostRatio: planStaplePriceCostRatio ?? null,
          stapleProducts: platformReferenceProducts,
          productById,
          suggestedOriginalByProductId
        });
        productRows.push(row);
        suggestedOriginalByProductId.set(product.id, row.suggestedOriginalPrice);
      }
    }
  }

  if (keyword && !productRows.length) warnings.push(`当前门店没有匹配「${normalizedSettings.productNameKeyword}」的商品。`);
  if (stoppedByDuration) warnings.push(`已达到最长计算时间 ${Math.round(maxDurationMs / 1000)} 秒，已停止继续评估。`);

  productRows.sort((a, b) => {
    const rank = { none: 0, config: 1, medium: 2, high: 3, critical: 4 };
    return rank[b.severity] - rank[a.severity] || a.planName.localeCompare(b.planName, 'zh-CN') || a.platformName.localeCompare(b.platformName, 'zh-CN') || a.productName.localeCompare(b.productName, 'zh-CN');
  });

  return {
    planRules: pricingPlans.map(planRuleDetailForSettings),
    productRows,
    warnings,
    summary: {
      resultCount: productRows.length,
      comboCount: checked,
      validComboCount: productRows.length,
      elapsedTime: Math.round(calculationNow() - startedAt)
    }
  };
}
