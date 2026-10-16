// @ts-nocheck
'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { App as AntApp, Button, Card, Col, DatePicker, Input, Row, Select, Space, Table, Tag, Tooltip, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { normalizeProductList } from '../../data/calculatorState';
import type { Product } from '../../domain/types';
import { downloadCsv } from '../../utils/csv';
import { money, rateText } from '../../utils/format';
import { uploadProps } from '../../utils/upload';
import { useCalculatorPageProps } from '../shared/CalculatorContext';
import {
  aggregateProductAnalysisByPeriod,
  buildProductAnalysisRows,
  buildProductAnalysisTrendRows,
  importProductAnalysisFileToState,
  loadProductAnalysisState,
  normalizeProductAnalysisDate,
  normalizeProductAnalysisDateRange,
  normalizeProductAnalysisState,
  productAnalysisDateRangeText,
  productAnalysisExportRows,
  productAnalysisImportedAtText,
  productAnalysisRecordsOverlapRange,
  productAnalysisSegmentColor,
  reliabilityText,
  saveProductAnalysisState,
  summarizeProductAnalysisRecords,
  type ProductAnalysisImportBatch,
  type ProductAnalysisPeriodGrain,
  type ProductAnalysisPeriodRow,
  type ProductAnalysisProductRow,
  type ProductAnalysisRecord,
  type ProductAnalysisSegment,
  type ProductAnalysisState,
  type ProductAnalysisTrendRow
} from './productAnalysisPageData';

const AntvBar = dynamic(() => import('@ant-design/charts').then(mod => mod.Bar), { ssr: false });
const AntvLine = dynamic(() => import('@ant-design/charts').then(mod => mod.Line), { ssr: false });
const { RangePicker } = DatePicker;
const { Search } = Input;
const { Text } = Typography;

type AnyRecord = Record<string, any>;

type ProductAnalysisPageProps = AnyRecord & {
  products?: Product[];
};

type RankingMetricKey =
  | 'opportunityScore'
  | 'exposureValueScore'
  | 'interestScore'
  | 'cartValueScore'
  | 'broughtOrders'
  | 'gmvPerThousandExposure';

type TrendMetricKey =
  | 'broughtOrders'
  | 'exposureUsers'
  | 'addCartUsers'
  | 'gmvPerThousandExposure'
  | 'addCartRate'
  | 'cartToOrderRate'
  | 'repeatRate30d';

const RANKING_METRIC_OPTIONS: Array<{ value: RankingMetricKey; label: string }> = [
  { value: 'opportunityScore', label: '机会分' },
  { value: 'exposureValueScore', label: '曝光价值分' },
  { value: 'interestScore', label: '兴趣价值分' },
  { value: 'cartValueScore', label: '加购价值分' },
  { value: 'broughtOrders', label: '带来订单数' },
  { value: 'gmvPerThousandExposure', label: '千曝光交易额' }
];

const TREND_METRIC_OPTIONS: Array<{ value: TrendMetricKey; label: string }> = [
  { value: 'broughtOrders', label: '带来订单数' },
  { value: 'exposureUsers', label: '曝光人数' },
  { value: 'addCartUsers', label: '加购人数' },
  { value: 'gmvPerThousandExposure', label: '千曝光交易额' },
  { value: 'addCartRate', label: '加购率' },
  { value: 'cartToOrderRate', label: '加购到订单效率' },
  { value: 'repeatRate30d', label: '近30日复购率' }
];

const PERIOD_GRAIN_OPTIONS: Array<{ value: ProductAnalysisPeriodGrain; label: string }> = [
  { value: 'source', label: '按源数据日期' },
  { value: 'week', label: '按自然周' },
  { value: 'month', label: '按自然月' }
];

