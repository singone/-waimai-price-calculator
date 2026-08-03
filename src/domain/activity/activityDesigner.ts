import type {
  ActivityBaseComboRow,
  ActivityComboSimulationRow,
  ActivityCouponBucketSuggestion,
  ActivityCouponRecommendationMode,
  ActivityCouponRecommendationPolicy,
  ActivityCouponRiskLevel,
  ActivityCouponSceneTemplate,
  ActivityDesignObjective,
  ActivityDesignResult,
  ActivityDesignSettings,
  ActivityFullAmountBasis,
  ActivityOriginalBucketRepresentativeCombo,
  ActivityOriginalDiscountTier,
  ActivityOriginalPriceBucketEntry,
  ActivityPriceBucketRow,
  ActivityRecommendationRow,
  ActivityRouteScoreBreakdown,
  ActivityRouteScoreLevel,
  ActivityScanComboPools,
  ActivityScanComboPoolRow,
  CalculatorState,
  CalculationLimits,
  CalculationProgress,
  ComboItem,
  ComboEvaluationRow,
  Coupon,
  FullReduction,
  Platform,
  PriceBandRow,
  RedAddOn,
  RedTier
} from '../types';
import {
  addWeightedComboToBucket,
  createWeightedPriceBucketAccumulator,
  finalizeWeightedPriceBucket
} from './shared';
import {
  bandKey,
  bestBaseRed,
  bestCouponOption,
  bestFullReduction,
  bestRedAddOn,
  buildFeeSummary,
  buildPlatformTotals,
  calculationTotalRange,
  calculationNow,
  calculationStopWarning,
  createComboEvaluationRow,
  currentStoreFrom,
  isMealAddOnProduct,
  isMealMainProduct,
  isProductListedOnPlatform,
  mealMainStapleServingCount,
  normalizeCalculationMaxDuration,
  platformOriginalUnitPrice,
  PLATFORM_NAMES,
  PLATFORMS
} from '../core';
import {
  buildSeparatedComboPoolsAsync,
  candidatePoolSignature,
  mergeComboQtys,
  type ComboPoolRow,
  type SeparatedComboPools
} from '../comboPools';
import { roundMoney } from '../money';

const ACTIVITY_PAY_MAX_BY_SCENARIO = {
  single: 40,
  double: 80,
  multi: 150
} as const;
const ACTIVITY_DESIGN_OBJECTIVES: ActivityDesignObjective[] = [
  'longTerm',
  'orderGrowth',
  'raiseAov',
  'hotProduct',
  'highMarginConversion',
  'profitRecovery'
];
const ACTIVITY_HIT_DETAIL_LIMIT = 5000;
const ACTIVITY_ROUTE_HIT_LIMIT_PER_REASON = 30;
const ACTIVITY_DESIGN_DEFAULT_MAX_CHECKS = 2500000;
const ACTIVITY_ROUTE_SOURCE_LIMIT_PER_PLATFORM = 6000;
const ACTIVITY_MIN_NET_PAY = 2;
const ACTIVITY_ROUTE_DESIGN_SAMPLE_LIMIT = 1600;
const ACTIVITY_ROUTE_MAX_FULL_RULES = 6;
const ACTIVITY_ROUTE_THRESHOLD_LIMIT = 180;
const ACTIVITY_FULL_REDUCTION_LOG_LIMIT = 2000;
const ACTIVITY_ROUTE_MIN_DESIGN_SPACE = 1;
const ACTIVITY_ROUTE_MIN_FULL_AMOUNT = 1;
const ACTIVITY_ROUTE_MIN_COUPON_AMOUNT = 1;
const ACTIVITY_MONEY_AMOUNT_UNIT = 0.01;
const ACTIVITY_COUPON_RECOMMEND_AMOUNT_UNIT = 0.5;
const ACTIVITY_BUSINESS_PAY_SEGMENTS = [
  { min: 0, max: 15, label: '0-15', orderShare: 0.54, weight: 1 },
  { min: 15, max: 20, label: '15-20', orderShare: 0.19, weight: 0.88 },
  { min: 20, max: 25, label: '20-25', orderShare: 0.17, weight: 0.78 },
  { min: 25, max: 30, label: '25-30', orderShare: 0.06, weight: 0.35 },
  { min: 30, max: Infinity, label: '30+', orderShare: 0.04, weight: 0.08 }
] as const;
const ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS: Record<ActivityCouponRecommendationMode, ActivityCouponRecommendationPolicy> = {
  conservative: {
    mode: 'conservative',
    amountStep: ACTIVITY_COUPON_RECOMMEND_AMOUNT_UNIT,
    minCouponAmount: ACTIVITY_ROUTE_MIN_COUPON_AMOUNT,
    nearThresholdGap: 4,
    farThresholdGap: 12,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 0,
    representativeMode: 'lowestThreshold'
  },
  balanced: {
    mode: 'balanced',
    amountStep: ACTIVITY_COUPON_RECOMMEND_AMOUNT_UNIT,
    minCouponAmount: ACTIVITY_ROUTE_MIN_COUPON_AMOUNT,
    nearThresholdGap: 5,
    farThresholdGap: 10,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 0.5,
    representativeMode: 'balanced'
  },
  aggressive: {
    mode: 'aggressive',
    amountStep: ACTIVITY_COUPON_RECOMMEND_AMOUNT_UNIT,
    minCouponAmount: ACTIVITY_ROUTE_MIN_COUPON_AMOUNT,
    nearThresholdGap: 8,
    farThresholdGap: 12,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 1,
    representativeMode: 'highestThreshold'
  }
};
const DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES: ActivityCouponSceneTemplate[] = [
  {
    key: 'raiseAov.addOnCritical',
    enabled: true,
    name: '加购引导券',
    priority: 30,
    channel: 'orderReturn',
    targetUser: 'highAov',
    objectiveKeys: ['raiseAov'],
    thresholdMode: 'addOnCritical',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 1,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 8,
    requireBoundarySafe: false,
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'orderGrowth.addOnCritical',
    enabled: true,
    name: '加购引导券',
    priority: 35,
    channel: 'inStore',
    targetUser: 'all',
    objectiveKeys: ['orderGrowth', 'hotProduct'],
    thresholdMode: 'addOnCritical',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 0.4,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 8,
    requireBoundarySafe: false,
    maxOverBucketSpace: 1,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'fullReduction.interleave',
    enabled: true,
    name: '满减补档券',
    priority: 40,
    channel: 'inStore',
    targetUser: 'highFrequency',
    objectiveKeys: [],
    thresholdMode: 'fullReductionInterleave',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 1,
    requireNearFullReduction: true,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 999,
    requireBoundarySafe: false,
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'redTier.highMarginGuide',
    enabled: true,
    name: '神券/爆红包补档券',
    priority: 45,
    channel: 'targeted',
    targetUser: 'highAov',
    objectiveKeys: ['highMarginConversion', 'profitRecovery'],
    thresholdMode: 'highMarginGuide',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 1,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: true,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 999,
    requireBoundarySafe: true,
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'retention.recall',
    enabled: true,
    name: '定向唤回券',
    priority: 60,
    channel: 'targeted',
    targetUser: 'lostCustomer',
    objectiveKeys: ['raiseAov', 'highMarginConversion'],
    thresholdMode: 'retentionRecall',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0.6,
    couponIndexRatioMax: 1,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 999,
    requireBoundarySafe: false,
    maxOverBucketSpace: 1,
    couponBudgetShare: 100,
    maxCouponCount: 4,
    maxCouponAmount: 999
  }
];
const ACTIVITY_OBJECTIVE_PAY_PROFILES: Record<ActivityDesignObjective, {
  label: string;
  min: number;
  max: number;
  coreMax: number;
  mainMax: number;
  highMin: number;
  targetPayProfitRate: number;
  minPayProfitRate: number;
  minNetProfitRate: number;
  maxLossShare: number;
  originalDiscountTiers: ActivityOriginalDiscountTier[];
  fullDiscountShare: number;
  couponDiscountShare: number;
  reserveDiscountShare: number;
  fullThresholdWindow: number;
  fullThresholdMinGap: number;
  minFullAmountIncrease: number;
  fullAmountBasis: 'average' | 'p75' | 'min' | 'max';
  maxFullRuleCount: number;
  minFullHitCount: number;
  minNetPayFloor: number;
  couponRecommendationPolicy: ActivityCouponRecommendationPolicy;
  couponScoringMode: 'conservative' | 'balanced' | 'aggressive';
  segmentWeights: number[];
}> = {
  longTerm: {
    label: '0-25 稳定主战场',
    min: 0,
    max: 25,
    coreMax: 20,
    mainMax: 25,
    highMin: 30,
    targetPayProfitRate: 35,
    minPayProfitRate: 23,
    minNetProfitRate: -5,
    maxLossShare: 8,
    originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 25 }, { originalMin: 45, originalMax: 60, discountRate: 20 }, { originalMin: 60, originalMax: 999, discountRate: 15 }],
    fullDiscountShare: 70,
    couponDiscountShare: 20,
    reserveDiscountShare: 10,
    fullThresholdWindow: 5,
    fullThresholdMinGap: 10,
    minFullAmountIncrease: 3,
    fullAmountBasis: 'average',
    maxFullRuleCount: 6,
    minFullHitCount: 3,
    minNetPayFloor: 2,
    couponRecommendationPolicy: ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.balanced,
    couponScoringMode: 'balanced',
    segmentWeights: [0.92, 1, 0.9, 0.38, 0.1]
  },
  orderGrowth: {
    label: '0-20 拉单成交区',
    min: 0,
    max: 20,
    coreMax: 20,
    mainMax: 20,
    highMin: 25,
    targetPayProfitRate: 25,
    minPayProfitRate: 7,
    minNetProfitRate: -18,
    maxLossShare: 22,
    originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 8 }, { originalMin: 30, originalMax: 45, discountRate: 30 }, { originalMin: 45, originalMax: 60, discountRate: 25 }, { originalMin: 60, originalMax: 999, discountRate: 20 }],
    fullDiscountShare: 30,
    couponDiscountShare: 60,
    reserveDiscountShare: 10,
    fullThresholdWindow: 5,
    fullThresholdMinGap: 8,
    minFullAmountIncrease: 2,
    fullAmountBasis: 'p75',
    maxFullRuleCount: 6,
    minFullHitCount: 2,
    minNetPayFloor: 2,
    couponRecommendationPolicy: ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.aggressive,
    couponScoringMode: 'aggressive',
    segmentWeights: [1, 0.82, 0.42, 0.16, 0.04]
  },
  raiseAov: {
    label: '15-25 加购提客单区',
    min: 15,
    max: 25,
    coreMax: 25,
    mainMax: 25,
    highMin: 30,
    targetPayProfitRate: 30,
    minPayProfitRate: 15,
    minNetProfitRate: -12,
    maxLossShare: 14,
    originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 28 }, { originalMin: 45, originalMax: 60, discountRate: 24 }, { originalMin: 60, originalMax: 999, discountRate: 20 }],
    fullDiscountShare: 35,
    couponDiscountShare: 55,
    reserveDiscountShare: 10,
    fullThresholdWindow: 5,
    fullThresholdMinGap: 10,
    minFullAmountIncrease: 3,
    fullAmountBasis: 'p75',
    maxFullRuleCount: 6,
    minFullHitCount: 3,
    minNetPayFloor: 2,
    couponRecommendationPolicy: ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.aggressive,
    couponScoringMode: 'aggressive',
    segmentWeights: [0.28, 0.82, 1, 0.76, 0.22]
  },
  hotProduct: {
    label: '0-18 爆品成交区',
    min: 0,
    max: 18,
    coreMax: 18,
    mainMax: 20,
    highMin: 25,
    targetPayProfitRate: 19,
    minPayProfitRate: 0,
    minNetProfitRate: -25,
    maxLossShare: 30,
    originalDiscountTiers: [{ originalMin: 0, originalMax: 15, discountRate: 10 }, { originalMin: 25, originalMax: 40, discountRate: 35 }, { originalMin: 40, originalMax: 60, discountRate: 28 }, { originalMin: 60, originalMax: 999, discountRate: 22 }],
    fullDiscountShare: 20,
    couponDiscountShare: 70,
    reserveDiscountShare: 10,
    fullThresholdWindow: 5,
    fullThresholdMinGap: 8,
    minFullAmountIncrease: 2,
    fullAmountBasis: 'p75',
    maxFullRuleCount: 6,
    minFullHitCount: 2,
    minNetPayFloor: 2,
    couponRecommendationPolicy: ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.aggressive,
    couponScoringMode: 'aggressive',
    segmentWeights: [1, 0.72, 0.24, 0.08, 0.03]
  },
  highMarginConversion: {
    label: '10-25 高到手转化区',
    min: 10,
    max: 25,
    coreMax: 25,
    mainMax: 25,
    highMin: 30,
    targetPayProfitRate: 32,
    minPayProfitRate: 17,
    minNetProfitRate: -14,
    maxLossShare: 16,
    originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 26 }, { originalMin: 45, originalMax: 60, discountRate: 22 }, { originalMin: 60, originalMax: 999, discountRate: 18 }],
    fullDiscountShare: 40,
    couponDiscountShare: 45,
    reserveDiscountShare: 15,
    fullThresholdWindow: 5,
    fullThresholdMinGap: 10,
    minFullAmountIncrease: 3,
    fullAmountBasis: 'average',
    maxFullRuleCount: 6,
    minFullHitCount: 3,
    minNetPayFloor: 2,
    couponRecommendationPolicy: ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.balanced,
    couponScoringMode: 'balanced',
    segmentWeights: [0.68, 1, 0.96, 0.45, 0.12]
  },
  profitRecovery: {
    label: '15-30 到手回收区',
    min: 15,
    max: 30,
    coreMax: 25,
    mainMax: 30,
    highMin: 35,
    targetPayProfitRate: 40,
    minPayProfitRate: 27,
    minNetProfitRate: -2,
    maxLossShare: 5,
    originalDiscountTiers: [{ originalMin: 0, originalMax: 20, discountRate: 0 }, { originalMin: 35, originalMax: 55, discountRate: 12 }, { originalMin: 55, originalMax: 999, discountRate: 10 }],
    fullDiscountShare: 85,
    couponDiscountShare: 5,
    reserveDiscountShare: 10,
    fullThresholdWindow: 5,
    fullThresholdMinGap: 12,
    minFullAmountIncrease: 3,
    fullAmountBasis: 'min',
    maxFullRuleCount: 6,
    minFullHitCount: 4,
    minNetPayFloor: 2,
    couponRecommendationPolicy: ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.conservative,
    couponScoringMode: 'conservative',
    segmentWeights: [0.18, 0.64, 0.92, 1, 0.55]
  }
};

type ActivityCandidate = {
  index: number;
  price: number;
  stapleCount: number;
};

type ActivityRouteMetrics = {
  activeCount: number;
  ignoredCount: number;
  avgProfitRate: number | null;
  minProfitRate: number | null;
  profitRateSpread: number | null;
  payBandAvgSpread: number | null;
  avgFinalPay: number;
  actualAvgDiscountRate: number | null;
  actualMinDiscountRate: number | null;
  actualMaxDiscountRate: number | null;
  lossCount: number;
  lossShare: number;
  maxLossShare: number;
  lossOutOfToleranceCount: number;
  lossShareOverflow: number;
  minAllowedProfitRate: number;
  targetGap: number | null;
  targetPenalty: number;
  spreadPenalty: number;
  lossPenalty: number;
  ignoredPenalty: number;
  discountPenalty: number;
  demandPenalty: number;
  businessPayWeight: number;
  corePayShare: number;
  mainPayShare: number;
  highPayShare: number;
  targetPayShareFloor: number;
  highPayShareLimit: number;
  score: number;
};

type ActivityPriceBandStats = {
  key: string;
  label: string;
  min: number;
  max: number;
  platform: Platform | 'all';
  platformName: string;
  scenario: PriceBandRow['scenario'];
  scenarioName: string;
  comboCount: number;
  ignoredCount: number;
  originalTotalSum: number;
  finalPaySum: number;
  netPaySum: number;
  costSum: number;
  profitSum: number;
  minProfit: number | null;
  maxProfit: number | null;
  profitRateSum: number;
  profitRateCount: number;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  profitSpaceSum: number;
  lowCount: number;
  riskCount: number;
};

type ActivityRouteValidationAccumulator = {
  recommendation: ActivityRecommendationRow;
  settings: ActivityDesignSettings;
  payBandSize: number;
  payBandStats: Map<string, ActivityPriceBandStats>;
  comboRowsByKey: Map<string, ActivityComboSimulationRow>;
  hitRowsByKey: Map<string, ActivityComboSimulationRow>;
  hitReasonCounts: Map<string, number>;
  activeCount: number;
  ignoredCount: number;
  lowNetPayIgnoredCount: number;
  finalPaySum: number;
  discountRateSum: number;
  discountRateCount: number;
  minDiscountRate: number | null;
  maxDiscountRate: number | null;
  businessPayWeightSum: number;
  corePayCount: number;
  mainPayCount: number;
  highPayCount: number;
  profitRateSum: number;
  profitRateCount: number;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  lossCount: number;
  lossOutOfToleranceCount: number;
  minProfitSpaceRow: ActivityComboSimulationRow | null;
  maxProfitRow: ActivityComboSimulationRow | null;
  maxFullAmount: number;
  minFullThreshold: number;
  maxCouponAmount: number;
  minCouponThreshold: number;
};

function representedComboCount(row: { representedComboCount?: number | null }) {
  if (row.representedComboCount === undefined || row.representedComboCount === null) return 1;
  return Math.max(0, Math.floor(Number(row.representedComboCount) || 0));
}

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

