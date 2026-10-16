import type { Activities } from '../types';

export const COUPON_CHANNELS = [
  { value: 'inStore', label: '店内领券' }, { value: 'orderReturn', label: '下单返券' },
  { value: 'reviewReturn', label: '评价返券' }, { value: 'pointsReturn', label: '积分兑换' },
  { value: 'targeted', label: '定向发券' }
] as const;
export const COUPON_TARGETS = [
  { value: 'all', label: '全部顾客' }, { value: 'newCustomer', label: '新客' },
  { value: 'highFrequency', label: '高频老客' }, { value: 'highAov', label: '高客单顾客' },
  { value: 'lostCustomer', label: '流失顾客' }, { value: 'specified', label: '指定人群' }
] as const;

/** 保存和后台导入共用校验，不从活动名称推断资格或分摊。 */
export function activityConfigurationErrors(activities: Activities): string[] {
  const errors: string[] = [];
  const validMoney = (value: number) => Number.isFinite(value) && value >= 0;
  for (const [label, rows] of [['满减', activities.fullReductions], ['订单券', activities.coupons], ['红包加码', activities.redAddOns]] as const) {
    rows.forEach((row, index) => {
      if (!validMoney(row.threshold) || !validMoney(row.amount)) errors.push(`${label}第${index + 1}项：门槛和金额须为非负数。`);
      if (label === '满减' && row.amount > row.threshold) errors.push(`满减第${index + 1}项：减额不能超过门槛。`);
    });
  }
  activities.discountActivities.forEach((row, index) => {
    if (!Number.isFinite(row.discountRate) || row.discountRate <= 0 || row.discountRate > 10) errors.push(`商品折扣第${index + 1}项：折扣须大于0且不超过10折。`);
    if (row.itemLimit !== '' && (!Number.isInteger(row.itemLimit) || row.itemLimit < 0)) errors.push(`商品折扣第${index + 1}项：件数须为非负整数，留空表示不限。`);
  });
  activities.jingdongSubsidyCoupons.forEach((row, index) => {
    if (![row.threshold, row.amount, row.merchantAmount, row.platformAmount, row.merchantExtraAmount].every(validMoney)) errors.push(`京东补贴券第${index + 1}项：金额须为非负数。`);
    if (Math.abs(row.amount - row.merchantAmount - row.platformAmount) > 0.01) errors.push(`京东补贴券第${index + 1}项：券面额须等于商家承担与平台承担之和，加码单列。`);
    if (row.kind === 'small' && row.merchantExtraAmount !== 0) errors.push(`京东小额券第${index + 1}项：当前模型不支持小额券加码，请核对后填写。`);
  });
  return errors;
}