const SEGMENT_FILTER_OPTIONS: Array<{ value: ProductAnalysisSegment | 'all'; label: string }> = [
  { value: 'all', label: '全部分层' },
  { value: 'hero', label: '主推放量' },
  { value: 'wastedExposure', label: '曝光浪费' },
  { value: 'interestConversionGap', label: '兴趣强转化弱' },
  { value: 'lowExposurePotential', label: '低曝光潜力' },
  { value: 'cartValue', label: '加购强成交好' },
  { value: 'soldOutOpportunity', label: '售罄影响' },
  { value: 'ingredient', label: '配料/选项' },
  { value: 'longTail', label: '长尾观察' },
  { value: 'stable', label: '稳定观察' }
];

const VALUE_CHART_COLORS = [
  '#496f5d',
  '#d95b18',
  '#5b7c99',
  '#8f6f4e',
  '#6d6aa8',
  '#b85f32',
  '#7b8c42',
  '#2f5d62'
];

function dateToDayjs(dateText: string): Dayjs | null {
  const normalized = normalizeProductAnalysisDate(dateText);
  return normalized ? dayjs(normalized) : null;
}

function phaseKey(start: string, end: string) {
  return `${start}:${end}`;
}

function metricOptionLabel<T extends string>(options: Array<{ value: T; label: string }>, value: T) {
  return options.find(option => option.value === value)?.label || value;
}

function scoreColor(score: number) {
  if (score >= 75) return 'green';
  if (score >= 55) return 'blue';
  if (score >= 40) return 'gold';
  return 'red';
}

function reliabilityColor(row: ProductAnalysisProductRow) {
  if (row.reliability === 'high') return 'green';
  if (row.reliability === 'medium') return 'blue';
  return 'default';
}

function scoreTag(label: string, value: number) {
  return <Tag color={scoreColor(value)}>{label} {Math.round(value)}</Tag>;
}

function numberText(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `${Math.round(value)}`;
}

function moneyText(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  return `¥${money(value)}`;
}

function rateValueText(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '-' : rateText(value);
}

