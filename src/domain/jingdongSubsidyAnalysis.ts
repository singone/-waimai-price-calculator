import type {
  CalculatorState,
  CalculationLimits,
  CalculationProgress,
  ComboItem,
  Coupon,
  FullReduction,
  ActivityBaseComboRow,
  ActivityPriceBucketRow,
  ActivityScanComboPools,
  JingdongSubsidyCoupon,
  Severity,
  Store
} from './types';
import {
  bestCouponOption,
  bestFullReduction,
  buildPlatformTotals,
  calculateFreightSubsidy,
  calculateServiceFee,
  calculationTotalRange,
  calculationNow,
  calculationStopWarning,
  comboStapleServingCount,
  currentStoreFrom,
  effectiveFeeRule,
  isInCalculationTotalRange,
  isInStapleCountRange,
  isMealAddOnProduct,
  isMealMainProduct,
  isProductListedOnPlatform,
  mealMainStapleServingCount,
  platformOriginalUnitPrice,
  pricingStrategyTargetForPay
} from './core';
import {
  buildSeparatedComboPoolsAsync,
  candidatePoolSignature,
  mergeComboQtys,
  type ComboPoolCandidate,
  type ComboPoolRow,
  type SeparatedComboPools
} from './comboPools';
import { profitRateByBasis, roundMoney } from './money';
import { PlatformUtils } from './platform';

const JINGDONG_PLATFORM = PlatformUtils.JINGDONG;
const PRICE_STEP = 0.5;
const PRICE_COARSE_STEP = 5;
const MAX_PRICE_INCREASE_SCAN = 200;
const DEFAULT_COUPON_TEST_NEAR_BEFORE = 5;
const DEFAULT_COUPON_TEST_NEAR_AFTER = 10;
const DEFAULT_COUPON_TEST_ROW_LIMIT = 200;
const DEFAULT_ANALYSIS_ROW_LIMIT = 5000;
const DEFAULT_COMBO_CONTEXT_CACHE_LIMIT = 50000;
const COMBO_CONTEXT_CACHE_SIZE = 3;

function normalizeJingdongMaxDuration(value?: number) {
  // 京东扫描默认只按门店最多检查组合数截断；显式传入正数时才启用时间保护。
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return Infinity;
  return Math.max(1000, Math.floor(duration));
}

function isJingdongDurationExceeded(startedAt: number, maxDurationMs: number, now = calculationNow()) {
  return Number.isFinite(maxDurationMs) && now - startedAt >= maxDurationMs;
}

function normalizedStoreMaxChecks(store: Store) {
  return Math.max(1, Math.floor(Number(store.maxChecks) || 0));
}

export type JingdongCouponSelection = {
  key: string;
  name: string;
  coupons: JingdongSubsidyCoupon[];
  largeCoupon: JingdongSubsidyCoupon | null;
  smallCoupon: JingdongSubsidyCoupon | null;
  amount: number;
  merchantAmount: number;
  merchantExtraAmount: number;
  platformAmount: number;
  isUserBest: boolean;
};

export type JingdongCouponScanMode = 'settlement' | 'pressure';

export type JingdongSubsidyAnalysisLimits = CalculationLimits & {
  couponScanMode?: JingdongCouponScanMode;
  scanComboPools?: ActivityScanComboPools | null;
  originalPriceBuckets?: ActivityPriceBucketRow[] | null;
};

export type JingdongPriceSuggestion = {
  targetCouponBasis: number;
  amount: number;
  finalPay?: number;
  netPay?: number;
  profit?: number;
  text: string;
};

type JingdongFinancials = {
  couponBasis: number;
  finalPay: number;
  merchantSettlement: number;
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
  netPay: number;
  profit: number;
  profitRate: number | null;
  netProfitRate: number | null;
  targetPayRate: number;
  targetNetRate: number;
  profitSpace: number;
};

type JingdongComboContext = {
  qtys: number[];
  items: ComboItem[];
  comboText: string;
  originalTotal: number;
  afterProductDiscount: number;
  productDiscount: number;
  full: FullReduction;
  storeCouponOption: { coupons: Coupon[]; amount: number };
  afterStoreDiscount: number;
  stapleCount: number;
  costTotal: number;
};

type JingdongComboContextCacheEntry = {
  key: string;
  contexts: JingdongComboContext[];
  checked: number;
  validCombos: number;
  complete: boolean;
};

export type JingdongSubsidyAnalysisRow = JingdongFinancials & {
  key: string;
  items: ComboItem[];
  comboText: string;
  scenarioName: string;
  originalTotal: number;
  afterProductDiscount: number;
  productDiscount: number;
  full: FullReduction;
  storeCoupons: Coupon[];
  storeCouponAmount: number;
  afterStoreDiscount: number;
  subsidySelection: JingdongCouponSelection;
  merchantActivityAmount: number;
  userDiscountAmount: number;
  cost: number;
  severity: Severity;
  riskType: 'loss' | 'lowProfit' | 'safe';
  reasons: string[];
  avoidSuggestion: JingdongPriceSuggestion | null;
  increaseSuggestion: JingdongPriceSuggestion | null;
};

export type JingdongSubsidyBucketRiskRow = JingdongFinancials & {
  key: string;
  bucketKey: string;
  priceBucket: number;
  label: string;
  comboCount: number;
  representedComboCount: number;
  originalTotal: number;
  afterProductDiscount: number;
  productDiscount: number;
  full: FullReduction;
  storeCoupons: Coupon[];
  storeCouponAmount: number;
  afterStoreDiscount: number;
  subsidySelection: JingdongCouponSelection;
  merchantActivityAmount: number;
  userDiscountAmount: number;
  cost: number;
  avgCost: number;
  minCost: number;
  maxCost: number;
  avgProfit: number;
  worstProfit: number;
  avgProfitRate: number | null;
  worstProfitRate: number | null;
  avgNetProfitRate: number | null;
  worstNetProfitRate: number | null;
  avgProfitSpace: number;
  worstProfitSpace: number;
  riskComboCount: number;
  severity: Severity;
  riskType: 'loss' | 'lowProfit' | 'safe';
  reasons: string[];
  avoidSuggestion: JingdongPriceSuggestion | null;
  increaseSuggestion: JingdongPriceSuggestion | null;
};

export type JingdongSubsidyAnalysisSummary = {
  resultCount: number;
  comboCount: number;
  validComboCount: number;
  lossCount: number;
  lowProfitCount: number;
  safeCount: number;
  worstProfit: number | null;
  displayedResultCount?: number;
  bucketCount?: number;
  bucketResultCount?: number;
  displayedBucketResultCount?: number;
  source?: 'bucketSummary' | 'comboDetail';
  elapsedTime: number | null;
};

export type JingdongSubsidyAnalysisResult = {
  rows: JingdongSubsidyAnalysisRow[];
  bucketRows?: JingdongSubsidyBucketRiskRow[];
  warnings: string[];
  summary: JingdongSubsidyAnalysisSummary;
};

export type JingdongCouponAddOnSuggestion = {
  productId: string;
  name: string;
  amount: number;
  afterCouponBasis: number;
  thresholdSpace: number;
  remainingGap: number;
  willTrigger: boolean;
};

export type JingdongCouponNearTriggerRow = {
  key: string;
  items: ComboItem[];
  qtys: number[];
  comboText: string;
  originalTotal: number;
  afterProductDiscount: number;
  productDiscount: number;
  full: FullReduction;
  storeCouponAmount: number;
  afterStoreDiscount: number;
  subsidySelection: JingdongCouponSelection;
  targetThreshold: number;
  thresholdGap: number;
  addOnSuggestions: JingdongCouponAddOnSuggestion[];
};

export type JingdongCouponNearTriggerBucketRow = {
  key: string;
  bucketKey: string;
  priceBucket: number;
  label: string;
  comboCount: number;
  representedComboCount: number;
  originalTotal: number;
  afterProductDiscount: number;
  productDiscount: number;
  full: FullReduction;
  storeCouponAmount: number;
  afterStoreDiscount: number;
  subsidySelection: JingdongCouponSelection;
  targetThreshold: number;
  thresholdGap: number;
  nearMin: number;
  nearMax: number;
  avgCost: number;
  minCost: number;
  maxCost: number;
  riskComboCount: number;
};

export type JingdongCouponTestOptions = {
  targetCoupon: JingdongSubsidyCoupon;
  selectedSmallCoupons?: JingdongSubsidyCoupon[];
  nearBefore?: number;
  nearAfter?: number;
  maxRows?: number;
  reuseOnly?: boolean;
};

export type JingdongCouponTestLimits = CalculationLimits & {
  scanComboPools?: ActivityScanComboPools | null;
  originalPriceBuckets?: ActivityPriceBucketRow[] | null;
};

export type JingdongCouponTestSummary = {
  resultCount: number;
  comboCount: number;
  validComboCount: number;
  eligibleCount: number;
  nearTriggerCount: number;
  lossCount: number;
  lowProfitCount: number;
  safeCount: number;
  worstProfit: number | null;
  displayedResultCount: number;
  displayedNearTriggerCount: number;
  bucketCount?: number;
  eligibleBucketCount?: number;
  nearTriggerBucketCount?: number;
  displayedEligibleBucketCount?: number;
  displayedNearTriggerBucketCount?: number;
  source?: 'bucketSummary' | 'comboDetail';
  elapsedTime: number | null;
};

export type JingdongCouponTestResult = {
  targetCoupon: JingdongSubsidyCoupon;
  selections: JingdongCouponSelection[];
  rows: JingdongSubsidyAnalysisRow[];
  nearRows: JingdongCouponNearTriggerRow[];
  bucketRows?: JingdongSubsidyBucketRiskRow[];
  nearBucketRows?: JingdongCouponNearTriggerBucketRow[];
  warnings: string[];
  summary: JingdongCouponTestSummary;
};

