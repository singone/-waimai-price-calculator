import type {
  CalculatorState,
  CalculationLimits,
  CalculationProgress,
  ComboEvaluationRow,
  MeasurementResult,
  MeasurementSettings,
  PriceBandRow,
  Platform
} from '../types';
import {
  bandKey,
  buildProductFilter,
  calculationNow,
  calculationTotalRange,
  calculationStopWarning,
  currentStoreFrom,
  evaluateComboWithCurrentActivities,
  isProductListedOnPlatform,
  normalizeCalculationMaxDuration,
  platformOriginalUnitPrice,
  PLATFORMS,
  productStapleServingCount,
  summarizePriceBands
} from '../core';
import {
  buildSeparatedComboPoolsAsync,
  candidatePoolSignature,
  mergeComboQtys
} from '../comboPools';
import { roundMoney } from '../money';

type MeasurementCandidate = {
  index: number;
  price: number;
  stapleCount: number;
};

type MeasurementRowsChunkHandler = (rows: ComboEvaluationRow[]) => void;

type PayBandAccumulator = {
  key: string;
  label: string;
  min: number;
  max: number;
  platform: Platform;
  platformName: string;
  scenario: ComboEvaluationRow['scenario'];
  comboCount: number;
  originalTotalSum: number;
  finalPaySum: number;
  netPaySum: number;
  costSum: number;
  profitSum: number;
  profitSpaceSum: number;
  profitRateSum: number;
  profitRateCount: number;
  minProfit: number | null;
  maxProfit: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  lowCount: number;
  riskCount: number;
};

const MEASUREMENT_RESULT_CHUNK_SIZE = 1000;

function measurementOriginalRange(store: ReturnType<typeof currentStoreFrom>, settings: MeasurementSettings) {
  const storeRange = calculationTotalRange(store);
  const filterMin = Math.max(0, Number(settings.originalMin) || 0);
  const rawFilterMax = settings.originalMax === '' ? Infinity : Math.max(filterMin, Number(settings.originalMax) || 0);
  return {
    min: Math.max(storeRange.min, filterMin),
    max: Math.min(storeRange.max, rawFilterMax)
  };
}

function isMealMainCandidate(store: ReturnType<typeof currentStoreFrom>, platform: Platform, index: number) {
  const product = store.products[index];
  if (!isProductListedOnPlatform(product, platform) || product.nonStandalone) return false;
  return product.category === 'staple' || product.category === 'setMeal' || productStapleServingCount(product) > 0;
}

function buildMeasurementCandidates(store: ReturnType<typeof currentStoreFrom>, platform: Platform) {
  const mainProducts: MeasurementCandidate[] = [];
  const addOnProducts: MeasurementCandidate[] = [];
  store.products.forEach((product, index) => {
    if (!isProductListedOnPlatform(product, platform)) return;
    const price = platformOriginalUnitPrice(product, platform);
    const stapleCount = isMealMainCandidate(store, platform, index)
      ? Math.max(1, productStapleServingCount(product))
      : 0;
    const row = { index, price, stapleCount };
    if (isMealMainCandidate(store, platform, index)) {
      mainProducts.push(row);
      return;
    }
    if (productStapleServingCount(product) <= 0) addOnProducts.push(row);
  });
  const byPrice = (a: MeasurementCandidate, b: MeasurementCandidate) => a.price - b.price || a.index - b.index;
  return {
    mainProducts: mainProducts.sort(byPrice),
    addOnProducts: addOnProducts.sort(byPrice)
  };
}

function measurementStapleMaxCount(settings: MeasurementSettings) {
  return Math.max(1, Math.floor(Number(settings.stapleMaxCount ?? settings.multiStapleCount) || 3));
}

function ensureUniqueComboRowKeys(rows: ComboEvaluationRow[]) {
  const seen = new Map<string, number>();
  return rows.map(row => {
    const count = seen.get(row.key) || 0;
    seen.set(row.key, count + 1);
    return count === 0 ? row : { ...row, key: `${row.key}::dup:${count}` };
  });
}