function rankingMetricValue(row: ProductAnalysisProductRow, metric: RankingMetricKey) {
  const value = row[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function rankingMetricText(row: ProductAnalysisProductRow, metric: RankingMetricKey) {
  const value = rankingMetricValue(row, metric);
  if (metric === 'gmvPerThousandExposure') return moneyText(value);
  if (metric === 'broughtOrders') return numberText(value);
  return `${Math.round(value)}`;
}

function trendMetricValue(row: ProductAnalysisTrendRow, metric: TrendMetricKey) {
  const value = row[metric];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function trendMetricText(metric: TrendMetricKey, value: number | null) {
  if (value === null) return '-';
  if (metric === 'gmvPerThousandExposure') return moneyText(value);
  if (metric === 'addCartRate' || metric === 'cartToOrderRate' || metric === 'repeatRate30d') return rateValueText(value);
  return numberText(value);
}

function shortProductName(value: unknown, max = 22) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function segmentDescription(row: ProductAnalysisProductRow) {
  return `${row.segmentText}：${row.advice}`;
}

function renderMetric(label: string, value: React.ReactNode, secondary?: string) {
  return (
    <div className="field">
      <Text type="secondary">{label}</Text>
      <div className="field-value">{value}</div>
      {secondary ? <Text type="secondary">{secondary}</Text> : null}
    </div>
  );
}

export function ProductAnalysisPage(pageProps: ProductAnalysisPageProps = {}) {
  const { message, modal } = AntApp.useApp();
  const { store, storeId, storeName, products: pageProducts } = useCalculatorPageProps(pageProps);
  const products = React.useMemo(
    () => pageProducts ?? normalizeProductList(store.products),
    [pageProducts, store.products]
  );
  const [productAnalysisState, setProductAnalysisState] = React.useState<ProductAnalysisState>(() => normalizeProductAnalysisState(undefined));
  const [selectedPhase, setSelectedPhase] = React.useState('all');
  const [dateStart, setDateStart] = React.useState('');
  const [dateEnd, setDateEnd] = React.useState('');
  const [periodGrain, setPeriodGrain] = React.useState<ProductAnalysisPeriodGrain>('source');
  const [segmentFilter, setSegmentFilter] = React.useState<ProductAnalysisSegment | 'all'>('all');
  const [searchText, setSearchText] = React.useState('');
  const [rankingMetric, setRankingMetric] = React.useState<RankingMetricKey>('opportunityScore');
  const [trendMetric, setTrendMetric] = React.useState<TrendMetricKey>('broughtOrders');
  const [selectedProductKey, setSelectedProductKey] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    loadProductAnalysisState().then(nextState => {
      if (!cancelled) setProductAnalysisState(nextState);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistProductAnalysisState = React.useCallback(async (nextState: ProductAnalysisState, successMessage?: string) => {
    setProductAnalysisState(nextState);
    try {
      await saveProductAnalysisState(nextState);
      if (successMessage) message.success(successMessage);
    } catch {
      message.error('保存商品分析数据失败，当前浏览器数据库不可用。');
    }
  }, [message]);

  const importProductAnalysisFile = React.useCallback(async (file: File) => {
    try {
      const result = await importProductAnalysisFileToState({
        file,
        currentState: productAnalysisState,
        storeId,
        storeName
      });
      await persistProductAnalysisState(
        result.state,
        `已导入商品数据：${result.importedCount} 条记录，覆盖 ${result.replacedRecords} 条旧记录。`
      );
      if (result.warnings.length) message.warning(result.warnings.slice(0, 2).join('；'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入商品汇总失败，请确认文件格式。');
    }
  }, [message, persistProductAnalysisState, productAnalysisState, storeId, storeName]);

  const { records, imports } = productAnalysisState;
  const storeRecords = React.useMemo(() => records.filter(row => row.storeId === storeId), [records, storeId]);
  const dataDateBounds = React.useMemo(() => {
    if (!storeRecords.length) return { start: '', end: '' };
    const starts = storeRecords.map(row => row.dateStart).sort();
    const ends = storeRecords.map(row => row.dateEnd).sort();
    return { start: starts[0], end: ends[ends.length - 1] };
  }, [storeRecords]);
  const allPeriodRows = React.useMemo(() => aggregateProductAnalysisByPeriod(storeRecords, periodGrain), [periodGrain, storeRecords]);
  const activePhaseRow = React.useMemo(() => allPeriodRows.find(row => row.key === selectedPhase), [allPeriodRows, selectedPhase]);
  const dateRangePickerValue = React.useMemo(() => {
    const start = dateToDayjs(dateStart);
    const end = dateToDayjs(dateEnd);
    return start && end ? [start, end] as [Dayjs, Dayjs] : undefined;
  }, [dateEnd, dateStart]);
  const dateRangePresets = React.useMemo(() => {
    const presets: Array<{ label: React.ReactNode; value: [Dayjs, Dayjs] }> = [];
    const addPreset = (label: React.ReactNode, startText: string, endText: string) => {
      const start = dateToDayjs(startText);
      const end = dateToDayjs(endText);
      if (start && end) presets.push({ label, value: [start, end] });
    };
    if (dataDateBounds.start && dataDateBounds.end) addPreset('全部商品数据', dataDateBounds.start, dataDateBounds.end);
    allPeriodRows.forEach(row => addPreset(row.periodLabel, row.dateStart, row.dateEnd));
    return presets;
  }, [allPeriodRows, dataDateBounds.end, dataDateBounds.start]);
  const phaseOptions = React.useMemo(() => [
    { value: 'all', label: '全部阶段' },
    ...allPeriodRows.map(row => ({ value: row.key, label: row.periodLabel }))
  ], [allPeriodRows]);

  const filteredRecords = React.useMemo(() => {
    if (activePhaseRow) {
      return storeRecords
        .filter(row => productAnalysisRecordsOverlapRange(row, activePhaseRow.dateStart, activePhaseRow.dateEnd))
        .sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.productName.localeCompare(b.productName, 'zh-CN'));
    }
    return storeRecords
      .filter(row => productAnalysisRecordsOverlapRange(row, dateStart, dateEnd))
      .sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.productName.localeCompare(b.productName, 'zh-CN'));
  }, [activePhaseRow, dateEnd, dateStart, storeRecords]);

  const summary = React.useMemo(() => summarizeProductAnalysisRecords(filteredRecords), [filteredRecords]);
  const periodRows = React.useMemo(() => aggregateProductAnalysisByPeriod(filteredRecords, periodGrain), [filteredRecords, periodGrain]);
  const productRows = React.useMemo(() => buildProductAnalysisRows(filteredRecords, products), [filteredRecords, products]);
  const productOptions = React.useMemo(() => productRows.map(row => ({ value: row.productKey, label: row.productName })), [productRows]);

  React.useEffect(() => {
    if (selectedProductKey && !productOptions.some(option => option.value === selectedProductKey)) {
      setSelectedProductKey('');
    }
  }, [productOptions, selectedProductKey]);

  const visibleProductRows = React.useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    return productRows
      .filter(row => segmentFilter === 'all' || row.segment === segmentFilter)
      .filter(row => !keyword || [
        row.productName,
        row.categoryName,
        row.segmentText,
        row.advice,
        row.matchedProductName
      ].join(' ').toLowerCase().includes(keyword));
  }, [productRows, searchText, segmentFilter]);

  const activeDateRangeText = productAnalysisDateRangeText(
    dateStart || summary.dateStart,
    dateEnd || summary.dateEnd
  );

  const importRows = React.useMemo(() => imports
    .filter(row => row.storeId === storeId)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt)), [imports, storeId]);

  const rankingChartRows = React.useMemo(() => visibleProductRows
    .slice()
    .sort((a, b) => rankingMetricValue(b, rankingMetric) - rankingMetricValue(a, rankingMetric) || b.broughtOrders - a.broughtOrders)
    .slice(0, 12)
    .reverse()
    .map(row => ({
      key: row.productKey,
      productName: shortProductName(row.productName, 18),
      fullProductName: row.productName,
      value: rankingMetricValue(row, rankingMetric),
      valueText: rankingMetricText(row, rankingMetric),
      segmentText: row.segmentText,
      segment: row.segment
    })), [rankingMetric, visibleProductRows]);

  const trendRows = React.useMemo(
    () => buildProductAnalysisTrendRows(filteredRecords, productRows, selectedProductKey, periodGrain),
    [filteredRecords, periodGrain, productRows, selectedProductKey]
  );
  const trendChartRows = React.useMemo(() => trendRows
    .map(row => {
      const value = trendMetricValue(row, trendMetric);
      if (value === null) return null;
      return {
        key: `${row.key}-${trendMetric}`,
        periodLabel: row.periodLabel,
        dateStart: row.dateStart,
        productName: shortProductName(row.productName, 16),
        fullProductName: row.productName,
        value,
        valueText: trendMetricText(trendMetric, value)
      };
    })
    .filter(Boolean), [trendMetric, trendRows]);

  const exportCurrentProductAnalysis = () => {
    const ok = downloadCsv(
      `${storeName}_商品分析_${productAnalysisDateRangeText(summary.dateStart, summary.dateEnd)}.csv`,
      productAnalysisExportRows(visibleProductRows)
    );
    if (!ok) message.warning('当前筛选范围没有可导出的商品分析数据。');
  };

  const clearCurrentStoreProductAnalysis = () => {
    modal.confirm({
      title: '清空商品分析数据',
      content: `确定清空「${storeName}」的商品分析导入记录吗？商品维护数据不会被删除。`,
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => persistProductAnalysisState(
        normalizeProductAnalysisState({
          records: records.filter(row => row.storeId !== storeId),
          imports: imports.filter(row => row.storeId !== storeId)
        }),
        '商品分析数据已清空。'
      )
    });
  };

  const changeDateRange = (dateStrings: string[]) => {
    const range = normalizeProductAnalysisDateRange(dateStrings[0], dateStrings[1]);
    setSelectedPhase('all');
    setDateStart(range.dateStart);
    setDateEnd(range.dateEnd);
  };

  const changePhase = (value: string) => {
    setSelectedPhase(value);
    const row = allPeriodRows.find(item => item.key === value);
    if (row) {
      setDateStart(row.dateStart);
      setDateEnd(row.dateEnd);
    }
  };

  const changePeriodGrain = (value: ProductAnalysisPeriodGrain) => {
    setPeriodGrain(value);
    setSelectedPhase('all');
    setDateStart('');
    setDateEnd('');
  };

  const renderRankingChart = () => {
    if (!rankingChartRows.length) return <div className="chart-empty">暂无商品价值排名数据</div>;
    return (
      <div className="chart-frame product-analysis-rank-chart">
        <AntvBar
          data={rankingChartRows}
          height={Math.max(260, rankingChartRows.length * 32)}
          autoFit
          xField="value"
          yField="productName"
          colorField="segmentText"
          axis={{
            x: { title: metricOptionLabel(RANKING_METRIC_OPTIONS, rankingMetric) },
            y: { title: '商品' }
          }}
          scale={{
            color: {
              range: VALUE_CHART_COLORS
            }
          }}
          label={[
            {
              text: 'valueText',
              position: 'right',
              style: { fill: '#111827', fontSize: 11, fontWeight: 600 }
            }
          ]}
          tooltip={{
            title: (datum: typeof rankingChartRows[number]) => datum.fullProductName,
            items: [
              (datum: typeof rankingChartRows[number]) => ({
                name: metricOptionLabel(RANKING_METRIC_OPTIONS, rankingMetric),
                value: `${datum.valueText}；${datum.segmentText}`
              })
            ]
          }}
          style={{ radiusTopRight: 4, radiusBottomRight: 4 }}
        />
      </div>
    );
  };

  const renderTrendChart = () => {
    if (periodRows.length < 2) return <div className="chart-empty">至少需要两个阶段后展示商品阶段趋势</div>;
    if (!trendChartRows.length) return <div className="chart-empty">暂无商品阶段趋势数据</div>;
    return (
      <div className="chart-frame">
        <AntvLine
          data={trendChartRows}
          height={300}
          autoFit
          xField="periodLabel"
          yField="value"
          colorField="productName"
          shapeField="smooth"
          axis={{
            x: { title: '阶段', labelAutoRotate: false },
            y: {
              title: metricOptionLabel(TREND_METRIC_OPTIONS, trendMetric),
              labelFormatter: (value: number | string) => trendMetricText(trendMetric, Number(value))
            }
          }}
          scale={{
            color: {
              range: VALUE_CHART_COLORS
            }
          }}
          style={{ lineWidth: 2.4 }}
          point={{ size: 4 }}
          tooltip={{
            title: (datum: typeof trendChartRows[number]) => datum.periodLabel,
            items: [
              (datum: typeof trendChartRows[number]) => ({
                name: datum.fullProductName,
                value: datum.valueText
              })
            ]
          }}
        />
      </div>
    );
  };

  const periodColumns: TableColumnsType<ProductAnalysisPeriodRow> = [
    { title: '阶段', dataIndex: 'periodLabel', width: 210, fixed: 'left' },
    { title: '商品数', dataIndex: 'productCount', width: 90 },
    { title: '曝光', dataIndex: 'exposureUsers', width: 100 },
    { title: '点击率', dataIndex: 'clickRate', width: 100, render: rateValueText },
    { title: '加购率', dataIndex: 'addCartRate', width: 100, render: rateValueText },
    { title: '下单人数', dataIndex: 'orderUsers', width: 100 },
    { title: '带来订单', dataIndex: 'broughtOrders', width: 100 },
    { title: '曝光成交率', dataIndex: 'exposureToOrderRate', width: 110, render: rateValueText },
    { title: '近30日复购率', dataIndex: 'repeatRate30d', width: 120, render: rateValueText },
    { title: '售罄商品', dataIndex: 'soldOutProductCount', width: 100 },
    { title: '千曝光订单', dataIndex: 'ordersPerThousandExposure', width: 110, render: value => value === null ? '-' : money(value) },
    { title: '千曝光交易额', dataIndex: 'gmvPerThousandExposure', width: 130, render: moneyText },
    { title: '阶段订单最高商品', dataIndex: 'topProductName', width: 240, ellipsis: true },
    { title: '最高带单', dataIndex: 'topProductOrders', width: 90 }
  ];

  const productColumns: TableColumnsType<ProductAnalysisProductRow> = [
    {
      title: '商品',
      dataIndex: 'productName',
      width: 270,
      fixed: 'left',
      render: (_, row) => (
        <Space orientation="vertical" size={2} style={{ width: '100%' }}>
          <Text strong className="table-text-wrap">{row.productName}</Text>
          <Space wrap size={[4, 4]}>
            <Tooltip title={segmentDescription(row)}>
              <Tag color={productAnalysisSegmentColor(row.segment)}>{row.segmentText}</Tag>
            </Tooltip>
            <Tag>{row.categoryName}</Tag>
            {row.isNewProduct ? <Tag color="blue">新品</Tag> : null}
            {row.isSignature ? <Tag color="gold">招牌</Tag> : null}
            {row.isSetMeal ? <Tag color="cyan">套餐</Tag> : null}
            {row.isSoldOut ? <Tag color="red">售罄</Tag> : null}
            <Tag color={reliabilityColor(row)}>{reliabilityText(row.reliability)}</Tag>
          </Space>
        </Space>
      )
    },
    { title: '阶段数', dataIndex: 'periodCount', width: 80 },
    { title: '曝光', dataIndex: 'exposureUsers', width: 90, sorter: (a, b) => a.exposureUsers - b.exposureUsers },
    { title: '点击', dataIndex: 'clickUsers', width: 80, sorter: (a, b) => a.clickUsers - b.clickUsers },
    { title: '加购', dataIndex: 'addCartUsers', width: 80, sorter: (a, b) => a.addCartUsers - b.addCartUsers },
    { title: '下单人数', dataIndex: 'orderUsers', width: 90, sorter: (a, b) => a.orderUsers - b.orderUsers },
    { title: '带单', dataIndex: 'broughtOrders', width: 80, sorter: (a, b) => a.broughtOrders - b.broughtOrders },
    { title: '销售额', dataIndex: 'salesAmount', width: 100, render: moneyText, sorter: (a, b) => a.salesAmount - b.salesAmount },
    { title: '订单交易额', dataIndex: 'orderTransactionAmount', width: 110, render: moneyText },
    { title: '点击率', dataIndex: 'clickRate', width: 90, render: rateValueText, sorter: (a, b) => (a.clickRate || 0) - (b.clickRate || 0) },
    { title: '加购率', dataIndex: 'addCartRate', width: 90, render: rateValueText, sorter: (a, b) => (a.addCartRate || 0) - (b.addCartRate || 0) },
    { title: '点击到加购', dataIndex: 'clickToCartRate', width: 110, render: rateValueText },
    { title: '加购到订单', dataIndex: 'cartToOrderRate', width: 110, render: rateValueText },
    { title: '近30日复购率', dataIndex: 'repeatRate30d', width: 120, render: rateValueText },
    { title: '千曝光订单', dataIndex: 'ordersPerThousandExposure', width: 110, render: value => value === null ? '-' : money(value), sorter: (a, b) => (a.ordersPerThousandExposure || 0) - (b.ordersPerThousandExposure || 0) },
    { title: '千曝光交易额', dataIndex: 'gmvPerThousandExposure', width: 130, render: moneyText, sorter: (a, b) => (a.gmvPerThousandExposure || 0) - (b.gmvPerThousandExposure || 0) },
    {
      title: '价值分',
      width: 250,
      render: (_, row) => (
        <Space wrap size={[4, 4]}>
          {scoreTag('曝光', row.exposureValueScore)}
          {scoreTag('兴趣', row.interestScore)}
          {scoreTag('加购', row.cartValueScore)}
        </Space>
      )
    },
    {
      title: '成本匹配',
      width: 170,
      render: (_, row) => row.matchedProductName
        ? (
          <Space orientation="vertical" size={2}>
            <Text>{row.matchedProductName}</Text>
            <Text type="secondary">{row.estimatedGrossProfit === null ? '未维护成本' : `估算毛利 ${moneyText(row.estimatedGrossProfit)}`}</Text>
          </Space>
        )
        : <Text type="secondary">未匹配商品维护</Text>
    },
    { title: '建议', dataIndex: 'advice', width: 360 }
  ];

  const importColumns: TableColumnsType<ProductAnalysisImportBatch> = [
    { title: '导入时间', dataIndex: 'importedAt', width: 170, render: value => productAnalysisImportedAtText(String(value || '')) },
    { title: '日期范围', width: 210, render: (_, row) => productAnalysisDateRangeText(row.dateStart, row.dateEnd) },
    { title: '商品数', dataIndex: 'rowCount', width: 90 },
    { title: '覆盖记录', dataIndex: 'replacedRecords', width: 90 },
    { title: '工作表', dataIndex: 'sheetName', width: 120 },
    { title: '文件', dataIndex: 'fileName', width: 280, ellipsis: true },
    { title: '提示', width: 280, render: (_, row) => row.warnings.length ? row.warnings.join('；') : <Text type="secondary">无</Text> }
  ];

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Card
        title="商品分析"
        extra={
          <Space wrap>
            <Upload {...uploadProps(importProductAnalysisFile)}><Button icon={<UploadOutlined />}>导入商品数据</Button></Upload>
            <Button icon={<DownloadOutlined />} onClick={exportCurrentProductAnalysis}>导出分析</Button>
            <Button danger icon={<DeleteOutlined />} disabled={!storeRecords.length} onClick={clearCurrentStoreProductAnalysis}>清空数据</Button>
          </Space>
        }
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Select
              style={{ width: 150 }}
              value={periodGrain}
              onChange={changePeriodGrain}
              options={PERIOD_GRAIN_OPTIONS}
            />
            <Select
              style={{ width: 190 }}
              value={selectedPhase}
              onChange={changePhase}
              options={phaseOptions}
            />
            <RangePicker
              allowClear
              format="YYYY-MM-DD"
              placeholder={['开始日期', '结束日期']}
              presets={dateRangePresets}
              style={{ width: 360 }}
              value={dateRangePickerValue}
              onChange={(_, dateStrings) => changeDateRange(Array.isArray(dateStrings) ? dateStrings : [])}
            />
            <Select
              style={{ width: 170 }}
              value={segmentFilter}
              onChange={setSegmentFilter}
              options={SEGMENT_FILTER_OPTIONS}
            />
            <Search
              allowClear
              placeholder="搜索商品、分层或建议"
              style={{ width: 260 }}
              value={searchText}
              onChange={event => setSearchText(event.target.value)}
            />
          </Space>
          <Space wrap>
            <Tag color="blue">{storeRecords.length} 条商品记录</Tag>
            <Tag>{allPeriodRows.length} 个阶段</Tag>
            <Tag>数据范围：{productAnalysisDateRangeText(dataDateBounds.start, dataDateBounds.end)}</Tag>
            <Tag color="green">当前统计：{activeDateRangeText}</Tag>
          </Space>
          <Text type="secondary">按日商品表会按天保存，并支持按自然周或自然月聚合；区间汇总表保留原始区间，不会被强拆成单日趋势。</Text>
        </Space>
      </Card>

      <Card title="当前阶段汇总">
        <Row gutter={[12, 12]}>
          <Col xs={12} md={6}>{renderMetric('商品数', summary.productCount, `${summary.periodCount} 个阶段`)}</Col>
          <Col xs={12} md={6}>{renderMetric('总曝光', summary.exposureUsers, `${summary.clickUsers} 点击`)}</Col>
          <Col xs={12} md={6}>{renderMetric('总加购', summary.addCartUsers, `加购率 ${rateValueText(summary.addCartRate)}`)}</Col>
          <Col xs={12} md={6}>{renderMetric('下单人数', summary.orderUsers, `${summary.broughtOrders} 带来订单`)}</Col>
          <Col xs={12} md={6}>{renderMetric('点击率', rateValueText(summary.clickRate), `${summary.likes} 点赞`)}</Col>
          <Col xs={12} md={6}>{renderMetric('近30日复购率', rateValueText(summary.repeatRate30d), `${summary.repeatUsers30d} 复购人数`)}</Col>
          <Col xs={12} md={6}>{renderMetric('加购到订单', rateValueText(summary.cartToOrderRate), `${summary.addCartUsers} 加购`)}</Col>
          <Col xs={12} md={6}>{renderMetric('售罄商品', summary.soldOutProductCount, `新品 ${summary.newProductCount} / 招牌 ${summary.signatureProductCount} / 套餐 ${summary.setMealProductCount}`)}</Col>
          <Col xs={12} md={6}>{renderMetric('千曝光交易额', moneyText(summary.gmvPerThousandExposure), `${moneyText(summary.orderTransactionAmount)} 交易额`)}</Col>
        </Row>
      </Card>

      <Card title="阶段表现" extra={<Tag color="green">{activeDateRangeText}</Tag>}>
        <Table
          rowKey="key"
          size="small"
          columns={periodColumns}
          dataSource={periodRows}
          pagination={false}
          scroll={{ x: 1580 }}
        />
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card
            title="商品价值排名"
            extra={
              <Select
                style={{ width: 160 }}
                value={rankingMetric}
                onChange={setRankingMetric}
                options={RANKING_METRIC_OPTIONS}
              />
            }
          >
            {renderRankingChart()}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card
            title="商品阶段趋势"
            extra={
              <Space wrap>
                <Select
                  allowClear
                  placeholder="默认前5带单商品"
                  style={{ width: 200 }}
                  value={selectedProductKey || undefined}
                  onChange={value => setSelectedProductKey(value || '')}
                  options={productOptions}
                  showSearch
                  optionFilterProp="label"
                />
                <Select
                  style={{ width: 160 }}
                  value={trendMetric}
                  onChange={setTrendMetric}
                  options={TREND_METRIC_OPTIONS}
                />
              </Space>
            }
          >
            {renderTrendChart()}
          </Card>
        </Col>
      </Row>

      <Card title="商品价值分层明细" extra={<Tag color="blue">{visibleProductRows.length} 个商品</Tag>}>
        <Table
          rowKey="key"
          size="small"
          columns={productColumns}
          dataSource={visibleProductRows}
          pagination={{ pageSize: 12 }}
          scroll={{ x: 2310 }}
        />
      </Card>

      <Card title="导入记录">
        <Table
          rowKey="id"
          size="small"
          columns={importColumns}
          dataSource={importRows}
          pagination={{ pageSize: 6 }}
          scroll={{ x: 1240 }}
        />
      </Card>
    </Space>
  );
}
