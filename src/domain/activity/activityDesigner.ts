import type {
  ActivityBaseComboRow,
  ActivityComboSimulationRow,
  ActivityDesignObjective,
  ActivityDesignResult,
  ActivityDesignSettings,
  ActivityRecommendationRow,
  CalculatorState,
  CalculationLimits,
  CalculationProgress,
  ComboEvaluationRow,
  Coupon,
  FullReduction,
  Platform,
  PriceBandRow
} from '../types';
import {
  bandKey,
  bestBaseRed,
  bestCouponOption,
  bestFullReduction,
  buildPlatformTotals,
  calculationTotalRange,
  calculationNow,
  calculationStopWarning,
  createComboEvaluationRow,
  currentStoreFrom,
  isProductListedOnPlatform,
  normalizeCalculationMaxDuration,
  platformOriginalUnitPrice,
  isInCalculationTotalRange,
  PLATFORMS,
  productStapleServingCount,
  summarizePriceBands
} from '../core';
import {
  buildSeparatedComboPoolsAsync,
  candidatePoolSignature,
  mergeComboQtys
} from '../comboPools';
import { roundMoney } from '../money';

const ACTIVITY_PAY_MAX_BY_SCENARIO = {
  single: 40,
  double: 80,
  multi: 150
} as const;
const ACTIVITY_DESIGN_OBJECTIVES: ActivityDesignObjective[] = ['longTerm', 'hotProduct', 'orderGrowth'];
const ACTIVITY_COMBO_DETAIL_LIMIT = 5000;
const ACTIVITY_ROUTE_HIT_LIMIT_PER_REASON = 30;
const ACTIVITY_PAY_BAND_SAMPLE_LIMIT = 80;
const ACTIVITY_DESIGN_MIN_MAX_CHECKS = 5000000;
const ACTIVITY_MIN_NET_PAY = 2;

type ActivityCandidate = {
  index: number;
  price: number;
  stapleCount: number;
};

function averageBy<T>(rows: T[], pick: (row: T) => number | null | undefined) {
  let sum = 0;
  let count = 0;
  for (const row of rows) {
    const value = pick(row);
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    sum += value;
    count++;
  }
  return count ? sum / count : null;
}

function objectiveName(objective: ActivityDesignObjective) {
  return {
    longTerm: '长期均值回归',
    hotProduct: '短期爆品',
    orderGrowth: '短期拉单'
  }[objective];
}

function activityLossTolerance(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const targetDropRate = Math.max(0, Number(settings.couponProfitDrop) || 0) / 100;
  const config = {
    longTerm: { floorBase: 0.02, floorDropTimes: 0.5, floorCap: 0.05, maxLossShare: 0.08 },
    hotProduct: { floorBase: 0.12, floorDropTimes: 3, floorCap: 0.25, maxLossShare: 0.28 },
    orderGrowth: { floorBase: 0.08, floorDropTimes: 2, floorCap: 0.18, maxLossShare: 0.2 }
  }[objective];
  return {
    minNetProfitRate: -Math.min(config.floorCap, Math.max(config.floorBase, targetDropRate * config.floorDropTimes)),
    maxLossShare: config.maxLossShare
  };
}

function activityLossToleranceText(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const tolerance = activityLossTolerance(settings, objective);
  return `最低${roundMoney(tolerance.minNetProfitRate * 100)}%，占比不超过${roundMoney(tolerance.maxLossShare * 100)}%`;
}

function effectiveActivityPayMax(row: Pick<ComboEvaluationRow, 'scenario'>, settings: ActivityDesignSettings) {
  const scenarioMax = ACTIVITY_PAY_MAX_BY_SCENARIO[row.scenario];
  if (settings.payMax === '') return scenarioMax;
  return Math.min(scenarioMax, Math.max(0, Number(settings.payMax) || 0));
}

function markActivityPayBoundary<T extends ActivityComboSimulationRow>(row: T, settings: ActivityDesignSettings): T {
  const min = Math.max(0, Number(settings.payMin) || 0);
  const max = effectiveActivityPayMax(row, settings);
  const payOutOfRange = row.finalPay + 1e-9 < min || row.finalPay > max + 1e-9;
  const netPayTooLow = row.netPay + 1e-9 < ACTIVITY_MIN_NET_PAY;
  const ignored = payOutOfRange || netPayTooLow;
  if (!ignored) return { ...row, ignored: false, ignoreReason: '' };
  const ignoreReason = netPayTooLow
    ? `商家到手价低于最低边界 ¥${roundMoney(ACTIVITY_MIN_NET_PAY)}，已忽略`
    : `超出${row.scenarioName}支付价范围 ¥${roundMoney(min)}-¥${roundMoney(max)}，已忽略`;
  return {
    ...row,
    ignored: true,
    ignoreReason
  };
}

function isInOriginalRange(settings: ActivityDesignSettings, originalTotal: number) {
  const min = Math.max(0, Number(settings.originalMin) || 0);
  const max = settings.originalMax === '' ? Infinity : Math.max(min, Number(settings.originalMax) || 0);
  return originalTotal + 1e-9 >= min && originalTotal <= max + 1e-9;
}

function activityStapleMaxCount(settings: ActivityDesignSettings) {
  return Math.max(1, Math.floor(Number(settings.stapleMaxCount) || 2));
}

function activityAddOnMaxCount(settings: ActivityDesignSettings) {
  if (settings.addOnMaxCount === '') return Infinity;
  return Math.max(0, Math.floor(Number(settings.addOnMaxCount) || 0));
}

function nonNegativeAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function configuredRedAddOnSpace(settings: ActivityDesignSettings) {
  return nonNegativeAmount(settings.redAddOnSpace);
}

function totalRedAddOnSpace(settings: ActivityDesignSettings, routeAddOnCostSpace: unknown) {
  return roundMoney(configuredRedAddOnSpace(settings) + nonNegativeAmount(routeAddOnCostSpace));
}

function recommendationRedAddOnSpace(settings: ActivityDesignSettings, recommendation: ActivityRecommendationRow) {
  const routeAddOnCostSpace = (recommendation as { routeAddOnCostSpace?: unknown }).routeAddOnCostSpace;
  if (routeAddOnCostSpace !== undefined) return nonNegativeAmount(recommendation.addOnCostSpace);
  return totalRedAddOnSpace(settings, recommendation.addOnCostSpace);
}

function activityOriginalRange(store: ReturnType<typeof currentStoreFrom>, settings: ActivityDesignSettings) {
  const storeRange = calculationTotalRange(store);
  const filterMin = Math.max(0, Number(settings.originalMin) || 0);
  const rawFilterMax = settings.originalMax === '' ? Infinity : Math.max(filterMin, Number(settings.originalMax) || 0);
  return {
    min: Math.max(storeRange.min, filterMin),
    max: Math.min(storeRange.max, rawFilterMax)
  };
}

