import { roundMoney } from '../../domain/money';
import { PlatformUtils } from '../../domain/platform';
import type { Platform, Product, ProductBundleChoiceGroup, ProductBundleItem, Severity } from '../../domain/types';

export type BundlePriceCheckPlatformFilter = Platform | 'all';
export type BundleCostSyncMode = 'average' | 'max';

export type BundlePriceCheckRow = {
  key: string;
  productId: string;
  productName: string;
  platform: Platform;
  platformName: string;
  invalidItemCount: number;
  choiceShortageCount: number;
  missingCostCount: number;
  productCost: number;
  setMealPrice: number;
  componentMinTotal: number | null;
  componentAverageTotal: number | null;
  componentMaxTotal: number | null;
  componentMinCostTotal: number | null;
  componentAverageCostTotal: number | null;
  componentMaxCostTotal: number | null;
  discountAmount: number | null;
  discountRate: number | null;
  profitAtMaxCost: number | null;
  severity: Severity;
  reasons: string[];
  compositionText: string;
};

type BundleComponentValue = {
  label: string;
  price: number;
  cost: number;
  missingCost: boolean;
};

type BundleCompositionSummary = {
  configuredItemCount: number;
  validComponentCount: number;
  invalidItemCount: number;
  choiceShortageCount: number;
  missingCostCount: number;
  componentMinTotal: number;
  componentAverageTotal: number;
  componentMaxTotal: number;
  componentMinCostTotal: number;
  componentAverageCostTotal: number;
  componentMaxCostTotal: number;
  compositionText: string;
};

const BUNDLE_PRICE_GAP = 0.01;
const TOO_DEEP_DISCOUNT_RATE = 0.35;
const TOO_SHALLOW_DISCOUNT_RATE = 0.03;
const SEVERITY_WEIGHT: Record<Severity, number> = {
  none: 0,
  config: 1,
  medium: 2,
  high: 3,
  critical: 4
};

function normalizedQty(item: ProductBundleItem) {
  return Math.max(1, Math.floor(Number(item.qty) || 1));
}

function normalizedSelectionQty(group: ProductBundleChoiceGroup) {
  return Math.max(1, Math.floor(Number(group.selectionQty) || 1));
}

function sumValues(values: BundleComponentValue[], field: 'price' | 'cost') {
  return roundMoney(values.reduce((sum, value) => sum + value[field], 0));
}

function averageValue(values: BundleComponentValue[], field: 'price' | 'cost', count: number) {
  if (!values.length || count <= 0) return 0;
  return roundMoney((values.reduce((sum, value) => sum + value[field], 0) / values.length) * count);
}

function resolveBundleComponent(
  productsById: Map<string, Product>,
  item: ProductBundleItem,
  platform: Platform
): BundleComponentValue | null {
  const product = productsById.get(item.productId);
  if (!product) return null;
  const qty = normalizedQty(item);
  const unitCost = Math.max(0, Number(product.cost) || 0);
  return {
    label: `${product.name || '未命名商品'}×${qty}`,
    price: roundMoney(PlatformUtils.originalUnitPrice(product, platform) * qty),
    cost: roundMoney(unitCost * qty),
    missingCost: unitCost <= 0
  };
}

function sortedSlice(values: BundleComponentValue[], field: 'price' | 'cost', count: number, desc = false) {
  const sorted = [...values].sort((a, b) => desc ? b[field] - a[field] : a[field] - b[field]);
  return sorted.slice(0, count);
}

