'use client';

import React from 'react';
import { PlatformRulesCard } from '../shared/PlatformRulesCard';
import { Alert, Button, Card, Col, Drawer, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CalculatorOutlined, DeleteOutlined, EyeOutlined, PlusOutlined, SaveOutlined, StarFilled } from '@ant-design/icons';
import { appendMissingJingdongReferenceCoupons, createDefaultJingdongSubsidyCoupons, currentStoreFrom, deepClone } from '../../data/calculatorState';
import type { Activities, ActivityDesignResult, ActivityPriceBucketRow, ActivityScanComboPools, CalculatorState, FullReduction, JingdongSubsidyCoupon, Store } from '../../domain/types';
import {
  buildJingdongAnalysisRowsFromActivityBaseRows,
  buildJingdongNearTriggerRowsFromActivityBaseRows,
  runJingdongCouponTestAnalysis,
  jingdongCouponEffectiveAmount,
  jingdongCouponEffectiveMerchantAmount,
  type JingdongCouponNearTriggerRow,
  type JingdongCouponNearTriggerBucketRow,
  type JingdongCouponTestResult,
  type JingdongSubsidyAnalysisRow,
  type JingdongSubsidyBucketRiskRow
} from '../../domain/jingdongSubsidyAnalysis';
import { money, rateText, severityColor } from '../../utils/format';
import { tablePagination } from '../../utils/table';
import { useCalculatorPageProps } from '../shared/CalculatorContext';
import { useCalculatorStateCommit } from '../shared/useCalculatorStateCommit';
import { useStoreActivityDesignSettings } from '../shared/useStoreActivityDesignSettings';
import { CouponTable, DiscountActivityTable, SimpleActivityTable } from '../activity/ActivityPage';
import { ActivityConfigurationGuide } from '../activity/ActivityConfigurationGuide';
import { activityConfigurationErrors } from '../../domain/activity/configuration';
import { activityPriceScanRecordToResult, buildActivityPriceScanSignature, expandActivityOriginalBucketCombos } from '../activityDesign/activityDesignCalculationUtils';
import { buildActivityDesignCalculationSettings, normalizeActivityScanComboPools } from '../activityDesign/activityDesignPageUtils';

const { Text, Title } = Typography;

type JingdongSubsidyPageProps = {
  calculatorState: CalculatorState;
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>;
  store: Store;
};

type CouponTestTarget = {
  coupon: JingdongSubsidyCoupon;
  index: number;
};

const BUCKET_DETAIL_ROW_LIMIT = 1000;

function jingdongOriginalBuckets(result: ActivityDesignResult | null): ActivityPriceBucketRow[] {
  return (result?.originalPriceBuckets || [])
    .filter(bucket => bucket.platform === 'jingdong' && Math.max(0, Number(bucket.comboCount) || 0) > 0)
    .sort((a, b) => a.priceBucket - b.priceBucket || a.key.localeCompare(b.key, 'zh-CN'));
}

function subsidyKindText(kind: JingdongSubsidyCoupon['kind']) {
  return kind === 'large' ? '大额补贴券' : '小额叠加券';
}

type JingdongRiskDisplayRow = Pick<JingdongSubsidyAnalysisRow, 'riskType' | 'severity'>;

function riskText(row: JingdongRiskDisplayRow) {
  if (row.riskType === 'loss') return '亏损';
  if (row.riskType === 'lowProfit') return '低利润';
  return '正常';
}

function riskTag(row: JingdongRiskDisplayRow) {
  return <Tag color={severityColor(row.severity)}>{riskText(row)}</Tag>;
}

function couponText(coupon: JingdongSubsidyCoupon) {
  const extraAmount = coupon.kind === 'large' ? Math.max(0, Number(coupon.merchantExtraAmount) || 0) : 0;
  const extraText = extraAmount > 0 ? `+加码${money(extraAmount)}` : '';
  const merchantText = extraAmount > 0 ? `商${money(coupon.merchantAmount)}+${money(extraAmount)}` : `商${money(coupon.merchantAmount)}`;
  return `满${money(coupon.threshold)}减${money(coupon.amount)}${extraText} / ${merchantText} 平${money(coupon.platformAmount)}`;
}

function blankSubsidyCoupon(kind: JingdongSubsidyCoupon['kind']): JingdongSubsidyCoupon {
  return {
    enabled: true,
    name: kind === 'large' ? '京东外卖超级补贴券' : '京东好运小额券',
    kind,
    threshold: 0,
    amount: 0,
    merchantAmount: 0,
    merchantExtraAmount: 0,
    platformAmount: 0,
    stackableWithLarge: false
  };
}

type CouponAnalysisSortMode = 'focus' | 'discountRate' | 'amount' | 'merchantAmount' | 'threshold' | 'original';

type CouponAnalysisRow = JingdongSubsidyCoupon & {
  sourceIndex: number;
  effectiveAmount: number;
  effectiveMerchantAmount: number;
  discountRate: number | null;
  merchantRate: number | null;
  platformRate: number | null;
  merchantShare: number | null;
  focusReasons: string[];
};

const COUPON_ANALYSIS_SORT_OPTIONS: Array<{ value: CouponAnalysisSortMode; label: string }> = [
  { value: 'focus', label: '重点优先' },
  { value: 'discountRate', label: '优惠率高优先' },
  { value: 'amount', label: '券面优惠高优先' },
  { value: 'merchantAmount', label: '商家承担高优先' },
  { value: 'threshold', label: '门槛低优先' },
  { value: 'original', label: '原始顺序' }
];

function couponRate(amount: number, threshold: number) {
  return threshold > 0 ? amount / threshold : null;
}

function couponAnalysisCompare(a: CouponAnalysisRow, b: CouponAnalysisRow, mode: CouponAnalysisSortMode) {
  const rateA = a.discountRate ?? -Infinity;
  const rateB = b.discountRate ?? -Infinity;
  const merchantRateA = a.merchantRate ?? -Infinity;
  const merchantRateB = b.merchantRate ?? -Infinity;
  if (mode === 'focus') {
    return b.focusReasons.length - a.focusReasons.length
      || rateB - rateA
      || b.effectiveAmount - a.effectiveAmount
      || b.effectiveMerchantAmount - a.effectiveMerchantAmount
      || a.threshold - b.threshold
      || a.sourceIndex - b.sourceIndex;
  }
  if (mode === 'discountRate') {
    return rateB - rateA
      || b.effectiveAmount - a.effectiveAmount
      || a.threshold - b.threshold
      || a.sourceIndex - b.sourceIndex;
  }
  if (mode === 'amount') {
    return b.effectiveAmount - a.effectiveAmount
      || rateB - rateA
      || a.threshold - b.threshold
      || a.sourceIndex - b.sourceIndex;
  }
  if (mode === 'merchantAmount') {
    return b.effectiveMerchantAmount - a.effectiveMerchantAmount
      || merchantRateB - merchantRateA
      || b.effectiveAmount - a.effectiveAmount
      || a.sourceIndex - b.sourceIndex;
  }
  if (mode === 'threshold') {
    return a.threshold - b.threshold
      || b.effectiveAmount - a.effectiveAmount
      || a.sourceIndex - b.sourceIndex;
  }
  return a.sourceIndex - b.sourceIndex;
}