function severityRank(severity: Severity) {
  return { none: 0, config: 1, medium: 2, high: 3, critical: 4 }[severity];
}

const comboContextCache = new Map<string, JingdongComboContextCacheEntry>();

function sortComboContextsByCouponBasis(a: JingdongComboContext, b: JingdongComboContext) {
  return a.afterStoreDiscount - b.afterStoreDiscount
    || a.originalTotal - b.originalTotal
    || a.comboText.localeCompare(b.comboText, 'zh-CN');
}

function rememberComboContextCache(entry: JingdongComboContextCacheEntry) {
  if (comboContextCache.has(entry.key)) comboContextCache.delete(entry.key);
  comboContextCache.set(entry.key, {
    ...entry,
    contexts: entry.contexts.slice().sort(sortComboContextsByCouponBasis)
  });
  while (comboContextCache.size > COMBO_CONTEXT_CACHE_SIZE) {
    const oldestKey = comboContextCache.keys().next().value;
    if (!oldestKey) break;
    comboContextCache.delete(oldestKey);
  }
}

function activityContextSignature(store: Store) {
  const activity = store.activities[JINGDONG_PLATFORM];
  return JSON.stringify({
    store: {
      id: store.id,
      startPrice: store.startPrice,
      maxItems: store.maxItems,
      maxQtyPerSku: store.maxQtyPerSku,
      maxChecks: store.maxChecks,
      maxCoupons: store.maxCoupons,
      maxDiscountItems: store.maxDiscountItems,
      calculationTotalMin: store.calculationTotalMin,
      calculationTotalMax: store.calculationTotalMax,
      stapleCountMin: store.stapleCountMin,
      stapleCountMax: store.stapleCountMax
    },
    products: store.products.map(product => ({
      id: product.id,
      name: product.name,
      price: product.price,
      cost: product.cost,
      packageFee: product.packageFee,
      jingdongPrice: product.jingdongPrice,
      jingdongPackageFee: product.jingdongPackageFee,
      jingdongEnabled: product.jingdongEnabled,
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      nonStandalone: product.nonStandalone
    })),
    activities: {
      fullReductions: activity.fullReductions,
      coupons: activity.coupons,
      jingdongSubsidyCoupons: activity.jingdongSubsidyCoupons,
      discountActivities: activity.discountActivities
    }
  });
}

function getComboContextCache(store: Store) {
  return comboContextCache.get(activityContextSignature(store)) || null;
}

function lowerBoundComboContexts(contexts: JingdongComboContext[], value: number) {
  let low = 0;
  let high = contexts.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (contexts[mid].afterStoreDiscount + 1e-9 < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

function upperBoundComboContexts(contexts: JingdongComboContext[], value: number) {
  let low = 0;
  let high = contexts.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (contexts[mid].afterStoreDiscount <= value + 1e-9) low = mid + 1;
    else high = mid;
  }
  return low;
}

function comboContextsInCouponBasisRange(contexts: JingdongComboContext[], min: number, max: number) {
  return contexts.slice(lowerBoundComboContexts(contexts, min), upperBoundComboContexts(contexts, max));
}

function buildJingdongComboCandidates(store: Store) {
  const mainProducts: ComboPoolCandidate[] = [];
  const addOnProducts: ComboPoolCandidate[] = [];
  store.products.forEach((product, index) => {
    if (!isProductListedOnPlatform(product, JINGDONG_PLATFORM)) return;
    const price = platformOriginalUnitPrice(product, JINGDONG_PLATFORM);
    if (isMealMainProduct(product)) {
      mainProducts.push({ index, price, stapleCount: mealMainStapleServingCount(product) });
      return;
    }
    if (isMealAddOnProduct(product)) addOnProducts.push({ index, price, stapleCount: 0 });
  });
  const byPrice = (a: ComboPoolCandidate, b: ComboPoolCandidate) => a.price - b.price || a.index - b.index;
  return {
    mainProducts: mainProducts.sort(byPrice),
    addOnProducts: addOnProducts.sort(byPrice)
  };
}

function comboPoolRowFromActivityScan(row: {
  qtys: number[];
  totalQty: number;
  originalTotal: number;
  stapleCount: number;
}): ComboPoolRow {
  return {
    qtys: row.qtys.slice(),
    totalQty: Math.max(0, Math.floor(Number(row.totalQty) || 0)),
    originalTotal: roundMoney(row.originalTotal),
    stapleCount: Math.max(0, Math.floor(Number(row.stapleCount) || 0))
  };
}

function jingdongComboPoolsFromActivityScan(scanComboPools?: ActivityScanComboPools | null): SeparatedComboPools | null {
  if (!scanComboPools) return null;
  const mainCombos = (scanComboPools.mainCombos || [])
    .filter(row => row.platform === JINGDONG_PLATFORM)
    .map(comboPoolRowFromActivityScan)
    .sort((a, b) => a.originalTotal - b.originalTotal || a.totalQty - b.totalQty);
  if (!mainCombos.length) return null;

  const addOnRows = (scanComboPools.addOnCombos || [])
    .filter(row => row.platform === JINGDONG_PLATFORM)
    .map(comboPoolRowFromActivityScan);
  const maxAddOnCount = addOnRows.reduce((max, row) => Math.max(max, row.totalQty), 0);
  const addOnCombosByCount: ComboPoolRow[][] = Array.from({ length: maxAddOnCount + 1 }, () => []);
  for (const row of addOnRows) {
    if (!addOnCombosByCount[row.totalQty]) addOnCombosByCount[row.totalQty] = [];
    addOnCombosByCount[row.totalQty].push(row);
  }
  if (!addOnCombosByCount[0]?.length) {
    addOnCombosByCount[0] = [{
      qtys: [],
      totalQty: 0,
      originalTotal: 0,
      stapleCount: 0
    }];
  }
  addOnCombosByCount.forEach(rows => rows.sort((a, b) => a.originalTotal - b.originalTotal || a.totalQty - b.totalQty));
  return { mainCombos, addOnCombosByCount };
}

async function enumerateJingdongCombosByOriginalAsync(
  store: Store,
  maxDurationMs: number,
  startedAt: number,
  visit: (qtys: number[]) => void,
  onProgress?: (summary: { checked: number; validCombos: number; stopped: boolean; stoppedReason?: 'maxChecks' | 'maxDuration' }) => void,
  shouldStop?: () => boolean,
  sourcePools?: SeparatedComboPools | null
) {
  const range = calculationTotalRange(store);
  const stapleRange = {
    min: Math.max(0, Math.floor(Number(store.stapleCountMin) || 0)),
    max: store.stapleCountMax === '' ? Infinity : Math.max(0, Math.floor(Number(store.stapleCountMax) || 0))
  };
  const maxItems = Math.max(0, Math.floor(Number(store.maxItems) || 0));
  const maxQtyPerSku = Math.max(0, Math.floor(Number(store.maxQtyPerSku) || 0));
  const maxChecks = normalizedStoreMaxChecks(store);
  const { mainProducts, addOnProducts } = sourcePools ? { mainProducts: [], addOnProducts: [] } : buildJingdongComboCandidates(store);
  const maxCandidateStapleCount = mainProducts.reduce((max, row) => Math.max(max, row.stapleCount), 1);
  const maxStapleCount = Number.isFinite(stapleRange.max)
    ? stapleRange.max
    : Math.max(stapleRange.min, maxItems * maxCandidateStapleCount);
  const addOnMaxCountLimit = maxItems;
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
    if (!stopped && shouldStop?.()) stop('maxChecks');
    if (!stopped && isJingdongDurationExceeded(startedAt, maxDurationMs, now)) stop('maxDuration');
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

  function recordCombo(qtys: number[], originalTotal: number, stapleCount: number) {
    if (stopped) return;
    if (originalTotal > range.max + 1e-9) return;
    checked++;
    if (checked > maxChecks) {
      stop('maxChecks');
      return;
    }
    if (originalTotal + 1e-9 < range.min) return;
    if (!isInStapleCountRange(store, stapleCount)) return;
    validCombos++;
    visit(qtys.slice());
  }

  const poolCacheKey = [
    'jingdong-subsidy',
    store.products.length,
    maxQtyPerSku,
    maxItems,
    stapleRange.min,
    maxStapleCount,
    range.max,
    candidatePoolSignature(mainProducts),
    candidatePoolSignature(addOnProducts)
  ].join('::');
  const pools = sourcePools || await buildSeparatedComboPoolsAsync({
    cacheKey: poolCacheKey,
    productCount: store.products.length,
    mainProducts,
    addOnProducts,
    maxQtyPerSku,
    maxItems,
    minStapleCount: stapleRange.min,
    maxStapleCount,
    maxAddOnCount: addOnMaxCountLimit,
    maxOriginalTotal: range.max,
    maxPoolRows: maxChecks,
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
        recordCombo(mergeComboQtys(store.products.length, base, addOn), originalTotal, base.stapleCount);
      }
    }
  }

  if (pools.truncated && !stopped) stop('maxChecks');
  onProgress?.({ checked, validCombos, stopped, stoppedReason });
  return { checked, validCombos, stopped, stoppedReason };
}

function couponBaseAmount(coupon: JingdongSubsidyCoupon) {
  return Math.max(0, Number(coupon.amount) || 0);
}

function couponMerchantBaseAmount(coupon: JingdongSubsidyCoupon) {
  return Math.max(0, Number(coupon.merchantAmount) || 0);
}

function couponMerchantExtraAmount(coupon: JingdongSubsidyCoupon) {
  return coupon.kind === 'large' ? Math.max(0, Number(coupon.merchantExtraAmount) || 0) : 0;
}

