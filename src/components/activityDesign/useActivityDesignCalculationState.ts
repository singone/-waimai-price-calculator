// @ts-nocheck
'use client';

import React from 'react';
import { App as AntApp } from 'antd';
import { currentStoreFrom } from '../../domain/core';
import type {
  ActivityDesignResult,
  ActivityDesignSettings,
  ActivityRecommendationRow,
  CalculatorState,
  Store,
  Summary
} from '../../domain/types';
import { EMPTY_SUMMARY } from '../../config/calculation';
import { isCalculationAbortError, runCalculationTask } from '../../workers/calculationClient';
import { productDiscountActivityName, type ProductDiscountSuggestion } from '../shared/productDiscountSuggestionUtils';
import type { CommitCalculatorState } from '../shared/useCalculatorStateCommit';
import { buildActivityDesignCalculationSettings } from './activityDesignPageUtils';
import {
  activityDesignDataRepository,
  activityPriceScanRecordToResult,
  buildActivityPriceScanSignature,
  buildLegacyActivityPriceScanSignature,
  expandActivityOriginalBucketCombos,
  mergeActivityRouteValidationResult
} from './activityDesignCalculationUtils';
import { waitForLoadingPaint } from '../results/resultsCalculationUtils';

const ACTIVITY_DESIGN_MAX_DURATION_MS = 1000 * 60 * 5;
const ACTIVITY_DESIGN_WORKER_TIMEOUT_MS = 1000 * 60 * 4;
const ACTIVITY_ROUTE_VALIDATION_MAX_DURATION_MS = 180000;
const ACTIVITY_ROUTE_VALIDATION_WORKER_TIMEOUT_MS = 190000;

type UseActivityDesignCalculationStateParams = {
  calculatorState: CalculatorState;
  store: Store;
  storeActivityDesignSettings: ActivityDesignSettings;
  commitCalculatorState: CommitCalculatorState;
};

type AsyncTask = {
  token: string;
  controller: AbortController;
};

function emptySummary(): Summary {
  return { ...EMPTY_SUMMARY };
}

