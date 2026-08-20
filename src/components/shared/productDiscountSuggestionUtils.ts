import { ACTIVITY_MIN_NET_PAY } from '../../config/activity';
import { PRODUCT_CATEGORY_NAMES } from '../../config/products';
import { average, clamp, finiteRate, normalizeDiscountRate, roundMoney } from '../../domain/money';
import type { ComboEvaluationRow, ComboItem, Platform, ProductCategory } from '../../domain/types';
import { itemsText, paymentGrossRate } from './comboDisplayUtils';

export type ProductDiscountSuggestionSource = 'measurementResult' | 'activityValidation';
export type ProductDiscountSuggestionRiskLevel = 'safe' | 'watch' | 'blocked';
export type ProductDiscountSuggestionRole = 'main' | 'addOn' | 'mixed';
export type ProductDiscountSuggestionAction = 'discount' | 'raisePrice' | 'watch' | 'none';

export type ProductDiscountSuggestionViewRow = {
  key: string;
  platformName: string;
  productId: string;
  productName: string;
  category: ProductCategory;
  categoryName: string;
  role: ProductDiscountSuggestionRole;
  actionType: ProductDiscountSuggestionAction;
  actionLabel: string;
  unitPrice: number;
  avgUnitCost: number;
  avgReasonableCost: number;
  reasonablePriceFromCost: number | null;
  avgCostGap: number;
  minCostGap: number | null;
  maxCostGap: number | null;
  discountRate: number;
  discountAmountPerUnit: number;
  affectedComboCount: number;
  opportunityComboCount: number;
  riskComboCount: number;
  riskLevel: ProductDiscountSuggestionRiskLevel;
  reason: string;
} & Record<string, unknown>;

export type ProductDiscountSuggestion = ProductDiscountSuggestionViewRow & {
  source: ProductDiscountSuggestionSource;
  platform: Platform;
  avgAllocatedNetPay: number | null;
  itemLimit: number | '';
  avgPaymentGrossRate: number | null;
  medianPaymentGrossRate: number | null;
  avgNetProfitRate: number | null;
  avgProfitSpace: number;
  minProfitAfterDiscount: number | null;
  minNetPayAfterDiscount: number | null;
  minFinalPayAfterDiscount: number | null;
};

export type BuildProductDiscountSuggestionOptions = {
  source?: ProductDiscountSuggestionSource;
  focusRowKey?: string;
  productId?: string;
  limit?: number;
  includeBlocked?: boolean;
  includeNeutral?: boolean;
  itemLimit?: number | '';
};

const PRODUCT_DISCOUNT_ITEM_LIMIT = 1;
const PRODUCT_DISCOUNT_SAFE_PROFIT_BUFFER = 0;
const PRODUCT_DISCOUNT_FINAL_PAY_FLOOR = 2;

export function productDiscountActivityName(suggestion: ProductDiscountSuggestion) {
  return `折扣修正-${suggestion.productName}`;
}

function money(value: unknown) {
  return roundMoney(value).toFixed(2);
}

function productCategoryName(category: ProductCategory) {
  return PRODUCT_CATEGORY_NAMES[category] || PRODUCT_CATEGORY_NAMES.other;
}

function productDiscountSourceName(source: ProductDiscountSuggestionSource) {
  if (source === 'activityValidation') return '支付价核验';
  return '测算结果';
}

function productDiscountActionLabel(action: ProductDiscountSuggestionAction) {
  if (action === 'discount') return '可降价';
  if (action === 'raisePrice') return '需涨价/规避';
  if (action === 'watch') return '检查凑单风险';
  return '无需处理';
}

function productDiscountRoleLabel(role: ProductDiscountSuggestionRole) {
  if (role === 'main') return '主商品';
  if (role === 'addOn') return '凑单品';
  return '混合';
}

function uniqueComboRows<T extends ComboEvaluationRow>(rows: T[]) {
  const map = new Map<string, T>();
  rows.forEach((row, index) => {
    const key = row.key || `${row.platform}-${index}-${itemsText(row.items)}`;
    if (!map.has(key)) map.set(key, row);
  });
  return Array.from(map.values());
}

function productDiscountEligibleQty(row: ComboEvaluationRow, productId: string, itemLimit: number | '') {
  let qty = 0;
  for (const item of row.items) {
    if (item.productId !== productId) continue;
    qty += Math.max(0, Number(item.qty) || 0);
  }
  if (qty <= 0) return 0;
  if (itemLimit === '') return qty;
  return Math.min(qty, Math.max(0, Number(itemLimit) || 0));
}