function couponEffectiveAmount(coupon: JingdongSubsidyCoupon) {
  return roundMoney(couponBaseAmount(coupon) + couponMerchantExtraAmount(coupon));
}

function couponEffectiveMerchantAmount(coupon: JingdongSubsidyCoupon) {
  return roundMoney(couponMerchantBaseAmount(coupon) + couponMerchantExtraAmount(coupon));
}

export function jingdongCouponEffectiveAmount(coupon: JingdongSubsidyCoupon) {
  return couponEffectiveAmount(coupon);
}

export function jingdongCouponEffectiveMerchantAmount(coupon: JingdongSubsidyCoupon) {
  return couponEffectiveMerchantAmount(coupon);
}

function couponSort(a: JingdongSubsidyCoupon, b: JingdongSubsidyCoupon) {
  return couponEffectiveAmount(b) - couponEffectiveAmount(a)
    || couponEffectiveMerchantAmount(b) - couponEffectiveMerchantAmount(a)
    || b.threshold - a.threshold
    || a.name.localeCompare(b.name, 'zh-CN');
}

function couponKey(coupon: JingdongSubsidyCoupon) {
  return [
    coupon.kind,
    coupon.name,
    roundMoney(coupon.threshold),
    roundMoney(coupon.amount),
    roundMoney(coupon.merchantAmount),
    roundMoney(couponMerchantExtraAmount(coupon)),
    roundMoney(coupon.platformAmount),
    coupon.stackableWithLarge ? 'stack' : 'solo'
  ].join(':');
}

function createCouponSelection(coupons: JingdongSubsidyCoupon[]): JingdongCouponSelection {
  const sorted = coupons.slice().sort((a, b) => a.kind.localeCompare(b.kind) || couponSort(a, b));
  const largeCoupon = sorted.find(coupon => coupon.kind === 'large') || null;
  const smallCoupon = sorted.find(coupon => coupon.kind === 'small') || null;
  return {
    key: sorted.map(couponKey).join('|'),
    name: sorted.map(coupon => coupon.name || (coupon.kind === 'large' ? '大额补贴券' : '小额叠加券')).join(' + '),
    coupons: sorted,
    largeCoupon,
    smallCoupon,
    amount: roundMoney(sorted.reduce((sum, coupon) => sum + couponEffectiveAmount(coupon), 0)),
    merchantAmount: roundMoney(sorted.reduce((sum, coupon) => sum + couponEffectiveMerchantAmount(coupon), 0)),
    merchantExtraAmount: roundMoney(sorted.reduce((sum, coupon) => sum + couponMerchantExtraAmount(coupon), 0)),
    platformAmount: roundMoney(sorted.reduce((sum, coupon) => sum + Math.max(0, Number(coupon.platformAmount) || 0), 0)),
    isUserBest: false
  };
}

function eligibleJingdongCoupons(coupons: JingdongSubsidyCoupon[], couponBasis: number) {
  return coupons
    .filter(coupon => coupon.enabled && couponBasis + 1e-9 >= coupon.threshold && couponEffectiveAmount(coupon) > 0)
    .sort(couponSort);
}

function markUserBestSelections(selections: JingdongCouponSelection[]) {
  const bestAmount = selections.reduce((max, row) => Math.max(max, row.amount), 0);
  return selections.map(row => ({ ...row, isUserBest: bestAmount > 0 && row.amount + 1e-9 >= bestAmount }));
}

export function buildEligibleJingdongCouponSelections(coupons: JingdongSubsidyCoupon[], couponBasis: number) {
  const enabledCoupons = eligibleJingdongCoupons(coupons, couponBasis);
  const largeCoupons = enabledCoupons.filter(coupon => coupon.kind === 'large');
  const smallCoupons = enabledCoupons.filter(coupon => coupon.kind === 'small');
  const selections = new Map<string, JingdongCouponSelection>();

  for (const smallCoupon of smallCoupons) {
    const selection = createCouponSelection([smallCoupon]);
    selections.set(selection.key, selection);
  }
  for (const largeCoupon of largeCoupons) {
    const largeSelection = createCouponSelection([largeCoupon]);
    selections.set(largeSelection.key, largeSelection);
    for (const smallCoupon of smallCoupons) {
      if (!smallCoupon.stackableWithLarge) continue;
      const stackedSelection = createCouponSelection([largeCoupon, smallCoupon]);
      selections.set(stackedSelection.key, stackedSelection);
    }
  }

  const rows = Array.from(selections.values()).sort((a, b) => b.amount - a.amount || b.merchantAmount - a.merchantAmount || a.name.localeCompare(b.name, 'zh-CN'));
  return markUserBestSelections(rows);
}

function buildBestJingdongCouponSelections(coupons: JingdongSubsidyCoupon[], couponBasis: number) {
  const enabledCoupons = eligibleJingdongCoupons(coupons, couponBasis);
  const largeCoupons = enabledCoupons.filter(coupon => coupon.kind === 'large');
  const smallCoupons = enabledCoupons.filter(coupon => coupon.kind === 'small');
  const stackableSmallCoupons = smallCoupons.filter(coupon => coupon.stackableWithLarge);
  const maxSmallAmount = smallCoupons.reduce((max, coupon) => Math.max(max, couponEffectiveAmount(coupon)), 0);
  const maxStackableSmallAmount = stackableSmallCoupons.reduce((max, coupon) => Math.max(max, couponEffectiveAmount(coupon)), 0);
  const candidates = new Map<string, JingdongCouponSelection>();

  for (const smallCoupon of smallCoupons) {
    if (couponEffectiveAmount(smallCoupon) + 1e-9 < maxSmallAmount) continue;
    const selection = createCouponSelection([smallCoupon]);
    candidates.set(selection.key, selection);
  }
  for (const largeCoupon of largeCoupons) {
    if (maxStackableSmallAmount <= 0) {
      const selection = createCouponSelection([largeCoupon]);
      candidates.set(selection.key, selection);
      continue;
    }
    for (const smallCoupon of stackableSmallCoupons) {
      if (couponEffectiveAmount(smallCoupon) + 1e-9 < maxStackableSmallAmount) continue;
      const selection = createCouponSelection([largeCoupon, smallCoupon]);
      candidates.set(selection.key, selection);
    }
  }

  const rows = markUserBestSelections(Array.from(candidates.values()));
  return rows
    .filter(selection => selection.isUserBest)
    .sort((a, b) => b.amount - a.amount || b.merchantAmount - a.merchantAmount || a.name.localeCompare(b.name, 'zh-CN'));
}

function buildJingdongCouponSelections(coupons: JingdongSubsidyCoupon[], couponBasis: number, mode: JingdongCouponScanMode) {
  return mode === 'pressure'
    ? buildEligibleJingdongCouponSelections(coupons, couponBasis)
    : buildBestJingdongCouponSelections(coupons, couponBasis);
}

/** 门店券可能使补贴券失去门槛资格，按完整优惠后的实付选择门店券。 */
export function bestJingdongStoreCouponOption(store: Store, originalTotal: number, afterFull: number) {
  const activity = store.activities[JINGDONG_PLATFORM];
  return bestCouponOption(activity.coupons, originalTotal, store.maxCoupons, amount => {
    const basis = Math.max(0, roundMoney(afterFull - amount));
    const [selection] = buildBestJingdongCouponSelections(activity.jingdongSubsidyCoupons || [], basis);
    return Math.max(0, roundMoney(basis - (selection?.amount || 0)));
  });
}

function couponHasDiscount(coupon: JingdongSubsidyCoupon) {
  return couponEffectiveAmount(coupon) > 0;
}

function selectionTriggerThreshold(selection: JingdongCouponSelection) {
  return Math.max(0, ...selection.coupons.map(coupon => Math.max(0, Number(coupon.threshold) || 0)));
}

function buildLargeCouponTestSelections(targetCoupon: JingdongSubsidyCoupon, selectedSmallCoupons: JingdongSubsidyCoupon[]) {
  const selections = new Map<string, JingdongCouponSelection>();
  const largeSelection = createCouponSelection([targetCoupon]);
  selections.set(largeSelection.key, largeSelection);
  for (const smallCoupon of selectedSmallCoupons) {
    if (smallCoupon.kind !== 'small' || !smallCoupon.stackableWithLarge || !couponHasDiscount(smallCoupon)) continue;
    const selection = createCouponSelection([targetCoupon, smallCoupon]);
    selections.set(selection.key, selection);
  }
  return markUserBestSelections(Array.from(selections.values()))
    .sort((a, b) => b.amount - a.amount || b.merchantAmount - a.merchantAmount || a.name.localeCompare(b.name, 'zh-CN'));
}

function buildSmallCouponTestSelections(targetCoupon: JingdongSubsidyCoupon, coupons: JingdongSubsidyCoupon[]) {
  if (!targetCoupon.stackableWithLarge) return markUserBestSelections([createCouponSelection([targetCoupon])]);
  const selections = coupons
    .filter(coupon => coupon.kind === 'large' && coupon.enabled && couponHasDiscount(coupon))
    .map(largeCoupon => createCouponSelection([largeCoupon, targetCoupon]));
  return markUserBestSelections(selections.length ? selections : [createCouponSelection([targetCoupon])])
    .sort((a, b) => b.amount - a.amount || b.merchantAmount - a.merchantAmount || a.name.localeCompare(b.name, 'zh-CN'));
}

function buildCouponTestSelections(
  targetCoupon: JingdongSubsidyCoupon,
  coupons: JingdongSubsidyCoupon[],
  selectedSmallCoupons: JingdongSubsidyCoupon[] = []
) {
  if (!couponHasDiscount(targetCoupon)) return [];
  return targetCoupon.kind === 'large'
    ? buildLargeCouponTestSelections(targetCoupon, selectedSmallCoupons)
    : buildSmallCouponTestSelections(targetCoupon, coupons);
}

