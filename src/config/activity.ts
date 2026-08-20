import type {
  ActivityCouponRecommendationMode,
  ActivityDesignCalculationMode,
  ActivityObjectiveStrategy,
  ComboRangeSettings,
  StapleScenario
} from '../domain/types';

export const ACTIVITY_DESIGN_STAGE_LABELS: Record<ActivityDesignCalculationMode, string> = {
  priceScan: '原价扫描',
  routeDesign: '活动路线设计',
  payValidation: '支付价核验'
};

export const ACTIVITY_FULL_AMOUNT_BASIS_OPTIONS: Array<{ value: ActivityObjectiveStrategy['fullAmountBasis']; label: string }> = [
  { value: 'average', label: '均值' },
  { value: 'p75', label: 'P75' },
  { value: 'min', label: '最小值' },
  { value: 'max', label: '最大值' }
];

export const ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS: Array<{ value: ActivityCouponRecommendationMode; label: string }> = [
  { value: 'conservative', label: '保守' },
  { value: 'balanced', label: '平稳' },
  { value: 'aggressive', label: '激进' }
];

export const ACTIVITY_PAY_MAX_BY_SCENARIO: Record<StapleScenario, number> = {
  single: 40,
  double: 80,
  multi: 150
};

export const ACTIVITY_MIN_NET_PAY = 2;

export const DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS: ComboRangeSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: ''
};