function quantile(values: number[], q: number) {
  const sorted = values.filter(value => Number.isFinite(value)).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function demandAverageValue(values: Array<{ value: number; weight: number }>) {
  let sum = 0;
  let weightSum = 0;
  for (const row of values) {
    if (!Number.isFinite(row.value)) continue;
    const weight = Math.max(0, Number(row.weight) || 0);
    sum += row.value * weight;
    weightSum += weight;
  }
  return weightSum > 0 ? sum / weightSum : null;
}

function demandQuantileValue(values: Array<{ value: number; weight: number }>, q: number) {
  const sorted = values
    .filter(row => Number.isFinite(row.value))
    .map(row => ({ value: row.value, weight: Math.max(0, Number(row.weight) || 0) }))
    .sort((a, b) => a.value - b.value);
  if (!sorted.length) return null;
  const totalWeight = sorted.reduce((sum, row) => sum + row.weight, 0);
  if (totalWeight <= 1e-9) return quantile(sorted.map(row => row.value), q);
  const target = totalWeight * Math.max(0, Math.min(1, q));
  let cumulative = 0;
  for (const row of sorted) {
    cumulative += row.weight;
    if (cumulative + 1e-9 >= target) return row.value;
  }
  return sorted[sorted.length - 1].value;
}

function integerThreshold(value: number) {
  return Math.max(0, Math.ceil((Number(value) || 0) - 1e-9));
}

function activityMoneyAmount(value: number) {
  return Math.floor(Math.max(0, Number(value) || 0) * 100 + 1e-9) / 100;
}

function cappedActivityMoneyAmount(value: number, maxAllowed: number) {
  const cap = Number.isFinite(maxAllowed) ? Math.max(0, Number(maxAllowed) || 0) : Number.POSITIVE_INFINITY;
  const rawAmount = Math.min(Math.max(0, Number(value) || 0), cap);
  if (rawAmount <= 0) return 0;
  return activityMoneyAmount(rawAmount);
}

function limitedIntegerThresholds(minValue: number, maxValue: number) {
  const min = integerThreshold(minValue);
  const max = Math.max(min, integerThreshold(maxValue));
  const span = max - min;
  const step = Math.max(1, Math.ceil(span / ACTIVITY_ROUTE_THRESHOLD_LIMIT));
  const thresholds: number[] = [];
  for (let value = min; value <= max; value += step) thresholds.push(value);
  if (thresholds[thresholds.length - 1] !== max) thresholds.push(max);
  return thresholds;
}

function activityObjectiveTemplateFromSettings(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  return settings.objectiveTemplates?.find(template => template.key === objective);
}

function activityObjectiveGroup(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  return activityObjectiveTemplateFromSettings(settings, objective)?.group || (objective === 'longTerm' ? 'stable' : 'marketing');
}

function objectiveName(objective: ActivityDesignObjective, settings?: ActivityDesignSettings) {
  return activityObjectiveTemplateFromSettings(settings || ({} as ActivityDesignSettings), objective)?.name || {
    longTerm: '店铺稳定',
    orderGrowth: '拉升单量',
    raiseAov: '提高客单价',
    hotProduct: '爆品打造',
    highMarginConversion: '高到手转化',
    profitRecovery: '到手回收'
  }[objective] || String(objective || '自定义目标');
}

function targetSegmentWeights(payMin: number, payMax: number, fallbackWeights: number[]) {
  return ACTIVITY_BUSINESS_PAY_SEGMENTS.map((segment, index) => {
    const segmentMax = Number.isFinite(segment.max) ? segment.max : payMax + 10;
    const overlaps = segment.min < payMax - 1e-9 && segmentMax > payMin + 1e-9;
    if (overlaps) return 1;
    const distance = segmentMax <= payMin ? payMin - segmentMax : segment.min - payMax;
    if (distance <= 5 + 1e-9) return Math.max(0.55, fallbackWeights[index] || 0);
    if (distance <= 10 + 1e-9) return Math.max(0.25, Math.min(0.5, fallbackWeights[index] || 0));
    return Math.min(0.08, fallbackWeights[index] || 0.08);
  });
}

function normalizeOriginalDiscountTiers(value: unknown, fallback: ActivityOriginalDiscountTier[]) {
  const hasExplicitRows = Array.isArray(value);
  const rows = Array.isArray(value) ? value as Partial<ActivityOriginalDiscountTier>[] : [];
  const normalized = rows
    .map(row => {
      const originalMin = Math.max(0, Number(row?.originalMin) || 0);
      const originalMax = Math.max(originalMin + 1, Number(row?.originalMax) || originalMin + 1);
      const discountRate = Math.max(0, Math.min(95, Number(row?.discountRate) || 0));
      return { originalMin, originalMax, discountRate };
    })
    .filter((row, index, list) => list.findIndex(item => Math.abs(item.originalMin - row.originalMin) < 1e-9 && Math.abs(item.originalMax - row.originalMax) < 1e-9) === index)
    .sort((a, b) => a.originalMin - b.originalMin || a.originalMax - b.originalMax);
  if (normalized.length) return normalized;
  return hasExplicitRows ? [] : fallback.map(row => ({ ...row }));
}

function normalizeFullAmountBasis(value: unknown, fallback: ActivityFullAmountBasis): ActivityFullAmountBasis {
  if (value === 'average' || value === 'p75' || value === 'min' || value === 'max') return value;
  if (value === 'weightedAverage') return 'average';
  if (value === 'weightedP75') return 'p75';
  if (value === 'weightedMin') return 'min';
  if (value === 'weightedMax') return 'max';
  return fallback;
}

function normalizeCouponRecommendationMode(value: unknown, fallback: ActivityCouponRecommendationMode): ActivityCouponRecommendationMode {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
    ? value
    : fallback;
}

function normalizeCouponRepresentativeMode(value: unknown, fallback: ActivityCouponRecommendationPolicy['representativeMode']) {
  return value === 'lowestThreshold' || value === 'balanced' || value === 'highestThreshold'
    ? value
    : fallback;
}

function defaultCouponRecommendationPolicy(mode: ActivityCouponRecommendationMode) {
  return { ...ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS[mode] };
}

function normalizeCouponRecommendationPolicy(value: unknown, fallback: ActivityCouponRecommendationPolicy): ActivityCouponRecommendationPolicy {
  const raw = value && typeof value === 'object' ? value as Partial<ActivityCouponRecommendationPolicy> : {};
  const mode = normalizeCouponRecommendationMode(raw.mode, fallback.mode);
  const modeFallback = ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS[mode] || fallback;
  const amountStep = Math.max(ACTIVITY_MONEY_AMOUNT_UNIT, Number(raw.amountStep ?? fallback.amountStep ?? modeFallback.amountStep) || modeFallback.amountStep);
  const minCouponAmount = Math.max(0, Number(raw.minCouponAmount ?? fallback.minCouponAmount ?? modeFallback.minCouponAmount) || modeFallback.minCouponAmount);
  const nearThresholdGap = Math.max(0, Number(raw.nearThresholdGap ?? fallback.nearThresholdGap ?? modeFallback.nearThresholdGap) || modeFallback.nearThresholdGap);
  const farThresholdGap = Math.max(nearThresholdGap, Number(raw.farThresholdGap ?? fallback.farThresholdGap ?? modeFallback.farThresholdGap) || modeFallback.farThresholdGap);
  return {
    mode,
    amountStep,
    minCouponAmount,
    nearThresholdGap,
    farThresholdGap,
    nearAmountMergeTolerance: Math.max(0, Number(raw.nearAmountMergeTolerance ?? fallback.nearAmountMergeTolerance ?? modeFallback.nearAmountMergeTolerance) || modeFallback.nearAmountMergeTolerance),
    farAmountSkipTolerance: Math.max(0, Number(raw.farAmountSkipTolerance ?? fallback.farAmountSkipTolerance ?? modeFallback.farAmountSkipTolerance) || modeFallback.farAmountSkipTolerance),
    maxOverBucketSpace: Math.max(0, Number(raw.maxOverBucketSpace ?? fallback.maxOverBucketSpace ?? modeFallback.maxOverBucketSpace) || 0),
    representativeMode: normalizeCouponRepresentativeMode(raw.representativeMode, fallback.representativeMode || modeFallback.representativeMode)
  };
}

function activityObjectivePayProfile(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const template = activityObjectiveTemplateFromSettings(settings, objective);
  const fallback = ACTIVITY_OBJECTIVE_PAY_PROFILES[objective]
    || ACTIVITY_OBJECTIVE_PAY_PROFILES[template?.baseObjective || '']
    || ACTIVITY_OBJECTIVE_PAY_PROFILES[template?.group === 'stable' ? 'longTerm' : 'orderGrowth'];
  const raw = settings.objectiveStrategies?.[objective] || settings.objectivePayTargets?.[objective];
  const payMin = fallback.min;
  const payMax = fallback.max;
  const rawStrategy = raw as Partial<typeof fallback> | undefined;
  const fallbackMode = normalizeCouponRecommendationMode(fallback.couponRecommendationPolicy?.mode || fallback.couponScoringMode, 'balanced');
  const rawMode = normalizeCouponRecommendationMode(rawStrategy?.couponRecommendationPolicy?.mode || rawStrategy?.couponScoringMode, fallbackMode);
  const couponRecommendationPolicy = normalizeCouponRecommendationPolicy(
    rawStrategy?.couponRecommendationPolicy,
    rawStrategy?.couponRecommendationPolicy
      ? { ...defaultCouponRecommendationPolicy(rawMode), ...rawStrategy.couponRecommendationPolicy, mode: rawMode }
      : defaultCouponRecommendationPolicy(rawMode)
  );
  return {
    ...fallback,
    min: payMin,
    max: payMax,
    coreMax: payMax,
    mainMax: payMax,
    highMin: payMax + Math.max(5, Number(settings.payBandSize) || 5),
    targetPayProfitRate: 0,
    minPayProfitRate: 0,
    minNetProfitRate: 0,
    maxLossShare: 1,
    originalDiscountTiers: normalizeOriginalDiscountTiers(rawStrategy?.originalDiscountTiers, fallback.originalDiscountTiers),
    fullDiscountShare: Math.max(0, Number(rawStrategy?.fullDiscountShare ?? fallback.fullDiscountShare) || 0),
    couponDiscountShare: Math.max(0, Number(rawStrategy?.couponDiscountShare ?? fallback.couponDiscountShare) || 0),
    reserveDiscountShare: Math.max(0, Number(rawStrategy?.reserveDiscountShare ?? fallback.reserveDiscountShare) || 0),
    fullThresholdWindow: Math.max(1, Number(rawStrategy?.fullThresholdWindow ?? fallback.fullThresholdWindow) || fallback.fullThresholdWindow),
    fullThresholdMinGap: Math.max(1, Number(rawStrategy?.fullThresholdMinGap ?? fallback.fullThresholdMinGap) || fallback.fullThresholdMinGap),
    minFullAmountIncrease: Math.max(0, Number(rawStrategy?.minFullAmountIncrease ?? fallback.minFullAmountIncrease) || fallback.minFullAmountIncrease),
    fullAmountBasis: normalizeFullAmountBasis(rawStrategy?.fullAmountBasis, fallback.fullAmountBasis),
    maxFullRuleCount: Math.max(1, Math.floor(Number(rawStrategy?.maxFullRuleCount ?? fallback.maxFullRuleCount) || fallback.maxFullRuleCount)),
    minFullHitCount: Math.max(0, Math.floor(Number(rawStrategy?.minFullHitCount ?? fallback.minFullHitCount) || fallback.minFullHitCount)),
    minNetPayFloor: Math.max(0, Number(rawStrategy?.minNetPayFloor ?? fallback.minNetPayFloor) || fallback.minNetPayFloor),
    couponRecommendationPolicy,
    couponScoringMode: couponRecommendationPolicy.mode,
    label: template?.targetPayLabel || fallback.label,
    segmentWeights: fallback.segmentWeights
  };
}

function activityDesignObjectives(settings: ActivityDesignSettings) {
  const objectives = new Set<ActivityDesignObjective>();
  for (const template of settings.objectiveTemplates || []) {
    if (template.enabled !== false && template.key) objectives.add(template.key);
  }
  for (const objective of Object.keys(settings.objectiveStrategies || {})) objectives.add(objective);
  for (const objective of Object.keys(settings.objectivePayTargets || {})) objectives.add(objective);
  return objectives.size ? Array.from(objectives) : ACTIVITY_DESIGN_OBJECTIVES;
}

function activityDiscountShareValue(settings: ActivityDesignSettings, objective: ActivityDesignObjective, kind: 'full' | 'coupon' | 'reserve') {
  const profile = activityObjectivePayProfile(settings, objective);
  if (kind === 'full') return Math.max(0, Math.min(100, Number(profile.fullDiscountShare) || 0));
  if (kind === 'coupon') return Math.max(0, Math.min(100, Number(profile.couponDiscountShare) || 0));
  return Math.max(0, Math.min(100, Number(profile.reserveDiscountShare) || 0));
}

function activityDiscountSharePercent(settings: ActivityDesignSettings, objective: ActivityDesignObjective, kind: 'full' | 'coupon' | 'reserve') {
  return activityDiscountShareValue(settings, objective, kind) / 100;
}

function activityDiscountShareRatio(settings: ActivityDesignSettings, objective: ActivityDesignObjective, kind: 'full' | 'coupon' | 'reserve') {
  const profile = activityObjectivePayProfile(settings, objective);
  const total = profile.fullDiscountShare + profile.couponDiscountShare + profile.reserveDiscountShare;
  if (total <= 1e-9) return kind === 'reserve' ? 0 : 0.5;
  if (kind === 'full') return profile.fullDiscountShare / total;
  if (kind === 'coupon') return profile.couponDiscountShare / total;
  return profile.reserveDiscountShare / total;
}

function activityLossTolerance(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const profile = activityObjectivePayProfile(settings, objective);
  return {
    minNetProfitRate: profile.minNetProfitRate,
    maxLossShare: profile.maxLossShare
  };
}

function activityLossToleranceText(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const tolerance = activityLossTolerance(settings, objective);
  return `观察线${roundMoney(tolerance.minNetProfitRate * 100)}%，占比${roundMoney(tolerance.maxLossShare * 100)}%`;
}

function ratePointText(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${roundMoney(value * 100)}pct`;
}

function rateShareText(value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${roundMoney(value * 100)}%`;
}

function effectiveActivityPayMax(row: Pick<ComboEvaluationRow, 'scenario'>, settings: ActivityDesignSettings) {
  const scenarioMax = ACTIVITY_PAY_MAX_BY_SCENARIO[row.scenario];
  if (settings.payMax === '') return scenarioMax;
  return Math.min(scenarioMax, Math.max(0, Number(settings.payMax) || 0));
}

function activityMinNetPayFloor(settings: ActivityDesignSettings, objective?: ActivityDesignObjective) {
  return objective ? activityObjectivePayProfile(settings, objective).minNetPayFloor : ACTIVITY_MIN_NET_PAY;
}

function markActivityPayBoundary<T extends ActivityComboSimulationRow>(row: T, settings: ActivityDesignSettings, objective?: ActivityDesignObjective): T {
  const min = Math.max(0, Number(settings.payMin) || 0);
  const max = effectiveActivityPayMax(row, settings);
  const payOutOfRange = row.finalPay + 1e-9 < min || row.finalPay > max + 1e-9;
  const minNetPay = activityMinNetPayFloor(settings, objective);
  const netPayTooLow = row.netPay + 1e-9 < minNetPay;
  const ignored = payOutOfRange || netPayTooLow;
  if (!ignored) return { ...row, ignored: false, ignoreReason: '' };
  const ignoreReason = netPayTooLow
    ? `商家到手价低于最低边界 ¥${roundMoney(minNetPay)}，已忽略`
    : `超出${row.scenarioName}支付价范围 ¥${roundMoney(min)}-¥${roundMoney(max)}，已忽略`;
  return {
    ...row,
    ignored: true,
    ignoreReason
  };
}

function activityBusinessPaySegment(finalPay: number) {
  return ACTIVITY_BUSINESS_PAY_SEGMENTS.find(segment => (
    finalPay + 1e-9 >= segment.min
    && finalPay < segment.max - 1e-9
  )) || ACTIVITY_BUSINESS_PAY_SEGMENTS[ACTIVITY_BUSINESS_PAY_SEGMENTS.length - 1];
}

function activityBusinessPaySegmentIndex(finalPay: number) {
  return Math.max(0, ACTIVITY_BUSINESS_PAY_SEGMENTS.findIndex(segment => (
    finalPay + 1e-9 >= segment.min
    && finalPay < segment.max - 1e-9
  )));
}

function activityTargetPayTolerance(settings: ActivityDesignSettings) {
  return Math.max(1, Math.min(4, (Number(settings.payBandSize) || 5) / 2));
}

function activityTargetPayFromOriginal(settings: ActivityDesignSettings, objective: ActivityDesignObjective, originalTotal: number) {
  const original = Math.max(0, Number(originalTotal) || 0);
  return roundMoney(original * (1 - activityOriginalDiscountRate(settings, objective, original)));
}

function activityTargetPayWindow(settings: ActivityDesignSettings, objective: ActivityDesignObjective, originalTotal: number) {
  const targetPay = activityTargetPayFromOriginal(settings, objective, originalTotal);
  const tolerance = activityTargetPayTolerance(settings);
  return {
    targetPay,
    min: Math.max(0, targetPay - tolerance),
    max: targetPay + tolerance,
    coreMin: Math.max(0, targetPay - tolerance / 2),
    coreMax: targetPay + tolerance / 2,
    highMin: targetPay + Math.max(5, Number(settings.payBandSize) || 5)
  };
}

function activityExpectedPayWeight(
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  _scenario: ComboEvaluationRow['scenario'],
  finalPay: number,
  originalTotal?: number
) {
  const index = activityBusinessPaySegmentIndex(finalPay);
  const segment = activityBusinessPaySegment(finalPay);
  const objectiveWeight = activityObjectivePayProfile(settings, objective).segmentWeights[index] ?? segment.weight;
  const mainOrderShare = ACTIVITY_BUSINESS_PAY_SEGMENTS[0].orderShare;
  const orderShareWeight = 0.45 + Math.min(1, segment.orderShare / mainOrderShare) * 0.55;
  const marketWeight = objectiveWeight * orderShareWeight;
  if (!Number.isFinite(Number(originalTotal))) return marketWeight;

  const window = activityTargetPayWindow(settings, objective, Number(originalTotal) || 0);
  const tolerance = activityTargetPayTolerance(settings);
  if (finalPay + 1e-9 >= window.min && finalPay <= window.max + 1e-9) return marketWeight * 1.18;
  if (finalPay < window.min) return marketWeight * 0.85;
  const overGap = Math.max(0, finalPay - window.max);
  return marketWeight * Math.max(0.12, 1 - overGap / Math.max(6, tolerance * 4));
}

function activityPayInTargetRange(settings: ActivityDesignSettings, objective: ActivityDesignObjective, finalPay: number, originalTotal?: number) {
  if (Number.isFinite(Number(originalTotal))) {
    const window = activityTargetPayWindow(settings, objective, Number(originalTotal) || 0);
    return finalPay + 1e-9 >= window.min && finalPay <= window.max + 1e-9;
  }
  return finalPay <= 25 + 1e-9;
}

function activityPayInCoreRange(settings: ActivityDesignSettings, objective: ActivityDesignObjective, finalPay: number, originalTotal?: number) {
  if (Number.isFinite(Number(originalTotal))) {
    const window = activityTargetPayWindow(settings, objective, Number(originalTotal) || 0);
    return finalPay + 1e-9 >= window.coreMin && finalPay <= window.coreMax + 1e-9;
  }
  return finalPay <= 20 + 1e-9;
}

function activityPayAboveTargetCeiling(settings: ActivityDesignSettings, objective: ActivityDesignObjective, finalPay: number, originalTotal: number) {
  return finalPay > activityTargetPayWindow(settings, objective, originalTotal).highMin + 1e-9;
}

function activityTargetPayShareFloor(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const group = activityObjectiveGroup(settings, objective);
  if (group === 'stable') return 0.64;
  return ({
    orderGrowth: 0.6,
    raiseAov: 0.54,
    hotProduct: 0.62,
    highMarginConversion: 0.56,
    profitRecovery: 0.5
  } as Record<string, number>)[objective] ?? 0.54;
}

function activityHighPayShareLimit(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  const group = activityObjectiveGroup(settings, objective);
  if (group === 'stable') return 0.18;
  return ({
    orderGrowth: 0.14,
    raiseAov: 0.2,
    hotProduct: 0.12,
    highMarginConversion: 0.18,
    profitRecovery: 0.26
  } as Record<string, number>)[objective] ?? 0.2;
}

function activityObjectiveTargetLabel(settings: ActivityDesignSettings, objective: ActivityDesignObjective) {
  return `${objectiveName(objective, settings)}活动空间规则`;
}

function activityDemandPenalty(
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  businessPayWeight: number,
  targetPayShare: number,
  highPayShare: number
) {
  const targetFloor = activityTargetPayShareFloor(settings, objective);
  const highLimit = activityHighPayShareLimit(settings, objective);
  return Math.max(0, 1 - businessPayWeight) * 70
    + Math.max(0, targetFloor - targetPayShare) * 180
    + Math.max(0, highPayShare - highLimit) * 150
    + highPayShare * 35;
}

function priceBandSuggestionFromStats(stats: ActivityPriceBandStats) {
  const avgProfitSpace = stats.comboCount ? stats.profitSpaceSum / stats.comboCount : 0;
  const avgProfitRate = stats.profitRateCount ? stats.profitRateSum / stats.profitRateCount : null;
  return avgProfitSpace < -1e-9
    ? '活动穿透，需收紧优惠或调价'
    : stats.lowCount > 0
      ? '存在低支付毛利组合，需查看明细'
      : avgProfitRate !== null && stats.maxProfitRate !== null && stats.minProfitRate !== null && stats.maxProfitRate - stats.minProfitRate > 0.12
        ? '同价位支付毛利离散，建议收拢'
        : avgProfitSpace > 1
          ? '存在可释放活动空间'
          : '结构正常';
}

function addPriceBandStats(
  groups: Map<string, ActivityPriceBandStats>,
  row: ComboEvaluationRow & { representedComboCount?: number | null },
  size: number,
  basis: 'pay' | 'original',
  options?: { groupByScenario?: boolean }
) {
  if (row.ignored) return;
  const countWeight = representedComboCount(row);
  if (countWeight <= 0) return;
  const groupByScenario = options?.groupByScenario !== false;
  const value = basis === 'pay' ? row.finalPay : row.originalTotal;
  const band = bandKey(value, size);
  const key = groupByScenario
    ? [basis, row.platform, row.scenario, band.key].join('::')
    : [basis, row.platform, band.key].join('::');
  const current = groups.get(key) || {
    key,
    label: band.label,
    min: band.min,
    max: band.max,
    platform: row.platform,
    platformName: row.platformName,
    scenario: row.scenario,
    scenarioName: groupByScenario ? row.scenarioName : '全部组合',
    comboCount: 0,
    ignoredCount: 0,
    originalTotalSum: 0,
    finalPaySum: 0,
    netPaySum: 0,
    costSum: 0,
    profitSum: 0,
    minProfit: null,
    maxProfit: null,
    profitRateSum: 0,
    profitRateCount: 0,
    minProfitRate: null,
    maxProfitRate: null,
    profitSpaceSum: 0,
    lowCount: 0,
    riskCount: 0
  };

  current.comboCount += countWeight;
  current.originalTotalSum += row.originalTotal * countWeight;
  current.finalPaySum += row.finalPay * countWeight;
  current.netPaySum += row.netPay * countWeight;
  current.costSum += row.cost * countWeight;
  current.profitSum += row.profit * countWeight;
  current.profitSpaceSum += row.profitSpace * countWeight;
  current.minProfit = current.minProfit === null ? row.profit : Math.min(current.minProfit, row.profit);
  current.maxProfit = current.maxProfit === null ? row.profit : Math.max(current.maxProfit, row.profit);
  const payGrossRate = paymentGrossProfitRate(row);
  if (payGrossRate !== null) {
    current.profitRateSum += payGrossRate * countWeight;
    current.profitRateCount += countWeight;
    current.minProfitRate = current.minProfitRate === null ? payGrossRate : Math.min(current.minProfitRate, payGrossRate);
    current.maxProfitRate = current.maxProfitRate === null ? payGrossRate : Math.max(current.maxProfitRate, payGrossRate);
  }
  if (row.profitSpace < -1e-9 || (payGrossRate !== null && payGrossRate + 1e-9 < row.targetPayRate)) current.lowCount += countWeight;
  if (row.risk.hasRisk) current.riskCount += countWeight;
  groups.set(key, current);
}

function priceBandRowsFromStats(groups: Map<string, ActivityPriceBandStats>): PriceBandRow[] {
  return Array.from(groups.values()).map(stats => {
    const count = stats.comboCount || 1;
    const avgProfitRate = stats.profitRateCount ? stats.profitRateSum / stats.profitRateCount : null;
    const avgProfitSpace = stats.comboCount ? stats.profitSpaceSum / stats.comboCount : 0;
    return {
      key: stats.key,
      label: stats.label,
      min: stats.min,
      max: stats.max,
      platform: stats.platform,
      platformName: stats.platformName,
      scenario: stats.scenario,
      scenarioName: stats.scenarioName,
      comboCount: stats.comboCount,
      ignoredCount: stats.ignoredCount,
      avgOriginalTotal: stats.originalTotalSum / count,
      avgFinalPay: stats.finalPaySum / count,
      avgNetPay: stats.netPaySum / count,
      avgCost: stats.costSum / count,
      avgProfit: roundMoney(stats.profitSum / count),
      minProfit: stats.minProfit,
      maxProfit: stats.maxProfit,
      avgProfitRate,
      minProfitRate: stats.minProfitRate,
      maxProfitRate: stats.maxProfitRate,
      avgProfitSpace,
      lowCount: stats.lowCount,
      riskCount: stats.riskCount,
      suggestion: priceBandSuggestionFromStats(stats)
    };
  }).sort((a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') || a.min - b.min);
}

function activityPriceBucketSuggestion(row: Pick<ActivityPriceBucketRow, 'weightedAvgFinalPay' | 'weightedAvgNetPay' | 'avgFinalPay' | 'avgNetPay' | 'weightedAvgActivitySafeDiscountSpace' | 'avgActivitySafeDiscountSpace' | 'riskCount' | 'outlierCount'>) {
  const finalPay = row.avgFinalPay ?? row.weightedAvgFinalPay ?? 0;
  const netPay = row.avgNetPay ?? row.weightedAvgNetPay ?? 0;
  const safeSpace = row.avgActivitySafeDiscountSpace ?? row.weightedAvgActivitySafeDiscountSpace ?? 0;
  if (netPay + 1e-9 < ACTIVITY_MIN_NET_PAY) return `平均到手价低于 ¥${roundMoney(ACTIVITY_MIN_NET_PAY)}，该价位不适合继续让利`;
  if (safeSpace <= 0.05) return '当前目标下没有安全活动空间，后续路线不会强行发券';
  if (safeSpace >= 3) return '存在可设计活动空间，可进入满减阶梯和原价桶券列表';
  if (row.riskCount > 0) return '存在到手边界风险组合，需查看明细确认商品组合';
  if (row.outlierCount > 0) return '存在支付价或到手价背离组合，需判断是否为策略组合';
  if (finalPay > 30) return '当前支付价偏高，生成路线时应优先检查满减梯度和券门槛';
  if (finalPay <= 25) return '已覆盖主要支付场景，可作为满减和券校验重点';
  if (netPay - ACTIVITY_MIN_NET_PAY > 8) return '到手边界空间较充足，可按活动目标测试让利';
  return '价格结构平稳，可作为满减和券分段参考';
}

type ActivityPriceBucketAccumulatorMap = Map<string, ReturnType<typeof createWeightedPriceBucketAccumulator>>;
type ActivityOriginalBucketEntryMap = Map<string, ActivityOriginalPriceBucketEntry[]>;

type ActivityScanComboGroup = {
  key: string;
  platform: Platform;
  priceCents: number;
  originalTotal: number;
  totalQty: number;
  stapleCount: number;
  comboIds: string[];
  costSum: number;
  minCost: number;
  maxCost: number;
  minCostComboId: string;
  maxCostComboId: string;
  avgCostComboId: string;
};

function moneyToCents(value: unknown) {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

function centsToMoney(value: unknown) {
  return roundMoney((Number(value) || 0) / 100);
}

function activityOriginalPriceBucketKey(platform: Platform, originalTotal: number) {
  const bucket = Math.max(0, Math.floor(originalTotal || 0));
  return ['original-price-bucket', platform, bucket].join('::');
}

function activityRepresentativeComboKey(representative: ActivityOriginalBucketRepresentativeCombo) {
  return [representative.kind, representative.mainComboId, representative.addOnComboId].join('::');
}

function mergeActivityBucketRepresentativeCombos(
  entries: ActivityOriginalPriceBucketEntry[],
  bucketAvgCost: number
) {
  const representatives = new Map<string, ActivityOriginalBucketRepresentativeCombo>();
  let minRepresentative: ActivityOriginalBucketRepresentativeCombo | null = null;
  let maxRepresentative: ActivityOriginalBucketRepresentativeCombo | null = null;
  let avgRepresentative: ActivityOriginalBucketRepresentativeCombo | null = null;
  for (const entry of entries) {
    for (const representative of entry.representativeCombos || []) {
      if (representative.kind === 'minCost' && (!minRepresentative || representative.cost < minRepresentative.cost)) {
        minRepresentative = representative;
      }
      if (representative.kind === 'maxCost' && (!maxRepresentative || representative.cost > maxRepresentative.cost)) {
        maxRepresentative = representative;
      }
      if (
        !avgRepresentative
        || Math.abs(representative.cost - bucketAvgCost) < Math.abs(avgRepresentative.cost - bucketAvgCost)
      ) {
        avgRepresentative = { ...representative, kind: 'avgCost' };
      }
    }
  }
  for (const representative of [minRepresentative, maxRepresentative, avgRepresentative]) {
    if (!representative) continue;
    representatives.set(activityRepresentativeComboKey(representative), representative);
  }
  return Array.from(representatives.values());
}

function activityOriginalPriceBucketsFromStats(
  buckets: ActivityPriceBucketAccumulatorMap,
  platformNames: Map<Platform, string>,
  bucketEntries?: ActivityOriginalBucketEntryMap
): ActivityPriceBucketRow[] {
  return Array.from(buckets.values())
    .map(finalizeWeightedPriceBucket)
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.priceBucket - b.priceBucket)
    .map(row => {
      const bucketRow = {
        ...row,
        platformName: platformNames.get(row.platform) || row.platform,
        label: `${roundMoney(row.min)}-${roundMoney(row.max)}`
      };
      return {
        ...bucketRow,
        ...(bucketEntries ? {
          entries: bucketEntries.get(row.key) || [],
          representativeCombos: mergeActivityBucketRepresentativeCombos(bucketEntries.get(row.key) || [], row.avgCost)
        } : {}),
        suggestion: activityPriceBucketSuggestion(bucketRow)
      };
    }) satisfies ActivityPriceBucketRow[];
}

function sortActivityBaseRows(a: ActivityBaseComboRow, b: ActivityBaseComboRow) {
  return a.platform.localeCompare(b.platform)
    || a.originalTotal - b.originalTotal
    || a.cost - b.cost
    || a.key.localeCompare(b.key);
}

function activityScanComboPoolKey(platform: Platform, pool: 'main' | 'addOn', index: number) {
  return ['activity-scan-pool', platform, pool, index].join('::');
}

function activityScanComboCostTotal(store: ReturnType<typeof currentStoreFrom>, qtys: number[]) {
  let costTotal = 0;
  store.products.forEach((product, index) => {
    const qty = Math.max(0, Number(qtys[index]) || 0);
    if (qty <= 0) return;
    costTotal += (Number(product.cost) || 0) * qty;
  });
  return roundMoney(costTotal);
}

function activityScanComboPoolRows(
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  pool: 'main' | 'addOn',
  rows: ComboPoolRow[]
): ActivityScanComboPoolRow[] {
  return rows.map((row, index) => ({
    key: activityScanComboPoolKey(platform, pool, index),
    platform,
    qtys: row.qtys,
    priceCents: moneyToCents(row.originalTotal),
    costTotal: activityScanComboCostTotal(store, row.qtys),
    totalQty: row.totalQty,
    originalTotal: row.originalTotal,
    stapleCount: row.stapleCount
  }));
}

function groupActivityScanCombosForOriginalScan(rows: ActivityScanComboPoolRow[], pool: 'main' | 'addOn') {
  const groups = new Map<string, ActivityScanComboGroup>();
  const costById = new Map(rows.map(row => [row.key, row.costTotal]));
  for (const row of rows) {
    const key = [
      'activity-scan-price-group',
      row.platform,
      pool,
      row.priceCents,
      row.totalQty,
      pool === 'main' ? row.stapleCount : 0
    ].join('::');
    const current = groups.get(key) || {
      key,
      platform: row.platform,
      priceCents: row.priceCents,
      originalTotal: centsToMoney(row.priceCents),
      totalQty: row.totalQty,
      stapleCount: row.stapleCount,
      comboIds: [],
      costSum: 0,
      minCost: Infinity,
      maxCost: 0,
      minCostComboId: row.key,
      maxCostComboId: row.key,
      avgCostComboId: row.key
    };
    current.comboIds.push(row.key);
    current.costSum += row.costTotal;
    if (row.costTotal < current.minCost) {
      current.minCost = row.costTotal;
      current.minCostComboId = row.key;
    }
    if (row.costTotal > current.maxCost) {
      current.maxCost = row.costTotal;
      current.maxCostComboId = row.key;
    }
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .map(row => {
      const comboIds = row.comboIds.slice().sort();
      const avgCost = row.costSum / Math.max(1, comboIds.length);
      const avgCostComboId = comboIds
        .slice()
        .sort((a, b) => {
          const aCost = costById.get(a) ?? avgCost;
          const bCost = costById.get(b) ?? avgCost;
          return Math.abs(aCost - avgCost) - Math.abs(bCost - avgCost) || a.localeCompare(b);
        })[0] || row.avgCostComboId;
      return {
        ...row,
        comboIds,
        minCost: Number.isFinite(row.minCost) ? row.minCost : 0,
        maxCost: Number.isFinite(row.maxCost) ? row.maxCost : 0,
        avgCostComboId
      };
    })
    .sort((a, b) => a.priceCents - b.priceCents || a.totalQty - b.totalQty || a.stapleCount - b.stapleCount || a.key.localeCompare(b.key));
}

function activityOriginalBucketEntryKey(
  platform: Platform,
  priceBucket: number,
  mainGroup: ActivityScanComboGroup,
  addOnGroup: ActivityScanComboGroup
) {
  return [
    'activity-original-bucket-entry',
    platform,
    priceBucket,
    mainGroup.priceCents,
    mainGroup.totalQty,
    mainGroup.stapleCount,
    addOnGroup.priceCents,
    addOnGroup.totalQty
  ].join('::');
}

function activityOriginalBucketEntryCostSummary(
  mainGroup: ActivityScanComboGroup,
  addOnGroup: ActivityScanComboGroup
) {
  const mainCount = Math.max(0, mainGroup.comboIds.length);
  const addOnCount = Math.max(0, addOnGroup.comboIds.length);
  const comboCount = mainCount * addOnCount;
  const mainAvgCost = mainCount > 0 ? mainGroup.costSum / mainCount : 0;
  const addOnAvgCost = addOnCount > 0 ? addOnGroup.costSum / addOnCount : 0;
  const costSum = roundMoney(mainGroup.costSum * addOnCount + addOnGroup.costSum * mainCount);
  const avgCost = comboCount > 0 ? roundMoney(costSum / comboCount) : roundMoney(mainAvgCost + addOnAvgCost);
  const minCost = roundMoney((Number.isFinite(mainGroup.minCost) ? mainGroup.minCost : 0) + (Number.isFinite(addOnGroup.minCost) ? addOnGroup.minCost : 0));
  const maxCost = roundMoney((Number.isFinite(mainGroup.maxCost) ? mainGroup.maxCost : 0) + (Number.isFinite(addOnGroup.maxCost) ? addOnGroup.maxCost : 0));
  const representatives: ActivityOriginalBucketRepresentativeCombo[] = [
    {
      kind: 'minCost',
      mainComboId: mainGroup.minCostComboId,
      addOnComboId: addOnGroup.minCostComboId,
      cost: minCost
    },
    {
      kind: 'maxCost',
      mainComboId: mainGroup.maxCostComboId,
      addOnComboId: addOnGroup.maxCostComboId,
      cost: maxCost
    },
    {
      kind: 'avgCost',
      mainComboId: mainGroup.avgCostComboId,
      addOnComboId: addOnGroup.avgCostComboId,
      cost: avgCost
    }
  ];
  return {
    comboCount,
    costSum,
    avgCost,
    minCost,
    maxCost,
    representativeCombos: representatives.filter(row => row.mainComboId && row.addOnComboId)
  };
}

function rememberActivityOriginalBucketEntry(
  entriesByBucket: ActivityOriginalBucketEntryMap,
  platform: Platform,
  originalTotalCents: number,
  mainGroup: ActivityScanComboGroup,
  addOnGroup: ActivityScanComboGroup
) {
  const originalTotal = centsToMoney(originalTotalCents);
  const bucketKey = activityOriginalPriceBucketKey(platform, originalTotal);
  const priceBucket = Math.max(0, Math.floor(originalTotal || 0));
  const costSummary = activityOriginalBucketEntryCostSummary(mainGroup, addOnGroup);
  const entry: ActivityOriginalPriceBucketEntry = {
    key: activityOriginalBucketEntryKey(platform, priceBucket, mainGroup, addOnGroup),
    originalTotalCents,
    mainComboIds: mainGroup.comboIds,
    addOnComboIds: addOnGroup.comboIds,
    comboCount: costSummary.comboCount,
    avgCost: costSummary.avgCost,
    minCost: costSummary.minCost,
    maxCost: costSummary.maxCost,
    costSum: costSummary.costSum,
    representativeCombos: costSummary.representativeCombos
  };
  const entries = entriesByBucket.get(bucketKey) || [];
  entries.push(entry);
  entriesByBucket.set(bucketKey, entries);
  return entry;
}

function addActivityOriginalPriceBucketStatsFromScanEntry(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  buckets: ActivityPriceBucketAccumulatorMap,
  platformNames: Map<Platform, string>,
  platform: Platform,
  originalTotalCents: number,
  entry: ActivityOriginalPriceBucketEntry,
  settings: ActivityDesignSettings
) {
  const originalTotal = centsToMoney(originalTotalCents);
  const comboCount = Math.max(0, Math.floor(Number(entry.comboCount) || 0));
  const avgCost = roundMoney(Number(entry.avgCost) || 0);
  const minCost = roundMoney(entry.minCost === undefined || entry.minCost === null ? avgCost : Number(entry.minCost) || 0);
  const maxCost = roundMoney(entry.maxCost === undefined || entry.maxCost === null ? avgCost : Number(entry.maxCost) || 0);
  if (!platformNames.has(platform)) platformNames.set(platform, PLATFORM_NAMES[platform]);
  const bucket = Math.max(0, Math.floor(originalTotal || 0));
  const key = [platform, bucket].join('::');
  const accumulator = buckets.get(key) || createWeightedPriceBucketAccumulator(platform, bucket);
  const activity = store.activities[platform];
  const platformFull = bestFullReduction(activity.fullReductions || [], originalTotal);
  const afterPlatformFull = Math.max(0, roundMoney(originalTotal - platformFull.amount));
  const baseRed = bestBaseRed(state, platform, afterPlatformFull);
  const afterBaseRed = Math.max(0, roundMoney(afterPlatformFull - baseRed.amount));
  const redAddOn = bestDesignRedAddOn(store, platform, afterPlatformFull, afterBaseRed, 0, configuredRedAddOnSpace(settings));
  const redAddAmount = redAddOn.amount;
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddAmount));
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const targetObjective = settings.objective || 'longTerm';
  const targetDiscountRate = activityOriginalDiscountRate(settings, targetObjective, originalTotal);
  const targetPay = roundMoney(originalTotal * (1 - targetDiscountRate));
  const targetDiscountAmount = roundMoney(Math.max(0, originalTotal - targetPay));
  const alreadyDiscountAmount = roundMoney(Math.max(0, originalTotal - finalPay));
  const activityDesignSpace = activityDesignSpaceWithPlatformDiscountDowngrade(
    state,
    store,
    platform,
    originalTotal,
    targetDiscountAmount,
    alreadyDiscountAmount,
    platformFull,
    baseRed,
    redAddOn,
    settings
  );
  const activityNetPayBoundarySpace = netPayFloorRouteDiscountSpace(state, store, finalPay, settings, targetObjective);
  const activitySafeDiscountSpace = activityDesignSpace;
  const scenario = activityBucketScenario(finalPay);
  const lowNetPay = netPay + 1e-9 < activityMinNetPayFloor(settings, targetObjective);
  const profit = roundMoney(netPay - avgCost);
  const maxCostProfit = roundMoney(netPay - maxCost);
  const profitRate = finalPay > 1e-9 ? profit / finalPay : null;
  const hasCostRisk = maxCostProfit < -1e-9;
  addWeightedComboToBucket(accumulator, {
    comboKey: ['activity-original-price-group', platform, originalTotalCents].join('::'),
    platform,
    count: comboCount,
    originalTotal,
    finalPay,
    cost: avgCost,
    minCost,
    maxCost,
    profit,
    netPay,
    profitRate,
    activityTargetDiscountRate: targetDiscountRate,
    activityTargetPay: targetPay,
    activityTargetPayGap: roundMoney(finalPay - targetPay),
    activityTargetDiscountAmount: targetDiscountAmount,
    activityAlreadyDiscountAmount: alreadyDiscountAmount,
    activityRedAddOnAmount: redAddAmount,
    activityDesignSpace,
    activityNetPayBoundarySpace,
    activitySafeDiscountSpace,
    weight: comboCount,
    hasRisk: lowNetPay || hasCostRisk,
    isOutlier: lowNetPay || hasCostRisk || finalPay > ACTIVITY_PAY_MAX_BY_SCENARIO[scenario] + 1e-9
  });
  buckets.set(key, accumulator);
}

function buildActivityScanComboPools(
  store: ReturnType<typeof currentStoreFrom>,
  poolsByPlatform: Map<Platform, SeparatedComboPools>
): ActivityScanComboPools {
  const mainCombos: ActivityScanComboPoolRow[] = [];
  const addOnCombos: ActivityScanComboPoolRow[] = [];
  const mainComboCountByPlatform: Partial<Record<Platform, number>> = {};
  const addOnComboCountByPlatform: Partial<Record<Platform, number>> = {};

  for (const [platform, pools] of poolsByPlatform.entries()) {
    const platformMainCombos = activityScanComboPoolRows(store, platform, 'main', pools.mainCombos);
    const platformAddOnCombos = activityScanComboPoolRows(store, platform, 'addOn', pools.addOnCombosByCount.flat());
    mainCombos.push(...platformMainCombos);
    addOnCombos.push(...platformAddOnCombos);
    mainComboCountByPlatform[platform] = platformMainCombos.length;
    addOnComboCountByPlatform[platform] = platformAddOnCombos.length;
  }

  return {
    mainCombos,
    addOnCombos,
    mainComboCountByPlatform,
    addOnComboCountByPlatform
  };
}

function rememberActivityRouteSample(
  rowsByPlatform: Map<Platform, ActivityBaseComboRow[]>,
  countsByPlatform: Map<Platform, number>,
  row: ActivityBaseComboRow
) {
  const nextCount = (countsByPlatform.get(row.platform) || 0) + 1;
  countsByPlatform.set(row.platform, nextCount);
  const rows = rowsByPlatform.get(row.platform) || [];
  if (rows.length < ACTIVITY_ROUTE_SOURCE_LIMIT_PER_PLATFORM) {
    rows.push(row);
    rowsByPlatform.set(row.platform, rows);
    return;
  }
  rows[nextCount % ACTIVITY_ROUTE_SOURCE_LIMIT_PER_PLATFORM] = row;
}

function activityBucketScenario(finalPay: number): ComboEvaluationRow['scenario'] {
  if (finalPay <= 25 + 1e-9) return 'single';
  if (finalPay <= 60 + 1e-9) return 'double';
  return 'multi';
}

function activityBucketScenarioName(scenario: ComboEvaluationRow['scenario']) {
  if (scenario === 'single') return '单人餐';
  if (scenario === 'double') return '双人餐';
  return '多人餐';
}

type ActivityBucketCostVariant = 'avgCost' | 'minCost' | 'maxCost';
type ActivityScanComboPoolLookup = {
  mainComboById: Map<string, ActivityScanComboPoolRow>;
  addOnComboById: Map<string, ActivityScanComboPoolRow>;
};

function activityBucketAverageCost(bucket: ActivityPriceBucketRow) {
  const weightedAvgCost = Number(bucket.weightedAvgCost);
  if (Number.isFinite(weightedAvgCost) && weightedAvgCost > 0) return roundMoney(weightedAvgCost);
  const avgCost = Number(bucket.avgCost);
  return Number.isFinite(avgCost) ? roundMoney(avgCost) : 0;
}

function activityBucketCostValue(bucket: ActivityPriceBucketRow, variant: ActivityBucketCostVariant) {
  const fallback = activityBucketAverageCost(bucket);
  const value = variant === 'maxCost'
    ? bucket.maxCost
    : variant === 'minCost'
      ? bucket.minCost
      : fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? roundMoney(numeric) : fallback;
}

function activityBucketProfitFields(finalPay: number, netPay: number, cost: number) {
  const profit = roundMoney(netPay - cost);
  return {
    profit,
    profitRate: finalPay > 1e-9 ? profit / finalPay : null,
    netProfitRate: netPay > 1e-9 ? profit / netPay : null,
    costProfitRate: cost > 1e-9 ? profit / cost : null,
    profitSpace: profit
  };
}

function activityBucketCostVariantLabel(variant: ActivityBucketCostVariant) {
  if (variant === 'maxCost') return '最高成本';
  if (variant === 'minCost') return '最低成本';
  return '平均成本';
}

function createActivityScanComboPoolLookup(scanComboPools: ActivityScanComboPools | undefined): ActivityScanComboPoolLookup | null {
  if (!scanComboPools?.mainCombos?.length || !scanComboPools?.addOnCombos?.length) return null;
  return {
    mainComboById: new Map(scanComboPools.mainCombos.map(row => [row.key, row])),
    addOnComboById: new Map(scanComboPools.addOnCombos.map(row => [row.key, row]))
  };
}

function mergeActivityScanComboQtys(mainCombo: ActivityScanComboPoolRow, addOnCombo: ActivityScanComboPoolRow) {
  const length = Math.max(mainCombo.qtys.length, addOnCombo.qtys.length);
  return Array.from({ length }, (_, index) => (mainCombo.qtys[index] || 0) + (addOnCombo.qtys[index] || 0));
}

function activityBucketRepresentativeForVariant(
  bucket: ActivityPriceBucketRow,
  variant: ActivityBucketCostVariant
) {
  const representatives = [
    ...(bucket.representativeCombos || []),
    ...(bucket.entries || []).flatMap(entry => entry.representativeCombos || [])
  ];
  if (!representatives.length) return null;
  const exact = representatives.find(row => row.kind === variant);
  if (exact) return exact;
  const targetCost = activityBucketCostValue(bucket, variant);
  const closest = representatives
    .slice()
    .sort((a, b) => Math.abs(a.cost - targetCost) - Math.abs(b.cost - targetCost) || activityRepresentativeComboKey(a).localeCompare(activityRepresentativeComboKey(b)))[0];
  return closest || null;
}

function activityBucketRepresentativeItems(
  store: ReturnType<typeof currentStoreFrom>,
  bucket: ActivityPriceBucketRow,
  variant: ActivityBucketCostVariant,
  lookup: ActivityScanComboPoolLookup | null
): ComboItem[] {
  if (!lookup) return [];
  const representative = activityBucketRepresentativeForVariant(bucket, variant);
  if (!representative) return [];
  const mainCombo = lookup.mainComboById.get(representative.mainComboId);
  const addOnCombo = lookup.addOnComboById.get(representative.addOnComboId);
  if (!mainCombo || !addOnCombo || mainCombo.platform !== bucket.platform || addOnCombo.platform !== bucket.platform) return [];
  return buildPlatformTotals(store, bucket.platform, mergeActivityScanComboQtys(mainCombo, addOnCombo)).items;
}

function activityBucketRouteRow(bucket: ActivityPriceBucketRow, costVariant: ActivityBucketCostVariant, items: ComboItem[] = []): ActivityBaseComboRow {
  const originalTotal = roundMoney(bucket.avgOriginalTotal || bucket.priceBucket);
  const finalPay = roundMoney(bucket.avgFinalPay ?? bucket.weightedAvgFinalPay ?? 0);
  const netPay = roundMoney(bucket.avgNetPay ?? bucket.weightedAvgNetPay ?? 0);
  const cost = activityBucketCostValue(bucket, costVariant);
  const scenario = activityBucketScenario(finalPay);
  const activityTargetDiscountAmount = roundMoney(bucket.avgActivityTargetDiscountAmount ?? bucket.weightedAvgActivityTargetDiscountAmount ?? 0);
  const activityAlreadyDiscountAmount = roundMoney(bucket.avgActivityAlreadyDiscountAmount ?? bucket.weightedAvgActivityAlreadyDiscountAmount ?? Math.max(0, originalTotal - finalPay));
  const activityRedAddOnAmount = roundMoney(bucket.avgActivityRedAddOnAmount ?? bucket.weightedAvgActivityRedAddOnAmount ?? 0);
  const activityDesignSpace = roundMoney(bucket.avgActivityDesignSpace ?? bucket.weightedAvgActivityDesignSpace ?? Math.max(0, activityTargetDiscountAmount - activityAlreadyDiscountAmount));
  const activityNetPayBoundarySpace = roundMoney(bucket.avgActivityNetPayBoundarySpace ?? bucket.weightedAvgActivityNetPayBoundarySpace ?? Math.max(0, netPay - ACTIVITY_MIN_NET_PAY));
  const activitySafeDiscountSpace = roundMoney(bucket.avgActivitySafeDiscountSpace ?? bucket.weightedAvgActivitySafeDiscountSpace ?? activityDesignSpace);
  const profitFields = activityBucketProfitFields(finalPay, netPay, cost);
  const costRisk = profitFields.profit < -1e-9;
  const bucketRisk = (Number(bucket.riskCount) || 0) > 0;
  const scenarioName = costVariant === 'avgCost'
    ? activityBucketScenarioName(scenario)
    : `${activityBucketScenarioName(scenario)} / ${activityBucketCostVariantLabel(costVariant)}`;
  const representedCount = costVariant === 'avgCost'
    ? Math.max(0, Math.floor(Number(bucket.comboCount) || 0))
    : 0;
  return {
    key: `activity-route-bucket::${bucket.key}::${costVariant}`,
    platform: bucket.platform,
    platformName: bucket.platformName,
    items,
    scenario,
    scenarioName,
    originalTotal,
    afterProductDiscount: originalTotal,
    finalPay,
    netPay,
    cost,
    activityAmount: Math.max(0, roundMoney(originalTotal - finalPay)),
    commission: 0,
    serviceFee: 0,
    freightSubsidy: 0,
    profit: profitFields.profit,
    profitRate: profitFields.profitRate,
    netProfitRate: profitFields.netProfitRate,
    costProfitRate: profitFields.costProfitRate,
    targetPayRate: 0,
    targetNetRate: 0,
    requiredPayRate: 0,
    requiredNetRate: 0,
    profitSpace: profitFields.profitSpace,
    profitRateGap: null,
    productDiscount: 0,
    full: { enabled: true, threshold: 0, amount: 0 },
    coupons: [],
    couponAmount: 0,
    baseRed: { enabled: true, threshold: 0, min: 0, max: 0, amount: activityAlreadyDiscountAmount },
    redAddOn: { enabled: true, threshold: 0, amount: activityRedAddOnAmount },
    ignored: false,
    ignoreReason: '',
    risk: {
      hasRisk: costRisk || bucketRisk,
      severity: costRisk ? 'high' : bucketRisk ? 'medium' : 'none',
      severityRank: costRisk ? 3 : bucketRisk ? 2 : 0,
      reasons: costRisk ? [`${activityBucketCostVariantLabel(costVariant)}高于商家到手价`] : [],
      target: null,
      thresholdRate: null,
      rateGap: null,
      netThresholdRate: null,
      netRateGap: null
    },
    baseFinalPay: finalPay,
    baseNetPay: netPay,
    baseProfitRate: profitFields.profitRate,
    representedComboCount: representedCount,
    activityTargetDiscountRate: bucket.avgActivityTargetDiscountRate ?? bucket.weightedAvgActivityTargetDiscountRate ?? undefined,
    activityTargetPay: bucket.avgActivityTargetPay ?? bucket.weightedAvgActivityTargetPay ?? undefined,
    activityTargetDiscountAmount,
    activityAlreadyDiscountAmount,
    activityRedAddOnAmount,
    activityDesignSpace,
    activityNetPayBoundarySpace,
    activitySafeDiscountSpace,
    activityTargetPayGap: bucket.avgActivityTargetPayGap ?? bucket.weightedAvgActivityTargetPayGap ?? undefined
  };
}

function activityBucketRowsToRouteRows(buckets: ActivityPriceBucketRow[], platforms: Platform[]) {
  const allowedPlatforms = new Set(platforms);
  return buckets
    .filter(bucket => allowedPlatforms.has(bucket.platform) && bucket.comboCount > 0)
    .map(bucket => activityBucketRouteRow(bucket, 'avgCost'))
    .sort(sortActivityBaseRows);
}

function activityBucketCostSummaryRowsToRouteRows(
  buckets: ActivityPriceBucketRow[],
  platforms: Platform[],
  options: {
    store?: ReturnType<typeof currentStoreFrom>;
    scanComboPools?: ActivityScanComboPools;
  } = {}
) {
  const allowedPlatforms = new Set(platforms);
  const rows: ActivityBaseComboRow[] = [];
  const variants: ActivityBucketCostVariant[] = ['avgCost', 'maxCost', 'minCost'];
  const lookup = createActivityScanComboPoolLookup(options.scanComboPools);
  for (const bucket of buckets) {
    if (!allowedPlatforms.has(bucket.platform) || bucket.comboCount <= 0) continue;
    const seenCosts = new Set<string>();
    for (const variant of variants) {
      const cost = activityBucketCostValue(bucket, variant);
      const costKey = roundMoney(cost).toFixed(2);
      if (seenCosts.has(costKey)) continue;
      seenCosts.add(costKey);
      const items = options.store ? activityBucketRepresentativeItems(options.store, bucket, variant, lookup) : [];
      rows.push(activityBucketRouteRow(bucket, variant, items));
    }
  }
  return rows.sort(sortActivityBaseRows);
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

function designRedAddOnRuleCandidates(
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  plannedThreshold: number,
  plannedAmount: number
) {
  const currentRules = store.activities[platform]?.redAddOns || [];
  const plannedRule = plannedAmount > 0
    ? [{ enabled: true, threshold: Math.max(0, Number(plannedThreshold) || 0), amount: roundMoney(plannedAmount) }]
    : [];
  return currentRules.concat(plannedRule);
}

function bestDesignRedAddOn(
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  basis: number,
  maxDeductible: number,
  plannedThreshold: number,
  plannedAmount: number
) {
  const rule = bestRedAddOn(designRedAddOnRuleCandidates(store, platform, plannedThreshold, plannedAmount), basis);
  return {
    ...rule,
    amount: Math.min(Math.max(0, Number(maxDeductible) || 0), nonNegativeAmount(rule.amount))
  };
}

function activityDesignSpaceWithPlatformDiscountDowngrade(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  originalTotal: number,
  targetDiscountAmount: number,
  alreadyDiscountAmount: number,
  currentFull: FullReduction,
  currentBaseRed: RedTier & { amount: number },
  currentRedAddOn: RedAddOn,
  settings: ActivityDesignSettings
) {
  const baseSpace = roundMoney(Math.max(0, targetDiscountAmount - alreadyDiscountAmount));
  if (baseSpace <= 0) return 0;
  const currentPlatformDiscountAmount = roundMoney(
    nonNegativeAmount(currentFull.amount)
    + nonNegativeAmount(currentBaseRed.amount)
    + nonNegativeAmount(currentRedAddOn.amount)
  );
  const nextFullBasis = Math.max(0, roundMoney(originalTotal - baseSpace));
  const nextFull = bestFullReduction(store.activities[platform]?.fullReductions || [], nextFullBasis);
  const nextRedBasis = Math.max(0, roundMoney(nextFullBasis - nextFull.amount));
  const nextBaseRed = bestBaseRed(state, platform, nextRedBasis);
  const nextAfterBaseRed = Math.max(0, roundMoney(nextRedBasis - nextBaseRed.amount));
  const nextRedAddOn = bestDesignRedAddOn(store, platform, nextRedBasis, nextAfterBaseRed, 0, configuredRedAddOnSpace(settings));
  const nextPlatformDiscountAmount = roundMoney(
    nonNegativeAmount(nextFull.amount)
    + nonNegativeAmount(nextBaseRed.amount)
    + nonNegativeAmount(nextRedAddOn.amount)
  );
  const downgradeLoss = Math.max(0, currentPlatformDiscountAmount - nextPlatformDiscountAmount);
  return roundMoney(baseSpace + downgradeLoss);
}

function activityOriginalRange(store: ReturnType<typeof currentStoreFrom>, settings: ActivityDesignSettings) {
  const storeRange = calculationTotalRange(store);
  const filterMin = Math.max(0, Number(store.startPrice) || 0, Number(settings.originalMin) || 0);
  const rawFilterMax = settings.originalMax === '' ? Infinity : Math.max(filterMin, Number(settings.originalMax) || 0);
  return {
    min: filterMin,
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
  return `原价¥${roundMoney(range.min)}-${originalMaxText}，饭团最多${activityStapleMaxCount(settings)}份，凑单小吃最多${addOnMaxText}，支付价最低¥${roundMoney(payMin)}，支付价最高${payMaxText}，商家到手价最低¥${roundMoney(activityMinNetPayFloor(settings, settings.objective))}`;
}

function activityDesignMaxChecks(store: ReturnType<typeof currentStoreFrom>) {
  const storeMaxChecks = Math.floor(Number(store.maxChecks) || 0);
  return storeMaxChecks > 0 ? storeMaxChecks : ACTIVITY_DESIGN_DEFAULT_MAX_CHECKS;
}

function isActivityMainCandidate(store: ReturnType<typeof currentStoreFrom>, platform: Platform, index: number) {
  const product = store.products[index];
  return isProductListedOnPlatform(product, platform) && isMealMainProduct(product);
}

function buildActivityCandidates(store: ReturnType<typeof currentStoreFrom>, platform: Platform) {
  const mainProducts: ActivityCandidate[] = [];
  const addOnProducts: ActivityCandidate[] = [];
  store.products.forEach((product, index) => {
    if (!isProductListedOnPlatform(product, platform)) return;
    const price = platformOriginalUnitPrice(product, platform);
    if (isActivityMainCandidate(store, platform, index)) {
      mainProducts.push({ index, price, stapleCount: mealMainStapleServingCount(product) });
      return;
    }
    if (isMealAddOnProduct(product)) addOnProducts.push({ index, price, stapleCount: 0 });
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
  const poolBuild = await buildActivityDesignComboPoolsAsync(store, platform, settings, maxDurationMs, startedAt, onProgress);
  const { range, maxItems, maxChecks, addOnMaxCountLimit, pools } = poolBuild;
  let checked = 0;
  let validCombos = 0;
  let stopped = poolBuild.stopped;
  let stoppedReason = poolBuild.stoppedReason;
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

  if (poolBuild.poolTruncated && !stopped) {
    stopped = true;
    stoppedReason = 'maxChecks';
  }
  onProgress?.({ checked, validCombos, stopped, stoppedReason });
  return { checked, validCombos, stopped, stoppedReason, pools };
}

async function buildActivityDesignComboPoolsAsync(
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  settings: ActivityDesignSettings,
  maxDurationMs: number,
  startedAt: number,
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
      onProgress({ checked: 0, validCombos: 0, stopped, stoppedReason });
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
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
    maxPoolRows: maxChecks,
    shouldStop: () => stopped,
    maybeYield
  });
  const poolTruncated = Boolean(pools.truncated);
  return {
    range,
    maxItems,
    maxChecks,
    addOnMaxCountLimit,
    pools,
    poolTruncated,
    stopped,
    stoppedReason
  };
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
  if (!isInOriginalRange(settings, totals.originalTotal)) return null;

  const activity = store.activities[platform];
  const platformFull = bestFullReduction(activity.fullReductions || [], totals.originalTotal);
  const afterPlatformFull = Math.max(0, roundMoney(totals.originalTotal - platformFull.amount));
  const baseRed = bestBaseRed(state, platform, afterPlatformFull);
  const afterBaseRed = Math.max(0, roundMoney(afterPlatformFull - baseRed.amount));
  const redAddOn = bestDesignRedAddOn(store, platform, afterPlatformFull, afterBaseRed, 0, configuredRedAddOnSpace(settings));
  const redAddAmount = redAddOn.amount;
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddAmount));
  const targetObjective = settings.objective || 'longTerm';
  const targetDiscountRate = activityOriginalDiscountRate(settings, targetObjective, totals.originalTotal);
  const targetPay = roundMoney(totals.originalTotal * (1 - targetDiscountRate));
  const targetDiscountAmount = roundMoney(Math.max(0, totals.originalTotal - targetPay));
  const alreadyDiscountAmount = roundMoney(Math.max(0, totals.originalTotal - finalPay));
  const activityDesignSpace = activityDesignSpaceWithPlatformDiscountDowngrade(
    state,
    store,
    platform,
    totals.originalTotal,
    targetDiscountAmount,
    alreadyDiscountAmount,
    platformFull,
    baseRed,
    redAddOn,
    settings
  );
  const row = createComboEvaluationRow(
    state,
    store,
    platform,
    totals.items,
    { originalTotal: totals.originalTotal, afterProductDiscount: totals.originalTotal, costTotal: totals.costTotal, productDiscount: 0 },
    {
      full: platformFull,
      coupons: [],
      couponAmount: 0,
      baseRed,
      redAddOn
    },
    finalPay
  );
  const activityNetPayBoundarySpace = netPayFloorRouteDiscountSpace(state, store, finalPay, settings, targetObjective);
  const baseRow = {
    ...row,
    baseFinalPay: finalPay,
    baseNetPay: row.netPay,
    baseProfitRate: paymentGrossProfitRate(row),
    activityTargetObjective: targetObjective,
    activityTargetObjectiveName: objectiveName(targetObjective, settings),
    activityTargetDiscountRate: targetDiscountRate,
    activityTargetPay: targetPay,
    activityTargetDiscountAmount: targetDiscountAmount,
    activityAlreadyDiscountAmount: alreadyDiscountAmount,
    activityRedAddOnAmount: redAddAmount,
    activityDesignSpace,
    activityNetPayBoundarySpace,
    activitySafeDiscountSpace: activityDesignSpace,
    activityTargetPayGap: roundMoney(finalPay - targetPay)
  };
  return baseRow;
}

function routeMoneyAmount(value: number) {
  return roundMoney(Math.max(0, Number(value) || 0));
}

function routeDiscountRate(originalTotal: number, finalPay: number) {
  const original = Math.max(0, Number(originalTotal) || 0);
  if (original <= 0) return null;
  const rate = Math.max(0, Math.min(1, (original - Math.max(0, Number(finalPay) || 0)) / original));
  return Math.round(rate * 10000) / 10000;
}

function allocateRouteDiscount(
  totalSpace: number,
  shares: { full: number; coupon: number; addOn: number },
  caps: { full: number; coupon: number }
) {
  const total = routeMoneyAmount(totalSpace);
  if (total <= 0) return { fullAmount: 0, couponAmount: 0, routeAddOnCostSpace: 0 };
  const parts = [
    { key: 'full' as const, share: Math.max(0, shares.full), cap: Math.max(0, caps.full) },
    { key: 'coupon' as const, share: Math.max(0, shares.coupon), cap: Math.max(0, caps.coupon) },
    { key: 'addOn' as const, share: Math.max(0, shares.addOn), cap: Infinity }
  ];
  const shareTotal = parts.reduce((sum, part) => sum + part.share, 0) || 1;
  const allocations = { full: 0, coupon: 0, addOn: 0 };
  let used = 0;
  parts.forEach(part => {
    const desired = total * (part.share / shareTotal);
    const amount = Math.min(part.cap, roundMoney(Math.max(0, desired)));
    allocations[part.key] = amount;
    used = roundMoney(used + amount);
  });
  let remaining = roundMoney(total - used);
  while (remaining > 1e-9) {
    const next = parts
      .map(part => {
        const desired = total * (part.share / shareTotal);
        return {
          part,
          room: part.cap - allocations[part.key],
          remainder: desired - allocations[part.key]
        };
      })
      .filter(item => item.room > 1e-9)
      .sort((a, b) => b.remainder - a.remainder || b.part.share - a.part.share)[0];
    if (!next) break;
    const increment = Math.min(remaining, next.room);
    allocations[next.part.key] = roundMoney(allocations[next.part.key] + increment);
    remaining = roundMoney(remaining - increment);
  }
  return {
    fullAmount: allocations.full,
    couponAmount: allocations.coupon,
    routeAddOnCostSpace: allocations.addOn
  };
}

function netPayAtFinalPay(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  finalPay: number
) {
  const safeFinalPay = Math.max(0, Number(finalPay) || 0);
  const fee = buildFeeSummary(state, store, safeFinalPay);
  return Math.max(0, roundMoney(safeFinalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
}

function netPayFloorRouteDiscountSpace(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  finalPay: number,
  settings: ActivityDesignSettings,
  objective?: ActivityDesignObjective
) {
  const currentFinalPay = Math.max(0, Number(finalPay) || 0);
  const minNetPay = activityMinNetPayFloor(settings, objective);
  if (currentFinalPay <= 0 || netPayAtFinalPay(state, store, currentFinalPay) + 1e-9 < minNetPay) return 0;

  let low = 0;
  let high = currentFinalPay;
  for (let index = 0; index < 28; index++) {
    const discount = (low + high) / 2;
    const nextNetPay = netPayAtFinalPay(state, store, currentFinalPay - discount);
    if (nextNetPay + 1e-9 >= minNetPay) low = discount;
    else high = discount;
  }
  return roundMoney(Math.max(0, low));
}

function activityOriginalDiscountRate(settings: ActivityDesignSettings, objective: ActivityDesignObjective, originalTotal: number) {
  const profile = activityObjectivePayProfile(settings, objective);
  const original = Math.max(0, Number(originalTotal) || 0);
  const tier = profile.originalDiscountTiers.find(row => original + 1e-9 >= row.originalMin && original < row.originalMax - 1e-9);
  const baseOriginalDiscountRate = Math.max(0, Math.min(95, Number(settings.baseOriginalDiscountRate ?? 50) || 0));
  return Math.max(0, Math.min(95, Number(tier?.discountRate ?? baseOriginalDiscountRate) || 0)) / 100;
}

function paymentGrossProfitRate(row: Pick<ComboEvaluationRow, 'finalPay' | 'cost'>) {
  const finalPay = Math.max(0, Number(row.finalPay) || 0);
  if (finalPay <= 1e-9) return null;
  return (finalPay - (Number(row.cost) || 0)) / finalPay;
}

function activityObjectiveDesignSpace(
  row: Pick<ComboEvaluationRow, 'originalTotal' | 'finalPay' | 'netPay'>,
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  const originalTotal = Math.max(0, Number(row.originalTotal) || 0);
  const finalPay = Math.max(0, Number(row.finalPay) || 0);
  if (originalTotal <= 0 || finalPay <= 0) return 0;
  const targetTotalDiscount = originalTotal * activityOriginalDiscountRate(settings, objective, originalTotal);
  const alreadyDiscount = Math.max(0, originalTotal - finalPay);
  return roundMoney(Math.max(0, targetTotalDiscount - alreadyDiscount));
}

function activityObjectiveDiscountSpace(
  row: Pick<ComboEvaluationRow, 'originalTotal' | 'finalPay' | 'netPay'>,
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  return activityObjectiveDesignSpace(row, settings, objective);
}

function activityNetPayBoundaryQuantile(objective: ActivityDesignObjective, level = 0) {
  const base = ({
    longTerm: 0.18,
    orderGrowth: 0.34,
    raiseAov: 0.3,
    hotProduct: 0.4,
    highMarginConversion: 0.36,
    profitRecovery: 0.12
  } as Record<string, number>)[objective] ?? 0.34;
  const step = ({
    longTerm: 0.08,
    orderGrowth: 0.08,
    raiseAov: 0.07,
    hotProduct: 0.08,
    highMarginConversion: 0.07,
    profitRecovery: 0.06
  } as Record<string, number>)[objective] ?? 0.08;
  const cap = ({
    longTerm: 0.5,
    orderGrowth: 0.58,
    raiseAov: 0.52,
    hotProduct: 0.6,
    highMarginConversion: 0.56,
    profitRecovery: 0.4
  } as Record<string, number>)[objective] ?? 0.58;
  return Math.min(cap, base + Math.max(0, level) * step);
}

function discountSpaceForObjective(
  rows: ComboEvaluationRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  const targetProfitRate = 0;
  const targetSpaces: number[] = [];

  for (const row of rows) {
    targetSpaces.push(activityObjectiveDiscountSpace(row, settings, objective));
  }
  const positiveSpaces = targetSpaces.filter(value => value > 0.1);
  if (!positiveSpaces.length) {
    return {
      targetProfitRate,
      safeDiscountSpace: 0,
      averageTargetSpace: 0,
      lossBoundSpace: 0,
      lossLimited: false
    };
  }

  const averageBoundarySpace = positiveSpaces.length
    ? positiveSpaces.reduce((sum, value) => sum + value, 0) / positiveSpaces.length
    : 0;
  const boundarySpace = quantile(positiveSpaces, activityNetPayBoundaryQuantile(objective)) ?? 0;

  return {
    targetProfitRate,
    safeDiscountSpace: roundMoney(averageBoundarySpace),
    averageTargetSpace: roundMoney(averageBoundarySpace),
    lossBoundSpace: roundMoney(boundarySpace),
    lossLimited: false
  };
}

function activityTargetSummaryForRows(
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  if (!rows.length) return { targetDiscountRate: null };
  let rateSum = 0;
  rows.forEach(row => {
    const originalTotal = Math.max(0, Number(row.originalTotal) || 0);
    const targetDiscountRate = activityOriginalDiscountRate(settings, objective, originalTotal);
    rateSum += targetDiscountRate;
  });
  return {
    targetDiscountRate: rateSum / rows.length
  };
}

function recommendationForBand(
  band: PriceBandRow,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
): ActivityRecommendationRow | null {
  const discountSpace = discountSpaceForObjective(rows, settings, objective);
  const targetSummary = activityTargetSummaryForRows(rows, settings, objective);
  const initialRedAddOnSpace = configuredRedAddOnSpace(settings);
  if (discountSpace.safeDiscountSpace <= 0.1 && initialRedAddOnSpace <= 0) return null;

  const maxFull = settings.couponDesignMaxFullAmount === '' ? Number.POSITIVE_INFINITY : Math.max(0, Number(settings.couponDesignMaxFullAmount) || 0);
  const maxCoupon = settings.couponDesignMaxCouponAmount === '' ? Number.POSITIVE_INFINITY : Math.max(0, Number(settings.couponDesignMaxCouponAmount) || 0);
  const safeDiscount = routeMoneyAmount(discountSpace.safeDiscountSpace);
  const targetProfitRate = 0;

  const split = {
    full: activityDiscountShareRatio(settings, objective, 'full'),
    coupon: activityDiscountShareRatio(settings, objective, 'coupon'),
    product: 0,
    addOn: activityDiscountShareRatio(settings, objective, 'reserve'),
    actionType: {
      longTerm: '满减底盘为主',
      orderGrowth: '券拉单为主',
      raiseAov: '券门槛引导加购',
      hotProduct: '爆品券刺激',
      highMarginConversion: '高到手空间转化',
      profitRecovery: '收紧优惠提升到手'
    }[objective] || `${objectiveName(objective, settings)}活动`
  };

  const routeAllocation = allocateRouteDiscount(safeDiscount, {
    full: split.full,
    coupon: split.coupon,
    addOn: split.addOn
  }, {
    full: maxFull,
    coupon: maxCoupon
  });
  const fullAmount = routeAllocation.fullAmount;
  const couponAmount = routeAllocation.couponAmount;
  const productDiscountAmount = 0;
  const routeAddOnCostSpace = routeAllocation.routeAddOnCostSpace;
  const addOnCostSpace = totalRedAddOnSpace(settings, routeAddOnCostSpace);
  const totalDiscount = roundMoney(fullAmount + couponAmount + productDiscountAmount + addOnCostSpace);
  if (totalDiscount <= 0) return null;

  const diagnosis = discountSpace.averageTargetSpace <= 0
    ? initialRedAddOnSpace > 0
      ? '当前主要来自神券/爆红包加码参数，需校验主要支付场景覆盖'
      : '该原价段当前支付价已经偏低，不建议继续让利'
    : '当前原价段仍有可活动空间，可进入活动核验';

  return {
    key: `${band.key}:${objective}:${fullAmount}:${couponAmount}:${productDiscountAmount}:${addOnCostSpace}`,
    platform: rows[0].platform,
    platformName: rows[0].platformName,
    objective,
    objectiveName: objectiveName(objective, settings),
    targetDiscountRate: targetSummary.targetDiscountRate,
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
    avgProfitBefore: null,
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
    .filter(row => row.fullAmount >= ACTIVITY_ROUTE_MIN_FULL_AMOUNT - 1e-9)
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
    return !sorted.slice(0, index).some(prev => prev.threshold <= coupon.threshold + 1e-9 && prev.amount >= coupon.amount - 1e-9);
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
  const targetProfitRate = 0;
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
    ? '阶梯满减+订单券'
    : fullReductionRules.length
      ? '阶梯满减'
      : couponRules.length
        ? '订单券'
        : '加码空间';

  return {
    key,
    platform: firstBand.platform as Platform,
    platformName: firstBand.platformName,
    objective,
    objectiveName: objectiveName(objective, settings),
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
    avgProfitBefore: null,
    avgProfitAfter: null,
    minProfitAfter: null,
    profitRateSpreadAfter: null,
    avgFinalPayAfter: 0,
    targetProfitRate,
    score: 999,
    actionType,
    diagnosis: '已按原价区间生成可命中的阶梯满减规则和订单券列表，待支付价校验',
    exampleItems: rows[0].items
  };
}

function normalizeScaledFullRules(rules: FullReduction[], scale: number) {
  let highestAmount = 0;
  return rules
    .map(rule => ({
      ...rule,
      amount: routeMoneyAmount(rule.amount * scale)
    }))
    .filter(rule => rule.enabled && rule.amount >= ACTIVITY_ROUTE_MIN_FULL_AMOUNT - 1e-9)
    .sort((a, b) => a.threshold - b.threshold || b.amount - a.amount)
    .reduce<FullReduction[]>((normalized, rule) => {
      if (rule.amount <= highestAmount + 1e-9) return normalized;
      highestAmount = rule.amount;
      normalized.push({ enabled: true, threshold: roundMoney(rule.threshold), amount: roundMoney(rule.amount) });
      return normalized;
    }, []);
}

function normalizeScaledCouponRules(rules: Coupon[], scale: number) {
  const bestByThreshold = new Map<number, Coupon>();
  rules.forEach(rule => {
    const threshold = roundMoney(rule.threshold);
    const amount = routeMoneyAmount(rule.amount * scale);
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
    return !sorted.slice(0, index).some(prev => prev.threshold <= coupon.threshold + 1e-9 && prev.amount >= coupon.amount - 1e-9);
  });
}

function routeVariantsForRecommendation(row: ActivityRecommendationRow, settings: ActivityDesignSettings) {
  const hasScalableDiscount = row.fullReductionRules.length > 0 || row.couponRules.length > 0 || row.routeAddOnCostSpace > 0;
  const variants = hasScalableDiscount
    ? [
      { key: 'conservative', label: '保守折扣', scale: 0.8 },
      { key: 'standard', label: '标准折扣', scale: 1 },
      { key: 'aggressive', label: '积极折扣', scale: 1.2 }
    ]
    : [{ key: 'initial', label: '初始路线', scale: 1 }];
  return variants
    .map(variant => {
      const fullReductionRules = normalizeScaledFullRules(row.fullReductionRules, variant.scale);
      const couponRules = normalizeScaledCouponRules(row.couponRules, variant.scale);
      const routeAddOnCostSpace = routeMoneyAmount(row.routeAddOnCostSpace * variant.scale);
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
  const full = bestFullReduction(recommendation.fullReductionRules, row.originalTotal);
  const afterFull = Math.max(0, roundMoney(row.originalTotal - full.amount));
  const couponOption = bestCouponOption(recommendation.couponRules, afterFull, 1);
  const afterCoupon = Math.max(0, roundMoney(afterFull - couponOption.amount));
  const productDiscountAmount = Math.min(afterFull, Math.max(0, recommendation.productDiscountAmount));
  const afterProductDiscount = Math.max(0, roundMoney(row.originalTotal - productDiscountAmount));
  const afterRouteDiscounts = Math.max(0, roundMoney(afterCoupon - productDiscountAmount));
  const baseRed = bestBaseRed(state, row.platform, afterRouteDiscounts);
  const afterBaseRed = Math.max(0, roundMoney(afterRouteDiscounts - baseRed.amount));
  const redAddOn = bestDesignRedAddOn(
    store,
    row.platform,
    afterRouteDiscounts,
    afterBaseRed,
    recommendation.threshold,
    recommendationRedAddOnSpace(settings, recommendation)
  );
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOn.amount));
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
      redAddOn
    },
    finalPay
  );
  const bucketScenarioOverride = row.key.startsWith('activity-route-bucket::')
    ? { scenario: row.scenario, scenarioName: row.scenarioName }
    : {};
  return {
    ...simulated,
    ...bucketScenarioOverride,
    key: `${recommendation.key}:${row.key}`,
    recommendationKey: recommendation.key,
    recommendationLabel: `${recommendation.objectiveName} / ${recommendation.originalBandLabel}`,
    representedComboCount: row.representedComboCount
  };
}

function sampleActivityRows(rows: ActivityBaseComboRow[], limit = ACTIVITY_ROUTE_DESIGN_SAMPLE_LIMIT) {
  const source = rows;
  if (source.length <= limit) return source.slice();
  const sorted = source.slice().sort((a, b) => a.originalTotal - b.originalTotal || a.finalPay - b.finalPay || a.key.localeCompare(b.key));
  const sampled: ActivityBaseComboRow[] = [];
  const used = new Set<string>();
  const step = (sorted.length - 1) / Math.max(1, limit - 1);
  for (let i = 0; i < limit; i++) {
    const row = sorted[Math.round(i * step)];
    if (!row || used.has(row.key)) continue;
    used.add(row.key);
    sampled.push(row);
  }
  return sampled.length ? sampled : sorted.slice(0, limit);
}

function distanceToRange(value: number, min: number, max: number) {
  if (value + 1e-9 < min) return min - value;
  if (value > max + 1e-9) return value - max;
  return 0;
}

function activityTargetPayGap(settings: ActivityDesignSettings, objective: ActivityDesignObjective, row: Pick<ComboEvaluationRow, 'originalTotal' | 'finalPay'>) {
  const targetPay = activityTargetPayFromOriginal(settings, objective, row.originalTotal);
  return Math.max(0, (Number(row.finalPay) || 0) - targetPay);
}

/**
 * 根据全路线基准让利率和目标阶梯覆盖选择活动路线设计样本。
 *
 * @param rows 当前平台可参与活动设计的基础组合。
 * @param settings 门店级活动设计参数。
 * @param objective 经营目标。
 * @returns 优先使用仍有活动空间的组合，避免被固定支付区间牵引到高门槛。
 */
function activityRowsForObjective(
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  if (!rows.length) return rows;
  const minRows = Math.min(40, Math.max(8, Math.floor(rows.length * 0.04)));
  const adjustableRows = rows.filter(row => baseActivityDesignSpace(row, settings, objective) >= ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9);
  if (adjustableRows.length >= minRows) return adjustableRows;
  if (adjustableRows.length) return adjustableRows;

  return rows
    .slice()
    .sort((a, b) => (
      activityTargetPayGap(settings, objective, b) - activityTargetPayGap(settings, objective, a)
      || a.originalTotal - b.originalTotal
      || a.key.localeCompare(b.key)
    ))
    .slice(0, Math.min(rows.length, ACTIVITY_ROUTE_DESIGN_SAMPLE_LIMIT));
}

function uniqueActivityBaseRows(rows: ActivityBaseComboRow[]) {
  return Array.from(new Map(rows.map(row => [row.key, row])).values()).sort(sortActivityBaseRows);
}

function activityFullReductionRowsForObjective(
  rows: ActivityBaseComboRow[],
  objectiveRows: ActivityBaseComboRow[]
) {
  if (objectiveRows.length) return uniqueActivityBaseRows(objectiveRows);
  return uniqueActivityBaseRows(rows);
}

function activityKnownRedAddOnAmount(row: Pick<ComboEvaluationRow, 'redAddOn'> & Partial<Pick<ActivityBaseComboRow, 'activityRedAddOnAmount'>>) {
  if (row.activityRedAddOnAmount !== undefined && row.activityRedAddOnAmount !== null) {
    return nonNegativeAmount(row.activityRedAddOnAmount);
  }
  return nonNegativeAmount(row.redAddOn?.amount);
}

type FullReductionBasisRow = {
  row: ActivityBaseComboRow;
  basis: number;
  targetSpace: number;
  rawTargetSpace: number;
  addOnDiscount: number;
  downgradeLoss: number;
  currentFullAmount: number;
  boundarySpace: number;
  targetDiscountRate: number;
  demandWeight: number;
};

type FullReductionBucket = {
  price: number;
  rows: FullReductionBasisRow[];
};

function targetSpaceMetric(
  rows: Array<{ targetSpace: number; demandWeight: number }>,
  basis: ReturnType<typeof activityObjectivePayProfile>['fullAmountBasis']
) {
  const values = rows.map(row => ({ value: row.targetSpace, weight: row.demandWeight }));
  if (basis === 'p75') return demandQuantileValue(values, 0.75) ?? 0;
  if (basis === 'min') return values.length ? Math.min(...values.map(row => row.value)) : 0;
  if (basis === 'max') return values.length ? Math.max(...values.map(row => row.value)) : 0;
  return demandAverageValue(values) ?? 0;
}

function fullReductionTargetMetric(rows: FullReductionBasisRow[], basis: ReturnType<typeof activityObjectivePayProfile>['fullAmountBasis']) {
  return targetSpaceMetric(rows, basis);
}

function netPayBoundaryReferenceMetric(rows: Array<{ boundarySpace: number; demandWeight: number }>) {
  return demandAverageValue(rows.map(row => ({ value: row.boundarySpace, weight: row.demandWeight }))) ?? 0;
}

function targetDiscountRateReferenceMetric(rows: Array<{ targetDiscountRate: number; demandWeight: number }>) {
  return demandAverageValue(rows.map(row => ({ value: row.targetDiscountRate, weight: row.demandWeight }))) ?? 0;
}

function buildFullReductionBuckets(rows: FullReductionBasisRow[]) {
  const grouped = new Map<number, FullReductionBasisRow[]>();
  for (const row of rows) {
    const price = Math.max(0, Math.floor(Number(row.basis) || 0));
    const bucketRows = grouped.get(price) || [];
    bucketRows.push(row);
    grouped.set(price, bucketRows);
  }
  return Array.from(grouped.entries())
    .map<FullReductionBucket>(([price, bucketRows]) => ({
      price,
      rows: bucketRows
    }))
    .filter(bucket => bucket.rows.length)
    .sort((a, b) => a.price - b.price);
}

function fullReductionThresholdCandidates(value: number, minThreshold: number) {
  const threshold = Math.max(minThreshold, Math.floor(Math.max(0, Number(value) || 0) + 1e-9));
  return [threshold];
}

function maxFullReductionAmount(settings: ActivityDesignSettings) {
  return settings.couponDesignMaxFullAmount === ''
    ? Number.POSITIVE_INFINITY
    : roundMoney(Math.max(0, Number(settings.couponDesignMaxFullAmount) || 0));
}

function maxCouponAmount(settings: ActivityDesignSettings) {
  return settings.couponDesignMaxCouponAmount === ''
    ? Number.POSITIVE_INFINITY
    : roundMoney(Math.max(0, Number(settings.couponDesignMaxCouponAmount) || 0));
}

type ActivityRouteDesignDiscountKind = 'full' | 'coupon';

function baseActivityDesignSpace(
  row: Partial<Pick<ActivityBaseComboRow, 'activitySafeDiscountSpace' | 'activityDesignSpace' | 'activityTargetDiscountRate' | 'activityTargetObjective'>> & Pick<ComboEvaluationRow, 'originalTotal' | 'finalPay' | 'netPay'>,
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  const expectedRate = activityOriginalDiscountRate(settings, objective, row.originalTotal);
  const storedRate = row.activityTargetDiscountRate;
  const canUseStoredSpace = row.activityTargetObjective === objective
    || (row.activityTargetObjective === undefined && (storedRate === undefined || storedRate === null || Math.abs(storedRate - expectedRate) < 1e-6));
  if (canUseStoredSpace && row.activitySafeDiscountSpace !== undefined && row.activitySafeDiscountSpace !== null) {
    return nonNegativeAmount(row.activitySafeDiscountSpace);
  }
  if (canUseStoredSpace && row.activityDesignSpace !== undefined && row.activityDesignSpace !== null) {
    return nonNegativeAmount(row.activityDesignSpace);
  }
  return activityObjectiveDiscountSpace(row, settings, objective);
}

function activityRouteAddOnThreshold(
  fullReductionRules: FullReduction[],
  couponRules: Coupon[],
  fallback: number
) {
  const firstFullThreshold = normalizeActivityFullRules(fullReductionRules)[0]?.threshold;
  const firstCouponThreshold = normalizeActivityCouponRules(couponRules)[0]?.threshold;
  return firstFullThreshold ?? firstCouponThreshold ?? Math.max(0, Number(fallback) || 0);
}

function activityRouteDiscountState(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  row: ActivityBaseComboRow,
  settings: ActivityDesignSettings,
  fullReductionRules: FullReduction[],
  couponRules: Coupon[],
  extraKind: ActivityRouteDesignDiscountKind,
  extraDiscount: number
) {
  const originalTotal = Math.max(0, Number(row.originalTotal) || 0);
  const normalizedFullRules = normalizeActivityFullRules(fullReductionRules);
  const normalizedCouponRules = normalizeActivityCouponRules(couponRules);
  const full = bestFullReduction(normalizedFullRules, originalTotal);
  const extra = roundMoney(Math.max(0, Number(extraDiscount) || 0));
  const afterFull = Math.max(0, roundMoney(originalTotal - full.amount - (extraKind === 'full' ? extra : 0)));
  const couponOption = bestCouponOption(normalizedCouponRules, afterFull, 1);
  const afterCoupon = Math.max(0, roundMoney(afterFull - couponOption.amount - (extraKind === 'coupon' ? extra : 0)));
  const baseRed = bestBaseRed(state, row.platform, afterCoupon);
  const afterBaseRed = Math.max(0, roundMoney(afterCoupon - baseRed.amount));
  const redAddOn = bestDesignRedAddOn(
    store,
    row.platform,
    afterCoupon,
    afterBaseRed,
    activityRouteAddOnThreshold(normalizedFullRules, normalizedCouponRules, originalTotal),
    configuredRedAddOnSpace(settings)
  );
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOn.amount));
  return {
    fullAmount: roundMoney(full.amount + (extraKind === 'full' ? extra : 0)),
    couponAmount: roundMoney(couponOption.amount + (extraKind === 'coupon' ? extra : 0)),
    baseRedAmount: nonNegativeAmount(baseRed.amount),
    redAddOnAmount: nonNegativeAmount(redAddOn.amount),
    finalPay
  };
}

function activityRouteDesignDiscountSpace(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  row: ActivityBaseComboRow,
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  fullReductionRules: FullReduction[],
  couponRules: Coupon[],
  extraKind: ActivityRouteDesignDiscountKind
) {
  const hasRouteRules = fullReductionRules.length > 0 || couponRules.length > 0;
  const targetDiscountRate = activityOriginalDiscountRate(settings, objective, row.originalTotal);
  if (!hasRouteRules) {
    const targetSpace = roundMoney(baseActivityDesignSpace(row, settings, objective));
    const addOnDiscount = activityKnownRedAddOnAmount(row);
    return {
      targetSpace: targetSpace >= ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9 ? targetSpace : 0,
      rawTargetSpace: roundMoney(targetSpace + addOnDiscount),
      addOnDiscount,
      downgradeLoss: 0,
      currentFullAmount: 0,
      boundarySpace: netPayFloorRouteDiscountSpace(state, store, row.finalPay, settings, objective),
      targetDiscountRate,
      demandWeight: activityExpectedPayWeight(settings, objective, row.scenario, row.baseFinalPay, row.originalTotal)
    };
  }

  const current = activityRouteDiscountState(state, store, row, settings, fullReductionRules, couponRules, extraKind, 0);
  const targetDiscountAmount = row.originalTotal * targetDiscountRate;
  const alreadyDiscountAmount = Math.max(0, row.originalTotal - current.finalPay);
  const baseSpace = roundMoney(Math.max(0, targetDiscountAmount - alreadyDiscountAmount));
  const addOnDiscount = roundMoney(current.redAddOnAmount);
  if (baseSpace < ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9) {
    return {
      targetSpace: 0,
      rawTargetSpace: roundMoney(baseSpace + addOnDiscount),
      addOnDiscount,
      downgradeLoss: 0,
      currentFullAmount: current.fullAmount,
      boundarySpace: netPayFloorRouteDiscountSpace(state, store, current.finalPay, settings, objective),
      targetDiscountRate,
      demandWeight: activityExpectedPayWeight(settings, objective, row.scenario, row.baseFinalPay, row.originalTotal)
    };
  }

  const next = activityRouteDiscountState(state, store, row, settings, fullReductionRules, couponRules, extraKind, baseSpace);
  const currentDependentDiscount = extraKind === 'full'
    ? current.couponAmount + current.baseRedAmount + current.redAddOnAmount
    : current.baseRedAmount + current.redAddOnAmount;
  const nextDependentDiscount = extraKind === 'full'
    ? next.couponAmount + next.baseRedAmount + next.redAddOnAmount
    : next.baseRedAmount + next.redAddOnAmount;
  const downgradeLoss = roundMoney(Math.max(0, currentDependentDiscount - nextDependentDiscount));
  const targetSpace = roundMoney(baseSpace + downgradeLoss);
  return {
    targetSpace: targetSpace >= ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9 ? targetSpace : 0,
    rawTargetSpace: roundMoney(baseSpace + addOnDiscount),
    addOnDiscount,
    downgradeLoss,
    currentFullAmount: current.fullAmount,
    boundarySpace: netPayFloorRouteDiscountSpace(state, store, current.finalPay, settings, objective),
    targetDiscountRate,
    demandWeight: activityExpectedPayWeight(settings, objective, row.scenario, row.baseFinalPay, row.originalTotal)
  };
}

function normalizeActivityCouponRules(coupons: Coupon[]) {
  const bestBySceneThreshold = new Map<string, Coupon>();
  for (const coupon of coupons) {
    const threshold = integerThreshold(coupon.threshold);
    const amount = roundMoney(Math.max(0, Number(coupon.amount) || 0));
    if (amount <= 0) continue;
    const sceneKey = coupon.sceneKey || coupon.sceneName || coupon.name || 'default';
    const dedupeKey = `${sceneKey}:${threshold}`;
    const current = bestBySceneThreshold.get(dedupeKey);
    if (!current || amount > current.amount + 1e-9) {
      bestBySceneThreshold.set(dedupeKey, {
        ...coupon,
        enabled: true,
        threshold,
        amount,
        name: coupon.name || `建议订单券满${threshold}减${amount}`
      });
    }
  }
  const sorted = Array.from(bestBySceneThreshold.values()).sort((a, b) => (
    (a.sceneName || a.name).localeCompare(b.sceneName || b.name, 'zh-CN')
    || a.threshold - b.threshold
    || b.amount - a.amount
  ));
  return sorted.filter((coupon, index) => {
    const sceneKey = coupon.sceneKey || coupon.sceneName || coupon.name || 'default';
    return !sorted.slice(0, index).some(prev => {
      const prevSceneKey = prev.sceneKey || prev.sceneName || prev.name || 'default';
      return prevSceneKey === sceneKey
        && prev.threshold <= coupon.threshold + 1e-9
        && prev.amount >= coupon.amount - 1e-9;
    });
  });
}

function normalizeActivityFullRules(rules: FullReduction[], maxRules = ACTIVITY_ROUTE_MAX_FULL_RULES) {
  let highestAmount = 0;
  return rules
    .map(rule => ({
      ...rule,
      enabled: true,
      threshold: integerThreshold(rule.threshold),
      amount: roundMoney(Math.max(0, Number(rule.amount) || 0))
    }))
    .filter(rule => rule.amount >= ACTIVITY_ROUTE_MIN_FULL_AMOUNT - 1e-9)
    .sort((a, b) => a.threshold - b.threshold || b.amount - a.amount)
    .reduce<FullReduction[]>((normalized, rule) => {
      if (normalized.length >= maxRules) return normalized;
      if (rule.amount <= highestAmount + 1e-9) return normalized;
      highestAmount = rule.amount;
      normalized.push(rule);
      return normalized;
    }, []);
}

function createActivityRouteRecommendation(
  platform: Platform,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  fullReductionRules: FullReduction[],
  couponRules: Coupon[],
  actionType: string,
  diagnosis: string,
  routeKind?: ActivityRecommendationRow['routeKind'],
  userScenarioName?: string,
  couponBucketSuggestions: ActivityCouponBucketSuggestion[] = []
): ActivityRecommendationRow | null {
  if (!rows.length) return null;
  const sortedRows = rows.slice().sort((a, b) => a.originalTotal - b.originalTotal);
  const first = sortedRows[0];
  const last = sortedRows[sortedRows.length - 1];
  const normalizedFullRules = normalizeActivityFullRules(
    fullReductionRules,
    activityObjectivePayProfile(settings, objective).maxFullRuleCount || ACTIVITY_ROUTE_MAX_FULL_RULES
  );
  const normalizedCouponRules = normalizeActivityCouponRules(couponRules);
  const routeAddOnCostSpace = 0;
  const addOnCostSpace = totalRedAddOnSpace(settings, routeAddOnCostSpace);
  if (!normalizedFullRules.length && !normalizedCouponRules.length && addOnCostSpace <= 0) return null;

  const maxFullAmount = normalizedFullRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
  const maxCoupon = normalizedCouponRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
  const targetSummary = activityTargetSummaryForRows(rows, settings, objective);
  const primaryThreshold = normalizedFullRules[0]?.threshold ?? normalizedCouponRules[0]?.threshold ?? first.originalTotal;
  const originalBandLabel = normalizedFullRules.length
    ? `满减${roundMoney(primaryThreshold)} / 原价桶${roundMoney(first.originalTotal)}-${roundMoney(last.originalTotal)}`
    : `原价桶${roundMoney(first.originalTotal)}-${roundMoney(last.originalTotal)}`;
  const key = [
    'route-v2',
    platform,
    objective,
    normalizedFullRules.map(rule => `${rule.threshold}-${rule.amount}`).join('|') || 'no-full',
    normalizedCouponRules.map(rule => `${rule.sceneKey || rule.name}:${rule.threshold}-${rule.amount}`).join('|') || 'no-coupon',
    addOnCostSpace
  ].join('::');

  return {
    key,
    platform,
    platformName: first.platformName,
    routeKind,
    routeGroup: activityObjectiveGroup(settings, objective) === 'stable' ? 'stable' : 'marketing',
    userScenarioName,
    targetPayLabel: activityObjectiveTargetLabel(settings, objective),
    targetDiscountRate: targetSummary.targetDiscountRate,
    objective,
    objectiveName: objectiveName(objective, settings),
    originalBandKey: key,
    originalBandLabel,
    threshold: primaryThreshold,
    fullReductionRules: normalizedFullRules,
    couponRules: normalizedCouponRules,
    couponBucketSuggestions,
    fullAmount: maxFullAmount,
    couponAmount: maxCoupon,
    productDiscountAmount: 0,
    addOnCostSpace,
    routeAddOnCostSpace,
    totalDiscount: roundMoney(maxFullAmount + maxCoupon + addOnCostSpace),
    safeDiscountSpace: roundMoney(maxFullAmount + maxCoupon),
    hitCount: rows.length,
    avgProfitBefore: null,
    avgProfitAfter: null,
    minProfitAfter: null,
    profitRateSpreadAfter: null,
    avgFinalPayAfter: 0,
    targetProfitRate: 0,
    score: 999,
    actionType,
    diagnosis,
    exampleItems: []
  };
}

function evaluateActivityRouteMetrics(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  settings: ActivityDesignSettings,
  recommendation: ActivityRecommendationRow,
  rows: ActivityBaseComboRow[]
): ActivityRouteMetrics {
  let activeCount = 0;
  let ignoredCount = 0;
  let finalPaySum = 0;
  let businessPayWeightSum = 0;
  let corePayCount = 0;
  let mainPayCount = 0;
  let highPayCount = 0;
  let discountRateSum = 0;
  let discountRateCount = 0;
  let minDiscountRate: number | null = null;
  let maxDiscountRate: number | null = null;

  for (const row of rows) {
    const simulation = markActivityPayBoundary(simulateRecommendation(state, store, row, recommendation, settings), settings, recommendation.objective);
    if (simulation.ignored) {
      ignoredCount++;
      continue;
    }
    activeCount++;
    finalPaySum += simulation.finalPay;
    const actualDiscountRate = routeDiscountRate(simulation.originalTotal, simulation.finalPay);
    if (actualDiscountRate !== null) {
      discountRateSum += actualDiscountRate;
      discountRateCount++;
      minDiscountRate = minDiscountRate === null ? actualDiscountRate : Math.min(minDiscountRate, actualDiscountRate);
      maxDiscountRate = maxDiscountRate === null ? actualDiscountRate : Math.max(maxDiscountRate, actualDiscountRate);
    }
    businessPayWeightSum += activityExpectedPayWeight(settings, recommendation.objective, simulation.scenario, simulation.finalPay, simulation.originalTotal);
    if (activityPayInCoreRange(settings, recommendation.objective, simulation.finalPay, simulation.originalTotal)) corePayCount++;
    if (activityPayInTargetRange(settings, recommendation.objective, simulation.finalPay, simulation.originalTotal)) mainPayCount++;
    if (activityPayAboveTargetCeiling(settings, recommendation.objective, simulation.finalPay, simulation.originalTotal)) highPayCount++;
  }

  const businessPayWeight = activeCount ? businessPayWeightSum / activeCount : 0;
  const corePayShare = activeCount ? corePayCount / activeCount : 0;
  const mainPayShare = activeCount ? mainPayCount / activeCount : 0;
  const highPayShare = activeCount ? highPayCount / activeCount : 0;
  const targetPayShareFloor = activityTargetPayShareFloor(settings, recommendation.objective);
  const highPayShareLimit = activityHighPayShareLimit(settings, recommendation.objective);
  const targetGap = null;
  const targetPenalty = 0;
  const spreadPenalty = 0;
  const lossPenalty = 0;
  const ignoredPenalty = rows.length ? (ignoredCount / rows.length) * 70 : 0;
  const discountPenalty = recommendation.totalDiscount * 0.03;
  const demandPenalty = activityDemandPenalty(settings, recommendation.objective, businessPayWeight, mainPayShare, highPayShare);

  return {
    activeCount,
    ignoredCount,
    avgProfitRate: null,
    minProfitRate: null,
    profitRateSpread: null,
    payBandAvgSpread: null,
    avgFinalPay: activeCount ? finalPaySum / activeCount : 0,
    actualAvgDiscountRate: discountRateCount ? Math.round((discountRateSum / discountRateCount) * 10000) / 10000 : null,
    actualMinDiscountRate: minDiscountRate,
    actualMaxDiscountRate: maxDiscountRate,
    lossCount: 0,
    lossShare: 0,
    maxLossShare: 0,
    lossOutOfToleranceCount: 0,
    lossShareOverflow: 0,
    minAllowedProfitRate: 0,
    businessPayWeight: roundMoney(businessPayWeight),
    corePayShare: roundMoney(corePayShare),
    mainPayShare: roundMoney(mainPayShare),
    highPayShare: roundMoney(highPayShare),
    targetPayShareFloor,
    highPayShareLimit,
    targetGap,
    targetPenalty: roundMoney(targetPenalty),
    spreadPenalty: roundMoney(spreadPenalty),
    lossPenalty: roundMoney(lossPenalty),
    ignoredPenalty: roundMoney(ignoredPenalty),
    discountPenalty: roundMoney(discountPenalty),
    demandPenalty: roundMoney(demandPenalty),
    score: roundMoney(targetPenalty + spreadPenalty + lossPenalty + ignoredPenalty + discountPenalty + demandPenalty)
  };
}

function activityRouteScoreLevel(metrics: ActivityRouteMetrics): ActivityRouteScoreLevel {
  if (!metrics.activeCount) return 'risk';
  if (metrics.ignoredCount >= metrics.activeCount) return 'risk';
  if (metrics.mainPayShare < metrics.targetPayShareFloor * 0.65 || metrics.highPayShare > metrics.highPayShareLimit + 0.25) return 'risk';
  if ((metrics.highPayShare || 0) > metrics.highPayShareLimit || (metrics.mainPayShare || 0) < metrics.targetPayShareFloor) return 'review';
  if (metrics.score <= 12) return 'excellent';
  if (metrics.score <= 24) return 'usable';
  return 'review';
}

function activityRouteScoreLabel(level: ActivityRouteScoreLevel) {
  return {
    excellent: '优',
    usable: '可用',
    review: '待复核',
    risk: '高风险'
  }[level];
}

function activityRouteScoreBreakdown(recommendation: ActivityRecommendationRow, metrics: ActivityRouteMetrics): ActivityRouteScoreBreakdown {
  return {
    activeCount: metrics.activeCount,
    ignoredCount: metrics.ignoredCount,
    targetGap: metrics.targetGap,
    avgProfitRate: metrics.avgProfitRate,
    targetProfitRate: recommendation.targetProfitRate,
    minProfitRate: metrics.minProfitRate,
    payBandSpread: metrics.payBandAvgSpread,
    profitRateSpread: metrics.profitRateSpread,
    lossCount: metrics.lossCount,
    lossShare: metrics.lossShare,
    maxLossShare: metrics.maxLossShare,
    lossOutOfToleranceCount: metrics.lossOutOfToleranceCount,
    minAllowedProfitRate: metrics.minAllowedProfitRate,
    targetPenalty: metrics.targetPenalty,
    spreadPenalty: metrics.spreadPenalty,
    lossPenalty: metrics.lossPenalty,
    ignoredPenalty: metrics.ignoredPenalty,
    discountPenalty: metrics.discountPenalty,
    demandPenalty: metrics.demandPenalty,
    businessPayWeight: metrics.businessPayWeight,
    corePayShare: metrics.corePayShare,
    mainPayShare: metrics.mainPayShare,
    highPayShare: metrics.highPayShare,
    targetPayShareFloor: metrics.targetPayShareFloor,
    highPayShareLimit: metrics.highPayShareLimit,
    totalPenalty: metrics.score
  };
}

function activityRouteScoreDetails(settings: ActivityDesignSettings, recommendation: ActivityRecommendationRow, metrics: ActivityRouteMetrics) {
  const discountRateText = metrics.actualAvgDiscountRate === null
    ? '执行让利率 无有效样本'
    : `执行让利率 均值${rateShareText(metrics.actualAvgDiscountRate)}，区间${rateShareText(metrics.actualMinDiscountRate ?? metrics.actualAvgDiscountRate)}-${rateShareText(metrics.actualMaxDiscountRate ?? metrics.actualAvgDiscountRate)}`;
  return [
    `主要支付覆盖 ${rateShareText(metrics.mainPayShare)}，要求 ${rateShareText(metrics.targetPayShareFloor)}`,
    `高支付价占比 ${rateShareText(metrics.highPayShare)}，上限 ${rateShareText(metrics.highPayShareLimit)}`,
    discountRateText,
    `平均支付价 ¥${roundMoney(metrics.avgFinalPay)}`,
    `总优惠 ¥${roundMoney(recommendation.totalDiscount)}`,
    `到手低于¥${roundMoney(activityMinNetPayFloor(settings, recommendation.objective))}忽略 ${metrics.ignoredCount}`
  ];
}

function appendActivityRouteGenerationDiagnosis(message: string, recommendation: ActivityRecommendationRow) {
  const source = String(recommendation.diagnosis || '');
  const markers = ['满减生成日志：', '满减候选诊断：'];
  const index = markers
    .map(marker => source.indexOf(marker))
    .filter(value => value >= 0)
    .sort((a, b) => a - b)[0];
  if (index === undefined || markers.some(marker => message.includes(marker))) return message;
  return `${message}；${source.slice(index)}`;
}

function fullReductionGenerationLogText(diagnostics: string[]) {
  return diagnostics.length ? `；满减生成日志：${diagnostics.join('；')}` : '';
}

function activityRouteDiagnosis(settings: ActivityDesignSettings, recommendation: ActivityRecommendationRow, metrics: ActivityRouteMetrics) {
  const fullRules = recommendation.fullReductionRules.slice().sort((a, b) => a.threshold - b.threshold);
  const firstRule = fullRules[0];
  const lastRule = fullRules[fullRules.length - 1];
  const fullRuleText = firstRule
    ? fullRules.length > 1
      ? `满减底盘${fullRules.length}档，首档满${roundMoney(firstRule.threshold)}减${roundMoney(firstRule.amount)}，最高档满${roundMoney(lastRule.threshold)}减${roundMoney(lastRule.amount)}`
      : `满减底盘1档，满${roundMoney(firstRule.threshold)}减${roundMoney(firstRule.amount)}`
    : '当前路线未生成满减阶梯';
  if (!metrics.activeCount) return appendActivityRouteGenerationDiagnosis(`${fullRuleText}，在支付价和到手价边界内没有有效原价桶`, recommendation);
  if (metrics.mainPayShare < metrics.targetPayShareFloor) {
    return appendActivityRouteGenerationDiagnosis(`${fullRuleText}，主要支付场景覆盖仅${rateShareText(metrics.mainPayShare)}，低于要求${rateShareText(metrics.targetPayShareFloor)}，需降低首档门槛或补充满减阶梯`, recommendation);
  }
  if (metrics.highPayShare > metrics.highPayShareLimit) {
    return appendActivityRouteGenerationDiagnosis(`${fullRuleText}，高支付价占比${rateShareText(metrics.highPayShare)}，超过上限${rateShareText(metrics.highPayShareLimit)}，满减梯度没有充分覆盖主要原价桶`, recommendation);
  }
  if (fullRules.length) return appendActivityRouteGenerationDiagnosis(`${fullRuleText}，主要支付场景覆盖达标，后续需在支付价核验确认到手风险`, recommendation);
  return appendActivityRouteGenerationDiagnosis(`${fullRuleText}，当前只保留默认活动和加码空间，需复核是否存在可用满减空间`, recommendation);
}

function applyActivityRouteMetrics(
  settings: ActivityDesignSettings,
  recommendation: ActivityRecommendationRow,
  metrics: ActivityRouteMetrics,
  hitCount = metrics.activeCount
): ActivityRecommendationRow {
  const scoreLevel = activityRouteScoreLevel(metrics);
  return {
    ...recommendation,
    hitCount,
    avgProfitAfter: metrics.avgProfitRate,
    minProfitAfter: metrics.minProfitRate,
    profitRateSpreadAfter: metrics.payBandAvgSpread ?? metrics.profitRateSpread,
    avgFinalPayAfter: metrics.avgFinalPay,
    actualAvgDiscountRate: metrics.actualAvgDiscountRate,
    actualMinDiscountRate: metrics.actualMinDiscountRate,
    actualMaxDiscountRate: metrics.actualMaxDiscountRate,
    score: metrics.score,
    scoreLevel,
    scoreLabel: activityRouteScoreLabel(scoreLevel),
    scoreDetails: activityRouteScoreDetails(settings, recommendation, metrics),
    scoreBreakdown: activityRouteScoreBreakdown(recommendation, metrics),
    diagnosis: activityRouteDiagnosis(settings, recommendation, metrics)
  };
}

function scoreActivityRouteRecommendation(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  settings: ActivityDesignSettings,
  recommendation: ActivityRecommendationRow,
  sampleRows: ActivityBaseComboRow[],
  hitCount: number
) {
  const metrics = evaluateActivityRouteMetrics(state, store, settings, recommendation, sampleRows);
  return applyActivityRouteMetrics(settings, recommendation, metrics, hitCount);
}

function recommendedCouponAmount(value: number, policy: ActivityCouponRecommendationPolicy = ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS.balanced) {
  const amountStep = Math.max(ACTIVITY_MONEY_AMOUNT_UNIT, Number(policy.amountStep) || ACTIVITY_COUPON_RECOMMEND_AMOUNT_UNIT);
  const minAmount = Math.max(0, Number(policy.minCouponAmount) || ACTIVITY_ROUTE_MIN_COUPON_AMOUNT);
  const amount = roundMoney(
    Math.floor(Math.max(0, Number(value) || 0) / amountStep + 1e-9)
    * amountStep
  );
  return amount >= minAmount - 1e-9 ? amount : 0;
}

function activityCouponStrategyName(mode: ActivityCouponRecommendationMode) {
  return {
    aggressive: '激进',
    balanced: '平稳',
    conservative: '保守'
  }[mode] || '平稳';
}

function normalizeActivityCouponSceneTemplate(row: Partial<ActivityCouponSceneTemplate> | undefined, fallback: ActivityCouponSceneTemplate): ActivityCouponSceneTemplate {
  const thresholdMin = Math.max(0, Number(row?.thresholdMin ?? fallback.thresholdMin) || 0);
  const amountMin = Math.max(0, Number(row?.amountMin ?? fallback.amountMin) || 0);
  const couponIndexRatioMin = Math.max(0, Math.min(1, Number(row?.couponIndexRatioMin ?? fallback.couponIndexRatioMin) || 0));
  const objectiveKeys = Array.isArray(row?.objectiveKeys)
    ? row.objectiveKeys.map(key => String(key || '')).filter(Boolean)
    : [];
  const legacyObjective = (row as { objective?: unknown } | undefined)?.objective;
  const platforms = Array.isArray(row?.platforms)
    ? row.platforms.filter((item): item is Platform => item === 'meituan' || item === 'eleme')
    : fallback.platforms;
  return {
    key: String(row?.key || fallback.key),
    enabled: row?.enabled !== false,
    name: String(row?.name || fallback.name),
    priority: Math.floor(Number(row?.priority ?? fallback.priority) || fallback.priority),
    platforms,
    channel: row?.channel === 'inStore' || row?.channel === 'orderReturn' || row?.channel === 'reviewReturn' || row?.channel === 'pointsReturn' || row?.channel === 'targeted' ? row.channel : fallback.channel,
    targetUser: row?.targetUser === 'all' || row?.targetUser === 'newCustomer' || row?.targetUser === 'highFrequency' || row?.targetUser === 'highAov' || row?.targetUser === 'lostCustomer' || row?.targetUser === 'specified' ? row.targetUser : fallback.targetUser,
    objectiveKeys: objectiveKeys.length ? objectiveKeys : legacyObjective ? [String(legacyObjective)] : fallback.objectiveKeys.slice(),
    thresholdMode: row?.thresholdMode === 'lowThresholdOrder' || row?.thresholdMode === 'fullReductionInterleave' || row?.thresholdMode === 'addOnCritical' || row?.thresholdMode === 'highMarginGuide' || row?.thresholdMode === 'retentionRecall' ? row.thresholdMode : fallback.thresholdMode,
    thresholdMin,
    thresholdMax: Math.max(thresholdMin, Number(row?.thresholdMax ?? fallback.thresholdMax) || fallback.thresholdMax),
    amountMin,
    amountMax: Math.max(amountMin, Number(row?.amountMax ?? fallback.amountMax) || fallback.amountMax),
    couponIndexRatioMin,
    couponIndexRatioMax: Math.max(couponIndexRatioMin, Math.min(1, Number(row?.couponIndexRatioMax ?? fallback.couponIndexRatioMax) || fallback.couponIndexRatioMax)),
    requireNearFullReduction: Boolean(row?.requireNearFullReduction ?? fallback.requireNearFullReduction),
    maxFullReductionDistance: Math.max(0, Number(row?.maxFullReductionDistance ?? fallback.maxFullReductionDistance) || fallback.maxFullReductionDistance),
    requireNearRedTier: Boolean(row?.requireNearRedTier ?? fallback.requireNearRedTier),
    maxRedTierDistance: Math.max(0, Number(row?.maxRedTierDistance ?? fallback.maxRedTierDistance) || fallback.maxRedTierDistance),
    addOnMin: Math.max(0, Number(row?.addOnMin ?? fallback.addOnMin) || 0),
    addOnMax: Math.max(0, Number(row?.addOnMax ?? fallback.addOnMax) || fallback.addOnMax),
    requireBoundarySafe: Boolean(row?.requireBoundarySafe ?? fallback.requireBoundarySafe),
    maxOverBucketSpace: Math.max(0, Number(row?.maxOverBucketSpace ?? fallback.maxOverBucketSpace) || 0),
    couponBudgetShare: Math.max(0, Math.min(100, Number(row?.couponBudgetShare ?? fallback.couponBudgetShare) || fallback.couponBudgetShare)),
    maxCouponCount: Math.max(1, Math.floor(Number(row?.maxCouponCount ?? fallback.maxCouponCount) || fallback.maxCouponCount)),
    maxCouponAmount: Math.max(0, Number(row?.maxCouponAmount ?? fallback.maxCouponAmount) || fallback.maxCouponAmount)
  };
}

function activityCouponSceneTemplatesForPlatform(settings: ActivityDesignSettings, platform: Platform) {
  const rawTemplates = settings.couponSceneTemplates?.length
    ? settings.couponSceneTemplates
    : DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES;
  const fallbackByKey = new Map(DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(row => [row.key, row]));
  const allowedKeys = settings.platformCouponSceneKeys?.[platform];
  const allowed = Array.isArray(allowedKeys) && allowedKeys.length ? new Set(allowedKeys) : null;
  return rawTemplates
    .map(template => normalizeActivityCouponSceneTemplate(template, fallbackByKey.get(template.key) || DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES[0]))
    .filter(template => template.enabled)
    .filter(template => !allowed || allowed.has(template.key))
    .filter(template => !template.platforms?.length || template.platforms.includes(platform))
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

type ActivityCouponDraftEntry = {
  row: ActivityCouponBucketSuggestion;
  amount: number;
};

type ActivityCouponDraft = {
  key: string;
  threshold: number;
  amount: number;
  maxObservedAmount: number;
  entries: ActivityCouponDraftEntry[];
  coveredRows: ActivityCouponBucketSuggestion[];
};

function refreshActivityCouponDraftRepresentative(draft: ActivityCouponDraft, policy: ActivityCouponRecommendationPolicy) {
  const entries = draft.entries.slice().sort((a, b) => a.row.originalBucket - b.row.originalBucket);
  if (!entries.length) return draft;
  const representative = policy.representativeMode === 'highestThreshold'
    ? entries[entries.length - 1]
    : policy.representativeMode === 'balanced'
      ? entries[Math.floor((entries.length - 1) / 2)]
      : entries[0];
  const amount = policy.representativeMode === 'lowestThreshold'
    ? entries[0].amount
    : Math.max(...entries.map(entry => entry.amount));
  draft.threshold = representative.row.originalBucket;
  draft.amount = roundMoney(amount);
  draft.maxObservedAmount = Math.max(draft.maxObservedAmount, ...entries.map(entry => entry.amount));
  return draft;
}

function activityCouponRiskForRows(
  rows: ActivityCouponBucketSuggestion[],
  coupon: Pick<Coupon, 'threshold' | 'amount'>,
  maxOverBucketSpace: number
) {
  let riskLevel: ActivityCouponRiskLevel = 'safe';
  const reasons = new Set<string>();
  for (const row of rows) {
    if (row.originalBucket + 1e-9 < coupon.threshold) continue;
    const overBucketSpace = roundMoney(coupon.amount - row.amount);
    const boundaryOverflow = roundMoney(coupon.amount - row.boundarySpace);
    if (boundaryOverflow > 1e-9) {
      riskLevel = 'risk';
      reasons.add(`到手边界超¥${roundMoney(boundaryOverflow)}`);
    } else if (overBucketSpace > maxOverBucketSpace + 1e-9 && riskLevel !== 'risk') {
      riskLevel = 'watch';
      reasons.add(`超桶级券空间¥${roundMoney(overBucketSpace)}`);
    }
  }
  return { riskLevel, riskReasons: Array.from(reasons) };
}

function activityCouponSceneUsageSuggestion(
  platform: Platform,
  scene: ActivityCouponSceneTemplate,
  coupon: Pick<Coupon, 'threshold' | 'amount'>,
  context: {
    fullTierText: string;
    redTierText: string;
    riskReasons: string[];
  }
) {
  const redName = platform === 'meituan' ? '神券' : '爆红包';
  const riskText = context.riskReasons.length ? `；风险：${context.riskReasons.join('，')}，应用前需核验` : '；应用前仍需支付价核验';
  if (scene.thresholdMode === 'fullReductionInterleave') {
    return `意义：补齐公开满减档位之间的价格带。${context.fullTierText}${riskText}。`;
  }
  if (scene.thresholdMode === 'highMarginGuide') {
    return `意义：围绕${redName}档位和高到手组合做补档。${context.redTierText}${riskText}。`;
  }
  if (scene.thresholdMode === 'retentionRecall') {
    return `意义：用于高门槛定向唤回或高客单复购，满${roundMoney(coupon.threshold)}减${roundMoney(coupon.amount)}不作为公开主档位${riskText}。`;
  }
  if (scene.thresholdMode === 'addOnCritical') {
    return `意义：引导加购或轻量凑单，真实业务档位仍以满减档和${redName}档为准${riskText}。`;
  }
  return `意义：低门槛拉单，优先覆盖主要支付场景${riskText}。`;
}

function activityCouponUsageScenario(
  settings: ActivityDesignSettings,
  platform: Platform,
  objective: ActivityDesignObjective,
  policy: ActivityCouponRecommendationPolicy,
  coupon: Pick<Coupon, 'threshold' | 'amount'>,
  index: number,
  total: number,
  fullReductionRules: FullReduction[],
  redTiers: RedTier[],
  coveredRows: ActivityCouponBucketSuggestion[]
): Pick<Coupon, 'sceneName' | 'channel' | 'targetUser' | 'thresholdMode' | 'usageSuggestion'> {
  const redName = platform === 'meituan' ? '神券' : '爆红包';
  const fullRules = normalizeActivityFullRules(fullReductionRules);
  const nextFullRule = fullRules.find(rule => rule.threshold > coupon.threshold + 1e-9);
  const redBasisAfterCoupon = Math.max(0, roundMoney(coupon.threshold - coupon.amount));
  const normalizedRedTiers = redTiers
    .filter(row => row.enabled && row.threshold > 0 && row.max > 0)
    .slice()
    .sort((a, b) => a.threshold - b.threshold);
  const nextRedTier = normalizedRedTiers.find(row => row.threshold > redBasisAfterCoupon + 1e-9);
  const fullDistance = nextFullRule ? roundMoney(nextFullRule.threshold - coupon.threshold) : Infinity;
  const redDistance = nextRedTier ? roundMoney(nextRedTier.threshold - redBasisAfterCoupon) : Infinity;
  const minCoveredBucket = coveredRows.length ? Math.min(...coveredRows.map(row => row.originalBucket)) : coupon.threshold;
  const addOnDistance = Math.max(0, roundMoney(coupon.threshold - minCoveredBucket));
  const risk = activityCouponRiskForRows(coveredRows, coupon, policy.maxOverBucketSpace);
  const indexRatio = total <= 1 ? 0 : index / Math.max(1, total - 1);
  const fullTierText = nextFullRule
    ? `下一满减档满${roundMoney(nextFullRule.threshold)}减${roundMoney(nextFullRule.amount)}`
    : fullRules.length
      ? `当前最高满减档满${roundMoney(fullRules[fullRules.length - 1].threshold)}减${roundMoney(fullRules[fullRules.length - 1].amount)}`
      : '当前未形成满减档';
  const redTierText = nextRedTier
    ? `下一${redName}档约满${roundMoney(nextRedTier.threshold)}减${roundMoney(nextRedTier.max)}`
    : normalizedRedTiers.length
      ? `当前最高${redName}档约满${roundMoney(normalizedRedTiers[normalizedRedTiers.length - 1].threshold)}减${roundMoney(normalizedRedTiers[normalizedRedTiers.length - 1].max)}`
      : `当前未配置${redName}档`;
  const scene = activityCouponSceneTemplatesForPlatform(settings, platform).find(template => {
    if (template.objectiveKeys.length && !template.objectiveKeys.includes(objective)) return false;
    if (coupon.threshold < template.thresholdMin - 1e-9 || coupon.threshold > template.thresholdMax + 1e-9) return false;
    if (coupon.amount < template.amountMin - 1e-9 || coupon.amount > Math.min(template.amountMax, template.maxCouponAmount) + 1e-9) return false;
    if (indexRatio < template.couponIndexRatioMin - 1e-9 || indexRatio > template.couponIndexRatioMax + 1e-9) return false;
    if (template.requireNearFullReduction && fullDistance > template.maxFullReductionDistance + 1e-9) return false;
    if (template.requireNearRedTier && redDistance > template.maxRedTierDistance + 1e-9) return false;
    if (addOnDistance < template.addOnMin - 1e-9 || addOnDistance > template.addOnMax + 1e-9) return false;
    if (template.requireBoundarySafe && risk.riskLevel === 'risk') return false;
    if (risk.riskReasons.length && template.maxOverBucketSpace + 1e-9 < policy.maxOverBucketSpace) return false;
    return true;
  }) || normalizeActivityCouponSceneTemplate(undefined, fullRules.length ? DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES[2] : DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES[3]);
  return {
    sceneName: scene.name,
    channel: scene.channel,
    targetUser: scene.targetUser,
    thresholdMode: scene.thresholdMode,
    usageSuggestion: activityCouponSceneUsageSuggestion(platform, scene, coupon, { fullTierText, redTierText, riskReasons: risk.riskReasons })
  };
}

function createStrategyCouponRules(
  settings: ActivityDesignSettings,
  platform: Platform,
  objective: ActivityDesignObjective,
  suggestions: ActivityCouponBucketSuggestion[],
  policy: ActivityCouponRecommendationPolicy,
  fullReductionRules: FullReduction[] = [],
  redTiers: RedTier[] = []
) {
  const sorted = suggestions.slice().sort((a, b) => a.originalBucket - b.originalBucket);
  if (!sorted.length) return [] as Coupon[];
  const mode = policy.mode;

  const scanStartIndex = mode === 'conservative'
    ? sorted.reduce((lastIndex, row, index) => (
      recommendedCouponAmount(row.amount, policy) <= 0 ? index : lastIndex
    ), -1) + 1
    : 0;
  const scanRows = sorted.slice(scanStartIndex);
  if (!scanRows.some(row => recommendedCouponAmount(row.amount, policy) > 0)) return [] as Coupon[];

  const strategyName = activityCouponStrategyName(mode);
  const strategyKey = ['coupon-strategy', platform, objective, mode].join('::');
  const couponDrafts: ActivityCouponDraft[] = [];
  let highestAmount = 0;
  for (let index = scanStartIndex; index < sorted.length; index++) {
    const row = sorted[index];
    const amount = recommendedCouponAmount(row.amount, policy);
    if (amount <= highestAmount + 1e-9) continue;
    const previousDraft = couponDrafts[couponDrafts.length - 1];
    if (previousDraft) {
      const thresholdGap = roundMoney(row.originalBucket - previousDraft.threshold);
      const amountDiff = roundMoney(amount - previousDraft.maxObservedAmount);
      if (thresholdGap <= policy.nearThresholdGap + 1e-9 && amountDiff <= policy.nearAmountMergeTolerance + 1e-9) {
        previousDraft.entries.push({ row, amount });
        refreshActivityCouponDraftRepresentative(previousDraft, policy);
        highestAmount = Math.max(highestAmount, amount);
        continue;
      }
      if (thresholdGap >= policy.farThresholdGap - 1e-9 && amountDiff <= policy.farAmountSkipTolerance + 1e-9) {
        previousDraft.entries.push({ row, amount });
        previousDraft.maxObservedAmount = Math.max(previousDraft.maxObservedAmount, amount);
        highestAmount = Math.max(highestAmount, amount);
        continue;
      }
    }
    const draft: ActivityCouponDraft = {
      key: '',
      threshold: row.originalBucket,
      amount,
      maxObservedAmount: amount,
      entries: [{ row, amount }],
      coveredRows: []
    };
    refreshActivityCouponDraftRepresentative(draft, policy);
    couponDrafts.push(draft);
    highestAmount = Math.max(highestAmount, amount);
  }

  for (const draft of couponDrafts) {
    draft.key = [strategyKey, draft.threshold, draft.amount].join('::');
  }

  for (let index = 0; index < couponDrafts.length; index++) {
    const coupon = couponDrafts[index];
    const nextCoupon = couponDrafts[index + 1];
    const coveredRows = sorted.filter(row => (
      row.originalBucket + 1e-9 >= coupon.threshold
      && (!nextCoupon || row.originalBucket < nextCoupon.threshold - 1e-9)
    ));
    coupon.coveredRows = coveredRows;
    const minCoveredBucket = coveredRows.length
      ? Math.min(...coveredRows.map(row => row.originalBucket))
      : coupon.threshold;
    const maxCoveredBucket = coveredRows.length
      ? Math.max(...coveredRows.map(row => row.originalBucket))
      : coupon.threshold;
    const thresholdSuggestion = coupon.entries.find(entry => Math.abs(entry.row.originalBucket - coupon.threshold) < 1e-9)?.row
      || sorted.find(row => Math.abs(row.originalBucket - coupon.threshold) < 1e-9)
      || coveredRows[0];
    if (!thresholdSuggestion) continue;
    thresholdSuggestion.selected = true;
    thresholdSuggestion.recommendedCouponKey = coupon.key;
    thresholdSuggestion.recommendedThreshold = coupon.threshold;
    thresholdSuggestion.recommendedAmount = coupon.amount;
    thresholdSuggestion.minCoveredBucket = minCoveredBucket;
    thresholdSuggestion.maxCoveredBucket = maxCoveredBucket;
    thresholdSuggestion.coveredBucketCount = coveredRows.length;
    thresholdSuggestion.diagnosis = `${thresholdSuggestion.diagnosis}；作为最终推荐券门槛桶，参考覆盖原价桶${roundMoney(minCoveredBucket)}-${roundMoney(maxCoveredBucket)}共${coveredRows.length}桶`;
  }

  for (const suggestion of sorted) {
    const matchedCoupon = couponDrafts
      .filter(coupon => suggestion.originalBucket + 1e-9 >= coupon.threshold)
      .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0];
    if (!matchedCoupon) continue;
    suggestion.recommendedCouponKey = suggestion.recommendedCouponKey || matchedCoupon.key;
    suggestion.recommendedThreshold = suggestion.recommendedThreshold ?? matchedCoupon.threshold;
    suggestion.recommendedAmount = suggestion.recommendedAmount ?? matchedCoupon.amount;
    const risk = activityCouponRiskForRows([suggestion], matchedCoupon, policy.maxOverBucketSpace);
    suggestion.riskLevel = risk.riskLevel;
    suggestion.riskReasons = risk.riskReasons;
    if (risk.riskReasons.length) {
      suggestion.diagnosis = `${suggestion.diagnosis}；命中推荐券满${roundMoney(matchedCoupon.threshold)}减${roundMoney(matchedCoupon.amount)}，${risk.riskReasons.join('，')}，建议在活动校验明细查看具体组合是否亏损`;
    }
  }

  return couponDrafts.map((coupon, index) => {
    const usage = activityCouponUsageScenario(
      settings,
      platform,
      objective,
      policy,
      coupon,
      index,
      couponDrafts.length,
      fullReductionRules,
      redTiers,
      coupon.coveredRows
    );
    return {
      enabled: true,
      name: `${usage.sceneName || strategyName}满${coupon.threshold}减${coupon.amount}`,
      threshold: coupon.threshold,
      amount: coupon.amount,
      sceneKey: [strategyKey, usage.channel, usage.thresholdMode].join('::'),
      ...usage
    };
  });
}

function buildCouponRouteRules(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  fullReductionRules: FullReduction[] = []
) {
  const maxAmount = maxCouponAmount(settings);
  if (!rows.length || maxAmount <= 0) return { couponRules: [] as Coupon[], couponBucketSuggestions: [] as ActivityCouponBucketSuggestion[] };
  const payProfile = activityObjectivePayProfile(settings, objective);

  const rowsByBucket = new Map<number, ActivityBaseComboRow[]>();
  for (const row of rows) {
    const bucket = Math.max(0, Math.floor(Number(row.originalTotal) || 0));
    const bucketRows = rowsByBucket.get(bucket) || [];
    bucketRows.push(row);
    rowsByBucket.set(bucket, bucketRows);
  }

  const bucketSuggestions: ActivityCouponBucketSuggestion[] = [];
  for (const [bucket, bucketRows] of Array.from(rowsByBucket.entries()).sort(([a], [b]) => a - b)) {
    const simulatedRows: Array<{
      targetSpace: number;
      boundarySpace: number;
      demandWeight: number;
      fullAmount: number;
    }> = [];
    for (const row of bucketRows) {
      const routeSpace = activityRouteDesignDiscountSpace(
        state,
        store,
        row,
        settings,
        objective,
        fullReductionRules,
        [],
        'coupon'
      );
      simulatedRows.push({
        targetSpace: routeSpace.targetSpace,
        boundarySpace: routeSpace.boundarySpace,
        demandWeight: routeSpace.demandWeight,
        fullAmount: routeSpace.currentFullAmount
      });
    }
    if (!simulatedRows.length) continue;
    const remainingSpace = targetSpaceMetric(simulatedRows, payProfile.fullAmountBasis);
    const boundarySpace = netPayBoundaryReferenceMetric(simulatedRows);
    const maxAllowedAmount = maxAmount;
    const amount = cappedActivityMoneyAmount(
      Math.min(remainingSpace, maxAllowedAmount),
      maxAllowedAmount
    );
    const fullDiscountAmount = demandAverageValue(simulatedRows.map(row => ({ value: row.fullAmount, weight: row.demandWeight }))) ?? 0;
    bucketSuggestions.push({
      key: ['coupon-bucket', platform, objective, bucket, amount].join('::'),
      originalBucket: bucket,
      threshold: bucket,
      amount,
      targetSpace: roundMoney(remainingSpace + fullDiscountAmount),
      fullDiscountAmount: roundMoney(fullDiscountAmount),
      remainingSpace: roundMoney(remainingSpace),
      boundarySpace: roundMoney(boundarySpace),
      minCoveredBucket: bucket,
      maxCoveredBucket: bucket,
      coveredBucketCount: 1,
      recommendationMode: payProfile.couponRecommendationPolicy.mode,
      riskLevel: 'safe',
      riskReasons: [],
      scoringMode: payProfile.couponRecommendationPolicy.mode,
      diagnosis: amount >= ACTIVITY_ROUTE_MIN_COUPON_AMOUNT - 1e-9
        ? `原价桶${bucket}满减后券空间约¥${roundMoney(remainingSpace)}，桶级券按小数保留为满${bucket}减${roundMoney(amount)}`
        : `原价桶${bucket}满减后券空间低于¥${roundMoney(ACTIVITY_ROUTE_MIN_COUPON_AMOUNT)}，不单独推荐，仅作为策略断点参考`
    });
  }

  const selected = createStrategyCouponRules(
    settings,
    platform,
    objective,
    bucketSuggestions,
    payProfile.couponRecommendationPolicy,
    fullReductionRules,
    state.platformRules.redTiers[platform] || []
  );
  return {
    couponRules: normalizeActivityCouponRules(selected),
    couponBucketSuggestions: bucketSuggestions.sort((a, b) => a.originalBucket - b.originalBucket)
  };
}

function buildFullReductionRouteRules(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  couponRules: Coupon[],
  diagnostics: string[] = []
) {
  const maxAmount = maxFullReductionAmount(settings);
  let suppressedDiagnostics = 0;
  const maxAmountText = Number.isFinite(maxAmount) ? roundMoney(maxAmount) : '不限';
  const noteDiagnostic = (message: string, force = false) => {
    if (force || diagnostics.length < ACTIVITY_FULL_REDUCTION_LOG_LIMIT) {
      diagnostics.push(message);
      return;
    }
    suppressedDiagnostics++;
  };
  const flushSuppressedDiagnostics = () => {
    if (suppressedDiagnostics <= 0) return;
    diagnostics.push(`中间候选日志超过${ACTIVITY_FULL_REDUCTION_LOG_LIMIT}条，已省略${suppressedDiagnostics}条`);
    suppressedDiagnostics = 0;
  };
  const finishWithoutRules = (reason: string) => {
    flushSuppressedDiagnostics();
    noteDiagnostic(`退出：${reason}`, true);
    return [];
  };
  if (!rows.length) return finishWithoutRules('没有可用于满减设计的原价桶样本');
  if (maxAmount <= 0) return finishWithoutRules(`满减最大减额为${roundMoney(maxAmount)}，无法生成有效满减`);
  if (maxAmount + 1e-9 < ACTIVITY_ROUTE_MIN_FULL_AMOUNT) return finishWithoutRules(`满减最大减额${roundMoney(maxAmount)}低于¥${roundMoney(ACTIVITY_ROUTE_MIN_FULL_AMOUNT)}，不生成满减`);

  const payProfile = activityObjectivePayProfile(settings, objective);
  const fullDiscountRatio = activityDiscountSharePercent(settings, objective, 'full');
  const maxRuleCount = payProfile.maxFullRuleCount || ACTIVITY_ROUTE_MAX_FULL_RULES;
  const thresholdGap = Math.max(1, Number(payProfile.fullThresholdMinGap) || 10);
  const bucketWindowSize = Math.max(1, Math.floor(Number(payProfile.fullThresholdWindow) || 5));
  const minIncrease = Math.max(0, Number(payProfile.minFullAmountIncrease) || 0);
  const minimumNextAmountIncrease = minIncrease > 0 ? minIncrease : ACTIVITY_MONEY_AMOUNT_UNIT;
  const basisRows: FullReductionBasisRow[] = [];
  for (const row of rows) {
    const fullTargetSpace = activityRouteDesignDiscountSpace(
      state,
      store,
      row,
      settings,
      objective,
      [],
      couponRules,
      'full'
    );
    basisRows.push({
      row,
      basis: Math.max(0, roundMoney(row.originalTotal)),
      targetSpace: fullTargetSpace.targetSpace,
      rawTargetSpace: fullTargetSpace.rawTargetSpace,
      addOnDiscount: fullTargetSpace.addOnDiscount,
      downgradeLoss: fullTargetSpace.downgradeLoss,
      currentFullAmount: fullTargetSpace.currentFullAmount,
      boundarySpace: fullTargetSpace.boundarySpace,
      targetDiscountRate: fullTargetSpace.targetDiscountRate,
      demandWeight: fullTargetSpace.demandWeight
    });
  }
  if (!basisRows.length) return finishWithoutRules('原价桶样本为空，无法计算满减候选');

  const minBasis = Math.min(...basisRows.map(row => row.basis));
  const configuredMinThreshold = Math.max(0, Number(settings.originalMin) || 0);
  const minThreshold = Math.max(
    Math.max(0, Math.floor(Math.max(0, minBasis) + 1e-9)),
    integerThreshold(configuredMinThreshold)
  );
  const buckets = buildFullReductionBuckets(
    basisRows.filter(row => row.basis + 1e-9 >= minThreshold && row.targetSpace >= ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9)
  );
  noteDiagnostic(
    `参数：样本${rows.length}，可计算样本${basisRows.length}，有效原价桶${buckets.length}，满减上限${maxAmountText}，满减占比${roundMoney(fullDiscountRatio * 100)}%，固定加码${roundMoney(configuredRedAddOnSpace(settings))}，窗口桶数${bucketWindowSize}，梯度间距${roundMoney(thresholdGap)}，最小减额增量${roundMoney(minimumNextAmountIncrease)}，金额口径${payProfile.fullAmountBasis}，金额保留到分`,
    true
  );
  if (!buckets.length) return finishWithoutRules(`没有路线活动空间达到¥${roundMoney(ACTIVITY_ROUTE_MIN_DESIGN_SPACE)}的有效原价桶；最小门槛${roundMoney(minThreshold)}，样本路线空间范围${roundMoney(Math.min(...basisRows.map(row => row.targetSpace)))}-${roundMoney(Math.max(...basisRows.map(row => row.targetSpace)))}`);

  const rules: FullReduction[] = [];
  let highestAmount = 0;
  const liftAmountForNextTier = (amount: number, maxAllowedAmount: number) => {
    if (highestAmount <= 0) return amount;
    const preferredAmount = highestAmount + minimumNextAmountIncrease;
    if (amount + 1e-9 >= preferredAmount) {
      return amount;
    }
    if (preferredAmount <= maxAllowedAmount + 1e-9 && preferredAmount <= maxAmount) return roundMoney(preferredAmount);
    if (amount > highestAmount + 1e-9) {
      return amount;
    }
    const nextStepAmount = highestAmount + ACTIVITY_MONEY_AMOUNT_UNIT;
    if (nextStepAmount <= maxAllowedAmount + 1e-9 && nextStepAmount <= maxAmount) return roundMoney(nextStepAmount);
    if (maxAllowedAmount > highestAmount + 1e-9) return roundMoney(Math.min(maxAllowedAmount, maxAmount));
    return amount;
  };
  const pushFullRule = (threshold: number, amount: number, context: string) => {
    const previousThreshold = rules[rules.length - 1]?.threshold;
    if (previousThreshold !== undefined && threshold - previousThreshold + 1e-9 < thresholdGap) {
      noteDiagnostic(`拒绝满${threshold}：距上一档${roundMoney(threshold - previousThreshold)}元，小于梯度间距${roundMoney(thresholdGap)}元；${context}`);
      return false;
    }
    if (amount + 1e-9 < ACTIVITY_ROUTE_MIN_FULL_AMOUNT) {
      noteDiagnostic(`拒绝满${threshold}：满减减额低于¥${roundMoney(ACTIVITY_ROUTE_MIN_FULL_AMOUNT)}，不保留；${context}`);
      return false;
    }
    if (previousThreshold !== undefined && amount + 1e-9 < highestAmount + minimumNextAmountIncrease) {
      noteDiagnostic(`拒绝满${threshold}减${roundMoney(amount)}：低于上一档减${roundMoney(highestAmount)}加最小增量${roundMoney(minimumNextAmountIncrease)}；${context}`);
      return false;
    }
    if (amount > maxAmount) {
      noteDiagnostic(`拒绝满${threshold}减${roundMoney(amount)}：超过满减上限${roundMoney(maxAmount)}；${context}`);
      return false;
    }
    highestAmount = amount;
    rules.push({ enabled: true, threshold, amount });
    noteDiagnostic(`生成满${threshold}减${roundMoney(amount)}；${context}`);
    return true;
  };
  const nextBucketIndexAtOrAfter = (threshold: number) => buckets.findIndex(bucket => bucket.price + 1e-9 >= threshold);
  const buildFullReductionRuleFromWindow = (windowBuckets: FullReductionBucket[]) => {
    const thresholdBucket = windowBuckets[0];
    const lastBucket = windowBuckets[windowBuckets.length - 1];
    const threshold = fullReductionThresholdCandidates(thresholdBucket.price, minThreshold)[0];
    const windowRows = windowBuckets
      .flatMap(bucket => bucket.rows)
      .map(row => {
        const space = activityRouteDesignDiscountSpace(
          state,
          store,
          row.row,
          settings,
          objective,
          rules,
          couponRules,
          'full'
        );
        return {
          ...row,
          targetSpace: space.targetSpace,
          rawTargetSpace: space.rawTargetSpace,
          addOnDiscount: space.addOnDiscount,
          downgradeLoss: space.downgradeLoss,
          currentFullAmount: space.currentFullAmount,
          boundarySpace: space.boundarySpace,
          targetDiscountRate: space.targetDiscountRate,
          demandWeight: space.demandWeight
        };
      })
      .filter(row => row.targetSpace >= ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9);
    if (!windowRows.length) {
      return {
        threshold,
        amount: 0,
        context: `窗口原价桶${roundMoney(thresholdBucket.price)}-${roundMoney(lastBucket.price)}，桶数${windowBuckets.length}，基于当前路线重新计算后没有达到¥${roundMoney(ACTIVITY_ROUTE_MIN_DESIGN_SPACE)}的活动空间`
      };
    }
    const targetSpace = fullReductionTargetMetric(windowRows, payProfile.fullAmountBasis);
    const currentFullAmount = targetSpaceMetric(
      windowRows.map(row => ({ targetSpace: row.currentFullAmount, demandWeight: row.demandWeight })),
      payProfile.fullAmountBasis
    );
    const rawTargetSpace = targetSpaceMetric(
      windowRows.map(row => ({ targetSpace: row.rawTargetSpace, demandWeight: row.demandWeight })),
      payProfile.fullAmountBasis
    );
    const addOnDiscount = targetSpaceMetric(
      windowRows.map(row => ({ targetSpace: row.addOnDiscount, demandWeight: row.demandWeight })),
      payProfile.fullAmountBasis
    );
    const targetDiscountRate = targetDiscountRateReferenceMetric(windowRows);
    const boundarySpace = netPayBoundaryReferenceMetric(windowRows);
    const downgradeLoss = targetSpaceMetric(
      windowRows.map(row => ({ targetSpace: row.downgradeLoss, demandWeight: row.demandWeight })),
      payProfile.fullAmountBasis
    );
    const targetAmount = roundMoney(currentFullAmount + targetSpace * fullDiscountRatio);
    let amount = targetAmount + 1e-9 < ACTIVITY_ROUTE_MIN_FULL_AMOUNT
      ? 0
      : cappedActivityMoneyAmount(
        Math.min(targetAmount, maxAmount),
        maxAmount
      );
    if (amount >= ACTIVITY_ROUTE_MIN_FULL_AMOUNT - 1e-9) {
      amount = liftAmountForNextTier(amount, maxAmount);
    }
    const maxAmountText = Number.isFinite(maxAmount)
      ? `，满减上限${roundMoney(maxAmount)}，距上限${roundMoney(Math.max(0, maxAmount - amount))}`
      : '';
    const minimumAmountText = targetAmount + 1e-9 < ACTIVITY_ROUTE_MIN_FULL_AMOUNT ? `，路线满减目标小于${roundMoney(ACTIVITY_ROUTE_MIN_FULL_AMOUNT)}` : '';
    const context = `窗口原价桶${roundMoney(thresholdBucket.price)}-${roundMoney(lastBucket.price)}，桶数${windowBuckets.length}，有效空间桶${windowRows.length}，让利率${roundMoney(targetDiscountRate * 100)}%，当前满减${roundMoney(currentFullAmount)}，加码前空间${roundMoney(rawTargetSpace)}，加码占用${roundMoney(addOnDiscount)}，降档回补${roundMoney(downgradeLoss)}，路线剩余空间${roundMoney(targetSpace)}，满减目标${roundMoney(targetAmount)}${minimumAmountText}${maxAmountText}，到手参考空间${roundMoney(boundarySpace)}`;
    return { threshold, amount, context };
  };
  const tryPushFullRuleFromIndex = (startIndex: number) => {
    for (let index = Math.max(0, startIndex); index < buckets.length; index++) {
      const windowBuckets = buckets.slice(index, index + bucketWindowSize);
      if (!windowBuckets.length) break;
      const candidate = buildFullReductionRuleFromWindow(windowBuckets);
      if (pushFullRule(candidate.threshold, candidate.amount, candidate.context)) return true;
    }
    return false;
  };
  const finishWithRules = (reason: string) => {
    flushSuppressedDiagnostics();
    noteDiagnostic(`退出：${reason}`, true);
    const normalized = normalizeActivityFullRules(rules, maxRuleCount);
    if (normalized.length !== rules.length) {
      noteDiagnostic(`归一化：生成${rules.length}档，保留${normalized.length}档；被移除的档位通常是减额未递增或超过最大档数`, true);
    }
    return normalized;
  };

  if (!tryPushFullRuleFromIndex(0)) {
    return finishWithoutRules(`从首个有效原价桶${roundMoney(buckets[0].price)}开始向后扫描，未找到可生成首档的满减候选`);
  }

  while (rules.length > 0 && rules.length < maxRuleCount && highestAmount + 1e-9 < maxAmount) {
    const previousThreshold = rules[rules.length - 1].threshold;
    const nextStartIndex = nextBucketIndexAtOrAfter(previousThreshold + thresholdGap);
    if (nextStartIndex < 0) {
      return finishWithRules(`上一档门槛${roundMoney(previousThreshold)}加梯度间距${roundMoney(thresholdGap)}后，没有更高的有效原价桶`);
    }
    if (!tryPushFullRuleFromIndex(nextStartIndex)) {
      return finishWithRules(`从原价桶${roundMoney(buckets[nextStartIndex].price)}开始向后扫描，未找到满足门槛间距、减额递增、满减上限的下一档候选`);
    }
  }

  if (rules.length >= maxRuleCount) return finishWithRules(`已达到最大满减档数${maxRuleCount}`);
  if (highestAmount + 1e-9 >= maxAmount) return finishWithRules(`最高减额${roundMoney(highestAmount)}已达到满减上限${roundMoney(maxAmount)}，后续档无法继续递增`);
  return finishWithRules('满减生成循环自然结束');
}

function designActivityRouteRecommendation(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  fullRows: ActivityBaseComboRow[] = rows
) {
  if (!rows.length) return null;
  const sampleRows = sampleActivityRows(rows);
  const fullSampleRows = sampleActivityRows(fullRows);
  const fullDiagnostics: string[] = [];
  const fullReductionRules = buildFullReductionRouteRules(state, store, platform, fullSampleRows, settings, objective, [], fullDiagnostics);
  const couponDesign = buildCouponRouteRules(state, store, platform, sampleRows, settings, objective, fullReductionRules);
  const couponRules = couponDesign.couponRules;
  const actionType = fullReductionRules.length && couponRules.length
    ? '阶梯满减+推荐券+加码'
    : fullReductionRules.length
      ? '满减校准+加码'
    : couponRules.length
        ? '推荐券+加码'
        : '神券/爆红包加码';
  const recommendation = createActivityRouteRecommendation(
    platform,
    rows,
    settings,
    objective,
    fullReductionRules,
    couponRules,
    actionType,
    `已按原价桶活动空间生成满减，并由原价桶券列表生成最终推荐券，待支付价校验${fullReductionGenerationLogText(fullDiagnostics)}`,
    undefined,
    undefined,
    couponDesign.couponBucketSuggestions
  );
  if (!recommendation) return null;
  return scoreActivityRouteRecommendation(state, store, settings, recommendation, sampleRows, rows.length);
}

function couponUserScenarioName(objective: ActivityDesignObjective, settings?: ActivityDesignSettings) {
  return {
    longTerm: '长期稳定券',
    orderGrowth: '拉单加购券',
    raiseAov: '提客单加购券',
    hotProduct: '低客单爆品券',
    highMarginConversion: '高到手转化券',
    profitRecovery: '到手回收券'
  }[objective] || `${objectiveName(objective, settings)}券`;
}

function designFullReductionRouteRecommendation(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective,
  fullRows: ActivityBaseComboRow[] = rows
) {
  if (!rows.length) return null;
  const sampleRows = sampleActivityRows(rows);
  const fullSampleRows = sampleActivityRows(fullRows);
  const fullDiagnostics: string[] = [];
  const fullReductionRules = buildFullReductionRouteRules(state, store, platform, fullSampleRows, settings, objective, [], fullDiagnostics);
  const recommendation = createActivityRouteRecommendation(
    platform,
    rows,
    settings,
    objective,
    fullReductionRules,
    [],
    '满减支付区底盘',
    `满减按全门店公开优惠单独设计，用于覆盖主要活动空间，并给优惠券和加码预留空间${fullReductionGenerationLogText(fullDiagnostics)}`,
    'fullReduction'
  );
  if (!recommendation) return null;
  return scoreActivityRouteRecommendation(state, store, settings, recommendation, sampleRows, rows.length);
}

function designCouponRouteRecommendation(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  rows: ActivityBaseComboRow[],
  settings: ActivityDesignSettings,
  objective: ActivityDesignObjective
) {
  if (!rows.length) return null;
  const sampleRows = sampleActivityRows(rows);
  const couponDesign = buildCouponRouteRules(state, store, platform, sampleRows, settings, objective);
  const couponRules = couponDesign.couponRules;
  const recommendation = createActivityRouteRecommendation(
    platform,
    rows,
    settings,
    objective,
    [],
    couponRules,
    '用户场景券刺激',
    '优惠券按用户场景单独设计，用于促成交、促加购或拉单；需和选定满减路线组合后再做支付价核验',
    'coupon',
    couponUserScenarioName(objective, settings),
    couponDesign.couponBucketSuggestions
  );
  if (!recommendation) return null;
  return scoreActivityRouteRecommendation(state, store, settings, recommendation, sampleRows, rows.length);
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

function sortActivityRows(a: ActivityComboSimulationRow, b: ActivityComboSimulationRow) {
  return a.platform.localeCompare(b.platform)
    || a.recommendationLabel.localeCompare(b.recommendationLabel, 'zh-CN')
    || a.originalTotal - b.originalTotal
    || a.finalPay - b.finalPay
    || a.key.localeCompare(b.key);
}

function createActivityRouteValidationAccumulator(
  recommendation: ActivityRecommendationRow,
  settings: ActivityDesignSettings
): ActivityRouteValidationAccumulator {
  const maxFullAmount = recommendation.fullReductionRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
  const minFullThreshold = maxFullAmount > 0
    ? recommendation.fullReductionRules
      .filter(rule => Math.abs(rule.amount - maxFullAmount) < 1e-9)
      .reduce((min, rule) => Math.min(min, rule.threshold), Infinity)
    : Infinity;
  const maxCouponAmount = recommendation.couponRules.reduce((max, rule) => Math.max(max, rule.amount), 0);
  const minCouponThreshold = maxCouponAmount > 0
    ? recommendation.couponRules
      .filter(rule => Math.abs(rule.amount - maxCouponAmount) < 1e-9)
      .reduce((min, rule) => Math.min(min, rule.threshold), Infinity)
    : Infinity;

  return {
    recommendation,
    settings,
    payBandSize: Math.max(1, Number(settings.payBandSize) || 5),
    payBandStats: new Map(),
    comboRowsByKey: new Map(),
    hitRowsByKey: new Map(),
    hitReasonCounts: new Map(),
    activeCount: 0,
    ignoredCount: 0,
    lowNetPayIgnoredCount: 0,
    finalPaySum: 0,
    discountRateSum: 0,
    discountRateCount: 0,
    minDiscountRate: null,
    maxDiscountRate: null,
    businessPayWeightSum: 0,
    corePayCount: 0,
    mainPayCount: 0,
    highPayCount: 0,
    profitRateSum: 0,
    profitRateCount: 0,
    minProfitRate: null,
    maxProfitRate: null,
    lossCount: 0,
    lossOutOfToleranceCount: 0,
    minProfitSpaceRow: null,
    maxProfitRow: null,
    maxFullAmount,
    minFullThreshold,
    maxCouponAmount,
    minCouponThreshold
  };
}

function appendActivityHitRow(
  accumulator: ActivityRouteValidationAccumulator,
  row: ActivityComboSimulationRow,
  reason: string,
  limit = ACTIVITY_ROUTE_HIT_LIMIT_PER_REASON
) {
  const currentCount = accumulator.hitReasonCounts.get(reason) || 0;
  if (currentCount >= limit && !accumulator.hitRowsByKey.has(row.key)) return;
  appendActivityDetailRow(accumulator.hitRowsByKey, row, reason);
  accumulator.hitReasonCounts.set(reason, currentCount + 1);
}

function consumeActivityRouteValidationRow(accumulator: ActivityRouteValidationAccumulator, row: ActivityComboSimulationRow) {
  const countWeight = representedComboCount(row);
  if (row.ignored) {
    accumulator.ignoredCount += countWeight;
    if (row.netPay + 1e-9 < activityMinNetPayFloor(accumulator.settings, accumulator.recommendation.objective)) accumulator.lowNetPayIgnoredCount += countWeight;
    return;
  }

  const tolerance = activityLossTolerance(accumulator.settings, accumulator.recommendation.objective);
  accumulator.activeCount += countWeight;
  accumulator.finalPaySum += row.finalPay * countWeight;
  const actualDiscountRate = routeDiscountRate(row.originalTotal, row.finalPay);
  if (actualDiscountRate !== null) {
    accumulator.discountRateSum += actualDiscountRate * countWeight;
    accumulator.discountRateCount += countWeight;
    accumulator.minDiscountRate = accumulator.minDiscountRate === null ? actualDiscountRate : Math.min(accumulator.minDiscountRate, actualDiscountRate);
    accumulator.maxDiscountRate = accumulator.maxDiscountRate === null ? actualDiscountRate : Math.max(accumulator.maxDiscountRate, actualDiscountRate);
  }
  accumulator.businessPayWeightSum += activityExpectedPayWeight(accumulator.settings, accumulator.recommendation.objective, row.scenario, row.finalPay, row.originalTotal) * countWeight;
  if (activityPayInCoreRange(accumulator.settings, accumulator.recommendation.objective, row.finalPay, row.originalTotal)) accumulator.corePayCount += countWeight;
  if (activityPayInTargetRange(accumulator.settings, accumulator.recommendation.objective, row.finalPay, row.originalTotal)) accumulator.mainPayCount += countWeight;
  if (activityPayAboveTargetCeiling(accumulator.settings, accumulator.recommendation.objective, row.finalPay, row.originalTotal)) accumulator.highPayCount += countWeight;
  if (row.profit < -1e-9 || (row.netProfitRate !== null && row.netProfitRate < -1e-9)) accumulator.lossCount += countWeight;
  if (row.netProfitRate === null || row.netProfitRate < tolerance.minNetProfitRate - 1e-9) accumulator.lossOutOfToleranceCount += countWeight;
  const payGrossRate = paymentGrossProfitRate(row);
  if (payGrossRate !== null) {
    accumulator.profitRateSum += payGrossRate * countWeight;
    accumulator.profitRateCount += countWeight;
    accumulator.minProfitRate = accumulator.minProfitRate === null ? payGrossRate : Math.min(accumulator.minProfitRate, payGrossRate);
    accumulator.maxProfitRate = accumulator.maxProfitRate === null ? payGrossRate : Math.max(accumulator.maxProfitRate, payGrossRate);
  }
  if (!accumulator.minProfitSpaceRow || row.profitSpace < accumulator.minProfitSpaceRow.profitSpace) accumulator.minProfitSpaceRow = row;
  if (!accumulator.maxProfitRow || row.profit > accumulator.maxProfitRow.profit) accumulator.maxProfitRow = row;

  addPriceBandStats(accumulator.payBandStats, row, accumulator.payBandSize, 'pay', { groupByScenario: false });
  appendActivityComboResultRow(accumulator, row, '活动校验明细');

  if (
    accumulator.maxFullAmount > 0
    && Number.isFinite(accumulator.minFullThreshold)
    && Math.abs(row.full.amount - accumulator.maxFullAmount) < 1e-9
    && Math.abs(row.full.threshold - accumulator.minFullThreshold) < 1e-9
  ) {
    appendActivityHitRow(
      accumulator,
      row,
      `满减最大优惠最小阶梯：满${roundMoney(accumulator.minFullThreshold)}减${roundMoney(accumulator.maxFullAmount)}`
    );
  }

  if (
    accumulator.maxCouponAmount > 0
    && Number.isFinite(accumulator.minCouponThreshold)
    && row.coupons.some(coupon => Math.abs(coupon.amount - accumulator.maxCouponAmount) < 1e-9 && Math.abs(coupon.threshold - accumulator.minCouponThreshold) < 1e-9)
  ) {
    appendActivityHitRow(
      accumulator,
      row,
      `优惠券最大优惠最小阶梯：满${roundMoney(accumulator.minCouponThreshold)}减${roundMoney(accumulator.maxCouponAmount)}`
    );
  }
}

function activityRouteMetricsFromAccumulator(accumulator: ActivityRouteValidationAccumulator): ActivityRouteMetrics {
  const tolerance = activityLossTolerance(accumulator.settings, accumulator.recommendation.objective);
  const avgProfitRate = accumulator.profitRateCount ? accumulator.profitRateSum / accumulator.profitRateCount : null;
  const profitRateSpread = accumulator.maxProfitRate !== null && accumulator.minProfitRate !== null
    ? roundMoney(accumulator.maxProfitRate - accumulator.minProfitRate)
    : null;
  const payBandAverages = Array.from(accumulator.payBandStats.values())
    .filter(row => row.profitRateCount > 0)
    .map(row => row.profitRateSum / row.profitRateCount);
  const payBandAvgSpread = payBandAverages.length
    ? roundMoney(Math.max(...payBandAverages) - Math.min(...payBandAverages))
    : null;
  const lossShare = accumulator.activeCount ? accumulator.lossCount / accumulator.activeCount : 0;
  const lossShareOverflow = Math.max(0, lossShare - tolerance.maxLossShare);
  const businessPayWeight = accumulator.activeCount ? accumulator.businessPayWeightSum / accumulator.activeCount : 0;
  const corePayShare = accumulator.activeCount ? accumulator.corePayCount / accumulator.activeCount : 0;
  const mainPayShare = accumulator.activeCount ? accumulator.mainPayCount / accumulator.activeCount : 0;
  const highPayShare = accumulator.activeCount ? accumulator.highPayCount / accumulator.activeCount : 0;
  const targetPayShareFloor = activityTargetPayShareFloor(accumulator.settings, accumulator.recommendation.objective);
  const highPayShareLimit = activityHighPayShareLimit(accumulator.settings, accumulator.recommendation.objective);
  const targetGap = null;
  const targetPenalty = 0;
  const spreadPenalty = 0;
  const lossPenalty = 0;
  const checkedCount = accumulator.activeCount + accumulator.ignoredCount;
  const ignoredPenalty = checkedCount ? (accumulator.ignoredCount / checkedCount) * 70 : 0;
  const discountPenalty = accumulator.recommendation.totalDiscount * 0.03;
  const demandPenalty = activityDemandPenalty(accumulator.settings, accumulator.recommendation.objective, businessPayWeight, mainPayShare, highPayShare);

  return {
    activeCount: accumulator.activeCount,
    ignoredCount: accumulator.ignoredCount,
    avgProfitRate,
    minProfitRate: accumulator.minProfitRate,
    profitRateSpread,
    payBandAvgSpread,
    avgFinalPay: accumulator.activeCount ? accumulator.finalPaySum / accumulator.activeCount : 0,
    actualAvgDiscountRate: accumulator.discountRateCount ? Math.round((accumulator.discountRateSum / accumulator.discountRateCount) * 10000) / 10000 : null,
    actualMinDiscountRate: accumulator.minDiscountRate,
    actualMaxDiscountRate: accumulator.maxDiscountRate,
    lossCount: accumulator.lossCount,
    lossShare,
    maxLossShare: tolerance.maxLossShare,
    lossOutOfToleranceCount: accumulator.lossOutOfToleranceCount,
    lossShareOverflow,
    minAllowedProfitRate: tolerance.minNetProfitRate,
    businessPayWeight: roundMoney(businessPayWeight),
    corePayShare: roundMoney(corePayShare),
    mainPayShare: roundMoney(mainPayShare),
    highPayShare: roundMoney(highPayShare),
    targetPayShareFloor,
    highPayShareLimit,
    targetGap,
    targetPenalty: roundMoney(targetPenalty),
    spreadPenalty: roundMoney(spreadPenalty),
    lossPenalty: roundMoney(lossPenalty),
    ignoredPenalty: roundMoney(ignoredPenalty),
    discountPenalty: roundMoney(discountPenalty),
    demandPenalty: roundMoney(demandPenalty),
    score: roundMoney(targetPenalty + spreadPenalty + lossPenalty + ignoredPenalty + discountPenalty + demandPenalty)
  };
}

function appendActivityComboResultRow(
  accumulator: ActivityRouteValidationAccumulator,
  row: ActivityComboSimulationRow,
  reason: string
) {
  appendActivityDetailRow(accumulator.comboRowsByKey, row, reason);
}

function finalizeActivityRouteValidation(accumulator: ActivityRouteValidationAccumulator) {
  if (accumulator.minProfitSpaceRow) {
    appendActivityHitRow(accumulator, accumulator.minProfitSpaceRow, `最低利润空间：¥${roundMoney(accumulator.minProfitSpaceRow.profitSpace)}`);
  }
  if (accumulator.maxProfitRow) {
    appendActivityHitRow(accumulator, accumulator.maxProfitRow, `最高利润：¥${roundMoney(accumulator.maxProfitRow.profit)}`);
  }

  if (accumulator.minProfitSpaceRow) {
    appendActivityComboResultRow(accumulator, accumulator.minProfitSpaceRow, `全量最低利润空间：¥${roundMoney(accumulator.minProfitSpaceRow.profitSpace)}`);
  }
  if (accumulator.maxProfitRow) {
    appendActivityComboResultRow(accumulator, accumulator.maxProfitRow, `全量最高利润：¥${roundMoney(accumulator.maxProfitRow.profit)}`);
  }

  const metrics = activityRouteMetricsFromAccumulator(accumulator);
  return {
    finalizedSelectedRecommendation: applyActivityRouteMetrics(accumulator.settings, accumulator.recommendation, metrics, accumulator.activeCount),
    payBands: priceBandRowsFromStats(accumulator.payBandStats),
    hitRows: Array.from(accumulator.hitRowsByKey.values()).sort(sortActivityRows).slice(0, ACTIVITY_HIT_DETAIL_LIMIT),
    comboRows: Array.from(accumulator.comboRowsByKey.values()).sort(sortActivityRows)
  };
}

function finalizeRecommendations(
  recommendations: ActivityRecommendationRow[],
  simulatedRows: ActivityComboSimulationRow[],
  settings: ActivityDesignSettings,
  ignoredRows: ActivityComboSimulationRow[] = []
) {
  const rowsByRecommendation = new Map<string, ActivityComboSimulationRow[]>();
  for (const row of simulatedRows) {
    const rows = rowsByRecommendation.get(row.recommendationKey) || [];
    rows.push(row);
    rowsByRecommendation.set(row.recommendationKey, rows);
  }
  const ignoredCountByRecommendation = new Map<string, number>();
  for (const row of ignoredRows) {
    ignoredCountByRecommendation.set(row.recommendationKey, (ignoredCountByRecommendation.get(row.recommendationKey) || 0) + 1);
  }
  return recommendations.map(row => {
    const rows = rowsByRecommendation.get(row.key) || [];
    const ignoredCount = ignoredCountByRecommendation.get(row.key) || 0;
    const tolerance = activityLossTolerance(settings, row.objective);
    const payBandSize = Math.max(1, Number(settings.payBandSize) || 5);
    const payBandRates = new Map<string, { sum: number; count: number }>();
    let profitRateSum = 0;
    let profitRateCount = 0;
    let finalPaySum = 0;
    let discountRateSum = 0;
    let discountRateCount = 0;
    let minDiscountRate: number | null = null;
    let maxDiscountRate: number | null = null;
    let businessPayWeightSum = 0;
    let corePayCount = 0;
    let mainPayCount = 0;
    let highPayCount = 0;
    let lossCount = 0;
    let lossOutOfToleranceCount = 0;
    let minProfitAfter: number | null = null;
    let maxProfitAfter: number | null = null;
    for (const item of rows) {
      finalPaySum += item.finalPay;
      const actualDiscountRate = routeDiscountRate(item.originalTotal, item.finalPay);
      if (actualDiscountRate !== null) {
        discountRateSum += actualDiscountRate;
        discountRateCount++;
        minDiscountRate = minDiscountRate === null ? actualDiscountRate : Math.min(minDiscountRate, actualDiscountRate);
        maxDiscountRate = maxDiscountRate === null ? actualDiscountRate : Math.max(maxDiscountRate, actualDiscountRate);
      }
      businessPayWeightSum += activityExpectedPayWeight(settings, row.objective, item.scenario, item.finalPay, item.originalTotal);
      if (activityPayInCoreRange(settings, row.objective, item.finalPay, item.originalTotal)) corePayCount++;
      if (activityPayInTargetRange(settings, row.objective, item.finalPay, item.originalTotal)) mainPayCount++;
      if (activityPayAboveTargetCeiling(settings, row.objective, item.finalPay, item.originalTotal)) highPayCount++;
      const netProfitRate = item.netProfitRate;
      if (item.profit < -1e-9 || (netProfitRate !== null && netProfitRate < -1e-9)) {
        lossCount++;
      }
      if (netProfitRate === null || netProfitRate < tolerance.minNetProfitRate - 1e-9) {
        lossOutOfToleranceCount++;
      }
      const payGrossRate = paymentGrossProfitRate(item);
      if (payGrossRate !== null) {
        profitRateSum += payGrossRate;
        profitRateCount++;
        minProfitAfter = minProfitAfter === null ? payGrossRate : Math.min(minProfitAfter, payGrossRate);
        maxProfitAfter = maxProfitAfter === null ? payGrossRate : Math.max(maxProfitAfter, payGrossRate);
        const payKey = bandKey(item.finalPay, payBandSize).key;
        const payBand = payBandRates.get(payKey) || { sum: 0, count: 0 };
        payBand.sum += payGrossRate;
        payBand.count++;
        payBandRates.set(payKey, payBand);
      }
    }
    const avgProfitAfter = profitRateCount ? profitRateSum / profitRateCount : null;
    const spread = maxProfitAfter !== null && minProfitAfter !== null ? roundMoney(maxProfitAfter - minProfitAfter) : null;
    const payBandAverages = Array.from(payBandRates.values()).map(item => item.sum / item.count);
    const payBandAvgSpread = payBandAverages.length
      ? roundMoney(Math.max(...payBandAverages) - Math.min(...payBandAverages))
      : null;
    const targetGap = null;
    const targetPenalty = 0;
    const lossShare = rows.length ? lossCount / rows.length : 0;
    const lossShareOverflow = Math.max(0, lossShare - tolerance.maxLossShare);
    const businessPayWeight = rows.length ? businessPayWeightSum / rows.length : 0;
    const corePayShare = rows.length ? corePayCount / rows.length : 0;
    const mainPayShare = rows.length ? mainPayCount / rows.length : 0;
    const highPayShare = rows.length ? highPayCount / rows.length : 0;
    const targetPayShareFloor = activityTargetPayShareFloor(settings, row.objective);
    const highPayShareLimit = activityHighPayShareLimit(settings, row.objective);
    const spreadPenalty = 0;
    const lossPenalty = 0;
    const checkedCount = rows.length + ignoredCount;
    const ignoredPenalty = checkedCount ? (ignoredCount / checkedCount) * 70 : 0;
    const discountPenalty = row.totalDiscount * 0.03;
    const demandPenalty = activityDemandPenalty(settings, row.objective, businessPayWeight, mainPayShare, highPayShare);
    const metrics: ActivityRouteMetrics = {
      activeCount: rows.length,
      ignoredCount,
      avgProfitRate: avgProfitAfter,
      minProfitRate: minProfitAfter,
      profitRateSpread: spread,
      payBandAvgSpread,
      avgFinalPay: rows.length ? finalPaySum / rows.length : 0,
      actualAvgDiscountRate: discountRateCount ? Math.round((discountRateSum / discountRateCount) * 10000) / 10000 : null,
      actualMinDiscountRate: minDiscountRate,
      actualMaxDiscountRate: maxDiscountRate,
      lossCount,
      lossShare,
      maxLossShare: tolerance.maxLossShare,
      lossOutOfToleranceCount,
      lossShareOverflow,
      minAllowedProfitRate: tolerance.minNetProfitRate,
      businessPayWeight: roundMoney(businessPayWeight),
      corePayShare: roundMoney(corePayShare),
      mainPayShare: roundMoney(mainPayShare),
      highPayShare: roundMoney(highPayShare),
      targetPayShareFloor,
      highPayShareLimit,
      targetGap,
      targetPenalty: roundMoney(targetPenalty),
      spreadPenalty: roundMoney(spreadPenalty),
      lossPenalty: roundMoney(lossPenalty),
      ignoredPenalty,
      discountPenalty: roundMoney(discountPenalty),
      demandPenalty: roundMoney(demandPenalty),
      score: roundMoney(targetPenalty + spreadPenalty + lossPenalty + ignoredPenalty + discountPenalty + demandPenalty)
    };
    const scoreLevel = activityRouteScoreLevel(metrics);
    return {
      ...row,
      hitCount: rows.length,
      avgProfitAfter,
      minProfitAfter,
      profitRateSpreadAfter: payBandAvgSpread ?? spread,
      avgFinalPayAfter: metrics.avgFinalPay,
      score: metrics.score,
      scoreLevel,
      scoreLabel: activityRouteScoreLabel(scoreLevel),
      scoreDetails: activityRouteScoreDetails(settings, row, metrics),
      scoreBreakdown: activityRouteScoreBreakdown(row, metrics),
      diagnosis: activityRouteDiagnosis(settings, row, metrics)
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
  const accumulator = createActivityRouteValidationAccumulator(selectedRecommendation, settings);
  const selectedRouteRows = baseRows.filter(row => row.platform === selectedRecommendation.platform);
  for (const row of selectedRouteRows) {
    const simulation = markActivityPayBoundary(simulateRecommendation(state, store, row, selectedRecommendation, settings), settings, selectedRecommendation.objective);
    consumeActivityRouteValidationRow(accumulator, simulation);
  }

  if (!selectedRouteRows.length) {
    warnings.push(`当前活动设计参数下没有可校验组合（${activityValidationBoundaryText(store, settings)}）。`);
  }

  const validation = finalizeActivityRouteValidation(accumulator);
  if (!accumulator.activeCount && selectedRouteRows.length) {
    warnings.push(`所选活动路线在当前活动设计支付价边界内没有命中组合（${activityValidationBoundaryText(store, settings)}），请调整支付价范围或活动力度。`);
  }
  if (accumulator.lowNetPayIgnoredCount > 0) {
    warnings.push(`所选活动路线有 ${accumulator.lowNetPayIgnoredCount} 个组合商家到手价低于 ¥${roundMoney(activityMinNetPayFloor(settings, selectedRecommendation.objective))}，已从支付价校验均值中排除。`);
  }
  if (accumulator.activeCount > validation.comboRows.length) {
    warnings.push(`活动后支付价校验明细共 ${accumulator.activeCount} 条，页面合并重复组合后展示 ${validation.comboRows.length} 条；区间统计仍基于全量命中组合计算。`);
  }

  return validation;
}

function activityRouteRowsByPlatform(rows: ActivityBaseComboRow[], platforms: Platform[]) {
  const allowedPlatforms = new Set(platforms);
  const rowsByPlatform = new Map<Platform, ActivityBaseComboRow[]>();
  const countsByPlatform = new Map<Platform, number>();
  for (const row of rows) {
    if (!allowedPlatforms.has(row.platform)) continue;
    rememberActivityRouteSample(rowsByPlatform, countsByPlatform, row);
  }
  return { rowsByPlatform, countsByPlatform };
}

function designActivityRoutesFromRows(
  state: CalculatorState,
  store: ReturnType<typeof currentStoreFrom>,
  platforms: Platform[],
  settings: ActivityDesignSettings,
  routeRowsByPlatform: Map<Platform, ActivityBaseComboRow[]>,
  routeRowCountsByPlatform: Map<Platform, number>,
  warnings: string[]
) {
  const activityRoutes: ActivityRecommendationRow[] = [];
  const fullRoutes: ActivityRecommendationRow[] = [];
  const couponRoutes: ActivityRecommendationRow[] = [];

  for (const platform of platforms) {
    const routeRows = routeRowsByPlatform.get(platform) || [];
    if (!routeRows.length) continue;
    const routeSourceCount = routeRowCountsByPlatform.get(platform) || routeRows.length;
    if (routeSourceCount > routeRows.length) {
      warnings.push(`${platform === 'meituan' ? '美团' : '饿了么'}活动路线设计基于 ${routeRows.length}/${routeSourceCount} 个原价桶采样，原价整数桶仍按扫描结果聚合。`);
    }
    for (const objective of activityDesignObjectives(settings)) {
      const objectiveRows = activityRowsForObjective(routeRows, settings, objective);
      if (objectiveRows.length < routeRows.length) {
        const adjustableRows = objectiveRows.filter(row => baseActivityDesignSpace(row, settings, objective) >= ACTIVITY_ROUTE_MIN_DESIGN_SPACE - 1e-9).length;
        if (!adjustableRows) {
          warnings.push(`${platform === 'meituan' ? '美团' : '饿了么'}${objectiveName(objective, settings)}原价阶梯下没有达到 ¥${roundMoney(ACTIVITY_ROUTE_MIN_DESIGN_SPACE)} 的剩余让利空间，已使用原价桶尝试生成候选路线。`);
        }
      }
      const objectiveSampleRows = sampleActivityRows(objectiveRows);
      const fullRows = activityFullReductionRowsForObjective(routeRows, objectiveRows);
      const activityRoute = designActivityRouteRecommendation(state, store, platform, objectiveRows, settings, objective, fullRows);
      if (activityRoute) {
        activityRoutes.push(scoreActivityRouteRecommendation(state, store, settings, activityRoute, objectiveSampleRows, objectiveRows.length));
      }
      const fullRoute = designFullReductionRouteRecommendation(state, store, platform, objectiveRows, settings, objective, fullRows);
      if (fullRoute) {
        fullRoutes.push(scoreActivityRouteRecommendation(state, store, settings, fullRoute, objectiveSampleRows, objectiveRows.length));
      }
      const couponRoute = designCouponRouteRecommendation(state, store, platform, objectiveRows, settings, objective);
      if (couponRoute) {
        couponRoutes.push(scoreActivityRouteRecommendation(state, store, settings, couponRoute, objectiveSampleRows, objectiveRows.length));
      }
    }
  }

  activityRoutes.sort((a, b) => a.platform.localeCompare(b.platform) || a.score - b.score || b.hitCount - a.hitCount);
  fullRoutes.sort((a, b) => a.platform.localeCompare(b.platform) || a.score - b.score || b.hitCount - a.hitCount);
  couponRoutes.sort((a, b) => a.platform.localeCompare(b.platform) || a.score - b.score || b.hitCount - a.hitCount);
  const recommendations = activityRoutes.length ? activityRoutes : [...fullRoutes, ...couponRoutes];
  recommendations.sort((a, b) => a.platform.localeCompare(b.platform) || a.score - b.score || b.hitCount - a.hitCount);

  return { activityRoutes, fullRoutes, couponRoutes, recommendations };
}

async function runSelectedActivityRouteValidationCalculation(
  state: CalculatorState,
  selectedRecommendation: ActivityRecommendationRow,
  settings: ActivityDesignSettings,
  warnings: string[],
  onProgress: ((progress: CalculationProgress) => void) | undefined,
  maxDurationMs: number,
  startedAt: number
): Promise<ActivityDesignResult> {
  const store = currentStoreFrom(state);
  const originalBandSize = Math.max(1, Number(settings.originalBandSize) || 5);
  const originalBandStats = new Map<string, ActivityPriceBandStats>();
  const accumulator = createActivityRouteValidationAccumulator(selectedRecommendation, settings);
  const originalPriceBucketsSnapshot = settings.originalPriceBucketsSnapshot || [];
  if (originalPriceBucketsSnapshot.length) {
    const originalBands = settings.originalBandsSnapshot || [];
    const selectedBuckets = originalPriceBucketsSnapshot.filter(bucket => bucket.platform === selectedRecommendation.platform && bucket.comboCount > 0);
    const selectedRouteRows = activityBucketCostSummaryRowsToRouteRows(selectedBuckets, [selectedRecommendation.platform], {
      store,
      scanComboPools: settings.scanComboPoolsSnapshot
    });
    const selectedBucketComboCount = selectedBuckets.reduce((sum, bucket) => sum + Math.max(0, Number(bucket.comboCount) || 0), 0);
    const missingCostSummaryCount = selectedBuckets.filter(bucket => (
      bucket.minCost === undefined
      && bucket.maxCost === undefined
      && !(Number(bucket.avgCost) > 0)
      && !(Number(bucket.weightedAvgCost) > 0)
    )).length;
    const missingRepresentativeItemCount = selectedRouteRows.filter(row => !row.items.length).length;
    const validation = validateSelectedActivityRoute(state, store, settings, selectedRecommendation, selectedRouteRows, warnings);
    warnings.push(`本次活动校验基于原价整数桶成本摘要完成，${selectedBuckets.length}个原价桶共代表${selectedBucketComboCount}个组合，生成${selectedRouteRows.length}条平均/最高/最低成本口径校验行，并按桶内代表组合回填商品明细。`);
    if (missingCostSummaryCount > 0) {
      warnings.push(`有${missingCostSummaryCount}个原价桶缺少成本摘要，请重新执行原价整数扫描后再做支付价核验。`);
    }
    if (missingRepresentativeItemCount > 0) {
      warnings.push(`有${missingRepresentativeItemCount}条校验行缺少可还原的代表组合，请重新执行原价整数扫描后再做支付价核验。`);
    }
    return {
      originalBands,
      originalPriceBuckets: originalPriceBucketsSnapshot,
      originalComboRows: [],
      routeSourceRows: selectedRouteRows,
      fullRoutes: [],
      couponRoutes: [],
      recommendations: [validation.finalizedSelectedRecommendation],
      payBands: validation.payBands,
      hitRows: validation.hitRows,
      comboRows: validation.comboRows,
      warnings,
      summary: {
        resultCount: 1,
        comboCount: selectedBucketComboCount || selectedRouteRows.length,
        validComboCount: selectedBucketComboCount || selectedRouteRows.length,
        elapsedTime: Math.round(calculationNow() - startedAt)
      }
    };
  }

  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: 'maxChecks' | 'maxDuration' | undefined;

  const enumeration = await enumerateActivityDesignCombosAsync(
    store,
    selectedRecommendation.platform,
    settings,
    maxDurationMs,
    startedAt,
    qtys => {
      const row = createBaselineCombo(state, store, selectedRecommendation.platform, qtys, settings);
      if (!row) return;
      addPriceBandStats(originalBandStats, row, originalBandSize, 'original');
      consumeActivityRouteValidationRow(
        accumulator,
        markActivityPayBoundary(simulateRecommendation(state, store, row, selectedRecommendation, settings), settings, selectedRecommendation.objective)
      );
    },
    progress => onProgress?.({
      resultCount: accumulator.activeCount + accumulator.ignoredCount,
      comboCount: progress.checked,
      validComboCount: progress.validCombos
    })
  );
  checked = enumeration.checked;
  validCombos = enumeration.validCombos;
  stopped = enumeration.stopped;
  stoppedReason = enumeration.stoppedReason;

  const stopWarning = calculationStopWarning({ stopped, stoppedReason }, activityDesignMaxChecks(store), maxDurationMs);
  if (stopWarning) warnings.push(stopWarning);
  const validation = finalizeActivityRouteValidation(accumulator);
  const validationTotal = accumulator.activeCount + accumulator.ignoredCount;
  if (!validationTotal) {
    warnings.push(`当前活动设计参数下没有可校验组合（${activityValidationBoundaryText(store, settings)}）。`);
  }
  if (!accumulator.activeCount && validationTotal) {
    warnings.push(`所选活动路线在当前活动设计支付价边界内没有命中组合（${activityValidationBoundaryText(store, settings)}），请调整支付价范围或活动力度。`);
  }
  if (accumulator.lowNetPayIgnoredCount > 0) {
    warnings.push(`所选活动路线有 ${accumulator.lowNetPayIgnoredCount} 个组合商家到手价低于 ¥${roundMoney(activityMinNetPayFloor(settings, selectedRecommendation.objective))}，已从支付价校验均值中排除。`);
  }
  if (accumulator.activeCount > validation.comboRows.length) {
    warnings.push(`活动后支付价校验明细共 ${accumulator.activeCount} 条，页面合并重复组合后展示 ${validation.comboRows.length} 条；区间统计仍基于全量命中组合计算。`);
  }

  return {
    originalBands: priceBandRowsFromStats(originalBandStats),
    originalPriceBuckets: [],
    originalComboRows: [],
    fullRoutes: [],
    couponRoutes: [],
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

export async function runActivityDesignCalculation(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: ActivityDesignSettings,
  onProgress?: (progress: CalculationProgress) => void,
  limits?: CalculationLimits,
  onRowsChunk?: (rows: ComboEvaluationRow[]) => void
): Promise<ActivityDesignResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeCalculationMaxDuration(limits?.maxDurationMs);
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  const calculationMode = settings.calculationMode || (settings.selectedRecommendationKey ? 'payValidation' : 'routeDesign');
  const selectedRecommendationKey = String(settings.selectedRecommendationKey || '');
  const selectedRecommendationSnapshot = selectedRecommendationKey
    ? recommendationSnapshotFromSettings(settings, selectedRecommendationKey)
    : null;
  const platforms = selectedRecommendationSnapshot
    ? [selectedRecommendationSnapshot.platform]
    : platformFilter === 'all'
      ? PLATFORMS
      : [platformFilter];

  if (selectedRecommendationSnapshot) {
    return runSelectedActivityRouteValidationCalculation(
      state,
      selectedRecommendationSnapshot,
      settings,
      warnings,
      onProgress,
      maxDurationMs,
      startedAt
    );
  }

  if (calculationMode === 'routeDesign' && (settings.originalPriceBucketsSnapshot || []).length) {
    const originalBands = settings.originalBandsSnapshot || [];
    const originalPriceBuckets = settings.originalPriceBucketsSnapshot || [];
    const bucketRouteRows = activityBucketRowsToRouteRows(originalPriceBuckets, platforms);
    const { rowsByPlatform, countsByPlatform } = activityRouteRowsByPlatform(bucketRouteRows, platforms);
    const routes = designActivityRoutesFromRows(state, store, platforms, settings, rowsByPlatform, countsByPlatform, warnings);
    onProgress?.({
      resultCount: routes.recommendations.length,
      comboCount: bucketRouteRows.length,
      validComboCount: bucketRouteRows.length
    });
    if (!routes.recommendations.length) {
      warnings.push('当前原价扫描快照没有生成可用活动路线，请调整基准让利率、阶梯覆盖或组合边界后重新扫描。');
    }
    return {
      originalBands,
      originalPriceBuckets,
      originalComboRows: [],
      routeSourceRows: [],
      fullRoutes: routes.fullRoutes.slice(0, 80),
      couponRoutes: routes.couponRoutes.slice(0, 80),
      recommendations: routes.recommendations.slice(0, 160),
      payBands: [],
      hitRows: [],
      comboRows: [],
      warnings,
      summary: {
        resultCount: routes.recommendations.length,
        comboCount: bucketRouteRows.length,
        validComboCount: bucketRouteRows.length,
        elapsedTime: Math.round(calculationNow() - startedAt)
      }
    };
  }

  const originalBucketStats: ActivityPriceBucketAccumulatorMap = new Map();
  const originalBucketPlatformNames = new Map<Platform, string>();
  const originalBucketEntries: ActivityOriginalBucketEntryMap = new Map();
  const scanPoolsByPlatform = new Map<Platform, SeparatedComboPools>();
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
    const poolBuild = await buildActivityDesignComboPoolsAsync(
      store,
      platform,
      settings,
      maxDurationMs,
      startedAt,
      progress => onProgress?.({
        resultCount: validBefore + progress.validCombos,
        comboCount: checkedBefore + progress.checked,
        validComboCount: validBefore + progress.validCombos
      })
    );
    scanPoolsByPlatform.set(platform, poolBuild.pools);
    stopped = stopped || poolBuild.stopped;
    stoppedReason = stoppedReason || poolBuild.stoppedReason;
    if (stoppedReason === 'maxDuration') break;

    const rangeMinCents = moneyToCents(poolBuild.range.min);
    const rangeMaxCents = Number.isFinite(poolBuild.range.max) ? moneyToCents(poolBuild.range.max) : Infinity;
    const platformMainRows = activityScanComboPoolRows(store, platform, 'main', poolBuild.pools.mainCombos);
    const platformAddOnRows = activityScanComboPoolRows(store, platform, 'addOn', poolBuild.pools.addOnCombosByCount.flat());
    const mainGroups = groupActivityScanCombosForOriginalScan(platformMainRows, 'main');
    const addOnGroups = groupActivityScanCombosForOriginalScan(platformAddOnRows, 'addOn');
    let visitedPairs = 0;
    let lastYieldAt = calculationNow();
    let lastProgressAt = calculationNow();

    async function maybeYield(force = false) {
      visitedPairs++;
      const now = calculationNow();
      if (!stopped && now - startedAt >= maxDurationMs) {
        stopped = true;
        stoppedReason = 'maxDuration';
      }
      if (stopped) return;
      const shouldYield = force || visitedPairs % 600 === 0 || now - lastYieldAt >= 16;
      if (!shouldYield) return;
      lastYieldAt = now;
      if (onProgress && now - lastProgressAt >= 120) {
        lastProgressAt = now;
        onProgress({ resultCount: validCombos, comboCount: checked, validComboCount: validCombos });
      }
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }

    for (const mainGroup of mainGroups) {
      if (stopped) break;
      if (mainGroup.priceCents > rangeMaxCents) break;
      const maxAddOnCount = Math.min(Math.max(0, poolBuild.maxItems - mainGroup.totalQty), poolBuild.addOnMaxCountLimit);
      for (const addOnGroup of addOnGroups) {
        await maybeYield();
        if (stopped) break;
        if (addOnGroup.totalQty > maxAddOnCount) continue;
        const originalTotalCents = mainGroup.priceCents + addOnGroup.priceCents;
        if (originalTotalCents > rangeMaxCents) break;
        const comboCount = mainGroup.comboIds.length * addOnGroup.comboIds.length;
        if (comboCount <= 0) continue;
        checked += comboCount;
        if (originalTotalCents < rangeMinCents) continue;
        const entry = rememberActivityOriginalBucketEntry(originalBucketEntries, platform, originalTotalCents, mainGroup, addOnGroup);
        validCombos += entry.comboCount;
        addActivityOriginalPriceBucketStatsFromScanEntry(
          state,
          store,
          originalBucketStats,
          originalBucketPlatformNames,
          platform,
          originalTotalCents,
          entry,
          settings
        );
      }
    }

    if (poolBuild.poolTruncated && !stopped) {
      stopped = true;
      stoppedReason = 'maxChecks';
    }
    if (stopped) break;
  }

  const stopWarning = calculationStopWarning({ stopped, stoppedReason }, activityDesignMaxChecks(store), maxDurationMs);
  if (stopWarning) warnings.push(stopWarning);

  const originalBands: PriceBandRow[] = [];
  const originalPriceBuckets = activityOriginalPriceBucketsFromStats(originalBucketStats, originalBucketPlatformNames, originalBucketEntries);
  const scanComboPools = buildActivityScanComboPools(store, scanPoolsByPlatform);
  const bucketRouteRows = activityBucketRowsToRouteRows(originalPriceBuckets, platforms);
  const routeSourceRows = bucketRouteRows;
  const routeSourceRowsByPlatform = activityRouteRowsByPlatform(routeSourceRows, platforms);

  const routes = calculationMode === 'priceScan'
    ? { fullRoutes: [] as ActivityRecommendationRow[], couponRoutes: [] as ActivityRecommendationRow[], recommendations: [] as ActivityRecommendationRow[] }
    : designActivityRoutesFromRows(state, store, platforms, settings, routeSourceRowsByPlatform.rowsByPlatform, routeSourceRowsByPlatform.countsByPlatform, warnings);
  const { fullRoutes, couponRoutes, recommendations } = routes;

  if (!selectedRecommendationKey) {
    return {
      originalBands,
      originalPriceBuckets,
      originalComboRows: [],
      routeSourceRows: [],
      scanComboPools,
      fullRoutes: fullRoutes.slice(0, 80),
      couponRoutes: couponRoutes.slice(0, 80),
      recommendations: recommendations.slice(0, 160),
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
      originalPriceBuckets,
      originalComboRows: [],
      routeSourceRows: [],
      scanComboPools,
      fullRoutes: fullRoutes.slice(0, 80),
      couponRoutes: couponRoutes.slice(0, 80),
      recommendations: recommendations.slice(0, 160),
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

  const validation = validateSelectedActivityRoute(state, store, settings, selectedRecommendation, routeSourceRows, warnings);
  const finalizedSelectedRecommendation = validation.finalizedSelectedRecommendation;
  const recommendationSource = recommendations.some(row => row.key === finalizedSelectedRecommendation.key)
    ? recommendations
    : [finalizedSelectedRecommendation, ...recommendations];
  const finalizedRecommendations = recommendationSource
    .map(row => row.key === finalizedSelectedRecommendation.key ? finalizedSelectedRecommendation : row)
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.score - b.score || b.hitCount - a.hitCount);

  return {
    originalBands,
    originalPriceBuckets,
    originalComboRows: [],
    routeSourceRows: [],
    scanComboPools,
    fullRoutes: fullRoutes.slice(0, 80),
    couponRoutes: couponRoutes.slice(0, 80),
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