function evaluateFinancials(
  state: CalculatorState,
  store: Store,
  couponBasis: number,
  selection: Pick<JingdongCouponSelection, 'amount' | 'merchantAmount'>,
  cost: number,
  stapleCount: number
): JingdongFinancials {
  const rule = effectiveFeeRule(state, store, JINGDONG_PLATFORM);
  const finalPay = Math.max(0, roundMoney(couponBasis - selection.amount));
  const merchantSettlement = roundMoney(couponBasis - selection.merchantAmount);
  const commission = roundMoney(Math.max(finalPay * (rule.commissionRate / 100), rule.minCommission));
  const serviceFee = calculateServiceFee(rule, store, finalPay);
  const freightSubsidy = calculateFreightSubsidy(rule, store.deliveryDistance);
  const netPay = roundMoney(merchantSettlement - commission - serviceFee - freightSubsidy);
  const profit = roundMoney(netPay - cost);
  const target = pricingStrategyTargetForPay(state, store, finalPay, stapleCount);
  const profitRate = profitRateByBasis(profit, finalPay);
  const netProfitRate = profitRateByBasis(profit, netPay);
  const paySpace = profitRate === null ? -Infinity : roundMoney(profit - finalPay * target.targetPayRate);
  const netSpace = netProfitRate === null ? -Infinity : roundMoney(profit - netPay * target.targetNetRate);
  return {
    couponBasis: roundMoney(couponBasis),
    finalPay,
    merchantSettlement,
    commission,
    serviceFee,
    freightSubsidy,
    netPay,
    profit,
    profitRate,
    netProfitRate,
    targetPayRate: target.targetPayRate,
    targetNetRate: target.targetNetRate,
    profitSpace: Number.isFinite(paySpace) && Number.isFinite(netSpace) ? Math.min(paySpace, netSpace) : roundMoney(profit)
  };
}

function buildAvoidSuggestion(selection: JingdongCouponSelection, couponBasis: number): JingdongPriceSuggestion | null {
  if (!selection.coupons.length) return null;
  const targetThreshold = Math.max(...selection.coupons.map(coupon => coupon.threshold));
  const targetCouponBasis = Math.max(0, roundMoney(targetThreshold - PRICE_STEP));
  const amount = roundMoney(couponBasis - targetCouponBasis);
  if (amount <= 0) return null;
  return {
    targetCouponBasis,
    amount,
    text: `门店优惠后降至 ¥${targetCouponBasis.toFixed(2)}，组合约降 ¥${amount.toFixed(2)}；用户再凑 ¥${PRICE_STEP.toFixed(2)} 可重新到券门槛`
  };
}

function buildIncreaseSuggestion(
  state: CalculatorState,
  store: Store,
  couponBasis: number,
  selection: JingdongCouponSelection,
  cost: number,
  stapleCount: number,
  current?: JingdongFinancials
): JingdongPriceSuggestion | null {
  const currentFinancials = current || evaluateFinancials(state, store, couponBasis, selection, cost, stapleCount);
  if (currentFinancials.profit >= 0 && currentFinancials.profitSpace >= 0) return null;
  const coarseSteps = Math.ceil(MAX_PRICE_INCREASE_SCAN / PRICE_COARSE_STEP);
  let upperCouponBasis: number | null = null;
  for (let index = 1; index <= coarseSteps; index++) {
    const nextCouponBasis = roundMoney(couponBasis + index * PRICE_COARSE_STEP);
    const financials = evaluateFinancials(state, store, nextCouponBasis, selection, cost, stapleCount);
    if (financials.profit >= 0 && financials.profitSpace >= 0) {
      upperCouponBasis = nextCouponBasis;
      break;
    }
  }
  if (upperCouponBasis === null) return null;
  const lowerCouponBasis = Math.max(couponBasis + PRICE_STEP, upperCouponBasis - PRICE_COARSE_STEP + PRICE_STEP);
  const refineSteps = Math.max(1, Math.ceil((upperCouponBasis - lowerCouponBasis) / PRICE_STEP) + 1);
  for (let index = 0; index <= refineSteps; index++) {
    const nextCouponBasis = roundMoney(lowerCouponBasis + index * PRICE_STEP);
    if (nextCouponBasis > upperCouponBasis + 1e-9) break;
    const financials = evaluateFinancials(state, store, nextCouponBasis, selection, cost, stapleCount);
    if (financials.profit < 0 || financials.profitSpace < 0) continue;
    const amount = roundMoney(nextCouponBasis - couponBasis);
    return {
      targetCouponBasis: nextCouponBasis,
      amount,
      finalPay: financials.finalPay,
      netPay: financials.netPay,
      profit: financials.profit,
      text: `门店优惠后约提至 ¥${nextCouponBasis.toFixed(2)}，组合约涨 ¥${amount.toFixed(2)}，预计到手 ¥${financials.netPay.toFixed(2)}`
    };
  }
  return null;
}

function buildRisk(financials: JingdongFinancials) {
  const reasons: string[] = [];
  if (financials.profit < -1e-9) reasons.push('补贴后亏损');
  if (financials.profit >= -1e-9 && financials.profitSpace < -1e-9) reasons.push('未达到目标利润空间');
  const riskType: JingdongSubsidyAnalysisRow['riskType'] = financials.profit < -1e-9
    ? 'loss'
    : financials.profitSpace < -1e-9
      ? 'lowProfit'
      : 'safe';
  const severity: Severity = riskType === 'loss' ? 'critical' : riskType === 'lowProfit' ? 'medium' : 'none';
  return {
    severity,
    riskType,
    reasons: reasons.length ? reasons : ['正常']
  };
}

function comboText(items: ComboItem[]) {
  return items.map(item => `${item.name}×${item.qty}`).join('、');
}

function buildJingdongComboContext(store: Store, qtys: number[]): JingdongComboContext | null {
  const activity = store.activities[JINGDONG_PLATFORM];
  const totals = buildPlatformTotals(store, JINGDONG_PLATFORM, qtys, activity);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (totals.afterProductDiscount + 1e-9 < store.startPrice) return null;
  const full = bestFullReduction(activity.fullReductions, totals.originalTotal);
  const afterFull = Math.max(0, roundMoney(totals.afterProductDiscount - full.amount));
  const storeCouponOption = bestJingdongStoreCouponOption(store, totals.originalTotal, afterFull);
  const afterStoreDiscount = Math.max(0, roundMoney(afterFull - storeCouponOption.amount));
  const items = totals.items;
  return {
    qtys: qtys.slice(),
    items,
    comboText: comboText(items),
    originalTotal: totals.originalTotal,
    afterProductDiscount: totals.afterProductDiscount,
    productDiscount: roundMoney(totals.productDiscount),
    full,
    storeCouponOption,
    afterStoreDiscount,
    stapleCount: comboStapleServingCount(items),
    costTotal: totals.costTotal
  };
}

function buildNearTriggerRow(context: JingdongComboContext, selection: JingdongCouponSelection, targetThreshold: number): JingdongCouponNearTriggerRow {
  const thresholdGap = Math.max(0, roundMoney(targetThreshold - context.afterStoreDiscount));
  return {
    key: [
      'jingdong-near',
      context.items.map(item => `${item.productId}:${item.qty}`).join('|'),
      selection.key,
      `gap:${thresholdGap}`
    ].join('::'),
    items: context.items,
    qtys: context.qtys,
    comboText: context.comboText,
    originalTotal: context.originalTotal,
    afterProductDiscount: context.afterProductDiscount,
    productDiscount: context.productDiscount,
    full: context.full,
    storeCouponAmount: context.storeCouponOption.amount,
    afterStoreDiscount: context.afterStoreDiscount,
    subsidySelection: selection,
    targetThreshold,
    thresholdGap,
    addOnSuggestions: []
  };
}

function sortNearTriggerRows(a: JingdongCouponNearTriggerRow, b: JingdongCouponNearTriggerRow) {
  return a.thresholdGap - b.thresholdGap
    || b.subsidySelection.amount - a.subsidySelection.amount
    || b.targetThreshold - a.targetThreshold
    || a.originalTotal - b.originalTotal
    || a.comboText.localeCompare(b.comboText, 'zh-CN');
}

function rememberLimitedRow<T>(rows: T[], row: T, limit: number, sorter: (a: T, b: T) => number) {
  rows.push(row);
  if (rows.length <= limit * 3) return;
  rows.sort(sorter);
  rows.splice(limit);
}

function buildAddOnSuggestions(store: Store, nearRow: JingdongCouponNearTriggerRow, maxSuggestions = 5): JingdongCouponAddOnSuggestion[] {
  const currentQty = nearRow.qtys.reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0);
  const maxItems = Math.max(0, Math.floor(Number(store.maxItems) || 0));
  const maxQtyPerSku = Math.max(0, Math.floor(Number(store.maxQtyPerSku) || 0));
  if (currentQty >= maxItems) return [];
  const suggestions: JingdongCouponAddOnSuggestion[] = [];
  store.products.forEach((product, index) => {
    if (!isProductListedOnPlatform(product, JINGDONG_PLATFORM) || !isMealAddOnProduct(product)) return;
    const currentProductQty = Math.max(0, Number(nearRow.qtys[index]) || 0);
    if (currentProductQty >= maxQtyPerSku) return;
    const nextQtys = nearRow.qtys.slice();
    nextQtys[index] = currentProductQty + 1;
    const nextContext = buildJingdongComboContext(store, nextQtys);
    if (!nextContext || nextContext.afterStoreDiscount <= nearRow.afterStoreDiscount + 1e-9) return;
    const remainingGap = Math.max(0, roundMoney(nearRow.targetThreshold - nextContext.afterStoreDiscount));
    suggestions.push({
      productId: product.id,
      name: product.name,
      amount: platformOriginalUnitPrice(product, JINGDONG_PLATFORM),
      afterCouponBasis: nextContext.afterStoreDiscount,
      thresholdSpace: roundMoney(nextContext.afterStoreDiscount - nearRow.targetThreshold),
      remainingGap,
      willTrigger: remainingGap <= 1e-9
    });
  });
  return suggestions
    .sort((a, b) => Number(b.willTrigger) - Number(a.willTrigger)
      || a.remainingGap - b.remainingGap
      || Math.abs(a.thresholdSpace) - Math.abs(b.thresholdSpace)
      || a.amount - b.amount
      || a.name.localeCompare(b.name, 'zh-CN'))
    .slice(0, maxSuggestions);
}

