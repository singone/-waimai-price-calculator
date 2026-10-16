import type { PricingPlanKey } from '../types';

export type PricingPlanPreset = {
  key: PricingPlanKey;
  name: string;
  description: string;
  stapleTargetCostShareOffset: number;
  setMealTargetCostShareOffset: number;
  addOnTargetCostShareOffset: number;
  addOnStapleRatioShareOffset: number;
  addOnPromotionRiskShareOffset: number;
  setMealDiscountRateOffset: number;
};

export const PRICING_PLAN_PRESETS: PricingPlanPreset[] = [
  {
    key: 'traffic',
    name: '引流方案',
    description: '允许更高成本占比，降低凑单风险承接，售价更有吸引力。',
    stapleTargetCostShareOffset: 0.06,
    setMealTargetCostShareOffset: 0.06,
    addOnTargetCostShareOffset: 0.06,
    addOnStapleRatioShareOffset: -0.1,
    addOnPromotionRiskShareOffset: -0.1,
    setMealDiscountRateOffset: 0.05
  },
  {
    key: 'balanced',
    name: '均衡方案',
    description: '沿用当前页面参数，按目标成本占比生成建议价。',
    stapleTargetCostShareOffset: 0,
    setMealTargetCostShareOffset: 0,
    addOnTargetCostShareOffset: 0,
    addOnStapleRatioShareOffset: 0,
    addOnPromotionRiskShareOffset: 0,
    setMealDiscountRateOffset: 0
  },
  {
    key: 'profit',
    name: '利润方案',
    description: '要求更低成本占比，提高凑单风险承接，减少套餐让利。',
    stapleTargetCostShareOffset: -0.05,
    setMealTargetCostShareOffset: -0.05,
    addOnTargetCostShareOffset: -0.05,
    addOnStapleRatioShareOffset: 0.1,
    addOnPromotionRiskShareOffset: 0.1,
    setMealDiscountRateOffset: -0.04
  }
];

export const DEFAULT_PRICING_PLAN_KEYS: PricingPlanKey[] = PRICING_PLAN_PRESETS.map(plan => plan.key);
