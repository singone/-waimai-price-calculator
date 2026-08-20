import { DEFAULT_PAGE_KEY, isPageKey } from '../pageRoutes';
import {
  activityPriceScanRecordKey,
  buildPersistedActivityPriceScanRecord
} from '../components/activityDesign/activityDesignCalculationUtils';
import {
  buildPersistedMeasurementRecord,
  isMeasurementRowInDisplayFilters,
  measurementChunkKey,
  measurementRecordKey,
  normalizeCachedMeasurementRows,
  sortMeasurementRows
} from '../components/results/resultsCalculationUtils';
import { createBrowserDataRepository } from './browserDataRepository';
import type {
  Activities,
  ActivityDesignSettings,
  ActivityDesignObjective as RedesignedActivityDesignObjective,
  ActivityCouponRecommendationMode,
  ActivityCouponRecommendationPolicy,
  ActivityCouponSceneTemplate,
  ActivityObjectiveTemplate,
  ActivityObjectivePayTarget,
  ActivityObjectiveStrategy,
  ActivityOriginalDiscountTier,
  ActivityStrategySettings,
  CalculatorState,
  FeeRule,
  Platform,
  PricingEvaluationRule,
  PricingStrategyTier,
  Product,
  ProductCategory,
  StapleScenario,
  Store
} from '../domain/types';
import {
  ACTIVITY_OBJECTIVE_OPTIONS,
  DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES,
  DEFAULT_ACTIVITY_DESIGN_SETTINGS,
  DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES,
  DEFAULT_ACTIVITY_STRATEGY_SETTINGS,
  activityObjectiveOptionFromTemplate,
  activityObjectiveOptionsFromTemplates,
  defaultActivityCouponRecommendationPolicy,
  defaultActivityObjectivePayTargets,
  defaultActivityObjectiveStrategies,
  type ActivityObjectiveOption
} from '../config/activityStrategy';
import { STAPLE_SCENARIOS } from '../config/calculation';
import { PRODUCT_CATEGORIES } from '../config/products';

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', '是', '有', '启用', '单点不送', '不可单点', '上架', '售卖中', '在售']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', '否', '无', '不', '停用', '关闭', '下架', '暂停售卖']);

const DEFAULT_PRICING_EVALUATION_RULE: PricingEvaluationRule = {
  fallbackTargetProfitRate: 25,
  addOnTargetProfitRate: 45,
  riceBallTargetProfitRate: 32,
  setMealTargetProfitRate: 36,
  singleStapleTargetProfitRate: 32,
  doubleStapleTargetProfitRate: 36,
  multiStapleTargetProfitRate: 38
};

const DEFAULT_PRICING_STRATEGY: Record<StapleScenario, PricingStrategyTier[]> = {
  single: [
    { enabled: true, payMin: 0, payMax: 20, payRateMin: 0, payRateTarget: 0, netRateMin: 0, netRateTarget: 0 },
    { enabled: true, payMin: 20, payMax: 30, payRateMin: 12, payRateTarget: 18, netRateMin: 22, netRateTarget: 30 },
    { enabled: true, payMin: 30, payMax: 45, payRateMin: 9, payRateTarget: 14, netRateMin: 18, netRateTarget: 25 },
    { enabled: true, payMin: 45, payMax: 9999, payRateMin: 7, payRateTarget: 11, netRateMin: 15, netRateTarget: 22 }
  ],
  double: [
    { enabled: true, payMin: 0, payMax: 40, payRateMin: 0, payRateTarget: 0, netRateMin: 0, netRateTarget: 0 },
    { enabled: true, payMin: 40, payMax: 60, payRateMin: 10, payRateTarget: 15, netRateMin: 20, netRateTarget: 28 },
    { enabled: true, payMin: 60, payMax: 90, payRateMin: 8, payRateTarget: 13, netRateMin: 17, netRateTarget: 24 },
    { enabled: true, payMin: 90, payMax: 9999, payRateMin: 6, payRateTarget: 10, netRateMin: 14, netRateTarget: 20 }
  ],
  multi: [
    { enabled: true, payMin: 0, payMax: 60, payRateMin: 0, payRateTarget: 0, netRateMin: 0, netRateTarget: 0 },
    { enabled: true, payMin: 60, payMax: 90, payRateMin: 9, payRateTarget: 14, netRateMin: 18, netRateTarget: 26 },
    { enabled: true, payMin: 90, payMax: 130, payRateMin: 7, payRateTarget: 12, netRateMin: 16, netRateTarget: 23 },
    { enabled: true, payMin: 130, payMax: 9999, payRateMin: 5, payRateTarget: 9, netRateMin: 13, netRateTarget: 19 }
  ]
};

function makeDefaultActivities(prefix: string): Activities {
  return {
    fullReductions: [
      { enabled: true, threshold: 25, amount: 3 },
      { enabled: true, threshold: 35, amount: 6 }
    ],
    coupons: [
      { enabled: true, name: `${prefix}店铺券`, threshold: 20, amount: 3 }
    ],
    redAddOns: [
      { enabled: true, threshold: 20, amount: 1 }
    ],
    discountActivities: [
      { enabled: true, name: `${prefix}饭团折扣`, productNames: '饭团', discountRate: 8.8, itemLimit: '' }
    ]
  };
}