function productUnitPriceInRows(rows: ComboEvaluationRow[], productId: string) {
  let maxPrice = 0;
  for (const row of rows) {
    for (const item of row.items) {
      if (item.productId !== productId) continue;
      const price = Number(item.price) || 0;
      if (price > maxPrice) maxPrice = price;
    }
  }
  return maxPrice;
}

function discountRateFromAmount(unitPrice: number, discountAmount: number) {
  if (unitPrice <= 0 || discountAmount <= 0) return 10;
  const rawRate = (1 - Math.min(discountAmount, unitPrice) / unitPrice) * 10;
  return clamp(Math.ceil(rawRate * 10 - 1e-9) / 10, 1, 9.9);
}

function discountAmountFromRate(unitPrice: number, discountRate: number) {
  return roundMoney(unitPrice * (1 - normalizeDiscountRate(discountRate)));
}

function normalizedTargetProfitRate(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const normalized = n > 1 ? n / 100 : n;
  return clamp(normalized, 0, 0.95);
}

function comboReasonableCostLimit(row: ComboEvaluationRow) {
  const candidates: number[] = [];
  const cost = Math.max(0, Number(row.cost) || 0);
  const netPay = Math.max(0, Number(row.netPay) || 0);
  const finalPay = Math.max(0, Number(row.finalPay) || 0);
  const profitSpace = Number(row.profitSpace);
  if (Number.isFinite(profitSpace)) {
    candidates.push(cost + profitSpace);
  }
  const targetNetRate = normalizedTargetProfitRate(row.targetNetRate);
  if (targetNetRate !== null && netPay > 0) {
    candidates.push(netPay * (1 - targetNetRate));
  }
  const targetPayRate = normalizedTargetProfitRate(row.targetPayRate);
  if (targetPayRate !== null && netPay > 0 && finalPay > 0) {
    candidates.push(netPay - finalPay * targetPayRate);
  }
  if (!candidates.length && netPay > 0) candidates.push(netPay);
  const finiteCandidates = candidates.filter(Number.isFinite);
  if (!finiteCandidates.length) return null;
  return roundMoney(Math.max(0, Math.min(...finiteCandidates)));
}

function comboItemUnitCost(item: ComboItem) {
  return Math.max(0, Number(item.cost) || 0);
}

function comboItemOriginalAmount(item: ComboItem) {
  return roundMoney((item.price + item.packageFee) * item.qty);
}