function createAnalysisRow(
  state: CalculatorState,
  store: Store,
  context: JingdongComboContext,
  selection: JingdongCouponSelection
): JingdongSubsidyAnalysisRow | null {
  const financials = evaluateFinancials(state, store, context.afterStoreDiscount, selection, context.costTotal, context.stapleCount);
  const risk = buildRisk(financials);
  const merchantActivityAmount = roundMoney(context.productDiscount + context.full.amount + context.storeCouponOption.amount + selection.merchantAmount + financials.freightSubsidy);
  const userDiscountAmount = roundMoney(context.productDiscount + context.full.amount + context.storeCouponOption.amount + selection.amount);
  return {
    ...financials,
    key: [
      'jingdong',
      context.items.map(item => `${item.productId}:${item.qty}`).join('|'),
      selection.key,
      `basis:${financials.couponBasis}`,
      `pay:${financials.finalPay}`
    ].join('::'),
    items: context.items,
    comboText: context.comboText,
    scenarioName: pricingStrategyTargetForPay(state, store, financials.finalPay, context.stapleCount).scenarioName,
    originalTotal: context.originalTotal,
    afterProductDiscount: context.afterProductDiscount,
    productDiscount: context.productDiscount,
    full: context.full,
    storeCoupons: context.storeCouponOption.coupons,
    storeCouponAmount: context.storeCouponOption.amount,
    afterStoreDiscount: context.afterStoreDiscount,
    subsidySelection: selection,
    merchantActivityAmount,
    userDiscountAmount,
    cost: context.costTotal,
    severity: risk.severity,
    riskType: risk.riskType,
    reasons: risk.reasons,
    avoidSuggestion: buildAvoidSuggestion(selection, context.afterStoreDiscount),
    increaseSuggestion: buildIncreaseSuggestion(state, store, context.afterStoreDiscount, selection, context.costTotal, context.stapleCount, financials)
  };
}

function sortAnalysisRows(a: JingdongSubsidyAnalysisRow, b: JingdongSubsidyAnalysisRow) {
  return severityRank(b.severity) - severityRank(a.severity)
    || a.profit - b.profit
    || a.profitSpace - b.profitSpace
    || b.subsidySelection.amount - a.subsidySelection.amount
    || a.finalPay - b.finalPay
    || a.originalTotal - b.originalTotal
    || a.comboText.localeCompare(b.comboText, 'zh-CN');
}

function bucketAverageCost(bucket: ActivityPriceBucketRow) {
  const weightedAvgCost = Number(bucket.weightedAvgCost);
  if (Number.isFinite(weightedAvgCost) && weightedAvgCost >= 0) return roundMoney(weightedAvgCost);
  const avgCost = Number(bucket.avgCost);
  return Number.isFinite(avgCost) ? roundMoney(Math.max(0, avgCost)) : 0;
}

function bucketCostValue(bucket: ActivityPriceBucketRow, key: 'minCost' | 'maxCost', fallback: number) {
  const value = Number(bucket[key]);
  return Number.isFinite(value) ? roundMoney(Math.max(0, value)) : fallback;
}

function bucketStapleCount(finalPay: number) {
  if (finalPay <= 25 + 1e-9) return 1;
  if (finalPay <= 60 + 1e-9) return 2;
  return 3;
}

function createBucketRiskRow(
  state: CalculatorState,
  store: Store,
  bucket: ActivityPriceBucketRow,
  selection: JingdongCouponSelection
): JingdongSubsidyBucketRiskRow | null {
  if (bucket.platform !== JINGDONG_PLATFORM || bucket.comboCount <= 0) return null;
  const activity = store.activities[JINGDONG_PLATFORM];
  const originalTotal = roundMoney(bucket.avgOriginalTotal || bucket.priceBucket);
  if (!isInCalculationTotalRange(store, originalTotal)) return null;
  if (originalTotal + 1e-9 < store.startPrice) return null;
  const productDiscount = 0;
  const afterProductDiscount = originalTotal;
  const full = bestFullReduction(activity.fullReductions, originalTotal);
  const afterFull = Math.max(0, roundMoney(afterProductDiscount - full.amount));
  const storeCouponOption = bestJingdongStoreCouponOption(store, originalTotal, afterFull);
  const afterStoreDiscount = Math.max(0, roundMoney(afterFull - storeCouponOption.amount));
  if (afterStoreDiscount + 1e-9 < selectionTriggerThreshold(selection)) return null;

  const avgCost = bucketAverageCost(bucket);
  const minCost = bucketCostValue(bucket, 'minCost', avgCost);
  const maxCost = bucketCostValue(bucket, 'maxCost', avgCost);
  const stapleCount = bucketStapleCount(Math.max(0, afterStoreDiscount - selection.amount));
  const avgFinancials = evaluateFinancials(state, store, afterStoreDiscount, selection, avgCost, stapleCount);
  const worstFinancials = evaluateFinancials(state, store, afterStoreDiscount, selection, maxCost, stapleCount);
  const risk = buildRisk(worstFinancials);
  const comboCount = Math.max(0, Math.floor(Number(bucket.comboCount) || 0));
  const merchantActivityAmount = roundMoney(productDiscount + full.amount + storeCouponOption.amount + selection.merchantAmount + avgFinancials.freightSubsidy);
  const userDiscountAmount = roundMoney(productDiscount + full.amount + storeCouponOption.amount + selection.amount);
  const reasons = new Set(risk.reasons);
  if (maxCost > avgCost + 1e-9) reasons.add(`桶内最高成本 ¥${maxCost.toFixed(2)} 已纳入保守判断`);
  if ((Number(bucket.riskCount) || 0) > 0) reasons.add(`活动设计原价桶已有 ${Math.max(0, Math.floor(Number(bucket.riskCount) || 0))} 个风险组合`);
  return {
    ...avgFinancials,
    key: [
      'jingdong-bucket',
      bucket.key,
      selection.key,
      `basis:${avgFinancials.couponBasis}`,
      `pay:${avgFinancials.finalPay}`
    ].join('::'),
    bucketKey: bucket.key,
    priceBucket: bucket.priceBucket,
    label: bucket.label || `${moneyBucketLabel(bucket)}`,
    comboCount,
    representedComboCount: comboCount,
    originalTotal,
    afterProductDiscount,
    productDiscount,
    full,
    storeCoupons: storeCouponOption.coupons,
    storeCouponAmount: storeCouponOption.amount,
    afterStoreDiscount,
    subsidySelection: selection,
    merchantActivityAmount,
    userDiscountAmount,
    cost: avgCost,
    avgCost,
    minCost,
    maxCost,
    avgProfit: avgFinancials.profit,
    worstProfit: worstFinancials.profit,
    avgProfitRate: avgFinancials.profitRate,
    worstProfitRate: worstFinancials.profitRate,
    avgNetProfitRate: avgFinancials.netProfitRate,
    worstNetProfitRate: worstFinancials.netProfitRate,
    avgProfitSpace: avgFinancials.profitSpace,
    worstProfitSpace: worstFinancials.profitSpace,
    riskComboCount: Math.max(0, Math.floor(Number(bucket.riskCount) || 0)),
    severity: risk.severity,
    riskType: risk.riskType,
    reasons: Array.from(reasons),
    avoidSuggestion: buildAvoidSuggestion(selection, afterStoreDiscount),
    increaseSuggestion: buildIncreaseSuggestion(state, store, afterStoreDiscount, selection, maxCost, stapleCount, worstFinancials)
  };
}

function moneyBucketLabel(bucket: ActivityPriceBucketRow) {
  const min = Number.isFinite(Number(bucket.min)) ? Number(bucket.min) : bucket.priceBucket;
  const max = Number.isFinite(Number(bucket.max)) ? Number(bucket.max) : bucket.priceBucket + 1;
  return `${roundMoney(min)}-${roundMoney(max)}`;
}

function sortBucketRiskRows(a: JingdongSubsidyBucketRiskRow, b: JingdongSubsidyBucketRiskRow) {
  return severityRank(b.severity) - severityRank(a.severity)
    || a.worstProfit - b.worstProfit
    || a.worstProfitSpace - b.worstProfitSpace
    || b.subsidySelection.amount - a.subsidySelection.amount
    || a.priceBucket - b.priceBucket
    || a.key.localeCompare(b.key, 'zh-CN');
}

