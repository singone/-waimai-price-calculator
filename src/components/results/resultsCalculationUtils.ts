'use client';

import { createBrowserDataRepository } from '../../data/browserDataRepository';
import type {
  MeasurementPersistenceMeta,
  PersistedActivityPriceScanRecord,
  PersistedMeasurementRecord
} from '../../data/browserDataRepository';
import {
  PLATFORM_NAMES,
  stapleScenarioName,
  summarizePriceBands as summarizeDomainPriceBands
} from '../../domain/core';
import { roundMoney } from '../../domain/money';
import type {
  CalculatorState,
  ComboEvaluationRow,
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

const MEASUREMENT_MODEL_VERSION = 'unified-pay-band-v1';
const ACTIVITY_PRICE_SCAN_MODEL_VERSION = 'activity-price-scan-v10';

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

export function buildMeasurementSummaryFromRows(rows: ComboEvaluationRow[], elapsedTime: number | null): MeasurementResult['summary'] {
  const activeRows = rows.filter(row => !row.ignored);
  return {
    resultCount: activeRows.length,
    comboCount: rows.length,
    validComboCount: activeRows.length,
    ignoredCount: rows.length - activeRows.length,
    riskCount: activeRows.filter(row => row.risk.hasRisk).length,
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

export function normalizeCachedMeasurementRows(value: unknown): ComboEvaluationRow[] {
  if (!Array.isArray(value)) return [];
  const rows = value
    .filter(row => row && typeof row === 'object')
    .map((row, index) => {
      const source = row as Partial<ComboEvaluationRow>;
      const platform: Platform = source.platform === 'eleme' ? 'eleme' : 'meituan';
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

export function measurementRecordToResult(record: PersistedMeasurementRecord, payBandSize: number): MeasurementResult {
  const rows = normalizeCachedMeasurementRows(record.rows);
  const activeRows = rows.filter(row => !row.ignored);
  return {
    rows,
    payBands: record.payBands?.length
      ? record.payBands
      : summarizeDomainPriceBands(activeRows, Math.max(1, Number(payBandSize) || 5), 'pay', { groupByScenario: false }),
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
      rowCount: chunkKeys.length ? result.summary.resultCount + result.summary.ignoredCount : rows.length
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
  isOptimizationLoading: boolean;
  isResultsLoading: boolean;
  lastOptimizations: unknown[];
  measurementPayBandSize: number;
  measurementPersistenceMeta: MeasurementPersistenceMeta | null;
  resultPayBands: PriceBandRow[];
  resultRows: ComboEvaluationRow[];
  resultSummary: MeasurementResult['summary'];
  runOptimization: () => Promise<void>;
  runResults: (settings?: MeasurementSettings) => Promise<void>;
  summary: Summary;
};
