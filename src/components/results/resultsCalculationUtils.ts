'use client';

import { createBrowserDataRepository } from '../../data/browserDataRepository';
import type {
  MeasurementPersistenceMeta,
  PersistedActivityPriceScanRecord,
  PersistedMeasurementRecord
} from '../../data/browserDataRepository';
import {
  ALL_PLATFORMS,
  bandKey,
  buildPlatformTotals,
  buildRiskInfo,
  comboStapleServingCount,
  PLATFORM_NAMES,
  pricingStrategyTargetForPay,
  stapleScenarioName,
} from '../../domain/core';
import { roundMoney } from '../../domain/money';
import type {
  ActivityDesignResult,
  ActivityOriginalBucketRepresentativeCombo,
  ActivityPriceBucketRow,
  ActivityScanComboPoolRow,
  ActivityScanComboPools,
  CalculatorState,
  ComboEvaluationRow,
  ComboItem,
  MeasurementBucketCostSample,
  MeasurementResult,
  MeasurementSettings,
  Platform,
  PriceBandRow,
  RiskInfo,
  StapleScenario,
  Store,
  Summary
} from '../../domain/types';
import { EMPTY_SUMMARY, STAPLE_SCENARIOS } from '../../config/calculation';

export const MEASUREMENT_RESULT_SCENARIO = 'multi';
export const DEFAULT_MEASUREMENT_SETTINGS: MeasurementSettings = {
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  stapleMaxCount: 3,
  multiStapleCount: 3,
  addOnMaxCount: '',
  payBandSize: 5,
  ignoreOutOfPayRange: true
};

const MEASUREMENT_MODEL_VERSION = 'original-price-bucket-v2';
const ACTIVITY_PRICE_SCAN_MODEL_VERSION = 'activity-price-scan-v15';

export function waitForLoadingPaint() {
  return new Promise<void>(resolve => setTimeout(resolve, 30));
}

export function emptyMeasurementSummary(): MeasurementResult['summary'] {
  return { ...EMPTY_SUMMARY, ignoredCount: 0, riskCount: 0 };
}

export function measurementRecordKey(storeId: string, scenario: string) {
  return `${storeId}::${scenario}::${MEASUREMENT_MODEL_VERSION}`;
}

export function measurementChunkKey(parentKey: string, runId: string, index: number) {
  return `${parentKey}::chunk::${runId}::${index}`;
}

function activityPriceScanRecordKey(storeId: string) {
  return `${storeId}::${ACTIVITY_PRICE_SCAN_MODEL_VERSION}`;
}

function measurementFiniteMax(value: number | '') {
  if (value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

export function measurementRowWeight(row: Pick<ComboEvaluationRow, 'representedComboCount'>) {
  if (row.representedComboCount === undefined || row.representedComboCount === null) return 1;
  return Math.max(0, Math.floor(Number(row.representedComboCount) || 0));
}

function measurementRowRiskWeight(row: Pick<ComboEvaluationRow, 'risk' | 'sourceBucketRiskCount' | 'representedComboCount'>) {
  const bucketRiskCount = Number(row.sourceBucketRiskCount);
  if (Number.isFinite(bucketRiskCount) && bucketRiskCount > 0) return Math.max(0, Math.floor(bucketRiskCount));
  return row.risk?.hasRisk ? measurementRowWeight(row) : 0;
}

export function buildMeasurementSummaryFromRows(rows: ComboEvaluationRow[], elapsedTime: number | null): MeasurementResult['summary'] {
  const activeRows = rows.filter(row => !row.ignored);
  const resultCount = activeRows.reduce((sum, row) => sum + measurementRowWeight(row), 0);
  const comboCount = rows.reduce((sum, row) => sum + measurementRowWeight(row), 0);
  return {
    resultCount,
    comboCount,
    validComboCount: resultCount,
    ignoredCount: Math.max(0, comboCount - resultCount),
    riskCount: activeRows.reduce((sum, row) => sum + measurementRowRiskWeight(row), 0),
    elapsedTime
  };
}

export function sortMeasurementRows(rows: ComboEvaluationRow[]) {
  return rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.finalPay - b.finalPay || a.originalTotal - b.originalTotal || a.key.localeCompare(b.key));
}

function fallbackMeasurementRowKey(row: Partial<ComboEvaluationRow>, index: number) {
  const itemKey = Array.isArray(row.items)
    ? row.items.map(item => `${item.productId || item.name}:${item.qty}`).join('|')
    : 'no-items';
  return [
    row.platform || 'platform',
    row.scenario || 'scenario',
    itemKey,
    roundMoney(row.originalTotal),
    roundMoney(row.finalPay),
    roundMoney(row.activityAmount),
    index
  ].join('::');
}

function ensureUniqueMeasurementRowKeys(rows: ComboEvaluationRow[]) {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const baseKey = String(row.key || fallbackMeasurementRowKey(row, index));
    const count = seen.get(baseKey) || 0;
    seen.set(baseKey, count + 1);
    if (count === 0 && row.key === baseKey) return row;
    return { ...row, key: `${baseKey}::cache-dup:${count || index}` };
  });
}