function buildBucketRiskRows(
  state: CalculatorState,
  store: Store,
  buckets: ActivityPriceBucketRow[],
  mode: JingdongCouponScanMode
) {
  const activity = store.activities[JINGDONG_PLATFORM];
  const rows: JingdongSubsidyBucketRiskRow[] = [];
  const selectionCache = new Map<string, JingdongCouponSelection[]>();
  let lossCount = 0;
  let lowProfitCount = 0;
  let safeCount = 0;
  let worstProfit: number | null = null;
  for (const bucket of buckets) {
    const originalTotal = roundMoney(bucket.avgOriginalTotal || bucket.priceBucket);
    const full = bestFullReduction(activity.fullReductions, originalTotal);
    const storeCouponOption = bestJingdongStoreCouponOption(store, originalTotal, Math.max(0, roundMoney(originalTotal - full.amount)));
    const afterStoreDiscount = Math.max(0, roundMoney(originalTotal - full.amount - storeCouponOption.amount));
    const selectionCacheKey = `${mode}:${afterStoreDiscount}`;
    let selections = selectionCache.get(selectionCacheKey);
    if (!selections) {
      selections = buildJingdongCouponSelections(activity.jingdongSubsidyCoupons || [], afterStoreDiscount, mode);
      selectionCache.set(selectionCacheKey, selections);
    }
    for (const selection of selections) {
      const row = createBucketRiskRow(state, store, bucket, selection);
      if (!row) continue;
      rows.push(row);
      if (row.riskType === 'loss') lossCount++;
      else if (row.riskType === 'lowProfit') lowProfitCount++;
      else safeCount++;
      worstProfit = worstProfit === null ? row.worstProfit : Math.min(worstProfit, row.worstProfit);
    }
  }
  return {
    rows: rows.sort(sortBucketRiskRows),
    lossCount,
    lowProfitCount,
    safeCount,
    worstProfit
  };
}

function jingdongOriginalPriceBuckets(buckets?: ActivityPriceBucketRow[] | null) {
  return (buckets || [])
    .filter(bucket => bucket.platform === JINGDONG_PLATFORM && Math.max(0, Number(bucket.comboCount) || 0) > 0)
    .sort((a, b) => a.priceBucket - b.priceBucket || a.key.localeCompare(b.key, 'zh-CN'));
}

export function buildJingdongAnalysisRowsFromActivityBaseRows(
  state: CalculatorState,
  baseRows: ActivityBaseComboRow[],
  targetSelection: JingdongCouponSelection,
  maxRows = DEFAULT_COUPON_TEST_ROW_LIMIT
): JingdongSubsidyAnalysisRow[] {
  const store = currentStoreFrom(state);
  const productIndexById = new Map(store.products.map((product, index) => [product.id, index]));
  const limit = Math.max(1, Math.floor(Number(maxRows) || DEFAULT_COUPON_TEST_ROW_LIMIT));
  const rows: JingdongSubsidyAnalysisRow[] = [];
  const threshold = selectionTriggerThreshold(targetSelection);
  for (const baseRow of baseRows) {
    if (baseRow.platform !== JINGDONG_PLATFORM) continue;
    const qtys = Array.from({ length: store.products.length }, () => 0);
    for (const item of baseRow.items || []) {
      const index = productIndexById.get(item.productId);
      if (index === undefined) continue;
      qtys[index] += Math.max(0, Math.floor(Number(item.qty) || 0));
    }
    if (!qtys.some(qty => qty > 0)) continue;
    const context = buildJingdongComboContext(store, qtys);
    if (!context || context.afterStoreDiscount + 1e-9 < threshold) continue;
    const row = createAnalysisRow(state, store, context, targetSelection);
    if (!row) continue;
    rememberLimitedRow(rows, row, limit, sortAnalysisRows);
  }
  return rows.sort(sortAnalysisRows).slice(0, limit);
}

type JingdongCouponTestSelectionThreshold = {
  selection: JingdongCouponSelection;
  threshold: number;
  min: number;
  max: number;
};

function createNearTriggerBucketRow(
  store: Store,
  bucket: ActivityPriceBucketRow,
  selectionThreshold: JingdongCouponTestSelectionThreshold
): JingdongCouponNearTriggerBucketRow | null {
  if (bucket.platform !== JINGDONG_PLATFORM || bucket.comboCount <= 0) return null;
  const activity = store.activities[JINGDONG_PLATFORM];
  const originalTotal = roundMoney(bucket.avgOriginalTotal || bucket.priceBucket);
  if (!isInCalculationTotalRange(store, originalTotal)) return null;
  if (originalTotal + 1e-9 < store.startPrice) return null;
  const productDiscount = 0;
  const afterProductDiscount = originalTotal;
  const full = bestFullReduction(activity.fullReductions, originalTotal);
  const afterFull = Math.max(0, roundMoney(afterProductDiscount - full.amount));
  const storeCouponOption = bestJingdongStoreCouponOption(store, originalTotal, afterFull);
  const afterStoreDiscount = Math.max(0, roundMoney(afterFull - storeCouponOption.amount));
  if (afterStoreDiscount + 1e-9 >= selectionThreshold.threshold) return null;
  if (afterStoreDiscount + 1e-9 < selectionThreshold.min || afterStoreDiscount > selectionThreshold.max + 1e-9) return null;
  const avgCost = bucketAverageCost(bucket);
  const minCost = bucketCostValue(bucket, 'minCost', avgCost);
  const maxCost = bucketCostValue(bucket, 'maxCost', avgCost);
  const thresholdGap = Math.max(0, roundMoney(selectionThreshold.threshold - afterStoreDiscount));
  const comboCount = Math.max(0, Math.floor(Number(bucket.comboCount) || 0));
  return {
    key: [
      'jingdong-near-bucket',
      bucket.key,
      selectionThreshold.selection.key,
      `gap:${thresholdGap}`
    ].join('::'),
    bucketKey: bucket.key,
    priceBucket: bucket.priceBucket,
    label: bucket.label || moneyBucketLabel(bucket),
    comboCount,
    representedComboCount: comboCount,
    originalTotal,
    afterProductDiscount,
    productDiscount,
    full,
    storeCouponAmount: storeCouponOption.amount,
    afterStoreDiscount,
    subsidySelection: selectionThreshold.selection,
    targetThreshold: selectionThreshold.threshold,
    thresholdGap,
    nearMin: selectionThreshold.min,
    nearMax: selectionThreshold.max,
    avgCost,
    minCost,
    maxCost,
    riskComboCount: Math.max(0, Math.floor(Number(bucket.riskCount) || 0))
  };
}

function sortNearTriggerBucketRows(a: JingdongCouponNearTriggerBucketRow, b: JingdongCouponNearTriggerBucketRow) {
  return a.thresholdGap - b.thresholdGap
    || b.subsidySelection.amount - a.subsidySelection.amount
    || b.targetThreshold - a.targetThreshold
    || a.priceBucket - b.priceBucket
    || a.key.localeCompare(b.key, 'zh-CN');
}

function buildCouponTestBucketRows(
  state: CalculatorState,
  store: Store,
  buckets: ActivityPriceBucketRow[],
  selectionThresholds: JingdongCouponTestSelectionThreshold[]
) {
  const activity = store.activities[JINGDONG_PLATFORM];
  const bucketRows: JingdongSubsidyBucketRiskRow[] = [];
  const nearBucketRows: JingdongCouponNearTriggerBucketRow[] = [];
  let lossCount = 0;
  let lowProfitCount = 0;
  let safeCount = 0;
  let worstProfit: number | null = null;
  for (const bucket of buckets) {
    const originalTotal = roundMoney(bucket.avgOriginalTotal || bucket.priceBucket);
    if (!isInCalculationTotalRange(store, originalTotal)) continue;
    if (originalTotal + 1e-9 < store.startPrice) continue;
    const full = bestFullReduction(activity.fullReductions, originalTotal);
    const storeCouponOption = bestJingdongStoreCouponOption(store, originalTotal, Math.max(0, roundMoney(originalTotal - full.amount)));
    const afterStoreDiscount = Math.max(0, roundMoney(originalTotal - full.amount - storeCouponOption.amount));
    for (const selectionThreshold of selectionThresholds) {
      if (afterStoreDiscount + 1e-9 < selectionThreshold.min || afterStoreDiscount > selectionThreshold.max + 1e-9) continue;
      const nearBucketRow = createNearTriggerBucketRow(store, bucket, selectionThreshold);
      if (nearBucketRow) {
        nearBucketRows.push(nearBucketRow);
        continue;
      }
      const row = createBucketRiskRow(state, store, bucket, selectionThreshold.selection);
      if (!row) continue;
      bucketRows.push(row);
      if (row.riskType === 'loss') lossCount++;
      else if (row.riskType === 'lowProfit') lowProfitCount++;
      else safeCount++;
      worstProfit = worstProfit === null ? row.worstProfit : Math.min(worstProfit, row.worstProfit);
    }
  }
  return {
    bucketRows: bucketRows.sort(sortBucketRiskRows),
    nearBucketRows: nearBucketRows.sort(sortNearTriggerBucketRows),
    lossCount,
    lowProfitCount,
    safeCount,
    worstProfit
  };
}

export function buildJingdongNearTriggerRowsFromActivityBaseRows(
  state: CalculatorState,
  baseRows: ActivityBaseComboRow[],
  targetSelection: JingdongCouponSelection,
  targetThreshold: number,
  nearMin: number,
  nearMax: number,
  maxRows = DEFAULT_COUPON_TEST_ROW_LIMIT
): JingdongCouponNearTriggerRow[] {
  const store = currentStoreFrom(state);
  const productIndexById = new Map(store.products.map((product, index) => [product.id, index]));
  const limit = Math.max(1, Math.floor(Number(maxRows) || DEFAULT_COUPON_TEST_ROW_LIMIT));
  const rows: JingdongCouponNearTriggerRow[] = [];
  for (const baseRow of baseRows) {
    if (baseRow.platform !== JINGDONG_PLATFORM) continue;
    const qtys = Array.from({ length: store.products.length }, () => 0);
    for (const item of baseRow.items || []) {
      const index = productIndexById.get(item.productId);
      if (index === undefined) continue;
      qtys[index] += Math.max(0, Math.floor(Number(item.qty) || 0));
    }
    if (!qtys.some(qty => qty > 0)) continue;
    const context = buildJingdongComboContext(store, qtys);
    if (!context) continue;
    if (context.afterStoreDiscount + 1e-9 < nearMin || context.afterStoreDiscount > nearMax + 1e-9) continue;
    if (context.afterStoreDiscount + 1e-9 >= targetThreshold) continue;
    rememberLimitedRow(rows, buildNearTriggerRow(context, targetSelection, targetThreshold), limit, sortNearTriggerRows);
  }
  return rows
    .sort(sortNearTriggerRows)
    .slice(0, limit)
    .map(row => ({ ...row, addOnSuggestions: buildAddOnSuggestions(store, row) }));
}

