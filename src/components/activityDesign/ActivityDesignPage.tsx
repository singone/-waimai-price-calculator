// @ts-nocheck
'use client';

import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import React from 'react';
import { Button, Card, Col, Input, InputNumber, Modal, Row, Space, Steps, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { pathForPage } from '../../pageRoutes';
import { PayBandAnalysisPanel } from '../shared/PayBandAnalysisPanel';
import { ProductDiscountSuggestionSection } from '../shared/ProductDiscountSuggestionSection';
import { useCalculatorStateCommit } from '../shared/useCalculatorStateCommit';
import { useStoreActivityDesignSettings } from '../shared/useStoreActivityDesignSettings';
import { PLATFORM_NAMES, PLATFORMS } from '../../domain/core';
import { average, finiteRate, roundMoney } from '../../domain/money';
import { tablePagination } from '../../utils/table';
import { dateTimeText, formatActivityOriginalDiscountTiers, money, rateText } from '../../utils/format';
import {
  ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS,
  ACTIVITY_DESIGN_STAGE_LABELS,
  ACTIVITY_FULL_AMOUNT_BASIS_OPTIONS,
  ACTIVITY_MIN_NET_PAY,
  ACTIVITY_PAY_MAX_BY_SCENARIO,
  DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS
} from '../../config/activity';
import { EMPTY_SUMMARY } from '../../config/calculation';
import type {
  ActivityBaseComboRow,
  ActivityComboSimulationRow,
  ActivityCouponBucketSuggestion,
  ActivityPriceBucketRow,
  ActivityRecommendationRow,
  ComboItem,
  Platform,
  PriceBandRow
} from '../../domain/types';
import {
  activityCostBasisLabel,
  activityFullReductionLogParts,
  activityFullReductionLogTypeColor,
  activityRecommendationRedAddOnSpace,
  activityRepresentedComboCount,
  activityRouteTypeLabel,
  buildActivityRoutePackages,
  couponChannelLabel,
  couponTargetUserLabel,
  couponThresholdModeLabel,
  itemsText,
  normalizeActivityCouponRecommendationMode,
  normalizeActivityScanComboPools,
  paymentGrossRate,
  riskColor,
  riskLabel,
  withoutColumnByDataIndex,
  type ActivityFullReductionLogSegment,
  type ActivityFullReductionLogSegmentType
} from './activityDesignPageUtils';
import { useActivityDesignCalculationState } from './useActivityDesignCalculationState';
import { useActivityDesignPageState } from './useActivityDesignPageState';

const AntvDualAxes = dynamic(() => import('@ant-design/charts').then(mod => mod.DualAxes), { ssr: false });
const { Text, Title } = Typography;

export type ActivityDesignPageProps = Record<string, any>;

function PriceBucketProfitChart({ rows, money }: { rows: ActivityPriceBucketRow[]; money: (value: unknown) => string }) {
  const data = rows.slice(0, 80).map(row => ({
    key: row.key,
    label: String(row.priceBucket),
    comboCount: row.comboCount,
    avgFinalPay: row.avgFinalPay ?? row.weightedAvgFinalPay ?? 0,
    avgNetPay: row.avgNetPay ?? row.weightedAvgNetPay ?? 0,
    avgActivitySafeDiscountSpace: row.avgActivitySafeDiscountSpace ?? row.weightedAvgActivitySafeDiscountSpace ?? 0,
    riskCount: row.riskCount,
    platformName: row.platformName
  }));
  if (!data.length) return <div className="chart-empty">暂无原价整数扫描数据</div>;
  return (
    <div className="chart-frame">
      <AntvDualAxes
        data={data}
        height={280}
        autoFit
        xField="label"
        axis={{
          x: { title: '原价整数', labelAutoRotate: false },
          y: { title: '组合数', labelFormatter: (value: number | string) => `${Math.round(Number(value))}` }
        }}
        scale={{
          y: { independent: true, nice: true },
          color: { range: ['#5b7c99', '#b85f32'] }
        }}
        children={[
          {
            type: 'interval',
            yField: 'comboCount',
            style: {
              fill: '#5b7c99',
              radiusTopLeft: 4,
              radiusTopRight: 4
            }
          },
          {
            type: 'line',
            yField: 'avgFinalPay',
            shapeField: 'smooth',
            axis: {
              y: {
                position: 'right',
                title: '平均支付价 / 到手价 / 活动空间',
                labelFormatter: (value: number | string) => `¥${money(value)}`
              }
            },
            style: {
              stroke: '#496f5d',
              lineWidth: 2.4
            },
            point: {
              sizeField: 4,
              style: {
                fill: (datum: { riskCount?: number }) => (datum.riskCount || 0) > 0 ? '#d4380d' : '#496f5d',
                stroke: '#fff',
                lineWidth: 1
              }
            }
          },
          {
            type: 'line',
            yField: 'avgNetPay',
            shapeField: 'smooth',
            style: {
              stroke: '#b85f32',
              lineDash: [5, 4],
              lineWidth: 2.2
            },
            point: {
              sizeField: 3,
              style: {
                fill: '#b85f32',
                stroke: '#fff',
                lineWidth: 1
              }
            }
          },
          {
            type: 'line',
            yField: 'avgActivitySafeDiscountSpace',
            shapeField: 'smooth',
            style: {
              stroke: '#6d6aa8',
              lineWidth: 2.2
            },
            point: {
              sizeField: 3,
              style: {
                fill: '#6d6aa8',
                stroke: '#fff',
                lineWidth: 1
              }
            }
          }
        ]}
        tooltip={{
          title: (datum: { platformName?: string; label?: string }) => `${datum.platformName || ''} 原价 ${datum.label || ''}`.trim(),
          items: [
            { field: 'comboCount', name: '组合数' },
            { field: 'avgFinalPay', name: '平均支付价', valueFormatter: (value: number) => Number.isFinite(Number(value)) ? `¥${money(value)}` : '-' },
            { field: 'avgNetPay', name: '平均到手价', valueFormatter: (value: number) => Number.isFinite(Number(value)) ? `¥${money(value)}` : '-' },
            { field: 'avgActivitySafeDiscountSpace', name: '安全活动空间', valueFormatter: (value: number) => Number.isFinite(Number(value)) ? `¥${money(value)}` : '-' },
            { field: 'riskCount', name: '到手边界风险数' }
          ]
        }}
      />
    </div>
  );
}

export function ActivityDesignPage(pageProps: ActivityDesignPageProps = {}) {
  const router = useRouter();
  const props = pageProps;
  const {
    activityObjectiveOptionsFromSettings,
    calculatorState,
    setCalculatorState,
    normalizeActivityObjectiveStrategies,
    store
  } = props;
  const commitCalculatorState = useCalculatorStateCommit(calculatorState, setCalculatorState);
  const storeActivityDesignSettings = useStoreActivityDesignSettings(calculatorState, store);
  const {
    activityDesign,
    activityPriceScanPersistenceMeta,
    applyActivityRouteToPlatform,
    applyProductDiscountSuggestion,
    expandActivityOriginalBucketCombos,
    onRunActivityDesign,
    onRunActivityDesignRouteValidation,
    onRunActivityRouteDesign,
    summary
  } = useActivityDesignCalculationState({
    calculatorState,
    store,
    storeActivityDesignSettings,
    commitCalculatorState
  });
    const navigatePage = React.useCallback((page: Parameters<typeof pathForPage>[0]) => {
      router.push(pathForPage(page));
    }, [router]);
    const couponRecommendationModeOptions = ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS;
    const {
      activityDesignPlatformTab,
      setActivityDesignPlatformTab,
      activityDesignFilters,
      setActivityDesignFilters,
      activityDesignStage,
      setActivityDesignStage,
      selectedActivityDesignBand,
      setSelectedActivityDesignBand,
      selectedActivityDesignPayBandKeyByPlatform,
      selectedActivityDesignRouteKey,
      selectedActivityCouponRoute,
      setSelectedActivityCouponRoute,
      selectedActivityFullReductionLogRoute,
      setSelectedActivityFullReductionLogRoute,
      selectedActivityOriginalBucket,
      setSelectedActivityOriginalBucket,
      activityDesignDetailSearchText,
      setActivityDesignDetailSearchText,
      isActivityDesignLoading,
      runActivityDesign,
      runActivityRouteDesign,
      runActivityDesignRouteValidation,
      changeActivityDesignStep,
      updateActivityDesignPayBandKey,
      resetActivityDesignDetailSelection
    } = useActivityDesignPageState({
      storeId: store.id,
      activityDesign,
      onRunActivityDesign,
      onRunActivityRouteDesign,
      onRunActivityDesignRouteValidation
    });

    const designSummary = activityDesign?.summary || (isActivityDesignLoading ? summary : { ...EMPTY_SUMMARY });
    const activityDesignStepCurrent = activityDesignStage === 'payValidation'
      ? 2
      : activityDesignStage === 'routeDesign'
        ? 1
        : 0;
    const activityDesignTitle = (
      <Space wrap size={6}>
        <Text strong>活动设计</Text>
        <Tag color="blue">当前阶段：{ACTIVITY_DESIGN_STAGE_LABELS[activityDesignStage]}</Tag>
        <Tag color="blue">原价桶 {activityDesign?.originalPriceBuckets?.length || 0}</Tag>
        <Tag>路线 {activityDesign?.recommendations.length || designSummary.resultCount}</Tag>
      </Space>
    );
    const activityPayMaxBoundary = ACTIVITY_PAY_MAX_BY_SCENARIO.multi;
    const activityEffectivePayMax = activityDesignFilters.payMax === ''
      ? activityPayMaxBoundary
      : Math.min(activityPayMaxBoundary, Math.max(0, Number(activityDesignFilters.payMax) || 0));
    const activityOriginalFilterMin = Math.max(0, Number(activityDesignFilters.originalMin) || 0);
    const activityOriginalFilterMax = activityDesignFilters.originalMax === ''
      ? Infinity
      : Math.max(activityOriginalFilterMin, Number(activityDesignFilters.originalMax) || 0);
    const activityPayFilterMin = Math.max(0, Number(activityDesignFilters.payMin) || 0);
    const activityPayFilterMax = activityDesignFilters.payMax === ''
      ? Infinity
      : Math.max(activityPayFilterMin, Number(activityDesignFilters.payMax) || 0);
    const activityOriginalKeyword = activityDesignFilters.productNameKeyword.trim().toLowerCase();
    const isActivityOriginalBucketInFilters = (row: ActivityPriceBucketRow) => (
      row.max > activityOriginalFilterMin + 1e-9
      && row.min < activityOriginalFilterMax - 1e-9
    );
    const isActivityPayBandInFilters = (row: PriceBandRow) => (
      row.max > activityPayFilterMin + 1e-9
      && row.min < activityPayFilterMax - 1e-9
    );
    const isActivityOriginalComboInFilters = (row: ActivityBaseComboRow) => {
      if (row.originalTotal + 1e-9 < activityOriginalFilterMin || row.originalTotal >= activityOriginalFilterMax - 1e-9) return false;
      if (!activityOriginalKeyword) return true;
      return row.items.map(item => item.name).join(' ').toLowerCase().includes(activityOriginalKeyword);
    };
    const activityRouteObjectiveOptions = activityObjectiveOptionsFromSettings(storeActivityDesignSettings);
    const routeObjectiveStrategiesFromSettings = normalizeActivityObjectiveStrategies(
      storeActivityDesignSettings.objectiveStrategies,
      storeActivityDesignSettings.targetProfitRate,
      activityRouteObjectiveOptions
    );
    const activityCurrentObjectiveStrategy = routeObjectiveStrategiesFromSettings[storeActivityDesignSettings.objective || 'longTerm'];
    const activityCurrentMinNetPayFloor = activityCurrentObjectiveStrategy?.minNetPayFloor ?? ACTIVITY_MIN_NET_PAY;
    const activityRouteStrategyOverview = activityDesignStage === 'routeDesign' ? (
      <Space direction="vertical" style={{ width: '100%' }} size={6}>
        <Text type="secondary">经营目标由全路线基准让利率、原价阶梯覆盖、活动占比和门槛策略决定；本页只用于确认当前路线引用的目标并执行核验或应用。</Text>
        <Space wrap size={[6, 6]}>
          <Text type="secondary">当前启用目标</Text>
          {activityRouteObjectiveOptions.map(option => {
            const strategy = storeActivityDesignSettings.objectiveStrategies?.[option.value];
            return (
              <Tag key={option.value} color={option.group === 'stable' ? 'blue' : 'purple'}>
                {option.label}：满减 {money(strategy?.fullDiscountShare ?? 0)}% / 券 {money(strategy?.couponDiscountShare ?? 0)}%
              </Tag>
            );
          })}
          <Button size="small" onClick={() => navigatePage('store')}>调整门店目标</Button>
          <Button size="small" onClick={() => navigatePage('system-strategy')}>系统策略</Button>
        </Space>
      </Space>
    ) : null;
    const activityPriceBucketSuggestionText = (row: ActivityPriceBucketRow) => {
      const finalPay = row.avgFinalPay ?? row.weightedAvgFinalPay ?? 0;
      const netPay = row.avgNetPay ?? row.weightedAvgNetPay ?? 0;
      const safeSpace = row.avgActivitySafeDiscountSpace ?? row.weightedAvgActivitySafeDiscountSpace ?? 0;
      if (netPay + 1e-9 < ACTIVITY_MIN_NET_PAY) return `平均到手价低于 ¥${money(ACTIVITY_MIN_NET_PAY)}，该价位不适合继续让利`;
      if (safeSpace <= 0.05) return '当前目标下没有安全活动空间，后续路线不会强行发券';
      if (safeSpace >= 3) return '存在可设计活动空间，可进入满减阶梯和原价桶券列表';
      if (row.riskCount > 0) return '存在到手边界风险组合，需查看明细确认商品组合';
      if (row.outlierCount > 0) return '存在支付价或到手价背离组合，需判断是否为策略组合';
      if (finalPay > 30) return '当前支付价偏高，生成路线时应优先检查满减梯度和券门槛';
      if (finalPay <= 25) return '已覆盖主要支付场景，可作为满减和券校验重点';
      if (netPay - ACTIVITY_MIN_NET_PAY > 8) return '到手边界空间较充足，可按活动目标测试让利';
      return '价格结构平稳，可作为满减和券分段参考';
    };
    const activityPriceBandSuggestionText = (row: PriceBandRow) => {
      if (row.ignoredCount > 0) return `有 ${row.ignoredCount} 个组合低于到手底线，已在活动核验中忽略`;
      if (row.riskCount > 0) return '存在到手边界风险组合，需查看明细';
      if (row.avgNetPay + 1e-9 < ACTIVITY_MIN_NET_PAY) return `平均到手价低于 ¥${money(ACTIVITY_MIN_NET_PAY)}，需收紧优惠`;
      if (row.avgFinalPay > 30) return '平均支付价偏高，路线未覆盖主要支付场景';
      if (row.avgFinalPay <= 25) return '已落入主要支付场景，可继续确认桶级让利空间';
      return '支付价结构正常';
    };
    const activityRouteScoreColor = (level?: ActivityRecommendationRow['scoreLevel']) => {
      if (level === 'excellent') return 'green';
      if (level === 'usable') return 'blue';
      if (level === 'risk') return 'red';
      return 'orange';
    };
    const renderActivityRouteScore = (row: ActivityRecommendationRow) => {
      const breakdown = row.scoreBreakdown;
      const label = row.scoreLabel || '待复核';
      const details = row.scoreDetails || [];
      return (
        <Space direction="vertical" size={2}>
          <Space size={4} wrap>
            <Tag color={activityRouteScoreColor(row.scoreLevel)}>{label}</Tag>
            <Text>{money(row.score)}</Text>
            <Text type="secondary">越低越好</Text>
          </Space>
          {breakdown ? (
            <Text type="secondary" className="table-text-wrap">
              经营 {money(breakdown.demandPenalty)} / 支付覆盖 {rateText(breakdown.mainPayShare ?? null)} / 覆盖要求 {rateText(breakdown.targetPayShareFloor ?? null)} / 到手边界 {money(breakdown.ignoredPenalty)} / 优惠力度 {money(breakdown.discountPenalty)}
            </Text>
          ) : null}
          {details.length ? <Text type="secondary" className="table-text-wrap">{details.join('；')}</Text> : null}
        </Space>
      );
    };
    const activityRouteRoleText = (row: ActivityRecommendationRow) => {
      if (row.fullReductionRules.length) return '满减负责公开活动底盘，路线诊断只判断满减门槛和阶梯覆盖。';
      return '当前路线未形成满减底盘，路线诊断只提示满减缺口。';
    };
    const renderActivityRouteDiagnosis = (row: ActivityRecommendationRow) => {
      const breakdown = row.scoreBreakdown;
      const fullReductionLog = activityFullReductionLogParts(row.diagnosis);
      const diagnosisText = fullReductionLog.summary
        || (fullReductionLog.entries.length ? '满减生成日志已记录，打开弹框查看详情。' : row.diagnosis)
        || '待核验路线的支付价覆盖和到手价边界。';
      return (
        <Space direction="vertical" size={2}>
          <Text>{activityRouteRoleText(row)}</Text>
          <Text type={row.scoreLevel === 'risk' ? 'danger' : row.scoreLevel === 'review' ? 'warning' : 'secondary'} className="table-text-wrap">
            {diagnosisText}
          </Text>
          {fullReductionLog.entries.length ? (
            <Space wrap size={[6, 6]}>
              <Tag color="blue">满减日志 {fullReductionLog.entries.length} 条</Tag>
              <Button size="small" onClick={() => setSelectedActivityFullReductionLogRoute(row)}>查看满减日志</Button>
            </Space>
          ) : null}
          {breakdown ? (
            <Text type="secondary" className="table-text-wrap">
              支付覆盖 {rateText(breakdown.mainPayShare ?? null)}，要求 {rateText(breakdown.targetPayShareFloor ?? null)} / 高支付价 {rateText(breakdown.highPayShare ?? null)}，上限 {rateText(breakdown.highPayShareLimit ?? null)} / 到手低于 ¥{money(ACTIVITY_MIN_NET_PAY)} 忽略 {breakdown.ignoredCount}
            </Text>
          ) : null}
        </Space>
      );
    };
    const renderActivityFullReductionLogSegments = (segments: ActivityFullReductionLogSegment[]) => {
      if (!segments.length) return <Text type="secondary">当前分段没有日志。</Text>;
      return (
        <div style={{ maxHeight: 560, overflowY: 'auto', paddingRight: 4 }}>
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {segments.map((segment, index) => (
              <div
                key={segment.key}
                style={{
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  padding: 10
                }}
              >
                <Space direction="vertical" style={{ width: '100%' }} size={4}>
                  <Space wrap size={[6, 6]}>
                    <Tag color={activityFullReductionLogTypeColor(segment.type)}>{segment.type}</Tag>
                    <Text type="secondary">#{index + 1}</Text>
                    <Text strong className="table-text-wrap">{segment.title}</Text>
                  </Space>
                  {segment.detail.map(detail => (
                    <Text key={detail} type="secondary" className="table-text-wrap" style={{ display: 'block', paddingLeft: 8 }}>
                      {detail}
                    </Text>
                  ))}
                </Space>
              </div>
            ))}
          </Space>
        </div>
      );
    };
    const renderActivityFullReductionLogModal = (row: ActivityRecommendationRow) => {
      const fullReductionLog = activityFullReductionLogParts(row.diagnosis);
      if (!fullReductionLog.entries.length) return <Text type="secondary">当前路线没有满减生成日志。</Text>;

      const groupedTabItems = (['参数', '生成', '拒绝', '退出', '其他'] as ActivityFullReductionLogSegmentType[])
        .flatMap(type => {
          const segments = fullReductionLog.segments.filter(segment => segment.type === type);
          return segments.length
            ? [{
              key: type,
              label: `${type} ${segments.length}`,
              children: renderActivityFullReductionLogSegments(segments)
            }]
            : [];
        });
      const tabItems = [
        {
          key: 'all',
          label: `全部 ${fullReductionLog.segments.length}`,
          children: renderActivityFullReductionLogSegments(fullReductionLog.segments)
        },
        ...groupedTabItems
      ];

      return (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          {fullReductionLog.summary ? <Text className="table-text-wrap">{fullReductionLog.summary}</Text> : null}
          <Space wrap size={[6, 6]}>
            <Tag color="blue">原始日志 {fullReductionLog.entries.length} 条</Tag>
            <Tag color="green">分段 {fullReductionLog.segments.length} 条</Tag>
          </Space>
          <Tabs destroyOnHidden items={tabItems} />
        </Space>
      );
    };
    const renderActivityCouponList = (row: ActivityRecommendationRow) => {
      const coupons = row.couponRules || [];
      const suggestions = row.couponBucketSuggestions || [];
      if (!coupons.length && !suggestions.length) return '-';
      const recommendedCoupons = coupons.slice(0, 5);
      return (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text type="secondary">推荐券 {coupons.length} 张 / 原价桶建议 {suggestions.length} 条</Text>
          {recommendedCoupons.length ? (
            <Text className="table-text-wrap">
              {recommendedCoupons.map(rule => `${rule.sceneName || '推荐券'}：满${money(rule.threshold)}减${money(rule.amount)}`).join('，')}
              {coupons.length > recommendedCoupons.length ? '，...' : ''}
            </Text>
          ) : <Text type="secondary">暂无最终推荐券</Text>}
          {coupons.length || suggestions.length ? <Button size="small" onClick={() => setSelectedActivityCouponRoute(row)}>查看券列表</Button> : null}
        </Space>
      );
    };
    const renderActivityRouteTarget = (row: ActivityRecommendationRow) => {
      const strategy = routeObjectiveStrategiesFromSettings[row.objective];
      const baseOriginalDiscountRate = strategy?.baseOriginalDiscountRate ?? storeActivityDesignSettings.baseOriginalDiscountRate ?? 50;
      const tierText = formatActivityOriginalDiscountTiers(strategy?.originalDiscountTiers || []);
      const fullAmountBasisLabel = ACTIVITY_FULL_AMOUNT_BASIS_OPTIONS.find(option => option.value === strategy?.fullAmountBasis)?.label || strategy?.fullAmountBasis || '-';
      const couponStrategyMode = strategy?.couponRecommendationPolicy?.mode || strategy?.couponScoringMode || 'balanced';
      const couponStrategyLabel = couponRecommendationModeOptions.find(option => option.value === couponStrategyMode)?.label || couponStrategyMode || '平稳';
      const averageTargetRate = row.targetDiscountRate === null || row.targetDiscountRate === undefined
        ? '-'
        : rateText(row.targetDiscountRate);
      const actualAvgRate = row.actualAvgDiscountRate === null || row.actualAvgDiscountRate === undefined
        ? '-'
        : rateText(row.actualAvgDiscountRate);
      const actualMinRate = row.actualMinDiscountRate === null || row.actualMinDiscountRate === undefined
        ? '-'
        : rateText(row.actualMinDiscountRate);
      const actualMaxRate = row.actualMaxDiscountRate === null || row.actualMaxDiscountRate === undefined
        ? '-'
        : rateText(row.actualMaxDiscountRate);
      return (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Space wrap size={[4, 4]}>
            <Tag color={row.routeGroup === 'stable' ? 'blue' : 'purple'}>{row.objectiveName || '-'}</Tag>
            {row.targetPayLabel ? <Tag color="cyan">{row.targetPayLabel}</Tag> : null}
          </Space>
          <Text type="secondary" className="table-text-wrap">
            基准让利 {money(baseOriginalDiscountRate)}% / 目标让利均值 {averageTargetRate} / 原价覆盖 {row.originalBandLabel || '-'}
          </Text>
          <Text type="secondary" className="table-text-wrap">
            阶梯覆盖 {tierText}
          </Text>
          <Text type="secondary" className="table-text-wrap">
            满减占比 {money(strategy?.fullDiscountShare ?? 0)}% / 券占比 {money(strategy?.couponDiscountShare ?? 0)}% / 预留 {money(strategy?.reserveDiscountShare ?? 0)}% / 券策略 {couponStrategyLabel}
          </Text>
          <Text type="secondary" className="table-text-wrap">
            满减窗口 {money(strategy?.fullThresholdWindow ?? 0)} / 间距 {money(strategy?.fullThresholdMinGap ?? 0)} / 最小增量 {money(strategy?.minFullAmountIncrease ?? 0)} / 口径 {fullAmountBasisLabel} / 最大 {strategy?.maxFullRuleCount ?? '-'} 档
          </Text>
          <Text type="secondary" className="table-text-wrap">
            执行让利均值 {actualAvgRate} / 最小 {actualMinRate} / 最大 {actualMaxRate}
          </Text>
        </Space>
      );
    };
    const activityPriceBucketColumns: TableColumnsType<ActivityPriceBucketRow> = [
      { title: '平台', dataIndex: 'platformName', width: 80, sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
      { title: '原价整数', dataIndex: 'priceBucket', width: 95, sorter: (a, b) => a.priceBucket - b.priceBucket, render: value => `¥${money(value)}` },
      { title: '价格范围', dataIndex: 'label', width: 105 },
      { title: '组合数', dataIndex: 'comboCount', width: 90, sorter: (a, b) => a.comboCount - b.comboCount },
      { title: '平均原价', dataIndex: 'avgOriginalTotal', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgOriginalTotal - b.avgOriginalTotal },
      { title: '平均基准支付价', dataIndex: 'avgFinalPay', width: 130, render: (_, row) => `¥${money(row.avgFinalPay ?? row.weightedAvgFinalPay ?? 0)}`, sorter: (a, b) => (a.avgFinalPay ?? a.weightedAvgFinalPay ?? 0) - (b.avgFinalPay ?? b.weightedAvgFinalPay ?? 0) },
      { title: '平均基准到手价', dataIndex: 'avgNetPay', width: 130, render: (_, row) => `¥${money(row.avgNetPay ?? row.weightedAvgNetPay ?? 0)}`, sorter: (a, b) => (a.avgNetPay ?? a.weightedAvgNetPay ?? 0) - (b.avgNetPay ?? b.weightedAvgNetPay ?? 0) },
      { title: '目标总优惠', dataIndex: 'avgActivityTargetDiscountAmount', width: 115, render: (_, row) => `¥${money(row.avgActivityTargetDiscountAmount ?? row.weightedAvgActivityTargetDiscountAmount ?? 0)}`, sorter: (a, b) => (a.avgActivityTargetDiscountAmount ?? a.weightedAvgActivityTargetDiscountAmount ?? 0) - (b.avgActivityTargetDiscountAmount ?? b.weightedAvgActivityTargetDiscountAmount ?? 0) },
      { title: '平台已优惠', dataIndex: 'avgActivityAlreadyDiscountAmount', width: 115, render: (_, row) => `¥${money(row.avgActivityAlreadyDiscountAmount ?? row.weightedAvgActivityAlreadyDiscountAmount ?? 0)}`, sorter: (a, b) => (a.avgActivityAlreadyDiscountAmount ?? a.weightedAvgActivityAlreadyDiscountAmount ?? 0) - (b.avgActivityAlreadyDiscountAmount ?? b.weightedAvgActivityAlreadyDiscountAmount ?? 0) },
      { title: '安全活动空间', dataIndex: 'avgActivitySafeDiscountSpace', width: 125, render: (_, row) => {
        const value = row.avgActivitySafeDiscountSpace ?? row.weightedAvgActivitySafeDiscountSpace ?? 0;
        return <Text type={Number(value) > 0 ? 'success' : 'secondary'}>¥{money(value)}</Text>;
      }, sorter: (a, b) => (a.avgActivitySafeDiscountSpace ?? a.weightedAvgActivitySafeDiscountSpace ?? 0) - (b.avgActivitySafeDiscountSpace ?? b.weightedAvgActivitySafeDiscountSpace ?? 0) },
      { title: '到手风险', dataIndex: 'riskCount', width: 95, sorter: (a, b) => a.riskCount - b.riskCount },
      { title: '诊断', dataIndex: 'suggestion', width: 280, render: (_, row) => <Text className="table-text-wrap">{activityPriceBucketSuggestionText(row)}</Text> },
      {
        title: '操作',
        width: 100,
        fixed: 'right',
        render: (_, row) => <Button size="small" onClick={() => setSelectedActivityOriginalBucket(row)}>查看组合</Button>
      }
    ];
    const activityOriginalComboColumns: TableColumnsType<ActivityBaseComboRow> = [
      { title: '商品组合', dataIndex: 'items', width: 280, fixed: 'left', render: items => <Text className="table-text-wrap">{itemsText(items as ComboItem[])}</Text> },
      { title: '原价', dataIndex: 'originalTotal', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.originalTotal - b.originalTotal },
      { title: '基准支付价', dataIndex: 'baseFinalPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseFinalPay - b.baseFinalPay },
      { title: '基准到手价', dataIndex: 'baseNetPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseNetPay - b.baseNetPay },
      { title: '到手边界', width: 110, render: (_, row) => row.baseNetPay + 1e-9 < ACTIVITY_MIN_NET_PAY ? <Text type="danger">低于 ¥{money(ACTIVITY_MIN_NET_PAY)}</Text> : <Text type="secondary">正常</Text> }
    ];
    const activityRecommendationColumns: TableColumnsType<ActivityRecommendationRow> = [
      { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left' },
      { title: '活动目标', dataIndex: 'objectiveName', width: 120, fixed: 'left', render: value => <Tag color="blue">{String(value || '-')}</Tag> },
      { title: '路线类型', width: 105, render: (_, row) => <Tag color={row.routeGroup === 'stable' ? 'blue' : 'purple'}>{activityRouteTypeLabel(row)}</Tag> },
      {
        title: '路线目标',
        width: 620,
        render: (_, row) => renderActivityRouteTarget(row)
      },
      {
        title: '满减规则',
        width: 260,
        render: (_, row) => row.fullReductionRules.length
          ? <Text className="table-text-wrap">{row.fullReductionRules.map(rule => `满${money(rule.threshold)}减${money(rule.amount)}`).join('，')}</Text>
          : '-'
      },
      {
        title: '券列表',
        width: 520,
        render: (_, row) => renderActivityCouponList(row)
      },
      {
        title: '神券/爆红包加码空间',
        dataIndex: 'addOnCostSpace',
        width: 190,
        render: (_, row) => {
          const { configuredSpace, routeSpace, totalSpace } = activityRecommendationRedAddOnSpace(row);
          if (configuredSpace <= 0 || routeSpace <= 0) return `¥${money(totalSpace)}`;
          return <Text className="table-text-wrap">¥{money(totalSpace)}（参数¥{money(configuredSpace)} + 路线¥{money(routeSpace)}）</Text>;
        },
        sorter: (a, b) => activityRecommendationRedAddOnSpace(a).totalSpace - activityRecommendationRedAddOnSpace(b).totalSpace
      },
      { title: '覆盖原价桶', dataIndex: 'hitCount', width: 110, render: value => `${Number(value) || 0} 桶`, sorter: (a, b) => a.hitCount - b.hitCount },
      {
        title: '支付覆盖',
        width: 150,
        render: (_, row) => {
          const breakdown = row.scoreBreakdown;
          if (!breakdown) return '-';
          return (
            <Space direction="vertical" size={2}>
              <Text>主要支付 {rateText(breakdown.mainPayShare ?? null)}</Text>
              <Text type={(breakdown.highPayShare || 0) > 0.35 ? 'warning' : 'secondary'}>30+ {rateText(breakdown.highPayShare ?? null)}</Text>
            </Space>
          );
        },
        sorter: (a, b) => (a.scoreBreakdown?.mainPayShare || 0) - (b.scoreBreakdown?.mainPayShare || 0)
      },
      { title: '评分（越低越好）', dataIndex: 'score', width: 260, render: (_, row) => renderActivityRouteScore(row), sorter: (a, b) => a.score - b.score },
      { title: '路线诊断', dataIndex: 'diagnosis', width: 460, render: (_, row) => renderActivityRouteDiagnosis(row) },
      {
        title: '操作',
        width: 180,
        fixed: 'right',
        render: (_, row) => (
          <Space>
            <Button
              size="small"
              type={selectedActivityDesignRouteKey === row.key ? 'primary' : 'default'}
              loading={isActivityDesignLoading && selectedActivityDesignRouteKey === row.key}
              onClick={() => runActivityDesignRouteValidation(row.key)}
            >
              {selectedActivityDesignRouteKey === row.key ? '已选择' : '校验'}
            </Button>
            <Button size="small" onClick={() => applyActivityRouteToPlatform(row)}>应用</Button>
          </Space>
        )
      }
    ];
    const activityPriceBandColumns: TableColumnsType<PriceBandRow> = [
      { title: '区间', dataIndex: 'label', width: 105, sorter: (a, b) => a.min - b.min },
      { title: '组合数', dataIndex: 'comboCount', width: 90, sorter: (a, b) => a.comboCount - b.comboCount },
      { title: '忽略数', dataIndex: 'ignoredCount', width: 90, sorter: (a, b) => a.ignoredCount - b.ignoredCount },
      { title: '平均原价', dataIndex: 'avgOriginalTotal', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgOriginalTotal - b.avgOriginalTotal },
      { title: '平均支付价', dataIndex: 'avgFinalPay', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgFinalPay - b.avgFinalPay },
      { title: '平均到手价', dataIndex: 'avgNetPay', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgNetPay - b.avgNetPay },
      { title: '平均成本', dataIndex: 'avgCost', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgCost - b.avgCost },
      { title: '平均利润', dataIndex: 'avgProfit', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.avgProfit - b.avgProfit },
      { title: '最低利润', dataIndex: 'minProfit', width: 105, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.minProfit ?? 0) - (b.minProfit ?? 0) },
      { title: '最高利润', dataIndex: 'maxProfit', width: 105, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.maxProfit ?? 0) - (b.maxProfit ?? 0) },
      { title: '平均利润率', dataIndex: 'avgProfitRate', width: 115, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitRate || 0) - (b.avgProfitRate || 0) },
      { title: '利润率范围', width: 135, render: (_, row) => row.minProfitRate === null ? '-' : `${rateText(row.minProfitRate)} - ${rateText(row.maxProfitRate)}` },
      { title: '平均利润空间', dataIndex: 'avgProfitSpace', width: 120, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.avgProfitSpace - b.avgProfitSpace },
      { title: '到手风险', dataIndex: 'riskCount', width: 95, sorter: (a, b) => a.riskCount - b.riskCount },
      { title: '诊断', dataIndex: 'suggestion', width: 280, render: (_, row) => <Text className="table-text-wrap">{activityPriceBandSuggestionText(row)}</Text> }
    ];
    const activityPlatformRecommendationColumns = withoutColumnByDataIndex(activityRecommendationColumns, 'platformName') as TableColumnsType<ActivityRecommendationRow>;
    const activityComboColumns: TableColumnsType<ActivityComboSimulationRow> = [
      { title: '商品组合', dataIndex: 'items', width: 300, fixed: 'left', render: items => <Text className="table-text-wrap">{itemsText(items as ComboItem[])}</Text> },
      { title: '状态', width: 115, render: (_, row) => row.ignored ? <Tag color="default">已忽略</Tag> : row.risk?.hasRisk ? <Tag color={riskColor(row.risk)}>{riskLabel(row.risk)}</Tag> : <Tag color="green">正常</Tag>, sorter: (a, b) => (a.risk?.severityRank || 0) - (b.risk?.severityRank || 0) },
      { title: '原价', dataIndex: 'originalTotal', width: 95, sorter: (a, b) => a.originalTotal - b.originalTotal, render: value => `¥${money(value)}` },
      { title: '用户实付', dataIndex: 'finalPay', width: 105, sorter: (a, b) => a.finalPay - b.finalPay, render: value => `¥${money(value)}` },
      { title: '商家到手', dataIndex: 'netPay', width: 105, sorter: (a, b) => a.netPay - b.netPay, render: value => `¥${money(value)}` },
      { title: '成本', dataIndex: 'cost', width: 95, sorter: (a, b) => a.cost - b.cost, render: value => `¥${money(value)}` },
      { title: '利润', dataIndex: 'profit', width: 95, sorter: (a, b) => a.profit - b.profit, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '支付毛利率', width: 110, sorter: (a, b) => (paymentGrossRate(a) || 0) - (paymentGrossRate(b) || 0), render: (_, row) => rateText(paymentGrossRate(row)) },
      { title: '到手利润率', dataIndex: 'netProfitRate', width: 110, sorter: (a, b) => (a.netProfitRate || 0) - (b.netProfitRate || 0), render: value => rateText(value as number | null) },
      { title: '实付利润率', dataIndex: 'profitRate', width: 110, sorter: (a, b) => (a.profitRate || 0) - (b.profitRate || 0), render: value => rateText(value as number | null) },
      { title: '利润空间', dataIndex: 'profitSpace', width: 105, sorter: (a, b) => a.profitSpace - b.profitSpace, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '活动金额', dataIndex: 'activityAmount', width: 105, sorter: (a, b) => a.activityAmount - b.activityAmount, render: value => `¥${money(value)}` },
      { title: '满减', width: 125, render: (_, row) => row.full?.amount ? `满${money(row.full.threshold)}减${money(row.full.amount)}` : '-' },
      { title: '优惠券', width: 190, render: (_, row) => row.coupons?.length ? <Text className="table-text-wrap">{row.coupons.map(coupon => `${coupon.name || '券'} ¥${money(coupon.amount)}`).join('，')}</Text> : '-' },
      {
        title: '红包/加码',
        width: 150,
        render: (_, row) => {
          const redName = row.platform === 'meituan' ? '神券' : '爆红包';
          return `${redName}¥${money(row.baseRed.amount)} / 加码¥${money(row.redAddOn.amount)}`;
        }
      },
      { title: '到手边界', width: 110, render: (_, row) => row.netPay + 1e-9 < ACTIVITY_MIN_NET_PAY ? <Text type="danger">低于 ¥{money(ACTIVITY_MIN_NET_PAY)}</Text> : <Text type="secondary">正常</Text> },
      { title: '异常原因', dataIndex: 'risk', width: 260, render: (_, row) => row.ignored ? row.ignoreReason : (row.risk?.reasons || []).join('，') }
    ];
    const activityRiskColumns: TableColumnsType<ActivityComboSimulationRow> = [
      { title: '等级', dataIndex: 'risk', width: 80, fixed: 'left', render: risk => <Tag color={riskColor(risk)}>{riskLabel(risk)}</Tag>, sorter: (a, b) => (a.risk?.severityRank || 0) - (b.risk?.severityRank || 0) },
      { title: '商品组合', dataIndex: 'items', width: 300, fixed: 'left', render: items => <Text className="table-text-wrap">{itemsText(items as ComboItem[])}</Text> },
      { title: '实付', dataIndex: 'finalPay', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.finalPay - b.finalPay },
      { title: '到手', dataIndex: 'netPay', width: 90, render: value => `¥${money(value)}` },
      { title: '成本', dataIndex: 'cost', width: 90, render: value => `¥${money(value)}` },
      { title: '利润', dataIndex: 'profit', width: 90, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '到手利润率', dataIndex: 'netProfitRate', width: 110, render: value => rateText(value as number | null) },
      { title: '利润空间', dataIndex: 'profitSpace', width: 95, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text> },
      { title: '触发原因', dataIndex: 'risk', render: risk => (risk?.reasons || []).join('，') }
    ];
    const selectedActivityDesignPlatformRows = selectedActivityDesignBand
      ? (activityDesign?.comboRows || []).filter(row => (
        row.platform === selectedActivityDesignBand.platform
        && row.finalPay + 1e-9 >= activityPayFilterMin
        && row.finalPay < activityPayFilterMax - 1e-9
      ))
      : [];
    const selectedActivityDesignPayBands = selectedActivityDesignBand
      ? (activityDesign?.payBands || []).filter(row => row.platform === selectedActivityDesignBand.platform && isActivityPayBandInFilters(row))
      : [];
    const selectedActivityDesignBandKey = selectedActivityDesignBand?.payBandKey || 'all';
    const selectedActivityDesignPayBand = selectedActivityDesignBandKey === 'all'
      ? null
      : selectedActivityDesignPayBands.find(row => row.key === selectedActivityDesignBandKey) || null;
    const selectedActivityDesignFullCount = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.comboCount
      : selectedActivityDesignPayBands.reduce((sum, row) => sum + row.comboCount, 0);
    const selectedActivityDesignRiskCoveredCount = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.riskCount
      : selectedActivityDesignPayBands.reduce((sum, row) => sum + row.riskCount, 0);
    const selectedActivityDesignPayBandWeight = Math.max(1, selectedActivityDesignFullCount);
    const selectedActivityDesignAveragePay = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.avgFinalPay
      : selectedActivityDesignPayBands.reduce((sum, row) => sum + row.avgFinalPay * row.comboCount, 0) / selectedActivityDesignPayBandWeight;
    const selectedActivityDesignAverageNetPay = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.avgNetPay
      : selectedActivityDesignPayBands.reduce((sum, row) => sum + row.avgNetPay * row.comboCount, 0) / selectedActivityDesignPayBandWeight;
    const selectedActivityDesignAverageCost = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.avgCost
      : selectedActivityDesignPayBands.reduce((sum, row) => sum + row.avgCost * row.comboCount, 0) / selectedActivityDesignPayBandWeight;
    const selectedActivityDesignMinProfitRate = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.minProfitRate
      : selectedActivityDesignPayBands.map(row => row.minProfitRate).filter(finiteRate).sort((a, b) => a - b)[0] ?? null;
    const selectedActivityDesignMaxProfitRate = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.maxProfitRate
      : selectedActivityDesignPayBands.map(row => row.maxProfitRate).filter(finiteRate).sort((a, b) => b - a)[0] ?? null;
    const selectedActivityDesignRows = selectedActivityDesignPayBand
      ? selectedActivityDesignPlatformRows.filter(row => (
        row.finalPay + 1e-9 >= selectedActivityDesignPayBand.min
        && row.finalPay < selectedActivityDesignPayBand.max - 1e-9
      ))
      : selectedActivityDesignPlatformRows;
    const activityDesignKeyword = activityDesignDetailSearchText.trim().toLowerCase();
    const selectedActivityDesignFilteredRows = activityDesignKeyword
      ? selectedActivityDesignRows.filter(row => row.items
        .map(item => item.name)
        .join(' ')
        .toLowerCase()
        .includes(activityDesignKeyword))
      : selectedActivityDesignRows;
    const selectedActivityDesignFilteredCoveredCount = selectedActivityDesignFilteredRows.reduce((sum, row) => sum + activityRepresentedComboCount(row), 0);
    const selectedActivityDesignRiskRows = selectedActivityDesignFilteredRows.filter(row => row.ignored || row.risk?.hasRisk);
    const selectedActivityValidationComboColumns: TableColumnsType<ActivityComboSimulationRow> = [
      activityComboColumns[0],
      {
        title: '成本口径',
        width: 100,
        render: (_, row) => <Tag color={activityCostBasisLabel(row) === '真实组合' ? 'green' : 'blue'}>{activityCostBasisLabel(row)}</Tag>,
        sorter: (a, b) => activityCostBasisLabel(a).localeCompare(activityCostBasisLabel(b), 'zh-CN')
      },
      {
        title: '代表组合数',
        dataIndex: 'representedComboCount',
        width: 110,
        render: (_, row) => activityRepresentedComboCount(row),
        sorter: (a, b) => activityRepresentedComboCount(a) - activityRepresentedComboCount(b)
      },
      ...activityComboColumns.slice(1)
    ];
    const selectedActivityOriginalBucketExpandedRows = selectedActivityOriginalBucket
      ? expandActivityOriginalBucketCombos(activityDesign, selectedActivityOriginalBucket)
      : [];
    const legacyActivityOriginalBucketSampleRows = (activityDesign?.originalPriceBuckets || [])
      .flatMap(row => row.sampleRows || []);
    const activityOriginalDisplayRows = activityDesign?.originalComboRows?.length
      ? activityDesign.originalComboRows
      : legacyActivityOriginalBucketSampleRows.length
        ? legacyActivityOriginalBucketSampleRows
        : activityDesign?.routeSourceRows || [];
    const selectedActivityOriginalBucketSourceRows = selectedActivityOriginalBucketExpandedRows.length
      ? selectedActivityOriginalBucketExpandedRows
      : selectedActivityOriginalBucket?.sampleRows?.length
        ? selectedActivityOriginalBucket.sampleRows
        : activityOriginalDisplayRows;
    const selectedActivityOriginalBucketCombos = selectedActivityOriginalBucket
      ? selectedActivityOriginalBucketSourceRows.filter(row => (
        row.platform === selectedActivityOriginalBucket.platform
        && Math.floor(row.originalTotal || 0) === selectedActivityOriginalBucket.priceBucket
        && isActivityOriginalComboInFilters(row)
      ))
      : [];
    const selectedActivityFinalCouponRules = selectedActivityCouponRoute?.couponRules || [];
    const selectedActivityCouponBucketRows = (selectedActivityCouponRoute?.couponBucketSuggestions || [])
      .slice()
      .sort((a, b) => a.originalBucket - b.originalBucket || a.threshold - b.threshold || b.amount - a.amount)
      .map((row, index) => ({ ...row, rowIndex: index + 1 }));
    const selectedActivityRecommendedBucketCount = selectedActivityCouponBucketRows.filter(row => row.selected).length;
    const activityRecommendedCouponForBucket = (row: ActivityCouponBucketSuggestion) => selectedActivityFinalCouponRules.find(rule => (
      row.selected
      && Math.abs(rule.threshold - (row.recommendedThreshold ?? -1)) < 1e-9
      && Math.abs(rule.amount - (row.recommendedAmount ?? -1)) < 1e-9
    ));
    const activityCouponUsageText = (coupon: ActivityRecommendationRow['couponRules'][number] | undefined) => {
      if (!coupon) return '-';
      return [
        coupon.sceneName || coupon.name || '推荐券',
        couponChannelLabel(coupon.channel),
        couponTargetUserLabel(coupon.targetUser),
        couponThresholdModeLabel(coupon.thresholdMode)
      ].filter(item => item && item !== '-').join(' / ');
    };
    const activityCouponRecommendationModeLabel = (mode: ActivityCouponBucketSuggestion['recommendationMode'] | ActivityCouponBucketSuggestion['scoringMode']) => {
      const normalizedMode = normalizeActivityCouponRecommendationMode(mode, 'balanced');
      return {
        conservative: '保守',
        balanced: '平稳',
        aggressive: '激进'
      }[normalizedMode];
    };
    const activityCouponRiskLevelLabel = (level: ActivityCouponBucketSuggestion['riskLevel'] | undefined) => ({
      safe: '安全',
      watch: '关注',
      risk: '风险'
    }[level || 'safe'] || '-');
    const activityCouponRiskColor = (level: ActivityCouponBucketSuggestion['riskLevel'] | undefined) => ({
      safe: 'green',
      watch: 'orange',
      risk: 'red'
    }[level || 'safe'] || 'default');
    const activityCouponBucketRisk = (row: ActivityCouponBucketSuggestion) => {
      if (row.riskLevel && row.riskLevel !== 'safe') {
        return {
          level: row.riskLevel,
          reasons: row.riskReasons || []
        };
      }
      const coupon = selectedActivityFinalCouponRules
        .filter(rule => row.originalBucket + 1e-9 >= rule.threshold)
        .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0];
      if (!coupon) return null;
      const overSpace = roundMoney(coupon.amount - row.amount);
      if (overSpace <= 1e-9) return null;
      return {
        level: 'watch' as const,
        reasons: [`命中满${money(coupon.threshold)}减${money(coupon.amount)} / 超¥${money(overSpace)}`]
      };
    };
    const selectedActivityCouponRecommendationDiagnosis = (() => {
      if (!selectedActivityCouponRoute) return [] as string[];
      const selectedRows = selectedActivityCouponBucketRows.filter(row => row.selected);
      if (!selectedActivityCouponBucketRows.length) {
        return ['当前路线没有生成原价桶券建议，优先检查满减后剩余活动空间、券最大金额和到手价边界。'];
      }
      const averageRemainingSpace = selectedActivityCouponBucketRows.reduce((sum, row) => sum + row.remainingSpace, 0) / selectedActivityCouponBucketRows.length;
      const strategyLabel = selectedRows[0]
        ? activityCouponRecommendationModeLabel(selectedRows[0].recommendationMode || selectedRows[0].scoringMode)
        : selectedActivityCouponRoute.couponRules[0]?.name?.replace(/策略券.*/, '') || '-';
      const finalCouponText = selectedActivityFinalCouponRules.length
        ? selectedActivityFinalCouponRules.map(rule => `${rule.sceneName || '推荐券'}：满${money(rule.threshold)}减${money(rule.amount)}`).join('，')
        : '无';
      return [
        `原价桶券建议 ${selectedActivityCouponBucketRows.length} 条，最终推荐券 ${selectedActivityFinalCouponRules.length} 张，当前券策略：${strategyLabel}。`,
        `推荐券：${finalCouponText}。`,
        `桶级满减后平均缺口约 ¥${money(averageRemainingSpace)}；最终推荐券按0.5元向下贴近，并按策略合并近档或跳过远档小差额券。`
      ];
    })();
    const selectedActivityCouponColumns: TableColumnsType<ActivityCouponBucketSuggestion & { rowIndex: number }> = [
      { title: '序号', dataIndex: 'rowIndex', width: 70 },
      { title: '原价桶', dataIndex: 'originalBucket', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.originalBucket - b.originalBucket },
      { title: '桶级券建议', width: 140, render: (_, row) => `满${money(row.threshold)}减${money(row.amount)}` },
      {
        title: '推荐状态',
        width: 115,
        render: (_, row) => row.selected
          ? <Tag color="green">最终推荐</Tag>
          : <Tag>桶级建议</Tag>,
        sorter: (a, b) => Number(a.selected) - Number(b.selected)
      },
      {
        title: '推荐券',
        width: 140,
        render: (_, row) => row.selected
          ? `满${money(row.recommendedThreshold)}减${money(row.recommendedAmount)}`
          : <Text type="secondary">未推荐</Text>
      },
      {
        title: '使用场景',
        width: 210,
        render: (_, row) => row.selected ? (
          <Space direction="vertical" size={2}>
            <Tag color="purple">{activityCouponUsageText(activityRecommendedCouponForBucket(row))}</Tag>
            {activityRecommendedCouponForBucket(row)?.usageSuggestion ? (
              <Text type="secondary" className="table-text-wrap">{activityRecommendedCouponForBucket(row)?.usageSuggestion}</Text>
            ) : null}
          </Space>
        ) : <Text type="secondary">-</Text>
      },
      {
        title: '券策略',
        dataIndex: 'recommendationMode',
        width: 95,
        render: (_, row) => <Tag color="blue">{activityCouponRecommendationModeLabel(row.recommendationMode || row.scoringMode)}</Tag>
      },
      {
        title: '券风险',
        width: 210,
        render: (_, row) => {
          const risk = activityCouponBucketRisk(row);
          return risk
            ? <Tag color={activityCouponRiskColor(risk.level)}>{activityCouponRiskLevelLabel(risk.level)}{risk.reasons.length ? ` / ${risk.reasons.join('，')}` : ''}</Tag>
            : <Text type="secondary">-</Text>;
        }
      },
      { title: '满减后缺口', dataIndex: 'remainingSpace', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.remainingSpace - b.remainingSpace },
      { title: '到手边界', dataIndex: 'boundarySpace', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.boundarySpace - b.boundarySpace },
      { title: '已配满减', dataIndex: 'fullDiscountAmount', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.fullDiscountAmount - b.fullDiscountAmount },
      { title: '诊断', dataIndex: 'diagnosis', width: 320, render: value => <Text className="table-text-wrap">{String(value || '-')}</Text> }
    ];
    const activityDesignFilterCard = (
      <Card size="small" title="页面筛选">
        <Row gutter={[12, 12]}>
          <Col xs={12} md={4}>
            <div className="field">
              <Text type="secondary">商品名称</Text>
              <Input allowClear value={activityDesignFilters.productNameKeyword} onChange={event => setActivityDesignFilters(prev => ({ ...prev, productNameKeyword: event.target.value }))} />
            </div>
          </Col>
          <Col xs={12} md={4}>
            <div className="field">
              <Text type="secondary">原价筛选最低</Text>
              <InputNumber min={0} precision={2} value={activityDesignFilters.originalMin} onChange={value => setActivityDesignFilters(prev => ({ ...prev, originalMin: Number(value) || 0 }))} />
            </div>
          </Col>
          <Col xs={12} md={4}>
            <div className="field">
              <Text type="secondary">原价筛选最高</Text>
              <InputNumber min={0} precision={2} placeholder="空=不限" value={activityDesignFilters.originalMax === '' ? null : activityDesignFilters.originalMax} onChange={value => setActivityDesignFilters(prev => ({ ...prev, originalMax: value === null ? '' : Number(value) || 0 }))} />
            </div>
          </Col>
          <Col xs={12} md={4}>
            <div className="field">
              <Text type="secondary">支付价筛选最低</Text>
              <InputNumber min={0} precision={2} value={activityDesignFilters.payMin} onChange={value => setActivityDesignFilters(prev => ({ ...prev, payMin: Number(value) || 0 }))} />
            </div>
          </Col>
          <Col xs={12} md={4}>
            <div className="field">
              <Text type="secondary">支付价最高</Text>
              <InputNumber
                min={0}
                max={activityPayMaxBoundary}
                precision={2}
                placeholder={`空=${activityPayMaxBoundary}`}
                value={activityDesignFilters.payMax === '' ? null : Math.min(activityPayMaxBoundary, Number(activityDesignFilters.payMax) || 0)}
                onChange={value => setActivityDesignFilters(prev => ({ ...prev, payMax: value === null ? '' : Math.min(activityPayMaxBoundary, Number(value) || 0) }))}
              />
            </div>
          </Col>
          <Col xs={24} md={4}>
            <div className="field-value">筛选支付价 ¥{money(activityDesignFilters.payMin)}-¥{money(activityEffectivePayMax)}</div>
          </Col>
          <Col xs={24} md={4}>
            <Button onClick={() => setActivityDesignFilters(DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS)}>重置筛选</Button>
          </Col>
        </Row>
      </Card>
    );
    const renderActivityDesignPlatformPanel = (platform: Platform) => {
      const originalPriceBuckets = (activityDesign?.originalPriceBuckets || [])
        .filter(row => row.platform === platform)
        .filter(isActivityOriginalBucketInFilters);
      const fullRoutes = (activityDesign?.fullRoutes || activityDesign?.recommendations.filter(row => row.routeKind === 'fullReduction') || []).filter(row => row.platform === platform);
      const couponRoutes = (activityDesign?.couponRoutes || activityDesign?.recommendations.filter(row => row.routeKind === 'coupon') || []).filter(row => row.platform === platform);
      const recommendations = (activityDesign?.recommendations || []).filter(row => row.platform === platform);
      const hitRows = ((activityDesign?.hitRows || []) as ActivityComboSimulationRow[]).filter(row => row.platform === platform);
      const allPayBands = (activityDesign?.payBands || []).filter(row => row.platform === platform);
      const payBands = allPayBands.filter(isActivityPayBandInFilters);
      const comboRows = ((activityDesign?.comboRows || []) as ActivityComboSimulationRow[]).filter(row => row.platform === platform);
      const platformOriginalBucketCount = (activityDesign?.originalPriceBuckets || []).filter(row => row.platform === platform && row.comboCount > 0).length;
      const scanComboPools = normalizeActivityScanComboPools(activityDesign?.scanComboPools);
      const platformMainComboCount = scanComboPools.mainComboCountByPlatform[platform]
        ?? scanComboPools.mainCombos.filter(row => row.platform === platform).length;
      const platformAddOnComboCount = scanComboPools.addOnComboCountByPlatform[platform]
        ?? scanComboPools.addOnCombos.filter(row => row.platform === platform).length;
      const payBandComboCount = payBands.reduce((sum, row) => sum + row.comboCount, 0);
      const payBandRiskCount = payBands.reduce((sum, row) => sum + row.riskCount, 0);
      const independentRoutes = recommendations.filter(row => row.routeKind !== 'fullReduction' && row.routeKind !== 'coupon');
      const routePackages = independentRoutes.length ? independentRoutes : buildActivityRoutePackages(platform, fullRoutes, couponRoutes, storeActivityDesignSettings, activityRouteObjectiveOptions);
      const stableRoutePackages = routePackages.filter(row => row.routeGroup === 'stable');
      const marketingRoutePackages = routePackages.filter(row => row.routeGroup !== 'stable');
      const routeRiskCount = routePackages.filter(row => row.scoreLevel === 'risk' || row.scoreLevel === 'review').length;
      const selectedRouteInPlatform = Boolean(selectedActivityDesignRouteKey) && (
        recommendations.some(row => row.key === selectedActivityDesignRouteKey)
        || routePackages.some(row => row.key === selectedActivityDesignRouteKey)
        || hitRows.some(row => row.recommendationKey === selectedActivityDesignRouteKey)
        || comboRows.some(row => row.recommendationKey === selectedActivityDesignRouteKey)
        || allPayBands.length > 0
      );
      const isSelectedRouteValidating = selectedRouteInPlatform && isActivityDesignLoading && !allPayBands.length;
      const selectedValidationRoute = routePackages.find(row => row.key === selectedActivityDesignRouteKey)
        || recommendations.find(row => row.key === selectedActivityDesignRouteKey)
        || null;
      const selectedRouteComboRows = selectedActivityDesignRouteKey
        ? comboRows.filter(row => row.recommendationKey === selectedActivityDesignRouteKey)
        : comboRows;
      const validationComboRows = selectedRouteComboRows.length ? selectedRouteComboRows : comboRows;
      const validationNetProfitRates = validationComboRows.map(row => row.netProfitRate).filter(finiteRate);
      const validationPayProfitRates = validationComboRows.map(row => row.profitRate).filter(finiteRate);
      const validationAvgOriginal = average(validationComboRows.map(row => row.originalTotal)) || 0;
      const validationAvgFinalPay = average(validationComboRows.map(row => row.finalPay)) || 0;
      const validationAvgNetPay = average(validationComboRows.map(row => row.netPay)) || 0;
      const validationAvgCost = average(validationComboRows.map(row => row.cost)) || 0;
      const validationAvgNetProfitRate = average(validationNetProfitRates);
      const validationAvgPayProfitRate = average(validationPayProfitRates);
      const validationMinNetProfitRate = validationNetProfitRates.length ? Math.min(...validationNetProfitRates) : null;
      const validationMaxNetProfitRate = validationNetProfitRates.length ? Math.max(...validationNetProfitRates) : null;
      const validationLossCount = validationComboRows.filter(row => row.profit < -1e-9).length;
      const validationRiskCount = validationComboRows.filter(row => row.ignored || row.risk?.hasRisk).length;
      const routeFullReductionText = selectedValidationRoute?.fullReductionRules.length
        ? selectedValidationRoute.fullReductionRules.map(rule => `满${money(rule.threshold)}减${money(rule.amount)}`).join('，')
        : '无';
      const routeCouponText = selectedValidationRoute?.couponRules.length
        ? selectedValidationRoute.couponRules.map(rule => `满${money(rule.threshold)}减${money(rule.amount)}`).join('，')
        : '无';
      const routeAddOnSpace = selectedValidationRoute ? activityRecommendationRedAddOnSpace(selectedValidationRoute) : null;
      const activityRouteValidationOverview = (
        <Card size="small" title="当前核验路线与合理成本口径">
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Space wrap size={[6, 6]}>
              <Tag color="blue">{selectedValidationRoute?.objectiveName || '当前路线'}</Tag>
              <Tag color={selectedValidationRoute?.routeGroup === 'stable' ? 'blue' : 'purple'}>{selectedValidationRoute ? activityRouteTypeLabel(selectedValidationRoute) : '-'}</Tag>
              {selectedValidationRoute?.targetPayLabel ? <Tag color="cyan">{selectedValidationRoute.targetPayLabel}</Tag> : null}
              <Tag>目标让利 {selectedValidationRoute?.targetDiscountRate === null || selectedValidationRoute?.targetDiscountRate === undefined ? '-' : rateText(selectedValidationRoute.targetDiscountRate)}</Tag>
              <Tag>执行均值 {selectedValidationRoute?.actualAvgDiscountRate === null || selectedValidationRoute?.actualAvgDiscountRate === undefined ? '-' : rateText(selectedValidationRoute.actualAvgDiscountRate)}</Tag>
            </Space>
            <Text type="secondary" className="table-text-wrap">
              满减：{routeFullReductionText}；券：{routeCouponText}；加码空间：{routeAddOnSpace ? `配置¥${money(routeAddOnSpace.configuredSpace)} / 路线¥${money(routeAddOnSpace.routeSpace)}` : '-'}。
            </Text>
            <Space wrap size={[6, 6]}>
              <Tag>核验组合 {validationComboRows.length}</Tag>
              <Tag>平均原价 ¥{money(validationAvgOriginal)}</Tag>
              <Tag>平均支付 ¥{money(validationAvgFinalPay)}</Tag>
              <Tag>平均到手 ¥{money(validationAvgNetPay)}</Tag>
              <Tag>平均成本 ¥{money(validationAvgCost)}</Tag>
            </Space>
            <Space wrap size={[6, 6]}>
              <Tag color="green">平均到手利润率 {rateText(validationAvgNetProfitRate)}</Tag>
              <Tag color="blue">平均实付利润率 {rateText(validationAvgPayProfitRate)}</Tag>
              <Tag color={validationMinNetProfitRate !== null && validationMinNetProfitRate < 0 ? 'red' : 'default'}>到手利润率范围 {validationMinNetProfitRate === null ? '-' : `${rateText(validationMinNetProfitRate)}-${rateText(validationMaxNetProfitRate)}`}</Tag>
              <Tag color={validationLossCount ? 'red' : 'green'}>亏损组合 {validationLossCount}</Tag>
              <Tag color={validationRiskCount ? 'orange' : 'green'}>风险组合 {validationRiskCount}</Tag>
            </Space>
            <Text type="secondary" className="table-text-wrap">
              活动合理成本表示当前售价在这条活动路线和利润率要求下可承受的成本上限；合理标价按“当前售价 × 当前成本 / 活动合理成本”估算，用于判断当前成本下售价是否偏低或偏高。
            </Text>
          </Space>
        </Card>
      );
      const routeInfoColumns = activityPlatformRecommendationColumns.filter(column => column.title !== '操作');
      const routePackageColumns: TableColumnsType<ActivityRecommendationRow> = [
        ...routeInfoColumns,
        {
          title: '操作',
          width: 180,
          fixed: 'right',
          render: (_, row) => (
            <Space>
              <Button
                size="small"
                type={selectedActivityDesignRouteKey === row.key ? 'primary' : 'default'}
                loading={isActivityDesignLoading && selectedActivityDesignRouteKey === row.key}
                onClick={() => runActivityDesignRouteValidation(row.key, row)}
              >
                {selectedActivityDesignRouteKey === row.key ? '已选择' : '核验'}
              </Button>
              <Button size="small" onClick={() => applyActivityRouteToPlatform(row)}>应用</Button>
            </Space>
          )
        }
      ];
      const originalScanContent = (
        <>
          {activityDesignFilterCard}
          <Card title="原价整数扫描">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">按 1 元整数桶铺平商品组合，价格 25 表示原价从 25 到 26（不含 26）。基准支付价和基准到手价已包含平台默认神券/爆红包；这一步只确认原价、支付价、到手价和风险分布，活动路线在下一步按经营目标生成。</Text>
              <Space wrap size={[6, 6]}>
                <Tag color="blue">饭团组合 {platformMainComboCount}</Tag>
                <Tag color="cyan">凑单小吃组合 {platformAddOnComboCount}</Tag>
                <Tag>原价桶 {platformOriginalBucketCount}</Tag>
              </Space>
              <PriceBucketProfitChart rows={originalPriceBuckets} money={money} />
              <Table loading={isActivityDesignLoading} rowKey="key" size="small" columns={activityPriceBucketColumns} dataSource={originalPriceBuckets} pagination={tablePagination(20)} scroll={{ x: 1720 }} tableLayout="fixed" />
            </Space>
          </Card>
        </>
      );
      const routeDesignContent = (
        <>
          <Card title={`活动路线列表（${routePackages.length}）`}>
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">每条路线都是可独立核验和应用的完整活动配置。稳定底盘和经营目标路线在同一张表中比较，路线诊断只说明满减底盘、主要支付场景覆盖和风险边界；券推荐诊断请打开券列表查看。</Text>
              <Space wrap size={[6, 6]}>
                <Tag>路线 {routePackages.length}</Tag>
                <Tag color="blue">稳定底盘 {stableRoutePackages.length}</Tag>
                <Tag color="purple">经营目标 {marketingRoutePackages.length}</Tag>
                <Tag>原价桶 {platformOriginalBucketCount}</Tag>
                <Tag color={routeRiskCount ? 'orange' : 'green'}>需复核 {routeRiskCount}</Tag>
              </Space>
              {!routePackages.length ? <Text type="secondary">请先在原价扫描确认结果后点击“生成活动路线”。</Text> : null}
              <Table loading={isActivityDesignLoading} rowKey="key" size="small" columns={routePackageColumns} dataSource={routePackages} pagination={tablePagination(12)} scroll={{ x: 3140 }} tableLayout="fixed" />
            </Space>
          </Card>
        </>
      );
      const payValidationContent = isSelectedRouteValidating ? (
        <Card title="活动后支付价校验">
          <Text type="secondary">正在计算所选活动路线的支付价区间、命中明细和风险预警。</Text>
        </Card>
      ) : selectedRouteInPlatform && !payBands.length ? (
        <Card title="活动后支付价校验">
          <Text type="secondary">当前页面筛选下没有命中支付价区间，请调整筛选范围；如全量仍为空，再到门店设置调整组合边界后重新生成活动路线。</Text>
        </Card>
      ) : selectedRouteInPlatform ? (
        <>
          {activityRouteValidationOverview}
          <ProductDiscountSuggestionSection
            rows={validationComboRows}
            source="activityValidation"
            title="活动路线商品维度合理成本结论"
            limit={80}
            includeNeutral
            description="商品结论按当前路线当前平台的全部支付价核验组合计算；支付价区间只用于查看明细，不再决定商品处理结论。主商品比较活动合理成本和当前成本，凑单品只判断分摊到手是否覆盖成本。"
            money={money}
            onApply={applyProductDiscountSuggestion}
          />
          <PayBandAnalysisPanel
            title="活动后支付价校验"
            chartTitle={`${PLATFORM_NAMES[platform]}活动后支付价区间`}
            platformName={PLATFORM_NAMES[platform]}
            payBands={payBands}
            selectedPayBandKey={selectedActivityDesignPayBandKeyByPlatform[platform] || 'all'}
            rowCount={payBandComboCount}
            riskCount={payBandRiskCount}
            loading={isActivityDesignLoading}
            columns={activityPriceBandColumns}
            money={money}
            pagination={tablePagination(20)}
            onSelectPayBand={key => {
              updateActivityDesignPayBandKey(platform, key);
              setSelectedActivityDesignBand({ platform, payBandKey: key });
              setActivityDesignDetailSearchText('');
            }}
          />
          <Card title="关键命中组合">
            {hitRows.length ? (
              <Table loading={isActivityDesignLoading} rowKey="key" size="small" columns={activityComboColumns} dataSource={hitRows} pagination={tablePagination(20)} scroll={{ x: 2440 }} tableLayout="fixed" />
            ) : (
              <Text type="secondary">核验完成后，这里展示最大优惠命中的关键组合和到手边界组合。</Text>
            )}
          </Card>
        </>
      ) : (
        <Card title="活动后支付价校验">
          <Space direction="vertical">
            <Text type="secondary">请先在活动路线步骤选择并核验一条{PLATFORM_NAMES[platform]}完整活动路线。</Text>
            <Button type="primary" onClick={() => setActivityDesignStage('routeDesign')}>去选择活动路线</Button>
          </Space>
        </Card>
      );
      return (
        <div className="section-stack result-platform-panel">
          {activityDesignStage === 'priceScan' ? originalScanContent : activityDesignStage === 'routeDesign' ? routeDesignContent : payValidationContent}
        </div>
      );
    };
    return (
      <div className="section-stack">
        <Card title={activityDesignTitle}>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Steps
              size="small"
              current={activityDesignStepCurrent}
              onChange={changeActivityDesignStep}
              items={[
                { title: '原价扫描' },
                { title: '活动路线' },
                { title: '支付价核验' }
              ]}
            />
            <Text type="secondary">第一步只做原价整数扫描；确认扫描后再生成活动路线。路线按全路线基准让利率和目标阶梯覆盖反推满减、优惠券和加码空间，只用用户实付和商家到手价判断活动边界。</Text>
            <Space wrap size={[6, 6]}>
              <Text type="secondary">门店活动设计配置</Text>
              <Tag>原价≥起送 ¥{money(store.startPrice)}</Tag>
              <Tag>原价≤{store.calculationTotalMax === '' ? '不限' : `¥${money(store.calculationTotalMax)}`}</Tag>
              <Tag>饭团≤{storeActivityDesignSettings.stapleMaxCount ?? 2}</Tag>
              <Tag>凑单≤{storeActivityDesignSettings.addOnMaxCount === '' ? '不限' : `${storeActivityDesignSettings.addOnMaxCount}件`}</Tag>
              <Tag>基准让利 {money(storeActivityDesignSettings.baseOriginalDiscountRate ?? 50)}%</Tag>
              <Tag>到手底线 ¥{money(activityCurrentMinNetPayFloor)}</Tag>
              <Tag>加码 ¥{money(storeActivityDesignSettings.redAddOnSpace)}</Tag>
              <Tag>支付步长 {storeActivityDesignSettings.payBandSize ?? 5}</Tag>
              {activityPriceScanPersistenceMeta ? (
                <Tag color="green">扫描缓存 {dateTimeText(activityPriceScanPersistenceMeta.generatedAt)}</Tag>
              ) : null}
              <Button size="small" onClick={() => navigatePage('store')}>门店设置</Button>
            </Space>
            {activityRouteStrategyOverview}
            <Space wrap>
              <Button icon={<ReloadOutlined />} loading={isActivityDesignLoading} onClick={runActivityDesign}>重新扫描</Button>
              <Button disabled={!activityDesign?.originalPriceBuckets?.length || isActivityDesignLoading} onClick={runActivityRouteDesign}>
                {activityDesign?.recommendations.length ? '重新生成活动路线' : '生成活动路线'}
              </Button>
            </Space>
            {activityDesign?.warnings.length ? <Card size="small">{activityDesign.warnings.map(item => <Text key={item} type="warning">{item}</Text>)}</Card> : null}
          </Space>
        </Card>
        <Tabs
          className="result-platform-tabs"
          activeKey={activityDesignPlatformTab}
          destroyOnHidden
          onChange={key => setActivityDesignPlatformTab(key as Platform)}
          items={PLATFORMS.map(platform => ({
            key: platform,
            label: PLATFORM_NAMES[platform],
            children: renderActivityDesignPlatformPanel(platform)
          }))}
        />
        <Modal
          title={selectedActivityCouponRoute ? `${selectedActivityCouponRoute.platformName} / ${selectedActivityCouponRoute.objectiveName} 券列表` : '券列表'}
          open={Boolean(selectedActivityCouponRoute)}
          width={1320}
          footer={null}
          destroyOnHidden
          onCancel={() => setSelectedActivityCouponRoute(null)}
        >
          {selectedActivityCouponRoute ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">这里展示当前路线下每个原价桶的小数券空间；最终推荐券由当前券策略按金额阶梯生成，应用活动时只写入最终推荐券。</Text>
              <Card size="small" title="券推荐诊断">
                <Space direction="vertical" size={4}>
                  {selectedActivityCouponRecommendationDiagnosis.map(item => (
                    <Text key={item} type="secondary">{item}</Text>
                  ))}
                </Space>
              </Card>
              <Space wrap size={[6, 6]}>
                <Tag>原价桶券建议 {selectedActivityCouponBucketRows.length}</Tag>
                <Tag color="green">推荐券门槛桶 {selectedActivityRecommendedBucketCount}</Tag>
                <Tag color="blue">最终推荐券 {selectedActivityFinalCouponRules.length}</Tag>
                {selectedActivityFinalCouponRules.map((rule, index) => (
                  <Tag key={[rule.threshold, rule.amount, rule.name, index].join('::')} color="blue">
                    {rule.sceneName || '推荐券'} / {couponChannelLabel(rule.channel)}：满{money(rule.threshold)}减{money(rule.amount)}
                  </Tag>
                ))}
              </Space>
              <Table
                rowKey={row => row.key || [row.originalBucket, row.threshold, row.amount, row.rowIndex].join('::')}
                size="small"
                columns={selectedActivityCouponColumns}
                dataSource={selectedActivityCouponBucketRows}
                pagination={tablePagination(30)}
                scroll={{ x: 1435 }}
                tableLayout="fixed"
              />
            </Space>
          ) : null}
        </Modal>
        <Modal
          title={selectedActivityFullReductionLogRoute ? `${selectedActivityFullReductionLogRoute.platformName} / ${selectedActivityFullReductionLogRoute.objectiveName} 满减日志` : '满减日志'}
          open={Boolean(selectedActivityFullReductionLogRoute)}
          width={1120}
          footer={null}
          destroyOnHidden
          onCancel={() => setSelectedActivityFullReductionLogRoute(null)}
        >
          {selectedActivityFullReductionLogRoute ? renderActivityFullReductionLogModal(selectedActivityFullReductionLogRoute) : null}
        </Modal>
        <Modal
          title={selectedActivityOriginalBucket ? `${selectedActivityOriginalBucket.platformName} 原价 ¥${selectedActivityOriginalBucket.label} 商品组合` : '商品组合明细'}
          open={Boolean(selectedActivityOriginalBucket)}
          width={1180}
          destroyOnHidden
          onCancel={() => setSelectedActivityOriginalBucket(null)}
          footer={null}
        >
          {selectedActivityOriginalBucket ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">原价扫描只保存饭团组合池、凑单小吃组合池和原价桶组合关系；这里按桶内组合 ID 还原商品组合，不再常驻保存全量明细。</Text>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">桶内组合数</Text><Title level={4}>{selectedActivityOriginalBucket.comboCount}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">展示组合</Text><Title level={4}>{selectedActivityOriginalBucketCombos.length}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">平均支付价</Text><Title level={4}>¥{money(selectedActivityOriginalBucket.avgFinalPay ?? selectedActivityOriginalBucket.weightedAvgFinalPay ?? 0)}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">平均到手价</Text><Title level={4}>¥{money(selectedActivityOriginalBucket.avgNetPay ?? selectedActivityOriginalBucket.weightedAvgNetPay ?? 0)}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">到手风险组合</Text><Title level={4}>{selectedActivityOriginalBucket.riskCount}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">离散组合</Text><Title level={4}>{selectedActivityOriginalBucket.outlierCount}</Title></Card></Col>
              </Row>
              <Table
                rowKey="key"
                size="small"
                columns={activityOriginalComboColumns}
                dataSource={selectedActivityOriginalBucketCombos}
                pagination={tablePagination(20)}
                scroll={{ x: 1040 }}
                tableLayout="fixed"
              />
            </Space>
          ) : null}
        </Modal>
        <Modal
          title={selectedActivityDesignBand ? `${PLATFORM_NAMES[selectedActivityDesignBand.platform]} / ${selectedActivityDesignPayBand ? `¥${selectedActivityDesignPayBand.label}` : '全部支付价区间'} 活动校验摘要与代表明细` : '活动校验明细'}
          open={Boolean(selectedActivityDesignBand)}
          width={1280}
          footer={null}
          destroyOnHidden
          onCancel={() => {
            setSelectedActivityDesignBand(null);
            setActivityDesignDetailSearchText('');
          }}
        >
          {selectedActivityDesignBand ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Card size="small" title="核验摘要">
                <Space direction="vertical" style={{ width: '100%' }} size="small">
                  <Row gutter={[12, 12]}>
                    <Col xs={12} md={4}>
                      <div className="field">
                        <Text type="secondary">覆盖真实组合</Text>
                        <div className="field-value">{selectedActivityDesignFullCount}</div>
                      </div>
                    </Col>
                    <Col xs={12} md={4}>
                      <div className="field">
                        <Text type="secondary">代表明细行</Text>
                        <div className="field-value">{selectedActivityDesignRows.length}</div>
                      </div>
                    </Col>
                    <Col xs={12} md={4}>
                      <div className="field">
                        <Text type="secondary">风险覆盖组合</Text>
                        <div className="field-value">{selectedActivityDesignRiskCoveredCount}</div>
                      </div>
                    </Col>
                    <Col xs={12} md={4}>
                      <div className="field">
                        <Text type="secondary">平均支付价</Text>
                        <div className="field-value">¥{money(selectedActivityDesignAveragePay)}</div>
                      </div>
                    </Col>
                    <Col xs={12} md={4}>
                      <div className="field">
                        <Text type="secondary">平均到手价</Text>
                        <div className="field-value">¥{money(selectedActivityDesignAverageNetPay)}</div>
                      </div>
                    </Col>
                    <Col xs={12} md={4}>
                      <div className="field">
                        <Text type="secondary">平均成本</Text>
                        <div className="field-value">¥{money(selectedActivityDesignAverageCost)}</div>
                      </div>
                    </Col>
                  </Row>
                  <Space wrap size={[6, 6]}>
                    <Tag color={selectedActivityDesignRiskCoveredCount ? 'orange' : 'green'}>风险覆盖 {selectedActivityDesignRiskCoveredCount}</Tag>
                    <Tag>利润率范围 {selectedActivityDesignMinProfitRate === null ? '-' : `${rateText(selectedActivityDesignMinProfitRate)}-${rateText(selectedActivityDesignMaxProfitRate)}`}</Tag>
                    <Tag>当前筛选覆盖 {selectedActivityDesignFilteredCoveredCount}</Tag>
                  </Space>
                  <Text type="secondary" className="table-text-wrap">支付区间组合数按原价桶代表的真实组合数加权统计；下方默认展示平均/最高/最低成本口径的代表明细，不直接展开全量真实组合。</Text>
                </Space>
              </Card>
              <Space wrap>
                <Input.Search
                  allowClear
                  style={{ width: 320 }}
                  placeholder="搜索商品名称"
                  value={activityDesignDetailSearchText}
                  onChange={event => setActivityDesignDetailSearchText(event.target.value)}
                />
                <Text type="secondary">当前展示 {selectedActivityDesignFilteredRows.length} 条代表明细，覆盖 {selectedActivityDesignFilteredCoveredCount} 个真实组合；区间覆盖 {selectedActivityDesignFullCount} 个真实组合，风险覆盖 {selectedActivityDesignRiskCoveredCount} 个组合</Text>
              </Space>
              <Tabs
                destroyOnHidden
                items={[
                  {
                    key: 'details',
                    label: '代表明细',
                    children: (
                      <Table
                        loading={isActivityDesignLoading}
                        rowClassName={row => row.ignored ? 'risk-config' : row.risk?.hasRisk ? `risk-${row.risk.severity}` : ''}
                        rowKey="key"
                        size="small"
                        columns={selectedActivityValidationComboColumns}
                        dataSource={selectedActivityDesignFilteredRows}
                        pagination={tablePagination(30)}
                        scroll={{ x: 2650 }}
                        tableLayout="fixed"
                      />
                    )
                  },
                  {
                    key: 'risks',
                    label: '风险预警',
                    children: (
                      <Table
                        loading={isActivityDesignLoading}
                        rowClassName={row => row.risk?.hasRisk ? `risk-${row.risk.severity}` : ''}
                        rowKey="key"
                        size="small"
                        columns={activityRiskColumns}
                        dataSource={selectedActivityDesignRiskRows}
                        pagination={tablePagination(20)}
                        scroll={{ x: 1440 }}
                        tableLayout="fixed"
                      />
                    )
                  }
                ]}
              />
            </Space>
          ) : null}
        </Modal>
      </div>
    );
  }