function normalizeBucketCostSamples(value: unknown): MeasurementBucketCostSample[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const rows = value
    .filter(row => row && typeof row === 'object')
    .map(row => {
      const source = row as Partial<MeasurementBucketCostSample>;
      const kind = source.kind === 'minCost' || source.kind === 'maxCost' || source.kind === 'avgCost' ? source.kind : null;
      if (!kind) return null;
      return {
        key: String(source.key || `${kind}-${roundMoney(source.originalTotal)}-${roundMoney(source.cost)}`),
        kind,
        kindName: source.kindName || bucketCostKindName(kind),
        originalTotal: roundMoney(source.originalTotal),
        cost: roundMoney(source.cost),
        totalQty: Math.max(0, Math.floor(Number(source.totalQty) || 0)),
        stapleCount: Math.max(0, Math.floor(Number(source.stapleCount) || 0)),
        items: Array.isArray(source.items) ? source.items : []
      } satisfies MeasurementBucketCostSample;
    })
    .filter((row): row is MeasurementBucketCostSample => Boolean(row));
  return rows.length ? rows : undefined;
}

export function normalizeCachedMeasurementRows(value: unknown): ComboEvaluationRow[] {
  if (!Array.isArray(value)) return [];
  const rows = value
    .filter(row => row && typeof row === 'object')
    .map((row, index) => {
      const source = row as Partial<ComboEvaluationRow>;
      const platform: Platform = ALL_PLATFORMS.includes(source.platform as Platform) ? source.platform as Platform : 'meituan';
      const scenario: StapleScenario = STAPLE_SCENARIOS.includes(source.scenario as StapleScenario) ? source.scenario as StapleScenario : 'single';
      const riskSource = (source.risk || {}) as Partial<RiskInfo>;
      return {
        ...source,
        key: String(source.key || fallbackMeasurementRowKey(source, index)),
        platform,
        platformName: source.platformName || PLATFORM_NAMES[platform],
        scenario,
        scenarioName: source.scenarioName || stapleScenarioName(scenario),
        items: Array.isArray(source.items) ? source.items : [],
        originalTotal: roundMoney(source.originalTotal),
        afterProductDiscount: roundMoney(source.afterProductDiscount),
        finalPay: roundMoney(source.finalPay),
        netPay: roundMoney(source.netPay),
        cost: roundMoney(source.cost),
        activityAmount: roundMoney(source.activityAmount),
        commission: roundMoney(source.commission),
        serviceFee: roundMoney(source.serviceFee),
        freightSubsidy: roundMoney(source.freightSubsidy),
        profit: roundMoney(source.profit),
        profitRate: source.profitRate === null || source.profitRate === undefined ? null : Number(source.profitRate) || 0,
        netProfitRate: source.netProfitRate === null || source.netProfitRate === undefined ? null : Number(source.netProfitRate) || 0,
        costProfitRate: source.costProfitRate === null || source.costProfitRate === undefined ? null : Number(source.costProfitRate) || 0,
        targetPayRate: Number(source.targetPayRate) || 0,
        targetNetRate: Number(source.targetNetRate) || 0,
        requiredPayRate: Number(source.requiredPayRate) || 0,
        requiredNetRate: Number(source.requiredNetRate) || 0,
        profitSpace: roundMoney(source.profitSpace),
        profitRateGap: source.profitRateGap === null || source.profitRateGap === undefined ? null : Number(source.profitRateGap) || 0,
        representedComboCount: source.representedComboCount === undefined || source.representedComboCount === null ? undefined : Math.max(0, Math.floor(Number(source.representedComboCount) || 0)),
        sourceBucketKey: source.sourceBucketKey,
        sourceBucketLabel: source.sourceBucketLabel,
        sourceBucketRiskCount: source.sourceBucketRiskCount === undefined || source.sourceBucketRiskCount === null ? undefined : Math.max(0, Math.floor(Number(source.sourceBucketRiskCount) || 0)),
        bucketCostSamples: normalizeBucketCostSamples(source.bucketCostSamples),
        ignored: Boolean(source.ignored),
        risk: {
          hasRisk: Boolean(riskSource.hasRisk),
          severity: riskSource.severity || 'none',
          severityRank: Number(riskSource.severityRank) || 0,
          reasons: Array.isArray(riskSource.reasons) ? riskSource.reasons : [],
          target: riskSource.target || null,
          thresholdRate: riskSource.thresholdRate ?? null,
          rateGap: riskSource.rateGap ?? null,
          netThresholdRate: riskSource.netThresholdRate ?? null,
          netRateGap: riskSource.netRateGap ?? null
        }
      } as ComboEvaluationRow;
    });
  return ensureUniqueMeasurementRowKeys(sortMeasurementRows(rows));
}

