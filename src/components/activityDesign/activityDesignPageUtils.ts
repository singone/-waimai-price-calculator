import { roundMoney } from '../../domain/money';
import { buildActivityRouteKey } from '../../domain/activity/shared';
import type {
  ActivityComboSimulationRow,
  ActivityDesignObjective,
  ActivityDesignSettings,
  ActivityRecommendationRow,
  ActivityScanComboPools,
  ActivityScanComboPoolRow,
  ActivityCouponRecommendationMode,
  Platform,
  Store,
} from '../../domain/types';
import type { ActivityObjectiveOption } from '../../config/activityStrategy';
import { calculationTotalRange, PLATFORM_NAMES } from '../../domain/core';
export { comboPackageFeeTotal, itemsText, paymentGrossRate, riskColor, riskLabel } from '../shared/comboDisplayUtils';

export type ActivityFullReductionLogSegmentType = '参数' | '生成' | '拒绝' | '退出' | '其他';

export type ActivityFullReductionLogSegment = {
  key: string;
  type: ActivityFullReductionLogSegmentType;
  title: string;
  detail: string[];
};

/**
 * 生成活动设计任务使用的参数。
 *
 * @param store 当前门店。
 * @param activityDesignSettings 已合并系统策略和门店覆盖项的活动设计设置。
 * @param overrides 任务级临时字段，例如所选活动路线快照。
 * @returns 不包含页面筛选条件的活动设计任务参数。
 */
export function buildActivityDesignCalculationSettings(
  store: Store,
  activityDesignSettings: ActivityDesignSettings,
  overrides: Partial<ActivityDesignSettings> = {}
): ActivityDesignSettings {
  const storeRange = calculationTotalRange(store);
  return {
    ...activityDesignSettings,
    productNameKeyword: '',
    originalMin: 0,
    originalMax: Number.isFinite(storeRange.max) ? storeRange.max : '',
    payMin: 0,
    payMax: '',
    selectedRecommendationKey: undefined,
    selectedRecommendationSnapshot: undefined,
    ...overrides
  };
}

export function activityRepresentedComboCount(row: Pick<ActivityComboSimulationRow, 'representedComboCount'>) {
  if (row.representedComboCount === undefined || row.representedComboCount === null) return 1;
  return Math.max(0, Math.floor(Number(row.representedComboCount) || 0));
}

export function activityCostBasisLabel(row: Pick<ActivityComboSimulationRow, 'key' | 'scenarioName' | 'representedComboCount'>) {
  const key = String(row.key || '');
  const scenarioName = String(row.scenarioName || '');
  if (key.endsWith('::maxCost') || scenarioName.includes('最高成本')) return '最高成本';
  if (key.endsWith('::minCost') || scenarioName.includes('最低成本')) return '最低成本';
  if (row.representedComboCount !== undefined && row.representedComboCount !== null) return '平均成本';
  return '真实组合';
}

export function activityRecommendationRedAddOnSpace(row: ActivityRecommendationRow) {
  const totalSpace = nonNegativeAmount(row.addOnCostSpace);
  const routeSpace = nonNegativeAmount(row.routeAddOnCostSpace);
  return {
    configuredSpace: Math.max(0, roundMoney(totalSpace - routeSpace)),
    routeSpace,
    totalSpace
  };
}

export function activityRouteTypeLabel(row: ActivityRecommendationRow) {
  if (row.routeGroup === 'stable') return '稳定底盘';
  if (row.routeKind === 'fullReduction') return '满减候选';
  if (row.routeKind === 'coupon') return '券候选';
  return '经营目标';
}

function activityObjectivePayTargetLabel(objectiveOptions: ActivityObjectiveOption[], objective: ActivityDesignObjective) {
  const option = objectiveOptions.find(item => item.value === objective);
  return `${option?.label || objective}活动空间规则`;
}

