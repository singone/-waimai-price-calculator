'use client';

import React from 'react';
import { App as AntApp, Button, Card, Col, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { EMPTY_SUMMARY } from '../../config/calculation';
import { deepClone } from '../../domain/core';
import { PlatformUtils } from '../../domain/platform';
import { DEFAULT_PRICING_PLAN_KEYS, PRICING_PLAN_PRESETS } from '../../domain/pricing/pricingPlans';
import { money, rateText, severityColor, severityLabel, severityRank } from '../../utils/format';
import { tablePagination } from '../../utils/table';
import { isCalculationAbortError, runCalculationTask } from '../../workers/calculationClient';
import { useCalculatorPageProps } from '../shared/CalculatorContext';
import {
  currentStoreFrom,
  effectiveFeeRule,
  normalizeState
} from '../../data/calculatorState';
import type {
  CalculatorState,
  FeeRule,
  Platform,
  PricingBaseRedAmountMode,
  PricingEvaluationResult,
  PricingEvaluationRule,
  PricingEvaluationSettings,
  PricingPlanKey,
  PricingPlanRuleDetail,
  PricingProductRow,
  Severity,
  Summary
} from '../../domain/types';

const { Text, Title } = Typography;

const SHOW_LG: Array<'lg'> = ['lg'];
const SHOW_XL: Array<'xl'> = ['xl'];

const FALLBACK_PRICING_EVALUATION_SETTINGS: PricingEvaluationSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  enabledPlanKeys: DEFAULT_PRICING_PLAN_KEYS.slice(),
  stapleTargetCostShare: 50,
  setMealTargetCostShare: 50,
  addOnTargetCostShare: 50,
  addOnStapleRatioShare: 70,
  addOnMinimumOriginalPrice: 1.9,
  addOnPromotionRiskShare: 80,
  setMealDiscountRate: 12,
  fixedActivityCost: 0,
  baseRedAmountMode: 'max'
};

type PricingPlatformFilter = Platform | 'all';

type PricingEvaluationPageProps = {
  calculatorState: CalculatorState;
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>;
  pricingRule: PricingEvaluationRule;
  pricingStrategy: FeeRule['pricingStrategy'];
};

const PRICING_EVALUATION_MAX_DURATION_MS = 30000;
const PRICING_EVALUATION_WORKER_TIMEOUT_MS = 35000;

