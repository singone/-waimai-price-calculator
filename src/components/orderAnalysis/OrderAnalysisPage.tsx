'use client';

import dynamic from 'next/dynamic';
import React from 'react';
import { App as AntApp, Button, Card, Col, DatePicker, Row, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { PLATFORM_NAMES, PLATFORMS } from '../../domain/core';
import { roundMoney } from '../../domain/money';
import { downloadCsv } from '../../utils/csv';
import {
  money,
  rateText,
  recommendationPriorityColor,
  recommendationPriorityText
} from '../../utils/format';
import { uploadProps } from '../../utils/upload';
import {
  importOrderAnalysisFileToState,
  loadOrderAnalysisState,
  saveOrderAnalysisState
} from './orderAnalysisPageData';
import {
  aggregateEnrichedOrdersByProduct,
  aggregateOrdersByActivityCombo,
  aggregateOrdersByActivityComboPayBand,
  aggregateOrdersByActivityType,
  aggregateOrdersByHour,
  aggregateOrdersByMealPeriod,
  aggregateOrdersByMealPeriodPayBand,
  aggregateOrdersByPayBand,
  aggregateOrdersByPlatform,
  aggregateOrdersByPlatformPayBand,
  buildOrderInsights,
  buildOrderOperationRecommendations,
  enrichOrderRecords,
  ORDER_ACTIVITY_TYPE_LABELS,
  orderAnalysisExportRows,
  summarizeOrderProfit,
  summarizeOrderRecords
} from '../../domain/orderAnalysis';
import type {
  EnrichedOrderDetailRecord,
  OrderActivityAggregateRow,
  OrderActivityComboRow,
  OrderActivityType,
  OrderAggregateRow,
  OrderAnalysisState,
  OrderAnalysisPlatformFilter,
  OrderCrossAggregateRow,
  OrderImportBatch,
  OrderInsightItem,
  OrderOperationRecommendation,
  OrderProductAggregateRow,
  OrderProfitSummary,
  OrderSummary
} from '../../domain/orderAnalysis';
import type { Product } from '../../domain/types';

const AntvColumn = dynamic(() => import('@ant-design/charts').then(mod => mod.Column), { ssr: false });
const AntvDualAxes = dynamic(() => import('@ant-design/charts').then(mod => mod.DualAxes), { ssr: false });
const { RangePicker } = DatePicker;
const { Text } = Typography;

type OrderAnalysisDateBounds = { start: string; end: string };

type OrderAnalysisPageProps = {
  storeId: string;
  storeName: string;
  products: Product[];
};

function normalizeDate(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const parsed = dayjs(text);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD') : '';
}

function addDays(dateText: string, days: number) {
  const date = dayjs(normalizeDate(dateText));
  return date.isValid() ? date.add(days, 'day').format('YYYY-MM-DD') : '';
}

function dateRangeText(start: string, end: string) {
  if (start && end && start !== end) return `${start} 至 ${end}`;
  return start || end || '全部日期';
}

function dateToDayjs(dateText: string): Dayjs | null {
  const normalized = normalizeDate(dateText);
  return normalized ? dayjs(normalized) : null;
}

function importedAtText(value: string) {
  if (!value) return '-';
  const parsed = dayjs(value);
  return parsed.isValid() ? parsed.format('YYYY-MM-DD HH:mm') : value;
}

export function OrderAnalysisPage(pageProps: Partial<OrderAnalysisPageProps> = {}) {
  const { message } = AntApp.useApp();
  const {
  storeId,
  storeName,
  products
  } = pageProps as OrderAnalysisPageProps;
  const [orderAnalysisState, setOrderAnalysisState] = React.useState<OrderAnalysisState>({ records: [], imports: [] });
  const [orderAnalysisPlatform, setOrderAnalysisPlatform] = React.useState<OrderAnalysisPlatformFilter>('all');
  const [orderAnalysisDateStart, setOrderAnalysisDateStart] = React.useState('');
  const [orderAnalysisDateEnd, setOrderAnalysisDateEnd] = React.useState('');
  React.useEffect(() => {
    let cancelled = false;
    loadOrderAnalysisState().then(nextState => {
      if (!cancelled) setOrderAnalysisState(nextState);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const importOrderAnalysisFile = React.useCallback(async (file: File) => {
    try {
      const result = await importOrderAnalysisFileToState({
        file,
        currentState: orderAnalysisState,
        storeId,
        storeName
      });
      setOrderAnalysisState(result.state);
      await saveOrderAnalysisState(result.state);
      message.success(`已导入${result.platformName}订单：${result.importedCount} 单，覆盖 ${result.replacedOrders} 单。`);
      if (result.warnings.length) message.warning(result.warnings.slice(0, 2).join('；'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入订单明细失败，请确认文件格式。');
    }
  }, [message, orderAnalysisState, storeId, storeName]);
  const { records, imports } = orderAnalysisState;
  const orderStoreRecords = React.useMemo(() => {
    return records.filter(row => row.storeId === storeId && row.isValid);
  }, [records, storeId]);
  const orderDataDateBounds = React.useMemo<OrderAnalysisDateBounds>(() => {
    if (!orderStoreRecords.length) return { start: '', end: '' };
    const dates = orderStoreRecords.map(row => row.orderDate).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [orderStoreRecords]);
  const orderDateRangePickerValue = React.useMemo(() => {
    const start = dateToDayjs(orderAnalysisDateStart);
    const end = dateToDayjs(orderAnalysisDateEnd);
    return start && end ? [start, end] as [Dayjs, Dayjs] : null;
  }, [orderAnalysisDateEnd, orderAnalysisDateStart]);
  const orderDateRangePresets = React.useMemo(() => {
    const presets: Array<{ label: React.ReactNode; value: [Dayjs, Dayjs] }> = [];
    const addPreset = (label: React.ReactNode, startText: string, endText: string) => {
      const start = dateToDayjs(startText);
      const end = dateToDayjs(endText);
      if (start && end) presets.push({ label, value: [start, end] });
    };
    if (!orderDataDateBounds.start || !orderDataDateBounds.end) return presets;
    addPreset('全部订单', orderDataDateBounds.start, orderDataDateBounds.end);
    const latest7Start = addDays(orderDataDateBounds.end, -6);
    addPreset('最近7天', latest7Start < orderDataDateBounds.start ? orderDataDateBounds.start : latest7Start, orderDataDateBounds.end);
    const latest30Start = addDays(orderDataDateBounds.end, -29);
    addPreset('最近30天', latest30Start < orderDataDateBounds.start ? orderDataDateBounds.start : latest30Start, orderDataDateBounds.end);
    return presets;
  }, [orderDataDateBounds.end, orderDataDateBounds.start]);
  const updateOrderAnalysisDateRange = (dateStrings: string[]) => {
    setOrderAnalysisDateStart(normalizeDate(dateStrings[0]));
    setOrderAnalysisDateEnd(normalizeDate(dateStrings[1]));
  };
  const filteredOrderRecords = React.useMemo(() => {
    return orderStoreRecords
      .filter(row => orderAnalysisPlatform === 'all' || row.platform === orderAnalysisPlatform)
      .filter(row => !orderAnalysisDateStart || row.orderDate >= orderAnalysisDateStart)
      .filter(row => !orderAnalysisDateEnd || row.orderDate <= orderAnalysisDateEnd)
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime) || a.orderId.localeCompare(b.orderId));
  }, [orderAnalysisDateEnd, orderAnalysisDateStart, orderAnalysisPlatform, orderStoreRecords]);
  const orderSummary = React.useMemo(() => summarizeOrderRecords(filteredOrderRecords), [filteredOrderRecords]);
  const orderActiveDateRangeText = dateRangeText(
    orderAnalysisDateStart || orderSummary.dateStart,
    orderAnalysisDateEnd || orderSummary.dateEnd
  );
  const orderPlatformRows = React.useMemo(() => aggregateOrdersByPlatform(filteredOrderRecords), [filteredOrderRecords]);
  const orderPayBandRows = React.useMemo(() => aggregateOrdersByPayBand(filteredOrderRecords), [filteredOrderRecords]);
  const orderMealPeriodRows = React.useMemo(() => aggregateOrdersByMealPeriod(filteredOrderRecords), [filteredOrderRecords]);
  const orderHourRows = React.useMemo(() => aggregateOrdersByHour(filteredOrderRecords), [filteredOrderRecords]);
  const orderActivityRows = React.useMemo(() => aggregateOrdersByActivityType(filteredOrderRecords), [filteredOrderRecords]);
  const enrichedOrderRecords = React.useMemo(() => enrichOrderRecords(filteredOrderRecords, products), [filteredOrderRecords, products]);
  const orderProfitSummary = React.useMemo(() => summarizeOrderProfit(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderActivityComboRows = React.useMemo(() => aggregateOrdersByActivityCombo(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderPlatformPayBandRows = React.useMemo(() => aggregateOrdersByPlatformPayBand(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderMealPayBandRows = React.useMemo(() => aggregateOrdersByMealPeriodPayBand(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderActivityComboPayBandRows = React.useMemo(() => aggregateOrdersByActivityComboPayBand(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderProductRows = React.useMemo(() => aggregateEnrichedOrdersByProduct(enrichedOrderRecords, products), [enrichedOrderRecords, products]);
  const orderOperationRecommendations = React.useMemo(
    () => buildOrderOperationRecommendations(orderSummary, orderProfitSummary, orderPayBandRows, orderPlatformPayBandRows, orderMealPayBandRows, orderActivityComboRows, orderProductRows),
    [orderActivityComboRows, orderMealPayBandRows, orderPayBandRows, orderPlatformPayBandRows, orderProductRows, orderProfitSummary, orderSummary]
  );
  const orderInsights = React.useMemo(() => buildOrderInsights(orderSummary, orderPayBandRows, orderMealPeriodRows, orderActivityRows), [orderActivityRows, orderMealPeriodRows, orderPayBandRows, orderSummary]);
  const orderImportRows = React.useMemo(() => {
    return imports
      .filter(row => row.storeId === storeId)
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }, [imports, storeId]);
  const exportOrderAnalysis = () => {
    return downloadCsv(
      `${storeName}_订单分析_${dateRangeText(orderSummary.dateStart, orderSummary.dateEnd)}.csv`,
      orderAnalysisExportRows(
        orderSummary,
        orderPayBandRows,
        orderMealPeriodRows,
        orderActivityRows,
        orderProductRows,
        orderProfitSummary,
        orderActivityComboRows,
        orderPlatformPayBandRows,
        orderMealPayBandRows,
        orderOperationRecommendations
      )
    );
  };
  const renderOrderMetric = (label: string, value: React.ReactNode, secondary?: string) => (
    <div className="field">
      <Text type="secondary">{label}</Text>
      <div className="field-value">{value}</div>
      {secondary ? <Text type="secondary">{secondary}</Text> : null}
    </div>
  );
  const aggregateColumns: TableColumnsType<OrderAggregateRow> = [
    { title: '名称', dataIndex: 'label', width: 120, fixed: 'left' },
    { title: '订单数', dataIndex: 'orderCount', width: 90, sorter: (a, b) => a.orderCount - b.orderCount },
    { title: '单均实付', width: 105, render: (_, row) => `¥${money(row.avgPay)}`, sorter: (a, b) => a.avgPay - b.avgPay },
    { title: '单均原价', width: 105, render: (_, row) => `¥${money(row.avgOriginal)}`, sorter: (a, b) => a.avgOriginal - b.avgOriginal },
    { title: '单均补贴', width: 105, render: (_, row) => `¥${money(row.avgDiscount)}`, sorter: (a, b) => a.avgDiscount - b.avgDiscount },
    { title: '让利率', width: 100, render: (_, row) => row.discountRate === null ? '-' : rateText(row.discountRate), sorter: (a, b) => (a.discountRate || 0) - (b.discountRate || 0) },
    { title: '商家单均补贴', width: 125, render: (_, row) => `¥${money(row.merchantSubsidyPerOrder)}`, sorter: (a, b) => a.merchantSubsidyPerOrder - b.merchantSubsidyPerOrder },
    { title: '平台单均补贴', width: 125, render: (_, row) => `¥${money(row.platformSubsidyPerOrder)}`, sorter: (a, b) => a.platformSubsidyPerOrder - b.platformSubsidyPerOrder }
  ];
  const activityColumns: TableColumnsType<OrderActivityAggregateRow> = [
    { title: '活动类型', dataIndex: 'activityName', width: 140, fixed: 'left' },
    { title: '订单数', dataIndex: 'orderCount', width: 90, sorter: (a, b) => a.orderCount - b.orderCount },
    { title: '单均实付', width: 105, render: (_, row) => `¥${money(row.avgPay)}`, sorter: (a, b) => a.avgPay - b.avgPay },
    { title: '单均原价', width: 105, render: (_, row) => `¥${money(row.avgOriginal)}`, sorter: (a, b) => a.avgOriginal - b.avgOriginal },
    { title: '单均补贴', width: 105, render: (_, row) => `¥${money(row.avgDiscount)}`, sorter: (a, b) => a.avgDiscount - b.avgDiscount },
    { title: '让利率', width: 100, render: (_, row) => row.discountRate === null ? '-' : rateText(row.discountRate), sorter: (a, b) => (a.discountRate || 0) - (b.discountRate || 0) },
    { title: '商家单均补贴', width: 125, render: (_, row) => `¥${money(row.merchantSubsidyPerOrder)}`, sorter: (a, b) => a.merchantSubsidyPerOrder - b.merchantSubsidyPerOrder },
    { title: '平台单均补贴', width: 125, render: (_, row) => `¥${money(row.platformSubsidyPerOrder)}`, sorter: (a, b) => a.platformSubsidyPerOrder - b.platformSubsidyPerOrder }
  ];
  const comboColumns: TableColumnsType<OrderActivityComboRow> = [
    { title: '活动组合', dataIndex: 'label', width: 280, fixed: 'left' },
    { title: '订单数', dataIndex: 'orderCount', width: 90, sorter: (a, b) => a.orderCount - b.orderCount },
    { title: '单均实付', width: 105, render: (_, row) => `¥${money(row.avgPay)}`, sorter: (a, b) => a.avgPay - b.avgPay },
    { title: '商家单均补贴', width: 125, render: (_, row) => `¥${money(row.merchantSubsidyPerOrder)}`, sorter: (a, b) => a.merchantSubsidyPerOrder - b.merchantSubsidyPerOrder },
    { title: '让利率', width: 100, render: (_, row) => row.discountRate === null ? '-' : rateText(row.discountRate), sorter: (a, b) => (a.discountRate || 0) - (b.discountRate || 0) },
    { title: '估算单均毛利', width: 125, render: (_, row) => row.avgEstimatedProfit === null ? '-' : `¥${money(row.avgEstimatedProfit)}`, sorter: (a, b) => (a.avgEstimatedProfit || 0) - (b.avgEstimatedProfit || 0) },
    { title: '估算毛利率', width: 110, render: (_, row) => row.estimatedProfitRate === null ? '-' : rateText(row.estimatedProfitRate), sorter: (a, b) => (a.estimatedProfitRate || 0) - (b.estimatedProfitRate || 0) },
    { title: '亏损单', dataIndex: 'lossOrderCount', width: 90, sorter: (a, b) => a.lossOrderCount - b.lossOrderCount }
  ];
  const crossColumns: TableColumnsType<OrderCrossAggregateRow> = [
    { title: '维度', dataIndex: 'primary', width: 160, fixed: 'left' },
    { title: '支付价', dataIndex: 'secondary', width: 100 },
    { title: '订单数', dataIndex: 'orderCount', width: 90, sorter: (a, b) => a.orderCount - b.orderCount },
    { title: '单均实付', width: 105, render: (_, row) => `¥${money(row.avgPay)}`, sorter: (a, b) => a.avgPay - b.avgPay },
    { title: '商家单均补贴', width: 125, render: (_, row) => `¥${money(row.merchantSubsidyPerOrder)}`, sorter: (a, b) => a.merchantSubsidyPerOrder - b.merchantSubsidyPerOrder },
    { title: '让利率', width: 100, render: (_, row) => row.discountRate === null ? '-' : rateText(row.discountRate), sorter: (a, b) => (a.discountRate || 0) - (b.discountRate || 0) },
    { title: '估算单均毛利', width: 125, render: (_, row) => row.avgEstimatedProfit === null ? '-' : `¥${money(row.avgEstimatedProfit)}`, sorter: (a, b) => (a.avgEstimatedProfit || 0) - (b.avgEstimatedProfit || 0) },
    { title: '亏损单', dataIndex: 'lossOrderCount', width: 90, sorter: (a, b) => a.lossOrderCount - b.lossOrderCount }
  ];
  const productColumns: TableColumnsType<OrderProductAggregateRow> = [
    { title: '商品', dataIndex: 'productName', width: 240, fixed: 'left' },
    { title: '订单数', dataIndex: 'orderCount', width: 90, sorter: (a, b) => a.orderCount - b.orderCount },
    { title: '数量', dataIndex: 'quantity', width: 90, sorter: (a, b) => a.quantity - b.quantity },
    { title: '订单占比', width: 100, render: (_, row) => row.orderShare === null ? '-' : rateText(row.orderShare), sorter: (a, b) => (a.orderShare || 0) - (b.orderShare || 0) },
    { title: '单均实付', width: 105, render: (_, row) => `¥${money(row.avgPay)}`, sorter: (a, b) => a.avgPay - b.avgPay },
    { title: '单均补贴', width: 105, render: (_, row) => `¥${money(row.avgDiscount)}`, sorter: (a, b) => a.avgDiscount - b.avgDiscount },
    { title: '估算单均毛利', width: 125, render: (_, row) => row.avgEstimatedProfit === null || row.avgEstimatedProfit === undefined ? '-' : `¥${money(row.avgEstimatedProfit)}`, sorter: (a, b) => (a.avgEstimatedProfit || 0) - (b.avgEstimatedProfit || 0) },
    { title: '成本匹配', width: 160, render: (_, row) => row.matchedProductName ? <Tag color="green">{row.matchedProductName}</Tag> : <Tag color="orange">未匹配</Tag> }
  ];
  const recommendationColumns: TableColumnsType<OrderOperationRecommendation> = [
    { title: '优先级', dataIndex: 'priority', width: 90, render: value => <Tag color={recommendationPriorityColor(value)}>{recommendationPriorityText(value)}</Tag> },
    { title: '问题', dataIndex: 'title', width: 190 },
    { title: '证据', dataIndex: 'evidence', width: 360 },
    { title: '动作', dataIndex: 'action', width: 420 },
    { title: '预期影响', dataIndex: 'expectedImpact', width: 300 }
  ];
  const detailColumns: TableColumnsType<EnrichedOrderDetailRecord> = [
    { title: '下单时间', dataIndex: 'orderTime', width: 165, fixed: 'left' },
    { title: '平台', dataIndex: 'platformName', width: 90 },
    { title: '订单号', dataIndex: 'orderId', width: 180, ellipsis: true },
    { title: '餐段', dataIndex: 'mealPeriod', width: 80 },
    { title: '实付', width: 90, render: (_, row) => `¥${money(row.customerPay)}`, sorter: (a, b) => a.customerPay - b.customerPay },
    { title: '原价', width: 90, render: (_, row) => `¥${money(row.grossOriginal)}`, sorter: (a, b) => a.grossOriginal - b.grossOriginal },
    { title: '补贴', width: 90, render: (_, row) => `¥${money(row.totalSubsidy)}`, sorter: (a, b) => a.totalSubsidy - b.totalSubsidy },
    { title: '估算毛利', width: 105, render: (_, row) => row.estimatedProfit === null ? '-' : `¥${money(row.estimatedProfit)}`, sorter: (a, b) => (a.estimatedProfit || 0) - (b.estimatedProfit || 0) },
    { title: '配送', dataIndex: 'deliveryType', width: 110 },
    { title: '用户', width: 80, render: (_, row) => ({ new: '新客', old: '老客', unknown: '-' }[row.customerType]) },
    { title: '活动', width: 240, render: (_, row) => (
      <Space wrap size={[4, 4]}>
        {(Object.keys(ORDER_ACTIVITY_TYPE_LABELS) as OrderActivityType[])
          .filter(type => row.activityFlags[type])
          .map(type => <Tag key={type}>{ORDER_ACTIVITY_TYPE_LABELS[type]}</Tag>)}
      </Space>
    ) },
    { title: '商品', width: 320, render: (_, row) => row.productItems.map(item => `${item.name}x${item.quantity}`).join(' / ') },
    { title: '未匹配商品', width: 220, render: (_, row) => row.unmatchedProductNames.join(' / ') || '-' }
  ];
  const importColumns: TableColumnsType<OrderImportBatch> = [
    { title: '导入时间', dataIndex: 'importedAt', width: 170, render: value => importedAtText(String(value || '')) },
    { title: '平台', dataIndex: 'platformName', width: 90 },
    { title: '文件', dataIndex: 'fileName', width: 280, ellipsis: true },
    { title: '日期范围', width: 190, render: (_, row) => dateRangeText(row.dateStart, row.dateEnd) },
    { title: '订单数', dataIndex: 'rowCount', width: 90 },
    { title: '覆盖', dataIndex: 'replacedOrders', width: 90 },
    { title: '跳过', dataIndex: 'skippedRows', width: 90 },
    { title: '提示', width: 320, render: (_, row) => row.warnings.slice(0, 2).join('；') || '-' }
  ];
  const payBandChartRows = orderPayBandRows.map(row => ({
    ...row,
    value: row.orderCount,
    avgPay: roundMoney(row.avgPay)
  }));
  const hourChartRows = orderHourRows.map(row => ({
    ...row,
    value: row.orderCount
  }));
  const activityChartRows = orderActivityRows.map(row => ({
    ...row,
    value: row.orderCount
  }));
  return (
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Card
        title="订单分析"
        extra={
          <Space wrap>
            <Upload {...uploadProps(importOrderAnalysisFile)}><Button icon={<UploadOutlined />}>导入订单文件</Button></Upload>
            <Button icon={<DownloadOutlined />} onClick={exportOrderAnalysis}>导出分析</Button>
          </Space>
        }
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Select
              style={{ width: 140 }}
              value={orderAnalysisPlatform}
              onChange={setOrderAnalysisPlatform}
              options={[
                { value: 'all', label: '全部平台' },
                ...PLATFORMS.map(platform => ({ value: platform, label: PLATFORM_NAMES[platform] }))
              ]}
            />
            <RangePicker
              allowClear
              disabled={!orderStoreRecords.length}
              format="YYYY-MM-DD"
              placeholder={['开始日期', '结束日期']}
              presets={orderDateRangePresets}
              style={{ width: 360 }}
              value={orderDateRangePickerValue}
              onChange={(_, dateStrings) => updateOrderAnalysisDateRange(Array.isArray(dateStrings) ? dateStrings : [])}
            />
            <Tag color="blue">{orderStoreRecords.length} 单</Tag>
            <Tag>数据范围：{dateRangeText(orderDataDateBounds.start, orderDataDateBounds.end)}</Tag>
            <Tag color="green">当前统计：{orderActiveDateRangeText}</Tag>
          </Space>
          <Text type="secondary">导入美团或饿了么订单明细后，系统按有效订单分析用户实付、下单时段、活动类型和商品偏好；重复订单号会用新导入记录覆盖。</Text>
        </Space>
      </Card>

      <Card title="订单总览">
        <Row gutter={[12, 12]}>
          <Col xs={12} md={6}>{renderOrderMetric('订单数', orderSummary.orderCount, `${orderSummary.platformCount} 个平台`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('单均实付', `¥${money(orderSummary.avgPay)}`, `总实付 ¥${money(orderSummary.customerPay)}`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('单均原价', `¥${money(orderSummary.avgOriginal)}`, `总原价 ¥${money(orderSummary.grossOriginal)}`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('平均让利率', orderSummary.discountRate === null ? '-' : rateText(orderSummary.discountRate), `单均补贴 ¥${money(orderSummary.avgDiscount)}`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('商家单均补贴', `¥${money(orderSummary.merchantSubsidyPerOrder)}`, `商家合计 ¥${money(orderSummary.merchantSubsidy)}`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('平台单均补贴', `¥${money(orderSummary.platformSubsidyPerOrder)}`, `平台合计 ¥${money(orderSummary.platformSubsidy)}`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('估算单均毛利', orderProfitSummary.avgEstimatedProfit === null ? '-' : `¥${money(orderProfitSummary.avgEstimatedProfit)}`, `覆盖 ${orderProfitSummary.costCoverageRate === null ? '-' : rateText(orderProfitSummary.costCoverageRate)}`)}</Col>
          <Col xs={12} md={6}>{renderOrderMetric('疑似亏损单', orderProfitSummary.lossOrderCount, orderProfitSummary.lossOrderRate === null ? '成本未完整匹配' : rateText(orderProfitSummary.lossOrderRate))}</Col>
        </Row>
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card title="支付价区间">
            {payBandChartRows.some(row => row.value > 0) ? (
              <div className="chart-frame">
                <AntvDualAxes
                  data={payBandChartRows}
                  height={280}
                  autoFit
                  xField="label"
                  axis={{
                    x: { title: '支付价区间', labelAutoRotate: false },
                    y: false
                  }}
                  scale={{
                    y: { independent: true, nice: true },
                    color: { range: ['#376996', '#d95b18'] }
                  }}
                  children={[
                    {
                      type: 'interval',
                      yField: 'value',
                      axis: {
                        y: {
                          title: '订单数',
                          labelFormatter: (value: number | string) => `${Math.round(Number(value))}`
                        }
                      },
                      style: {
                        fill: '#376996',
                        radiusTopLeft: 4,
                        radiusTopRight: 4
                      }
                    },
                    {
                      type: 'line',
                      yField: 'avgPay',
                      shapeField: 'smooth',
                      axis: {
                        y: {
                          position: 'right',
                          title: '单均实付',
                          labelFormatter: (value: number | string) => `¥${money(value)}`
                        }
                      },
                      style: {
                        stroke: '#d95b18',
                        lineWidth: 2.4
                      },
                      point: {
                        sizeField: 4,
                        style: {
                          fill: '#d95b18',
                          stroke: '#fff',
                          lineWidth: 1
                        }
                      }
                    }
                  ]}
                  tooltip={{
                    title: (datum: { label?: string }) => datum.label || '',
                    items: [
                      { field: 'value', name: '订单数' },
                      { field: 'avgPay', name: '单均实付', valueFormatter: (value: number) => `¥${money(value)}` }
                    ]
                  }}
                />
              </div>
            ) : <div className="chart-empty">暂无支付价区间数据</div>}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="下单小时">
            {hourChartRows.length ? (
              <div className="chart-frame">
                <AntvColumn
                  data={hourChartRows}
                  height={280}
                  autoFit
                  xField="label"
                  yField="value"
                  axis={{ x: { title: '小时' }, y: { title: '订单数' } }}
                  scale={{ color: { range: ['#4f8f73'] } }}
                />
              </div>
            ) : <div className="chart-empty">暂无下单小时数据</div>}
          </Card>
        </Col>
      </Row>

      <Card title="运营建议">
        {orderOperationRecommendations.length ? (
          <Table rowKey="key" size="small" columns={recommendationColumns} dataSource={orderOperationRecommendations} pagination={false} scroll={{ x: 1360 }} />
        ) : <div className="chart-empty">暂无足够订单生成运营建议</div>}
      </Card>

      <Card title="活动方向">
        {orderInsights.length ? (
          <Row gutter={[12, 12]}>
            {orderInsights.map(item => (
              <Col xs={24} lg={12} key={item.key}>
                <Card size="small" title={item.title}>
                  <Space direction="vertical" size="small">
                    <Text>{item.description}</Text>
                    <Text type="secondary">{item.suggestion}</Text>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        ) : <div className="chart-empty">暂无足够订单生成活动方向</div>}
      </Card>

      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card title="餐段偏好">
            <Table rowKey="key" size="small" columns={aggregateColumns} dataSource={orderMealPeriodRows} pagination={false} scroll={{ x: 870 }} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card title="活动类型偏好">
            {activityChartRows.length ? (
              <div className="chart-frame">
                <AntvColumn
                  data={activityChartRows}
                  height={220}
                  autoFit
                  xField="activityName"
                  yField="value"
                  axis={{ x: { title: '活动类型', labelAutoRotate: false }, y: { title: '订单数' } }}
                  scale={{ color: { range: ['#b7791f'] } }}
                />
              </div>
            ) : <div className="chart-empty">暂无活动类型数据</div>}
            <Table rowKey="key" size="small" columns={activityColumns} dataSource={orderActivityRows} pagination={false} scroll={{ x: 890 }} />
          </Card>
        </Col>
      </Row>

      <Card title="平台对比">
        <Table rowKey="key" size="small" columns={aggregateColumns} dataSource={orderPlatformRows} pagination={false} scroll={{ x: 870 }} />
      </Card>

      <Card title="支付价区间明细">
        <Table rowKey="key" size="small" columns={aggregateColumns} dataSource={orderPayBandRows} pagination={false} scroll={{ x: 870 }} />
      </Card>

      <Card title="活动组合归因">
        <Table rowKey="key" size="small" columns={comboColumns} dataSource={orderActivityComboRows} pagination={{ pageSize: 8 }} scroll={{ x: 1060 }} />
      </Card>

      <Card title="平台 × 支付价">
        <Table rowKey="key" size="small" columns={crossColumns} dataSource={orderPlatformPayBandRows} pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} />
      </Card>

      <Card title="餐段 × 支付价">
        <Table rowKey="key" size="small" columns={crossColumns} dataSource={orderMealPayBandRows} pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} />
      </Card>

      <Card title="活动组合 × 支付价">
        <Table rowKey="key" size="small" columns={crossColumns} dataSource={orderActivityComboPayBandRows} pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} />
      </Card>

      <Card title="商品偏好">
        <Table rowKey="key" size="small" columns={productColumns} dataSource={orderProductRows.slice(0, 80)} pagination={{ pageSize: 10 }} scroll={{ x: 1110 }} />
      </Card>

      <Card title="订单明细">
        <Table rowKey="key" size="small" columns={detailColumns} dataSource={enrichedOrderRecords} pagination={{ pageSize: 10 }} scroll={{ x: 1840 }} />
      </Card>

      <Card title="导入记录">
        <Table rowKey="id" size="small" columns={importColumns} dataSource={orderImportRows} pagination={{ pageSize: 6 }} scroll={{ x: 1230 }} />
      </Card>
    </Space>
  );
  
}