function buildCouponAnalysisRows(rows: JingdongSubsidyCoupon[]): CouponAnalysisRow[] {
  const analysisRows = rows.map((coupon, sourceIndex) => {
    const effectiveAmount = jingdongCouponEffectiveAmount(coupon);
    const effectiveMerchantAmount = jingdongCouponEffectiveMerchantAmount(coupon);
    return {
      ...coupon,
      sourceIndex,
      effectiveAmount,
      effectiveMerchantAmount,
      discountRate: couponRate(effectiveAmount, coupon.threshold),
      merchantRate: couponRate(effectiveMerchantAmount, coupon.threshold),
      platformRate: couponRate(Math.max(0, Number(coupon.platformAmount) || 0), coupon.threshold),
      merchantShare: effectiveAmount > 0 ? effectiveMerchantAmount / effectiveAmount : null,
      focusReasons: []
    };
  });

  const focusByIndex = new Map<number, Set<string>>();
  const markFocus = (row: CouponAnalysisRow, reason: string) => {
    const reasons = focusByIndex.get(row.sourceIndex) || new Set<string>();
    reasons.add(reason);
    focusByIndex.set(row.sourceIndex, reasons);
  };
  const enabledLargeRows = analysisRows.filter(row => row.enabled && row.kind === 'large' && row.effectiveAmount > 0 && row.threshold > 0);
  enabledLargeRows
    .slice()
    .sort((a, b) => (b.discountRate ?? 0) - (a.discountRate ?? 0) || b.effectiveAmount - a.effectiveAmount || a.threshold - b.threshold)
    .slice(0, 3)
    .forEach(row => markFocus(row, '高优惠率'));
  enabledLargeRows
    .slice()
    .sort((a, b) => b.effectiveAmount - a.effectiveAmount || (b.discountRate ?? 0) - (a.discountRate ?? 0) || a.threshold - b.threshold)
    .slice(0, 3)
    .forEach(row => markFocus(row, '高券面'));
  enabledLargeRows
    .slice()
    .sort((a, b) => b.effectiveMerchantAmount - a.effectiveMerchantAmount || (b.merchantRate ?? 0) - (a.merchantRate ?? 0) || a.threshold - b.threshold)
    .slice(0, 3)
    .forEach(row => markFocus(row, '高商家承担'));

  analysisRows
    .filter(row => row.enabled && row.kind === 'small' && row.stackableWithLarge && row.effectiveAmount > 0)
    .sort((a, b) => b.effectiveAmount - a.effectiveAmount || (b.discountRate ?? 0) - (a.discountRate ?? 0) || a.threshold - b.threshold)
    .slice(0, 2)
    .forEach(row => markFocus(row, '叠加重点'));

  return analysisRows.map(row => ({
    ...row,
    focusReasons: Array.from(focusByIndex.get(row.sourceIndex) || [])
  }));
}