function activityValidationBoundaryText(store: ReturnType<typeof currentStoreFrom>, settings: ActivityDesignSettings) {
  const range = activityOriginalRange(store, settings);
  const originalMaxText = Number.isFinite(range.max) ? `¥${roundMoney(range.max)}` : '不限';
  const addOnMaxCount = activityAddOnMaxCount(settings);
  const addOnMaxText = Number.isFinite(addOnMaxCount) ? `${addOnMaxCount}件` : '不限';
  const payMin = Math.max(0, Number(settings.payMin) || 0);
  const payMaxText = settings.payMax === ''
    ? '按单人¥40、双人¥80、多人¥150'
    : `¥${roundMoney(Math.max(0, Number(settings.payMax) || 0))}`;
  return `原价¥${roundMoney(range.min)}-${originalMaxText}，饭团最多${activityStapleMaxCount(settings)}份，凑单小吃最多${addOnMaxText}，支付价最低¥${roundMoney(payMin)}，支付价最高${payMaxText}，商家到手价最低¥${roundMoney(ACTIVITY_MIN_NET_PAY)}`;
}

function activityDesignMaxChecks(store: ReturnType<typeof currentStoreFrom>) {
  const storeMaxChecks = Math.max(1, Math.floor(Number(store.maxChecks) || 0));
  return Math.max(storeMaxChecks, ACTIVITY_DESIGN_MIN_MAX_CHECKS);
}

function isActivityMainCandidate(store: ReturnType<typeof currentStoreFrom>, platform: Platform, index: number) {
  const product = store.products[index];
  if (!isProductListedOnPlatform(product, platform) || product.nonStandalone) return false;
  return product.category === 'staple' || product.category === 'setMeal' || productStapleServingCount(product) > 0;
}

function buildActivityCandidates(store: ReturnType<typeof currentStoreFrom>, platform: Platform) {
  const mainProducts: ActivityCandidate[] = [];
  const addOnProducts: ActivityCandidate[] = [];
  store.products.forEach((product, index) => {
    if (!isProductListedOnPlatform(product, platform)) return;
    const price = platformOriginalUnitPrice(product, platform);
    if (isActivityMainCandidate(store, platform, index)) {
      mainProducts.push({ index, price, stapleCount: Math.max(1, productStapleServingCount(product)) });
      return;
    }
    if (productStapleServingCount(product) <= 0) addOnProducts.push({ index, price, stapleCount: 0 });
  });
  const byPrice = (a: ActivityCandidate, b: ActivityCandidate) => a.price - b.price || a.index - b.index;
  return {
    mainProducts: mainProducts.sort(byPrice),
    addOnProducts: addOnProducts.sort(byPrice)
  };
}

