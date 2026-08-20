// @ts-nocheck
'use client';

import React from 'react';
import { App as AntApp } from 'antd';
import {
  bestBaseRed,
  buildFeeSummary,
  buildPlatformTotals,
  calculationStopWarning,
  currentStoreFrom,
  enumerateStoreCombosAsync,
  isInCalculationTotalRange,
  PLATFORMS
} from '../../domain/core';
import { roundMoney } from '../../domain/money';
import type {
  CalculatorState,
  CalculationProgress,
  ComboItem,
  MeasurementSettings,
  Platform,
  ProfitTarget,
  Store,
  Summary
} from '../../domain/types';
import { EMPTY_SUMMARY } from '../../config/calculation';
import { isCalculationAbortError, runCalculationTask } from '../../workers/calculationClient';
import { productDiscountActivityName, type ProductDiscountSuggestion } from '../shared/productDiscountSuggestionUtils';
import type { CommitCalculatorState } from '../shared/useCalculatorStateCommit';
import type { OptimizationRow } from './resultsPageTypes';
import {
  DEFAULT_MEASUREMENT_SETTINGS,
  MEASUREMENT_RESULT_SCENARIO,
  buildMeasurementPersistenceSettings,
  emptyMeasurementSummary,
  measurementChunkKey,
  measurementRecordKey,
  measurementRecordToResult,
  resultsDataRepository,
  waitForLoadingPaint
} from './resultsCalculationUtils';

const ASYNC_CALCULATION_MAX_DURATION_MS = 30000;
const ASYNC_CALCULATION_WORKER_TIMEOUT_MS = 35000;

type UseResultsCalculationStateParams = {
  calculatorState: CalculatorState;
  commitCalculatorState: CommitCalculatorState;
  store: Store;
  storeActivityDesignSettings: {
    stapleMaxCount?: number;
    addOnMaxCount?: number | '';
    payBandSize?: number;
  };
};

type AsyncTask = {
  token: string;
  controller: AbortController;
};

function effectiveProfitTargets(state: CalculatorState, store = currentStoreFrom(state)) {
  return (store.usePlatformTargets ? state.platformRules.profitTargets : store.profitTargets)
    .filter(target => target.enabled)
    .filter(target => target.payMax > 0 && target.rateMax > target.rateMin);
}

function buildProfitMetrics(state: CalculatorState, store: Store, cost: number, finalPay: number) {
  const fee = buildFeeSummary(state, store, finalPay);
  const profit = roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy - cost);
  return {
    profit,
    profitRate: finalPay > 0 ? profit / finalPay : null
  };
}

function findClosestPayForRate(state: CalculatorState, store: Store, cost: number, lower: number, upper: number, targetRate: number) {
  const candidates = [Math.max(0.01, lower), Math.max(0.01, upper)];
  let low = Math.max(0.01, lower);
  let high = Math.max(low, upper);
  for (let index = 0; index < 24; index++) {
    const mid = (low + high) / 2;
    const metrics = buildProfitMetrics(state, store, cost, mid);
    candidates.push(mid);
    if (metrics.profitRate === null) break;
    if (metrics.profitRate < targetRate) low = mid;
    else high = mid;
  }

  let best: { pay: number; distance: number } | null = null;
  for (const candidate of candidates) {
    const pay = roundMoney(candidate);
    const metrics = buildProfitMetrics(state, store, cost, pay);
    if (!Number.isFinite(metrics.profitRate)) continue;
    const distance = Math.abs((metrics.profitRate as number) - targetRate);
    if (!best || distance < best.distance) best = { pay, distance };
  }
  return best ? best.pay : null;
}

function splitSuggestedDiscount(discount: number, basis: number, redThreshold: number) {
  const total = roundMoney(Math.max(0, discount));
  if (total <= 0) return { fullAmount: 0, couponAmount: 0, redAddAmount: 0, total: 0 };
  const redAddAmount = redThreshold > 0 && basis >= redThreshold ? roundMoney(total * 0.35) : 0;
  const remain = roundMoney(total - redAddAmount);
  const couponAmount = roundMoney(remain * 0.35);
  const fullAmount = roundMoney(remain - couponAmount);
  return { fullAmount, couponAmount, redAddAmount, total };
}

function evaluateOptimizationBase(state: CalculatorState, store: Store, platform: Platform, qtys: number[]) {
  const totals = buildPlatformTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (totals.afterProductDiscount + 1e-9 < store.startPrice) return null;
  const baseRed = bestBaseRed(state, platform, totals.afterProductDiscount);
  const basePay = Math.max(0, roundMoney(totals.afterProductDiscount - baseRed.amount));
  if (basePay <= 0) return null;
  return {
    platform,
    platformName: platform === 'meituan' ? '美团' : '饿了么',
    items: totals.items,
    afterProductDiscount: totals.afterProductDiscount,
    cost: totals.costTotal,
    baseRed,
    basePay
  };
}

