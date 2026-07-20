'use client';

import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import {
  App as AntApp,
  Button,
  Card,
  Checkbox,
  ConfigProvider,
  Flex,
  Input,
  InputNumber,
  Layout,
  Menu,
  Modal,
  Row,
  Col,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  Upload
} from 'antd';
import type { TableColumnsType, UploadProps } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined
} from '@ant-design/icons';
import * as XLSX from 'xlsx';
import { DEFAULT_PAGE_KEY, isPageKey, pageFromPathname, pathForPage, type PageKey } from './pageRoutes';
import { summarizePriceBands as summarizeDomainPriceBands } from './domain/core';
import { isCalculationAbortError, runCalculationTask } from './workers/calculationClient';
import type {
  ActivityDesignObjective as RedesignedActivityDesignObjective,
  ActivityDesignResult as RedesignedActivityDesignResult,
  ActivityComboSimulationRow,
  ActivityRecommendationRow,
  ComboEvaluationRow,
  MeasurementResult,
  MeasurementSettings,
  PriceBandRow,
  PricingEvaluationResult as RedesignedPricingEvaluationResult,
  PricingProductRow
} from './domain/types';

const AntvLine = dynamic(() => import('@ant-design/charts').then(mod => mod.Line), { ssr: false });
const AntvDualAxes = dynamic(() => import('@ant-design/charts').then(mod => mod.DualAxes), { ssr: false });

type Platform = 'meituan' | 'eleme';
type Severity = 'none' | 'critical' | 'high' | 'medium' | 'config';
type CouponDesignBasis = 'original' | 'pay';
type ActivityDesignMode = 'auto' | 'full' | 'coupon' | 'stacked';
type PricingProductType = 'normal' | 'addOn' | 'riceBall' | 'setMeal';
type ProductCategory = 'staple' | 'snackDrink' | 'addOn' | 'setMeal' | 'other';
type StapleScenario = 'single' | 'double' | 'multi';
type AsyncCalculationSlot = 'measurement' | 'activityDesign' | 'pricingEvaluation';
type AsyncCalculationTask = {
  token: string;
  page: PageKey;
  controller: AbortController;
};
type PendingAsyncCalculationResult =
  | {
    slot: 'measurement';
    token: string;
    page: 'results';
    scenario: StapleScenario;
    result: MeasurementResult;
  }
  | {
    slot: 'activityDesign';
    token: string;
    page: 'activity-design';
    scenario: StapleScenario;
    result: RedesignedActivityDesignResult;
  }
  | {
    slot: 'pricingEvaluation';
    token: string;
    page: 'pricing';
    result: RedesignedPricingEvaluationResult;
  };
type SelectedResultProduct = {
  platform: Platform;
  payBandKey: string;
  productId: string;
  productName: string;
};

type SelectedResultBand = {
  platform: Platform;
  payBandKey: string;
};

type PayBandAnalysisPanelProps = {
  title: string;
  chartTitle: string;
  platformName: string;
  payBands: PriceBandRow[];
  selectedPayBandKey: string;
  rowCount: number;
  riskCount: number;
  loading: boolean;
  columns: TableColumnsType<PriceBandRow>;
  onSelectPayBand: (key: string) => void;
};

type MeasurementPersistenceMeta = {
  generatedAt: string;
  originalMax: number | null;
  payMax: number | null;
  rowCount: number;
};

type PersistedMeasurementRecord = {
  key: string;
  storeId: string;
  storeName: string;
  scenario: StapleScenario;
  generatedAt: string;
  settings: MeasurementSettings;
  meta: MeasurementPersistenceMeta;
  payBands?: PriceBandRow[];
  chunkKeys?: string[];
  rows: ComboEvaluationRow[];
  warnings: string[];
  summary: MeasurementResult['summary'];
};

type MeasurementChunkRecord = {
  key: string;
  parentKey: string;
  index: number;
  rows: ComboEvaluationRow[];
  rowCount: number;
};

type ResultPlatformView = {
  platform: Platform;
  platformName: string;
  payBands: PriceBandRow[];
  selectedPayBandKey: string;
  selectedPayBand: PriceBandRow | null;
  platformRows: ComboEvaluationRow[];
  payBandRows: ComboEvaluationRow[];
  productRows: ComboEvaluationRow[];
  riskRows: ComboEvaluationRow[];
  visibleRows: ComboEvaluationRow[];
};

type LoadedResultBandRows = {
  platform: Platform;
  payBandKey: string;
  rows: ComboEvaluationRow[];
  matchedCount: number;
  truncated: boolean;
};

type Product = {
  id: string;
  name: string;
  price: number;
  cost: number;
  packageFee: number;
  meituanPrice: number | '';
  elemePrice: number | '';
  meituanPackageFee: number | '';
  elemePackageFee: number | '';
  meituanEnabled: boolean;
  elemeEnabled: boolean;
  category: ProductCategory;
  stapleServingCount: number;
  nonStandalone: boolean;
};

type CostPriceAdjustmentRecord = {
  id: string;
  createdAt: string;
  platform: Platform;
  platformName: string;
  productId: string;
  productName: string;
  salesPrice: number;
  oldPrice: number;
  suggestedPrice: number | null;
  newPrice: number;
  increaseAmount: number;
  increaseRate: number | null;
  targetProfitRate: number;
  minProfitRate: number | null;
  avgProfitRate: number | null;
  comboCount: number;
};

type ProfitTarget = {
  enabled: boolean;
  payMin: number;
  payMax: number;
  rateMin: number;
  rateMax: number;
};

type PricingStrategyTier = {
  enabled: boolean;
  payMin: number;
  payMax: number;
  payRateMin: number;
  payRateTarget: number;
  netRateMin: number;
  netRateTarget: number;
};

type RedTier = {
  enabled: boolean;
  threshold: number;
  min: number;
  max: number;
};

type FullReduction = {
  enabled: boolean;
  threshold: number;
  amount: number;
};

type Coupon = {
  enabled: boolean;
  name: string;
  threshold: number;
  amount: number;
};

type RedAddOn = {
  enabled: boolean;
  threshold: number;
  amount: number;
};

type DiscountActivity = {
  enabled: boolean;
  name: string;
  productNames: string;
  discountRate: number;
  itemLimit: number | '';
};

type Activities = {
  fullReductions: FullReduction[];
  coupons: Coupon[];
  redAddOns: RedAddOn[];
  discountActivities: DiscountActivity[];
};

type FeeRule = {
  commissionRate: number;
  minCommission: number;
  baseDeliveryFee: number;
  extraDeliveryFee: number;
  midPriceRate: number;
  highPriceRate: number;
  freightWithin3: number;
  freightWithin5: number;
  freightAbove5: number;
  profitTargets: ProfitTarget[];
  pricingStrategy: Record<StapleScenario, PricingStrategyTier[]>;
  redTiers: Record<Platform, RedTier[]>;
  pricingEvaluation: PricingEvaluationRule;
};

type PricingEvaluationRule = {
  fallbackTargetProfitRate: number;
  addOnTargetProfitRate: number;
  riceBallTargetProfitRate: number;
  setMealTargetProfitRate: number;
  singleStapleTargetProfitRate: number;
  doubleStapleTargetProfitRate: number;
  multiStapleTargetProfitRate: number;
};

type Store = {
  id: string;
  name: string;
  startPrice: number;
  calculationTotalMin: number;
  calculationTotalMax: number | '';
  stapleCountMin: number;
  stapleCountMax: number | '';
  deliveryDistance: number;
  orderTime: string;
  maxItems: number;
  maxQtyPerSku: number;
  maxCoupons: number;
  maxDiscountItems: number | '';
  maxChecks: number;
  usePlatformFee: boolean;
  customFeeRule: Partial<FeeRule> | null;
  usePlatformTargets: boolean;
  profitTargets: ProfitTarget[];
  products: Product[];
  activities: Record<Platform, Activities>;
  costPriceAdjustments: CostPriceAdjustmentRecord[];
};

type CalculatorState = {
  selectedStoreId: string;
  activePage: PageKey;
  riskSafetyMargin: number;
  platformRules: FeeRule;
  stores: Store[];
};

type ComboItem = {
  productId: string;
  name: string;
  qty: number;
  price: number;
  packageFee: number;
  cost: number;
  category: ProductCategory;
  stapleServingCount: number;
  nonStandalone: boolean;
};

type RiskInfo = {
  hasRisk: boolean;
  severity: Severity;
  severityRank: number;
  reasons: string[];
  target: PricingStrategyTier | null;
  thresholdRate: number | null;
  rateGap: number | null;
  netThresholdRate: number | null;
  netRateGap: number | null;
};

type ResultRow = {
  key: string;
  platform: Platform;
  platformName: string;
  items: ComboItem[];
  finalPay: number;
  cost: number;
  activityAmount: number;
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
  profit: number;
  profitRate: number | null;
  netPay: number;
  netProfitRate: number | null;
  productDiscount: number;
  full: FullReduction;
  coupons: Coupon[];
  couponAmount: number;
  baseRed: RedTier & { amount: number };
  redAddOn: RedAddOn;
  originalTotal: number;
  afterProductDiscount: number;
  risk?: RiskInfo;
};

type OptimizationRow = {
  key: string;
  platform: Platform;
  platformName: string;
  full: FullReduction;
  coupon: Coupon;
  redAddOn: RedAddOn;
  target: ProfitTarget;
  coverage: number;
  score: number;
  finalPay: number;
  profitRate: number | null;
  example: {
    items: ComboItem[];
    finalPay: number;
    profitRate: number | null;
    score: number;
  };
};

type CostProductIssue = {
  key: string;
  productId: string;
  productName: string;
  platform: Platform;
  platformName: string;
  currentPrice: number;
  costPrice: number;
  orderFinalPayMin: number | null;
  orderFinalPayMax: number | null;
  orderFinalPayAvg: number | null;
  finalPayMin: number | null;
  finalPayMax: number | null;
  avgFinalPay: number | null;
  avgProfitRate: number | null;
  avgPayProfitRate: number | null;
  targetProfitRate: number;
  targetPayProfitRate: number;
  minProfitRate: number | null;
  minPayProfitRate: number | null;
  maxProfitRate: number | null;
  minAffordableSpace: number | null;
  suggestedPrice: number | null;
  suggestedIncrease: number;
  suggestedIncreaseRate: number | null;
  suggestionBasis: string;
  comboCount: number;
  lowCount: number;
  severity: Severity;
  reasons: string[];
};

type ProductCostComboDetail = {
  key: string;
  productKey: string;
  productId: string;
  productName: string;
  currentPrice: number;
  costPrice: number;
  platform: Platform;
  platformName: string;
  comboLabel: string;
  items: ComboItem[];
  originalTotal: number;
  afterBaseRedTotal: number;
  totalDiscount: number;
  baseRedAmount: number;
  couponSpace: number;
  redAddOnSpace: number;
  orderFinalPay: number;
  orderNetPay: number;
  orderCommission: number;
  orderServiceFee: number;
  orderFreightSubsidy: number;
  orderCost: number;
  orderProfit: number;
  orderProfitRate: number | null;
  productFinalPay: number;
  productNetPay: number;
  productCost: number;
  productFee: number;
  productProfit: number;
  productProfitRate: number | null;
  productPayProfitRate: number | null;
  requiredNetRate: number;
  targetNetRate: number;
  requiredPayRate: number;
  targetPayRate: number;
  strategyScenarioName: string;
  strategyTierName: string;
  affordableSpace: number | null;
  belowMinimum: boolean;
  belowTarget: boolean;
};

type PricingComboDetail = {
  key: string;
  productKey: string;
  productId: string;
  productName: string;
  currentPrice: number;
  packageFee: number;
  currentOriginalPrice: number;
  costPrice: number;
  platform: Platform;
  platformName: string;
  comboLabel: string;
  items: ComboItem[];
  originalTotal: number;
  baseRedAmount: number;
  redAddOnSpace: number;
  orderFinalPay: number;
  orderNetPay: number;
  orderCommission: number;
  orderServiceFee: number;
  orderFreightSubsidy: number;
  requiredRate: number;
  productFinalPay: number;
  productFee: number;
  productNetPay: number;
  productCost: number;
  productProfit: number;
  productProfitRate: number | null;
  productPayProfitRate: number | null;
  requiredNetRate: number;
  targetNetRate: number;
  requiredPayRate: number;
  targetPayRate: number;
  strategyScenarioName: string;
  strategyTierName: string;
  affordableSpace: number | null;
  belowMinimum: boolean;
  belowTarget: boolean;
};

type PricingProductIssue = {
  key: string;
  productId: string;
  productName: string;
  productType: PricingProductType;
  productTypeName: string;
  platform: Platform;
  platformName: string;
  currentPrice: number;
  costPrice: number;
  targetProfitRate: number;
  targetPayProfitRate: number;
  comboCount: number;
  lowCount: number;
  lossCount: number;
  minProfitRate: number | null;
  minPayProfitRate: number | null;
  avgProfitRate: number | null;
  avgPayProfitRate: number | null;
  avgRequiredRate: number | null;
  avgRequiredPayRate: number | null;
  minAffordableSpace: number | null;
  packageFee: number;
  currentOriginalPrice: number;
  suggestedPrice: number | null;
  suggestedOriginalPrice: number | null;
  suggestedIncrease: number;
  suggestedIncreaseRate: number | null;
  suggestionBasis: string;
  severity: Severity;
  reasons: string[];
};

type ProductCurvePoint = {
  key: string;
  productKey: string;
  productName: string;
  platform: Platform;
  platformName: string;
  comboLabel: string;
  finalPay: number;
  profitRate: number | null;
  targetMidRate: number | null;
};

type TierAnalysisRow = {
  key: string;
  platform: Platform;
  platformName: string;
  tierName: string;
  threshold: number;
  amount: number;
  hitCount: number;
  avgFinalPay: number;
  avgProfitRate: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  lowCount: number;
};

type CouponDesignRow = {
  key: string;
  platform: Platform;
  platformName: string;
  basis: CouponDesignBasis;
  basisName: string;
  threshold: number;
  fullAmount: number;
  couponAmount: number;
  totalDiscount: number;
  mode: ActivityDesignMode;
  modeName: string;
  hitCount: number;
  eligibleCount: number;
  coverageRate: number;
  avgOriginalTotal: number;
  avgFinalPay: number;
  avgNetPay: number;
  avgProfitRate: number | null;
  noCouponAvgProfitRate: number | null;
  noCouponMinProfitRate: number | null;
  couponAvgProfitRate: number | null;
  couponMinProfitRate: number | null;
  couponTargetProfitRate: number;
  profitRateSpread: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  targetProfitRate: number;
  profitRateGap: number | null;
  avgBaseRedAmount: number;
  avgRedAddOnSpace: number;
  score: number;
  example: {
    items: ComboItem[];
    originalTotal: number;
    finalPay: number;
    profitRate: number | null;
  };
};

type CostAnalysisResult = {
  issues: CostProductIssue[];
  details: ProductCostComboDetail[];
  curvePoints: ProductCurvePoint[];
  redTierRows: TierAnalysisRow[];
  warnings: string[];
  summary: Summary;
};

type ActivityDesignResult = {
  rows: CouponDesignRow[];
  warnings: string[];
  summary: Summary;
};

type PricingEvaluationResult = {
  issues: PricingProductIssue[];
  details: PricingComboDetail[];
  warnings: string[];
  summary: Summary;
};

type ComboRangeSettings = {
  productNameKeyword: string;
  originalMin: number;
  originalMax: number | '';
  payMin: number;
  payMax: number | '';
};

type CostAnalysisSettings = ComboRangeSettings & {
  couponSpace: number;
  redAddOnSpace: number;
  targetProfitRate: number;
};

type ActivityDesignSettings = ComboRangeSettings & {
  redAddOnSpace: number;
  stapleMaxCount?: number;
  addOnMaxCount?: number | '';
  selectedRecommendationKey?: string;
  targetProfitRate: number;
  couponProfitDrop: number;
  couponDesignBasis: CouponDesignBasis;
  couponDesignThresholdStep: number;
  couponDesignAmountStep: number;
  couponDesignMaxFullAmount: number | '';
  couponDesignMaxCouponAmount: number | '';
  designMode: ActivityDesignMode;
  objective?: RedesignedActivityDesignObjective;
  minProfitRate?: number;
  originalBandSize?: number;
  payBandSize?: number;
};

type PricingEvaluationSettings = ComboRangeSettings & {
  redAddOnSpace: number;
  lowPayMax: number;
  fixedCostAllocation?: number;
};

type ProductSortField = 'name' | 'category' | 'stapleServingCount' | 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
type ProductStatusFilter = 'all' | 'meituanEnabled' | 'meituanDisabled' | 'elemeEnabled' | 'elemeDisabled' | 'nonStandalone' | 'missingCost';
type TableBreakpoint = 'xxxl' | 'xxl' | 'xl' | 'lg' | 'md' | 'sm' | 'xs';

type CostSpaceOrderRow = {
  key: string;
  platform: Platform;
  platformName: string;
  items: ComboItem[];
  originalTotal: number;
  afterProductDiscount: number;
  baseRed: RedTier & { amount: number };
  couponSpace: number;
  redAddOnSpace: number;
  reservedActivitySpace: number;
  finalPay: number;
  netPay: number;
  cost: number;
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
  profit: number;
  profitRate: number | null;
  payProfitRate: number | null;
  requiredNetRate: number;
  targetNetRate: number;
  requiredPayRate: number;
  targetPayRate: number;
  strategyScenarioName: string;
  strategyTierName: string;
};

type PricingOrderRow = {
  key: string;
  platform: Platform;
  platformName: string;
  items: ComboItem[];
  originalTotal: number;
  baseRed: RedTier & { amount: number };
  redAddOnSpace: number;
  finalPay: number;
  netPay: number;
  cost: number;
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
  profit: number;
  profitRate: number | null;
  payProfitRate: number | null;
  requiredNetRate: number;
  targetNetRate: number;
  requiredPayRate: number;
  targetPayRate: number;
  strategyScenarioName: string;
  strategyTierName: string;
};

type CouponDesignBaseRow = {
  key: string;
  platform: Platform;
  platformName: string;
  items: ComboItem[];
  originalTotal: number;
  preCouponPay: number;
  cost: number;
};

type ProductBulkPriceField = 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
type ProductBulkPriceMode = 'set' | 'increase' | 'discount';

type Summary = {
  resultCount: number;
  comboCount: number;
  validComboCount: number;
  elapsedTime: number | null;
};

type ComboEnumerationSummary = {
  checked: number;
  validCombos: number;
  stopped: boolean;
  stoppedReason?: 'maxChecks' | 'maxDuration';
};

type CalculationProgress = {
  resultCount: number;
  comboCount: number;
  validComboCount: number;
};

type CostRecord = {
  name: string;
  cost: number;
};

type PlatformProductRecord = {
  name: string;
  price: number;
  packageFee?: number;
  platformEnabled?: boolean;
};

const EMPTY_SUMMARY: Summary = { resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null };

const { Header, Sider, Content } = Layout;
const { Text, Title } = Typography;

const STORAGE_KEY = 'waimai_store_activity_calculator_v2';
const DB_NAME = 'waimai-price-calculator';
const DB_VERSION = 2;
const STATE_STORE = 'states';
const MEASUREMENT_RESULTS_STORE = 'measurement_results';
const REQUIRED_OBJECT_STORES = [STATE_STORE, MEASUREMENT_RESULTS_STORE] as const;
const DEFAULT_STATE_KEY = 'default';
const PLATFORMS: Platform[] = ['meituan', 'eleme'];
const PLATFORM_NAMES: Record<Platform, string> = { meituan: '美团', eleme: '饿了么' };
const STAPLE_SCENARIOS: StapleScenario[] = ['single', 'double', 'multi'];
const ACTIVITY_PAY_MAX_BY_SCENARIO: Record<StapleScenario, number> = { single: 40, double: 80, multi: 150 };
const MEASUREMENT_RESULT_SCENARIO: StapleScenario = 'multi';
const MEASUREMENT_MODEL_VERSION = 'unified-pay-band-v1';
const MEASUREMENT_DETAIL_ROW_LIMIT = 5000;
const ACTIVITY_DESIGN_RESULT_SCENARIO: StapleScenario = 'multi';
const ASYNC_CALCULATION_MAX_DURATION_MS = 30000;
const ASYNC_CALCULATION_WORKER_TIMEOUT_MS = 35000;
const ACTIVITY_DESIGN_MAX_DURATION_MS = 90000;
const ACTIVITY_DESIGN_WORKER_TIMEOUT_MS = 95000;
const ACTIVITY_ROUTE_VALIDATION_MAX_DURATION_MS = 180000;
const ACTIVITY_ROUTE_VALIDATION_WORKER_TIMEOUT_MS = 190000;
const PRODUCT_CATEGORIES: ProductCategory[] = ['staple', 'snackDrink', 'addOn', 'setMeal', 'other'];
const PRODUCT_CATEGORY_NAMES: Record<ProductCategory, string> = {
  staple: '主食',
  snackDrink: '小吃饮料',
  addOn: '加料',
  setMeal: '套餐',
  other: '其他'
};
const SHOW_MD: TableBreakpoint[] = ['md'];
const SHOW_LG: TableBreakpoint[] = ['lg'];
const SHOW_XL: TableBreakpoint[] = ['xl'];
const SHOW_XXL: TableBreakpoint[] = ['xxl'];
const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', '是', '有', '启用', '单点不送', '不可单点', '上架', '售卖中', '在售']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', '否', '无', '不', '停用', '关闭', '下架', '暂停售卖']);

function comboEnumerationStopWarning(stopped: boolean, stoppedReason: ComboEnumerationSummary['stoppedReason'], maxChecks: number) {
  if (!stopped) return null;
  if (stoppedReason === 'maxDuration') {
    return `已达到最长计算时间 ${Math.round(ASYNC_CALCULATION_MAX_DURATION_MS / 1000)} 秒，已停止继续枚举。`;
  }
  return `已达到最多检查组合数 ${maxChecks}，已停止继续枚举。`;
}

const PLATFORM_PRODUCT_IMPORT_RULES: Record<Platform, {
  name: string;
  priceField: 'meituanPrice' | 'elemePrice';
  packageFeeField: 'meituanPackageFee' | 'elemePackageFee';
  enabledField: 'meituanEnabled' | 'elemeEnabled';
  nameHeaders: string[];
  priceHeaders: string[];
  packageFeeHeaders: string[];
  statusHeaders: string[];
}> = {
  meituan: {
    name: '美团',
    priceField: 'meituanPrice',
    packageFeeField: 'meituanPackageFee',
    enabledField: 'meituanEnabled',
    nameHeaders: ['商品名称', '商品名', '名称'],
    priceHeaders: ['外送价', '美团价', '售价', '价格(元)', '价格'],
    packageFeeHeaders: ['餐盒价格'],
    statusHeaders: ['售卖状态', '上下架', '上架状态']
  },
  eleme: {
    name: '饿了么',
    priceField: 'elemePrice',
    packageFeeField: 'elemePackageFee',
    enabledField: 'elemeEnabled',
    nameHeaders: ['商品名称', '商品名', '名称'],
    priceHeaders: ['价格(元)', '饿了么价', '外送价', '售价', '价格'],
    packageFeeHeaders: ['包装费(元)'],
    statusHeaders: []
  }
};

const COST_IMPORT_RULE = {
  nameHeaders: ['商品名称', '商品名', '名称', '菜品名称', '产品名称'],
  costHeaders: ['成本价', '成本', '商品成本', '成本(元)', '成本价格', '采购价']
};

const DEFAULT_COST_ANALYSIS_SETTINGS: CostAnalysisSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  couponSpace: 0,
  redAddOnSpace: 0,
  targetProfitRate: 25
};

const DEFAULT_ACTIVITY_DESIGN_SETTINGS: ActivityDesignSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  redAddOnSpace: 0,
  stapleMaxCount: 2,
  addOnMaxCount: 3,
  targetProfitRate: 25,
  couponProfitDrop: 3,
  couponDesignBasis: 'original',
  couponDesignThresholdStep: 5,
  couponDesignAmountStep: 1,
  couponDesignMaxFullAmount: 20,
  couponDesignMaxCouponAmount: 20,
  designMode: 'auto',
  objective: 'longTerm',
  minProfitRate: 0,
  originalBandSize: 5,
  payBandSize: 5
};

const DEFAULT_PRICING_EVALUATION_SETTINGS: PricingEvaluationSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  redAddOnSpace: 0,
  lowPayMax: 25,
  fixedCostAllocation: 0
};

const DEFAULT_MEASUREMENT_SETTINGS: MeasurementSettings = {
  originalMin: 0,
  originalMax: '',
  stapleMaxCount: 3,
  multiStapleCount: 3,
  payMin: 0,
  payMax: '',
  payBandSize: 5,
  addOnMaxCount: 3,
  ignoreOutOfPayRange: true
};

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

const defaultState: CalculatorState = {
  selectedStoreId: 'store-1',
  activePage: 'store',
  riskSafetyMargin: 0,
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
      costPriceAdjustments: []
    }
  ]
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
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

function parseProductStatus(value: unknown, fallback = true) {
  const text = String(value ?? '').trim();
  if (text === '') return fallback;
  if (/暂停|停售|下架|关闭|停用|不可售|未售/.test(text)) return false;
  if (/售卖中|上架|在售|启用|开启/.test(text)) return true;
  return parseBoolean(text, fallback);
}

function normalizeDiscountRate(value: unknown) {
  const n = toNumber(value, 1);
  if (n > 10) return n / 100;
  if (n > 1) return n / 10;
  return n;
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

function productCategoryName(category: ProductCategory) {
  return PRODUCT_CATEGORY_NAMES[category] || PRODUCT_CATEGORY_NAMES.other;
}

function money(value: unknown) {
  return (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
}

function roundMoney(value: unknown) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function nonNegativeAmount(value: unknown) {
  return Math.max(0, Number(value) || 0);
}

function rateText(rate: number | null | undefined) {
  return Number.isFinite(rate) ? `${((rate as number) * 100).toFixed(2)}%` : '无法计算';
}

function dateTimeText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || '-';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function ceilMoneyStep(value: number, step = 0.1) {
  return roundMoney(Math.ceil((Number(value) || 0) / step - 1e-9) * step);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function tableColumnDataIndex<T>(column: TableColumnsType<T>[number]) {
  const dataIndex = (column as { dataIndex?: unknown }).dataIndex;
  if (Array.isArray(dataIndex)) return dataIndex.join('.');
  return typeof dataIndex === 'string' || typeof dataIndex === 'number' ? String(dataIndex) : '';
}

function withoutColumnByDataIndex<T>(columns: TableColumnsType<T>, dataIndex: string): TableColumnsType<T> {
  return columns.filter(column => tableColumnDataIndex(column) !== dataIndex);
}

function tablePagination(defaultPageSize: number) {
  return {
    defaultPageSize,
    showSizeChanger: true,
    pageSizeOptions: ['5', '10', '20', '30', '50', '100'],
    showTotal: (total: number) => `共 ${total} 条`
  };
}

function createScenarioRecord<T>(factory: () => T): Record<StapleScenario, T> {
  return {
    single: factory(),
    double: factory(),
    multi: factory()
  };
}

function createScenarioPlatformRecord<T>(factory: () => T): Record<StapleScenario, Record<Platform, T>> {
  return createScenarioRecord(() => ({
    meituan: factory(),
    eleme: factory()
  }));
}

function measurementRecordKey(storeId: string, scenario: StapleScenario) {
  return `${storeId}::${scenario}::${MEASUREMENT_MODEL_VERSION}`;
}

function measurementChunkKey(parentKey: string, runId: string, index: number) {
  return `${parentKey}::chunk::${runId}::${index}`;
}

function measurementFiniteMax(value: number | '') {
  if (value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
}

function buildMeasurementSummaryFromRows(rows: ComboEvaluationRow[], elapsedTime: number | null): MeasurementResult['summary'] {
  const activeRows = rows.filter(row => !row.ignored);
  return {
    resultCount: activeRows.length,
    comboCount: rows.length,
    validComboCount: activeRows.length,
    ignoredCount: rows.length - activeRows.length,
    riskCount: activeRows.filter(row => row.risk.hasRisk).length,
    elapsedTime
  };
}

function sortMeasurementRows(rows: ComboEvaluationRow[]) {
  return rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.finalPay - b.finalPay || a.originalTotal - b.originalTotal || a.key.localeCompare(b.key));
}

function fallbackMeasurementRowKey(row: Partial<ComboEvaluationRow>, index: number) {
  const itemKey = Array.isArray(row.items)
    ? row.items.map(item => `${item.productId || item.name}:${item.qty}`).join('|')
    : 'no-items';
  return [
    row.platform || 'platform',
    row.scenario || 'scenario',
    itemKey,
    roundMoney(row.originalTotal),
    roundMoney(row.finalPay),
    roundMoney(row.activityAmount),
    index
  ].join('::');
}

function ensureUniqueMeasurementRowKeys(rows: ComboEvaluationRow[]) {
  const seen = new Map<string, number>();
  return rows.map((row, index) => {
    const baseKey = String(row.key || fallbackMeasurementRowKey(row, index));
    const count = seen.get(baseKey) || 0;
    seen.set(baseKey, count + 1);
    if (count === 0 && row.key === baseKey) return row;
    return { ...row, key: `${baseKey}::cache-dup:${count || index}` };
  });
}

function normalizeCachedMeasurementRows(value: unknown): ComboEvaluationRow[] {
  if (!Array.isArray(value)) return [];
  const rows = value
    .filter(row => row && typeof row === 'object')
    .map((row, index) => {
      const source = row as Partial<ComboEvaluationRow>;
      const platform: Platform = source.platform === 'eleme' ? 'eleme' : 'meituan';
      const scenario: StapleScenario = STAPLE_SCENARIOS.includes(source.scenario as StapleScenario) ? source.scenario as StapleScenario : 'single';
      const riskSource = (source.risk || {}) as Partial<RiskInfo>;
      return {
        ...source,
        key: String(source.key || fallbackMeasurementRowKey(source, index)),
        platform,
        platformName: source.platformName || PLATFORM_NAMES[platform],
        scenario,
        scenarioName: source.scenarioName || stapleScenarioName(scenario),
        items: Array.isArray(source.items) ? source.items : [],
        originalTotal: roundMoney(source.originalTotal),
        afterProductDiscount: roundMoney(source.afterProductDiscount),
        finalPay: roundMoney(source.finalPay),
        netPay: roundMoney(source.netPay),
        cost: roundMoney(source.cost),
        activityAmount: roundMoney(source.activityAmount),
        commission: roundMoney(source.commission),
        serviceFee: roundMoney(source.serviceFee),
        freightSubsidy: roundMoney(source.freightSubsidy),
        profit: roundMoney(source.profit),
        profitRate: source.profitRate === null || source.profitRate === undefined ? null : Number(source.profitRate) || 0,
        netProfitRate: source.netProfitRate === null || source.netProfitRate === undefined ? null : Number(source.netProfitRate) || 0,
        costProfitRate: source.costProfitRate === null || source.costProfitRate === undefined ? null : Number(source.costProfitRate) || 0,
        targetPayRate: Number(source.targetPayRate) || 0,
        targetNetRate: Number(source.targetNetRate) || 0,
        requiredPayRate: Number(source.requiredPayRate) || 0,
        requiredNetRate: Number(source.requiredNetRate) || 0,
        profitSpace: roundMoney(source.profitSpace),
        profitRateGap: source.profitRateGap === null || source.profitRateGap === undefined ? null : Number(source.profitRateGap) || 0,
        ignored: Boolean(source.ignored),
        risk: {
          hasRisk: Boolean(riskSource.hasRisk),
          severity: riskSource.severity || 'none',
          severityRank: Number(riskSource.severityRank) || 0,
          reasons: Array.isArray(riskSource.reasons) ? riskSource.reasons : [],
          target: riskSource.target || null,
          thresholdRate: riskSource.thresholdRate ?? null,
          rateGap: riskSource.rateGap ?? null,
          netThresholdRate: riskSource.netThresholdRate ?? null,
          netRateGap: riskSource.netRateGap ?? null
        }
      } as ComboEvaluationRow;
    });
  return ensureUniqueMeasurementRowKeys(sortMeasurementRows(rows));
}

function buildMeasurementPersistenceSettings(store: Store, settings: MeasurementSettings): MeasurementSettings {
  const storeRange = calculationTotalRange(store);
  const maxFromStore = Number.isFinite(storeRange.max) ? storeRange.max : settings.originalMax;
  const stapleMaxCount = Math.max(1, Math.floor(Number(settings.stapleMaxCount ?? settings.multiStapleCount) || 3));
  return {
    ...settings,
    originalMin: 0,
    originalMax: maxFromStore,
    stapleMaxCount,
    multiStapleCount: Math.max(3, Math.floor(Number(settings.multiStapleCount) || stapleMaxCount)),
    payMin: 0,
    payMax: '',
    ignoreOutOfPayRange: true
  };
}

function isMeasurementRowInDisplayFilters(row: ComboEvaluationRow, store: Store, settings: MeasurementSettings) {
  const storeRange = calculationTotalRange(store);
  const originalMin = Math.max(storeRange.min, Math.max(0, Number(settings.originalMin) || 0));
  const originalMaxSetting = settings.originalMax === '' ? storeRange.max : Math.max(originalMin, Number(settings.originalMax) || 0);
  const originalMax = Number.isFinite(originalMaxSetting) ? originalMaxSetting : Infinity;
  const payMin = Math.max(0, Number(settings.payMin) || 0);
  const payMax = settings.payMax === '' ? Infinity : Math.max(payMin, Number(settings.payMax) || 0);
  return row.originalTotal + 1e-9 >= originalMin
    && row.originalTotal <= originalMax + 1e-9
    && row.finalPay + 1e-9 >= payMin
    && row.finalPay <= payMax + 1e-9;
}

function measurementRecordToResult(record: PersistedMeasurementRecord, payBandSize: number): MeasurementResult {
  const rows = normalizeCachedMeasurementRows(record.rows);
  const activeRows = rows.filter(row => !row.ignored);
  return {
    rows,
    payBands: record.payBands?.length
      ? record.payBands
      : summarizeDomainPriceBands(activeRows, Math.max(1, Number(payBandSize) || 5), 'pay', { groupByScenario: false }),
    warnings: record.warnings,
    summary: record.summary
  };
}

function mergeActivityRouteValidationResult(
  current: RedesignedActivityDesignResult | null,
  validation: RedesignedActivityDesignResult
): RedesignedActivityDesignResult {
  if (!current) return validation;
  const selectedRecommendation = validation.recommendations[0];
  const recommendations = selectedRecommendation
    ? current.recommendations.some(row => row.key === selectedRecommendation.key)
      ? current.recommendations.map(row => row.key === selectedRecommendation.key ? selectedRecommendation : row)
      : [selectedRecommendation, ...current.recommendations]
    : current.recommendations;
  const validationPlatforms = new Set(validation.originalBands.map(row => row.platform));
  const originalBands = validation.originalBands.length
    ? [
      ...current.originalBands.filter(row => !validationPlatforms.has(row.platform)),
      ...validation.originalBands
    ]
    : current.originalBands;
  return {
    ...current,
    originalBands,
    recommendations,
    payBands: validation.payBands,
    hitRows: validation.hitRows,
    comboRows: validation.comboRows,
    warnings: validation.warnings,
    summary: {
      ...validation.summary,
      resultCount: current.summary.resultCount || current.recommendations.length || validation.summary.resultCount
    }
  };
}

function buildPersistedMeasurementRecord(
  store: Store,
  scenario: StapleScenario,
  settings: MeasurementSettings,
  result: MeasurementResult,
  chunkKeys: string[] = []
): PersistedMeasurementRecord {
  const rows = normalizeCachedMeasurementRows(result.rows);
  const generatedAt = new Date().toISOString();
  const originalMax = measurementFiniteMax(settings.originalMax);
  const payMax = measurementFiniteMax(settings.payMax);
  return {
    key: measurementRecordKey(store.id, scenario),
    storeId: store.id,
    storeName: store.name,
    scenario,
    generatedAt,
    settings: {
      ...settings,
      originalMax: originalMax === null ? '' : originalMax,
      payMax: payMax === null ? '' : payMax
    },
    meta: {
      generatedAt,
      originalMax,
      payMax,
      rowCount: chunkKeys.length ? result.summary.resultCount + result.summary.ignoredCount : rows.length
    },
    payBands: result.payBands,
    chunkKeys,
    rows: chunkKeys.length ? [] : rows,
    warnings: result.warnings,
    summary: chunkKeys.length ? result.summary : buildMeasurementSummaryFromRows(rows, result.summary.elapsedTime)
  };
}

function stapleScenarioName(scenario: StapleScenario) {
  return { single: '单人', double: '双人', multi: '多人' }[scenario];
}

function stapleScenarioRange(scenario: StapleScenario): Pick<Store, 'stapleCountMin' | 'stapleCountMax'> {
  if (scenario === 'single') return { stapleCountMin: 1, stapleCountMax: 1 };
  if (scenario === 'double') return { stapleCountMin: 2, stapleCountMax: 2 };
  return { stapleCountMin: 3, stapleCountMax: '' };
}

function stapleScenarioRangeText(scenario: StapleScenario) {
  const range = stapleScenarioRange(scenario);
  return `${range.stapleCountMin}-${range.stapleCountMax === '' ? '不限' : range.stapleCountMax} 份`;
}

function stateWithStapleScenario(state: CalculatorState, scenario: StapleScenario) {
  const next = deepClone(state);
  const store = currentStoreFrom(next);
  const range = stapleScenarioRange(scenario);
  store.stapleCountMin = range.stapleCountMin;
  store.stapleCountMax = range.stapleCountMax;
  return normalizeState(next);
}

type PriceSuggestionDetail = {
  affordableSpace: number | null;
  items: ComboItem[];
  productId: string;
  productFinalPay: number;
  productNetPay: number;
  comboLabel: string;
};

type PriceSuggestionCandidate = {
  shortage: number;
  qty: number;
  increase: number;
  comboLabel: string;
};

type PriceSurplusCandidate = {
  surplus: number;
  qty: number;
  decrease: number;
  comboLabel: string;
};

const PRICING_TRUST_PRICE_GAP = 0.3;

function buildPriceSuggestionCandidates(details: PriceSuggestionDetail[]): PriceSuggestionCandidate[] {
  return details
    .map(detail => {
      const shortage = Math.max(0, -(detail.affordableSpace || 0));
      if (shortage <= 0) return null;
      const qty = detail.items.find(item => item.productId === detail.productId)?.qty || 1;
      const netEfficiency = detail.productFinalPay > 0
        ? clamp(detail.productNetPay / detail.productFinalPay, 0.45, 1)
        : 0.8;
      return {
        shortage,
        qty,
        increase: shortage / Math.max(1, qty) / netEfficiency,
        comboLabel: detail.comboLabel
      };
    })
    .filter((item): item is PriceSuggestionCandidate => Boolean(item));
}

function buildPriceSurplusCandidates(details: PriceSuggestionDetail[]): PriceSurplusCandidate[] {
  return details
    .map(detail => {
      const surplus = Math.max(0, detail.affordableSpace || 0);
      if (surplus <= 0) return null;
      const qty = detail.items.find(item => item.productId === detail.productId)?.qty || 1;
      const netEfficiency = detail.productFinalPay > 0
        ? clamp(detail.productNetPay / detail.productFinalPay, 0.45, 1)
        : 0.8;
      return {
        surplus,
        qty,
        decrease: surplus / Math.max(1, qty) / netEfficiency,
        comboLabel: detail.comboLabel
      };
    })
    .filter((item): item is PriceSurplusCandidate => Boolean(item));
}

function noPriceSuggestionBasis() {
  return {
    suggestedPrice: null,
    suggestedOriginalPrice: null,
    suggestedIncrease: 0,
    suggestedIncreaseRate: null,
    suggestionBasis: '当前组合未出现目标利润率缺口'
  };
}

function priceEndingNineCeil(value: number) {
  const normalized = Math.max(0, Number(value) || 0);
  const floor = Math.floor(normalized);
  const candidate = roundMoney(floor + 0.9);
  return candidate + 1e-9 >= normalized ? candidate : roundMoney(floor + 1.9);
}

function buildCostPriceSuggestion(currentPrice: number, details: PriceSuggestionDetail[]) {
  const candidates = buildPriceSuggestionCandidates(details);
  if (!candidates.length) {
    return noPriceSuggestionBasis();
  }

  const worst = candidates.sort((a, b) => b.increase - a.increase)[0];
  const suggestedPrice = ceilMoneyStep(currentPrice + worst.increase);
  const suggestedIncrease = roundMoney(suggestedPrice - currentPrice);
  return {
    suggestedPrice,
    suggestedOriginalPrice: suggestedPrice,
    suggestedIncrease,
    suggestedIncreaseRate: currentPrice > 0 ? suggestedIncrease / currentPrice : null,
    suggestionBasis: `按缺口最大组合估算：${worst.comboLabel}`
  };
}

function buildPricingPriceSuggestion(currentPrice: number, packageFee: number, details: PriceSuggestionDetail[]) {
  const currentOriginalPrice = roundMoney(currentPrice + packageFee);
  const candidates = buildPriceSuggestionCandidates(details);
  if (!candidates.length) {
    const surplusCandidates = buildPriceSurplusCandidates(details);
    if (!surplusCandidates.length || surplusCandidates.length < details.length) return noPriceSuggestionBasis();
    const limiting = surplusCandidates.sort((a, b) => a.decrease - b.decrease)[0];
    const rawSuggestedOriginalPrice = ceilMoneyStep(Math.max(packageFee, currentOriginalPrice - limiting.decrease));
    const rawSuggestedPrice = Math.max(0, roundMoney(rawSuggestedOriginalPrice - packageFee));
    const rawDecrease = roundMoney(currentPrice - rawSuggestedPrice);
    if (rawDecrease <= PRICING_TRUST_PRICE_GAP + 1e-9) {
      return {
        suggestedPrice: null,
        suggestedOriginalPrice: null,
        suggestedIncrease: 0,
        suggestedIncreaseRate: null,
        suggestionBasis: `可安全降价空间仅 ¥${money(rawDecrease)}，低于 ¥${money(PRICING_TRUST_PRICE_GAP)} 置信阈值，暂不建议调价`
      };
    }
    const suggestedOriginalPrice = priceEndingNineCeil(rawSuggestedOriginalPrice);
    const suggestedPrice = Math.max(0, roundMoney(suggestedOriginalPrice - packageFee));
    const suggestedIncrease = roundMoney(suggestedPrice - currentPrice);
    if (suggestedIncrease >= -PRICING_TRUST_PRICE_GAP - 1e-9) {
      return {
        suggestedPrice: null,
        suggestedOriginalPrice: null,
        suggestedIncrease: 0,
        suggestedIncreaseRate: null,
        suggestionBasis: '当前价格已接近 x.9 尾价安全下限，暂不建议降价'
      };
    }
    return {
      suggestedPrice,
      suggestedOriginalPrice: roundMoney(suggestedPrice + packageFee),
      suggestedIncrease,
      suggestedIncreaseRate: currentPrice > 0 ? suggestedIncrease / currentPrice : null,
      suggestionBasis: `利润率高于目标，按最紧压力场景估算含打包费 x.9 尾价：${limiting.comboLabel}`
    };
  }

  const worst = candidates.sort((a, b) => b.increase - a.increase)[0];
  const rawSuggestedOriginalPrice = ceilMoneyStep(currentOriginalPrice + worst.increase);
  const rawSuggestedPrice = Math.max(0, roundMoney(rawSuggestedOriginalPrice - packageFee));
  const rawIncrease = roundMoney(rawSuggestedPrice - currentPrice);
  if (rawIncrease <= PRICING_TRUST_PRICE_GAP + 1e-9) {
    return {
      suggestedPrice: null,
      suggestedOriginalPrice: null,
      suggestedIncrease: 0,
      suggestedIncreaseRate: null,
      suggestionBasis: `评估缺口仅 ¥${money(rawIncrease)}，低于 ¥${money(PRICING_TRUST_PRICE_GAP)} 置信阈值，暂不建议调价`
    };
  }

  const suggestedOriginalPrice = priceEndingNineCeil(rawSuggestedOriginalPrice);
  const suggestedPrice = Math.max(0, roundMoney(suggestedOriginalPrice - packageFee));
  const suggestedIncrease = roundMoney(suggestedPrice - currentPrice);
  return {
    suggestedPrice,
    suggestedOriginalPrice: roundMoney(suggestedPrice + packageFee),
    suggestedIncrease,
    suggestedIncreaseRate: currentPrice > 0 ? suggestedIncrease / currentPrice : null,
    suggestionBasis: `按缺口最大场景估算含打包费 x.9 尾价：${worst.comboLabel}`
  };
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

function isProductListedOnPlatform(product: Product, platform: Platform) {
  return platform === 'meituan' ? product.meituanEnabled !== false : product.elemeEnabled !== false;
}

function currentStoreFrom(state: CalculatorState) {
  return state.stores.find(store => store.id === state.selectedStoreId) || state.stores[0];
}

function effectiveFeeRule(state: CalculatorState, store = currentStoreFrom(state)): FeeRule {
  return store.usePlatformFee || !store.customFeeRule
    ? deepClone(state.platformRules)
    : { ...deepClone(state.platformRules), ...deepClone(store.customFeeRule) };
}

function effectiveProfitTargets(state: CalculatorState, store = currentStoreFrom(state)) {
  return (store.usePlatformTargets ? state.platformRules.profitTargets : store.profitTargets)
    .filter(target => target.enabled)
    .filter(target => target.payMax > 0 && target.rateMax > target.rateMin);
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

function normalizeProductList(value: unknown): Product[] {
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

function productTextValue(value: unknown) {
  return String(value ?? '').trim();
}

function productNumberValue(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function compareProductText(a: unknown, b: unknown) {
  return productTextValue(a).localeCompare(productTextValue(b), 'zh-CN');
}

function compareProductNumber(a: unknown, b: unknown) {
  return productNumberValue(a) - productNumberValue(b);
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
      amount: toMoneyNumber(row.amount, 0)
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

function normalizeCostPriceAdjustment(record: Partial<CostPriceAdjustmentRecord>): CostPriceAdjustmentRecord {
  const platform: Platform = record.platform === 'eleme' ? 'eleme' : 'meituan';
  const oldPrice = Math.max(0, toMoneyNumber(record.oldPrice, 0));
  const newPrice = Math.max(0, toMoneyNumber(record.newPrice, oldPrice));
  const salesPrice = Math.max(0, toMoneyNumber(record.salesPrice, 0));
  const increaseAmount = roundMoney(newPrice - oldPrice);
  return {
    id: record.id || uid('adj'),
    createdAt: String(record.createdAt || new Date().toISOString()),
    platform,
    platformName: PLATFORM_NAMES[platform],
    productId: String(record.productId || ''),
    productName: String(record.productName || ''),
    salesPrice,
    oldPrice,
    suggestedPrice: record.suggestedPrice === null || record.suggestedPrice === undefined ? null : Math.max(0, toMoneyNumber(record.suggestedPrice, oldPrice)),
    newPrice,
    increaseAmount,
    increaseRate: oldPrice > 0 ? increaseAmount / oldPrice : null,
    targetProfitRate: Math.max(0, Number(record.targetProfitRate) || 0),
    minProfitRate: record.minProfitRate === null || record.minProfitRate === undefined ? null : Number(record.minProfitRate),
    avgProfitRate: record.avgProfitRate === null || record.avgProfitRate === undefined ? null : Number(record.avgProfitRate),
    comboCount: Math.max(0, Math.floor(Number(record.comboCount) || 0))
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

function normalizePricingStrategy(data: Partial<Record<StapleScenario, Partial<PricingStrategyTier>[]>> | undefined): Record<StapleScenario, PricingStrategyTier[]> {
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

function normalizeState(data: unknown): CalculatorState {
  if (!data || typeof data !== 'object') return deepClone(defaultState);
  const raw = data as Partial<CalculatorState>;
  const base = deepClone(defaultState);
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
    costPriceAdjustments: Array.isArray(store.costPriceAdjustments)
      ? store.costPriceAdjustments.map(normalizeCostPriceAdjustment).filter(record => record.productId && record.productName)
      : []
  }));
  const selected = normalizedStores.find(store => store.id === raw.selectedStoreId)?.id || normalizedStores[0].id;
  return {
    ...base,
    ...raw,
    selectedStoreId: selected,
    activePage: isPageKey(raw.activePage) ? raw.activePage : DEFAULT_PAGE_KEY,
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

function platformPrice(product: Product, platform: Platform) {
  const platformValue = platform === 'eleme' ? product.elemePrice : product.meituanPrice;
  const n = Number(platformValue);
  return n > 0 ? n : Number(product.price) || 0;
}

function platformPackageFee(product: Product, platform: Platform) {
  const platformValue = platform === 'eleme' ? product.elemePackageFee : product.meituanPackageFee;
  if (platformValue !== '') return Math.max(0, Number(platformValue) || 0);
  return Math.max(0, Number(product.packageFee) || 0);
}

function platformOriginalUnitPrice(product: Product, platform: Platform) {
  return roundMoney(platformPrice(product, platform) + platformPackageFee(product, platform));
}

function platformPriceField(platform: Platform): 'meituanPrice' | 'elemePrice' {
  return platform === 'eleme' ? 'elemePrice' : 'meituanPrice';
}

function calculationTotalRange(store: Store) {
  const min = Math.max(0, Number(store.calculationTotalMin) || 0);
  const rawMax = store.calculationTotalMax === '' ? Infinity : Math.max(0, Number(store.calculationTotalMax) || 0);
  return { min, max: rawMax === Infinity ? Infinity : Math.max(min, rawMax) };
}

function isInCalculationTotalRange(store: Store, total: number) {
  const range = calculationTotalRange(store);
  return total + 1e-9 >= range.min && total <= range.max + 1e-9;
}

function calculationRangeText(store: Store) {
  const range = calculationTotalRange(store);
  return `¥${money(range.min)}-${range.max === Infinity ? '不限' : `¥${money(range.max)}`}`;
}

function stapleCountRange(store: Store) {
  const min = Math.max(0, Math.floor(Number(store.stapleCountMin) || 0));
  const max = store.stapleCountMax === '' ? Infinity : Math.max(min, Math.floor(Number(store.stapleCountMax) || 0));
  return { min, max };
}

function stapleCountRangeText(store: Store) {
  const range = stapleCountRange(store);
  return `${range.min}-${range.max === Infinity ? '不限' : range.max} 份`;
}

function productStapleServingCount(product: Pick<Product, 'stapleServingCount'>) {
  return Math.max(0, Math.floor(Number(product.stapleServingCount) || 0));
}

function comboStapleServingCount(items: ComboItem[]) {
  return items.reduce((sum, item) => sum + item.stapleServingCount * item.qty, 0);
}

function isInStapleCountRange(store: Store, stapleCount: number) {
  const range = stapleCountRange(store);
  return stapleCount + 1e-9 >= range.min && stapleCount <= range.max + 1e-9;
}

function canContinueByStapleRange(store: Store, index: number, currentStapleCount: number, suffixMaxStaple: number[]) {
  const range = stapleCountRange(store);
  if (currentStapleCount > range.max + 1e-9) return false;
  return currentStapleCount + (suffixMaxStaple[index] || 0) + 1e-9 >= range.min;
}

function buildCalculationPriceBounds(store: Store, platforms: Platform[]) {
  const minPrices: number[] = [];
  const maxPrices: number[] = [];
  const stapleCounts: number[] = [];
  store.products.forEach(product => {
    const prices = platforms
      .filter(platform => isProductListedOnPlatform(product, platform))
      .map(platform => platformOriginalUnitPrice(product, platform));
    minPrices.push(prices.length ? Math.min(...prices) : 0);
    maxPrices.push(prices.length ? Math.max(...prices) : 0);
    stapleCounts.push(productStapleServingCount(product));
  });
  const suffixMax: number[] = Array(store.products.length + 1).fill(0);
  const suffixMaxStaple: number[] = Array(store.products.length + 1).fill(0);
  for (let index = store.products.length - 1; index >= 0; index--) {
    suffixMax[index] = suffixMax[index + 1] + maxPrices[index] * store.maxQtyPerSku;
    suffixMaxStaple[index] = suffixMaxStaple[index + 1] + stapleCounts[index] * store.maxQtyPerSku;
  }
  return { minPrices, maxPrices, stapleCounts, suffixMax, suffixMaxStaple };
}

function canContinueByCalculationRange(store: Store, nextIndex: number, currentMinTotal: number, currentMaxTotal: number, suffixMax: number[]) {
  const range = calculationTotalRange(store);
  if (currentMinTotal > range.max + 1e-9) return false;
  if (currentMaxTotal + suffixMax[nextIndex] + 1e-9 < range.min) return false;
  return true;
}

function parseOrderMinutes(value: string) {
  const match = String(value ?? '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour === 24 && minute === 0) return 1440;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function calculateTimeFee(value: string) {
  const minutes = parseOrderMinutes(value);
  if (minutes === null) return 0;
  if (minutes > 0 && minutes <= 120) return 0.8;
  if (minutes > 120 && minutes <= 360) return 1;
  if (minutes > 1260 && minutes <= 1440) return 0.3;
  return 0;
}

function calculateFreightSubsidy(rule: FeeRule, distanceValue: number) {
  const distance = Math.max(0, Number(distanceValue) || 0);
  if (distance <= 3) return roundMoney(rule.freightWithin3);
  if (distance <= 5) return roundMoney(rule.freightWithin5);
  return roundMoney(rule.freightAbove5);
}

function calculateServiceFee(rule: FeeRule, store: Store, priceBasis: number) {
  const distance = Math.max(0, Number(store.deliveryDistance) || 0);
  const extraUnits = distance <= 3 ? 0 : Math.ceil(((distance - 3) * 10) - 1e-9);
  const distanceFee = roundMoney(rule.baseDeliveryFee + extraUnits * rule.extraDeliveryFee);
  const basis = Math.max(0, Number(priceBasis) || 0);
  let priceFee = 0;
  if (basis > 25) priceFee = 5 * rule.midPriceRate + (basis - 25) * rule.highPriceRate;
  else if (basis > 20) priceFee = (basis - 20) * rule.midPriceRate;
  return roundMoney(distanceFee + priceFee + calculateTimeFee(store.orderTime));
}

function buildFeeSummary(state: CalculatorState, store: Store, finalPay: number) {
  const rule = effectiveFeeRule(state, store);
  const commission = roundMoney(Math.max(finalPay * (rule.commissionRate / 100), rule.minCommission));
  const serviceFee = calculateServiceFee(rule, store, finalPay);
  const freightSubsidy = calculateFreightSubsidy(rule, store.deliveryDistance);
  return { commission, serviceFee, freightSubsidy };
}

function activityMatchesProduct(activity: DiscountActivity, product: Product) {
  const text = String(activity.productNames || '').trim();
  if (!text) return true;
  return text.split(/[,，、\s]+/).filter(Boolean).some(keyword => product.name.includes(keyword));
}

function applyProductDiscounts(units: Array<{ product: Product; price: number }>, activities: DiscountActivity[], maxDiscountItems: number | '') {
  const enabled = activities.filter(activity => activity.enabled);
  if (!enabled.length) return 0;
  const candidates: Array<{ unitIndex: number; activityIndex: number; amount: number }> = [];
  enabled.forEach((activity, activityIndex) => {
    units.forEach((unit, unitIndex) => {
      if (!activityMatchesProduct(activity, unit.product)) return;
      const discounted = roundMoney(unit.price * normalizeDiscountRate(activity.discountRate));
      const amount = roundMoney(unit.price - discounted);
      if (amount > 0) candidates.push({ unitIndex, activityIndex, amount });
    });
  });
  candidates.sort((a, b) => b.amount - a.amount);
  const globalLimit = maxDiscountItems === '' ? Infinity : Math.max(0, Number(maxDiscountItems) || 0);
  const activityLimits = enabled.map(activity => activity.itemLimit === '' ? Infinity : Math.max(0, Number(activity.itemLimit) || 0));
  const usedUnits = new Set<number>();
  let usedGlobal = 0;
  let total = 0;
  for (const candidate of candidates) {
    if (usedGlobal >= globalLimit) break;
    if (usedUnits.has(candidate.unitIndex)) continue;
    if (activityLimits[candidate.activityIndex] <= 0) continue;
    usedUnits.add(candidate.unitIndex);
    usedGlobal++;
    activityLimits[candidate.activityIndex]--;
    total += candidate.amount;
  }
  return roundMoney(total);
}

function buildPlatformTotals(store: Store, platform: Platform, qtys: number[]) {
  const units: Array<{ product: Product; price: number }> = [];
  const items: ComboItem[] = [];
  let originalTotal = 0;
  let costTotal = 0;
  let hasUnlistedProduct = false;
  store.products.forEach((product, index) => {
    const qty = qtys[index] || 0;
    if (qty <= 0) return;
    if (!isProductListedOnPlatform(product, platform)) {
      hasUnlistedProduct = true;
      return;
    }
    const price = platformPrice(product, platform);
    const packageFee = platformPackageFee(product, platform);
    const cost = Number(product.cost) || 0;
    originalTotal += (price + packageFee) * qty;
    costTotal += cost * qty;
    items.push({
      productId: product.id,
      name: product.name,
      qty,
      price,
      packageFee,
      cost,
      category: product.category,
      stapleServingCount: productStapleServingCount(product),
      nonStandalone: product.nonStandalone
    });
    for (let unitIndex = 0; unitIndex < qty; unitIndex++) units.push({ product, price });
  });
  if (hasUnlistedProduct) return { items: [], originalTotal: 0, costTotal: 0, productDiscount: 0, afterProductDiscount: 0 };
  const discount = applyProductDiscounts(units, store.activities[platform].discountActivities, store.maxDiscountItems);
  return {
    items,
    originalTotal: roundMoney(originalTotal),
    costTotal: roundMoney(costTotal),
    productDiscount: roundMoney(discount),
    afterProductDiscount: roundMoney(originalTotal - discount)
  };
}

function bestFullReduction(rows: FullReduction[], basis: number): FullReduction {
  return rows
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0] || { enabled: true, threshold: 0, amount: 0 };
}

function bestBaseRed(state: CalculatorState, platform: Platform, basis: number): RedTier & { amount: number } {
  const tier = state.platformRules.redTiers[platform]
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => b.max - a.max || b.threshold - a.threshold)[0];
  if (!tier) return { enabled: true, threshold: 0, min: 0, max: 0, amount: 0 };
  return { ...tier, amount: roundMoney(Math.max(0, Number(tier.max) || 0)) };
}

function bestRedAddOn(rows: RedAddOn[], basis: number): RedAddOn {
  return rows
    .filter(row => row.enabled && basis + 1e-9 >= row.threshold)
    .sort((a, b) => b.amount - a.amount || b.threshold - a.threshold)[0] || { enabled: true, threshold: 0, amount: 0 };
}

function eligibleCouponOptions(coupons: Coupon[], basis: number, maxCoupons: number) {
  const eligible = coupons.filter(coupon => coupon.enabled && basis + 1e-9 >= coupon.threshold);
  const options: Array<{ coupons: Coupon[]; amount: number }> = [{ coupons: [], amount: 0 }];
  function dfs(start: number, chosen: Coupon[], amount: number) {
    if (chosen.length >= maxCoupons) return;
    for (let i = start; i < eligible.length; i++) {
      const coupon = eligible[i];
      const next = chosen.concat(coupon);
      const nextAmount = roundMoney(amount + coupon.amount);
      options.push({ coupons: next, amount: nextAmount });
      dfs(i + 1, next, nextAmount);
    }
  }
  if (maxCoupons > 0) dfs(0, [], 0);
  return options;
}

function bestCouponOption(coupons: Coupon[], basis: number, maxCoupons: number) {
  return eligibleCouponOptions(coupons, basis, maxCoupons)
    .filter(option => option.amount <= basis + 1e-9)
    .sort((a, b) => b.amount - a.amount || b.coupons.length - a.coupons.length)[0] || { coupons: [], amount: 0 };
}

function evaluateCombo(state: CalculatorState, store: Store, platform: Platform, qtys: number[]) {
  const totals = buildPlatformTotals(store, platform, qtys);
  if (!totals.items.length) return [];
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return [];
  if (totals.afterProductDiscount + 1e-9 < store.startPrice) return [];
  const activity = store.activities[platform];
  const full = bestFullReduction(activity.fullReductions, totals.afterProductDiscount);
  const afterFull = Math.max(0, roundMoney(totals.afterProductDiscount - full.amount));
  const couponOptions = eligibleCouponOptions(activity.coupons, afterFull, store.maxCoupons);
  const output: ResultRow[] = [];
  for (const couponOption of couponOptions) {
    const afterCoupon = Math.max(0, roundMoney(afterFull - couponOption.amount));
    const baseRed = bestBaseRed(state, platform, afterCoupon);
    const addOn = bestRedAddOn(activity.redAddOns, afterCoupon);
    const finalPay = Math.max(0, roundMoney(afterCoupon - baseRed.amount - addOn.amount));
    const fee = buildFeeSummary(state, store, finalPay);
    const activityAmount = roundMoney(totals.productDiscount + full.amount + couponOption.amount + baseRed.amount + addOn.amount + fee.freightSubsidy);
    const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
    const profit = roundMoney(netPay - totals.costTotal);
    output.push({
      key: '',
      platform,
      platformName: PLATFORM_NAMES[platform],
      items: totals.items,
      finalPay,
      cost: totals.costTotal,
      activityAmount,
      commission: fee.commission,
      serviceFee: fee.serviceFee,
      freightSubsidy: fee.freightSubsidy,
      profit,
      profitRate: finalPay > 0 ? profit / finalPay : null,
      netPay,
      netProfitRate: netPay > 0 ? profit / netPay : profit < 0 ? -1 : null,
      productDiscount: totals.productDiscount,
      full,
      coupons: couponOption.coupons,
      couponAmount: couponOption.amount,
      baseRed,
      redAddOn: addOn,
      originalTotal: totals.originalTotal,
      afterProductDiscount: totals.afterProductDiscount
    });
  }
  return output;
}

function targetForPayExtended(pay: number, targets: ProfitTarget[]) {
  if (!targets.length) return null;
  const sorted = targets.slice().sort((a, b) => a.payMin - b.payMin);
  const matched = sorted.find((target, index) => {
    const isLast = index === sorted.length - 1;
    return pay + 1e-9 >= target.payMin && (isLast || pay <= target.payMax + 1e-9);
  });
  return matched || null;
}

function pricingScenarioForStapleCount(stapleCount: number): StapleScenario {
  const normalized = Math.max(0, Math.floor(Number(stapleCount) || 0));
  if (normalized >= 3) return 'multi';
  if (normalized === 2) return 'double';
  return 'single';
}

function pricingTierName(tier: PricingStrategyTier | null) {
  if (!tier) return '未匹配策略';
  return `实付¥${money(tier.payMin)}-${tier.payMax >= 9999 ? '不限' : `¥${money(tier.payMax)}`}`;
}

function pricingStrategyTargetForPay(state: CalculatorState, store: Store, finalPay: number, stapleCount: number) {
  const scenario = pricingScenarioForStapleCount(stapleCount);
  const strategy = effectiveFeeRule(state, store).pricingStrategy || DEFAULT_PRICING_STRATEGY;
  const rows = (strategy[scenario] || DEFAULT_PRICING_STRATEGY[scenario])
    .filter(row => row.enabled)
    .sort((a, b) => a.payMin - b.payMin || a.payMax - b.payMax);
  const tier = rows.find((row, index) => {
    const isLast = index === rows.length - 1;
    return finalPay + 1e-9 >= row.payMin && (isLast || finalPay <= row.payMax + 1e-9);
  }) || rows[rows.length - 1] || null;
  return {
    scenario,
    scenarioName: stapleScenarioName(scenario),
    tier,
    tierName: pricingTierName(tier),
    requiredPayRate: Math.max(0, Number(tier?.payRateMin) || 0) / 100,
    targetPayRate: Math.max(0, Number(tier?.payRateTarget) || 0) / 100,
    requiredNetRate: Math.max(0, Number(tier?.netRateMin) || 0) / 100,
    targetNetRate: Math.max(0, Number(tier?.netRateTarget) || 0) / 100
  };
}

function profitRateByBasis(profit: number, basis: number) {
  return basis > 0 ? profit / basis : profit < 0 ? -1 : null;
}

function pricingAffordableSpace(profit: number, finalPay: number, netPay: number, target: ReturnType<typeof pricingStrategyTargetForPay>) {
  const paySpace = roundMoney(profit - finalPay * target.targetPayRate);
  const netSpace = roundMoney(profit - netPay * target.targetNetRate);
  return Math.min(paySpace, netSpace);
}

function isBelowPricingMinimum(profit: number, payProfitRate: number | null, netProfitRate: number | null, target: ReturnType<typeof pricingStrategyTargetForPay>) {
  return profit < 0 ||
    payProfitRate === null ||
    netProfitRate === null ||
    payProfitRate + 1e-9 < target.requiredPayRate ||
    netProfitRate + 1e-9 < target.requiredNetRate;
}

function isBelowPricingTarget(profit: number, payProfitRate: number | null, netProfitRate: number | null, target: ReturnType<typeof pricingStrategyTargetForPay>) {
  return profit < 0 ||
    payProfitRate === null ||
    netProfitRate === null ||
    payProfitRate + 1e-9 < target.targetPayRate ||
    netProfitRate + 1e-9 < target.targetNetRate;
}

function severityRank(severity: Severity) {
  return { none: 0, config: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(b) > severityRank(a) ? b : a;
}

function buildRiskInfo(state: CalculatorState, store: Store, row: ResultRow): RiskInfo {
  const target = pricingStrategyTargetForPay(state, store, row.finalPay, comboStapleServingCount(row.items));
  const marginRate = (Number(state.riskSafetyMargin) || 0) / 100;
  const reasons: string[] = [];
  let severity: Severity = 'none';
  const thresholdRate = target.requiredPayRate + marginRate;
  const netThresholdRate = target.requiredNetRate + marginRate;
  const rateGap = Number.isFinite(row.profitRate) ? (row.profitRate as number) - thresholdRate : null;
  const netRateGap = Number.isFinite(row.netProfitRate) ? (row.netProfitRate as number) - netThresholdRate : null;
  if (row.profit < 0) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('亏损');
  }
  if (row.finalPay + 1e-9 < row.cost) {
    severity = maxSeverity(severity, 'high');
    reasons.push('用户实付低于成本');
  }
  if (!target.tier) {
    severity = maxSeverity(severity, 'config');
    reasons.push('未匹配定价策略阶梯');
  }
  if (!Number.isFinite(row.profitRate) || (row.profitRate as number) + 1e-9 < thresholdRate) {
    severity = maxSeverity(severity, row.profit < 0 ? 'critical' : 'medium');
    reasons.push(`实付利润率低于${money((target.requiredPayRate + marginRate) * 100)}%下限`);
  }
  if (!Number.isFinite(row.netProfitRate) || (row.netProfitRate as number) + 1e-9 < netThresholdRate) {
    severity = maxSeverity(severity, row.profit < 0 ? 'critical' : 'medium');
    reasons.push(`到手利润率低于${money((target.requiredNetRate + marginRate) * 100)}%下限`);
  }
  return {
    hasRisk: severity !== 'none',
    severity,
    severityRank: severityRank(severity),
    reasons,
    target: target.tier,
    thresholdRate,
    rateGap,
    netThresholdRate,
    netRateGap
  };
}

function annotateRiskWarnings(state: CalculatorState, rows: ResultRow[]) {
  const store = currentStoreFrom(state);
  return rows.map(row => ({ ...row, risk: buildRiskInfo(state, store, row) }));
}

function dedupeResults(results: ResultRow[]) {
  const seen = new Set<string>();
  const output: ResultRow[] = [];
  for (const result of results) {
    const itemKey = result.items.map(item => `${item.name}:${item.qty}`).join('|');
    const couponKey = result.coupons.map(coupon => `${coupon.name}:${coupon.amount}`).join('|');
    const key = [result.platform, itemKey, result.finalPay, result.full.amount, couponKey, result.baseRed.amount, result.redAddOn.amount].join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({ ...result, key });
  }
  return output;
}

function runComboCalculation(state: CalculatorState, platformFilter: Platform | 'all') {
  const start = performance.now();
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const results: ResultRow[] = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  for (const platform of platforms) {
    const enumeration = enumerateStoreCombos(store, [platform], qtys => {
      results.push(...evaluateCombo(state, store, platform, qtys));
    });
    checked += enumeration.checked;
    validCombos += enumeration.validCombos;
    stopped = stopped || enumeration.stopped;
  }
  if (stopped) warnings.push(`已达到最多检查组合数 ${store.maxChecks}，已停止继续枚举。`);
  const rows = annotateRiskWarnings(state, dedupeResults(results).sort((a, b) => a.finalPay - b.finalPay));
  return {
    rows,
    warnings,
    summary: {
      resultCount: rows.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(performance.now() - start)
    }
  };
}

async function runComboCalculationAsync(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  onProgress?: (progress: CalculationProgress) => void
) {
  const start = calculationNow();
  const store = currentStoreFrom(state);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const results: ResultRow[] = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: ComboEnumerationSummary['stoppedReason'];

  await yieldToBrowser();
  for (const platform of platforms) {
    const checkedBeforePlatform = checked;
    const validBeforePlatform = validCombos;
    const enumeration = await enumerateStoreCombosAsync(
      store,
      [platform],
      qtys => {
        results.push(...evaluateCombo(state, store, platform, qtys));
      },
      progress => onProgress?.({
        resultCount: results.length,
        comboCount: checkedBeforePlatform + progress.checked,
        validComboCount: validBeforePlatform + progress.validCombos
      })
    );
    checked += enumeration.checked;
    validCombos += enumeration.validCombos;
    stopped = stopped || enumeration.stopped;
    stoppedReason = stoppedReason || enumeration.stoppedReason;
    if (stoppedReason === 'maxDuration') break;
  }

  const stopWarning = comboEnumerationStopWarning(stopped, stoppedReason, store.maxChecks);
  if (stopWarning) warnings.push(stopWarning);
  await yieldToBrowser();
  const rows = annotateRiskWarnings(state, dedupeResults(results).sort((a, b) => a.finalPay - b.finalPay));
  return {
    rows,
    warnings,
    summary: {
      resultCount: rows.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(calculationNow() - start)
    }
  };
}

function enumerateStoreCombos(store: Store, platforms: Platform[], visit: (qtys: number[]) => void) {
  const priceBounds = buildCalculationPriceBounds(store, platforms);
  const qtys = Array(store.products.length).fill(0);
  let checked = 0;
  let validCombos = 0;
  let stopped = false;

  function dfs(index: number, totalQty: number, currentMinTotal: number, currentMaxTotal: number, currentStapleCount: number) {
    if (stopped) return;
    if (!canContinueByCalculationRange(store, index, currentMinTotal, currentMaxTotal, priceBounds.suffixMax)) return;
    if (!canContinueByStapleRange(store, index, currentStapleCount, priceBounds.suffixMaxStaple)) return;
    if (index === store.products.length) {
      if (totalQty === 0) return;
      checked++;
      if (checked > store.maxChecks) {
        stopped = true;
        return;
      }
      if (!qtys.some((qty, i) => qty > 0 && !store.products[i].nonStandalone)) return;
      if (!isInStapleCountRange(store, currentStapleCount)) return;
      validCombos++;
      visit(qtys.slice());
      return;
    }
    const canSellOnSelectedPlatforms = platforms.some(platform => isProductListedOnPlatform(store.products[index], platform));
    const maxQty = canSellOnSelectedPlatforms ? Math.min(store.maxQtyPerSku, store.maxItems - totalQty) : 0;
    for (let qty = 0; qty <= maxQty; qty++) {
      qtys[index] = qty;
      const nextMinTotal = currentMinTotal + priceBounds.minPrices[index] * qty;
      const nextMaxTotal = currentMaxTotal + priceBounds.maxPrices[index] * qty;
      const nextStapleCount = currentStapleCount + priceBounds.stapleCounts[index] * qty;
      if (canContinueByCalculationRange(store, index + 1, nextMinTotal, nextMaxTotal, priceBounds.suffixMax)) {
        dfs(index + 1, totalQty + qty, nextMinTotal, nextMaxTotal, nextStapleCount);
      }
      if (stopped) return;
    }
    qtys[index] = 0;
  }

  if (store.products.length) dfs(0, 0, 0, 0, 0);
  return { checked, validCombos, stopped };
}

function calculationNow() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function yieldToBrowser() {
  return new Promise<void>(resolve => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

async function enumerateStoreCombosAsync(
  store: Store,
  platforms: Platform[],
  visit: (qtys: number[]) => void,
  onProgress?: (summary: ComboEnumerationSummary) => void
): Promise<ComboEnumerationSummary> {
  const startedAt = calculationNow();
  const priceBounds = buildCalculationPriceBounds(store, platforms);
  const qtys = Array(store.products.length).fill(0);
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: ComboEnumerationSummary['stoppedReason'];
  let visitedNodes = 0;
  let lastYieldAt = calculationNow();
  let lastProgressAt = calculationNow();

  function stop(reason: NonNullable<ComboEnumerationSummary['stoppedReason']>) {
    stopped = true;
    stoppedReason = reason;
  }

  function stopIfTimedOut(now = calculationNow()) {
    if (!stopped && now - startedAt >= ASYNC_CALCULATION_MAX_DURATION_MS) stop('maxDuration');
    return stopped;
  }

  function maybeYield(force = false) {
    visitedNodes++;
    const now = calculationNow();
    if (stopIfTimedOut(now)) return null;
    const shouldYield = force || visitedNodes % 500 === 0 || now - lastYieldAt >= 12;
    if (!shouldYield) return null;
    lastYieldAt = now;
    if (onProgress && now - lastProgressAt >= 120) {
      lastProgressAt = now;
      onProgress({ checked, validCombos, stopped, stoppedReason });
    }
    return yieldToBrowser();
  }

  async function dfs(index: number, totalQty: number, currentMinTotal: number, currentMaxTotal: number, currentStapleCount: number): Promise<void> {
    if (stopped) return;
    const yieldPromise = maybeYield();
    if (yieldPromise) await yieldPromise;
    if (!canContinueByCalculationRange(store, index, currentMinTotal, currentMaxTotal, priceBounds.suffixMax)) return;
    if (!canContinueByStapleRange(store, index, currentStapleCount, priceBounds.suffixMaxStaple)) return;
    if (index === store.products.length) {
      if (totalQty === 0) return;
      checked++;
      if (checked > store.maxChecks) {
        stop('maxChecks');
        return;
      }
      if (stopIfTimedOut()) return;
      if (!qtys.some((qty, i) => qty > 0 && !store.products[i].nonStandalone)) return;
      if (!isInStapleCountRange(store, currentStapleCount)) return;
      validCombos++;
      visit(qtys.slice());
      const forcedYieldPromise = maybeYield(checked % 200 === 0);
      if (forcedYieldPromise) await forcedYieldPromise;
      return;
    }
    const canSellOnSelectedPlatforms = platforms.some(platform => isProductListedOnPlatform(store.products[index], platform));
    const maxQty = canSellOnSelectedPlatforms ? Math.min(store.maxQtyPerSku, store.maxItems - totalQty) : 0;
    for (let qty = 0; qty <= maxQty; qty++) {
      qtys[index] = qty;
      const nextMinTotal = currentMinTotal + priceBounds.minPrices[index] * qty;
      const nextMaxTotal = currentMaxTotal + priceBounds.maxPrices[index] * qty;
      const nextStapleCount = currentStapleCount + priceBounds.stapleCounts[index] * qty;
      if (canContinueByCalculationRange(store, index + 1, nextMinTotal, nextMaxTotal, priceBounds.suffixMax)) {
        await dfs(index + 1, totalQty + qty, nextMinTotal, nextMaxTotal, nextStapleCount);
      }
      if (stopped) return;
    }
    qtys[index] = 0;
  }

  if (store.products.length) await dfs(0, 0, 0, 0, 0);
  onProgress?.({ checked, validCombos, stopped, stoppedReason });
  return { checked, validCombos, stopped, stoppedReason };
}

function severityLabel(severity: Severity) {
  return { critical: '严重', high: '高', medium: '中', config: '配置', none: '正常' }[severity];
}

function severityColor(severity: Severity) {
  return { critical: 'red', high: 'orange', medium: 'gold', config: 'purple', none: 'green' }[severity];
}

function average(values: number[]) {
  const valid = values.filter(Number.isFinite);
  if (!valid.length) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function targetMidRate(target: ProfitTarget | null) {
  return target ? ((Number(target.rateMin) || 0) + (Number(target.rateMax) || 0)) / 200 : null;
}

function costAnalysisOriginalRange(settings: ComboRangeSettings) {
  const min = Math.max(0, Number(settings.originalMin) || 0);
  const max = settings.originalMax === '' ? Infinity : Math.max(min, Number(settings.originalMax) || 0);
  return { min, max };
}

function costAnalysisOriginalRangeText(settings: ComboRangeSettings) {
  const range = costAnalysisOriginalRange(settings);
  return `¥${money(range.min)}-${range.max === Infinity ? '不限' : `¥${money(range.max)}`}`;
}

function isInCostAnalysisOriginalRange(settings: ComboRangeSettings, originalTotal: number) {
  const range = costAnalysisOriginalRange(settings);
  return originalTotal + 1e-9 >= range.min && originalTotal <= range.max + 1e-9;
}

function costAnalysisPayRange(settings: ComboRangeSettings) {
  const min = Math.max(0, Number(settings.payMin) || 0);
  const max = settings.payMax === '' ? Infinity : Math.max(min, Number(settings.payMax) || 0);
  return { min, max };
}

function costAnalysisPayRangeText(settings: ComboRangeSettings) {
  const range = costAnalysisPayRange(settings);
  return `¥${money(range.min)}-${range.max === Infinity ? '不限' : `¥${money(range.max)}`}`;
}

function isInCostAnalysisPayRange(settings: ComboRangeSettings, finalPay: number) {
  const range = costAnalysisPayRange(settings);
  return finalPay + 1e-9 >= range.min && finalPay <= range.max + 1e-9;
}

function normalizeCostProductKeyword(settings: ComboRangeSettings) {
  return String(settings.productNameKeyword || '').trim().toLowerCase();
}

function buildCostProductFilter(store: Store, settings: ComboRangeSettings) {
  const keyword = normalizeCostProductKeyword(settings);
  if (!keyword) return { keyword, productIds: null as Set<string> | null };
  return {
    keyword,
    productIds: new Set(store.products.filter(product => product.name.toLowerCase().includes(keyword)).map(product => product.id))
  };
}

function costIssueSeverity(issue: Omit<CostProductIssue, 'severity' | 'reasons'>) {
  const reasons: string[] = [];
  let severity: Severity = 'none';
  if (!issue.comboCount || issue.avgProfitRate === null || issue.minProfitRate === null) {
    return { severity: 'config' as Severity, reasons: ['没有命中有效组合'] };
  }
  if (issue.minProfitRate < 0 || (issue.minPayProfitRate !== null && issue.minPayProfitRate < 0)) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('存在亏损组合');
  }
  if (issue.lowCount >= issue.comboCount) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('所有组合均低于目标利润率');
  } else if (issue.avgProfitRate < issue.targetProfitRate || (issue.avgPayProfitRate !== null && issue.avgPayProfitRate < issue.targetPayProfitRate)) {
    severity = maxSeverity(severity, 'high');
    reasons.push('平均利润率低于目标利润率');
  } else if (issue.lowCount > 0) {
    severity = maxSeverity(severity, 'medium');
    reasons.push('部分组合低于目标利润率');
  }
  if ((issue.minAffordableSpace || 0) < 0) {
    severity = maxSeverity(severity, 'medium');
    reasons.push('目标利润率下剩余优惠空间不足');
  }
  if (!reasons.length) reasons.push('当前预留空间下满足目标利润率');
  return { severity, reasons };
}

function aggregateCostRedTierRows(rows: CostSpaceOrderRow[]) {
  const groups = new Map<string, {
    platform: Platform;
    platformName: string;
    tierName: string;
    threshold: number;
    amount: number;
    finalPays: number[];
    profitRates: number[];
    lowCount: number;
  }>();
  rows.forEach(row => {
    const threshold = row.baseRed.threshold;
    const amount = row.baseRed.amount;
    const tierName = amount > 0
      ? `${row.platform === 'meituan' ? '神券' : '爆红包'} 满${money(threshold)}减${money(amount)}`
      : `未命中${row.platform === 'meituan' ? '神券' : '爆红包'}`;
    const key = [row.platform, 'red', threshold, amount].join('::');
    const group = groups.get(key) || {
      platform: row.platform,
      platformName: row.platformName,
      tierName,
      threshold,
      amount,
      finalPays: [],
      profitRates: [],
      lowCount: 0
    };
    group.finalPays.push(row.netPay);
    if (row.profitRate !== null) group.profitRates.push(row.profitRate);
    if (row.profitRate === null || row.profitRate < row.targetNetRate) group.lowCount++;
    groups.set(key, group);
  });
  return Array.from(groups.entries()).map(([key, group]) => ({
    key,
    platform: group.platform,
    platformName: group.platformName,
    tierName: group.tierName,
    threshold: group.threshold,
    amount: group.amount,
    hitCount: group.finalPays.length,
    avgFinalPay: average(group.finalPays) || 0,
    avgProfitRate: average(group.profitRates),
    minProfitRate: group.profitRates.length ? Math.min(...group.profitRates) : null,
    maxProfitRate: group.profitRates.length ? Math.max(...group.profitRates) : null,
    lowCount: group.lowCount
  })).sort((a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') || a.threshold - b.threshold || a.amount - b.amount);
}

function buildCostAnalysisTotals(store: Store, platform: Platform, qtys: number[]) {
  const items: ComboItem[] = [];
  let originalTotal = 0;
  let costTotal = 0;
  let hasUnlistedProduct = false;
  store.products.forEach((product, index) => {
    const qty = qtys[index] || 0;
    if (qty <= 0) return;
    if (!isProductListedOnPlatform(product, platform)) {
      hasUnlistedProduct = true;
      return;
    }
    const price = platformPrice(product, platform);
    const packageFee = platformPackageFee(product, platform);
    const cost = Number(product.cost) || 0;
    originalTotal += (price + packageFee) * qty;
    costTotal += cost * qty;
    items.push({
      productId: product.id,
      name: product.name,
      qty,
      price,
      packageFee,
      cost,
      category: product.category,
      stapleServingCount: productStapleServingCount(product),
      nonStandalone: product.nonStandalone
    });
  });
  if (hasUnlistedProduct) return { items: [], originalTotal: 0, costTotal: 0 };
  return {
    items,
    originalTotal: roundMoney(originalTotal),
    costTotal: roundMoney(costTotal)
  };
}

function couponDesignBasisName(basis: CouponDesignBasis) {
  return basis === 'pay' ? '券前支付价' : '原价小计';
}

function couponDesignBasisValue(row: CouponDesignBaseRow, basis: CouponDesignBasis) {
  return basis === 'pay' ? row.preCouponPay : row.originalTotal;
}

function couponDesignThresholdStep(settings: ActivityDesignSettings) {
  return Math.max(1, Number(settings.couponDesignThresholdStep) || 5);
}

function couponDesignAmountStep(settings: ActivityDesignSettings) {
  return Math.max(0.1, Number(settings.couponDesignAmountStep) || 0.5);
}

function activityDesignMaxFullAmount(settings: ActivityDesignSettings, threshold: number, amountStep: number) {
  const configured = settings.couponDesignMaxFullAmount === '' ? 20 : Math.max(0, Number(settings.couponDesignMaxFullAmount) || 0);
  return Math.max(0, Math.min(configured, threshold - amountStep));
}

function activityDesignMaxCouponAmount(settings: ActivityDesignSettings, threshold: number, amountStep: number) {
  const configured = settings.couponDesignMaxCouponAmount === '' ? 20 : Math.max(0, Number(settings.couponDesignMaxCouponAmount) || 0);
  return Math.max(0, Math.min(configured, threshold - amountStep));
}

function activityDesignModeName(mode: ActivityDesignMode) {
  return { auto: '自动', full: '只满减', coupon: '只订单券', stacked: '满减+券' }[mode];
}

function steppedDown(value: number, step: number) {
  if (value <= 0) return 0;
  return roundMoney(Math.floor(value / step) * step);
}

function limitEvenly<T>(values: T[], limit: number) {
  if (values.length <= limit) return values;
  const output: T[] = [];
  for (let index = 0; index < limit; index++) {
    output.push(values[Math.round(index * (values.length - 1) / (limit - 1))]);
  }
  return Array.from(new Set(output));
}

function buildCouponDesignBaseRow(state: CalculatorState, store: Store, platform: Platform, qtys: number[], settings: ActivityDesignSettings): CouponDesignBaseRow | null {
  const totals = buildCostAnalysisTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (!isInCostAnalysisOriginalRange(settings, totals.originalTotal)) return null;
  if (totals.originalTotal + 1e-9 < store.startPrice) return null;
  const baselineRed = bestBaseRed(state, platform, totals.originalTotal);
  const afterBaselineRed = Math.max(0, roundMoney(totals.originalTotal - baselineRed.amount));
  const baselineRedAddOnSpace = Math.min(Math.max(0, Number(settings.redAddOnSpace) || 0), afterBaselineRed);
  const preCouponPay = Math.max(0, roundMoney(afterBaselineRed - baselineRedAddOnSpace));
  const itemKey = totals.items.map(item => `${item.productId}:${item.qty}`).join('|');
  return {
    key: [platform, itemKey].join('::'),
    platform,
    platformName: PLATFORM_NAMES[platform],
    items: totals.items,
    originalTotal: totals.originalTotal,
    preCouponPay,
    cost: totals.costTotal
  };
}

function simulateCouponDesignRow(state: CalculatorState, store: Store, row: CouponDesignBaseRow, settings: ActivityDesignSettings, fullAmount: number, couponAmount: number) {
  const fullDiscount = Math.min(Math.max(0, Number(fullAmount) || 0), row.originalTotal);
  const afterFull = Math.max(0, roundMoney(row.originalTotal - fullDiscount));
  const couponDiscount = Math.min(Math.max(0, Number(couponAmount) || 0), afterFull);
  const afterCoupon = Math.max(0, roundMoney(afterFull - couponDiscount));
  const baseRed = bestBaseRed(state, row.platform, afterCoupon);
  const afterBaseRed = Math.max(0, roundMoney(afterCoupon - baseRed.amount));
  const redAddOnSpace = Math.min(Math.max(0, Number(settings.redAddOnSpace) || 0), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOnSpace));
  if (!isInCostAnalysisPayRange(settings, finalPay)) return null;
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const profit = roundMoney(netPay - row.cost);
  const profitRate = netPay > 0 ? profit / netPay : profit < 0 ? -1 : null;
  const payProfitRate = profitRateByBasis(profit, finalPay);
  const strategyTarget = pricingStrategyTargetForPay(state, store, finalPay, comboStapleServingCount(row.items));
  return {
    row,
    finalPay,
    netPay,
    profit,
    profitRate,
    payProfitRate,
    targetNetRate: strategyTarget.targetNetRate,
    targetPayRate: strategyTarget.targetPayRate,
    requiredNetRate: strategyTarget.requiredNetRate,
    requiredPayRate: strategyTarget.requiredPayRate,
    baseRedAmount: baseRed.amount,
    redAddOnSpace
  };
}

type ActivityScenarioSummary = {
  simulations: NonNullable<ReturnType<typeof simulateCouponDesignRow>>[];
  avgProfitRate: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  spread: number | null;
  avgFinalPay: number;
  avgNetPay: number;
  avgBaseRedAmount: number;
  avgRedAddOnSpace: number;
  avgTargetNetRate: number;
  avgTargetPayRate: number;
  avgNetTargetGap: number | null;
  avgPayTargetGap: number | null;
};

function summarizeActivityScenario(state: CalculatorState, store: Store, rows: CouponDesignBaseRow[], settings: ActivityDesignSettings, fullAmount: number, couponAmount: number, targetDropRate = 0): ActivityScenarioSummary | null {
  const simulations = rows
    .map(row => simulateCouponDesignRow(state, store, row, settings, fullAmount, couponAmount))
    .filter((row): row is NonNullable<ReturnType<typeof simulateCouponDesignRow>> => row !== null && row.profitRate !== null);
  if (!simulations.length) return null;
  if (simulations.some(row => row.profit < 0)) return null;
  const profitRates = simulations.map(row => row.profitRate as number);
  const minProfitRate = Math.min(...profitRates);
  const maxProfitRate = Math.max(...profitRates);
  const adjustedNetTargets = simulations.map(row => Math.max(0, row.targetNetRate - targetDropRate));
  const adjustedPayTargets = simulations.map(row => Math.max(0, row.targetPayRate - targetDropRate));
  return {
    simulations,
    avgProfitRate: average(profitRates),
    minProfitRate,
    maxProfitRate,
    spread: roundMoney(maxProfitRate - minProfitRate),
    avgFinalPay: average(simulations.map(row => row.finalPay)) || 0,
    avgNetPay: average(simulations.map(row => row.netPay)) || 0,
    avgBaseRedAmount: average(simulations.map(row => row.baseRedAmount)) || 0,
    avgRedAddOnSpace: average(simulations.map(row => row.redAddOnSpace)) || 0,
    avgTargetNetRate: average(adjustedNetTargets) || 0,
    avgTargetPayRate: average(adjustedPayTargets) || 0,
    avgNetTargetGap: average(simulations.map((row, index) => (row.profitRate as number) - adjustedNetTargets[index])),
    avgPayTargetGap: average(simulations.map((row, index) => (row.payProfitRate ?? -1) - adjustedPayTargets[index]))
  };
}

function normalizeDiscountCandidates(amount: number, step: number, maxAmount: number) {
  const base = roundMoney(Math.round(amount / step) * step);
  return Array.from(new Set([base - step, base, base + step]
    .map(value => roundMoney(clamp(value, 0, maxAmount)))))
    .sort((a, b) => a - b);
}

function findDiscountForTarget(
  state: CalculatorState,
  store: Store,
  rows: CouponDesignBaseRow[],
  settings: ActivityDesignSettings,
  fixedFullAmount: number,
  maxAmount: number,
  targetDropRate: number,
  kind: 'full' | 'coupon'
) {
  if (maxAmount <= 0) return 0;
  let low = 0;
  let high = maxAmount;
  let best = 0;
  for (let index = 0; index < 8; index++) {
    const mid = roundMoney((low + high) / 2);
    const fullAmount = kind === 'full' ? mid : fixedFullAmount;
    const couponAmount = kind === 'coupon' ? mid : 0;
    const summary = summarizeActivityScenario(state, store, rows, settings, fullAmount, couponAmount, targetDropRate);
    if (!summary || summary.avgProfitRate === null) {
      high = mid;
      continue;
    }
    if ((summary.avgNetTargetGap ?? -Infinity) >= 0 && (summary.avgPayTargetGap ?? -Infinity) >= 0) {
      best = mid;
      low = mid;
    } else {
      high = mid;
    }
  }
  return best;
}

function sortCouponDesignRows(rows: CouponDesignRow[]) {
  return rows.sort((a, b) => a.score - b.score || b.hitCount - a.hitCount || a.threshold - b.threshold);
}

async function buildCouponDesignRowsAsync(
  state: CalculatorState,
  store: Store,
  baseRows: CouponDesignBaseRow[],
  settings: ActivityDesignSettings,
  onProgress?: (rows: CouponDesignRow[]) => void
): Promise<CouponDesignRow[]> {
  if (!baseRows.length) return [];
  const basis = settings.couponDesignBasis;
  const basisName = couponDesignBasisName(basis);
  const thresholdStep = couponDesignThresholdStep(settings);
  const amountStep = couponDesignAmountStep(settings);
  const couponDropRate = Math.max(0, Number(settings.couponProfitDrop) || 0) / 100;
  const grouped = new Map<Platform, CouponDesignBaseRow[]>();
  baseRows.forEach(row => {
    const rows = grouped.get(row.platform) || [];
    rows.push(row);
    grouped.set(row.platform, rows);
  });
  const output: CouponDesignRow[] = [];
  let processedThresholds = 0;
  let lastYieldAt = calculationNow();

  for (const [platform, platformRows] of grouped.entries()) {
    const thresholds = Array.from(new Set(platformRows
      .map(row => steppedDown(couponDesignBasisValue(row, basis), thresholdStep))
      .filter(value => value > 0)))
      .sort((a, b) => a - b);
    const limitedThresholds = limitEvenly(thresholds, 30);

    for (const threshold of limitedThresholds) {
      const eligible = platformRows.filter(row => couponDesignBasisValue(row, basis) + 1e-9 >= threshold);
      if (!eligible.length) continue;
      const searchRows = eligible.length > 250 ? limitEvenly(eligible, 250) : eligible;
      let best: CouponDesignRow | null = null;
      const maxFull = activityDesignMaxFullAmount(settings, threshold, amountStep);
      const maxCoupon = activityDesignMaxCouponAmount(settings, threshold, amountStep);
      const modes: ActivityDesignMode[] = settings.designMode === 'auto' ? ['full', 'coupon', 'stacked'] : [settings.designMode];

      modes.forEach(mode => {
        const targetFullAmount = mode === 'coupon'
          ? 0
          : findDiscountForTarget(state, store, searchRows, settings, 0, maxFull, 0, 'full');
        const fullCandidates = mode === 'coupon' ? [0] : normalizeDiscountCandidates(targetFullAmount, amountStep, maxFull);
        fullCandidates.forEach(fullAmount => {
          const noCouponSummary = summarizeActivityScenario(state, store, eligible, settings, fullAmount, 0, 0);
          if (!noCouponSummary || noCouponSummary.avgProfitRate === null) return;
          const noCouponAvgProfitRate = noCouponSummary.avgProfitRate;
          if ((noCouponSummary.avgNetTargetGap ?? -Infinity) < -0.005 || (noCouponSummary.avgPayTargetGap ?? -Infinity) < -0.005) return;

          const targetCouponAmount = mode === 'full'
            ? 0
            : findDiscountForTarget(state, store, searchRows, settings, fullAmount, maxCoupon, couponDropRate, 'coupon');
          const couponCandidates = mode === 'full' ? [0] : normalizeDiscountCandidates(targetCouponAmount, amountStep, maxCoupon);
          couponCandidates.forEach(couponAmount => {
            if (mode === 'coupon' && couponAmount <= 0) return;
            if (mode === 'stacked' && (fullAmount <= 0 || couponAmount <= 0)) return;
            const couponSummary = summarizeActivityScenario(state, store, eligible, settings, fullAmount, couponAmount, couponDropRate);
            if (!couponSummary || couponSummary.avgProfitRate === null) return;
            const couponAvgProfitRate = couponSummary.avgProfitRate;
            if ((couponSummary.avgNetTargetGap ?? -Infinity) < -0.005 || (couponSummary.avgPayTargetGap ?? -Infinity) < -0.005) return;

            const noCouponGap = Math.min(noCouponSummary.avgNetTargetGap ?? 0, noCouponSummary.avgPayTargetGap ?? 0);
            const couponGap = Math.min(couponSummary.avgNetTargetGap ?? 0, couponSummary.avgPayTargetGap ?? 0);
            const spreadPenalty = ((noCouponSummary.spread || 0) + (couponSummary.spread || 0)) * 0.2;
            const score = Math.abs(noCouponGap) + Math.abs(couponGap) * 0.8 + spreadPenalty;
            const example = couponSummary.simulations.reduce((current, next) => {
              const currentTarget = Math.max(0, current.targetNetRate - couponDropRate);
              const nextTarget = Math.max(0, next.targetNetRate - couponDropRate);
              const currentGap = current.profitRate === null ? Infinity : Math.abs(current.profitRate - currentTarget);
              const nextGap = next.profitRate === null ? Infinity : Math.abs(next.profitRate - nextTarget);
              return nextGap > currentGap ? next : current;
            }, couponSummary.simulations[0]);
            const candidate: CouponDesignRow = {
              key: [platform, basis, threshold, mode, fullAmount, couponAmount, couponSummary.simulations.length].join('::'),
              platform,
              platformName: PLATFORM_NAMES[platform],
              basis,
              basisName,
              threshold,
              fullAmount,
              couponAmount,
              totalDiscount: roundMoney(fullAmount + couponAmount),
              mode,
              modeName: activityDesignModeName(mode),
              hitCount: couponSummary.simulations.length,
              eligibleCount: eligible.length,
              coverageRate: couponSummary.simulations.length / platformRows.length,
              avgOriginalTotal: average(couponSummary.simulations.map(row => row.row.originalTotal)) || 0,
              avgFinalPay: couponSummary.avgFinalPay,
              avgNetPay: couponSummary.avgNetPay,
              avgProfitRate: couponAvgProfitRate,
              noCouponAvgProfitRate,
              noCouponMinProfitRate: noCouponSummary.minProfitRate,
              couponAvgProfitRate,
              couponMinProfitRate: couponSummary.minProfitRate,
              couponTargetProfitRate: couponSummary.avgTargetNetRate,
              profitRateSpread: couponSummary.spread,
              minProfitRate: couponSummary.minProfitRate,
              maxProfitRate: couponSummary.maxProfitRate,
              targetProfitRate: noCouponSummary.avgTargetNetRate,
              profitRateGap: noCouponGap,
              avgBaseRedAmount: couponSummary.avgBaseRedAmount,
              avgRedAddOnSpace: couponSummary.avgRedAddOnSpace,
              score,
              example: {
                items: example.row.items,
                originalTotal: example.row.originalTotal,
                finalPay: example.finalPay,
                profitRate: example.profitRate
              }
            };
            if (
              !best ||
              candidate.score < best.score ||
              (Math.abs(candidate.score - best.score) < 1e-9 && candidate.hitCount > best.hitCount) ||
              (Math.abs(candidate.score - best.score) < 1e-9 && candidate.hitCount === best.hitCount && candidate.totalDiscount < best.totalDiscount)
            ) {
              best = candidate;
            }
          });
        });
      });
      if (best) output.push(best);
      processedThresholds++;
      const now = calculationNow();
      if (processedThresholds % 2 === 0 || now - lastYieldAt >= 12) {
        lastYieldAt = now;
        onProgress?.(sortCouponDesignRows(output.slice()).slice(0, 30));
        await yieldToBrowser();
      }
    }
  }

  return sortCouponDesignRows(output).slice(0, 30);
}

function evaluateCostSpaceCombo(state: CalculatorState, store: Store, platform: Platform, qtys: number[], settings: CostAnalysisSettings): CostSpaceOrderRow | null {
  const totals = buildCostAnalysisTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (!isInCostAnalysisOriginalRange(settings, totals.originalTotal)) return null;
  if (totals.originalTotal + 1e-9 < store.startPrice) return null;
  const couponSpace = Math.min(Math.max(0, Number(settings.couponSpace) || 0), totals.originalTotal);
  const afterCouponSpace = Math.max(0, roundMoney(totals.originalTotal - couponSpace));
  const baseRed = bestBaseRed(state, platform, afterCouponSpace);
  const afterBaseRed = Math.max(0, roundMoney(afterCouponSpace - baseRed.amount));
  const redAddOnSpace = Math.min(Math.max(0, Number(settings.redAddOnSpace) || 0), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOnSpace));
  if (!isInCostAnalysisPayRange(settings, finalPay)) return null;
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const profit = roundMoney(netPay - totals.costTotal);
  const profitRate = netPay > 0 ? profit / netPay : profit < 0 ? -1 : null;
  const payProfitRate = profitRateByBasis(profit, finalPay);
  const strategyTarget = pricingStrategyTargetForPay(state, store, finalPay, comboStapleServingCount(totals.items));
  const itemKey = totals.items.map(item => `${item.productId}:${item.qty}`).join('|');
  return {
    key: [platform, itemKey, finalPay, couponSpace, baseRed.amount, redAddOnSpace].join('::'),
    platform,
    platformName: PLATFORM_NAMES[platform],
    items: totals.items,
    originalTotal: totals.originalTotal,
    afterProductDiscount: totals.originalTotal,
    baseRed,
    couponSpace,
    redAddOnSpace,
    reservedActivitySpace: roundMoney(couponSpace + redAddOnSpace),
    finalPay,
    netPay,
    cost: totals.costTotal,
    commission: fee.commission,
    serviceFee: fee.serviceFee,
    freightSubsidy: fee.freightSubsidy,
    profit,
    profitRate,
    payProfitRate,
    requiredNetRate: strategyTarget.requiredNetRate,
    targetNetRate: strategyTarget.targetNetRate,
    requiredPayRate: strategyTarget.requiredPayRate,
    targetPayRate: strategyTarget.targetPayRate,
    strategyScenarioName: strategyTarget.scenarioName,
    strategyTierName: strategyTarget.tierName
  };
}

function allocateCostSpaceItems(row: CostSpaceOrderRow): ProductCostComboDetail[] {
  const grossTotal = row.items.reduce((sum, item) => sum + comboItemOriginalAmount(item), 0);
  const totalCouponDiscount = roundMoney(row.couponSpace);
  const afterCouponItems = row.items.map(item => {
    const grossAmount = comboItemOriginalAmount(item);
    const grossShare = grossTotal > 0 ? grossAmount / grossTotal : 1 / Math.max(1, row.items.length);
    return {
      item,
      grossAmount,
      grossShare,
      afterCouponAmount: Math.max(0, roundMoney(grossAmount - totalCouponDiscount * grossShare))
    };
  });
  const afterCouponTotal = afterCouponItems.reduce((sum, entry) => sum + entry.afterCouponAmount, 0);
  const afterBaseRedItems = afterCouponItems.map(entry => {
    const couponShare = afterCouponTotal > 0 ? entry.afterCouponAmount / afterCouponTotal : entry.grossShare;
    const baseRedShare = roundMoney(row.baseRed.amount * couponShare);
    return {
      ...entry,
      afterBaseRedAmount: Math.max(0, roundMoney(entry.afterCouponAmount - baseRedShare))
    };
  });
  const afterBaseRedTotal = afterBaseRedItems.reduce((sum, entry) => sum + entry.afterBaseRedAmount, 0);
  return afterBaseRedItems.map(entry => {
    const item = entry.item;
    const share = afterBaseRedTotal > 0 ? entry.afterBaseRedAmount / afterBaseRedTotal : entry.grossShare;
    const productFinalPay = roundMoney(row.finalPay * share);
    const productCost = roundMoney(item.cost * item.qty);
    const productFee = roundMoney((row.commission + row.serviceFee + row.freightSubsidy) * share);
    const productNetPay = Math.max(0, roundMoney(productFinalPay - productFee));
    const productProfit = roundMoney(productNetPay - productCost);
    const productProfitRate = productNetPay > 0 ? productProfit / productNetPay : productProfit < 0 ? -1 : null;
    const productPayProfitRate = profitRateByBasis(productProfit, productFinalPay);
    const target = {
      requiredPayRate: row.requiredPayRate,
      targetPayRate: row.targetPayRate,
      requiredNetRate: row.requiredNetRate,
      targetNetRate: row.targetNetRate
    };
    const affordableSpace = productProfitRate === null || productPayProfitRate === null
      ? null
      : Math.min(
        roundMoney(productProfit - productNetPay * target.targetNetRate),
        roundMoney(productProfit - productFinalPay * target.targetPayRate)
      );
    const belowMinimum = productProfit < 0 ||
      productProfitRate === null ||
      productPayProfitRate === null ||
      productProfitRate + 1e-9 < target.requiredNetRate ||
      productPayProfitRate + 1e-9 < target.requiredPayRate;
    const belowTarget = productProfit < 0 ||
      productProfitRate === null ||
      productPayProfitRate === null ||
      productProfitRate + 1e-9 < target.targetNetRate ||
      productPayProfitRate + 1e-9 < target.targetPayRate;
    return {
      key: `${row.key}:${item.productId}`,
      productKey: `${row.platform}:${item.productId}`,
      productId: item.productId,
      productName: item.name,
      currentPrice: item.price,
      packageFee: item.packageFee,
      currentOriginalPrice: roundMoney(item.price + item.packageFee),
      costPrice: item.cost,
      platform: row.platform,
      platformName: row.platformName,
      comboLabel: itemsText(row.items),
      items: row.items,
      originalTotal: row.originalTotal,
      afterBaseRedTotal: Math.max(0, roundMoney(row.originalTotal - row.couponSpace - row.baseRed.amount)),
      totalDiscount: roundMoney(row.baseRed.amount + row.couponSpace + row.redAddOnSpace),
      baseRedAmount: row.baseRed.amount,
      couponSpace: row.couponSpace,
      redAddOnSpace: row.redAddOnSpace,
      orderFinalPay: row.finalPay,
      orderNetPay: row.netPay,
      orderCommission: row.commission,
      orderServiceFee: row.serviceFee,
      orderFreightSubsidy: row.freightSubsidy,
      orderCost: row.cost,
      orderProfit: row.profit,
      orderProfitRate: row.profitRate,
      productFinalPay,
      productNetPay,
      productCost,
      productFee,
      productProfit,
      productProfitRate,
      productPayProfitRate,
      requiredNetRate: row.requiredNetRate,
      targetNetRate: row.targetNetRate,
      requiredPayRate: row.requiredPayRate,
      targetPayRate: row.targetPayRate,
      strategyScenarioName: row.strategyScenarioName,
      strategyTierName: row.strategyTierName,
      affordableSpace,
      belowMinimum,
      belowTarget
    };
  });
}

function pricingRequiredRate(finalPay: number, settings: PricingEvaluationSettings, targets: ProfitTarget[], rule: PricingEvaluationRule) {
  if (finalPay <= Math.max(0, Number(settings.lowPayMax) || 0) + 1e-9) return 0;
  const target = targetForPayExtended(finalPay, targets);
  if (target) return Math.max(0, Number(target.rateMin) || 0) / 100;
  return Math.max(0, Number(rule.fallbackTargetProfitRate) || 0) / 100;
}

function pricingProductTypeName(type: PricingProductType) {
  return { normal: '普通', addOn: '加料/凑单', riceBall: '主食', setMeal: '套餐' }[type];
}

function pricingProductType(product: Product): PricingProductType {
  if (product.category === 'setMeal') return 'setMeal';
  if (product.category === 'staple') return 'riceBall';
  if (product.category === 'addOn') return 'addOn';
  const name = product.name.toLowerCase();
  if (product.nonStandalone || /凑单|加购|小料|配菜|蘸料|调料|单点不送|不可单点|小份/.test(name)) return 'addOn';
  if (/套餐|套饭|组合|单人餐|双人|两份|多人餐|combo|set|\+|＋/.test(name)) return 'setMeal';
  if (/饭团/.test(name)) return 'riceBall';
  return 'normal';
}

function pricingProductTargetRate(type: PricingProductType, rule: PricingEvaluationRule) {
  const rate = type === 'addOn'
    ? rule.addOnTargetProfitRate
    : type === 'riceBall'
      ? rule.riceBallTargetProfitRate
      : type === 'setMeal'
        ? rule.setMealTargetProfitRate
        : rule.fallbackTargetProfitRate;
  return Math.max(0, Number(rate) || 0) / 100;
}

function pricingStapleCountTargetRate(stapleCount: number, rule: PricingEvaluationRule) {
  const normalized = Math.max(0, Math.floor(Number(stapleCount) || 0));
  if (normalized === 1) return Math.max(0, Number(rule.singleStapleTargetProfitRate) || 0) / 100;
  if (normalized === 2) return Math.max(0, Number(rule.doubleStapleTargetProfitRate) || 0) / 100;
  if (normalized >= 3) return Math.max(0, Number(rule.multiStapleTargetProfitRate) || 0) / 100;
  return 0;
}

function pricingRequiredRateForProduct(finalPay: number, settings: PricingEvaluationSettings, targets: ProfitTarget[], type: PricingProductType, rule: PricingEvaluationRule, stapleCount: number) {
  return Math.max(
    pricingRequiredRate(finalPay, settings, targets, rule),
    pricingProductTargetRate(type, rule),
    pricingStapleCountTargetRate(stapleCount, rule)
  );
}

function minStandaloneOriginalUnitPrice(store: Store, platform: Platform, excludedProductId: string) {
  const prices = store.products
    .filter(product => product.id !== excludedProductId)
    .filter(product => !product.nonStandalone)
    .filter(product => isProductListedOnPlatform(product, platform))
    .map(product => platformOriginalUnitPrice(product, platform))
    .filter(price => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function minStapleOriginalUnitPrice(store: Store, platform: Platform, excludedProductId: string) {
  const prices = store.products
    .filter(product => product.id !== excludedProductId)
    .filter(product => productStapleServingCount(product) > 0)
    .filter(product => isProductListedOnPlatform(product, platform))
    .map(product => platformOriginalUnitPrice(product, platform) / Math.max(1, productStapleServingCount(product)))
    .filter(price => price > 0);
  return prices.length ? Math.min(...prices) : 0;
}

function minReachablePricingAddOn(
  store: Store,
  platform: Platform,
  product: Product,
  currentQty: number,
  targetTotal: number,
  settings: ComboRangeSettings
) {
  const currentTotal = roundMoney(platformOriginalUnitPrice(product, platform) * currentQty);
  const currentStapleCount = productStapleServingCount(product) * currentQty;
  const currentHasStandalone = currentQty > 0 && !product.nonStandalone;
  const maxItems = Math.max(1, Math.floor(Number(store.maxItems) || 1));
  const maxQtyPerSku = Math.max(1, Math.floor(Number(store.maxQtyPerSku) || 1));
  const remainingItems = maxItems - currentQty;
  const originalRange = costAnalysisOriginalRange(settings);
  const calcRange = calculationTotalRange(store);
  const maxTotal = Math.min(originalRange.max, calcRange.max);
  const maxAdd = Number.isFinite(maxTotal) ? Math.max(0, maxTotal - currentTotal) : Infinity;
  const targetAdd = Math.max(0, roundMoney(targetTotal - currentTotal));
  const stapleRange = stapleCountRange(store);
  if (currentStapleCount > stapleRange.max + 1e-9) return null;

  if (
    targetAdd <= 1e-9 &&
    currentHasStandalone &&
    isInStapleCountRange(store, currentStapleCount)
  ) {
    return { addTotal: 0, addStapleCount: 0 };
  }
  if (remainingItems <= 0) return null;

  const units: Array<{ priceCents: number; stapleCount: number; standalone: boolean }> = [];
  store.products
    .filter(item => item.id !== product.id)
    .filter(item => isProductListedOnPlatform(item, platform))
    .forEach(item => {
      const price = platformOriginalUnitPrice(item, platform);
      if (price <= 0) return;
      for (let count = 0; count < maxQtyPerSku; count++) {
        units.push({
          priceCents: Math.round(price * 100),
          stapleCount: productStapleServingCount(item),
          standalone: !item.nonStandalone
        });
      }
    });
  if (!units.length) return null;

  const maxUnitCents = Math.max(...units.map(unit => unit.priceCents));
  const targetAddCents = Math.max(0, Math.round(targetAdd * 100));
  const maxAddCents = Number.isFinite(maxAdd)
    ? Math.round(maxAdd * 100)
    : targetAddCents + maxUnitCents;
  type AddOnState = { sumCents: number; stapleCount: number; hasStandalone: boolean; itemCount: number };
  const layers: Map<string, AddOnState>[] = Array.from({ length: remainingItems + 1 }, () => new Map());
  layers[0].set('0:0:0', { sumCents: 0, stapleCount: 0, hasStandalone: false, itemCount: 0 });

  units.forEach(unit => {
    for (let count = remainingItems - 1; count >= 0; count--) {
      const states = Array.from(layers[count].values());
      states.forEach(state => {
        const nextSum = state.sumCents + unit.priceCents;
        if (nextSum > maxAddCents) return;
        const nextStapleCount = state.stapleCount + unit.stapleCount;
        if (currentStapleCount + nextStapleCount > stapleRange.max + 1e-9) return;
        const nextHasStandalone = state.hasStandalone || unit.standalone;
        const key = `${nextSum}:${nextStapleCount}:${nextHasStandalone ? 1 : 0}`;
        if (!layers[count + 1].has(key)) {
          layers[count + 1].set(key, {
            sumCents: nextSum,
            stapleCount: nextStapleCount,
            hasStandalone: nextHasStandalone,
            itemCount: count + 1
          });
        }
      });
    }
  });

  let best: AddOnState | null = null;
  for (const layer of layers) {
    for (const state of layer.values()) {
      if (state.sumCents + 1e-9 < targetAddCents) continue;
      if (!currentHasStandalone && !state.hasStandalone) continue;
      if (!isInStapleCountRange(store, currentStapleCount + state.stapleCount)) continue;
      if (!best || state.sumCents < best.sumCents || (state.sumCents === best.sumCents && state.itemCount < best.itemCount)) {
        best = state;
      }
    }
  }
  return best ? { addTotal: roundMoney(best.sumCents / 100), addStapleCount: best.stapleCount } : null;
}

type PricingProductScenario = {
  label: string;
  qty: number;
  orderOriginalTotal: number;
  productOriginalTotal: number;
  orderStapleCount: number;
};

function buildPricingProductScenarios(state: CalculatorState, store: Store, platform: Platform, product: Product, settings: PricingEvaluationSettings): PricingProductScenario[] {
  const unitOriginal = platformOriginalUnitPrice(product, platform);
  if (unitOriginal <= 0) return [];
  const maxQty = Math.max(1, Math.floor(Number(store.maxQtyPerSku) || 1));
  const stapleRange = stapleCountRange(store);
  const unitStapleCount = productStapleServingCount(product);
  const range = calculationTotalRange(store);
  const minOriginal = Math.max(0, Number(settings.originalMin) || 0);
  const minOrderTotal = roundMoney(Math.max(store.startPrice, range.min, minOriginal));
  const scenarios = new Map<string, PricingProductScenario>();

  function addScenario(label: string, total: number, qty = 1, allowAdditionalProducts = false) {
    const safeQty = Math.max(1, Math.min(maxQty, Math.floor(qty) || 1));
    const productOriginalTotal = roundMoney(unitOriginal * safeQty);
    const productStapleTotal = unitStapleCount * safeQty;
    if (productStapleTotal > stapleRange.max + 1e-9) return;
    const targetTotal = roundMoney(Math.max(total, productOriginalTotal, store.startPrice, range.min, minOriginal));
    const addOn = allowAdditionalProducts
      ? minReachablePricingAddOn(store, platform, product, safeQty, targetTotal, settings)
      : null;
    if (allowAdditionalProducts && !addOn) return;
    const orderStapleCount = productStapleTotal + (addOn?.addStapleCount || 0);
    if (!isInStapleCountRange(store, orderStapleCount)) return;
    const orderOriginalTotal = allowAdditionalProducts
      ? roundMoney(productOriginalTotal + (addOn?.addTotal || 0))
      : productOriginalTotal;
    if (orderOriginalTotal + 1e-9 < store.startPrice) return;
    if (orderOriginalTotal + 1e-9 < total) return;
    if (product.nonStandalone && !allowAdditionalProducts) return;
    if (!isInCalculationTotalRange(store, orderOriginalTotal)) return;
    if (!isInCostAnalysisOriginalRange(settings, orderOriginalTotal)) return;
    const key = `${safeQty}:${orderOriginalTotal}`;
    if (!scenarios.has(key)) {
      scenarios.set(key, {
        label,
        qty: safeQty,
        orderOriginalTotal,
        productOriginalTotal,
        orderStapleCount
      });
    }
  }

  if (!product.nonStandalone) {
    for (let qty = 1; qty <= maxQty; qty++) {
      addScenario(`单品 x${qty}`, unitOriginal * qty, qty);
    }
  } else {
    addScenario('凑单分摊', minOrderTotal, 1, true);
  }

  addScenario('起送压力', minOrderTotal, 1, true);
  [20, 25].forEach(total => addScenario(`费用阶梯 ¥${money(total)}`, Math.max(minOrderTotal, total), 1, true));
  state.platformRules.redTiers[platform]
    .filter(tier => tier.enabled && tier.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold)
    .forEach(tier => addScenario(`${PLATFORM_NAMES[platform]}红包门槛 ¥${money(tier.threshold)}`, Math.max(minOrderTotal, tier.threshold), 1, true));

  return Array.from(scenarios.values()).sort((a, b) => a.orderOriginalTotal - b.orderOriginalTotal || a.qty - b.qty);
}

function evaluatePricingProductScenario(
  state: CalculatorState,
  store: Store,
  platform: Platform,
  product: Product,
  scenario: PricingProductScenario,
  settings: PricingEvaluationSettings,
  targets: ProfitTarget[],
  type: PricingProductType,
  rule: PricingEvaluationRule
): PricingComboDetail | null {
  const price = platformPrice(product, platform);
  const packageFee = platformPackageFee(product, platform);
  const baseRed = bestBaseRed(state, platform, scenario.orderOriginalTotal);
  const afterBaseRed = Math.max(0, roundMoney(scenario.orderOriginalTotal - baseRed.amount));
  const redAddOnSpace = Math.min(Math.max(0, Number(settings.redAddOnSpace) || 0), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOnSpace));
  if (!isInCostAnalysisPayRange(settings, finalPay)) return null;

  const fee = buildFeeSummary(state, store, finalPay);
  const feeTotal = roundMoney(fee.commission + fee.serviceFee + fee.freightSubsidy);
  const productGrossShare = scenario.orderOriginalTotal > 0 ? scenario.productOriginalTotal / scenario.orderOriginalTotal : 1;
  const productAfterBaseRed = Math.max(0, roundMoney(scenario.productOriginalTotal - baseRed.amount * productGrossShare));
  const finalShare = afterBaseRed > 0 ? productAfterBaseRed / afterBaseRed : productGrossShare;
  const productFinalPay = roundMoney(finalPay * finalShare);
  const productFee = roundMoney(feeTotal * finalShare);
  const productNetPay = Math.max(0, roundMoney(productFinalPay - productFee));
  const productCost = roundMoney((Number(product.cost) || 0) * scenario.qty);
  const productProfit = roundMoney(productNetPay - productCost);
  const productProfitRate = productNetPay > 0 ? productProfit / productNetPay : productProfit < 0 ? -1 : null;
  const productPayProfitRate = profitRateByBasis(productProfit, productFinalPay);
  const strategyTarget = pricingStrategyTargetForPay(state, store, finalPay, scenario.orderStapleCount);
  const affordableSpace = productProfitRate === null || productPayProfitRate === null
    ? null
    : pricingAffordableSpace(productProfit, productFinalPay, productNetPay, strategyTarget);
  const belowMinimum = isBelowPricingMinimum(productProfit, productPayProfitRate, productProfitRate, strategyTarget);
  const belowTarget = isBelowPricingTarget(productProfit, productPayProfitRate, productProfitRate, strategyTarget);
  const item: ComboItem = {
    productId: product.id,
    name: product.name,
    qty: scenario.qty,
    price,
    packageFee,
    cost: Number(product.cost) || 0,
    category: product.category,
    stapleServingCount: productStapleServingCount(product),
    nonStandalone: product.nonStandalone
  };
  const hasVirtualItems = scenario.orderOriginalTotal > scenario.productOriginalTotal + 1e-9;
  const comboLabel = `${scenario.label}${hasVirtualItems ? ' + 其他商品' : ''} / 原价¥${money(scenario.orderOriginalTotal)} / 红包¥${money(baseRed.amount)} / 加码¥${money(redAddOnSpace)}`;
  return {
    key: [platform, product.id, scenario.label, scenario.qty, scenario.orderOriginalTotal, finalPay].join('::'),
    productKey: `${platform}:${product.id}`,
    productId: product.id,
    productName: product.name,
    currentPrice: price,
    packageFee,
    currentOriginalPrice: roundMoney(price + packageFee),
    costPrice: Number(product.cost) || 0,
    platform,
    platformName: PLATFORM_NAMES[platform],
    comboLabel,
    items: [item],
    originalTotal: scenario.orderOriginalTotal,
    baseRedAmount: baseRed.amount,
    redAddOnSpace,
    orderFinalPay: finalPay,
    orderNetPay: Math.max(0, roundMoney(finalPay - feeTotal)),
    orderCommission: fee.commission,
    orderServiceFee: fee.serviceFee,
    orderFreightSubsidy: fee.freightSubsidy,
    requiredRate: strategyTarget.targetNetRate,
    productFinalPay,
    productFee,
    productNetPay,
    productCost,
    productProfit,
    productProfitRate,
    productPayProfitRate,
    requiredNetRate: strategyTarget.requiredNetRate,
    targetNetRate: strategyTarget.targetNetRate,
    requiredPayRate: strategyTarget.requiredPayRate,
    targetPayRate: strategyTarget.targetPayRate,
    strategyScenarioName: strategyTarget.scenarioName,
    strategyTierName: strategyTarget.tierName,
    affordableSpace,
    belowMinimum,
    belowTarget
  };
}

function evaluatePricingCombo(state: CalculatorState, store: Store, platform: Platform, qtys: number[], settings: PricingEvaluationSettings, targets: ProfitTarget[]): PricingOrderRow | null {
  const totals = buildCostAnalysisTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (!isInCostAnalysisOriginalRange(settings, totals.originalTotal)) return null;
  if (totals.originalTotal + 1e-9 < store.startPrice) return null;
  const baseRed = bestBaseRed(state, platform, totals.originalTotal);
  const afterBaseRed = Math.max(0, roundMoney(totals.originalTotal - baseRed.amount));
  const redAddOnSpace = Math.min(Math.max(0, Number(settings.redAddOnSpace) || 0), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOnSpace));
  if (!isInCostAnalysisPayRange(settings, finalPay)) return null;
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const profit = roundMoney(netPay - totals.costTotal);
  const profitRate = netPay > 0 ? profit / netPay : profit < 0 ? -1 : null;
  const payProfitRate = profitRateByBasis(profit, finalPay);
  const strategyTarget = pricingStrategyTargetForPay(state, store, finalPay, comboStapleServingCount(totals.items));
  const itemKey = totals.items.map(item => `${item.productId}:${item.qty}`).join('|');
  return {
    key: [platform, itemKey, finalPay, baseRed.amount, redAddOnSpace].join('::'),
    platform,
    platformName: PLATFORM_NAMES[platform],
    items: totals.items,
    originalTotal: totals.originalTotal,
    baseRed,
    redAddOnSpace,
    finalPay,
    netPay,
    cost: totals.costTotal,
    commission: fee.commission,
    serviceFee: fee.serviceFee,
    freightSubsidy: fee.freightSubsidy,
    profit,
    profitRate,
    payProfitRate,
    requiredNetRate: strategyTarget.requiredNetRate,
    targetNetRate: strategyTarget.targetNetRate,
    requiredPayRate: strategyTarget.requiredPayRate,
    targetPayRate: strategyTarget.targetPayRate,
    strategyScenarioName: strategyTarget.scenarioName,
    strategyTierName: strategyTarget.tierName
  };
}

function allocatePricingItems(row: PricingOrderRow): PricingComboDetail[] {
  const grossTotal = row.items.reduce((sum, item) => sum + comboItemOriginalAmount(item), 0);
  const afterBaseRedItems = row.items.map(item => {
    const grossAmount = comboItemOriginalAmount(item);
    const grossShare = grossTotal > 0 ? grossAmount / grossTotal : 1 / Math.max(1, row.items.length);
    const baseRedShare = roundMoney(row.baseRed.amount * grossShare);
    return {
      item,
      grossShare,
      afterBaseRedAmount: Math.max(0, roundMoney(grossAmount - baseRedShare))
    };
  });
  const afterBaseRedTotal = afterBaseRedItems.reduce((sum, entry) => sum + entry.afterBaseRedAmount, 0);
  return afterBaseRedItems.map(entry => {
    const item = entry.item;
    const share = afterBaseRedTotal > 0 ? entry.afterBaseRedAmount / afterBaseRedTotal : entry.grossShare;
    const productFinalPay = roundMoney(row.finalPay * share);
    const productFee = roundMoney((row.commission + row.serviceFee + row.freightSubsidy) * share);
    const productNetPay = Math.max(0, roundMoney(productFinalPay - productFee));
    const productProfit = roundMoney(productNetPay - item.cost * item.qty);
    const productProfitRate = productNetPay > 0 ? productProfit / productNetPay : productProfit < 0 ? -1 : null;
    const productPayProfitRate = profitRateByBasis(productProfit, productFinalPay);
    const affordableSpace = productProfitRate === null || productPayProfitRate === null
      ? null
      : Math.min(
        roundMoney(productProfit - productNetPay * row.targetNetRate),
        roundMoney(productProfit - productFinalPay * row.targetPayRate)
      );
    const belowMinimum = productProfit < 0 ||
      productProfitRate === null ||
      productPayProfitRate === null ||
      productProfitRate + 1e-9 < row.requiredNetRate ||
      productPayProfitRate + 1e-9 < row.requiredPayRate;
    const belowTarget = productProfit < 0 ||
      productProfitRate === null ||
      productPayProfitRate === null ||
      productProfitRate + 1e-9 < row.targetNetRate ||
      productPayProfitRate + 1e-9 < row.targetPayRate;
    return {
      key: `${row.key}:${item.productId}`,
      productKey: `${row.platform}:${item.productId}`,
      productId: item.productId,
      productName: item.name,
      currentPrice: item.price,
      packageFee: item.packageFee,
      currentOriginalPrice: roundMoney(item.price + item.packageFee),
      costPrice: item.cost,
      platform: row.platform,
      platformName: row.platformName,
      comboLabel: itemsText(row.items),
      items: row.items,
      originalTotal: row.originalTotal,
      baseRedAmount: row.baseRed.amount,
      redAddOnSpace: row.redAddOnSpace,
      orderFinalPay: row.finalPay,
      orderNetPay: row.netPay,
      orderCommission: row.commission,
      orderServiceFee: row.serviceFee,
      orderFreightSubsidy: row.freightSubsidy,
      requiredRate: row.targetNetRate,
      productFinalPay,
      productFee,
      productNetPay,
      productCost: roundMoney(item.cost * item.qty),
      productProfit,
      productProfitRate,
      productPayProfitRate,
      requiredNetRate: row.requiredNetRate,
      targetNetRate: row.targetNetRate,
      requiredPayRate: row.requiredPayRate,
      targetPayRate: row.targetPayRate,
      strategyScenarioName: row.strategyScenarioName,
      strategyTierName: row.strategyTierName,
      affordableSpace,
      belowMinimum,
      belowTarget
    };
  });
}

function pricingIssueSeverity(issue: Omit<PricingProductIssue, 'severity' | 'reasons'>) {
  const reasons: string[] = [];
  let severity: Severity = 'none';
  if (!issue.comboCount || issue.avgProfitRate === null || issue.minProfitRate === null) {
    return { severity: 'config' as Severity, reasons: ['没有命中有效组合'] };
  }
  if (issue.lossCount > 0 || issue.minProfitRate < 0) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('存在亏损组合');
  }
  if (issue.minPayProfitRate !== null && issue.minPayProfitRate < 0) {
    severity = maxSeverity(severity, 'critical');
    reasons.push('存在实付口径亏损组合');
  }
  if (issue.lowCount >= issue.comboCount) {
    severity = maxSeverity(severity, 'high');
    reasons.push('所有组合均低于定价目标');
  } else if (issue.lowCount > 0) {
    severity = maxSeverity(severity, 'medium');
    reasons.push('部分组合低于定价目标');
  }
  if ((issue.minAffordableSpace || 0) < 0) {
    severity = maxSeverity(severity, 'medium');
    reasons.push('目标利润率下价格空间不足');
  }
  if (issue.suggestedIncrease < 0) {
    severity = maxSeverity(severity, 'medium');
    reasons.push('利润率明显高于定价目标');
  }
  if (!reasons.length) reasons.push('当前定价满足评估目标');
  return { severity, reasons };
}

async function runPricingEvaluationCalculationAsync(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: PricingEvaluationSettings,
  onProgress?: (progress: CalculationProgress) => void
): Promise<PricingEvaluationResult> {
  const start = calculationNow();
  const store = currentStoreFrom(state);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const targets = effectiveProfitTargets(state, store);
  const pricingRule = normalizePricingEvaluationRule(state.platformRules.pricingEvaluation);
  const productFilter = buildCostProductFilter(store, settings);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  if (productFilter.productIds && !productFilter.productIds.size) warnings.push(`当前门店没有匹配「${settings.productNameKeyword.trim()}」的商品。`);

  let checked = 0;
  let validCombos = 0;
  const details: PricingComboDetail[] = [];
  const productGroups = new Map<string, {
    productId: string;
    productName: string;
    productType: PricingProductType;
    productTypeName: string;
    platform: Platform;
    platformName: string;
    currentPrice: number;
    packageFee: number;
    currentOriginalPrice: number;
    costPrice: number;
    targetProfitRate: number;
    targetPayProfitRate: number;
    profitRates: number[];
    payProfitRates: number[];
    requiredRates: number[];
    requiredPayRates: number[];
    affordableSpaces: number[];
    lowCount: number;
    lossCount: number;
  }>();
  await yieldToBrowser();

  if (!productFilter.productIds || productFilter.productIds.size > 0) {
    for (const platform of platforms) {
      const platformProducts = store.products
        .filter(product => isProductListedOnPlatform(product, platform))
        .filter(product => !productFilter.productIds || productFilter.productIds.has(product.id));
      for (let index = 0; index < platformProducts.length; index++) {
        const product = platformProducts[index];
        const type = pricingProductType(product);
        const productKey = `${platform}:${product.id}`;
        const group = productGroups.get(productKey) || {
          productId: product.id,
          productName: product.name,
          productType: type,
          productTypeName: pricingProductTypeName(type),
          platform,
          platformName: PLATFORM_NAMES[platform],
          currentPrice: platformPrice(product, platform),
          packageFee: platformPackageFee(product, platform),
          currentOriginalPrice: platformOriginalUnitPrice(product, platform),
          costPrice: Number(product.cost) || 0,
          targetProfitRate: 0,
          targetPayProfitRate: 0,
          profitRates: [],
          payProfitRates: [],
          requiredRates: [],
          requiredPayRates: [],
          affordableSpaces: [],
          lowCount: 0,
          lossCount: 0
        };
        productGroups.set(productKey, group);

        const scenarios = buildPricingProductScenarios(state, store, platform, product, settings);
        for (const scenario of scenarios) {
          checked++;
          const detail = evaluatePricingProductScenario(state, store, platform, product, scenario, settings, targets, type, pricingRule);
          if (!detail) continue;
          validCombos++;
          if (detail.productProfitRate !== null) group.profitRates.push(detail.productProfitRate);
          if (detail.productPayProfitRate !== null) group.payProfitRates.push(detail.productPayProfitRate);
          group.requiredRates.push(detail.targetNetRate);
          group.requiredPayRates.push(detail.targetPayRate);
          if (detail.affordableSpace !== null) group.affordableSpaces.push(detail.affordableSpace);
          if (detail.belowTarget) group.lowCount++;
          if (detail.productProfit < 0) group.lossCount++;
          details.push(detail);
        }

        if (index % 20 === 0) {
          onProgress?.({
            resultCount: productGroups.size,
            comboCount: checked,
            validComboCount: validCombos
          });
          await yieldToBrowser();
        }
      }
    }
  }

  const issues = Array.from(productGroups.values()).map(group => {
    const productKey = `${group.platform}:${group.productId}`;
    const productDetails = details.filter(detail => detail.productKey === productKey);
    const suggestion = buildPricingPriceSuggestion(group.currentPrice, group.packageFee, productDetails);
    const baseIssue = {
      key: productKey,
      productId: group.productId,
      productName: group.productName,
      productType: group.productType,
      productTypeName: group.productTypeName,
      platform: group.platform,
      platformName: group.platformName,
      currentPrice: group.currentPrice,
      packageFee: group.packageFee,
      currentOriginalPrice: group.currentOriginalPrice,
      costPrice: group.costPrice,
      targetProfitRate: average(group.requiredRates) || 0,
      targetPayProfitRate: average(group.requiredPayRates) || 0,
      comboCount: group.profitRates.length,
      lowCount: group.lowCount,
      lossCount: group.lossCount,
      minProfitRate: group.profitRates.length ? Math.min(...group.profitRates) : null,
      minPayProfitRate: group.payProfitRates.length ? Math.min(...group.payProfitRates) : null,
      avgProfitRate: average(group.profitRates),
      avgPayProfitRate: average(group.payProfitRates),
      avgRequiredRate: average(group.requiredRates),
      avgRequiredPayRate: average(group.requiredPayRates),
      minAffordableSpace: group.affordableSpaces.length ? Math.min(...group.affordableSpaces) : null,
      suggestedPrice: suggestion.suggestedPrice,
      suggestedOriginalPrice: suggestion.suggestedOriginalPrice,
      suggestedIncrease: suggestion.suggestedIncrease,
      suggestedIncreaseRate: suggestion.suggestedIncreaseRate,
      suggestionBasis: suggestion.suggestionBasis
    };
    const severity = pricingIssueSeverity(baseIssue);
    return { ...baseIssue, ...severity };
  }).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || b.suggestedIncrease - a.suggestedIncrease);

  return {
    issues,
    details,
    warnings,
    summary: {
      resultCount: issues.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(calculationNow() - start)
    }
  };
}

function runCostAnalysisCalculation(state: CalculatorState, platformFilter: Platform | 'all', settings: CostAnalysisSettings): CostAnalysisResult {
  const start = performance.now();
  const store = currentStoreFrom(state);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const productFilter = buildCostProductFilter(store, settings);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  if (productFilter.productIds && !productFilter.productIds.size) {
    warnings.push(`当前门店没有匹配「${settings.productNameKeyword.trim()}」的商品。`);
  }
  const orderRows: CostSpaceOrderRow[] = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  if (!productFilter.productIds || productFilter.productIds.size > 0) {
    platforms.forEach(platform => {
      const enumeration = enumerateStoreCombos(store, [platform], qtys => {
        if (productFilter.productIds && !qtys.some((qty, index) => qty > 0 && productFilter.productIds?.has(store.products[index].id))) return;
        const row = evaluateCostSpaceCombo(state, store, platform, qtys, settings);
        if (row) orderRows.push(row);
      });
      checked += enumeration.checked;
      validCombos += enumeration.validCombos;
      stopped = stopped || enumeration.stopped;
    });
  }
  if (stopped) warnings.push(`已达到最多检查组合数 ${store.maxChecks}，已停止继续枚举。`);

  const productGroups = new Map<string, {
    productId: string;
    productName: string;
    platform: Platform;
    platformName: string;
    currentPrice: number;
    costPrice: number;
    orderFinalPays: number[];
    finalPays: number[];
    profitRates: number[];
    payProfitRates: number[];
    targetNetRates: number[];
    targetPayRates: number[];
    affordableSpaces: number[];
    lowCount: number;
  }>();
  const curvePoints: ProductCurvePoint[] = [];
  const details: ProductCostComboDetail[] = [];

  orderRows.forEach(row => {
    allocateCostSpaceItems(row)
      .filter(detail => !productFilter.productIds || productFilter.productIds.has(detail.productId))
      .forEach(detail => {
      const group = productGroups.get(detail.productKey) || {
        productId: detail.productId,
        productName: detail.productName,
        platform: detail.platform,
        platformName: detail.platformName,
        currentPrice: detail.currentPrice,
        costPrice: detail.costPrice,
        orderFinalPays: [],
        finalPays: [],
        profitRates: [],
        payProfitRates: [],
        targetNetRates: [],
        targetPayRates: [],
        affordableSpaces: [],
        lowCount: 0
      };
      group.orderFinalPays.push(detail.orderNetPay);
      group.finalPays.push(detail.productNetPay);
      if (detail.productProfitRate !== null) group.profitRates.push(detail.productProfitRate);
      if (detail.productPayProfitRate !== null) group.payProfitRates.push(detail.productPayProfitRate);
      group.targetNetRates.push(detail.targetNetRate);
      group.targetPayRates.push(detail.targetPayRate);
      if (detail.affordableSpace !== null) group.affordableSpaces.push(detail.affordableSpace);
      if (detail.belowTarget) group.lowCount++;
      details.push(detail);
      curvePoints.push({
        key: detail.key,
        productKey: detail.productKey,
        productName: detail.productName,
        platform: detail.platform,
        platformName: detail.platformName,
        comboLabel: detail.comboLabel,
        finalPay: detail.orderNetPay,
        profitRate: detail.productProfitRate,
        targetMidRate: detail.targetNetRate
      });
      productGroups.set(detail.productKey, group);
    });
  });

  const issues = Array.from(productGroups.values()).map(group => {
    const avgProfitRate = average(group.profitRates);
    const minProfitRate = group.profitRates.length ? Math.min(...group.profitRates) : null;
    const maxProfitRate = group.profitRates.length ? Math.max(...group.profitRates) : null;
    const finalPayMin = group.finalPays.length ? Math.min(...group.finalPays) : null;
    const finalPayMax = group.finalPays.length ? Math.max(...group.finalPays) : null;
    const avgFinalPay = average(group.finalPays);
    const orderFinalPayMin = group.orderFinalPays.length ? Math.min(...group.orderFinalPays) : null;
    const orderFinalPayMax = group.orderFinalPays.length ? Math.max(...group.orderFinalPays) : null;
    const orderFinalPayAvg = average(group.orderFinalPays);
    const minAffordableSpace = group.affordableSpaces.length ? Math.min(...group.affordableSpaces) : null;
    const productKey = `${group.platform}:${group.productId}`;
    const suggestion = buildCostPriceSuggestion(group.currentPrice, details.filter(detail => detail.productKey === productKey));
    const baseIssue = {
      key: productKey,
      productId: group.productId,
      productName: group.productName,
      platform: group.platform,
      platformName: group.platformName,
      currentPrice: group.currentPrice,
      costPrice: group.costPrice,
      orderFinalPayMin,
      orderFinalPayMax,
      orderFinalPayAvg,
      finalPayMin,
      finalPayMax,
      avgFinalPay,
      avgProfitRate,
      avgPayProfitRate: average(group.payProfitRates),
      targetProfitRate: average(group.targetNetRates) || 0,
      targetPayProfitRate: average(group.targetPayRates) || 0,
      minProfitRate,
      minPayProfitRate: group.payProfitRates.length ? Math.min(...group.payProfitRates) : null,
      maxProfitRate,
      minAffordableSpace,
      suggestedPrice: suggestion.suggestedPrice,
      suggestedIncrease: suggestion.suggestedIncrease,
      suggestedIncreaseRate: suggestion.suggestedIncreaseRate,
      suggestionBasis: suggestion.suggestionBasis,
      comboCount: group.profitRates.length,
      lowCount: group.lowCount
    };
    const severity = costIssueSeverity(baseIssue);
    return { ...baseIssue, ...severity };
  }).sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || (a.minProfitRate || 0) - (b.minProfitRate || 0));

  return {
    issues,
    details: details.sort((a, b) => a.orderNetPay - b.orderNetPay || (a.productProfitRate || 0) - (b.productProfitRate || 0)),
    curvePoints: curvePoints.sort((a, b) => a.finalPay - b.finalPay),
    redTierRows: aggregateCostRedTierRows(orderRows),
    warnings,
    summary: {
      resultCount: orderRows.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(performance.now() - start)
    }
  };
}

async function runActivityDesignCalculationAsync(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: ActivityDesignSettings,
  onProgress?: (progress: CalculationProgress) => void
): Promise<ActivityDesignResult> {
  const start = calculationNow();
  const store = currentStoreFrom(state);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const productFilter = buildCostProductFilter(store, settings);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  if (productFilter.productIds && !productFilter.productIds.size) {
    warnings.push(`当前门店没有匹配「${settings.productNameKeyword.trim()}」的商品。`);
  }

  const baseRows: CouponDesignBaseRow[] = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: ComboEnumerationSummary['stoppedReason'];
  await yieldToBrowser();

  if (!productFilter.productIds || productFilter.productIds.size > 0) {
    for (const platform of platforms) {
      const checkedBeforePlatform = checked;
      const validBeforePlatform = validCombos;
      const enumeration = await enumerateStoreCombosAsync(
        store,
        [platform],
        qtys => {
          if (productFilter.productIds && !qtys.some((qty, index) => qty > 0 && productFilter.productIds?.has(store.products[index].id))) return;
          const row = buildCouponDesignBaseRow(state, store, platform, qtys, settings);
          if (row) baseRows.push(row);
        },
        progress => onProgress?.({
          resultCount: baseRows.length,
          comboCount: checkedBeforePlatform + progress.checked,
          validComboCount: validBeforePlatform + progress.validCombos
        })
      );
      checked += enumeration.checked;
      validCombos += enumeration.validCombos;
      stopped = stopped || enumeration.stopped;
    }
  }

  const stopWarning = comboEnumerationStopWarning(stopped, stoppedReason, store.maxChecks);
  if (stopWarning) warnings.push(stopWarning);
  await yieldToBrowser();
  const rows = await buildCouponDesignRowsAsync(
    state,
    store,
    baseRows,
    settings,
    progressRows => onProgress?.({
      resultCount: progressRows.length,
      comboCount: checked,
      validComboCount: validCombos
    })
  );
  return {
    rows,
    warnings,
    summary: {
      resultCount: rows.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(calculationNow() - start)
    }
  };
}

function buildProfitMetrics(state: CalculatorState, store: Store, cost: number, finalPay: number) {
  const fee = buildFeeSummary(state, store, finalPay);
  const profit = roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy - cost);
  return {
    profit,
    profitRate: finalPay > 0 ? profit / finalPay : null
  };
}

function findClosestPayForRate(state: CalculatorState, store: Store, cost: number, lower: number, upper: number, targetRate: number) {
  const candidates = [Math.max(0.01, lower), Math.max(0.01, upper)];
  let low = Math.max(0.01, lower);
  let high = Math.max(low, upper);
  for (let index = 0; index < 24; index++) {
    const mid = (low + high) / 2;
    const metrics = buildProfitMetrics(state, store, cost, mid);
    candidates.push(mid);
    if (metrics.profitRate === null) break;
    if (metrics.profitRate < targetRate) low = mid;
    else high = mid;
  }

  let best: { pay: number; distance: number } | null = null;
  for (const candidate of candidates) {
    const pay = roundMoney(candidate);
    const metrics = buildProfitMetrics(state, store, cost, pay);
    if (!Number.isFinite(metrics.profitRate)) continue;
    const distance = Math.abs((metrics.profitRate as number) - targetRate);
    if (!best || distance < best.distance) best = { pay, distance };
  }
  return best ? best.pay : null;
}

function splitSuggestedDiscount(discount: number, basis: number, redThreshold: number) {
  const total = roundMoney(Math.max(0, discount));
  if (total <= 0) return { fullAmount: 0, couponAmount: 0, redAddAmount: 0, total: 0 };
  const redAddAmount = redThreshold > 0 && basis >= redThreshold ? roundMoney(total * 0.35) : 0;
  const remain = roundMoney(total - redAddAmount);
  const couponAmount = roundMoney(remain * 0.35);
  const fullAmount = roundMoney(remain - couponAmount);
  return { fullAmount, couponAmount, redAddAmount, total };
}

function evaluateOptimizationBase(state: CalculatorState, store: Store, platform: Platform, qtys: number[]) {
  const totals = buildPlatformTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (totals.afterProductDiscount + 1e-9 < store.startPrice) return null;
  const baseRed = bestBaseRed(state, platform, totals.afterProductDiscount);
  const basePay = Math.max(0, roundMoney(totals.afterProductDiscount - baseRed.amount));
  if (basePay <= 0) return null;
  return {
    platform,
    platformName: PLATFORM_NAMES[platform],
    items: totals.items,
    afterProductDiscount: totals.afterProductDiscount,
    cost: totals.costTotal,
    baseRed,
    basePay
  };
}

function runOptimizationCalculation(state: CalculatorState, platformFilter: Platform | 'all') {
  const store = currentStoreFrom(state);
  const targets = effectiveProfitTargets(state, store);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const rows: Array<{
    platform: Platform;
    platformName: string;
    fullThreshold: number;
    fullAmount: number;
    couponThreshold: number;
    couponAmount: number;
    redAddThreshold: number;
    redAddAmount: number;
    target: ProfitTarget;
    score: number;
    finalPay: number;
    profitRate: number | null;
    items: ComboItem[];
  }> = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;

  function collectOptimizationRows(platform: Platform, qtys: number[]) {
    const base = evaluateOptimizationBase(state, store, platform, qtys);
    if (!base) return;
    for (const target of targets) {
      const lower = Math.max(0.01, Number(target.payMin) || 0);
      const upper = Math.min(Number(target.payMax) || base.basePay, base.basePay);
      if (upper < lower) continue;
      const midRate = ((Number(target.rateMin) || 0) + (Number(target.rateMax) || 0)) / 200;
      const desiredPay = findClosestPayForRate(state, store, base.cost, lower, upper, midRate);
      if (desiredPay === null) continue;
      const merchantDiscount = roundMoney(base.basePay - desiredPay);
      if (merchantDiscount < 0) continue;
      const split = splitSuggestedDiscount(merchantDiscount, base.afterProductDiscount, base.baseRed.threshold);
      const finalPay = Math.max(0, roundMoney(base.basePay - split.total));
      const metrics = buildProfitMetrics(state, store, base.cost, finalPay);
      if (metrics.profitRate === null) continue;
      rows.push({
        platform,
        platformName: PLATFORM_NAMES[platform],
        fullThreshold: base.afterProductDiscount,
        fullAmount: split.fullAmount,
        couponThreshold: base.afterProductDiscount,
        couponAmount: split.couponAmount,
        redAddThreshold: base.baseRed.threshold,
        redAddAmount: split.redAddAmount,
        target,
        score: Math.abs(metrics.profitRate - midRate),
        finalPay,
        profitRate: metrics.profitRate,
        items: base.items
      });
    }
  }

  if (store.products.length && targets.length) {
    for (const platform of platforms) {
      const enumeration = enumerateStoreCombos(store, [platform], qtys => collectOptimizationRows(platform, qtys));
      checked += enumeration.checked;
      validCombos += enumeration.validCombos;
      stopped = stopped || enumeration.stopped;
    }
  }

  const grouped = new Map<string, OptimizationRow>();
  rows.forEach(row => {
    const key = [
      row.platform,
      row.fullThreshold,
      row.fullAmount,
      row.couponThreshold,
      row.couponAmount,
      row.redAddThreshold,
      row.redAddAmount,
      row.target.payMin,
      row.target.payMax
    ].join('::');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        platform: row.platform,
        platformName: row.platformName,
        full: { enabled: true, threshold: row.fullThreshold, amount: row.fullAmount },
        coupon: { enabled: true, threshold: row.couponThreshold, amount: row.couponAmount, name: '建议订单券' },
        redAddOn: { enabled: true, threshold: row.redAddThreshold, amount: row.redAddAmount },
        target: row.target,
        coverage: 1,
        score: row.score,
        finalPay: row.finalPay,
        profitRate: row.profitRate,
        example: { items: row.items, finalPay: row.finalPay, profitRate: row.profitRate, score: row.score }
      });
      return;
    }
    const nextCoverage = existing.coverage + 1;
    existing.score = (existing.score * existing.coverage + row.score) / nextCoverage;
    existing.finalPay = (existing.finalPay * existing.coverage + row.finalPay) / nextCoverage;
    existing.profitRate = ((existing.profitRate || 0) * existing.coverage + (row.profitRate || 0)) / nextCoverage;
    existing.coverage = nextCoverage;
    if (row.score > existing.example.score) existing.example = { items: row.items, finalPay: row.finalPay, profitRate: row.profitRate, score: row.score };
  });
  const optimizations = Array.from(grouped.values()).sort((a, b) => a.score - b.score || a.finalPay - b.finalPay);
  return {
    optimizations,
    summary: {
      resultCount: optimizations.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: null
    },
    warnings: stopped ? [`已达到最多检查组合数 ${store.maxChecks}，已停止继续枚举。`] : []
  };
}

async function runOptimizationCalculationAsync(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  onProgress?: (progress: CalculationProgress) => void
) {
  const start = calculationNow();
  const store = currentStoreFrom(state);
  const targets = effectiveProfitTargets(state, store);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const rows: Array<{
    platform: Platform;
    platformName: string;
    fullThreshold: number;
    fullAmount: number;
    couponThreshold: number;
    couponAmount: number;
    redAddThreshold: number;
    redAddAmount: number;
    target: ProfitTarget;
    score: number;
    finalPay: number;
    profitRate: number | null;
    items: ComboItem[];
  }> = [];
  let checked = 0;
  let validCombos = 0;
  let stopped = false;
  let stoppedReason: ComboEnumerationSummary['stoppedReason'];

  function collectOptimizationRows(platform: Platform, qtys: number[]) {
    const base = evaluateOptimizationBase(state, store, platform, qtys);
    if (!base) return;
    for (const target of targets) {
      const lower = Math.max(0.01, Number(target.payMin) || 0);
      const upper = Math.min(Number(target.payMax) || base.basePay, base.basePay);
      if (upper < lower) continue;
      const midRate = ((Number(target.rateMin) || 0) + (Number(target.rateMax) || 0)) / 200;
      const desiredPay = findClosestPayForRate(state, store, base.cost, lower, upper, midRate);
      if (desiredPay === null) continue;
      const merchantDiscount = roundMoney(base.basePay - desiredPay);
      if (merchantDiscount < 0) continue;
      const split = splitSuggestedDiscount(merchantDiscount, base.afterProductDiscount, base.baseRed.threshold);
      const finalPay = Math.max(0, roundMoney(base.basePay - split.total));
      const metrics = buildProfitMetrics(state, store, base.cost, finalPay);
      if (metrics.profitRate === null) continue;
      rows.push({
        platform,
        platformName: PLATFORM_NAMES[platform],
        fullThreshold: base.afterProductDiscount,
        fullAmount: split.fullAmount,
        couponThreshold: base.afterProductDiscount,
        couponAmount: split.couponAmount,
        redAddThreshold: base.baseRed.threshold,
        redAddAmount: split.redAddAmount,
        target,
        score: Math.abs(metrics.profitRate - midRate),
        finalPay,
        profitRate: metrics.profitRate,
        items: base.items
      });
    }
  }

  await yieldToBrowser();
  if (store.products.length && targets.length) {
    for (const platform of platforms) {
      const checkedBeforePlatform = checked;
      const validBeforePlatform = validCombos;
      const enumeration = await enumerateStoreCombosAsync(
        store,
        [platform],
        qtys => collectOptimizationRows(platform, qtys),
        progress => onProgress?.({
          resultCount: rows.length,
          comboCount: checkedBeforePlatform + progress.checked,
          validComboCount: validBeforePlatform + progress.validCombos
        })
      );
      checked += enumeration.checked;
      validCombos += enumeration.validCombos;
      stopped = stopped || enumeration.stopped;
      stoppedReason = stoppedReason || enumeration.stoppedReason;
      if (stoppedReason === 'maxDuration') break;
    }
  }

  const grouped = new Map<string, OptimizationRow>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const key = [
      row.platform,
      row.fullThreshold,
      row.fullAmount,
      row.couponThreshold,
      row.couponAmount,
      row.redAddThreshold,
      row.redAddAmount,
      row.target.payMin,
      row.target.payMax
    ].join('::');
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        key,
        platform: row.platform,
        platformName: row.platformName,
        full: { enabled: true, threshold: row.fullThreshold, amount: row.fullAmount },
        coupon: { enabled: true, threshold: row.couponThreshold, amount: row.couponAmount, name: '建议订单券' },
        redAddOn: { enabled: true, threshold: row.redAddThreshold, amount: row.redAddAmount },
        target: row.target,
        coverage: 1,
        score: row.score,
        finalPay: row.finalPay,
        profitRate: row.profitRate,
        example: { items: row.items, finalPay: row.finalPay, profitRate: row.profitRate, score: row.score }
      });
    } else {
      const nextCoverage = existing.coverage + 1;
      existing.score = (existing.score * existing.coverage + row.score) / nextCoverage;
      existing.finalPay = (existing.finalPay * existing.coverage + row.finalPay) / nextCoverage;
      existing.profitRate = ((existing.profitRate || 0) * existing.coverage + (row.profitRate || 0)) / nextCoverage;
      existing.coverage = nextCoverage;
      if (row.score > existing.example.score) existing.example = { items: row.items, finalPay: row.finalPay, profitRate: row.profitRate, score: row.score };
    }
    if (index > 0 && index % 1000 === 0) await yieldToBrowser();
  }

  const optimizations = Array.from(grouped.values()).sort((a, b) => a.score - b.score || a.finalPay - b.finalPay);
  return {
    optimizations,
    summary: {
      resultCount: optimizations.length,
      comboCount: checked,
      validComboCount: validCombos,
      elapsedTime: Math.round(calculationNow() - start)
    },
    warnings: [comboEnumerationStopWarning(stopped, stoppedReason, store.maxChecks)].filter((warning): warning is string => Boolean(warning))
  };
}

function splitCsvLine(line: string) {
  const fields: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if ((char === ',' || char === '，' || char === '\t') && !quoted) {
      fields.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  fields.push(current);
  return fields;
}

function normalizeHeader(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase();
  const map: Record<string, string> = {
    商品名: 'name',
    商品名称: 'name',
    名称: 'name',
    name: 'name',
    销售价: 'price',
    售价: 'price',
    原价: 'price',
    价格: 'price',
    price: 'price',
    成本价: 'cost',
    成本: 'cost',
    cost: 'cost',
    打包费: 'packageFee',
    包装费: 'packageFee',
    统一打包费: 'packageFee',
    统一包装费: 'packageFee',
    packagefee: 'packageFee',
    美团价: 'meituanPrice',
    美团价格: 'meituanPrice',
    meituanprice: 'meituanPrice',
    饿了么价: 'elemePrice',
    饿了么价格: 'elemePrice',
    elemeprice: 'elemePrice',
    美团打包费: 'meituanPackageFee',
    美团包装费: 'meituanPackageFee',
    meituanpackagefee: 'meituanPackageFee',
    饿了么打包费: 'elemePackageFee',
    饿了么包装费: 'elemePackageFee',
    elepackagefee: 'elemePackageFee',
    elemepackagefee: 'elemePackageFee',
    美团上架: 'meituanEnabled',
    美团上下架: 'meituanEnabled',
    美团售卖状态: 'meituanEnabled',
    饿了么上架: 'elemeEnabled',
    饿了么上下架: 'elemeEnabled',
    饿了么售卖状态: 'elemeEnabled',
    单点不送: 'nonStandalone',
    不可单点: 'nonStandalone',
    nonstandalone: 'nonStandalone',
    商品分类: 'category',
    商品类型: 'category',
    分类: 'category',
    category: 'category',
    主食份数: 'stapleServingCount',
    主食数量: 'stapleServingCount',
    主食数: 'stapleServingCount',
    stapleservingcount: 'stapleServingCount'
  };
  return map[text] || text;
}

function objectFromHeaders(headers: string[], fields: string[]) {
  return headers.reduce<Record<string, string>>((row, header, index) => {
    row[header] = fields[index] ?? '';
    return row;
  }, {});
}

function normalizeImportedProduct(row: Record<string, unknown>) {
  const name = String(row.name ?? '').trim();
  const price = toMoneyNumber(row.price, Number.NaN);
  if (!name || !(price > 0)) return null;
  return normalizeProduct({
    id: uid('p'),
    name,
    price,
    cost: Math.max(0, toMoneyNumber(row.cost, 0)),
    packageFee: Math.max(0, toMoneyNumber(row.packageFee, 0)),
    meituanPrice: normalizeOptionalPrice(row.meituanPrice),
    elemePrice: normalizeOptionalPrice(row.elemePrice),
    meituanPackageFee: normalizeOptionalMoney(row.meituanPackageFee, 0, 0),
    elemePackageFee: normalizeOptionalMoney(row.elemePackageFee, 0, 0),
    meituanEnabled: parseProductStatus(row.meituanEnabled, true),
    elemeEnabled: parseProductStatus(row.elemeEnabled, true),
    category: normalizeProductCategory(row.category, name, parseBoolean(row.nonStandalone)),
    stapleServingCount: String(row.stapleServingCount ?? '').trim() === '' ? undefined : Math.max(0, Math.floor(toNumber(row.stapleServingCount, 0))),
    nonStandalone: parseBoolean(row.nonStandalone)
  });
}

function parseProducts(raw: string) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const products: Product[] = [];
  let headers: string[] | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line).map(field => field.trim());
    if (!headers && /商品|名称|name/i.test(fields[0] || '')) {
      headers = fields.map(normalizeHeader);
      continue;
    }
    const row = headers ? objectFromHeaders(headers, fields) : {
      name: fields[0],
      price: fields[1],
      cost: fields[2],
      meituanPrice: fields[3],
      elemePrice: fields[4],
      nonStandalone: fields[5],
      meituanEnabled: fields[6],
      elemeEnabled: fields[7],
      packageFee: fields[8],
      meituanPackageFee: fields[9],
      elemePackageFee: fields[10],
      category: fields[11],
      stapleServingCount: fields[12]
    };
    const product = normalizeImportedProduct(row);
    if (product) products.push(product);
  }
  return products;
}

function normalizeImportHeader(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
}

function isExcludedImportPriceHeader(header: string) {
  return /餐盒|包装/.test(header);
}

function findImportColumnIndex(row: unknown[], candidates: string[]) {
  if (!candidates.length) return -1;
  const cells = row.map(normalizeImportHeader);
  const normalizedCandidates = candidates.map(normalizeImportHeader);
  for (const candidate of normalizedCandidates) {
    const exactIndex = cells.indexOf(candidate);
    if (exactIndex >= 0) return exactIndex;
  }
  for (const candidate of normalizedCandidates) {
    const partialIndex = cells.findIndex(cell => cell.includes(candidate) && !isExcludedImportPriceHeader(cell));
    if (partialIndex >= 0) return partialIndex;
  }
  return -1;
}

function normalizeImportedProductName(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeProductMatchName(value: unknown) {
  return normalizeImportedProductName(value).toLowerCase();
}

function rowHasText(row: unknown[]) {
  return Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '');
}

function firstSheetRows(workbook: XLSX.WorkBook) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('工作簿没有可读取的工作表');
  const sheet = workbook.Sheets[sheetName];
  return {
    sheetName,
    rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
  };
}

function parsePlatformProductWorkbook(workbook: XLSX.WorkBook, platform: Platform) {
  const rule = PLATFORM_PRODUCT_IMPORT_RULES[platform];
  const { sheetName, rows } = firstSheetRows(workbook);
  const limit = Math.min(rows.length, 50);
  let header: { rowIndex: number; nameIndex: number; priceIndex: number } | null = null;
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    const nameIndex = findImportColumnIndex(row, rule.nameHeaders);
    const priceIndex = findImportColumnIndex(row, rule.priceHeaders);
    if (nameIndex >= 0 && priceIndex >= 0) {
      header = { rowIndex, nameIndex, priceIndex };
      break;
    }
  }
  if (!header) throw new Error('没有找到商品名称或价格列');
  const statusIndex = findImportColumnIndex(rows[header.rowIndex] || [], rule.statusHeaders || []);
  const packageFeeIndex = findImportColumnIndex(rows[header.rowIndex] || [], rule.packageFeeHeaders || []);
  const productsByName = new Map<string, PlatformProductRecord>();
  let skipped = 0;
  let duplicated = 0;
  let disabled = 0;
  rows.slice(header.rowIndex + 1).forEach(row => {
    const rawName = String(row[header.nameIndex] ?? '').trim();
    const price = toMoneyNumber(row[header.priceIndex], Number.NaN);
    if (!rawName || !(price > 0)) {
      if (rowHasText(row)) skipped++;
      return;
    }
    const name = normalizeImportedProductName(rawName);
    const key = normalizeProductMatchName(name);
    const platformEnabled = statusIndex >= 0 ? parseProductStatus(row[statusIndex], true) : undefined;
    const packageFeeText = packageFeeIndex >= 0 ? String(row[packageFeeIndex] ?? '').trim() : '';
    const packageFee = packageFeeText === '' ? undefined : Math.max(0, toMoneyNumber(packageFeeText, 0));
    if (platformEnabled === false) disabled++;
    if (productsByName.has(key)) duplicated++;
    productsByName.set(key, { name, price, packageFee, platformEnabled });
  });
  return { products: Array.from(productsByName.values()), skipped, duplicated, disabled, sheetName, headerRow: header.rowIndex + 1 };
}

function parseCostWorkbook(workbook: XLSX.WorkBook) {
  const { sheetName, rows } = firstSheetRows(workbook);
  const limit = Math.min(rows.length, 50);
  let header: { rowIndex: number; nameIndex: number; costIndex: number } | null = null;
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    const nameIndex = findImportColumnIndex(row, COST_IMPORT_RULE.nameHeaders);
    const costIndex = findImportColumnIndex(row, COST_IMPORT_RULE.costHeaders);
    if (nameIndex >= 0 && costIndex >= 0) {
      header = { rowIndex, nameIndex, costIndex };
      break;
    }
  }
  if (!header) throw new Error('没有找到商品名称或成本价列');
  const costsByName = new Map<string, CostRecord>();
  let skipped = 0;
  let duplicated = 0;
  rows.slice(header.rowIndex + 1).forEach(row => {
    const rawName = String(row[header.nameIndex] ?? '').trim();
    const cost = toMoneyNumber(row[header.costIndex], Number.NaN);
    if (!rawName || !Number.isFinite(cost) || cost < 0) {
      if (rowHasText(row)) skipped++;
      return;
    }
    const name = normalizeImportedProductName(rawName);
    const key = normalizeProductMatchName(name);
    if (costsByName.has(key)) duplicated++;
    costsByName.set(key, { name, cost: roundMoney(cost) });
  });
  return { costs: Array.from(costsByName.values()), skipped, duplicated, sheetName, headerRow: header.rowIndex + 1 };
}

function csvCell(value: unknown) {
  const text = String(value ?? '');
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return false;
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(','), ...rows.map(row => headers.map(header => csvCell(row[header])).join(','))];
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return true;
}

function exportConfigFile(state: CalculatorState) {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `外卖门店活动配置_${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function itemsText(items: ComboItem[]) {
  return items.map(item => `${item.name}x${item.qty}`).join(' + ');
}

function comboItemOriginalAmount(item: ComboItem) {
  return roundMoney((item.price + item.packageFee) * item.qty);
}

function comboPackageFeeTotal(items: ComboItem[]) {
  return roundMoney(items.reduce((sum, item) => sum + item.packageFee * item.qty, 0));
}

function riskLabel(risk?: RiskInfo) {
  return { critical: '严重', high: '高', medium: '中', config: '配置', none: '正常' }[risk?.severity || 'none'];
}

function riskColor(risk?: RiskInfo) {
  return { critical: 'red', high: 'orange', medium: 'gold', config: 'purple', none: 'green' }[risk?.severity || 'none'];
}

function readWorkbook(file: File) {
  return file.arrayBuffer().then(buffer => XLSX.read(buffer, { type: 'array', cellDates: false }));
}

function waitForLoadingPaint() {
  return new Promise<void>(resolve => setTimeout(resolve, 30));
}

type StateRecord = {
  key: string;
  value: CalculatorState;
  updatedAt: string;
};

function ensureBrowserObjectStores(db: IDBDatabase) {
  REQUIRED_OBJECT_STORES.forEach(storeName => {
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName, { keyPath: 'key' });
    }
  });
}

function hasRequiredObjectStores(db: IDBDatabase) {
  return REQUIRED_OBJECT_STORES.every(storeName => db.objectStoreNames.contains(storeName));
}

function openBrowserDatabase(targetVersion?: number, repaired = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const request = targetVersion === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, targetVersion);
    request.onupgradeneeded = () => {
      ensureBrowserObjectStores(request.result);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (hasRequiredObjectStores(db)) {
        resolve(db);
        return;
      }
      const nextVersion = Math.max(db.version + 1, DB_VERSION);
      db.close();
      if (repaired) {
        reject(new Error('浏览器数据库结构升级失败，请刷新页面后重试。'));
        return;
      }
      openBrowserDatabase(nextVersion, true).then(resolve, reject);
    };
    request.onerror = () => reject(request.error || new Error('打开 IndexedDB 失败'));
  });
}

function browserDbStoreTransaction<T>(storeName: string, mode: IDBTransactionMode, executor: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openBrowserDatabase().then(db => new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      request = executor(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB 事务失败'));
    };
  }));
}

function browserDbStoreAction<T>(storeName: string, mode: IDBTransactionMode, executor: (store: IDBObjectStore) => T): Promise<T> {
  return openBrowserDatabase().then(db => new Promise<T>((resolve, reject) => {
    let result: T;
    try {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      result = executor(store);
      transaction.oncomplete = () => {
        db.close();
        resolve(result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('IndexedDB 事务失败'));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error('IndexedDB 事务已中断'));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

function browserDbTransaction<T>(mode: IDBTransactionMode, executor: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return browserDbStoreTransaction(STATE_STORE, mode, executor);
}

function saveStateToBrowserDb(value: CalculatorState) {
  const record: StateRecord = {
    key: DEFAULT_STATE_KEY,
    value,
    updatedAt: new Date().toISOString()
  };
  return browserDbTransaction<IDBValidKey>('readwrite', store => store.put(record));
}

async function loadStateFromBrowserDb() {
  const record = await browserDbTransaction<StateRecord | undefined>('readonly', store => store.get(DEFAULT_STATE_KEY));
  if (record?.value) return normalizeState(record.value);

  const legacy = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  if (!legacy) return null;
  const migrated = normalizeState(JSON.parse(legacy));
  await saveStateToBrowserDb(migrated);
  return migrated;
}

async function loadMeasurementRecordFromBrowserDb(storeId: string, scenario: StapleScenario) {
  return browserDbStoreTransaction<PersistedMeasurementRecord | undefined>(MEASUREMENT_RESULTS_STORE, 'readonly', store => store.get(measurementRecordKey(storeId, scenario)));
}

async function loadMeasurementRecordsFromBrowserDb(storeId: string) {
  const records = await Promise.all(STAPLE_SCENARIOS.map(scenario => loadMeasurementRecordFromBrowserDb(storeId, scenario)));
  return records.filter((record): record is PersistedMeasurementRecord => Boolean(record));
}

async function saveMeasurementRecordToBrowserDb(store: Store, scenario: StapleScenario, settings: MeasurementSettings, result: MeasurementResult) {
  const record = buildPersistedMeasurementRecord(store, scenario, settings, result);
  await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
  return record;
}

async function deleteMeasurementRecordChunksFromBrowserDb(record: PersistedMeasurementRecord | undefined) {
  if (!record?.chunkKeys?.length) return;
  await browserDbStoreAction(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => {
    record.chunkKeys?.forEach(key => objectStore.delete(key));
    return undefined;
  });
}

function createMeasurementChunkWriter(parentKey: string) {
  const chunkKeys: string[] = [];
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  let index = 0;
  return {
    keys: () => chunkKeys.slice(),
    async write(rows: ComboEvaluationRow[]) {
      if (!rows.length) return;
      const key = measurementChunkKey(parentKey, runId, index++);
      const record: MeasurementChunkRecord = {
        key,
        parentKey,
        index: index - 1,
        rows: normalizeCachedMeasurementRows(rows),
        rowCount: rows.length
      };
      await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
      chunkKeys.push(key);
    }
  };
}

async function saveChunkedMeasurementRecordToBrowserDb(
  store: Store,
  scenario: StapleScenario,
  settings: MeasurementSettings,
  result: MeasurementResult,
  chunkKeys: string[]
) {
  const record = buildPersistedMeasurementRecord(store, scenario, settings, result, chunkKeys);
  await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
  return record;
}

async function loadMeasurementChunkFromBrowserDb(key: string) {
  return browserDbStoreTransaction<MeasurementChunkRecord | undefined>(MEASUREMENT_RESULTS_STORE, 'readonly', store => store.get(key));
}

async function loadMeasurementRowsFromBrowserDb(
  record: PersistedMeasurementRecord,
  filters: {
    store: Store;
    settings: MeasurementSettings;
    platform: Platform;
    payBand: PriceBandRow | null;
    limit: number;
  }
) {
  const rows: ComboEvaluationRow[] = [];
  let matchedCount = 0;
  const accept = (row: ComboEvaluationRow) => {
    if (row.platform !== filters.platform) return false;
    if (filters.payBand && (row.finalPay + 1e-9 < filters.payBand.min || row.finalPay >= filters.payBand.max - 1e-9)) return false;
    return isMeasurementRowInDisplayFilters(row, filters.store, filters.settings);
  };
  const consumeRows = (sourceRows: ComboEvaluationRow[]) => {
    for (const row of sourceRows) {
      if (!accept(row)) continue;
      matchedCount++;
      if (rows.length < filters.limit) rows.push(row);
    }
  };

  if (record.chunkKeys?.length) {
    for (const key of record.chunkKeys) {
      const chunk = await loadMeasurementChunkFromBrowserDb(key);
      if (chunk?.rows?.length) consumeRows(normalizeCachedMeasurementRows(chunk.rows));
    }
  } else {
    consumeRows(normalizeCachedMeasurementRows(record.rows));
  }

  return {
    rows: sortMeasurementRows(rows),
    matchedCount,
    truncated: matchedCount > rows.length
  };
}

type AppDataRepository = {
  loadCalculatorState: () => Promise<CalculatorState | null>;
  saveCalculatorState: (value: CalculatorState) => Promise<void>;
  loadMeasurementRecord: (storeId: string, scenario: StapleScenario) => Promise<PersistedMeasurementRecord | undefined>;
  loadMeasurementRecords: (storeId: string) => Promise<PersistedMeasurementRecord[]>;
  saveMeasurementRecord: (store: Store, scenario: StapleScenario, settings: MeasurementSettings, result: MeasurementResult) => Promise<PersistedMeasurementRecord>;
  deleteMeasurementRecordChunks: (record: PersistedMeasurementRecord | undefined) => Promise<void>;
  createMeasurementChunkWriter: (parentKey: string) => ReturnType<typeof createMeasurementChunkWriter>;
  saveChunkedMeasurementRecord: (store: Store, scenario: StapleScenario, settings: MeasurementSettings, result: MeasurementResult, chunkKeys: string[]) => Promise<PersistedMeasurementRecord>;
  loadMeasurementRows: typeof loadMeasurementRowsFromBrowserDb;
};

const browserDataRepository: AppDataRepository = {
  loadCalculatorState: loadStateFromBrowserDb,
  saveCalculatorState: async value => {
    await saveStateToBrowserDb(value);
  },
  loadMeasurementRecord: loadMeasurementRecordFromBrowserDb,
  loadMeasurementRecords: loadMeasurementRecordsFromBrowserDb,
  saveMeasurementRecord: saveMeasurementRecordToBrowserDb,
  deleteMeasurementRecordChunks: deleteMeasurementRecordChunksFromBrowserDb,
  createMeasurementChunkWriter,
  saveChunkedMeasurementRecord: saveChunkedMeasurementRecordToBrowserDb,
  loadMeasurementRows: loadMeasurementRowsFromBrowserDb
};

function ProfitCurveChart({ points }: { points: ProductCurvePoint[] }) {
  const valid = points
    .filter(point => point.profitRate !== null)
    .sort((a, b) => a.finalPay - b.finalPay)
    .slice(0, 180);
  if (!valid.length) return <div className="chart-empty">暂无可绘制的商品组合利润率曲线</div>;
  const data = valid.flatMap(point => {
    const actual = {
      key: `${point.key}-actual`,
      finalPay: roundMoney(point.finalPay),
      rate: roundMoney((point.profitRate || 0) * 100),
      metric: '实际利润率',
      platformName: point.platformName,
      comboLabel: point.comboLabel
    };
    if (point.targetMidRate === null) return [actual];
    return [
      actual,
      {
        key: `${point.key}-target`,
        finalPay: roundMoney(point.finalPay),
        rate: roundMoney(point.targetMidRate * 100),
        metric: '目标中线',
        platformName: point.platformName,
        comboLabel: point.comboLabel
      }
    ];
  });
  return (
    <div className="chart-frame">
      <AntvLine
        data={data}
        height={280}
        autoFit
        xField="finalPay"
        yField="rate"
        colorField="metric"
        shapeField="smooth"
        axis={{
          x: { title: '净实付', labelFormatter: (value: number | string) => `¥${money(value)}` },
          y: { title: '利润率', labelFormatter: (value: number | string) => `${Number(value).toFixed(0)}%` }
        }}
        scale={{
          x: { nice: true },
          y: { nice: true },
          color: { range: ['#d95b18', '#2e7d32'] }
        }}
        style={{
          lineWidth: 2.4,
          lineDash: (datum: { metric?: string }) => datum.metric === '目标中线' ? [5, 5] : []
        }}
        point={{
          sizeField: 3.5,
          style: {
            stroke: '#fff',
            lineWidth: 1
          }
        }}
        tooltip={{
          title: (datum: { platformName?: string; comboLabel?: string }) => `${datum.platformName || ''} ${datum.comboLabel || ''}`.trim(),
          items: [
            { field: 'metric', name: '指标' },
            { field: 'rate', name: '利润率', valueFormatter: (value: number) => `${Number(value).toFixed(2)}%` },
            { field: 'finalPay', name: '净实付', valueFormatter: (value: number) => `¥${money(value)}` }
          ]
        }}
      />
    </div>
  );
}

function TierHitChart({ rows, label }: { rows: TierAnalysisRow[]; label: string }) {
  const data = rows.slice(0, 12).map(row => ({
    key: row.key,
    tierName: row.tierName.replace(/满减 |神券 |爆红包 /g, ''),
    hitCount: row.hitCount,
    avgProfitRate: row.avgProfitRate === null ? null : roundMoney(row.avgProfitRate * 100),
    lowCount: row.lowCount,
    platformName: row.platformName
  }));
  if (!data.length) return <div className="chart-empty">暂无{label}命中数据</div>;
  return (
    <div className="chart-frame">
      <AntvDualAxes
        data={data}
        height={280}
        autoFit
        xField="tierName"
        axis={{
          x: { title: label, labelAutoRotate: false },
          y: { title: '命中组合数', labelFormatter: (value: number | string) => `${Math.round(Number(value))}` }
        }}
        scale={{
          y: { independent: true, nice: true },
          color: { range: ['#e5a663', '#326b77'] }
        }}
        legend={{
          color: {
            itemMarker: (value: string) => value === 'avgProfitRate' ? 'smooth' : 'rect'
          }
        }}
        children={[
          {
            type: 'interval',
            yField: 'hitCount',
            colorField: 'hitCount',
            style: {
              fill: '#e5a663',
              radiusTopLeft: 4,
              radiusTopRight: 4
            }
          },
          {
            type: 'line',
            yField: 'avgProfitRate',
            shapeField: 'smooth',
            axis: {
              y: {
                position: 'right',
                title: '平均利润率',
                labelFormatter: (value: number | string) => `${Number(value).toFixed(0)}%`
              }
            },
            style: {
              stroke: '#326b77',
              lineWidth: 2.4
            },
            point: {
              sizeField: 4,
              style: {
                fill: (datum: { lowCount?: number }) => (datum.lowCount || 0) > 0 ? '#d4380d' : '#326b77',
                stroke: '#fff',
                lineWidth: 1
              }
            }
          }
        ]}
        tooltip={{
          title: (datum: { platformName?: string; tierName?: string }) => `${datum.platformName || ''} ${datum.tierName || ''}`.trim(),
          items: [
            { field: 'hitCount', name: '命中组合数' },
            { field: 'avgProfitRate', name: '平均利润率', valueFormatter: (value: number) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '-' },
            { field: 'lowCount', name: '低于目标数' }
          ]
        }}
      />
    </div>
  );
}

function PriceBandVolumeProfitChart({ rows, title }: { rows: PriceBandRow[]; title: string }) {
  const data = rows.slice(0, 24).map(row => ({
    key: row.key,
    label: row.label,
    comboCount: row.comboCount,
    avgProfitRate: row.avgProfitRate === null ? null : roundMoney(row.avgProfitRate * 100),
    riskCount: row.riskCount,
    platformName: row.platformName
  }));
  if (!data.length) return <div className="chart-empty">暂无{title}区间数据</div>;
  return (
    <div className="chart-frame">
      <AntvDualAxes
        data={data}
        height={280}
        autoFit
        xField="label"
        axis={{
          x: { title, labelAutoRotate: false },
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
            yField: 'avgProfitRate',
            shapeField: 'smooth',
            axis: {
              y: {
                position: 'right',
                title: '平均利润率',
                labelFormatter: (value: number | string) => `${Number(value).toFixed(0)}%`
              }
            },
            style: {
              stroke: '#b85f32',
              lineWidth: 2.4
            },
            point: {
              sizeField: 4,
              style: {
                fill: (datum: { riskCount?: number }) => (datum.riskCount || 0) > 0 ? '#d4380d' : '#b85f32',
                stroke: '#fff',
                lineWidth: 1
              }
            }
          }
        ]}
        tooltip={{
          title: (datum: { platformName?: string; label?: string }) => `${datum.platformName || ''} ${datum.label || ''}`.trim(),
          items: [
            { field: 'comboCount', name: '组合数' },
            { field: 'avgProfitRate', name: '平均利润率', valueFormatter: (value: number) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '-' },
            { field: 'riskCount', name: '异常数' }
          ]
        }}
      />
    </div>
  );
}

function PriceBandMoneyTrendChart({ rows }: { rows: PriceBandRow[] }) {
  const data = rows.slice(0, 24).flatMap(row => [
    { key: `${row.key}-avg-profit`, label: row.label, metric: '平均利润', amount: roundMoney(row.avgProfit) },
    { key: `${row.key}-min-profit`, label: row.label, metric: '最低利润', amount: roundMoney(row.minProfit ?? 0) },
    { key: `${row.key}-max-profit`, label: row.label, metric: '最高利润', amount: roundMoney(row.maxProfit ?? 0) }
  ]);
  if (!data.length) return <div className="chart-empty">暂无价格趋势数据</div>;
  return (
    <div className="chart-frame">
      <AntvLine
        data={data}
        height={280}
        autoFit
        xField="label"
        yField="amount"
        colorField="metric"
        shapeField="smooth"
        axis={{
          x: { title: '支付价区间', labelAutoRotate: false },
          y: { title: '金额', labelFormatter: (value: number | string) => `¥${money(value)}` }
        }}
        scale={{
          y: { nice: true },
          color: { range: ['#496f5d', '#a66a3f', '#6d6aa8'] }
        }}
        style={{
          lineWidth: 2.2
        }}
        point={{
          sizeField: 3.5,
          style: {
            stroke: '#fff',
            lineWidth: 1
          }
        }}
        tooltip={{
          title: (datum: { label?: string }) => datum.label || '',
          items: [
            { field: 'metric', name: '指标' },
            { field: 'amount', name: '金额', valueFormatter: (value: number) => `¥${money(value)}` }
          ]
        }}
      />
    </div>
  );
}

function PayBandAnalysisPanel({
  title,
  chartTitle,
  platformName,
  payBands,
  selectedPayBandKey,
  rowCount,
  riskCount,
  loading,
  columns,
  onSelectPayBand
}: PayBandAnalysisPanelProps) {
  const effectiveSelectedKey = payBands.some(row => row.key === selectedPayBandKey) ? selectedPayBandKey : 'all';
  return (
    <Card title={title}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Text type="secondary">查看区间</Text>
          <Select
            style={{ width: 260 }}
            value={effectiveSelectedKey}
            onChange={onSelectPayBand}
            options={[
              { value: 'all', label: '全部支付价区间' },
              ...payBands.map(row => ({
                value: row.key,
                label: `${row.platformName}${row.scenarioName === '全部组合' ? '' : ` / ${row.scenarioName}`} / ¥${row.label}`
              }))
            ]}
          />
          <Button onClick={() => onSelectPayBand('all')}>查看全部组合</Button>
          <Text type="secondary">{platformName} 当前 {rowCount} 条，风险 {riskCount} 条</Text>
        </Space>
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={12}><PriceBandVolumeProfitChart rows={payBands} title={chartTitle} /></Col>
          <Col xs={24} lg={12}><PriceBandMoneyTrendChart rows={payBands} /></Col>
        </Row>
        <Table
          loading={loading}
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={payBands}
          pagination={tablePagination(20)}
          scroll={{ x: 1380 }}
          tableLayout="fixed"
          rowClassName={row => row.key === effectiveSelectedKey ? 'risk-config' : ''}
          onRow={row => ({
            onClick: () => onSelectPayBand(row.key)
          })}
        />
      </Space>
    </Card>
  );
}

class ProductTableErrorBoundary extends React.Component<{ children: React.ReactNode; fallback: React.ReactNode }, { hasError: boolean }> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function WaimaiCalculatorInner() {
  const { message, modal } = AntApp.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const routePage = useMemo(() => pageFromPathname(pathname || '/'), [pathname]);
  const routePageRef = React.useRef(routePage);
  const stateRef = React.useRef<CalculatorState>(deepClone(defaultState));
  const asyncCalculationSeqRef = React.useRef(0);
  const measurementCacheWarmupSeqRef = React.useRef(0);
  const resultBandLoadSeqRef = React.useRef(0);
  const measurementCacheWarmupIdleRef = React.useRef<number | null>(null);
  const measurementCacheWarmupTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const measurementCacheWarmupControllerRef = React.useRef<AbortController | null>(null);
  const resultScenarioRef = React.useRef<StapleScenario>(MEASUREMENT_RESULT_SCENARIO);
  const latestAsyncCalculationTokenRef = React.useRef<Partial<Record<AsyncCalculationSlot, string>>>({});
  const activeAsyncCalculationRef = React.useRef<Partial<Record<AsyncCalculationSlot, AsyncCalculationTask>>>({});
  const pendingAsyncCalculationResultRef = React.useRef<Partial<Record<AsyncCalculationSlot, PendingAsyncCalculationResult>>>({});
  const [state, setState] = useState<CalculatorState>(() => deepClone(defaultState));
  const [resultPlatformTab, setResultPlatformTab] = useState<Platform>('meituan');
  const [costPlatformFilter, setCostPlatformFilter] = useState<Platform | 'all'>('all');
  const [activityDesignPlatformTab, setActivityDesignPlatformTab] = useState<Platform>('meituan');
  const [pricingPlatformFilter, setPricingPlatformFilter] = useState<Platform | 'all'>('all');
  const [costAnalysisSettings, setCostAnalysisSettings] = useState<CostAnalysisSettings>(DEFAULT_COST_ANALYSIS_SETTINGS);
  const [activityDesignSettings, setActivityDesignSettings] = useState<ActivityDesignSettings>(DEFAULT_ACTIVITY_DESIGN_SETTINGS);
  const [pricingSettings, setPricingSettings] = useState<PricingEvaluationSettings>(DEFAULT_PRICING_EVALUATION_SETTINGS);
  const [measurementSettings, setMeasurementSettings] = useState<MeasurementSettings>(DEFAULT_MEASUREMENT_SETTINGS);
  const [costCompactColumns, setCostCompactColumns] = useState(true);
  const [riskOnly, setRiskOnly] = useState(false);
  const [isStoreEditing, setIsStoreEditing] = useState(false);
  const [storeDraft, setStoreDraft] = useState<Store | null>(null);
  const [isProductsEditing, setIsProductsEditing] = useState(false);
  const [productsDraft, setProductsDraft] = useState<Product[] | null>(null);
  const [isPlatformEditing, setIsPlatformEditing] = useState(false);
  const [platformDraft, setPlatformDraft] = useState<FeeRule | null>(null);
  const [editingActivityPlatform, setEditingActivityPlatform] = useState<Platform | null>(null);
  const [activityDraft, setActivityDraft] = useState<Activities | null>(null);
  const [isRiskEditing, setIsRiskEditing] = useState(false);
  const [riskDraft, setRiskDraft] = useState<number | null>(null);
  const [selectedProductRowKeys, setSelectedProductRowKeys] = useState<React.Key[]>([]);
  const [bulkPriceField, setBulkPriceField] = useState<ProductBulkPriceField>('price');
  const [bulkPriceMode, setBulkPriceMode] = useState<ProductBulkPriceMode>('set');
  const [bulkPriceValue, setBulkPriceValue] = useState<number | null>(null);
  const [bulkProductCategory, setBulkProductCategory] = useState<ProductCategory>('staple');
  const [bulkStapleServingCount, setBulkStapleServingCount] = useState<number | null>(null);
  const [bulkText, setBulkText] = useState('');
  const [productSearchText, setProductSearchText] = useState('');
  const [productStatusFilter, setProductStatusFilter] = useState<ProductStatusFilter>('all');
  const [productCategoryFilter, setProductCategoryFilter] = useState<ProductCategory | 'all'>('all');
  const [productSortField, setProductSortField] = useState<ProductSortField>('name');
  const [productSortAsc, setProductSortAsc] = useState(true);
  const [pricingResultSearchText, setPricingResultSearchText] = useState('');
  const resultScenario = MEASUREMENT_RESULT_SCENARIO;
  const [lastResultsByScenario, setLastResultsByScenario] = useState(() => createScenarioRecord<ComboEvaluationRow[]>(() => []));
  const [resultPayBandsByScenario, setResultPayBandsByScenario] = useState(() => createScenarioRecord<PriceBandRow[]>(() => []));
  const [selectedResultPayBandKeyByScenarioPlatform, setSelectedResultPayBandKeyByScenarioPlatform] = useState(() => createScenarioPlatformRecord<string>(() => 'all'));
  const [measurementPersistenceMetaByScenario, setMeasurementPersistenceMetaByScenario] = useState(() => createScenarioRecord<MeasurementPersistenceMeta | null>(() => null));
  const [lastOptimizationsByScenario, setLastOptimizationsByScenario] = useState(() => createScenarioRecord<OptimizationRow[]>(() => []));
  const [resultSummariesByScenario, setResultSummariesByScenario] = useState(() => createScenarioRecord<Summary>(() => ({ ...EMPTY_SUMMARY })));
  const [resultWarningsByScenario, setResultWarningsByScenario] = useState(() => createScenarioRecord<string[]>(() => []));
  const [optimizationWarningsByScenario, setOptimizationWarningsByScenario] = useState(() => createScenarioRecord<string[]>(() => []));
  const [costAnalysis, setCostAnalysis] = useState<CostAnalysisResult | null>(null);
  const [activityDesignByScenario, setActivityDesignByScenario] = useState(() => createScenarioRecord<RedesignedActivityDesignResult | null>(() => null));
  const [pricingEvaluation, setPricingEvaluation] = useState<RedesignedPricingEvaluationResult | null>(null);
  const [selectedCostProductKey, setSelectedCostProductKey] = useState('');
  const [selectedPricingProductKey, setSelectedPricingProductKey] = useState('');
  const [costAdjustmentPrice, setCostAdjustmentPrice] = useState<number | null>(null);
  const [selectedResultBand, setSelectedResultBand] = useState<SelectedResultBand | null>(null);
  const [selectedActivityDesignBand, setSelectedActivityDesignBand] = useState<SelectedResultBand | null>(null);
  const [selectedActivityDesignPayBandKeyByPlatform, setSelectedActivityDesignPayBandKeyByPlatform] = useState<Record<Platform, string>>(() => ({ meituan: 'all', eleme: 'all' }));
  const [selectedActivityDesignRouteKey, setSelectedActivityDesignRouteKey] = useState('');
  const [selectedResultProduct, setSelectedResultProduct] = useState<SelectedResultProduct | null>(null);
  const [resultDetailSearchText, setResultDetailSearchText] = useState('');
  const [activityDesignDetailSearchText, setActivityDesignDetailSearchText] = useState('');
  const [resultProductPayRange, setResultProductPayRange] = useState<[number, number] | null>(null);
  const [loadedResultBandRows, setLoadedResultBandRows] = useState<LoadedResultBandRows | null>(null);
  const [isCostModalFullscreen, setIsCostModalFullscreen] = useState(false);
  const [costModalOffset, setCostModalOffset] = useState({ x: 0, y: 0 });
  const [costModalDragStart, setCostModalDragStart] = useState<{ pointerX: number; pointerY: number; startX: number; startY: number } | null>(null);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [isMeasurementCacheLoading, setIsMeasurementCacheLoading] = useState(false);
  const [isResultBandLoading, setIsResultBandLoading] = useState(false);
  const [isOptimizationLoading, setIsOptimizationLoading] = useState(false);
  const [isCostAnalysisLoading, setIsCostAnalysisLoading] = useState(false);
  const [isActivityDesignLoading, setIsActivityDesignLoading] = useState(false);
  const [isPricingEvaluationLoading, setIsPricingEvaluationLoading] = useState(false);
  const [summary, setSummary] = useState<Summary>({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
  const [warnings, setWarnings] = useState<string[]>([]);

  stateRef.current = state;
  resultScenarioRef.current = resultScenario;
  const store = useMemo(() => currentStoreFrom(state), [state]);
  const shouldPrepareResultsView = state.activePage === 'results';
  const lastResults = shouldPrepareResultsView ? lastResultsByScenario[resultScenario] : [];
  const filteredResultRows = useMemo(() => {
    if (!shouldPrepareResultsView) return [];
    return lastResults.filter(row => isMeasurementRowInDisplayFilters(row, store, measurementSettings));
  }, [lastResults, measurementSettings, shouldPrepareResultsView, store]);
  const storedResultPayBands = resultPayBandsByScenario[resultScenario];
  const activeResultPayBands = useMemo(() => {
    if (!shouldPrepareResultsView) return [];
    if (!filteredResultRows.length && storedResultPayBands.length) {
      const payMin = Math.max(0, Number(measurementSettings.payMin) || 0);
      const payMax = measurementSettings.payMax === '' ? Infinity : Math.max(payMin, Number(measurementSettings.payMax) || 0);
      return storedResultPayBands.filter(row => row.max > payMin + 1e-9 && row.min < payMax - 1e-9);
    }
    return summarizeDomainPriceBands(filteredResultRows.filter(row => !row.ignored), Math.max(1, Number(measurementSettings.payBandSize) || 5), 'pay', { groupByScenario: false });
  }, [filteredResultRows, measurementSettings.payBandSize, measurementSettings.payMax, measurementSettings.payMin, shouldPrepareResultsView, storedResultPayBands]);
  const selectedResultPayBandKeys = selectedResultPayBandKeyByScenarioPlatform[resultScenario];
  const lastOptimizations = lastOptimizationsByScenario[resultScenario];
  const activityDesign = activityDesignByScenario[ACTIVITY_DESIGN_RESULT_SCENARIO];
  const storedResultSummary = resultSummariesByScenario[resultScenario] as MeasurementResult['summary'];
  const filteredResultSummary = useMemo(() => {
    if (!filteredResultRows.length && storedResultPayBands.length) return storedResultSummary;
    return buildMeasurementSummaryFromRows(filteredResultRows, storedResultSummary.elapsedTime);
  }, [filteredResultRows, storedResultPayBands.length, storedResultSummary]);
  const activeResultSummary = isResultsLoading ? summary : filteredResultSummary;
  const measurementPersistenceMeta = measurementPersistenceMetaByScenario[resultScenario];
  const activeResultWarnings = [
    ...resultWarningsByScenario[resultScenario],
    ...optimizationWarningsByScenario[resultScenario]
  ];
  const resultPlatformViews = useMemo(() => {
    return PLATFORMS.reduce((views, platform) => {
      const payBands = activeResultPayBands.filter(row => row.platform === platform);
      const selectedPayBandKey = selectedResultPayBandKeys[platform] || 'all';
      const selectedPayBand = payBands.find(row => row.key === selectedPayBandKey) || null;
      const platformRows = filteredResultRows.filter(row => row.platform === platform);
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
  }, [activeResultPayBands, filteredResultRows, riskOnly, selectedResultPayBandKeys]);
  const activeResultPlatformView = resultPlatformViews[resultPlatformTab];
  const selectedResultBandView = selectedResultBand ? resultPlatformViews[selectedResultBand.platform] : null;
  const selectedResultBandKey = selectedResultBand?.payBandKey || 'all';
  const selectedResultBandPayBand = selectedResultBandView && selectedResultBandKey !== 'all'
    ? selectedResultBandView.payBands.find(row => row.key === selectedResultBandKey) || null
    : null;
  const selectedResultBandRows = useMemo(() => {
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
    return sortMeasurementRows(baseRows.slice());
  }, [loadedResultBandRows, selectedResultBand, selectedResultBandKey, selectedResultBandPayBand, selectedResultBandView]);
  const selectedResultBandFilteredRows = useMemo(() => {
    const keyword = resultDetailSearchText.trim().toLowerCase();
    if (!keyword) return selectedResultBandRows;
    return selectedResultBandRows.filter(row => row.items.some(item => item.name.toLowerCase().includes(keyword)));
  }, [resultDetailSearchText, selectedResultBandRows]);
  const selectedResultBandRiskRows = useMemo(() => {
    return selectedResultBandFilteredRows
      .filter(row => row.risk?.hasRisk)
      .sort((a, b) => (b.risk?.severityRank || 0) - (a.risk?.severityRank || 0));
  }, [selectedResultBandFilteredRows]);
  const selectedResultProductRows = useMemo(() => {
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
  const selectedResultProductPayBounds = useMemo(() => {
    if (!selectedResultProductRows.length) return null;
    let min = selectedResultProductRows[0].finalPay;
    let max = selectedResultProductRows[0].finalPay;
    selectedResultProductRows.forEach(row => {
      min = Math.min(min, row.finalPay);
      max = Math.max(max, row.finalPay);
    });
    return { min: roundMoney(min), max: roundMoney(max) };
  }, [selectedResultProductRows]);
  const selectedResultProductFilteredRows = useMemo(() => {
    if (!resultProductPayRange || !selectedResultProductPayBounds) return selectedResultProductRows;
    const min = clamp(Math.min(resultProductPayRange[0], resultProductPayRange[1]), selectedResultProductPayBounds.min, selectedResultProductPayBounds.max);
    const max = clamp(Math.max(resultProductPayRange[0], resultProductPayRange[1]), selectedResultProductPayBounds.min, selectedResultProductPayBounds.max);
    return selectedResultProductRows.filter(row => row.finalPay + 1e-9 >= min && row.finalPay <= max + 1e-9);
  }, [resultProductPayRange, selectedResultProductPayBounds, selectedResultProductRows]);
  const selectedResultProductChartRows = useMemo(() => {
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
  }, [selectedResultProductRows]);
  const selectedResultProductTableRows = useMemo(() => {
    return selectedResultProductFilteredRows.map((row, index) => ({
      ...row,
      index: index + 1,
      profitRateGapAmount: row.netProfitRate === null ? null : row.netProfitRate - row.targetNetRate
    }));
  }, [selectedResultProductFilteredRows]);
  const selectedResultProductStats = useMemo(() => {
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
  const selectedCostIssue = useMemo(() => costAnalysis?.issues.find(issue => issue.key === selectedCostProductKey), [costAnalysis, selectedCostProductKey]);
  const selectedCurvePoints = useMemo(() => costAnalysis?.curvePoints.filter(point => point.productKey === selectedCostProductKey) || [], [costAnalysis, selectedCostProductKey]);
  const selectedCostDetails = useMemo(() => costAnalysis?.details.filter(row => row.productKey === selectedCostProductKey) || [], [costAnalysis, selectedCostProductKey]);
  const selectedPricingIssue = useMemo(() => pricingEvaluation?.productRows.find(issue => issue.key === selectedPricingProductKey), [pricingEvaluation, selectedPricingProductKey]);
  const selectedCostAdjustments = useMemo(() => {
    if (!selectedCostIssue) return [];
    return store.costPriceAdjustments.filter(record => record.platform === selectedCostIssue.platform && record.productId === selectedCostIssue.productId);
  }, [store.costPriceAdjustments, selectedCostIssue]);

  React.useEffect(() => {
    routePageRef.current = routePage;
    setState(prev => prev.activePage === routePage ? prev : normalizeState({ ...prev, activePage: routePage }));
    cancelAllEdits();
    applyPendingAsyncCalculationResult(routePage);
  }, [routePage]);

  React.useEffect(() => {
    let ignore = false;
    browserDataRepository.loadCalculatorState()
      .then(loaded => {
        if (!ignore && loaded) {
          setState(stateWithCurrentRoutePage(loaded));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  React.useEffect(() => {
    if (routePage !== 'results') return undefined;
    let ignore = false;
    const storeId = store.id;
    const scenario = MEASUREMENT_RESULT_SCENARIO;
    setIsMeasurementCacheLoading(true);
    browserDataRepository.loadMeasurementRecord(storeId, scenario)
      .then(record => {
        if (ignore || storeId !== currentStoreFrom(stateRef.current).id) return;
        if (!record) {
          setLastResultsByScenario(prev => ({ ...prev, [scenario]: [] }));
          setResultPayBandsByScenario(prev => ({ ...prev, [scenario]: [] }));
          setMeasurementPersistenceMetaByScenario(prev => ({ ...prev, [scenario]: null }));
          return;
        }
        const result = measurementRecordToResult(record, measurementSettings.payBandSize);
        setLastResultsByScenario(prev => {
          if (prev[scenario] === result.rows) return prev;
          return { ...prev, [scenario]: result.rows };
        });
        setResultWarningsByScenario(prev => {
          if (prev[scenario] === result.warnings) return prev;
          return { ...prev, [scenario]: result.warnings };
        });
        setResultSummariesByScenario(prev => {
          if (prev[scenario] === result.summary) return prev;
          return { ...prev, [scenario]: result.summary };
        });
        setMeasurementPersistenceMetaByScenario(prev => {
          if (prev[scenario] === record.meta) return prev;
          return { ...prev, [scenario]: record.meta };
        });
        setResultPayBandsByScenario(prev => {
          if (prev[scenario] === result.payBands) return prev;
          return { ...prev, [scenario]: result.payBands };
        });
      })
      .catch(() => undefined)
      .finally(() => {
        if (!ignore) setIsMeasurementCacheLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [measurementSettings.payBandSize, routePage, store.id]);

  React.useEffect(() => {
    setLoadedResultBandRows(null);
    setSelectedResultProduct(null);
    setResultProductPayRange(null);
  }, [measurementSettings.originalMin, measurementSettings.originalMax, measurementSettings.payMin, measurementSettings.payMax, store.id]);

  React.useEffect(() => {
    return () => cancelMeasurementCacheWarmup();
  }, []);

  React.useEffect(() => {
    if (!costModalDragStart || isCostModalFullscreen) return undefined;
    const move = (event: MouseEvent) => {
      setCostModalOffset({
        x: costModalDragStart.startX + event.clientX - costModalDragStart.pointerX,
        y: costModalDragStart.startY + event.clientY - costModalDragStart.pointerY
      });
    };
    const stop = () => setCostModalDragStart(null);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', stop);
    };
  }, [costModalDragStart, isCostModalFullscreen]);

  React.useEffect(() => {
    if (!selectedCostIssue) {
      setCostAdjustmentPrice(null);
      return;
    }
    setCostAdjustmentPrice(selectedCostIssue.suggestedPrice ?? selectedCostIssue.currentPrice);
  }, [selectedCostIssue?.key, selectedCostIssue?.suggestedPrice, selectedCostIssue?.currentPrice]);

  function mutateState(mutator: (draft: CalculatorState) => void) {
    setState(prev => {
      const draft = deepClone(prev);
      mutator(draft);
      return normalizeState(draft);
    });
  }

  async function commitState(mutator: (draft: CalculatorState) => void, successMessage: string) {
    const draft = deepClone(state);
    mutator(draft);
    const normalized = normalizeState(draft);
    setState(normalized);
    try {
      await browserDataRepository.saveCalculatorState(normalized);
      scheduleMeasurementCacheWarmup(normalized);
      message.success(successMessage);
    } catch {
      message.warning('已更新当前页面，但保存到浏览器数据库失败。');
    }
  }

  function stateWithCurrentRoutePage(value: unknown) {
    const next = normalizeState(value);
    next.activePage = routePageRef.current;
    return next;
  }

  function mutateStore(mutator: (draft: Store, root: CalculatorState) => void) {
    mutateState(draft => {
      const draftStore = currentStoreFrom(draft);
      mutator(draftStore, draft);
    });
  }

  function startStoreEdit() {
    cancelProductsEdit();
    cancelPlatformEdit();
    cancelActivityEdit();
    setStoreDraft(deepClone(store));
    setIsStoreEditing(true);
  }

  function updateStoreDraft(mutator: (draft: Store) => void) {
    setStoreDraft(prev => {
      const draft = deepClone(prev || store);
      mutator(draft);
      return draft;
    });
  }

  function cancelStoreEdit() {
    setIsStoreEditing(false);
    setStoreDraft(null);
  }

  async function saveStoreEdit() {
    if (!storeDraft) return;
    const nextStore = deepClone(storeDraft);
    if (nextStore.calculationTotalMax !== '' && nextStore.calculationTotalMax < nextStore.calculationTotalMin) {
      nextStore.calculationTotalMax = nextStore.calculationTotalMin;
    }
    if (nextStore.stapleCountMax !== '' && nextStore.stapleCountMax < nextStore.stapleCountMin) {
      nextStore.stapleCountMax = nextStore.stapleCountMin;
    }
    await commitState(draft => {
      draft.stores = draft.stores.map(item => item.id === nextStore.id ? nextStore : item);
    }, '门店信息已保存到浏览器数据库。');
    setIsStoreEditing(false);
    setStoreDraft(null);
    clearCalculatedState();
  }

  function startProductsEdit() {
    cancelStoreEdit();
    cancelPlatformEdit();
    cancelActivityEdit();
    setProductsDraft(normalizeProductList(store.products));
    setIsProductsEditing(true);
    resetProductBulkState();
  }

  function updateProductsDraft(mutator: (draft: Product[]) => void) {
    setProductsDraft(prev => {
      const draft = deepClone(prev || store.products);
      mutator(draft);
      return normalizeProductList(draft);
    });
  }

  function cancelProductsEdit() {
    setIsProductsEditing(false);
    setProductsDraft(null);
    setBulkText('');
    resetProductBulkState();
  }

  async function saveProductsEdit() {
    if (!productsDraft) return;
    await commitState(draft => {
      currentStoreFrom(draft).products = normalizeProductList(productsDraft);
    }, '商品信息已保存到浏览器数据库。');
    setIsProductsEditing(false);
    setProductsDraft(null);
    setBulkText('');
    resetProductBulkState();
    clearCalculatedState();
  }

  function resetProductBulkState() {
    setSelectedProductRowKeys([]);
    setBulkPriceValue(null);
    setBulkProductCategory('staple');
    setBulkStapleServingCount(null);
  }

  function selectedProductIdSet() {
    return new Set(selectedProductRowKeys.map(String));
  }

  function requireSelectedProducts() {
    if (selectedProductRowKeys.length > 0) return true;
    message.warning('请先选择需要批量操作的商品。');
    return false;
  }

  function updateSelectedProducts(mutator: (product: Product) => void) {
    if (!requireSelectedProducts()) return false;
    const selectedIds = selectedProductIdSet();
    updateProductsDraft(draft => {
      draft.forEach(product => {
        if (selectedIds.has(product.id)) mutator(product);
      });
    });
    return true;
  }

  function bulkSetProductFlag(field: 'meituanEnabled' | 'elemeEnabled' | 'nonStandalone', value: boolean) {
    const ok = updateSelectedProducts(product => {
      product[field] = value;
    });
    if (ok) message.success(`已批量更新 ${selectedProductRowKeys.length} 个商品。`);
  }

  function bulkSetProductCategory() {
    const ok = updateSelectedProducts(product => {
      product.category = bulkProductCategory;
      product.stapleServingCount = inferStapleServingCount(product.name, bulkProductCategory);
    });
    if (ok) message.success(`已批量设置 ${selectedProductRowKeys.length} 个商品分类。`);
  }

  function bulkSetStapleServingCount() {
    if (bulkStapleServingCount === null || !Number.isFinite(bulkStapleServingCount)) {
      message.warning('请输入主食份数。');
      return;
    }
    const nextCount = Math.max(0, Math.floor(bulkStapleServingCount));
    const ok = updateSelectedProducts(product => {
      product.stapleServingCount = nextCount;
    });
    if (ok) message.success(`已批量设置 ${selectedProductRowKeys.length} 个商品主食份数。`);
  }

  function bulkClearPlatformOverride(field: 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee') {
    const ok = updateSelectedProducts(product => {
      product[field] = '';
    });
    if (ok) message.success(`已清空 ${selectedProductRowKeys.length} 个商品的平台覆盖值。`);
  }

  function bulkPriceBaseValue(product: Product, field: ProductBulkPriceField) {
    if (field === 'meituanPrice') return platformPrice(product, 'meituan');
    if (field === 'elemePrice') return platformPrice(product, 'eleme');
    if (field === 'meituanPackageFee') return platformPackageFee(product, 'meituan');
    if (field === 'elemePackageFee') return platformPackageFee(product, 'eleme');
    return Number(product[field]) || 0;
  }

  function resolveBulkPriceValue(product: Product, field: ProductBulkPriceField, value: number) {
    const current = bulkPriceBaseValue(product, field);
    if (bulkPriceMode === 'set') return Math.max(0, value);
    if (bulkPriceMode === 'increase') return Math.max(0, current + value);
    return Math.max(0, current * normalizeDiscountRate(value));
  }

  function applyBulkPriceEdit() {
    if (!requireSelectedProducts()) return;
    if (bulkPriceValue === null || !Number.isFinite(bulkPriceValue)) {
      message.warning('请输入批量调整的数值。');
      return;
    }
    const selectedIds = selectedProductIdSet();
    updateProductsDraft(draft => {
      draft.forEach(product => {
        if (!selectedIds.has(product.id)) return;
        product[bulkPriceField] = roundMoney(resolveBulkPriceValue(product, bulkPriceField, bulkPriceValue));
      });
    });
    message.success(`已批量调整 ${selectedProductRowKeys.length} 个商品。`);
  }

  function bulkDeleteProducts() {
    if (!requireSelectedProducts()) return;
    const selectedIds = selectedProductIdSet();
    const selectedProducts = displayedProducts.filter(product => selectedIds.has(product.id));
    const preview = selectedProducts.slice(0, 5).map(product => product.name).join('、');
    modal.confirm({
      title: '批量删除商品',
      content: `确定删除选中的 ${selectedProducts.length} 个商品吗？${preview ? `包括：${preview}${selectedProducts.length > 5 ? '等' : ''}` : ''}。删除只会先进入编辑草稿，保存商品后才会生效。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        updateProductsDraft(draft => {
          for (let index = draft.length - 1; index >= 0; index--) {
            if (selectedIds.has(draft[index].id)) draft.splice(index, 1);
          }
        });
        setSelectedProductRowKeys([]);
      }
    });
  }

  function deleteZeroPriceProducts() {
    const zeroProducts = displayedProducts.filter(product =>
      roundMoney(product.price) <= 0 &&
      (product.meituanPrice === '' || roundMoney(product.meituanPrice) <= 0) &&
      (product.elemePrice === '' || roundMoney(product.elemePrice) <= 0)
    );
    if (!zeroProducts.length) {
      message.info('当前没有 0 元商品。');
      return;
    }
    const zeroIds = new Set(zeroProducts.map(product => product.id));
    const preview = zeroProducts.slice(0, 5).map(product => product.name).join('、');
    modal.confirm({
      title: '删除0元商品',
      content: `确定删除 ${zeroProducts.length} 个 0 元商品吗？${preview ? `包括：${preview}${zeroProducts.length > 5 ? '等' : ''}` : ''}。删除只会先进入编辑草稿，保存商品后才会生效。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        updateProductsDraft(draft => {
          for (let index = draft.length - 1; index >= 0; index--) {
            if (zeroIds.has(draft[index].id)) draft.splice(index, 1);
          }
        });
        setSelectedProductRowKeys(prev => prev.filter(key => !zeroIds.has(String(key))));
      }
    });
  }

  function startPlatformEdit() {
    cancelStoreEdit();
    cancelProductsEdit();
    cancelActivityEdit();
    setPlatformDraft(deepClone(state.platformRules));
    setIsPlatformEditing(true);
  }

  function updatePlatformDraft(mutator: (draft: FeeRule) => void) {
    setPlatformDraft(prev => {
      const draft = deepClone(prev || state.platformRules);
      mutator(draft);
      return draft;
    });
  }

  function cancelPlatformEdit() {
    setIsPlatformEditing(false);
    setPlatformDraft(null);
  }

  async function savePlatformEdit() {
    if (!platformDraft) return;
    await commitState(draft => {
      draft.platformRules = deepClone(platformDraft);
    }, '平台通用规则已保存到浏览器数据库。');
    setIsPlatformEditing(false);
    setPlatformDraft(null);
    clearCalculatedState();
  }

  function startActivityEdit(platform: Platform) {
    cancelStoreEdit();
    cancelProductsEdit();
    cancelPlatformEdit();
    setEditingActivityPlatform(platform);
    setActivityDraft(deepClone(store.activities[platform]));
  }

  function updateActivityDraft(mutator: (draft: Activities) => void) {
    setActivityDraft(prev => {
      const platform = editingActivityPlatform || 'meituan';
      const draft = deepClone(prev || store.activities[platform]);
      mutator(draft);
      return draft;
    });
  }

  function cancelActivityEdit() {
    setEditingActivityPlatform(null);
    setActivityDraft(null);
  }

  async function saveActivityEdit() {
    if (!editingActivityPlatform || !activityDraft) return;
    const platform = editingActivityPlatform;
    await commitState(draft => {
      currentStoreFrom(draft).activities[platform] = deepClone(activityDraft);
    }, `${PLATFORM_NAMES[platform]}活动已保存到浏览器数据库。`);
    setEditingActivityPlatform(null);
    setActivityDraft(null);
    clearCalculatedState();
  }

  function startRiskEdit() {
    cancelStoreEdit();
    cancelProductsEdit();
    cancelPlatformEdit();
    cancelActivityEdit();
    setRiskDraft(state.riskSafetyMargin);
    setIsRiskEditing(true);
  }

  function cancelRiskEdit() {
    setIsRiskEditing(false);
    setRiskDraft(null);
  }

  async function saveRiskEdit() {
    await commitState(draft => {
      draft.riskSafetyMargin = Math.max(0, Number(riskDraft) || 0);
    }, '预警安全边际已保存到浏览器数据库。');
    setIsRiskEditing(false);
    setRiskDraft(null);
    clearCalculatedState();
  }

  function cancelAllEdits() {
    cancelStoreEdit();
    cancelProductsEdit();
    cancelPlatformEdit();
    cancelActivityEdit();
    cancelRiskEdit();
  }

  function cancelAsyncCalculations(slots: AsyncCalculationSlot[] = ['measurement', 'activityDesign', 'pricingEvaluation']) {
    slots.forEach(slot => {
      activeAsyncCalculationRef.current[slot]?.controller.abort();
      delete activeAsyncCalculationRef.current[slot];
      delete latestAsyncCalculationTokenRef.current[slot];
      delete pendingAsyncCalculationResultRef.current[slot];
    });
    if (slots.includes('measurement')) setIsResultsLoading(false);
    if (slots.includes('activityDesign')) setIsActivityDesignLoading(false);
    if (slots.includes('pricingEvaluation')) setIsPricingEvaluationLoading(false);
  }

  function clearCalculatedState() {
    cancelAsyncCalculations();
    setLastResultsByScenario(createScenarioRecord<ComboEvaluationRow[]>(() => []));
    setResultPayBandsByScenario(createScenarioRecord<PriceBandRow[]>(() => []));
    setSelectedResultPayBandKeyByScenarioPlatform(createScenarioPlatformRecord<string>(() => 'all'));
    setMeasurementPersistenceMetaByScenario(createScenarioRecord<MeasurementPersistenceMeta | null>(() => null));
    setLastOptimizationsByScenario(createScenarioRecord<OptimizationRow[]>(() => []));
    setResultSummariesByScenario(createScenarioRecord<Summary>(() => ({ ...EMPTY_SUMMARY })));
    setResultWarningsByScenario(createScenarioRecord<string[]>(() => []));
    setOptimizationWarningsByScenario(createScenarioRecord<string[]>(() => []));
    setCostAnalysis(null);
    setActivityDesignByScenario(createScenarioRecord<RedesignedActivityDesignResult | null>(() => null));
    setPricingEvaluation(null);
    setSelectedCostProductKey('');
    setSelectedPricingProductKey('');
    setSelectedResultBand(null);
    setSelectedActivityDesignBand(null);
    setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
    setSelectedActivityDesignRouteKey('');
    setSelectedResultProduct(null);
    setResultDetailSearchText('');
    setActivityDesignDetailSearchText('');
    setResultProductPayRange(null);
    setLoadedResultBandRows(null);
    setIsMeasurementCacheLoading(false);
    setIsResultBandLoading(false);
    setSummary({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
    setWarnings([]);
  }

  function navigatePage(page: PageKey) {
    cancelAllEdits();
    router.push(pathForPage(page));
    mutateState(draft => {
      draft.activePage = page;
    });
  }

  function addStore() {
    cancelAllEdits();
    router.push(pathForPage(DEFAULT_PAGE_KEY));
    mutateState(draft => {
      const next = deepClone(defaultState.stores[0]);
      next.id = uid('store');
      next.name = `新门店${draft.stores.length + 1}`;
      next.products = [];
      draft.stores.push(next);
      draft.selectedStoreId = next.id;
      draft.activePage = 'store';
    });
    clearCalculatedState();
  }

  function duplicateStore() {
    cancelAllEdits();
    mutateState(draft => {
      const source = currentStoreFrom(draft);
      const copy = deepClone(source);
      copy.id = uid('store');
      copy.name = `${source.name} 副本`;
      draft.stores.push(copy);
      draft.selectedStoreId = copy.id;
    });
    clearCalculatedState();
  }

  function deleteStore() {
    if (state.stores.length <= 1) {
      message.warning('至少保留一个门店。');
      return;
    }
    modal.confirm({
      title: '删除门店',
      content: `确定删除门店「${store.name}」吗？该门店的商品、平台活动和测算配置都会移除。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        cancelAllEdits();
        mutateState(draft => {
          draft.stores = draft.stores.filter(item => item.id !== draft.selectedStoreId);
          draft.selectedStoreId = draft.stores[0].id;
        });
        clearCalculatedState();
      }
    });
  }

  async function saveState() {
    try {
      await browserDataRepository.saveCalculatorState(state);
      message.success('已保存到浏览器数据库。');
    } catch {
      message.error('保存失败，当前浏览器数据库不可用。');
    }
  }

  async function loadState() {
    try {
      const loaded = await browserDataRepository.loadCalculatorState();
      if (!loaded) {
        message.warning('当前浏览器数据库没有保存过配置。');
        return;
      }
      setState(stateWithCurrentRoutePage(loaded));
      cancelAllEdits();
      clearCalculatedState();
      message.success('已从浏览器数据库读取配置。');
    } catch {
      message.error('读取失败，浏览器数据库数据可能已损坏。');
    }
  }

  function importConfig(file: File) {
    file.text().then(text => {
      try {
        setState(stateWithCurrentRoutePage(JSON.parse(text)));
        cancelAllEdits();
        clearCalculatedState();
        message.success('配置已导入。');
      } catch {
        message.error('导入失败，请确认是新版配置 JSON。');
      }
    });
  }

  function resetState() {
    modal.confirm({
      title: '恢复示例',
      content: '确定恢复示例配置吗？当前未保存的修改会丢失。',
      okText: '恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        setState(stateWithCurrentRoutePage(deepClone(defaultState)));
        cancelAllEdits();
        clearCalculatedState();
      }
    });
  }

  function updateProductDraft(productId: string, patch: Partial<Product>) {
    updateProductsDraft(draft => {
      const index = draft.findIndex(product => product.id === productId);
      if (index < 0) return;
      draft[index] = normalizeProduct({ ...draft[index], ...patch });
    });
  }

  function deleteProductDraft(productId: string) {
    const product = (productsDraft || store.products).find(item => item.id === productId);
    if (!product) return;
    modal.confirm({
      title: '删除商品',
      content: `确定删除「${product.name}」吗？删除后当前门店的该商品价格、成本和上下架状态都会移除。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        updateProductsDraft(draft => {
          const index = draft.findIndex(item => item.id === productId);
          if (index < 0) return;
          draft.splice(index, 1);
        });
        setSelectedProductRowKeys(prev => prev.filter(key => String(key) !== product.id));
      }
    });
  }

  function uploadProps(handler: (file: File) => void): UploadProps {
    return {
      accept: '.xls,.xlsx,.csv,.txt,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,text/plain,application/json',
      showUploadList: false,
      beforeUpload: file => {
        handler(file as File);
        return false;
      }
    };
  }

  function syncUnifiedPackageFeeFromImport(product: Product, importedPackageFee: number | undefined) {
    if (importedPackageFee === undefined || importedPackageFee <= 0) return false;
    const nextPackageFee = roundMoney(importedPackageFee);
    if (roundMoney(product.packageFee) === nextPackageFee) return false;
    product.packageFee = nextPackageFee;
    return true;
  }

  async function importPlatformProducts(file: File, platform: Platform) {
    if (!isProductsEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    try {
      const parsed = parsePlatformProductWorkbook(await readWorkbook(file), platform);
      if (!parsed.products.length) {
        message.warning(`没有识别到有效${PLATFORM_NAMES[platform]}商品，请确认表格包含商品名称和价格列。`);
        return;
      }
      const rule = PLATFORM_PRODUCT_IMPORT_RULES[platform];
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      updateProductsDraft(draft => {
        const productMap = new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
        parsed.products.forEach(item => {
          const key = normalizeProductMatchName(item.name);
          const existing = productMap.get(key);
          if (existing) {
            const oldValue = normalizeOptionalPrice(existing[rule.priceField]);
            const oldPackageFee = existing[rule.packageFeeField];
            const oldEnabled = isProductListedOnPlatform(existing, platform);
            existing[rule.priceField] = item.price;
            if (item.packageFee !== undefined) existing[rule.packageFeeField] = item.packageFee;
            const unifiedPackageFeeChanged = syncUnifiedPackageFeeFromImport(existing, item.packageFee);
            if (item.platformEnabled !== undefined) existing[rule.enabledField] = item.platformEnabled;
            const enabledChanged = item.platformEnabled !== undefined && oldEnabled !== item.platformEnabled;
            const packageFeeChanged = item.packageFee !== undefined && oldPackageFee !== item.packageFee;
            if (oldValue === item.price && !enabledChanged && !packageFeeChanged && !unifiedPackageFeeChanged) unchanged++;
            else updated++;
            return;
          }
          const product = normalizeProduct({
            id: uid('p'),
            name: item.name,
            price: item.price,
            cost: 0,
            meituanPrice: '',
            elemePrice: '',
            meituanEnabled: true,
            elemeEnabled: true,
            nonStandalone: false
          });
          product[rule.priceField] = item.price;
          if (item.packageFee !== undefined) product[rule.packageFeeField] = item.packageFee;
          syncUnifiedPackageFeeFromImport(product, item.packageFee);
          if (item.platformEnabled !== undefined) product[rule.enabledField] = item.platformEnabled;
          draft.push(product);
          productMap.set(key, product);
          added++;
        });
      });
      message.success(`已导入${PLATFORM_NAMES[platform]}商品：识别 ${parsed.products.length} 个，更新 ${updated} 个，新增 ${added} 个，未变化 ${unchanged} 个。`);
      if (parsed.disabled) message.info(`其中 ${parsed.disabled} 个商品为下架或暂停售卖状态。`);
    } catch {
      message.error(`导入${PLATFORM_NAMES[platform]}商品表失败，请确认文件格式。`);
    }
  }

  async function importCostFile(file: File) {
    if (!isProductsEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    try {
      const parsed = parseCostWorkbook(await readWorkbook(file));
      if (!parsed.costs.length) {
        message.warning('没有识别到有效成本数据，请确认表格包含商品名称和成本价列。');
        return;
      }
      let updated = 0;
      let unchanged = 0;
      let unmatched = 0;
      updateProductsDraft(draft => {
        const productMap = new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
        parsed.costs.forEach(item => {
          const product = productMap.get(normalizeProductMatchName(item.name));
          if (!product) {
            unmatched++;
            return;
          }
          const oldCost = roundMoney(product.cost);
          product.cost = item.cost;
          if (oldCost === item.cost) unchanged++;
          else updated++;
        });
      });
      message.success(`成本导入完成：识别 ${parsed.costs.length} 条，更新 ${updated} 个，未变化 ${unchanged} 个，未匹配 ${unmatched} 个。`);
    } catch {
      message.error('导入成本表失败，请确认文件包含商品名称和成本价列。');
    }
  }

  function importProductsFile(file: File) {
    if (!isProductsEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    file.text().then(text => {
      const products = parseProducts(text);
      if (!products.length) {
        message.warning('没有识别到有效商品。');
        return;
      }
      updateProductsDraft(draft => {
        draft.push(...products);
      });
      message.success(`已导入 ${products.length} 个商品。`);
    });
  }

  function applyBulkProducts(mode: 'append' | 'replace') {
    if (!isProductsEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    const products = parseProducts(bulkText);
    if (!products.length) {
      message.warning('没有识别到有效商品。');
      return;
    }
    const apply = () => {
      updateProductsDraft(draft => {
        if (mode === 'replace') {
          draft.splice(0, draft.length, ...products);
          return;
        }
        draft.push(...products);
      });
      if (mode === 'replace') setSelectedProductRowKeys([]);
      setBulkText('');
    };
    if (mode === 'replace') {
      modal.confirm({
        title: '替换商品',
        content: `确定用 ${products.length} 个商品替换当前门店商品吗？当前门店原商品会被移除。`,
        okText: '替换',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: apply
      });
      return;
    }
    apply();
  }

  function beginAsyncCalculation(slot: AsyncCalculationSlot, page: PageKey): AsyncCalculationTask {
    activeAsyncCalculationRef.current[slot]?.controller.abort();
    const token = `${slot}-${Date.now().toString(36)}-${asyncCalculationSeqRef.current++}`;
    const task = { token, page, controller: new AbortController() };
    latestAsyncCalculationTokenRef.current[slot] = token;
    activeAsyncCalculationRef.current[slot] = task;
    delete pendingAsyncCalculationResultRef.current[slot];
    return task;
  }

  function isAsyncCalculationCurrent(slot: AsyncCalculationSlot, token: string) {
    return latestAsyncCalculationTokenRef.current[slot] === token;
  }

  function finishAsyncCalculation(slot: AsyncCalculationSlot, token: string) {
    if (activeAsyncCalculationRef.current[slot]?.token === token) {
      delete activeAsyncCalculationRef.current[slot];
    }
  }

  function asyncCalculationOptions(task: AsyncCalculationTask) {
    return {
      signal: task.controller.signal,
      maxDurationMs: ASYNC_CALCULATION_MAX_DURATION_MS,
      timeoutMs: ASYNC_CALCULATION_WORKER_TIMEOUT_MS
    };
  }

  function shouldWriteAsyncCalculation(slot: AsyncCalculationSlot, token: string, page: PageKey) {
    return isAsyncCalculationCurrent(slot, token) && routePageRef.current === page;
  }

  function applyAsyncCalculationResult(pending: PendingAsyncCalculationResult) {
    if (pending.slot === 'measurement') {
      setLastResultsByScenario(prev => ({ ...prev, [pending.scenario]: pending.result.rows }));
      setResultPayBandsByScenario(prev => ({ ...prev, [pending.scenario]: pending.result.payBands }));
      setResultWarningsByScenario(prev => ({ ...prev, [pending.scenario]: pending.result.warnings }));
      setResultSummariesByScenario(prev => ({ ...prev, [pending.scenario]: pending.result.summary }));
      setSummary(pending.result.summary);
      return;
    }
    if (pending.slot === 'activityDesign') {
      setActivityDesignByScenario(prev => ({ ...prev, [pending.scenario]: pending.result }));
      setSummary(pending.result.summary);
      return;
    }
    setPricingEvaluation(pending.result);
    setWarnings(pending.result.warnings);
    setSummary(pending.result.summary);
  }

  function applyOrQueueAsyncCalculationResult(pending: PendingAsyncCalculationResult) {
    if (!isAsyncCalculationCurrent(pending.slot, pending.token)) return;
    if (routePageRef.current === pending.page) {
      applyAsyncCalculationResult(pending);
      return;
    }
    pendingAsyncCalculationResultRef.current[pending.slot] = pending;
  }

  function applyPendingAsyncCalculationResult(page: PageKey) {
    (Object.keys(pendingAsyncCalculationResultRef.current) as AsyncCalculationSlot[]).forEach(slot => {
      const pending = pendingAsyncCalculationResultRef.current[slot];
      if (!pending || pending.page !== page) return;
      delete pendingAsyncCalculationResultRef.current[slot];
      if (isAsyncCalculationCurrent(pending.slot, pending.token)) applyAsyncCalculationResult(pending);
    });
  }

  function reportAsyncCalculationError(slot: AsyncCalculationSlot, token: string, page: PageKey, error: unknown, fallback: string) {
    if (isCalculationAbortError(error) || !isAsyncCalculationCurrent(slot, token) || routePageRef.current !== page) return;
    message.error(error instanceof Error ? error.message : fallback);
  }

  function cancelMeasurementCacheWarmup() {
    measurementCacheWarmupSeqRef.current += 1;
    if (measurementCacheWarmupIdleRef.current !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
      (window as Window & { cancelIdleCallback: (id: number) => void }).cancelIdleCallback(measurementCacheWarmupIdleRef.current);
    }
    if (measurementCacheWarmupTimeoutRef.current !== null) {
      clearTimeout(measurementCacheWarmupTimeoutRef.current);
    }
    measurementCacheWarmupControllerRef.current?.abort();
    measurementCacheWarmupIdleRef.current = null;
    measurementCacheWarmupTimeoutRef.current = null;
    measurementCacheWarmupControllerRef.current = null;
  }

  function applyWarmupMeasurementRecord(storeId: string, scenario: StapleScenario, record: PersistedMeasurementRecord) {
    if (currentStoreFrom(stateRef.current).id !== storeId) return;
    if (routePageRef.current !== 'results') return;
    if (resultScenarioRef.current !== scenario) return;
    const result = measurementRecordToResult(record, measurementSettings.payBandSize);
    setLastResultsByScenario(prev => ({ ...prev, [scenario]: result.rows }));
    setResultPayBandsByScenario(prev => ({ ...prev, [scenario]: result.payBands }));
    setResultWarningsByScenario(prev => ({ ...prev, [scenario]: result.warnings }));
    setResultSummariesByScenario(prev => ({ ...prev, [scenario]: result.summary }));
    setMeasurementPersistenceMetaByScenario(prev => ({ ...prev, [scenario]: record.meta }));
  }

  async function runMeasurementCacheWarmup(sourceState: CalculatorState, sourceSettings: MeasurementSettings, token: number) {
    const targetStore = currentStoreFrom(sourceState);
    const scenario = MEASUREMENT_RESULT_SCENARIO;
    if (measurementCacheWarmupSeqRef.current !== token) return;
    const persistenceSettings = buildMeasurementPersistenceSettings(targetStore, sourceSettings);
    const parentKey = measurementRecordKey(targetStore.id, scenario);
    const previousRecord = await browserDataRepository.loadMeasurementRecord(targetStore.id, scenario);
    const chunkWriter = browserDataRepository.createMeasurementChunkWriter(parentKey);
    const controller = new AbortController();
    measurementCacheWarmupControllerRef.current = controller;
    try {
      const result = await runCalculationTask('measurement', {
        state: sourceState,
        platformFilter: 'all',
        settings: persistenceSettings
      }, undefined, {
        signal: controller.signal,
        maxDurationMs: ASYNC_CALCULATION_MAX_DURATION_MS,
        timeoutMs: ASYNC_CALCULATION_WORKER_TIMEOUT_MS,
        onRowsChunk: rows => chunkWriter.write(rows)
      });
      if (measurementCacheWarmupSeqRef.current !== token) return;
      const record = await browserDataRepository.saveChunkedMeasurementRecord(targetStore, scenario, persistenceSettings, result, chunkWriter.keys());
      await browserDataRepository.deleteMeasurementRecordChunks(previousRecord);
      if (measurementCacheWarmupSeqRef.current !== token) return;
      applyWarmupMeasurementRecord(targetStore.id, scenario, record);
    } catch (error) {
      if (!isCalculationAbortError(error)) return;
    } finally {
      if (measurementCacheWarmupControllerRef.current === controller) {
        measurementCacheWarmupControllerRef.current = null;
      }
    }
  }

  function scheduleMeasurementCacheWarmup(sourceState: CalculatorState) {
    if (typeof window === 'undefined') return;
    cancelMeasurementCacheWarmup();
    const token = measurementCacheWarmupSeqRef.current;
    const sourceSettings = { ...measurementSettings };
    const start = () => {
      measurementCacheWarmupIdleRef.current = null;
      measurementCacheWarmupTimeoutRef.current = null;
      void runMeasurementCacheWarmup(deepClone(sourceState), sourceSettings, token);
    };
    if ('requestIdleCallback' in window) {
      measurementCacheWarmupIdleRef.current = (window as Window & { requestIdleCallback: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number }).requestIdleCallback(start, { timeout: 3000 });
      return;
    }
    measurementCacheWarmupTimeoutRef.current = setTimeout(start, 1200);
  }

  async function openResultBandDetail(platform: Platform, payBandKey: string) {
    const payBand = payBandKey === 'all'
      ? null
      : activeResultPayBands.find(row => row.platform === platform && row.key === payBandKey) || null;
    const nextBand = { platform, payBandKey };
    setSelectedResultBand(nextBand);
    setResultDetailSearchText('');
    setSelectedResultProduct(null);
    setResultProductPayRange(null);
    setLoadedResultBandRows(null);
    const seq = resultBandLoadSeqRef.current + 1;
    resultBandLoadSeqRef.current = seq;
    setIsResultBandLoading(true);
    try {
      const record = await browserDataRepository.loadMeasurementRecord(store.id, MEASUREMENT_RESULT_SCENARIO);
      if (!record || resultBandLoadSeqRef.current !== seq) return;
      const loaded = await browserDataRepository.loadMeasurementRows(record, {
        store,
        settings: measurementSettings,
        platform,
        payBand,
        limit: MEASUREMENT_DETAIL_ROW_LIMIT
      });
      if (resultBandLoadSeqRef.current !== seq) return;
      setLoadedResultBandRows({
        platform,
        payBandKey,
        rows: loaded.rows,
        matchedCount: loaded.matchedCount,
        truncated: loaded.truncated
      });
    } catch (error) {
      if (resultBandLoadSeqRef.current === seq) {
        message.error(error instanceof Error ? error.message : '读取区间明细失败。');
      }
    } finally {
      if (resultBandLoadSeqRef.current === seq) setIsResultBandLoading(false);
    }
  }

  async function runResults() {
    if (isResultsLoading) return;
    cancelMeasurementCacheWarmup();
    const scenario = MEASUREMENT_RESULT_SCENARIO;
    const persistenceSettings = buildMeasurementPersistenceSettings(store, measurementSettings);
    const parentKey = measurementRecordKey(store.id, scenario);
    const task = beginAsyncCalculation('measurement', 'results');
    setIsResultsLoading(true);
    await waitForLoadingPaint();
    try {
      const previousRecord = await browserDataRepository.loadMeasurementRecord(store.id, scenario);
      const chunkWriter = browserDataRepository.createMeasurementChunkWriter(parentKey);
      setLastResultsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setResultPayBandsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setSelectedResultPayBandKeyByScenarioPlatform(prev => ({
        ...prev,
        [scenario]: { meituan: 'all', eleme: 'all' }
      }));
      setLastOptimizationsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setResultWarningsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setOptimizationWarningsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setResultSummariesByScenario(prev => ({ ...prev, [scenario]: { ...EMPTY_SUMMARY } }));
      setSummary({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const result = await runCalculationTask('measurement', {
        state,
        platformFilter: 'all',
        settings: persistenceSettings
      }, progress => {
        if (shouldWriteAsyncCalculation('measurement', task.token, task.page)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        ...asyncCalculationOptions(task),
        onRowsChunk: rows => chunkWriter.write(rows)
      });
      const record = await browserDataRepository.saveChunkedMeasurementRecord(store, scenario, persistenceSettings, result, chunkWriter.keys());
      await browserDataRepository.deleteMeasurementRecordChunks(previousRecord);
      setMeasurementPersistenceMetaByScenario(prev => ({ ...prev, [scenario]: record.meta }));
      applyOrQueueAsyncCalculationResult({ slot: 'measurement', token: task.token, page: 'results', scenario, result: measurementRecordToResult(record, measurementSettings.payBandSize) });
    } catch (error) {
      reportAsyncCalculationError('measurement', task.token, task.page, error, '测算结果生成失败。');
    } finally {
      if (isAsyncCalculationCurrent('measurement', task.token)) setIsResultsLoading(false);
      finishAsyncCalculation('measurement', task.token);
    }
  }

  async function runOptimization() {
    if (isOptimizationLoading) return;
    const scenario = MEASUREMENT_RESULT_SCENARIO;
    setIsOptimizationLoading(true);
    await waitForLoadingPaint();
    try {
      setLastOptimizationsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setOptimizationWarningsByScenario(prev => ({ ...prev, [scenario]: [] }));
      setSummary({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const result = await runOptimizationCalculationAsync(state, 'all', progress => {
        setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
      });
      setLastOptimizationsByScenario(prev => ({ ...prev, [scenario]: result.optimizations }));
      setOptimizationWarningsByScenario(prev => ({ ...prev, [scenario]: result.warnings }));
      setSummary(result.summary);
    } finally {
      setIsOptimizationLoading(false);
    }
  }

  async function runCostAnalysis() {
    if (isCostAnalysisLoading) return;
    setIsCostAnalysisLoading(true);
    await waitForLoadingPaint();
    try {
      const result = runCostAnalysisCalculation(state, costPlatformFilter, costAnalysisSettings);
      setCostAnalysis(result);
      setSelectedCostProductKey('');
      setWarnings(result.warnings);
      setSummary(result.summary);
    } finally {
      setIsCostAnalysisLoading(false);
    }
  }

  async function runActivityDesign() {
    if (isActivityDesignLoading) return;
    const scenario = ACTIVITY_DESIGN_RESULT_SCENARIO;
    const task = beginAsyncCalculation('activityDesign', 'activity-design');
    setIsActivityDesignLoading(true);
    await waitForLoadingPaint();
    try {
      setSelectedActivityDesignRouteKey('');
      setSelectedActivityDesignBand(null);
      setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
      setActivityDesignDetailSearchText('');
      setActivityDesignByScenario(prev => ({ ...prev, [scenario]: null }));
      setSummary({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const result = await runCalculationTask('activityDesign', {
        state,
        platformFilter: 'all',
        settings: { ...activityDesignSettings, productNameKeyword: '', selectedRecommendationKey: undefined }
      }, progress => {
        if (shouldWriteAsyncCalculation('activityDesign', task.token, task.page)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        ...asyncCalculationOptions(task),
        maxDurationMs: ACTIVITY_DESIGN_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_DESIGN_WORKER_TIMEOUT_MS
      });
      applyOrQueueAsyncCalculationResult({ slot: 'activityDesign', token: task.token, page: 'activity-design', scenario, result });
    } catch (error) {
      reportAsyncCalculationError('activityDesign', task.token, task.page, error, '活动设计生成失败。');
    } finally {
      if (isAsyncCalculationCurrent('activityDesign', task.token)) setIsActivityDesignLoading(false);
      finishAsyncCalculation('activityDesign', task.token);
    }
  }

  async function runActivityDesignRouteValidation(recommendationKey: string) {
    if (isActivityDesignLoading || !recommendationKey) return;
    const scenario = ACTIVITY_DESIGN_RESULT_SCENARIO;
    const task = beginAsyncCalculation('activityDesign', 'activity-design');
    const selectedRecommendationSnapshot = activityDesign?.recommendations.find(row => row.key === recommendationKey);
    setSelectedActivityDesignRouteKey(recommendationKey);
    setSelectedActivityDesignBand(null);
    setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
    setActivityDesignDetailSearchText('');
    setActivityDesignByScenario(prev => ({
      ...prev,
      [scenario]: prev[scenario]
        ? { ...prev[scenario], payBands: [], hitRows: [], comboRows: [] }
        : prev[scenario]
    }));
    setIsActivityDesignLoading(true);
    await waitForLoadingPaint();
    try {
      setSummary({ resultCount: activityDesign?.summary.resultCount || 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const result = await runCalculationTask('activityDesign', {
        state,
        platformFilter: selectedRecommendationSnapshot?.platform || 'all',
        settings: {
          ...activityDesignSettings,
          productNameKeyword: '',
          selectedRecommendationKey: recommendationKey,
          selectedRecommendationSnapshot
        }
      }, progress => {
        if (shouldWriteAsyncCalculation('activityDesign', task.token, task.page)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        ...asyncCalculationOptions(task),
        maxDurationMs: ACTIVITY_ROUTE_VALIDATION_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_ROUTE_VALIDATION_WORKER_TIMEOUT_MS
      });
      const mergedResult = mergeActivityRouteValidationResult(activityDesign, result);
      applyOrQueueAsyncCalculationResult({ slot: 'activityDesign', token: task.token, page: 'activity-design', scenario, result: mergedResult });
    } catch (error) {
      reportAsyncCalculationError('activityDesign', task.token, task.page, error, '活动路线校验失败。');
    } finally {
      if (isAsyncCalculationCurrent('activityDesign', task.token)) setIsActivityDesignLoading(false);
      finishAsyncCalculation('activityDesign', task.token);
    }
  }

  async function runPricingEvaluation() {
    if (isPricingEvaluationLoading) return;
    const task = beginAsyncCalculation('pricingEvaluation', 'pricing');
    setIsPricingEvaluationLoading(true);
    await waitForLoadingPaint();
    try {
      setPricingEvaluation(null);
      setSelectedPricingProductKey('');
      setSummary({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const result = await runCalculationTask('pricingEvaluation', {
        state,
        platformFilter: pricingPlatformFilter,
        settings: pricingSettings
      }, undefined, asyncCalculationOptions(task));
      applyOrQueueAsyncCalculationResult({ slot: 'pricingEvaluation', token: task.token, page: 'pricing', result });
    } catch (error) {
      reportAsyncCalculationError('pricingEvaluation', task.token, task.page, error, '定价评估生成失败。');
    } finally {
      if (isAsyncCalculationCurrent('pricingEvaluation', task.token)) setIsPricingEvaluationLoading(false);
      finishAsyncCalculation('pricingEvaluation', task.token);
    }
  }

  function applyPricingSuggestedPrice(row: { suggestedPrice: number | null; productId: string; platform: Platform; platformName: string }) {
    if (row.suggestedPrice === null) {
      message.warning('当前商品没有可应用的建议价。');
      return;
    }
    const suggestedPrice = row.suggestedPrice;
    mutateStore(draftStore => {
      const product = draftStore.products.find(item => item.id === row.productId);
      if (!product) return;
      product[platformPriceField(row.platform)] = suggestedPrice === product.price ? '' : suggestedPrice;
    });
    setPricingEvaluation(null);
    message.success(`已应用到${row.platformName}价，请重新生成定价评估查看结果。`);
  }

  function startCostModalDrag(event: React.MouseEvent<HTMLDivElement>) {
    if (isCostModalFullscreen || event.button !== 0) return;
    if ((event.target as HTMLElement).closest('button')) return;
    setCostModalDragStart({
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: costModalOffset.x,
      startY: costModalOffset.y
    });
  }

  function toggleCostModalFullscreen(event: React.MouseEvent<HTMLElement>) {
    event.stopPropagation();
    const next = !isCostModalFullscreen;
    setIsCostModalFullscreen(next);
    setCostModalDragStart(null);
    if (next) setCostModalOffset({ x: 0, y: 0 });
  }

  function closeCostModal() {
    setSelectedCostProductKey('');
    setIsCostModalFullscreen(false);
    setCostModalOffset({ x: 0, y: 0 });
    setCostModalDragStart(null);
  }

  function renderCostModalTitle(selectedIssue: CostProductIssue | undefined) {
    return (
      <div className="draggable-modal-title" onMouseDown={startCostModalDrag}>
        <span>{selectedIssue ? `${selectedIssue.platformName} / ${selectedIssue.productName} 组合分析` : '商品组合分析'}</span>
        <Button
          type="text"
          size="small"
          aria-label={isCostModalFullscreen ? '还原弹框' : '全屏弹框'}
          icon={isCostModalFullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          onMouseDown={event => event.stopPropagation()}
          onClick={toggleCostModalFullscreen}
        />
      </div>
    );
  }

  async function applyCostAnalysisPrice() {
    if (!selectedCostIssue) return;
    const newPrice = roundMoney(costAdjustmentPrice);
    if (!Number.isFinite(newPrice) || newPrice <= 0) {
      message.warning('请输入有效的平台售价。');
      return;
    }
    const nextState = deepClone(state);
    const draftStore = currentStoreFrom(nextState);
    const product = draftStore.products.find(item => item.id === selectedCostIssue.productId);
    if (!product) {
      message.error('没有找到对应商品，无法调价。');
      return;
    }
    const oldPrice = platformPrice(product, selectedCostIssue.platform);
    const field = platformPriceField(selectedCostIssue.platform);
    product[field] = newPrice;
    const increaseAmount = roundMoney(newPrice - oldPrice);
    const record: CostPriceAdjustmentRecord = {
      id: uid('adj'),
      createdAt: new Date().toISOString(),
      platform: selectedCostIssue.platform,
      platformName: selectedCostIssue.platformName,
      productId: product.id,
      productName: product.name,
      salesPrice: roundMoney(product.price),
      oldPrice,
      suggestedPrice: selectedCostIssue.suggestedPrice,
      newPrice,
      increaseAmount,
      increaseRate: oldPrice > 0 ? increaseAmount / oldPrice : null,
      targetProfitRate: selectedCostIssue.targetProfitRate,
      minProfitRate: selectedCostIssue.minProfitRate,
      avgProfitRate: selectedCostIssue.avgProfitRate,
      comboCount: selectedCostIssue.comboCount
    };
    draftStore.costPriceAdjustments = [record, ...(draftStore.costPriceAdjustments || [])].slice(0, 300);
    const normalized = normalizeState(nextState);
    setState(normalized);
    try {
      await browserDataRepository.saveCalculatorState(normalized);
      message.success('平台售价已更新，并已记录本次成本测算调价。重新生成成本测算可查看调价后利润。');
    } catch {
      message.warning('平台售价已更新到当前页面，但保存到浏览器数据库失败。');
    }
  }

  function exportResults() {
    const ok = downloadCsv(`${store.name}_${activeResultPlatformView.platformName}_组合测算.csv`, activeResultPlatformView.visibleRows.map(row => ({
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
  }

  function exportRisks() {
    const ok = downloadCsv(`${store.name}_${activeResultPlatformView.platformName}_风险预警.csv`, activeResultPlatformView.riskRows.map(row => ({
      严重等级: riskLabel(row.risk),
      平台: row.platformName,
      商品组合: itemsText(row.items),
      主食份数: comboStapleServingCount(row.items),
      用户实付: money(row.finalPay),
      商家到手价: money(row.netPay),
      成本: money(row.cost),
      活动金额: money(row.activityAmount),
      通用佣金: money(row.commission),
      外卖服务费: money(row.serviceFee),
      利润: money(row.profit),
      实付利润率: rateText(row.profitRate),
      到手利润率: rateText(row.netProfitRate),
      触发原因: row.risk?.reasons.join('|') || ''
    })));
    if (!ok) message.warning('没有可导出的风险预警。');
  }

  function exportCostAnalysis() {
    const ok = downloadCsv(`${store.name}_成本测算诊断.csv`, (costAnalysis?.issues || []).map(row => ({
      平台: row.platformName,
      商品: row.productName,
      当前价格: money(row.currentPrice),
      成本价: money(row.costPrice),
      整单最低净实付: row.orderFinalPayMin === null ? '' : money(row.orderFinalPayMin),
      整单最高净实付: row.orderFinalPayMax === null ? '' : money(row.orderFinalPayMax),
      整单平均净实付: row.orderFinalPayAvg === null ? '' : money(row.orderFinalPayAvg),
      商品最低净分摊实付: row.finalPayMin === null ? '' : money(row.finalPayMin),
      商品最高净分摊实付: row.finalPayMax === null ? '' : money(row.finalPayMax),
      商品平均净分摊实付: row.avgFinalPay === null ? '' : money(row.avgFinalPay),
      平均到手利润率: rateText(row.avgProfitRate),
      平均实付利润率: rateText(row.avgPayProfitRate),
      到手目标利润率: rateText(row.targetProfitRate),
      实付目标利润率: rateText(row.targetPayProfitRate),
      最低到手利润率: rateText(row.minProfitRate),
      最低实付利润率: rateText(row.minPayProfitRate),
      最高利润率: rateText(row.maxProfitRate),
      剩余优惠空间: row.minAffordableSpace === null ? '' : money(row.minAffordableSpace),
      建议售价: row.suggestedPrice === null ? '' : money(row.suggestedPrice),
      建议加价: money(row.suggestedIncrease),
      建议加价比例: rateText(row.suggestedIncreaseRate),
      命中组合数: row.comboCount,
      低于目标组合数: row.lowCount,
      异常等级: severityLabel(row.severity),
      诊断原因: row.reasons.join('|')
    })));
    if (!ok) message.warning('没有可导出的成本测算结果。');
  }

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

  function renderStapleScenarioTabs(value: StapleScenario, onChange: (value: StapleScenario) => void) {
    return (
      <Tabs
        size="small"
        activeKey={value}
        onChange={key => onChange(key as StapleScenario)}
        items={STAPLE_SCENARIOS.map(scenario => ({
          key: scenario,
          label: stapleScenarioName(scenario),
          children: <Text type="secondary">当前按主食份数 {stapleScenarioRangeText(scenario)} 测算，不修改门店维护中的默认范围。</Text>
        }))}
      />
    );
  }

  const rawProductSource = isProductsEditing && productsDraft ? productsDraft : store.products;
  const productSource = useMemo(() => normalizeProductList(rawProductSource), [rawProductSource]);
  const displayedProducts = useMemo(() => {
    try {
      const keyword = String(productSearchText || '').trim().toLowerCase();
      const filtered = productSource.filter(product => {
        if (keyword) {
          const text = [
            product.name,
            product.price,
            product.cost,
            product.packageFee,
            product.meituanPrice,
            product.elemePrice,
            product.meituanPackageFee,
            product.elemePackageFee,
            productCategoryName(product.category),
            product.stapleServingCount
          ].map(productTextValue).join(' ').toLowerCase();
          if (!text.includes(keyword)) return false;
        }
        if (productCategoryFilter !== 'all' && product.category !== productCategoryFilter) return false;
        if (productStatusFilter === 'meituanEnabled') return product.meituanEnabled;
        if (productStatusFilter === 'meituanDisabled') return !product.meituanEnabled;
        if (productStatusFilter === 'elemeEnabled') return product.elemeEnabled;
        if (productStatusFilter === 'elemeDisabled') return !product.elemeEnabled;
        if (productStatusFilter === 'nonStandalone') return product.nonStandalone;
        if (productStatusFilter === 'missingCost') return roundMoney(product.cost) <= 0;
        return true;
      });
      const sorted = filtered.slice().sort((a, b) => {
        let result = 0;
        if (productSortField === 'name') result = compareProductText(a.name, b.name);
        else if (productSortField === 'category') result = compareProductText(productCategoryName(a.category), productCategoryName(b.category));
        else if (productSortField === 'stapleServingCount') result = compareProductNumber(a.stapleServingCount, b.stapleServingCount);
        else if (productSortField === 'price') result = compareProductNumber(a.price, b.price);
        else if (productSortField === 'cost') result = compareProductNumber(a.cost, b.cost);
        else if (productSortField === 'packageFee') result = compareProductNumber(a.packageFee, b.packageFee);
        else if (productSortField === 'meituanPrice') result = compareProductNumber(platformPrice(a, 'meituan'), platformPrice(b, 'meituan'));
        else if (productSortField === 'elemePrice') result = compareProductNumber(platformPrice(a, 'eleme'), platformPrice(b, 'eleme'));
        else if (productSortField === 'meituanPackageFee') result = compareProductNumber(platformPackageFee(a, 'meituan'), platformPackageFee(b, 'meituan'));
        else result = compareProductNumber(platformPackageFee(a, 'eleme'), platformPackageFee(b, 'eleme'));
        return productSortAsc ? result : -result;
      });
      return sorted;
    } catch {
      return productSource;
    }
  }, [productSource, productSearchText, productCategoryFilter, productStatusFilter, productSortField, productSortAsc]);

  React.useEffect(() => {
    if (!isProductsEditing) return;
    const availableIds = new Set(productSource.map(product => product.id));
    setSelectedProductRowKeys(prev => {
      const next = prev.filter(key => availableIds.has(String(key)));
      return next.length === prev.length ? prev : next;
    });
  }, [isProductsEditing, productSource]);
  const selectedProductCount = selectedProductRowKeys.length;
  const productRowSelection = isProductsEditing ? {
    selectedRowKeys: selectedProductRowKeys,
    onChange: (keys: React.Key[]) => setSelectedProductRowKeys(keys)
  } : undefined;
  const productColumns: TableColumnsType<Product> = [
    {
      title: '商品名',
      dataIndex: 'name',
      width: 260,
      sorter: (a, b) => compareProductText(a.name, b.name),
      render: (_, row) => isProductsEditing
        ? <Input value={row.name} onChange={e => updateProductDraft(row.id, { name: e.target.value })} />
        : <Text>{row.name || '-'}</Text>
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 125,
      sorter: (a, b) => compareProductText(productCategoryName(a.category), productCategoryName(b.category)),
      render: (_, row) => isProductsEditing
        ? (
          <Select
            value={row.category}
            style={{ width: 110 }}
            onChange={(value: ProductCategory) => updateProductDraft(row.id, { category: value, stapleServingCount: inferStapleServingCount(row.name, value) })}
            options={PRODUCT_CATEGORIES.map(category => ({ value: category, label: productCategoryName(category) }))}
          />
        )
        : <Tag>{productCategoryName(row.category)}</Tag>
    },
    {
      title: '主食份数',
      dataIndex: 'stapleServingCount',
      width: 110,
      align: 'center',
      sorter: (a, b) => compareProductNumber(a.stapleServingCount, b.stapleServingCount),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={0} value={row.stapleServingCount} onChange={value => updateProductDraft(row.id, { stapleServingCount: Number(value) || 0 })} />
        : <Tag color={row.stapleServingCount > 0 ? 'blue' : 'default'}>{row.stapleServingCount}</Tag>
    },
    {
      title: '销售价',
      dataIndex: 'price',
      width: 120,
      sorter: (a, b) => compareProductNumber(a.price, b.price),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} value={row.price} onChange={value => updateProductDraft(row.id, { price: Number(value) || 0 })} />
        : `¥${money(row.price)}`
    },
    {
      title: '成本价',
      dataIndex: 'cost',
      width: 120,
      sorter: (a, b) => compareProductNumber(a.cost, b.cost),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} value={row.cost} onChange={value => updateProductDraft(row.id, { cost: Number(value) || 0 })} />
        : `¥${money(row.cost)}`
    },
    {
      title: '统一打包费',
      dataIndex: 'packageFee',
      width: 130,
      sorter: (a, b) => compareProductNumber(a.packageFee, b.packageFee),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} value={row.packageFee} onChange={value => updateProductDraft(row.id, { packageFee: Number(value) || 0 })} />
        : `¥${money(row.packageFee)}`
    },
    {
      title: '美团价',
      dataIndex: 'meituanPrice',
      width: 120,
      sorter: (a, b) => compareProductNumber(platformPrice(a, 'meituan'), platformPrice(b, 'meituan')),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} placeholder="空=销售价" value={row.meituanPrice === '' ? null : row.meituanPrice} onChange={value => updateProductDraft(row.id, { meituanPrice: value === null ? '' : Number(value) })} />
        : (row.meituanPrice === '' ? '同销售价' : `¥${money(row.meituanPrice)}`)
    },
    {
      title: '美团打包费',
      dataIndex: 'meituanPackageFee',
      width: 130,
      sorter: (a, b) => compareProductNumber(platformPackageFee(a, 'meituan'), platformPackageFee(b, 'meituan')),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} placeholder="空=统一" value={row.meituanPackageFee === '' ? null : row.meituanPackageFee} onChange={value => updateProductDraft(row.id, { meituanPackageFee: value === null ? '' : Number(value) })} />
        : (row.meituanPackageFee === '' ? '同统一' : `¥${money(row.meituanPackageFee)}`)
    },
    {
      title: '饿了么价',
      dataIndex: 'elemePrice',
      width: 120,
      sorter: (a, b) => compareProductNumber(platformPrice(a, 'eleme'), platformPrice(b, 'eleme')),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} placeholder="空=销售价" value={row.elemePrice === '' ? null : row.elemePrice} onChange={value => updateProductDraft(row.id, { elemePrice: value === null ? '' : Number(value) })} />
        : (row.elemePrice === '' ? '同销售价' : `¥${money(row.elemePrice)}`)
    },
    {
      title: '饿了么打包费',
      dataIndex: 'elemePackageFee',
      width: 140,
      sorter: (a, b) => compareProductNumber(platformPackageFee(a, 'eleme'), platformPackageFee(b, 'eleme')),
      render: (_, row) => isProductsEditing
        ? <InputNumber min={0} precision={2} placeholder="空=统一" value={row.elemePackageFee === '' ? null : row.elemePackageFee} onChange={value => updateProductDraft(row.id, { elemePackageFee: value === null ? '' : Number(value) })} />
        : (row.elemePackageFee === '' ? '同统一' : `¥${money(row.elemePackageFee)}`)
    },
    {
      title: '美团上架',
      dataIndex: 'meituanEnabled',
      width: 100,
      align: 'center',
      sorter: (a, b) => Number(a.meituanEnabled) - Number(b.meituanEnabled),
      render: (_, row) => isProductsEditing
        ? <Switch checked={row.meituanEnabled} onChange={checked => updateProductDraft(row.id, { meituanEnabled: checked })} />
        : <Tag color={row.meituanEnabled ? 'green' : 'default'}>{row.meituanEnabled ? '上架' : '下架'}</Tag>
    },
    {
      title: '饿了么上架',
      dataIndex: 'elemeEnabled',
      width: 110,
      align: 'center',
      sorter: (a, b) => Number(a.elemeEnabled) - Number(b.elemeEnabled),
      render: (_, row) => isProductsEditing
        ? <Switch checked={row.elemeEnabled} onChange={checked => updateProductDraft(row.id, { elemeEnabled: checked })} />
        : <Tag color={row.elemeEnabled ? 'green' : 'default'}>{row.elemeEnabled ? '上架' : '下架'}</Tag>
    },
    {
      title: '单点不送',
      dataIndex: 'nonStandalone',
      width: 100,
      align: 'center',
      sorter: (a, b) => Number(a.nonStandalone) - Number(b.nonStandalone),
      render: (_, row) => isProductsEditing
        ? <Switch checked={row.nonStandalone} onChange={checked => updateProductDraft(row.id, { nonStandalone: checked })} />
        : <Tag color={row.nonStandalone ? 'orange' : 'green'}>{row.nonStandalone ? '是' : '否'}</Tag>
    },
    ...(isProductsEditing ? [{
      title: '',
      width: 70,
      render: (_: unknown, row: Product) => <Button danger icon={<DeleteOutlined />} onClick={() => deleteProductDraft(row.id)} />
    }] : [])
  ];

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
  const activityRiskColumns = withoutColumnByDataIndex(riskColumns as TableColumnsType<ActivityComboSimulationRow>, 'platformName');

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

  const costIssueColumns: TableColumnsType<CostProductIssue> = [
    { title: '等级', dataIndex: 'severity', width: 80, render: value => <Tag color={severityColor(value as Severity)}>{severityLabel(value as Severity)}</Tag>, sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity), defaultSortOrder: 'descend' },
    { title: '平台', dataIndex: 'platformName', width: 80, sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: (_, row) => <Button className="table-link-wrap" type="link" title={row.productName} onClick={() => setSelectedCostProductKey(row.key)}>{row.productName}</Button>, sorter: (a, b) => a.productName.localeCompare(b.productName, 'zh-CN') },
    { title: '平均利润率', dataIndex: 'avgProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitRate || 0) - (b.avgProfitRate || 0) },
    { title: '最低利润率', dataIndex: 'minProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.minProfitRate || 0) - (b.minProfitRate || 0) },
    { title: '剩余空间', dataIndex: 'minAffordableSpace', width: 100, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.minAffordableSpace || 0) - (b.minAffordableSpace || 0) },
    { title: '建议售价', dataIndex: 'suggestedPrice', width: 100, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.suggestedPrice || a.currentPrice) - (b.suggestedPrice || b.currentPrice) },
    { title: '建议加价', dataIndex: 'suggestedIncrease', width: 130, responsive: SHOW_MD, render: (_, row) => row.suggestedIncrease > 0 ? <Text type="danger">+¥{money(row.suggestedIncrease)} / {rateText(row.suggestedIncreaseRate)}</Text> : '-', sorter: (a, b) => a.suggestedIncrease - b.suggestedIncrease },
    { title: '组合数', dataIndex: 'comboCount', width: 90, sorter: (a, b) => a.comboCount - b.comboCount },
    ...(costCompactColumns ? [] : [
      { title: '当前价', dataIndex: 'currentPrice', width: 95, responsive: SHOW_LG, render: (value: number) => `¥${money(value)}`, sorter: (a: CostProductIssue, b: CostProductIssue) => a.currentPrice - b.currentPrice },
      { title: '成本价', dataIndex: 'costPrice', width: 95, responsive: SHOW_LG, render: (value: number) => `¥${money(value)}`, sorter: (a: CostProductIssue, b: CostProductIssue) => a.costPrice - b.costPrice },
      { title: '商品净分摊实付', width: 150, responsive: SHOW_LG, render: (_: unknown, row: CostProductIssue) => row.finalPayMin === null ? '-' : `¥${money(row.finalPayMin)}-${money(row.finalPayMax)}` },
      { title: '整单净实付范围', width: 150, responsive: SHOW_XL, render: (_: unknown, row: CostProductIssue) => row.orderFinalPayMin === null ? '-' : `¥${money(row.orderFinalPayMin)}-${money(row.orderFinalPayMax)}` },
      { title: '到手目标', dataIndex: 'targetProfitRate', width: 100, responsive: SHOW_XL, render: (value: number | null) => rateText(value), sorter: (a: CostProductIssue, b: CostProductIssue) => a.targetProfitRate - b.targetProfitRate },
      { title: '实付目标', dataIndex: 'targetPayProfitRate', width: 100, responsive: SHOW_XL, render: (value: number | null) => rateText(value), sorter: (a: CostProductIssue, b: CostProductIssue) => a.targetPayProfitRate - b.targetPayProfitRate },
      { title: '最低实付利润率', dataIndex: 'minPayProfitRate', width: 125, responsive: SHOW_XL, render: (value: number | null) => rateText(value), sorter: (a: CostProductIssue, b: CostProductIssue) => (a.minPayProfitRate || 0) - (b.minPayProfitRate || 0) },
      { title: '最高利润率', dataIndex: 'maxProfitRate', width: 110, responsive: SHOW_XL, render: (value: number | null) => rateText(value), sorter: (a: CostProductIssue, b: CostProductIssue) => (a.maxProfitRate || 0) - (b.maxProfitRate || 0) },
      { title: '低于目标', dataIndex: 'lowCount', width: 95, responsive: SHOW_XL, sorter: (a: CostProductIssue, b: CostProductIssue) => a.lowCount - b.lowCount },
      { title: '诊断', dataIndex: 'reasons', width: 260, responsive: SHOW_XXL, render: (reasons: string[]) => reasons.join('，') }
    ])
  ];

  const pricingIssueColumns: TableColumnsType<PricingProductIssue> = [
    { title: '等级', dataIndex: 'severity', width: 80, fixed: 'left', render: value => <Tag color={severityColor(value as Severity)}>{severityLabel(value as Severity)}</Tag>, sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity), defaultSortOrder: 'descend' },
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left', sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: (_, row) => <Button className="table-link-wrap" type="link" title={row.productName} onClick={() => setSelectedPricingProductKey(row.key)}>{row.productName}</Button>, sorter: (a, b) => a.productName.localeCompare(b.productName, 'zh-CN') },
    { title: '类型', dataIndex: 'productTypeName', width: 80, render: value => <Tag>{String(value || '-')}</Tag>, sorter: (a, b) => a.productTypeName.localeCompare(b.productTypeName, 'zh-CN') },
    { title: '当前平台价', dataIndex: 'currentPrice', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentPrice - b.currentPrice },
    { title: '打包费', dataIndex: 'packageFee', width: 90, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.packageFee - b.packageFee },
    { title: '当前含打包费', dataIndex: 'currentOriginalPrice', width: 125, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentOriginalPrice - b.currentOriginalPrice },
    { title: '成本价', dataIndex: 'costPrice', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.costPrice - b.costPrice },
    { title: '到手目标', dataIndex: 'targetProfitRate', width: 100, responsive: SHOW_LG, render: value => rateText(value as number | null), sorter: (a, b) => a.targetProfitRate - b.targetProfitRate },
    { title: '实付目标', dataIndex: 'targetPayProfitRate', width: 100, responsive: SHOW_LG, render: value => rateText(value as number | null), sorter: (a, b) => a.targetPayProfitRate - b.targetPayProfitRate },
    { title: '最低利润率', dataIndex: 'minProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.minProfitRate || 0) - (b.minProfitRate || 0) },
    { title: '平均利润率', dataIndex: 'avgProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitRate || 0) - (b.avgProfitRate || 0) },
    { title: '平均目标', dataIndex: 'avgRequiredRate', width: 100, responsive: SHOW_LG, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgRequiredRate || 0) - (b.avgRequiredRate || 0) },
    { title: '亏损组合', dataIndex: 'lossCount', width: 95, sorter: (a, b) => a.lossCount - b.lossCount },
    { title: '低于目标', dataIndex: 'lowCount', width: 95, sorter: (a, b) => a.lowCount - b.lowCount },
    { title: '组合数', dataIndex: 'comboCount', width: 90, sorter: (a, b) => a.comboCount - b.comboCount },
    { title: '剩余空间', dataIndex: 'minAffordableSpace', width: 100, responsive: SHOW_LG, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.minAffordableSpace || 0) - (b.minAffordableSpace || 0) },
    { title: '建议平台价', dataIndex: 'suggestedPrice', width: 110, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.suggestedPrice || a.currentPrice) - (b.suggestedPrice || b.currentPrice) },
    { title: '建议含打包费', dataIndex: 'suggestedOriginalPrice', width: 125, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.suggestedOriginalPrice || a.currentOriginalPrice) - (b.suggestedOriginalPrice || b.currentOriginalPrice) },
    { title: '建议调价', dataIndex: 'suggestedIncrease', width: 125, render: (_, row) => row.suggestedIncrease === 0 ? '-' : <Text type={row.suggestedIncrease > 0 ? 'danger' : 'success'}>{row.suggestedIncrease > 0 ? '+' : ''}¥{money(row.suggestedIncrease)} / {rateText(row.suggestedIncreaseRate)}</Text>, sorter: (a, b) => a.suggestedIncrease - b.suggestedIncrease },
    { title: '诊断', dataIndex: 'reasons', width: 240, responsive: SHOW_XL, render: (reasons: string[]) => reasons.join('，') },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedPricingProductKey(row.key)}>查看组合</Button>
          <Button size="small" disabled={row.suggestedPrice === null || row.suggestedIncrease === 0} onClick={() => applyPricingSuggestedPrice(row)}>应用建议价</Button>
        </Space>
      )
    }
  ];

  const pricingDetailColumns: TableColumnsType<PricingComboDetail> = [
    { title: '状态', dataIndex: 'belowTarget', width: 95, fixed: 'left', render: (_, row) => row.belowMinimum ? <Tag color="red">低于下限</Tag> : row.belowTarget ? <Tag color="orange">低于目标</Tag> : <Tag color="green">正常</Tag>, sorter: (a, b) => Number(a.belowMinimum) - Number(b.belowMinimum) || Number(a.belowTarget) - Number(b.belowTarget) },
    { title: '场景说明', dataIndex: 'comboLabel', width: 360, fixed: 'left', render: value => <Text className="table-text-wrap" title={String(value || '')}>{String(value || '')}</Text> },
    { title: '策略场景', dataIndex: 'strategyScenarioName', width: 95 },
    { title: '策略档位', dataIndex: 'strategyTierName', width: 150 },
    { title: '原价小计', dataIndex: 'originalTotal', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.originalTotal - b.originalTotal },
    { title: '基础红包', dataIndex: 'baseRedAmount', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseRedAmount - b.baseRedAmount },
    { title: '加码空间', dataIndex: 'redAddOnSpace', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.redAddOnSpace - b.redAddOnSpace },
    { title: '用户实付', dataIndex: 'orderFinalPay', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderFinalPay - b.orderFinalPay },
    { title: '平台佣金', dataIndex: 'orderCommission', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderCommission - b.orderCommission },
    { title: '服务费', dataIndex: 'orderServiceFee', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderServiceFee - b.orderServiceFee },
    { title: '配送补贴', dataIndex: 'orderFreightSubsidy', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderFreightSubsidy - b.orderFreightSubsidy },
    { title: '整单到手价', dataIndex: 'orderNetPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderNetPay - b.orderNetPay },
    { title: '到手下限', dataIndex: 'requiredNetRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.requiredNetRate - b.requiredNetRate },
    { title: '到手目标', dataIndex: 'targetNetRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.targetNetRate - b.targetNetRate },
    { title: '实付下限', dataIndex: 'requiredPayRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.requiredPayRate - b.requiredPayRate },
    { title: '实付目标', dataIndex: 'targetPayRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.targetPayRate - b.targetPayRate },
    { title: '商品用户实付', dataIndex: 'productFinalPay', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.productFinalPay - b.productFinalPay },
    { title: '商品费用分摊', dataIndex: 'productFee', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.productFee - b.productFee },
    { title: '商品到手价', dataIndex: 'productNetPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.productNetPay - b.productNetPay },
    { title: '商品成本', dataIndex: 'productCost', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.productCost - b.productCost },
    { title: '商品利润', dataIndex: 'productProfit', width: 95, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.productProfit - b.productProfit },
    { title: '到手利润率', dataIndex: 'productProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.productProfitRate || 0) - (b.productProfitRate || 0) },
    { title: '实付利润率', dataIndex: 'productPayProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.productPayProfitRate || 0) - (b.productPayProfitRate || 0) },
    { title: '剩余空间', dataIndex: 'affordableSpace', width: 95, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.affordableSpace || 0) - (b.affordableSpace || 0) }
  ];

  const costDetailColumns: TableColumnsType<ProductCostComboDetail> = [
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left' },
    { title: '状态', dataIndex: 'belowTarget', width: 95, fixed: 'left', render: (_, row) => row.belowMinimum ? <Tag color="red">低于下限</Tag> : row.belowTarget ? <Tag color="orange">低于目标</Tag> : <Tag color="green">正常</Tag>, sorter: (a, b) => Number(a.belowMinimum) - Number(b.belowMinimum) || Number(a.belowTarget) - Number(b.belowTarget) },
    { title: '商品组合', dataIndex: 'items', width: 280, fixed: 'left', render: items => <Space wrap>{(items as ComboItem[]).map(item => <Tag key={`${item.productId}-${item.qty}`}>{item.name} x {item.qty}</Tag>)}</Space> },
    { title: '策略场景', dataIndex: 'strategyScenarioName', width: 95 },
    { title: '策略档位', dataIndex: 'strategyTierName', width: 150 },
    { title: '原价小计(含打包费)', dataIndex: 'originalTotal', width: 140, render: value => `¥${money(value)}`, sorter: (a, b) => a.originalTotal - b.originalTotal },
    { title: '满减/券空间', dataIndex: 'couponSpace', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.couponSpace - b.couponSpace },
    { title: '基础红包', dataIndex: 'baseRedAmount', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseRedAmount - b.baseRedAmount },
    { title: '加码空间', dataIndex: 'redAddOnSpace', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.redAddOnSpace - b.redAddOnSpace },
    { title: '优惠总额', dataIndex: 'totalDiscount', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.totalDiscount - b.totalDiscount },
    { title: '用户实付', dataIndex: 'orderFinalPay', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderFinalPay - b.orderFinalPay },
    { title: '平台佣金', dataIndex: 'orderCommission', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderCommission - b.orderCommission },
    { title: '外卖服务费', dataIndex: 'orderServiceFee', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderServiceFee - b.orderServiceFee },
    { title: '配送补贴', dataIndex: 'orderFreightSubsidy', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderFreightSubsidy - b.orderFreightSubsidy },
    { title: '整单到手价', dataIndex: 'orderNetPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderNetPay - b.orderNetPay },
    { title: '整单成本', dataIndex: 'orderCost', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.orderCost - b.orderCost },
    { title: '整单利润', dataIndex: 'orderProfit', width: 95, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.orderProfit - b.orderProfit },
    { title: '整单到手利润率', dataIndex: 'orderProfitRate', width: 125, render: value => rateText(value as number | null), sorter: (a, b) => (a.orderProfitRate || 0) - (b.orderProfitRate || 0) },
    { title: '到手下限', dataIndex: 'requiredNetRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.requiredNetRate - b.requiredNetRate },
    { title: '到手目标', dataIndex: 'targetNetRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.targetNetRate - b.targetNetRate },
    { title: '实付下限', dataIndex: 'requiredPayRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.requiredPayRate - b.requiredPayRate },
    { title: '实付目标', dataIndex: 'targetPayRate', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => a.targetPayRate - b.targetPayRate },
    { title: '商品用户实付', dataIndex: 'productFinalPay', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.productFinalPay - b.productFinalPay },
    { title: '商品费用分摊', dataIndex: 'productFee', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.productFee - b.productFee },
    { title: '商品到手价', dataIndex: 'productNetPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.productNetPay - b.productNetPay },
    { title: '商品成本', dataIndex: 'productCost', width: 95, render: value => `¥${money(value)}`, sorter: (a, b) => a.productCost - b.productCost },
    { title: '商品利润', dataIndex: 'productProfit', width: 95, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.productProfit - b.productProfit },
    { title: '到手利润率', dataIndex: 'productProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.productProfitRate || 0) - (b.productProfitRate || 0) },
    { title: '实付利润率', dataIndex: 'productPayProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.productPayProfitRate || 0) - (b.productPayProfitRate || 0) },
    { title: '剩余空间', dataIndex: 'affordableSpace', width: 95, render: value => value === null ? '-' : <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => (a.affordableSpace || 0) - (b.affordableSpace || 0) }
  ];

  const tierAnalysisColumns: TableColumnsType<TierAnalysisRow> = [
    { title: '平台', dataIndex: 'platformName', width: 80, sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    { title: '阶梯', dataIndex: 'tierName', width: 220 },
    { title: '命中组合', dataIndex: 'hitCount', width: 100, sorter: (a, b) => a.hitCount - b.hitCount },
    { title: '平均净实付', dataIndex: 'avgFinalPay', width: 110, responsive: SHOW_MD, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgFinalPay - b.avgFinalPay },
    { title: '平均利润率', dataIndex: 'avgProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitRate || 0) - (b.avgProfitRate || 0) },
    { title: '最低利润率', dataIndex: 'minProfitRate', width: 110, responsive: SHOW_LG, render: value => rateText(value as number | null), sorter: (a, b) => (a.minProfitRate || 0) - (b.minProfitRate || 0) },
    { title: '最高利润率', dataIndex: 'maxProfitRate', width: 110, responsive: SHOW_XL, render: value => rateText(value as number | null), sorter: (a, b) => (a.maxProfitRate || 0) - (b.maxProfitRate || 0) },
    { title: '低于目标', dataIndex: 'lowCount', width: 95, responsive: SHOW_LG, sorter: (a, b) => a.lowCount - b.lowCount }
  ];

  const couponDesignColumns: TableColumnsType<CouponDesignRow> = [
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left', sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    {
      title: '建议满减',
      width: 125,
      fixed: 'left',
      render: (_, row) => row.fullAmount > 0 ? `满${money(row.threshold)}减${money(row.fullAmount)}` : '-',
      sorter: (a, b) => a.fullAmount - b.fullAmount
    },
    { title: '建议订单券', width: 125, fixed: 'left', render: (_, row) => row.couponAmount > 0 ? `满${money(row.threshold)}减${money(row.couponAmount)}` : '-', sorter: (a, b) => a.couponAmount - b.couponAmount },
    { title: '活动类型', dataIndex: 'modeName', width: 100 },
    { title: '门槛口径', dataIndex: 'basisName', width: 110 },
    { title: '总优惠', dataIndex: 'totalDiscount', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.totalDiscount - b.totalDiscount },
    { title: '命中组合', width: 120, render: (_, row) => `${row.hitCount}/${row.eligibleCount}`, sorter: (a, b) => a.hitCount - b.hitCount },
    { title: '覆盖率', dataIndex: 'coverageRate', width: 90, render: value => rateText(value as number | null), sorter: (a, b) => a.coverageRate - b.coverageRate },
    { title: '无券偏差', dataIndex: 'profitRateGap', width: 100, render: value => <Text type={Math.abs(Number(value) || 0) > 0.03 ? 'warning' : 'success'}>{rateText(value as number | null)}</Text>, sorter: (a, b) => Math.abs(a.profitRateGap || 0) - Math.abs(b.profitRateGap || 0) },
    { title: '无券平均', dataIndex: 'noCouponAvgProfitRate', width: 105, render: value => rateText(value as number | null), sorter: (a, b) => (a.noCouponAvgProfitRate || 0) - (b.noCouponAvgProfitRate || 0) },
    { title: '用券平均', dataIndex: 'couponAvgProfitRate', width: 105, render: value => rateText(value as number | null), sorter: (a, b) => (a.couponAvgProfitRate || 0) - (b.couponAvgProfitRate || 0) },
    { title: '用券目标', dataIndex: 'couponTargetProfitRate', width: 105, responsive: SHOW_LG, render: value => rateText(value as number | null) },
    { title: '利润率波动', dataIndex: 'profitRateSpread', width: 110, responsive: SHOW_XL, render: value => rateText(value as number | null), sorter: (a, b) => (a.profitRateSpread || 0) - (b.profitRateSpread || 0) },
    { title: '用券最低', dataIndex: 'couponMinProfitRate', width: 105, responsive: SHOW_XL, render: value => rateText(value as number | null), sorter: (a, b) => (a.couponMinProfitRate || 0) - (b.couponMinProfitRate || 0) },
    { title: '平均原价', dataIndex: 'avgOriginalTotal', width: 100, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgOriginalTotal - b.avgOriginalTotal },
    { title: '平均实付', dataIndex: 'avgFinalPay', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgFinalPay - b.avgFinalPay },
    { title: '平均到手', dataIndex: 'avgNetPay', width: 100, responsive: SHOW_XL, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgNetPay - b.avgNetPay },
    { title: '平均基础红包', dataIndex: 'avgBaseRedAmount', width: 120, responsive: SHOW_XL, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgBaseRedAmount - b.avgBaseRedAmount },
    { title: '平均加码', dataIndex: 'avgRedAddOnSpace', width: 100, responsive: SHOW_XL, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgRedAddOnSpace - b.avgRedAddOnSpace },
    { title: '代表组合', dataIndex: 'example', width: 260, render: example => <Text className="table-text-wrap">{itemsText((example as CouponDesignRow['example']).items)}</Text> }
  ];

  const pricingProductColumns: TableColumnsType<PricingProductRow> = [
    { title: '等级', dataIndex: 'severity', width: 80, fixed: 'left', render: value => <Tag color={severityColor(value as Severity)}>{severityLabel(value as Severity)}</Tag>, sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity), defaultSortOrder: 'descend' },
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left', sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: (_, row) => <Button className="table-link-wrap" type="link" title={row.productName} onClick={() => setSelectedPricingProductKey(row.key)}>{row.productName}</Button>, sorter: (a, b) => a.productName.localeCompare(b.productName, 'zh-CN') },
    { title: '分类', dataIndex: 'categoryName', width: 95, render: value => <Tag>{String(value || '-')}</Tag> },
    { title: '场景', dataIndex: 'scenarioName', width: 80, render: value => <Tag color="blue">{String(value || '-')}</Tag> },
    { title: '当前售价', dataIndex: 'currentPrice', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentPrice - b.currentPrice },
    { title: '打包费', dataIndex: 'packageFee', width: 90, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.packageFee - b.packageFee },
    { title: '销售价合计', dataIndex: 'currentOriginalPrice', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentOriginalPrice - b.currentOriginalPrice },
    { title: '商品成本', dataIndex: 'productCost', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.productCost - b.productCost },
    { title: '固定成本分摊', dataIndex: 'fixedCostAllocation', width: 125, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.fixedCostAllocation - b.fixedCostAllocation },
    { title: '基础成本', dataIndex: 'baseCost', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseCost - b.baseCost },
    { title: '目标利润率', dataIndex: 'targetProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => a.targetProfitRate - b.targetProfitRate },
    { title: '当前利润率', dataIndex: 'currentProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.currentProfitRate || 0) - (b.currentProfitRate || 0) },
    { title: '利润空间', dataIndex: 'profitSpace', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.profitSpace - b.profitSpace },
    { title: '目标销售价', dataIndex: 'suggestedOriginalPrice', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.suggestedOriginalPrice - b.suggestedOriginalPrice },
    { title: '建议平台价', dataIndex: 'suggestedPrice', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.suggestedPrice - b.suggestedPrice },
    { title: '建议调价', dataIndex: 'suggestedIncrease', width: 125, render: (_, row) => row.suggestedIncrease === 0 ? '-' : <Text type={row.suggestedIncrease > 0 ? 'danger' : 'success'}>{row.suggestedIncrease > 0 ? '+' : ''}¥{money(row.suggestedIncrease)} / {rateText(row.suggestedIncreaseRate)}</Text>, sorter: (a, b) => a.suggestedIncrease - b.suggestedIncrease },
    { title: '诊断', dataIndex: 'reasons', width: 260, responsive: SHOW_XL, render: (reasons: string[]) => reasons.join('，') },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedPricingProductKey(row.key)}>查看</Button>
          <Button size="small" disabled={Math.abs(row.suggestedIncrease) < 0.01} onClick={() => applyPricingSuggestedPrice(row)}>应用建议价</Button>
        </Space>
      )
    }
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

  const activityRecommendationRedAddOnSpace = (row: ActivityRecommendationRow) => {
    const totalSpace = nonNegativeAmount(row.addOnCostSpace);
    const routeSpace = nonNegativeAmount(row.routeAddOnCostSpace);
    return {
      configuredSpace: Math.max(0, roundMoney(totalSpace - routeSpace)),
      routeSpace,
      totalSpace
    };
  };

  const activityRecommendationColumns: TableColumnsType<ActivityRecommendationRow> = [
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left' },
    { title: '活动目标', dataIndex: 'objectiveName', width: 120, fixed: 'left', render: value => <Tag color="blue">{String(value || '-')}</Tag> },
    { title: '原价覆盖', dataIndex: 'originalBandLabel', width: 110, sorter: (a, b) => a.threshold - b.threshold },
    { title: '建议动作', dataIndex: 'actionType', width: 150 },
    {
      title: '满减阶梯',
      width: 260,
      render: (_, row) => row.fullReductionRules.length
        ? <Text className="table-text-wrap">{row.fullReductionRules.map(rule => `满${money(rule.threshold)}减${money(rule.amount)}`).join('，')}</Text>
        : '-'
    },
    {
      title: '优惠券列表',
      width: 260,
      render: (_, row) => row.couponRules.length
        ? <Text className="table-text-wrap">{row.couponRules.map(rule => `满${money(rule.threshold)}减${money(rule.amount)}`).join('，')}</Text>
        : '-'
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
    { title: '安全让利', dataIndex: 'safeDiscountSpace', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.safeDiscountSpace - b.safeDiscountSpace },
    { title: '命中组合', dataIndex: 'hitCount', width: 95, sorter: (a, b) => a.hitCount - b.hitCount },
    { title: '活动前均值', dataIndex: 'avgProfitBefore', width: 115, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitBefore || 0) - (b.avgProfitBefore || 0) },
    { title: '活动后均值', dataIndex: 'avgProfitAfter', width: 115, render: value => rateText(value as number | null), sorter: (a, b) => (a.avgProfitAfter || 0) - (b.avgProfitAfter || 0) },
    { title: '活动后最低', dataIndex: 'minProfitAfter', width: 115, render: value => rateText(value as number | null), sorter: (a, b) => (a.minProfitAfter || 0) - (b.minProfitAfter || 0) },
    { title: '离散度', dataIndex: 'profitRateSpreadAfter', width: 95, render: value => rateText(value as number | null), sorter: (a, b) => (a.profitRateSpreadAfter || 0) - (b.profitRateSpreadAfter || 0) },
    { title: '评分', dataIndex: 'score', width: 80, sorter: (a, b) => a.score - b.score },
    { title: '诊断', dataIndex: 'diagnosis', width: 240, render: value => <Text className="table-text-wrap">{String(value || '')}</Text> },
    { title: '代表组合', dataIndex: 'exampleItems', width: 260, render: items => <Text className="table-text-wrap">{itemsText(items as ComboItem[])}</Text> },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Button
          size="small"
          type={selectedActivityDesignRouteKey === row.key ? 'primary' : 'default'}
          loading={isActivityDesignLoading && selectedActivityDesignRouteKey === row.key}
          onClick={() => runActivityDesignRouteValidation(row.key)}
        >
          {selectedActivityDesignRouteKey === row.key ? '已选择' : '校验'}
        </Button>
      )
    }
  ];
  const activityPriceBandColumns = withoutColumnByDataIndex(priceBandColumns, 'platformName');
  const activityPlatformRecommendationColumns = withoutColumnByDataIndex(activityRecommendationColumns, 'platformName');
  const activityComboColumns = withoutColumnByDataIndex(resultColumns as TableColumnsType<ActivityComboSimulationRow>, 'platformName');

  const costAdjustmentColumns: TableColumnsType<CostPriceAdjustmentRecord> = [
    { title: '时间', dataIndex: 'createdAt', width: 170, responsive: SHOW_MD, render: value => dateTimeText(String(value)) },
    { title: '平台', dataIndex: 'platformName', width: 80 },
    { title: '商品', dataIndex: 'productName', width: 220, render: value => <Text className="table-text-wrap" title={String(value || '')}>{String(value || '')}</Text> },
    { title: '销售价', dataIndex: 'salesPrice', width: 90, responsive: SHOW_LG, render: value => `¥${money(value)}` },
    { title: '调前平台价', dataIndex: 'oldPrice', width: 110, responsive: SHOW_MD, render: value => `¥${money(value)}` },
    { title: '建议价', dataIndex: 'suggestedPrice', width: 90, responsive: SHOW_LG, render: value => value === null ? '-' : `¥${money(value)}` },
    { title: '调后平台价', dataIndex: 'newPrice', width: 110, render: value => `¥${money(value)}` },
    { title: '较调前', width: 130, render: (_, row) => <Text type={row.increaseAmount > 0 ? 'danger' : 'secondary'}>{row.increaseAmount >= 0 ? '+' : ''}¥{money(row.increaseAmount)} / {rateText(row.increaseRate)}</Text> },
    { title: '较销售价', width: 110, responsive: SHOW_LG, render: (_, row) => row.salesPrice > 0 ? rateText((row.newPrice - row.salesPrice) / row.salesPrice) : '-' },
    { title: '测算利润率', width: 160, responsive: SHOW_XL, render: (_, row) => <Text type="secondary">最低 {rateText(row.minProfitRate)} / 平均 {rateText(row.avgProfitRate)}</Text> },
    { title: '组合数', dataIndex: 'comboCount', width: 80, responsive: SHOW_XL }
  ];

  function renderStorePage() {
    const pageStore = isStoreEditing && storeDraft ? storeDraft : store;
    const feeRule = effectiveFeeRule(state, pageStore);
    const renderField = (label: string, value: React.ReactNode, control: React.ReactNode, span: { xs?: number; md?: number } = { xs: 12, md: 4 }) => (
      <Col xs={span.xs ?? 12} md={span.md ?? 4}>
        <div className="field">
          <Text type="secondary">{label}</Text>
          {isStoreEditing ? control : <div className="field-value">{value}</div>}
        </div>
      </Col>
    );
    return (
      <div className="section-stack">
        <Card
          title="门店维护"
          extra={
            <Space>
              {isStoreEditing ? (
                <>
                  <Button onClick={cancelStoreEdit}>取消</Button>
                  <Button type="primary" icon={<SaveOutlined />} onClick={saveStoreEdit}>保存门店</Button>
                </>
              ) : (
                <Button type="primary" onClick={startStoreEdit}>编辑门店</Button>
              )}
              <Button icon={<CopyOutlined />} onClick={duplicateStore}>复制门店</Button>
              <Button danger icon={<DeleteOutlined />} onClick={deleteStore}>删除门店</Button>
            </Space>
          }
        >
          <Row gutter={[12, 12]}>
            {renderField('门店名称', pageStore.name, <Input value={pageStore.name} onChange={e => updateStoreDraft(draft => { draft.name = e.target.value; })} />, { xs: 24, md: 8 })}
            {renderField('起送价', `¥${money(pageStore.startPrice)}`, <InputNumber min={0} precision={2} value={pageStore.startPrice} onChange={value => updateStoreDraft(draft => { draft.startPrice = Number(value) || 0; })} />)}
            {renderField('测算最低总价', `¥${money(pageStore.calculationTotalMin)}`, <InputNumber min={0} precision={2} value={pageStore.calculationTotalMin} onChange={value => updateStoreDraft(draft => { draft.calculationTotalMin = Number(value) || 0; })} />)}
            {renderField('测算最高总价', pageStore.calculationTotalMax === '' ? '不限' : `¥${money(pageStore.calculationTotalMax)}`, <InputNumber min={0} precision={2} placeholder="空=不限" value={pageStore.calculationTotalMax === '' ? null : pageStore.calculationTotalMax} onChange={value => updateStoreDraft(draft => { draft.calculationTotalMax = value === null ? '' : Number(value) || 0; })} />)}
            {renderField('主食份数最低', pageStore.stapleCountMin, <InputNumber min={0} precision={0} value={pageStore.stapleCountMin} onChange={value => updateStoreDraft(draft => { draft.stapleCountMin = Number(value) || 0; })} />)}
            {renderField('主食份数最高', pageStore.stapleCountMax === '' ? '不限' : pageStore.stapleCountMax, <InputNumber min={0} precision={0} placeholder="空=不限" value={pageStore.stapleCountMax === '' ? null : pageStore.stapleCountMax} onChange={value => updateStoreDraft(draft => { draft.stapleCountMax = value === null ? '' : Number(value) || 0; })} />)}
            {renderField('配送距离', `${pageStore.deliveryDistance} 公里`, <InputNumber min={0} precision={1} value={pageStore.deliveryDistance} onChange={value => updateStoreDraft(draft => { draft.deliveryDistance = Number(value) || 0; })} />)}
            {renderField('下单时段', pageStore.orderTime, <Input value={pageStore.orderTime} onChange={e => updateStoreDraft(draft => { draft.orderTime = e.target.value; })} />)}
            {renderField('最多商品件数', pageStore.maxItems, <InputNumber min={1} max={10} value={pageStore.maxItems} onChange={value => updateStoreDraft(draft => { draft.maxItems = Number(value) || 1; })} />)}
            {renderField('单SKU最多数量', pageStore.maxQtyPerSku, <InputNumber min={1} max={10} value={pageStore.maxQtyPerSku} onChange={value => updateStoreDraft(draft => { draft.maxQtyPerSku = Number(value) || 1; })} />)}
            {renderField('最多优惠券张数', pageStore.maxCoupons, <InputNumber min={0} max={8} value={pageStore.maxCoupons} onChange={value => updateStoreDraft(draft => { draft.maxCoupons = Number(value) || 0; })} />)}
            {renderField('整单折扣商品上限', pageStore.maxDiscountItems === '' ? '不限' : pageStore.maxDiscountItems, <InputNumber min={0} placeholder="空=不限" value={pageStore.maxDiscountItems === '' ? null : pageStore.maxDiscountItems} onChange={value => updateStoreDraft(draft => { draft.maxDiscountItems = value === null ? '' : Number(value) || 0; })} />)}
            {renderField('最多检查组合数', pageStore.maxChecks, <InputNumber min={1000} step={1000} value={pageStore.maxChecks} onChange={value => updateStoreDraft(draft => { draft.maxChecks = Number(value) || 1000; })} />)}
          </Row>
        </Card>

        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card title="费用规则" extra={isStoreEditing ? <Button onClick={() => updateStoreDraft(draft => { draft.usePlatformFee = true; draft.customFeeRule = null; })}>重置到平台规则</Button> : null}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {isStoreEditing ? (
                  <Checkbox checked={pageStore.usePlatformFee} onChange={e => updateStoreDraft(draft => { draft.usePlatformFee = e.target.checked; if (e.target.checked) draft.customFeeRule = null; else draft.customFeeRule = feeRule; })}>继承平台费用规则</Checkbox>
                ) : (
                  <Tag color={pageStore.usePlatformFee ? 'green' : 'blue'}>{pageStore.usePlatformFee ? '继承平台费用规则' : '门店自定义费用规则'}</Tag>
                )}
                <Row gutter={[12, 12]}>
                  {[
                    ['commissionRate', '佣金率%'],
                    ['minCommission', '保底佣金'],
                    ['baseDeliveryFee', '3公里内配送费'],
                    ['extraDeliveryFee', '超3公里每0.1公里'],
                    ['freightWithin3', '3公里内运费补贴'],
                    ['freightWithin5', '3-5公里运费补贴'],
                    ['freightAbove5', '5公里以上运费补贴']
                  ].map(([field, label]) => (
                    <Col xs={12} md={8} key={field}>
                      <div className="field">
                        <Text type="secondary">{label}</Text>
                        {isStoreEditing ? (
                          <InputNumber disabled={pageStore.usePlatformFee} precision={2} value={Number((feeRule as unknown as Record<string, number>)[field])} onChange={value => updateStoreDraft(draft => { draft.customFeeRule = { ...(draft.customFeeRule || {}), [field]: Number(value) || 0 }; })} />
                        ) : (
                          <div className="field-value">{money((feeRule as unknown as Record<string, number>)[field])}</div>
                        )}
                      </div>
                    </Col>
                  ))}
                </Row>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            {renderProfitTargetsCard('门店利润率阶梯', pageStore.usePlatformTargets ? state.platformRules.profitTargets : pageStore.profitTargets, !isStoreEditing || pageStore.usePlatformTargets, {
              extra: isStoreEditing ? <Checkbox checked={pageStore.usePlatformTargets} onChange={e => updateStoreDraft(draft => { draft.usePlatformTargets = e.target.checked; })}>继承平台阶梯</Checkbox> : <Tag color={pageStore.usePlatformTargets ? 'green' : 'blue'}>{pageStore.usePlatformTargets ? '继承平台阶梯' : '门店自定义阶梯'}</Tag>,
              onChange: rows => updateStoreDraft(draft => { draft.profitTargets = rows; }),
              onAdd: () => updateStoreDraft(draft => { draft.profitTargets.push({ enabled: true, payMin: 0, payMax: 20, rateMin: 20, rateMax: 30 }); })
            })}
          </Col>
        </Row>
      </div>
    );
  }

  function renderProfitTargetsCard(title: string, rows: ProfitTarget[], disabled: boolean, options: { extra?: React.ReactNode; onChange: (rows: ProfitTarget[]) => void; onAdd: () => void }) {
    const columns: TableColumnsType<ProfitTarget> = [
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (_, row, index) => disabled
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
          : <Switch checked={row.enabled} onChange={checked => options.onChange(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
      },
      {
        title: '实付最低',
        dataIndex: 'payMin',
        render: (_, row, index) => disabled
          ? `¥${money(row.payMin)}`
          : <InputNumber precision={2} value={row.payMin} onChange={value => options.onChange(rows.map((item, i) => i === index ? { ...item, payMin: Number(value) || 0 } : item))} />
      },
      {
        title: '实付最高',
        dataIndex: 'payMax',
        render: (_, row, index) => disabled
          ? `¥${money(row.payMax)}`
          : <InputNumber precision={2} value={row.payMax} onChange={value => options.onChange(rows.map((item, i) => i === index ? { ...item, payMax: Number(value) || 0 } : item))} />
      },
      {
        title: '利润率低%',
        dataIndex: 'rateMin',
        render: (_, row, index) => disabled
          ? `${money(row.rateMin)}%`
          : <InputNumber precision={2} value={row.rateMin} onChange={value => options.onChange(rows.map((item, i) => i === index ? { ...item, rateMin: Number(value) || 0 } : item))} />
      },
      {
        title: '利润率高%',
        dataIndex: 'rateMax',
        render: (_, row, index) => disabled
          ? `${money(row.rateMax)}%`
          : <InputNumber precision={2} value={row.rateMax} onChange={value => options.onChange(rows.map((item, i) => i === index ? { ...item, rateMax: Number(value) || 0 } : item))} />
      },
      ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: ProfitTarget, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => options.onChange(rows.filter((_, i) => i !== index))} /> }])
    ];
    return (
      <Card title={title} extra={<Space>{options.extra}{disabled ? null : <Button icon={<PlusOutlined />} onClick={options.onAdd}>添加阶梯</Button>}</Space>}>
        <Table size="small" rowKey={(_, index) => String(index)} columns={columns} dataSource={rows} pagination={false} scroll={{ x: 760 }} />
      </Card>
    );
  }

  function renderPricingStrategyCard(title: string, strategy: Record<StapleScenario, PricingStrategyTier[]>, disabled: boolean, onChange: (strategy: Record<StapleScenario, PricingStrategyTier[]>) => void) {
    const normalized = normalizePricingStrategy(strategy);
    const updateRows = (scenario: StapleScenario, rows: PricingStrategyTier[]) => {
      onChange({ ...normalized, [scenario]: rows });
    };
    const columnsFor = (scenario: StapleScenario): TableColumnsType<PricingStrategyTier> => {
      const rows = normalized[scenario];
      return [
        {
          title: '启用',
          dataIndex: 'enabled',
          width: 70,
          render: (_, row, index) => disabled
            ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
            : <Switch checked={row.enabled} onChange={checked => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
        },
        {
          title: '实付最低',
          dataIndex: 'payMin',
          width: 115,
          render: (_, row, index) => disabled
            ? `¥${money(row.payMin)}`
            : <InputNumber min={0} precision={2} value={row.payMin} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payMin: Number(value) || 0 } : item))} />
        },
        {
          title: '实付最高',
          dataIndex: 'payMax',
          width: 115,
          render: (_, row, index) => disabled
            ? (row.payMax >= 9999 ? '不限' : `¥${money(row.payMax)}`)
            : <InputNumber min={0} precision={2} value={row.payMax} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payMax: Number(value) || 0 } : item))} />
        },
        {
          title: '实付下限%',
          dataIndex: 'payRateMin',
          width: 115,
          render: (_, row, index) => disabled
            ? `${money(row.payRateMin)}%`
            : <InputNumber min={0} precision={2} value={row.payRateMin} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payRateMin: Number(value) || 0 } : item))} />
        },
        {
          title: '实付目标%',
          dataIndex: 'payRateTarget',
          width: 115,
          render: (_, row, index) => disabled
            ? `${money(row.payRateTarget)}%`
            : <InputNumber min={0} precision={2} value={row.payRateTarget} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payRateTarget: Number(value) || 0 } : item))} />
        },
        {
          title: '到手下限%',
          dataIndex: 'netRateMin',
          width: 115,
          render: (_, row, index) => disabled
            ? `${money(row.netRateMin)}%`
            : <InputNumber min={0} precision={2} value={row.netRateMin} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, netRateMin: Number(value) || 0 } : item))} />
        },
        {
          title: '到手目标%',
          dataIndex: 'netRateTarget',
          width: 115,
          render: (_, row, index) => disabled
            ? `${money(row.netRateTarget)}%`
            : <InputNumber min={0} precision={2} value={row.netRateTarget} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, netRateTarget: Number(value) || 0 } : item))} />
        },
        ...(disabled ? [] : [{
          title: '',
          width: 70,
          render: (_: unknown, __: PricingStrategyTier, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => updateRows(scenario, rows.filter((_, i) => i !== index))} />
        }])
      ];
    };
    return (
      <Card title={title}>
        <Text type="secondary">按用户实付匹配阶梯；下限用于预警，目标用于定价建议和活动设计。最后一档可把实付最高设置为 9999 表示不限。</Text>
        <Tabs
          items={STAPLE_SCENARIOS.map(scenario => ({
            key: scenario,
            label: stapleScenarioName(scenario),
            children: (
              <Space direction="vertical" style={{ width: '100%' }}>
                {disabled ? null : <Button icon={<PlusOutlined />} onClick={() => updateRows(scenario, normalized[scenario].concat({ enabled: true, payMin: 0, payMax: 9999, payRateMin: 0, payRateTarget: 0, netRateMin: 0, netRateTarget: 0 }))}>添加{stapleScenarioName(scenario)}阶梯</Button>}
                <Table size="small" rowKey={(_, index) => String(index)} columns={columnsFor(scenario)} dataSource={normalized[scenario]} pagination={false} scroll={{ x: 850 }} />
              </Space>
            )
          }))}
        />
      </Card>
    );
  }

  function renderProductBulkToolbar() {
    const disabled = selectedProductCount === 0;
    const pricePlaceholder = bulkPriceMode === 'discount' ? '如 8.8 表示 8.8折' : bulkPriceMode === 'increase' ? '可输入负数' : '输入金额';
    return (
      <Card size="small" title="批量操作">
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Tag color={selectedProductCount ? 'blue' : 'default'}>已选 {selectedProductCount} 个商品</Tag>
            <Button onClick={() => setSelectedProductRowKeys(displayedProducts.map(product => product.id))}>全选全部商品</Button>
            <Button onClick={() => setSelectedProductRowKeys(displayedProducts.filter(product => product.cost <= 0).map(product => product.id))}>选择缺成本商品</Button>
            <Button disabled={!selectedProductCount} onClick={() => setSelectedProductRowKeys([])}>清空选择</Button>
          </Space>

          <Space wrap>
            <Text type="secondary">状态</Text>
            <Button disabled={disabled} onClick={() => bulkSetProductFlag('meituanEnabled', true)}>美团上架</Button>
            <Button disabled={disabled} onClick={() => bulkSetProductFlag('meituanEnabled', false)}>美团下架</Button>
            <Button disabled={disabled} onClick={() => bulkSetProductFlag('elemeEnabled', true)}>饿了么上架</Button>
            <Button disabled={disabled} onClick={() => bulkSetProductFlag('elemeEnabled', false)}>饿了么下架</Button>
            <Button disabled={disabled} onClick={() => bulkSetProductFlag('nonStandalone', true)}>设为单点不送</Button>
            <Button disabled={disabled} onClick={() => bulkSetProductFlag('nonStandalone', false)}>允许单点</Button>
          </Space>

          <Space wrap>
            <Text type="secondary">分类</Text>
            <Select
              style={{ width: 130 }}
              value={bulkProductCategory}
              onChange={setBulkProductCategory}
              options={PRODUCT_CATEGORIES.map(category => ({ value: category, label: productCategoryName(category) }))}
            />
            <Button disabled={disabled} onClick={bulkSetProductCategory}>设置分类</Button>
            <InputNumber min={0} precision={0} placeholder="主食份数" value={bulkStapleServingCount} onChange={value => setBulkStapleServingCount(value === null ? null : Number(value))} />
            <Button disabled={disabled} onClick={bulkSetStapleServingCount}>设置主食份数</Button>
          </Space>

          <Space wrap>
            <Text type="secondary">价格</Text>
            <Select
              style={{ width: 150 }}
              value={bulkPriceField}
              onChange={value => setBulkPriceField(value)}
              options={[
                { value: 'price', label: '销售价' },
                { value: 'cost', label: '成本价' },
                { value: 'packageFee', label: '统一打包费' },
                { value: 'meituanPrice', label: '美团价' },
                { value: 'elemePrice', label: '饿了么价' },
                { value: 'meituanPackageFee', label: '美团打包费' },
                { value: 'elemePackageFee', label: '饿了么打包费' }
              ]}
            />
            <Select
              style={{ width: 130 }}
              value={bulkPriceMode}
              onChange={value => setBulkPriceMode(value)}
              options={[
                { value: 'set', label: '设置为' },
                { value: 'increase', label: '加减金额' },
                { value: 'discount', label: '按折扣' }
              ]}
            />
            <InputNumber placeholder={pricePlaceholder} precision={2} value={bulkPriceValue} onChange={value => setBulkPriceValue(value === null ? null : Number(value))} />
            <Button type="primary" disabled={disabled} onClick={applyBulkPriceEdit}>应用价格调整</Button>
            <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('meituanPrice')}>清空美团价</Button>
            <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('elemePrice')}>清空饿了么价</Button>
            <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('meituanPackageFee')}>清空美团打包费</Button>
            <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('elemePackageFee')}>清空饿了么打包费</Button>
          </Space>

          <Space wrap>
            <Text type="secondary">危险操作</Text>
            <Button danger icon={<DeleteOutlined />} onClick={deleteZeroPriceProducts}>删除0元商品</Button>
            <Button danger disabled={disabled} icon={<DeleteOutlined />} onClick={bulkDeleteProducts}>删除选中商品</Button>
            <Text type="secondary">批量操作只修改当前草稿，保存商品后才会生效。</Text>
          </Space>
        </Space>
      </Card>
    );
  }

  function renderProductsPage() {
    return (
      <Card title="商品维护" extra={
        <Space wrap>
          {isProductsEditing ? (
            <>
              <Upload {...uploadProps(file => importPlatformProducts(file, 'meituan'))}><Button icon={<UploadOutlined />}>导入美团商品表</Button></Upload>
              <Upload {...uploadProps(file => importPlatformProducts(file, 'eleme'))}><Button icon={<UploadOutlined />}>导入饿了么商品表</Button></Upload>
              <Upload {...uploadProps(importCostFile)}><Button icon={<UploadOutlined />}>导入成本表</Button></Upload>
              <Upload {...uploadProps(importProductsFile)}><Button icon={<UploadOutlined />}>导入商品CSV</Button></Upload>
              <Button icon={<PlusOutlined />} onClick={() => updateProductsDraft(draft => { draft.push(normalizeProduct({ id: uid('p'), name: '新商品', price: 0, cost: 0, meituanEnabled: true, elemeEnabled: true })); })}>添加商品</Button>
              <Button onClick={cancelProductsEdit}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={saveProductsEdit}>保存商品</Button>
            </>
          ) : (
            <Button type="primary" onClick={startProductsEdit}>编辑商品</Button>
          )}
        </Space>
      }>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">当前门店商品 {productSource.length} 个，当前展示 {displayedProducts.length} 个。平台商品表按商品名称更新对应平台价；成本表按商品名称更新成本价；美团表会同步售卖状态。</Text>
          <Card size="small" title="搜索和排序">
            <Space wrap>
              <Input.Search
                allowClear
                style={{ width: 260 }}
                placeholder="搜索商品名、分类、价格、成本"
                value={productSearchText}
                onChange={event => setProductSearchText(event.target.value)}
              />
              <Select
                style={{ width: 140 }}
                value={productCategoryFilter}
                onChange={setProductCategoryFilter}
                options={[
                  { value: 'all', label: '全部分类' },
                  ...PRODUCT_CATEGORIES.map(category => ({ value: category, label: productCategoryName(category) }))
                ]}
              />
              <Select
                style={{ width: 150 }}
                value={productStatusFilter}
                onChange={setProductStatusFilter}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'meituanEnabled', label: '美团上架' },
                  { value: 'meituanDisabled', label: '美团下架' },
                  { value: 'elemeEnabled', label: '饿了么上架' },
                  { value: 'elemeDisabled', label: '饿了么下架' },
                  { value: 'nonStandalone', label: '单点不送' },
                  { value: 'missingCost', label: '缺成本价' }
                ]}
              />
              <Select
                style={{ width: 160 }}
                value={productSortField}
                onChange={setProductSortField}
                options={[
                  { value: 'name', label: '按商品名' },
                  { value: 'category', label: '按分类' },
                  { value: 'stapleServingCount', label: '按主食份数' },
                  { value: 'price', label: '按销售价' },
                  { value: 'cost', label: '按成本价' },
                  { value: 'packageFee', label: '按统一打包费' },
                  { value: 'meituanPrice', label: '按美团价' },
                  { value: 'elemePrice', label: '按饿了么价' },
                  { value: 'meituanPackageFee', label: '按美团打包费' },
                  { value: 'elemePackageFee', label: '按饿了么打包费' }
                ]}
              />
              <Select
                style={{ width: 100 }}
                value={productSortAsc ? 'asc' : 'desc'}
                onChange={value => setProductSortAsc(value === 'asc')}
                options={[
                  { value: 'asc', label: '升序' },
                  { value: 'desc', label: '降序' }
                ]}
              />
              <Button onClick={() => {
                setProductSearchText('');
                setProductCategoryFilter('all');
                setProductStatusFilter('all');
                setProductSortField('name');
                setProductSortAsc(true);
              }}>清空筛选</Button>
            </Space>
          </Card>
          {isProductsEditing ? (
            <>
              {renderProductBulkToolbar()}
              <Input.TextArea rows={4} value={bulkText} onChange={e => setBulkText(e.target.value)} placeholder={'商品名,销售价,成本价,美团价,饿了么价,单点不送,美团上架,饿了么上架,统一打包费,美团打包费,饿了么打包费,商品分类,主食份数\n海鸭蛋和风饭团,15,6,,,否,是,是,0,,,主食,1'} />
              <Space><Button onClick={() => applyBulkProducts('append')}>追加批量商品</Button><Button danger onClick={() => applyBulkProducts('replace')}>替换当前商品</Button></Space>
            </>
          ) : null}
          <ProductTableErrorBoundary
            key={`${store.id}-${isProductsEditing ? 'edit' : 'view'}-${productSource.length}-${productSearchText}-${productCategoryFilter}-${productStatusFilter}-${productSortField}-${productSortAsc ? 'asc' : 'desc'}`}
            fallback={
              <Card size="small">
                <Space direction="vertical">
                  <Text type="danger">商品列表渲染异常，已阻止页面继续崩溃。</Text>
                  <Text type="secondary">请先清空筛选或退出编辑后重新进入；异常通常来自重复商品标识或导入数据字段异常。</Text>
                  <Space>
                    <Button onClick={() => {
                      setProductSearchText('');
                      setProductCategoryFilter('all');
                      setProductStatusFilter('all');
                      setProductSortField('name');
                      setProductSortAsc(true);
                    }}>清空筛选</Button>
                    {isProductsEditing ? <Button onClick={cancelProductsEdit}>退出编辑</Button> : null}
                  </Space>
                </Space>
              </Card>
            }
          >
            <Table
              rowKey={row => row.id}
              size="small"
              rowSelection={productRowSelection}
              columns={productColumns}
              dataSource={displayedProducts}
              pagination={tablePagination(30)}
              scroll={{ x: 1800, y: 620 }}
              virtual
              tableLayout="fixed"
            />
          </ProductTableErrorBoundary>
        </Space>
      </Card>
    );
  }

  function renderPlatformPage() {
    const fee = isPlatformEditing && platformDraft ? platformDraft : state.platformRules;
    return (
      <div className="section-stack">
        <Card
          title="平台费用规则"
          extra={isPlatformEditing ? (
            <Space>
              <Button onClick={cancelPlatformEdit}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={savePlatformEdit}>保存平台规则</Button>
            </Space>
          ) : (
            <Button type="primary" onClick={startPlatformEdit}>编辑平台规则</Button>
          )}
        >
          <Row gutter={[12, 12]}>
            {[
              ['commissionRate', '佣金率%'],
              ['minCommission', '保底佣金'],
              ['baseDeliveryFee', '3公里内配送费'],
              ['extraDeliveryFee', '超3公里每0.1公里'],
              ['midPriceRate', '20-25元价格费率'],
              ['highPriceRate', '25元以上价格费率'],
              ['freightWithin3', '3公里内运费补贴'],
              ['freightWithin5', '3-5公里运费补贴'],
              ['freightAbove5', '5公里以上运费补贴']
            ].map(([field, label]) => (
              <Col xs={12} md={6} key={field}>
                <div className="field">
                  <Text type="secondary">{label}</Text>
                  {isPlatformEditing ? (
                    <InputNumber precision={2} value={Number((fee as unknown as Record<string, number>)[field])} onChange={value => updatePlatformDraft(draft => { (draft as unknown as Record<string, number>)[field] = Number(value) || 0; })} />
                  ) : (
                    <div className="field-value">{money((fee as unknown as Record<string, number>)[field])}</div>
                  )}
                </div>
              </Col>
            ))}
          </Row>
        </Card>
        {renderProfitTargetsCard('平台通用利润率阶梯', fee.profitTargets, !isPlatformEditing, {
          onChange: rows => updatePlatformDraft(draft => { draft.profitTargets = rows; }),
          onAdd: () => updatePlatformDraft(draft => { draft.profitTargets.push({ enabled: true, payMin: 0, payMax: 20, rateMin: 20, rateMax: 30 }); })
        })}
        {renderPricingStrategyCard('平台通用定价策略阶梯', fee.pricingStrategy, !isPlatformEditing, strategy => updatePlatformDraft(draft => { draft.pricingStrategy = normalizePricingStrategy(strategy); }))}
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>{renderRedTierCard('美团基础神券', fee.redTiers.meituan, !isPlatformEditing, rows => updatePlatformDraft(draft => { draft.redTiers.meituan = rows; }))}</Col>
          <Col xs={24} lg={12}>{renderRedTierCard('饿了么基础爆红包', fee.redTiers.eleme, !isPlatformEditing, rows => updatePlatformDraft(draft => { draft.redTiers.eleme = rows; }))}</Col>
        </Row>
      </div>
    );
  }

  function renderRedTierCard(title: string, rows: RedTier[], disabled: boolean, change: (rows: RedTier[]) => void) {
    const columns: TableColumnsType<RedTier> = [
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (_, row, index) => disabled
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
          : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
      },
      {
        title: '门槛',
        dataIndex: 'threshold',
        render: (_, row, index) => disabled
          ? `¥${money(row.threshold)}`
          : <InputNumber precision={2} value={row.threshold} onChange={value => change(rows.map((item, i) => i === index ? { ...item, threshold: Number(value) || 0 } : item))} />
      },
      {
        title: '最小',
        dataIndex: 'min',
        render: (_, row, index) => disabled
          ? `¥${money(row.min)}`
          : <InputNumber precision={2} value={row.min} onChange={value => change(rows.map((item, i) => i === index ? { ...item, min: Number(value) || 0 } : item))} />
      },
      {
        title: '最大',
        dataIndex: 'max',
        render: (_, row, index) => disabled
          ? `¥${money(row.max)}`
          : <InputNumber precision={2} value={row.max} onChange={value => change(rows.map((item, i) => i === index ? { ...item, max: Number(value) || 0 } : item))} />
      },
      ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: RedTier, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
    ];
    return <Card title={title} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat({ enabled: true, threshold: 0, min: 0, max: 0 }))}>添加档位</Button>}><Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} /></Card>;
  }

  function renderActivityPage(platform: Platform) {
    const isEditing = editingActivityPlatform === platform && activityDraft !== null;
    const activities = isEditing && activityDraft ? activityDraft : store.activities[platform];
    return (
      <div className="section-stack">
        <Card
          title={`${PLATFORM_NAMES[platform]}活动维护`}
          extra={isEditing ? (
            <Space>
              <Button onClick={cancelActivityEdit}>取消</Button>
              <Button type="primary" icon={<SaveOutlined />} onClick={saveActivityEdit}>保存活动</Button>
            </Space>
          ) : (
            <Button type="primary" onClick={() => startActivityEdit(platform)}>编辑活动</Button>
          )}
        >
          <Text type="secondary">活动配置归属于当前门店「{store.name}」。基础{platform === 'meituan' ? '神券' : '爆红包'}阶梯来自平台通用规则，本页只维护门店加码和门店承担的活动。</Text>
        </Card>
        {renderSimpleActivityTable(`${PLATFORM_NAMES[platform]}门店满减`, activities.fullReductions, rows => updateActivityDraft(draft => { draft.fullReductions = rows; }), { enabled: true, threshold: 0, amount: 0 }, !isEditing)}
        {renderCouponTable(platform, activities.coupons, rows => updateActivityDraft(draft => { draft.coupons = rows; }), !isEditing)}
        {renderSimpleActivityTable(`${PLATFORM_NAMES[platform]}${platform === 'meituan' ? '神券' : '爆红包'}加码`, activities.redAddOns, rows => updateActivityDraft(draft => { draft.redAddOns = rows; }), { enabled: true, threshold: 0, amount: 0 }, !isEditing)}
        {renderDiscountActivityTable(platform, activities.discountActivities, rows => updateActivityDraft(draft => { draft.discountActivities = rows; }), !isEditing)}
      </div>
    );
  }

  function renderSimpleActivityTable<T extends FullReduction | RedAddOn>(title: string, rows: T[], change: (rows: T[]) => void, blank: T, disabled: boolean) {
    const columns: TableColumnsType<T> = [
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (_, row, index) => disabled
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
          : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
      },
      {
        title: '门槛',
        dataIndex: 'threshold',
        render: (_, row, index) => disabled
          ? `¥${money(row.threshold)}`
          : <InputNumber precision={2} value={row.threshold} onChange={value => change(rows.map((item, i) => i === index ? { ...item, threshold: Number(value) || 0 } : item))} />
      },
      {
        title: '金额',
        dataIndex: 'amount',
        render: (_, row, index) => disabled
          ? `¥${money(row.amount)}`
          : <InputNumber precision={2} value={row.amount} onChange={value => change(rows.map((item, i) => i === index ? { ...item, amount: Number(value) || 0 } : item))} />
      },
      ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: T, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
    ];
    return <Card title={title} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat(blank))}>添加</Button>}><Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} /></Card>;
  }

  function renderCouponTable(platform: Platform, rows: Coupon[], change: (rows: Coupon[]) => void, disabled: boolean) {
    const columns: TableColumnsType<Coupon> = [
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (_, row, index) => disabled
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
          : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
      },
      {
        title: '名称',
        dataIndex: 'name',
        render: (_, row, index) => disabled
          ? <Text>{row.name || '-'}</Text>
          : <Input value={row.name} onChange={e => change(rows.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
      },
      {
        title: '门槛',
        dataIndex: 'threshold',
        render: (_, row, index) => disabled
          ? `¥${money(row.threshold)}`
          : <InputNumber precision={2} value={row.threshold} onChange={value => change(rows.map((item, i) => i === index ? { ...item, threshold: Number(value) || 0 } : item))} />
      },
      {
        title: '金额',
        dataIndex: 'amount',
        render: (_, row, index) => disabled
          ? `¥${money(row.amount)}`
          : <InputNumber precision={2} value={row.amount} onChange={value => change(rows.map((item, i) => i === index ? { ...item, amount: Number(value) || 0 } : item))} />
      },
      ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: Coupon, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
    ];
    return <Card title={`${PLATFORM_NAMES[platform]}订单优惠券`} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat({ enabled: true, name: '订单优惠券', threshold: 0, amount: 0 }))}>添加券</Button>}><Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 760 }} /></Card>;
  }

  function renderDiscountActivityTable(platform: Platform, rows: DiscountActivity[], change: (rows: DiscountActivity[]) => void, disabled: boolean) {
    const columns: TableColumnsType<DiscountActivity> = [
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (_, row, index) => disabled
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
          : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
      },
      {
        title: '名称',
        dataIndex: 'name',
        render: (_, row, index) => disabled
          ? <Text>{row.name || '-'}</Text>
          : <Input value={row.name} onChange={e => change(rows.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
      },
      {
        title: '商品关键字',
        dataIndex: 'productNames',
        render: (_, row, index) => disabled
          ? <Text>{row.productNames || '全部商品'}</Text>
          : <Input placeholder="空=全部，多个用逗号" value={row.productNames} onChange={e => change(rows.map((item, i) => i === index ? { ...item, productNames: e.target.value } : item))} />
      },
      {
        title: '折扣',
        dataIndex: 'discountRate',
        render: (_, row, index) => disabled
          ? `${money(row.discountRate)}折`
          : <InputNumber precision={2} value={row.discountRate} onChange={value => change(rows.map((item, i) => i === index ? { ...item, discountRate: Number(value) || 0 } : item))} />
      },
      {
        title: '活动件数上限',
        dataIndex: 'itemLimit',
        render: (_, row, index) => disabled
          ? (row.itemLimit === '' ? '不限' : row.itemLimit)
          : <InputNumber min={0} placeholder="空=不限" value={row.itemLimit === '' ? null : row.itemLimit} onChange={value => change(rows.map((item, i) => i === index ? { ...item, itemLimit: value === null ? '' : Number(value) || 0 } : item))} />
      },
      ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: DiscountActivity, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
    ];
    return <Card title={`${PLATFORM_NAMES[platform]}商品折扣活动`} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat({ enabled: true, name: '商品折扣', productNames: '', discountRate: 8.8, itemLimit: '' }))}>添加折扣</Button>}><Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 920 }} /></Card>;
  }

  function renderCostAnalysisPage() {
    const costSummary = costAnalysis?.summary || { resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null };
    const selectedIssue = selectedCostIssue;
    return (
      <div className="section-stack">
        <Card title="成本测算" extra={
          <Space wrap>
            <Select value={costPlatformFilter} onChange={setCostPlatformFilter} options={[{ value: 'all', label: '全部平台' }, { value: 'meituan', label: '只看美团' }, { value: 'eleme', label: '只看饿了么' }]} />
            <Switch checked={costCompactColumns} onChange={setCostCompactColumns} checkedChildren="精简列" unCheckedChildren="完整列" />
            <Button type="primary" loading={isCostAnalysisLoading} onClick={runCostAnalysis}>生成成本测算</Button>
            <Button icon={<DownloadOutlined />} onClick={exportCostAnalysis}>导出诊断CSV</Button>
          </Space>
        }>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Text type="secondary">基于当前门店商品成本、平台价、打包费、平台基础神券/爆红包、本页预留优惠空间和平台定价策略阶梯，计算商品在单买和组合中的利润率范围。成本测算不读取当前门店满减和订单券；满减/券空间用于模拟后续券或满减设计，会先从含打包费原价中扣除，再命中神券/爆红包阶梯。商品名称筛选按模糊匹配，只输出命中商品及包含它的组合。门店测算总价范围：{calculationRangeText(store)}；主食份数范围：{stapleCountRangeText(store)}；本页商品原价小计范围：{costAnalysisOriginalRangeText(costAnalysisSettings)}。</Text>
            <Card size="small" title="成本测算参数">
              <Row gutter={[12, 12]}>
                <Col xs={24} md={8}>
                  <div className="field">
                    <Text type="secondary">商品名称筛选</Text>
                    <Input allowClear placeholder="空=全部商品，支持模糊匹配" value={costAnalysisSettings.productNameKeyword} onChange={event => setCostAnalysisSettings(prev => ({ ...prev, productNameKeyword: event.target.value }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价小计最低</Text>
                    <InputNumber min={0} precision={2} value={costAnalysisSettings.originalMin} onChange={value => setCostAnalysisSettings(prev => ({ ...prev, originalMin: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价小计最高</Text>
                    <InputNumber min={0} precision={2} placeholder="空=不限" value={costAnalysisSettings.originalMax === '' ? null : costAnalysisSettings.originalMax} onChange={value => setCostAnalysisSettings(prev => ({ ...prev, originalMax: value === null ? '' : Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">支付价最低</Text>
                    <InputNumber min={0} precision={2} value={costAnalysisSettings.payMin} onChange={value => setCostAnalysisSettings(prev => ({ ...prev, payMin: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">支付价最高</Text>
                    <InputNumber min={0} precision={2} placeholder="空=不限" value={costAnalysisSettings.payMax === '' ? null : costAnalysisSettings.payMax} onChange={value => setCostAnalysisSettings(prev => ({ ...prev, payMax: value === null ? '' : Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">满减/券空间</Text>
                    <InputNumber min={0} precision={2} value={costAnalysisSettings.couponSpace} onChange={value => setCostAnalysisSettings(prev => ({ ...prev, couponSpace: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={5}>
                  <div className="field">
                    <Text type="secondary">神券/爆红包加码空间</Text>
                    <InputNumber min={0} precision={2} value={costAnalysisSettings.redAddOnSpace} onChange={value => setCostAnalysisSettings(prev => ({ ...prev, redAddOnSpace: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={24} md={4}>
                  <div className="field-value">实付范围 {costAnalysisPayRangeText(costAnalysisSettings)}</div>
                </Col>
              </Row>
            </Card>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">结果组合</Text><Title level={3}>{costSummary.resultCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">检查组合</Text><Title level={3}>{costSummary.comboCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">商品诊断</Text><Title level={3}>{costAnalysis?.issues.length || 0}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">异常商品</Text><Title level={3}>{costAnalysis?.issues.filter(issue => issue.severity !== 'none').length || 0}</Title></Card></Col>
            </Row>
            {costAnalysis?.warnings.length ? <Card size="small">{costAnalysis.warnings.map(item => <Text key={item} type="warning">{item}</Text>)}</Card> : null}
            <Table loading={isCostAnalysisLoading} rowKey="key" size="small" columns={costIssueColumns} dataSource={costAnalysis?.issues || []} pagination={tablePagination(20)} scroll={{ x: costCompactColumns ? 1080 : 2140 }} tableLayout="fixed" />
          </Space>
        </Card>

        <Modal
          title={renderCostModalTitle(selectedIssue)}
          open={Boolean(selectedIssue)}
          width={isCostModalFullscreen ? 'calc(100vw - 32px)' : 1180}
          className={isCostModalFullscreen ? 'cost-analysis-modal cost-analysis-modal-fullscreen' : 'cost-analysis-modal'}
          style={isCostModalFullscreen ? { top: 16, paddingBottom: 0 } : { transform: `translate(${costModalOffset.x}px, ${costModalOffset.y}px)` }}
          footer={null}
          onCancel={closeCostModal}
        >
          {selectedIssue ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space wrap>
                <Tag color={severityColor(selectedIssue.severity)}>{severityLabel(selectedIssue.severity)}</Tag>
                <Text type="secondary">明细展示该商品在当前支付价范围内所有可下单组合的优惠、平台费用、净实付和利润率。</Text>
              </Space>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前价</Text><Title level={4}>¥{money(selectedIssue.currentPrice)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">成本价</Text><Title level={4}>¥{money(selectedIssue.costPrice)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">命中组合</Text><Title level={4}>{selectedCostDetails.length}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">平均利润率</Text><Title level={4}>{rateText(selectedIssue.avgProfitRate)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">最低利润率</Text><Title level={4}>{rateText(selectedIssue.minProfitRate)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">剩余优惠空间</Text><Title level={4}>{selectedIssue.minAffordableSpace === null ? '-' : `¥${money(selectedIssue.minAffordableSpace)}`}</Title></Card></Col>
              </Row>
              <Card size="small" title="建议调价">
                <Space direction="vertical" style={{ width: '100%' }} size="middle">
                  <Row gutter={[12, 12]}>
                    <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前平台价</Text><Title level={4}>¥{money(selectedIssue.currentPrice)}</Title></Card></Col>
                    <Col xs={12} md={4}><Card size="small"><Text type="secondary">建议平台价</Text><Title level={4}>{selectedIssue.suggestedPrice === null ? '-' : `¥${money(selectedIssue.suggestedPrice)}`}</Title></Card></Col>
                    <Col xs={12} md={4}><Card size="small"><Text type="secondary">建议加价</Text><Title level={4}>{selectedIssue.suggestedIncrease > 0 ? `+¥${money(selectedIssue.suggestedIncrease)}` : '-'}</Title></Card></Col>
                    <Col xs={12} md={4}><Card size="small"><Text type="secondary">加价比例</Text><Title level={4}>{rateText(selectedIssue.suggestedIncreaseRate)}</Title></Card></Col>
                    <Col xs={24} md={8}>
                      <div className="field">
                        <Text type="secondary">调整为</Text>
                        <InputNumber min={0} precision={2} value={costAdjustmentPrice} onChange={value => setCostAdjustmentPrice(value === null ? null : Number(value))} />
                        <Button type="primary" onClick={applyCostAnalysisPrice}>应用到{selectedIssue.platformName}价</Button>
                      </div>
                    </Col>
                  </Row>
                  <Text type="secondary">{selectedIssue.suggestionBasis}。应用后会记录调价流水，并保存到浏览器数据库；请重新生成成本测算查看新价格下的利润。</Text>
                </Space>
              </Card>
              <Card size="small" title="商品组合利润率曲线">
                <ProfitCurveChart points={selectedCurvePoints} />
              </Card>
              <Card size="small" title="商品组合明细">
                <Table className="cost-combo-detail-table" loading={isCostAnalysisLoading} rowKey="key" size="small" columns={costDetailColumns} dataSource={selectedCostDetails} pagination={tablePagination(20)} scroll={{ x: 3300 }} tableLayout="fixed" />
              </Card>
              <Card size="small" title="该商品调价记录">
                <Table rowKey="id" size="small" columns={costAdjustmentColumns} dataSource={selectedCostAdjustments} pagination={tablePagination(5)} scroll={{ x: 900 }} />
              </Card>
            </Space>
          ) : null}
        </Modal>

        <Card title="优惠券后神券/爆红包阶梯命中分析">
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <TierHitChart rows={costAnalysis?.redTierRows || []} label="优惠券后神券/爆红包阶梯" />
            <Table loading={isCostAnalysisLoading} rowKey="key" size="small" columns={tierAnalysisColumns} dataSource={costAnalysis?.redTierRows || []} pagination={false} scroll={{ x: 740 }} />
          </Space>
        </Card>

        <Card title="成本测算调价记录">
          <Table rowKey="id" size="small" columns={costAdjustmentColumns} dataSource={store.costPriceAdjustments} pagination={tablePagination(10)} scroll={{ x: 900 }} />
        </Card>
      </div>
    );
  }

  function renderActivityDesignPage() {
    const designSummary = activityDesign?.summary || (isActivityDesignLoading ? summary : { ...EMPTY_SUMMARY });
    const activityPayMaxBoundary = ACTIVITY_PAY_MAX_BY_SCENARIO.multi;
    const activityEffectivePayMax = activityDesignSettings.payMax === ''
      ? activityPayMaxBoundary
      : Math.min(activityPayMaxBoundary, Math.max(0, Number(activityDesignSettings.payMax) || 0));
    const updateActivityDesignPayBandKey = (platform: Platform, key: string) => {
      setSelectedActivityDesignPayBandKeyByPlatform(prev => ({ ...prev, [platform]: key }));
    };
    const selectedActivityDesignPlatformRows = selectedActivityDesignBand
      ? (activityDesign?.comboRows || []).filter(row => row.platform === selectedActivityDesignBand.platform)
      : [];
    const selectedActivityDesignPayBands = selectedActivityDesignBand
      ? (activityDesign?.payBands || []).filter(row => row.platform === selectedActivityDesignBand.platform)
      : [];
    const selectedActivityDesignBandKey = selectedActivityDesignBand?.payBandKey || 'all';
    const selectedActivityDesignPayBand = selectedActivityDesignBandKey === 'all'
      ? null
      : selectedActivityDesignPayBands.find(row => row.key === selectedActivityDesignBandKey) || null;
    const selectedActivityDesignFullCount = selectedActivityDesignPayBand
      ? selectedActivityDesignPayBand.comboCount
      : selectedActivityDesignPayBands.reduce((sum, row) => sum + row.comboCount, 0);
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
    const selectedActivityDesignRiskRows = selectedActivityDesignFilteredRows.filter(row => row.ignored || row.risk?.hasRisk);
    const renderActivityDesignPlatformPanel = (platform: Platform) => {
      const originalBands = (activityDesign?.originalBands || []).filter(row => row.platform === platform);
      const recommendations = (activityDesign?.recommendations || []).filter(row => row.platform === platform);
      const hitRows = ((activityDesign?.hitRows || []) as ActivityComboSimulationRow[]).filter(row => row.platform === platform);
      const payBands = (activityDesign?.payBands || []).filter(row => row.platform === platform);
      const comboRows = ((activityDesign?.comboRows || []) as ActivityComboSimulationRow[]).filter(row => row.platform === platform);
      const payBandComboCount = payBands.reduce((sum, row) => sum + row.comboCount, 0);
      const payBandRiskCount = payBands.reduce((sum, row) => sum + row.riskCount, 0);
      const selectedRouteInPlatform = Boolean(selectedActivityDesignRouteKey) && (
        recommendations.some(row => row.key === selectedActivityDesignRouteKey)
        || hitRows.some(row => row.recommendationKey === selectedActivityDesignRouteKey)
        || comboRows.some(row => row.recommendationKey === selectedActivityDesignRouteKey)
        || payBands.length > 0
      );
      const isSelectedRouteValidating = selectedRouteInPlatform && isActivityDesignLoading && !payBands.length;
      return (
        <div className="section-stack result-platform-panel">
          <Card title="第一阶段：原价区间扫描">
            <Table loading={isActivityDesignLoading} rowKey="key" size="small" columns={activityPriceBandColumns} dataSource={originalBands} pagination={tablePagination(20)} scroll={{ x: 1300 }} tableLayout="fixed" />
          </Card>
          <Card title="第二阶段：活动路线与关键命中组合">
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Text type="secondary">先给出满减阶梯和优惠券组合，再列出最大优惠命中的最小阶梯组合、最低利润空间组合和最高利润组合。</Text>
              <Table loading={isActivityDesignLoading} rowKey="key" size="small" columns={activityPlatformRecommendationColumns} dataSource={recommendations} pagination={tablePagination(20)} scroll={{ x: 2220 }} tableLayout="fixed" />
              {selectedRouteInPlatform ? (
                <Table loading={isActivityDesignLoading} rowKey="key" size="small" columns={activityComboColumns} dataSource={hitRows} pagination={tablePagination(20)} scroll={{ x: 1700 }} tableLayout="fixed" />
              ) : (
                <Text type="secondary">选择并校验一条{PLATFORM_NAMES[platform]}活动路线后，这里会展示关键命中组合。</Text>
              )}
            </Space>
          </Card>
          {isSelectedRouteValidating ? (
            <Card title="第三阶段：活动后支付价校验">
              <Text type="secondary">正在计算所选活动路线的支付价区间、命中明细和风险预警。</Text>
            </Card>
          ) : selectedRouteInPlatform && !payBands.length ? (
            <Card title="第三阶段：活动后支付价校验">
              <Text type="secondary">当前活动设计参数下没有命中支付价区间，请调整原价范围、支付价范围、饭团最大组合数、凑单小吃上限或重新生成活动路线。</Text>
            </Card>
          ) : selectedRouteInPlatform ? (
            <PayBandAnalysisPanel
              title="第三阶段：活动后支付价校验"
              chartTitle={`${PLATFORM_NAMES[platform]}活动后支付价区间`}
              platformName={PLATFORM_NAMES[platform]}
              payBands={payBands}
              selectedPayBandKey={selectedActivityDesignPayBandKeyByPlatform[platform] || 'all'}
              rowCount={payBandComboCount}
              riskCount={payBandRiskCount}
              loading={isActivityDesignLoading}
              columns={activityPriceBandColumns}
              onSelectPayBand={key => {
                updateActivityDesignPayBandKey(platform, key);
                setSelectedActivityDesignBand({ platform, payBandKey: key });
                setActivityDesignDetailSearchText('');
              }}
            />
          ) : (
            <Card title="第三阶段：活动后支付价校验">
              <Text type="secondary">请先在第二阶段选择一条{PLATFORM_NAMES[platform]}活动路线进行校验。</Text>
            </Card>
          )}
        </div>
      );
    };
    return (
      <div className="section-stack">
        <Card title="活动设计参数">
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Text type="secondary">先按饭团最大组合数和凑单小吃上限扫描当前销售价组合，再基于平均目标利润空间和负利润容忍边界反推活动路线，列出命中组合，最后按组合实际主食份数进行支付价校验：单人最高 ¥40、双人最高 ¥80、多人最高 ¥150，商家到手价最低 ¥2。</Text>
            <Card size="small">
              <Row gutter={[12, 12]}>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">饭团最大组合数</Text>
                    <InputNumber min={1} precision={0} value={activityDesignSettings.stapleMaxCount ?? 2} onChange={value => setActivityDesignSettings(prev => ({ ...prev, stapleMaxCount: Math.max(1, Math.floor(Number(value) || 2)) }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">凑单小吃最多件数</Text>
                    <InputNumber min={0} precision={0} placeholder="空=门店上限" value={activityDesignSettings.addOnMaxCount === '' ? null : activityDesignSettings.addOnMaxCount ?? 3} onChange={value => setActivityDesignSettings(prev => ({ ...prev, addOnMaxCount: value === null ? '' : Math.max(0, Math.floor(Number(value) || 0)) }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价小计最低</Text>
                    <InputNumber min={0} precision={2} value={activityDesignSettings.originalMin} onChange={value => setActivityDesignSettings(prev => ({ ...prev, originalMin: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价小计最高</Text>
                    <InputNumber min={0} precision={2} placeholder="空=不限" value={activityDesignSettings.originalMax === '' ? null : activityDesignSettings.originalMax} onChange={value => setActivityDesignSettings(prev => ({ ...prev, originalMax: value === null ? '' : Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">支付价最低</Text>
                    <InputNumber min={0} precision={2} value={activityDesignSettings.payMin} onChange={value => setActivityDesignSettings(prev => ({ ...prev, payMin: Number(value) || 0 }))} />
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
                      value={activityDesignSettings.payMax === '' ? null : Math.min(activityPayMaxBoundary, Number(activityDesignSettings.payMax) || 0)}
                      onChange={value => setActivityDesignSettings(prev => ({ ...prev, payMax: value === null ? '' : Math.min(activityPayMaxBoundary, Number(value) || 0) }))}
                    />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">整体目标利润率%</Text>
                    <InputNumber min={0} max={95} precision={2} value={activityDesignSettings.targetProfitRate} onChange={value => setActivityDesignSettings(prev => ({ ...prev, targetProfitRate: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">最低利润率%</Text>
                    <InputNumber min={0} max={95} precision={2} value={activityDesignSettings.minProfitRate ?? 0} onChange={value => setActivityDesignSettings(prev => ({ ...prev, minProfitRate: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">目标下浮百分点</Text>
                    <InputNumber min={0} precision={2} value={activityDesignSettings.couponProfitDrop} onChange={value => setActivityDesignSettings(prev => ({ ...prev, couponProfitDrop: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">神券/爆红包加码空间</Text>
                    <InputNumber min={0} precision={2} value={activityDesignSettings.redAddOnSpace} onChange={value => setActivityDesignSettings(prev => ({ ...prev, redAddOnSpace: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">让利步长</Text>
                    <InputNumber min={0.1} precision={1} value={activityDesignSettings.couponDesignAmountStep} onChange={value => setActivityDesignSettings(prev => ({ ...prev, couponDesignAmountStep: Number(value) || 1 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">满减最大减额</Text>
                    <InputNumber min={0} precision={2} placeholder="空=20" value={activityDesignSettings.couponDesignMaxFullAmount === '' ? null : activityDesignSettings.couponDesignMaxFullAmount} onChange={value => setActivityDesignSettings(prev => ({ ...prev, couponDesignMaxFullAmount: value === null ? '' : Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">券最大减额</Text>
                    <InputNumber min={0} precision={2} placeholder="空=20" value={activityDesignSettings.couponDesignMaxCouponAmount === '' ? null : activityDesignSettings.couponDesignMaxCouponAmount} onChange={value => setActivityDesignSettings(prev => ({ ...prev, couponDesignMaxCouponAmount: value === null ? '' : Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价区间步长</Text>
                    <InputNumber min={1} precision={0} value={activityDesignSettings.originalBandSize ?? 5} onChange={value => setActivityDesignSettings(prev => ({ ...prev, originalBandSize: Number(value) || 5 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">支付价区间步长</Text>
                    <InputNumber min={1} precision={0} value={activityDesignSettings.payBandSize ?? 5} onChange={value => setActivityDesignSettings(prev => ({ ...prev, payBandSize: Number(value) || 5 }))} />
                  </div>
                </Col>
                <Col xs={24} md={4}>
                  <div className="field-value">实际支付价范围 ¥{money(activityDesignSettings.payMin)}-¥{money(activityEffectivePayMax)}</div>
                </Col>
              </Row>
            </Card>
            <Button type="primary" loading={isActivityDesignLoading} onClick={runActivityDesign}>生成活动路线</Button>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">活动路线</Text><Title level={3}>{designSummary.resultCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">检查组合</Text><Title level={3}>{designSummary.comboCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">有效组合</Text><Title level={3}>{designSummary.validComboCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">耗时</Text><Title level={3}>{designSummary.elapsedTime === null ? '-' : `${designSummary.elapsedTime}ms`}</Title></Card></Col>
            </Row>
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
          title={selectedActivityDesignBand ? `${PLATFORM_NAMES[selectedActivityDesignBand.platform]} / ${selectedActivityDesignPayBand ? `¥${selectedActivityDesignPayBand.label}` : '全部支付价区间'} 活动校验明细` : '活动校验明细'}
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
              <Space wrap>
                <Input.Search
                  allowClear
                  style={{ width: 320 }}
                  placeholder="搜索商品名称"
                  value={activityDesignDetailSearchText}
                  onChange={event => setActivityDesignDetailSearchText(event.target.value)}
                />
                <Text type="secondary">当前展示 {selectedActivityDesignFilteredRows.length} 条，区间全量 {selectedActivityDesignFullCount} 条，风险 {selectedActivityDesignRiskRows.length} 条</Text>
              </Space>
              <Tabs
                destroyOnHidden
                items={[
                  {
                    key: 'details',
                    label: '组合明细',
                    children: (
                      <Table
                        loading={isActivityDesignLoading}
                        rowClassName={row => row.ignored ? 'risk-config' : row.risk?.hasRisk ? `risk-${row.risk.severity}` : ''}
                        rowKey="key"
                        size="small"
                        columns={activityComboColumns}
                        dataSource={selectedActivityDesignFilteredRows}
                        pagination={tablePagination(30)}
                        scroll={{ x: 1700 }}
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
                        scroll={{ x: 1320 }}
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

  function renderPricingEvaluationPage() {
    const pricingSummary = pricingEvaluation?.summary || (isPricingEvaluationLoading ? summary : { resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
    const pricingStrategy = normalizePricingStrategy(effectiveFeeRule(state, store).pricingStrategy);
    const pricingIssues = pricingEvaluation?.productRows || [];
    const pricingResultKeyword = pricingResultSearchText.trim().toLowerCase();
    const visiblePricingIssues = pricingResultKeyword
      ? pricingIssues.filter(issue => [
        severityLabel(issue.severity),
        issue.platformName,
        issue.productName,
        issue.categoryName,
        issue.scenarioName,
        issue.currentPrice,
        issue.packageFee,
        issue.currentOriginalPrice,
        issue.productCost,
        issue.fixedCostAllocation,
        issue.baseCost,
        issue.targetProfitRate,
        issue.currentProfitRate,
        issue.profitSpace,
        issue.suggestedPrice,
        issue.suggestedOriginalPrice,
        issue.suggestedIncrease,
        issue.reasons.join(' ')
      ].join(' ').toLowerCase().includes(pricingResultKeyword))
      : pricingIssues;
    const abnormalPricingIssueCount = pricingIssues.filter(issue => issue.severity !== 'none').length;
    return (
      <div className="section-stack">
        <Card title="定价评估" extra={
          <Space wrap>
            <Select value={pricingPlatformFilter} onChange={setPricingPlatformFilter} options={[{ value: 'all', label: '全部平台' }, { value: 'meituan', label: '只看美团' }, { value: 'eleme', label: '只看饿了么' }]} />
            <Button type="primary" loading={isPricingEvaluationLoading} onClick={runPricingEvaluation}>生成定价评估</Button>
          </Space>
        }>
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Text type="secondary">基于商品成本、主食/套餐固定成本分摊和分类目标利润率评估销售价。单点不送商品不分摊固定成本，只按商品成本和目标利润率计算；活动影响由活动设计和测算结果页校验。</Text>
            <Card size="small" title="定价评估参数">
              <Row gutter={[12, 12]}>
                <Col xs={24} md={8}>
                  <div className="field">
                    <Text type="secondary">商品名称筛选</Text>
                    <Input allowClear placeholder="空=全部商品，支持模糊匹配" value={pricingSettings.productNameKeyword} onChange={event => setPricingSettings(prev => ({ ...prev, productNameKeyword: event.target.value }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价小计最低</Text>
                    <InputNumber min={0} precision={2} value={pricingSettings.originalMin} onChange={value => setPricingSettings(prev => ({ ...prev, originalMin: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">原价小计最高</Text>
                    <InputNumber min={0} precision={2} placeholder="空=不限" value={pricingSettings.originalMax === '' ? null : pricingSettings.originalMax} onChange={value => setPricingSettings(prev => ({ ...prev, originalMax: value === null ? '' : Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={12} md={4}>
                  <div className="field">
                    <Text type="secondary">主食/套餐固定成本分摊</Text>
                    <InputNumber min={0} precision={2} value={pricingSettings.fixedCostAllocation ?? 0} onChange={value => setPricingSettings(prev => ({ ...prev, fixedCostAllocation: Number(value) || 0 }))} />
                  </div>
                </Col>
                <Col xs={24}>
                  <Space wrap>
                    <Text type="secondary">分类目标利润率</Text>
                    <Tag>普通 {money(state.platformRules.pricingEvaluation.fallbackTargetProfitRate)}%</Tag>
                    <Tag>加料 {money(state.platformRules.pricingEvaluation.addOnTargetProfitRate)}%</Tag>
                    <Tag>主食 {money(state.platformRules.pricingEvaluation.riceBallTargetProfitRate)}%</Tag>
                    <Tag>套餐 {money(state.platformRules.pricingEvaluation.setMealTargetProfitRate)}%</Tag>
                    <Text type="secondary">场景策略</Text>
                    {STAPLE_SCENARIOS.map(scenario => <Tag key={scenario}>{stapleScenarioName(scenario)} {pricingStrategy[scenario].filter(row => row.enabled).length} 档</Tag>)}
                  </Space>
                </Col>
              </Row>
            </Card>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">商品诊断</Text><Title level={3}>{pricingSummary.resultCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">检查商品</Text><Title level={3}>{pricingSummary.comboCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">可用结果</Text><Title level={3}>{pricingSummary.validComboCount}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">异常商品</Text><Title level={3}>{abnormalPricingIssueCount}</Title></Card></Col>
            </Row>
            {pricingEvaluation?.warnings.length ? <Card size="small">{pricingEvaluation.warnings.map(item => <Text key={item} type="warning">{item}</Text>)}</Card> : null}
            <Card size="small">
              <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
                <Input.Search
                  allowClear
                  placeholder="搜索商品、平台、类型、诊断或价格"
                  style={{ width: 320, maxWidth: '100%' }}
                  value={pricingResultSearchText}
                  onChange={event => setPricingResultSearchText(event.target.value)}
                />
                <Text type="secondary">当前显示 {visiblePricingIssues.length} / {pricingIssues.length} 个结果</Text>
              </Space>
            </Card>
            <Table loading={isPricingEvaluationLoading} rowKey="key" size="small" columns={pricingProductColumns} dataSource={visiblePricingIssues} pagination={tablePagination(20)} scroll={{ x: 2240 }} tableLayout="fixed" />
          </Space>
        </Card>

        <Modal
          title={selectedPricingIssue ? `${selectedPricingIssue.platformName} / ${selectedPricingIssue.productName} 定价诊断` : '定价诊断'}
          open={Boolean(selectedPricingIssue)}
          width={960}
          className="cost-analysis-modal"
          style={{ top: 16, paddingBottom: 0 }}
          footer={null}
          onCancel={() => setSelectedPricingProductKey('')}
        >
          {selectedPricingIssue ? (
            <Space direction="vertical" style={{ width: '100%' }} size="middle">
              <Space wrap>
                <Tag color={severityColor(selectedPricingIssue.severity)}>{severityLabel(selectedPricingIssue.severity)}</Tag>
                <Text type="secondary">定价评估只看商品自身的基础成本和目标利润率，活动空间由后续页面继续校验。</Text>
              </Space>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前平台价</Text><Title level={4}>¥{money(selectedPricingIssue.currentPrice)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">含打包费价</Text><Title level={4}>¥{money(selectedPricingIssue.currentOriginalPrice)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">商品成本</Text><Title level={4}>¥{money(selectedPricingIssue.productCost)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">固定成本分摊</Text><Title level={4}>¥{money(selectedPricingIssue.fixedCostAllocation)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">目标利润率</Text><Title level={4}>{rateText(selectedPricingIssue.targetProfitRate)}</Title></Card></Col>
                <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前利润率</Text><Title level={4}>{rateText(selectedPricingIssue.currentProfitRate)}</Title></Card></Col>
              </Row>
              <Card size="small" title="建议">
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Text>{selectedPricingIssue.reasons.join('，')}</Text>
                  <Text type="secondary">目标销售价 = (商品成本 + 适用固定成本分摊) / (1 - 目标利润率)，并按 x.9 尾价向上取整；单点不送商品的适用固定成本分摊为 0。</Text>
                </Space>
              </Card>
              <Row gutter={[12, 12]}>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">目标销售价</Text><Title level={4}>¥{money(selectedPricingIssue.suggestedOriginalPrice)}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">建议平台价</Text><Title level={4}>¥{money(selectedPricingIssue.suggestedPrice)}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">建议调价</Text><Title level={4}>{selectedPricingIssue.suggestedIncrease > 0 ? '+' : ''}¥{money(selectedPricingIssue.suggestedIncrease)}</Title></Card></Col>
                <Col xs={12} md={6}><Card size="small"><Text type="secondary">利润空间</Text><Title level={4}>¥{money(selectedPricingIssue.profitSpace)}</Title></Card></Col>
              </Row>
            </Space>
          ) : null}
        </Modal>
      </div>
    );
  }

  function renderResultsPage() {
    const measurementSummary = activeResultSummary as MeasurementResult['summary'];
    const updateResultPayBandKey = (platform: Platform, key: string) => {
      setSelectedResultPayBandKeyByScenarioPlatform(prev => ({
        ...prev,
        [resultScenario]: {
          ...prev[resultScenario],
          [platform]: key
        }
      }));
    };
    const renderResultPlatformPanel = (view: ResultPlatformView) => {
      const platformOptimizations = lastOptimizations.filter(row => row.platform === view.platform);
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
            onSelectPayBand={key => {
              updateResultPayBandKey(view.platform, key);
              void openResultBandDetail(view.platform, key);
            }}
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
              <Button type="primary" loading={isResultsLoading} onClick={runResults}>生成组合结果</Button>
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
                      <Text type="secondary">饭团最大组合数</Text>
                      <InputNumber min={1} precision={0} value={measurementSettings.stapleMaxCount} onChange={value => setMeasurementSettings(prev => ({ ...prev, stapleMaxCount: Math.max(1, Math.floor(Number(value) || 3)) }))} />
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
                  <Col xs={12} md={4}>
                    <div className="field">
                      <Text type="secondary">支付价区间步长</Text>
                      <InputNumber min={1} precision={0} value={measurementSettings.payBandSize} onChange={value => setMeasurementSettings(prev => ({ ...prev, payBandSize: Number(value) || 5 }))} />
                    </div>
                  </Col>
                  <Col xs={12} md={4}>
                    <div className="field">
                      <Text type="secondary">凑单小吃最多件数</Text>
                      <InputNumber min={0} precision={0} placeholder="空=不限" value={measurementSettings.addOnMaxCount === '' ? null : measurementSettings.addOnMaxCount} onChange={value => setMeasurementSettings(prev => ({ ...prev, addOnMaxCount: value === null ? '' : Math.max(0, Math.floor(Number(value) || 0)) }))} />
                    </div>
                  </Col>
                  <Col xs={12} md={5}>
                    <Checkbox checked={measurementSettings.ignoreOutOfPayRange} onChange={event => setMeasurementSettings(prev => ({ ...prev, ignoreOutOfPayRange: event.target.checked }))}>生成时保留超出支付价组合</Checkbox>
                  </Col>
                  <Col xs={24} md={10}>
                    <div className="field-value">门店原价边界 {calculationRangeText(store)}，饭团最多 {Math.max(1, Math.floor(Number(measurementSettings.stapleMaxCount) || 3))} 份，凑单小吃最多 {measurementSettings.addOnMaxCount === '' ? '不限' : `${Math.max(0, Math.floor(Number(measurementSettings.addOnMaxCount) || 0))} 件`}</div>
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
                          scroll={{ x: 1900 }}
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
                scroll={{ x: 1900 }}
                tableLayout="fixed"
              />
            </Space>
          ) : null}
        </Modal>
      </div>
    );
  }

  function pageContent() {
    if (state.activePage === 'store') return renderStorePage();
    if (state.activePage === 'products') return renderProductsPage();
    if (state.activePage === 'platform') return renderPlatformPage();
    if (state.activePage === 'meituan') return renderActivityPage('meituan');
    if (state.activePage === 'eleme') return renderActivityPage('eleme');
    if (state.activePage === 'cost') return renderCostAnalysisPage();
    if (state.activePage === 'activity-design') return renderActivityDesignPage();
    if (state.activePage === 'pricing') return renderPricingEvaluationPage();
    return renderResultsPage();
  }

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div>
          <h1 className="app-title">外卖门店活动测算工具</h1>
          <p className="app-subtitle">按门店维护商品、平台活动和利润率阶梯，测算组合利润并导出结果。</p>
        </div>
        <Space wrap>
          <Select style={{ width: 220 }} value={state.selectedStoreId} onChange={value => { cancelAllEdits(); mutateState(draft => { draft.selectedStoreId = value; }); clearCalculatedState(); }} options={state.stores.map(item => ({ value: item.id, label: item.name }))} />
          <Button icon={<PlusOutlined />} onClick={addStore}>新增门店</Button>
          <Button icon={<SaveOutlined />} onClick={saveState}>保存设置</Button>
          <Button onClick={loadState}>读取保存</Button>
          <Button icon={<DownloadOutlined />} onClick={() => exportConfigFile(state)}>导出配置</Button>
          <Upload {...uploadProps(importConfig)}><Button icon={<UploadOutlined />}>导入配置</Button></Upload>
          <Button danger icon={<ReloadOutlined />} onClick={resetState}>恢复示例</Button>
        </Space>
      </Header>
      <Layout>
        <Sider width={210} theme="light" breakpoint="lg" collapsedWidth={0}>
          <Menu
            className="side-menu"
            selectedKeys={[state.activePage]}
            onClick={item => {
              if (isPageKey(item.key)) navigatePage(item.key);
            }}
            items={[
              { key: 'store', label: '门店维护' },
              { key: 'products', label: '商品维护' },
              { key: 'platform', label: '平台通用规则' },
              { key: 'meituan', label: '美团活动' },
              { key: 'eleme', label: '饿了么活动' },
              { key: 'cost', label: '成本测算' },
              { key: 'activity-design', label: '活动设计' },
              { key: 'pricing', label: '定价评估' },
              { key: 'results', label: '测算结果' }
            ]}
          />
        </Sider>
        <Content className="app-content">{pageContent()}</Content>
      </Layout>
    </Layout>
  );
}

export default function WaimaiCalculator() {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#d95b18', borderRadius: 8 } }}>
      <AntApp>
        <WaimaiCalculatorInner />
      </AntApp>
    </ConfigProvider>
  );
}