function summarizeBundleComposition(product: Product, productsById: Map<string, Product>, platform: Platform): BundleCompositionSummary {
  const fixedItems = product.bundleItems || [];
  const choiceGroups = product.bundleChoiceGroups || [];
  const summary: BundleCompositionSummary = {
    configuredItemCount: fixedItems.length + choiceGroups.reduce((sum, group) => sum + group.items.length, 0),
    validComponentCount: 0,
    invalidItemCount: 0,
    choiceShortageCount: 0,
    missingCostCount: 0,
    componentMinTotal: 0,
    componentAverageTotal: 0,
    componentMaxTotal: 0,
    componentMinCostTotal: 0,
    componentAverageCostTotal: 0,
    componentMaxCostTotal: 0,
    compositionText: ''
  };
  const textParts: string[] = [];

  if (fixedItems.length) {
    const fixedTextParts: string[] = [];
    fixedItems.forEach(item => {
      const component = resolveBundleComponent(productsById, item, platform);
      if (!component) {
        summary.invalidItemCount++;
        fixedTextParts.push(`失效商品×${normalizedQty(item)}`);
        return;
      }
      summary.validComponentCount++;
      if (component.missingCost) summary.missingCostCount++;
      summary.componentMinTotal = roundMoney(summary.componentMinTotal + component.price);
      summary.componentAverageTotal = roundMoney(summary.componentAverageTotal + component.price);
      summary.componentMaxTotal = roundMoney(summary.componentMaxTotal + component.price);
      summary.componentMinCostTotal = roundMoney(summary.componentMinCostTotal + component.cost);
      summary.componentAverageCostTotal = roundMoney(summary.componentAverageCostTotal + component.cost);
      summary.componentMaxCostTotal = roundMoney(summary.componentMaxCostTotal + component.cost);
      fixedTextParts.push(component.label);
    });
    textParts.push(`固定：${fixedTextParts.join('、')}`);
  }

  choiceGroups.forEach(group => {
    const selectionQty = normalizedSelectionQty(group);
    const optionValues: BundleComponentValue[] = [];
    const optionLabels: string[] = [];
    group.items.forEach(item => {
      const component = resolveBundleComponent(productsById, item, platform);
      if (!component) {
        summary.invalidItemCount++;
        optionLabels.push(`失效商品×${normalizedQty(item)}`);
        return;
      }
      if (component.missingCost) summary.missingCostCount++;
      optionValues.push(component);
      optionLabels.push(component.label);
    });

    if (optionValues.length < selectionQty) {
      summary.choiceShortageCount += selectionQty - optionValues.length;
    }
    const pickedCount = Math.min(selectionQty, optionValues.length);
    if (pickedCount > 0) {
      summary.validComponentCount += pickedCount;
      summary.componentMinTotal = roundMoney(summary.componentMinTotal + sumValues(sortedSlice(optionValues, 'price', pickedCount), 'price'));
      summary.componentAverageTotal = roundMoney(summary.componentAverageTotal + averageValue(optionValues, 'price', pickedCount));
      summary.componentMaxTotal = roundMoney(summary.componentMaxTotal + sumValues(sortedSlice(optionValues, 'price', pickedCount, true), 'price'));
      summary.componentMinCostTotal = roundMoney(summary.componentMinCostTotal + sumValues(sortedSlice(optionValues, 'cost', pickedCount), 'cost'));
      summary.componentAverageCostTotal = roundMoney(summary.componentAverageCostTotal + averageValue(optionValues, 'cost', pickedCount));
      summary.componentMaxCostTotal = roundMoney(summary.componentMaxCostTotal + sumValues(sortedSlice(optionValues, 'cost', pickedCount, true), 'cost'));
    }
    textParts.push(`${group.name || '任选组'}任选${selectionQty}：${optionLabels.length ? optionLabels.join(' / ') : '未配置可选商品'}`);
  });

  summary.compositionText = textParts.join('；');
  return summary;
}

function bundlePriceCheckReasons(summary: BundleCompositionSummary, setMealPrice: number, discountRate: number | null, profitAtMaxCost: number | null) {
  const reasons: string[] = [];
  if (!summary.configuredItemCount) reasons.push('套餐未配置组成');
  else if (!summary.validComponentCount) reasons.push('套餐组成没有有效商品');
  if (summary.invalidItemCount) reasons.push(`有 ${summary.invalidItemCount} 个组成商品失效`);
  if (summary.choiceShortageCount) reasons.push(`任选组少 ${summary.choiceShortageCount} 个可选项`);
  if (summary.missingCostCount) reasons.push(`有 ${summary.missingCostCount} 个组成商品缺成本`);
  if (setMealPrice <= BUNDLE_PRICE_GAP) reasons.push('套餐总价为 0');
  if (profitAtMaxCost !== null && profitAtMaxCost <= BUNDLE_PRICE_GAP) reasons.push('按最高成本组合测算不覆盖成本');
  if (summary.validComponentCount > 0 && setMealPrice > summary.componentAverageTotal + BUNDLE_PRICE_GAP) {
    reasons.push('套餐总价高于单品均值合计');
  }
  if (discountRate !== null && discountRate > TOO_DEEP_DISCOUNT_RATE) reasons.push('折扣过深，需复核毛利');
  if (discountRate !== null && discountRate >= 0 && discountRate < TOO_SHALLOW_DISCOUNT_RATE) reasons.push('套餐优惠感偏弱');
  return reasons.length ? reasons : ['套餐折扣在合理区间'];
}

