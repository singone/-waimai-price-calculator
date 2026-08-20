// @ts-nocheck
'use client';

import { createBrowserDataRepository } from '../../data/browserDataRepository';
import type {
  ActivityPriceScanPersistenceMeta,
  PersistedActivityPriceScanRecord
} from '../../data/browserDataRepository';
import {
  bestBaseRed,
  bestFullReduction,
  bestRedAddOn,
  buildFeeSummary,
  buildPlatformTotals,
  currentStoreFrom,
  PLATFORM_NAMES,
  pricingScenarioForStapleCount
} from '../../domain/core';
import { roundMoney } from '../../domain/money';
import type {
  ActivityBaseComboRow,
  ActivityDesignResult,
  ActivityDesignSettings,
  ActivityPriceBucketRow,
  ActivityRecommendationRow,
  ActivityScanComboPools,
  ActivityScanComboPoolRow,
  CalculatorState,
  Platform,
  PriceBandRow,
  RedAddOn,
  Store
} from '../../domain/types';
import { ACTIVITY_MIN_NET_PAY } from '../../config/activity';
import { activityObjectiveOptionsFromTemplates } from '../../config/activityStrategy';
import { STAPLE_SCENARIOS } from '../../config/calculation';
import {
  buildMeasurementSummaryFromRows,
  isMeasurementRowInDisplayFilters,
  measurementChunkKey,
  measurementRecordKey,
  normalizeCachedMeasurementRows,
  sortMeasurementRows
} from '../results/resultsCalculationUtils';
import { normalizeActivityScanComboPools } from './activityDesignPageUtils';

const ACTIVITY_PRICE_SCAN_MODEL_VERSION = 'activity-price-scan-v10';

export function activityPriceScanRecordKey(storeId: string) {
  return `${storeId}::${ACTIVITY_PRICE_SCAN_MODEL_VERSION}`;
}