async function enumerateActivityDesignCombosAsync(
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  settings: ActivityDesignSettings,
  maxDurationMs: number,
  startedAt: number,
  visit: (qtys: number[]) => void,
  onProgress?: (summary: { checked: number; validCombos: number; stopped: boolean; stoppedReason?: 'maxChecks' | 'maxDuration' }) => void
) {
  const range = activityOriginalRange(store, settings);
  const maxStapleCount = activityStapleMaxCount(settings);
  const maxAddOnSetting = activityAddOnMaxCount(settings);
  const maxAddOnLimit = Math.min(maxAddOnSetting, Math.max(0, Math.floor(Number(store.maxItems) || 0)));
  const maxItems = Math.max(1, maxStapleCount + maxAddOnLimit);
  const maxQtyPerSku = Math.max(1, Math.floor(Number(store.maxQtyPerSku) || 1));
  const maxChecks = activityDesignMaxChecks(store);
  const addOnMaxCountLimit = Math.min(Math.max(0, maxItems - 1), maxAddOnLimit);
  const { mainProducts, addOnProducts } = buildActivityCandidates(store, platform);
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: 'maxChecks' | 'maxDuration' | undefined;
  let visitedNodes = 0;
  let lastYieldAt = calculationNow();
  let lastProgressAt = calculationNow();

  function stop(reason: NonNullable<typeof stoppedReason>) {
    stopped = true;
    stoppedReason = reason;
  }

  function stopIfNeeded(now = calculationNow()) {
    if (!stopped && now - startedAt >= maxDurationMs) stop('maxDuration');
    return stopped;
  }

  async function maybeYield(force = false) {
    visitedNodes++;
    const now = calculationNow();
    if (stopIfNeeded(now)) return;
    const shouldYield = force || visitedNodes % 600 === 0 || now - lastYieldAt >= 16;
    if (!shouldYield) return;
    lastYieldAt = now;
    if (onProgress && now - lastProgressAt >= 120) {
      lastProgressAt = now;
      onProgress({ checked, validCombos, stopped, stoppedReason });
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  function recordCombo(qtys: number[], originalTotal: number) {
    if (stopped) return;
    if (originalTotal > range.max + 1e-9) return;
    checked++;
    if (checked > maxChecks) {
      stop('maxChecks');
      return;
    }
    if (originalTotal + 1e-9 < range.min) return;
    validCombos++;
    visit(qtys.slice());
  }

  const poolCacheKey = [
    'activity',
    platform,
    store.products.length,
    maxQtyPerSku,
    maxItems,
    1,
    maxStapleCount,
    addOnMaxCountLimit,
    range.max,
    candidatePoolSignature(mainProducts),
    candidatePoolSignature(addOnProducts)
  ].join('::');
  const pools = await buildSeparatedComboPoolsAsync({
    cacheKey: poolCacheKey,
    productCount: store.products.length,
    mainProducts,
    addOnProducts,
    maxQtyPerSku,
    maxItems,
    minStapleCount: 1,
    maxStapleCount,
    maxAddOnCount: addOnMaxCountLimit,
    maxOriginalTotal: range.max,
    shouldStop: () => stopped,
    maybeYield
  });

  for (const base of pools.mainCombos) {
    if (stopped) break;
    if (base.originalTotal > range.max + 1e-9) break;
    const maxAddOnCount = Math.min(Math.max(0, maxItems - base.totalQty), addOnMaxCountLimit);
    for (let addOnCount = 0; addOnCount <= maxAddOnCount; addOnCount++) {
      if (stopped) break;
      const addOnCombos = pools.addOnCombosByCount[addOnCount] || [];
      for (const addOn of addOnCombos) {
        await maybeYield();
        if (stopped) break;
        const originalTotal = base.originalTotal + addOn.originalTotal;
        if (originalTotal > range.max + 1e-9) break;
        recordCombo(mergeComboQtys(store.products.length, base, addOn), originalTotal);
      }
    }
  }

  onProgress?.({ checked, validCombos, stopped, stoppedReason });
  return { checked, validCombos, stopped, stoppedReason };
}

function createBaselineCombo(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  qtys: number[],
  settings: ActivityDesignSettings
): ActivityBaseComboRow | null {
  const totals = buildPlatformTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (!isInOriginalRange(settings, totals.originalTotal)) return null;
  if (totals.originalTotal + 1e-9 < store.startPrice) return null;

  const baseRed = bestBaseRed(state, platform, totals.originalTotal);
  const afterBaseRed = Math.max(0, roundMoney(totals.originalTotal - baseRed.amount));
  const redAddAmount = Math.min(configuredRedAddOnSpace(settings), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddAmount));
  const row = createComboEvaluationRow(
    state,
    store,
    platform,
    totals.items,
    { originalTotal: totals.originalTotal, afterProductDiscount: totals.originalTotal, costTotal: totals.costTotal, productDiscount: 0 },
    {
      full: { enabled: true, threshold: 0, amount: 0 },
      coupons: [],
      couponAmount: 0,
      baseRed,
      redAddOn: { enabled: true, threshold: 0, amount: redAddAmount }
    },
    finalPay
  );
  return {
    ...row,
    baseFinalPay: finalPay,
    baseNetPay: row.netPay,
    baseProfitRate: row.netProfitRate
  };
}

function stepped(value: number, step: number) {
  const safeStep = Math.max(0.1, Number(step) || 1);
  return roundMoney(Math.floor(Math.max(0, value) / safeStep) * safeStep);
}

function targetRateForObjective(rows: ComboEvaluationRow[], settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const configured = Math.max(0, Number(settings.targetProfitRate) || 0) / 100;
  const baseTarget = configured > 0 ? configured : averageBy(rows, row => row.targetNetRate) || 0;
  const minRate = Math.max(0, Number(settings.minProfitRate) || 0) / 100;
  const drop = Math.max(0, Number(settings.couponProfitDrop) || 0) / 100;
  if (objective === 'longTerm') return Math.max(minRate, baseTarget);
  if (objective === 'hotProduct') return Math.max(minRate, baseTarget - drop * 1.5);
  return Math.max(minRate, baseTarget - drop);
}

function discountSpaceForObjective(
  rows: ComboEvaluationRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  const targetProfitRate = targetRateForObjective(rows, settings, objective);
  const tolerance = activityLossTolerance(settings, objective);
  const targetSpaces: number[] = [];
  const floorSpaces: number[] = [];

  for (const row of rows) {
    if (row.netPay <= 0) continue;
    targetSpaces.push(row.profit - row.netPay * targetProfitRate);
    floorSpaces.push(row.profit - row.netPay * tolerance.minNetProfitRate);
  }

  const averageTargetSpace = targetSpaces.length
    ? targetSpaces.reduce((sum, value) => sum + value, 0) / targetSpaces.length
    : 0;
  const sortedFloorSpaces = floorSpaces.slice().sort((a, b) => a - b);
  const floorIndex = sortedFloorSpaces.length
    ? Math.min(sortedFloorSpaces.length - 1, Math.max(0, Math.floor(sortedFloorSpaces.length * tolerance.maxLossShare)))
    : 0;
  const lossBoundSpace = sortedFloorSpaces[floorIndex] ?? 0;
  const safeDiscountSpace = Math.max(0, Math.min(averageTargetSpace, lossBoundSpace));

  return {
    targetProfitRate,
    safeDiscountSpace: roundMoney(safeDiscountSpace),
    averageTargetSpace: roundMoney(averageTargetSpace),
    lossBoundSpace: roundMoney(lossBoundSpace),
    lossLimited: lossBoundSpace + 1e-9 < averageTargetSpace
  };
}

function recommendationForBand(
  band: PriceBandRow,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
): ActivityRecommendationRow | null {
  const discountSpace = discountSpaceForObjective(rows, settings, objective);
  const initialRedAddOnSpace = configuredRedAddOnSpace(settings);
  if (discountSpace.safeDiscountSpace <= 0.1 && initialRedAddOnSpace <= 0) return null;

  const amountStep = Math.max(0.1, Number(settings.couponDesignAmountStep) || 1);
  const maxFull = settings.couponDesignMaxFullAmount === '' ? 20 : Math.max(0, Number(settings.couponDesignMaxFullAmount) || 0);
  const maxCoupon = settings.couponDesignMaxCouponAmount === '' ? 20 : Math.max(0, Number(settings.couponDesignMaxCouponAmount) || 0);
  const safeDiscount = stepped(discountSpace.safeDiscountSpace, amountStep);
  const targetProfitRate = discountSpace.targetProfitRate;

  const split = objective === 'longTerm'
    ? { full: 0.65, coupon: 0.25, product: 0.05, addOn: 0.05, actionType: '满减为主，少量券或加码' }
    : objective === 'hotProduct'
      ? { full: 0.15, coupon: 0.2, product: 0.55, addOn: 0.1, actionType: '商品折扣为主' }
      : { full: 0.35, coupon: 0.5, product: 0.05, addOn: 0.1, actionType: '券拉单为主' };

  const fullAmount = stepped(Math.min(maxFull, safeDiscount * split.full), amountStep);
  const couponAmount = stepped(Math.min(maxCoupon, safeDiscount * split.coupon), amountStep);
  const productDiscountAmount = stepped(safeDiscount * split.product, amountStep);
  const routeAddOnCostSpace = stepped(safeDiscount * split.addOn, amountStep);
  const addOnCostSpace = totalRedAddOnSpace(settings, routeAddOnCostSpace);
  const totalDiscount = roundMoney(fullAmount + couponAmount + productDiscountAmount + addOnCostSpace);
  if (totalDiscount <= 0) return null;

  const avgBefore = averageBy(rows, row => row.netProfitRate);
  const diagnosis = discountSpace.averageTargetSpace <= 0
    ? initialRedAddOnSpace > 0
      ? '当前主要来自神券/爆红包加码参数，需校验平均利润率'
      : '该原价段平均利润率已低于目标，不建议让利'
    : discountSpace.lossLimited
      ? '已按负利润容忍边界截断让利空间，需进入活动校验'
      : band.maxProfitRate !== null && band.minProfitRate !== null && band.maxProfitRate - band.minProfitRate > 0.12
        ? '利润率离散较大，需优先查看组合明细'
        : '可用利润空间稳定，可进入活动校验';

  return {
    key: `${band.key}:${objective}:${fullAmount}:${couponAmount}:${productDiscountAmount}:${addOnCostSpace}`,
    platform: rows[0].platform,
    platformName: rows[0].platformName,
    objective,
    objectiveName: objectiveName(objective),
    originalBandKey: band.key,
    originalBandLabel: band.label,
    threshold: band.min,
    fullReductionRules: [],
    couponRules: [],
    fullAmount,
    couponAmount,
    productDiscountAmount,
    addOnCostSpace,
    routeAddOnCostSpace,
    totalDiscount,
    safeDiscountSpace: safeDiscount,
    hitCount: rows.length,
    avgProfitBefore: avgBefore,
    avgProfitAfter: null,
    minProfitAfter: null,
    profitRateSpreadAfter: null,
    avgFinalPayAfter: 0,
    targetProfitRate,
    score: 999,
    actionType: split.actionType,
    diagnosis,
    exampleItems: rows[0].items
  };
}

function normalizeFullReductionRoute(recommendations: ActivityRecommendationRow[]): FullReduction[] {
  let highestAmount = 0;
  return recommendations
    .filter(row => row.fullAmount > 0)
    .slice()
    .sort((a, b) => a.threshold - b.threshold || b.fullAmount - a.fullAmount)
    .reduce<FullReduction[]>((rules, row) => {
      const amount = roundMoney(row.fullAmount);
      if (amount <= highestAmount + 1e-9) return rules;
      highestAmount = amount;
      rules.push({ enabled: true, threshold: roundMoney(row.threshold), amount });
      return rules;
    }, []);
}

function normalizeCouponRoute(recommendations: ActivityRecommendationRow[]): Coupon[] {
  const bestByThreshold = new Map<number, Coupon>();
  recommendations.forEach(row => {
    if (row.couponAmount <= 0) return;
    const threshold = roundMoney(row.threshold);
    const amount = roundMoney(row.couponAmount);
    const current = bestByThreshold.get(threshold);
    if (!current || amount > current.amount + 1e-9) {
      bestByThreshold.set(threshold, {
        enabled: true,
        name: `建议订单券满${threshold}减${amount}`,
        threshold,
        amount
      });
    }
  });

  const sorted = Array.from(bestByThreshold.values())
    .sort((a, b) => a.threshold - b.threshold || b.amount - a.amount);
  return sorted.filter((coupon, index) => {
    return !sorted.slice(0, index).some(prev => prev.threshold <= coupon.threshold + 1e-9 && prev.amount > coupon.amount + 1e-9);
  });
}

function routeRecommendationForGroup(
  bands: PriceBandRow[],
  bandRecommendations: ActivityRecommendationRow[],
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
): ActivityRecommendationRow | null {
  if (!bands.length || !bandRecommendations.length || !rows.length) return null;
  const sortedBands = bands.slice().sort((a, b) => a.min - b.min);
  const fullReductionRules = normalizeFullReductionRoute(bandRecommendations);
  const couponRules = normalizeCouponRoute(bandRecommendations);
  let routeAddOnCostSpace = 0;
  for (const recommendation of bandRecommendations) routeAddOnCostSpace = Math.max(routeAddOnCostSpace, recommendation.routeAddOnCostSpace);
  const addOnCostSpace = totalRedAddOnSpace(settings, routeAddOnCostSpace);
  if (!fullReductionRules.length && !couponRules.length && addOnCostSpace <= 0) return null;

  const firstBand = sortedBands[0];
  const lastBand = sortedBands[sortedBands.length - 1];
  const maxFullAmount = fullReductionRules.reduce((max, row) => Math.max(max, row.amount), 0);
  const maxCouponAmount = couponRules.reduce((max, row) => Math.max(max, row.amount), 0);
  const totalDiscount = roundMoney(maxFullAmount + maxCouponAmount + addOnCostSpace);
  const targetProfitRate = targetRateForObjective(rows, settings, objective);
  const avgBefore = averageBy(rows, row => row.netProfitRate);
  let safeDiscountSpace = Infinity;
  for (const recommendation of bandRecommendations) {
    safeDiscountSpace = Math.min(safeDiscountSpace, recommendation.safeDiscountSpace);
  }
  const key = [
    'route',
    firstBand.platform,
    'combo',
    objective,
    fullReductionRules.map(row => `${row.threshold}-${row.amount}`).join('|') || 'no-full',
    couponRules.map(row => `${row.threshold}-${row.amount}`).join('|') || 'no-coupon',
    addOnCostSpace
  ].join('::');
  const actionType = fullReductionRules.length && couponRules.length
    ? '满减阶梯+订单券'
    : fullReductionRules.length
      ? '满减阶梯'
      : couponRules.length
        ? '订单券'
        : '加码空间';

  return {
    key,
    platform: firstBand.platform as Platform,
    platformName: firstBand.platformName,
    objective,
    objectiveName: objectiveName(objective),
    originalBandKey: key,
    originalBandLabel: `${roundMoney(firstBand.min)}-${roundMoney(lastBand.max)}`,
    threshold: firstBand.min,
    fullReductionRules,
    couponRules,
    fullAmount: maxFullAmount,
    couponAmount: maxCouponAmount,
    productDiscountAmount: 0,
    addOnCostSpace,
    routeAddOnCostSpace,
    totalDiscount,
    safeDiscountSpace: Number.isFinite(safeDiscountSpace) ? safeDiscountSpace : 0,
    hitCount: rows.length,
    avgProfitBefore: avgBefore,
    avgProfitAfter: null,
    minProfitAfter: null,
    profitRateSpreadAfter: null,
    avgFinalPayAfter: 0,
    targetProfitRate,
    score: 999,
    actionType,
    diagnosis: '已按原价区间生成可命中的满减阶梯和订单券列表，待支付价校验',
    exampleItems: rows[0].items
  };
}

function normalizeScaledFullRules(rules: FullReduction[], scale: number, amountStep: number) {
  let highestAmount = 0;
  return rules
    .map(rule => ({
      ...rule,
      amount: stepped(rule.amount * scale, amountStep)
    }))
    .filter(rule => rule.enabled && rule.amount > 0)
    .sort((a, b) => a.threshold - b.threshold || b.amount - a.amount)
    .reduce<FullReduction[]>((normalized, rule) => {
      if (rule.amount <= highestAmount + 1e-9) return normalized;
      highestAmount = rule.amount;
      normalized.push({ enabled: true, threshold: roundMoney(rule.threshold), amount: roundMoney(rule.amount) });
      return normalized;
    }, []);
}

function normalizeScaledCouponRules(rules: Coupon[], scale: number, amountStep: number) {
  const bestByThreshold = new Map<number, Coupon>();
  rules.forEach(rule => {
    const threshold = roundMoney(rule.threshold);
    const amount = stepped(rule.amount * scale, amountStep);
    if (amount <= 0) return;
    const current = bestByThreshold.get(threshold);
    if (!current || amount > current.amount + 1e-9) {
      bestByThreshold.set(threshold, {
        ...rule,
        enabled: true,
        threshold,
        amount
      });
    }
  });
  const sorted = Array.from(bestByThreshold.values())
    .sort((a, b) => a.threshold - b.threshold || b.amount - a.amount);
  return sorted.filter((coupon, index) => {
    return !sorted.slice(0, index).some(prev => prev.threshold <= coupon.threshold + 1e-9 && prev.amount > coupon.amount + 1e-9);
  });
}

function routeVariantsForRecommendation(row: ActivityRecommendationRow, settings: ActivityDesignSettings) {
  const amountStep = Math.max(0.1, Number(settings.couponDesignAmountStep) || 1);
  const hasScalableDiscount = row.fullReductionRules.length > 0 || row.couponRules.length > 0 || row.routeAddOnCostSpace > 0;
  const variants = hasScalableDiscount
    ? [
      { key: 'conservative', label: '保守路线', scale: 0.8 },
      { key: 'standard', label: '标准路线', scale: 1 },
      { key: 'aggressive', label: '积极路线', scale: 1.2 }
    ]
    : [{ key: 'initial', label: '初始路线', scale: 1 }];
  return variants
    .map(variant => {
      const fullReductionRules = normalizeScaledFullRules(row.fullReductionRules, variant.scale, amountStep);
      const couponRules = normalizeScaledCouponRules(row.couponRules, variant.scale, amountStep);
      const routeAddOnCostSpace = stepped(row.routeAddOnCostSpace * variant.scale, amountStep);
      const addOnCostSpace = totalRedAddOnSpace(settings, routeAddOnCostSpace);
      const maxFullAmount = fullReductionRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
      const maxCouponAmount = couponRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
      const totalDiscount = roundMoney(maxFullAmount + maxCouponAmount + addOnCostSpace);
      if (!fullReductionRules.length && !couponRules.length && addOnCostSpace <= 0) return null;
      return {
        ...row,
        key: [
          row.key,
          variant.key,
          fullReductionRules.map(rule => `${rule.threshold}-${rule.amount}`).join('|') || 'no-full',
          couponRules.map(rule => `${rule.threshold}-${rule.amount}`).join('|') || 'no-coupon',
          addOnCostSpace
        ].join('::'),
        fullReductionRules,
        couponRules,
        fullAmount: maxFullAmount,
        couponAmount: maxCouponAmount,
        addOnCostSpace,
        routeAddOnCostSpace,
        totalDiscount,
        safeDiscountSpace: roundMoney(row.safeDiscountSpace * variant.scale),
        actionType: `${variant.label} / ${row.actionType}`,
        diagnosis: `${variant.label}，待选择后进行支付价校验`,
        score: roundMoney(row.score + Math.abs(variant.scale - 1) * 10)
      };
    })
    .filter((variant): variant is ActivityRecommendationRow => variant !== null);
}

function simulateRecommendation(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  row: ActivityBaseComboRow,
  recommendation: ActivityRecommendationRow,
  settings: ActivityDesignSettings
): ActivityComboSimulationRow {
  const productDiscountAmount = Math.min(row.originalTotal, Math.max(0, recommendation.productDiscountAmount));
  const afterProductDiscount = Math.max(0, roundMoney(row.originalTotal - productDiscountAmount));
  const full = bestFullReduction(recommendation.fullReductionRules, afterProductDiscount);
  const afterFull = Math.max(0, roundMoney(afterProductDiscount - full.amount));
  const couponOption = bestCouponOption(recommendation.couponRules, afterFull, 1);
  const afterCoupon = Math.max(0, roundMoney(afterFull - couponOption.amount));
  const baseRed = bestBaseRed(state, row.platform, afterCoupon);
  const afterBaseRed = Math.max(0, roundMoney(afterCoupon - baseRed.amount));
  const redAddAmount = Math.min(afterBaseRed, recommendationRedAddOnSpace(settings, recommendation));
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddAmount));
  const simulated = createComboEvaluationRow(
    state,
    store,
    row.platform,
    row.items,
    {
      originalTotal: row.originalTotal,
      afterProductDiscount,
      costTotal: row.cost,
      productDiscount: productDiscountAmount
    },
    {
      full,
      coupons: couponOption.coupons,
      couponAmount: couponOption.amount,
      baseRed,
      redAddOn: { enabled: true, threshold: recommendation.threshold, amount: redAddAmount }
    },
    finalPay
  );
  return {
    ...simulated,
    key: `${recommendation.key}:${row.key}`,
    recommendationKey: recommendation.key,
    recommendationLabel: `${recommendation.objectiveName} / ${recommendation.originalBandLabel}`
  };
}