function buildManualActivityRouteSnapshot(
  platform: Platform,
  fullRoute: ActivityRecommendationRow | null,
  couponRoute: ActivityRecommendationRow | null,
  settings: ActivityDesignSettings,
  objectiveOptions: ActivityObjectiveOption[],
  options: {
    objective?: ActivityDesignObjective;
    objectiveName?: string;
    targetPayLabel?: string;
    routeGroup?: ActivityRecommendationRow['routeGroup'];
    actionType?: string;
    diagnosis?: string;
  } = {}
): ActivityRecommendationRow | null {
  const source = fullRoute || couponRoute;
  if (!source) return null;
  const fullReductionRules = fullRoute?.fullReductionRules || [];
  const couponRules = couponRoute?.couponRules || [];
  const addOnCostSpace = nonNegativeAmount(settings.redAddOnSpace);
  if (!fullReductionRules.length && !couponRules.length && addOnCostSpace <= 0) return null;
  const fullAmount = fullReductionRules.reduce((max, rule) => Math.max(max, nonNegativeAmount(rule.amount)), 0);
  const couponAmount = couponRules.reduce((max, rule) => Math.max(max, nonNegativeAmount(rule.amount)), 0);
  const key = buildActivityRouteKey({
    platform,
    version: ['route-package-v1', options.objective || source.objective, options.routeGroup || source.routeGroup || 'custom'].join(':'),
    fullReductionRules,
    couponRules,
    redAddOnRules: addOnCostSpace > 0 ? [{ enabled: true, threshold: 0, amount: addOnCostSpace }] : []
  });
  const sourceRouteKeys = [fullRoute?.key, couponRoute?.key].filter((item): item is string => Boolean(item));
  const objective = options.objective || couponRoute?.objective || fullRoute?.objective || source.objective;
  const objectiveOption = objectiveOptions.find(item => item.value === objective);
  return {
    ...source,
    key,
    platform,
    platformName: PLATFORM_NAMES[platform],
    routeKind: 'combined',
    routeGroup: options.routeGroup || objectiveOption?.group || source.routeGroup,
    targetPayLabel: options.targetPayLabel || `${objectiveOption?.label || source.objectiveName}活动空间规则`,
    targetDiscountRate: source.targetDiscountRate ?? null,
    actualAvgDiscountRate: source.actualAvgDiscountRate ?? null,
    actualMinDiscountRate: source.actualMinDiscountRate ?? null,
    actualMaxDiscountRate: source.actualMaxDiscountRate ?? null,
    sourceRouteKeys,
    objective,
    objectiveName: options.objectiveName || [fullRoute?.objectiveName, couponRoute?.userScenarioName || couponRoute?.objectiveName]
      .filter(Boolean)
      .join(' + ') || source.objectiveName,
    originalBandKey: key,
    fullReductionRules,
    couponRules,
    couponBucketSuggestions: couponRoute?.couponBucketSuggestions || source.couponBucketSuggestions || [],
    fullAmount,
    couponAmount,
    productDiscountAmount: 0,
    addOnCostSpace,
    routeAddOnCostSpace: 0,
    totalDiscount: roundMoney(fullAmount + couponAmount + addOnCostSpace),
    safeDiscountSpace: Math.min(
      ...[fullRoute?.safeDiscountSpace, couponRoute?.safeDiscountSpace]
        .filter((value): value is number => Number.isFinite(value))
    ),
    score: roundMoney((fullRoute?.score || 0) + (couponRoute?.score || 0)),
    actionType: options.actionType || [
      fullRoute ? '满减路线' : '',
      couponRoute ? '优惠券路线' : '',
      addOnCostSpace > 0 ? '加码' : ''
    ].filter(Boolean).join('+'),
    diagnosis: options.diagnosis || fullRoute?.diagnosis || '当前路线未生成满减阶梯，请复核原价桶让利空间和满减步长'
  };
}

function bestActivityRoute(
  routes: ActivityRecommendationRow[],
  objective: ActivityDesignObjective,
  limit = 1
) {
  return routes
    .filter(row => row.objective === objective)
    .slice()
    .sort((a, b) => a.score - b.score || b.hitCount - a.hitCount)
    .slice(0, limit);
}