export function isMeasurementRowInDisplayFilters(row: ComboEvaluationRow, store: Pick<Store, 'calculationTotalMin' | 'calculationTotalMax'>, settings: MeasurementSettings) {
  const storeRange = {
    min: Math.max(0, Number(store.calculationTotalMin) || 0),
    max: store.calculationTotalMax === '' ? Infinity : Math.max(0, Number(store.calculationTotalMax) || 0)
  };
  const originalMin = Math.max(storeRange.min, Math.max(0, Number(settings.originalMin) || 0));
  const originalMaxSetting = settings.originalMax === '' ? storeRange.max : Math.max(originalMin, Number(settings.originalMax) || 0);
  const originalMax = Number.isFinite(originalMaxSetting) ? originalMaxSetting : Infinity;
  const payMin = Math.max(0, Number(settings.payMin) || 0);
  const payMax = settings.payMax === '' ? Infinity : Math.max(payMin, Number(settings.payMax) || 0);
  return row.originalTotal + 1e-9 >= originalMin
    && row.originalTotal <= originalMax + 1e-9
    && row.finalPay + 1e-9 >= payMin
    && row.finalPay <= payMax + 1e-9;
}

function measurementPriceBandSuggestion(avgProfitSpace: number, lowCount: number, riskCount: number, minProfitRate: number | null, maxProfitRate: number | null) {
  if (avgProfitSpace < -1e-9) return '活动穿透，需收紧优惠或调价';
  if (lowCount > 0) return '存在低利润原价桶，需查看明细';
  if (minProfitRate !== null && maxProfitRate !== null && maxProfitRate - minProfitRate > 0.12) return '同价位利润离散，建议收拢';
  if (avgProfitSpace > 1) return '存在可释放活动空间';
  if (riskCount > 0) return '桶内存在风险组合，需抽查明细';
  return '结构正常';
}