function createMeasurementPayBandAccumulators() {
  const groups = new Map<string, PayBandAccumulator>();
  return {
    add(row: ComboEvaluationRow, payBandSize: number) {
      if (row.ignored) return;
      const band = bandKey(row.finalPay, payBandSize);
      const key = ['pay', row.platform, band.key].join('::');
      const current = groups.get(key) || {
        key,
        label: band.label,
        min: band.min,
        max: band.max,
        platform: row.platform,
        platformName: row.platformName,
        scenario: row.scenario,
        comboCount: 0,
        originalTotalSum: 0,
        finalPaySum: 0,
        netPaySum: 0,
        costSum: 0,
        profitSum: 0,
        profitSpaceSum: 0,
        profitRateSum: 0,
        profitRateCount: 0,
        minProfit: null,
        maxProfit: null,
        minProfitRate: null,
        maxProfitRate: null,
        lowCount: 0,
        riskCount: 0
      } satisfies PayBandAccumulator;
      current.comboCount++;
      current.originalTotalSum += row.originalTotal;
      current.finalPaySum += row.finalPay;
      current.netPaySum += row.netPay;
      current.costSum += row.cost;
      current.profitSum += row.profit;
      current.profitSpaceSum += row.profitSpace;
      current.minProfit = current.minProfit === null ? row.profit : Math.min(current.minProfit, row.profit);
      current.maxProfit = current.maxProfit === null ? row.profit : Math.max(current.maxProfit, row.profit);
      if (row.netProfitRate !== null) {
        current.profitRateSum += row.netProfitRate;
        current.profitRateCount++;
        current.minProfitRate = current.minProfitRate === null ? row.netProfitRate : Math.min(current.minProfitRate, row.netProfitRate);
        current.maxProfitRate = current.maxProfitRate === null ? row.netProfitRate : Math.max(current.maxProfitRate, row.netProfitRate);
      }
      if (row.profitSpace < -1e-9 || (row.netProfitRate !== null && row.netProfitRate + 1e-9 < row.targetNetRate)) current.lowCount++;
      if (row.risk.hasRisk) current.riskCount++;
      groups.set(key, current);
    },
    rows(): PriceBandRow[] {
      return Array.from(groups.values()).map(group => {
        const avgProfitRate = group.profitRateCount ? group.profitRateSum / group.profitRateCount : null;
        const avgProfitSpace = group.comboCount ? group.profitSpaceSum / group.comboCount : 0;
        const suggestion = avgProfitSpace < -1e-9
          ? '活动穿透，需收紧优惠或调价'
          : group.lowCount > 0
            ? '存在低利润组合，需查看明细'
            : avgProfitRate !== null && group.maxProfitRate !== null && group.minProfitRate !== null && group.maxProfitRate - group.minProfitRate > 0.12
              ? '同价位利润离散，建议收拢'
              : avgProfitSpace > 1
                ? '存在可释放活动空间'
                : '结构正常';
        return {
          key: group.key,
          label: group.label,
          min: group.min,
          max: group.max,
          platform: group.platform,
          platformName: group.platformName,
          scenario: group.scenario,
          scenarioName: '全部组合',
          comboCount: group.comboCount,
          ignoredCount: 0,
          avgOriginalTotal: group.comboCount ? group.originalTotalSum / group.comboCount : 0,
          avgFinalPay: group.comboCount ? group.finalPaySum / group.comboCount : 0,
          avgNetPay: group.comboCount ? group.netPaySum / group.comboCount : 0,
          avgCost: group.comboCount ? group.costSum / group.comboCount : 0,
          avgProfit: group.comboCount ? roundMoney(group.profitSum / group.comboCount) : 0,
          minProfit: group.minProfit,
          maxProfit: group.maxProfit,
          avgProfitRate,
          minProfitRate: group.minProfitRate,
          maxProfitRate: group.maxProfitRate,
          avgProfitSpace,
          lowCount: group.lowCount,
          riskCount: group.riskCount,
          suggestion
        };
      }).sort((a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') || a.min - b.min);
    }
  };
}

async function enumerateMeasurementCombosByOriginalAsync(
  store: ReturnType<typeof currentStoreFrom>,
  platform: Platform,
  settings: MeasurementSettings,
  maxDurationMs: number,
  startedAt: number,
  visit: (qtys: number[]) => void,
  onProgress?: (summary: { checked: number; validCombos: number; stopped: boolean; stoppedReason?: 'maxChecks' | 'maxDuration' }) => void
) {
  const range = measurementOriginalRange(store, settings);
  const minStapleCount = 1;
  const maxStapleCount = measurementStapleMaxCount(settings);
  const maxItems = Math.max(0, Math.floor(Number(store.maxItems) || 0));
  const maxQtyPerSku = Math.max(0, Math.floor(Number(store.maxQtyPerSku) || 0));
  const maxChecks = Math.max(1, Math.floor(Number(store.maxChecks) || 0));
  const addOnMaxCountSetting = settings.addOnMaxCount === ''
    ? maxItems
    : Math.max(0, Math.floor(Number(settings.addOnMaxCount) || 0));
  const addOnMaxCountLimit = Math.min(maxItems, addOnMaxCountSetting);
  const { mainProducts, addOnProducts } = buildMeasurementCandidates(store, platform);
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: 'maxChecks' | 'maxDuration' | undefined;
  let visitedNodes = 0;
  let lastYieldAt = calculationNow();
  let lastProgressAt = calculationNow();

  function stop(reason: NonNullable<typeof stoppedReason>) {
    stopped = true;
    stoppedReason = reason;
  }

  function stopIfNeeded(now = calculationNow()) {
    if (!stopped && now - startedAt >= maxDurationMs) stop('maxDuration');
    return stopped;
  }

  async function maybeYield(force = false) {
    visitedNodes++;
    const now = calculationNow();
    if (stopIfNeeded(now)) return;
    const shouldYield = force || visitedNodes % 600 === 0 || now - lastYieldAt >= 16;
    if (!shouldYield) return;
    lastYieldAt = now;
    if (onProgress && now - lastProgressAt >= 120) {
      lastProgressAt = now;
      onProgress({ checked, validCombos, stopped, stoppedReason });
    }
    await new Promise<void>(resolve => setTimeout(resolve, 0));
  }

  function recordCombo(qtys: number[], originalTotal: number) {
    if (stopped) return;
    if (originalTotal > range.max + 1e-9) return;
    checked++;
    if (checked > maxChecks) {
      stop('maxChecks');
      return;
    }
    if (originalTotal + 1e-9 < range.min) return;
    validCombos++;
    visit(qtys.slice());
  }

  const poolCacheKey = [
    'measurement',
    platform,
    store.products.length,
    maxQtyPerSku,
    maxItems,
    minStapleCount,
    maxStapleCount,
    addOnMaxCountLimit,
    range.max,
    candidatePoolSignature(mainProducts),
    candidatePoolSignature(addOnProducts)
  ].join('::');
  const pools = await buildSeparatedComboPoolsAsync({
    cacheKey: poolCacheKey,
    productCount: store.products.length,
    mainProducts,
    addOnProducts,
    maxQtyPerSku,
    maxItems,
    minStapleCount,
    maxStapleCount,
    maxAddOnCount: addOnMaxCountLimit,
    maxOriginalTotal: range.max,
    shouldStop: () => stopped,
    maybeYield
  });

  for (const base of pools.mainCombos) {
    if (stopped) break;
    if (base.originalTotal > range.max + 1e-9) break;
    const maxAddOnCount = Math.min(Math.max(0, maxItems - base.totalQty), addOnMaxCountLimit);
    for (let addOnCount = 0; addOnCount <= maxAddOnCount; addOnCount++) {
      if (stopped) break;
      const addOnCombos = pools.addOnCombosByCount[addOnCount] || [];
      for (const addOn of addOnCombos) {
        await maybeYield();
        if (stopped) break;
        const originalTotal = base.originalTotal + addOn.originalTotal;
        if (originalTotal > range.max + 1e-9) break;
        recordCombo(mergeComboQtys(store.products.length, base, addOn), originalTotal);
      }
    }
  }

  onProgress?.({ checked, validCombos, stopped, stoppedReason });
  return { checked, validCombos, stopped, stoppedReason };
}

export async function runMeasurementCalculation(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: MeasurementSettings,
  onProgress?: (progress: CalculationProgress) => void,
  limits?: CalculationLimits,
  onRowsChunk?: MeasurementRowsChunkHandler
): Promise<MeasurementResult> {
  const startedAt = calculationNow();
  const maxDurationMs = normalizeCalculationMaxDuration(limits?.maxDurationMs);
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const rows: ComboEvaluationRow[] = [];
  const chunkRows: ComboEvaluationRow[] = [];
  const seenRowKeys = new Map<string, number>();
  const payBandAccumulators = createMeasurementPayBandAccumulators();
  const payBandSize = Math.max(1, Number(settings.payBandSize) || 5);
  const shouldStreamRows = Boolean(onRowsChunk);
  let checked = 0;
  let validCombos = 0;
  let activeRowCount = 0;
  let ignoredCount = 0;
  let riskCount = 0;
  let stopped = false;
  let stoppedReason: 'maxChecks' | 'maxDuration' | undefined;

  function makeUniqueRow(row: ComboEvaluationRow) {
    const count = seenRowKeys.get(row.key) || 0;
    seenRowKeys.set(row.key, count + 1);
    return count === 0 ? row : { ...row, key: `${row.key}::dup:${count}` };
  }

  function flushRowsChunk() {
    if (!onRowsChunk || !chunkRows.length) return;
    onRowsChunk(chunkRows.splice(0, chunkRows.length));
  }

  function appendRow(row: ComboEvaluationRow) {
    const uniqueRow = makeUniqueRow(row);
    if (uniqueRow.ignored) {
      ignoredCount++;
    } else {
      activeRowCount++;
      if (uniqueRow.risk.hasRisk) riskCount++;
      payBandAccumulators.add(uniqueRow, payBandSize);
    }
    if (shouldStreamRows) {
      chunkRows.push(uniqueRow);
      if (chunkRows.length >= MEASUREMENT_RESULT_CHUNK_SIZE) flushRowsChunk();
      return;
    }
    rows.push(uniqueRow);
  }

  for (const platform of platforms) {
    const elapsed = calculationNow() - startedAt;
    if (elapsed >= maxDurationMs) {
      stopped = true;
      stoppedReason = 'maxDuration';
      break;
    }
    const platformStartedAt = calculationNow();
    const checkedBefore = checked;
    const validBefore = validCombos;
    const enumeration = await enumerateMeasurementCombosByOriginalAsync(
      store,
      platform,
      settings,
      maxDurationMs - elapsed,
      platformStartedAt,
      qtys => {
        const evaluatedRows = evaluateComboWithCurrentActivities(state, store, platform, qtys, settings);
        for (const row of evaluatedRows) appendRow(row);
      },
      progress => onProgress?.({
        resultCount: rows.filter(row => !row.ignored).length,
        comboCount: checkedBefore + progress.checked,
        validComboCount: validBefore + progress.validCombos
      })
    );
    checked += enumeration.checked;
    validCombos += enumeration.validCombos;
    stopped = stopped || enumeration.stopped;
    stoppedReason = stoppedReason || enumeration.stoppedReason;
    if (stoppedReason === 'maxDuration') break;
  }

  const stopWarning = calculationStopWarning({ stopped, stoppedReason }, store.maxChecks, maxDurationMs);
  if (stopWarning) warnings.push(stopWarning);

  flushRowsChunk();
  const sortedRows = shouldStreamRows
    ? []
    : ensureUniqueComboRowKeys(rows.sort((a, b) => a.finalPay - b.finalPay || a.originalTotal - b.originalTotal));
  const activeRows = shouldStreamRows ? [] : sortedRows.filter(row => !row.ignored);
  const finalIgnoredCount = shouldStreamRows ? ignoredCount : sortedRows.length - activeRows.length;
  const finalRiskCount = shouldStreamRows ? riskCount : activeRows.filter(row => row.risk.hasRisk).length;

  return {
    rows: sortedRows,
    payBands: shouldStreamRows
      ? payBandAccumulators.rows()
      : summarizePriceBands(activeRows, payBandSize, 'pay', { groupByScenario: false }),
    warnings,
    summary: {
      resultCount: shouldStreamRows ? activeRowCount : activeRows.length,
      comboCount: checked,
      validComboCount: validCombos,
      ignoredCount: finalIgnoredCount,
      riskCount: finalRiskCount,
      elapsedTime: Math.round(calculationNow() - startedAt)
    }
  };
}

export { buildProductFilter };