export function buildActivityRoutePackages(
  platform: Platform,
  fullRoutes: ActivityRecommendationRow[],
  couponRoutes: ActivityRecommendationRow[],
  settings: ActivityDesignSettings,
  objectiveOptions: ActivityObjectiveOption[]
) {
  const packages = new Map<string, ActivityRecommendationRow>();
  const stableObjective = objectiveOptions.find(option => option.group === 'stable')?.value || 'longTerm';
  const stableFullRoutes = bestActivityRoute(fullRoutes, stableObjective, 2);
  const stableCouponRoutes = bestActivityRoute(couponRoutes, stableObjective, 1);
  const fallbackStableFull = stableFullRoutes[0] || bestActivityRoute(fullRoutes, settings.objective || stableObjective, 1)[0] || fullRoutes[0] || null;

  objectiveOptions.forEach(option => {
    const targetPayLabel = activityObjectivePayTargetLabel(objectiveOptions, option.value);
    const isStableObjective = option.group === 'stable';
    const fullCandidates = option.value === 'profitRecovery'
      ? bestActivityRoute(fullRoutes, 'profitRecovery', 2)
      : isStableObjective
        ? bestActivityRoute(fullRoutes, option.value, 2)
        : stableFullRoutes.length
          ? stableFullRoutes.slice(0, 1)
          : bestActivityRoute(fullRoutes, option.value, 1);
    const couponCandidates = option.value === 'profitRecovery'
      ? []
      : isStableObjective
        ? stableCouponRoutes
        : bestActivityRoute(couponRoutes, option.value, 2);
    const safeFullCandidates = fullCandidates.length ? fullCandidates : fallbackStableFull ? [fallbackStableFull] : [];
    const safeCouponCandidates = couponCandidates.length ? couponCandidates : isStableObjective ? [] : bestActivityRoute(couponRoutes, option.value, 1);
    const pairs: Array<{ fullRoute: ActivityRecommendationRow | null; couponRoute: ActivityRecommendationRow | null }> = safeFullCandidates.length
      ? safeCouponCandidates.length
        ? safeFullCandidates.flatMap(fullRoute => safeCouponCandidates.map(couponRoute => ({ fullRoute, couponRoute })))
        : safeFullCandidates.map(fullRoute => ({ fullRoute, couponRoute: null }))
      : safeCouponCandidates.map(couponRoute => ({ fullRoute: null, couponRoute }));
    pairs.forEach(({ fullRoute, couponRoute }, index) => {
      const snapshot = buildManualActivityRouteSnapshot(platform, fullRoute, couponRoute, settings, objectiveOptions, {
        objective: option.value,
        objectiveName: option.label,
        targetPayLabel,
        routeGroup: option.group,
        actionType: isStableObjective
          ? '稳定满减路线'
          : `${option.label}路线`,
        diagnosis: fullRoute?.diagnosis || '当前路线未生成满减阶梯，请复核原价桶让利空间和满减步长。'
      });
      if (!snapshot) return;
      packages.set(`${snapshot.key}:${option.value}:${index}`, {
        ...snapshot,
        key: `${snapshot.key}:${option.value}:${index}`,
        score: roundMoney((fullRoute?.score || 0) + (couponRoute?.score || 0)),
        scoreLevel: fullRoute?.scoreLevel || couponRoute?.scoreLevel,
        scoreLabel: fullRoute?.scoreLabel || couponRoute?.scoreLabel,
        scoreDetails: [
          `${option.label}活动空间规则`,
          ...((fullRoute?.scoreDetails || []).slice(0, 3))
        ],
        scoreBreakdown: couponRoute?.scoreBreakdown || fullRoute?.scoreBreakdown
      });
    });
  });

  return Array.from(packages.values()).sort((a, b) => (
    (a.routeGroup === b.routeGroup ? 0 : a.routeGroup === 'stable' ? -1 : 1)
    || a.score - b.score
    || b.hitCount - a.hitCount
  ));
}

export function couponChannelLabel(value: unknown) {
  return {
    inStore: '店内领券',
    orderReturn: '下单返券',
    reviewReturn: '评价返券',
    pointsReturn: '集点/会员',
    targeted: '定向券'
  }[String(value || '')] || '-';
}

export function couponTargetUserLabel(value: unknown) {
  return {
    all: '全部用户',
    newCustomer: '新客',
    highFrequency: '高频用户',
    highAov: '高客单用户',
    lostCustomer: '流失召回',
    specified: '指定人群'
  }[String(value || '')] || '-';
}

export function couponThresholdModeLabel(value: unknown) {
  return {
    lowThresholdOrder: '低门槛成单',
    fullReductionInterleave: '满减错层',
    addOnCritical: '凑单临界',
    highMarginGuide: '高毛利引导',
    retentionRecall: '复购召回'
  }[String(value || '')] || '-';
}

export function normalizeActivityCouponRecommendationMode(value: unknown, fallback: ActivityCouponRecommendationMode = 'balanced'): ActivityCouponRecommendationMode {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
    ? value
    : fallback;
}

function emptyActivityScanComboPools(): ActivityScanComboPools {
  return {
    mainCombos: [],
    addOnCombos: [],
    mainComboCountByPlatform: {},
    addOnComboCountByPlatform: {}
  };
}

