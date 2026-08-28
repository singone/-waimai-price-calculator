import { profitRateByBasis, roundMoney } from './money';

export type BusinessSubsidyInput = {
  totalSubsidy: number;
  merchantSubsidy: number;
  platformSubsidy: number;
};

export type MerchantIncomeInput = {
  grossSales: number;
  merchantActivityCost: number;
  commission: number;
  deliveryServiceFee: number;
  otherExpense?: number;
};

export type ActivityAmountInput = {
  productDiscount?: number;
  fullReduction?: number;
  couponAmount?: number;
  baseRedAmount?: number;
  redAddOnAmount?: number;
  freightSubsidy?: number;
};

/**
 * 计算经营日报中的商品口径优惠前金额，不包含顾客配送费。
 */
export function goodsOriginalTotal(productOriginal: number, packageFee: number) {
  return roundMoney(Math.max(0, Number(productOriginal) || 0) + Math.max(0, Number(packageFee) || 0));
}

/**
 * 计算订单明细中的订单口径原价，包含顾客配送费。
 */
export function orderOriginalTotal(productOriginal: number, packageFee: number, deliveryFee: number) {
  return roundMoney(goodsOriginalTotal(productOriginal, packageFee) + Math.max(0, Number(deliveryFee) || 0));
}

/**
 * 还原除商家和平台外的补贴承担方，例如代理商补贴。
 */
export function otherSubsidyAmount(input: BusinessSubsidyInput) {
  return roundMoney(
    (Number(input.totalSubsidy) || 0)
    - (Number(input.merchantSubsidy) || 0)
    - (Number(input.platformSubsidy) || 0)
  );
}

/**
 * 按指定分母计算让利率，分母可以是商品口径或订单口径。
 */
export function subsidyRate(totalSubsidy: number, basis: number) {
  return profitRateByBasis(Math.max(0, Number(totalSubsidy) || 0), Math.max(0, Number(basis) || 0));
}

/**
 * 按经营日报口径复算营业收入，利润应在此基础上再扣商品成本。
 */
export function merchantIncomeByBusinessFormula(input: MerchantIncomeInput) {
  return roundMoney(
    (Number(input.grossSales) || 0)
    - (Number(input.merchantActivityCost) || 0)
    - (Number(input.commission) || 0)
    - (Number(input.deliveryServiceFee) || 0)
    - (Number(input.otherExpense) || 0)
  );
}

/**
 * 计算商家活动支出率，分母可选择优惠前总额或营业收入。
 */
export function merchantActivityCostRate(merchantActivityCost: number, basis: number) {
  return profitRateByBasis(Number(merchantActivityCost) || 0, Number(basis) || 0);
}

/**
 * 统一测算侧的商家活动金额，包含减配送费等商家承担项。
 */
export function activityAmountByBusinessFormula(input: ActivityAmountInput) {
  return roundMoney(
    (Number(input.productDiscount) || 0)
    + (Number(input.fullReduction) || 0)
    + (Number(input.couponAmount) || 0)
    + (Number(input.baseRedAmount) || 0)
    + (Number(input.redAddOnAmount) || 0)
    + (Number(input.freightSubsidy) || 0)
  );
}