export const defaultState: CalculatorState = {
  selectedStoreId: 'store-1',
  activePage: 'store',
  riskSafetyMargin: 0,
  activityStrategySettings: DEFAULT_ACTIVITY_STRATEGY_SETTINGS,
  platformRules: {
    commissionRate: 4.8,
    minCommission: 0.96,
    baseDeliveryFee: 2.7,
    extraDeliveryFee: 0.05,
    midPriceRate: 0.13,
    highPriceRate: 0.15,
    freightWithin3: 2.7,
    freightWithin5: 4,
    freightAbove5: 5,
    profitTargets: [
      { enabled: true, payMin: 10, payMax: 15, rateMin: 18, rateMax: 26 },
      { enabled: true, payMin: 15, payMax: 25, rateMin: 22, rateMax: 32 },
      { enabled: true, payMin: 25, payMax: 40, rateMin: 28, rateMax: 40 }
    ],
    pricingStrategy: DEFAULT_PRICING_STRATEGY,
    redTiers: {
      meituan: [
        { enabled: true, threshold: 15, min: 2, max: 4 },
        { enabled: true, threshold: 20, min: 3, max: 6 },
        { enabled: true, threshold: 30, min: 5, max: 8 }
      ],
      eleme: [
        { enabled: true, threshold: 15, min: 1.5, max: 3.5 },
        { enabled: true, threshold: 20, min: 2, max: 5 },
        { enabled: true, threshold: 30, min: 4, max: 7 }
      ]
    },
    pricingEvaluation: DEFAULT_PRICING_EVALUATION_RULE
  },
  stores: [
    {
      id: 'store-1',
      name: '示例门店',
      startPrice: 20,
      calculationTotalMin: 0,
      calculationTotalMax: 80,
      stapleCountMin: 0,
      stapleCountMax: '',
      deliveryDistance: 3,
      orderTime: '12:00',
      maxItems: 4,
      maxQtyPerSku: 2,
      maxCoupons: 1,
      maxDiscountItems: '',
      maxChecks: 250000,
      usePlatformFee: true,
      customFeeRule: null,
      usePlatformTargets: true,
      profitTargets: [],
      products: [
        { id: 'p1', name: '海鸭蛋和风饭团', price: 15, cost: 6, packageFee: 0, meituanPrice: '', elemePrice: '', meituanPackageFee: '', elemePackageFee: '', meituanEnabled: true, elemeEnabled: true, category: 'staple', stapleServingCount: 1, nonStandalone: false },
        { id: 'p2', name: '照烧鸡排饭团', price: 16, cost: 6.5, packageFee: 0, meituanPrice: '', elemePrice: '', meituanPackageFee: '', elemePackageFee: '', meituanEnabled: true, elemeEnabled: true, category: 'staple', stapleServingCount: 1, nonStandalone: false },
        { id: 'p3', name: '九州金枪鱼饭团', price: 16, cost: 6.5, packageFee: 0, meituanPrice: '', elemePrice: '', meituanPackageFee: '', elemePackageFee: '', meituanEnabled: true, elemeEnabled: true, category: 'staple', stapleServingCount: 1, nonStandalone: false },
        { id: 'p4', name: '酥香肉松饭团', price: 8.9, cost: 3.2, packageFee: 0, meituanPrice: '', elemePrice: '', meituanPackageFee: '', elemePackageFee: '', meituanEnabled: true, elemeEnabled: true, category: 'staple', stapleServingCount: 1, nonStandalone: false },
        { id: 'p5', name: '醇香豆浆', price: 3, cost: 1, packageFee: 0, meituanPrice: '', elemePrice: '', meituanPackageFee: '', elemePackageFee: '', meituanEnabled: true, elemeEnabled: true, category: 'snackDrink', stapleServingCount: 0, nonStandalone: true },
        { id: 'p6', name: '茶叶蛋', price: 2, cost: 0.8, packageFee: 0, meituanPrice: '', elemePrice: '', meituanPackageFee: '', elemePackageFee: '', meituanEnabled: true, elemeEnabled: true, category: 'snackDrink', stapleServingCount: 0, nonStandalone: true }
      ],
      activities: {
        meituan: makeDefaultActivities('美团'),
        eleme: makeDefaultActivities('饿了么')
      },
      activityDesignSettings: DEFAULT_ACTIVITY_DESIGN_SETTINGS
    }
  ]
};

export function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toNumber(value: unknown, fallback = 0) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function toMoneyNumber(value: unknown, fallback = Number.NaN) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const text = String(value ?? '').trim().replace(/[¥￥元]/g, '').replace(/,/g, '');
  if (text === '') return fallback;
  return toNumber(text, fallback);
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '') return fallback;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return fallback;
}

function normalizeProductCategory(value: unknown, name = '', nonStandalone = false): ProductCategory {
  const text = String(value ?? '').trim();
  const lowered = text.toLowerCase();
  const aliases: Record<string, ProductCategory> = {
    staple: 'staple',
    riceball: 'staple',
    rice_ball: 'staple',
    主食: 'staple',
    饭团主食: 'staple',
    饭团: 'staple',
    snackdrink: 'snackDrink',
    snack_drink: 'snackDrink',
    小吃饮料: 'snackDrink',
    小吃: 'snackDrink',
    饮料: 'snackDrink',
    add_on: 'addOn',
    addon: 'addOn',
    addOn: 'addOn',
    加料: 'addOn',
    加购: 'addOn',
    set_meal: 'setMeal',
    setmeal: 'setMeal',
    套餐: 'setMeal',
    组合: 'setMeal',
    other: 'other',
    其他: 'other'
  };
  if (PRODUCT_CATEGORIES.includes(lowered as ProductCategory)) return lowered as ProductCategory;
  if (aliases[text]) return aliases[text];
  if (aliases[lowered]) return aliases[lowered];
  return inferProductCategory(name, nonStandalone);
}

function inferProductCategory(name: string, nonStandalone = false): ProductCategory {
  const text = String(name || '').toLowerCase();
  if (/套餐|套饭|组合|单人餐|双人|两份|多人餐|combo|set|\+|＋/.test(text)) return 'setMeal';
  if (/饭团|主食/.test(text)) return 'staple';
  if (/加料|加购|小料|配菜|蘸料|调料/.test(text)) return 'addOn';
  if (/饮|奶|茶|豆浆|可乐|雪碧|水|果汁|咖啡|小吃|点心|茶叶蛋|蛋|甜品|布丁/.test(text)) return 'snackDrink';
  return nonStandalone ? 'addOn' : 'other';
}

function inferStapleServingCount(name: string, category: ProductCategory) {
  if (category === 'staple') return 1;
  if (category !== 'setMeal') return 0;
  const text = String(name || '').toLowerCase();
  if (/四人|四份/.test(text)) return 4;
  if (/三人|三份|多人/.test(text)) return 3;
  if (/双人|两份|二人|2人|2份/.test(text)) return 2;
  return 1;
}

function normalizeStapleServingCount(value: unknown, name: string, category: ProductCategory) {
  const text = String(value ?? '').trim();
  if (text === '') return inferStapleServingCount(name, category);
  return Math.max(0, Math.floor(toNumber(text, inferStapleServingCount(name, category))));
}