async function runOptimizationCalculationAsync(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  onProgress?: (progress: CalculationProgress) => void
) {
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const store = currentStoreFrom(state);
  const targets = effectiveProfitTargets(state, store);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const rows: Array<{
    platform: Platform;
    platformName: string;
    fullThreshold: number;
    fullAmount: number;
    couponThreshold: number;
    couponAmount: number;
    redAddThreshold: number;
    redAddAmount: number;
    target: ProfitTarget;
    score: number;
    finalPay: number;
    profitRate: number | null;
    items: ComboItem[];
  }> = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: 'maxChecks' | 'maxDuration' | undefined;

  function collectOptimizationRows(platform: Platform, qtys: number[]) {
    const base = evaluateOptimizationBase(state, store, platform, qtys);
    if (!base) return;
    for (const target of targets) {
      const lower = Math.max(0.01, Number(target.payMin) || 0);
      const upper = Math.min(Number(target.payMax) || base.basePay, base.basePay);
      if (upper < lower) continue;
      const midRate = ((Number(target.rateMin) || 0) + (Number(target.rateMax) || 0)) / 200;
      const desiredPay = findClosestPayForRate(state, store, base.cost, lower, upper, midRate);
      if (desiredPay === null) continue;
      const merchantDiscount = roundMoney(base.basePay - desiredPay);
      if (merchantDiscount < 0) continue;
      const split = splitSuggestedDiscount(merchantDiscount, base.afterProductDiscount, base.baseRed.threshold);
      const finalPay = Math.max(0, roundMoney(base.basePay - split.total));
      const metrics = buildProfitMetrics(state, store, base.cost, finalPay);
      if (metrics.profitRate === null) continue;
      rows.push({
        platform,
        platformName: base.platformName,
        fullThreshold: base.afterProductDiscount,
        fullAmount: split.fullAmount,
        couponThreshold: base.afterProductDiscount,
        couponAmount: split.couponAmount,
        redAddThreshold: base.baseRed.threshold,
        redAddAmount: split.redAddAmount,
        target,
        score: Math.abs(metrics.profitRate - midRate),
        finalPay,
        profitRate: metrics.profitRate,
        items: base.items
      });
    }
  }

  await new Promise<void>(resolve => setTimeout(resolve, 0));
  if (store.products.length && targets.length) {
    for (const platform of platforms) {
      const checkedBeforePlatform = checked;
      const validBeforePlatform = validCombos;
      const enumeration = await enumerateStoreCombosAsync(
        store,
        [platform],
        qtys => collectOptimizationRows(platform, qtys),
        progress => onProgress?.({
          resultCount: rows.length,
          comboCount: checkedBeforePlatform + progress.checked,
          validComboCount: validBeforePlatform + progress.validCombos
        }),
        { maxDurationMs: ASYNC_CALCULATION_MAX_DURATION_MS }
      );
      checked += enumeration.checked;
      validCombos += enumeration.validCombos;
      stopped = stopped || enumeration.stopped;
      stoppedReason = stoppedReason || enumeration.stoppedReason;
      if (stoppedReason === 'maxDuration') break;
    }
  }

  const grouped = new Map<string, OptimizationRow>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const key = [
      row.platform,
      row.fullThreshold,
      row.fullAmount,
      row.couponThreshold,
      row.couponAmount,
      row.redAddThreshold,
      row.redAddAmount,
      row.target.payMin,
      row.target.payMax
    ].join('::');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        platform: row.platform,
        platformName: row.platformName,
        full: { enabled: true, threshold: row.fullThreshold, amount: row.fullAmount },
        coupon: { enabled: true, threshold: row.couponThreshold, amount: row.couponAmount, name: '建议订单券' },
        redAddOn: { enabled: true, threshold: row.redAddThreshold, amount: row.redAddAmount },
        target: row.target,
        coverage: 1,
        score: row.score,
        finalPay: row.finalPay,
        profitRate: row.profitRate,
        example: { items: row.items, finalPay: row.finalPay, profitRate: row.profitRate, score: row.score }
      });
    } else {
      const nextCoverage = existing.coverage + 1;
      existing.score = (existing.score * existing.coverage + row.score) / nextCoverage;
      existing.finalPay = (existing.finalPay * existing.coverage + row.finalPay) / nextCoverage;
      existing.profitRate = ((existing.profitRate || 0) * existing.coverage + (row.profitRate || 0)) / nextCoverage;
      existing.coverage = nextCoverage;
      if (row.score > existing.example.score) existing.example = { items: row.items, finalPay: row.finalPay, profitRate: row.profitRate, score: row.score };
    }
    if (index > 0 && index % 1000 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  const optimizations = Array.from(grouped.values()).sort((a, b) => a.score - b.score || a.finalPay - b.finalPay);
  const stopWarning = calculationStopWarning({ stopped, stoppedReason }, store.maxChecks, ASYNC_CALCULATION_MAX_DURATION_MS);
  return {
    optimizations,
    summary: {
      resultCount: optimizations.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start)
    },
    warnings: stopWarning ? [stopWarning] : []
  };
}