function activityMoneyToCents(value: unknown) {
  return Math.max(0, Math.round((Number(value) || 0) * 100));
}

export function normalizeActivityScanComboPools(value: unknown): ActivityScanComboPools {
  const source = value as Partial<ActivityScanComboPools> | undefined;
  if (!source || typeof source !== 'object') return emptyActivityScanComboPools();
  const normalizeRows = (rows: unknown): ActivityScanComboPoolRow[] => Array.isArray(rows)
    ? rows
      .filter(row => row && typeof row === 'object')
      .map(row => {
        const sourceRow = row as Partial<ActivityScanComboPoolRow>;
        const platform: Platform = sourceRow.platform === 'eleme' ? 'eleme' : 'meituan';
        const originalTotal = roundMoney(sourceRow.originalTotal);
        return {
          key: String(sourceRow.key || ''),
          platform,
          qtys: Array.isArray(sourceRow.qtys) ? sourceRow.qtys.map(value => Math.max(0, Math.floor(Number(value) || 0))) : [],
          priceCents: Math.max(0, Math.floor(Number(sourceRow.priceCents) || activityMoneyToCents(originalTotal))),
          costTotal: roundMoney(sourceRow.costTotal),
          totalQty: Math.max(0, Math.floor(Number(sourceRow.totalQty) || 0)),
          originalTotal,
          stapleCount: Math.max(0, Math.floor(Number(sourceRow.stapleCount) || 0))
        };
      })
      .filter(row => row.key)
    : [];
  const mainCombos = normalizeRows(source.mainCombos);
  const addOnCombos = normalizeRows(source.addOnCombos);
  return {
    mainCombos,
    addOnCombos,
    mainComboCountByPlatform: source.mainComboCountByPlatform || {},
    addOnComboCountByPlatform: source.addOnComboCountByPlatform || {}
  };
}

export function activityFullReductionLogTypeColor(type: ActivityFullReductionLogSegmentType) {
  if (type === '参数') return 'blue';
  if (type === '生成') return 'green';
  if (type === '拒绝') return 'orange';
  if (type === '退出') return 'red';
  return 'default';
}

export function activityFullReductionLogParts(diagnosis: string | null | undefined) {
  const text = String(diagnosis || '').trim();
  const markers = ['满减生成日志：', '满减候选诊断：'];
  const markerMatch = markers
    .map(marker => ({ marker, index: text.indexOf(marker) }))
    .filter(item => item.index >= 0)
    .sort((a, b) => a.index - b.index)[0];
  if (!markerMatch) {
    return {
      summary: text,
      entries: [] as string[],
      segments: [] as ActivityFullReductionLogSegment[]
    };
  }

  const summary = text
    .slice(0, markerMatch.index)
    .replace(/[；;，,\s]+$/g, '')
    .trim();
  const entries = text
    .slice(markerMatch.index + markerMatch.marker.length)
    .split(/[；;]\s*/)
    .map(item => item.trim())
    .filter(Boolean);
  const segments: ActivityFullReductionLogSegment[] = [];
  entries.forEach((entry, index) => {
    const previous = segments[segments.length - 1];
    if (entry.startsWith('窗口原价桶') && previous && (previous.type === '生成' || previous.type === '拒绝')) {
      previous.detail.push(entry);
      return;
    }
    segments.push({
      key: `full-reduction-log-${index}`,
      type: activityFullReductionLogType(entry),
      title: entry,
      detail: []
    });
  });
  return { summary, entries, segments };
}

export function withoutColumnByDataIndex<T>(columns: readonly T[], dataIndex: string) {
  return columns.filter(column => tableColumnDataIndex(column) !== dataIndex);
}

function activityFullReductionLogType(entry: string): ActivityFullReductionLogSegmentType {
  if (entry.startsWith('参数：')) return '参数';
  if (entry.startsWith('生成满')) return '生成';
  if (entry.startsWith('拒绝')) return '拒绝';
  if (entry.startsWith('退出：')) return '退出';
  return '其他';
}

function tableColumnDataIndex(column: unknown) {
  const dataIndex = (column as { dataIndex?: unknown }).dataIndex;
  if (Array.isArray(dataIndex)) return dataIndex.join('.');
  return typeof dataIndex === 'string' || typeof dataIndex === 'number' ? String(dataIndex) : '';
}

function nonNegativeAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}