function appendActivityDetailRow(
  rowsByKey: Map<string, ActivityComboSimulationRow>,
  row: ActivityComboSimulationRow,
  reason: string
) {
  const current = rowsByKey.get(row.key);
  if (!current) {
    rowsByKey.set(row.key, { ...row, detailReasons: reason ? [reason] : [] });
    return;
  }
  if (!reason || current.detailReasons?.includes(reason)) return;
  rowsByKey.set(row.key, {
    ...current,
    detailReasons: [...(current.detailReasons || []), reason]
  });
}

function activityPayBandKey(row: ActivityComboSimulationRow, payBandSize: number) {
  const band = bandKey(row.finalPay, payBandSize);
  return ['pay', row.platform, band.key].join('::');
}

function sortActivityRows(a: ActivityComboSimulationRow, b: ActivityComboSimulationRow) {
  return a.platform.localeCompare(b.platform)
    || a.recommendationLabel.localeCompare(b.recommendationLabel, 'zh-CN')
    || a.originalTotal - b.originalTotal
    || a.finalPay - b.finalPay
    || a.key.localeCompare(b.key);
}

function rowWithExtremes(rows: ActivityComboSimulationRow[]) {
  let minProfitSpaceRow: ActivityComboSimulationRow | null = null;
  let maxProfitRow: ActivityComboSimulationRow | null = null;
  for (const row of rows) {
    if (!minProfitSpaceRow || row.profitSpace < minProfitSpaceRow.profitSpace) minProfitSpaceRow = row;
    if (!maxProfitRow || row.profit > maxProfitRow.profit) maxProfitRow = row;
  }
  return { minProfitSpaceRow, maxProfitRow };
}

