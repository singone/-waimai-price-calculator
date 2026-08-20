// @ts-nocheck
'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { App as AntApp, Button, Card, Checkbox, Col, Input, InputNumber, Modal, Row, Space, Spin, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import { tablePagination } from '../../utils/table';
import { EMPTY_SUMMARY, MEASUREMENT_DETAIL_ROW_LIMIT } from '../../config/calculation';
import { comboStapleServingCount, PLATFORM_NAMES, PLATFORMS, summarizePriceBands as summarizeDomainPriceBands } from '../../domain/core';
import { roundMoney } from '../../domain/money';
import { PayBandAnalysisPanel } from '../shared/PayBandAnalysisPanel';
import { ProductDiscountSuggestionSection } from '../shared/ProductDiscountSuggestionSection';
import { useCalculatorStateCommit } from '../shared/useCalculatorStateCommit';
import { useStoreActivityDesignSettings } from '../shared/useStoreActivityDesignSettings';
import { downloadCsv } from '../../utils/csv';
import { dateTimeText, money, rateText } from '../../utils/format';
import { calculationRangeText } from '../../utils/storeDisplay';
import {
  comboPackageFeeTotal,
  itemsText,
  paymentGrossRate,
  riskColor,
  riskLabel
} from '../shared/comboDisplayUtils';
import type {
  ComboEvaluationRow,
  ComboItem,
  Coupon,
  FullReduction,
  MeasurementSettings,
  MeasurementResult,
  Platform,
  PriceBandRow,
  ProfitTarget,
  RedAddOn,
  Summary,
  Store
} from '../../domain/types';
import type {
  LoadedResultBandRows,
  OptimizationRow,
  ResultPlatformView,
  SelectedResultBand,
  SelectedResultProduct
} from './resultsPageTypes';
import { useResultsCalculationState } from './useResultsCalculationState';
import {
  DEFAULT_MEASUREMENT_SETTINGS,
  MEASUREMENT_RESULT_SCENARIO,
  buildMeasurementSummaryFromRows,
  isMeasurementRowInDisplayFilters,
  resultsDataRepository
} from './resultsCalculationUtils';

const AntvLine = dynamic(() => import('@ant-design/charts').then(mod => mod.Line), { ssr: false });
const { Text, Title } = Typography;

type AnyRecord = Record<string, any>;

export type ResultsPageProps = AnyRecord;

function createPlatformPayBandKeys(): Record<Platform, string> {
  return { meituan: 'all', eleme: 'all' };
}