function JingdongSubsidyCouponTable({
  rows,
  disabled,
  onChange,
  onTest
}: {
  rows: JingdongSubsidyCoupon[];
  disabled: boolean;
  onChange: (rows: JingdongSubsidyCoupon[]) => void;
  onTest: (coupon: JingdongSubsidyCoupon, index: number) => void;
}) {
  const [sortMode, setSortMode] = React.useState<CouponAnalysisSortMode>('focus');
  const analysisRows = React.useMemo(
    () => buildCouponAnalysisRows(rows).sort((a, b) => couponAnalysisCompare(a, b, sortMode)),
    [rows, sortMode]
  );
  const focusRows = React.useMemo(() => analysisRows.filter(row => row.focusReasons.length), [analysisRows]);
  const updateRow = (index: number, patch: Partial<JingdongSubsidyCoupon>) => {
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };
  const columns: TableColumnsType<CouponAnalysisRow> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (_, row) => disabled
        ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
        : <Switch checked={row.enabled} onChange={enabled => updateRow(row.sourceIndex, { enabled })} />
    },
    {
      title: '类型',
      dataIndex: 'kind',
      width: 120,
      render: (_, row) => disabled
        ? <Tag color={row.kind === 'large' ? 'red' : 'blue'}>{subsidyKindText(row.kind)}</Tag>
        : (
          <Select
            value={row.kind}
            style={{ width: 116 }}
            onChange={kind => updateRow(row.sourceIndex, {
              kind: kind as JingdongSubsidyCoupon['kind'],
              merchantExtraAmount: kind === 'large' ? row.merchantExtraAmount : 0,
              stackableWithLarge: kind === 'small' ? row.stackableWithLarge : false
            })}
            options={[
              { value: 'large', label: '大额补贴券' },
              { value: 'small', label: '小额叠加券' }
            ]}
          />
        )
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 220,
      render: (_, row) => disabled
        ? (
          <Space direction="vertical" size={2}>
            <Text>{row.name || '-'}</Text>
            {row.focusReasons.length ? <Tag color="red" icon={<StarFilled />}>重点</Tag> : null}
          </Space>
        )
        : (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Input value={row.name} onChange={event => updateRow(row.sourceIndex, { name: event.target.value })} />
            {row.focusReasons.length ? <Tag color="red" icon={<StarFilled />}>重点</Tag> : null}
          </Space>
        )
    },
    {
      title: '门槛',
      dataIndex: 'threshold',
      width: 105,
      sorter: (a, b) => a.threshold - b.threshold,
      render: (_, row) => disabled
        ? `¥${money(row.threshold)}`
        : <InputNumber min={0} precision={2} value={row.threshold} onChange={value => updateRow(row.sourceIndex, { threshold: Number(value) || 0 })} />
    },
    {
      title: '券面优惠',
      dataIndex: 'amount',
      width: 105,
      sorter: (a, b) => a.effectiveAmount - b.effectiveAmount,
      render: (_, row) => disabled
        ? `¥${money(row.amount)}`
        : <InputNumber min={0} precision={2} value={row.amount} onChange={value => updateRow(row.sourceIndex, { amount: Number(value) || 0 })} />
    },
    {
      title: '商家承担',
      dataIndex: 'merchantAmount',
      width: 115,
      sorter: (a, b) => a.effectiveMerchantAmount - b.effectiveMerchantAmount,
      render: (_, row) => disabled
        ? `¥${money(row.merchantAmount)}`
        : <InputNumber min={0} precision={2} value={row.merchantAmount} onChange={value => updateRow(row.sourceIndex, { merchantAmount: Number(value) || 0 })} />
    },
    {
      title: '最大可叠加码',
      dataIndex: 'merchantExtraAmount',
      width: 115,
      render: (_, row) => {
        if (row.kind !== 'large') return <Tag>仅大额</Tag>;
        return disabled
          ? `¥${money(row.merchantExtraAmount || 0)}`
          : <InputNumber min={0} precision={2} value={row.merchantExtraAmount || 0} onChange={value => updateRow(row.sourceIndex, { merchantExtraAmount: Number(value) || 0 })} />;
      }
    },
    {
      title: '平台承担',
      dataIndex: 'platformAmount',
      width: 115,
      sorter: (a, b) => (a.platformRate ?? 0) - (b.platformRate ?? 0),
      render: (_, row) => disabled
        ? `¥${money(row.platformAmount)}`
        : <InputNumber min={0} precision={2} value={row.platformAmount} onChange={value => updateRow(row.sourceIndex, { platformAmount: Number(value) || 0 })} />
    },
    {
      title: '力度分析',
      width: 230,
      sorter: (a, b) => (a.discountRate ?? 0) - (b.discountRate ?? 0) || a.effectiveAmount - b.effectiveAmount,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Space wrap size={[4, 4]}>
            {row.focusReasons.map(reason => <Tag key={reason} color="red">{reason}</Tag>)}
            {!row.focusReasons.length ? <Tag>常规</Tag> : null}
          </Space>
          <Text type="secondary">有效优惠 ¥{money(row.effectiveAmount)} / 优惠率 {rateText(row.discountRate)}</Text>
          <Text type="secondary">商家有效承担 ¥{money(row.effectiveMerchantAmount)} / 承担率 {rateText(row.merchantRate)}</Text>
        </Space>
      )
    },
    {
      title: '叠大额券',
      dataIndex: 'stackableWithLarge',
      width: 105,
      render: (_, row) => {
        if (row.kind === 'large') return <Tag>互斥</Tag>;
        return disabled
          ? <Tag color={row.stackableWithLarge ? 'green' : 'default'}>{row.stackableWithLarge ? '可叠加' : '不叠加'}</Tag>
          : <Switch checked={row.stackableWithLarge} onChange={stackableWithLarge => updateRow(row.sourceIndex, { stackableWithLarge })} />;
      }
    },
    {
      title: '操作',
      width: disabled ? 90 : 155,
      render: (_: unknown, row: CouponAnalysisRow) => (
        <Space size={6}>
          <Button size="small" icon={<CalculatorOutlined />} onClick={() => onTest(row, row.sourceIndex)}>测试</Button>
          {disabled ? null : <Button size="small" danger icon={<DeleteOutlined />} onClick={() => onChange(rows.filter((_, rowIndex) => rowIndex !== row.sourceIndex))} />}
        </Space>
      )
    }
  ];

  return (
    <Card
      title="京东平台补贴券"
      extra={(
        <Space wrap>
          <Select<CouponAnalysisSortMode>
            value={sortMode}
            style={{ width: 150 }}
            onChange={setSortMode}
            options={COUPON_ANALYSIS_SORT_OPTIONS}
          />
          {disabled ? null : (
            <>
              <Button onClick={() => onChange(appendMissingJingdongReferenceCoupons(rows))}>补齐参考券（停用）</Button>
              <Button onClick={() => onChange(createDefaultJingdongSubsidyCoupons())}>载入默认券</Button>
              <Button icon={<PlusOutlined />} onClick={() => onChange(rows.concat(blankSubsidyCoupon('large')))}>添加大额券</Button>
              <Button icon={<PlusOutlined />} onClick={() => onChange(rows.concat(blankSubsidyCoupon('small')))}>添加小额券</Button>
            </>
          )}
        </Space>
      )}
    >
      {focusRows.length ? (
        <Space wrap size={[6, 6]} style={{ marginBottom: 12 }}>
          <Text type="secondary">重点券</Text>
          {focusRows.map(row => (
            <Tag key={row.sourceIndex} color="red" icon={<StarFilled />}>
              {row.name || subsidyKindText(row.kind)} / 优惠率 {rateText(row.discountRate)}
            </Tag>
          ))}
        </Space>
      ) : null}
      <Table rowKey={row => String(row.sourceIndex)} size="small" columns={columns} dataSource={analysisRows} pagination={false} scroll={{ x: 1480 }} />
    </Card>
  );
}

function priceChain(row: JingdongSubsidyAnalysisRow) {
  return (
    <div className="table-metric-stack">
      <span>原价 ¥{money(row.originalTotal)}</span>
      <span>折扣后 ¥{money(row.afterProductDiscount)}</span>
      <span>门店后 ¥{money(row.afterStoreDiscount)}</span>
      <span>实付 ¥{money(row.finalPay)}</span>
    </div>
  );
}

type JingdongMerchantCostRow = Pick<JingdongSubsidyAnalysisRow, 'subsidySelection' | 'freightSubsidy' | 'merchantActivityAmount'>;

function merchantCost(row: JingdongMerchantCostRow) {
  return (
    <div className="table-metric-stack">
      <span>券商家承担 ¥{money(row.subsidySelection.merchantAmount)}</span>
      {row.subsidySelection.merchantExtraAmount > 0 ? <span>其中加码 ¥{money(row.subsidySelection.merchantExtraAmount)}</span> : null}
      <span>运费减免 ¥{money(row.freightSubsidy)}</span>
      <span>商家活动合计 ¥{money(row.merchantActivityAmount)}</span>
    </div>
  );
}

type JingdongFeeRow = Pick<JingdongSubsidyAnalysisRow, 'commission' | 'serviceFee' | 'merchantSettlement'>;

function feeStack(row: JingdongFeeRow) {
  return (
    <div className="table-metric-stack">
      <span>佣金 ¥{money(row.commission)}</span>
      <span>配送服务 ¥{money(row.serviceFee)}</span>
      <span>商家结算 ¥{money(row.merchantSettlement)}</span>
    </div>
  );
}

function profitStack(row: JingdongSubsidyAnalysisRow) {
  return (
    <div className="table-metric-stack">
      <span>到手 ¥{money(row.netPay)}</span>
      <span>成本 ¥{money(row.cost)}</span>
      <span>利润 ¥{money(row.profit)}</span>
      <span>利润率 {rateText(row.profitRate)}</span>
    </div>
  );
}

function suggestionStack(row: JingdongSubsidyAnalysisRow) {
  return (
    <Space direction="vertical" size={2}>
      {row.avoidSuggestion ? <Text type="secondary">{row.avoidSuggestion.text}</Text> : null}
      {row.increaseSuggestion ? <Text>{row.increaseSuggestion.text}</Text> : null}
      {!row.avoidSuggestion && !row.increaseSuggestion ? <Text type="secondary">无需调价</Text> : null}
    </Space>
  );
}

function subsidySelectionStack(row: Pick<JingdongSubsidyAnalysisRow, 'subsidySelection'>) {
  return (
    <Space direction="vertical" size={2}>
      <Text>{row.subsidySelection.name}</Text>
      <Text type="secondary">{row.subsidySelection.coupons.map(couponText).join('；')}</Text>
      {row.subsidySelection.isUserBest ? <Tag color="blue">用户最优</Tag> : null}
    </Space>
  );
}