function addLimitedRows(
  rowsByKey: Map<string, ActivityComboSimulationRow>,
  rows: ActivityComboSimulationRow[],
  reason: string,
  limit = ACTIVITY_ROUTE_HIT_LIMIT_PER_REASON
) {
  rows
    .slice()
    .sort((a, b) => a.originalTotal - b.originalTotal || a.finalPay - b.finalPay || a.profitSpace - b.profitSpace)
    .slice(0, limit)
    .forEach(row => appendActivityDetailRow(rowsByKey, row, reason));
}

function selectActivityHitRows(
  rowsByRecommendation: Map<string, ActivityComboSimulationRow[]>,
  recommendations: ActivityRecommendationRow[]
) {
  const rowsByKey = new Map<string, ActivityComboSimulationRow>();
  for (const recommendation of recommendations) {
    const rows = rowsByRecommendation.get(recommendation.key) || [];
    if (!rows.length) continue;

    const maxFullAmount = recommendation.fullReductionRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
    if (maxFullAmount > 0) {
      const minFullThreshold = recommendation.fullReductionRules
        .filter(rule => Math.abs(rule.amount - maxFullAmount) < 1e-9)
        .reduce((min, rule) => Math.min(min, rule.threshold), Infinity);
      if (Number.isFinite(minFullThreshold)) {
        addLimitedRows(
          rowsByKey,
          rows.filter(row => Math.abs(row.full.amount - maxFullAmount) < 1e-9 && Math.abs(row.full.threshold - minFullThreshold) < 1e-9),
          `满减最大优惠最小阶梯：满${roundMoney(minFullThreshold)}减${roundMoney(maxFullAmount)}`
        );
      }
    }

    const maxCouponAmount = recommendation.couponRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
    if (maxCouponAmount > 0) {
      const minCouponThreshold = recommendation.couponRules
        .filter(rule => Math.abs(rule.amount - maxCouponAmount) < 1e-9)
        .reduce((min, rule) => Math.min(min, rule.threshold), Infinity);
      if (Number.isFinite(minCouponThreshold)) {
        addLimitedRows(
          rowsByKey,
          rows.filter(row => row.coupons.some(coupon => Math.abs(coupon.amount - maxCouponAmount) < 1e-9 && Math.abs(coupon.threshold - minCouponThreshold) < 1e-9)),
          `优惠券最大优惠最小阶梯：满${roundMoney(minCouponThreshold)}减${roundMoney(maxCouponAmount)}`
        );
      }
    }

    const { minProfitSpaceRow, maxProfitRow } = rowWithExtremes(rows);
    if (minProfitSpaceRow) appendActivityDetailRow(rowsByKey, minProfitSpaceRow, `最低利润空间：¥${roundMoney(minProfitSpaceRow.profitSpace)}`);
    if (maxProfitRow) appendActivityDetailRow(rowsByKey, maxProfitRow, `最高利润：¥${roundMoney(maxProfitRow.profit)}`);
  }
  return Array.from(rowsByKey.values()).sort(sortActivityRows);
}

