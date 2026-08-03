import type { Platform } from '../../types';
import { roundMoney } from '../../money';

export type WeightedPriceBucketComboInput = {
  comboKey: string;
  platform: Platform;
  count?: number;
  originalTotal: number;
  finalPay: number;
  cost: number;
  minCost?: number | null;
  maxCost?: number | null;
  profit: number;
  netPay: number;
  profitRate: number | null;
  activityTargetDiscountRate?: number | null;
  activityTargetPay?: number | null;
  activityTargetPayGap?: number | null;
  activityTargetDiscountAmount?: number | null;
  activityAlreadyDiscountAmount?: number | null;
  activityRedAddOnAmount?: number | null;
  activityDesignSpace?: number | null;
  activityNetPayBoundarySpace?: number | null;
  activitySafeDiscountSpace?: number | null;
  /** 内部权重字段。原价扫描默认使用组合明细数量。 */
  weight?: number;
  hasRisk?: boolean;
  isOutlier?: boolean;
};

export type WeightedPriceBucketAccumulator = {
  key: string;
  platform: Platform;
  priceBucket: number;
  min: number;
  max: number;
  comboCount: number;
  weightedComboCount: number;
  originalTotalSum: number;
  finalPaySum: number;
  netPaySum: number;
  activityTargetDiscountRateSum: number;
  activityTargetDiscountRateCount: number;
  activityTargetPaySum: number;
  activityTargetPayGapSum: number;
  activityTargetDiscountAmountSum: number;
  activityAlreadyDiscountAmountSum: number;
  activityRedAddOnAmountSum: number;
  activityDesignSpaceSum: number;
  activityNetPayBoundarySpaceSum: number;
  activitySafeDiscountSpaceSum: number;
  costSum: number;
  minCost: number | null;
  maxCost: number | null;
  profitSum: number;
  weightedFinalPaySum: number;
  weightedActivityTargetDiscountRateSum: number;
  weightedActivityTargetPaySum: number;
  weightedActivityTargetPayGapSum: number;
  weightedActivityTargetDiscountAmountSum: number;
  weightedActivityAlreadyDiscountAmountSum: number;
  weightedActivityRedAddOnAmountSum: number;
  weightedActivityDesignSpaceSum: number;
  weightedActivityNetPayBoundarySpaceSum: number;
  weightedActivitySafeDiscountSpaceSum: number;
  weightedCostSum: number;
  weightedProfitSum: number;
  weightedNetPaySum: number;
  profitRateSum: number;
  profitRateCount: number;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  riskCount: number;
  outlierCount: number;
};

export type WeightedPriceBucketSummary = {
  key: string;
  platform: Platform;
  priceBucket: number;
  min: number;
  max: number;
  comboCount: number;
  weightedComboCount: number;
  avgOriginalTotal: number;
  avgFinalPay: number;
  avgNetPay: number;
  avgCost: number;
  minCost: number | null;
  maxCost: number | null;
  costSpread: number | null;
  avgProfit: number;
  weightedAvgFinalPay: number;
  weightedAvgNetPay: number;
  avgActivityTargetDiscountRate: number | null;
  weightedAvgActivityTargetDiscountRate: number | null;
  avgActivityTargetPay: number;
  weightedAvgActivityTargetPay: number;
  avgActivityTargetPayGap: number;
  weightedAvgActivityTargetPayGap: number;
  avgActivityTargetDiscountAmount: number;
  weightedAvgActivityTargetDiscountAmount: number;
  avgActivityAlreadyDiscountAmount: number;
  weightedAvgActivityAlreadyDiscountAmount: number;
  avgActivityRedAddOnAmount: number;
  weightedAvgActivityRedAddOnAmount: number;
  avgActivityDesignSpace: number;
  weightedAvgActivityDesignSpace: number;
  avgActivityNetPayBoundarySpace: number;
  weightedAvgActivityNetPayBoundarySpace: number;
  avgActivitySafeDiscountSpace: number;
  weightedAvgActivitySafeDiscountSpace: number;
  weightedAvgCost: number;
  weightedAvgProfit: number;
  weightedProfitRate: number | null;
  avgProfitRate: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  profitRateSpread: number | null;
  riskCount: number;
  outlierCount: number;
};

/**
 * 计算原价整数桶。
 *
 * @param originalTotal 商品组合原价小计。
 * @returns 原价整数桶，例如 25 表示 25 <= 原价 < 26。
 */
