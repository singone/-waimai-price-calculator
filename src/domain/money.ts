export function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function ceilMoneyStep(value: number, step = 0.1) {
  return roundMoney(Math.ceil((Number(value) || 0) / step - 1e-9) * step);
}

export function priceEndingNineCeil(value: number) {
  const normalized = Math.max(0, Number(value) || 0);
  const floor = Math.floor(normalized);
  const candidate = roundMoney(floor + 0.9);
  return candidate + 1e-9 >= normalized ? candidate : roundMoney(floor + 1.9);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function average(values: Array<number | null | undefined>) {
  const valid = values.filter((value): value is number => Number.isFinite(value));
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

export function profitRateByBasis(profit: number, basis: number) {
  return basis > 0 ? profit / basis : profit < 0 ? -1 : null;
}

export function normalizeDiscountRate(value: unknown) {
  const n = Number(value) || 1;
  if (n > 10) return n / 100;
  if (n > 1) return n / 10;
  return n;
}