function selectActivityPayBandRows(activeRows: ActivityComboSimulationRow[], payBandSize: number) {
  if (activeRows.length <= ACTIVITY_COMBO_DETAIL_LIMIT) {
    return activeRows.slice().sort(sortActivityRows);
  }

  const rowsByKey = new Map<string, ActivityComboSimulationRow>();
  const rowsByBand = new Map<string, ActivityComboSimulationRow[]>();
  for (const row of activeRows) {
    const key = activityPayBandKey(row, payBandSize);
    const current = rowsByBand.get(key) || [];
    current.push(row);
    rowsByBand.set(key, current);
  }

  const sortedBands = Array.from(rowsByBand.entries())
    .sort(([a], [b]) => a.localeCompare(b));
  for (const [, rows] of sortedBands) {
    const sortedRows = rows.slice().sort(sortActivityRows);
    if (sortedRows[0] && rowsByKey.size < ACTIVITY_COMBO_DETAIL_LIMIT) appendActivityDetailRow(rowsByKey, sortedRows[0], '支付价区间样本');
  }

  for (const [, rows] of sortedBands) {
    const sortedRows = rows.slice().sort(sortActivityRows);
    for (const row of sortedRows.slice(1, ACTIVITY_PAY_BAND_SAMPLE_LIMIT)) {
      if (rowsByKey.size >= ACTIVITY_COMBO_DETAIL_LIMIT) break;
      appendActivityDetailRow(rowsByKey, row, '支付价区间样本');
    }
    if (rowsByKey.size >= ACTIVITY_COMBO_DETAIL_LIMIT) break;
  }

  for (const [, rows] of sortedBands) {
    const { minProfitSpaceRow, maxProfitRow } = rowWithExtremes(rows);
    if (minProfitSpaceRow && rowsByKey.size < ACTIVITY_COMBO_DETAIL_LIMIT) {
      appendActivityDetailRow(rowsByKey, minProfitSpaceRow, `区间最低利润空间：¥${roundMoney(minProfitSpaceRow.profitSpace)}`);
    }
    if (maxProfitRow && rowsByKey.size < ACTIVITY_COMBO_DETAIL_LIMIT) {
      appendActivityDetailRow(rowsByKey, maxProfitRow, `区间最高利润：¥${roundMoney(maxProfitRow.profit)}`);
    }
  }

  return Array.from(rowsByKey.values()).sort(sortActivityRows);
}