function bucketPriceChain(row: JingdongSubsidyBucketRiskRow) {
  return (
    <div className="table-metric-stack">
      <span>桶均原价 ¥{money(row.originalTotal)}</span>
      <span>满减 ¥{money(row.full.amount)}</span>
      <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
      <span>券前价 ¥{money(row.afterStoreDiscount)}</span>
      <span>实付 ¥{money(row.finalPay)}</span>
    </div>
  );
}

function bucketProfitStack(row: JingdongSubsidyBucketRiskRow) {
  return (
    <div className="table-metric-stack">
      <span>平均成本 ¥{money(row.avgCost)} / 利润 ¥{money(row.avgProfit)}</span>
      <span>最高成本 ¥{money(row.maxCost)} / 最低利润 ¥{money(row.worstProfit)}</span>
      <span>最低利润率 {rateText(row.worstProfitRate)}</span>
      <span>最低利润空间 ¥{money(row.worstProfitSpace)}</span>
    </div>
  );
}

function bucketReasonStack(row: JingdongSubsidyBucketRiskRow) {
  return (
    <Space direction="vertical" size={2}>
      {row.reasons.map(reason => <Text key={reason} type={row.severity === 'none' ? 'secondary' : undefined}>{reason}</Text>)}
    </Space>
  );
}

function bucketSuggestionStack(row: JingdongSubsidyBucketRiskRow) {
  return (
    <Space direction="vertical" size={2}>
      {row.avoidSuggestion ? <Text type="secondary">{row.avoidSuggestion.text}</Text> : null}
      {row.increaseSuggestion ? <Text>{row.increaseSuggestion.text}</Text> : null}
      {!row.avoidSuggestion && !row.increaseSuggestion ? <Text type="secondary">无需调价</Text> : null}
    </Space>
  );
}

function nearBucketPriceChain(row: JingdongCouponNearTriggerBucketRow) {
  return (
    <div className="table-metric-stack">
      <span>桶均原价 ¥{money(row.originalTotal)}</span>
      <span>满减 ¥{money(row.full.amount)}</span>
      <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
      <span>券前价 ¥{money(row.afterStoreDiscount)}</span>
      <span>差门槛 ¥{money(row.thresholdGap)}</span>
    </div>
  );
}

function nearBucketCostStack(row: JingdongCouponNearTriggerBucketRow) {
  return (
    <div className="table-metric-stack">
      <span>平均成本 ¥{money(row.avgCost)}</span>
      <span>最低成本 ¥{money(row.minCost)}</span>
      <span>最高成本 ¥{money(row.maxCost)}</span>
    </div>
  );
}

function nearPriceChain(row: JingdongCouponNearTriggerRow) {
  return (
    <div className="table-metric-stack">
      <span>原价 ¥{money(row.originalTotal)}</span>
      <span>折扣后 ¥{money(row.afterProductDiscount)}</span>
      <span>门店后 ¥{money(row.afterStoreDiscount)}</span>
      <span>差门槛 ¥{money(row.thresholdGap)}</span>
    </div>
  );
}

function addOnSuggestionStack(row: JingdongCouponNearTriggerRow) {
  if (!row.addOnSuggestions.length) return <Text type="secondary">无单个凑单商品</Text>;
  return (
    <Space direction="vertical" size={2}>
      {row.addOnSuggestions.map(item => (
        <Text key={`${item.productId}:${item.afterCouponBasis}`} type="secondary">
          {item.name} ¥{money(item.amount)} {'->'} 门店后 ¥{money(item.afterCouponBasis)}
          {item.willTrigger ? ' 可触发' : ` 还差 ¥${money(item.remainingGap)}`}
        </Text>
      ))}
    </Space>
  );
}

function couponTestSummaryCards(result: JingdongCouponTestResult | null, progress: JingdongCouponTestResult['summary'] | null) {
  const summary = result?.summary || progress;
  const isBucketSummary = summary?.source === 'bucketSummary';
  return (
    <Row gutter={[12, 12]}>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">{isBucketSummary ? '命中桶' : '命中组合'}</Text><Title level={4}>{summary?.eligibleCount ?? 0}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">{isBucketSummary ? '接近触发桶' : '接近触发'}</Text><Title level={4}>{summary?.nearTriggerCount ?? 0}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">{isBucketSummary ? '亏损桶' : '亏损组合'}</Text><Title level={4}>{summary?.lossCount ?? 0}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">最低利润</Text><Title level={4}>{summary?.worstProfit === null || summary?.worstProfit === undefined ? '-' : `¥${money(summary.worstProfit)}`}</Title></Card></Col>
    </Row>
  );
}