export function summarizeMeasurementPriceBandsFromRows(rows: ComboEvaluationRow[], payBandSize: number): PriceBandRow[] {
  const groups = new Map<string, {
    key: string;
    label: string;
    min: number;
    max: number;
    platform: Platform;
    platformName: string;
    scenario: StapleScenario;
    scenarioName: string;
    comboCount: number;
    ignoredCount: number;
    originalTotalSum: number;
    finalPaySum: number;
    netPaySum: number;
    costSum: number;
    profitSum: number;
    minProfit: number | null;
    maxProfit: number | null;
    profitRateSum: number;
    profitRateCount: number;
    minProfitRate: number | null;
    maxProfitRate: number | null;
    profitSpaceSum: number;
    lowCount: number;
    riskCount: number;
  }>();
  const size = Math.max(1, Number(payBandSize) || 5);
  for (const row of rows) {
    const weight = measurementRowWeight(row);
    if (weight <= 0) continue;
    const band = bandKey(row.finalPay, size);
    const key = ['pay', row.platform, band.key].join('::');
    const current = groups.get(key) || {
      key,
      label: band.label,
      min: band.min,
      max: band.max,
      platform: row.platform,
      platformName: row.platformName,
      scenario: row.scenario,
      scenarioName: '全部组合',
      comboCount: 0,
      ignoredCount: 0,
      originalTotalSum: 0,
      finalPaySum: 0,
      netPaySum: 0,
      costSum: 0,
      profitSum: 0,
      minProfit: null,
      maxProfit: null,
      profitRateSum: 0,
      profitRateCount: 0,
      minProfitRate: null,
      maxProfitRate: null,
      profitSpaceSum: 0,
      lowCount: 0,
      riskCount: 0
    };
    current.comboCount += weight;
    current.ignoredCount += row.ignored ? weight : 0;
    if (row.ignored) {
      groups.set(key, current);
      continue;
    }
    current.originalTotalSum += row.originalTotal * weight;
    current.finalPaySum += row.finalPay * weight;
    current.netPaySum += row.netPay * weight;
    current.costSum += row.cost * weight;
    current.profitSum += row.profit * weight;
    current.profitSpaceSum += row.profitSpace * weight;
    current.minProfit = current.minProfit === null ? row.profit : Math.min(current.minProfit, row.profit);
    current.maxProfit = current.maxProfit === null ? row.profit : Math.max(current.maxProfit, row.profit);
    if (row.netProfitRate !== null) {
      current.profitRateSum += row.netProfitRate * weight;
      current.profitRateCount += weight;
      current.minProfitRate = current.minProfitRate === null ? row.netProfitRate : Math.min(current.minProfitRate, row.netProfitRate);
      current.maxProfitRate = current.maxProfitRate === null ? row.netProfitRate : Math.max(current.maxProfitRate, row.netProfitRate);
    }
    if (row.profitSpace < -1e-9 || (row.netProfitRate !== null && row.netProfitRate + 1e-9 < row.targetNetRate)) current.lowCount += weight;
    current.riskCount += measurementRowRiskWeight(row);
    groups.set(key, current);
  }
  return Array.from(groups.values())
    .filter(group => group.comboCount > group.ignoredCount)
    .map(group => {
      const activeCount = Math.max(1, group.comboCount - group.ignoredCount);
      const avgProfitRate = group.profitRateCount ? group.profitRateSum / group.profitRateCount : null;
      const avgProfitSpace = group.profitSpaceSum / activeCount;
      return {
        key: group.key,
        label: group.label,
        min: group.min,
        max: group.max,
        platform: group.platform,
        platformName: group.platformName,
        scenario: group.scenario,
        scenarioName: group.scenarioName,
        comboCount: group.comboCount,
        ignoredCount: group.ignoredCount,
        avgOriginalTotal: group.originalTotalSum / activeCount,
        avgFinalPay: group.finalPaySum / activeCount,
        avgNetPay: group.netPaySum / activeCount,
        avgCost: group.costSum / activeCount,
        avgProfit: roundMoney(group.profitSum / activeCount),
        minProfit: group.minProfit,
        maxProfit: group.maxProfit,
        avgProfitRate,
        minProfitRate: group.minProfitRate,
        maxProfitRate: group.maxProfitRate,
        avgProfitSpace,
        lowCount: group.lowCount,
        riskCount: group.riskCount,
        suggestion: measurementPriceBandSuggestion(avgProfitSpace, group.lowCount, group.riskCount, group.minProfitRate, group.maxProfitRate)
      } satisfies PriceBandRow;
    })
    .sort((a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') || a.min - b.min);
}

function mergeScanComboQtys(mainCombo: ActivityScanComboPoolRow, addOnCombo: ActivityScanComboPoolRow) {
  const length = Math.max(mainCombo.qtys.length, addOnCombo.qtys.length);
  return Array.from({ length }, (_, index) => (mainCombo.qtys[index] || 0) + (addOnCombo.qtys[index] || 0));
}

function scanComboLookup(scanComboPools?: ActivityScanComboPools) {
  if (!scanComboPools?.mainCombos?.length || !scanComboPools?.addOnCombos?.length) return null;
  return {
    mainComboById: new Map(scanComboPools.mainCombos.map(row => [row.key, row])),
    addOnComboById: new Map(scanComboPools.addOnCombos.map(row => [row.key, row]))
  };
}

function representativeComboKey(representative: ActivityOriginalBucketRepresentativeCombo) {
  return [representative.kind, representative.mainComboId, representative.addOnComboId].join('::');
}

function bucketCostKindName(kind: MeasurementBucketCostSample['kind']) {
  if (kind === 'minCost') return '最低成本';
  if (kind === 'maxCost') return '最高成本';
  return '平均成本';
}

function bucketRepresentatives(bucket: ActivityPriceBucketRow, kind: MeasurementBucketCostSample['kind'], limit: number) {
  const representatives = [
    ...(bucket.representativeCombos || []),
    ...(bucket.entries || []).flatMap(entry => entry.representativeCombos || [])
  ].filter(row => row.kind === kind);
  if (!representatives.length) return [];
  const deduped = new Map<string, ActivityOriginalBucketRepresentativeCombo>();
  for (const representative of representatives) {
    const key = representativeComboKey(representative);
    if (!deduped.has(key)) deduped.set(key, representative);
  }
  const avgCost = Number(bucket.avgCost ?? bucket.weightedAvgCost ?? 0) || 0;
  const sorted = Array.from(deduped.values()).sort((a, b) => {
    if (kind === 'minCost') return a.cost - b.cost || representativeComboKey(a).localeCompare(representativeComboKey(b));
    if (kind === 'maxCost') return b.cost - a.cost || representativeComboKey(a).localeCompare(representativeComboKey(b));
    return Math.abs(a.cost - avgCost) - Math.abs(b.cost - avgCost) || representativeComboKey(a).localeCompare(representativeComboKey(b));
  });
  return sorted.slice(0, Math.max(1, Math.floor(Number(limit) || 1)));
}

function bucketRepresentative(bucket: ActivityPriceBucketRow) {
  return bucketRepresentatives(bucket, 'avgCost', 1)[0]
    || bucketRepresentatives(bucket, 'minCost', 1)[0]
    || bucketRepresentatives(bucket, 'maxCost', 1)[0]
    || null;
}

function bucketRepresentativeItems(
  store: Store,
  bucket: ActivityPriceBucketRow,
  scanComboPools: ActivityScanComboPools | undefined,
  representative = bucketRepresentative(bucket)
) {
  const lookup = scanComboLookup(scanComboPools);
  if (!lookup || !representative) return { items: [] as ComboItem[], stapleCount: 0, originalTotal: 0, cost: 0, totalQty: 0 };
  const mainCombo = lookup.mainComboById.get(representative.mainComboId);
  const addOnCombo = lookup.addOnComboById.get(representative.addOnComboId);
  if (!mainCombo || !addOnCombo || mainCombo.platform !== bucket.platform || addOnCombo.platform !== bucket.platform) return { items: [] as ComboItem[], stapleCount: 0, originalTotal: 0, cost: 0, totalQty: 0 };
  const totals = buildPlatformTotals(store, bucket.platform, mergeScanComboQtys(mainCombo, addOnCombo));
  const originalTotal = roundMoney((mainCombo.priceCents + addOnCombo.priceCents) / 100 || totals.originalTotal);
  return {
    items: totals.items,
    stapleCount: mainCombo.stapleCount || comboStapleServingCount(totals.items),
    originalTotal,
    cost: roundMoney(representative.cost || totals.costTotal),
    totalQty: mainCombo.totalQty + addOnCombo.totalQty
  };
}

function bucketCostSamples(store: Store, bucket: ActivityPriceBucketRow, scanComboPools?: ActivityScanComboPools): MeasurementBucketCostSample[] | undefined {
  const kinds: MeasurementBucketCostSample['kind'][] = ['minCost', 'avgCost', 'maxCost'];
  const samples = kinds.flatMap(kind => bucketRepresentatives(bucket, kind, 3).map(representative => {
    const detail = bucketRepresentativeItems(store, bucket, scanComboPools, representative);
    return {
      key: `${bucket.key}::${representativeComboKey(representative)}`,
      kind,
      kindName: bucketCostKindName(kind),
      originalTotal: detail.originalTotal,
      cost: detail.cost,
      totalQty: detail.totalQty,
      stapleCount: detail.stapleCount,
      items: detail.items
    } satisfies MeasurementBucketCostSample;
  }));
  return samples.length ? samples : undefined;
}

function fallbackStapleCountForBucket(finalPay: number) {
  if (finalPay <= 25 + 1e-9) return 1;
  if (finalPay <= 60 + 1e-9) return 2;
  return 3;
}

function bucketToMeasurementRow(state: CalculatorState, store: Store, bucket: ActivityPriceBucketRow, scanComboPools?: ActivityScanComboPools): ComboEvaluationRow {
  const representative = bucketRepresentativeItems(store, bucket, scanComboPools);
  const originalTotal = roundMoney(bucket.avgOriginalTotal || bucket.priceBucket);
  const finalPay = roundMoney(bucket.avgFinalPay ?? bucket.weightedAvgFinalPay ?? 0);
  const netPay = roundMoney(bucket.avgNetPay ?? bucket.weightedAvgNetPay ?? 0);
  const cost = roundMoney(bucket.avgCost ?? bucket.weightedAvgCost ?? 0);
  const profit = roundMoney(netPay - cost);
  const stapleCount = representative.stapleCount || comboStapleServingCount(representative.items) || fallbackStapleCountForBucket(finalPay);
  const target = pricingStrategyTargetForPay(state, store, finalPay, stapleCount);
  const profitRate = finalPay > 1e-9 ? profit / finalPay : profit < 0 ? -1 : null;
  const netProfitRate = netPay > 1e-9 ? profit / netPay : profit < 0 ? -1 : null;
  const costProfitRate = cost > 1e-9 ? profit / cost : profit < 0 ? -1 : null;
  const paySpace = profitRate === null ? -Infinity : roundMoney(profit - finalPay * target.targetPayRate);
  const netSpace = netProfitRate === null ? -Infinity : roundMoney(profit - netPay * target.targetNetRate);
  const profitSpace = Number.isFinite(paySpace) && Number.isFinite(netSpace) ? Math.min(paySpace, netSpace) : roundMoney(profit);
  const activityAmount = roundMoney(bucket.avgActivityAlreadyDiscountAmount ?? bucket.weightedAvgActivityAlreadyDiscountAmount ?? Math.max(0, originalTotal - finalPay));
  const redAddOnAmount = roundMoney(bucket.avgActivityRedAddOnAmount ?? bucket.weightedAvgActivityRedAddOnAmount ?? 0);
  const baseRow = {
    key: `measurement-bucket::${bucket.key}`,
    platform: bucket.platform,
    platformName: bucket.platformName || PLATFORM_NAMES[bucket.platform],
    items: representative.items,
    scenario: target.scenario,
    scenarioName: '原价桶汇总',
    originalTotal,
    afterProductDiscount: originalTotal,
    finalPay,
    netPay,
    cost,
    activityAmount,
    commission: 0,
    serviceFee: 0,
    freightSubsidy: 0,
    profit,
    profitRate,
    netProfitRate,
    costProfitRate,
    targetPayRate: target.targetPayRate,
    targetNetRate: target.targetNetRate,
    requiredPayRate: target.requiredPayRate,
    requiredNetRate: target.requiredNetRate,
    profitSpace,
    profitRateGap: netProfitRate === null ? null : netProfitRate - target.targetNetRate,
    productDiscount: 0,
    full: { enabled: true, threshold: 0, amount: 0 },
    coupons: [],
    couponAmount: 0,
    baseRed: { enabled: true, threshold: 0, min: 0, max: 0, amount: Math.max(0, activityAmount - redAddOnAmount) },
    redAddOn: { enabled: true, threshold: 0, amount: redAddOnAmount },
    representedComboCount: Math.max(0, Math.floor(Number(bucket.comboCount) || 0)),
    sourceBucketKey: bucket.key,
    sourceBucketLabel: bucket.label,
    sourceBucketRiskCount: Math.max(0, Math.floor(Number(bucket.riskCount) || 0)),
    bucketCostSamples: bucketCostSamples(store, bucket, scanComboPools),
    ignored: false,
    ignoreReason: ''
  } satisfies Omit<ComboEvaluationRow, 'risk'>;
  const risk = buildRiskInfo(baseRow);
  if (baseRow.sourceBucketRiskCount > 0) {
    const reasons = risk.reasons.filter(reason => reason !== '正常');
    reasons.push(`原价桶内已有 ${baseRow.sourceBucketRiskCount} 个风险组合`);
    return {
      ...baseRow,
      risk: {
        ...risk,
        hasRisk: true,
        severity: risk.hasRisk ? risk.severity : 'medium',
        severityRank: Math.max(risk.severityRank, 2),
        reasons
      }
    };
  }
  return { ...baseRow, risk };
}

export function buildMeasurementResultFromActivityScan(
  state: CalculatorState,
  store: Store,
  scanResult: Pick<ActivityDesignResult, 'originalPriceBuckets' | 'scanComboPools' | 'warnings'>,
  payBandSize: number
): MeasurementResult {
  const rows = (scanResult.originalPriceBuckets || [])
    .filter(bucket => ALL_PLATFORMS.includes(bucket.platform) && Math.max(0, Number(bucket.comboCount) || 0) > 0)
    .map(bucket => bucketToMeasurementRow(state, store, bucket, scanResult.scanComboPools));
  const sortedRows = normalizeCachedMeasurementRows(rows);
  const activeRows = sortedRows.filter(row => !row.ignored);
  const bucketCount = sortedRows.length;
  const representedCount = sortedRows.reduce((sum, row) => sum + measurementRowWeight(row), 0);
  return {
    rows: sortedRows,
    payBands: summarizeMeasurementPriceBandsFromRows(activeRows, payBandSize),
    warnings: [
      '组合测算基于活动设计原价桶汇总，按桶均值估算支付价、到手价和利润；需要商品级明细时请在原价桶明细中抽查。',
      ...(representedCount > bucketCount ? [`当前 ${bucketCount} 个原价桶代表约 ${representedCount} 个商品组合。`] : []),
      ...(scanResult.warnings || [])
    ],
    summary: buildMeasurementSummaryFromRows(sortedRows, null)
  };
}

export function measurementRecordToResult(record: PersistedMeasurementRecord, payBandSize: number): MeasurementResult {
  const rows = normalizeCachedMeasurementRows(record.rows);
  const activeRows = rows.filter(row => !row.ignored);
  return {
    rows,
    payBands: record.payBands?.length
      ? record.payBands
      : summarizeMeasurementPriceBandsFromRows(activeRows, Math.max(1, Number(payBandSize) || 5)),
    warnings: record.warnings,
    summary: record.summary
  };
}

export function buildMeasurementPersistenceSettings(
  store: Store,
  settings: MeasurementSettings,
  activitySettings: Pick<MeasurementSettings, 'payBandSize'> & { stapleMaxCount?: number; addOnMaxCount?: number | '' }
): MeasurementSettings {
  const storeMax = store.calculationTotalMax === ''
    ? settings.originalMax
    : Math.max(0, Number(store.calculationTotalMax) || 0);
  const stapleMaxCount = Math.max(1, Math.floor(Number(activitySettings.stapleMaxCount ?? settings.stapleMaxCount) || 3));
  return {
    ...settings,
    originalMin: 0,
    originalMax: storeMax,
    stapleMaxCount,
    multiStapleCount: Math.max(stapleMaxCount, Math.floor(Number(settings.multiStapleCount) || stapleMaxCount)),
    addOnMaxCount: activitySettings.addOnMaxCount === ''
      ? ''
      : Math.max(0, Math.floor(Number(activitySettings.addOnMaxCount) || 0)),
    payMin: 0,
    payMax: '',
    payBandSize: Math.max(1, Math.floor(Number(activitySettings.payBandSize) || settings.payBandSize || 5)),
    ignoreOutOfPayRange: true
  };
}

export function buildPersistedMeasurementRecord(
  store: Store,
  scenario: StapleScenario,
  settings: MeasurementSettings,
  result: MeasurementResult,
  chunkKeys: string[] = []
): PersistedMeasurementRecord {
  const rows = normalizeCachedMeasurementRows(result.rows);
  const generatedAt = new Date().toISOString();
  const originalMax = measurementFiniteMax(settings.originalMax);
  const payMax = measurementFiniteMax(settings.payMax);
  return {
    key: measurementRecordKey(store.id, scenario),
    storeId: store.id,
    storeName: store.name,
    scenario,
    generatedAt,
    settings: {
      ...settings,
      originalMax: originalMax === null ? '' : originalMax,
      payMax: payMax === null ? '' : payMax
    },
    meta: {
      generatedAt,
      originalMax,
      payMax,
      rowCount: result.summary.comboCount || rows.length
    },
    payBands: result.payBands,
    chunkKeys,
    rows: chunkKeys.length ? [] : rows,
    warnings: result.warnings,
    summary: chunkKeys.length ? result.summary : buildMeasurementSummaryFromRows(rows, result.summary.elapsedTime)
  };
}

function unsupportedActivityPriceScanSave(): PersistedActivityPriceScanRecord {
  throw new Error('结果页数据仓储不负责保存活动设计扫描。');
}

export const resultsDataRepository = createBrowserDataRepository<CalculatorState, Store>({
  scenarios: STAPLE_SCENARIOS,
  normalizeState: value => value as CalculatorState,
  measurementRecordKey,
  measurementChunkKey,
  activityPriceScanRecordKey,
  buildPersistedMeasurementRecord,
  buildPersistedActivityPriceScanRecord: unsupportedActivityPriceScanSave,
  normalizeCachedMeasurementRows,
  isMeasurementRowInDisplayFilters,
  sortMeasurementRows
});

export type ResultsCalculationState = {
  activeResultWarnings: string[];
  isMeasurementCacheLoading: boolean;
  isResultsLoading: boolean;
  measurementPayBandSize: number;
  measurementPersistenceMeta: MeasurementPersistenceMeta | null;
  resultPayBands: PriceBandRow[];
  resultRows: ComboEvaluationRow[];
  resultSummary: MeasurementResult['summary'];
  runResults: (settings?: MeasurementSettings) => Promise<void>;
  summary: Summary;
};
