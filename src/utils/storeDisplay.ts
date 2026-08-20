import type { Store } from '../domain/types';
import { money } from './format';

export function calculationTotalRange(store: Pick<Store, 'calculationTotalMin' | 'calculationTotalMax'>) {
  const min = Math.max(0, Number(store.calculationTotalMin) || 0);
  const rawMax = store.calculationTotalMax === '' ? Infinity : Math.max(0, Number(store.calculationTotalMax) || 0);
  return { min, max: rawMax === Infinity ? Infinity : Math.max(min, rawMax) };
}

export function calculationRangeText(store: Pick<Store, 'calculationTotalMin' | 'calculationTotalMax'>) {
  const range = calculationTotalRange(store);
  return `¥${money(range.min)}-${range.max === Infinity ? '不限' : `¥${money(range.max)}`}`;
}