export function priceIntegerBucket(originalTotal: number) {
  return Math.max(0, Math.floor(Number(originalTotal) || 0));
}

/**
 * 返回原价整数桶覆盖的价格范围。
 *
 * @param bucket 原价整数桶。
 * @returns 当前桶的最小值和最大值，最大值为开区间边界。
 */
export function priceIntegerBucketRange(bucket: number) {
  const min = Math.max(0, Math.floor(Number(bucket) || 0));
  return { min, max: min + 1 };
}

/**
 * 判断价格是否落在活动门槛窗口内。
 *
 * @param price 商品组合原价或支付价。
 * @param threshold 活动门槛。
 * @param windowSize 门槛窗口长度，例如 5 表示 threshold <= price < threshold + 5。
 * @returns 若价格落入门槛窗口返回 true。
 */
export function isPriceInThresholdWindow(price: number, threshold: number, windowSize: number) {
  const safeThreshold = Math.max(0, Number(threshold) || 0);
  const safeWindowSize = Math.max(0, Number(windowSize) || 0);
  return price + 1e-9 >= safeThreshold && price < safeThreshold + safeWindowSize;
}

/**
 * 规范化组合明细数量。
 *
 * @param weight 输入数量，空值或非法值使用默认数量。
 * @param fallback 默认数量，默认值为 1。
 * @returns 非负数量。
 */
export function normalizeComboCount(valueLike: unknown, fallback = 1) {
  const value = Number(valueLike);
  if (!Number.isFinite(value)) return Math.max(0, fallback);
  return Math.max(0, value);
}

/**
 * 创建原价整数桶聚合器。
 *
 * @param platform 当前平台。
 * @param priceBucket 原价整数桶。
 * @returns 初始化后的聚合器。
 */
export function createWeightedPriceBucketAccumulator(platform: Platform, priceBucket: number): WeightedPriceBucketAccumulator {
  const range = priceIntegerBucketRange(priceBucket);
  return {
    key: ['original-price-bucket', platform, range.min].join('::'),
    platform,
    priceBucket: range.min,
    min: range.min,
    max: range.max,
    comboCount: 0,
    weightedComboCount: 0,
    originalTotalSum: 0,
    finalPaySum: 0,
    netPaySum: 0,
    activityTargetDiscountRateSum: 0,
    activityTargetDiscountRateCount: 0,
    activityTargetPaySum: 0,
    activityTargetPayGapSum: 0,
    activityTargetDiscountAmountSum: 0,
    activityAlreadyDiscountAmountSum: 0,
    activityRedAddOnAmountSum: 0,
    activityDesignSpaceSum: 0,
    activityNetPayBoundarySpaceSum: 0,
    activitySafeDiscountSpaceSum: 0,
    costSum: 0,
    minCost: null,
    maxCost: null,
    profitSum: 0,
    weightedFinalPaySum: 0,
    weightedActivityTargetDiscountRateSum: 0,
    weightedActivityTargetPaySum: 0,
    weightedActivityTargetPayGapSum: 0,
    weightedActivityTargetDiscountAmountSum: 0,
    weightedActivityAlreadyDiscountAmountSum: 0,
    weightedActivityRedAddOnAmountSum: 0,
    weightedActivityDesignSpaceSum: 0,
    weightedActivityNetPayBoundarySpaceSum: 0,
    weightedActivitySafeDiscountSpaceSum: 0,
    weightedCostSum: 0,
    weightedProfitSum: 0,
    weightedNetPaySum: 0,
    profitRateSum: 0,
    profitRateCount: 0,
    minProfitRate: null,
    maxProfitRate: null,
    riskCount: 0,
    outlierCount: 0
  };
}

/**
 * 向原价整数桶聚合器追加一个商品组合。
 *
 * @param accumulator 当前整数桶聚合器。
 * @param combo 商品组合基础数据和明细数量。
 * @returns 追加后的同一个聚合器实例。
 */