function bundlePriceCheckSeverity(summary: BundleCompositionSummary, setMealPrice: number, discountRate: number | null, profitAtMaxCost: number | null): Severity {
  if (setMealPrice <= BUNDLE_PRICE_GAP || (profitAtMaxCost !== null && profitAtMaxCost <= BUNDLE_PRICE_GAP)) return 'critical';
  if (summary.validComponentCount > 0 && setMealPrice > summary.componentAverageTotal + BUNDLE_PRICE_GAP) return 'high';
  if (discountRate !== null && discountRate > TOO_DEEP_DISCOUNT_RATE) return 'high';
  if (!summary.configuredItemCount || !summary.validComponentCount || summary.invalidItemCount || summary.choiceShortageCount || summary.missingCostCount) return 'config';
  if (discountRate !== null && discountRate >= 0 && discountRate < TOO_SHALLOW_DISCOUNT_RATE) return 'medium';
  return 'none';
}

export function buildBundlePriceCheckRows(products: Product[], platformFilter: BundlePriceCheckPlatformFilter): BundlePriceCheckRow[] {
  const productsById = new Map(products.map(product => [product.id, product]));
  const platforms = platformFilter === 'all' ? PlatformUtils.ALL_PLATFORMS : [platformFilter];
  const rows: BundlePriceCheckRow[] = [];

  products.forEach(product => {
    if (product.category !== 'setMeal') return;
    platforms.forEach(platform => {
      if (!PlatformUtils.isListed(product, platform)) return;
      const summary = summarizeBundleComposition(product, productsById, platform);
      const setMealPrice = PlatformUtils.originalUnitPrice(product, platform);
      const componentMinTotal = summary.validComponentCount > 0 ? summary.componentMinTotal : null;
      const componentAverageTotal = summary.validComponentCount > 0 ? summary.componentAverageTotal : null;
      const componentMaxTotal = summary.validComponentCount > 0 ? summary.componentMaxTotal : null;
      const componentMinCostTotal = summary.validComponentCount > 0 ? summary.componentMinCostTotal : null;
      const componentAverageCostTotal = summary.validComponentCount > 0 ? summary.componentAverageCostTotal : null;
      const componentMaxCostTotal = summary.validComponentCount > 0 ? summary.componentMaxCostTotal : null;
      const discountAmount = componentAverageTotal === null ? null : roundMoney(componentAverageTotal - setMealPrice);
      const discountRate = componentAverageTotal && componentAverageTotal > 0 && discountAmount !== null
        ? discountAmount / componentAverageTotal
        : null;
      const profitAtMaxCost = componentMaxCostTotal === null ? null : roundMoney(setMealPrice - componentMaxCostTotal);
      rows.push({
        key: `${product.id}-${platform}`,
        productId: product.id,
        productName: product.name,
        platform,
        platformName: PlatformUtils.NAMES[platform],
        invalidItemCount: summary.invalidItemCount,
        choiceShortageCount: summary.choiceShortageCount,
        missingCostCount: summary.missingCostCount,
        productCost: Math.max(0, Number(product.cost) || 0),
        setMealPrice,
        componentMinTotal,
        componentAverageTotal,
        componentMaxTotal,
        componentMinCostTotal,
        componentAverageCostTotal,
        componentMaxCostTotal,
        discountAmount,
        discountRate,
        profitAtMaxCost,
        severity: bundlePriceCheckSeverity(summary, setMealPrice, discountRate, profitAtMaxCost),
        reasons: bundlePriceCheckReasons(summary, setMealPrice, discountRate, profitAtMaxCost),
        compositionText: summary.compositionText || '未配置组成'
      });
    });
  });

  return rows.sort((a, b) => (
    SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity] ||
    (a.discountRate ?? 0) - (b.discountRate ?? 0) ||
    a.productName.localeCompare(b.productName, 'zh-CN')
  ));
}

export function bundleCostTotalByMode(row: BundlePriceCheckRow, mode: BundleCostSyncMode) {
  return mode === 'average' ? row.componentAverageCostTotal : row.componentMaxCostTotal;
}
