import type { ComboEvaluationRow, ComboItem, RiskInfo } from '../../domain/types';

export function itemsText(items: ComboItem[]) {
  return items.map(item => `${item.name}x${item.qty}`).join(' + ');
}

export function comboPackageFeeTotal(items: ComboItem[]) {
  return items.reduce((sum, item) => sum + item.packageFee * item.qty, 0);
}

export function paymentGrossRate(row: Pick<ComboEvaluationRow, 'finalPay' | 'cost'>) {
  const finalPay = Number(row.finalPay) || 0;
  if (finalPay <= 0) return null;
  return (finalPay - (Number(row.cost) || 0)) / finalPay;
}

export function riskLabel(risk?: RiskInfo) {
  return { critical: '严重', high: '高', medium: '中', config: '配置', none: '正常' }[risk?.severity || 'none'];
}

export function riskColor(risk?: RiskInfo) {
  return { critical: 'red', high: 'orange', medium: 'gold', config: 'purple', none: 'green' }[risk?.severity || 'none'];
}
