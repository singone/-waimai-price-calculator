import type {
  CalculatorState,
  CalculationLimits,
  Platform,
  PricingEvaluationResult,
  PricingEvaluationRule,
  PricingEvaluationSettings,
  Product,
  ProductCategory,
  Severity
} from '../types';
import {
  calculationNow,
  currentStoreFrom,
  isMealMainProduct,
  isProductListedOnPlatform,
  normalizeCalculationMaxDuration,
  platformOriginalUnitPrice,
  platformPackageFee,
  platformPrice,
  PLATFORM_NAMES,
  PLATFORMS,
  pricingScenarioForStapleCount,
  stapleScenarioName
} from '../core';
import { priceEndingNineCeil, roundMoney } from '../money';

function categoryName(category: ProductCategory) {
  return {
    staple: '主食',
    snackDrink: '小吃饮料',
    addOn: '加料',
    setMeal: '套餐',
    other: '其他'
  }[category] || '其他';
}

function productCategoryTargetRate(product: Product, rule: PricingEvaluationRule) {
  const rate = product.category === 'addOn'
    ? rule.addOnTargetProfitRate
    : product.category === 'staple'
      ? rule.riceBallTargetProfitRate
      : product.category === 'setMeal'
        ? rule.setMealTargetProfitRate
        : rule.fallbackTargetProfitRate;
  return Math.max(0, Number(rate) || 0) / 100;
}

function scenarioTargetRate(product: Product, rule: PricingEvaluationRule) {
  const stapleCount = Math.max(0, Math.floor(Number(product.stapleServingCount) || 0));
  if (stapleCount === 1) return Math.max(0, Number(rule.singleStapleTargetProfitRate) || 0) / 100;
  if (stapleCount === 2) return Math.max(0, Number(rule.doubleStapleTargetProfitRate) || 0) / 100;
  if (stapleCount >= 3) return Math.max(0, Number(rule.multiStapleTargetProfitRate) || 0) / 100;
  return 0;
}

function targetRateForProduct(product: Product, rule: PricingEvaluationRule) {
  return Math.min(0.95, Math.max(
    productCategoryTargetRate(product, rule),
    scenarioTargetRate(product, rule)
  ));
}

function shouldApplyFixedCostAllocation(product: Product) {
  return isMealMainProduct(product);
}

function maxSeverity(a: Severity, b: Severity): Severity {
  const rank = { none: 0, config: 1, medium: 2, high: 3, critical: 4 };
  return rank[b] > rank[a] ? b : a;
}

function severityForPrice(currentProfit: number, currentProfitRate: number | null, targetRate: number, profitSpace: number) {
  const reasons: string[] = [];
  let severity: Severity = 'none';
  if (currentProfit < 0) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('当前销售价低于基础成本');
  }
  if (currentProfitRate === null) {
    severity = maxSeverity(severity, 'config');
    reasons.push('当前价格无法计算利润率');
  } else if (currentProfitRate + 1e-9 < targetRate) {
    severity = maxSeverity(severity, 'high');
    reasons.push('低于目标利润率');
  } else if (currentProfitRate - targetRate > 0.12) {
    severity = maxSeverity(severity, 'medium');
    reasons.push('明显高于目标，可释放活动空间');
  }
  if (profitSpace < -1e-9) {
    severity = maxSeverity(severity, 'high');
    reasons.push('目标利润率下定价空间不足');
  }
  if (!reasons.length) reasons.push('当前定价符合目标');
  return { severity, reasons };
}

function isInOriginalRange(settings: PricingEvaluationSettings, originalPrice: number) {
  const min = Math.max(0, Number(settings.originalMin) || 0);
  const max = settings.originalMax === '' ? Infinity : Math.max(min, Number(settings.originalMax) || 0);
  return originalPrice + 1e-9 >= min && originalPrice <= max + 1e-9;
}

