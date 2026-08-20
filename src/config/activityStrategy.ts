import type {
  ActivityCouponRecommendationMode,
  ActivityCouponRecommendationPolicy,
  ActivityCouponSceneTemplate,
  ActivityDesignObjective,
  ActivityDesignSettings,
  ActivityObjectivePayTarget,
  ActivityObjectiveStrategy,
  ActivityObjectiveTemplate,
  ActivityOriginalDiscountTier,
  ActivityStrategySettings,
  Platform
} from '../domain/types';

export type ActivityObjectiveOption = ActivityObjectiveTemplate & {
  value: ActivityDesignObjective;
  label: string;
};

export const DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES: ActivityObjectiveTemplate[] = [
  { key: 'longTerm', enabled: true, name: '店铺稳定', group: 'stable', targetPayLabel: '0-25 稳定主战场', targetPayMin: 0, targetPayMax: 25, description: '满减为主，券少发，用于稳定主要支付区。' },
  { key: 'orderGrowth', enabled: true, name: '拉升单量', group: 'marketing', targetPayLabel: '0-20 拉单成交区', targetPayMin: 0, targetPayMax: 20, description: '满减保守，优惠券和加码主导低客单成交。' },
  { key: 'raiseAov', enabled: true, name: '提高客单价', group: 'marketing', targetPayLabel: '15-25 加购提客单区', targetPayMin: 15, targetPayMax: 25, description: '券门槛卡在加购档位，引导用户补小吃。' },
  { key: 'hotProduct', enabled: true, name: '爆品打造', group: 'marketing', targetPayLabel: '0-18 爆品成交区', targetPayMin: 0, targetPayMax: 18, description: '短期让利换曝光，优先覆盖低支付成交。' },
  { key: 'highMarginConversion', enabled: true, name: '高到手转化', group: 'marketing', targetPayLabel: '10-25 高到手转化区', targetPayMin: 10, targetPayMax: 25, description: '释放到手空间较足的组合，提高成交率。' },
  { key: 'profitRecovery', enabled: true, name: '到手回收', group: 'marketing', targetPayLabel: '15-30 到手回收区', targetPayMin: 15, targetPayMax: 30, description: '收紧优惠，优先提升活动后到手价。' }
];

export function activityObjectiveOptionFromTemplate(template: ActivityObjectiveTemplate): ActivityObjectiveOption {
  return {
    ...template,
    value: template.key,
    label: template.name
  };
}

export function activityObjectiveOptionsFromTemplates(templates: ActivityObjectiveTemplate[]) {
  return templates.filter(template => template.enabled).map(activityObjectiveOptionFromTemplate);
}

export const ACTIVITY_OBJECTIVE_OPTIONS = activityObjectiveOptionsFromTemplates(DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES);

export const ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS: Record<ActivityCouponRecommendationMode, ActivityCouponRecommendationPolicy> = {
  conservative: {
    mode: 'conservative',
    amountStep: 0.5,
    minCouponAmount: 1,
    nearThresholdGap: 4,
    farThresholdGap: 12,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 0,
    representativeMode: 'lowestThreshold'
  },
  balanced: {
    mode: 'balanced',
    amountStep: 0.5,
    minCouponAmount: 1,
    nearThresholdGap: 5,
    farThresholdGap: 10,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 0.5,
    representativeMode: 'balanced'
  },
  aggressive: {
    mode: 'aggressive',
    amountStep: 0.5,
    minCouponAmount: 1,
    nearThresholdGap: 8,
    farThresholdGap: 12,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 1,
    representativeMode: 'highestThreshold'
  }
};

export const DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES: ActivityCouponSceneTemplate[] = [
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
    name: '高到手补档券',
    priority: 50,
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
    maxOverBucketSpace: 0,
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
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  }
];

export const DEFAULT_ACTIVITY_PLATFORM_COUPON_SCENE_KEYS: Partial<Record<Platform, string[]>> = {
  meituan: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(template => template.key),
  eleme: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(template => template.key)
};