function waitForLoadingPaint() {
  return new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

function pricingSettingNumber(value: number | null) {
  return Number(value) || 0;
}

function defaultPricingSettingsFromRule(rule: PricingEvaluationRule): PricingEvaluationSettings {
  return {
    ...FALLBACK_PRICING_EVALUATION_SETTINGS,
    enabledPlanKeys: DEFAULT_PRICING_PLAN_KEYS.slice(),
    stapleTargetCostShare: Number(rule.stapleTargetCostShare) || FALLBACK_PRICING_EVALUATION_SETTINGS.stapleTargetCostShare,
    setMealTargetCostShare: Number(rule.setMealTargetCostShare) || FALLBACK_PRICING_EVALUATION_SETTINGS.setMealTargetCostShare,
    addOnTargetCostShare: Number(rule.addOnTargetCostShare) || FALLBACK_PRICING_EVALUATION_SETTINGS.addOnTargetCostShare,
    addOnStapleRatioShare: Number(rule.addOnStapleRatioShare) || FALLBACK_PRICING_EVALUATION_SETTINGS.addOnStapleRatioShare,
    addOnMinimumOriginalPrice: Number(rule.addOnMinimumOriginalPrice) || FALLBACK_PRICING_EVALUATION_SETTINGS.addOnMinimumOriginalPrice,
    addOnPromotionRiskShare: Number(rule.addOnPromotionRiskShare) || FALLBACK_PRICING_EVALUATION_SETTINGS.addOnPromotionRiskShare,
    setMealDiscountRate: Number(rule.setMealDiscountRate) || FALLBACK_PRICING_EVALUATION_SETTINGS.setMealDiscountRate,
    fixedActivityCost: Number(rule.fixedActivityCost) || FALLBACK_PRICING_EVALUATION_SETTINGS.fixedActivityCost,
    baseRedAmountMode: rule.baseRedAmountMode || FALLBACK_PRICING_EVALUATION_SETTINGS.baseRedAmountMode
  };
}

function baseRedAmountModeText(mode: PricingBaseRedAmountMode) {
  return { min: '最低', average: '平均', max: '最高' }[mode];
}

function planRateFromPercent(value: unknown, fallback: number) {
  const n = Number(value);
  const normalized = Number.isFinite(n) ? n : fallback;
  return Math.max(0, Math.min(100, normalized)) / 100;
}

function clampPlanRate(value: number) {
  return Math.max(0, Math.min(1, value));
}

function previewPricingPlanRules(settings: PricingEvaluationSettings): PricingPlanRuleDetail[] {
  const selectedKeys: PricingPlanKey[] = settings.enabledPlanKeys.length ? settings.enabledPlanKeys : ['balanced'];
  const selected = new Set<PricingPlanKey>(selectedKeys);
  const stapleTargetCostShare = planRateFromPercent(settings.stapleTargetCostShare, FALLBACK_PRICING_EVALUATION_SETTINGS.stapleTargetCostShare);
  const setMealTargetCostShare = planRateFromPercent(settings.setMealTargetCostShare, FALLBACK_PRICING_EVALUATION_SETTINGS.setMealTargetCostShare);
  const addOnTargetCostShare = planRateFromPercent(settings.addOnTargetCostShare, FALLBACK_PRICING_EVALUATION_SETTINGS.addOnTargetCostShare);
  const addOnStapleRatioShare = planRateFromPercent(settings.addOnStapleRatioShare, FALLBACK_PRICING_EVALUATION_SETTINGS.addOnStapleRatioShare);
  const addOnPromotionRiskShare = planRateFromPercent(settings.addOnPromotionRiskShare, FALLBACK_PRICING_EVALUATION_SETTINGS.addOnPromotionRiskShare);
  const setMealDiscountRate = planRateFromPercent(settings.setMealDiscountRate, FALLBACK_PRICING_EVALUATION_SETTINGS.setMealDiscountRate);

  return PRICING_PLAN_PRESETS
    .filter(plan => selected.has(plan.key))
    .map(plan => ({
      planKey: plan.key,
      planName: plan.name,
      planDescription: plan.description,
      stapleTargetCostShare: clampPlanRate(stapleTargetCostShare + plan.stapleTargetCostShareOffset),
      setMealTargetCostShare: clampPlanRate(setMealTargetCostShare + plan.setMealTargetCostShareOffset),
      addOnTargetCostShare: clampPlanRate(addOnTargetCostShare + plan.addOnTargetCostShareOffset),
      addOnStapleRatioShare: clampPlanRate(addOnStapleRatioShare + plan.addOnStapleRatioShareOffset),
      addOnMinimumOriginalPrice: Math.max(0, Number(settings.addOnMinimumOriginalPrice) || 0),
      addOnPromotionRiskShare: clampPlanRate(addOnPromotionRiskShare + plan.addOnPromotionRiskShareOffset),
      setMealDiscountRate: clampPlanRate(setMealDiscountRate + plan.setMealDiscountRateOffset),
      fixedActivityCost: Math.max(0, Number(settings.fixedActivityCost) || 0),
      baseRedAmountMode: settings.baseRedAmountMode
    }));
}

function multipleText(value: number | null | undefined) {
  return Number.isFinite(value) ? `${Number(value).toFixed(2)}x` : '-';
}

function optionalMoney(value: number | null | undefined) {
  return value === null || value === undefined ? '-' : `¥${money(value)}`;
}

function filterPricingIssues(rows: PricingProductRow[], keyword: string, severityLabel: (severity: Severity) => string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return rows;
  return rows.filter(issue => [
    severityLabel(issue.severity),
    issue.planName,
    issue.planDescription,
    issue.platformName,
    issue.productName,
    issue.categoryName,
    issue.strategyName,
    issue.scenarioName,
    issue.currentPrice,
    issue.packageFee,
    issue.currentOriginalPrice,
    issue.productCost,
    issue.componentOriginalTotal,
    issue.componentCostTotal,
    issue.discountAmount,
    issue.baseRedAmount,
    issue.commission,
    issue.serviceFee,
    issue.freightSubsidy,
    issue.fixedActivityCost,
    issue.platformExpenseTotal,
    issue.finalPay,
    issue.commissionDeliveryFee,
    issue.netRevenue,
    issue.netTakeRate,
    issue.costShare,
    issue.targetCostShare,
    issue.costShareSpace,
    issue.staplePriceCostRatio,
    issue.addOnReferenceOriginalPrice,
    issue.addOnCostShareFloor,
    issue.addOnStapleRatioFloor,
    issue.addOnMinimumOriginalPrice,
    issue.addOnPromotionRiskAmount,
    issue.addOnPromotionRiskFloor,
    issue.addOnPricingFloor,
    issue.addOnPricingBasisName,
    issue.suggestedPrice,
    issue.suggestedOriginalPrice,
    issue.suggestedIncrease,
    issue.reasons.join(' ')
  ].join(' ').toLowerCase().includes(normalizedKeyword));
}

export function PricingEvaluationPage(pageProps: Partial<PricingEvaluationPageProps> = {}) {
  const { message } = AntApp.useApp();
  const {
    calculatorState,
    setCalculatorState,
    store,
    pricingRule: pagePricingRule
  } = useCalculatorPageProps(pageProps);
  const effectiveRule = React.useMemo(
    () => effectiveFeeRule(calculatorState, store),
    [calculatorState, store]
  );
  const pricingRule = pagePricingRule || effectiveRule.pricingEvaluation;
  const activePricingTaskRef = React.useRef<AbortController | null>(null);
  const [pricingEvaluation, setPricingEvaluation] = React.useState<PricingEvaluationResult | null>(null);
  const [isLoading, setIsLoading] = React.useState(false);
  const [fallbackSummary, setFallbackSummary] = React.useState<Summary>({ ...EMPTY_SUMMARY });
  const [platformFilter, setPlatformFilter] = React.useState<PricingPlatformFilter>('all');
  const [visiblePlanFilter, setVisiblePlanFilter] = React.useState<PricingPlanKey | 'all'>('all');
  const [pricingSettings, setPricingSettings] = React.useState<PricingEvaluationSettings>(() => defaultPricingSettingsFromRule(pricingRule));
  const [pricingResultSearchText, setPricingResultSearchText] = React.useState('');
  const [selectedPricingProductKey, setSelectedPricingProductKey] = React.useState('');
  React.useEffect(() => () => {
    activePricingTaskRef.current?.abort();
  }, []);
  React.useEffect(() => {
    setPricingEvaluation(null);
    setSelectedPricingProductKey('');
    setFallbackSummary({ ...EMPTY_SUMMARY });
  }, [calculatorState?.selectedStoreId]);
  const runPricingEvaluation = async (settings: PricingEvaluationSettings, nextPlatformFilter: PricingPlatformFilter) => {
    if (isLoading || !calculatorState) return;
    activePricingTaskRef.current?.abort();
    const controller = new AbortController();
    activePricingTaskRef.current = controller;
    setIsLoading(true);
    setPricingEvaluation(null);
    setFallbackSummary({ ...EMPTY_SUMMARY });
    await waitForLoadingPaint();
    try {
      const result = await runCalculationTask('pricingEvaluation', {
        state: calculatorState,
        platformFilter: nextPlatformFilter,
        settings
      }, undefined, {
        signal: controller.signal,
        maxDurationMs: PRICING_EVALUATION_MAX_DURATION_MS,
        timeoutMs: PRICING_EVALUATION_WORKER_TIMEOUT_MS
      });
      if (activePricingTaskRef.current !== controller) return;
      setPricingEvaluation(result);
      setFallbackSummary(result.summary);
    } catch (error) {
      if (!isCalculationAbortError(error)) {
        message.error(error instanceof Error ? error.message : '定价评估生成失败。');
      }
    } finally {
      if (activePricingTaskRef.current === controller) {
        activePricingTaskRef.current = null;
        setIsLoading(false);
      }
    }
  };
  const applySuggestedPrice = (row: Pick<PricingProductRow, 'suggestedPrice' | 'productId' | 'platform' | 'platformName' | 'planName'>) => {
    const suggestedPrice = row.suggestedPrice;
    setCalculatorState(prev => {
      const draft = deepClone(prev);
      const product = currentStoreFrom(draft).products.find(item => item.id === row.productId);
      if (!product) return prev;
      product[PlatformUtils.priceField(row.platform)] = suggestedPrice === product.price ? '' : suggestedPrice;
      return normalizeState(draft);
    });
    message.success(`已按${row.planName}应用到${row.platformName}价，请重新生成定价规则查看结果。`);
    setPricingEvaluation(null);
    setSelectedPricingProductKey('');
  };
  const pricingSummary = pricingEvaluation?.summary || (isLoading ? fallbackSummary : { resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
  const pricingIssues = pricingEvaluation?.productRows || [];
  const planFilteredPricingIssues = React.useMemo(
    () => visiblePlanFilter === 'all' ? pricingIssues : pricingIssues.filter(issue => issue.planKey === visiblePlanFilter),
    [pricingIssues, visiblePlanFilter]
  );
  const visiblePricingIssues = React.useMemo(
    () => filterPricingIssues(planFilteredPricingIssues, pricingResultSearchText, severityLabel),
    [planFilteredPricingIssues, pricingResultSearchText, severityLabel]
  );
  const generatedPlanCount = React.useMemo(
    () => new Set(pricingIssues.map(issue => issue.planKey)).size,
    [pricingIssues]
  );
  const abnormalPricingIssueCount = React.useMemo(
    () => pricingIssues.filter(issue => issue.severity !== 'none').length,
    [pricingIssues]
  );
  const setMealConfigIssueCount = React.useMemo(
    () => pricingIssues.filter(issue => issue.strategyKind === 'setMeal' && issue.severity === 'config').length,
    [pricingIssues]
  );
  const selectedPricingIssue = React.useMemo(
    () => pricingIssues.find(issue => issue.key === selectedPricingProductKey),
    [pricingIssues, selectedPricingProductKey]
  );
  const previewPlanRules = React.useMemo(
    () => previewPricingPlanRules(pricingSettings),
    [pricingSettings]
  );
  const pricingPlanRules = pricingEvaluation?.planRules?.length ? pricingEvaluation.planRules : previewPlanRules;
  const selectedPlanRule = React.useMemo(
    () => selectedPricingIssue
      ? pricingPlanRules.find(rule => rule.planKey === selectedPricingIssue.planKey)
      : null,
    [pricingPlanRules, selectedPricingIssue]
  );

  const updateSettings = (patch: Partial<PricingEvaluationSettings>) => {
    setPricingSettings(prev => ({ ...prev, ...patch }));
  };

  const pricingPlanRuleColumns = React.useMemo<TableColumnsType<PricingPlanRuleDetail>>(() => [
    { title: '方案', dataIndex: 'planName', width: 110, render: (_, row) => <Tag color={row.planKey === 'traffic' ? 'cyan' : row.planKey === 'profit' ? 'volcano' : 'green'}>{row.planName}</Tag> },
    { title: '方案说明', dataIndex: 'planDescription', width: 260, render: value => <Text type="secondary">{String(value || '-')}</Text> },
    { title: '主食目标占比', dataIndex: 'stapleTargetCostShare', width: 120, render: value => rateText(value as number | null) },
    { title: '凑单目标占比', dataIndex: 'addOnTargetCostShare', width: 120, render: value => rateText(value as number | null) },
    { title: '凑单承接主食', dataIndex: 'addOnStapleRatioShare', width: 120, render: value => rateText(value as number | null) },
    { title: '品类最低售价', dataIndex: 'addOnMinimumOriginalPrice', width: 120, render: value => `¥${money(value)}` },
    { title: '优惠承接比例', dataIndex: 'addOnPromotionRiskShare', width: 120, render: value => rateText(value as number | null) },
    { title: '套餐目标占比', dataIndex: 'setMealTargetCostShare', width: 120, render: value => rateText(value as number | null) },
    { title: '套餐折扣', dataIndex: 'setMealDiscountRate', width: 100, render: value => rateText(value as number | null) },
    { title: '基础活动口径', dataIndex: 'baseRedAmountMode', width: 110, render: value => baseRedAmountModeText(value as PricingBaseRedAmountMode) },
    { title: '固定支出', dataIndex: 'fixedActivityCost', width: 100, render: value => `¥${money(value)}` }
  ], [money, rateText]);

  const pricingProductColumns = React.useMemo<TableColumnsType<PricingProductRow>>(() => [
    { title: '等级', dataIndex: 'severity', width: 80, fixed: 'left', render: value => <Tag color={severityColor(value as Severity)}>{severityLabel(value as Severity)}</Tag>, sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity), defaultSortOrder: 'descend' },
    { title: '方案', dataIndex: 'planName', width: 105, fixed: 'left', render: (_, row) => <Tag color={row.planKey === 'traffic' ? 'cyan' : row.planKey === 'profit' ? 'volcano' : 'green'}>{row.planName}</Tag>, sorter: (a, b) => a.planName.localeCompare(b.planName, 'zh-CN') },
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left', sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: (_, row) => <Button className="table-link-wrap" type="link" title={row.productName} onClick={() => setSelectedPricingProductKey(row.key)}>{row.productName}</Button>, sorter: (a, b) => a.productName.localeCompare(b.productName, 'zh-CN') },
    { title: '策略', dataIndex: 'strategyName', width: 95, render: value => <Tag color="blue">{String(value || '-')}</Tag> },
    { title: '分类', dataIndex: 'categoryName', width: 95, responsive: SHOW_LG, render: value => <Tag>{String(value || '-')}</Tag> },
    { title: '当前售价', dataIndex: 'currentPrice', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentPrice - b.currentPrice },
    { title: '打包费', dataIndex: 'packageFee', width: 90, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.packageFee - b.packageFee },
    { title: '当前含费价', dataIndex: 'currentOriginalPrice', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentOriginalPrice - b.currentOriginalPrice },
    { title: '基础活动', dataIndex: 'baseRedAmount', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseRedAmount - b.baseRedAmount },
    { title: '配送减免', dataIndex: 'freightSubsidy', width: 100, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.freightSubsidy - b.freightSubsidy },
    { title: '固定支出', dataIndex: 'fixedActivityCost', width: 100, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.fixedActivityCost - b.fixedActivityCost },
    { title: '支付价', dataIndex: 'finalPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.finalPay - b.finalPay },
    { title: '佣金配送费', dataIndex: 'commissionDeliveryFee', width: 120, render: value => `¥${money(value)}`, sorter: (a, b) => a.commissionDeliveryFee - b.commissionDeliveryFee },
    { title: '佣金', dataIndex: 'commission', width: 90, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.commission - b.commission },
    { title: '配送服务', dataIndex: 'serviceFee', width: 100, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.serviceFee - b.serviceFee },
    { title: '支出合计', dataIndex: 'platformExpenseTotal', width: 100, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.platformExpenseTotal - b.platformExpenseTotal },
    { title: '商家到手', dataIndex: 'netRevenue', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.netRevenue - b.netRevenue },
    { title: '到手率', dataIndex: 'netTakeRate', width: 100, render: value => rateText(value as number | null), sorter: (a, b) => (a.netTakeRate ?? 0) - (b.netTakeRate ?? 0) },
    { title: '商品成本', dataIndex: 'productCost', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.productCost - b.productCost },
    { title: '成本占比', dataIndex: 'costShare', width: 105, render: value => rateText(value as number | null), sorter: (a, b) => (a.costShare ?? 0) - (b.costShare ?? 0) },
    { title: '目标占比', dataIndex: 'targetCostShare', width: 105, render: value => rateText(value as number | null), sorter: (a, b) => a.targetCostShare - b.targetCostShare },
    { title: '占比空间', dataIndex: 'costShareSpace', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>{rateText(value as number | null)}</Text>, sorter: (a, b) => (a.costShareSpace ?? 0) - (b.costShareSpace ?? 0) },
    { title: '主食比例', dataIndex: 'staplePriceCostRatio', width: 100, responsive: SHOW_XL, render: value => multipleText(value as number | null), sorter: (a, b) => (a.staplePriceCostRatio ?? 0) - (b.staplePriceCostRatio ?? 0) },
    { title: '主食参考价', dataIndex: 'addOnReferenceOriginalPrice', width: 115, responsive: SHOW_XL, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.addOnReferenceOriginalPrice ?? 0) - (b.addOnReferenceOriginalPrice ?? 0) },
    { title: '成本底价', dataIndex: 'addOnCostShareFloor', width: 105, responsive: SHOW_XL, render: value => optionalMoney(value as number | null), sorter: (a, b) => (a.addOnCostShareFloor ?? 0) - (b.addOnCostShareFloor ?? 0) },
    { title: '主食比例价', dataIndex: 'addOnStapleRatioFloor', width: 115, responsive: SHOW_XL, render: value => optionalMoney(value as number | null), sorter: (a, b) => (a.addOnStapleRatioFloor ?? 0) - (b.addOnStapleRatioFloor ?? 0) },
    { title: '品类最低价', dataIndex: 'addOnMinimumOriginalPrice', width: 115, responsive: SHOW_XL, render: value => optionalMoney(value as number | null), sorter: (a, b) => (a.addOnMinimumOriginalPrice ?? 0) - (b.addOnMinimumOriginalPrice ?? 0) },
    { title: '新增优惠', dataIndex: 'addOnPromotionRiskAmount', width: 105, responsive: SHOW_XL, render: value => optionalMoney(value as number | null), sorter: (a, b) => (a.addOnPromotionRiskAmount ?? 0) - (b.addOnPromotionRiskAmount ?? 0) },
    { title: '风险底价', dataIndex: 'addOnPromotionRiskFloor', width: 105, responsive: SHOW_XL, render: value => optionalMoney(value as number | null), sorter: (a, b) => (a.addOnPromotionRiskFloor ?? 0) - (b.addOnPromotionRiskFloor ?? 0) },
    { title: '取价底线', dataIndex: 'addOnPricingFloor', width: 105, responsive: SHOW_XL, render: value => optionalMoney(value as number | null), sorter: (a, b) => (a.addOnPricingFloor ?? 0) - (b.addOnPricingFloor ?? 0) },
    { title: '取价依据', dataIndex: 'addOnPricingBasisName', width: 150, responsive: SHOW_XL, render: value => String(value || '-') },
    { title: '套餐基准价', dataIndex: 'componentOriginalTotal', width: 110, responsive: SHOW_XL, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.componentOriginalTotal ?? 0) - (b.componentOriginalTotal ?? 0) },
    { title: '套餐成本', dataIndex: 'componentCostTotal', width: 100, responsive: SHOW_XL, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.componentCostTotal ?? 0) - (b.componentCostTotal ?? 0) },
    { title: '套餐折扣', dataIndex: 'discountAmount', width: 100, responsive: SHOW_XL, render: value => Number(value) > 0 ? `¥${money(value)}` : '-', sorter: (a, b) => a.discountAmount - b.discountAmount },
    { title: '目标含费价', dataIndex: 'suggestedOriginalPrice', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.suggestedOriginalPrice - b.suggestedOriginalPrice },
    { title: '建议平台价', dataIndex: 'suggestedPrice', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.suggestedPrice - b.suggestedPrice },
    { title: '建议调价', dataIndex: 'suggestedIncrease', width: 125, render: (_, row) => row.suggestedIncrease === 0 ? '-' : <Text type={row.suggestedIncrease > 0 ? 'danger' : 'success'}>{row.suggestedIncrease > 0 ? '+' : ''}¥{money(row.suggestedIncrease)} / {rateText(row.suggestedIncreaseRate)}</Text>, sorter: (a, b) => a.suggestedIncrease - b.suggestedIncrease },
    { title: '诊断', dataIndex: 'reasons', width: 280, responsive: SHOW_XL, render: (reasons: string[]) => reasons.join('，') },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedPricingProductKey(row.key)}>查看</Button>
          <Button size="small" disabled={Math.abs(row.suggestedIncrease) < 0.01} onClick={() => applySuggestedPrice(row)}>应用建议价</Button>
        </Space>
      )
    }
  ], [applySuggestedPrice, money, rateText, severityColor, severityLabel, severityRank]);

  return (
    <div className="section-stack">
      <Card title="定价评估" extra={
        <Space wrap>
          <Select value={platformFilter} onChange={setPlatformFilter} options={[{ value: 'all', label: '全部平台' }, { value: 'meituan', label: '只看美团' }, { value: 'eleme', label: '只看饿了么' }]} />
          <Button type="primary" loading={isLoading} onClick={() => runPricingEvaluation(pricingSettings, platformFilter)}>生成定价规则</Button>
        </Space>
      }>
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">按主食、凑单商品、套餐生成多套建议价；支付价扣除佣金配送费后得到商家到手，定价判断只看成本占比。</Text>
          <Card size="small" title="筛选和平台活动口径">
            <Row gutter={[12, 12]}>
              <Col xs={24} md={6}>
                <div className="field">
                  <Text type="secondary">商品名称筛选</Text>
                  <Input allowClear placeholder="空=全部商品，支持模糊匹配" value={pricingSettings.productNameKeyword} onChange={event => updateSettings({ productNameKeyword: event.target.value })} />
                </div>
              </Col>
              <Col xs={24} md={6}>
                <div className="field">
                  <Text type="secondary">生成方案</Text>
                  <Select
                    mode="multiple"
                    value={pricingSettings.enabledPlanKeys}
                    onChange={(value: PricingPlanKey[]) => updateSettings({ enabledPlanKeys: value.length ? value : ['balanced'] })}
                    options={PRICING_PLAN_PRESETS.map(plan => ({ value: plan.key, label: plan.name }))}
                  />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">含费价最低</Text>
                  <InputNumber min={0} precision={2} value={pricingSettings.originalMin} onChange={value => updateSettings({ originalMin: pricingSettingNumber(value) })} />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">含费价最高</Text>
                  <InputNumber min={0} precision={2} placeholder="空=不限" value={pricingSettings.originalMax === '' ? null : pricingSettings.originalMax} onChange={value => updateSettings({ originalMax: value === null ? '' : pricingSettingNumber(value) })} />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">基础活动口径</Text>
                  <Select
                    value={pricingSettings.baseRedAmountMode}
                    onChange={(value: PricingBaseRedAmountMode) => updateSettings({ baseRedAmountMode: value })}
                    options={[
                      { value: 'max', label: '最高' },
                      { value: 'average', label: '平均' },
                      { value: 'min', label: '最低' }
                    ]}
                  />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">其他固定活动支出</Text>
                  <InputNumber min={0} precision={2} value={pricingSettings.fixedActivityCost} onChange={value => updateSettings({ fixedActivityCost: pricingSettingNumber(value) })} />
                </div>
              </Col>
            </Row>
          </Card>

          <Row gutter={[12, 12]}>
            <Col xs={24} lg={8}>
              <Card size="small" title="主食策略">
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <div className="field">
                    <Text type="secondary">目标成本占比%</Text>
                    <InputNumber min={1} max={100} precision={2} value={pricingSettings.stapleTargetCostShare} onChange={value => updateSettings({ stapleTargetCostShare: pricingSettingNumber(value) })} />
                  </div>
                  <Text type="secondary">主食承担基础活动、配送减免、配送服务费和其他固定活动支出；建议价以成本占支付价的比例是否达标判断。</Text>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card size="small" title="凑单商品策略">
                <Space orientation="vertical" style={{ width: '100%' }}>
                  <Row gutter={[12, 12]}>
                    <Col xs={12}>
                      <div className="field">
                        <Text type="secondary">目标成本占比%</Text>
                        <InputNumber min={1} max={100} precision={2} value={pricingSettings.addOnTargetCostShare} onChange={value => updateSettings({ addOnTargetCostShare: pricingSettingNumber(value) })} />
                      </div>
                    </Col>
                    <Col xs={12}>
                      <div className="field">
                        <Text type="secondary">承接主食比例%</Text>
                        <InputNumber min={0} max={100} precision={2} value={pricingSettings.addOnStapleRatioShare} onChange={value => updateSettings({ addOnStapleRatioShare: pricingSettingNumber(value) })} />
                      </div>
                    </Col>
                    <Col xs={12}>
                      <div className="field">
                        <Text type="secondary">品类最低售价</Text>
                        <InputNumber min={0} precision={2} value={pricingSettings.addOnMinimumOriginalPrice} onChange={value => updateSettings({ addOnMinimumOriginalPrice: pricingSettingNumber(value) })} />
                      </div>
                    </Col>
                    <Col xs={12}>
                      <div className="field">
                        <Text type="secondary">优惠承接比例%</Text>
                        <InputNumber min={0} max={100} precision={2} value={pricingSettings.addOnPromotionRiskShare} onChange={value => updateSettings({ addOnPromotionRiskShare: pricingSettingNumber(value) })} />
                      </div>
                    </Col>
                  </Row>
                  <Text type="secondary">凑单商品不承担配送减免、配送服务费、基础活动和其他固定活动支出，避免小吃售价被直接摊高。</Text>
                  <Text type="secondary">建议价取成本底价、主食比例价、品类最低价、阶梯风险底价中的最高值，防止低价小吃在大额券或下一档优惠中打穿利润。</Text>
                </Space>
              </Card>
            </Col>
            <Col xs={24} lg={8}>
              <Card size="small" title="套餐策略">
                <Row gutter={[12, 12]}>
                  <Col xs={12}>
                    <div className="field">
                      <Text type="secondary">目标成本占比%</Text>
                      <InputNumber min={1} max={100} precision={2} value={pricingSettings.setMealTargetCostShare} onChange={value => updateSettings({ setMealTargetCostShare: pricingSettingNumber(value) })} />
                    </div>
                  </Col>
                  <Col xs={12}>
                    <div className="field">
                      <Text type="secondary">套餐折扣率%</Text>
                      <InputNumber min={0} max={95} precision={2} value={pricingSettings.setMealDiscountRate} onChange={value => updateSettings({ setMealDiscountRate: pricingSettingNumber(value) })} />
                    </div>
                  </Col>
                  <Col xs={24}>
                    <Text type="secondary">套餐先按组成商品建议价求和，再扣套餐折扣，并与成本占比底价取较高值。</Text>
                  </Col>
                </Row>
              </Card>
            </Col>
          </Row>

          <Card size="small" title="已关联平台规则">
            <Space wrap>
              <Tag>佣金率 {money(effectiveRule.commissionRate)}%</Tag>
              <Tag>保底佣金 ¥{money(effectiveRule.minCommission)}</Tag>
              <Tag>基础配送服务 ¥{money(effectiveRule.baseDeliveryFee)}</Tag>
              <Tag>20-25元费率 {money(effectiveRule.midPriceRate)}</Tag>
              <Tag>25元以上费率 {money(effectiveRule.highPriceRate)}</Tag>
              <Tag>配送减免 ¥{money(store.deliveryDistance <= 3 ? effectiveRule.freightWithin3 : store.deliveryDistance <= 5 ? effectiveRule.freightWithin5 : effectiveRule.freightAbove5)}</Tag>
              <Tag>基础活动按{baseRedAmountModeText(pricingSettings.baseRedAmountMode)}</Tag>
              <Tag>凑单承接主食 {money(pricingSettings.addOnStapleRatioShare)}%</Tag>
              <Tag>凑单最低售价 ¥{money(pricingSettings.addOnMinimumOriginalPrice)}</Tag>
              <Tag>优惠承接 {money(pricingSettings.addOnPromotionRiskShare)}%</Tag>
            </Space>
          </Card>

          <Card
            size="small"
            title={pricingEvaluation ? '已生成定价规则明细' : '待生成定价规则明细'}
            extra={<Tag color={pricingEvaluation ? 'green' : 'default'}>{pricingEvaluation ? '已生成' : '预览'}</Tag>}
          >
            <Table
              rowKey="planKey"
              size="small"
              columns={pricingPlanRuleColumns}
              dataSource={pricingPlanRules}
              pagination={false}
              scroll={{ x: 1400 }}
              tableLayout="fixed"
            />
          </Card>

          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">方案结果</Text><Title level={3}>{pricingSummary.resultCount}</Title></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">生成方案</Text><Title level={3}>{generatedPlanCount || pricingSettings.enabledPlanKeys.length}</Title></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">异常结果</Text><Title level={3}>{abnormalPricingIssueCount}</Title></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">套餐配置问题</Text><Title level={3}>{setMealConfigIssueCount}</Title></Card></Col>
          </Row>
          {pricingEvaluation?.warnings.length ? <Card size="small">{pricingEvaluation.warnings.map(item => <Text key={item} type="warning">{item}</Text>)}</Card> : null}
          <Card size="small">
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Space wrap>
                <Select
                  style={{ width: 140 }}
                  value={visiblePlanFilter}
                  onChange={setVisiblePlanFilter}
                  options={[
                    { value: 'all', label: '全部方案' },
                    ...PRICING_PLAN_PRESETS.map(plan => ({ value: plan.key, label: plan.name }))
                  ]}
                />
                <Input.Search
                  allowClear
                  placeholder="搜索商品、平台、策略、诊断或价格"
                  style={{ width: 320, maxWidth: '100%' }}
                  value={pricingResultSearchText}
                  onChange={event => setPricingResultSearchText(event.target.value)}
                />
              </Space>
              <Text type="secondary">当前显示 {visiblePricingIssues.length} / {pricingIssues.length} 个结果</Text>
            </Space>
          </Card>
          <Table loading={isLoading} rowKey="key" size="small" columns={pricingProductColumns} dataSource={visiblePricingIssues} pagination={tablePagination(20)} scroll={{ x: 4040 }} tableLayout="fixed" />
        </Space>
      </Card>

      <Modal
        title={selectedPricingIssue ? `${selectedPricingIssue.planName} / ${selectedPricingIssue.platformName} / ${selectedPricingIssue.productName} 定价诊断` : '定价诊断'}
        open={Boolean(selectedPricingIssue)}
        width={1040}
        className="cost-analysis-modal"
        style={{ top: 16, paddingBottom: 0 }}
        footer={null}
        onCancel={() => setSelectedPricingProductKey('')}
      >
        {selectedPricingIssue ? (
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Tag color={severityColor(selectedPricingIssue.severity)}>{severityLabel(selectedPricingIssue.severity)}</Tag>
              <Tag color={selectedPricingIssue.planKey === 'traffic' ? 'cyan' : selectedPricingIssue.planKey === 'profit' ? 'volcano' : 'green'}>{selectedPricingIssue.planName}</Tag>
              <Tag>{selectedPricingIssue.strategyName}</Tag>
              <Text type="secondary">{selectedPricingIssue.planDescription} {selectedPricingIssue.reasons.join('，')}</Text>
            </Space>
            {selectedPlanRule ? (
              <Card size="small" title="方案规则">
                <Space wrap>
                  <Tag>主食目标成本占比 {rateText(selectedPlanRule.stapleTargetCostShare)}</Tag>
                  <Tag>凑单目标成本占比 {rateText(selectedPlanRule.addOnTargetCostShare)}</Tag>
                  <Tag>凑单承接主食 {rateText(selectedPlanRule.addOnStapleRatioShare)}</Tag>
                  <Tag>凑单最低售价 ¥{money(selectedPlanRule.addOnMinimumOriginalPrice)}</Tag>
                  <Tag>优惠承接比例 {rateText(selectedPlanRule.addOnPromotionRiskShare)}</Tag>
                  <Tag>套餐目标成本占比 {rateText(selectedPlanRule.setMealTargetCostShare)}</Tag>
                  <Tag>套餐折扣 {rateText(selectedPlanRule.setMealDiscountRate)}</Tag>
                  <Tag>基础活动按{baseRedAmountModeText(selectedPlanRule.baseRedAmountMode)}</Tag>
                  <Tag>固定支出 ¥{money(selectedPlanRule.fixedActivityCost)}</Tag>
                </Space>
              </Card>
            ) : null}
            <Row gutter={[12, 12]}>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前平台价</Text><Title level={4}>¥{money(selectedPricingIssue.currentPrice)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">含费价</Text><Title level={4}>¥{money(selectedPricingIssue.currentOriginalPrice)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">支付价</Text><Title level={4}>¥{money(selectedPricingIssue.finalPay)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">佣金配送费</Text><Title level={4}>¥{money(selectedPricingIssue.commissionDeliveryFee)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">商家到手</Text><Title level={4}>¥{money(selectedPricingIssue.netRevenue)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">到手率</Text><Title level={4}>{rateText(selectedPricingIssue.netTakeRate)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">成本占比</Text><Title level={4}>{rateText(selectedPricingIssue.costShare)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">目标占比</Text><Title level={4}>{rateText(selectedPricingIssue.targetCostShare)}</Title></Card></Col>
            </Row>
            <Card size="small" title="费用拆解">
              <Space wrap>
                <Tag>商品成本 ¥{money(selectedPricingIssue.productCost)}</Tag>
                {selectedPricingIssue.componentCostTotal !== null ? <Tag>套餐组成成本 ¥{money(selectedPricingIssue.componentCostTotal)}</Tag> : null}
                <Tag>基础活动 ¥{money(selectedPricingIssue.baseRedAmount)}</Tag>
                <Tag>佣金 ¥{money(selectedPricingIssue.commission)}</Tag>
                <Tag>配送服务 ¥{money(selectedPricingIssue.serviceFee)}</Tag>
                <Tag>配送减免 ¥{money(selectedPricingIssue.freightSubsidy)}</Tag>
                <Tag>其他固定活动 ¥{money(selectedPricingIssue.fixedActivityCost)}</Tag>
                <Tag>支出合计 ¥{money(selectedPricingIssue.platformExpenseTotal)}</Tag>
              </Space>
            </Card>
            <Card size="small" title="策略依据">
              <Space wrap>
                <Tag>目标成本占比 {rateText(selectedPricingIssue.targetCostShare)}</Tag>
                <Tag>当前成本占比 {rateText(selectedPricingIssue.costShare)}</Tag>
                <Tag>占比空间 {rateText(selectedPricingIssue.costShareSpace)}</Tag>
                <Tag>到手率 {rateText(selectedPricingIssue.netTakeRate)}</Tag>
                <Tag>当前毛利 ¥{money(selectedPricingIssue.currentProfit)}</Tag>
                {selectedPricingIssue.staplePriceCostRatio !== null ? <Tag>主食比例 {multipleText(selectedPricingIssue.staplePriceCostRatio)}</Tag> : null}
                {selectedPricingIssue.addOnReferenceOriginalPrice !== null ? <Tag>主食参考价 ¥{money(selectedPricingIssue.addOnReferenceOriginalPrice)}</Tag> : null}
                {selectedPricingIssue.addOnCostShareFloor !== null ? <Tag>成本占比底价 ¥{money(selectedPricingIssue.addOnCostShareFloor)}</Tag> : null}
                {selectedPricingIssue.addOnStapleRatioFloor !== null ? <Tag>主食比例价 ¥{money(selectedPricingIssue.addOnStapleRatioFloor)}</Tag> : null}
                {selectedPricingIssue.addOnMinimumOriginalPrice !== null ? <Tag>品类最低售价 ¥{money(selectedPricingIssue.addOnMinimumOriginalPrice)}</Tag> : null}
                {selectedPricingIssue.addOnPromotionRiskAmount !== null ? <Tag>新增优惠 ¥{money(selectedPricingIssue.addOnPromotionRiskAmount)}</Tag> : null}
                {selectedPricingIssue.addOnPromotionRiskFloor !== null ? <Tag>阶梯风险底价 ¥{money(selectedPricingIssue.addOnPromotionRiskFloor)}</Tag> : null}
                {selectedPricingIssue.addOnPricingFloor !== null ? <Tag>凑单取价底线 ¥{money(selectedPricingIssue.addOnPricingFloor)}</Tag> : null}
                {selectedPricingIssue.addOnPricingBasisName ? <Tag>凑单取价依据 {selectedPricingIssue.addOnPricingBasisName}</Tag> : null}
                {selectedPricingIssue.componentOriginalTotal !== null ? <Tag>套餐基准价 ¥{money(selectedPricingIssue.componentOriginalTotal)}</Tag> : null}
                {selectedPricingIssue.setMealDiscountRate !== null ? <Tag>套餐折扣率 {rateText(selectedPricingIssue.setMealDiscountRate)}</Tag> : null}
                {selectedPricingIssue.discountAmount > 0 ? <Tag>套餐折扣 ¥{money(selectedPricingIssue.discountAmount)}</Tag> : null}
              </Space>
            </Card>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">目标含费价</Text><Title level={4}>¥{money(selectedPricingIssue.suggestedOriginalPrice)}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">建议平台价</Text><Title level={4}>¥{money(selectedPricingIssue.suggestedPrice)}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">建议调价</Text><Title level={4}>{selectedPricingIssue.suggestedIncrease > 0 ? '+' : ''}¥{money(selectedPricingIssue.suggestedIncrease)}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">调价比例</Text><Title level={4}>{rateText(selectedPricingIssue.suggestedIncreaseRate)}</Title></Card></Col>
            </Row>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