export async function runJingdongSubsidyAnalysis(
  state: CalculatorState,
  onProgress?: (progress: CalculationProgress) => void,
  limits?: JingdongSubsidyAnalysisLimits
): Promise<JingdongSubsidyAnalysisResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeJingdongMaxDuration(limits?.maxDurationMs);
  const couponScanMode = limits?.couponScanMode || 'settlement';
  const store = currentStoreFrom(state);
  const activity = store.activities[JINGDONG_PLATFORM];
  const warnings: string[] = [];
  const couponRows = activity.jingdongSubsidyCoupons || [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先维护商品。');
  if (!store.products.some(product => PlatformUtils.isListed(product, JINGDONG_PLATFORM))) warnings.push('当前门店没有京东上架商品。');
  if (!couponRows.some(row => row.enabled && couponEffectiveAmount(row) > 0)) warnings.push('当前没有启用的京东补贴券。');

  const sourcePools = jingdongComboPoolsFromActivityScan(limits?.scanComboPools);
  const originalPriceBuckets = jingdongOriginalPriceBuckets(limits?.originalPriceBuckets);
  if (originalPriceBuckets.length) {
    const bucketResult = buildBucketRiskRows(state, store, originalPriceBuckets, couponScanMode);
    const comboCount = originalPriceBuckets.reduce((sum, bucket) => sum + Math.max(0, Math.floor(Number(bucket.comboCount) || 0)), 0);
    const elapsedTime = Math.round(calculationNow() - startedAt);
    if ((activity.discountActivities || []).some(row => row.enabled)) {
      warnings.push('主表基于活动设计原价桶汇总，商品级特价按桶均值估算；点开组合明细会按具体商品组合重新复核。');
    }
    if (limits?.scanComboPools && !sourcePools) warnings.push('活动设计扫描缓存中没有京东组合池，主表可用汇总桶，但暂时无法展开完整组合明细。');
    onProgress?.({
      resultCount: bucketResult.rows.length,
      comboCount,
      validComboCount: comboCount
    });
    return {
      rows: [],
      bucketRows: bucketResult.rows,
      warnings,
      summary: {
        resultCount: bucketResult.rows.length,
        comboCount,
        validComboCount: comboCount,
        lossCount: bucketResult.lossCount,
        lowProfitCount: bucketResult.lowProfitCount,
        safeCount: bucketResult.safeCount,
        worstProfit: bucketResult.worstProfit,
        displayedResultCount: bucketResult.rows.length,
        bucketCount: originalPriceBuckets.length,
        bucketResultCount: bucketResult.rows.length,
        displayedBucketResultCount: bucketResult.rows.length,
        source: 'bucketSummary',
        elapsedTime
      }
    };
  }
  if (limits?.scanComboPools && !sourcePools) warnings.push('活动设计扫描缓存中没有京东组合池，本次按京东商品现算组合。');

  const rows: JingdongSubsidyAnalysisRow[] = [];
  const comboContextCacheKey = activityContextSignature(store);
  const comboContexts: JingdongComboContext[] = [];
  const couponSelectionCache = new Map<string, JingdongCouponSelection[]>();
  let checked = 0;
  let validCombos = 0;
  let resultCount = 0;
  let lossCount = 0;
  let lowProfitCount = 0;
  let safeCount = 0;
  let worstProfit: number | null = null;
  let comboContextCacheLimited = false;
  const enumeration = await enumerateJingdongCombosByOriginalAsync(
    store,
    maxDurationMs,
    startedAt,
    qtys => {
      const context = buildJingdongComboContext(store, qtys);
      if (!context) return;
      if (comboContexts.length < DEFAULT_COMBO_CONTEXT_CACHE_LIMIT) {
        comboContexts.push(context);
      } else {
        comboContextCacheLimited = true;
      }
      const selectionCacheKey = `${couponScanMode}:${roundMoney(context.afterStoreDiscount)}`;
      let selections = couponSelectionCache.get(selectionCacheKey);
      if (!selections) {
        selections = buildJingdongCouponSelections(couponRows, context.afterStoreDiscount, couponScanMode);
        couponSelectionCache.set(selectionCacheKey, selections);
      }
      for (const selection of selections) {
        const row = createAnalysisRow(state, store, context, selection);
        if (!row) continue;
        resultCount++;
        if (row.riskType === 'loss') lossCount++;
        else if (row.riskType === 'lowProfit') lowProfitCount++;
        else safeCount++;
        worstProfit = worstProfit === null ? row.profit : Math.min(worstProfit, row.profit);
        rememberLimitedRow(rows, row, DEFAULT_ANALYSIS_ROW_LIMIT, sortAnalysisRows);
      }
    },
    progress => {
      checked = progress.checked;
      validCombos = progress.validCombos;
      onProgress?.({
        resultCount,
        comboCount: progress.checked,
        validComboCount: progress.validCombos
      });
    },
    undefined,
    sourcePools
  );
  checked = enumeration.checked;
  validCombos = enumeration.validCombos;
  rememberComboContextCache({
    key: comboContextCacheKey,
    contexts: comboContexts,
    checked,
    validCombos,
    complete: !enumeration.stopped && !comboContextCacheLimited
  });
  const stopWarning = calculationStopWarning(enumeration, store.maxChecks, maxDurationMs);
  if (stopWarning) warnings.push(stopWarning);

  const sortedRows = rows.sort(sortAnalysisRows).slice(0, DEFAULT_ANALYSIS_ROW_LIMIT);
  if (resultCount > sortedRows.length) warnings.push(`券组合明细较多，当前只保留风险排序前 ${DEFAULT_ANALYSIS_ROW_LIMIT} 条，统计数仍按已扫描组合汇总。`);
  const elapsedTime = Math.round(calculationNow() - startedAt);
  onProgress?.({ resultCount, comboCount: checked, validComboCount: validCombos });
  return {
    rows: sortedRows,
    warnings,
    summary: {
      resultCount,
      comboCount: checked,
      validComboCount: validCombos,
      lossCount,
      lowProfitCount,
      safeCount,
      worstProfit,
      displayedResultCount: sortedRows.length,
      source: 'comboDetail',
      elapsedTime
    }
  };
}