function money(value: unknown) {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function createScenarioRecord<T>(factory: () => T): Record<StapleScenario, T> {
  return {
    single: factory(),
    double: factory(),
    multi: factory()
  };
}

function stableJsonStringify(value: unknown): string {
  if (value === undefined || value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(stableJsonStringify).join(',')}]`;
  if (typeof value === 'object') {
    const source = value as Record<string, unknown>;
    return `{${Object.keys(source)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJsonStringify(source[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * 读取门店级活动设计参数。
 *
 * @param store 当前门店。
 * @returns 已兼容旧门店数据的活动设计参数。
 */
export function activityDesignSettingsFromStore(store: Pick<Store, 'activityDesignSettings'>): ActivityDesignSettings {
  return normalizeActivityDesignSettings(store.activityDesignSettings);
}

export function effectiveActivityDesignSettingsFromStore(
  store: Pick<Store, 'activityDesignSettings'>,
  strategySettings: ActivityStrategySettings
): ActivityDesignSettings {
  const base = activityDesignSettingsFromStore(store);
  const rawStoreSettings = (store.activityDesignSettings || {}) as Partial<ActivityDesignSettings>;
  const normalizedStrategy = normalizeActivityStrategySettings(strategySettings);
  const useDefaultObjectiveStrategies = useDefaultObjectiveStrategiesFromRaw(rawStoreSettings);
  const rawObjectiveTemplateOverrides = !useDefaultObjectiveStrategies && Array.isArray(rawStoreSettings.objectiveTemplates)
    ? rawStoreSettings.objectiveTemplates as Partial<ActivityObjectiveTemplate>[]
    : [];
  const rawObjectiveTemplateOverrideByKey = new Map(rawObjectiveTemplateOverrides.map(template => [String(template.key || ''), template]));
  const mergedObjectiveTemplates = (normalizedStrategy.objectiveTemplates || [])
    .map(template => {
      const override = rawObjectiveTemplateOverrideByKey.get(template.key);
      return override ? normalizeActivityObjectiveTemplate({ ...template, ...override, key: template.key }, template) : template;
    });
  for (const override of rawObjectiveTemplateOverrides) {
    const key = String(override.key || '');
    if (!key || mergedObjectiveTemplates.some(template => template.key === key)) continue;
    mergedObjectiveTemplates.push(normalizeActivityObjectiveTemplate(override, {
      key,
      enabled: true,
      name: String(override.name || key),
      group: override.group === 'stable' ? 'stable' : 'marketing',
      targetPayLabel: '',
      targetPayMin: 0,
      targetPayMax: 25,
      description: ''
    }));
  }
  const objectiveOptions = activityObjectiveOptionsFromTemplates(mergedObjectiveTemplates);
  const rawStrategyOverrides = !useDefaultObjectiveStrategies
    ? (rawStoreSettings.objectiveStrategies || rawStoreSettings.objectivePayTargets) as Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined
    : undefined;
  const mergedStrategies = normalizeActivityObjectiveStrategies({
    ...normalizedStrategy.objectiveStrategies,
    ...(rawStrategyOverrides || {})
  }, base.targetProfitRate, objectiveOptions);
  const baseOriginalDiscountRate = useDefaultObjectiveStrategies
    ? normalizedStrategy.baseOriginalDiscountRate
    : Math.max(0, Math.min(95, toMoneyNumber(rawStoreSettings.baseOriginalDiscountRate, normalizedStrategy.baseOriginalDiscountRate)));
  return normalizeActivityDesignSettings({
    ...base,
    baseOriginalDiscountRate,
    useDefaultObjectiveStrategies,
    objectiveStrategies: mergedStrategies,
    objectiveTemplates: mergedObjectiveTemplates,
    couponSceneTemplates: normalizedStrategy.couponSceneTemplates,
    platformCouponSceneKeys: normalizedStrategy.platformCouponSceneKeys
  });
}

function normalizeOptionalPrice(value: unknown): number | '' {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  const n = toMoneyNumber(text, Number.NaN);
  return n > 0 ? n : '';
}

function normalizeOptionalMoney(value: unknown, min: number, fallback: number): number | '' {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  return Math.max(min, toMoneyNumber(text, fallback));
}

function normalizeOptionalInteger(value: unknown, min: number, fallback: number): number | '' {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  return Math.max(min, Math.floor(toNumber(text, fallback)));
}

export function currentStoreFrom(state: CalculatorState) {
  return state.stores.find(store => store.id === state.selectedStoreId) || state.stores[0];
}

export function effectiveFeeRule(state: CalculatorState, store = currentStoreFrom(state)): FeeRule {
  return store.usePlatformFee || !store.customFeeRule
    ? deepClone(state.platformRules)
    : { ...deepClone(state.platformRules), ...deepClone(store.customFeeRule) };
}

function normalizeProduct(product: Partial<Product>): Product {
  const nonStandalone = parseBoolean(product.nonStandalone);
  const name = String(product.name || '').trim() || '未命名商品';
  const category = normalizeProductCategory(product.category, name, nonStandalone);
  return {
    id: String(product.id || uid('p')),
    name,
    price: Math.max(0, toMoneyNumber(product.price, 0)),
    cost: Math.max(0, toMoneyNumber(product.cost, 0)),
    packageFee: Math.max(0, toMoneyNumber(product.packageFee, 0)),
    meituanPrice: normalizeOptionalPrice(product.meituanPrice),
    elemePrice: normalizeOptionalPrice(product.elemePrice),
    meituanPackageFee: normalizeOptionalMoney(product.meituanPackageFee, 0, 0),
    elemePackageFee: normalizeOptionalMoney(product.elemePackageFee, 0, 0),
    meituanEnabled: parseBoolean(product.meituanEnabled, true),
    elemeEnabled: parseBoolean(product.elemeEnabled, true),
    category,
    stapleServingCount: normalizeStapleServingCount(product.stapleServingCount, name, category),
    nonStandalone
  };
}

export function normalizeProductList(value: unknown): Product[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value
    .map(row => normalizeProduct(row as Partial<Product>))
    .filter(product => product.name)
    .map(product => {
      const id = String(product.id || '').trim() || uid('p');
      if (!seenIds.has(id)) {
        seenIds.add(id);
        return { ...product, id };
      }
      const nextId = uid('p');
      seenIds.add(nextId);
      return { ...product, id: nextId };
    });
}

function normalizeActivities(data: Partial<Activities> | undefined, platformName: string): Activities {
  const fallback = makeDefaultActivities(platformName);
  return {
    fullReductions: Array.isArray(data?.fullReductions) ? data.fullReductions.map(row => ({
      enabled: parseBoolean(row.enabled, true),
      threshold: toMoneyNumber(row.threshold, 0),
      amount: toMoneyNumber(row.amount, 0)
    })) : fallback.fullReductions,
    coupons: Array.isArray(data?.coupons) ? data.coupons.map(row => ({
      enabled: parseBoolean(row.enabled, true),
      name: String(row.name || '订单优惠券'),
      threshold: toMoneyNumber(row.threshold, 0),
      amount: toMoneyNumber(row.amount, 0),
      sceneKey: row.sceneKey ? String(row.sceneKey) : undefined,
      sceneName: row.sceneName ? String(row.sceneName) : undefined,
      channel: row.channel,
      targetUser: row.targetUser,
      thresholdMode: row.thresholdMode,
      usageSuggestion: row.usageSuggestion ? String(row.usageSuggestion) : undefined
    })) : fallback.coupons,
    redAddOns: Array.isArray(data?.redAddOns) ? data.redAddOns.map(row => ({
      enabled: parseBoolean(row.enabled, true),
      threshold: toMoneyNumber(row.threshold, 0),
      amount: toMoneyNumber(row.amount, 0)
    })) : fallback.redAddOns,
    discountActivities: Array.isArray(data?.discountActivities) ? data.discountActivities.map(row => ({
      enabled: parseBoolean(row.enabled, true),
      name: String(row.name || '商品折扣'),
      productNames: String(row.productNames || ''),
      discountRate: toNumber(row.discountRate, 8.8),
      itemLimit: String(row.itemLimit ?? '').trim() === '' ? '' : Math.max(0, Math.floor(toNumber(row.itemLimit, 0)))
    })) : fallback.discountActivities
  };
}

function normalizePricingEvaluationRule(rule: Partial<PricingEvaluationRule> | undefined): PricingEvaluationRule {
  const fallback = DEFAULT_PRICING_EVALUATION_RULE;
  return {
    fallbackTargetProfitRate: Math.max(0, toMoneyNumber(rule?.fallbackTargetProfitRate, fallback.fallbackTargetProfitRate)),
    addOnTargetProfitRate: Math.max(0, toMoneyNumber(rule?.addOnTargetProfitRate, fallback.addOnTargetProfitRate)),
    riceBallTargetProfitRate: Math.max(0, toMoneyNumber(rule?.riceBallTargetProfitRate, fallback.riceBallTargetProfitRate)),
    setMealTargetProfitRate: Math.max(0, toMoneyNumber(rule?.setMealTargetProfitRate, fallback.setMealTargetProfitRate)),
    singleStapleTargetProfitRate: Math.max(0, toMoneyNumber(rule?.singleStapleTargetProfitRate, fallback.singleStapleTargetProfitRate)),
    doubleStapleTargetProfitRate: Math.max(0, toMoneyNumber(rule?.doubleStapleTargetProfitRate, fallback.doubleStapleTargetProfitRate)),
    multiStapleTargetProfitRate: Math.max(0, toMoneyNumber(rule?.multiStapleTargetProfitRate, fallback.multiStapleTargetProfitRate))
  };
}

export function normalizeActivityObjectiveTemplate(
  value: Partial<ActivityObjectiveTemplate> | undefined,
  fallback: ActivityObjectiveTemplate
): ActivityObjectiveTemplate {
  const rawKey = String(value?.key || fallback.key || '').trim();
  const key = rawKey || fallback.key;
  const targetPayMin = Math.max(0, toMoneyNumber(value?.targetPayMin, fallback.targetPayMin));
  const targetPayMax = Math.max(targetPayMin + 1, toMoneyNumber(value?.targetPayMax, fallback.targetPayMax));
  return {
    key,
    enabled: value?.enabled !== false,
    name: String(value?.name || fallback.name || key),
    group: value?.group === 'stable' ? 'stable' : value?.group === 'marketing' ? 'marketing' : fallback.group,
    targetPayLabel: String(value?.targetPayLabel || fallback.targetPayLabel || `${money(targetPayMin)}-${money(targetPayMax)}`),
    targetPayMin,
    targetPayMax,
    description: String(value?.description || fallback.description || ''),
    baseObjective: value?.baseObjective ? String(value.baseObjective) : fallback.baseObjective
  };
}

export function normalizeActivityObjectiveTemplates(value: unknown): ActivityObjectiveTemplate[] {
  const rows = Array.isArray(value) ? value as Partial<ActivityObjectiveTemplate>[] : [];
  const fallbackByKey = new Map(DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES.map(row => [row.key, row]));
  const normalized = rows
    .map(row => {
      const key = String(row?.key || '').trim();
      const fallback = fallbackByKey.get(key) || {
        key: key || uid('objective'),
        enabled: true,
        name: row?.name || '新经营目标',
        group: row?.group === 'stable' ? 'stable' : 'marketing',
        targetPayLabel: '',
        targetPayMin: 0,
        targetPayMax: 25,
        description: ''
      } satisfies ActivityObjectiveTemplate;
      return normalizeActivityObjectiveTemplate(row, { ...fallback, key: key || fallback.key });
    })
    .filter((row, index, list) => row.key && list.findIndex(item => item.key === row.key) === index);
  for (const fallback of DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES) {
    if (!normalized.some(row => row.key === fallback.key)) normalized.push(normalizeActivityObjectiveTemplate(undefined, fallback));
  }
  return normalized;
}

export function activityObjectiveOptionsFromSettings(settings: Pick<ActivityStrategySettings | ActivityDesignSettings, 'objectiveTemplates' | 'objectiveStrategies'> | undefined) {
  const templates = normalizeActivityObjectiveTemplates(settings?.objectiveTemplates);
  const strategyKeys = Object.keys(settings?.objectiveStrategies || {});
  for (const key of strategyKeys) {
    if (templates.some(template => template.key === key)) continue;
    templates.push(normalizeActivityObjectiveTemplate({ key, name: key, enabled: true }, {
      key,
      enabled: true,
      name: key,
      group: 'marketing',
      targetPayLabel: '',
      targetPayMin: 0,
      targetPayMax: 25,
      description: ''
    }));
  }
  return activityObjectiveOptionsFromTemplates(templates);
}

/**
 * 归一化旧版支付目标范围。
 *
 * @param value 缓存或导入配置中的目标支付范围。
 * @returns 每个经营目标可用于旧数据兼容的支付范围。
 */
function normalizeActivityObjectivePayTargets(
  value: Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectivePayTarget>>> | undefined,
  baseTargetProfitRate = DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate,
  objectiveOptions: ActivityObjectiveOption[] = ACTIVITY_OBJECTIVE_OPTIONS
): Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget> {
  const fallbacks = defaultActivityObjectivePayTargets(baseTargetProfitRate, objectiveOptions);
  return objectiveOptions.reduce<Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget>>((targets, option) => {
    const fallback = fallbacks[option.value];
    const raw = value?.[option.value];
    const payMin = Math.max(0, toMoneyNumber(raw?.payMin, fallback.payMin));
    const rawPayMax = toMoneyNumber(raw?.payMax, fallback.payMax);
    const targetPayProfitRate = Math.max(-50, Math.min(95, toMoneyNumber(raw?.targetPayProfitRate, fallback.targetPayProfitRate)));
    targets[option.value] = {
      payMin,
      payMax: rawPayMax > payMin + 1e-9 ? rawPayMax : fallback.payMax,
      targetPayProfitRate,
      minPayProfitRate: Math.max(-80, Math.min(targetPayProfitRate, toMoneyNumber(raw?.minPayProfitRate, fallback.minPayProfitRate))),
      minNetProfitRate: Math.max(-80, Math.min(95, toMoneyNumber(raw?.minNetProfitRate, fallback.minNetProfitRate))),
      maxLossShare: Math.max(0, Math.min(100, toMoneyNumber(raw?.maxLossShare, fallback.maxLossShare)))
    };
    return targets;
  }, {} as Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget>);
}

function normalizeActivityCouponRecommendationMode(value: unknown, fallback: ActivityCouponRecommendationMode = 'balanced'): ActivityCouponRecommendationMode {
  return value === 'conservative' || value === 'balanced' || value === 'aggressive'
    ? value
    : fallback;
}

function normalizeActivityCouponRepresentativeMode(value: unknown, fallback: ActivityCouponRecommendationPolicy['representativeMode']): ActivityCouponRecommendationPolicy['representativeMode'] {
  return value === 'lowestThreshold' || value === 'balanced' || value === 'highestThreshold'
    ? value
    : fallback;
}

function normalizeActivityCouponRecommendationPolicy(
  value: Partial<ActivityCouponRecommendationPolicy> | undefined,
  fallback: ActivityCouponRecommendationPolicy = defaultActivityCouponRecommendationPolicy('balanced')
): ActivityCouponRecommendationPolicy {
  const mode = normalizeActivityCouponRecommendationMode(value?.mode, fallback.mode);
  const modeFallback = defaultActivityCouponRecommendationPolicy(mode);
  return {
    mode,
    amountStep: Math.max(0.01, toMoneyNumber(value?.amountStep, fallback.amountStep || modeFallback.amountStep)),
    minCouponAmount: Math.max(0, toMoneyNumber(value?.minCouponAmount, fallback.minCouponAmount || modeFallback.minCouponAmount)),
    nearThresholdGap: Math.max(0, toMoneyNumber(value?.nearThresholdGap, fallback.nearThresholdGap || modeFallback.nearThresholdGap)),
    farThresholdGap: Math.max(0, toMoneyNumber(value?.farThresholdGap, fallback.farThresholdGap || modeFallback.farThresholdGap)),
    nearAmountMergeTolerance: Math.max(0, toMoneyNumber(value?.nearAmountMergeTolerance, fallback.nearAmountMergeTolerance || modeFallback.nearAmountMergeTolerance)),
    farAmountSkipTolerance: Math.max(0, toMoneyNumber(value?.farAmountSkipTolerance, fallback.farAmountSkipTolerance || modeFallback.farAmountSkipTolerance)),
    maxOverBucketSpace: Math.max(0, toMoneyNumber(value?.maxOverBucketSpace, fallback.maxOverBucketSpace || modeFallback.maxOverBucketSpace)),
    representativeMode: normalizeActivityCouponRepresentativeMode(value?.representativeMode, fallback.representativeMode || modeFallback.representativeMode)
  };
}

function normalizeActivityCouponSceneTemplate(row: Partial<ActivityCouponSceneTemplate> | undefined, fallback: ActivityCouponSceneTemplate): ActivityCouponSceneTemplate {
  const thresholdMin = Math.max(0, toMoneyNumber(row?.thresholdMin, fallback.thresholdMin));
  const amountMin = Math.max(0, toMoneyNumber(row?.amountMin, fallback.amountMin));
  const couponIndexRatioMin = Math.max(0, Math.min(1, toNumber(row?.couponIndexRatioMin, fallback.couponIndexRatioMin)));
  const objectiveKeys = Array.isArray(row?.objectiveKeys)
    ? row.objectiveKeys.map(key => String(key || '')).filter(Boolean)
    : [];
  const legacyObjective = (row as { objective?: unknown } | undefined)?.objective;
  return {
    key: String(row?.key || fallback.key),
    enabled: row?.enabled !== false,
    name: String(row?.name || fallback.name),
    priority: Math.floor(toNumber(row?.priority, fallback.priority)),
    platforms: Array.isArray(row?.platforms)
      ? row.platforms.filter((item): item is Platform => item === 'meituan' || item === 'eleme')
      : fallback.platforms,
    channel: row?.channel === 'inStore' || row?.channel === 'orderReturn' || row?.channel === 'reviewReturn' || row?.channel === 'pointsReturn' || row?.channel === 'targeted' ? row.channel : fallback.channel,
    targetUser: row?.targetUser === 'all' || row?.targetUser === 'newCustomer' || row?.targetUser === 'highFrequency' || row?.targetUser === 'highAov' || row?.targetUser === 'lostCustomer' || row?.targetUser === 'specified' ? row.targetUser : fallback.targetUser,
    objectiveKeys: objectiveKeys.length ? objectiveKeys : legacyObjective ? [String(legacyObjective)] : fallback.objectiveKeys.slice(),
    thresholdMode: row?.thresholdMode === 'lowThresholdOrder' || row?.thresholdMode === 'fullReductionInterleave' || row?.thresholdMode === 'addOnCritical' || row?.thresholdMode === 'highMarginGuide' || row?.thresholdMode === 'retentionRecall' ? row.thresholdMode : fallback.thresholdMode,
    thresholdMin,
    thresholdMax: Math.max(thresholdMin, toMoneyNumber(row?.thresholdMax, fallback.thresholdMax)),
    amountMin,
    amountMax: Math.max(amountMin, toMoneyNumber(row?.amountMax, fallback.amountMax)),
    couponIndexRatioMin,
    couponIndexRatioMax: Math.max(couponIndexRatioMin, Math.min(1, toNumber(row?.couponIndexRatioMax, fallback.couponIndexRatioMax))),
    requireNearFullReduction: parseBoolean(row?.requireNearFullReduction, fallback.requireNearFullReduction),
    maxFullReductionDistance: Math.max(0, toMoneyNumber(row?.maxFullReductionDistance, fallback.maxFullReductionDistance)),
    requireNearRedTier: parseBoolean(row?.requireNearRedTier, fallback.requireNearRedTier),
    maxRedTierDistance: Math.max(0, toMoneyNumber(row?.maxRedTierDistance, fallback.maxRedTierDistance)),
    addOnMin: Math.max(0, toMoneyNumber(row?.addOnMin, fallback.addOnMin)),
    addOnMax: Math.max(0, toMoneyNumber(row?.addOnMax, fallback.addOnMax)),
    requireBoundarySafe: parseBoolean(row?.requireBoundarySafe, fallback.requireBoundarySafe),
    maxOverBucketSpace: Math.max(0, toMoneyNumber(row?.maxOverBucketSpace, fallback.maxOverBucketSpace)),
    couponBudgetShare: Math.max(0, Math.min(100, toMoneyNumber(row?.couponBudgetShare, fallback.couponBudgetShare))),
    maxCouponCount: Math.max(1, Math.floor(toNumber(row?.maxCouponCount, fallback.maxCouponCount))),
    maxCouponAmount: Math.max(0, toMoneyNumber(row?.maxCouponAmount, fallback.maxCouponAmount))
  };
}

function normalizeActivityCouponSceneTemplates(value: unknown): ActivityCouponSceneTemplate[] {
  const fallbackByKey = new Map(DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(template => [template.key, template]));
  const rows = Array.isArray(value) ? value as Partial<ActivityCouponSceneTemplate>[] : DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES;
  const normalized = rows
    .map(row => normalizeActivityCouponSceneTemplate(row, fallbackByKey.get(String(row?.key || '')) || DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES[0]))
    .filter((row, index, list) => row.key && list.findIndex(item => item.key === row.key) === index)
    .sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
  return normalized.length ? normalized : DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(template => normalizeActivityCouponSceneTemplate(template, template));
}

function normalizePlatformCouponSceneKeys(value: Partial<Record<Platform, string[]>> | undefined, templates: ActivityCouponSceneTemplate[]) {
  const templateKeys = templates.map(template => template.key);
  const normalizeKeys = (keys: unknown) => {
    const rows = Array.isArray(keys) ? keys.map(key => String(key || '')).filter(Boolean) : templateKeys;
    const allowed = rows.filter((key, index, list) => templateKeys.includes(key) && list.indexOf(key) === index);
    return allowed.length ? allowed : templateKeys;
  };
  return {
    meituan: normalizeKeys(value?.meituan),
    eleme: normalizeKeys(value?.eleme)
  };
}

function normalizeActivityFullAmountBasis(value: unknown, fallback: ActivityObjectiveStrategy['fullAmountBasis']): ActivityObjectiveStrategy['fullAmountBasis'] {
  if (value === 'average' || value === 'p75' || value === 'min' || value === 'max') return value;
  if (value === 'weightedAverage') return 'average';
  if (value === 'weightedP75') return 'p75';
  if (value === 'weightedMin') return 'min';
  if (value === 'weightedMax') return 'max';
  return fallback;
}

function normalizeActivityOriginalDiscountTiers(value: unknown, fallback: ActivityOriginalDiscountTier[]) {
  const hasExplicitRows = Array.isArray(value);
  const rows = Array.isArray(value) ? value as Partial<ActivityOriginalDiscountTier>[] : [];
  const normalized = rows
    .map(row => {
      const originalMin = Math.max(0, toMoneyNumber(row?.originalMin, 0));
      const rawMax = toMoneyNumber(row?.originalMax, originalMin + 1);
      return {
        originalMin,
        originalMax: Math.max(originalMin + 1, rawMax),
        discountRate: Math.max(0, Math.min(95, toMoneyNumber(row?.discountRate, 0)))
      };
    })
    .filter((row, index, list) => (
      Number.isFinite(row.originalMin)
      && Number.isFinite(row.originalMax)
      && list.findIndex(item => Math.abs(item.originalMin - row.originalMin) < 1e-9 && Math.abs(item.originalMax - row.originalMax) < 1e-9) === index
    ))
    .sort((a, b) => a.originalMin - b.originalMin || a.originalMax - b.originalMax);
  if (normalized.length) return normalized;
  return hasExplicitRows ? [] : fallback.map(row => ({ ...row }));
}

export function normalizeActivityObjectiveStrategies(
  value: Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined,
  baseTargetProfitRate = DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate,
  objectiveOptions: ActivityObjectiveOption[] = ACTIVITY_OBJECTIVE_OPTIONS
): Record<RedesignedActivityDesignObjective, ActivityObjectiveStrategy> {
  const fallbacks = defaultActivityObjectiveStrategies(baseTargetProfitRate, objectiveOptions);
  const legacyTargets = normalizeActivityObjectivePayTargets(value as Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectivePayTarget>>> | undefined, baseTargetProfitRate, objectiveOptions);
  return objectiveOptions.reduce<Record<RedesignedActivityDesignObjective, ActivityObjectiveStrategy>>((strategies, option) => {
    const fallback = fallbacks[option.value];
    const raw = value?.[option.value];
    const payTarget = legacyTargets[option.value];
    const fallbackMode = normalizeActivityCouponRecommendationMode(fallback.couponRecommendationPolicy?.mode || fallback.couponScoringMode, 'balanced');
    const rawMode = normalizeActivityCouponRecommendationMode(raw?.couponRecommendationPolicy?.mode || raw?.couponScoringMode, fallbackMode);
    const couponRecommendationPolicy = normalizeActivityCouponRecommendationPolicy(
      raw?.couponRecommendationPolicy,
      raw?.couponRecommendationPolicy
        ? { ...defaultActivityCouponRecommendationPolicy(rawMode), ...raw.couponRecommendationPolicy, mode: rawMode }
        : defaultActivityCouponRecommendationPolicy(rawMode)
    );
    strategies[option.value] = {
      ...fallback,
      ...payTarget,
      originalDiscountTiers: normalizeActivityOriginalDiscountTiers(raw?.originalDiscountTiers, fallback.originalDiscountTiers),
      fullDiscountShare: Math.max(0, Math.min(100, toMoneyNumber(raw?.fullDiscountShare, fallback.fullDiscountShare))),
      couponDiscountShare: Math.max(0, Math.min(100, toMoneyNumber(raw?.couponDiscountShare, fallback.couponDiscountShare))),
      reserveDiscountShare: Math.max(0, Math.min(100, toMoneyNumber(raw?.reserveDiscountShare, fallback.reserveDiscountShare))),
      fullThresholdWindow: Math.max(1, toMoneyNumber(raw?.fullThresholdWindow, fallback.fullThresholdWindow)),
      fullThresholdMinGap: Math.max(1, toMoneyNumber(raw?.fullThresholdMinGap, fallback.fullThresholdMinGap)),
      minFullAmountIncrease: Math.max(0, toMoneyNumber(raw?.minFullAmountIncrease, fallback.minFullAmountIncrease)),
      fullAmountBasis: normalizeActivityFullAmountBasis(raw?.fullAmountBasis, fallback.fullAmountBasis),
      maxFullRuleCount: Math.max(1, Math.floor(toNumber(raw?.maxFullRuleCount, fallback.maxFullRuleCount))),
      minFullHitCount: Math.max(0, Math.floor(toNumber(raw?.minFullHitCount, fallback.minFullHitCount))),
      minNetPayFloor: Math.max(0, toMoneyNumber(raw?.minNetPayFloor, fallback.minNetPayFloor)),
      couponRecommendationPolicy,
      couponScoringMode: couponRecommendationPolicy.mode
    };
    return strategies;
  }, {} as Record<RedesignedActivityDesignObjective, ActivityObjectiveStrategy>);
}

export function normalizeActivityStrategySettings(value: Partial<ActivityStrategySettings> | undefined): ActivityStrategySettings {
  const objectiveTemplates = normalizeActivityObjectiveTemplates(value?.objectiveTemplates);
  const objectiveOptions = activityObjectiveOptionsFromTemplates(objectiveTemplates);
  const objectiveStrategies = normalizeActivityObjectiveStrategies(value?.objectiveStrategies, DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate, objectiveOptions);
  const couponSceneTemplates = normalizeActivityCouponSceneTemplates(value?.couponSceneTemplates);
  return {
    baseOriginalDiscountRate: Math.max(0, Math.min(95, toMoneyNumber(value?.baseOriginalDiscountRate, DEFAULT_ACTIVITY_STRATEGY_SETTINGS.baseOriginalDiscountRate))),
    objectiveTemplates,
    objectiveStrategies,
    couponSceneTemplates,
    platformCouponSceneKeys: normalizePlatformCouponSceneKeys(value?.platformCouponSceneKeys, couponSceneTemplates)
  };
}

function hasStoreObjectiveModelOverrides(raw: Partial<ActivityDesignSettings>) {
  const rawStrategies = (raw.objectiveStrategies || raw.objectivePayTargets) as Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined;
  const hasTemplates = Array.isArray(raw.objectiveTemplates);
  if (!hasTemplates && !rawStrategies) return false;

  const defaultTemplates = normalizeActivityObjectiveTemplates(DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES);
  const rawTemplates = normalizeActivityObjectiveTemplates(hasTemplates ? raw.objectiveTemplates : DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES);
  if (stableJsonStringify(rawTemplates) !== stableJsonStringify(defaultTemplates)) return true;
  if (!rawStrategies) return false;

  const defaultOptions = activityObjectiveOptionsFromTemplates(defaultTemplates);
  const defaultStrategies = normalizeActivityObjectiveStrategies(
    DEFAULT_ACTIVITY_STRATEGY_SETTINGS.objectiveStrategies,
    DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate,
    defaultOptions
  );
  const rawNormalizedStrategies = normalizeActivityObjectiveStrategies(
    rawStrategies,
    DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate,
    defaultOptions
  );
  return stableJsonStringify(rawNormalizedStrategies) !== stableJsonStringify(defaultStrategies);
}

function useDefaultObjectiveStrategiesFromRaw(raw: Partial<ActivityDesignSettings>) {
  return raw.useDefaultObjectiveStrategies === undefined
    ? !hasStoreObjectiveModelOverrides(raw)
    : raw.useDefaultObjectiveStrategies !== false;
}

/**
 * 归一化门店级活动设计参数。
 *
 * @param settings 浏览器缓存或导入配置中的活动设计参数。
 * @returns 可直接传给活动设计和测算任务的门店级默认参数。
 */
export function normalizeActivityDesignSettings(settings: Partial<ActivityDesignSettings> | undefined): ActivityDesignSettings {
  const fallback = DEFAULT_ACTIVITY_DESIGN_SETTINGS;
  const raw = settings || {};
  const originalMin = Math.max(0, toMoneyNumber(raw.originalMin, fallback.originalMin));
  const payMin = Math.max(0, toMoneyNumber(raw.payMin, fallback.payMin));
  const targetProfitRate = Math.max(0, toMoneyNumber(raw.targetProfitRate, fallback.targetProfitRate));
  const objectiveTemplates = normalizeActivityObjectiveTemplates(raw.objectiveTemplates || fallback.objectiveTemplates);
  const objectiveOptions = activityObjectiveOptionsFromTemplates(objectiveTemplates);
  const objective = objectiveOptions.some(option => option.value === raw.objective)
    ? String(raw.objective)
    : fallback.objective;
  const designMode = raw.designMode === 'full' || raw.designMode === 'coupon' || raw.designMode === 'stacked' ? raw.designMode : fallback.designMode;
  const couponDesignBasis = raw.couponDesignBasis === 'pay' ? 'pay' : fallback.couponDesignBasis;
  const rawObjectiveStrategies = (raw.objectiveStrategies || raw.objectivePayTargets) as Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined;
  const useDefaultObjectiveStrategies = useDefaultObjectiveStrategiesFromRaw(raw);
  return {
    productNameKeyword: '',
    originalMin,
    originalMax: normalizeOptionalMoney(raw.originalMax, originalMin, Number(fallback.originalMax) || 0),
    payMin,
    payMax: normalizeOptionalMoney(raw.payMax, payMin, Number(fallback.payMax) || 0),
    redAddOnSpace: Math.max(0, toMoneyNumber(raw.redAddOnSpace, fallback.redAddOnSpace)),
    baseOriginalDiscountRate: Math.max(0, Math.min(95, toMoneyNumber(raw.baseOriginalDiscountRate, fallback.baseOriginalDiscountRate ?? 50))),
    stapleMaxCount: Math.max(1, Math.floor(toNumber(raw.stapleMaxCount, fallback.stapleMaxCount || 2))),
    addOnMaxCount: raw.addOnMaxCount === ''
      ? ''
      : Math.max(0, Math.floor(toNumber(raw.addOnMaxCount, Number(fallback.addOnMaxCount) || 3))),
    targetProfitRate,
    couponProfitDrop: Math.max(0, toMoneyNumber(raw.couponProfitDrop, fallback.couponProfitDrop)),
    couponDesignBasis,
    couponDesignThresholdStep: Math.max(1, Math.floor(toNumber(raw.couponDesignThresholdStep, fallback.couponDesignThresholdStep))),
    couponDesignMaxFullAmount: raw.couponDesignMaxFullAmount === '' || (raw.couponDesignMaxFullAmount === undefined && fallback.couponDesignMaxFullAmount === '')
      ? ''
      : Math.max(0, toMoneyNumber(raw.couponDesignMaxFullAmount, fallback.couponDesignMaxFullAmount === '' ? 0 : Number(fallback.couponDesignMaxFullAmount) || 20)),
    couponDesignMaxCouponAmount: raw.couponDesignMaxCouponAmount === ''
      ? ''
      : Math.max(0, toMoneyNumber(raw.couponDesignMaxCouponAmount, Number(fallback.couponDesignMaxCouponAmount) || 20)),
    designMode,
    objective,
    useDefaultObjectiveStrategies,
    objectivePayTargets: normalizeActivityObjectivePayTargets(raw.objectivePayTargets, targetProfitRate, objectiveOptions),
    objectiveStrategies: normalizeActivityObjectiveStrategies(rawObjectiveStrategies, targetProfitRate, objectiveOptions),
    objectiveTemplates,
    couponSceneTemplates: normalizeActivityCouponSceneTemplates(raw.couponSceneTemplates || fallback.couponSceneTemplates),
    platformCouponSceneKeys: normalizePlatformCouponSceneKeys(raw.platformCouponSceneKeys || fallback.platformCouponSceneKeys, normalizeActivityCouponSceneTemplates(raw.couponSceneTemplates || fallback.couponSceneTemplates)),
    minProfitRate: Math.max(0, toMoneyNumber(raw.minProfitRate, fallback.minProfitRate || 0)),
    originalBandSize: Math.max(1, Math.floor(toNumber(raw.originalBandSize, fallback.originalBandSize || 5))),
    payBandSize: Math.max(1, Math.floor(toNumber(raw.payBandSize, fallback.payBandSize || 5)))
  };
}


function normalizePricingStrategyTier(row: Partial<PricingStrategyTier> | undefined, fallback: PricingStrategyTier): PricingStrategyTier {
  const payMin = Math.max(0, toMoneyNumber(row?.payMin, fallback.payMin));
  const payMax = Math.max(payMin, toMoneyNumber(row?.payMax, fallback.payMax));
  const payRateMin = Math.max(0, toMoneyNumber(row?.payRateMin, fallback.payRateMin));
  const payRateTarget = Math.max(payRateMin, toMoneyNumber(row?.payRateTarget, fallback.payRateTarget));
  const netRateMin = Math.max(0, toMoneyNumber(row?.netRateMin, fallback.netRateMin));
  const netRateTarget = Math.max(netRateMin, toMoneyNumber(row?.netRateTarget, fallback.netRateTarget));
  return {
    enabled: parseBoolean(row?.enabled, fallback.enabled),
    payMin,
    payMax,
    payRateMin,
    payRateTarget,
    netRateMin,
    netRateTarget
  };
}

export function normalizePricingStrategy(data: Partial<Record<StapleScenario, Partial<PricingStrategyTier>[]>> | undefined): Record<StapleScenario, PricingStrategyTier[]> {
  const strategy = createScenarioRecord<PricingStrategyTier[]>(() => []);
  STAPLE_SCENARIOS.forEach(scenario => {
    const fallbackRows = DEFAULT_PRICING_STRATEGY[scenario];
    const rows = Array.isArray(data?.[scenario]) && data?.[scenario]?.length ? data[scenario] as Partial<PricingStrategyTier>[] : fallbackRows;
    strategy[scenario] = rows
      .map((row, index) => normalizePricingStrategyTier(row, fallbackRows[Math.min(index, fallbackRows.length - 1)]))
      .filter(row => row.payMax > row.payMin)
      .sort((a, b) => a.payMin - b.payMin || a.payMax - b.payMax);
    if (!strategy[scenario].length) strategy[scenario] = fallbackRows.map(row => normalizePricingStrategyTier(row, row));
  });
  return strategy;
}

export function normalizeState(data: unknown): CalculatorState {
  if (!data || typeof data !== 'object') return deepClone(defaultState);
  const raw = data as Partial<CalculatorState>;
  const base = deepClone(defaultState);
  const activityStrategySettings = normalizeActivityStrategySettings(raw.activityStrategySettings);
  const stores = Array.isArray(raw.stores) && raw.stores.length ? raw.stores : base.stores;
  const normalizedStores = stores.map(store => ({
    ...base.stores[0],
    ...store,
    id: store.id || uid('store'),
    name: String(store.name || '未命名门店'),
    calculationTotalMin: Math.max(0, toMoneyNumber(store.calculationTotalMin, base.stores[0].calculationTotalMin)),
    calculationTotalMax: normalizeOptionalMoney(
      store.calculationTotalMax,
      Math.max(0, toMoneyNumber(store.calculationTotalMin, base.stores[0].calculationTotalMin)),
      Number(base.stores[0].calculationTotalMax) || 80
    ),
    stapleCountMin: Math.max(0, Math.floor(toNumber(store.stapleCountMin, base.stores[0].stapleCountMin))),
    stapleCountMax: normalizeOptionalInteger(
      store.stapleCountMax,
      Math.max(0, Math.floor(toNumber(store.stapleCountMin, base.stores[0].stapleCountMin))),
      Number(base.stores[0].stapleCountMax) || 0
    ),
    products: normalizeProductList(store.products),
    activities: {
      meituan: normalizeActivities(store.activities?.meituan, '美团'),
      eleme: normalizeActivities(store.activities?.eleme, '饿了么')
    },
    activityDesignSettings: normalizeActivityDesignSettings(store.activityDesignSettings)
  }));
  const selected = normalizedStores.find(store => store.id === raw.selectedStoreId)?.id || normalizedStores[0].id;
  return {
    ...base,
    ...raw,
    selectedStoreId: selected,
    activePage: isPageKey(raw.activePage) ? raw.activePage : DEFAULT_PAGE_KEY,
    activityStrategySettings,
    platformRules: {
      ...base.platformRules,
      ...(raw.platformRules || {}),
      redTiers: {
        meituan: raw.platformRules?.redTiers?.meituan || base.platformRules.redTiers.meituan,
        eleme: raw.platformRules?.redTiers?.eleme || base.platformRules.redTiers.eleme
      },
      profitTargets: raw.platformRules?.profitTargets || base.platformRules.profitTargets,
      pricingStrategy: normalizePricingStrategy(raw.platformRules?.pricingStrategy),
      pricingEvaluation: normalizePricingEvaluationRule(raw.platformRules?.pricingEvaluation)
    },
    stores: normalizedStores
  };
}

export const browserDataRepository = createBrowserDataRepository<CalculatorState, Store>({
  scenarios: STAPLE_SCENARIOS,
  normalizeState,
  measurementRecordKey,
  measurementChunkKey,
  activityPriceScanRecordKey,
  buildPersistedMeasurementRecord,
  buildPersistedActivityPriceScanRecord,
  normalizeCachedMeasurementRows,
  isMeasurementRowInDisplayFilters,
  sortMeasurementRows
});