function isAddOnDiscountItem(item: ComboItem) {
  return Boolean(item.nonStandalone)
    || item.category === 'snackDrink'
    || item.category === 'addOn';
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function buildProductDiscountSuggestions(
  rows: ComboEvaluationRow[],
  options: BuildProductDiscountSuggestionOptions = {}
): ProductDiscountSuggestion[] {
  const source = options.source || 'measurementResult';
  const itemLimit = options.itemLimit ?? PRODUCT_DISCOUNT_ITEM_LIMIT;
  const baseRows = uniqueComboRows(rows)
    .filter(row => !row.ignored)
    .filter(row => row.items.length && row.finalPay > 0 && row.netPay > 0);
  if (!baseRows.length) return [];

  const paymentRates = baseRows.map(paymentGrossRate).filter(finiteRate);
  const medianPaymentRate = median(paymentRates);
  type ProductCostAccumulator = {
    productId: string;
    productName: string;
    platform: Platform;
    platformName: string;
    category: ProductCategory;
    roleCounts: Record<ProductDiscountSuggestionRole, number>;
    rowKeys: Set<string>;
    opportunityRowKeys: Set<string>;
    riskRowKeys: Set<string>;
    qtySum: number;
    unitPriceSum: number;
    unitCostSum: number;
    reasonableCostSum: number;
    costGapSum: number;
    allocatedNetPaySum: number;
    allocatedNetPayQty: number;
    profitSpaceSum: number;
    paymentRates: number[];
    netProfitRates: number[];
    minCostGap: number | null;
    maxCostGap: number | null;
  };
  const candidates = new Map<string, ProductCostAccumulator>();
  const analysisRows = options.focusRowKey
    ? baseRows.filter(row => row.key === options.focusRowKey)
    : baseRows;

  const ensureCandidate = (row: ComboEvaluationRow, item: ComboItem, role: ProductDiscountSuggestionRole) => {
    const current = candidates.get(item.productId) || {
      productId: item.productId,
      productName: item.name,
      platform: row.platform,
      platformName: row.platformName,
      category: item.category,
      roleCounts: { main: 0, addOn: 0, mixed: 0 },
      rowKeys: new Set<string>(),
      opportunityRowKeys: new Set<string>(),
      riskRowKeys: new Set<string>(),
      qtySum: 0,
      unitPriceSum: 0,
      unitCostSum: 0,
      reasonableCostSum: 0,
      costGapSum: 0,
      allocatedNetPaySum: 0,
      allocatedNetPayQty: 0,
      profitSpaceSum: 0,
      paymentRates: [],
      netProfitRates: [],
      minCostGap: null,
      maxCostGap: null
    };
    current.roleCounts[role] += 1;
    candidates.set(item.productId, current);
    return current;
  };

  const addContribution = (
    row: ComboEvaluationRow,
    item: ComboItem,
    role: ProductDiscountSuggestionRole,
    reasonableCostPerUnit: number,
    allocatedNetPayPerUnit: number | null
  ) => {
    if (options.productId && item.productId !== options.productId) return;
    const qty = Math.max(0, Number(item.qty) || 0);
    const unitPrice = Math.max(0, Number(item.price) || 0);
    if (qty <= 0 || unitPrice <= 0) return;
    const current = ensureCandidate(row, item, role);
    const unitCost = comboItemUnitCost(item);
    const costGap = roundMoney(reasonableCostPerUnit - unitCost);
    current.rowKeys.add(row.key);
    if (costGap >= 1) current.opportunityRowKeys.add(row.key);
    if (costGap < -0.5) current.riskRowKeys.add(row.key);
    current.qtySum += qty;
    current.unitPriceSum += unitPrice * qty;
    current.unitCostSum += unitCost * qty;
    current.reasonableCostSum += Math.max(0, reasonableCostPerUnit) * qty;
    current.costGapSum += costGap * qty;
    current.profitSpaceSum += (Number.isFinite(Number(row.profitSpace)) ? Number(row.profitSpace) : 0) * qty;
    if (allocatedNetPayPerUnit !== null) {
      current.allocatedNetPaySum += allocatedNetPayPerUnit * qty;
      current.allocatedNetPayQty += qty;
    }
    const paymentRate = paymentGrossRate(row);
    if (paymentRate !== null) current.paymentRates.push(paymentRate);
    if (finiteRate(row.netProfitRate)) current.netProfitRates.push(row.netProfitRate);
    current.minCostGap = current.minCostGap === null ? costGap : Math.min(current.minCostGap, costGap);
    current.maxCostGap = current.maxCostGap === null ? costGap : Math.max(current.maxCostGap, costGap);
  };

  for (const row of analysisRows) {
    const reasonableCostLimit = comboReasonableCostLimit(row);
    if (reasonableCostLimit === null) continue;
    const items = row.items.filter(item => Math.max(0, Number(item.qty) || 0) > 0 && Math.max(0, Number(item.price) || 0) > 0);
    if (!items.length) continue;
    const totalOriginal = Math.max(
      Number(row.originalTotal) || 0,
      items.reduce((sum, item) => sum + comboItemOriginalAmount(item), 0)
    );
    if (totalOriginal <= 0) continue;
    const addOnItems = items.filter(isAddOnDiscountItem);
    const mainItems = items.filter(item => !isAddOnDiscountItem(item));
    const mainOriginal = mainItems.reduce((sum, item) => sum + comboItemOriginalAmount(item), 0);
    const addOnCost = addOnItems.reduce((sum, item) => sum + comboItemUnitCost(item) * Math.max(0, Number(item.qty) || 0), 0);
    const mainReasonableCost = Math.max(0, reasonableCostLimit - addOnCost);

    for (const item of addOnItems) {
      const qty = Math.max(0, Number(item.qty) || 0);
      const allocatedNetPayPerUnit = qty > 0
        ? (row.netPay * (comboItemOriginalAmount(item) / totalOriginal)) / qty
        : 0;
      addContribution(row, item, 'addOn', allocatedNetPayPerUnit, allocatedNetPayPerUnit);
    }

    for (const item of mainItems) {
      const qty = Math.max(0, Number(item.qty) || 0);
      const reasonableCostPerUnit = qty > 0 && mainOriginal > 0
        ? (mainReasonableCost * (comboItemOriginalAmount(item) / mainOriginal)) / qty
        : 0;
      addContribution(row, item, 'main', reasonableCostPerUnit, null);
    }

    if (!mainItems.length && !addOnItems.length) {
      for (const item of items) {
        const qty = Math.max(0, Number(item.qty) || 0);
        const reasonableCostPerUnit = qty > 0
          ? (reasonableCostLimit * (comboItemOriginalAmount(item) / totalOriginal)) / qty
          : 0;
        addContribution(row, item, 'main', reasonableCostPerUnit, null);
      }
    }
  }

  const suggestions = Array.from(candidates.values()).map<ProductDiscountSuggestion | null>(candidate => {
    if (candidate.qtySum <= 0) return null;
    const affectedRows = baseRows.filter(row => row.platform === candidate.platform && row.items.some(item => item.productId === candidate.productId));
    const affectedRowsWithQty = affectedRows
      .map(row => ({ row, qty: productDiscountEligibleQty(row, candidate.productId, itemLimit) }))
      .filter(item => item.qty > 0);
    const unitPrice = candidate.unitPriceSum / candidate.qtySum || productUnitPriceInRows(affectedRows, candidate.productId);
    if (unitPrice <= 0) return null;

    const avgUnitCost = candidate.unitCostSum / candidate.qtySum;
    const avgReasonableCost = candidate.reasonableCostSum / candidate.qtySum;
    const avgCostGap = candidate.costGapSum / candidate.qtySum;
    const avgProfitSpace = candidate.profitSpaceSum / candidate.qtySum;
    const avgAllocatedNetPay = candidate.allocatedNetPayQty > 0
      ? candidate.allocatedNetPaySum / candidate.allocatedNetPayQty
      : null;
    const role: ProductDiscountSuggestionRole = candidate.roleCounts.main > 0 && candidate.roleCounts.addOn > 0
      ? 'mixed'
      : candidate.roleCounts.addOn > 0
        ? 'addOn'
        : 'main';
    const gapForDiscount = roundMoney(Math.max(0, avgCostGap));
    const canDiscount = role !== 'addOn' && gapForDiscount >= 1;
    const hasCostRisk = candidate.riskRowKeys.size > 0 || avgCostGap < -0.5;
    const actionType: ProductDiscountSuggestionAction = canDiscount
      ? 'discount'
      : hasCostRisk
        ? (role === 'addOn' ? 'watch' : 'raisePrice')
        : 'none';
    const riskLevel: ProductDiscountSuggestionRiskLevel = actionType === 'raisePrice'
      ? 'blocked'
      : actionType === 'watch' || (actionType === 'discount' && candidate.riskRowKeys.size > 0)
        ? 'watch'
        : 'safe';
    const cappedAmount = actionType === 'discount'
      ? Math.min(gapForDiscount, unitPrice * 0.25, 5)
      : 0;
    const discountRate = cappedAmount >= 1
      ? discountRateFromAmount(unitPrice, cappedAmount)
      : 10;
    const discountAmountPerUnit = cappedAmount >= 1
      ? discountAmountFromRate(unitPrice, discountRate)
      : 0;

    const afterRows = actionType === 'discount'
      ? affectedRowsWithQty.map(({ row, qty }) => {
        const discountAmount = discountAmountPerUnit * qty;
        return {
          profit: roundMoney(row.profit - discountAmount),
          netPay: roundMoney(row.netPay - discountAmount),
          finalPay: roundMoney(row.finalPay - discountAmount)
        };
      })
      : [];
    const minProfitAfterDiscount = afterRows.length ? Math.min(...afterRows.map(row => row.profit)) : null;
    const minNetPayAfterDiscount = afterRows.length ? Math.min(...afterRows.map(row => row.netPay)) : null;
    const minFinalPayAfterDiscount = afterRows.length ? Math.min(...afterRows.map(row => row.finalPay)) : null;
    const finalRiskLevel: ProductDiscountSuggestionRiskLevel = actionType === 'discount' && (
      (minProfitAfterDiscount ?? 0) + 1e-9 < PRODUCT_DISCOUNT_SAFE_PROFIT_BUFFER ||
      (minNetPayAfterDiscount ?? 0) + 1e-9 < ACTIVITY_MIN_NET_PAY ||
      (minFinalPayAfterDiscount ?? 0) + 1e-9 < PRODUCT_DISCOUNT_FINAL_PAY_FLOOR
    )
      ? 'watch'
      : riskLevel;
    const actionLabel = productDiscountActionLabel(actionType);
    const roleLabel = productDiscountRoleLabel(role);
    const reason = actionType === 'discount'
      ? `${productDiscountSourceName(source)}按商品维度反推活动合理成本：${roleLabel}当前成本 ¥${money(avgUnitCost)}，活动合理成本 ¥${money(avgReasonableCost)}，单件空间 ¥${money(avgCostGap)}；建议按商品维度给 ¥${money(discountAmountPerUnit)} 左右折扣。`
      : actionType === 'raisePrice'
        ? `${productDiscountSourceName(source)}按商品维度反推活动合理成本：当前成本 ¥${money(avgUnitCost)} 高于活动合理成本 ¥${money(avgReasonableCost)}，平均缺口 ¥${money(Math.abs(avgCostGap))}；不建议继续做商品折扣，优先涨价、收紧活动或排除该商品。`
        : actionType === 'watch'
          ? `${productDiscountSourceName(source)}按凑单品分摊到手校验：分摊到手均值 ¥${money(avgAllocatedNetPay ?? avgReasonableCost)}，当前成本 ¥${money(avgUnitCost)}，有 ${candidate.riskRowKeys.size} 个组合可能打穿，建议查看具体亏损组合。`
          : `${productDiscountSourceName(source)}按商品维度反推活动合理成本：当前成本 ¥${money(avgUnitCost)}，活动合理成本 ¥${money(avgReasonableCost)}，合理空间 ¥${money(avgCostGap)}；暂不需要商品折扣或调价处理。`;
    const suggestion: ProductDiscountSuggestion = {
      key: `${source}-${candidate.platform}-${candidate.productId}-${actionType}`,
      source,
      platform: candidate.platform,
      platformName: candidate.platformName,
      productId: candidate.productId,
      productName: candidate.productName,
      category: candidate.category,
      categoryName: productCategoryName(candidate.category),
      role,
      actionType,
      actionLabel,
      unitPrice: roundMoney(unitPrice),
      avgUnitCost: roundMoney(avgUnitCost),
      avgReasonableCost: roundMoney(avgReasonableCost),
      reasonablePriceFromCost: avgReasonableCost > 1e-9 ? roundMoney(unitPrice * (avgUnitCost / avgReasonableCost)) : null,
      avgCostGap: roundMoney(avgCostGap),
      minCostGap: candidate.minCostGap,
      maxCostGap: candidate.maxCostGap,
      avgAllocatedNetPay: avgAllocatedNetPay === null ? null : roundMoney(avgAllocatedNetPay),
      discountRate,
      discountAmountPerUnit,
      itemLimit,
      affectedComboCount: candidate.rowKeys.size,
      opportunityComboCount: candidate.opportunityRowKeys.size,
      riskComboCount: candidate.riskRowKeys.size,
      avgPaymentGrossRate: average(candidate.paymentRates),
      medianPaymentGrossRate: medianPaymentRate,
      avgNetProfitRate: average(candidate.netProfitRates),
      avgProfitSpace: roundMoney(avgProfitSpace),
      minProfitAfterDiscount,
      minNetPayAfterDiscount,
      minFinalPayAfterDiscount,
      riskLevel: finalRiskLevel,
      reason
    };
    return suggestion;
  }).filter((item): item is ProductDiscountSuggestion => Boolean(item));

  return suggestions
    .filter(item => options.includeBlocked !== false || item.riskLevel !== 'blocked')
    .filter(item => options.includeNeutral || options.productId || item.actionType !== 'none')
    .sort((a, b) => {
      const actionOrder: Record<ProductDiscountSuggestionAction, number> = { raisePrice: 0, discount: 1, watch: 2, none: 3 };
      return actionOrder[a.actionType] - actionOrder[b.actionType]
        || b.riskComboCount - a.riskComboCount
        || b.opportunityComboCount - a.opportunityComboCount
        || b.affectedComboCount - a.affectedComboCount
        || Math.abs(b.avgCostGap) - Math.abs(a.avgCostGap)
        || a.discountRate - b.discountRate;
    })
    .slice(0, options.limit ?? 50);
}