function finalizeRecommendations(
  recommendations: ActivityRecommendationRow[],
  simulatedRows: ActivityComboSimulationRow[],
  settings: ActivityDesignSettings
) {
  const rowsByRecommendation = new Map<string, ActivityComboSimulationRow[]>();
  for (const row of simulatedRows) {
    const rows = rowsByRecommendation.get(row.recommendationKey) || [];
    rows.push(row);
    rowsByRecommendation.set(row.recommendationKey, rows);
  }
  return recommendations.map(row => {
    const rows = rowsByRecommendation.get(row.key) || [];
    const tolerance = activityLossTolerance(settings, row.objective);
    let profitRateSum = 0;
    let profitRateCount = 0;
    let finalPaySum = 0;
    let lossCount = 0;
    let lossOutOfToleranceCount = 0;
    let minProfitAfter: number | null = null;
    let maxProfitAfter: number | null = null;
    for (const item of rows) {
      finalPaySum += item.finalPay;
      const netProfitRate = item.netProfitRate;
      if (item.profit < -1e-9 || (netProfitRate !== null && netProfitRate < -1e-9)) {
        lossCount++;
      }
      if (netProfitRate === null || netProfitRate < tolerance.minNetProfitRate - 1e-9) {
        lossOutOfToleranceCount++;
      }
      if (item.netProfitRate !== null) {
        profitRateSum += item.netProfitRate;
        profitRateCount++;
        minProfitAfter = minProfitAfter === null ? item.netProfitRate : Math.min(minProfitAfter, item.netProfitRate);
        maxProfitAfter = maxProfitAfter === null ? item.netProfitRate : Math.max(maxProfitAfter, item.netProfitRate);
      }
    }
    const avgProfitAfter = profitRateCount ? profitRateSum / profitRateCount : null;
    const spread = maxProfitAfter !== null && minProfitAfter !== null ? roundMoney(maxProfitAfter - minProfitAfter) : null;
    const targetGap = avgProfitAfter === null ? 1 : row.targetProfitRate - avgProfitAfter;
    const targetPenalty = targetGap > 0 ? targetGap * 180 : Math.abs(targetGap) * 45;
    const lossShare = rows.length ? lossCount / rows.length : 0;
    const lossShareOverflow = Math.max(0, lossShare - tolerance.maxLossShare);
    const lossPenalty = lossOutOfToleranceCount * 12 + lossShareOverflow * 80;
    const score = roundMoney(targetPenalty + (spread || 0) * 20 + lossPenalty + row.totalDiscount * 0.05);
    const toleranceText = activityLossToleranceText(settings, row.objective);
    const diagnosis = avgProfitAfter !== null && avgProfitAfter + 1e-9 < row.targetProfitRate
      ? '活动后平均利润率低于目标，需降低优惠或提高支付价'
      : lossOutOfToleranceCount > 0 || lossShareOverflow > 1e-9
        ? `存在超出${objectiveName(row.objective)}容忍范围的负利润组合（${toleranceText}），需降低优惠`
        : lossCount > 0
          ? `允许少量负利润组合（${toleranceText}），当前平均利润率已达到${objectiveName(row.objective)}目标`
          : row.diagnosis;
    return {
      ...row,
      hitCount: rows.length,
      avgProfitAfter,
      minProfitAfter,
      profitRateSpreadAfter: spread,
      avgFinalPayAfter: rows.length ? finalPaySum / rows.length : 0,
      score,
      diagnosis
    };
  }).sort((a, b) => a.score - b.score || b.hitCount - a.hitCount);
}

function limitedRecommendationsWithSelected(
  recommendations: ActivityRecommendationRow[],
  selectedKey: string,
  limit = 30
) {
  const limited = recommendations.slice(0, limit);
  if (!selectedKey || limited.some(row => row.key === selectedKey)) return limited;
  const selected = recommendations.find(row => row.key === selectedKey);
  if (!selected) return limited;
  return [selected, ...limited.slice(0, Math.max(0, limit - 1))];
}

function recommendationSnapshotFromSettings(settings: ActivityDesignSettings, selectedKey: string) {
  const snapshot = settings.selectedRecommendationSnapshot;
  if (!snapshot || snapshot.key !== selectedKey) return null;
  return snapshot;
}

function validateSelectedActivityRoute(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  settings: ActivityDesignSettings,
  selectedRecommendation: ActivityRecommendationRow,
  baseRows: ActivityBaseComboRow[],
  warnings: string[]
) {
  const payBandSize = Math.max(1, Number(settings.payBandSize) || 5);
  const boundarySimulations: ActivityComboSimulationRow[] = [];
  const activeBoundarySimulations: ActivityComboSimulationRow[] = [];
  const selectedRouteRows = baseRows.filter(row => row.platform === selectedRecommendation.platform);
  for (const row of selectedRouteRows) {
    const simulation = markActivityPayBoundary(simulateRecommendation(state, store, row, selectedRecommendation, settings), settings);
    boundarySimulations.push(simulation);
    if (!simulation.ignored) {
      activeBoundarySimulations.push(simulation);
    }
  }

  const finalizedSelectedRecommendation = finalizeRecommendations([selectedRecommendation], activeBoundarySimulations, settings)[0] || selectedRecommendation;
  if (!selectedRouteRows.length) {
    warnings.push(`当前活动设计参数下没有可校验组合（${activityValidationBoundaryText(store, settings)}）。`);
  }

  const activeSimulations: ActivityComboSimulationRow[] = [];
  const routeRowsByRecommendation = new Map<string, ActivityComboSimulationRow[]>();
  for (const row of boundarySimulations) {
    const routeRows = routeRowsByRecommendation.get(row.recommendationKey) || [];
    routeRows.push(row);
    routeRowsByRecommendation.set(row.recommendationKey, routeRows);
    if (!row.ignored) activeSimulations.push(row);
  }

  const payBands = summarizePriceBands(activeSimulations, payBandSize, 'pay', { groupByScenario: false });
  const hitRows = selectActivityHitRows(routeRowsByRecommendation, [finalizedSelectedRecommendation]);
  const comboRows = selectActivityPayBandRows(activeSimulations, payBandSize);
  if (!activeSimulations.length && boundarySimulations.length) {
    warnings.push(`所选活动路线在当前活动设计支付价边界内没有命中组合（${activityValidationBoundaryText(store, settings)}），请调整支付价范围或活动力度。`);
  }
  const lowNetPayIgnoredCount = boundarySimulations.filter(row => row.ignored && row.netPay + 1e-9 < ACTIVITY_MIN_NET_PAY).length;
  if (lowNetPayIgnoredCount > 0) {
    warnings.push(`所选活动路线有 ${lowNetPayIgnoredCount} 个组合商家到手价低于 ¥${roundMoney(ACTIVITY_MIN_NET_PAY)}，已从支付价校验均值中排除。`);
  }
  if (hitRows.length > ACTIVITY_COMBO_DETAIL_LIMIT) {
    warnings.push(`关键命中组合共 ${hitRows.length} 条，页面仅展示前 ${ACTIVITY_COMBO_DETAIL_LIMIT} 条。`);
  }
  if (activeSimulations.length > comboRows.length) {
    warnings.push(`活动后支付价校验明细共 ${activeSimulations.length} 条，页面按支付价区间展示 ${comboRows.length} 条代表组合；区间统计仍基于全量命中组合计算。`);
  }

  return {
    finalizedSelectedRecommendation,
    payBands,
    hitRows: hitRows.slice(0, ACTIVITY_COMBO_DETAIL_LIMIT),
    comboRows
  };
}