export function addWeightedComboToBucket(
  accumulator: WeightedPriceBucketAccumulator,
  combo: WeightedPriceBucketComboInput
) {
  const count = Math.max(1, Math.floor(Number(combo.count) || 1));
  const bucketCount = normalizeComboCount(combo.weight, count);
  accumulator.comboCount += count;
  accumulator.weightedComboCount += bucketCount;
  accumulator.originalTotalSum += (Number(combo.originalTotal) || 0) * count;
  accumulator.finalPaySum += Math.max(0, Number(combo.finalPay) || 0) * count;
  accumulator.netPaySum += Math.max(0, Number(combo.netPay) || 0) * count;
  const targetDiscountRate = combo.activityTargetDiscountRate === null || combo.activityTargetDiscountRate === undefined
    ? null
    : Number(combo.activityTargetDiscountRate);
  const targetPay = combo.activityTargetPay === null || combo.activityTargetPay === undefined
    ? null
    : Math.max(0, Number(combo.activityTargetPay) || 0);
  const targetPayGap = combo.activityTargetPayGap === null || combo.activityTargetPayGap === undefined
    ? null
    : Number(combo.activityTargetPayGap);
  const targetDiscountAmount = combo.activityTargetDiscountAmount === null || combo.activityTargetDiscountAmount === undefined
    ? null
    : Math.max(0, Number(combo.activityTargetDiscountAmount) || 0);
  const alreadyDiscountAmount = combo.activityAlreadyDiscountAmount === null || combo.activityAlreadyDiscountAmount === undefined
    ? null
    : Math.max(0, Number(combo.activityAlreadyDiscountAmount) || 0);
  const redAddOnAmount = combo.activityRedAddOnAmount === null || combo.activityRedAddOnAmount === undefined
    ? null
    : Math.max(0, Number(combo.activityRedAddOnAmount) || 0);
  const designSpace = combo.activityDesignSpace === null || combo.activityDesignSpace === undefined
    ? null
    : Math.max(0, Number(combo.activityDesignSpace) || 0);
  const netPayBoundarySpace = combo.activityNetPayBoundarySpace === null || combo.activityNetPayBoundarySpace === undefined
    ? null
    : Math.max(0, Number(combo.activityNetPayBoundarySpace) || 0);
  const safeDiscountSpace = combo.activitySafeDiscountSpace === null || combo.activitySafeDiscountSpace === undefined
    ? null
    : Math.max(0, Number(combo.activitySafeDiscountSpace) || 0);
  if (targetDiscountRate !== null && Number.isFinite(targetDiscountRate)) {
    accumulator.activityTargetDiscountRateSum += targetDiscountRate * count;
    accumulator.activityTargetDiscountRateCount += count;
    accumulator.weightedActivityTargetDiscountRateSum += targetDiscountRate * bucketCount;
  }
  if (targetPay !== null && Number.isFinite(targetPay)) {
    accumulator.activityTargetPaySum += targetPay * count;
    accumulator.weightedActivityTargetPaySum += targetPay * bucketCount;
  }
  if (targetPayGap !== null && Number.isFinite(targetPayGap)) {
    accumulator.activityTargetPayGapSum += targetPayGap * count;
    accumulator.weightedActivityTargetPayGapSum += targetPayGap * bucketCount;
  }
  if (targetDiscountAmount !== null && Number.isFinite(targetDiscountAmount)) {
    accumulator.activityTargetDiscountAmountSum += targetDiscountAmount * count;
    accumulator.weightedActivityTargetDiscountAmountSum += targetDiscountAmount * bucketCount;
  }
  if (alreadyDiscountAmount !== null && Number.isFinite(alreadyDiscountAmount)) {
    accumulator.activityAlreadyDiscountAmountSum += alreadyDiscountAmount * count;
    accumulator.weightedActivityAlreadyDiscountAmountSum += alreadyDiscountAmount * bucketCount;
  }
  if (redAddOnAmount !== null && Number.isFinite(redAddOnAmount)) {
    accumulator.activityRedAddOnAmountSum += redAddOnAmount * count;
    accumulator.weightedActivityRedAddOnAmountSum += redAddOnAmount * bucketCount;
  }
  if (designSpace !== null && Number.isFinite(designSpace)) {
    accumulator.activityDesignSpaceSum += designSpace * count;
    accumulator.weightedActivityDesignSpaceSum += designSpace * bucketCount;
  }
  if (netPayBoundarySpace !== null && Number.isFinite(netPayBoundarySpace)) {
    accumulator.activityNetPayBoundarySpaceSum += netPayBoundarySpace * count;
    accumulator.weightedActivityNetPayBoundarySpaceSum += netPayBoundarySpace * bucketCount;
  }
  if (safeDiscountSpace !== null && Number.isFinite(safeDiscountSpace)) {
    accumulator.activitySafeDiscountSpaceSum += safeDiscountSpace * count;
    accumulator.weightedActivitySafeDiscountSpaceSum += safeDiscountSpace * bucketCount;
  }
  const cost = Number(combo.cost) || 0;
  const minCost = combo.minCost === null || combo.minCost === undefined
    ? cost
    : Number(combo.minCost) || 0;
  const maxCost = combo.maxCost === null || combo.maxCost === undefined
    ? cost
    : Number(combo.maxCost) || 0;
  accumulator.costSum += cost * count;
  accumulator.minCost = accumulator.minCost === null ? minCost : Math.min(accumulator.minCost, minCost);
  accumulator.maxCost = accumulator.maxCost === null ? maxCost : Math.max(accumulator.maxCost, maxCost);
  accumulator.profitSum += (Number(combo.profit) || 0) * count;
  accumulator.weightedFinalPaySum += Math.max(0, Number(combo.finalPay) || 0) * bucketCount;
  accumulator.weightedCostSum += cost * bucketCount;
  accumulator.weightedProfitSum += (Number(combo.profit) || 0) * bucketCount;
  accumulator.weightedNetPaySum += Math.max(0, Number(combo.netPay) || 0) * bucketCount;
  if (combo.profitRate !== null && Number.isFinite(combo.profitRate)) {
    accumulator.profitRateSum += combo.profitRate * count;
    accumulator.profitRateCount += count;
    accumulator.minProfitRate = accumulator.minProfitRate === null
      ? combo.profitRate
      : Math.min(accumulator.minProfitRate, combo.profitRate);
    accumulator.maxProfitRate = accumulator.maxProfitRate === null
      ? combo.profitRate
      : Math.max(accumulator.maxProfitRate, combo.profitRate);
  }
  if (combo.hasRisk) accumulator.riskCount += count;
  if (combo.isOutlier) accumulator.outlierCount += count;
  return accumulator;
}