function measurementFiniteMax(value: number | '') {
  if (value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJsonStringify(source[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function activityPriceScanSettingsSignatureInput(settings: ActivityDesignSettings) {
  const {
    calculationMode: _calculationMode,
    originalBandsSnapshot: _originalBandsSnapshot,
    originalPriceBucketsSnapshot: _originalPriceBucketsSnapshot,
    scanComboPoolsSnapshot: _scanComboPoolsSnapshot,
    selectedRecommendationKey: _selectedRecommendationKey,
    selectedRecommendationSnapshot: _selectedRecommendationSnapshot,
    targetProfitRate: _targetProfitRate,
    couponProfitDrop: _couponProfitDrop,
    minProfitRate: _minProfitRate,
    objectivePayTargets: _objectivePayTargets,
    ...scanSettings
  } = settings;
  const objectiveStrategies = Object.fromEntries(Object.entries(scanSettings.objectiveStrategies || {}).map(([key, strategy]) => [key, {
    payMin: strategy?.payMin,
    payMax: strategy?.payMax,
    originalDiscountTiers: strategy?.originalDiscountTiers,
    fullDiscountShare: strategy?.fullDiscountShare,
    couponDiscountShare: strategy?.couponDiscountShare,
    reserveDiscountShare: strategy?.reserveDiscountShare,
    fullThresholdWindow: strategy?.fullThresholdWindow,
    fullThresholdMinGap: strategy?.fullThresholdMinGap,
    minFullAmountIncrease: strategy?.minFullAmountIncrease,
    fullAmountBasis: strategy?.fullAmountBasis,
    maxFullRuleCount: strategy?.maxFullRuleCount,
    minFullHitCount: strategy?.minFullHitCount,
    minNetPayFloor: strategy?.minNetPayFloor,
    couponRecommendationPolicy: strategy?.couponRecommendationPolicy,
    couponScoringMode: strategy?.couponScoringMode
  }]));
  return {
    ...scanSettings,
    objectiveStrategies
  };
}

function activityPriceScanStoreSignatureInput(store: Store) {
  return {
    id: store.id,
    startPrice: store.startPrice,
    calculationTotalMax: store.calculationTotalMax,
    stapleCountMin: store.stapleCountMin,
    stapleCountMax: store.stapleCountMax,
    deliveryDistance: store.deliveryDistance,
    maxItems: store.maxItems,
    maxQtyPerSku: store.maxQtyPerSku,
    maxDiscountItems: store.maxDiscountItems,
    maxChecks: store.maxChecks,
    usePlatformFee: store.usePlatformFee,
    customFeeRule: store.customFeeRule,
    activityDesignSettings: store.activityDesignSettings,
    discountActivities: {
      meituan: store.activities.meituan.discountActivities,
      eleme: store.activities.eleme.discountActivities
    },
    products: store.products.map(product => ({
      id: product.id,
      name: product.name,
      price: product.price,
      packageFee: product.packageFee,
      meituanPrice: product.meituanPrice,
      elemePrice: product.elemePrice,
      meituanPackageFee: product.meituanPackageFee,
      elemePackageFee: product.elemePackageFee,
      meituanEnabled: product.meituanEnabled,
      elemeEnabled: product.elemeEnabled,
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      nonStandalone: product.nonStandalone
    }))
  };
}

export function buildActivityPriceScanSignature(state: CalculatorState, store: Store, settings: ActivityDesignSettings) {
  return stableJsonStringify({
    modelVersion: ACTIVITY_PRICE_SCAN_MODEL_VERSION,
    schemaVersion: 'scan-pools-v1',
    platformRules: state.platformRules,
    store: activityPriceScanStoreSignatureInput(store),
    settings: activityPriceScanSettingsSignatureInput(settings)
  });
}

function activityPriceScanLegacySettingsSignatureInput(settings: ActivityDesignSettings) {
  const {
    calculationMode: _calculationMode,
    originalBandsSnapshot: _originalBandsSnapshot,
    originalPriceBucketsSnapshot: _originalPriceBucketsSnapshot,
    scanComboPoolsSnapshot: _scanComboPoolsSnapshot,
    selectedRecommendationKey: _selectedRecommendationKey,
    selectedRecommendationSnapshot: _selectedRecommendationSnapshot,
    ...scanSettings
  } = settings;
  return scanSettings;
}

function activityPriceScanLegacyStoreSignatureInput(store: Store) {
  return {
    ...activityPriceScanStoreSignatureInput(store),
    usePlatformTargets: store.usePlatformTargets,
    profitTargets: store.profitTargets,
    products: store.products.map(product => ({
      id: product.id,
      name: product.name,
      price: product.price,
      cost: product.cost,
      packageFee: product.packageFee,
      meituanPrice: product.meituanPrice,
      elemePrice: product.elemePrice,
      meituanPackageFee: product.meituanPackageFee,
      elemePackageFee: product.elemePackageFee,
      meituanEnabled: product.meituanEnabled,
      elemeEnabled: product.elemeEnabled,
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      nonStandalone: product.nonStandalone
    }))
  };
}

export function buildLegacyActivityPriceScanSignature(state: CalculatorState, store: Store, settings: ActivityDesignSettings) {
  return stableJsonStringify({
    modelVersion: ACTIVITY_PRICE_SCAN_MODEL_VERSION,
    schemaVersion: 'scan-pools-v1',
    riskSafetyMargin: state.riskSafetyMargin,
    platformRules: state.platformRules,
    store: activityPriceScanLegacyStoreSignatureInput(store),
    settings: activityPriceScanLegacySettingsSignatureInput(settings)
  });
}

export function buildPersistedActivityPriceScanRecord(
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  result: ActivityDesignResult
): PersistedActivityPriceScanRecord {
  const generatedAt = new Date().toISOString();
  const originalPriceBuckets = Array.isArray(result.originalPriceBuckets) ? result.originalPriceBuckets : [];
  const scanComboPools = normalizeActivityScanComboPools(result.scanComboPools);
  return {
    key: activityPriceScanRecordKey(store.id),
    storeId: store.id,
    storeName: store.name,
    generatedAt,
    signature: buildActivityPriceScanSignature(state, store, settings),
    meta: {
      storeId: store.id,
      generatedAt,
      originalMax: measurementFiniteMax(settings.originalMax),
      bucketCount: originalPriceBuckets.length,
      mainComboCount: scanComboPools.mainCombos.length,
      addOnComboCount: scanComboPools.addOnCombos.length,
      mainComboCountByPlatform: scanComboPools.mainComboCountByPlatform,
      addOnComboCountByPlatform: scanComboPools.addOnComboCountByPlatform
    },
    scanComboPools,
    originalPriceBuckets
  };
}

export function activityPriceScanRecordToResult(record: PersistedActivityPriceScanRecord): ActivityDesignResult {
  const legacyRecord = record as PersistedActivityPriceScanRecord & {
    originalBands?: PriceBandRow[];
    originalComboRows?: ActivityBaseComboRow[];
    routeSourceRows?: ActivityBaseComboRow[];
    warnings?: string[];
    summary?: ActivityDesignResult['summary'];
    meta?: ActivityPriceScanPersistenceMeta & { comboRowCount?: number };
  };
  const originalBands = Array.isArray(legacyRecord.originalBands) ? legacyRecord.originalBands : [];
  const originalPriceBuckets = Array.isArray(record.originalPriceBuckets) ? record.originalPriceBuckets : [];
  const scanComboPools = normalizeActivityScanComboPools(record.scanComboPools);
  const comboCount = legacyRecord.meta?.comboRowCount ?? originalPriceBuckets.reduce((sum, row) => sum + row.comboCount, 0);
  return {
    originalBands,
    originalPriceBuckets,
    originalComboRows: [],
    routeSourceRows: [],
    scanComboPools,
    fullRoutes: [],
    couponRoutes: [],
    recommendations: [],
    payBands: [],
    hitRows: [],
    comboRows: [],
    warnings: Array.isArray(legacyRecord.warnings) ? legacyRecord.warnings : [],
    summary: legacyRecord.summary || {
      resultCount: originalPriceBuckets.length,
      comboCount,
      validComboCount: comboCount,
      elapsedTime: null
    }
  };
}

export function mergeActivityRouteValidationResult(
  current: ActivityDesignResult | null,
  validation: ActivityDesignResult
): ActivityDesignResult {
  if (!current) return validation;
  const selectedRecommendation = validation.recommendations[0];
  const recommendations = selectedRecommendation
    ? current.recommendations.some(row => row.key === selectedRecommendation.key)
      ? current.recommendations.map(row => row.key === selectedRecommendation.key ? selectedRecommendation : row)
      : [selectedRecommendation, ...current.recommendations]
    : current.recommendations;
  const validationPlatforms = new Set(validation.originalBands.map(row => row.platform));
  const originalBands = validation.originalBands.length
    ? [
      ...current.originalBands.filter(row => !validationPlatforms.has(row.platform)),
      ...validation.originalBands
    ]
    : current.originalBands;
  const validationBucketPlatforms = new Set((validation.originalPriceBuckets || []).map(row => row.platform));
  const originalPriceBuckets = validation.originalPriceBuckets?.length
    ? [
      ...(current.originalPriceBuckets || []).filter(row => !validationBucketPlatforms.has(row.platform)),
      ...validation.originalPriceBuckets
    ]
    : current.originalPriceBuckets;
  const validationComboPlatforms = new Set((validation.originalComboRows || []).map(row => row.platform));
  const originalComboRows = validation.originalComboRows?.length
    ? [
      ...(current.originalComboRows || []).filter(row => !validationComboPlatforms.has(row.platform)),
      ...validation.originalComboRows
    ]
    : current.originalComboRows;
  const validationRouteSourcePlatforms = new Set((validation.routeSourceRows || []).map(row => row.platform));
  const routeSourceRows = validation.routeSourceRows?.length
    ? [
      ...(current.routeSourceRows || []).filter(row => !validationRouteSourcePlatforms.has(row.platform)),
      ...validation.routeSourceRows
    ]
    : current.routeSourceRows;
  return {
    ...current,
    originalBands,
    originalPriceBuckets,
    originalComboRows,
    routeSourceRows,
    fullRoutes: current.fullRoutes,
    couponRoutes: current.couponRoutes,
    recommendations,
    payBands: validation.payBands,
    hitRows: validation.hitRows,
    comboRows: validation.comboRows,
    warnings: validation.warnings,
    summary: {
      ...validation.summary,
      resultCount: current.summary.resultCount || current.recommendations.length || validation.summary.resultCount
    }
  };
}

function activityOriginalScanDetailRowKey(
  bucket: ActivityPriceBucketRow,
  mainCombo: ActivityScanComboPoolRow,
  addOnCombo: ActivityScanComboPoolRow
) {
  return ['activity-original-detail', bucket.key, mainCombo.key, addOnCombo.key].join('::');
}

function mergeActivityScanComboQtys(mainCombo: ActivityScanComboPoolRow, addOnCombo: ActivityScanComboPoolRow) {
  const length = Math.max(mainCombo.qtys.length, addOnCombo.qtys.length);
  return Array.from({ length }, (_, index) => (mainCombo.qtys[index] || 0) + (addOnCombo.qtys[index] || 0));
}

function activityScanScenarioName(scenario: string) {
  if (scenario === 'single') return '单人餐';
  if (scenario === 'double') return '双人餐';
  return '多人餐';
}

function nonNegativeAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function buildActivityOriginalScanDetailRow(
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  bucket: ActivityPriceBucketRow,
  mainCombo: ActivityScanComboPoolRow,
  addOnCombo: ActivityScanComboPoolRow,
  originalTotalCents: number,
  key: string
): ActivityBaseComboRow | null {
  const qtys = mergeActivityScanComboQtys(mainCombo, addOnCombo);
  const totals = buildPlatformTotals(store, bucket.platform, qtys);
  if (!totals.items.length) return null;
  const originalTotal = roundMoney(originalTotalCents / 100 || totals.originalTotal);
  const activity = store.activities[bucket.platform];
  const platformFull = bestFullReduction(activity.fullReductions || [], originalTotal);
  const afterPlatformFull = Math.max(0, roundMoney(originalTotal - platformFull.amount));
  const baseRed = bestBaseRed(state, bucket.platform, afterPlatformFull);
  const afterBaseRed = Math.max(0, roundMoney(afterPlatformFull - baseRed.amount));
  const plannedRedAddOn = nonNegativeAmount(settings.redAddOnSpace) > 0
    ? [{ enabled: true, threshold: 0, amount: roundMoney(nonNegativeAmount(settings.redAddOnSpace)) } as RedAddOn]
    : [];
  const redAddOn = bestRedAddOn(activity.redAddOns.concat(plannedRedAddOn), afterPlatformFull);
  const redAddAmount = Math.min(nonNegativeAmount(redAddOn.amount), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddAmount));
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const scenario = pricingScenarioForStapleCount(mainCombo.stapleCount);
  const profit = roundMoney(netPay - totals.costTotal);
  const profitRate = finalPay > 0 ? profit / finalPay : profit < 0 ? -1 : null;
  const netProfitRate = netPay > 0 ? profit / netPay : profit < 0 ? -1 : null;
  const costProfitRate = totals.costTotal > 0 ? profit / totals.costTotal : profit < 0 ? -1 : null;
  const lowNetPay = netPay + 1e-9 < ACTIVITY_MIN_NET_PAY;
  const costRisk = profit < -1e-9;
  const hasRisk = lowNetPay || costRisk;
  const objectiveOptions = activityObjectiveOptionsFromTemplates(settings.objectiveTemplates || []);
  return {
    key,
    platform: bucket.platform,
    platformName: bucket.platformName || PLATFORM_NAMES[bucket.platform],
    items: totals.items,
    scenario,
    scenarioName: activityScanScenarioName(scenario),
    originalTotal,
    afterProductDiscount: originalTotal,
    finalPay,
    netPay,
    cost: totals.costTotal,
    activityAmount: roundMoney(Math.max(0, originalTotal - finalPay)),
    commission: fee.commission,
    serviceFee: fee.serviceFee,
    freightSubsidy: fee.freightSubsidy,
    profit,
    profitRate,
    netProfitRate,
    costProfitRate,
    targetPayRate: 0,
    targetNetRate: 0,
    requiredPayRate: 0,
    requiredNetRate: 0,
    profitSpace: profit,
    profitRateGap: null,
    productDiscount: 0,
    full: platformFull,
    coupons: [],
    couponAmount: 0,
    baseRed,
    redAddOn: { ...redAddOn, amount: redAddAmount },
    ignored: false,
    ignoreReason: '',
    risk: {
      hasRisk,
      severity: costRisk ? 'high' : lowNetPay ? 'medium' : 'none',
      severityRank: costRisk ? 3 : lowNetPay ? 2 : 0,
      reasons: [
        ...(lowNetPay ? [`商家到手价低于 ¥${roundMoney(ACTIVITY_MIN_NET_PAY).toFixed(2)}`] : []),
        ...(costRisk ? ['成本高于商家到手价'] : [])
      ],
      target: null,
      thresholdRate: null,
      rateGap: null,
      netThresholdRate: null,
      netRateGap: null
    },
    baseFinalPay: finalPay,
    baseNetPay: netPay,
    baseProfitRate: profitRate,
    activityTargetObjective: settings.objective || 'longTerm',
    activityTargetObjectiveName: objectiveOptions.find(option => option.value === (settings.objective || 'longTerm'))?.label,
    activityTargetDiscountRate: bucket.avgActivityTargetDiscountRate ?? bucket.weightedAvgActivityTargetDiscountRate ?? undefined,
    activityTargetPay: bucket.avgActivityTargetPay ?? bucket.weightedAvgActivityTargetPay ?? undefined,
    activityTargetDiscountAmount: bucket.avgActivityTargetDiscountAmount ?? bucket.weightedAvgActivityTargetDiscountAmount ?? undefined,
    activityAlreadyDiscountAmount: bucket.avgActivityAlreadyDiscountAmount ?? bucket.weightedAvgActivityAlreadyDiscountAmount ?? roundMoney(Math.max(0, originalTotal - finalPay)),
    activityDesignSpace: bucket.avgActivityDesignSpace ?? bucket.weightedAvgActivityDesignSpace ?? undefined,
    activityNetPayBoundarySpace: bucket.avgActivityNetPayBoundarySpace ?? bucket.weightedAvgActivityNetPayBoundarySpace ?? undefined,
    activitySafeDiscountSpace: bucket.avgActivitySafeDiscountSpace ?? bucket.weightedAvgActivitySafeDiscountSpace ?? undefined,
    activityTargetPayGap: bucket.avgActivityTargetPayGap ?? bucket.weightedAvgActivityTargetPayGap ?? undefined
  };
}

export function expandActivityOriginalBucketCombos(
  result: ActivityDesignResult | null,
  bucket: ActivityPriceBucketRow | null,
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  options: { onlyKeys?: Set<string> } = {}
) {
  const scanComboPools = normalizeActivityScanComboPools(result?.scanComboPools);
  if (!scanComboPools.mainCombos.length || !scanComboPools.addOnCombos.length) return [];
  const mainComboById = new Map(scanComboPools.mainCombos.map(row => [row.key, row]));
  const addOnComboById = new Map(scanComboPools.addOnCombos.map(row => [row.key, row]));
  const emptyAddOnByPlatform = new Map<Platform, ActivityScanComboPoolRow>();
  for (const row of scanComboPools.addOnCombos) {
    if (row.totalQty === 0 && !emptyAddOnByPlatform.has(row.platform)) emptyAddOnByPlatform.set(row.platform, row);
  }
  const buckets = bucket ? [bucket] : (result?.originalPriceBuckets || []);
  const rows: ActivityBaseComboRow[] = [];
  for (const bucketRow of buckets) {
    for (const entry of bucketRow.entries || []) {
      const mainIds = Array.isArray(entry.mainComboIds) ? entry.mainComboIds : [];
      const persistedAddOnIds = Array.isArray(entry.addOnComboIds) ? entry.addOnComboIds : [];
      const addOnIds = persistedAddOnIds.length ? persistedAddOnIds : [emptyAddOnByPlatform.get(bucketRow.platform)?.key || ''];
      for (const mainId of mainIds) {
        const mainCombo = mainComboById.get(mainId);
        if (!mainCombo) continue;
        for (const addOnId of addOnIds) {
          const addOnCombo = addOnComboById.get(addOnId);
          if (!addOnCombo) continue;
          const key = activityOriginalScanDetailRowKey(bucketRow, mainCombo, addOnCombo);
          if (options.onlyKeys && !options.onlyKeys.has(key)) continue;
          const row = buildActivityOriginalScanDetailRow(state, store, settings, bucketRow, mainCombo, addOnCombo, entry.originalTotalCents, key);
          if (row) rows.push(row);
        }
      }
    }
  }
  return rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.originalTotal - b.originalTotal || a.key.localeCompare(b.key));
}

function unsupportedMeasurementRecordSave(store: Store, scenario: string, settings, result, chunkKeys = []) {
  const rows = normalizeCachedMeasurementRows(result.rows);
  const generatedAt = new Date().toISOString();
  return {
    key: measurementRecordKey(store.id, scenario),
    storeId: store.id,
    storeName: store.name,
    scenario,
    generatedAt,
    settings,
    meta: { generatedAt, originalMax: null, payMax: null, rowCount: rows.length },
    payBands: result.payBands,
    chunkKeys,
    rows,
    warnings: result.warnings,
    summary: buildMeasurementSummaryFromRows(rows, result.summary?.elapsedTime ?? null)
  };
}

export const activityDesignDataRepository = createBrowserDataRepository<CalculatorState, Store>({
  scenarios: STAPLE_SCENARIOS,
  normalizeState: value => value as CalculatorState,
  measurementRecordKey,
  measurementChunkKey,
  activityPriceScanRecordKey,
  buildPersistedMeasurementRecord: unsupportedMeasurementRecordSave,
  buildPersistedActivityPriceScanRecord,
  normalizeCachedMeasurementRows,
  isMeasurementRowInDisplayFilters,
  sortMeasurementRows
});