export async function runActivityDesignCalculation(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: ActivityDesignSettings,
  onProgress?: (progress: CalculationProgress) => void,
  limits?: CalculationLimits
): Promise<ActivityDesignResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeCalculationMaxDuration(limits?.maxDurationMs);
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  const selectedRecommendationKey = String(settings.selectedRecommendationKey || '');
  const selectedRecommendationSnapshot = selectedRecommendationKey
    ? recommendationSnapshotFromSettings(settings, selectedRecommendationKey)
    : null;
  const platforms = selectedRecommendationSnapshot
    ? [selectedRecommendationSnapshot.platform]
    : platformFilter === 'all'
      ? PLATFORMS
      : [platformFilter];

  const baseRows: ActivityBaseComboRow[] = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: 'maxChecks' | 'maxDuration' | undefined;

  for (const platform of platforms) {
    const elapsed = calculationNow() - startedAt;
    if (elapsed >= maxDurationMs) {
      stopped = true;
      stoppedReason = 'maxDuration';
      break;
    }
    const checkedBefore = checked;
    const validBefore = validCombos;
    const enumeration = await enumerateActivityDesignCombosAsync(
      store,
      platform,
      settings,
      maxDurationMs - elapsed,
      startedAt,
      qtys => {
        const row = createBaselineCombo(state, store, platform, qtys, settings);
        if (row) baseRows.push(row);
      },
      progress => onProgress?.({
        resultCount: baseRows.length,
        comboCount: checkedBefore + progress.checked,
        validComboCount: validBefore + progress.validCombos
      })
    );
    checked += enumeration.checked;
    validCombos += enumeration.validCombos;
    stopped = stopped || enumeration.stopped;
    stoppedReason = stoppedReason || enumeration.stoppedReason;
    if (stoppedReason === 'maxDuration') break;
  }

  const stopWarning = calculationStopWarning({ stopped, stoppedReason }, activityDesignMaxChecks(store), maxDurationMs);
  if (stopWarning) warnings.push(stopWarning);

  const originalBandSize = Math.max(1, Number(settings.originalBandSize) || 5);
  const originalBands = summarizePriceBands(baseRows, originalBandSize, 'original');

  if (selectedRecommendationSnapshot) {
    const validation = validateSelectedActivityRoute(state, store, settings, selectedRecommendationSnapshot, baseRows, warnings);
    return {
      originalBands,
      recommendations: [validation.finalizedSelectedRecommendation],
      payBands: validation.payBands,
      hitRows: validation.hitRows,
      comboRows: validation.comboRows,
      warnings,
      summary: {
        resultCount: 1,
        comboCount: checked,
        validComboCount: validCombos,
        elapsedTime: Math.round(calculationNow() - startedAt)
      }
    };
  }

  const rowsByBand = new Map<string, ActivityBaseComboRow[]>();
  baseRows.forEach(row => {
    const band = bandKey(row.originalTotal, originalBandSize);
    const key = ['original', row.platform, row.scenario, band.key].join('::');
    const rows = rowsByBand.get(key) || [];
    rows.push(row);
    rowsByBand.set(key, rows);
  });

  const bandRecommendations = originalBands
    .flatMap(band => {
      const rows = rowsByBand.get(band.key) || [];
      if (!rows.length) return [];
      return ACTIVITY_DESIGN_OBJECTIVES
        .map(objective => recommendationForBand(band, rows, settings, objective))
        .filter((row): row is ActivityRecommendationRow => row !== null);
    })
    .filter((row): row is ActivityRecommendationRow => row !== null);

  const bandsByRoute = new Map<string, PriceBandRow[]>();
  originalBands.forEach(band => {
    const key = String(band.platform);
    const rows = bandsByRoute.get(key) || [];
    rows.push(band);
    bandsByRoute.set(key, rows);
  });
  const bandRecommendationsByRoute = new Map<string, ActivityRecommendationRow[]>();
  bandRecommendations.forEach(recommendation => {
    const key = [recommendation.platform, recommendation.objective].join('::');
    const rows = bandRecommendationsByRoute.get(key) || [];
    rows.push(recommendation);
    bandRecommendationsByRoute.set(key, rows);
  });

  const recommendations: ActivityRecommendationRow[] = [];
  for (const [routeKey, bands] of bandsByRoute.entries()) {
    const routeRows: ActivityBaseComboRow[] = [];
    for (const band of bands) {
      const rows = rowsByBand.get(band.key) || [];
      for (const row of rows) routeRows.push(row);
    }
    for (const objective of ACTIVITY_DESIGN_OBJECTIVES) {
      const routeBandRecommendations = bandRecommendationsByRoute.get([routeKey, objective].join('::')) || [];
      const recommendation = routeRecommendationForGroup(bands, routeBandRecommendations, routeRows, settings, objective);
      if (!recommendation) continue;
      for (const variant of routeVariantsForRecommendation(recommendation, settings)) {
        recommendations.push(variant);
      }
    }
  }

  if (!selectedRecommendationKey) {
    return {
      originalBands,
      recommendations: recommendations.slice(0, 30),
      payBands: [],
      hitRows: [],
      comboRows: [],
      warnings,
      summary: {
        resultCount: recommendations.length,
        comboCount: checked,
        validComboCount: validCombos,
        elapsedTime: Math.round(calculationNow() - startedAt)
      }
    };
  }

  const selectedRecommendation = recommendations.find(row => row.key === selectedRecommendationKey);
  if (!selectedRecommendation) {
    warnings.push('当前选择的活动路线已失效，请重新选择路线后再校验。');
    return {
      originalBands,
      recommendations: recommendations.slice(0, 30),
      payBands: [],
      hitRows: [],
      comboRows: [],
      warnings,
      summary: {
        resultCount: recommendations.length,
        comboCount: checked,
        validComboCount: validCombos,
        elapsedTime: Math.round(calculationNow() - startedAt)
      }
    };
  }

  const validation = validateSelectedActivityRoute(state, store, settings, selectedRecommendation, baseRows, warnings);
  const finalizedSelectedRecommendation = validation.finalizedSelectedRecommendation;
  const recommendationSource = recommendations.some(row => row.key === finalizedSelectedRecommendation.key)
    ? recommendations
    : [finalizedSelectedRecommendation, ...recommendations];
  const finalizedRecommendations = recommendationSource
    .map(row => row.key === finalizedSelectedRecommendation.key ? finalizedSelectedRecommendation : row)
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.score - b.score || b.hitCount - a.hitCount);

  return {
    originalBands,
    recommendations: limitedRecommendationsWithSelected(finalizedRecommendations, finalizedSelectedRecommendation.key),
    payBands: validation.payBands,
    hitRows: validation.hitRows,
    comboRows: validation.comboRows,
    warnings,
    summary: {
      resultCount: finalizedRecommendations.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(calculationNow() - startedAt)
    }
  };
}