export function useActivityDesignCalculationState({
  calculatorState,
  store,
  storeActivityDesignSettings,
  commitCalculatorState
}: UseActivityDesignCalculationStateParams) {
  const { message, modal } = AntApp.useApp();
  const calculatorStateRef = React.useRef(calculatorState);
  const activityDesignRef = React.useRef<ActivityDesignResult | null>(null);
  const activityPriceScanPersistenceMetaRef = React.useRef(null);
  const priceScanLoadSeqRef = React.useRef(0);
  const taskSeqRef = React.useRef(0);
  const activeTaskRef = React.useRef<AsyncTask | null>(null);

  const [activityDesign, setActivityDesign] = React.useState<ActivityDesignResult | null>(null);
  const [activityPriceScanPersistenceMeta, setActivityPriceScanPersistenceMeta] = React.useState(null);
  const [summary, setSummary] = React.useState<Summary>(emptySummary);

  calculatorStateRef.current = calculatorState;
  activityDesignRef.current = activityDesign;
  activityPriceScanPersistenceMetaRef.current = activityPriceScanPersistenceMeta;

  const beginTask = React.useCallback(() => {
    activeTaskRef.current?.controller.abort();
    const task = {
      token: `activity-design-${Date.now().toString(36)}-${taskSeqRef.current++}`,
      controller: new AbortController()
    };
    activeTaskRef.current = task;
    return task;
  }, []);

  const isCurrentTask = React.useCallback((task: AsyncTask) => (
    activeTaskRef.current?.token === task.token
  ), []);

  const finishTask = React.useCallback((task: AsyncTask) => {
    if (isCurrentTask(task)) activeTaskRef.current = null;
  }, [isCurrentTask]);

  const clearActivityDesignState = React.useCallback(() => {
    activeTaskRef.current?.controller.abort();
    activeTaskRef.current = null;
    setActivityDesign(null);
    setActivityPriceScanPersistenceMeta(null);
    setSummary(emptySummary());
  }, []);

  React.useEffect(() => {
    const currentScan = activityDesignRef.current;
    const currentMeta = activityPriceScanPersistenceMetaRef.current;
    const hasCurrentStoreScan = Boolean(
      currentScan?.originalPriceBuckets?.length
      && (!currentMeta || currentMeta.storeId === store.id)
    );
    if (hasCurrentStoreScan) return undefined;

    let ignore = false;
    const seq = priceScanLoadSeqRef.current + 1;
    priceScanLoadSeqRef.current = seq;
    const targetStore = store;
    const scanSettings = buildActivityDesignCalculationSettings(
      targetStore,
      storeActivityDesignSettings,
      { calculationMode: 'priceScan' }
    );
    const expectedSignature = buildActivityPriceScanSignature(calculatorState, targetStore, scanSettings);
    const legacyExpectedSignature = buildLegacyActivityPriceScanSignature(calculatorState, targetStore, scanSettings);

    activityDesignDataRepository.loadActivityPriceScanRecord(targetStore.id)
      .then(record => {
        if (
          ignore
          || priceScanLoadSeqRef.current !== seq
          || currentStoreFrom(calculatorStateRef.current).id !== targetStore.id
          || activeTaskRef.current
        ) {
          return;
        }
        if (!record || (record.signature !== expectedSignature && record.signature !== legacyExpectedSignature)) {
          setActivityPriceScanPersistenceMeta(null);
          if (activityPriceScanPersistenceMetaRef.current?.storeId !== targetStore.id) {
            setActivityDesign(current => current?.originalPriceBuckets?.length ? null : current);
          }
          return;
        }
        const result = activityPriceScanRecordToResult(record);
        if (!result.originalPriceBuckets?.length) {
          setActivityPriceScanPersistenceMeta(null);
          return;
        }
        const latestScan = activityDesignRef.current;
        const latestMeta = activityPriceScanPersistenceMetaRef.current;
        if (latestScan?.originalPriceBuckets?.length && (!latestMeta || latestMeta.storeId === targetStore.id)) return;
        setActivityDesign(current => (
          current?.originalPriceBuckets?.length && (!activityPriceScanPersistenceMetaRef.current || activityPriceScanPersistenceMetaRef.current.storeId === targetStore.id)
            ? current
            : result
        ));
        setActivityPriceScanPersistenceMeta(record.meta);
        setSummary(result.summary);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [calculatorState, store, storeActivityDesignSettings]);

  React.useEffect(() => {
    return () => {
      activeTaskRef.current?.controller.abort();
    };
  }, []);

  const executeActivityDesignScan = React.useCallback(async () => {
    if (activeTaskRef.current) return;
    const task = beginTask();
    await waitForLoadingPaint();
    try {
      setActivityDesign(null);
      setActivityPriceScanPersistenceMeta(null);
      setSummary(emptySummary());
      const scanSettings = buildActivityDesignCalculationSettings(store, storeActivityDesignSettings, { calculationMode: 'priceScan' });
      const result = await runCalculationTask('activityDesign', {
        state: calculatorState,
        platformFilter: 'all',
        settings: scanSettings
      }, progress => {
        if (isCurrentTask(task)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        signal: task.controller.signal,
        maxDurationMs: ACTIVITY_DESIGN_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_DESIGN_WORKER_TIMEOUT_MS
      });
      let displayResult: ActivityDesignResult = {
        ...result,
        originalComboRows: [],
        routeSourceRows: []
      };
      if (result.originalPriceBuckets?.length) {
        try {
          const record = await activityDesignDataRepository.saveActivityPriceScanRecord(calculatorState, store, scanSettings, result);
          displayResult = activityPriceScanRecordToResult(record);
          if (isCurrentTask(task)) setActivityPriceScanPersistenceMeta(record.meta);
        } catch {
          if (isCurrentTask(task)) message.warning('原价扫描已生成，但浏览器缓存写入失败。');
        }
      }
      if (!isCurrentTask(task)) return;
      setActivityDesign(displayResult);
      setSummary(displayResult.summary);
    } catch (error) {
      if (!isCalculationAbortError(error) && isCurrentTask(task)) {
        message.error(error instanceof Error ? error.message : '活动设计生成失败。');
      }
    } finally {
      finishTask(task);
    }
  }, [beginTask, calculatorState, finishTask, isCurrentTask, message, store, storeActivityDesignSettings]);

  const executeActivityRouteDesign = React.useCallback(async () => {
    if (activeTaskRef.current) return;
    const currentDesign = activityDesignRef.current;
    if (!currentDesign?.originalPriceBuckets?.length) {
      message.warning('请先生成原价整数扫描结果。');
      return;
    }
    const originalPriceBucketsSnapshot = currentDesign.originalPriceBuckets || [];
    const routeBucketCount = originalPriceBucketsSnapshot.filter(row => row.comboCount > 0).length;
    if (!routeBucketCount) {
      message.warning('当前原价扫描没有可用于生成路线的原价桶。');
      return;
    }
    const task = beginTask();
    setActivityDesign(current => current
      ? { ...current, fullRoutes: [], couponRoutes: [], recommendations: [], payBands: [], hitRows: [], comboRows: [] }
      : current
    );
    await waitForLoadingPaint();
    try {
      setSummary({ resultCount: 0, comboCount: routeBucketCount, validComboCount: routeBucketCount, elapsedTime: null });
      const result = await runCalculationTask('activityDesign', {
        state: calculatorState,
        platformFilter: 'all',
        settings: buildActivityDesignCalculationSettings(store, storeActivityDesignSettings, {
          calculationMode: 'routeDesign',
          originalBandsSnapshot: currentDesign.originalBands,
          originalPriceBucketsSnapshot
        })
      }, progress => {
        if (isCurrentTask(task)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        signal: task.controller.signal,
        maxDurationMs: ACTIVITY_DESIGN_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_DESIGN_WORKER_TIMEOUT_MS
      });
      if (!isCurrentTask(task)) return;
      const displayResult = { ...result, scanComboPools: currentDesign.scanComboPools };
      setActivityDesign(displayResult);
      setSummary(displayResult.summary);
    } catch (error) {
      if (!isCalculationAbortError(error) && isCurrentTask(task)) {
        message.error(error instanceof Error ? error.message : '活动路线生成失败。');
      }
    } finally {
      finishTask(task);
    }
  }, [beginTask, calculatorState, finishTask, isCurrentTask, message, store, storeActivityDesignSettings]);

  const executeActivityDesignRouteValidation = React.useCallback(async (recommendationKey: string, recommendationSnapshot?: ActivityRecommendationRow | null) => {
    if (activeTaskRef.current || !recommendationKey) return;
    const currentDesign = activityDesignRef.current;
    const selectedRecommendationSnapshot = recommendationSnapshot || currentDesign?.recommendations.find(row => row.key === recommendationKey);
    if (!selectedRecommendationSnapshot) {
      message.warning('请先选择有效的满减路线或优惠券路线。');
      return;
    }
    const task = beginTask();
    setActivityDesign(current => current
      ? { ...current, payBands: [], hitRows: [], comboRows: [] }
      : current
    );
    await waitForLoadingPaint();
    try {
      setSummary({ resultCount: currentDesign?.summary.resultCount || 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const result = await runCalculationTask('activityDesign', {
        state: calculatorState,
        platformFilter: selectedRecommendationSnapshot?.platform || 'all',
        settings: buildActivityDesignCalculationSettings(store, storeActivityDesignSettings, {
          calculationMode: 'payValidation',
          selectedRecommendationKey: recommendationKey,
          selectedRecommendationSnapshot,
          originalBandsSnapshot: currentDesign?.originalBands || [],
          originalPriceBucketsSnapshot: currentDesign?.originalPriceBuckets || [],
          scanComboPoolsSnapshot: currentDesign?.scanComboPools
        })
      }, progress => {
        if (isCurrentTask(task)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        signal: task.controller.signal,
        maxDurationMs: ACTIVITY_ROUTE_VALIDATION_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_ROUTE_VALIDATION_WORKER_TIMEOUT_MS
      });
      if (!isCurrentTask(task)) return;
      const mergedResult = mergeActivityRouteValidationResult(currentDesign, result);
      setActivityDesign(mergedResult);
      setSummary(mergedResult.summary);
    } catch (error) {
      if (!isCalculationAbortError(error) && isCurrentTask(task)) {
        message.error(error instanceof Error ? error.message : '活动路线校验失败。');
      }
    } finally {
      finishTask(task);
    }
  }, [beginTask, calculatorState, finishTask, isCurrentTask, message, store, storeActivityDesignSettings]);

  const applyActivityRouteToPlatform = React.useCallback((row: ActivityRecommendationRow) => {
    const fullReductions = row.fullReductionRules.map(rule => ({
      enabled: true,
      threshold: Math.max(0, Number(rule.threshold) || 0),
      amount: Math.max(0, Number(rule.amount) || 0)
    }));
    const coupons = row.couponRules.map(rule => ({
      enabled: true,
      name: rule.name || `建议订单券满${Number(rule.threshold || 0).toFixed(2)}减${Number(rule.amount || 0).toFixed(2)}`,
      threshold: Math.max(0, Number(rule.threshold) || 0),
      amount: Math.max(0, Number(rule.amount) || 0),
      sceneKey: rule.sceneKey,
      sceneName: rule.sceneName,
      channel: rule.channel,
      targetUser: rule.targetUser,
      thresholdMode: rule.thresholdMode,
      usageSuggestion: rule.usageSuggestion
    }));
    if (!fullReductions.length && !coupons.length) {
      message.warning('当前路线没有可应用的满减或优惠券规则。');
      return;
    }
    modal.confirm({
      title: `应用${row.platformName}活动路线`,
      content: `将覆盖当前门店${row.platformName}的满减规则和券列表，其他活动配置保持不变。是否继续？`,
      okText: '应用',
      cancelText: '取消',
      onOk: async () => {
        await commitCalculatorState(draft => {
          const draftStore = currentStoreFrom(draft);
          const current = draftStore.activities[row.platform];
          draftStore.activities[row.platform] = {
            ...current,
            fullReductions,
            coupons
          };
        }, `${row.platformName}活动路线已应用到当前门店。`);
        clearActivityDesignState();
      }
    });
  }, [clearActivityDesignState, commitCalculatorState, message, modal]);

  const applyProductDiscountSuggestion = React.useCallback((suggestion: ProductDiscountSuggestion) => {
    if (suggestion.riskLevel === 'blocked') {
      message.warning('该折扣会打穿最低利润、最低到手价或最低支付价，不能直接应用。');
      return;
    }
    modal.confirm({
      title: `应用${suggestion.platformName}商品折扣`,
      content: `将为「${suggestion.productName}」配置 ${suggestion.discountRate} 折商品折扣。应用后请重新生成测算结果或重新核验路线。`,
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
        clearActivityDesignState();
      }
    });
  }, [clearActivityDesignState, commitCalculatorState, message, modal]);

  const expandOriginalBucketCombos = React.useCallback((design: ActivityDesignResult | null | undefined, bucket) => (
    expandActivityOriginalBucketCombos(design ?? null, bucket ?? null, calculatorState, store, storeActivityDesignSettings)
  ), [calculatorState, store, storeActivityDesignSettings]);

  return {
    activityDesign,
    activityPriceScanPersistenceMeta,
    applyActivityRouteToPlatform,
    applyProductDiscountSuggestion,
    clearActivityDesignState,
    expandActivityOriginalBucketCombos: expandOriginalBucketCombos,
    onRunActivityDesign: executeActivityDesignScan,
    onRunActivityDesignRouteValidation: executeActivityDesignRouteValidation,
    onRunActivityRouteDesign: executeActivityRouteDesign,
    summary
  };
}