export async function runJingdongCouponTestAnalysis(
  state: CalculatorState,
  options: JingdongCouponTestOptions,
  onProgress?: (progress: CalculationProgress) => void,
  limits?: JingdongCouponTestLimits
): Promise<JingdongCouponTestResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeJingdongMaxDuration(limits?.maxDurationMs);
  const store = currentStoreFrom(state);
  const activity = store.activities[JINGDONG_PLATFORM];
  const warnings: string[] = [];
  const targetCoupon = options.targetCoupon;
  const nearBefore = Math.max(0, Number(options.nearBefore) || DEFAULT_COUPON_TEST_NEAR_BEFORE);
  const nearAfter = Math.max(0, Number(options.nearAfter) || DEFAULT_COUPON_TEST_NEAR_AFTER);
  const maxRows = Math.max(1, Math.floor(Number(options.maxRows) || DEFAULT_COUPON_TEST_ROW_LIMIT));
  const maxChecks = normalizedStoreMaxChecks(store);
  const sourcePools = jingdongComboPoolsFromActivityScan(limits?.scanComboPools);
  const originalPriceBuckets = jingdongOriginalPriceBuckets(limits?.originalPriceBuckets);
  const selections = buildCouponTestSelections(targetCoupon, activity.jingdongSubsidyCoupons || [], options.selectedSmallCoupons || []);
  const selectionThresholds = selections.map(selection => ({
    selection,
    threshold: selectionTriggerThreshold(selection),
    min: Math.max(0, roundMoney(selectionTriggerThreshold(selection) - nearBefore)),
    max: roundMoney(selectionTriggerThreshold(selection) + nearAfter)
  }));
  const globalMin = selectionThresholds.length ? Math.min(...selectionThresholds.map(row => row.min)) : 0;
  const globalMax = selectionThresholds.length ? Math.max(...selectionThresholds.map(row => row.max)) : 0;

  if (!store.products.length) warnings.push('当前门店没有有效商品，请先维护商品。');
  if (!store.products.some(product => PlatformUtils.isListed(product, JINGDONG_PLATFORM))) warnings.push('当前门店没有京东上架商品。');
  if (!selections.length) warnings.push('当前券没有有效优惠金额，无法测试。');

  if (selections.length && originalPriceBuckets.length) {
    const bucketResult = buildCouponTestBucketRows(state, store, originalPriceBuckets, selectionThresholds);
    const comboCount = originalPriceBuckets.reduce((sum, bucket) => sum + Math.max(0, Math.floor(Number(bucket.comboCount) || 0)), 0);
    const bucketRows = bucketResult.bucketRows.slice(0, maxRows);
    const nearBucketRows = bucketResult.nearBucketRows.slice(0, maxRows);
    const elapsedTime = Math.round(calculationNow() - startedAt);
    if ((activity.discountActivities || []).some(row => row.enabled)) {
      warnings.push('单券测试基于活动设计原价桶汇总，商品级特价按桶均值估算；点开组合明细会按具体商品组合重新复核。');
    }
    if (limits?.scanComboPools && !sourcePools) warnings.push('活动设计扫描缓存中没有京东组合池，单券测试主表可用汇总桶，但暂时无法展开完整组合明细。');
    if (bucketResult.bucketRows.length > bucketRows.length) warnings.push(`命中原价桶较多，当前只展示风险排序前 ${maxRows} 条。`);
    if (bucketResult.nearBucketRows.length > nearBucketRows.length) warnings.push(`接近触发原价桶较多，当前只展示距离最近的 ${maxRows} 条。`);
    onProgress?.({
      resultCount: bucketResult.bucketRows.length + bucketResult.nearBucketRows.length,
      comboCount,
      validComboCount: comboCount
    });
    return {
      targetCoupon,
      selections,
      rows: [],
      nearRows: [],
      bucketRows,
      nearBucketRows,
      warnings,
      summary: {
        resultCount: bucketResult.bucketRows.length + bucketResult.nearBucketRows.length,
        comboCount,
        validComboCount: comboCount,
        eligibleCount: bucketResult.bucketRows.length,
        nearTriggerCount: bucketResult.nearBucketRows.length,
        lossCount: bucketResult.lossCount,
        lowProfitCount: bucketResult.lowProfitCount,
        safeCount: bucketResult.safeCount,
        worstProfit: bucketResult.worstProfit,
        displayedResultCount: bucketRows.length,
        displayedNearTriggerCount: nearBucketRows.length,
        bucketCount: originalPriceBuckets.length,
        eligibleBucketCount: bucketResult.bucketRows.length,
        nearTriggerBucketCount: bucketResult.nearBucketRows.length,
        displayedEligibleBucketCount: bucketRows.length,
        displayedNearTriggerBucketCount: nearBucketRows.length,
        source: 'bucketSummary',
        elapsedTime
      }
    };
  }

  const rows: JingdongSubsidyAnalysisRow[] = [];
  const nearRows: JingdongCouponNearTriggerRow[] = [];
  let checked = 0;
  let validCombos = 0;
  let eligibleCount = 0;
  let nearTriggerCount = 0;
  let lossCount = 0;
  let lowProfitCount = 0;
  let safeCount = 0;
  let worstProfit: number | null = null;
  let couponValidationChecks = 0;
  let stoppedByMaxChecks = false;

  const visitCouponTestContext = (context: JingdongComboContext) => {
    if (stoppedByMaxChecks) return;
    if (context.afterStoreDiscount + 1e-9 < globalMin || context.afterStoreDiscount > globalMax + 1e-9) return;
    for (const selectionThreshold of selectionThresholds) {
      if (stoppedByMaxChecks) break;
      const { selection, threshold, min, max } = selectionThreshold;
      if (context.afterStoreDiscount + 1e-9 < min || context.afterStoreDiscount > max + 1e-9) continue;
      couponValidationChecks++;
      if (couponValidationChecks > maxChecks) {
        stoppedByMaxChecks = true;
        break;
      }
      if (context.afterStoreDiscount + 1e-9 >= threshold) {
        const row = createAnalysisRow(state, store, context, selection);
        if (!row) continue;
        eligibleCount++;
        if (row.riskType === 'loss') lossCount++;
        else if (row.riskType === 'lowProfit') lowProfitCount++;
        else safeCount++;
        worstProfit = worstProfit === null ? row.profit : Math.min(worstProfit, row.profit);
        rememberLimitedRow(rows, row, maxRows, sortAnalysisRows);
        continue;
      }
      nearTriggerCount++;
      rememberLimitedRow(nearRows, buildNearTriggerRow(context, selection, threshold), maxRows, sortNearTriggerRows);
    }
  };

  if (selections.length) {
    const cachedContexts = getComboContextCache(store);
    const shouldUseCachedContexts = Boolean(cachedContexts?.contexts.length && (cachedContexts.complete || !sourcePools));
    if (shouldUseCachedContexts && cachedContexts) {
      checked = cachedContexts.checked;
      validCombos = cachedContexts.validCombos;
      if (!cachedContexts.complete) warnings.push('正在复用上次未完整枚举的组合数据，结果可能遗漏未扫到的商品组合。');
      const candidateContexts = comboContextsInCouponBasisRange(cachedContexts.contexts, globalMin, globalMax);
      let visitedContexts = 0;
      let stoppedByDuration = false;
      let lastYieldAt = calculationNow();
      let lastProgressAt = calculationNow();
      for (const context of candidateContexts) {
        visitCouponTestContext(context);
        if (stoppedByMaxChecks) break;
        visitedContexts++;
        const now = calculationNow();
        if (isJingdongDurationExceeded(startedAt, maxDurationMs, now)) {
          stoppedByDuration = true;
          break;
        }
        if (visitedContexts % 1000 !== 0 && now - lastYieldAt < 16) continue;
        lastYieldAt = now;
        if (onProgress && now - lastProgressAt >= 120) {
          lastProgressAt = now;
          onProgress({
            resultCount: eligibleCount + nearTriggerCount,
            comboCount: checked,
            validComboCount: validCombos
          });
        }
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      if (stoppedByMaxChecks) warnings.push(`已达到最多检查组合数 ${maxChecks}，已停止继续验证。`);
      if (stoppedByDuration) warnings.push(`复用组合数据验证已达到最长计算时间 ${Math.round(maxDurationMs / 1000)} 秒，已停止继续验证。`);
    } else if (sourcePools) {
      if (cachedContexts?.contexts.length && !cachedContexts.complete) warnings.push('上次京东主测算的快速测试缓存不完整，本次改用活动设计原价组合池验证。');
      const enumeration = await enumerateJingdongCombosByOriginalAsync(
        store,
        maxDurationMs,
        startedAt,
        qtys => {
          const context = buildJingdongComboContext(store, qtys);
          if (!context) return;
          visitCouponTestContext(context);
        },
        progress => {
          checked = progress.checked;
          validCombos = progress.validCombos;
          onProgress?.({
            resultCount: eligibleCount + nearTriggerCount,
            comboCount: progress.checked,
            validComboCount: progress.validCombos
          });
        },
        () => stoppedByMaxChecks,
        sourcePools
      );
      checked = enumeration.checked;
      validCombos = enumeration.validCombos;
      const stopWarning = calculationStopWarning(enumeration, store.maxChecks, maxDurationMs);
      if (stoppedByMaxChecks) warnings.push(`已达到最多检查组合数 ${maxChecks}，已停止继续验证。`);
      else if (stopWarning) warnings.push(stopWarning);
    } else {
      if (options.reuseOnly) {
        warnings.push('未找到可复用的京东组合数据，请先运行一次“生成券组合测算”，再测试单张券。');
      } else {
        warnings.push('未找到可复用的京东组合数据，本次已临时枚举；先运行一次主测算后，单券测试会直接复用组合数据。');
      }
      if (options.reuseOnly) {
        onProgress?.({ resultCount: 0, comboCount: 0, validComboCount: 0 });
      } else {
        const comboContextCacheKey = activityContextSignature(store);
        const comboContexts: JingdongComboContext[] = [];
        let comboContextCacheLimited = false;
        const enumeration = await enumerateJingdongCombosByOriginalAsync(
          store,
          maxDurationMs,
          startedAt,
          qtys => {
            const context = buildJingdongComboContext(store, qtys);
            if (!context) return;
            if (comboContexts.length < DEFAULT_COMBO_CONTEXT_CACHE_LIMIT) {
              comboContexts.push(context);
            } else {
              comboContextCacheLimited = true;
            }
            visitCouponTestContext(context);
          },
          progress => {
            checked = progress.checked;
            validCombos = progress.validCombos;
            onProgress?.({
              resultCount: eligibleCount + nearTriggerCount,
              comboCount: progress.checked,
              validComboCount: progress.validCombos
            });
          },
          () => stoppedByMaxChecks
        );
        checked = enumeration.checked;
        validCombos = enumeration.validCombos;
        rememberComboContextCache({
          key: comboContextCacheKey,
          contexts: comboContexts,
          checked,
          validCombos,
          complete: !enumeration.stopped && !comboContextCacheLimited
        });
        const stopWarning = calculationStopWarning(enumeration, store.maxChecks, maxDurationMs);
        if (stoppedByMaxChecks) warnings.push(`已达到最多检查组合数 ${maxChecks}，已停止继续验证。`);
        else if (stopWarning) warnings.push(stopWarning);
      }
    }
  }

  const sortedRows = rows.sort(sortAnalysisRows).slice(0, maxRows);
  const sortedNearRows = nearRows
    .sort(sortNearTriggerRows)
    .slice(0, maxRows)
    .map(row => ({ ...row, addOnSuggestions: buildAddOnSuggestions(store, row) }));
  const elapsedTime = Math.round(calculationNow() - startedAt);
  onProgress?.({ resultCount: eligibleCount + nearTriggerCount, comboCount: checked, validComboCount: validCombos });

  return {
    targetCoupon,
    selections,
    rows: sortedRows,
    nearRows: sortedNearRows,
    warnings,
    summary: {
      resultCount: eligibleCount + nearTriggerCount,
      comboCount: checked,
      validComboCount: validCombos,
      eligibleCount,
      nearTriggerCount,
      lossCount,
      lowProfitCount,
      safeCount,
      worstProfit,
      displayedResultCount: sortedRows.length,
      displayedNearTriggerCount: sortedNearRows.length,
      elapsedTime
    }
  };
}