export function useResultsCalculationState({
  calculatorState,
  commitCalculatorState,
  store,
  storeActivityDesignSettings
}: UseResultsCalculationStateParams) {
  const { message, modal } = AntApp.useApp();
  const calculatorStateRef = React.useRef(calculatorState);
  const taskSeqRef = React.useRef(0);
  const activeMeasurementTaskRef = React.useRef<AsyncTask | null>(null);
  const lastMeasurementSettingsRef = React.useRef<MeasurementSettings>(DEFAULT_MEASUREMENT_SETTINGS);

  const measurementPayBandSize = Math.max(1, Math.floor(Number(storeActivityDesignSettings.payBandSize) || 5));
  const [resultRows, setResultRows] = React.useState([]);
  const [resultPayBands, setResultPayBands] = React.useState([]);
  const [measurementPersistenceMeta, setMeasurementPersistenceMeta] = React.useState(null);
  const [lastOptimizations, setLastOptimizations] = React.useState<OptimizationRow[]>([]);
  const [resultWarnings, setResultWarnings] = React.useState<string[]>([]);
  const [optimizationWarnings, setOptimizationWarnings] = React.useState<string[]>([]);
  const [isResultsLoading, setIsResultsLoading] = React.useState(false);
  const [isMeasurementCacheLoading, setIsMeasurementCacheLoading] = React.useState(false);
  const [isOptimizationLoading, setIsOptimizationLoading] = React.useState(false);
  const [resultSummary, setResultSummary] = React.useState(emptyMeasurementSummary);
  const [summary, setSummary] = React.useState<Summary>({ ...EMPTY_SUMMARY });

  calculatorStateRef.current = calculatorState;

  const beginMeasurementTask = React.useCallback(() => {
    activeMeasurementTaskRef.current?.controller.abort();
    const task = {
      token: `measurement-${Date.now().toString(36)}-${taskSeqRef.current++}`,
      controller: new AbortController()
    };
    activeMeasurementTaskRef.current = task;
    return task;
  }, []);

  const isCurrentMeasurementTask = React.useCallback((task: AsyncTask) => (
    activeMeasurementTaskRef.current?.token === task.token
  ), []);

  const clearResults = React.useCallback(() => {
    setResultRows([]);
    setResultPayBands([]);
    setMeasurementPersistenceMeta(null);
    setLastOptimizations([]);
    setResultWarnings([]);
    setOptimizationWarnings([]);
    setResultSummary(emptyMeasurementSummary());
    setSummary({ ...EMPTY_SUMMARY });
  }, []);

  React.useEffect(() => {
    let ignore = false;
    const storeId = store.id;
    setIsMeasurementCacheLoading(true);
    resultsDataRepository.loadMeasurementRecord(storeId, MEASUREMENT_RESULT_SCENARIO)
      .then(record => {
        if (ignore || storeId !== currentStoreFrom(calculatorStateRef.current).id) return;
        if (!record) {
          clearResults();
          return;
        }
        const result = measurementRecordToResult(record, measurementPayBandSize);
        setResultRows(result.rows);
        setResultWarnings(result.warnings);
        setResultSummary(result.summary);
        setSummary(result.summary);
        setMeasurementPersistenceMeta(record.meta);
        setResultPayBands(result.payBands);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!ignore) setIsMeasurementCacheLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [clearResults, measurementPayBandSize, store.id]);

  React.useEffect(() => {
    return () => {
      activeMeasurementTaskRef.current?.controller.abort();
    };
  }, []);

  const runResults = React.useCallback(async (settings: MeasurementSettings = DEFAULT_MEASUREMENT_SETTINGS) => {
    if (isResultsLoading) return;
    lastMeasurementSettingsRef.current = { ...settings };
    const task = beginMeasurementTask();
    const scenario = MEASUREMENT_RESULT_SCENARIO;
    const persistenceSettings = buildMeasurementPersistenceSettings(store, settings, storeActivityDesignSettings);
    const parentKey = measurementRecordKey(store.id, scenario);
    setIsResultsLoading(true);
    await waitForLoadingPaint();
    try {
      const previousRecord = await resultsDataRepository.loadMeasurementRecord(store.id, scenario);
      const chunkWriter = resultsDataRepository.createMeasurementChunkWriter(parentKey);
      setResultRows([]);
      setResultPayBands([]);
      setLastOptimizations([]);
      setResultWarnings([]);
      setOptimizationWarnings([]);
      setResultSummary(emptyMeasurementSummary());
      setSummary({ ...EMPTY_SUMMARY });
      const result = await runCalculationTask('measurement', {
        state: calculatorState,
        platformFilter: 'all',
        settings: persistenceSettings
      }, progress => {
        if (isCurrentMeasurementTask(task)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        signal: task.controller.signal,
        maxDurationMs: ASYNC_CALCULATION_MAX_DURATION_MS,
        timeoutMs: ASYNC_CALCULATION_WORKER_TIMEOUT_MS,
        onRowsChunk: rows => chunkWriter.write(rows)
      });
      const record = await resultsDataRepository.saveChunkedMeasurementRecord(store, scenario, persistenceSettings, result, chunkWriter.keys());
      await resultsDataRepository.deleteMeasurementRecordChunks(previousRecord);
      if (!isCurrentMeasurementTask(task)) return;
      const displayResult = measurementRecordToResult(record, measurementPayBandSize);
      setMeasurementPersistenceMeta(record.meta);
      setResultRows(displayResult.rows);
      setResultPayBands(displayResult.payBands);
      setResultWarnings(displayResult.warnings);
      setResultSummary(displayResult.summary);
      setSummary(displayResult.summary);
    } catch (error) {
      if (!isCalculationAbortError(error) && isCurrentMeasurementTask(task)) {
        message.error(error instanceof Error ? error.message : '测算结果生成失败。');
      }
    } finally {
      if (isCurrentMeasurementTask(task)) {
        setIsResultsLoading(false);
        activeMeasurementTaskRef.current = null;
      }
    }
  }, [beginMeasurementTask, calculatorState, isCurrentMeasurementTask, isResultsLoading, measurementPayBandSize, message, store, storeActivityDesignSettings]);

  const runOptimization = React.useCallback(async () => {
    if (isOptimizationLoading) return;
    setIsOptimizationLoading(true);
    await waitForLoadingPaint();
    try {
      setLastOptimizations([]);
      setOptimizationWarnings([]);
      setSummary({ ...EMPTY_SUMMARY });
      const result = await runOptimizationCalculationAsync(calculatorState, 'all', progress => {
        setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
      });
      setLastOptimizations(result.optimizations);
      setOptimizationWarnings(result.warnings);
      setSummary(result.summary);
    } finally {
      setIsOptimizationLoading(false);
    }
  }, [calculatorState, isOptimizationLoading]);

  const onApplyProductDiscountSuggestion = React.useCallback((suggestion: ProductDiscountSuggestion) => {
    if (suggestion.riskLevel === 'blocked') {
      message.warning('该折扣会打穿最低利润、最低到手价或最低支付价，不能直接应用。');
      return;
    }
    modal.confirm({
      title: `应用${suggestion.platformName}商品折扣`,
      content: `将为「${suggestion.productName}」配置 ${suggestion.discountRate} 折商品折扣。应用后请重新生成测算结果查看结果。`,
      okText: '应用折扣',
      cancelText: '取消',
      onOk: async () => {
        await commitCalculatorState(draft => {
          const draftStore = currentStoreFrom(draft);
          const activities = draftStore.activities[suggestion.platform];
          const discountActivity = {
            enabled: true,
            name: productDiscountActivityName(suggestion),
            productNames: suggestion.productName,
            discountRate: suggestion.discountRate,
            itemLimit: suggestion.itemLimit
          };
          const currentRows = Array.isArray(activities.discountActivities) ? activities.discountActivities : [];
          const existingIndex = currentRows.findIndex(row => (
            String(row.productNames || '').trim() === suggestion.productName ||
            row.name === productDiscountActivityName(suggestion)
          ));
          activities.discountActivities = existingIndex >= 0
            ? currentRows.map((row, index) => index === existingIndex ? discountActivity : row)
            : [discountActivity, ...currentRows];
        }, `${suggestion.platformName}「${suggestion.productName}」商品折扣已应用。`);
        clearResults();
      }
    });
  }, [clearResults, commitCalculatorState, message, modal]);

  return {
    activeResultWarnings: [...resultWarnings, ...optimizationWarnings],
    isMeasurementCacheLoading,
    isOptimizationLoading,
    isResultsLoading,
    lastOptimizations,
    measurementPayBandSize,
    measurementPersistenceMeta,
    resultPayBands,
    resultRows,
    resultSummary,
    onApplyProductDiscountSuggestion,
    runOptimization,
    runResults,
    summary
  };
}