const ACTIVITY_OBJECTIVE_TARGET_DEFAULTS: Record<string, {
  targetOffset: number;
  minOffset: number;
  minNetProfitRate: number;
  maxLossShare: number;
  originalDiscountTiers: ActivityOriginalDiscountTier[];
  fullDiscountShare: number;
  couponDiscountShare: number;
  reserveDiscountShare: number;
  fullThresholdWindow: number;
  fullThresholdMinGap: number;
  minFullAmountIncrease: number;
  fullAmountBasis: ActivityObjectiveStrategy['fullAmountBasis'];
  maxFullRuleCount: number;
  minFullHitCount: number;
  minNetPayFloor: number;
  couponScoringMode: ActivityObjectiveStrategy['couponScoringMode'];
}> = {
  longTerm: { targetOffset: 0, minOffset: -12, minNetProfitRate: -5, maxLossShare: 8, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 25 }, { originalMin: 45, originalMax: 60, discountRate: 20 }, { originalMin: 60, originalMax: 999, discountRate: 15 }], fullDiscountShare: 70, couponDiscountShare: 20, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 10, minFullAmountIncrease: 3, fullAmountBasis: 'average', maxFullRuleCount: 6, minFullHitCount: 3, minNetPayFloor: 2, couponScoringMode: 'balanced' },
  orderGrowth: { targetOffset: -10, minOffset: -28, minNetProfitRate: -18, maxLossShare: 22, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 8 }, { originalMin: 30, originalMax: 45, discountRate: 30 }, { originalMin: 45, originalMax: 60, discountRate: 25 }, { originalMin: 60, originalMax: 999, discountRate: 20 }], fullDiscountShare: 30, couponDiscountShare: 60, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 8, minFullAmountIncrease: 2, fullAmountBasis: 'p75', maxFullRuleCount: 6, minFullHitCount: 2, minNetPayFloor: 2, couponScoringMode: 'aggressive' },
  raiseAov: { targetOffset: -5, minOffset: -20, minNetProfitRate: -12, maxLossShare: 14, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 28 }, { originalMin: 45, originalMax: 60, discountRate: 24 }, { originalMin: 60, originalMax: 999, discountRate: 20 }], fullDiscountShare: 35, couponDiscountShare: 55, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 10, minFullAmountIncrease: 3, fullAmountBasis: 'p75', maxFullRuleCount: 6, minFullHitCount: 3, minNetPayFloor: 2, couponScoringMode: 'aggressive' },
  hotProduct: { targetOffset: -16, minOffset: -35, minNetProfitRate: -25, maxLossShare: 30, originalDiscountTiers: [{ originalMin: 0, originalMax: 15, discountRate: 10 }, { originalMin: 25, originalMax: 40, discountRate: 35 }, { originalMin: 40, originalMax: 60, discountRate: 28 }, { originalMin: 60, originalMax: 999, discountRate: 22 }], fullDiscountShare: 20, couponDiscountShare: 70, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 8, minFullAmountIncrease: 2, fullAmountBasis: 'p75', maxFullRuleCount: 6, minFullHitCount: 2, minNetPayFloor: 2, couponScoringMode: 'aggressive' },
  highMarginConversion: { targetOffset: -3, minOffset: -18, minNetProfitRate: -14, maxLossShare: 16, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 26 }, { originalMin: 45, originalMax: 60, discountRate: 22 }, { originalMin: 60, originalMax: 999, discountRate: 18 }], fullDiscountShare: 40, couponDiscountShare: 45, reserveDiscountShare: 15, fullThresholdWindow: 5, fullThresholdMinGap: 10, minFullAmountIncrease: 3, fullAmountBasis: 'average', maxFullRuleCount: 6, minFullHitCount: 3, minNetPayFloor: 2, couponScoringMode: 'balanced' },
  profitRecovery: { targetOffset: 5, minOffset: -8, minNetProfitRate: -2, maxLossShare: 5, originalDiscountTiers: [{ originalMin: 0, originalMax: 20, discountRate: 0 }, { originalMin: 35, originalMax: 55, discountRate: 12 }, { originalMin: 55, originalMax: 999, discountRate: 10 }], fullDiscountShare: 85, couponDiscountShare: 5, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 12, minFullAmountIncrease: 3, fullAmountBasis: 'min', maxFullRuleCount: 6, minFullHitCount: 4, minNetPayFloor: 2, couponScoringMode: 'conservative' }
};

function activityObjectiveTargetDefaults(objective: ActivityDesignObjective, group: ActivityObjectiveTemplate['group'] = 'marketing') {
  return ACTIVITY_OBJECTIVE_TARGET_DEFAULTS[objective]
    || ACTIVITY_OBJECTIVE_TARGET_DEFAULTS[group === 'stable' ? 'longTerm' : 'orderGrowth'];
}