export async function runPricingEvaluationCalculation(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: PricingEvaluationSettings,
  limits?: CalculationLimits
): Promise<PricingEvaluationResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeCalculationMaxDuration(limits?.maxDurationMs);
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');

  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const keyword = String(settings.productNameKeyword || '').trim().toLowerCase();
  const configuredFixedCostAllocation = Math.max(0, Number(settings.fixedCostAllocation) || 0);
  const rule = state.platformRules.pricingEvaluation;
  const productRows = [];
  let checked = 0;
  let stoppedByDuration = false;

  platformLoop:
  for (const platform of platforms) {
    for (const product of store.products) {
      if (calculationNow() - startedAt >= maxDurationMs) {
        stoppedByDuration = true;
        break platformLoop;
      }
      if (!isProductListedOnPlatform(product, platform)) continue;
      if (keyword && !product.name.toLowerCase().includes(keyword)) continue;
      const currentOriginalPrice = platformOriginalUnitPrice(product, platform);
      if (!isInOriginalRange(settings, currentOriginalPrice)) continue;
      checked++;
      const productCost = Math.max(0, Number(product.cost) || 0);
      const packageFee = platformPackageFee(product, platform);
      const currentPrice = platformPrice(product, platform);
      const fixedCostAllocation = shouldApplyFixedCostAllocation(product) ? configuredFixedCostAllocation : 0;
      const baseCost = roundMoney(productCost + fixedCostAllocation);
      const targetProfitRate = targetRateForProduct(product, rule);
      const targetOriginalPrice = targetProfitRate >= 1
        ? currentOriginalPrice
        : priceEndingNineCeil(baseCost / Math.max(0.01, 1 - targetProfitRate));
      const suggestedPrice = Math.max(0, roundMoney(targetOriginalPrice - packageFee));
      const suggestedOriginalPrice = roundMoney(suggestedPrice + packageFee);
      const currentProfit = roundMoney(currentOriginalPrice - baseCost);
      const currentProfitRate = currentOriginalPrice > 0 ? currentProfit / currentOriginalPrice : currentProfit < 0 ? -1 : null;
      const suggestedIncrease = roundMoney(suggestedPrice - currentPrice);
      const profitSpace = roundMoney(currentOriginalPrice - baseCost / Math.max(0.01, 1 - targetProfitRate));
      const severity = severityForPrice(currentProfit, currentProfitRate, targetProfitRate, profitSpace);
      const scenario = pricingScenarioForStapleCount(product.stapleServingCount);
      productRows.push({
        key: `${platform}:${product.id}`,
        platform,
        platformName: PLATFORM_NAMES[platform],
        productId: product.id,
        productName: product.name,
        category: product.category,
        categoryName: categoryName(product.category),
        scenario,
        scenarioName: stapleScenarioName(scenario),
        currentPrice,
        packageFee,
        currentOriginalPrice,
        productCost,
        fixedCostAllocation,
        baseCost,
        targetProfitRate,
        currentProfit,
        currentProfitRate,
        targetOriginalPrice,
        suggestedPrice,
        suggestedOriginalPrice,
        suggestedIncrease,
        suggestedIncreaseRate: currentPrice > 0 ? suggestedIncrease / currentPrice : null,
        profitSpace,
        ...severity
      });
    }
  }

  if (keyword && !productRows.length) warnings.push(`当前门店没有匹配「${settings.productNameKeyword.trim()}」的商品。`);
  if (stoppedByDuration) warnings.push(`已达到最长计算时间 ${Math.round(maxDurationMs / 1000)} 秒，已停止继续评估。`);

  productRows.sort((a, b) => {
    const rank = { none: 0, config: 1, medium: 2, high: 3, critical: 4 };
    return rank[b.severity] - rank[a.severity] || a.platformName.localeCompare(b.platformName, 'zh-CN') || a.productName.localeCompare(b.productName, 'zh-CN');
  });

  return {
    productRows,
    warnings,
    summary: {
      resultCount: productRows.length,
      comboCount: checked,
      validComboCount: productRows.length,
      elapsedTime: Math.round(calculationNow() - startedAt)
    }
  };
}
