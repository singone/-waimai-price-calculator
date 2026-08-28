// @ts-nocheck
'use client';

import React from 'react';
import { App as AntApp } from 'antd';
import { currentStoreFrom } from '../../domain/core';
import type {
  CalculatorState,
  MeasurementSettings,
  Store,
  Summary
} from '../../domain/types';
import { EMPTY_SUMMARY } from '../../config/calculation';
import { isCalculationAbortError, runCalculationTask } from '../../workers/calculationClient';
import { productDiscountActivityName, type ProductDiscountSuggestion } from '../shared/productDiscountSuggestionUtils';
import type { CommitCalculatorState } from '../shared/useCalculatorStateCommit';
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
  const [resultWarnings, setResultWarnings] = React.useState<string[]>([]);
  const [isResultsLoading, setIsResultsLoading] = React.useState(false);
  const [isMeasurementCacheLoading, setIsMeasurementCacheLoading] = React.useState(false);
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
    setResultWarnings([]);
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
      setResultWarnings([]);
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
    activeResultWarnings: resultWarnings,
    isMeasurementCacheLoading,
    isResultsLoading,
    measurementPayBandSize,
    measurementPersistenceMeta,
    resultPayBands,
    resultRows,
    resultSummary,
    onApplyProductDiscountSuggestion,
    runResults,
    summary
  };
}