export function JingdongSubsidyPage(pageProps: Partial<JingdongSubsidyPageProps> = {}) {
  const { calculatorState, setCalculatorState, store, dataRepository } = useCalculatorPageProps(pageProps);
  const commitCalculatorState = useCalculatorStateCommit(calculatorState, setCalculatorState);
  const storeActivityDesignSettings = useStoreActivityDesignSettings(calculatorState, store);
  const sourceActivities = store.activities.jingdong;
  const [draft, setDraft] = React.useState<Activities | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [couponTestOpen, setCouponTestOpen] = React.useState(false);
  const [couponTestTarget, setCouponTestTarget] = React.useState<CouponTestTarget | null>(null);
  const [selectedTestSmallIndexes, setSelectedTestSmallIndexes] = React.useState<number[]>([]);
  const [isCouponTestRunning, setIsCouponTestRunning] = React.useState(false);
  const [couponTestResult, setCouponTestResult] = React.useState<JingdongCouponTestResult | null>(null);
  const [couponTestProgress, setCouponTestProgress] = React.useState<JingdongCouponTestResult['summary'] | null>(null);
  const [activityScanResult, setActivityScanResult] = React.useState<ActivityDesignResult | null>(null);
  const [activityScanComboPools, setActivityScanComboPools] = React.useState<ActivityScanComboPools | null>(null);
  const [activityScanCacheText, setActivityScanCacheText] = React.useState('');
  const [isActivityScanCacheLoading, setIsActivityScanCacheLoading] = React.useState(false);
  const [bucketDetailOpen, setBucketDetailOpen] = React.useState(false);
  const [bucketDetailMode, setBucketDetailMode] = React.useState<'hit' | 'near'>('hit');
  const [selectedBucketRisk, setSelectedBucketRisk] = React.useState<JingdongSubsidyBucketRiskRow | null>(null);
  const [selectedNearBucketRisk, setSelectedNearBucketRisk] = React.useState<JingdongCouponNearTriggerBucketRow | null>(null);
  const [bucketDetailRows, setBucketDetailRows] = React.useState<JingdongSubsidyAnalysisRow[]>([]);
  const [bucketNearDetailRows, setBucketNearDetailRows] = React.useState<JingdongCouponNearTriggerRow[]>([]);
  const [bucketDetailText, setBucketDetailText] = React.useState('');
  const isEditing = draft !== null;
  const activities = draft || sourceActivities;

  React.useEffect(() => {
    setDraft(null);
    setCouponTestOpen(false);
    setCouponTestTarget(null);
    setCouponTestResult(null);
    setCouponTestProgress(null);
    setBucketDetailOpen(false);
    setBucketDetailMode('hit');
    setSelectedBucketRisk(null);
    setSelectedNearBucketRisk(null);
    setBucketDetailRows([]);
    setBucketNearDetailRows([]);
    setBucketDetailText('');
  }, [sourceActivities, store.id]);

  React.useEffect(() => {
    let ignore = false;
    setActivityScanResult(null);
    setActivityScanComboPools(null);
    setActivityScanCacheText('');
    setIsActivityScanCacheLoading(true);
    const scanSettings = buildActivityDesignCalculationSettings(store, storeActivityDesignSettings, { calculationMode: 'priceScan' });
    const expectedSignature = buildActivityPriceScanSignature(calculatorState, store, scanSettings);
    dataRepository.loadActivityPriceScanRecord(store.id)
      .then(record => {
        if (ignore) return;
        if (!record) {
          setActivityScanCacheText('未找到活动设计原价扫描缓存，京东测算会临时现算商品组合。');
          return;
        }
        if (record.signature !== expectedSignature) {
          setActivityScanCacheText('活动设计原价扫描缓存已过期，请在活动设计页重新扫描后再复用京东组合。');
          return;
        }
        const scanResult = activityPriceScanRecordToResult(record);
        const jingdongBucketCount = jingdongOriginalBuckets(scanResult).length;
        const pools = normalizeActivityScanComboPools(record.scanComboPools);
        const mainCount = pools.mainComboCountByPlatform.jingdong ?? pools.mainCombos.filter(row => row.platform === 'jingdong').length;
        const addOnCount = pools.addOnComboCountByPlatform.jingdong ?? pools.addOnCombos.filter(row => row.platform === 'jingdong').length;
        if (!jingdongBucketCount && !mainCount) {
          setActivityScanCacheText('活动设计原价扫描缓存未包含京东原价桶，请在活动设计页重新扫描。');
          return;
        }
        setActivityScanResult(scanResult);
        if (mainCount) setActivityScanComboPools(pools);
        const detailText = mainCount ? `主组合 ${mainCount}，凑单组合 ${addOnCount}` : '缺少组合池，暂不能展开明细';
        setActivityScanCacheText(`已复用活动设计京东原价桶 ${jingdongBucketCount} 个；${detailText}`);
      })
      .catch(() => {
        if (!ignore) setActivityScanCacheText('活动设计原价扫描缓存读取失败，京东测算会临时现算商品组合。');
      })
      .finally(() => {
        if (!ignore) setIsActivityScanCacheLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [calculatorState, dataRepository, store, storeActivityDesignSettings]);

  const stackableSmallCouponOptions = React.useMemo(() => activities.jingdongSubsidyCoupons
    .map((coupon, index) => ({ coupon, index }))
    .filter(row => row.coupon.kind === 'small' && row.coupon.stackableWithLarge && row.coupon.enabled)
    .map(row => ({
      value: row.index,
      label: row.coupon.name || `小额券${row.index + 1}`
    })), [activities.jingdongSubsidyCoupons]);

  const updateDraft = (mutator: (value: Activities) => void) => {
    setDraft(prev => {
      const next = deepClone(prev || sourceActivities);
      mutator(next);
      return next;
    });
  };

  const saveEdit = async () => {
    if (!draft || activityConfigurationErrors(draft).length) return;
    setIsSaving(true);
    try {
      await commitCalculatorState(stateDraft => {
        currentStoreFrom(stateDraft).activities.jingdong = deepClone(draft);
      }, '京东活动和补贴券已保存到浏览器数据库。');
      setDraft(null);
    } finally {
      setIsSaving(false);
    }
  };

  const runCouponTest = async (
    target = couponTestTarget,
    smallIndexes = selectedTestSmallIndexes
  ) => {
    if (!target || isCouponTestRunning) return;
    const initialBucketCount = jingdongOriginalBuckets(activityScanResult).length;
    setIsCouponTestRunning(true);
    setCouponTestResult(null);
    setCouponTestProgress({
      resultCount: 0,
      comboCount: 0,
      validComboCount: 0,
      eligibleCount: 0,
      nearTriggerCount: 0,
      lossCount: 0,
      lowProfitCount: 0,
      safeCount: 0,
      worstProfit: null,
      displayedResultCount: 0,
      displayedNearTriggerCount: 0,
      bucketCount: initialBucketCount,
      source: initialBucketCount ? 'bucketSummary' : 'comboDetail',
      elapsedTime: null
    });
    try {
      const analysisState = deepClone(calculatorState);
      currentStoreFrom(analysisState).activities.jingdong = deepClone(activities);
      const currentCoupons = currentStoreFrom(analysisState).activities.jingdong.jingdongSubsidyCoupons;
      const targetCoupon = currentCoupons[target.index] || target.coupon;
      const selectedSmallCoupons = targetCoupon.kind === 'large'
        ? smallIndexes
          .map(index => currentCoupons[index])
          .filter((coupon): coupon is JingdongSubsidyCoupon => Boolean(coupon && coupon.kind === 'small' && coupon.stackableWithLarge))
        : [];
      const result = await runJingdongCouponTestAnalysis(analysisState, {
        targetCoupon,
        selectedSmallCoupons,
        maxRows: 200,
        reuseOnly: true
      }, progress => {
        setCouponTestProgress(prev => ({
          resultCount: progress.resultCount,
          comboCount: progress.comboCount,
          validComboCount: progress.validComboCount,
          eligibleCount: prev?.eligibleCount ?? 0,
          nearTriggerCount: prev?.nearTriggerCount ?? 0,
          lossCount: prev?.lossCount ?? 0,
          lowProfitCount: prev?.lowProfitCount ?? 0,
          safeCount: prev?.safeCount ?? 0,
          worstProfit: prev?.worstProfit ?? null,
          displayedResultCount: prev?.displayedResultCount ?? 0,
          displayedNearTriggerCount: prev?.displayedNearTriggerCount ?? 0,
          bucketCount: prev?.bucketCount,
          eligibleBucketCount: prev?.eligibleBucketCount,
          nearTriggerBucketCount: prev?.nearTriggerBucketCount,
          displayedEligibleBucketCount: prev?.displayedEligibleBucketCount,
          displayedNearTriggerBucketCount: prev?.displayedNearTriggerBucketCount,
          source: prev?.source,
          elapsedTime: null
        }));
      }, {
        scanComboPools: activityScanComboPools,
        originalPriceBuckets: activityScanResult?.originalPriceBuckets || null
      });
      setCouponTestResult(result);
      setCouponTestProgress(result.summary);
    } finally {
      setIsCouponTestRunning(false);
    }
  };

  const openCouponTest = (coupon: JingdongSubsidyCoupon, index: number) => {
    const target = { coupon, index };
    const defaultSmallIndexes = coupon.kind === 'large'
      ? stackableSmallCouponOptions.map(option => Number(option.value))
      : [];
    setCouponTestTarget(target);
    setSelectedTestSmallIndexes(defaultSmallIndexes);
    setCouponTestOpen(true);
    void runCouponTest(target, defaultSmallIndexes);
  };

  const activityBucketCount = React.useMemo(() => jingdongOriginalBuckets(activityScanResult).length, [activityScanResult]);

  const openBucketDetail = (row: JingdongSubsidyBucketRiskRow) => {
    setBucketDetailMode('hit');
    setSelectedBucketRisk(row);
    setSelectedNearBucketRisk(null);
    setBucketDetailOpen(true);
    setBucketDetailRows([]);
    setBucketNearDetailRows([]);
    const scanResult = activityScanResult;
    const bucket = jingdongOriginalBuckets(scanResult).find(item => item.key === row.bucketKey) || null;
    if (!scanResult || !bucket) {
      setBucketDetailText('未找到活动设计原价桶缓存，请先在活动设计页重新扫描。');
      return;
    }
    const scanPools = normalizeActivityScanComboPools(scanResult.scanComboPools);
    const hasJingdongComboPool = scanPools.mainCombos.some(item => item.platform === 'jingdong')
      && scanPools.addOnCombos.some(item => item.platform === 'jingdong');
    if (!hasJingdongComboPool) {
      setBucketDetailText('活动设计缓存缺少京东组合池，当前只能查看汇总风险，请先在活动设计页重新扫描。');
      return;
    }
    const analysisState = deepClone(calculatorState);
    currentStoreFrom(analysisState).activities.jingdong = deepClone(activities);
    const analysisStore = currentStoreFrom(analysisState);
    const maxChecks = Math.max(1, Math.floor(Number(analysisStore.maxChecks) || BUCKET_DETAIL_ROW_LIMIT));
    const detailLimit = Math.min(BUCKET_DETAIL_ROW_LIMIT, maxChecks);
    const baseRows = expandActivityOriginalBucketCombos(
      scanResult,
      bucket,
      analysisState,
      analysisStore,
      storeActivityDesignSettings,
      { limit: detailLimit }
    );
    const detailRows = buildJingdongAnalysisRowsFromActivityBaseRows(analysisState, baseRows, row.subsidySelection, detailLimit);
    setBucketDetailRows(detailRows);
    const omittedCount = Math.max(0, Math.floor(Number(bucket.comboCount) || 0) - baseRows.length);
    setBucketDetailText(omittedCount > 0
      ? `已按当前京东配置复核 ${detailRows.length} 条；该桶组合较多，另有约 ${omittedCount} 条未展开。`
      : `已按当前京东配置复核 ${detailRows.length} 条组合明细。`
    );
  };

  const openNearBucketDetail = (row: JingdongCouponNearTriggerBucketRow) => {
    setBucketDetailMode('near');
    setSelectedBucketRisk(null);
    setSelectedNearBucketRisk(row);
    setBucketDetailOpen(true);
    setBucketDetailRows([]);
    setBucketNearDetailRows([]);
    const scanResult = activityScanResult;
    const bucket = jingdongOriginalBuckets(scanResult).find(item => item.key === row.bucketKey) || null;
    if (!scanResult || !bucket) {
      setBucketDetailText('未找到活动设计原价桶缓存，请先在活动设计页重新扫描。');
      return;
    }
    const scanPools = normalizeActivityScanComboPools(scanResult.scanComboPools);
    const hasJingdongComboPool = scanPools.mainCombos.some(item => item.platform === 'jingdong')
      && scanPools.addOnCombos.some(item => item.platform === 'jingdong');
    if (!hasJingdongComboPool) {
      setBucketDetailText('活动设计缓存缺少京东组合池，当前只能查看接近触发汇总，请先在活动设计页重新扫描。');
      return;
    }
    const analysisState = deepClone(calculatorState);
    currentStoreFrom(analysisState).activities.jingdong = deepClone(activities);
    const analysisStore = currentStoreFrom(analysisState);
    const maxChecks = Math.max(1, Math.floor(Number(analysisStore.maxChecks) || BUCKET_DETAIL_ROW_LIMIT));
    const detailLimit = Math.min(BUCKET_DETAIL_ROW_LIMIT, maxChecks);
    const baseRows = expandActivityOriginalBucketCombos(
      scanResult,
      bucket,
      analysisState,
      analysisStore,
      storeActivityDesignSettings,
      { limit: detailLimit }
    );
    const nearRows = buildJingdongNearTriggerRowsFromActivityBaseRows(
      analysisState,
      baseRows,
      row.subsidySelection,
      row.targetThreshold,
      row.nearMin,
      row.nearMax,
      detailLimit
    );
    setBucketNearDetailRows(nearRows);
    const omittedCount = Math.max(0, Math.floor(Number(bucket.comboCount) || 0) - baseRows.length);
    setBucketDetailText(omittedCount > 0
      ? `已按当前京东配置复核 ${nearRows.length} 条接近触发组合；该桶组合较多，另有约 ${omittedCount} 条未展开。`
      : `已按当前京东配置复核 ${nearRows.length} 条接近触发组合。`
    );
  };

  const columns: TableColumnsType<JingdongSubsidyAnalysisRow> = [
    {
      title: '风险',
      dataIndex: 'riskType',
      width: 90,
      fixed: 'left',
      render: (_, row) => riskTag(row)
    },
    {
      title: '商品组合',
      dataIndex: 'comboText',
      width: 280,
      fixed: 'left',
      render: value => <Text className="table-text-wrap">{value}</Text>
    },
    {
      title: '补贴券组合',
      dataIndex: 'subsidySelection',
      width: 300,
      render: (_, row) => subsidySelectionStack(row)
    },
    {
      title: '价格链路',
      width: 180,
      render: (_, row) => priceChain(row)
    },
    {
      title: '门店活动',
      width: 190,
      render: (_, row) => (
        <div className="table-metric-stack">
          <span>商品折扣 ¥{money(row.productDiscount)}</span>
          <span>满减 ¥{money(row.full.amount)}</span>
          <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
        </div>
      )
    },
    {
      title: '商家承担',
      width: 210,
      render: (_, row) => merchantCost(row)
    },
    {
      title: '费用',
      width: 170,
      render: (_, row) => feeStack(row)
    },
    {
      title: '到手利润',
      width: 175,
      render: (_, row) => profitStack(row)
    },
    {
      title: '建议',
      width: 430,
      render: (_, row) => suggestionStack(row)
    }
  ];

  const bucketColumns: TableColumnsType<JingdongSubsidyBucketRiskRow> = [
    {
      title: '风险',
      dataIndex: 'riskType',
      width: 90,
      fixed: 'left',
      render: (_, row) => riskTag(row)
    },
    {
      title: '原价桶',
      dataIndex: 'label',
      width: 180,
      fixed: 'left',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>¥{row.label}</Text>
          <Text type="secondary">覆盖 {row.comboCount} 个组合</Text>
          {row.riskComboCount > 0 ? <Tag color="orange">活动设计已有风险 {row.riskComboCount}</Tag> : null}
        </Space>
      )
    },
    {
      title: '补贴券组合',
      dataIndex: 'subsidySelection',
      width: 300,
      render: (_, row) => subsidySelectionStack(row)
    },
    {
      title: '价格链路',
      width: 190,
      render: (_, row) => bucketPriceChain(row)
    },
    {
      title: '门店活动',
      width: 170,
      render: (_, row) => (
        <div className="table-metric-stack">
          <span>商品折扣 ¥{money(row.productDiscount)}</span>
          <span>满减 ¥{money(row.full.amount)}</span>
          <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
        </div>
      )
    },
    {
      title: '商家承担',
      width: 210,
      render: (_, row) => merchantCost(row)
    },
    {
      title: '费用',
      width: 170,
      render: (_, row) => feeStack(row)
    },
    {
      title: '利润风险',
      width: 250,
      sorter: (a, b) => a.worstProfit - b.worstProfit,
      render: (_, row) => bucketProfitStack(row)
    },
    {
      title: '原因',
      width: 300,
      render: (_, row) => bucketReasonStack(row)
    },
    {
      title: '建议',
      width: 390,
      render: (_, row) => bucketSuggestionStack(row)
    },
    {
      title: '明细',
      width: 110,
      fixed: 'right',
      render: (_, row) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => openBucketDetail(row)}>
          查看
        </Button>
      )
    }
  ];

  const nearBucketColumns: TableColumnsType<JingdongCouponNearTriggerBucketRow> = [
    {
      title: '触发距离',
      dataIndex: 'thresholdGap',
      width: 110,
      fixed: 'left',
      sorter: (a, b) => a.thresholdGap - b.thresholdGap,
      render: (_, row) => <Tag color="orange">差 ¥{money(row.thresholdGap)}</Tag>
    },
    {
      title: '原价桶',
      dataIndex: 'label',
      width: 180,
      fixed: 'left',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>¥{row.label}</Text>
          <Text type="secondary">覆盖 {row.comboCount} 个组合</Text>
          {row.riskComboCount > 0 ? <Tag color="orange">活动设计已有风险 {row.riskComboCount}</Tag> : null}
        </Space>
      )
    },
    {
      title: '测试券组合',
      dataIndex: 'subsidySelection',
      width: 300,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.subsidySelection.name}</Text>
          <Text type="secondary">门槛 ¥{money(row.targetThreshold)}</Text>
          <Text type="secondary">{row.subsidySelection.coupons.map(couponText).join('；')}</Text>
        </Space>
      )
    },
    {
      title: '价格链路',
      width: 190,
      render: (_, row) => nearBucketPriceChain(row)
    },
    {
      title: '成本分布',
      width: 170,
      render: (_, row) => nearBucketCostStack(row)
    },
    {
      title: '明细',
      width: 110,
      fixed: 'right',
      render: (_, row) => (
        <Button size="small" icon={<EyeOutlined />} onClick={() => openNearBucketDetail(row)}>
          查看
        </Button>
      )
    }
  ];

  const nearColumns: TableColumnsType<JingdongCouponNearTriggerRow> = [
    {
      title: '触发距离',
      dataIndex: 'thresholdGap',
      width: 110,
      fixed: 'left',
      render: (_, row) => <Tag color="orange">差 ¥{money(row.thresholdGap)}</Tag>
    },
    {
      title: '商品组合',
      dataIndex: 'comboText',
      width: 280,
      fixed: 'left',
      render: value => <Text className="table-text-wrap">{value}</Text>
    },
    {
      title: '测试券组合',
      dataIndex: 'subsidySelection',
      width: 300,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>{row.subsidySelection.name}</Text>
          <Text type="secondary">门槛 ¥{money(row.targetThreshold)}</Text>
        </Space>
      )
    },
    {
      title: '价格链路',
      width: 180,
      render: (_, row) => nearPriceChain(row)
    },
    {
      title: '门店活动',
      width: 180,
      render: (_, row) => (
        <div className="table-metric-stack">
          <span>商品折扣 ¥{money(row.productDiscount)}</span>
          <span>满减 ¥{money(row.full.amount)}</span>
          <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
        </div>
      )
    },
    {
      title: '可凑单商品',
      width: 360,
      render: (_, row) => addOnSuggestionStack(row)
    }
  ];

  const couponTestTitle = couponTestTarget
    ? `${subsidyKindText(couponTestTarget.coupon.kind)}测试：${couponTestTarget.coupon.name || '-'}`
    : '补贴券专项测试';
  const couponTestWarnings = couponTestResult?.warnings || [];
  const couponTestUsingBucketSummary = couponTestResult?.summary.source === 'bucketSummary';
  const couponTestBucketRows = couponTestResult?.bucketRows || [];
  const couponTestNearBucketRows = couponTestResult?.nearBucketRows || [];

  return (
    <div className="section-stack">
      <PlatformRulesCard platform="jingdong" />
      <ActivityConfigurationGuide platform="jingdong" />
      {activityConfigurationErrors(draft || sourceActivities).length > 0 && <Alert type="error" showIcon message="活动配置需要修正" description={activityConfigurationErrors(draft || sourceActivities).join('；')} />}
      <Card
        title="京东补贴券维护"
        extra={isEditing ? (
          <Space>
            <Button onClick={() => setDraft(null)}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} disabled={activityConfigurationErrors(draft || sourceActivities).length > 0} loading={isSaving} onClick={saveEdit}>保存京东配置</Button>
          </Space>
        ) : (
          <Button type="primary" onClick={() => setDraft(deepClone(sourceActivities))}>编辑京东配置</Button>
        )}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            <Tag color="blue">当前门店：{store.name}</Tag>
            <Tag color={activityBucketCount ? 'green' : isActivityScanCacheLoading ? 'blue' : 'orange'}>
              {activityBucketCount ? '单券测试可复用原价桶' : isActivityScanCacheLoading ? '读取原价缓存' : '未复用原价缓存'}
            </Tag>
          </Space>
          <Text type="secondary">全量京东券组合风险已整合到测算结果页；本页保留京东活动维护和单张券测试。</Text>
          <Text type="secondary">按最大可用优惠测算最低实付及对应商家到手。最大可叠加码填写可同时生效的最高商家追加金额，不把新客与 Plus 等互斥追加相加；只需录入核实后的金额，无需模拟人群或时段。</Text>
          <Text type="secondary">补齐参考券只添加缺少的停用项，保留现有金额和加码；核实本店报名与最大加码后再启用并保存。</Text>
          {activityScanCacheText ? (
            <Text type={activityBucketCount ? 'secondary' : 'warning'}>{activityScanCacheText}</Text>
          ) : null}
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <SimpleActivityTable<FullReduction>
            title="京东门店满减"
            rows={activities.fullReductions}
            change={rows => updateDraft(next => { next.fullReductions = rows; })}
            blank={{ enabled: true, threshold: 0, amount: 0 }}
            disabled={!isEditing}
            money={money}
          />
        </Col>
        <Col xs={24} lg={12}>
          <CouponTable
            platform="jingdong"
            rows={activities.coupons}
            change={rows => updateDraft(next => { next.coupons = rows; })}
            disabled={!isEditing}
            money={money}
          />
        </Col>
      </Row>

      <DiscountActivityTable
        platform="jingdong"
        rows={activities.discountActivities}
        change={rows => updateDraft(next => { next.discountActivities = rows; })}
        disabled={!isEditing}
        money={money}
      />

      <JingdongSubsidyCouponTable
        rows={activities.jingdongSubsidyCoupons}
        disabled={!isEditing}
        onChange={rows => updateDraft(next => { next.jingdongSubsidyCoupons = rows; })}
        onTest={openCouponTest}
      />

      <Drawer
        title={bucketDetailMode === 'near'
          ? selectedNearBucketRisk ? `原价桶 ¥${selectedNearBucketRisk.label} 接近触发明细` : '接近触发组合明细'
          : selectedBucketRisk ? `原价桶 ¥${selectedBucketRisk.label} 组合明细` : '原价桶组合明细'}
        open={bucketDetailOpen}
        onClose={() => setBucketDetailOpen(false)}
        width="min(1180px, 96vw)"
      >
        <div className="section-stack">
          {bucketDetailMode === 'near' && selectedNearBucketRisk ? (
            <Card size="small">
              <Space wrap size={[8, 8]}>
                <Tag color="orange">差 ¥{money(selectedNearBucketRisk.thresholdGap)}</Tag>
                <Tag color="blue">覆盖 {selectedNearBucketRisk.comboCount} 个组合</Tag>
                <Tag>券前价 ¥{money(selectedNearBucketRisk.afterStoreDiscount)}</Tag>
                <Tag>门槛 ¥{money(selectedNearBucketRisk.targetThreshold)}</Tag>
                <Tag>补贴 ¥{money(selectedNearBucketRisk.subsidySelection.amount)}</Tag>
              </Space>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">{bucketDetailText}</Text>
              </div>
            </Card>
          ) : selectedBucketRisk ? (
            <Card size="small">
              <Space wrap size={[8, 8]}>
                {riskTag(selectedBucketRisk)}
                <Tag color="blue">覆盖 {selectedBucketRisk.comboCount} 个组合</Tag>
                <Tag>券前价 ¥{money(selectedBucketRisk.afterStoreDiscount)}</Tag>
                <Tag>补贴 ¥{money(selectedBucketRisk.subsidySelection.amount)}</Tag>
                <Tag>商家承担 ¥{money(selectedBucketRisk.subsidySelection.merchantAmount)}</Tag>
              </Space>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">{bucketDetailText}</Text>
              </div>
            </Card>
          ) : null}
          {bucketDetailMode === 'near' ? (
            <Table
              rowKey={row => row.key}
              size="small"
              columns={nearColumns}
              dataSource={bucketNearDetailRows}
              pagination={tablePagination(20)}
              scroll={{ x: 1410, y: 560 }}
              tableLayout="fixed"
            />
          ) : (
            <Table
              rowKey={row => row.key}
              size="small"
              columns={columns}
              dataSource={bucketDetailRows}
              pagination={tablePagination(20)}
              scroll={{ x: 2025, y: 560 }}
              tableLayout="fixed"
            />
          )}
        </div>
      </Drawer>

      <Drawer
        title={couponTestTitle}
        open={couponTestOpen}
        onClose={() => setCouponTestOpen(false)}
        width="min(1180px, 96vw)"
        extra={(
          <Space>
            {couponTestTarget?.coupon.kind === 'large' ? (
              <Select
                mode="multiple"
                allowClear
                value={selectedTestSmallIndexes}
                style={{ minWidth: 260 }}
                placeholder="选择小额券"
                onChange={value => setSelectedTestSmallIndexes(value.map(Number))}
                options={stackableSmallCouponOptions}
              />
            ) : null}
            <Button type="primary" icon={<CalculatorOutlined />} loading={isCouponTestRunning} onClick={() => runCouponTest()}>重新测试</Button>
          </Space>
        )}
      >
        <div className="section-stack">
          {couponTestSummaryCards(couponTestResult, couponTestProgress)}

          {couponTestWarnings.map(warning => (
            <Alert key={warning} type="warning" showIcon message={warning} />
          ))}

          <Card
            title={couponTestUsingBucketSummary ? '命中券原价桶' : '命中券组合'}
            extra={<Text type="secondary">最多展示 {couponTestResult?.summary.displayedResultCount ?? 0} 条</Text>}
          >
            {couponTestUsingBucketSummary ? (
              <Table
                rowKey={row => row.key}
                size="small"
                columns={bucketColumns}
                dataSource={couponTestBucketRows}
                pagination={tablePagination(20)}
                scroll={{ x: 2180, y: 360 }}
                tableLayout="fixed"
                loading={isCouponTestRunning}
              />
            ) : (
              <Table
                rowKey={row => row.key}
                size="small"
                columns={columns}
                dataSource={couponTestResult?.rows || []}
                pagination={tablePagination(20)}
                scroll={{ x: 2025, y: 360 }}
                tableLayout="fixed"
                loading={isCouponTestRunning}
              />
            )}
          </Card>

          <Card
            title={couponTestUsingBucketSummary ? '接近触发原价桶' : '接近触发组合'}
            extra={<Text type="secondary">最多展示 {couponTestResult?.summary.displayedNearTriggerCount ?? 0} 条</Text>}
          >
            {couponTestUsingBucketSummary ? (
              <Table
                rowKey={row => row.key}
                size="small"
                columns={nearBucketColumns}
                dataSource={couponTestNearBucketRows}
                pagination={tablePagination(20)}
                scroll={{ x: 1060, y: 360 }}
                tableLayout="fixed"
                loading={isCouponTestRunning}
              />
            ) : (
              <Table
                rowKey={row => row.key}
                size="small"
                columns={nearColumns}
                dataSource={couponTestResult?.nearRows || []}
                pagination={tablePagination(20)}
                scroll={{ x: 1410, y: 360 }}
                tableLayout="fixed"
                loading={isCouponTestRunning}
              />
            )}
          </Card>
        </div>
      </Drawer>
    </div>
  );
}
