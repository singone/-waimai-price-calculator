export const PLATFORM_FEE_FIELDS = [
  ['commissionRate', '佣金率（%）'], ['minCommission', '保底佣金（元/单）'],
  ['baseDeliveryFee', '3 公里内履约费（元）'], ['extraDeliveryFee', '超 3 公里每 0.1 公里（元）'],
  ['midPriceRate', '20–25 元每增 1 元履约加价'], ['highPriceRate', '超过 25 元每增 1 元履约加价'],
  ['freightWithin3', '3 公里内商家减配成本（元）'], ['freightWithin5', '3–5 公里商家减配成本（元）'],
  ['freightAbove5', '超过 5 公里商家减配成本（元）'], ['timeFeeOverride', '本次测算时段附加费（元）']
] as const;
export type PlatformFeeField = typeof PLATFORM_FEE_FIELDS[number][0];