function sortResultRows(rows: ComboEvaluationRow[]) {
  return rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.finalPay - b.finalPay || a.originalTotal - b.originalTotal || a.key.localeCompare(b.key));
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ResultsPage(pageProps: ResultsPageProps = {}) {
    const props = pageProps;
    const { message } = AntApp.useApp();
    const {
    calculatorState,
    setCalculatorState,
    store
  } = props;
  const commitCalculatorState = useCalculatorStateCommit(calculatorState, setCalculatorState);
  const storeActivityDesignSettings = useStoreActivityDesignSettings(calculatorState, store);
  const {
    activeResultWarnings,
    isMeasurementCacheLoading,
    isOptimizationLoading,
    isResultsLoading,
    lastOptimizations,
    measurementPayBandSize,
    measurementPersistenceMeta,
    onApplyProductDiscountSuggestion,
    resultPayBands: rawResultPayBands,
    resultRows: rawResultRows,
    resultSummary: rawResultSummary,
    runOptimization,
    runResults,
    summary
  } = useResultsCalculationState({
    calculatorState,
    commitCalculatorState,
    store,
    storeActivityDesignSettings
  });
  const [measurementSettings, setMeasurementSettings] = React.useState<MeasurementSettings>(DEFAULT_MEASUREMENT_SETTINGS);
  const [resultPlatformTab, setResultPlatformTab] = React.useState<Platform>('meituan');
  const [riskOnly, setRiskOnly] = React.useState(false);
  const [selectedResultPayBandKeys, setSelectedResultPayBandKeys] = React.useState<Record<Platform, string>>(createPlatformPayBandKeys);
  const [selectedResultBand, setSelectedResultBand] = React.useState<SelectedResultBand | null>(null);
  const [selectedResultProduct, setSelectedResultProduct] = React.useState<SelectedResultProduct | null>(null);
  const [resultDetailSearchText, setResultDetailSearchText] = React.useState('');
  const [resultProductPayRange, setResultProductPayRange] = React.useState<[number, number] | null>(null);
  const [loadedResultBandRows, setLoadedResultBandRows] = React.useState<LoadedResultBandRows | null>(null);
  const [isResultBandLoading, setIsResultBandLoading] = React.useState(false);
  const resultBandLoadSeqRef = React.useRef(0);

  function metricCards(metricSummary: Summary) {
    return (
    <Row gutter={[12, 12]}>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">结果组合</Text><Title level={3}>{metricSummary.resultCount}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">检查组合</Text><Title level={3}>{metricSummary.comboCount}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">合法组合</Text><Title level={3}>{metricSummary.validComboCount}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">耗时</Text><Title level={3}>{metricSummary.elapsedTime === null ? '-' : `${metricSummary.elapsedTime}ms`}</Title></Card></Col>
    </Row>
    );
  }
    const sourceResultRows = rawResultRows as ComboEvaluationRow[] || [];
    const storedResultPayBands = rawResultPayBands as PriceBandRow[] || [];
    const storedResultSummary = rawResultSummary as MeasurementResult['summary'] || { ...EMPTY_SUMMARY };
    const filteredResultRows = React.useMemo(
      () => sourceResultRows.filter(row => isMeasurementRowInDisplayFilters(row, store, measurementSettings)),
      [measurementSettings, sourceResultRows, store]
    );
    const activeResultPayBands = React.useMemo(() => {
      if (!filteredResultRows.length && storedResultPayBands.length) {
        const payMin = Math.max(0, Number(measurementSettings.payMin) || 0);
        const payMax = measurementSettings.payMax === '' ? Infinity : Math.max(payMin, Number(measurementSettings.payMax) || 0);
        return storedResultPayBands.filter(row => row.max > payMin + 1e-9 && row.min < payMax - 1e-9);
      }
      return summarizeDomainPriceBands(filteredResultRows.filter(row => !row.ignored), measurementPayBandSize, 'pay', { groupByScenario: false });
    }, [filteredResultRows, measurementPayBandSize, measurementSettings.payMax, measurementSettings.payMin, storedResultPayBands]);
    const activeResultSummary = isResultsLoading ? summary : (
      !filteredResultRows.length && storedResultPayBands.length
        ? storedResultSummary
        : buildMeasurementSummaryFromRows(filteredResultRows, storedResultSummary.elapsedTime)
    );
    const resultPayBandRows = activeResultPayBands as PriceBandRow[] || [];
    const resultRows = filteredResultRows as ComboEvaluationRow[] || [];
    const resultOptimizations = lastOptimizations as OptimizationRow[] || [];
    const resultPlatformViews = React.useMemo(() => {
      return PLATFORMS.reduce((views, platform) => {
        const payBands = resultPayBandRows.filter(row => row.platform === platform);
        const selectedPayBandKey = selectedResultPayBandKeys[platform] || 'all';
        const selectedPayBand = payBands.find(row => row.key === selectedPayBandKey) || null;
        const platformRows = resultRows.filter(row => row.platform === platform);
        const payBandRows = selectedPayBand
          ? platformRows.filter(row => (
            row.finalPay + 1e-9 >= selectedPayBand.min
            && row.finalPay < selectedPayBand.max - 1e-9
          ))
          : platformRows;
        const riskRows = payBandRows
          .filter(row => row.risk?.hasRisk)
          .sort((a, b) => (b.risk?.severityRank || 0) - (a.risk?.severityRank || 0));
        views[platform] = {
          platform,
          platformName: PLATFORM_NAMES[platform],
          payBands,
          selectedPayBandKey,
          selectedPayBand,
          platformRows,
          payBandRows,
          productRows: payBandRows,
          riskRows,
          visibleRows: riskOnly ? riskRows : payBandRows
        };
        return views;
      }, {} as Record<Platform, ResultPlatformView>);
    }, [resultPayBandRows, resultRows, riskOnly, selectedResultPayBandKeys]);
    const activeResultPlatformView = resultPlatformViews[resultPlatformTab] || resultPlatformViews.meituan;
    const selectedResultBandView = selectedResultBand ? resultPlatformViews[selectedResultBand.platform] : null;
    const selectedResultBandKey = selectedResultBand?.payBandKey || 'all';
    const selectedResultBandPayBand = selectedResultBandView && selectedResultBandKey !== 'all'
      ? selectedResultBandView.payBands.find(row => row.key === selectedResultBandKey) || null
      : null;
    const selectedResultBandRows = React.useMemo(() => {
      if (!selectedResultBand || !selectedResultBandView) return [];
      if (
        loadedResultBandRows
        && loadedResultBandRows.platform === selectedResultBand.platform
        && loadedResultBandRows.payBandKey === selectedResultBandKey
      ) {
        return loadedResultBandRows.rows;
      }
      const baseRows = selectedResultBandPayBand
        ? selectedResultBandView.platformRows.filter(row => (
          row.finalPay + 1e-9 >= selectedResultBandPayBand.min
          && row.finalPay < selectedResultBandPayBand.max - 1e-9
        ))
        : selectedResultBandView.platformRows;
      return sortResultRows(baseRows.slice());
    }, [loadedResultBandRows, selectedResultBand, selectedResultBandKey, selectedResultBandPayBand, selectedResultBandView]);
    const selectedResultBandFilteredRows = React.useMemo(() => {
      const keyword = resultDetailSearchText.trim().toLowerCase();
      if (!keyword) return selectedResultBandRows;
      return selectedResultBandRows.filter(row => row.items.some(item => item.name.toLowerCase().includes(keyword)));
    }, [resultDetailSearchText, selectedResultBandRows]);
    const selectedResultBandRiskRows = React.useMemo(() => {
      return selectedResultBandFilteredRows
        .filter(row => row.risk?.hasRisk)
        .sort((a, b) => (b.risk?.severityRank || 0) - (a.risk?.severityRank || 0));
    }, [selectedResultBandFilteredRows]);
    const selectedResultProductRows = React.useMemo(() => {
      if (!selectedResultProduct) return [];
      const productView = resultPlatformViews[selectedResultProduct.platform];
      const productPayBand = selectedResultProduct.payBandKey !== 'all'
        ? productView.payBands.find(row => row.key === selectedResultProduct.payBandKey) || null
        : null;
      const chunkLoadedRows = selectedResultBand
        && selectedResultBand.platform === selectedResultProduct.platform
        && selectedResultBand.payBandKey === selectedResultProduct.payBandKey
        ? selectedResultBandRows
        : [];
      const sourceRows = chunkLoadedRows.length ? chunkLoadedRows : productView.platformRows;
      const baseRows = productPayBand && !chunkLoadedRows.length
        ? productView.platformRows.filter(row => (
          row.finalPay + 1e-9 >= productPayBand.min
          && row.finalPay < productPayBand.max - 1e-9
        ))
        : sourceRows;
      return baseRows
        .filter(row => row.items.some(item => item.productId === selectedResultProduct.productId))
        .sort((a, b) => a.finalPay - b.finalPay || a.profit - b.profit || a.originalTotal - b.originalTotal);
    }, [resultPlatformViews, selectedResultBand, selectedResultBandRows, selectedResultProduct]);
    const selectedResultProductPayBounds = React.useMemo(() => {
      if (!selectedResultProductRows.length) return null;
      let min = selectedResultProductRows[0].finalPay;
      let max = selectedResultProductRows[0].finalPay;
      selectedResultProductRows.forEach(row => {
        min = Math.min(min, row.finalPay);
        max = Math.max(max, row.finalPay);
      });
      return { min: roundMoney(min), max: roundMoney(max) };
    }, [roundMoney, selectedResultProductRows]);
    const selectedResultProductFilteredRows = React.useMemo(() => {
      if (!resultProductPayRange || !selectedResultProductPayBounds) return selectedResultProductRows;
      const min = clampNumber(Math.min(resultProductPayRange[0], resultProductPayRange[1]), selectedResultProductPayBounds.min, selectedResultProductPayBounds.max);
      const max = clampNumber(Math.max(resultProductPayRange[0], resultProductPayRange[1]), selectedResultProductPayBounds.min, selectedResultProductPayBounds.max);
      return selectedResultProductRows.filter(row => row.finalPay + 1e-9 >= min && row.finalPay <= max + 1e-9);
    }, [resultProductPayRange, selectedResultProductPayBounds, selectedResultProductRows]);
    const selectedResultProductChartRows = React.useMemo(() => {
      return selectedResultProductRows.flatMap((row, index) => {
        const actualRate = row.netProfitRate === null ? null : roundMoney(row.netProfitRate * 100);
        const targetRate = roundMoney(row.targetNetRate * 100);
        const gap = actualRate === null ? null : roundMoney(actualRate - targetRate);
        const isOutlier = gap !== null && Math.abs(gap) >= 5;
        const base = {
          rowKey: row.key,
          index: index + 1,
          finalPay: roundMoney(row.finalPay),
          comboLabel: itemsText(row.items),
          platformName: row.platformName,
          gap,
          isOutlier
        };
        return [
          {
            ...base,
            key: `${row.key}-actual`,
            metric: '实际利润率',
            rate: actualRate
          },
          {
            ...base,
            key: `${row.key}-target`,
            metric: '目标利润率',
            rate: targetRate,
            isOutlier: false
          }
        ].filter(item => item.rate !== null);
      });
    }, [roundMoney, selectedResultProductRows]);
    const selectedResultProductTableRows = React.useMemo(() => {
      return selectedResultProductFilteredRows.map((row, index) => ({
        ...row,
        index: index + 1,
        profitRateGapAmount: row.netProfitRate === null ? null : row.netProfitRate - row.targetNetRate
      }));
    }, [selectedResultProductFilteredRows]);
    const selectedResultProductStats = React.useMemo(() => {
      let minProfit: number | null = null;
      let maxProfit: number | null = null;
      for (const row of selectedResultProductFilteredRows) {
        minProfit = minProfit === null ? row.profit : Math.min(minProfit, row.profit);
        maxProfit = maxProfit === null ? row.profit : Math.max(maxProfit, row.profit);
      }
      return {
        minFinalPay: selectedResultProductFilteredRows[0]?.finalPay ?? null,
        minProfit,
        maxProfit
      };
    }, [selectedResultProductFilteredRows]);
    React.useEffect(() => {
      setSelectedResultPayBandKeys(createPlatformPayBandKeys());
      setSelectedResultBand(null);
      setSelectedResultProduct(null);
      setResultDetailSearchText('');
      setResultProductPayRange(null);
      setLoadedResultBandRows(null);
    }, [store.id]);
    React.useEffect(() => {
      setLoadedResultBandRows(null);
      setSelectedResultProduct(null);
      setResultProductPayRange(null);
    }, [measurementSettings.originalMin, measurementSettings.originalMax, measurementSettings.payMin, measurementSettings.payMax, store.id]);
    React.useEffect(() => {
      if (!isResultsLoading) return;
      setSelectedResultPayBandKeys(createPlatformPayBandKeys());
      setSelectedResultBand(null);
      setSelectedResultProduct(null);
      setResultDetailSearchText('');
      setResultProductPayRange(null);
      setLoadedResultBandRows(null);
    }, [isResultsLoading]);
    const measurementSummary = activeResultSummary as MeasurementResult['summary'];
    const updateResultPayBandKey = (platform: Platform, key: string) => {
      setSelectedResultPayBandKeys(prev => ({
        ...prev,
        [platform]: key
      }));
    };
    const loadResultBandRows = React.useCallback(async (platform: Platform, payBandKey: string, payBand: PriceBandRow | null): Promise<LoadedResultBandRows | null> => {
      const record = await resultsDataRepository.loadMeasurementRecord(store.id, MEASUREMENT_RESULT_SCENARIO);
      if (!record) return null;
      const loaded = await resultsDataRepository.loadMeasurementRows(record, {
        store,
        settings: measurementSettings,
        platform,
        payBand,
        limit: MEASUREMENT_DETAIL_ROW_LIMIT
      });
      return {
        platform,
        payBandKey,
        rows: loaded.rows,
        matchedCount: loaded.matchedCount,
        truncated: loaded.truncated
      };
    }, [measurementSettings, store]);
    const openResultBandDetail = async (platform: Platform, payBandKey: string) => {
      const payBand = payBandKey === 'all'
        ? null
        : resultPayBandRows.find(row => row.platform === platform && row.key === payBandKey) || null;
      setSelectedResultBand({ platform, payBandKey });
      setResultDetailSearchText('');
      setSelectedResultProduct(null);
      setResultProductPayRange(null);
      setLoadedResultBandRows(null);
      const seq = resultBandLoadSeqRef.current + 1;
      resultBandLoadSeqRef.current = seq;
      setIsResultBandLoading(true);
      try {
        const loaded = await loadResultBandRows(platform, payBandKey, payBand);
        if (resultBandLoadSeqRef.current !== seq || !loaded) return;
        setLoadedResultBandRows(loaded);
      } catch (error) {
        if (resultBandLoadSeqRef.current === seq) {
          message.error(error instanceof Error ? error.message : '读取区间明细失败。');
        }
      } finally {
        if (resultBandLoadSeqRef.current === seq) setIsResultBandLoading(false);
      }
    };
    const exportResults = () => {
      const view = activeResultPlatformView;
      const ok = downloadCsv(`${store.name}_${view.platformName}_组合测算.csv`, view.visibleRows.map(row => ({
        平台: row.platformName,
        商品组合: itemsText(row.items),
        主食份数: comboStapleServingCount(row.items),
        原价合计含打包费: money(row.originalTotal),
        打包费合计: money(comboPackageFeeTotal(row.items)),
        商品折扣后: money(row.afterProductDiscount),
        用户实付: money(row.finalPay),
        商家到手价: money(row.netPay),
        成本: money(row.cost),
        活动金额: money(row.activityAmount),
        通用佣金: money(row.commission),
        外卖服务费: money(row.serviceFee),
        运费补贴: money(row.freightSubsidy),
        利润: money(row.profit),
        支付毛利率: rateText(paymentGrossRate(row)),
        实付利润率: rateText(row.profitRate),
        到手利润率: rateText(row.netProfitRate),
        商品折扣: money(row.productDiscount),
        满减: row.full.amount ? `满${money(row.full.threshold)}减${money(row.full.amount)}` : '',
        优惠券: row.coupons.map(c => `${c.name}-${money(c.amount)}`).join('|'),
        基础红包: money(row.baseRed.amount),
        红包加码: money(row.redAddOn.amount),
        风险: row.risk?.reasons.join('|') || ''
      })));
      if (!ok) message.warning('没有可导出的结果。');
    };
    const renderComboProductTags = (row: ComboEvaluationRow) => (
      <Space wrap>
        {row.items.map(item => (
          <Tag
            key={`${item.productId}-${item.qty}`}
            className="clickable-tag"
            onClick={event => {
              event.stopPropagation();
              setResultProductPayRange(null);
              setSelectedResultProduct({
                platform: row.platform,
                payBandKey: selectedResultBand?.platform === row.platform ? selectedResultBand.payBandKey : 'all',
                productId: item.productId,
                productName: item.name
              });
            }}
          >
            {item.name} x {item.qty}
          </Tag>
        ))}
      </Space>
    );
    const resultColumns: TableColumnsType<ComboEvaluationRow> = [
      { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left', sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
      { title: '商品组合', dataIndex: 'items', width: 300, fixed: 'left', render: (_, row) => renderComboProductTags(row) },
      { title: '主食份数', dataIndex: 'items', width: 95, render: items => comboStapleServingCount(items as ComboItem[]), sorter: (a, b) => comboStapleServingCount(a.items) - comboStapleServingCount(b.items) },
      { title: '状态', width: 115, render: (_, row) => row.ignored ? <Tag color="default">已忽略</Tag> : row.risk?.hasRisk ? <Tag color={riskColor(row.risk)}>{riskLabel(row.risk)}</Tag> : <Tag color="green">正常</Tag>, sorter: (a, b) => (a.risk?.severityRank || 0) - (b.risk?.severityRank || 0) },
      { title: '原价', dataIndex: 'originalTotal', width: 95, sorter: (a, b) => a.originalTotal - b.originalTotal, render: value => `¥${money(value)}` },
      { title: '用户实付', dataIndex: 'finalPay', width: 105, sorter: (a, b) => a.finalPay - b.finalPay, render: value => `¥${money(value)}` },
      { title: '商家到手', dataIndex: 'netPay', width: 105, sorter: (a, b) => a.netPay - b.netPay, render: value => `¥${money(value)}` },
      { title: '成本', dataIndex: 'cost', width: 95, sorter: (a, b) => a.cost - b.cost, render: value => `¥${money(value)}` },
      { title: '支付毛利率', width: 110, sorter: (a, b) => (paymentGrossRate(a) || 0) - (paymentGrossRate(b) || 0), render: (_, row) => rateText(paymentGrossRate(row)) },
      { title: '活动金额', dataIndex: 'activityAmount', width: 105, sorter: (a, b) => a.activityAmount - b.activityAmount, render: value => `¥${money(value)}` },
      { title: '利润', dataIndex: 'profit', width: 90, sorter: (a, b) => a.profit - b.profit, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '到手利润率', dataIndex: 'netProfitRate', width: 110, sorter: (a, b) => (a.netProfitRate || 0) - (b.netProfitRate || 0), render: value => rateText(value as number | null) },
      { title: '实付利润率', dataIndex: 'profitRate', width: 110, sorter: (a, b) => (a.profitRate || 0) - (b.profitRate || 0), render: value => rateText(value as number | null) },
      { title: '利润空间', dataIndex: 'profitSpace', width: 105, sorter: (a, b) => a.profitSpace - b.profitSpace, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '利润偏差', dataIndex: 'profitRateGap', width: 105, sorter: (a, b) => (a.profitRateGap || 0) - (b.profitRateGap || 0), render: value => rateText(value as number | null) },
      {
        title: '优惠明细',
        width: 300,
        render: (_, row) => {
          const redName = row.platform === 'meituan' ? '神券' : '爆红包';
          return <Text type="secondary">商品折扣¥{money(row.productDiscount)} / 满减¥{money(row.full.amount)} / 券¥{money(row.couponAmount)} / {redName}¥{money(row.baseRed.amount)} / {redName}加码¥{money(row.redAddOn.amount)}</Text>;
        }
      },
      { title: '异常原因', dataIndex: 'risk', width: 240, render: (_, row) => row.ignored ? row.ignoreReason : (row.risk?.reasons || []).join('，') }
    ];
    const riskColumns: TableColumnsType<ComboEvaluationRow> = [
      { title: '等级', dataIndex: 'risk', width: 80, fixed: 'left', render: risk => <Tag color={riskColor(risk)}>{riskLabel(risk)}</Tag>, sorter: (a, b) => (a.risk?.severityRank || 0) - (b.risk?.severityRank || 0) },
      { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left' },
      { title: '商品组合', dataIndex: 'items', width: 300, fixed: 'left', render: (_, row) => renderComboProductTags(row) },
      { title: '主食份数', dataIndex: 'items', width: 95, render: items => comboStapleServingCount(items as ComboItem[]) },
      { title: '实付', dataIndex: 'finalPay', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.finalPay - b.finalPay },
      { title: '到手', dataIndex: 'netPay', width: 90, render: value => `¥${money(value)}` },
      { title: '成本', dataIndex: 'cost', width: 90, render: value => `¥${money(value)}` },
      { title: '利润', dataIndex: 'profit', width: 90, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '到手利润率', dataIndex: 'netProfitRate', width: 110, render: value => rateText(value as number | null) },
      { title: '利润空间', dataIndex: 'profitSpace', width: 95, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '触发原因', dataIndex: 'risk', render: risk => (risk?.reasons || []).join('，') }
    ];
    const optimizationColumns: TableColumnsType<OptimizationRow> = [
      { title: '平台', dataIndex: 'platformName', width: 80 },
      { title: '覆盖组合', dataIndex: 'coverage', width: 100, sorter: (a, b) => a.coverage - b.coverage },
      { title: '目标阶梯', dataIndex: 'target', width: 180, render: target => `实付${money((target as ProfitTarget).payMin)}-${money((target as ProfitTarget).payMax)} / ${money((target as ProfitTarget).rateMin)}%-${money((target as ProfitTarget).rateMax)}%` },
      { title: '建议满减', dataIndex: 'full', render: full => `满${money((full as FullReduction).threshold)}减${money((full as FullReduction).amount)}` },
      { title: '建议优惠券', dataIndex: 'coupon', render: coupon => `满${money((coupon as Coupon).threshold)}减${money((coupon as Coupon).amount)}` },
      { title: '建议加码', dataIndex: 'redAddOn', render: red => `门槛${money((red as RedAddOn).threshold)} / 加码${money((red as RedAddOn).amount)}` },
      { title: '平均实付', dataIndex: 'finalPay', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.finalPay - b.finalPay },
      { title: '平均利润率', dataIndex: 'profitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.profitRate || 0) - (b.profitRate || 0) },
      { title: '示例组合', dataIndex: 'example', render: example => itemsText((example as OptimizationRow['example']).items) }
    ];
    const priceBandColumns: TableColumnsType<PriceBandRow> = [
      { title: '平台', dataIndex: 'platformName', width: 80, sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
      { title: '场景', dataIndex: 'scenarioName', width: 80, render: value => <Tag color="blue">{String(value || '-')}</Tag> },
      { title: '区间', dataIndex: 'label', width: 105, sorter: (a, b) => a.min - b.min },
      { title: '组合数', dataIndex: 'comboCount', width: 90, sorter: (a, b) => a.comboCount - b.comboCount },
      { title: '平均原价', dataIndex: 'avgOriginalTotal', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgOriginalTotal - b.avgOriginalTotal },
      { title: '平均支付价', dataIndex: 'avgFinalPay', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgFinalPay - b.avgFinalPay },
      { title: '平均成本', dataIndex: 'avgCost', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgCost - b.avgCost },
      { title: '平均利润', dataIndex: 'avgProfit', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.avgProfit - b.avgProfit },
      { title: '最低利润', dataIndex: 'minProfit', width: 105, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.minProfit ?? 0) - (b.minProfit ?? 0) },
      { title: '最高利润', dataIndex: 'maxProfit', width: 105, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.maxProfit ?? 0) - (b.maxProfit ?? 0) },
      { title: '平均利润率', dataIndex: 'avgProfitRate', width: 115, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitRate || 0) - (b.avgProfitRate || 0) },
      { title: '利润率范围', width: 135, render: (_, row) => row.minProfitRate === null ? '-' : `${rateText(row.minProfitRate)} - ${rateText(row.maxProfitRate)}` },
      { title: '异常数', dataIndex: 'riskCount', width: 85, sorter: (a, b) => a.riskCount - b.riskCount },
      { title: '建议', dataIndex: 'suggestion', width: 220, render: value => <Text className="table-text-wrap">{String(value || '')}</Text> }
    ];
    const renderResultPlatformPanel = (view: ResultPlatformView) => {
      const platformOptimizations = resultOptimizations.filter(row => row.platform === view.platform);
      const platformRowCount = view.platformRows.length || view.payBands.reduce((sum, row) => sum + row.comboCount, 0);
      const platformRiskCount = view.platformRows.length
        ? view.platformRows.filter(row => row.risk?.hasRisk).length
        : view.payBands.reduce((sum, row) => sum + row.riskCount, 0);
      return (
        <div className="section-stack result-platform-panel">
          <PayBandAnalysisPanel
            title="支付价区间分析"
            chartTitle={`${view.platformName}支付价区间`}
            platformName={view.platformName}
            payBands={view.payBands}
            selectedPayBandKey={view.selectedPayBandKey}
            rowCount={platformRowCount}
            riskCount={platformRiskCount}
            loading={isResultsLoading || isMeasurementCacheLoading}
            columns={priceBandColumns}
            money={money}
            pagination={tablePagination(20)}
            onSelectPayBand={key => {
              updateResultPayBandKey(view.platform, key);
              void openResultBandDetail(view.platform, key);
            }}
          />
          <ProductDiscountSuggestionSection
            rows={view.platformRows}
            source="measurementResult"
            title="商品维度合理成本结论"
            limit={50}
            includeNeutral
            description="商品结论按当前平台全部测算组合计算：主商品用活动合理成本和当前成本比较判断降价或涨价空间；凑单品只校验按原价占比分摊的到手价是否覆盖成本。"
            money={money}
            onApply={onApplyProductDiscountSuggestion}
          />
          <Card title="旧版最优活动建议">
            <Table loading={isOptimizationLoading} rowKey="key" size="small" columns={optimizationColumns} dataSource={platformOptimizations} pagination={tablePagination(20)} scroll={{ x: 1280 }} />
          </Card>
        </div>
      );
    };
    return (
      <div className="section-stack">
        <Spin spinning={isMeasurementCacheLoading} tip="正在读取测算缓存">
          <Card title="组合测算" extra={
            <Space wrap>
              <Button type="primary" loading={isResultsLoading} onClick={() => runResults(measurementSettings)}>生成组合结果</Button>
              <Checkbox checked={riskOnly} onChange={e => setRiskOnly(e.target.checked)}>只看预警组合</Checkbox>
              <Button loading={isOptimizationLoading} onClick={runOptimization}>测算最优活动</Button>
              <Button icon={<DownloadOutlined />} onClick={exportResults}>导出结果CSV</Button>
            </Space>
          }>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">基于当前已维护的商品价格和门店活动生成组合，并持久化保存最大覆盖结果；原价和支付价条件会在已保存列表中筛选展示。</Text>
              <Card size="small" title="持久化结果筛选">
                <Row gutter={[12, 12]}>
                  <Col xs={12} md={4}>
                    <div className="field">
                      <Text type="secondary">原价筛选最低</Text>
                      <InputNumber min={0} precision={2} value={measurementSettings.originalMin} onChange={value => setMeasurementSettings(prev => ({ ...prev, originalMin: Number(value) || 0 }))} />
                    </div>
                  </Col>
                  <Col xs={12} md={4}>
                    <div className="field">
                      <Text type="secondary">原价筛选最高</Text>
                      <InputNumber min={0} precision={2} placeholder="空=门店上限" value={measurementSettings.originalMax === '' ? null : measurementSettings.originalMax} onChange={value => setMeasurementSettings(prev => ({ ...prev, originalMax: value === null ? '' : Number(value) || 0 }))} />
                    </div>
                  </Col>
                  <Col xs={12} md={4}>
                    <div className="field">
                      <Text type="secondary">支付价筛选最低</Text>
                      <InputNumber min={0} precision={2} value={measurementSettings.payMin} onChange={value => setMeasurementSettings(prev => ({ ...prev, payMin: Number(value) || 0 }))} />
                    </div>
                  </Col>
                  <Col xs={12} md={4}>
                    <div className="field">
                      <Text type="secondary">支付价筛选最高</Text>
                      <InputNumber min={0} precision={2} placeholder="空=不限" value={measurementSettings.payMax === '' ? null : measurementSettings.payMax} onChange={value => setMeasurementSettings(prev => ({ ...prev, payMax: value === null ? '' : Number(value) || 0 }))} />
                    </div>
                  </Col>
                  <Col xs={12} md={5}>
                    <Checkbox checked={measurementSettings.ignoreOutOfPayRange} onChange={event => setMeasurementSettings(prev => ({ ...prev, ignoreOutOfPayRange: event.target.checked }))}>生成时保留超出支付价组合</Checkbox>
                  </Col>
                  <Col xs={24} md={12}>
                    <div className="field-value">门店原价边界 {calculationRangeText(store)}，饭团最多 {storeActivityDesignSettings.stapleMaxCount ?? 2} 份，凑单小吃最多 {storeActivityDesignSettings.addOnMaxCount === '' ? '不限' : `${storeActivityDesignSettings.addOnMaxCount} 件`}，支付价区间步长 {measurementPayBandSize}</div>
                  </Col>
                  <Col xs={24} md={10}>
                    <div className="field-value">
                      {measurementPersistenceMeta
                        ? `已保存 ${measurementPersistenceMeta.rowCount} 条，最大原价 ${measurementPersistenceMeta.originalMax === null ? '不限' : `¥${money(measurementPersistenceMeta.originalMax)}`}，保存时间 ${dateTimeText(measurementPersistenceMeta.generatedAt)}`
                        : '暂无持久化测算结果'}
                    </div>
                  </Col>
                </Row>
              </Card>
              {metricCards(activeResultSummary)}
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">忽略组合</Text><Title level={3}>{measurementSummary.ignoredCount || 0}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">风险组合</Text><Title level={3}>{measurementSummary.riskCount || 0}</Title></Card></Col>
              </Row>
              {activeResultWarnings.length ? <Card size="small">{activeResultWarnings.map(item => <Text key={item} type="warning">{item}</Text>)}</Card> : null}
            </Space>
          </Card>
          <Tabs
            className="result-platform-tabs"
            activeKey={resultPlatformTab}
            destroyOnHidden
            onChange={key => setResultPlatformTab(key as Platform)}
            items={PLATFORMS.map(platform => ({
              key: platform,
              label: PLATFORM_NAMES[platform],
              children: renderResultPlatformPanel(resultPlatformViews[platform])
            }))}
          />
        </Spin>
        <Modal
          title={selectedResultBandView ? `${selectedResultBandView.platformName} / ${selectedResultBandPayBand ? `¥${selectedResultBandPayBand.label}` : '全部支付价区间'} 明细` : '区间明细'}
          open={Boolean(selectedResultBand)}
          width={1280}
          footer={null}
          destroyOnHidden
          onCancel={() => {
            setSelectedResultBand(null);
            setResultDetailSearchText('');
            setLoadedResultBandRows(null);
          }}
        >
          {selectedResultBandView ? (
            <Spin spinning={isResultBandLoading} tip="正在读取区间明细">
              <Space direction="vertical" style={{ width: '100%' }} size="middle">
                <Space wrap>
                  <Input.Search
                    allowClear
                    style={{ width: 320 }}
                    placeholder="搜索商品名称"
                    value={resultDetailSearchText}
                    onChange={event => setResultDetailSearchText(event.target.value)}
                  />
                  <Text type="secondary">
                    组合 {selectedResultBandFilteredRows.length} 条，风险 {selectedResultBandRiskRows.length} 条
                    {loadedResultBandRows?.truncated ? `，当前区间命中 ${loadedResultBandRows.matchedCount} 条，已加载前 ${MEASUREMENT_DETAIL_ROW_LIMIT} 条` : ''}
                  </Text>
                </Space>
                <Tabs
                  destroyOnHidden
                  items={[
                    {
                      key: 'details',
                      label: '组合明细',
                      children: (
                        <Table
                          loading={isResultsLoading || isResultBandLoading}
                          rowClassName={row => row.ignored ? 'risk-config' : row.risk?.hasRisk ? `risk-${row.risk.severity}` : ''}
                          rowKey="key"
                          size="small"
                          columns={resultColumns}
                          dataSource={riskOnly ? selectedResultBandRiskRows : selectedResultBandFilteredRows}
                          pagination={tablePagination(30)}
                          scroll={{ x: 2010 }}
                          tableLayout="fixed"
                        />
                      )
                    },
                    {
                      key: 'risks',
                      label: '风险预警',
                      children: (
                        <Table
                          loading={isResultsLoading || isResultBandLoading}
                          rowClassName={row => row.risk?.hasRisk ? `risk-${row.risk.severity}` : ''}
                          rowKey="key"
                          size="small"
                          columns={riskColumns}
                          dataSource={selectedResultBandRiskRows}
                          pagination={tablePagination(20)}
                          scroll={{ x: 1400 }}
                          tableLayout="fixed"
                        />
                      )
                    }
                  ]}
                />
              </Space>
            </Spin>
          ) : null}
        </Modal>
        <Modal
          title={selectedResultProduct ? `${selectedResultProduct.productName} 相关组合` : '商品相关组合'}
          open={Boolean(selectedResultProduct)}
          width={1200}
          footer={null}
          onCancel={() => {
            setSelectedResultProduct(null);
            setResultProductPayRange(null);
          }}
        >
          {selectedResultProduct ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">相关组合</Text><Title level={4}>{selectedResultProductFilteredRows.length}/{selectedResultProductRows.length}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">最低实付</Text><Title level={4}>{selectedResultProductStats.minFinalPay === null ? '-' : `¥${money(selectedResultProductStats.minFinalPay)}`}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">最低利润</Text><Title level={4}>{selectedResultProductStats.minProfit === null ? '-' : `¥${money(selectedResultProductStats.minProfit)}`}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">最高利润</Text><Title level={4}>{selectedResultProductStats.maxProfit === null ? '-' : `¥${money(selectedResultProductStats.maxProfit)}`}</Title></Card></Col>
              </Row>
              <ProductDiscountSuggestionSection
                rows={selectedResultProductFilteredRows}
                source="measurementResult"
                title="当前商品合理成本结论"
                productId={selectedResultProduct.productId}
                limit={1}
                includeNeutral
                description="这里只展示当前商品在已筛选相关组合中的活动合理成本结论，用于追溯全局商品结论。"
                money={money}
                onApply={onApplyProductDiscountSuggestion}
              />
              {selectedResultProductChartRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={selectedResultProductChartRows}
                    height={280}
                    autoFit
                    xField="finalPay"
                    yField="rate"
                    colorField="metric"
                    shapeField="smooth"
                    axis={{
                      x: { title: '用户实付价', labelFormatter: (value: number | string) => `¥${money(value)}` },
                      y: { title: '到手利润率', labelFormatter: (value: number | string) => `${money(value)}%` }
                    }}
                    scale={{
                      x: { nice: true },
                      color: { range: ['#496f5d', '#d95b18'] }
                    }}
                    slider={{
                      x: {
                        labelFormatter: (value: number | string) => `¥${money(value)}`
                      }
                    }}
                    onEvent={(_, event: { type?: string; data?: { selection?: unknown[] } }) => {
                      if (event.type !== 'sliderX:filter') return;
                      const selection = event.data?.selection?.[0];
                      if (!Array.isArray(selection) || selection.length < 2) return;
                      const min = Number(selection[0]);
                      const max = Number(selection[1]);
                      if (!Number.isFinite(min) || !Number.isFinite(max)) return;
                      const nextRange: [number, number] = [roundMoney(Math.min(min, max)), roundMoney(Math.max(min, max))];
                      setResultProductPayRange(prev => (
                        prev && prev[0] === nextRange[0] && prev[1] === nextRange[1]
                          ? prev
                          : nextRange
                      ));
                    }}
                    point={{
                      sizeField: (datum: { isOutlier?: boolean; metric?: string }) => datum.isOutlier && datum.metric === '实际利润率' ? 6 : 3.5,
                      style: (datum: { isOutlier?: boolean; metric?: string }) => ({
                        fill: datum.isOutlier && datum.metric === '实际利润率' ? '#d4380d' : '#fff',
                        stroke: datum.isOutlier && datum.metric === '实际利润率' ? '#d4380d' : undefined,
                        lineWidth: datum.isOutlier && datum.metric === '实际利润率' ? 2 : 1
                      })
                    }}
                    tooltip={{
                      title: (datum: { comboLabel?: string }) => datum.comboLabel || '',
                      items: [
                        { field: 'metric', name: '指标' },
                        { field: 'finalPay', name: '用户实付', valueFormatter: (value: number) => `¥${money(value)}` },
                        { field: 'rate', name: '利润率', valueFormatter: (value: number | null) => value === null ? '-' : `${money(value)}%` },
                        { field: 'gap', name: '目标偏差', valueFormatter: (value: number | null) => value === null ? '-' : `${money(value)}%` }
                      ]
                    }}
                  />
                </div>
              ) : <div className="chart-empty">暂无相关组合数据</div>}
              <Table
                rowKey="key"
                size="small"
                columns={resultColumns}
                dataSource={selectedResultProductTableRows}
                pagination={tablePagination(20)}
                scroll={{ x: 2010 }}
                tableLayout="fixed"
              />
            </Space>
          ) : null}
        </Modal>
      </div>
    );
  }