/**
 * 将原价整数桶聚合器转换为页面和任务可消费的摘要。
 *
 * @param accumulator 当前整数桶聚合器。
 * @returns 聚合后的原价整数桶摘要。
 */
export function finalizeWeightedPriceBucket(accumulator: WeightedPriceBucketAccumulator): WeightedPriceBucketSummary {
  const count = accumulator.comboCount || 1;
  const weightedCount = accumulator.weightedComboCount || 0;
  const avgProfitRate = accumulator.profitRateCount
    ? accumulator.profitRateSum / accumulator.profitRateCount
    : null;
  const profitRateSpread = accumulator.minProfitRate !== null && accumulator.maxProfitRate !== null
    ? accumulator.maxProfitRate - accumulator.minProfitRate
    : null;
  return {
    key: accumulator.key,
    platform: accumulator.platform,
    priceBucket: accumulator.priceBucket,
    min: accumulator.min,
    max: accumulator.max,
    comboCount: accumulator.comboCount,
    weightedComboCount: roundMoney(accumulator.weightedComboCount),
    avgOriginalTotal: roundMoney(accumulator.originalTotalSum / count),
    avgFinalPay: roundMoney(accumulator.finalPaySum / count),
    avgNetPay: roundMoney(accumulator.netPaySum / count),
    avgActivityTargetDiscountRate: accumulator.activityTargetDiscountRateCount
      ? accumulator.activityTargetDiscountRateSum / accumulator.activityTargetDiscountRateCount
      : null,
    weightedAvgActivityTargetDiscountRate: weightedCount > 0 && accumulator.weightedActivityTargetDiscountRateSum > 0
      ? accumulator.weightedActivityTargetDiscountRateSum / weightedCount
      : accumulator.activityTargetDiscountRateCount ? accumulator.activityTargetDiscountRateSum / accumulator.activityTargetDiscountRateCount : null,
    avgActivityTargetPay: roundMoney(accumulator.activityTargetPaySum / count),
    weightedAvgActivityTargetPay: weightedCount > 0 ? roundMoney(accumulator.weightedActivityTargetPaySum / weightedCount) : 0,
    avgActivityTargetPayGap: roundMoney(accumulator.activityTargetPayGapSum / count),
    weightedAvgActivityTargetPayGap: weightedCount > 0 ? roundMoney(accumulator.weightedActivityTargetPayGapSum / weightedCount) : 0,
    avgActivityTargetDiscountAmount: roundMoney(accumulator.activityTargetDiscountAmountSum / count),
    weightedAvgActivityTargetDiscountAmount: weightedCount > 0 ? roundMoney(accumulator.weightedActivityTargetDiscountAmountSum / weightedCount) : 0,
    avgActivityAlreadyDiscountAmount: roundMoney(accumulator.activityAlreadyDiscountAmountSum / count),
    weightedAvgActivityAlreadyDiscountAmount: weightedCount > 0 ? roundMoney(accumulator.weightedActivityAlreadyDiscountAmountSum / weightedCount) : 0,
    avgActivityRedAddOnAmount: roundMoney(accumulator.activityRedAddOnAmountSum / count),
    weightedAvgActivityRedAddOnAmount: weightedCount > 0 ? roundMoney(accumulator.weightedActivityRedAddOnAmountSum / weightedCount) : 0,
    avgActivityDesignSpace: roundMoney(accumulator.activityDesignSpaceSum / count),
    weightedAvgActivityDesignSpace: weightedCount > 0 ? roundMoney(accumulator.weightedActivityDesignSpaceSum / weightedCount) : 0,
    avgActivityNetPayBoundarySpace: roundMoney(accumulator.activityNetPayBoundarySpaceSum / count),
    weightedAvgActivityNetPayBoundarySpace: weightedCount > 0 ? roundMoney(accumulator.weightedActivityNetPayBoundarySpaceSum / weightedCount) : 0,
    avgActivitySafeDiscountSpace: roundMoney(accumulator.activitySafeDiscountSpaceSum / count),
    weightedAvgActivitySafeDiscountSpace: weightedCount > 0 ? roundMoney(accumulator.weightedActivitySafeDiscountSpaceSum / weightedCount) : 0,
    avgCost: roundMoney(accumulator.costSum / count),
    minCost: accumulator.minCost === null ? null : roundMoney(accumulator.minCost),
    maxCost: accumulator.maxCost === null ? null : roundMoney(accumulator.maxCost),
    costSpread: accumulator.minCost === null || accumulator.maxCost === null ? null : roundMoney(accumulator.maxCost - accumulator.minCost),
    avgProfit: roundMoney(accumulator.profitSum / count),
    weightedAvgFinalPay: weightedCount > 0 ? roundMoney(accumulator.weightedFinalPaySum / weightedCount) : 0,
    weightedAvgNetPay: weightedCount > 0 ? roundMoney(accumulator.weightedNetPaySum / weightedCount) : 0,
    weightedAvgCost: weightedCount > 0 ? roundMoney(accumulator.weightedCostSum / weightedCount) : 0,
    weightedAvgProfit: weightedCount > 0 ? roundMoney(accumulator.weightedProfitSum / weightedCount) : 0,
    weightedProfitRate: accumulator.profitRateCount > 0 && accumulator.weightedFinalPaySum > 0
      ? (accumulator.weightedFinalPaySum - accumulator.weightedCostSum) / accumulator.weightedFinalPaySum
      : null,
    avgProfitRate,
    minProfitRate: accumulator.minProfitRate,
    maxProfitRate: accumulator.maxProfitRate,
    profitRateSpread,
    riskCount: accumulator.riskCount,
    outlierCount: accumulator.outlierCount
  };
}

/**
 * 按平台和原价整数桶汇总商品组合。
 *
 * @param combos 商品组合基础数据列表。
 * @returns 已按平台和价格升序排序的原价整数桶摘要列表。
 */
export function summarizeWeightedPriceBuckets(combos: WeightedPriceBucketComboInput[]) {
  const buckets = new Map<string, WeightedPriceBucketAccumulator>();
  for (const combo of combos) {
    const bucket = priceIntegerBucket(combo.originalTotal);
    const key = [combo.platform, bucket].join('::');
    const accumulator = buckets.get(key) || createWeightedPriceBucketAccumulator(combo.platform, bucket);
    addWeightedComboToBucket(accumulator, combo);
    buckets.set(key, accumulator);
  }
  return Array.from(buckets.values())
    .map(finalizeWeightedPriceBucket)
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.priceBucket - b.priceBucket);
}
