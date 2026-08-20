import type { ActivityOriginalDiscountTier, Severity } from '../domain/types';

export function money(value: unknown) {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

export function rateText(rate: number | null | undefined) {
  return Number.isFinite(rate) ? `${((rate as number) * 100).toFixed(2)}%` : '无法计算';
}

export function dateTimeText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function severityLabel(severity: Severity) {
  return { critical: '严重', high: '高', medium: '中', config: '配置', none: '正常' }[severity];
}

export function severityColor(severity: Severity) {
  return { critical: 'red', high: 'orange', medium: 'gold', config: 'purple', none: 'green' }[severity];
}

export function severityRank(severity: Severity) {
  return { none: 0, config: 1, medium: 2, high: 3, critical: 4 }[severity];
}

export function recommendationPriorityColor(priority: Severity) {
  return severityColor(priority);
}

export function recommendationPriorityText(priority: Severity) {
  return severityLabel(priority);
}

export function formatActivityOriginalDiscountTiers(tiers: ActivityOriginalDiscountTier[]) {
  const text = tiers
    .map(tier => `${money(tier.originalMin)}-${tier.originalMax >= 999 ? '∞' : money(tier.originalMax)}:${money(tier.discountRate)}%`)
    .join('，');
  return text || '无覆盖，全部按基准';
}