export function defaultActivityObjectivePayTargets(
  baseTargetProfitRate = 35,
  objectiveOptions: ActivityObjectiveOption[] = ACTIVITY_OBJECTIVE_OPTIONS
): Record<ActivityDesignObjective, ActivityObjectivePayTarget> {
  return objectiveOptions.reduce<Record<ActivityDesignObjective, ActivityObjectivePayTarget>>((targets, option) => {
    const defaults = activityObjectiveTargetDefaults(option.value, option.group);
    const targetPayProfitRate = Math.max(-30, Math.min(95, baseTargetProfitRate + defaults.targetOffset));
    targets[option.value] = {
      payMin: option.targetPayMin,
      payMax: option.targetPayMax,
      targetPayProfitRate,
      minPayProfitRate: Math.max(-50, Math.min(targetPayProfitRate, baseTargetProfitRate + defaults.minOffset)),
      minNetProfitRate: defaults.minNetProfitRate,
      maxLossShare: defaults.maxLossShare
    };
    return targets;
  }, {} as Record<ActivityDesignObjective, ActivityObjectivePayTarget>);
}

export const DEFAULT_ACTIVITY_OBJECTIVE_PAY_TARGETS = defaultActivityObjectivePayTargets();

export function defaultActivityCouponRecommendationPolicy(mode: ActivityCouponRecommendationMode = 'balanced'): ActivityCouponRecommendationPolicy {
  return { ...ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS[mode] };
}

export function defaultActivityObjectiveStrategies(
  baseTargetProfitRate = 35,
  objectiveOptions: ActivityObjectiveOption[] = ACTIVITY_OBJECTIVE_OPTIONS
): Record<ActivityDesignObjective, ActivityObjectiveStrategy> {
  const payTargets = defaultActivityObjectivePayTargets(baseTargetProfitRate, objectiveOptions);
  return objectiveOptions.reduce<Record<ActivityDesignObjective, ActivityObjectiveStrategy>>((strategies, option) => {
    const defaults = activityObjectiveTargetDefaults(option.value, option.group);
    strategies[option.value] = {
      ...payTargets[option.value],
      originalDiscountTiers: defaults.originalDiscountTiers,
      fullDiscountShare: defaults.fullDiscountShare,
      couponDiscountShare: defaults.couponDiscountShare,
      reserveDiscountShare: defaults.reserveDiscountShare,
      fullThresholdWindow: defaults.fullThresholdWindow,
      fullThresholdMinGap: defaults.fullThresholdMinGap,
      minFullAmountIncrease: defaults.minFullAmountIncrease,
      fullAmountBasis: defaults.fullAmountBasis,
      maxFullRuleCount: defaults.maxFullRuleCount,
      minFullHitCount: defaults.minFullHitCount,
      minNetPayFloor: defaults.minNetPayFloor,
      couponRecommendationPolicy: defaultActivityCouponRecommendationPolicy(defaults.couponScoringMode),
      couponScoringMode: defaults.couponScoringMode
    };
    return strategies;
  }, {} as Record<ActivityDesignObjective, ActivityObjectiveStrategy>);
}

export const DEFAULT_ACTIVITY_STRATEGY_SETTINGS: ActivityStrategySettings = {
  baseOriginalDiscountRate: 50,
  objectiveTemplates: DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES,
  objectiveStrategies: defaultActivityObjectiveStrategies(),
  couponSceneTemplates: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES,
  platformCouponSceneKeys: DEFAULT_ACTIVITY_PLATFORM_COUPON_SCENE_KEYS
};

export const DEFAULT_ACTIVITY_DESIGN_SETTINGS: ActivityDesignSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  redAddOnSpace: 0,
  baseOriginalDiscountRate: 50,
  stapleMaxCount: 2,
  addOnMaxCount: 3,
  targetProfitRate: 35,
  couponProfitDrop: 3,
  couponDesignBasis: 'original',
  couponDesignThresholdStep: 5,
  couponDesignMaxFullAmount: '',
  couponDesignMaxCouponAmount: 20,
  designMode: 'auto',
  objective: 'longTerm',
  useDefaultObjectiveStrategies: true,
  objectivePayTargets: DEFAULT_ACTIVITY_OBJECTIVE_PAY_TARGETS,
  objectiveStrategies: DEFAULT_ACTIVITY_STRATEGY_SETTINGS.objectiveStrategies,
  objectiveTemplates: DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES,
  couponSceneTemplates: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES,
  platformCouponSceneKeys: DEFAULT_ACTIVITY_PLATFORM_COUPON_SCENE_KEYS,
  minProfitRate: 0,
  originalBandSize: 5,
  payBandSize: 5
};
