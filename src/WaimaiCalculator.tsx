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
  DatePicker,
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
  Steps,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
  Upload
} from 'antd';
import type { TableColumnsType, UploadProps } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import {
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  ReloadOutlined,
  SaveOutlined,
  UploadOutlined
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import * as XLSX from 'xlsx';
import { DEFAULT_PAGE_KEY, isPageKey, pageFromPathname, pathForPage, type PageKey } from './pageRoutes';
import { ActivityPage } from './components/activity/ActivityPage';
import { ActivityDiscountTierEditorModal, type ActivityDiscountTierBatchDraft } from './components/modals/ActivityDiscountTierEditorModal';
import { BusinessNoteEditorModal } from './components/modals/BusinessNoteEditorModal';
import { OrderAnalysisPage } from './components/orderAnalysis/OrderAnalysisPage';
import { PlatformPage } from './components/platform/PlatformPage';
import { ProductsPage } from './components/products/ProductsPage';
import { StorePage } from './components/store/StorePage';
import { SystemStrategyPage } from './components/systemStrategy/SystemStrategyPage';
import { summarizePriceBands as summarizeDomainPriceBands } from './domain/core';
import { isCalculationAbortError, runCalculationTask } from './workers/calculationClient';
import type {
  ActivityDesignObjective as RedesignedActivityDesignObjective,
  ActivityCouponBucketSuggestion,
  ActivityCouponChannel,
  ActivityCouponRecommendationMode,
  ActivityCouponRecommendationPolicy,
  ActivityCouponSceneTemplate,
  ActivityCouponTargetUser,
  ActivityCouponThresholdMode,
  ActivityObjectiveTemplate,
  ActivityObjectivePayTarget,
  ActivityObjectiveStrategy,
  ActivityOriginalDiscountTier,
  ActivityStrategySettings,
  ActivityDesignResult as RedesignedActivityDesignResult,
  ActivityBaseComboRow,
  ActivityComboSimulationRow,
  ActivityPriceBucketRow,
  ActivityRecommendationRow,
  ActivityScanComboPools,
  ActivityScanComboPoolRow,
  ComboEvaluationRow,
  MeasurementResult,
  MeasurementSettings,
  PriceBandRow,
  PricingEvaluationResult as RedesignedPricingEvaluationResult,
  PricingProductRow
} from './domain/types';
import { buildActivityRouteKey } from './domain/activity/shared';
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
  findOrderWorkbookHeader,
  normalizeOrderAnalysisState,
  normalizeOrderDetailRecord,
  orderAnalysisExportRows,
  parseOrderWorkbook,
  summarizeOrderProfit,
  summarizeOrderRecords
} from './domain/orderAnalysis';
import type {
  OrderAnalysisPlatformFilter,
  OrderAnalysisState,
  OrderDetailRecord,
  ParsedOrderWorkbook
} from './domain/orderAnalysis';

const AntvLine = dynamic(() => import('@ant-design/charts').then(mod => mod.Line), { ssr: false });
const AntvColumn = dynamic(() => import('@ant-design/charts').then(mod => mod.Column), { ssr: false });
const AntvDualAxes = dynamic(() => import('@ant-design/charts').then(mod => mod.DualAxes), { ssr: false });
const AntvFunnel = dynamic(() => import('@ant-design/charts').then(mod => mod.Funnel), { ssr: false });
const { RangePicker } = DatePicker;

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

type ActivityDesignStage = 'priceScan' | 'routeDesign' | 'payValidation';
type BusinessDataMetricKey = 'actualReceipt' | 'validOrders' | 'exposureUsers' | 'visitRate' | 'orderRate' | 'merchantActivityCost' | 'tradedProductRate' | 'newOrderUsers' | 'oldOrderUsers' | 'newOrderRate' | 'oldOrderRate' | 'repeatRate7d' | 'repeatRate30d' | 'platformRepeatRate';

type BusinessDailyRecord = {
  key: string;
  storeId: string;
  storeName: string;
  platform: Platform;
  platformName: string;
  date: string;
  sourceFileName: string;
  importBatchId: string;
  importedAt: string;
  externalStoreId: string;
  externalStoreName: string;
  grossSales: number;
  actualReceipt: number;
  merchantIncome: number;
  validOrders: number;
  invalidOrders: number;
  averageReceipt: number;
  averageMerchantIncome: number;
  exposureUsers: number;
  visitUsers: number;
  orderUsers: number;
  visitRate: number | null;
  orderRate: number | null;
  customerBreakdownProvided: boolean;
  newExposureUsers: number;
  oldExposureUsers: number;
  newVisitUsers: number;
  oldVisitUsers: number;
  newOrderUsers: number;
  oldOrderUsers: number;
  newVisitRate: number | null;
  oldVisitRate: number | null;
  newOrderRate: number | null;
  oldOrderRate: number | null;
  repeatDataProvided: boolean;
  repeatUsers7d: number;
  repeatRate7d: number | null;
  repeatUsers30d: number;
  repeatRate30d: number | null;
  platformRepeatRate: number | null;
  exposureTimes: number;
  visitTimes: number;
  orderTimes: number;
  merchantActivityCost: number;
  merchantActivityCostWithoutFull: number;
  platformSubsidy: number;
  totalActivitySubsidy: number;
  commission: number;
  deliveryServiceFee: number;
  packageFee: number;
  customerDeliveryFee: number;
  activityOrders: number;
  activityOrderRate: number | null;
  cancelOrders: number;
  merchantCancelOrders: number;
  listedProducts: number;
  tradedProducts: number;
  outOfStockProducts: number;
  activityProducts: number;
  businessHoursText: string;
  warnings: string[];
};

type BusinessDataImportBatch = {
  id: string;
  storeId: string;
  storeName: string;
  platform: Platform;
  platformName: string;
  fileName: string;
  importedAt: string;
  dateStart: string;
  dateEnd: string;
  rowCount: number;
  replacedDates: string[];
  warnings: string[];
};

type BusinessAnalysisNoteKind = 'memo' | 'diagnostic';

type BusinessAnalysisNote = {
  id: string;
  storeId: string;
  kind: BusinessAnalysisNoteKind;
  title: string;
  createdAt: string;
  dateStart: string;
  dateEnd: string;
  platform: Platform | 'all';
  items: string[];
};

type BusinessNoteEditorState = {
  id?: string;
  dateStart: string;
  dateEnd: string;
  platform: Platform | 'all';
  title: string;
  content: string;
};

type BusinessDiagnosticItem = {
  key: string;
  severity: Severity;
  title: string;
  description: string;
  suggestion: string;
  currentText: string;
  baselineText: string;
};

type BusinessDataState = {
  records: BusinessDailyRecord[];
  imports: BusinessDataImportBatch[];
  notes: BusinessAnalysisNote[];
};

type BusinessDataSummary = {
  dateStart: string;
  dateEnd: string;
  dayCount: number;
  platformCount: number;
  grossSales: number;
  actualReceipt: number;
  merchantIncome: number;
  validOrders: number;
  invalidOrders: number;
  exposureUsers: number;
  visitUsers: number;
  orderUsers: number;
  visitRate: number | null;
  orderRate: number | null;
  customerBreakdownProvided: boolean;
  newExposureUsers: number;
  oldExposureUsers: number;
  newVisitUsers: number;
  oldVisitUsers: number;
  newOrderUsers: number;
  oldOrderUsers: number;
  newVisitRate: number | null;
  oldVisitRate: number | null;
  newOrderRate: number | null;
  oldOrderRate: number | null;
  newOrderShare: number | null;
  oldOrderShare: number | null;
  repeatDataProvided: boolean;
  repeatUsers7d: number;
  repeatRate7d: number | null;
  repeatUsers30d: number;
  repeatRate30d: number | null;
  platformRepeatRate: number | null;
  averageReceipt: number;
  merchantActivityCost: number;
  merchantActivityCostWithoutFull: number;
  platformSubsidy: number;
  totalActivitySubsidy: number;
  commission: number;
  deliveryServiceFee: number;
  packageFee: number;
  activityCostRate: number | null;
  merchantCostPerOrder: number | null;
  tradedProductRate: number | null;
};

type BusinessDailyAggregate = BusinessDataSummary & {
  key: string;
  date: string;
};

type BusinessPlatformAggregate = BusinessDataSummary & {
  key: string;
  platform: Platform;
  platformName: string;
};

type BusinessWeekdayCell = BusinessDataSummary & {
  date: string;
  weekdayIndex: number;
};

type BusinessWeekComparisonRow = {
  key: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  platform: Platform;
  platformName: string;
  days: Record<number, BusinessWeekdayCell | undefined>;
  total: BusinessDataSummary;
};

type BusinessFunnelMetricSource = Pick<BusinessDataSummary, 'exposureUsers' | 'visitUsers' | 'orderUsers' | 'validOrders' | 'visitRate' | 'orderRate'>;
type BusinessFunnelChartRow = {
  key: string;
  stage: string;
  value: number;
  valueText: string;
  conversionTitleText: string;
  conversionRateText: string;
  conversionText: string;
  totalConversionText: string;
};

type ParsedBusinessReport = {
  platform: Platform;
  sheetName: string;
  records: Array<Omit<BusinessDailyRecord, 'key' | 'storeId' | 'storeName' | 'sourceFileName' | 'importBatchId' | 'importedAt'>>;
  warnings: string[];
};

type ActivityFullReductionLogSegmentType = '参数' | '生成' | '拒绝' | '退出' | '其他';
type ActivityFullReductionLogSegment = {
  key: string;
  type: ActivityFullReductionLogSegmentType;
  title: string;
  detail: string[];
};

type ActivityDiscountTierEditorScope = 'system' | 'store';
type ActivityDiscountTierEditorState = {
  scope: ActivityDiscountTierEditorScope;
  objective: RedesignedActivityDesignObjective;
  title: string;
  fallback: ActivityOriginalDiscountTier[];
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

type ActivityPriceScanPersistenceMeta = {
  storeId: string;
  generatedAt: string;
  originalMax: number | null;
  bucketCount: number;
  mainComboCount: number;
  addOnComboCount: number;
  mainComboCountByPlatform?: Partial<Record<Platform, number>>;
  addOnComboCountByPlatform?: Partial<Record<Platform, number>>;
};

type PersistedActivityPriceScanRecord = {
  key: string;
  storeId: string;
  storeName: string;
  generatedAt: string;
  signature: string;
  meta: ActivityPriceScanPersistenceMeta;
  scanComboPools: ActivityScanComboPools;
  originalPriceBuckets: ActivityPriceBucketRow[];
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

type ProductDiscountSuggestionSource = 'measurementResult' | 'activityValidation';
type ProductDiscountSuggestionRiskLevel = 'safe' | 'watch' | 'blocked';
type ProductDiscountSuggestionRole = 'main' | 'addOn' | 'mixed';
type ProductDiscountSuggestionAction = 'discount' | 'raisePrice' | 'watch' | 'none';
type ProductDiscountSuggestion = {
  key: string;
  source: ProductDiscountSuggestionSource;
  platform: Platform;
  platformName: string;
  productId: string;
  productName: string;
  category: ProductCategory;
  categoryName: string;
  role: ProductDiscountSuggestionRole;
  actionType: ProductDiscountSuggestionAction;
  actionLabel: string;
  unitPrice: number;
  avgUnitCost: number;
  avgReasonableCost: number;
  reasonablePriceFromCost: number | null;
  avgCostGap: number;
  minCostGap: number | null;
  maxCostGap: number | null;
  avgAllocatedNetPay: number | null;
  discountRate: number;
  discountAmountPerUnit: number;
  itemLimit: number | '';
  affectedComboCount: number;
  opportunityComboCount: number;
  riskComboCount: number;
  avgPaymentGrossRate: number | null;
  medianPaymentGrossRate: number | null;
  avgNetProfitRate: number | null;
  avgProfitSpace: number;
  minProfitAfterDiscount: number | null;
  minNetPayAfterDiscount: number | null;
  minFinalPayAfterDiscount: number | null;
  riskLevel: ProductDiscountSuggestionRiskLevel;
  reason: string;
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
  sceneKey?: string;
  sceneName?: string;
  channel?: ActivityCouponChannel;
  targetUser?: ActivityCouponTargetUser;
  thresholdMode?: ActivityCouponThresholdMode;
  usageSuggestion?: string;
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
  activityDesignSettings: ActivityDesignSettings;
};

type CalculatorState = {
  selectedStoreId: string;
  activePage: PageKey;
  riskSafetyMargin: number;
  activityStrategySettings: ActivityStrategySettings;
  businessData: BusinessDataState;
  orderAnalysis: OrderAnalysisState;
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

type ActivityDesignSettings = ComboRangeSettings & {
  redAddOnSpace: number;
  baseOriginalDiscountRate?: number;
  calculationMode?: 'priceScan' | 'routeDesign' | 'payValidation';
  originalBandsSnapshot?: PriceBandRow[];
  originalPriceBucketsSnapshot?: ActivityPriceBucketRow[];
  scanComboPoolsSnapshot?: ActivityScanComboPools;
  stapleMaxCount?: number;
  addOnMaxCount?: number | '';
  selectedRecommendationKey?: string;
  selectedRecommendationSnapshot?: ActivityRecommendationRow;
  targetProfitRate: number;
  couponProfitDrop: number;
  couponDesignBasis: CouponDesignBasis;
  couponDesignThresholdStep: number;
  couponDesignMaxFullAmount: number | '';
  couponDesignMaxCouponAmount: number | '';
  designMode: ActivityDesignMode;
  objective?: RedesignedActivityDesignObjective;
  useDefaultObjectiveStrategies?: boolean;
  objectivePayTargets?: Partial<Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget>>;
  objectiveStrategies?: Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectiveStrategy>>>;
  objectiveTemplates?: ActivityObjectiveTemplate[];
  couponSceneTemplates?: ActivityCouponSceneTemplate[];
  platformCouponSceneKeys?: Partial<Record<Platform, string[]>>;
  minProfitRate?: number;
  originalBandSize?: number;
  payBandSize?: number;
};

type ActivityDesignPageFilters = ComboRangeSettings;

type PricingEvaluationSettings = ComboRangeSettings & {
  redAddOnSpace: number;
  lowPayMax: number;
  fixedCostAllocation?: number;
};

type ProductSortField = 'name' | 'category' | 'stapleServingCount' | 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
type ProductStatusFilter = 'all' | 'meituanEnabled' | 'meituanDisabled' | 'elemeEnabled' | 'elemeDisabled' | 'nonStandalone' | 'missingCost';
type TableBreakpoint = 'xxxl' | 'xxl' | 'xl' | 'lg' | 'md' | 'sm' | 'xs';

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
const DB_VERSION = 3;
const STATE_STORE = 'states';
const MEASUREMENT_RESULTS_STORE = 'measurement_results';
const ACTIVITY_PRICE_SCANS_STORE = 'activity_price_scans';
const REQUIRED_OBJECT_STORES = [STATE_STORE, MEASUREMENT_RESULTS_STORE, ACTIVITY_PRICE_SCANS_STORE] as const;
const DEFAULT_STATE_KEY = 'default';
const PLATFORMS: Platform[] = ['meituan', 'eleme'];
const PLATFORM_NAMES: Record<Platform, string> = { meituan: '美团', eleme: '饿了么' };
const ACTIVITY_DESIGN_STAGE_LABELS: Record<ActivityDesignStage, string> = {
  priceScan: '原价扫描',
  routeDesign: '活动路线设计',
  payValidation: '支付价核验'
};
type ActivityObjectiveOption = ActivityObjectiveTemplate & {
  value: RedesignedActivityDesignObjective;
  label: string;
};

const DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES: ActivityObjectiveTemplate[] = [
  { key: 'longTerm', enabled: true, name: '店铺稳定', group: 'stable', targetPayLabel: '0-25 稳定主战场', targetPayMin: 0, targetPayMax: 25, description: '满减为主，券少发，用于稳定主要支付区。' },
  { key: 'orderGrowth', enabled: true, name: '拉升单量', group: 'marketing', targetPayLabel: '0-20 拉单成交区', targetPayMin: 0, targetPayMax: 20, description: '满减保守，优惠券和加码主导低客单成交。' },
  { key: 'raiseAov', enabled: true, name: '提高客单价', group: 'marketing', targetPayLabel: '15-25 加购提客单区', targetPayMin: 15, targetPayMax: 25, description: '券门槛卡在加购档位，引导用户补小吃。' },
  { key: 'hotProduct', enabled: true, name: '爆品打造', group: 'marketing', targetPayLabel: '0-18 爆品成交区', targetPayMin: 0, targetPayMax: 18, description: '短期让利换曝光，优先覆盖低支付成交。' },
  { key: 'highMarginConversion', enabled: true, name: '高到手转化', group: 'marketing', targetPayLabel: '10-25 高到手转化区', targetPayMin: 10, targetPayMax: 25, description: '释放到手空间较足的组合，提高成交率。' },
  { key: 'profitRecovery', enabled: true, name: '到手回收', group: 'marketing', targetPayLabel: '15-30 到手回收区', targetPayMin: 15, targetPayMax: 30, description: '收紧优惠，优先提升活动后到手价。' }
];

function activityObjectiveOptionFromTemplate(template: ActivityObjectiveTemplate): ActivityObjectiveOption {
  return {
    ...template,
    value: template.key,
    label: template.name
  };
}

function activityObjectiveOptionsFromTemplates(templates: ActivityObjectiveTemplate[]) {
  return templates.filter(template => template.enabled).map(activityObjectiveOptionFromTemplate);
}

const ACTIVITY_OBJECTIVE_OPTIONS = activityObjectiveOptionsFromTemplates(DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES);
const ACTIVITY_OBJECTIVE_LABELS = ACTIVITY_OBJECTIVE_OPTIONS.reduce<Record<RedesignedActivityDesignObjective, string>>((labels, option) => {
  labels[option.value] = option.label;
  return labels;
}, {} as Record<RedesignedActivityDesignObjective, string>);
const ACTIVITY_FULL_AMOUNT_BASIS_OPTIONS: Array<{ value: ActivityObjectiveStrategy['fullAmountBasis']; label: string }> = [
  { value: 'average', label: '均值' },
  { value: 'p75', label: 'P75' },
  { value: 'min', label: '最小值' },
  { value: 'max', label: '最大值' }
];
const ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS: Array<{ value: ActivityCouponRecommendationMode; label: string }> = [
  { value: 'conservative', label: '保守' },
  { value: 'balanced', label: '平稳' },
  { value: 'aggressive', label: '激进' }
];
const ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS: Record<ActivityCouponRecommendationMode, ActivityCouponRecommendationPolicy> = {
  conservative: {
    mode: 'conservative',
    amountStep: 0.5,
    minCouponAmount: 1,
    nearThresholdGap: 4,
    farThresholdGap: 12,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 0,
    representativeMode: 'lowestThreshold'
  },
  balanced: {
    mode: 'balanced',
    amountStep: 0.5,
    minCouponAmount: 1,
    nearThresholdGap: 5,
    farThresholdGap: 10,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 0.5,
    representativeMode: 'balanced'
  },
  aggressive: {
    mode: 'aggressive',
    amountStep: 0.5,
    minCouponAmount: 1,
    nearThresholdGap: 8,
    farThresholdGap: 12,
    nearAmountMergeTolerance: 0.5,
    farAmountSkipTolerance: 1,
    maxOverBucketSpace: 1,
    representativeMode: 'highestThreshold'
  }
};
const DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES: ActivityCouponSceneTemplate[] = [
  {
    key: 'raiseAov.addOnCritical',
    enabled: true,
    name: '加购引导券',
    priority: 30,
    channel: 'orderReturn',
    targetUser: 'highAov',
    objectiveKeys: ['raiseAov'],
    thresholdMode: 'addOnCritical',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 1,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 8,
    requireBoundarySafe: false,
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'orderGrowth.addOnCritical',
    enabled: true,
    name: '加购引导券',
    priority: 35,
    channel: 'inStore',
    targetUser: 'all',
    objectiveKeys: ['orderGrowth', 'hotProduct'],
    thresholdMode: 'addOnCritical',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 0.4,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 8,
    requireBoundarySafe: false,
    maxOverBucketSpace: 1,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'fullReduction.interleave',
    enabled: true,
    name: '满减补档券',
    priority: 40,
    channel: 'inStore',
    targetUser: 'highFrequency',
    objectiveKeys: [],
    thresholdMode: 'fullReductionInterleave',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 1,
    requireNearFullReduction: true,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 999,
    requireBoundarySafe: false,
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'redTier.highMarginGuide',
    enabled: true,
    name: '高到手补档券',
    priority: 50,
    channel: 'targeted',
    targetUser: 'highAov',
    objectiveKeys: ['highMarginConversion', 'profitRecovery'],
    thresholdMode: 'highMarginGuide',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0,
    couponIndexRatioMax: 1,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: true,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 999,
    requireBoundarySafe: true,
    maxOverBucketSpace: 0,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  },
  {
    key: 'retention.recall',
    enabled: true,
    name: '定向唤回券',
    priority: 60,
    channel: 'targeted',
    targetUser: 'lostCustomer',
    objectiveKeys: ['raiseAov', 'highMarginConversion'],
    thresholdMode: 'retentionRecall',
    thresholdMin: 0,
    thresholdMax: 999,
    amountMin: 1,
    amountMax: 999,
    couponIndexRatioMin: 0.6,
    couponIndexRatioMax: 1,
    requireNearFullReduction: false,
    maxFullReductionDistance: 8,
    requireNearRedTier: false,
    maxRedTierDistance: 8,
    addOnMin: 0,
    addOnMax: 999,
    requireBoundarySafe: false,
    maxOverBucketSpace: 0.5,
    couponBudgetShare: 100,
    maxCouponCount: 6,
    maxCouponAmount: 999
  }
];
const DEFAULT_ACTIVITY_PLATFORM_COUPON_SCENE_KEYS: Partial<Record<Platform, string[]>> = {
  meituan: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(template => template.key),
  eleme: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES.map(template => template.key)
};
const ACTIVITY_OBJECTIVE_TARGET_DEFAULTS: Record<string, {
  targetOffset: number;
  minOffset: number;
  minNetProfitRate: number;
  maxLossShare: number;
  originalDiscountTiers: ActivityOriginalDiscountTier[];
  fullDiscountShare: number;
  couponDiscountShare: number;
  reserveDiscountShare: number;
  fullThresholdWindow: number;
  fullThresholdMinGap: number;
  minFullAmountIncrease: number;
  fullAmountBasis: ActivityObjectiveStrategy['fullAmountBasis'];
  maxFullRuleCount: number;
  minFullHitCount: number;
  minNetPayFloor: number;
  couponScoringMode: ActivityObjectiveStrategy['couponScoringMode'];
}> = {
  longTerm: { targetOffset: 0, minOffset: -12, minNetProfitRate: -5, maxLossShare: 8, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 25 }, { originalMin: 45, originalMax: 60, discountRate: 20 }, { originalMin: 60, originalMax: 999, discountRate: 15 }], fullDiscountShare: 70, couponDiscountShare: 20, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 10, minFullAmountIncrease: 3, fullAmountBasis: 'average', maxFullRuleCount: 6, minFullHitCount: 3, minNetPayFloor: 2, couponScoringMode: 'balanced' },
  orderGrowth: { targetOffset: -10, minOffset: -28, minNetProfitRate: -18, maxLossShare: 22, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 8 }, { originalMin: 30, originalMax: 45, discountRate: 30 }, { originalMin: 45, originalMax: 60, discountRate: 25 }, { originalMin: 60, originalMax: 999, discountRate: 20 }], fullDiscountShare: 30, couponDiscountShare: 60, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 8, minFullAmountIncrease: 2, fullAmountBasis: 'p75', maxFullRuleCount: 6, minFullHitCount: 2, minNetPayFloor: 2, couponScoringMode: 'aggressive' },
  raiseAov: { targetOffset: -5, minOffset: -20, minNetProfitRate: -12, maxLossShare: 14, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 28 }, { originalMin: 45, originalMax: 60, discountRate: 24 }, { originalMin: 60, originalMax: 999, discountRate: 20 }], fullDiscountShare: 35, couponDiscountShare: 55, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 10, minFullAmountIncrease: 3, fullAmountBasis: 'p75', maxFullRuleCount: 6, minFullHitCount: 3, minNetPayFloor: 2, couponScoringMode: 'aggressive' },
  hotProduct: { targetOffset: -16, minOffset: -35, minNetProfitRate: -25, maxLossShare: 30, originalDiscountTiers: [{ originalMin: 0, originalMax: 15, discountRate: 10 }, { originalMin: 25, originalMax: 40, discountRate: 35 }, { originalMin: 40, originalMax: 60, discountRate: 28 }, { originalMin: 60, originalMax: 999, discountRate: 22 }], fullDiscountShare: 20, couponDiscountShare: 70, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 8, minFullAmountIncrease: 2, fullAmountBasis: 'p75', maxFullRuleCount: 6, minFullHitCount: 2, minNetPayFloor: 2, couponScoringMode: 'aggressive' },
  highMarginConversion: { targetOffset: -3, minOffset: -18, minNetProfitRate: -14, maxLossShare: 16, originalDiscountTiers: [{ originalMin: 0, originalMax: 18, discountRate: 0 }, { originalMin: 30, originalMax: 45, discountRate: 26 }, { originalMin: 45, originalMax: 60, discountRate: 22 }, { originalMin: 60, originalMax: 999, discountRate: 18 }], fullDiscountShare: 40, couponDiscountShare: 45, reserveDiscountShare: 15, fullThresholdWindow: 5, fullThresholdMinGap: 10, minFullAmountIncrease: 3, fullAmountBasis: 'average', maxFullRuleCount: 6, minFullHitCount: 3, minNetPayFloor: 2, couponScoringMode: 'balanced' },
  profitRecovery: { targetOffset: 5, minOffset: -8, minNetProfitRate: -2, maxLossShare: 5, originalDiscountTiers: [{ originalMin: 0, originalMax: 20, discountRate: 0 }, { originalMin: 35, originalMax: 55, discountRate: 12 }, { originalMin: 55, originalMax: 999, discountRate: 10 }], fullDiscountShare: 85, couponDiscountShare: 5, reserveDiscountShare: 10, fullThresholdWindow: 5, fullThresholdMinGap: 12, minFullAmountIncrease: 3, fullAmountBasis: 'min', maxFullRuleCount: 6, minFullHitCount: 4, minNetPayFloor: 2, couponScoringMode: 'conservative' }
};

function activityObjectiveTargetDefaults(objective: RedesignedActivityDesignObjective, group: ActivityObjectiveTemplate['group'] = 'marketing') {
  return ACTIVITY_OBJECTIVE_TARGET_DEFAULTS[objective]
    || ACTIVITY_OBJECTIVE_TARGET_DEFAULTS[group === 'stable' ? 'longTerm' : 'orderGrowth'];
}

function defaultActivityObjectivePayTargets(
  baseTargetProfitRate = 35,
  objectiveOptions: ActivityObjectiveOption[] = ACTIVITY_OBJECTIVE_OPTIONS
): Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget> {
  return objectiveOptions.reduce<Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget>>((targets, option) => {
    const defaults = activityObjectiveTargetDefaults(option.value, option.group);
    const targetPayProfitRate = Math.max(-30, Math.min(95, baseTargetProfitRate + defaults.targetOffset));
    targets[option.value] = {
      payMin: option.targetPayMin,
      payMax: option.targetPayMax,
      targetPayProfitRate,
      minPayProfitRate: Math.max(-50, Math.min(targetPayProfitRate, baseTargetProfitRate + defaults.minOffset)),
      minNetProfitRate: defaults.minNetProfitRate,
      maxLossShare: defaults.maxLossShare
    };
    return targets;
  }, {} as Record<RedesignedActivityDesignObjective, ActivityObjectivePayTarget>);
}

const DEFAULT_ACTIVITY_OBJECTIVE_PAY_TARGETS = defaultActivityObjectivePayTargets();

function defaultActivityCouponRecommendationPolicy(mode: ActivityCouponRecommendationMode = 'balanced'): ActivityCouponRecommendationPolicy {
  return { ...ACTIVITY_COUPON_RECOMMENDATION_POLICY_DEFAULTS[mode] };
}

function defaultActivityObjectiveStrategies(
  baseTargetProfitRate = 35,
  objectiveOptions: ActivityObjectiveOption[] = ACTIVITY_OBJECTIVE_OPTIONS
): Record<RedesignedActivityDesignObjective, ActivityObjectiveStrategy> {
  const payTargets = defaultActivityObjectivePayTargets(baseTargetProfitRate, objectiveOptions);
  return objectiveOptions.reduce<Record<RedesignedActivityDesignObjective, ActivityObjectiveStrategy>>((strategies, option) => {
    const defaults = activityObjectiveTargetDefaults(option.value, option.group);
    strategies[option.value] = {
      ...payTargets[option.value],
      originalDiscountTiers: defaults.originalDiscountTiers,
      fullDiscountShare: defaults.fullDiscountShare,
      couponDiscountShare: defaults.couponDiscountShare,
      reserveDiscountShare: defaults.reserveDiscountShare,
      fullThresholdWindow: defaults.fullThresholdWindow,
      fullThresholdMinGap: defaults.fullThresholdMinGap,
      minFullAmountIncrease: defaults.minFullAmountIncrease,
      fullAmountBasis: defaults.fullAmountBasis,
      maxFullRuleCount: defaults.maxFullRuleCount,
      minFullHitCount: defaults.minFullHitCount,
      minNetPayFloor: defaults.minNetPayFloor,
      couponRecommendationPolicy: defaultActivityCouponRecommendationPolicy(defaults.couponScoringMode),
      couponScoringMode: defaults.couponScoringMode
    };
    return strategies;
  }, {} as Record<RedesignedActivityDesignObjective, ActivityObjectiveStrategy>);
}

const DEFAULT_ACTIVITY_STRATEGY_SETTINGS: ActivityStrategySettings = {
  baseOriginalDiscountRate: 50,
  objectiveTemplates: DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES,
  objectiveStrategies: defaultActivityObjectiveStrategies(),
  couponSceneTemplates: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES,
  platformCouponSceneKeys: DEFAULT_ACTIVITY_PLATFORM_COUPON_SCENE_KEYS
};
const STAPLE_SCENARIOS: StapleScenario[] = ['single', 'double', 'multi'];
const ACTIVITY_PAY_MAX_BY_SCENARIO: Record<StapleScenario, number> = { single: 40, double: 80, multi: 150 };
const ACTIVITY_MIN_NET_PAY = 2;
const MEASUREMENT_RESULT_SCENARIO: StapleScenario = 'multi';
const MEASUREMENT_MODEL_VERSION = 'unified-pay-band-v1';
const ACTIVITY_PRICE_SCAN_MODEL_VERSION = 'activity-price-scan-v10';
const MEASUREMENT_DETAIL_ROW_LIMIT = 5000;
const ACTIVITY_DESIGN_RESULT_SCENARIO: StapleScenario = 'multi';
const PRODUCT_DISCOUNT_ITEM_LIMIT = 1;
const PRODUCT_DISCOUNT_MIN_EFFECTIVE_AMOUNT = 0.2;
const PRODUCT_DISCOUNT_SAFE_PROFIT_BUFFER = 0;
const PRODUCT_DISCOUNT_FINAL_PAY_FLOOR = 2;
const ASYNC_CALCULATION_MAX_DURATION_MS = 30000;
const ASYNC_CALCULATION_WORKER_TIMEOUT_MS = 35000;
const ACTIVITY_DESIGN_MAX_DURATION_MS = 1000 * 60 * 5; // 5 minutes
const ACTIVITY_DESIGN_WORKER_TIMEOUT_MS = 1000 * 60 * 4;
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

const DEFAULT_ACTIVITY_DESIGN_SETTINGS: ActivityDesignSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  redAddOnSpace: 0,
  baseOriginalDiscountRate: 50,
  stapleMaxCount: 2,
  addOnMaxCount: 3,
  targetProfitRate: 35,
  couponProfitDrop: 3,
  couponDesignBasis: 'original',
  couponDesignThresholdStep: 5,
  couponDesignMaxFullAmount: '',
  couponDesignMaxCouponAmount: 20,
  designMode: 'auto',
  objective: 'longTerm',
  useDefaultObjectiveStrategies: true,
  objectivePayTargets: DEFAULT_ACTIVITY_OBJECTIVE_PAY_TARGETS,
  objectiveStrategies: DEFAULT_ACTIVITY_STRATEGY_SETTINGS.objectiveStrategies,
  objectiveTemplates: DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES,
  couponSceneTemplates: DEFAULT_ACTIVITY_COUPON_SCENE_TEMPLATES,
  platformCouponSceneKeys: DEFAULT_ACTIVITY_PLATFORM_COUPON_SCENE_KEYS,
  minProfitRate: 0,
  originalBandSize: 5,
  payBandSize: 5
};

const DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS: ActivityDesignPageFilters = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: ''
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
  activityStrategySettings: DEFAULT_ACTIVITY_STRATEGY_SETTINGS,
  businessData: {
    records: [],
    imports: [],
    notes: []
  },
  orderAnalysis: {
    records: [],
    imports: []
  },
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

function couponChannelLabel(value: unknown) {
  return {
    inStore: '店内领券',
    orderReturn: '下单返券',
    reviewReturn: '评价返券',
    pointsReturn: '集点/会员',
    targeted: '定向券'
  }[String(value || '')] || '-';
}

function couponTargetUserLabel(value: unknown) {
  return {
    all: '全部用户',
    newCustomer: '新客',
    highFrequency: '高频老客',
    highAov: '高客单',
    lostCustomer: '流失用户',
    specified: '指定人群'
  }[String(value || '')] || '-';
}

function couponThresholdModeLabel(value: unknown) {
  return {
    lowThresholdOrder: '低门槛拉单',
    fullReductionInterleave: '满减补档',
    addOnCritical: '加购引导',
    highMarginGuide: '神券/爆红包补档',
    retentionRecall: '定向唤回'
  }[String(value || '')] || '-';
}

function activityRepresentedComboCount(row: Pick<ActivityComboSimulationRow, 'representedComboCount'>) {
  if (row.representedComboCount === undefined || row.representedComboCount === null) return 1;
  return Math.max(0, Math.floor(Number(row.representedComboCount) || 0));
}

function activityCostBasisLabel(row: Pick<ActivityComboSimulationRow, 'key' | 'scenarioName' | 'representedComboCount'>) {
  const key = String(row.key || '');
  const scenarioName = String(row.scenarioName || '');
  if (key.endsWith('::maxCost') || scenarioName.includes('最高成本')) return '最高成本';
  if (key.endsWith('::minCost') || scenarioName.includes('最低成本')) return '最低成本';
  if (row.representedComboCount !== undefined && row.representedComboCount !== null) return '平均成本';
  return '真实组合';
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

function activityFullReductionLogType(entry: string): ActivityFullReductionLogSegmentType {
  if (entry.startsWith('参数：')) return '参数';
  if (entry.startsWith('生成满')) return '生成';
  if (entry.startsWith('拒绝')) return '拒绝';
  if (entry.startsWith('退出：')) return '退出';
  return '其他';
}

function activityFullReductionLogTypeColor(type: ActivityFullReductionLogSegmentType) {
  if (type === '参数') return 'blue';
  if (type === '生成') return 'green';
  if (type === '拒绝') return 'orange';
  if (type === '退出') return 'red';
  return 'default';
}

function activityFullReductionLogParts(diagnosis: string | null | undefined) {
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

function paymentGrossRate(row: Pick<ComboEvaluationRow, 'finalPay' | 'cost'>) {
  const finalPay = Number(row.finalPay) || 0;
  if (finalPay <= 0) return null;
  return (finalPay - (Number(row.cost) || 0)) / finalPay;
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

function activityPriceScanRecordKey(storeId: string) {
  return `${storeId}::${ACTIVITY_PRICE_SCAN_MODEL_VERSION}`;
}

function measurementFiniteMax(value: number | '') {
  if (value === '') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? Math.max(0, numberValue) : null;
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

function activityPriceScanSettingsSignatureInput(settings: ActivityDesignSettings) {
  const {
    calculationMode: _calculationMode,
    originalBandsSnapshot: _originalBandsSnapshot,
    originalPriceBucketsSnapshot: _originalPriceBucketsSnapshot,
    scanComboPoolsSnapshot: _scanComboPoolsSnapshot,
    selectedRecommendationKey: _selectedRecommendationKey,
    selectedRecommendationSnapshot: _selectedRecommendationSnapshot,
    targetProfitRate: _targetProfitRate,
    couponProfitDrop: _couponProfitDrop,
    minProfitRate: _minProfitRate,
    objectivePayTargets: _objectivePayTargets,
    ...scanSettings
  } = settings;
  const objectiveStrategies = Object.fromEntries(Object.entries(scanSettings.objectiveStrategies || {}).map(([key, strategy]) => [key, {
    payMin: strategy?.payMin,
    payMax: strategy?.payMax,
    originalDiscountTiers: strategy?.originalDiscountTiers,
    fullDiscountShare: strategy?.fullDiscountShare,
    couponDiscountShare: strategy?.couponDiscountShare,
    reserveDiscountShare: strategy?.reserveDiscountShare,
    fullThresholdWindow: strategy?.fullThresholdWindow,
    fullThresholdMinGap: strategy?.fullThresholdMinGap,
    minFullAmountIncrease: strategy?.minFullAmountIncrease,
    fullAmountBasis: strategy?.fullAmountBasis,
    maxFullRuleCount: strategy?.maxFullRuleCount,
    minFullHitCount: strategy?.minFullHitCount,
    minNetPayFloor: strategy?.minNetPayFloor,
    couponRecommendationPolicy: strategy?.couponRecommendationPolicy,
    couponScoringMode: strategy?.couponScoringMode
  }]));
  return {
    ...scanSettings,
    objectiveStrategies
  };
}

function activityPriceScanStoreSignatureInput(store: Store) {
  return {
    id: store.id,
    startPrice: store.startPrice,
    calculationTotalMax: store.calculationTotalMax,
    stapleCountMin: store.stapleCountMin,
    stapleCountMax: store.stapleCountMax,
    deliveryDistance: store.deliveryDistance,
    maxItems: store.maxItems,
    maxQtyPerSku: store.maxQtyPerSku,
    maxDiscountItems: store.maxDiscountItems,
    maxChecks: store.maxChecks,
    usePlatformFee: store.usePlatformFee,
    customFeeRule: store.customFeeRule,
    activityDesignSettings: activityDesignSettingsFromStore(store),
    discountActivities: {
      meituan: store.activities.meituan.discountActivities,
      eleme: store.activities.eleme.discountActivities
    },
    products: store.products.map(product => ({
      id: product.id,
      name: product.name,
      price: product.price,
      packageFee: product.packageFee,
      meituanPrice: product.meituanPrice,
      elemePrice: product.elemePrice,
      meituanPackageFee: product.meituanPackageFee,
      elemePackageFee: product.elemePackageFee,
      meituanEnabled: product.meituanEnabled,
      elemeEnabled: product.elemeEnabled,
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      nonStandalone: product.nonStandalone
    }))
  };
}

function buildActivityPriceScanSignature(state: CalculatorState, store: Store, settings: ActivityDesignSettings) {
  return stableJsonStringify({
    modelVersion: ACTIVITY_PRICE_SCAN_MODEL_VERSION,
    schemaVersion: 'scan-pools-v1',
    platformRules: state.platformRules,
    store: activityPriceScanStoreSignatureInput(store),
    settings: activityPriceScanSettingsSignatureInput(settings)
  });
}

function activityPriceScanLegacySettingsSignatureInput(settings: ActivityDesignSettings) {
  const {
    calculationMode: _calculationMode,
    originalBandsSnapshot: _originalBandsSnapshot,
    originalPriceBucketsSnapshot: _originalPriceBucketsSnapshot,
    scanComboPoolsSnapshot: _scanComboPoolsSnapshot,
    selectedRecommendationKey: _selectedRecommendationKey,
    selectedRecommendationSnapshot: _selectedRecommendationSnapshot,
    ...scanSettings
  } = settings;
  return scanSettings;
}

function activityPriceScanLegacyStoreSignatureInput(store: Store) {
  return {
    ...activityPriceScanStoreSignatureInput(store),
    usePlatformTargets: store.usePlatformTargets,
    profitTargets: store.profitTargets,
    products: store.products.map(product => ({
      id: product.id,
      name: product.name,
      price: product.price,
      cost: product.cost,
      packageFee: product.packageFee,
      meituanPrice: product.meituanPrice,
      elemePrice: product.elemePrice,
      meituanPackageFee: product.meituanPackageFee,
      elemePackageFee: product.elemePackageFee,
      meituanEnabled: product.meituanEnabled,
      elemeEnabled: product.elemeEnabled,
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      nonStandalone: product.nonStandalone
    }))
  };
}

function buildLegacyActivityPriceScanSignature(state: CalculatorState, store: Store, settings: ActivityDesignSettings) {
  return stableJsonStringify({
    modelVersion: ACTIVITY_PRICE_SCAN_MODEL_VERSION,
    schemaVersion: 'scan-pools-v1',
    riskSafetyMargin: state.riskSafetyMargin,
    platformRules: state.platformRules,
    store: activityPriceScanLegacyStoreSignatureInput(store),
    settings: activityPriceScanLegacySettingsSignatureInput(settings)
  });
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

/**
 * 读取门店级活动设计参数。
 *
 * @param store 当前门店。
 * @returns 已兼容旧门店数据的活动设计参数。
 */
function activityDesignSettingsFromStore(store: Pick<Store, 'activityDesignSettings'>): ActivityDesignSettings {
  return normalizeActivityDesignSettings(store.activityDesignSettings);
}

function effectiveActivityDesignSettingsFromStore(
  store: Pick<Store, 'activityDesignSettings'>,
  strategySettings: ActivityStrategySettings,
  platform?: Platform
): ActivityDesignSettings {
  const base = activityDesignSettingsFromStore(store);
  const rawStoreSettings = store.activityDesignSettings || {};
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

/**
 * 生成活动设计任务使用的参数。
 *
 * @param store 当前门店。
 * @param overrides 任务级临时字段，例如所选活动路线快照。
 * @returns 不包含页面筛选条件的活动设计任务参数。
 */
function buildActivityDesignCalculationSettings(
  store: Store,
  strategySettings: ActivityStrategySettings,
  overrides: Partial<ActivityDesignSettings> = {}
): ActivityDesignSettings {
  const storeRange = calculationTotalRange(store);
  return {
    ...effectiveActivityDesignSettingsFromStore(store, strategySettings),
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

/**
 * 将门店活动设计参数转换为组合测算任务参数。
 *
 * @param store 当前门店。
 * @param filters 测算结果页面的展示筛选条件。
 * @returns 用于生成持久化最大覆盖测算结果的任务参数。
 */
function buildMeasurementSettingsFromActivityDesign(
  store: Store,
  filters: MeasurementSettings
): MeasurementSettings {
  const activitySettings = activityDesignSettingsFromStore(store);
  const stapleMaxCount = Math.max(1, Math.floor(Number(activitySettings.stapleMaxCount) || filters.stapleMaxCount || 3));
  return {
    ...filters,
    stapleMaxCount,
    multiStapleCount: Math.max(stapleMaxCount, Math.floor(Number(filters.multiStapleCount) || stapleMaxCount)),
    addOnMaxCount: activitySettings.addOnMaxCount === ''
      ? ''
      : Math.max(0, Math.floor(Number(activitySettings.addOnMaxCount) || 0)),
    payBandSize: Math.max(1, Math.floor(Number(activitySettings.payBandSize) || filters.payBandSize || 5))
  };
}

function buildMeasurementPersistenceSettings(store: Store, settings: MeasurementSettings): MeasurementSettings {
  const storeRange = calculationTotalRange(store);
  const designBackedSettings = buildMeasurementSettingsFromActivityDesign(store, settings);
  const maxFromStore = Number.isFinite(storeRange.max) ? storeRange.max : settings.originalMax;
  const stapleMaxCount = Math.max(1, Math.floor(Number(designBackedSettings.stapleMaxCount ?? designBackedSettings.multiStapleCount) || 3));
  return {
    ...designBackedSettings,
    originalMin: 0,
    originalMax: maxFromStore,
    stapleMaxCount,
    multiStapleCount: Math.max(stapleMaxCount, Math.floor(Number(designBackedSettings.multiStapleCount) || stapleMaxCount)),
    payMin: 0,
    payMax: '',
    ignoreOutOfPayRange: true
  };
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

function normalizeActivityScanComboPools(value: unknown): ActivityScanComboPools {
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

function activityOriginalScanDetailRowKey(
  bucket: ActivityPriceBucketRow,
  mainCombo: ActivityScanComboPoolRow,
  addOnCombo: ActivityScanComboPoolRow
) {
  return ['activity-original-detail', bucket.key, mainCombo.key, addOnCombo.key].join('::');
}

function mergeActivityScanComboQtys(mainCombo: ActivityScanComboPoolRow, addOnCombo: ActivityScanComboPoolRow) {
  const length = Math.max(mainCombo.qtys.length, addOnCombo.qtys.length);
  return Array.from({ length }, (_, index) => (mainCombo.qtys[index] || 0) + (addOnCombo.qtys[index] || 0));
}

function activityScanScenarioName(scenario: StapleScenario) {
  if (scenario === 'single') return '单人餐';
  if (scenario === 'double') return '双人餐';
  return '多人餐';
}

function buildActivityOriginalScanDetailRow(
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  bucket: ActivityPriceBucketRow,
  mainCombo: ActivityScanComboPoolRow,
  addOnCombo: ActivityScanComboPoolRow,
  originalTotalCents: number,
  key: string
): ActivityBaseComboRow | null {
  const qtys = mergeActivityScanComboQtys(mainCombo, addOnCombo);
  const totals = buildPlatformTotals(store, bucket.platform, qtys);
  if (!totals.items.length) return null;
  const originalTotal = roundMoney(originalTotalCents / 100 || totals.originalTotal);
  const activity = store.activities[bucket.platform];
  const platformFull = bestFullReduction(activity.fullReductions || [], originalTotal);
  const afterPlatformFull = Math.max(0, roundMoney(originalTotal - platformFull.amount));
  const baseRed = bestBaseRed(state, bucket.platform, afterPlatformFull);
  const afterBaseRed = Math.max(0, roundMoney(afterPlatformFull - baseRed.amount));
  const plannedRedAddOn = nonNegativeAmount(settings.redAddOnSpace) > 0
    ? [{ enabled: true, threshold: 0, amount: roundMoney(nonNegativeAmount(settings.redAddOnSpace)) }]
    : [];
  const redAddOn = bestRedAddOn(activity.redAddOns.concat(plannedRedAddOn), afterPlatformFull);
  const redAddAmount = Math.min(nonNegativeAmount(redAddOn.amount), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddAmount));
  const fee = buildFeeSummary(state, store, finalPay);
  const netPay = Math.max(0, roundMoney(finalPay - fee.commission - fee.serviceFee - fee.freightSubsidy));
  const scenario = pricingScenarioForStapleCount(mainCombo.stapleCount);
  const profit = roundMoney(netPay - totals.costTotal);
  const profitRate = profitRateByBasis(profit, finalPay);
  const netProfitRate = profitRateByBasis(profit, netPay);
  const costProfitRate = profitRateByBasis(profit, totals.costTotal);
  const lowNetPay = netPay + 1e-9 < ACTIVITY_MIN_NET_PAY;
  const costRisk = profit < -1e-9;
  const hasRisk = lowNetPay || costRisk;
  return {
    key,
    platform: bucket.platform,
    platformName: bucket.platformName || PLATFORM_NAMES[bucket.platform],
    items: totals.items,
    scenario,
    scenarioName: activityScanScenarioName(scenario),
    originalTotal,
    afterProductDiscount: originalTotal,
    finalPay,
    netPay,
    cost: totals.costTotal,
    activityAmount: roundMoney(Math.max(0, originalTotal - finalPay)),
    commission: fee.commission,
    serviceFee: fee.serviceFee,
    freightSubsidy: fee.freightSubsidy,
    profit,
    profitRate,
    netProfitRate,
    costProfitRate,
    targetPayRate: 0,
    targetNetRate: 0,
    requiredPayRate: 0,
    requiredNetRate: 0,
    profitSpace: profit,
    profitRateGap: null,
    productDiscount: 0,
    full: platformFull,
    coupons: [],
    couponAmount: 0,
    baseRed,
    redAddOn: { ...redAddOn, amount: redAddAmount },
    ignored: false,
    ignoreReason: '',
    risk: {
      hasRisk,
      severity: costRisk ? 'high' : lowNetPay ? 'medium' : 'none',
      severityRank: costRisk ? 3 : lowNetPay ? 2 : 0,
      reasons: [
        ...(lowNetPay ? [`商家到手价低于 ¥${money(ACTIVITY_MIN_NET_PAY)}`] : []),
        ...(costRisk ? ['成本高于商家到手价'] : [])
      ],
      target: null,
      thresholdRate: null,
      rateGap: null,
      netThresholdRate: null,
      netRateGap: null
    },
    baseFinalPay: finalPay,
    baseNetPay: netPay,
    baseProfitRate: profitRate,
    activityTargetObjective: settings.objective || 'longTerm',
    activityTargetObjectiveName: activityObjectiveOptionsFromSettings(settings).find(option => option.value === (settings.objective || 'longTerm'))?.label,
    activityTargetDiscountRate: bucket.avgActivityTargetDiscountRate ?? bucket.weightedAvgActivityTargetDiscountRate ?? undefined,
    activityTargetPay: bucket.avgActivityTargetPay ?? bucket.weightedAvgActivityTargetPay ?? undefined,
    activityTargetDiscountAmount: bucket.avgActivityTargetDiscountAmount ?? bucket.weightedAvgActivityTargetDiscountAmount ?? undefined,
    activityAlreadyDiscountAmount: bucket.avgActivityAlreadyDiscountAmount ?? bucket.weightedAvgActivityAlreadyDiscountAmount ?? roundMoney(Math.max(0, originalTotal - finalPay)),
    activityDesignSpace: bucket.avgActivityDesignSpace ?? bucket.weightedAvgActivityDesignSpace ?? undefined,
    activityNetPayBoundarySpace: bucket.avgActivityNetPayBoundarySpace ?? bucket.weightedAvgActivityNetPayBoundarySpace ?? undefined,
    activitySafeDiscountSpace: bucket.avgActivitySafeDiscountSpace ?? bucket.weightedAvgActivitySafeDiscountSpace ?? undefined,
    activityTargetPayGap: bucket.avgActivityTargetPayGap ?? bucket.weightedAvgActivityTargetPayGap ?? undefined
  };
}

function expandActivityOriginalBucketCombos(
  result: RedesignedActivityDesignResult | null,
  bucket: ActivityPriceBucketRow | null,
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  options: { onlyKeys?: Set<string> } = {}
) {
  const scanComboPools = normalizeActivityScanComboPools(result?.scanComboPools);
  if (!scanComboPools.mainCombos.length || !scanComboPools.addOnCombos.length) return [];
  const mainComboById = new Map(scanComboPools.mainCombos.map(row => [row.key, row]));
  const addOnComboById = new Map(scanComboPools.addOnCombos.map(row => [row.key, row]));
  const emptyAddOnByPlatform = new Map<Platform, ActivityScanComboPoolRow>();
  for (const row of scanComboPools.addOnCombos) {
    if (row.totalQty === 0 && !emptyAddOnByPlatform.has(row.platform)) emptyAddOnByPlatform.set(row.platform, row);
  }
  const buckets = bucket ? [bucket] : (result?.originalPriceBuckets || []);
  const rows: ActivityBaseComboRow[] = [];
  for (const bucketRow of buckets) {
    for (const entry of bucketRow.entries || []) {
      const mainIds = Array.isArray(entry.mainComboIds) ? entry.mainComboIds : [];
      const persistedAddOnIds = Array.isArray(entry.addOnComboIds) ? entry.addOnComboIds : [];
      const addOnIds = persistedAddOnIds.length ? persistedAddOnIds : [emptyAddOnByPlatform.get(bucketRow.platform)?.key || ''];
      for (const mainId of mainIds) {
        const mainCombo = mainComboById.get(mainId);
        if (!mainCombo) continue;
        for (const addOnId of addOnIds) {
          const addOnCombo = addOnComboById.get(addOnId);
          if (!addOnCombo) continue;
          const key = activityOriginalScanDetailRowKey(bucketRow, mainCombo, addOnCombo);
          if (options.onlyKeys && !options.onlyKeys.has(key)) continue;
          const row = buildActivityOriginalScanDetailRow(state, store, settings, bucketRow, mainCombo, addOnCombo, entry.originalTotalCents, key);
          if (row) rows.push(row);
        }
      }
    }
  }
  return rows.sort((a, b) => a.platform.localeCompare(b.platform) || a.originalTotal - b.originalTotal || a.key.localeCompare(b.key));
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

function buildPersistedActivityPriceScanRecord(
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  result: RedesignedActivityDesignResult
): PersistedActivityPriceScanRecord {
  const generatedAt = new Date().toISOString();
  const originalPriceBuckets = Array.isArray(result.originalPriceBuckets) ? result.originalPriceBuckets : [];
  const scanComboPools = normalizeActivityScanComboPools(result.scanComboPools);
  return {
    key: activityPriceScanRecordKey(store.id),
    storeId: store.id,
    storeName: store.name,
    generatedAt,
    signature: buildActivityPriceScanSignature(state, store, settings),
    meta: {
      storeId: store.id,
      generatedAt,
      originalMax: measurementFiniteMax(settings.originalMax),
      bucketCount: originalPriceBuckets.length,
      mainComboCount: scanComboPools.mainCombos.length,
      addOnComboCount: scanComboPools.addOnCombos.length,
      mainComboCountByPlatform: scanComboPools.mainComboCountByPlatform,
      addOnComboCountByPlatform: scanComboPools.addOnComboCountByPlatform
    },
    scanComboPools,
    originalPriceBuckets,
  };
}

function activityPriceScanRecordToResult(record: PersistedActivityPriceScanRecord): RedesignedActivityDesignResult {
  const legacyRecord = record as PersistedActivityPriceScanRecord & {
    originalBands?: PriceBandRow[];
    originalComboRows?: ActivityBaseComboRow[];
    routeSourceRows?: ActivityBaseComboRow[];
    warnings?: string[];
    summary?: RedesignedActivityDesignResult['summary'];
    meta?: ActivityPriceScanPersistenceMeta & { comboRowCount?: number };
  };
  const originalBands = Array.isArray(legacyRecord.originalBands) ? legacyRecord.originalBands : [];
  const originalPriceBuckets = Array.isArray(record.originalPriceBuckets) ? record.originalPriceBuckets : [];
  const scanComboPools = normalizeActivityScanComboPools(record.scanComboPools);
  const comboCount = legacyRecord.meta?.comboRowCount ?? originalPriceBuckets.reduce((sum, row) => sum + row.comboCount, 0);
  return {
    originalBands,
    originalPriceBuckets,
    originalComboRows: [],
    routeSourceRows: [],
    scanComboPools,
    fullRoutes: [],
    couponRoutes: [],
    recommendations: [],
    payBands: [],
    hitRows: [],
    comboRows: [],
    warnings: Array.isArray(legacyRecord.warnings) ? legacyRecord.warnings : [],
    summary: legacyRecord.summary || {
      resultCount: originalPriceBuckets.length,
      comboCount,
      validComboCount: comboCount,
      elapsedTime: null
    }
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
  const validationPriceBucketPlatforms = new Set((validation.originalPriceBuckets || []).map(row => row.platform));
  const originalPriceBuckets = validation.originalPriceBuckets?.length
    ? [
      ...(current.originalPriceBuckets || []).filter(row => !validationPriceBucketPlatforms.has(row.platform)),
      ...validation.originalPriceBuckets
    ]
    : current.originalPriceBuckets;
  const validationComboPlatforms = new Set((validation.originalComboRows || []).map(row => row.platform));
  const originalComboRows = validation.originalComboRows?.length
    ? [
      ...(current.originalComboRows || []).filter(row => !validationComboPlatforms.has(row.platform)),
      ...validation.originalComboRows
    ]
    : current.originalComboRows;
  const validationRouteSourcePlatforms = new Set((validation.routeSourceRows || []).map(row => row.platform));
  const routeSourceRows = validation.routeSourceRows?.length
    ? [
      ...(current.routeSourceRows || []).filter(row => !validationRouteSourcePlatforms.has(row.platform)),
      ...validation.routeSourceRows
    ]
    : current.routeSourceRows;
  return {
    ...current,
    originalBands,
    originalPriceBuckets,
    originalComboRows,
    routeSourceRows,
    fullRoutes: current.fullRoutes,
    couponRoutes: current.couponRoutes,
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

function activityPriceBucketSuggestionText(row: ActivityPriceBucketRow) {
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
}

function activityPriceBandSuggestionText(row: PriceBandRow) {
  if (row.ignoredCount > 0) return `有 ${row.ignoredCount} 个组合低于到手底线，已在活动核验中忽略`;
  if (row.riskCount > 0) return '存在到手边界风险组合，需查看明细';
  if (row.avgNetPay + 1e-9 < ACTIVITY_MIN_NET_PAY) return `平均到手价低于 ¥${money(ACTIVITY_MIN_NET_PAY)}，需收紧优惠`;
  if (row.avgFinalPay > 30) return '平均支付价偏高，路线未覆盖主要支付场景';
  if (row.avgFinalPay <= 25) return '已落入主要支付场景，可继续确认桶级让利空间';
  return '支付价结构正常';
}

function productDiscountSourceName(source: ProductDiscountSuggestionSource) {
  if (source === 'activityValidation') return '支付价核验';
  return '测算结果';
}

function productDiscountRiskLabel(level: ProductDiscountSuggestionRiskLevel) {
  if (level === 'safe') return '可执行';
  if (level === 'watch') return '需复核';
  return '需调价';
}

function productDiscountRiskColor(level: ProductDiscountSuggestionRiskLevel) {
  if (level === 'safe') return 'green';
  if (level === 'watch') return 'orange';
  return 'red';
}

function productDiscountRoleLabel(role: ProductDiscountSuggestionRole) {
  if (role === 'main') return '主商品';
  if (role === 'addOn') return '凑单品';
  return '混合';
}

function productDiscountActionLabel(action: ProductDiscountSuggestionAction) {
  if (action === 'discount') return '可降价';
  if (action === 'raisePrice') return '需涨价/规避';
  if (action === 'watch') return '检查凑单风险';
  return '无需处理';
}

function finiteRate(value: number | null | undefined): value is number {
  return Number.isFinite(value);
}

function uniqueComboRows<T extends ComboEvaluationRow>(rows: T[]) {
  const map = new Map<string, T>();
  rows.forEach((row, index) => {
    const key = row.key || `${row.platform}-${index}-${itemsText(row.items)}`;
    if (!map.has(key)) map.set(key, row);
  });
  return Array.from(map.values());
}

function productDiscountEligibleQty(row: ComboEvaluationRow, productId: string, itemLimit: number | '') {
  let qty = 0;
  for (const item of row.items) {
    if (item.productId !== productId) continue;
    qty += Math.max(0, Number(item.qty) || 0);
  }
  if (qty <= 0) return 0;
  if (itemLimit === '') return qty;
  return Math.min(qty, Math.max(0, Number(itemLimit) || 0));
}

function productUnitPriceInRows(rows: ComboEvaluationRow[], productId: string) {
  let maxPrice = 0;
  for (const row of rows) {
    for (const item of row.items) {
      if (item.productId !== productId) continue;
      const price = Number(item.price) || 0;
      if (price > maxPrice) maxPrice = price;
    }
  }
  return maxPrice;
}

function discountRateFromAmount(unitPrice: number, discountAmount: number) {
  if (unitPrice <= 0 || discountAmount <= 0) return 10;
  const rawRate = (1 - Math.min(discountAmount, unitPrice) / unitPrice) * 10;
  return clamp(Math.ceil(rawRate * 10 - 1e-9) / 10, 1, 9.9);
}

function discountAmountFromRate(unitPrice: number, discountRate: number) {
  return roundMoney(unitPrice * (1 - normalizeDiscountRate(discountRate)));
}

function normalizedTargetProfitRate(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const normalized = n > 1 ? n / 100 : n;
  return clamp(normalized, 0, 0.95);
}

function comboReasonableCostLimit(row: ComboEvaluationRow) {
  const candidates: number[] = [];
  const cost = Math.max(0, Number(row.cost) || 0);
  const netPay = Math.max(0, Number(row.netPay) || 0);
  const finalPay = Math.max(0, Number(row.finalPay) || 0);
  const profitSpace = Number(row.profitSpace);
  if (Number.isFinite(profitSpace)) {
    candidates.push(cost + profitSpace);
  }
  const targetNetRate = normalizedTargetProfitRate(row.targetNetRate);
  if (targetNetRate !== null && netPay > 0) {
    candidates.push(netPay * (1 - targetNetRate));
  }
  const targetPayRate = normalizedTargetProfitRate(row.targetPayRate);
  if (targetPayRate !== null && netPay > 0 && finalPay > 0) {
    candidates.push(netPay - finalPay * targetPayRate);
  }
  if (!candidates.length && netPay > 0) candidates.push(netPay);
  const finiteCandidates = candidates.filter(Number.isFinite);
  if (!finiteCandidates.length) return null;
  return roundMoney(Math.max(0, Math.min(...finiteCandidates)));
}

function comboItemUnitCost(item: ComboItem) {
  return Math.max(0, Number(item.cost) || 0);
}

function isAddOnDiscountItem(item: ComboItem) {
  return Boolean(item.nonStandalone)
    || item.category === 'snackDrink'
    || item.category === 'addOn';
}

function buildProductDiscountSuggestions(
  rows: ComboEvaluationRow[],
  options: {
    source?: ProductDiscountSuggestionSource;
    focusRowKey?: string;
    productId?: string;
    limit?: number;
    includeBlocked?: boolean;
    includeNeutral?: boolean;
    itemLimit?: number | '';
  } = {}
): ProductDiscountSuggestion[] {
  const source = options.source || 'measurementResult';
  const itemLimit = options.itemLimit ?? PRODUCT_DISCOUNT_ITEM_LIMIT;
  const baseRows = uniqueComboRows(rows)
    .filter(row => !row.ignored)
    .filter(row => row.items.length && row.finalPay > 0 && row.netPay > 0);
  if (!baseRows.length) return [];

  const paymentRates = baseRows.map(paymentGrossRate).filter(finiteRate);
  const medianPaymentRate = median(paymentRates);
  type ProductCostAccumulator = {
    productId: string;
    productName: string;
    platform: Platform;
    platformName: string;
    category: ProductCategory;
    roleCounts: Record<ProductDiscountSuggestionRole, number>;
    rowKeys: Set<string>;
    opportunityRowKeys: Set<string>;
    riskRowKeys: Set<string>;
    qtySum: number;
    unitPriceSum: number;
    unitCostSum: number;
    reasonableCostSum: number;
    costGapSum: number;
    allocatedNetPaySum: number;
    allocatedNetPayQty: number;
    profitSpaceSum: number;
    paymentRates: number[];
    netProfitRates: number[];
    minCostGap: number | null;
    maxCostGap: number | null;
  };
  const candidates = new Map<string, ProductCostAccumulator>();
  const analysisRows = options.focusRowKey
    ? baseRows.filter(row => row.key === options.focusRowKey)
    : baseRows;

  const ensureCandidate = (row: ComboEvaluationRow, item: ComboItem, role: ProductDiscountSuggestionRole) => {
    const current = candidates.get(item.productId) || {
      productId: item.productId,
      productName: item.name,
      platform: row.platform,
      platformName: row.platformName,
      category: item.category,
      roleCounts: { main: 0, addOn: 0, mixed: 0 },
      rowKeys: new Set<string>(),
      opportunityRowKeys: new Set<string>(),
      riskRowKeys: new Set<string>(),
      qtySum: 0,
      unitPriceSum: 0,
      unitCostSum: 0,
      reasonableCostSum: 0,
      costGapSum: 0,
      allocatedNetPaySum: 0,
      allocatedNetPayQty: 0,
      profitSpaceSum: 0,
      paymentRates: [],
      netProfitRates: [],
      minCostGap: null,
      maxCostGap: null
    };
    current.roleCounts[role] += 1;
    candidates.set(item.productId, current);
    return current;
  };

  const addContribution = (
    row: ComboEvaluationRow,
    item: ComboItem,
    role: ProductDiscountSuggestionRole,
    reasonableCostPerUnit: number,
    allocatedNetPayPerUnit: number | null
  ) => {
    if (options.productId && item.productId !== options.productId) return;
    const qty = Math.max(0, Number(item.qty) || 0);
    const unitPrice = Math.max(0, Number(item.price) || 0);
    if (qty <= 0 || unitPrice <= 0) return;
    const current = ensureCandidate(row, item, role);
    const unitCost = comboItemUnitCost(item);
    const costGap = roundMoney(reasonableCostPerUnit - unitCost);
    current.rowKeys.add(row.key);
    if (costGap >= 1) current.opportunityRowKeys.add(row.key);
    if (costGap < -0.5) current.riskRowKeys.add(row.key);
    current.qtySum += qty;
    current.unitPriceSum += unitPrice * qty;
    current.unitCostSum += unitCost * qty;
    current.reasonableCostSum += Math.max(0, reasonableCostPerUnit) * qty;
    current.costGapSum += costGap * qty;
    current.profitSpaceSum += (Number.isFinite(Number(row.profitSpace)) ? Number(row.profitSpace) : 0) * qty;
    if (allocatedNetPayPerUnit !== null) {
      current.allocatedNetPaySum += allocatedNetPayPerUnit * qty;
      current.allocatedNetPayQty += qty;
    }
    const paymentRate = paymentGrossRate(row);
    if (paymentRate !== null) current.paymentRates.push(paymentRate);
    if (finiteRate(row.netProfitRate)) current.netProfitRates.push(row.netProfitRate);
    current.minCostGap = current.minCostGap === null ? costGap : Math.min(current.minCostGap, costGap);
    current.maxCostGap = current.maxCostGap === null ? costGap : Math.max(current.maxCostGap, costGap);
  };

  for (const row of analysisRows) {
    const reasonableCostLimit = comboReasonableCostLimit(row);
    if (reasonableCostLimit === null) continue;
    const items = row.items.filter(item => Math.max(0, Number(item.qty) || 0) > 0 && Math.max(0, Number(item.price) || 0) > 0);
    if (!items.length) continue;
    const totalOriginal = Math.max(
      Number(row.originalTotal) || 0,
      items.reduce((sum, item) => sum + comboItemOriginalAmount(item), 0)
    );
    if (totalOriginal <= 0) continue;
    const addOnItems = items.filter(isAddOnDiscountItem);
    const mainItems = items.filter(item => !isAddOnDiscountItem(item));
    const mainOriginal = mainItems.reduce((sum, item) => sum + comboItemOriginalAmount(item), 0);
    const addOnCost = addOnItems.reduce((sum, item) => sum + comboItemUnitCost(item) * Math.max(0, Number(item.qty) || 0), 0);
    const mainReasonableCost = Math.max(0, reasonableCostLimit - addOnCost);

    for (const item of addOnItems) {
      const qty = Math.max(0, Number(item.qty) || 0);
      const allocatedNetPayPerUnit = qty > 0
        ? (row.netPay * (comboItemOriginalAmount(item) / totalOriginal)) / qty
        : 0;
      addContribution(row, item, 'addOn', allocatedNetPayPerUnit, allocatedNetPayPerUnit);
    }

    for (const item of mainItems) {
      const qty = Math.max(0, Number(item.qty) || 0);
      const reasonableCostPerUnit = qty > 0 && mainOriginal > 0
        ? (mainReasonableCost * (comboItemOriginalAmount(item) / mainOriginal)) / qty
        : 0;
      addContribution(row, item, 'main', reasonableCostPerUnit, null);
    }

    if (!mainItems.length && !addOnItems.length) {
      for (const item of items) {
        const qty = Math.max(0, Number(item.qty) || 0);
        const reasonableCostPerUnit = qty > 0
          ? (reasonableCostLimit * (comboItemOriginalAmount(item) / totalOriginal)) / qty
          : 0;
        addContribution(row, item, 'main', reasonableCostPerUnit, null);
      }
    }
  }

  const suggestions = Array.from(candidates.values()).map<ProductDiscountSuggestion | null>(candidate => {
    if (candidate.qtySum <= 0) return null;
    const affectedRows = baseRows.filter(row => row.platform === candidate.platform && row.items.some(item => item.productId === candidate.productId));
    const affectedRowsWithQty = affectedRows
      .map(row => ({ row, qty: productDiscountEligibleQty(row, candidate.productId, itemLimit) }))
      .filter(item => item.qty > 0);
    const unitPrice = candidate.unitPriceSum / candidate.qtySum || productUnitPriceInRows(affectedRows, candidate.productId);
    if (unitPrice <= 0) return null;

    const avgUnitCost = candidate.unitCostSum / candidate.qtySum;
    const avgReasonableCost = candidate.reasonableCostSum / candidate.qtySum;
    const avgCostGap = candidate.costGapSum / candidate.qtySum;
    const avgProfitSpace = candidate.profitSpaceSum / candidate.qtySum;
    const avgAllocatedNetPay = candidate.allocatedNetPayQty > 0
      ? candidate.allocatedNetPaySum / candidate.allocatedNetPayQty
      : null;
    const role: ProductDiscountSuggestionRole = candidate.roleCounts.main > 0 && candidate.roleCounts.addOn > 0
      ? 'mixed'
      : candidate.roleCounts.addOn > 0
        ? 'addOn'
        : 'main';
    const gapForDiscount = roundMoney(Math.max(0, avgCostGap));
    const canDiscount = role !== 'addOn' && gapForDiscount >= 1;
    const hasCostRisk = candidate.riskRowKeys.size > 0 || avgCostGap < -0.5;
    const actionType: ProductDiscountSuggestionAction = canDiscount
      ? 'discount'
      : hasCostRisk
        ? (role === 'addOn' ? 'watch' : 'raisePrice')
        : 'none';
    const riskLevel: ProductDiscountSuggestionRiskLevel = actionType === 'raisePrice'
      ? 'blocked'
      : actionType === 'watch' || (actionType === 'discount' && candidate.riskRowKeys.size > 0)
        ? 'watch'
        : 'safe';
    const cappedAmount = actionType === 'discount'
      ? Math.min(gapForDiscount, unitPrice * 0.25, 5)
      : 0;
    const discountRate = cappedAmount >= 1
      ? discountRateFromAmount(unitPrice, cappedAmount)
      : 10;
    const discountAmountPerUnit = cappedAmount >= 1
      ? discountAmountFromRate(unitPrice, discountRate)
      : 0;

    const afterRows = actionType === 'discount'
      ? affectedRowsWithQty.map(({ row, qty }) => {
        const discountAmount = discountAmountPerUnit * qty;
        return {
          profit: roundMoney(row.profit - discountAmount),
          netPay: roundMoney(row.netPay - discountAmount),
          finalPay: roundMoney(row.finalPay - discountAmount)
        };
      })
      : [];
    const minProfitAfterDiscount = afterRows.length ? Math.min(...afterRows.map(row => row.profit)) : null;
    const minNetPayAfterDiscount = afterRows.length ? Math.min(...afterRows.map(row => row.netPay)) : null;
    const minFinalPayAfterDiscount = afterRows.length ? Math.min(...afterRows.map(row => row.finalPay)) : null;
    const finalRiskLevel: ProductDiscountSuggestionRiskLevel = actionType === 'discount' && (
      (minProfitAfterDiscount ?? 0) + 1e-9 < PRODUCT_DISCOUNT_SAFE_PROFIT_BUFFER ||
      (minNetPayAfterDiscount ?? 0) + 1e-9 < ACTIVITY_MIN_NET_PAY ||
      (minFinalPayAfterDiscount ?? 0) + 1e-9 < PRODUCT_DISCOUNT_FINAL_PAY_FLOOR
    )
      ? 'watch'
      : riskLevel;
    const actionLabel = productDiscountActionLabel(actionType);
    const roleLabel = productDiscountRoleLabel(role);
    const reason = actionType === 'discount'
      ? `${productDiscountSourceName(source)}按商品维度反推活动合理成本：${roleLabel}当前成本 ¥${money(avgUnitCost)}，活动合理成本 ¥${money(avgReasonableCost)}，单件空间 ¥${money(avgCostGap)}；建议按商品维度给 ¥${money(discountAmountPerUnit)} 左右折扣。`
      : actionType === 'raisePrice'
        ? `${productDiscountSourceName(source)}按商品维度反推活动合理成本：当前成本 ¥${money(avgUnitCost)} 高于活动合理成本 ¥${money(avgReasonableCost)}，平均缺口 ¥${money(Math.abs(avgCostGap))}；不建议继续做商品折扣，优先涨价、收紧活动或排除该商品。`
        : actionType === 'watch'
          ? `${productDiscountSourceName(source)}按凑单品分摊到手校验：分摊到手均值 ¥${money(avgAllocatedNetPay ?? avgReasonableCost)}，当前成本 ¥${money(avgUnitCost)}，有 ${candidate.riskRowKeys.size} 个组合可能打穿，建议查看具体亏损组合。`
          : `${productDiscountSourceName(source)}按商品维度反推活动合理成本：当前成本 ¥${money(avgUnitCost)}，活动合理成本 ¥${money(avgReasonableCost)}，合理空间 ¥${money(avgCostGap)}；暂不需要商品折扣或调价处理。`;
    const suggestion: ProductDiscountSuggestion = {
      key: `${source}-${candidate.platform}-${candidate.productId}-${actionType}`,
      source,
      platform: candidate.platform,
      platformName: candidate.platformName,
      productId: candidate.productId,
      productName: candidate.productName,
      category: candidate.category,
      categoryName: productCategoryName(candidate.category),
      role,
      actionType,
      actionLabel,
      unitPrice: roundMoney(unitPrice),
      avgUnitCost: roundMoney(avgUnitCost),
      avgReasonableCost: roundMoney(avgReasonableCost),
      reasonablePriceFromCost: avgReasonableCost > 1e-9 ? roundMoney(unitPrice * (avgUnitCost / avgReasonableCost)) : null,
      avgCostGap: roundMoney(avgCostGap),
      minCostGap: candidate.minCostGap,
      maxCostGap: candidate.maxCostGap,
      avgAllocatedNetPay: avgAllocatedNetPay === null ? null : roundMoney(avgAllocatedNetPay),
      discountRate,
      discountAmountPerUnit,
      itemLimit,
      affectedComboCount: candidate.rowKeys.size,
      opportunityComboCount: candidate.opportunityRowKeys.size,
      riskComboCount: candidate.riskRowKeys.size,
      avgPaymentGrossRate: average(candidate.paymentRates),
      medianPaymentGrossRate: medianPaymentRate,
      avgNetProfitRate: average(candidate.netProfitRates),
      avgProfitSpace: roundMoney(avgProfitSpace),
      minProfitAfterDiscount,
      minNetPayAfterDiscount,
      minFinalPayAfterDiscount,
      riskLevel: finalRiskLevel,
      reason
    };
    return suggestion;
  }).filter((item): item is ProductDiscountSuggestion => Boolean(item));

  return suggestions
    .filter(item => options.includeBlocked !== false || item.riskLevel !== 'blocked')
    .filter(item => options.includeNeutral || options.productId || item.actionType !== 'none')
    .sort((a, b) => {
      const actionOrder: Record<ProductDiscountSuggestionAction, number> = { raisePrice: 0, discount: 1, watch: 2, none: 3 };
      return actionOrder[a.actionType] - actionOrder[b.actionType]
        || b.riskComboCount - a.riskComboCount
        || b.opportunityComboCount - a.opportunityComboCount
        || b.affectedComboCount - a.affectedComboCount
        || Math.abs(b.avgCostGap) - Math.abs(a.avgCostGap)
        || a.discountRate - b.discountRate;
    })
    .slice(0, options.limit ?? 50);
}

/**
 * 生成完整活动路线快照。
 *
 * @param platform 平台。
 * @param fullRoute 选中的满减底盘路线。
 * @param couponRoute 选中的经营目标券路线。
 * @param settings 门店级活动设计参数，提供神券/爆红包加码空间。
 * @param options 路线展示与核验使用的经营目标信息。
 * @returns 可直接传入支付价核验任务的完整活动路线；无有效活动规则时返回 null。
 */
function buildManualActivityRouteSnapshot(
  platform: Platform,
  fullRoute: ActivityRecommendationRow | null,
  couponRoute: ActivityRecommendationRow | null,
  settings: ActivityDesignSettings,
  options: {
    objective?: RedesignedActivityDesignObjective;
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
  const objectiveOption = activityObjectiveOptionsFromSettings(settings).find(item => item.value === objective);
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
  objective: RedesignedActivityDesignObjective,
  limit = 1
) {
  return routes
    .filter(row => row.objective === objective)
    .slice()
    .sort((a, b) => a.score - b.score || b.hitCount - a.hitCount)
    .slice(0, limit);
}

/**
 * 基于满减候选和优惠券候选生成兼容路线库。
 *
 * @param platform 平台。
 * @param fullRoutes 满减候选路线。
 * @param couponRoutes 优惠券候选路线。
 * @param settings 门店级活动设计参数。
 * @returns 去重后的完整路线，包含店铺稳定路线和经营目标路线。
 */
function buildActivityRoutePackages(
  platform: Platform,
  fullRoutes: ActivityRecommendationRow[],
  couponRoutes: ActivityRecommendationRow[],
  settings: ActivityDesignSettings
) {
  const packages = new Map<string, ActivityRecommendationRow>();
  const objectiveOptions = activityObjectiveOptionsFromSettings(settings);
  const stableObjective = objectiveOptions.find(option => option.group === 'stable')?.value || 'longTerm';
  const stableFullRoutes = bestActivityRoute(fullRoutes, stableObjective, 2);
  const stableCouponRoutes = bestActivityRoute(couponRoutes, stableObjective, 1);
  const fallbackStableFull = stableFullRoutes[0] || bestActivityRoute(fullRoutes, settings.objective || stableObjective, 1)[0] || fullRoutes[0] || null;

  objectiveOptions.forEach(option => {
    const targetPayLabel = activityObjectivePayTargetLabel(settings, option.value);
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
      const snapshot = buildManualActivityRouteSnapshot(platform, fullRoute, couponRoute, settings, {
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

function normalizeActivityObjectiveTemplate(
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

function normalizeActivityObjectiveTemplates(value: unknown): ActivityObjectiveTemplate[] {
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

function activityObjectiveOptionsFromSettings(settings: Pick<ActivityStrategySettings | ActivityDesignSettings, 'objectiveTemplates' | 'objectiveStrategies'> | undefined) {
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

function formatActivityOriginalDiscountTiers(tiers: ActivityOriginalDiscountTier[]) {
  const text = tiers
    .map(tier => `${money(tier.originalMin)}-${tier.originalMax >= 999 ? '∞' : money(tier.originalMax)}:${money(tier.discountRate)}%`)
    .join('，');
  return text || '无覆盖，全部按基准';
}

function normalizeActivityObjectiveStrategies(
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

function normalizeActivityStrategySettings(value: Partial<ActivityStrategySettings> | undefined): ActivityStrategySettings {
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

function activityObjectivePayTargetLabel(
  settings: ActivityDesignSettings,
  objective: RedesignedActivityDesignObjective
) {
  const option = activityObjectiveOptionsFromSettings(settings).find(item => item.value === objective);
  return `${option?.label || objective}活动空间规则`;
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
function normalizeActivityDesignSettings(settings: Partial<ActivityDesignSettings> | undefined): ActivityDesignSettings {
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

function normalizeBusinessDate(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const dateMatch = text.match(/^(\d{4})[-/.年]?(\d{1,2})[-/.月]?(\d{1,2})/);
  if (dateMatch) {
    const [, year, month, day] = dateMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const compactMatch = text.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    return `${year}-${month}-${day}`;
  }
  const numberValue = Number(value);
  if (Number.isFinite(numberValue) && numberValue > 25000 && numberValue < 80000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    epoch.setUTCDate(epoch.getUTCDate() + Math.floor(numberValue));
    return epoch.toISOString().slice(0, 10);
  }
  return '';
}

function normalizeBusinessRate(value: unknown, fallback: number | null = null) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return fallback;
  const parsed = toNumber(text.replace('%', ''), Number.NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return text.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

function normalizeBusinessDailyRecord(row: Partial<BusinessDailyRecord> | undefined): BusinessDailyRecord | null {
  const platform = row?.platform === 'eleme' ? 'eleme' : row?.platform === 'meituan' ? 'meituan' : null;
  const date = normalizeBusinessDate(row?.date);
  if (!platform || !date) return null;
  const actualReceipt = Math.max(0, toMoneyNumber(row?.actualReceipt, 0));
  const validOrders = Math.max(0, Math.floor(toNumber(row?.validOrders, 0)));
  const exposureUsers = Math.max(0, Math.floor(toNumber(row?.exposureUsers, 0)));
  const visitUsers = Math.max(0, Math.floor(toNumber(row?.visitUsers, 0)));
  const orderUsers = Math.max(0, Math.floor(toNumber(row?.orderUsers, 0)));
  const hasBusinessField = (field: keyof BusinessDailyRecord) => row?.[field] !== undefined && row?.[field] !== null;
  const customerBreakdownProvided = Boolean(row?.customerBreakdownProvided) || ([
    'newExposureUsers',
    'oldExposureUsers',
    'newVisitUsers',
    'oldVisitUsers',
    'newOrderUsers',
    'oldOrderUsers',
    'newVisitRate',
    'oldVisitRate',
    'newOrderRate',
    'oldOrderRate'
  ] as Array<keyof BusinessDailyRecord>).some(hasBusinessField);
  const newExposureUsers = customerBreakdownProvided ? Math.max(0, Math.floor(toNumber(row?.newExposureUsers, 0))) : 0;
  const oldExposureUsers = customerBreakdownProvided ? Math.max(0, Math.floor(toNumber(row?.oldExposureUsers, 0))) : 0;
  const newVisitUsers = customerBreakdownProvided ? Math.max(0, Math.floor(toNumber(row?.newVisitUsers, 0))) : 0;
  const oldVisitUsers = customerBreakdownProvided ? Math.max(0, Math.floor(toNumber(row?.oldVisitUsers, 0))) : 0;
  const newOrderUsers = customerBreakdownProvided ? Math.max(0, Math.floor(toNumber(row?.newOrderUsers, 0))) : 0;
  const oldOrderUsers = customerBreakdownProvided ? Math.max(0, Math.floor(toNumber(row?.oldOrderUsers, 0))) : 0;
  const visitRate = row?.visitRate === null || row?.visitRate === undefined
    ? exposureUsers > 0 ? visitUsers / exposureUsers : null
    : normalizeBusinessRate(row.visitRate);
  const orderRate = row?.orderRate === null || row?.orderRate === undefined
    ? visitUsers > 0 ? orderUsers / visitUsers : null
    : normalizeBusinessRate(row.orderRate);
  const newVisitRate = customerBreakdownProvided
    ? row?.newVisitRate === null || row?.newVisitRate === undefined
      ? newExposureUsers > 0 ? newVisitUsers / newExposureUsers : null
      : normalizeBusinessRate(row.newVisitRate)
    : null;
  const oldVisitRate = customerBreakdownProvided
    ? row?.oldVisitRate === null || row?.oldVisitRate === undefined
      ? oldExposureUsers > 0 ? oldVisitUsers / oldExposureUsers : null
      : normalizeBusinessRate(row.oldVisitRate)
    : null;
  const newOrderRate = customerBreakdownProvided
    ? row?.newOrderRate === null || row?.newOrderRate === undefined
      ? newVisitUsers > 0 ? newOrderUsers / newVisitUsers : null
      : normalizeBusinessRate(row.newOrderRate)
    : null;
  const oldOrderRate = customerBreakdownProvided
    ? row?.oldOrderRate === null || row?.oldOrderRate === undefined
      ? oldVisitUsers > 0 ? oldOrderUsers / oldVisitUsers : null
      : normalizeBusinessRate(row.oldOrderRate)
    : null;
  const repeatDataProvided = Boolean(row?.repeatDataProvided) || ([
    'repeatUsers7d',
    'repeatRate7d',
    'repeatUsers30d',
    'repeatRate30d',
    'platformRepeatRate'
  ] as Array<keyof BusinessDailyRecord>).some(hasBusinessField);
  return {
    key: `${row?.storeId || ''}:${platform}:${date}`,
    storeId: String(row?.storeId || ''),
    storeName: String(row?.storeName || ''),
    platform,
    platformName: PLATFORM_NAMES[platform],
    date,
    sourceFileName: String(row?.sourceFileName || ''),
    importBatchId: String(row?.importBatchId || ''),
    importedAt: String(row?.importedAt || ''),
    externalStoreId: String(row?.externalStoreId || ''),
    externalStoreName: String(row?.externalStoreName || ''),
    grossSales: Math.max(0, toMoneyNumber(row?.grossSales, 0)),
    actualReceipt,
    merchantIncome: Math.max(0, toMoneyNumber(row?.merchantIncome, 0)),
    validOrders,
    invalidOrders: Math.max(0, Math.floor(toNumber(row?.invalidOrders, 0))),
    averageReceipt: Math.max(0, toMoneyNumber(row?.averageReceipt, validOrders > 0 ? actualReceipt / validOrders : 0)),
    averageMerchantIncome: Math.max(0, toMoneyNumber(row?.averageMerchantIncome, 0)),
    exposureUsers,
    visitUsers,
    orderUsers,
    visitRate,
    orderRate,
    customerBreakdownProvided,
    newExposureUsers,
    oldExposureUsers,
    newVisitUsers,
    oldVisitUsers,
    newOrderUsers,
    oldOrderUsers,
    newVisitRate,
    oldVisitRate,
    newOrderRate,
    oldOrderRate,
    repeatDataProvided,
    repeatUsers7d: repeatDataProvided ? Math.max(0, Math.floor(toNumber(row?.repeatUsers7d, 0))) : 0,
    repeatRate7d: repeatDataProvided ? normalizeBusinessRate(row?.repeatRate7d) : null,
    repeatUsers30d: repeatDataProvided ? Math.max(0, Math.floor(toNumber(row?.repeatUsers30d, 0))) : 0,
    repeatRate30d: repeatDataProvided ? normalizeBusinessRate(row?.repeatRate30d) : null,
    platformRepeatRate: repeatDataProvided ? normalizeBusinessRate(row?.platformRepeatRate) : null,
    exposureTimes: Math.max(0, Math.floor(toNumber(row?.exposureTimes, 0))),
    visitTimes: Math.max(0, Math.floor(toNumber(row?.visitTimes, 0))),
    orderTimes: Math.max(0, Math.floor(toNumber(row?.orderTimes, 0))),
    merchantActivityCost: Math.max(0, toMoneyNumber(row?.merchantActivityCost, 0)),
    merchantActivityCostWithoutFull: Math.max(0, toMoneyNumber(row?.merchantActivityCostWithoutFull, row?.merchantActivityCost || 0)),
    platformSubsidy: Math.max(0, toMoneyNumber(row?.platformSubsidy, 0)),
    totalActivitySubsidy: Math.max(0, toMoneyNumber(row?.totalActivitySubsidy, 0)),
    commission: Math.max(0, toMoneyNumber(row?.commission, 0)),
    deliveryServiceFee: Math.max(0, toMoneyNumber(row?.deliveryServiceFee, 0)),
    packageFee: Math.max(0, toMoneyNumber(row?.packageFee, 0)),
    customerDeliveryFee: Math.max(0, toMoneyNumber(row?.customerDeliveryFee, 0)),
    activityOrders: Math.max(0, Math.floor(toNumber(row?.activityOrders, 0))),
    activityOrderRate: normalizeBusinessRate(row?.activityOrderRate),
    cancelOrders: Math.max(0, Math.floor(toNumber(row?.cancelOrders, 0))),
    merchantCancelOrders: Math.max(0, Math.floor(toNumber(row?.merchantCancelOrders, 0))),
    listedProducts: Math.max(0, Math.floor(toNumber(row?.listedProducts, 0))),
    tradedProducts: Math.max(0, Math.floor(toNumber(row?.tradedProducts, 0))),
    outOfStockProducts: Math.max(0, Math.floor(toNumber(row?.outOfStockProducts, 0))),
    activityProducts: Math.max(0, Math.floor(toNumber(row?.activityProducts, 0))),
    businessHoursText: String(row?.businessHoursText || ''),
    warnings: Array.isArray(row?.warnings) ? row.warnings.map(item => String(item || '')).filter(Boolean) : []
  };
}

function normalizeBusinessData(value: Partial<BusinessDataState> | undefined): BusinessDataState {
  const records = (Array.isArray(value?.records) ? value.records : [])
    .map(row => normalizeBusinessDailyRecord(row))
    .filter((row): row is BusinessDailyRecord => Boolean(row))
    .sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
  const imports = (Array.isArray(value?.imports) ? value.imports : [])
    .map(row => ({
      id: String(row?.id || uid('business-import')),
      storeId: String(row?.storeId || ''),
      storeName: String(row?.storeName || ''),
      platform: row?.platform === 'eleme' ? 'eleme' : 'meituan' as Platform,
      platformName: row?.platformName || PLATFORM_NAMES[row?.platform === 'eleme' ? 'eleme' : 'meituan'],
      fileName: String(row?.fileName || ''),
      importedAt: String(row?.importedAt || ''),
      dateStart: normalizeBusinessDate(row?.dateStart),
      dateEnd: normalizeBusinessDate(row?.dateEnd),
      rowCount: Math.max(0, Math.floor(toNumber(row?.rowCount, 0))),
      replacedDates: Array.isArray(row?.replacedDates) ? row.replacedDates.map(normalizeBusinessDate).filter(Boolean) : [],
      warnings: Array.isArray(row?.warnings) ? row.warnings.map(item => String(item || '')).filter(Boolean) : []
    }))
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  const notes = (Array.isArray(value?.notes) ? value.notes : [])
    .map(row => ({
      id: String(row?.id || uid('business-note')),
      storeId: String(row?.storeId || ''),
      kind: (row?.kind === 'memo' ? 'memo' : 'diagnostic') as BusinessAnalysisNoteKind,
      title: String(row?.title || '经营诊断'),
      createdAt: String(row?.createdAt || ''),
      dateStart: normalizeBusinessDate(row?.dateStart),
      dateEnd: normalizeBusinessDate(row?.dateEnd),
      platform: row?.platform === 'meituan' || row?.platform === 'eleme' ? row.platform : 'all' as Platform | 'all',
      items: Array.isArray(row?.items) ? row.items.map(item => String(item || '')).filter(Boolean) : []
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { records, imports, notes };
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
    businessData: normalizeBusinessData(raw.businessData),
    orderAnalysis: normalizeOrderAnalysisState(raw.orderAnalysis),
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

function isMealMainProduct(product: Pick<Product, 'category' | 'stapleServingCount' | 'nonStandalone'>) {
  if (product.nonStandalone) return false;
  return product.category === 'staple' || product.category === 'setMeal' || productStapleServingCount(product) > 0;
}

function mealMainStapleServingCount(product: Pick<Product, 'category' | 'stapleServingCount' | 'nonStandalone'>) {
  return isMealMainProduct(product) ? Math.max(1, productStapleServingCount(product)) : 0;
}

function comboHasMealMainAnchor(store: Store, qtys: number[]) {
  return qtys.some((qty, index) => qty > 0 && isMealMainProduct(store.products[index]));
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
    stapleCounts.push(mealMainStapleServingCount(product));
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
      if (!comboHasMealMainAnchor(store, qtys)) return;
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
      if (!comboHasMealMainAnchor(store, qtys)) return;
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
  let sum = 0;
  let count = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    sum += value;
    count++;
  }
  return count ? sum / count : null;
}

function median(values: number[]) {
  const valid: number[] = [];
  for (const value of values) {
    if (Number.isFinite(value)) valid.push(value);
  }
  valid.sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
}

function comboOriginalRange(settings: ComboRangeSettings) {
  const min = Math.max(0, Number(settings.originalMin) || 0);
  const max = settings.originalMax === '' ? Infinity : Math.max(min, Number(settings.originalMax) || 0);
  return { min, max };
}

function isInComboOriginalRange(settings: ComboRangeSettings, originalTotal: number) {
  const range = comboOriginalRange(settings);
  return originalTotal + 1e-9 >= range.min && originalTotal <= range.max + 1e-9;
}

function comboPayRange(settings: ComboRangeSettings) {
  const min = Math.max(0, Number(settings.payMin) || 0);
  const max = settings.payMax === '' ? Infinity : Math.max(min, Number(settings.payMax) || 0);
  return { min, max };
}

function isInComboPayRange(settings: ComboRangeSettings, finalPay: number) {
  const range = comboPayRange(settings);
  return finalPay + 1e-9 >= range.min && finalPay <= range.max + 1e-9;
}

function normalizeComboProductKeyword(settings: ComboRangeSettings) {
  return String(settings.productNameKeyword || '').trim().toLowerCase();
}

function buildComboProductFilter(store: Store, settings: ComboRangeSettings) {
  const keyword = normalizeComboProductKeyword(settings);
  if (!keyword) return { keyword, productIds: null as Set<string> | null };
  const productIds = new Set<string>();
  for (const product of store.products) {
    if (product.name.toLowerCase().includes(keyword)) productIds.add(product.id);
  }
  return {
    keyword,
    productIds
  };
}

function buildComboTotals(store: Store, platform: Platform, qtys: number[]) {
  const items: ComboItem[] = [];
  let originalTotal = 0;
  let costTotal = 0;
  let hasUnlistedProduct = false;
  for (let index = 0; index < store.products.length; index++) {
    const product = store.products[index];
    const qty = qtys[index] || 0;
    if (qty <= 0) continue;
    if (!isProductListedOnPlatform(product, platform)) {
      hasUnlistedProduct = true;
      break;
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
  }
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

function moneyFloorToCent(value: number) {
  return Math.floor(Math.max(0, Number(value) || 0) * 100 + 1e-9) / 100;
}

function activityDesignMaxFullAmount(settings: ActivityDesignSettings, threshold: number) {
  const configured = settings.couponDesignMaxFullAmount === '' ? Number.POSITIVE_INFINITY : Math.max(0, Number(settings.couponDesignMaxFullAmount) || 0);
  return Math.max(0, Math.min(configured, threshold - 0.01));
}

function activityDesignMaxCouponAmount(settings: ActivityDesignSettings, threshold: number) {
  const configured = settings.couponDesignMaxCouponAmount === '' ? Number.POSITIVE_INFINITY : Math.max(0, Number(settings.couponDesignMaxCouponAmount) || 0);
  return Math.max(0, Math.min(configured, threshold - 0.01));
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
  const totals = buildComboTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (!isInComboOriginalRange(settings, totals.originalTotal)) return null;
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
  if (!isInComboPayRange(settings, finalPay)) return null;
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

function normalizeDiscountCandidates(amount: number, maxAmount: number) {
  const base = moneyFloorToCent(clamp(amount, 0, maxAmount));
  return Array.from(new Set([base - 0.01, base, base + 0.01]
    .map(value => moneyFloorToCent(clamp(value, 0, maxAmount)))))
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
      const maxFull = activityDesignMaxFullAmount(settings, threshold);
      const maxCoupon = activityDesignMaxCouponAmount(settings, threshold);
      const modes: ActivityDesignMode[] = settings.designMode === 'auto' ? ['full', 'coupon', 'stacked'] : [settings.designMode];

      modes.forEach(mode => {
        const targetFullAmount = mode === 'coupon'
          ? 0
          : findDiscountForTarget(state, store, searchRows, settings, 0, maxFull, 0, 'full');
        const fullCandidates = mode === 'coupon' ? [0] : normalizeDiscountCandidates(targetFullAmount, maxFull);
        fullCandidates.forEach(fullAmount => {
          const noCouponSummary = summarizeActivityScenario(state, store, eligible, settings, fullAmount, 0, 0);
          if (!noCouponSummary || noCouponSummary.avgProfitRate === null) return;
          const noCouponAvgProfitRate = noCouponSummary.avgProfitRate;
          if ((noCouponSummary.avgNetTargetGap ?? -Infinity) < -0.005 || (noCouponSummary.avgPayTargetGap ?? -Infinity) < -0.005) return;

          const targetCouponAmount = mode === 'full'
            ? 0
            : findDiscountForTarget(state, store, searchRows, settings, fullAmount, maxCoupon, couponDropRate, 'coupon');
          const couponCandidates = mode === 'full' ? [0] : normalizeDiscountCandidates(targetCouponAmount, maxCoupon);
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
  let minPrice = Infinity;
  for (const product of store.products) {
    if (product.id === excludedProductId) continue;
    if (!isMealMainProduct(product) || !isProductListedOnPlatform(product, platform)) continue;
    const price = platformOriginalUnitPrice(product, platform);
    if (price > 0 && price < minPrice) minPrice = price;
  }
  return minPrice === Infinity ? 0 : minPrice;
}

function minStapleOriginalUnitPrice(store: Store, platform: Platform, excludedProductId: string) {
  let minPrice = Infinity;
  for (const product of store.products) {
    if (product.id === excludedProductId) continue;
    if (!isMealMainProduct(product) || !isProductListedOnPlatform(product, platform)) continue;
    const price = platformOriginalUnitPrice(product, platform) / mealMainStapleServingCount(product);
    if (price > 0 && price < minPrice) minPrice = price;
  }
  return minPrice === Infinity ? 0 : minPrice;
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
  const currentStapleCount = mealMainStapleServingCount(product) * currentQty;
  const currentHasStandalone = currentQty > 0 && isMealMainProduct(product);
  const maxItems = Math.max(1, Math.floor(Number(store.maxItems) || 1));
  const maxQtyPerSku = Math.max(1, Math.floor(Number(store.maxQtyPerSku) || 1));
  const remainingItems = maxItems - currentQty;
  const originalRange = comboOriginalRange(settings);
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
  let maxUnitCents = 0;
  for (const item of store.products) {
    if (item.id === product.id || !isProductListedOnPlatform(item, platform)) continue;
    const price = platformOriginalUnitPrice(item, platform);
    if (price <= 0) continue;
    const priceCents = Math.round(price * 100);
    const stapleCount = mealMainStapleServingCount(item);
    const standalone = isMealMainProduct(item);
    if (priceCents > maxUnitCents) maxUnitCents = priceCents;
    for (let count = 0; count < maxQtyPerSku; count++) {
      units.push({ priceCents, stapleCount, standalone });
    }
  }
  if (!units.length) return null;

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
  const unitStapleCount = mealMainStapleServingCount(product);
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
    if (!isMealMainProduct(product) && !allowAdditionalProducts) return;
    if (!isInCalculationTotalRange(store, orderOriginalTotal)) return;
    if (!isInComboOriginalRange(settings, orderOriginalTotal)) return;
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

  if (isMealMainProduct(product)) {
    for (let qty = 1; qty <= maxQty; qty++) {
      addScenario(`单品 x${qty}`, unitOriginal * qty, qty);
    }
  } else {
    addScenario('凑单分摊', minOrderTotal, 1, true);
  }

  addScenario('起送压力', minOrderTotal, 1, true);
  [20, 25].forEach(total => addScenario(`费用阶梯 ¥${money(total)}`, Math.max(minOrderTotal, total), 1, true));
  const enabledRedTiers = [];
  for (const tier of state.platformRules.redTiers[platform]) {
    if (tier.enabled && tier.threshold > 0) enabledRedTiers.push(tier);
  }
  enabledRedTiers.sort((a, b) => a.threshold - b.threshold);
  for (const tier of enabledRedTiers) {
    addScenario(`${PLATFORM_NAMES[platform]}红包门槛 ¥${money(tier.threshold)}`, Math.max(minOrderTotal, tier.threshold), 1, true);
  }

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
  if (!isInComboPayRange(settings, finalPay)) return null;

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
  const totals = buildComboTotals(store, platform, qtys);
  if (!totals.items.length) return null;
  if (!isInCalculationTotalRange(store, totals.originalTotal)) return null;
  if (!isInComboOriginalRange(settings, totals.originalTotal)) return null;
  if (totals.originalTotal + 1e-9 < store.startPrice) return null;
  const baseRed = bestBaseRed(state, platform, totals.originalTotal);
  const afterBaseRed = Math.max(0, roundMoney(totals.originalTotal - baseRed.amount));
  const redAddOnSpace = Math.min(Math.max(0, Number(settings.redAddOnSpace) || 0), afterBaseRed);
  const finalPay = Math.max(0, roundMoney(afterBaseRed - redAddOnSpace));
  if (!isInComboPayRange(settings, finalPay)) return null;
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
  const productFilter = buildComboProductFilter(store, settings);
  const warnings: string[] = [];
  if (!store.products.length) warnings.push('当前门店没有有效商品，请先导入或维护商品。');
  if (productFilter.productIds && !productFilter.productIds.size) warnings.push(`当前门店没有匹配「${settings.productNameKeyword.trim()}」的商品。`);

  let checked = 0;
  let validCombos = 0;
  const details: PricingComboDetail[] = [];
  const detailsByProductKey = new Map<string, PricingComboDetail[]>();
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
      let processedProducts = 0;
      for (const product of store.products) {
        if (!isProductListedOnPlatform(product, platform)) continue;
        if (productFilter.productIds && !productFilter.productIds.has(product.id)) continue;
        processedProducts++;
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
          const productDetails = detailsByProductKey.get(productKey);
          if (productDetails) productDetails.push(detail);
          else detailsByProductKey.set(productKey, [detail]);
        }

        if (processedProducts % 20 === 1) {
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
    const productDetails = detailsByProductKey.get(productKey) || [];
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

async function runActivityDesignCalculationAsync(
  state: CalculatorState,
  platformFilter: Platform | 'all',
  settings: ActivityDesignSettings,
  onProgress?: (progress: CalculationProgress) => void
): Promise<ActivityDesignResult> {
  const start = calculationNow();
  const store = currentStoreFrom(state);
  const platforms = platformFilter === 'all' ? PLATFORMS : [platformFilter];
  const productFilter = buildComboProductFilter(store, settings);
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

function normalizeProductMergeName(value: unknown) {
  return normalizeImportedProductName(value)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(【［\[].*?[）)】］\]]/g, '')
    .replace(/美团|饿了么|外卖|专享|平台|热销|爆款|招牌|推荐|新品|限时|活动|折扣|单点不送|不可单点/g, '')
    .replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

function productNameSimilarity(a: unknown, b: unknown) {
  const left = normalizeProductMergeName(a);
  const right = normalizeProductMergeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  const leftSet = new Set(Array.from(left));
  const rightSet = new Set(Array.from(right));
  let intersection = 0;
  leftSet.forEach(char => {
    if (rightSet.has(char)) intersection++;
  });
  const union = new Set([...Array.from(leftSet), ...Array.from(rightSet)]).size || 1;
  const jaccard = intersection / union;
  const coverage = intersection / Math.max(1, Math.min(leftSet.size, rightSet.size));
  const containsScore = longer.includes(shorter) && shorter.length >= 4
    ? Math.min(0.96, 0.72 + shorter.length / Math.max(longer.length, 1) * 0.24)
    : 0;
  return Math.max(containsScore, coverage * 0.65 + jaccard * 0.35);
}

function productHasPlatformOverride(product: Product, platform: Platform) {
  if (platform === 'meituan') return product.meituanPrice !== '' || product.meituanPackageFee !== '';
  return product.elemePrice !== '' || product.elemePackageFee !== '';
}

function productMergeCompatible(a: Product, b: Product) {
  const similarity = productNameSimilarity(a.name, b.name);
  if (similarity < 0.82) return false;
  if (a.category !== b.category && a.category !== 'other' && b.category !== 'other') return false;
  if (a.stapleServingCount > 0 && b.stapleServingCount > 0 && a.stapleServingCount !== b.stapleServingCount) return false;
  return true;
}

function productDataCompleteness(product: Product) {
  return [
    product.cost > 0,
    product.packageFee > 0,
    product.meituanPrice !== '',
    product.elemePrice !== '',
    product.meituanPackageFee !== '',
    product.elemePackageFee !== '',
    product.category !== 'other',
    product.stapleServingCount > 0
  ].filter(Boolean).length;
}

function mergeOptionalPrice<T extends 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee'>(target: Product, source: Product, field: T) {
  if (target[field] === '' && source[field] !== '') target[field] = source[field];
}

function mergeProductRecords(primary: Product, duplicates: Product[]) {
  const merged = normalizeProduct(primary);
  duplicates.forEach(source => {
    if (merged.price <= 0 && source.price > 0) merged.price = source.price;
    if (merged.cost <= 0 && source.cost > 0) merged.cost = source.cost;
    if (merged.packageFee <= 0 && source.packageFee > 0) merged.packageFee = source.packageFee;
    const hadMeituanOverride = productHasPlatformOverride(merged, 'meituan');
    const hadElemeOverride = productHasPlatformOverride(merged, 'eleme');
    mergeOptionalPrice(merged, source, 'meituanPrice');
    mergeOptionalPrice(merged, source, 'elemePrice');
    mergeOptionalPrice(merged, source, 'meituanPackageFee');
    mergeOptionalPrice(merged, source, 'elemePackageFee');
    if (productHasPlatformOverride(source, 'meituan') && !hadMeituanOverride) {
      merged.meituanEnabled = source.meituanEnabled;
    } else {
      merged.meituanEnabled = merged.meituanEnabled || source.meituanEnabled;
    }
    if (productHasPlatformOverride(source, 'eleme') && !hadElemeOverride) {
      merged.elemeEnabled = source.elemeEnabled;
    } else {
      merged.elemeEnabled = merged.elemeEnabled || source.elemeEnabled;
    }
    if (merged.category === 'other' && source.category !== 'other') merged.category = source.category;
    merged.stapleServingCount = Math.max(merged.stapleServingCount, source.stapleServingCount);
    merged.nonStandalone = merged.nonStandalone || source.nonStandalone;
  });
  return normalizeProduct(merged);
}

function chooseProductMergePrimary(products: Product[]) {
  return products
    .slice()
    .sort((a, b) => productDataCompleteness(b) - productDataCompleteness(a) || a.name.length - b.name.length || a.name.localeCompare(b.name, 'zh-CN'))[0];
}

function findDuplicateProductGroups(products: Product[]) {
  const groups: Product[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    if (used.has(product.id)) continue;
    const group = [product];
    for (let j = i + 1; j < products.length; j++) {
      const candidate = products[j];
      if (used.has(candidate.id)) continue;
      if (group.some(item => productMergeCompatible(item, candidate))) group.push(candidate);
    }
    if (group.length > 1) {
      group.forEach(item => used.add(item.id));
      groups.push(group);
    }
  }
  return groups.sort((a, b) => b.length - a.length || b.reduce((sum, item) => sum + productDataCompleteness(item), 0) - a.reduce((sum, item) => sum + productDataCompleteness(item), 0));
}

function platformImportPriceField(platform: Platform): 'meituanPrice' | 'elemePrice' {
  return platform === 'meituan' ? 'meituanPrice' : 'elemePrice';
}

function findSimilarProductForPlatformImport(products: Product[], item: PlatformProductRecord, platform: Platform) {
  const priceField = platformImportPriceField(platform);
  const imported = normalizeProduct({ name: item.name, price: item.price });
  let best: { product: Product; score: number } | null = null;
  for (const product of products) {
    if (product[priceField] !== '') continue;
    if (product.category !== imported.category && product.category !== 'other' && imported.category !== 'other') continue;
    if (product.stapleServingCount > 0 && imported.stapleServingCount > 0 && product.stapleServingCount !== imported.stapleServingCount) continue;
    const similarity = productNameSimilarity(product.name, item.name);
    if (similarity < 0.88) continue;
    const priceBasis = Number(product.price) || 0;
    const priceGap = priceBasis > 0 ? Math.abs(priceBasis - item.price) : 0;
    const priceCompatible = priceBasis <= 0 || priceGap <= Math.max(5, item.price * 0.35);
    if (!priceCompatible) continue;
    if (!best || similarity > best.score) best = { product, score: similarity };
  }
  return best?.product || null;
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

function businessNumber(row: unknown[], index: number, fallback = 0) {
  return index >= 0 ? toMoneyNumber(row[index], fallback) : fallback;
}

function businessInteger(row: unknown[], index: number, fallback = 0) {
  return Math.max(0, Math.floor(toNumber(index >= 0 ? row[index] : fallback, fallback)));
}

function businessOptionalInteger(row: unknown[], index: number) {
  return index >= 0 ? Math.max(0, Math.floor(toNumber(row[index], 0))) : 0;
}

function businessText(row: unknown[], index: number) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

function businessRate(row: unknown[], index: number) {
  return index >= 0 ? normalizeBusinessRate(row[index]) : null;
}

function businessColumn(row: unknown[], candidates: string[]) {
  return findImportColumnIndex(row, candidates);
}

function businessExactColumn(row: unknown[], candidates: string[]) {
  const cells = row.map(normalizeImportHeader);
  return candidates
    .map(normalizeImportHeader)
    .map(candidate => cells.indexOf(candidate))
    .find(index => index >= 0) ?? -1;
}

function detectBusinessReportPlatform(header: unknown[]): Platform | null {
  if (businessColumn(header, ['门店id']) >= 0 && businessColumn(header, ['顾客实付（不含券）', '顾客实付']) >= 0) return 'meituan';
  if (businessColumn(header, ['门店编号']) >= 0 && businessColumn(header, ['饿了么补贴', '顾客实付总额']) >= 0) return 'eleme';
  return null;
}

function findBusinessReportHeader(rows: unknown[][]) {
  const limit = Math.min(rows.length, 30);
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (businessColumn(row, ['日期']) >= 0 && businessColumn(row, ['门店名称']) >= 0 && businessColumn(row, ['有效订单']) >= 0) {
      const platform = detectBusinessReportPlatform(row);
      if (platform) return { rowIndex, header: row, platform };
    }
  }
  return null;
}

function parseMeituanBusinessRecord(row: unknown[], header: unknown[], warnings: string[]): ParsedBusinessReport['records'][number] | null {
  const dateIndex = businessColumn(header, ['日期']);
  const date = normalizeBusinessDate(row[dateIndex]);
  if (!date) return null;
  const validOrders = businessInteger(row, businessColumn(header, ['有效订单']));
  const exposureUsers = businessInteger(row, businessColumn(header, ['曝光人数']));
  const visitUsers = businessInteger(row, businessColumn(header, ['入店人数']));
  const orderUsers = businessInteger(row, businessColumn(header, ['下单人数']), validOrders);
  const newExposureIndex = businessColumn(header, ['曝光新客', '新客曝光人数']);
  const oldExposureIndex = businessColumn(header, ['曝光老客', '老客曝光人数']);
  const newVisitIndex = businessColumn(header, ['入店新客', '进店新客', '新客入店人数', '新客进店人数']);
  const oldVisitIndex = businessColumn(header, ['入店老客', '进店老客', '老客入店人数', '老客进店人数']);
  const newOrderIndex = businessColumn(header, ['下单新客', '新客下单人数']);
  const oldOrderIndex = businessColumn(header, ['下单老客', '老客下单人数']);
  const newVisitRateIndex = businessColumn(header, ['新客入店转化率', '新客进店转化率']);
  const oldVisitRateIndex = businessColumn(header, ['老客入店转化率', '老客进店转化率']);
  const newOrderRateIndex = businessColumn(header, ['新客下单转化率']);
  const oldOrderRateIndex = businessColumn(header, ['老客下单转化率']);
  const customerBreakdownProvided = [
    newExposureIndex,
    oldExposureIndex,
    newVisitIndex,
    oldVisitIndex,
    newOrderIndex,
    oldOrderIndex,
    newVisitRateIndex,
    oldVisitRateIndex,
    newOrderRateIndex,
    oldOrderRateIndex
  ].some(index => index >= 0);
  const newExposureUsers = businessOptionalInteger(row, newExposureIndex);
  const oldExposureUsers = businessOptionalInteger(row, oldExposureIndex);
  const newVisitUsers = businessOptionalInteger(row, newVisitIndex);
  const oldVisitUsers = businessOptionalInteger(row, oldVisitIndex);
  const newOrderUsers = businessOptionalInteger(row, newOrderIndex);
  const oldOrderUsers = businessOptionalInteger(row, oldOrderIndex);
  const platformRepeatRateIndex = businessExactColumn(header, ['复购率']);
  const platformRepeatRate = businessRate(row, platformRepeatRateIndex);
  const grossSales = businessNumber(row, businessColumn(header, ['优惠前总额', '商品原价']));
  const actualReceipt = businessNumber(row, businessColumn(header, ['顾客实付']));
  const merchantActivityCost = businessNumber(row, businessColumn(header, ['商家活动支出']));
  const platformSubsidy = businessNumber(row, businessColumn(header, ['平台活动补贴']));
  const platformName = PLATFORM_NAMES.meituan;
  const recordWarnings = [
    ...(businessColumn(header, ['有交易商品数']) < 0 ? ['美团日报缺少商品交易结构字段，商品结构诊断仅做平台总览。'] : [])
  ];
  if (!validOrders && actualReceipt > 0) warnings.push(`${date} 美团有实收但有效订单为0，请复核原始报表。`);
  return {
    platform: 'meituan',
    platformName,
    date,
    externalStoreId: businessText(row, businessColumn(header, ['门店id'])),
    externalStoreName: businessText(row, businessColumn(header, ['门店名称'])),
    grossSales,
    actualReceipt,
    merchantIncome: businessNumber(row, businessColumn(header, ['营业收入'])),
    validOrders,
    invalidOrders: businessInteger(row, businessColumn(header, ['取消订单'])),
    averageReceipt: businessNumber(row, businessColumn(header, ['实付单均价']), validOrders > 0 ? actualReceipt / validOrders : 0),
    averageMerchantIncome: validOrders > 0 ? businessNumber(row, businessColumn(header, ['营业收入'])) / validOrders : 0,
    exposureUsers,
    visitUsers,
    orderUsers,
    visitRate: businessRate(row, businessColumn(header, ['入店转化率'])) ?? (exposureUsers > 0 ? visitUsers / exposureUsers : null),
    orderRate: businessRate(row, businessColumn(header, ['下单转化率'])) ?? (visitUsers > 0 ? orderUsers / visitUsers : null),
    customerBreakdownProvided,
    newExposureUsers,
    oldExposureUsers,
    newVisitUsers,
    oldVisitUsers,
    newOrderUsers,
    oldOrderUsers,
    newVisitRate: businessRate(row, newVisitRateIndex) ?? (newExposureUsers > 0 ? newVisitUsers / newExposureUsers : null),
    oldVisitRate: businessRate(row, oldVisitRateIndex) ?? (oldExposureUsers > 0 ? oldVisitUsers / oldExposureUsers : null),
    newOrderRate: businessRate(row, newOrderRateIndex) ?? (newVisitUsers > 0 ? newOrderUsers / newVisitUsers : null),
    oldOrderRate: businessRate(row, oldOrderRateIndex) ?? (oldVisitUsers > 0 ? oldOrderUsers / oldVisitUsers : null),
    repeatDataProvided: platformRepeatRateIndex >= 0,
    repeatUsers7d: 0,
    repeatRate7d: null,
    repeatUsers30d: 0,
    repeatRate30d: null,
    platformRepeatRate,
    exposureTimes: businessInteger(row, businessColumn(header, ['曝光次数'])),
    visitTimes: businessInteger(row, businessColumn(header, ['入店次数'])),
    orderTimes: validOrders,
    merchantActivityCost,
    merchantActivityCostWithoutFull: merchantActivityCost,
    platformSubsidy,
    totalActivitySubsidy: businessNumber(row, businessColumn(header, ['活动补贴'])),
    commission: businessNumber(row, businessColumn(header, ['佣金'])),
    deliveryServiceFee: businessNumber(row, businessColumn(header, ['配送服务费'])),
    packageFee: businessNumber(row, businessColumn(header, ['包装费'])),
    customerDeliveryFee: businessNumber(row, businessColumn(header, ['顾客配送费（跑腿/自配送）', '顾客配送费'])),
    activityOrders: 0,
    activityOrderRate: null,
    cancelOrders: businessInteger(row, businessColumn(header, ['取消订单'])),
    merchantCancelOrders: businessInteger(row, businessColumn(header, ['商责取消订单'])),
    listedProducts: 0,
    tradedProducts: 0,
    outOfStockProducts: 0,
    activityProducts: 0,
    businessHoursText: businessText(row, businessColumn(header, ['营业时段'])),
    warnings: recordWarnings
  };
}

function parseElemeBusinessRecord(row: unknown[], header: unknown[], warnings: string[]): ParsedBusinessReport['records'][number] | null {
  const dateIndex = businessColumn(header, ['日期']);
  const date = normalizeBusinessDate(row[dateIndex]);
  if (!date) return null;
  const validOrders = businessInteger(row, businessColumn(header, ['有效订单']));
  const exposureUsers = businessInteger(row, businessColumn(header, ['曝光人数']));
  const visitUsers = businessInteger(row, businessColumn(header, ['进店人数', '入店人数']));
  const orderUsers = businessInteger(row, businessColumn(header, ['下单人数']), validOrders);
  const newExposureIndex = businessColumn(header, ['新客曝光人数', '曝光新客']);
  const oldExposureIndex = businessColumn(header, ['老客曝光人数', '曝光老客']);
  const newVisitIndex = businessColumn(header, ['新客进店人数', '新客入店人数', '进店新客', '入店新客']);
  const oldVisitIndex = businessColumn(header, ['老客进店人数', '老客入店人数', '进店老客', '入店老客']);
  const newOrderIndex = businessColumn(header, ['新客下单人数', '下单新客']);
  const oldOrderIndex = businessColumn(header, ['老客下单人数', '下单老客']);
  const newVisitRateIndex = businessColumn(header, ['新客进店转化率', '新客入店转化率']);
  const oldVisitRateIndex = businessColumn(header, ['老客进店转化率', '老客入店转化率']);
  const newOrderRateIndex = businessColumn(header, ['新客下单转化率']);
  const oldOrderRateIndex = businessColumn(header, ['老客下单转化率']);
  const customerBreakdownProvided = [
    newExposureIndex,
    oldExposureIndex,
    newVisitIndex,
    oldVisitIndex,
    newOrderIndex,
    oldOrderIndex,
    newVisitRateIndex,
    oldVisitRateIndex,
    newOrderRateIndex,
    oldOrderRateIndex
  ].some(index => index >= 0);
  const newExposureUsers = businessOptionalInteger(row, newExposureIndex);
  const oldExposureUsers = businessOptionalInteger(row, oldExposureIndex);
  const newVisitUsers = businessOptionalInteger(row, newVisitIndex);
  const oldVisitUsers = businessOptionalInteger(row, oldVisitIndex);
  const newOrderUsers = businessOptionalInteger(row, newOrderIndex);
  const oldOrderUsers = businessOptionalInteger(row, oldOrderIndex);
  const repeatUsers7dIndex = businessColumn(header, ['近7日复购人数']);
  const repeatRate7dIndex = businessColumn(header, ['近7日复购率']);
  const repeatUsers30dIndex = businessColumn(header, ['近30日复购人数']);
  const repeatRate30dIndex = businessColumn(header, ['近30日复购率']);
  const repeatDataProvided = [repeatUsers7dIndex, repeatRate7dIndex, repeatUsers30dIndex, repeatRate30dIndex].some(index => index >= 0);
  const actualReceipt = businessNumber(row, businessColumn(header, ['顾客实付总额', '顾客实付']));
  const merchantActivityCost = businessNumber(row, businessColumn(header, ['商家活动成本（含满减活动）', '商家活动成本']));
  const merchantActivityCostWithoutFull = businessNumber(row, businessColumn(header, ['商家活动成本（不含满减活动）']), merchantActivityCost);
  const elemeSubsidy = businessNumber(row, businessColumn(header, ['饿了么补贴']));
  const agentSubsidy = businessNumber(row, businessColumn(header, ['代理商补贴']));
  if (!validOrders && actualReceipt > 0) warnings.push(`${date} 饿了么有实收但有效订单为0，请复核原始报表。`);
  return {
    platform: 'eleme',
    platformName: PLATFORM_NAMES.eleme,
    date,
    externalStoreId: businessText(row, businessColumn(header, ['门店编号'])),
    externalStoreName: businessText(row, businessColumn(header, ['门店名称'])),
    grossSales: businessNumber(row, businessColumn(header, ['营业额'])),
    actualReceipt,
    merchantIncome: businessNumber(row, businessColumn(header, ['收入'])),
    validOrders,
    invalidOrders: businessInteger(row, businessColumn(header, ['无效订单'])),
    averageReceipt: businessNumber(row, businessColumn(header, ['单均实付']), validOrders > 0 ? actualReceipt / validOrders : 0),
    averageMerchantIncome: businessNumber(row, businessColumn(header, ['单均收入'])),
    exposureUsers,
    visitUsers,
    orderUsers,
    visitRate: businessRate(row, businessColumn(header, ['进店转化率', '入店转化率'])) ?? (exposureUsers > 0 ? visitUsers / exposureUsers : null),
    orderRate: businessRate(row, businessColumn(header, ['下单转化率'])) ?? (visitUsers > 0 ? orderUsers / visitUsers : null),
    customerBreakdownProvided,
    newExposureUsers,
    oldExposureUsers,
    newVisitUsers,
    oldVisitUsers,
    newOrderUsers,
    oldOrderUsers,
    newVisitRate: businessRate(row, newVisitRateIndex) ?? (newExposureUsers > 0 ? newVisitUsers / newExposureUsers : null),
    oldVisitRate: businessRate(row, oldVisitRateIndex) ?? (oldExposureUsers > 0 ? oldVisitUsers / oldExposureUsers : null),
    newOrderRate: businessRate(row, newOrderRateIndex) ?? (newVisitUsers > 0 ? newOrderUsers / newVisitUsers : null),
    oldOrderRate: businessRate(row, oldOrderRateIndex) ?? (oldVisitUsers > 0 ? oldOrderUsers / oldVisitUsers : null),
    repeatDataProvided,
    repeatUsers7d: businessOptionalInteger(row, repeatUsers7dIndex),
    repeatRate7d: businessRate(row, repeatRate7dIndex),
    repeatUsers30d: businessOptionalInteger(row, repeatUsers30dIndex),
    repeatRate30d: businessRate(row, repeatRate30dIndex),
    platformRepeatRate: null,
    exposureTimes: businessInteger(row, businessColumn(header, ['曝光次数'])),
    visitTimes: businessInteger(row, businessColumn(header, ['进店次数', '入店次数'])),
    orderTimes: businessInteger(row, businessColumn(header, ['下单次数']), validOrders),
    merchantActivityCost,
    merchantActivityCostWithoutFull,
    platformSubsidy: elemeSubsidy + agentSubsidy,
    totalActivitySubsidy: businessNumber(row, businessColumn(header, ['活动总补贴'])),
    commission: businessNumber(row, businessColumn(header, ['平台技术服务费'])) + businessNumber(row, businessColumn(header, ['履约技术服务费'])),
    deliveryServiceFee: businessNumber(row, businessColumn(header, ['配送费补贴'])),
    packageFee: businessNumber(row, businessColumn(header, ['打包费'])),
    customerDeliveryFee: 0,
    activityOrders: businessInteger(row, businessColumn(header, ['活动订单数'])),
    activityOrderRate: businessRate(row, businessColumn(header, ['活动订单占比'])),
    cancelOrders: businessInteger(row, businessColumn(header, ['商责取消数'])),
    merchantCancelOrders: businessInteger(row, businessColumn(header, ['商责退单数'])),
    listedProducts: businessInteger(row, businessColumn(header, ['上架商品数'])),
    tradedProducts: businessInteger(row, businessColumn(header, ['有交易商品数'])),
    outOfStockProducts: businessInteger(row, businessColumn(header, ['库存不足商品数'])),
    activityProducts: businessInteger(row, businessColumn(header, ['活动商品数'])),
    businessHoursText: businessText(row, businessColumn(header, ['设置营业时间段'])),
    warnings: []
  };
}

function parseBusinessReportWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedBusinessReport {
  const { sheetName, rows } = firstSheetRows(workbook);
  const headerInfo = findBusinessReportHeader(rows);
  if (!headerInfo) throw new Error('没有找到可识别的经营日报表头。');
  const warnings: string[] = [];
  const records = rows.slice(headerInfo.rowIndex + 1)
    .filter(rowHasText)
    .map(row => headerInfo.platform === 'meituan'
      ? parseMeituanBusinessRecord(row, headerInfo.header, warnings)
      : parseElemeBusinessRecord(row, headerInfo.header, warnings))
    .filter((row): row is ParsedBusinessReport['records'][number] => Boolean(row));
  const duplicateDates = records
    .map(row => row.date)
    .filter((date, index, list) => list.indexOf(date) !== index);
  if (duplicateDates.length) warnings.push(`${fileName} 内存在重复日期，导入时会保留最后一条。`);
  return {
    platform: headerInfo.platform,
    sheetName,
    records,
    warnings: Array.from(new Set(warnings))
  };
}


function arrayBufferToBinaryString(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return chunks.join('');
}

function workbookImportHeaderScore(workbook: XLSX.WorkBook) {
  let score = 0;
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    if (findOrderWorkbookHeader(rows)) score = Math.max(score, 100);
    if (findBusinessReportHeader(rows)) score = Math.max(score, 90);
    rows.slice(0, 30).forEach(row => {
      const matchedFields = [
        '日期',
        '门店名称',
        '订单编号',
        '订单单号',
        '下单时间',
        '订单状态',
        '订单实付',
        '顾客实付',
        '商品信息',
        '商品原价',
        '订单原价',
        '有效订单'
      ].filter(field => findImportColumnIndex(row || [], [field]) >= 0).length;
      score = Math.max(score, matchedFields);
    });
  });
  return score;
}

async function readBusinessReportWorkbook(file: File) {
  const isCsv = /\.csv|\.txt$/i.test(file.name);
  if (!isCsv) return readWorkbook(file);
  const buffer = await file.arrayBuffer();
  const candidates: XLSX.WorkBook[] = [];
  const addCandidate = (data: string, options: XLSX.ParsingOptions) => {
    try {
      candidates.push(XLSX.read(data, { ...options, cellDates: false, raw: true }));
    } catch {
      return;
    }
  };
  ['utf-8', 'gb18030', 'gbk'].forEach(encoding => {
    try {
      addCandidate(new TextDecoder(encoding, { fatal: true }).decode(buffer), { type: 'string' });
    } catch {
      return;
    }
  });
  addCandidate(arrayBufferToBinaryString(buffer), { type: 'binary', codepage: 936 });
  if (!candidates.length) addCandidate(new TextDecoder().decode(buffer), { type: 'string' });
  return candidates
    .map((workbook, index) => ({ workbook, index, score: workbookImportHeaderScore(workbook) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.workbook || XLSX.utils.book_new();
}

const readOrderWorkbook = readBusinessReportWorkbook;

function recommendationPriorityColor(priority: Severity) {
  return severityColor(priority);
}

function recommendationPriorityText(priority: Severity) {
  return severityLabel(priority);
}

function orderImportedAtText(value: string) {
  return businessImportedAtText(value);
}

function businessDateRangeText(start: string, end: string) {
  if (start && end && start !== end) return `${start} 至 ${end}`;
  return start || end || '全部日期';
}

const BUSINESS_WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const BUSINESS_WEEK_TOTAL_LABEL = '周总计';
const BUSINESS_WEEKLY_TREND_MIN_DAYS = 30;
const BUSINESS_NOTE_LIMIT = 300;
const BUSINESS_WEEKDAY_CHART_COLORS = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#17becf',
  '#111827'
];
const BUSINESS_LINE_CHART_COLORS = [
  '#376996',
  '#d95b18',
  '#4f8f73',
  '#8f5f42',
  '#6d6aa8',
  '#b7791f'
];

function businessUtcDate(dateText: string) {
  const normalized = normalizeBusinessDate(dateText);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function businessDateFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

function businessAddDays(dateText: string, days: number) {
  const date = businessUtcDate(dateText);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return businessDateFromUtc(date);
}

function businessWeekdayIndex(dateText: string) {
  const date = businessUtcDate(dateText);
  if (!date) return 0;
  return (date.getUTCDay() + 6) % 7;
}

function businessWeekStart(dateText: string) {
  const date = businessUtcDate(dateText);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return businessDateFromUtc(date);
}

function businessWeekLabel(weekStart: string) {
  const weekEnd = businessAddDays(weekStart, 6);
  return businessDateRangeText(weekStart, weekEnd);
}

function businessDateSpanDays(startText: string, endText: string) {
  const start = businessUtcDate(startText);
  const end = businessUtcDate(endText);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

function normalizeBusinessDateRange(startText: string, endText: string) {
  const start = normalizeBusinessDate(startText);
  const end = normalizeBusinessDate(endText);
  if (!start && !end) return { dateStart: '', dateEnd: '' };
  if (!start) return { dateStart: end, dateEnd: end };
  if (!end) return { dateStart: start, dateEnd: start };
  return start <= end ? { dateStart: start, dateEnd: end } : { dateStart: end, dateEnd: start };
}

function businessNoteDateStart(note: BusinessAnalysisNote) {
  return note.dateStart || note.dateEnd;
}

function businessNoteDateEnd(note: BusinessAnalysisNote) {
  return note.dateEnd || note.dateStart;
}

function businessNoteContainsDate(note: BusinessAnalysisNote, dateText: string) {
  const date = normalizeBusinessDate(dateText);
  if (!date) return false;
  const start = businessNoteDateStart(note);
  const end = businessNoteDateEnd(note);
  return (!start || date >= start) && (!end || date <= end);
}

function businessNoteOverlapsDateRange(note: BusinessAnalysisNote, startText: string, endText: string) {
  const range = normalizeBusinessDateRange(startText, endText);
  if (!range.dateStart && !range.dateEnd) return true;
  const noteStart = businessNoteDateStart(note);
  const noteEnd = businessNoteDateEnd(note);
  if (!noteStart && !noteEnd) return true;
  if (range.dateStart && noteEnd && noteEnd < range.dateStart) return false;
  if (range.dateEnd && noteStart && noteStart > range.dateEnd) return false;
  return true;
}

function businessNoteMatchesPlatformFilter(note: BusinessAnalysisNote, platform: Platform | 'all') {
  return platform === 'all' || note.platform === 'all' || note.platform === platform;
}

function businessNoteMatchesRecord(note: BusinessAnalysisNote, row: BusinessDailyRecord) {
  return note.kind === 'memo'
    && businessNoteContainsDate(note, row.date)
    && (note.platform === 'all' || note.platform === row.platform);
}

function businessNoteItemsText(note: BusinessAnalysisNote) {
  return note.items.join('；');
}

function businessMonthStart(dateText: string) {
  const normalized = normalizeBusinessDate(dateText);
  if (!normalized) return '';
  return `${normalized.slice(0, 7)}-01`;
}

function businessMonthEnd(monthStart: string) {
  const date = businessUtcDate(monthStart);
  if (!date) return '';
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return businessDateFromUtc(date);
}

function businessDateToDayjs(dateText: string): Dayjs | null {
  const normalized = normalizeBusinessDate(dateText);
  return normalized ? dayjs(normalized) : null;
}

function businessSummaryEmpty(): BusinessDataSummary {
  return {
    dateStart: '',
    dateEnd: '',
    dayCount: 0,
    platformCount: 0,
    grossSales: 0,
    actualReceipt: 0,
    merchantIncome: 0,
    validOrders: 0,
    invalidOrders: 0,
    exposureUsers: 0,
    visitUsers: 0,
    orderUsers: 0,
    visitRate: null,
    orderRate: null,
    customerBreakdownProvided: false,
    newExposureUsers: 0,
    oldExposureUsers: 0,
    newVisitUsers: 0,
    oldVisitUsers: 0,
    newOrderUsers: 0,
    oldOrderUsers: 0,
    newVisitRate: null,
    oldVisitRate: null,
    newOrderRate: null,
    oldOrderRate: null,
    newOrderShare: null,
    oldOrderShare: null,
    repeatDataProvided: false,
    repeatUsers7d: 0,
    repeatRate7d: null,
    repeatUsers30d: 0,
    repeatRate30d: null,
    platformRepeatRate: null,
    averageReceipt: 0,
    merchantActivityCost: 0,
    merchantActivityCostWithoutFull: 0,
    platformSubsidy: 0,
    totalActivitySubsidy: 0,
    commission: 0,
    deliveryServiceFee: 0,
    packageFee: 0,
    activityCostRate: null,
    merchantCostPerOrder: null,
    tradedProductRate: null
  };
}

function sumBusinessNumber(records: BusinessDailyRecord[], field: keyof BusinessDailyRecord) {
  return roundMoney(records.reduce((sum, row) => sum + (Number(row[field]) || 0), 0));
}

function averageBusinessRecordRate(records: BusinessDailyRecord[], field: keyof BusinessDailyRecord) {
  const values = records
    .map(row => row[field])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? average(values) : null;
}

function businessRollingRepeatRate(records: BusinessDailyRecord[], usersField: keyof BusinessDailyRecord, rateField: keyof BusinessDailyRecord) {
  let numerator = 0;
  let denominator = 0;
  records.forEach(row => {
    const users = Number(row[usersField]) || 0;
    const rate = row[rateField];
    if (users > 0 && typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
      numerator += users;
      denominator += users / rate;
    }
  });
  if (denominator > 0) return numerator / denominator;
  return averageBusinessRecordRate(records, rateField);
}

function summarizeBusinessRecords(records: BusinessDailyRecord[]): BusinessDataSummary {
  if (!records.length) return businessSummaryEmpty();
  const sorted = records.slice().sort((a, b) => a.date.localeCompare(b.date));
  const grossSales = sumBusinessNumber(records, 'grossSales');
  const actualReceipt = sumBusinessNumber(records, 'actualReceipt');
  const merchantIncome = sumBusinessNumber(records, 'merchantIncome');
  const validOrders = Math.round(sumBusinessNumber(records, 'validOrders'));
  const invalidOrders = Math.round(sumBusinessNumber(records, 'invalidOrders'));
  const exposureUsers = Math.round(sumBusinessNumber(records, 'exposureUsers'));
  const visitUsers = Math.round(sumBusinessNumber(records, 'visitUsers'));
  const orderUsers = Math.round(sumBusinessNumber(records, 'orderUsers'));
  const customerRows = records.filter(row => row.customerBreakdownProvided);
  const newExposureUsers = Math.round(sumBusinessNumber(customerRows, 'newExposureUsers'));
  const oldExposureUsers = Math.round(sumBusinessNumber(customerRows, 'oldExposureUsers'));
  const newVisitUsers = Math.round(sumBusinessNumber(customerRows, 'newVisitUsers'));
  const oldVisitUsers = Math.round(sumBusinessNumber(customerRows, 'oldVisitUsers'));
  const newOrderUsers = Math.round(sumBusinessNumber(customerRows, 'newOrderUsers'));
  const oldOrderUsers = Math.round(sumBusinessNumber(customerRows, 'oldOrderUsers'));
  const customerOrderUsers = newOrderUsers + oldOrderUsers;
  const repeatRows = records.filter(row => row.repeatDataProvided);
  const repeatUsers7d = Math.round(sumBusinessNumber(repeatRows, 'repeatUsers7d'));
  const repeatUsers30d = Math.round(sumBusinessNumber(repeatRows, 'repeatUsers30d'));
  const merchantActivityCost = sumBusinessNumber(records, 'merchantActivityCost');
  const merchantActivityCostWithoutFull = sumBusinessNumber(records, 'merchantActivityCostWithoutFull');
  const platformSubsidy = sumBusinessNumber(records, 'platformSubsidy');
  const totalActivitySubsidy = sumBusinessNumber(records, 'totalActivitySubsidy');
  const listedProducts = Math.round(sumBusinessNumber(records, 'listedProducts'));
  const tradedProducts = Math.round(sumBusinessNumber(records, 'tradedProducts'));
  return {
    dateStart: sorted[0].date,
    dateEnd: sorted[sorted.length - 1].date,
    dayCount: new Set(records.map(row => row.date)).size,
    platformCount: new Set(records.map(row => row.platform)).size,
    grossSales,
    actualReceipt,
    merchantIncome,
    validOrders,
    invalidOrders,
    exposureUsers,
    visitUsers,
    orderUsers,
    visitRate: exposureUsers > 0 ? visitUsers / exposureUsers : null,
    orderRate: visitUsers > 0 ? orderUsers / visitUsers : null,
    customerBreakdownProvided: customerRows.length > 0,
    newExposureUsers,
    oldExposureUsers,
    newVisitUsers,
    oldVisitUsers,
    newOrderUsers,
    oldOrderUsers,
    newVisitRate: newExposureUsers > 0 ? newVisitUsers / newExposureUsers : null,
    oldVisitRate: oldExposureUsers > 0 ? oldVisitUsers / oldExposureUsers : null,
    newOrderRate: newVisitUsers > 0 ? newOrderUsers / newVisitUsers : null,
    oldOrderRate: oldVisitUsers > 0 ? oldOrderUsers / oldVisitUsers : null,
    newOrderShare: customerOrderUsers > 0 ? newOrderUsers / customerOrderUsers : null,
    oldOrderShare: customerOrderUsers > 0 ? oldOrderUsers / customerOrderUsers : null,
    repeatDataProvided: repeatRows.length > 0,
    repeatUsers7d,
    repeatRate7d: businessRollingRepeatRate(repeatRows, 'repeatUsers7d', 'repeatRate7d'),
    repeatUsers30d,
    repeatRate30d: businessRollingRepeatRate(repeatRows, 'repeatUsers30d', 'repeatRate30d'),
    platformRepeatRate: averageBusinessRecordRate(repeatRows, 'platformRepeatRate'),
    averageReceipt: validOrders > 0 ? actualReceipt / validOrders : 0,
    merchantActivityCost,
    merchantActivityCostWithoutFull,
    platformSubsidy,
    totalActivitySubsidy,
    commission: sumBusinessNumber(records, 'commission'),
    deliveryServiceFee: sumBusinessNumber(records, 'deliveryServiceFee'),
    packageFee: sumBusinessNumber(records, 'packageFee'),
    activityCostRate: grossSales > 0 ? merchantActivityCost / grossSales : null,
    merchantCostPerOrder: validOrders > 0 ? merchantActivityCost / validOrders : null,
    tradedProductRate: listedProducts > 0 ? tradedProducts / listedProducts : null
  };
}

function aggregateBusinessRecordsByDate(records: BusinessDailyRecord[]): BusinessDailyAggregate[] {
  const byDate = new Map<string, BusinessDailyRecord[]>();
  records.forEach(row => {
    byDate.set(row.date, (byDate.get(row.date) || []).concat(row));
  });
  return Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, rows]) => ({
      ...summarizeBusinessRecords(rows),
      key: date,
      date
    }));
}

function aggregateBusinessRecordsByPlatform(records: BusinessDailyRecord[]): BusinessPlatformAggregate[] {
  return PLATFORMS.flatMap(platform => {
    const rows = records.filter(row => row.platform === platform);
    if (!rows.length) return [];
    return [{
        ...summarizeBusinessRecords(rows),
        key: platform,
        platform,
        platformName: PLATFORM_NAMES[platform]
    }];
  });
}

function aggregateBusinessRecordsByWeekday(records: BusinessDailyRecord[]): BusinessWeekComparisonRow[] {
  const byWeekPlatform = new Map<string, BusinessDailyRecord[]>();
  records.forEach(row => {
    const weekStart = businessWeekStart(row.date);
    if (!weekStart) return;
    const key = `${weekStart}:${row.platform}`;
    byWeekPlatform.set(key, (byWeekPlatform.get(key) || []).concat(row));
  });
  return Array.from(byWeekPlatform.entries())
    .map(([key, rows]) => {
      const first = rows[0];
      const weekStart = businessWeekStart(first.date);
      const byDate = new Map<string, BusinessDailyRecord[]>();
      rows.forEach(row => {
        byDate.set(row.date, (byDate.get(row.date) || []).concat(row));
      });
      const days: Record<number, BusinessWeekdayCell | undefined> = {};
      Array.from(byDate.entries()).forEach(([date, dateRows]) => {
        const weekdayIndex = businessWeekdayIndex(date);
        days[weekdayIndex] = {
          ...summarizeBusinessRecords(dateRows),
          date,
          weekdayIndex
        };
      });
      return {
        key,
        weekStart,
        weekEnd: businessAddDays(weekStart, 6),
        weekLabel: businessWeekLabel(weekStart),
        platform: first.platform,
        platformName: first.platformName,
        days,
        total: summarizeBusinessRecords(rows)
      };
    })
    .sort((a, b) => b.weekStart.localeCompare(a.weekStart) || a.platform.localeCompare(b.platform));
}

function businessMetricValue(row: BusinessDataSummary, metric: BusinessDataMetricKey) {
  if (metric === 'tradedProductRate') return row.tradedProductRate;
  return row[metric];
}

function businessMetricName(metric: BusinessDataMetricKey) {
  return {
    actualReceipt: '实收',
    validOrders: '有效订单',
    exposureUsers: '曝光人数',
    visitRate: '入店率',
    orderRate: '下单率',
    merchantActivityCost: '商家活动成本',
    tradedProductRate: '动销率',
    newOrderUsers: '新客下单人数',
    oldOrderUsers: '老客下单人数',
    newOrderRate: '新客下单率',
    oldOrderRate: '老客下单率',
    repeatRate7d: '近7日复购率',
    repeatRate30d: '近30日复购率',
    platformRepeatRate: '平台复购率'
  }[metric];
}

function businessMetricText(metric: BusinessDataMetricKey, value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (metric === 'visitRate' || metric === 'orderRate' || metric === 'tradedProductRate' || metric === 'newOrderRate' || metric === 'oldOrderRate' || metric === 'repeatRate7d' || metric === 'repeatRate30d' || metric === 'platformRepeatRate') return rateText(value);
  if (metric === 'validOrders' || metric === 'exposureUsers' || metric === 'newOrderUsers' || metric === 'oldOrderUsers') return `${Math.round(value)}`;
  return `¥${money(value)}`;
}

function businessFunnelMetrics(row: BusinessFunnelMetricSource) {
  const visitRate = row.visitRate ?? (row.exposureUsers > 0 ? row.visitUsers / row.exposureUsers : null);
  const orderRate = row.orderRate ?? (row.visitUsers > 0 ? row.orderUsers / row.visitUsers : null);
  const exposureVisitLoss = Math.max(0, row.exposureUsers - row.visitUsers);
  const visitOrderLoss = Math.max(0, row.visitUsers - row.orderUsers);
  const exposureVisitLossRate = visitRate === null ? null : Math.max(0, 1 - visitRate);
  const visitOrderLossRate = orderRate === null ? null : Math.max(0, 1 - orderRate);
  const orderValidRate = row.orderUsers > 0 ? row.validOrders / row.orderUsers : null;
  const exposureValidRate = row.exposureUsers > 0 ? row.validOrders / row.exposureUsers : null;
  let bottleneck = '-';
  if (exposureVisitLossRate !== null || visitOrderLossRate !== null) {
    bottleneck = (exposureVisitLossRate ?? -1) >= (visitOrderLossRate ?? -1) ? '曝光到入店' : '入店到下单';
  }
  return {
    visitRate,
    orderRate,
    exposureVisitLoss,
    visitOrderLoss,
    exposureVisitLossRate,
    visitOrderLossRate,
    orderValidRate,
    exposureValidRate,
    bottleneck
  };
}

function businessFunnelStageText(row: BusinessFunnelMetricSource) {
  return `曝光 ${row.exposureUsers} → 入店 ${row.visitUsers} → 下单 ${row.orderUsers}`;
}

function businessFunnelChartRows(row: BusinessFunnelMetricSource): BusinessFunnelChartRow[] {
  const stages = [
    { key: 'exposure', stage: '曝光人数', value: row.exposureUsers },
    { key: 'visit', stage: '入店人数', value: row.visitUsers },
    { key: 'order', stage: '下单数', value: row.orderUsers }
  ];
  return stages.map((stage, index) => {
    const value = Math.max(0, Math.round(Number(stage.value) || 0));
    const prevValue = index > 0 ? Math.max(0, Math.round(Number(stages[index - 1].value) || 0)) : null;
    const totalConversionText = row.exposureUsers > 0 ? `全链路 ${rateText(value / row.exposureUsers)}` : '全链路 -';
    const conversionTitleText = stage.key === 'visit' ? '入店率' : stage.key === 'order' ? '下单率' : '';
    const conversionRateText = prevValue === null ? '' : prevValue > 0 ? rateText(value / prevValue) : '-';
    const conversionText = conversionTitleText ? `${conversionTitleText} ${conversionRateText}` : '起点';
    return {
      ...stage,
      value,
      valueText: `${value}`,
      conversionTitleText,
      conversionRateText,
      conversionText,
      totalConversionText
    };
  });
}

function businessCustomerFunnelChartRows(row: BusinessDataSummary, segment: 'new' | 'old'): BusinessFunnelChartRow[] {
  if (!row.customerBreakdownProvided) return [];
  const exposureUsers = segment === 'new' ? row.newExposureUsers : row.oldExposureUsers;
  const visitUsers = segment === 'new' ? row.newVisitUsers : row.oldVisitUsers;
  const orderUsers = segment === 'new' ? row.newOrderUsers : row.oldOrderUsers;
  return businessFunnelChartRows({
    exposureUsers,
    visitUsers,
    orderUsers,
    validOrders: orderUsers,
    visitRate: exposureUsers > 0 ? visitUsers / exposureUsers : null,
    orderRate: visitUsers > 0 ? orderUsers / visitUsers : null
  });
}

function businessPrimaryRepeatRate(row: Pick<BusinessDataSummary, 'repeatRate7d' | 'repeatRate30d' | 'platformRepeatRate'>) {
  if (row.repeatRate30d !== null) return { label: '近30日复购率', value: row.repeatRate30d };
  if (row.repeatRate7d !== null) return { label: '近7日复购率', value: row.repeatRate7d };
  if (row.platformRepeatRate !== null) return { label: '平台复购率', value: row.platformRepeatRate };
  return { label: '复购率', value: null };
}

function businessRepeatSummaryText(row: Pick<BusinessDataSummary, 'repeatUsers7d' | 'repeatRate7d' | 'repeatUsers30d' | 'repeatRate30d' | 'platformRepeatRate'>) {
  const parts = [
    row.repeatRate7d === null ? '' : `近7日 ${rateText(row.repeatRate7d)}${row.repeatUsers7d ? ` / ${row.repeatUsers7d}人` : ''}`,
    row.repeatRate30d === null ? '' : `近30日 ${rateText(row.repeatRate30d)}${row.repeatUsers30d ? ` / ${row.repeatUsers30d}人` : ''}`,
    row.platformRepeatRate === null ? '' : `平台原始 ${rateText(row.platformRepeatRate)}`
  ].filter(Boolean);
  return parts.length ? parts.join('；') : '日报未提供';
}

function businessChangeText(metric: BusinessDataMetricKey, current: number | null, baseline: number | null) {
  if (current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return '-';
  const diff = current - baseline;
  const relative = diff / baseline;
  if (metric === 'visitRate' || metric === 'orderRate' || metric === 'tradedProductRate' || metric === 'newOrderRate' || metric === 'oldOrderRate' || metric === 'repeatRate7d' || metric === 'repeatRate30d' || metric === 'platformRepeatRate') {
    return `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(2)}pp / ${relative >= 0 ? '+' : ''}${(relative * 100).toFixed(1)}%`;
  }
  if (metric === 'validOrders' || metric === 'exposureUsers' || metric === 'newOrderUsers' || metric === 'oldOrderUsers') {
    return `${diff >= 0 ? '+' : ''}${Math.round(diff)} / ${relative >= 0 ? '+' : ''}${(relative * 100).toFixed(1)}%`;
  }
  return `${diff >= 0 ? '+' : ''}¥${money(Math.abs(diff))} / ${relative >= 0 ? '+' : ''}${(relative * 100).toFixed(1)}%`;
}

function averageBusinessMetric(rows: BusinessDailyAggregate[], metric: BusinessDataMetricKey) {
  const values = rows
    .map(row => businessMetricValue(row, metric))
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length ? average(values) : null;
}

function businessDiagnosticColor(severity: Severity) {
  if (severity === 'critical') return 'red';
  if (severity === 'high') return 'orange';
  if (severity === 'medium') return 'gold';
  if (severity === 'config') return 'blue';
  return 'green';
}

function businessDiagnosticSeverityText(severity: Severity) {
  return { critical: '严重', high: '高', medium: '中', config: '提示', none: '正常' }[severity];
}

function appendBusinessDropDiagnostic(
  items: BusinessDiagnosticItem[],
  scopeName: string,
  metric: BusinessDataMetricKey,
  current: number | null,
  baseline: number | null,
  options: { relativeDrop: number; absoluteDrop: number; key: string; suggestion: string; date: string }
) {
  if (current === null || baseline === null || !Number.isFinite(current) || !Number.isFinite(baseline) || baseline <= 0) return;
  const drop = baseline - current;
  const relativeDrop = drop / baseline;
  if (drop < options.absoluteDrop && relativeDrop < options.relativeDrop) return;
  const metricName = businessMetricName(metric);
  items.push({
    key: options.key,
    severity: relativeDrop >= 0.3 ? 'high' : 'medium',
    title: `${scopeName}${metricName}下降`,
    description: `${options.date} 的${metricName}低于前序日期均值，变化为 ${businessChangeText(metric, current, baseline)}。`,
    suggestion: options.suggestion,
    currentText: businessMetricText(metric, current),
    baselineText: businessMetricText(metric, baseline)
  });
}

function appendBusinessTrendDiagnostics(items: BusinessDiagnosticItem[], scopeName: string, rows: BusinessDailyAggregate[], keyPrefix: string) {
  const sorted = rows.slice().sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return;
  const latest = sorted[sorted.length - 1];
  const baselineRows = sorted.slice(0, -1);
  const date = latest.date;
  appendBusinessDropDiagnostic(items, scopeName, 'validOrders', latest.validOrders, averageBusinessMetric(baselineRows, 'validOrders'), {
    relativeDrop: 0.2,
    absoluteDrop: 2,
    key: `${keyPrefix}-orders`,
    date,
    suggestion: '先看曝光人数和入店率是否同步下降；如果流量正常，再排查活动力度、商品排序和高销量商品是否异常。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'actualReceipt', latest.actualReceipt, averageBusinessMetric(baselineRows, 'actualReceipt'), {
    relativeDrop: 0.2,
    absoluteDrop: 30,
    key: `${keyPrefix}-receipt`,
    date,
    suggestion: '拆到订单数和单均实付：订单数下降优先看流量转化，单均下降优先看券、满减和商品结构。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'exposureUsers', latest.exposureUsers, averageBusinessMetric(baselineRows, 'exposureUsers'), {
    relativeDrop: 0.2,
    absoluteDrop: 10,
    key: `${keyPrefix}-exposure`,
    date,
    suggestion: '检查平台曝光、营业时段、配送范围、排名和库存状态，判断是否是平台流量入口变少。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'visitRate', latest.visitRate, averageBusinessMetric(baselineRows, 'visitRate'), {
    relativeDrop: 0.2,
    absoluteDrop: 0.01,
    key: `${keyPrefix}-visit-rate`,
    date,
    suggestion: '优先检查门店头像、起送价、配送费、评分展示、头图和主推商品价格是否影响进店。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'orderRate', latest.orderRate, averageBusinessMetric(baselineRows, 'orderRate'), {
    relativeDrop: 0.2,
    absoluteDrop: 0.03,
    key: `${keyPrefix}-order-rate`,
    date,
    suggestion: '优先检查活动后支付价、满减断档、券密度、商品库存和高销量商品是否缺失。'
  });
}

function appendBusinessCustomerDiagnostics(items: BusinessDiagnosticItem[], scopeName: string, rows: BusinessDailyAggregate[], keyPrefix: string) {
  const sorted = rows
    .filter(row => row.customerBreakdownProvided || row.repeatDataProvided)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < 2) return;
  const latest = sorted[sorted.length - 1];
  const baselineRows = sorted.slice(0, -1);
  const date = latest.date;
  appendBusinessDropDiagnostic(items, scopeName, 'newOrderUsers', latest.newOrderUsers, averageBusinessMetric(baselineRows, 'newOrderUsers'), {
    relativeDrop: 0.25,
    absoluteDrop: 2,
    key: `${keyPrefix}-new-customer-orders`,
    date,
    suggestion: '新客成交下降时优先检查平台新客曝光入口、新客券力度、起送价和主推商品首单吸引力。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'newOrderRate', latest.newOrderRate, averageBusinessMetric(baselineRows, 'newOrderRate'), {
    relativeDrop: 0.2,
    absoluteDrop: 0.03,
    key: `${keyPrefix}-new-customer-order-rate`,
    date,
    suggestion: '新客下单率下降通常和首单价格感知、券门槛、配送费、爆品排序有关，优先看新客到店后的支付价是否有吸引力。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'oldOrderUsers', latest.oldOrderUsers, averageBusinessMetric(baselineRows, 'oldOrderUsers'), {
    relativeDrop: 0.25,
    absoluteDrop: 2,
    key: `${keyPrefix}-old-customer-orders`,
    date,
    suggestion: '老客成交下降时优先检查复购商品稳定性、缺货、出餐体验、老客券和近期评价波动。'
  });
  appendBusinessDropDiagnostic(items, scopeName, 'oldOrderRate', latest.oldOrderRate, averageBusinessMetric(baselineRows, 'oldOrderRate'), {
    relativeDrop: 0.2,
    absoluteDrop: 0.03,
    key: `${keyPrefix}-old-customer-order-rate`,
    date,
    suggestion: '老客下单率下降说明进店后的复购转化变弱，重点排查常购商品、价格变化、活动缩水和配送体验。'
  });
  const repeatMetric: BusinessDataMetricKey | null = latest.repeatRate30d !== null
    ? 'repeatRate30d'
    : latest.repeatRate7d !== null
      ? 'repeatRate7d'
      : latest.platformRepeatRate !== null
        ? 'platformRepeatRate'
        : null;
  if (repeatMetric) {
    appendBusinessDropDiagnostic(items, scopeName, repeatMetric, businessMetricValue(latest, repeatMetric), averageBusinessMetric(baselineRows, repeatMetric), {
      relativeDrop: 0.15,
      absoluteDrop: 0.01,
      key: `${keyPrefix}-repeat-rate`,
      date,
      suggestion: '复购率下降时优先检查老客券、常购商品库存、活动连续性、差评投诉和出餐配送稳定性。'
    });
  }
}

function diagnoseBusinessRecords(records: BusinessDailyRecord[]): BusinessDiagnosticItem[] {
  const items: BusinessDiagnosticItem[] = [];
  const dailyRows = aggregateBusinessRecordsByDate(records);
  appendBusinessTrendDiagnostics(items, '全店', dailyRows, 'all');
  appendBusinessCustomerDiagnostics(items, '全店', dailyRows, 'all-customer');
  PLATFORMS.forEach(platform => {
    const platformRows = aggregateBusinessRecordsByDate(records.filter(row => row.platform === platform));
    appendBusinessTrendDiagnostics(items, PLATFORM_NAMES[platform], platformRows, platform);
    appendBusinessCustomerDiagnostics(items, PLATFORM_NAMES[platform], platformRows, `${platform}-customer`);
  });

  const summary = summarizeBusinessRecords(records);
  if (summary.activityCostRate !== null && summary.activityCostRate >= 0.35) {
    items.push({
      key: 'activity-cost-rate',
      severity: summary.activityCostRate >= 0.45 ? 'high' : 'medium',
      title: '商家活动成本偏高',
      description: `当前范围商家活动成本占营业额 ${rateText(summary.activityCostRate)}，平台补贴已单独展示，不计入成本异常判断。`,
      suggestion: '结合活动设计页核对满减、券和加码是否叠加过深，优先收紧低利润支付价区间。',
      currentText: rateText(summary.activityCostRate),
      baselineText: '建议低于35%'
    });
  }
  if (summary.tradedProductRate !== null && summary.tradedProductRate < 0.12) {
    items.push({
      key: 'traded-product-rate',
      severity: 'medium',
      title: '商品动销偏窄',
      description: `当前有交易商品占上架商品 ${rateText(summary.tradedProductRate)}，订单可能集中在少数商品。`,
      suggestion: '排查主推商品、套餐组合和加购品是否覆盖核心支付价；必要时下架弱商品或调整排序。',
      currentText: rateText(summary.tradedProductRate),
      baselineText: '建议不低于12%'
    });
  }
  const outOfStockProducts = records.reduce((sum, row) => sum + row.outOfStockProducts, 0);
  if (outOfStockProducts > 0) {
    items.push({
      key: 'out-of-stock',
      severity: 'medium',
      title: '存在库存不足商品',
      description: `当前范围累计出现 ${outOfStockProducts} 个库存不足商品，可能影响下单转化和商品结构。`,
      suggestion: '优先恢复高点击、高成交商品库存，再检查活动商品是否被库存状态截断。',
      currentText: `${outOfStockProducts}`,
      baselineText: '0'
    });
  }
  const totalOrders = summary.validOrders + summary.invalidOrders;
  if (totalOrders > 0 && summary.invalidOrders / totalOrders >= 0.15) {
    items.push({
      key: 'invalid-order-rate',
      severity: 'medium',
      title: '异常订单占比偏高',
      description: `当前范围无效订单占比 ${rateText(summary.invalidOrders / totalOrders)}，已按有效订单口径分析核心经营指标。`,
      suggestion: '检查取消原因、商责取消和履约问题；异常订单过高会拉低真实转化质量。',
      currentText: rateText(summary.invalidOrders / totalOrders),
      baselineText: '建议低于15%'
    });
  }
  const merchantCancelOrders = records.reduce((sum, row) => sum + row.merchantCancelOrders, 0);
  if (merchantCancelOrders > 0) {
    items.push({
      key: 'merchant-cancel',
      severity: 'medium',
      title: '存在商责取消',
      description: `当前范围累计商责取消 ${merchantCancelOrders} 单，可能影响平台流量分发和转化。`,
      suggestion: '复核出餐、缺货、配送交接和营业时段设置，避免商责问题放大到流量端。',
      currentText: `${merchantCancelOrders}`,
      baselineText: '0'
    });
  }
  const warningTexts = Array.from(new Set(records.flatMap(row => row.warnings))).filter(Boolean);
  warningTexts.forEach((warning, index) => {
    items.push({
      key: `warning-${index}`,
      severity: 'config',
      title: '字段提示',
      description: warning,
      suggestion: '该提示不阻断导入，但对应模块的诊断粒度会受限。',
      currentText: '已提示',
      baselineText: '-'
    });
  });
  if (!items.length) {
    items.push({
      key: 'no-risk',
      severity: 'none',
      title: '暂无明显异常',
      description: '当前筛选范围内没有触发单量、转化、流量、成本或商品结构异常规则。',
      suggestion: '继续观察最近一天与前序日期均值的变化，重点看实收、入店率和下单率。',
      currentText: '正常',
      baselineText: '-'
    });
  }
  return items;
}

function businessReportExportRows(records: BusinessDailyRecord[], notes: BusinessAnalysisNote[] = []) {
  return records
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform))
    .map(row => {
      const funnel = businessFunnelMetrics(row);
      const memoText = notes
        .filter(note => businessNoteMatchesRecord(note, row))
        .map(note => `${note.title}：${businessNoteItemsText(note)}`)
        .filter(Boolean)
        .join('；');
      return {
        日期: row.date,
        平台: row.platformName,
        门店: row.storeName,
        平台门店: row.externalStoreName,
        实收: money(row.actualReceipt),
        营业额: money(row.grossSales),
        商家收入: money(row.merchantIncome),
        有效订单: row.validOrders,
        无效订单: row.invalidOrders,
        单均实付: money(row.averageReceipt),
        曝光人数: row.exposureUsers,
        入店人数: row.visitUsers,
        下单人数: row.orderUsers,
        入店率: row.visitRate === null ? '' : rateText(row.visitRate),
        下单率: row.orderRate === null ? '' : rateText(row.orderRate),
        新客曝光人数: row.customerBreakdownProvided ? row.newExposureUsers : '',
        新客入店人数: row.customerBreakdownProvided ? row.newVisitUsers : '',
        新客下单人数: row.customerBreakdownProvided ? row.newOrderUsers : '',
        新客入店率: row.newVisitRate === null ? '' : rateText(row.newVisitRate),
        新客下单率: row.newOrderRate === null ? '' : rateText(row.newOrderRate),
        老客曝光人数: row.customerBreakdownProvided ? row.oldExposureUsers : '',
        老客入店人数: row.customerBreakdownProvided ? row.oldVisitUsers : '',
        老客下单人数: row.customerBreakdownProvided ? row.oldOrderUsers : '',
        老客入店率: row.oldVisitRate === null ? '' : rateText(row.oldVisitRate),
        老客下单率: row.oldOrderRate === null ? '' : rateText(row.oldOrderRate),
        近7日复购人数: row.repeatDataProvided ? row.repeatUsers7d : '',
        近7日复购率: row.repeatRate7d === null ? '' : rateText(row.repeatRate7d),
        近30日复购人数: row.repeatDataProvided ? row.repeatUsers30d : '',
        近30日复购率: row.repeatRate30d === null ? '' : rateText(row.repeatRate30d),
        平台复购率: row.platformRepeatRate === null ? '' : rateText(row.platformRepeatRate),
        曝光到入店流失: funnel.exposureVisitLoss,
        曝光到入店流失率: funnel.exposureVisitLossRate === null ? '' : rateText(funnel.exposureVisitLossRate),
        入店到下单流失: funnel.visitOrderLoss,
        入店到下单流失率: funnel.visitOrderLossRate === null ? '' : rateText(funnel.visitOrderLossRate),
        有效订单转化率: funnel.orderValidRate === null ? '' : rateText(funnel.orderValidRate),
        全链路订单转化率: funnel.exposureValidRate === null ? '' : rateText(funnel.exposureValidRate),
        漏斗主要断点: funnel.bottleneck,
        商家活动成本: money(row.merchantActivityCost),
        平台补贴不计成本: money(row.platformSubsidy),
        佣金及技术服务费: money(row.commission),
        配送服务费: money(row.deliveryServiceFee),
        上架商品数: row.listedProducts || '',
        有交易商品数: row.tradedProducts || '',
        库存不足商品数: row.outOfStockProducts || '',
        备注: memoText,
        来源文件: row.sourceFileName,
        导入时间: row.importedAt
      };
    });
}

function businessImportedAtText(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
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

async function loadActivityPriceScanRecordFromBrowserDb(storeId: string) {
  return browserDbStoreTransaction<PersistedActivityPriceScanRecord | undefined>(ACTIVITY_PRICE_SCANS_STORE, 'readonly', store => store.get(activityPriceScanRecordKey(storeId)));
}

async function saveMeasurementRecordToBrowserDb(store: Store, scenario: StapleScenario, settings: MeasurementSettings, result: MeasurementResult) {
  const record = buildPersistedMeasurementRecord(store, scenario, settings, result);
  await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
  return record;
}

async function saveActivityPriceScanRecordToBrowserDb(
  state: CalculatorState,
  store: Store,
  settings: ActivityDesignSettings,
  result: RedesignedActivityDesignResult
) {
  const previousRecord = await loadActivityPriceScanRecordFromBrowserDb(store.id);
  const record = buildPersistedActivityPriceScanRecord(state, store, settings, result);
  await browserDbStoreTransaction<IDBValidKey>(ACTIVITY_PRICE_SCANS_STORE, 'readwrite', objectStore => objectStore.put(record));
  await deleteLegacyActivityPriceScanRecordChunksFromBrowserDb(previousRecord);
  return record;
}

async function deleteLegacyActivityPriceScanRecordChunksFromBrowserDb(record: unknown) {
  const chunkKeys = Array.isArray((record as { chunkKeys?: unknown } | undefined)?.chunkKeys)
    ? (record as { chunkKeys: string[] }).chunkKeys
    : [];
  if (!chunkKeys.length) return;
  await browserDbStoreAction(ACTIVITY_PRICE_SCANS_STORE, 'readwrite', objectStore => {
    chunkKeys.forEach(key => objectStore.delete(key));
    return undefined;
  });
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
  loadActivityPriceScanRecord: (storeId: string) => Promise<PersistedActivityPriceScanRecord | undefined>;
  saveActivityPriceScanRecord: (state: CalculatorState, store: Store, settings: ActivityDesignSettings, result: RedesignedActivityDesignResult) => Promise<PersistedActivityPriceScanRecord>;
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
  loadActivityPriceScanRecord: loadActivityPriceScanRecordFromBrowserDb,
  saveActivityPriceScanRecord: saveActivityPriceScanRecordToBrowserDb,
  deleteMeasurementRecordChunks: deleteMeasurementRecordChunksFromBrowserDb,
  createMeasurementChunkWriter,
  saveChunkedMeasurementRecord: saveChunkedMeasurementRecordToBrowserDb,
  loadMeasurementRows: loadMeasurementRowsFromBrowserDb
};

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

function PriceBucketProfitChart({ rows }: { rows: ActivityPriceBucketRow[] }) {
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
          scroll={{ x: 1760 }}
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

function WaimaiCalculatorInner() {
  const { message, modal } = AntApp.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const routePage = useMemo(() => pageFromPathname(pathname || '/'), [pathname]);
  const routePageRef = React.useRef(routePage);
  const stateRef = React.useRef<CalculatorState>(deepClone(defaultState));
  const asyncCalculationSeqRef = React.useRef(0);
  const measurementCacheWarmupSeqRef = React.useRef(0);
  const activityPriceScanLoadSeqRef = React.useRef(0);
  const resultBandLoadSeqRef = React.useRef(0);
  const measurementCacheWarmupIdleRef = React.useRef<number | null>(null);
  const measurementCacheWarmupTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const measurementCacheWarmupControllerRef = React.useRef<AbortController | null>(null);
  const resultScenarioRef = React.useRef<StapleScenario>(MEASUREMENT_RESULT_SCENARIO);
  const activityDesignByScenarioRef = React.useRef(createScenarioRecord<RedesignedActivityDesignResult | null>(() => null));
  const activityPriceScanPersistenceMetaRef = React.useRef<ActivityPriceScanPersistenceMeta | null>(null);
  const latestAsyncCalculationTokenRef = React.useRef<Partial<Record<AsyncCalculationSlot, string>>>({});
  const activeAsyncCalculationRef = React.useRef<Partial<Record<AsyncCalculationSlot, AsyncCalculationTask>>>({});
  const pendingAsyncCalculationResultRef = React.useRef<Partial<Record<AsyncCalculationSlot, PendingAsyncCalculationResult>>>({});
  const [state, setState] = useState<CalculatorState>(() => deepClone(defaultState));
  const [resultPlatformTab, setResultPlatformTab] = useState<Platform>('meituan');
  const [activityDesignPlatformTab, setActivityDesignPlatformTab] = useState<Platform>('meituan');
  const [pricingPlatformFilter, setPricingPlatformFilter] = useState<Platform | 'all'>('all');
  const [businessAnalysisPlatform, setBusinessAnalysisPlatform] = useState<Platform | 'all'>('all');
  const [businessAnalysisDateStart, setBusinessAnalysisDateStart] = useState('');
  const [businessAnalysisDateEnd, setBusinessAnalysisDateEnd] = useState('');
  const [orderAnalysisPlatform, setOrderAnalysisPlatform] = useState<OrderAnalysisPlatformFilter>('all');
  const [orderAnalysisDateStart, setOrderAnalysisDateStart] = useState('');
  const [orderAnalysisDateEnd, setOrderAnalysisDateEnd] = useState('');
  const [businessNoteEditor, setBusinessNoteEditor] = useState<BusinessNoteEditorState | null>(null);
  const [activityDesignFilters, setActivityDesignFilters] = useState<ActivityDesignPageFilters>(DEFAULT_ACTIVITY_DESIGN_PAGE_FILTERS);
  const [pricingSettings, setPricingSettings] = useState<PricingEvaluationSettings>(DEFAULT_PRICING_EVALUATION_SETTINGS);
  const [measurementSettings, setMeasurementSettings] = useState<MeasurementSettings>(DEFAULT_MEASUREMENT_SETTINGS);
  const [riskOnly, setRiskOnly] = useState(false);
  const [isStoreEditing, setIsStoreEditing] = useState(false);
  const [storeDraft, setStoreDraft] = useState<Store | null>(null);
  const [isProductsEditing, setIsProductsEditing] = useState(false);
  const [productsDraft, setProductsDraft] = useState<Product[] | null>(null);
  const [isPlatformEditing, setIsPlatformEditing] = useState(false);
  const [platformDraft, setPlatformDraft] = useState<FeeRule | null>(null);
  const [isSystemStrategyEditing, setIsSystemStrategyEditing] = useState(false);
  const [systemStrategyDraft, setSystemStrategyDraft] = useState<ActivityStrategySettings | null>(null);
  const [activityDiscountTierEditor, setActivityDiscountTierEditor] = useState<ActivityDiscountTierEditorState | null>(null);
  const [activityDiscountTierDraft, setActivityDiscountTierDraft] = useState<ActivityOriginalDiscountTier[]>([]);
  const [activityDiscountTierBatchDraft, setActivityDiscountTierBatchDraft] = useState<ActivityDiscountTierBatchDraft>({ start: 0, end: 80, step: 10, rate: 30 });
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
  const [activityPriceScanPersistenceMeta, setActivityPriceScanPersistenceMeta] = useState<ActivityPriceScanPersistenceMeta | null>(null);
  const [lastOptimizationsByScenario, setLastOptimizationsByScenario] = useState(() => createScenarioRecord<OptimizationRow[]>(() => []));
  const [resultSummariesByScenario, setResultSummariesByScenario] = useState(() => createScenarioRecord<Summary>(() => ({ ...EMPTY_SUMMARY })));
  const [resultWarningsByScenario, setResultWarningsByScenario] = useState(() => createScenarioRecord<string[]>(() => []));
  const [optimizationWarningsByScenario, setOptimizationWarningsByScenario] = useState(() => createScenarioRecord<string[]>(() => []));
  const [activityDesignByScenario, setActivityDesignByScenario] = useState(() => createScenarioRecord<RedesignedActivityDesignResult | null>(() => null));
  const [pricingEvaluation, setPricingEvaluation] = useState<RedesignedPricingEvaluationResult | null>(null);
  const [selectedPricingProductKey, setSelectedPricingProductKey] = useState('');
  const [selectedResultBand, setSelectedResultBand] = useState<SelectedResultBand | null>(null);
  const [selectedActivityDesignBand, setSelectedActivityDesignBand] = useState<SelectedResultBand | null>(null);
  const [selectedActivityDesignPayBandKeyByPlatform, setSelectedActivityDesignPayBandKeyByPlatform] = useState<Record<Platform, string>>(() => ({ meituan: 'all', eleme: 'all' }));
  const [selectedActivityDesignRouteKey, setSelectedActivityDesignRouteKey] = useState('');
  const [selectedActivityCouponRoute, setSelectedActivityCouponRoute] = useState<ActivityRecommendationRow | null>(null);
  const [selectedActivityFullReductionLogRoute, setSelectedActivityFullReductionLogRoute] = useState<ActivityRecommendationRow | null>(null);
  const [activityDesignStage, setActivityDesignStage] = useState<ActivityDesignStage>('priceScan');
  const [selectedActivityOriginalBucket, setSelectedActivityOriginalBucket] = useState<ActivityPriceBucketRow | null>(null);
  const [selectedResultProduct, setSelectedResultProduct] = useState<SelectedResultProduct | null>(null);
  const [resultDetailSearchText, setResultDetailSearchText] = useState('');
  const [activityDesignDetailSearchText, setActivityDesignDetailSearchText] = useState('');
  const [resultProductPayRange, setResultProductPayRange] = useState<[number, number] | null>(null);
  const [loadedResultBandRows, setLoadedResultBandRows] = useState<LoadedResultBandRows | null>(null);
  const [isResultsLoading, setIsResultsLoading] = useState(false);
  const [isMeasurementCacheLoading, setIsMeasurementCacheLoading] = useState(false);
  const [isResultBandLoading, setIsResultBandLoading] = useState(false);
  const [isOptimizationLoading, setIsOptimizationLoading] = useState(false);
  const [isActivityDesignLoading, setIsActivityDesignLoading] = useState(false);
  const [isPricingEvaluationLoading, setIsPricingEvaluationLoading] = useState(false);
  const [summary, setSummary] = useState<Summary>({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
  const [warnings, setWarnings] = useState<string[]>([]);

  stateRef.current = state;
  resultScenarioRef.current = resultScenario;
  activityDesignByScenarioRef.current = activityDesignByScenario;
  activityPriceScanPersistenceMetaRef.current = activityPriceScanPersistenceMeta;
  const store = useMemo(() => currentStoreFrom(state), [state]);
  const businessStoreRecords = useMemo(() => {
    return state.businessData.records.filter(row => row.storeId === store.id);
  }, [state.businessData.records, store.id]);
  const businessDataDateBounds = useMemo(() => {
    if (!businessStoreRecords.length) return { start: '', end: '' };
    const dates = businessStoreRecords.map(row => row.date).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [businessStoreRecords]);
  const businessDateRangePickerValue = useMemo(() => {
    const start = businessDateToDayjs(businessAnalysisDateStart);
    const end = businessDateToDayjs(businessAnalysisDateEnd);
    return start && end ? [start, end] as [Dayjs, Dayjs] : null;
  }, [businessAnalysisDateEnd, businessAnalysisDateStart]);
  const businessDateRangePresets = useMemo(() => {
    const presets: Array<{ label: React.ReactNode; value: [Dayjs, Dayjs] }> = [];
    const addPreset = (label: React.ReactNode, startText: string, endText: string) => {
      const start = businessDateToDayjs(startText);
      const end = businessDateToDayjs(endText);
      if (start && end) presets.push({ label, value: [start, end] });
    };
    if (!businessDataDateBounds.start || !businessDataDateBounds.end) return presets;
    addPreset('全部数据', businessDataDateBounds.start, businessDataDateBounds.end);
    const latest7Start = businessAddDays(businessDataDateBounds.end, -6);
    addPreset('最近7天', latest7Start < businessDataDateBounds.start ? businessDataDateBounds.start : latest7Start, businessDataDateBounds.end);
    const latest30Start = businessAddDays(businessDataDateBounds.end, -29);
    addPreset('最近30天', latest30Start < businessDataDateBounds.start ? businessDataDateBounds.start : latest30Start, businessDataDateBounds.end);
    Array.from(new Set(businessStoreRecords.map(row => businessWeekStart(row.date)).filter(Boolean)))
      .sort((a, b) => b.localeCompare(a))
      .forEach(weekStart => addPreset(`周 ${businessWeekLabel(weekStart)}`, weekStart, businessAddDays(weekStart, 6)));
    Array.from(new Set(businessStoreRecords.map(row => businessMonthStart(row.date)).filter(Boolean)))
      .sort((a, b) => b.localeCompare(a))
      .forEach(monthStart => addPreset(`${monthStart.slice(0, 7)} 月`, monthStart, businessMonthEnd(monthStart)));
    return presets;
  }, [businessDataDateBounds.end, businessDataDateBounds.start, businessStoreRecords]);
  const updateBusinessAnalysisDateRange = (dateStrings: string[]) => {
    setBusinessAnalysisDateStart(normalizeBusinessDate(dateStrings[0]));
    setBusinessAnalysisDateEnd(normalizeBusinessDate(dateStrings[1]));
  };
  const filteredBusinessRecords = useMemo(() => {
    return businessStoreRecords
      .filter(row => businessAnalysisPlatform === 'all' || row.platform === businessAnalysisPlatform)
      .filter(row => !businessAnalysisDateStart || row.date >= businessAnalysisDateStart)
      .filter(row => !businessAnalysisDateEnd || row.date <= businessAnalysisDateEnd)
      .sort((a, b) => a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
  }, [businessAnalysisDateEnd, businessAnalysisDateStart, businessAnalysisPlatform, businessStoreRecords]);
  const orderStoreRecords = useMemo(() => {
    return state.orderAnalysis.records.filter(row => row.storeId === store.id && row.isValid);
  }, [state.orderAnalysis.records, store.id]);
  const orderDataDateBounds = useMemo(() => {
    if (!orderStoreRecords.length) return { start: '', end: '' };
    const dates = orderStoreRecords.map(row => row.orderDate).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [orderStoreRecords]);
  const orderDateRangePickerValue = useMemo(() => {
    const start = businessDateToDayjs(orderAnalysisDateStart);
    const end = businessDateToDayjs(orderAnalysisDateEnd);
    return start && end ? [start, end] as [Dayjs, Dayjs] : null;
  }, [orderAnalysisDateEnd, orderAnalysisDateStart]);
  const orderDateRangePresets = useMemo(() => {
    const presets: Array<{ label: React.ReactNode; value: [Dayjs, Dayjs] }> = [];
    const addPreset = (label: React.ReactNode, startText: string, endText: string) => {
      const start = businessDateToDayjs(startText);
      const end = businessDateToDayjs(endText);
      if (start && end) presets.push({ label, value: [start, end] });
    };
    if (!orderDataDateBounds.start || !orderDataDateBounds.end) return presets;
    addPreset('全部订单', orderDataDateBounds.start, orderDataDateBounds.end);
    const latest7Start = businessAddDays(orderDataDateBounds.end, -6);
    addPreset('最近7天', latest7Start < orderDataDateBounds.start ? orderDataDateBounds.start : latest7Start, orderDataDateBounds.end);
    const latest30Start = businessAddDays(orderDataDateBounds.end, -29);
    addPreset('最近30天', latest30Start < orderDataDateBounds.start ? orderDataDateBounds.start : latest30Start, orderDataDateBounds.end);
    return presets;
  }, [orderDataDateBounds.end, orderDataDateBounds.start]);
  const updateOrderAnalysisDateRange = (dateStrings: string[]) => {
    setOrderAnalysisDateStart(normalizeBusinessDate(dateStrings[0]));
    setOrderAnalysisDateEnd(normalizeBusinessDate(dateStrings[1]));
  };
  const filteredOrderRecords = useMemo(() => {
    return orderStoreRecords
      .filter(row => orderAnalysisPlatform === 'all' || row.platform === orderAnalysisPlatform)
      .filter(row => !orderAnalysisDateStart || row.orderDate >= orderAnalysisDateStart)
      .filter(row => !orderAnalysisDateEnd || row.orderDate <= orderAnalysisDateEnd)
      .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime) || a.orderId.localeCompare(b.orderId));
  }, [orderAnalysisDateEnd, orderAnalysisDateStart, orderAnalysisPlatform, orderStoreRecords]);
  const orderSummary = useMemo(() => summarizeOrderRecords(filteredOrderRecords), [filteredOrderRecords]);
  const orderActiveDateRangeText = businessDateRangeText(
    orderAnalysisDateStart || orderSummary.dateStart,
    orderAnalysisDateEnd || orderSummary.dateEnd
  );
  const orderPlatformRows = useMemo(() => aggregateOrdersByPlatform(filteredOrderRecords), [filteredOrderRecords]);
  const orderPayBandRows = useMemo(() => aggregateOrdersByPayBand(filteredOrderRecords), [filteredOrderRecords]);
  const orderMealPeriodRows = useMemo(() => aggregateOrdersByMealPeriod(filteredOrderRecords), [filteredOrderRecords]);
  const orderHourRows = useMemo(() => aggregateOrdersByHour(filteredOrderRecords), [filteredOrderRecords]);
  const orderActivityRows = useMemo(() => aggregateOrdersByActivityType(filteredOrderRecords), [filteredOrderRecords]);
  const enrichedOrderRecords = useMemo(() => enrichOrderRecords(filteredOrderRecords, store.products), [filteredOrderRecords, store.products]);
  const orderProfitSummary = useMemo(() => summarizeOrderProfit(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderActivityComboRows = useMemo(() => aggregateOrdersByActivityCombo(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderPlatformPayBandRows = useMemo(() => aggregateOrdersByPlatformPayBand(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderMealPayBandRows = useMemo(() => aggregateOrdersByMealPeriodPayBand(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderActivityComboPayBandRows = useMemo(() => aggregateOrdersByActivityComboPayBand(enrichedOrderRecords), [enrichedOrderRecords]);
  const orderProductRows = useMemo(() => aggregateEnrichedOrdersByProduct(enrichedOrderRecords, store.products), [enrichedOrderRecords, store.products]);
  const orderOperationRecommendations = useMemo(
    () => buildOrderOperationRecommendations(orderSummary, orderProfitSummary, orderPayBandRows, orderPlatformPayBandRows, orderMealPayBandRows, orderActivityComboRows, orderProductRows),
    [orderActivityComboRows, orderMealPayBandRows, orderPayBandRows, orderPlatformPayBandRows, orderProductRows, orderProfitSummary, orderSummary]
  );
  const orderInsights = useMemo(() => buildOrderInsights(orderSummary, orderPayBandRows, orderMealPeriodRows, orderActivityRows), [orderActivityRows, orderMealPeriodRows, orderPayBandRows, orderSummary]);
  const orderImportRows = useMemo(() => {
    return state.orderAnalysis.imports
      .filter(row => row.storeId === store.id)
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }, [state.orderAnalysis.imports, store.id]);
  const businessSummary = useMemo(() => summarizeBusinessRecords(filteredBusinessRecords), [filteredBusinessRecords]);
  const businessActiveDateRangeText = businessDateRangeText(
    businessAnalysisDateStart || businessSummary.dateStart,
    businessAnalysisDateEnd || businessSummary.dateEnd
  );
  const businessPlatformRows = useMemo(() => aggregateBusinessRecordsByPlatform(filteredBusinessRecords), [filteredBusinessRecords]);
  const businessDailyRows = useMemo(() => aggregateBusinessRecordsByDate(filteredBusinessRecords), [filteredBusinessRecords]);
  const businessWeeklyRows = useMemo(() => aggregateBusinessRecordsByWeekday(filteredBusinessRecords), [filteredBusinessRecords]);
  const businessDiagnostics = useMemo(() => diagnoseBusinessRecords(filteredBusinessRecords), [filteredBusinessRecords]);
  const businessImportRows = useMemo(() => {
    return state.businessData.imports
      .filter(row => row.storeId === store.id)
      .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }, [state.businessData.imports, store.id]);
  const businessNotes = useMemo(() => {
    return state.businessData.notes
      .filter(row => row.storeId === store.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [state.businessData.notes, store.id]);
  const businessVisibleNotes = useMemo(() => {
    return businessNotes
      .filter(row => businessNoteMatchesPlatformFilter(row, businessAnalysisPlatform))
      .filter(row => businessNoteOverlapsDateRange(row, businessAnalysisDateStart, businessAnalysisDateEnd));
  }, [businessAnalysisDateEnd, businessAnalysisDateStart, businessAnalysisPlatform, businessNotes]);
  const storeActivityDesignSettings = useMemo(() => effectiveActivityDesignSettingsFromStore(store, state.activityStrategySettings), [state.activityStrategySettings, store]);
  const routeObjectiveOptionsFromSettings = useMemo(() => activityObjectiveOptionsFromSettings(storeActivityDesignSettings), [storeActivityDesignSettings]);
  const routeObjectiveStrategiesFromSettings = useMemo(() => normalizeActivityObjectiveStrategies(
    storeActivityDesignSettings.objectiveStrategies,
    storeActivityDesignSettings.targetProfitRate,
    routeObjectiveOptionsFromSettings
  ), [routeObjectiveOptionsFromSettings, storeActivityDesignSettings]);
  const measurementPayBandSize = Math.max(1, Math.floor(Number(storeActivityDesignSettings.payBandSize) || 5));
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
    return summarizeDomainPriceBands(filteredResultRows.filter(row => !row.ignored), measurementPayBandSize, 'pay', { groupByScenario: false });
  }, [filteredResultRows, measurementPayBandSize, measurementSettings.payMax, measurementSettings.payMin, shouldPrepareResultsView, storedResultPayBands]);
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
  const selectedPricingIssue = useMemo(() => pricingEvaluation?.productRows.find(issue => issue.key === selectedPricingProductKey), [pricingEvaluation, selectedPricingProductKey]);

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
        const result = measurementRecordToResult(record, measurementPayBandSize);
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
  }, [measurementPayBandSize, routePage, store.id]);

  React.useEffect(() => {
    if (routePage !== 'activity-design') return undefined;
    const scenario = ACTIVITY_DESIGN_RESULT_SCENARIO;
    const currentScan = activityDesignByScenarioRef.current[scenario];
    const currentMeta = activityPriceScanPersistenceMetaRef.current;
    const hasCurrentStoreScan = Boolean(
      currentScan?.originalPriceBuckets?.length
      && (!currentMeta || currentMeta.storeId === store.id)
    );
    if (hasCurrentStoreScan) return undefined;
    let ignore = false;
    const seq = activityPriceScanLoadSeqRef.current + 1;
    activityPriceScanLoadSeqRef.current = seq;
    const targetStore = store;
    const settings = buildActivityDesignCalculationSettings(targetStore, state.activityStrategySettings, { calculationMode: 'priceScan' });
    const expectedSignature = buildActivityPriceScanSignature(state, targetStore, settings);
    const legacyExpectedSignature = buildLegacyActivityPriceScanSignature(state, targetStore, settings);
    browserDataRepository.loadActivityPriceScanRecord(targetStore.id)
      .then(record => {
        if (
          ignore
          || activityPriceScanLoadSeqRef.current !== seq
          || routePageRef.current !== 'activity-design'
          || currentStoreFrom(stateRef.current).id !== targetStore.id
          || activeAsyncCalculationRef.current.activityDesign
        ) {
          return;
        }
        if (!record || (record.signature !== expectedSignature && record.signature !== legacyExpectedSignature)) {
          setActivityPriceScanPersistenceMeta(null);
          if (activityPriceScanPersistenceMetaRef.current?.storeId !== targetStore.id) {
            setActivityDesignByScenario(prev => {
              if (!prev[scenario]?.originalPriceBuckets?.length) return prev;
              return { ...prev, [scenario]: null };
            });
          }
          return;
        }
        const result = activityPriceScanRecordToResult(record);
        if (!result.originalPriceBuckets?.length) {
          setActivityPriceScanPersistenceMeta(null);
          return;
        }
        const latestScan = activityDesignByScenarioRef.current[scenario];
        const latestMeta = activityPriceScanPersistenceMetaRef.current;
        if (latestScan?.originalPriceBuckets?.length && (!latestMeta || latestMeta.storeId === targetStore.id)) return;
        setActivityDesignByScenario(prev => {
          if (prev[scenario]?.originalPriceBuckets?.length && (!activityPriceScanPersistenceMetaRef.current || activityPriceScanPersistenceMetaRef.current.storeId === targetStore.id)) return prev;
          return { ...prev, [scenario]: result };
        });
        setActivityPriceScanPersistenceMeta(record.meta);
        setActivityDesignStage('priceScan');
        setSelectedActivityDesignRouteKey('');
        setSelectedActivityDesignBand(null);
        setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
        setSelectedActivityOriginalBucket(null);
        setSummary(result.summary);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [routePage, state, store]);

  React.useEffect(() => {
    setLoadedResultBandRows(null);
    setSelectedResultProduct(null);
    setResultProductPayRange(null);
  }, [measurementSettings.originalMin, measurementSettings.originalMax, measurementSettings.payMin, measurementSettings.payMax, store.id]);

  React.useEffect(() => {
    return () => cancelMeasurementCacheWarmup();
  }, []);

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
      return true;
    } catch {
      message.warning('已更新当前页面，但保存到浏览器数据库失败。');
      return false;
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
    cancelSystemStrategyEdit();
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
    nextStore.activityDesignSettings = normalizeActivityDesignSettings(nextStore.activityDesignSettings);
    await commitState(draft => {
      draft.stores = draft.stores.map(item => item.id === nextStore.id ? nextStore : item);
    }, '门店信息已保存到浏览器数据库。');
    setIsStoreEditing(false);
    setStoreDraft(null);
    clearCalculatedState();
  }

  function startProductsEdit() {
    cancelSystemStrategyEdit();
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

  function startSystemStrategyEdit() {
    cancelStoreEdit();
    cancelProductsEdit();
    cancelPlatformEdit();
    cancelActivityEdit();
    cancelRiskEdit();
    setSystemStrategyDraft(normalizeActivityStrategySettings(state.activityStrategySettings));
    setIsSystemStrategyEditing(true);
  }

  function updateSystemStrategyDraft(mutator: (draft: ActivityStrategySettings) => void) {
    setSystemStrategyDraft(prev => {
      const draft = normalizeActivityStrategySettings(deepClone(prev || state.activityStrategySettings));
      mutator(draft);
      return normalizeActivityStrategySettings(draft);
    });
  }

  function cancelSystemStrategyEdit() {
    setIsSystemStrategyEditing(false);
    setSystemStrategyDraft(null);
  }

  async function saveSystemStrategyEdit() {
    if (!systemStrategyDraft) return;
    const nextSettings = normalizeActivityStrategySettings(systemStrategyDraft);
    if (!activityObjectiveOptionsFromSettings(nextSettings).length) {
      message.warning('请至少启用一个经营目标。');
      return;
    }
    const saved = await commitState(draft => {
      draft.activityStrategySettings = nextSettings;
    }, '系统活动策略已保存到浏览器数据库。');
    if (!saved) return;
    setIsSystemStrategyEditing(false);
    setSystemStrategyDraft(null);
    clearCalculatedState();
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

  function selectFirstDuplicateProductGroup() {
    if (!productDuplicateGroups.length) {
      message.info('当前没有识别到高置信疑似重复商品。');
      return;
    }
    setSelectedProductRowKeys(productDuplicateGroups[0].map(product => product.id));
    message.info(`已选择疑似重复商品：${productDuplicateGroups[0].map(product => product.name).join('、')}`);
  }

  function mergeSelectedDuplicateProducts() {
    if (selectedProductRowKeys.length < 2) {
      message.warning('请至少选择 2 个需要合并的商品。');
      return;
    }
    const selectedIds = selectedProductIdSet();
    const sourceProducts = productsDraft || store.products;
    const selectedProducts = sourceProducts.filter(product => selectedIds.has(product.id));
    if (selectedProducts.length < 2) {
      message.warning('请至少选择 2 个需要合并的商品。');
      return;
    }
    const primary = chooseProductMergePrimary(selectedProducts);
    const duplicates = selectedProducts.filter(product => product.id !== primary.id);
    const merged = mergeProductRecords(primary, duplicates);
    modal.confirm({
      title: '合并选中商品',
      content: (
        <Space direction="vertical">
          <Text>将 {selectedProducts.length} 个商品合并为「{merged.name}」。</Text>
          <Text type="secondary">主商品：{primary.name}。合并会保留主商品已有字段，并用其他商品补齐缺失的平台价、打包费、成本、分类和上下架状态。</Text>
          <Text type="secondary">被合并商品：{duplicates.map(product => product.name).join('、')}</Text>
          <Text type="secondary">该操作只修改当前编辑草稿，点击“保存商品”后才会生效。</Text>
        </Space>
      ),
      okText: '合并',
      cancelText: '取消',
      onOk: () => {
        updateProductsDraft(draft => {
          const duplicateIds = new Set(duplicates.map(product => product.id));
          const primaryIndex = draft.findIndex(product => product.id === primary.id);
          if (primaryIndex >= 0) draft[primaryIndex] = merged;
          for (let index = draft.length - 1; index >= 0; index--) {
            if (duplicateIds.has(draft[index].id)) draft.splice(index, 1);
          }
        });
        setSelectedProductRowKeys([merged.id]);
        message.success(`已合并 ${selectedProducts.length} 个商品，保存商品后生效。`);
      }
    });
  }

  function startPlatformEdit() {
    cancelSystemStrategyEdit();
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
    cancelSystemStrategyEdit();
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
    cancelSystemStrategyEdit();
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

  function openActivityDiscountTierEditor(
    scope: ActivityDiscountTierEditorScope,
    objective: RedesignedActivityDesignObjective,
    title: string,
    tiers: ActivityOriginalDiscountTier[],
    fallback: ActivityOriginalDiscountTier[]
  ) {
    const normalized = normalizeActivityOriginalDiscountTiers(tiers, fallback);
    setActivityDiscountTierEditor({ scope, objective, title, fallback });
    setActivityDiscountTierDraft(normalized);
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    setActivityDiscountTierBatchDraft({
      start: first?.originalMin ?? 0,
      end: last?.originalMax && last.originalMax < 999 ? last.originalMax : '',
      step: Math.max(1, roundMoney((first?.originalMax ?? 10) - (first?.originalMin ?? 0)) || 10),
      rate: first?.discountRate ?? 30
    });
  }

  function closeActivityDiscountTierEditor() {
    setActivityDiscountTierEditor(null);
    setActivityDiscountTierDraft([]);
  }

  function saveActivityDiscountTierEditor() {
    if (!activityDiscountTierEditor) return;
    const nextTiers = normalizeActivityOriginalDiscountTiers(activityDiscountTierDraft, activityDiscountTierEditor.fallback);
    if (activityDiscountTierEditor.scope === 'system') {
      setSystemStrategyDraft(prev => {
        const settings = normalizeActivityStrategySettings(deepClone(prev || state.activityStrategySettings));
        const options = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).map(activityObjectiveOptionFromTemplate);
        const current = normalizeActivityObjectiveStrategies(settings.objectiveStrategies, DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate, options)[activityDiscountTierEditor.objective];
        settings.objectiveStrategies[activityDiscountTierEditor.objective] = { ...current, originalDiscountTiers: nextTiers };
        return normalizeActivityStrategySettings(settings);
      });
    } else {
      updateStoreDraft(draft => {
        const settings = normalizeActivityDesignSettings(draft.activityDesignSettings);
        const effectiveSettings = effectiveActivityDesignSettingsFromStore({ ...draft, activityDesignSettings: settings }, state.activityStrategySettings);
        const options = activityObjectiveOptionsFromSettings(effectiveSettings);
        const current = normalizeActivityObjectiveStrategies(effectiveSettings.objectiveStrategies, effectiveSettings.targetProfitRate, options)[activityDiscountTierEditor.objective];
        settings.useDefaultObjectiveStrategies = false;
        settings.objectiveStrategies = {
          ...(settings.objectiveStrategies || {}),
          [activityDiscountTierEditor.objective]: { ...current, originalDiscountTiers: nextTiers }
        };
        settings.objectiveTemplates = options.map(option => ({
          key: option.value,
          enabled: option.enabled,
          name: option.label,
          group: option.group,
          targetPayLabel: option.targetPayLabel,
          targetPayMin: option.targetPayMin,
          targetPayMax: option.targetPayMax,
          description: option.description,
          baseObjective: option.baseObjective
        }));
        draft.activityDesignSettings = normalizeActivityDesignSettings(settings);
      });
    }
    closeActivityDiscountTierEditor();
  }

  function cancelAllEdits() {
    cancelSystemStrategyEdit();
    cancelStoreEdit();
    cancelProductsEdit();
    cancelPlatformEdit();
    cancelActivityEdit();
    cancelRiskEdit();
    closeActivityDiscountTierEditor();
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
    setActivityPriceScanPersistenceMeta(null);
    setLastOptimizationsByScenario(createScenarioRecord<OptimizationRow[]>(() => []));
    setResultSummariesByScenario(createScenarioRecord<Summary>(() => ({ ...EMPTY_SUMMARY })));
    setResultWarningsByScenario(createScenarioRecord<string[]>(() => []));
    setOptimizationWarningsByScenario(createScenarioRecord<string[]>(() => []));
    setActivityDesignByScenario(createScenarioRecord<RedesignedActivityDesignResult | null>(() => null));
    setPricingEvaluation(null);
    setSelectedPricingProductKey('');
    setSelectedResultBand(null);
    setSelectedActivityDesignBand(null);
    setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
    setSelectedActivityDesignRouteKey('');
    setActivityDesignStage('priceScan');
    setSelectedActivityOriginalBucket(null);
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
      let similarMerged = 0;
      updateProductsDraft(draft => {
        const productMap = new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
        parsed.products.forEach(item => {
          const key = normalizeProductMatchName(item.name);
          const exactExisting = productMap.get(key);
          const similarExisting = exactExisting ? null : findSimilarProductForPlatformImport(draft, item, platform);
          const existing = exactExisting || similarExisting;
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
            if (similarExisting) {
              similarMerged++;
              productMap.set(key, existing);
            }
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
      message.success(`已导入${PLATFORM_NAMES[platform]}商品：识别 ${parsed.products.length} 个，更新 ${updated} 个，新增 ${added} 个，相似合并 ${similarMerged} 个，未变化 ${unchanged} 个。`);
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

  async function importBusinessReport(file: File) {
    try {
      const parsed = parseBusinessReportWorkbook(await readBusinessReportWorkbook(file), file.name);
      const rowsByDate = new Map<string, ParsedBusinessReport['records'][number]>();
      parsed.records.forEach(row => {
        rowsByDate.set(row.date, row);
      });
      const sourceRows = Array.from(rowsByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
      if (!sourceRows.length) {
        message.warning('没有识别到有效经营日报，请确认文件包含日期、门店名称和有效订单。');
        return;
      }
      const importedAt = new Date().toISOString();
      const importBatchId = uid('business-import');
      const dateSet = new Set(sourceRows.map(row => row.date));
      const replacedDates = Array.from(new Set(
        state.businessData.records
          .filter(row => row.storeId === store.id && row.platform === parsed.platform && dateSet.has(row.date))
          .map(row => row.date)
      )).sort();
      const warnings = Array.from(new Set([
        ...parsed.warnings,
        ...sourceRows.flatMap(row => row.warnings || [])
      ])).filter(Boolean);
      const nextRecords = sourceRows
        .map(row => normalizeBusinessDailyRecord({
          ...row,
          key: `${store.id}:${row.platform}:${row.date}`,
          storeId: store.id,
          storeName: store.name,
          sourceFileName: file.name,
          importBatchId,
          importedAt
        }))
        .filter((row): row is BusinessDailyRecord => Boolean(row));
      const dateStart = nextRecords[0]?.date || '';
      const dateEnd = nextRecords[nextRecords.length - 1]?.date || '';
      await commitState(draft => {
        draft.businessData.records = draft.businessData.records
          .filter(row => !(row.storeId === store.id && row.platform === parsed.platform && dateSet.has(row.date)))
          .concat(nextRecords)
          .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform));
        draft.businessData.imports = [{
          id: importBatchId,
          storeId: store.id,
          storeName: store.name,
          platform: parsed.platform,
          platformName: PLATFORM_NAMES[parsed.platform],
          fileName: file.name,
          importedAt,
          dateStart,
          dateEnd,
          rowCount: nextRecords.length,
          replacedDates,
          warnings
        }, ...draft.businessData.imports].slice(0, 100);
      }, `已导入${PLATFORM_NAMES[parsed.platform]}经营日报：${nextRecords.length} 天，覆盖 ${replacedDates.length} 天。`);
      if (warnings.length) message.warning(warnings.slice(0, 2).join('；'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入经营日报失败，请确认文件格式。');
    }
  }

  function exportBusinessAnalysis() {
    const ok = downloadCsv(
      `${store.name}_经营数据_${businessDateRangeText(businessSummary.dateStart, businessSummary.dateEnd)}.csv`,
      businessReportExportRows(filteredBusinessRecords, businessNotes)
    );
    if (!ok) message.warning('当前筛选范围没有可导出的经营数据。');
  }

  async function importOrderAnalysisFile(file: File) {
    try {
      const parsed = parseOrderWorkbook(await readOrderWorkbook(file), file.name);
      const rowsByOrderId = new Map<string, ParsedOrderWorkbook['records'][number]>();
      parsed.records.forEach(row => {
        rowsByOrderId.set(row.orderId, row);
      });
      const sourceRows = Array.from(rowsByOrderId.values())
        .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime));
      if (!sourceRows.length) {
        message.warning('没有识别到有效订单，请确认文件是美团或饿了么订单明细导出。');
        return;
      }
      const importedAt = new Date().toISOString();
      const importBatchId = uid('order-import');
      const orderIds = new Set(sourceRows.map(row => row.orderId));
      const replacedOrders = state.orderAnalysis.records
        .filter(row => row.storeId === store.id && orderIds.has(row.orderId))
        .length;
      const warnings = Array.from(new Set(parsed.warnings)).filter(Boolean);
      const nextRecords = sourceRows
        .map(row => normalizeOrderDetailRecord({
          ...row,
          key: row.orderId,
          storeId: store.id,
          storeName: store.name,
          sourceFileName: file.name,
          importBatchId,
          importedAt
        }))
        .filter((row): row is OrderDetailRecord => Boolean(row));
      const dateStart = nextRecords[0]?.orderDate || '';
      const dateEnd = nextRecords[nextRecords.length - 1]?.orderDate || '';
      await commitState(draft => {
        draft.orderAnalysis.records = draft.orderAnalysis.records
          .filter(row => !(row.storeId === store.id && orderIds.has(row.orderId)))
          .concat(nextRecords)
          .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime));
        draft.orderAnalysis.imports = [{
          id: importBatchId,
          storeId: store.id,
          storeName: store.name,
          platform: parsed.platform,
          platformName: PLATFORM_NAMES[parsed.platform],
          fileName: file.name,
          importedAt,
          dateStart,
          dateEnd,
          rowCount: nextRecords.length,
          replacedOrders,
          skippedRows: parsed.skippedRows,
          warnings
        }, ...draft.orderAnalysis.imports].slice(0, 100);
      }, `已导入${PLATFORM_NAMES[parsed.platform]}订单：${nextRecords.length} 单，覆盖 ${replacedOrders} 单。`);
      if (warnings.length) message.warning(warnings.slice(0, 2).join('；'));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入订单明细失败，请确认文件格式。');
    }
  }

  function exportOrderAnalysis() {
    const ok = downloadCsv(
      `${store.name}_订单分析_${businessDateRangeText(orderSummary.dateStart, orderSummary.dateEnd)}.csv`,
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
    if (!ok) message.warning('当前筛选范围没有可导出的订单分析。');
  }

  function openBusinessMemoNoteEditor(note?: BusinessAnalysisNote) {
    if (note) {
      setBusinessNoteEditor({
        id: note.id,
        dateStart: note.dateStart,
        dateEnd: note.dateEnd,
        platform: note.platform,
        title: note.title,
        content: businessNoteItemsText(note)
      });
      return;
    }
    const fallbackStart = businessAnalysisDateStart || businessSummary.dateStart || businessDataDateBounds.end || '';
    const fallbackEnd = businessAnalysisDateEnd || businessSummary.dateEnd || fallbackStart;
    const range = normalizeBusinessDateRange(fallbackStart, fallbackEnd);
    setBusinessNoteEditor({
      ...range,
      platform: businessAnalysisPlatform,
      title: '经营备忘',
      content: ''
    });
  }

  function openBusinessMemoNoteEditorWithContext(context: BusinessNoteEditorState) {
    const range = normalizeBusinessDateRange(context.dateStart, context.dateEnd);
    if (!range.dateStart || !range.dateEnd) {
      message.warning('没有识别到图表日期，无法新增备忘。');
      return;
    }
    setBusinessNoteEditor({
      ...context,
      ...range,
      title: context.title.trim() || '经营备忘'
    });
  }

  function updateBusinessMemoNoteDateRange(dateStrings: string[]) {
    const range = normalizeBusinessDateRange(dateStrings[0], dateStrings[1]);
    setBusinessNoteEditor(prev => prev ? { ...prev, ...range } : prev);
  }

  async function saveBusinessMemoNote() {
    if (!businessNoteEditor) return;
    const range = normalizeBusinessDateRange(businessNoteEditor.dateStart, businessNoteEditor.dateEnd);
    if (!range.dateStart || !range.dateEnd) {
      message.warning('请选择备忘日期。');
      return;
    }
    const content = businessNoteEditor.content.trim();
    if (!content) {
      message.warning('请填写备忘内容。');
      return;
    }
    const title = businessNoteEditor.title.trim() || '经营备忘';
    const nextNote: BusinessAnalysisNote = {
      id: businessNoteEditor.id || uid('business-note'),
      storeId: store.id,
      kind: 'memo',
      title,
      createdAt: businessNoteEditor.id
        ? businessNotes.find(row => row.id === businessNoteEditor.id)?.createdAt || new Date().toISOString()
        : new Date().toISOString(),
      dateStart: range.dateStart,
      dateEnd: range.dateEnd,
      platform: businessNoteEditor.platform,
      items: [content]
    };
    await commitState(draft => {
      draft.businessData.notes = businessNoteEditor.id
        ? draft.businessData.notes.map(row => row.id === businessNoteEditor.id ? nextNote : row)
        : [nextNote, ...draft.businessData.notes].slice(0, BUSINESS_NOTE_LIMIT);
    }, businessNoteEditor.id ? '备忘录已更新。' : '备忘录已保存。');
    setBusinessNoteEditor(null);
  }

  function deleteBusinessAnalysisNote(note: BusinessAnalysisNote) {
    modal.confirm({
      title: note.kind === 'memo' ? '删除备忘录' : '删除诊断记录',
      content: `确定删除「${note.title}」吗？`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => commitState(draft => {
        draft.businessData.notes = draft.businessData.notes.filter(row => row.id !== note.id);
      }, note.kind === 'memo' ? '备忘录已删除。' : '诊断记录已删除。')
    });
  }

  async function saveBusinessAnalysisNote() {
    if (!filteredBusinessRecords.length) {
      message.warning('当前筛选范围没有经营数据，无法保存诊断。');
      return;
    }
    const dateStart = businessSummary.dateStart;
    const dateEnd = businessSummary.dateEnd;
    const platform = businessAnalysisPlatform;
    const items = businessDiagnostics.map(row => `${row.title}：${row.description} 建议：${row.suggestion}`);
    const note: BusinessAnalysisNote = {
      id: uid('business-note'),
      storeId: store.id,
      kind: 'diagnostic',
      title: `${store.name} ${businessDateRangeText(dateStart, dateEnd)} 经营诊断`,
      createdAt: new Date().toISOString(),
      dateStart,
      dateEnd,
      platform,
      items
    };
    await commitState(draft => {
      draft.businessData.notes = [note, ...draft.businessData.notes].slice(0, BUSINESS_NOTE_LIMIT);
    }, '当前经营诊断已保存。');
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
    const result = measurementRecordToResult(record, measurementPayBandSize);
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
      applyOrQueueAsyncCalculationResult({ slot: 'measurement', token: task.token, page: 'results', scenario, result: measurementRecordToResult(record, measurementPayBandSize) });
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

  function openActivityOriginalBucketDetail(row: ActivityPriceBucketRow) {
    setSelectedActivityOriginalBucket(row);
  }

  async function runActivityDesign() {
    if (isActivityDesignLoading) return;
    const scenario = ACTIVITY_DESIGN_RESULT_SCENARIO;
    const task = beginAsyncCalculation('activityDesign', 'activity-design');
    setIsActivityDesignLoading(true);
    await waitForLoadingPaint();
    try {
      setSelectedActivityDesignRouteKey('');
      setActivityDesignStage('priceScan');
      setSelectedActivityOriginalBucket(null);
      setSelectedActivityDesignBand(null);
      setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
      setActivityDesignDetailSearchText('');
      setActivityDesignByScenario(prev => ({ ...prev, [scenario]: null }));
      setActivityPriceScanPersistenceMeta(null);
      setSummary({ resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
      const scanSettings = buildActivityDesignCalculationSettings(store, state.activityStrategySettings, { calculationMode: 'priceScan' });
      const result = await runCalculationTask('activityDesign', {
        state,
        platformFilter: 'all',
        settings: scanSettings
      }, progress => {
        if (shouldWriteAsyncCalculation('activityDesign', task.token, task.page)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        ...asyncCalculationOptions(task),
        maxDurationMs: ACTIVITY_DESIGN_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_DESIGN_WORKER_TIMEOUT_MS
      });
      let displayResult: RedesignedActivityDesignResult = {
        ...result,
        originalComboRows: [],
        routeSourceRows: []
      };
      if (result.originalPriceBuckets?.length) {
        try {
          const record = await browserDataRepository.saveActivityPriceScanRecord(state, store, scanSettings, result);
          displayResult = activityPriceScanRecordToResult(record);
          if (shouldWriteAsyncCalculation('activityDesign', task.token, task.page)) {
            setActivityPriceScanPersistenceMeta(record.meta);
          }
        } catch {
          if (shouldWriteAsyncCalculation('activityDesign', task.token, task.page)) {
            message.warning('原价扫描已生成，但浏览器缓存写入失败。');
          }
        }
      }
      applyOrQueueAsyncCalculationResult({ slot: 'activityDesign', token: task.token, page: 'activity-design', scenario, result: displayResult });
    } catch (error) {
      reportAsyncCalculationError('activityDesign', task.token, task.page, error, '活动设计生成失败。');
    } finally {
      if (isAsyncCalculationCurrent('activityDesign', task.token)) setIsActivityDesignLoading(false);
      finishAsyncCalculation('activityDesign', task.token);
    }
  }

  async function runActivityRouteDesign() {
    if (isActivityDesignLoading) return;
    if (!activityDesign?.originalPriceBuckets?.length) {
      message.warning('请先生成原价整数扫描结果。');
      return;
    }
    const originalPriceBucketsSnapshot = activityDesign.originalPriceBuckets || [];
    const routeBucketCount = originalPriceBucketsSnapshot.filter(row => row.comboCount > 0).length;
    if (!routeBucketCount) {
      message.warning('当前原价扫描没有可用于生成路线的原价桶。');
      return;
    }
    const scenario = ACTIVITY_DESIGN_RESULT_SCENARIO;
    const task = beginAsyncCalculation('activityDesign', 'activity-design');
    setSelectedActivityDesignRouteKey('');
    setActivityDesignStage('routeDesign');
    setSelectedActivityDesignBand(null);
    setSelectedActivityDesignPayBandKeyByPlatform({ meituan: 'all', eleme: 'all' });
    setActivityDesignDetailSearchText('');
    setActivityDesignByScenario(prev => ({
      ...prev,
      [scenario]: prev[scenario]
        ? { ...prev[scenario], fullRoutes: [], couponRoutes: [], recommendations: [], payBands: [], hitRows: [], comboRows: [] }
        : prev[scenario]
    }));
    setIsActivityDesignLoading(true);
    await waitForLoadingPaint();
    try {
      setSummary({ resultCount: 0, comboCount: routeBucketCount, validComboCount: routeBucketCount, elapsedTime: null });
      const result = await runCalculationTask('activityDesign', {
        state,
        platformFilter: 'all',
        settings: buildActivityDesignCalculationSettings(store, state.activityStrategySettings, {
          calculationMode: 'routeDesign',
          originalBandsSnapshot: activityDesign.originalBands,
          originalPriceBucketsSnapshot
        })
      }, progress => {
        if (shouldWriteAsyncCalculation('activityDesign', task.token, task.page)) {
          setSummary({ resultCount: progress.resultCount, comboCount: progress.comboCount, validComboCount: progress.validComboCount, elapsedTime: null });
        }
      }, {
        ...asyncCalculationOptions(task),
        maxDurationMs: ACTIVITY_DESIGN_MAX_DURATION_MS,
        timeoutMs: ACTIVITY_DESIGN_WORKER_TIMEOUT_MS
      });
      applyOrQueueAsyncCalculationResult({
        slot: 'activityDesign',
        token: task.token,
        page: 'activity-design',
        scenario,
        result: { ...result, scanComboPools: activityDesign.scanComboPools }
      });
    } catch (error) {
      reportAsyncCalculationError('activityDesign', task.token, task.page, error, '活动路线生成失败。');
    } finally {
      if (isAsyncCalculationCurrent('activityDesign', task.token)) setIsActivityDesignLoading(false);
      finishAsyncCalculation('activityDesign', task.token);
    }
  }

  function applyActivityRouteToPlatform(row: ActivityRecommendationRow) {
    const fullReductions = row.fullReductionRules.map(rule => ({
      enabled: true,
      threshold: Math.max(0, Number(rule.threshold) || 0),
      amount: Math.max(0, Number(rule.amount) || 0)
    }));
    const coupons = row.couponRules.map(rule => ({
      enabled: true,
      name: rule.name || `建议订单券满${money(rule.threshold)}减${money(rule.amount)}`,
      threshold: Math.max(0, Number(rule.threshold) || 0),
      amount: Math.max(0, Number(rule.amount) || 0),
      sceneKey: rule.sceneKey,
      sceneName: rule.sceneName,
      channel: rule.channel,
      targetUser: rule.targetUser,
      thresholdMode: rule.thresholdMode,
      usageSuggestion: rule.usageSuggestion
    }));
    if (!fullReductions.length && !coupons.length) {
      message.warning('当前路线没有可应用的满减或优惠券规则。');
      return;
    }
    modal.confirm({
      title: `应用${row.platformName}活动路线`,
      content: `将覆盖当前门店${row.platformName}的满减规则和券列表，其他活动配置保持不变。是否继续？`,
      okText: '应用',
      cancelText: '取消',
      onOk: async () => {
        await commitState(draft => {
          const draftStore = currentStoreFrom(draft);
          const current = draftStore.activities[row.platform];
          draftStore.activities[row.platform] = {
            ...current,
            fullReductions,
            coupons
          };
        }, `${row.platformName}活动路线已应用到当前门店。`);
        clearCalculatedState();
      }
    });
  }

  async function runActivityDesignRouteValidation(recommendationKey: string, recommendationSnapshot?: ActivityRecommendationRow | null) {
    if (isActivityDesignLoading || !recommendationKey) return;
    const scenario = ACTIVITY_DESIGN_RESULT_SCENARIO;
    const task = beginAsyncCalculation('activityDesign', 'activity-design');
    const selectedRecommendationSnapshot = recommendationSnapshot || activityDesign?.recommendations.find(row => row.key === recommendationKey);
    if (!selectedRecommendationSnapshot) {
      message.warning('请先选择有效的满减路线或优惠券路线。');
      finishAsyncCalculation('activityDesign', task.token);
      return;
    }
    setSelectedActivityDesignRouteKey(recommendationKey);
    setActivityDesignStage('payValidation');
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
        settings: buildActivityDesignCalculationSettings(store, state.activityStrategySettings, {
          calculationMode: 'payValidation',
          selectedRecommendationKey: recommendationKey,
          selectedRecommendationSnapshot,
          originalBandsSnapshot: activityDesign?.originalBands || [],
          originalPriceBucketsSnapshot: activityDesign?.originalPriceBuckets || [],
          scanComboPoolsSnapshot: activityDesign?.scanComboPools
        })
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

  function productDiscountActivityName(suggestion: ProductDiscountSuggestion) {
    return `折扣修正-${suggestion.productName}`;
  }

  function applyProductDiscountSuggestion(suggestion: ProductDiscountSuggestion) {
    if (suggestion.riskLevel === 'blocked') {
      message.warning('该折扣会打穿最低利润、最低到手价或最低支付价，不能直接应用。');
      return;
    }
    modal.confirm({
      title: `应用${suggestion.platformName}商品折扣`,
      content: (
        <Space direction="vertical">
          <Text>将为「{suggestion.productName}」配置 {money(suggestion.discountRate)} 折商品折扣，单件预计让利 ¥{money(suggestion.discountAmountPerUnit)}。</Text>
          <Text type="secondary">该动作只修改当前门店当前平台的商品折扣活动，不覆盖满减、订单券、神券/爆红包或商品售价。应用后请重新生成测算结果或重新核验路线。</Text>
        </Space>
      ),
      okText: '应用折扣',
      cancelText: '取消',
      onOk: async () => {
        await commitState(draft => {
          const draftStore = currentStoreFrom(draft);
          const activities = draftStore.activities[suggestion.platform];
          const discountActivity: DiscountActivity = {
            enabled: true,
            name: productDiscountActivityName(suggestion),
            productNames: suggestion.productName,
            discountRate: suggestion.discountRate,
            itemLimit: suggestion.itemLimit
          };
          const currentRows = Array.isArray(activities.discountActivities) ? activities.discountActivities : [];
          const existingIndex = currentRows.findIndex(row => (
            String(row.productNames || '').trim() === suggestion.productName ||
            row.name === productDiscountActivityName(suggestion)
          ));
          activities.discountActivities = existingIndex >= 0
            ? currentRows.map((row, index) => index === existingIndex ? discountActivity : row)
            : [discountActivity, ...currentRows];
        }, `${suggestion.platformName}「${suggestion.productName}」商品折扣已应用。`);
        clearCalculatedState();
      }
    });
  }

  function renderProductDiscountSuggestionPanel(
    rows: ComboEvaluationRow[],
    options: {
      source: ProductDiscountSuggestionSource;
      title?: string;
      productId?: string;
      allowApply?: boolean;
      limit?: number;
      analysisRows?: ComboEvaluationRow[];
      description?: React.ReactNode;
      includeNeutral?: boolean;
    }
  ) {
    const allowApply = options.allowApply !== false;
    const analysisRows = options.analysisRows || rows;
    const suggestions = buildProductDiscountSuggestions(analysisRows, {
      source: options.source,
      productId: options.productId,
      limit: options.limit ?? 6,
      includeBlocked: true,
      includeNeutral: options.includeNeutral
    });
    const columns: TableColumnsType<ProductDiscountSuggestion> = [
      { title: '状态', dataIndex: 'riskLevel', width: 95, render: value => <Tag color={productDiscountRiskColor(value as ProductDiscountSuggestionRiskLevel)}>{productDiscountRiskLabel(value as ProductDiscountSuggestionRiskLevel)}</Tag> },
      { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: value => <Text className="table-text-wrap">{String(value || '')}</Text> },
      { title: '分类', dataIndex: 'categoryName', width: 90, render: value => <Tag>{String(value || '-')}</Tag> },
      { title: '角色', dataIndex: 'role', width: 90, render: value => <Tag color={value === 'addOn' ? 'cyan' : 'blue'}>{productDiscountRoleLabel(value as ProductDiscountSuggestionRole)}</Tag> },
      { title: '结论', dataIndex: 'actionLabel', width: 120, render: (_, row) => <Tag color={productDiscountRiskColor(row.riskLevel)}>{row.actionLabel}</Tag> },
      { title: '售价', dataIndex: 'unitPrice', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.unitPrice - b.unitPrice },
      { title: '当前成本', dataIndex: 'avgUnitCost', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgUnitCost - b.avgUnitCost },
      { title: '活动合理成本', dataIndex: 'avgReasonableCost', width: 125, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgReasonableCost - b.avgReasonableCost },
      { title: '合理空间', dataIndex: 'avgCostGap', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.avgCostGap - b.avgCostGap },
      { title: '合理标价', dataIndex: 'reasonablePriceFromCost', width: 105, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.reasonablePriceFromCost || 0) - (b.reasonablePriceFromCost || 0) },
      { title: '差值范围', width: 130, render: (_, row) => row.minCostGap === null ? '-' : `${money(row.minCostGap)} ~ ${money(row.maxCostGap)}` },
      { title: '建议折扣', width: 115, render: (_, row) => row.actionType === 'discount' ? `${money(row.discountRate)}折 / ¥${money(row.discountAmountPerUnit)}` : '-' },
      { title: '影响组合', width: 115, render: (_, row) => `${row.affectedComboCount} 条`, sorter: (a, b) => a.affectedComboCount - b.affectedComboCount },
      { title: '风险/空间', width: 115, render: (_, row) => `${row.riskComboCount}/${row.opportunityComboCount}`, sorter: (a, b) => a.riskComboCount - b.riskComboCount || a.opportunityComboCount - b.opportunityComboCount },
      { title: '说明', dataIndex: 'reason', width: 360, render: value => <Text type="secondary" className="table-text-wrap">{String(value || '')}</Text> },
      {
        title: '操作',
        width: 110,
        fixed: 'right',
        render: (_, row) => allowApply && row.actionType === 'discount'
          ? <Button size="small" disabled={row.riskLevel === 'blocked'} onClick={() => applyProductDiscountSuggestion(row)}>应用</Button>
          : <Text type="secondary">只观察</Text>
      }
    ];
    return (
      <Card size="small" title={options.title || '商品维度活动合理成本结论'}>
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Text type="secondary">{options.description || '商品结论按当前活动路线下的合理成本反推；主商品比较活动合理成本和当前成本，凑单品只判断分摊到手是否覆盖成本。'}</Text>
          {suggestions.length ? (
            <Table
              rowKey="key"
              size="small"
              columns={columns}
              dataSource={suggestions}
              pagination={false}
              scroll={{ x: 1925 }}
              tableLayout="fixed"
            />
          ) : (
            <Text type="secondary">当前范围没有需要商品折扣、调价或凑单风险处理的商品。</Text>
          )}
        </Space>
      </Card>
    );
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
      支付毛利率: rateText(paymentGrossRate(row)),
      实付利润率: rateText(row.profitRate),
      到手利润率: rateText(row.netProfitRate),
      触发原因: row.risk?.reasons.join('|') || ''
    })));
    if (!ok) message.warning('没有可导出的风险预警。');
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
  const productDuplicateGroups = useMemo(() => (
    isProductsEditing ? findDuplicateProductGroups(productSource) : []
  ), [isProductsEditing, productSource]);

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
  const activityRiskBaseColumns = withoutColumnByDataIndex(riskColumns as TableColumnsType<ActivityComboSimulationRow>, 'platformName');
  const activityRiskColumns: TableColumnsType<ActivityComboSimulationRow> = activityRiskBaseColumns;

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
    { title: '覆盖组合', width: 120, render: (_, row) => `${row.hitCount}/${row.eligibleCount}`, sorter: (a, b) => a.hitCount - b.hitCount },
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
    { title: '平均加码', dataIndex: 'avgRedAddOnSpace', width: 100, responsive: SHOW_XL, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgRedAddOnSpace - b.avgRedAddOnSpace }
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
      render: (_, row) => <Button size="small" onClick={() => openActivityOriginalBucketDetail(row)}>查看组合</Button>
    }
  ];

  const activityOriginalComboColumns: TableColumnsType<ActivityBaseComboRow> = [
    { title: '商品组合', dataIndex: 'items', width: 280, fixed: 'left', render: items => <Text className="table-text-wrap">{itemsText(items as ComboItem[])}</Text> },
    { title: '原价', dataIndex: 'originalTotal', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.originalTotal - b.originalTotal },
    { title: '基准支付价', dataIndex: 'baseFinalPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseFinalPay - b.baseFinalPay },
    { title: '基准到手价', dataIndex: 'baseNetPay', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseNetPay - b.baseNetPay },
    { title: '到手边界', width: 110, render: (_, row) => row.baseNetPay + 1e-9 < ACTIVITY_MIN_NET_PAY ? <Text type="danger">低于 ¥{money(ACTIVITY_MIN_NET_PAY)}</Text> : <Text type="secondary">正常</Text> }
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

  const activityRouteTypeLabel = (row: ActivityRecommendationRow) => {
    if (row.routeGroup === 'stable') return '稳定底盘';
    if (row.routeKind === 'fullReduction') return '满减候选';
    if (row.routeKind === 'coupon') return '券候选';
    return '经营目标';
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
              <Space orientation="vertical" style={{ width: '100%' }} size={4}>
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
    const couponStrategyLabel = ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS.find(option => option.value === couponStrategyMode)?.label || couponStrategyMode || '平稳';
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
  const activityPlatformRecommendationColumns = withoutColumnByDataIndex(activityRecommendationColumns, 'platformName');
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

  function renderSystemStrategyPage() {
    const strategySettings = normalizeActivityStrategySettings(
      isSystemStrategyEditing && systemStrategyDraft ? systemStrategyDraft : state.activityStrategySettings
    );
    const objectiveOptions = normalizeActivityObjectiveTemplates(strategySettings.objectiveTemplates).map(activityObjectiveOptionFromTemplate);
    const updateStrategySettings = (mutator: (settings: ActivityStrategySettings) => void) => {
      updateSystemStrategyDraft(mutator);
    };
    const updateObjectiveTemplate = (objective: RedesignedActivityDesignObjective, patch: Partial<ActivityObjectiveTemplate>) => {
      updateStrategySettings(settings => {
        settings.objectiveTemplates = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).map(template => (
          template.key === objective ? normalizeActivityObjectiveTemplate({ ...template, ...patch, key: template.key }, template) : template
        ));
      });
    };
    const updateObjectiveStrategy = (objective: RedesignedActivityDesignObjective, patch: Partial<ActivityObjectiveStrategy>) => {
      updateStrategySettings(settings => {
        const options = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).map(activityObjectiveOptionFromTemplate);
        const current = normalizeActivityObjectiveStrategies(settings.objectiveStrategies, DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate, options)[objective];
        settings.objectiveStrategies[objective] = { ...current, ...patch };
      });
    };
    const addObjectiveStrategy = () => {
      updateStrategySettings(settings => {
        const key = uid('objective');
        const template = normalizeActivityObjectiveTemplate({
          key,
          enabled: true,
          name: '新经营目标',
          group: 'marketing',
          targetPayLabel: '0-25 自定义目标区',
          targetPayMin: 0,
          targetPayMax: 25,
          description: '自定义经营目标。'
        }, DEFAULT_ACTIVITY_OBJECTIVE_TEMPLATES[1]);
        settings.objectiveTemplates = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).concat(template);
        const strategy = defaultActivityObjectiveStrategies(DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate, [activityObjectiveOptionFromTemplate(template)])[key];
        settings.objectiveStrategies[key] = strategy;
      });
    };
    const objectiveStrategies = normalizeActivityObjectiveStrategies(strategySettings.objectiveStrategies, DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate, objectiveOptions);
    const objectiveStrategyRows = objectiveOptions.map(option => ({
      ...option,
      strategy: objectiveStrategies[option.value]
    }));
    return (
      <SystemStrategyPage
        strategySettings={strategySettings}
        rows={objectiveStrategyRows}
        isEditing={isSystemStrategyEditing}
        fullAmountBasisOptions={ACTIVITY_FULL_AMOUNT_BASIS_OPTIONS}
        couponRecommendationModeOptions={ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS}
        money={money}
        formatActivityOriginalDiscountTiers={formatActivityOriginalDiscountTiers}
        defaultActivityCouponRecommendationPolicy={defaultActivityCouponRecommendationPolicy}
        startEdit={startSystemStrategyEdit}
        cancelEdit={cancelSystemStrategyEdit}
        saveEdit={saveSystemStrategyEdit}
        restoreDefault={() => setSystemStrategyDraft(deepClone(DEFAULT_ACTIVITY_STRATEGY_SETTINGS))}
        addObjective={addObjectiveStrategy}
        updateSettings={updateStrategySettings}
        updateObjectiveTemplate={updateObjectiveTemplate}
        updateObjectiveStrategy={updateObjectiveStrategy}
        openActivityDiscountTierEditor={(objective, title, value, fallback) => openActivityDiscountTierEditor('system', objective, title, value, fallback)}
        fallbackStrategyForObjective={objective => defaultActivityObjectiveStrategies(DEFAULT_ACTIVITY_DESIGN_SETTINGS.targetProfitRate, objectiveOptions)[objective]}
      />
    );
  }

  function renderStorePage() {
    const pageStore = isStoreEditing && storeDraft ? storeDraft : store;
    const feeRule = effectiveFeeRule(state, pageStore);
    const pageActivityDesignSettings = activityDesignSettingsFromStore(pageStore);
    const effectivePageActivityDesignSettings = effectiveActivityDesignSettingsFromStore(pageStore, state.activityStrategySettings);
    const pageObjectiveOptions = activityObjectiveOptionsFromSettings(effectivePageActivityDesignSettings);
    const effectiveObjectiveStrategies = normalizeActivityObjectiveStrategies(effectivePageActivityDesignSettings.objectiveStrategies, effectivePageActivityDesignSettings.targetProfitRate, pageObjectiveOptions);
    const systemStrategySettings = normalizeActivityStrategySettings(state.activityStrategySettings);
    const storeUsesDefaultObjectiveStrategies = pageActivityDesignSettings.useDefaultObjectiveStrategies !== false;
    const updateActivityDesignDraft = (mutator: (settings: ActivityDesignSettings) => void) => {
      updateStoreDraft(draft => {
        const nextSettings = normalizeActivityDesignSettings(draft.activityDesignSettings);
        mutator(nextSettings);
        draft.activityDesignSettings = normalizeActivityDesignSettings(nextSettings);
      });
    };
    const setStoreUsesDefaultObjectiveStrategies = (checked: boolean) => {
      updateActivityDesignDraft(settings => {
        settings.useDefaultObjectiveStrategies = checked;
        if (checked) {
          settings.baseOriginalDiscountRate = undefined;
          settings.objectiveTemplates = [];
          settings.objectivePayTargets = {};
          settings.objectiveStrategies = {};
        } else {
          settings.baseOriginalDiscountRate = effectivePageActivityDesignSettings.baseOriginalDiscountRate ?? systemStrategySettings.baseOriginalDiscountRate;
          settings.objectiveTemplates = pageObjectiveOptions.map(option => ({
            key: option.value,
            enabled: option.enabled,
            name: option.label,
            group: option.group,
            targetPayLabel: option.targetPayLabel,
            targetPayMin: option.targetPayMin,
            targetPayMax: option.targetPayMax,
            description: option.description,
            baseObjective: option.baseObjective
          }));
          settings.objectiveStrategies = effectiveObjectiveStrategies;
        }
      });
    };
    const updateStoreObjectiveStrategy = (objective: RedesignedActivityDesignObjective, patch: Partial<ActivityObjectiveStrategy>) => {
      updateActivityDesignDraft(settings => {
        settings.useDefaultObjectiveStrategies = false;
        const rawStrategies = (settings.objectiveStrategies || settings.objectivePayTargets) as Partial<Record<RedesignedActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined;
        const strategies = normalizeActivityObjectiveStrategies(rawStrategies, settings.targetProfitRate, pageObjectiveOptions);
        strategies[objective] = { ...strategies[objective], ...patch };
        settings.objectiveStrategies = strategies;
        settings.objectiveTemplates = pageObjectiveOptions.map(option => ({
          key: option.value,
          enabled: option.enabled,
          name: option.label,
          group: option.group,
          targetPayLabel: option.targetPayLabel,
          targetPayMin: option.targetPayMin,
          targetPayMax: option.targetPayMax,
          description: option.description,
          baseObjective: option.baseObjective
        }));
      });
    };
    return (
      <StorePage
        pageStore={pageStore}
        platformProfitTargets={state.platformRules.profitTargets}
        feeRule={feeRule}
        isEditing={isStoreEditing}
        activityDesignSettings={pageActivityDesignSettings}
        effectiveActivityDesignSettings={effectivePageActivityDesignSettings}
        objectiveOptions={pageObjectiveOptions}
        effectiveObjectiveStrategies={effectiveObjectiveStrategies}
        systemStrategySettings={systemStrategySettings}
        usesDefaultObjectiveStrategies={storeUsesDefaultObjectiveStrategies}
        fullAmountBasisOptions={ACTIVITY_FULL_AMOUNT_BASIS_OPTIONS}
        couponRecommendationModeOptions={ACTIVITY_COUPON_RECOMMENDATION_MODE_OPTIONS}
        activityMinNetPay={ACTIVITY_MIN_NET_PAY}
        money={money}
        activityDesignModeName={activityDesignModeName}
        formatActivityOriginalDiscountTiers={formatActivityOriginalDiscountTiers}
        defaultActivityCouponRecommendationPolicy={defaultActivityCouponRecommendationPolicy}
        normalizeActivityObjectiveStrategies={normalizeActivityObjectiveStrategies}
        startEdit={startStoreEdit}
        cancelEdit={cancelStoreEdit}
        saveEdit={saveStoreEdit}
        duplicateStore={duplicateStore}
        deleteStore={deleteStore}
        updateStore={updateStoreDraft}
        updateActivityDesign={updateActivityDesignDraft}
        setUsesDefaultObjectiveStrategies={setStoreUsesDefaultObjectiveStrategies}
        updateObjectiveStrategy={updateStoreObjectiveStrategy}
        openActivityDiscountTierEditor={(objective, title, value, fallback) => openActivityDiscountTierEditor('store', objective, title, value, fallback)}
      />
    );
  }

  function clearProductFilters() {
    setProductSearchText('');
    setProductCategoryFilter('all');
    setProductStatusFilter('all');
    setProductSortField('name');
    setProductSortAsc(true);
  }

  function renderProductsPage() {
    return (
      <ProductsPage
        storeId={store.id}
        isEditing={isProductsEditing}
        productSource={productSource}
        displayedProducts={displayedProducts}
        selectedProductCount={selectedProductCount}
        duplicateGroupCount={productDuplicateGroups.length}
        productSearchText={productSearchText}
        productCategoryFilter={productCategoryFilter}
        productStatusFilter={productStatusFilter}
        productSortField={productSortField}
        productSortAsc={productSortAsc}
        productCategories={PRODUCT_CATEGORIES}
        productColumns={productColumns}
        productRowSelection={productRowSelection}
        bulkText={bulkText}
        bulkProductCategory={bulkProductCategory}
        bulkStapleServingCount={bulkStapleServingCount}
        bulkPriceField={bulkPriceField}
        bulkPriceMode={bulkPriceMode}
        bulkPriceValue={bulkPriceValue}
        uploadProps={uploadProps}
        importPlatformProducts={importPlatformProducts}
        importCostFile={importCostFile}
        importProductsFile={importProductsFile}
        addProduct={() => updateProductsDraft(draft => { draft.push(normalizeProduct({ id: uid('p'), name: '新商品', price: 0, cost: 0, meituanEnabled: true, elemeEnabled: true })); })}
        startEdit={startProductsEdit}
        cancelEdit={cancelProductsEdit}
        saveEdit={saveProductsEdit}
        setProductSearchText={setProductSearchText}
        setProductCategoryFilter={setProductCategoryFilter}
        setProductStatusFilter={setProductStatusFilter}
        setProductSortField={setProductSortField}
        setProductSortAsc={setProductSortAsc}
        clearProductFilters={clearProductFilters}
        setBulkText={setBulkText}
        applyBulkProducts={applyBulkProducts}
        setSelectedProductIds={ids => setSelectedProductRowKeys(ids)}
        selectMissingCostProducts={() => setSelectedProductRowKeys(displayedProducts.filter(product => product.cost <= 0).map(product => product.id))}
        selectFirstDuplicateProductGroup={selectFirstDuplicateProductGroup}
        mergeSelectedDuplicateProducts={mergeSelectedDuplicateProducts}
        clearSelectedProducts={() => setSelectedProductRowKeys([])}
        bulkSetProductFlag={bulkSetProductFlag}
        setBulkProductCategory={setBulkProductCategory}
        bulkSetProductCategory={bulkSetProductCategory}
        setBulkStapleServingCount={setBulkStapleServingCount}
        bulkSetStapleServingCount={bulkSetStapleServingCount}
        setBulkPriceField={setBulkPriceField}
        setBulkPriceMode={setBulkPriceMode}
        setBulkPriceValue={setBulkPriceValue}
        applyBulkPriceEdit={applyBulkPriceEdit}
        bulkClearPlatformOverride={bulkClearPlatformOverride}
        deleteZeroPriceProducts={deleteZeroPriceProducts}
        bulkDeleteProducts={bulkDeleteProducts}
        productCategoryName={productCategoryName}
        tablePagination={tablePagination}
      />
    );
  }

  function renderPlatformPage() {
    const fee = isPlatformEditing && platformDraft ? platformDraft : state.platformRules;
    return (
      <PlatformPage
        fee={{ ...fee, pricingStrategy: normalizePricingStrategy(fee.pricingStrategy) }}
        isEditing={isPlatformEditing}
        scenarios={STAPLE_SCENARIOS}
        money={money}
        stapleScenarioName={stapleScenarioName}
        startEdit={startPlatformEdit}
        cancelEdit={cancelPlatformEdit}
        saveEdit={savePlatformEdit}
        updateFeeField={(field, value) => updatePlatformDraft(draft => { (draft as unknown as Record<string, number>)[field] = value; })}
        changeProfitTargets={rows => updatePlatformDraft(draft => { draft.profitTargets = rows; })}
        addProfitTarget={() => updatePlatformDraft(draft => { draft.profitTargets.push({ enabled: true, payMin: 0, payMax: 20, rateMin: 20, rateMax: 30 }); })}
        changePricingStrategy={strategy => updatePlatformDraft(draft => { draft.pricingStrategy = normalizePricingStrategy(strategy); })}
        changeRedTiers={(platform, rows) => updatePlatformDraft(draft => { draft.redTiers[platform] = rows; })}
      />
    );
  }

  function renderActivityPage(platform: Platform) {
    const isEditing = editingActivityPlatform === platform && activityDraft !== null;
    const activities = isEditing && activityDraft ? activityDraft : store.activities[platform];
    return (
      <ActivityPage
        platform={platform}
        storeName={store.name}
        isEditing={isEditing}
        activities={activities}
        money={money}
        startEdit={startActivityEdit}
        cancelEdit={cancelActivityEdit}
        saveEdit={saveActivityEdit}
        changeFullReductions={rows => updateActivityDraft(draft => { draft.fullReductions = rows; })}
        changeCoupons={rows => updateActivityDraft(draft => { draft.coupons = rows; })}
        changeRedAddOns={rows => updateActivityDraft(draft => { draft.redAddOns = rows; })}
        changeDiscountActivities={rows => updateActivityDraft(draft => { draft.discountActivities = rows; })}
      />
    );
  }

  function renderActivityDesignPage() {
    const designSummary = activityDesign?.summary || (isActivityDesignLoading ? summary : { ...EMPTY_SUMMARY });
    const activityDesignStepCurrent = activityDesignStage === 'payValidation'
      ? 2
      : activityDesignStage === 'routeDesign'
        ? 1
        : 0;
    const changeActivityDesignStep = (current: number) => {
      const nextStage: ActivityDesignStage = current === 2 ? 'payValidation' : current === 1 ? 'routeDesign' : 'priceScan';
      setActivityDesignStage(nextStage);
    };
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
    const activityCurrentObjectiveStrategy = normalizeActivityObjectiveStrategies(
      storeActivityDesignSettings.objectiveStrategies,
      storeActivityDesignSettings.targetProfitRate,
      activityRouteObjectiveOptions
    )[storeActivityDesignSettings.objective || 'longTerm'];
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
    const updateActivityDesignPayBandKey = (platform: Platform, key: string) => {
      setSelectedActivityDesignPayBandKeyByPlatform(prev => ({ ...prev, [platform]: key }));
    };
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
      ? expandActivityOriginalBucketCombos(activityDesign, selectedActivityOriginalBucket, state, store, storeActivityDesignSettings)
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
      const routePackages = independentRoutes.length ? independentRoutes : buildActivityRoutePackages(platform, fullRoutes, couponRoutes, storeActivityDesignSettings);
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
              <PriceBucketProfitChart rows={originalPriceBuckets} />
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
          {renderProductDiscountSuggestionPanel(validationComboRows, {
            source: 'activityValidation',
            title: '活动路线商品维度合理成本结论',
            limit: 80,
            includeNeutral: true,
            description: '商品结论按当前路线当前平台的全部支付价核验组合计算；支付价区间只用于查看明细，不再决定商品处理结论。主商品比较活动合理成本和当前成本，凑单品只判断分摊到手是否覆盖成本。'
          })}
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

  function renderDataAnalysisPage() {
    const platformDailyRows = filteredBusinessRecords;
    type BusinessChartMemoUnit = 'count' | 'rate' | 'money';
    type BusinessTrendChartDatum = {
      key: string;
      value: number;
      platform: Platform;
      platformName: string;
      series?: string;
      metric?: string;
      date?: string;
      weekStart?: string;
      weekLabel?: string;
    } & Record<string, unknown>;
    type BusinessTrendInflectionSeverity = 'drop' | 'rise' | 'volatile';
    type BusinessTrendInflectionRow = {
      key: string;
      sourceKey: string;
      dateStart: string;
      dateEnd: string;
      dateLabel: string;
      platform: Platform;
      platformName: string;
      chartTitle: string;
      metricName: string;
      currentValue: number;
      baselineValue: number;
      changeValue: number;
      changeRate: number | null;
      unit: BusinessChartMemoUnit;
      severity: BusinessTrendInflectionSeverity;
      chartLabel: string;
      reason: string;
      suggestion: string;
      memoCount: number;
      memoText: string;
    };
    const moneyTrendRows = platformDailyRows.flatMap(row => [
      { key: `${row.date}-${row.platform}-actualReceipt`, date: row.date, platform: row.platform, platformName: row.platformName, metric: `${row.platformName}实收`, value: roundMoney(row.actualReceipt) },
      { key: `${row.date}-${row.platform}-grossSales`, date: row.date, platform: row.platform, platformName: row.platformName, metric: `${row.platformName}营业额`, value: roundMoney(row.grossSales) },
      { key: `${row.date}-${row.platform}-merchantActivityCost`, date: row.date, platform: row.platform, platformName: row.platformName, metric: `${row.platformName}活动成本`, value: roundMoney(row.merchantActivityCost) }
    ]).filter(row => Number.isFinite(row.value));
    const visitRateTrendRows = platformDailyRows.map(row => ({
      key: `${row.date}-${row.platform}-visitRate`,
      date: row.date,
      platform: row.platform,
      platformName: row.platformName,
      metric: `${row.platformName}入店率`,
      value: row.visitRate === null ? null : roundMoney(row.visitRate * 100)
    })).filter((row): row is { key: string; date: string; platform: Platform; platformName: string; metric: string; value: number } => row.value !== null && Number.isFinite(row.value));
    const orderRateTrendRows = platformDailyRows.map(row => ({
      key: `${row.date}-${row.platform}-orderRate`,
      date: row.date,
      platform: row.platform,
      platformName: row.platformName,
      metric: `${row.platformName}下单率`,
      value: row.orderRate === null ? null : roundMoney(row.orderRate * 100)
    })).filter((row): row is { key: string; date: string; platform: Platform; platformName: string; metric: string; value: number } => row.value !== null && Number.isFinite(row.value));
    const businessTrendDateSpanDays = businessDateSpanDays(
      businessAnalysisDateStart || businessSummary.dateStart,
      businessAnalysisDateEnd || businessSummary.dateEnd
    );
    const isBusinessShortTrendRange = businessTrendDateSpanDays > 0 && businessTrendDateSpanDays < BUSINESS_WEEKLY_TREND_MIN_DAYS;
    const dailyTrendChartRows = platformDailyRows.map(row => ({
      key: `${row.date}-${row.platform}-daily`,
      date: row.date,
      platform: row.platform,
      platformName: row.platformName,
      series: '每日',
      exposureUsers: row.exposureUsers,
      visitUsers: row.visitUsers,
      orderUsers: row.orderUsers
    }));
    const weeklyTrendChartRows = businessWeeklyRows
      .slice()
      .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.platform.localeCompare(b.platform))
      .flatMap(row => {
        const weekdayRows = BUSINESS_WEEKDAY_LABELS.flatMap((weekdayLabel, weekdayIndex) => {
          const day = row.days[weekdayIndex];
          if (!day) return [];
          return [{
            key: `${row.key}-${weekdayIndex}`,
            weekLabel: row.weekLabel,
            weekStart: row.weekStart,
            platform: row.platform,
            platformName: row.platformName,
            weekdayIndex,
            weekdayLabel,
            series: weekdayLabel,
            exposureUsers: day.exposureUsers,
            visitUsers: day.visitUsers,
            orderUsers: day.orderUsers,
            validOrders: day.validOrders,
            actualReceipt: roundMoney(day.actualReceipt),
            visitRate: day.visitRate === null ? null : roundMoney(day.visitRate * 100),
            orderRate: day.orderRate === null ? null : roundMoney(day.orderRate * 100),
            isWeekTotal: false
          }];
        });
        return weekdayRows.concat({
          key: `${row.key}-total`,
          weekLabel: row.weekLabel,
          weekStart: row.weekStart,
          platform: row.platform,
          platformName: row.platformName,
          weekdayIndex: BUSINESS_WEEKDAY_LABELS.length,
          weekdayLabel: BUSINESS_WEEK_TOTAL_LABEL,
          series: BUSINESS_WEEK_TOTAL_LABEL,
          exposureUsers: row.total.exposureUsers,
          visitUsers: row.total.visitUsers,
          orderUsers: row.total.orderUsers,
          validOrders: row.total.validOrders,
          actualReceipt: roundMoney(row.total.actualReceipt),
          visitRate: row.total.visitRate === null ? null : roundMoney(row.total.visitRate * 100),
          orderRate: row.total.orderRate === null ? null : roundMoney(row.total.orderRate * 100),
          isWeekTotal: true
        });
      });
    const weeklyTrendPlatformGroups = PLATFORMS
      .map(platform => ({
        platform,
        platformName: PLATFORM_NAMES[platform],
        rows: (isBusinessShortTrendRange ? dailyTrendChartRows : weeklyTrendChartRows).filter(row => row.platform === platform)
      }))
      .filter(group => group.rows.length);
    const businessTrendCardTitle = isBusinessShortTrendRange ? '按天变化（日趋势）' : '按周变化（星期对比）';
    const businessTrendDescription = isBusinessShortTrendRange
      ? `当前日期范围少于${BUSINESS_WEEKLY_TREND_MIN_DAYS}天，按日展示曝光、入店和下单变化；平台分开展示。可拖动图表底部滑块缩放日期范围。`
      : `当前日期范围达到${BUSINESS_WEEKLY_TREND_MIN_DAYS}天及以上，横轴是自然周，每条线代表周一到周日中的某一天，并额外展示周总计曲线；平台分开展示。可拖动图表底部滑块缩放自然周范围。`;
    const businessTrendGroupDescription = isBusinessShortTrendRange
      ? '按每天的经营数据展示当前范围内变化。'
      : '每条线为一个星期几，周总计为该平台当周合计口径。';
    const businessTrendXField = isBusinessShortTrendRange ? 'date' : 'weekLabel';
    const businessTrendXTitle = isBusinessShortTrendRange ? '日期' : '自然周';
    const businessFunnelChartGroups = PLATFORMS
      .filter(platform => businessAnalysisPlatform === 'all' || platform === businessAnalysisPlatform)
      .map(platform => {
        const row = businessPlatformRows.find(item => item.platform === platform);
        const totalRows = row ? businessFunnelChartRows(row) : [];
        const newRows = row ? businessCustomerFunnelChartRows(row, 'new') : [];
        const oldRows = row ? businessCustomerFunnelChartRows(row, 'old') : [];
        return {
          platform,
          platformName: PLATFORM_NAMES[platform],
          row,
          rows: totalRows,
          funnels: [
            {
              key: 'total',
              title: '总漏斗',
              rows: totalRows,
              emptyText: `暂无${PLATFORM_NAMES[platform]}总漏斗数据`,
              colors: ['#376996', '#4f8f73', '#d1902f']
            },
            {
              key: 'new',
              title: '新客漏斗',
              rows: newRows,
              emptyText: row?.customerBreakdownProvided ? '暂无新客漏斗数据' : '日报未提供新客字段',
              colors: ['#376996', '#4f8f73', '#d1902f']
            },
            {
              key: 'old',
              title: '老客漏斗',
              rows: oldRows,
              emptyText: row?.customerBreakdownProvided ? '暂无老客漏斗数据' : '日报未提供老客字段',
              colors: ['#6d6aa8', '#8f5f42', '#b7791f']
            }
          ]
        };
      });
    const businessCustomerPlatformGroups = PLATFORMS
      .filter(platform => businessAnalysisPlatform === 'all' || platform === businessAnalysisPlatform)
      .map(platform => {
        const row = businessPlatformRows.find(item => item.platform === platform);
        const rows = platformDailyRows.filter(item => item.platform === platform && (item.customerBreakdownProvided || item.repeatDataProvided));
        const customerRows = rows.filter(item => item.customerBreakdownProvided);
        const orderRows = customerRows.flatMap(item => [
          { key: `${item.key}-new-order-users`, date: item.date, platform: item.platform, platformName: item.platformName, series: '新客下单人数', value: item.newOrderUsers },
          { key: `${item.key}-old-order-users`, date: item.date, platform: item.platform, platformName: item.platformName, series: '老客下单人数', value: item.oldOrderUsers }
        ]);
        const rateRows = customerRows.flatMap(item => [
          item.newVisitRate === null ? null : { key: `${item.key}-new-visit-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '新客入店率', value: roundMoney(item.newVisitRate * 100) },
          item.oldVisitRate === null ? null : { key: `${item.key}-old-visit-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '老客入店率', value: roundMoney(item.oldVisitRate * 100) },
          item.newOrderRate === null ? null : { key: `${item.key}-new-order-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '新客下单率', value: roundMoney(item.newOrderRate * 100) },
          item.oldOrderRate === null ? null : { key: `${item.key}-old-order-rate`, date: item.date, platform: item.platform, platformName: item.platformName, series: '老客下单率', value: roundMoney(item.oldOrderRate * 100) }
        ]).filter((item): item is { key: string; date: string; platform: Platform; platformName: string; series: string; value: number } => Boolean(item));
        const repeatRows = rows.flatMap(item => [
          item.repeatRate7d === null ? null : { key: `${item.key}-repeat-7d`, date: item.date, platform: item.platform, platformName: item.platformName, series: '近7日复购率', value: roundMoney(item.repeatRate7d * 100) },
          item.repeatRate30d === null ? null : { key: `${item.key}-repeat-30d`, date: item.date, platform: item.platform, platformName: item.platformName, series: '近30日复购率', value: roundMoney(item.repeatRate30d * 100) },
          item.platformRepeatRate === null ? null : { key: `${item.key}-repeat-platform`, date: item.date, platform: item.platform, platformName: item.platformName, series: '平台复购率', value: roundMoney(item.platformRepeatRate * 100) }
        ]).filter((item): item is { key: string; date: string; platform: Platform; platformName: string; series: string; value: number } => Boolean(item));
        return {
          platform,
          platformName: PLATFORM_NAMES[platform],
          row,
          rows,
          customerRows,
          orderRows,
          rateRows,
          repeatRows
        };
      })
      .filter(group => group.row && (group.rows.length || group.row.customerBreakdownProvided || group.row.repeatDataProvided));
    const businessMemoNotes = businessNotes.filter(row => row.kind === 'memo');
    const businessMemoNotesForRecord = (row: BusinessDailyRecord) => (
      businessMemoNotes.filter(note => businessNoteMatchesRecord(note, row))
    );
    const businessMemoNotesForDate = (date: string) => (
      businessMemoNotes.filter(note => businessNoteContainsDate(note, date) && businessNoteMatchesPlatformFilter(note, businessAnalysisPlatform))
    );
    const renderBusinessNoteTags = (notes: BusinessAnalysisNote[]) => {
      if (!notes.length) return <Text type="secondary">无</Text>;
      return (
        <Space wrap size={[4, 4]}>
          {notes.slice(0, 3).map(note => (
            <Tooltip key={note.id} title={businessNoteItemsText(note)}>
              <Tag color="purple">{note.title}</Tag>
            </Tooltip>
          ))}
          {notes.length > 3 ? <Tag>+{notes.length - 3}</Tag> : null}
        </Space>
      );
    };
    const businessTrendDatumMetricName = (row: BusinessTrendChartDatum, fallback: string) => (
      String(row.series || row.metric || fallback)
    );
    const businessTrendInflectionSourceKey = (chartTitle: string, row: BusinessTrendChartDatum) => (
      `${chartTitle}::${businessTrendDatumMetricName(row, chartTitle)}::${row.key}`
    );
    const businessTrendValueText = (unit: BusinessChartMemoUnit, value: number) => {
      if (unit === 'rate') return `${money(value)}%`;
      if (unit === 'money') return `¥${money(value)}`;
      return `${Math.round(value)}`;
    };
    const businessTrendChangeText = (row: BusinessTrendInflectionRow) => {
      const sign = row.changeValue > 0 ? '+' : '';
      const rateTextValue = row.changeRate === null ? '' : ` / ${row.changeRate > 0 ? '+' : ''}${money(row.changeRate * 100)}%`;
      if (row.unit === 'rate') return `${sign}${money(row.changeValue)}个百分点${rateTextValue}`;
      if (row.unit === 'money') return `${row.changeValue > 0 ? '+' : '-'}¥${money(Math.abs(row.changeValue))}${rateTextValue}`;
      return `${sign}${Math.round(row.changeValue)}${rateTextValue}`;
    };
    const businessTrendInflectionColor = (severity: BusinessTrendInflectionSeverity) => (
      severity === 'drop' ? 'red' : severity === 'rise' ? 'green' : 'orange'
    );
    const businessTrendInflectionText = (severity: BusinessTrendInflectionSeverity) => (
      severity === 'drop' ? '下降拐点' : severity === 'rise' ? '回升拐点' : '异常波动'
    );
    const businessTrendSeriesName = (text: string, platformName: string) => (
      text.startsWith(platformName) ? text.slice(platformName.length) || text : text
    );
    const businessTrendInflectionLabelText = (row: BusinessTrendInflectionRow) => {
      const direction = row.severity === 'drop' ? '下降' : row.severity === 'rise' ? '回升' : '波动';
      const sign = row.changeValue > 0 ? '+' : '';
      if (row.unit === 'rate') return `${direction} ${sign}${money(row.changeValue)}pp`;
      if (typeof row.changeRate === 'number' && Number.isFinite(row.changeRate)) {
        return `${direction} ${row.changeRate > 0 ? '+' : ''}${money(row.changeRate * 100)}%`;
      }
      if (row.unit === 'money') return `${direction} ${row.changeValue > 0 ? '+' : '-'}¥${money(Math.abs(row.changeValue))}`;
      return `${direction} ${sign}${Math.round(row.changeValue)}`;
    };
    const businessTrendDeltaText = (unit: BusinessChartMemoUnit, value: number) => {
      const sign = value > 0 ? '+' : '';
      if (unit === 'rate') return `${sign}${money(value)}pp`;
      if (unit === 'money') return `${value > 0 ? '+' : '-'}¥${money(Math.abs(value))}`;
      return `${sign}${Math.round(value)}`;
    };
    const businessTrendInvestigationText = (metricName: string, severity: BusinessTrendInflectionSeverity) => {
      const name = metricName.replace(/^美团|^饿了么/, '');
      if (/曝光/.test(name)) return '优先排查平台流量、搜索/推荐排名、营业时长、配送范围和平台活动入口变化。';
      if (/入店人数/.test(name)) return '优先排查曝光质量、门店首图、配送费、起送价、评分和活动吸引力。';
      if (/入店率/.test(name)) return '曝光存在但进店转弱，优先排查门店展示、活动标签、配送费和竞品对比。';
      if (/下单数|下单人数/.test(name)) return '优先拆成入店人数和下单率，排查价格、券、满减、缺货和主推商品结构。';
      if (/下单率|转化率/.test(name)) return '入店后的成交转化变化，优先排查活动力度、券配置、商品价格、套餐结构和缺货。';
      if (/复购/.test(name)) return '优先排查老客返券、会员触达、产品稳定性、履约体验和近期差评。';
      if (/实收|营业额|金额/.test(name)) return '先按曝光、入店率、下单率、客单价拆解，再判断是流量、转化还是商品结构问题。';
      if (/活动成本/.test(name)) return '活动成本异常时，排查满减、券、平台活动报名和低价商品成交占比。';
      return severity === 'drop'
        ? '优先查看同日漏斗、商品结构和备忘事件，确认是否存在活动、缺货或配送变化。'
        : '对照同日备忘和活动配置，确认回升是否来自活动调整、流量恢复或商品结构变化。';
    };
    const businessTrendSuggestionText = (row: BusinessTrendInflectionRow) => {
      if (row.memoCount > 0) return '已有备忘，先核对备忘事件是否能解释该变化；如不能解释，再补充排查结论。';
      return row.severity === 'drop'
        ? '当前范围暂无匹配备忘，建议补充当天或该周发生的活动、缺货、配送、竞品、天气等原因。'
        : '建议补充回升原因，后续可复用为有效动作或恢复路径。';
    };
    const businessTrendInflectionMeetsThreshold = (
      unit: BusinessChartMemoUnit,
      current: number,
      baseline: number,
      changeValue: number,
      changeRate: number | null
    ) => {
      const absChange = Math.abs(changeValue);
      const absRate = Math.abs(changeRate ?? 1);
      if (unit === 'rate') return absChange >= 2 && (absChange >= 3 || absRate >= 0.12);
      if (unit === 'money') return absChange >= 50 && absRate >= 0.12;
      const baseVolume = Math.max(Math.abs(current), Math.abs(baseline));
      if (baseVolume < 10) return absChange >= 5;
      return absChange >= 3 && absRate >= 0.15;
    };
    const collectBusinessTrendInflections = (
      rows: BusinessTrendChartDatum[],
      chartTitle: string,
      unit: BusinessChartMemoUnit
    ): BusinessTrendInflectionRow[] => {
      const groups = new Map<string, BusinessTrendChartDatum[]>();
      rows
        .filter(row => Number.isFinite(row.value))
        .forEach(row => {
          const groupKey = `${row.platform}::${businessTrendDatumMetricName(row, chartTitle)}`;
          groups.set(groupKey, [...(groups.get(groupKey) || []), row]);
        });
      const nextRows: BusinessTrendInflectionRow[] = [];
      groups.forEach(groupRows => {
        const sortedRows = groupRows.slice().sort((a, b) => (
          String(a.weekStart || a.date || '').localeCompare(String(b.weekStart || b.date || ''))
        ));
        sortedRows.forEach((row, index) => {
          const currentValue = Number(row.value);
          const date = normalizeBusinessDate(row.date);
          const weekStart = normalizeBusinessDate(row.weekStart);
          const sameWeekdayBaseline = date
            ? sortedRows.find(item => normalizeBusinessDate(item.date) === businessAddDays(date, -7))
            : null;
          const baselineRow = sameWeekdayBaseline || sortedRows[index - 1];
          if (!baselineRow) return;
          const baselineValue = Number(baselineRow.value);
          if (!Number.isFinite(currentValue) || !Number.isFinite(baselineValue) || currentValue === baselineValue) return;
          const changeValue = roundMoney(currentValue - baselineValue);
          const changeRate = baselineValue === 0 ? null : changeValue / Math.abs(baselineValue);
          if (!businessTrendInflectionMeetsThreshold(unit, currentValue, baselineValue, changeValue, changeRate)) return;
          const nextRow = sortedRows[index + 1];
          const nextValue = nextRow ? Number(nextRow.value) : null;
          const returnsNearBaseline = nextValue !== null
            && Number.isFinite(nextValue)
            && Math.abs(nextValue - baselineValue) <= Math.max(1, Math.abs(changeValue) * 0.35);
          const severity: BusinessTrendInflectionSeverity = returnsNearBaseline
            ? 'volatile'
            : changeValue < 0 ? 'drop' : 'rise';
          const dateStart = date || weekStart;
          const dateEnd = date || (weekStart ? businessAddDays(weekStart, 6) : dateStart);
          if (!dateStart || !dateEnd) return;
          const matchedNotes = businessMemoNotes.filter(note => (
            businessNoteMatchesPlatformFilter(note, row.platform)
            && businessNoteOverlapsDateRange(note, dateStart, dateEnd)
          ));
          const metricName = businessTrendDatumMetricName(row, chartTitle);
          nextRows.push({
            key: `${chartTitle}-${row.key}`,
            sourceKey: businessTrendInflectionSourceKey(chartTitle, row),
            dateStart,
            dateEnd,
            dateLabel: businessDateRangeText(dateStart, dateEnd),
            platform: row.platform,
            platformName: row.platformName,
            chartTitle,
            metricName,
            currentValue,
            baselineValue,
            changeValue,
            changeRate,
            unit,
            severity,
            chartLabel: severity === 'drop' ? '下降' : severity === 'rise' ? '回升' : '波动',
            reason: businessTrendInvestigationText(metricName, severity),
            suggestion: '',
            memoCount: matchedNotes.length,
            memoText: matchedNotes.map(note => `${note.title}：${businessNoteItemsText(note)}`).join('；')
          });
        });
      });
      return nextRows.map(row => ({
        ...row,
        suggestion: businessTrendSuggestionText(row)
      }));
    };
    const businessTrendAllInflectionRows = [
      ...collectBusinessTrendInflections(moneyTrendRows, '金额趋势（按平台）', 'money'),
      ...collectBusinessTrendInflections(visitRateTrendRows, '入店率趋势（按平台）', 'rate'),
      ...collectBusinessTrendInflections(orderRateTrendRows, '下单率趋势（按平台）', 'rate'),
      ...businessCustomerPlatformGroups.flatMap(group => [
        ...collectBusinessTrendInflections(group.orderRows, `${group.platformName}新老客下单人数趋势`, 'count'),
        ...collectBusinessTrendInflections(group.rateRows, `${group.platformName}新老客转化率趋势`, 'rate'),
        ...collectBusinessTrendInflections(group.repeatRows, `${group.platformName}复购率趋势`, 'rate')
      ]),
      ...weeklyTrendPlatformGroups.flatMap(group => {
        const exposureRows = group.rows.map(row => ({ ...row, value: row.exposureUsers }));
        const visitRows = group.rows.map(row => ({ ...row, value: row.visitUsers }));
        const orderUserRows = group.rows.map(row => ({ ...row, value: row.orderUsers }));
        return [
          ...collectBusinessTrendInflections(exposureRows, `${group.platformName}曝光人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`, 'count'),
          ...collectBusinessTrendInflections(visitRows, `${group.platformName}入店人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`, 'count'),
          ...collectBusinessTrendInflections(orderUserRows, `${group.platformName}下单数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`, 'count')
        ];
      })
    ]
      .sort((a, b) => {
        const severityWeight = (row: BusinessTrendInflectionRow) => row.severity === 'drop' ? 0 : row.severity === 'volatile' ? 1 : 2;
        const severityDiff = severityWeight(a) - severityWeight(b);
        if (severityDiff !== 0) return severityDiff;
        return Math.abs(b.changeRate ?? b.changeValue) - Math.abs(a.changeRate ?? a.changeValue);
      })
    const businessTrendInflectionRows = businessTrendAllInflectionRows.slice(0, 16);
    const businessTrendInflectionBySourceKey = new Map(businessTrendAllInflectionRows.map(row => [row.sourceKey, row]));
    type BusinessTimeSeriesAnomalyRow = BusinessTrendChartDatum & {
      series: string;
      xLabel: string;
      xKey: string;
      sourceTitle: string;
      anomalyLabel: string;
      anomalyDetail: string;
      anomalySeverityText: string;
      baselineValue: number | null;
      changeValue: number | null;
      changeRate: number | null;
      anomalySortWeight: number;
      pointSize: number;
    };
    type BusinessAnomalyDeltaRow = {
      key: string;
      xLabel: string;
      xKey: string;
      platform: Platform;
      platformName: string;
      series: string;
      value: number;
      baselineValue: number;
      currentValue: number;
      changeRate: number | null;
      anomalyLabel: string;
      anomalyDetail: string;
      anomalySeverityText: string;
      dateStart: string;
      dateEnd: string;
    };
    const buildBusinessTimeSeriesAnomalyRow = (
      row: BusinessTrendChartDatum,
      sourceTitle: string,
      displaySeries: string
    ): BusinessTimeSeriesAnomalyRow => {
      const inflection = businessTrendInflectionBySourceKey.get(businessTrendInflectionSourceKey(sourceTitle, row));
      const rawXLabel = String(row.date || row.weekLabel || row.weekStart || '');
      const series = businessTrendSeriesName(displaySeries, row.platformName);
      return {
        ...row,
        key: `${sourceTitle}-${series}-${row.key}`,
        series,
        metric: series,
        xLabel: rawXLabel,
        xKey: String(row.date || row.weekStart || rawXLabel),
        sourceTitle,
        anomalyLabel: inflection ? businessTrendInflectionLabelText(inflection) : '',
        anomalyDetail: inflection ? `${businessTrendInflectionText(inflection.severity)}，${businessTrendChangeText(inflection)}` : '',
        anomalySeverityText: inflection ? businessTrendInflectionText(inflection.severity) : '',
        baselineValue: inflection ? inflection.baselineValue : null,
        changeValue: inflection ? inflection.changeValue : null,
        changeRate: inflection ? inflection.changeRate : null,
        anomalySortWeight: inflection ? Math.abs(inflection.changeRate ?? inflection.changeValue) : 0,
        pointSize: inflection ? 5.5 : 0
      };
    };
    const businessVisitRateAnomalyRows: BusinessTimeSeriesAnomalyRow[] = [
      ...visitRateTrendRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, '入店率趋势（按平台）', row.metric)),
      ...businessCustomerPlatformGroups.flatMap(group => (
        group.rateRows
          .filter(row => row.series.includes('入店率'))
          .map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}新老客转化率趋势`, `${group.platformName}${row.series}`))
      ))
    ].sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessOrderRateAnomalyRows: BusinessTimeSeriesAnomalyRow[] = [
      ...orderRateTrendRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, '下单率趋势（按平台）', row.metric)),
      ...businessCustomerPlatformGroups.flatMap(group => (
        group.rateRows
          .filter(row => row.series.includes('下单率'))
          .map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}新老客转化率趋势`, `${group.platformName}${row.series}`))
      ))
    ].sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessCustomerOrderAnomalyRows: BusinessTimeSeriesAnomalyRow[] = businessCustomerPlatformGroups
      .flatMap(group => (
        group.orderRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}新老客下单人数趋势`, `${group.platformName}${row.series}`))
      ))
      .sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessRepeatRateAnomalyRows: BusinessTimeSeriesAnomalyRow[] = businessCustomerPlatformGroups
      .flatMap(group => (
        group.repeatRows.map(row => buildBusinessTimeSeriesAnomalyRow(row, `${group.platformName}复购率趋势`, `${group.platformName}${row.series}`))
      ))
      .sort((a, b) => a.xLabel.localeCompare(b.xLabel) || a.series.localeCompare(b.series));
    const businessTrendAnomalySourceGroups = [
      { key: 'visit-rate', title: '入店率时序异常（总/新客/老客）', yTitle: '入店率', unit: 'rate' as BusinessChartMemoUnit, rows: businessVisitRateAnomalyRows },
      { key: 'order-rate', title: '下单率时序异常（总/新客/老客）', yTitle: '下单率', unit: 'rate' as BusinessChartMemoUnit, rows: businessOrderRateAnomalyRows },
      { key: 'customer-order', title: '新老客下单人数时序异常', yTitle: '下单人数', unit: 'count' as BusinessChartMemoUnit, rows: businessCustomerOrderAnomalyRows },
      { key: 'repeat-rate', title: '复购率时序异常', yTitle: '复购率', unit: 'rate' as BusinessChartMemoUnit, rows: businessRepeatRateAnomalyRows }
    ];
    const buildBusinessAnomalyDeltaRows = (rows: BusinessTimeSeriesAnomalyRow[]): BusinessAnomalyDeltaRow[] => (
      rows
        .filter(row => row.anomalyLabel && row.baselineValue !== null && row.changeValue !== null)
        .map(row => ({
          key: `${row.key}-delta`,
          xLabel: row.xLabel,
          xKey: row.xKey,
          platform: row.platform,
          platformName: row.platformName,
          series: row.series,
          value: Number(row.changeValue || 0),
          baselineValue: Number(row.baselineValue || 0),
          currentValue: Number(row.value || 0),
          changeRate: row.changeRate,
          anomalyLabel: row.anomalyLabel,
          anomalyDetail: row.anomalyDetail,
          anomalySeverityText: row.anomalySeverityText,
          dateStart: normalizeBusinessDate(row.date) || normalizeBusinessDate(row.weekStart) || row.xKey,
          dateEnd: normalizeBusinessDate(row.date) || (normalizeBusinessDate(row.weekStart) ? businessAddDays(String(row.weekStart), 6) : row.xKey)
        }))
    );
    const businessTrendAnomalyChartGroups = businessTrendAnomalySourceGroups
      .flatMap(group => PLATFORMS.map(platform => {
        const rows = group.rows.filter(row => row.platform === platform);
        const anomalies = rows
          .filter(row => row.anomalyLabel)
          .sort((a, b) => (
            String(a.date || a.weekStart || '').localeCompare(String(b.date || b.weekStart || ''))
            || b.anomalySortWeight - a.anomalySortWeight
          ));
        return {
          ...group,
          key: `${group.key}-${platform}`,
          title: `${PLATFORM_NAMES[platform]}${group.title.replace('时序异常', '趋势诊断')}`,
          platform,
          platformName: PLATFORM_NAMES[platform],
          rows,
          anomalies,
          deltaRows: buildBusinessAnomalyDeltaRows(rows)
        };
      }))
      .filter(group => group.rows.length);
    const platformSummaryColumns: TableColumnsType<BusinessPlatformAggregate> = [
      { title: '平台', dataIndex: 'platformName', width: 100, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '日期范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '天数', dataIndex: 'dayCount', width: 80 },
      { title: '实收', dataIndex: 'actualReceipt', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.actualReceipt - b.actualReceipt },
      { title: '营业额', dataIndex: 'grossSales', width: 110, render: value => `¥${money(value)}` },
      { title: '有效订单', dataIndex: 'validOrders', width: 100, sorter: (a, b) => a.validOrders - b.validOrders },
      { title: '单均实付', dataIndex: 'averageReceipt', width: 100, render: value => `¥${money(value)}` },
      { title: '曝光人数', dataIndex: 'exposureUsers', width: 100 },
      { title: '入店率', dataIndex: 'visitRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '下单率', dataIndex: 'orderRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '商家活动成本', dataIndex: 'merchantActivityCost', width: 130, render: value => `¥${money(value)}` },
      { title: '活动成本率', dataIndex: 'activityCostRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '平台补贴', dataIndex: 'platformSubsidy', width: 110, render: value => `¥${money(value)}` },
      { title: '动销率', dataIndex: 'tradedProductRate', width: 100, render: value => value === null ? '-' : rateText(value) }
    ];
    const customerSummaryColumns: TableColumnsType<BusinessPlatformAggregate> = [
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '日期范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '新客曝光', dataIndex: 'newExposureUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newExposureUsers : '-' },
      { title: '新客入店', dataIndex: 'newVisitUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newVisitUsers : '-' },
      { title: '新客入店率', dataIndex: 'newVisitRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '新客下单', dataIndex: 'newOrderUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newOrderUsers : '-' },
      { title: '新客下单率', dataIndex: 'newOrderRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '新客下单占比', dataIndex: 'newOrderShare', width: 120, render: value => value === null ? '-' : rateText(value) },
      { title: '老客曝光', dataIndex: 'oldExposureUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldExposureUsers : '-' },
      { title: '老客入店', dataIndex: 'oldVisitUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldVisitUsers : '-' },
      { title: '老客入店率', dataIndex: 'oldVisitRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '老客下单', dataIndex: 'oldOrderUsers', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldOrderUsers : '-' },
      { title: '老客下单率', dataIndex: 'oldOrderRate', width: 110, render: value => value === null ? '-' : rateText(value) },
      { title: '老客下单占比', dataIndex: 'oldOrderShare', width: 120, render: value => value === null ? '-' : rateText(value) },
      { title: '复购口径', width: 230, render: (_, row) => businessRepeatSummaryText(row) }
    ];
    const funnelSummaryColumns: TableColumnsType<BusinessPlatformAggregate> = [
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '漏斗阶段', width: 320, render: (_, row) => businessFunnelStageText(row) },
      { title: '入店率', width: 100, render: (_, row) => businessFunnelMetrics(row).visitRate === null ? '-' : rateText(businessFunnelMetrics(row).visitRate) },
      { title: '曝光到入店流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.exposureVisitLoss} / ${funnel.exposureVisitLossRate === null ? '-' : rateText(funnel.exposureVisitLossRate)}`;
      } },
      { title: '下单率', width: 100, render: (_, row) => businessFunnelMetrics(row).orderRate === null ? '-' : rateText(businessFunnelMetrics(row).orderRate) },
      { title: '入店到下单流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.visitOrderLoss} / ${funnel.visitOrderLossRate === null ? '-' : rateText(funnel.visitOrderLossRate)}`;
      } },
      { title: '有效订单转化', width: 130, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.orderValidRate === null ? '-' : rateText(funnel.orderValidRate);
      } },
      { title: '全链路订单转化', width: 140, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.exposureValidRate === null ? '-' : rateText(funnel.exposureValidRate);
      } },
      { title: '主要断点', width: 120, render: (_, row) => <Tag color="orange">{businessFunnelMetrics(row).bottleneck}</Tag> }
    ];
    const dailyColumns: TableColumnsType<BusinessDailyAggregate> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '备注', width: 180, render: (_, row) => renderBusinessNoteTags(businessMemoNotesForDate(row.date)) },
      { title: '实收', dataIndex: 'actualReceipt', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.actualReceipt - b.actualReceipt },
      { title: '营业额', dataIndex: 'grossSales', width: 110, render: value => `¥${money(value)}` },
      { title: '有效订单', dataIndex: 'validOrders', width: 100, sorter: (a, b) => a.validOrders - b.validOrders },
      { title: '单均实付', dataIndex: 'averageReceipt', width: 100, render: value => `¥${money(value)}` },
      { title: '曝光人数', dataIndex: 'exposureUsers', width: 100 },
      { title: '入店人数', dataIndex: 'visitUsers', width: 100 },
      { title: '入店率', dataIndex: 'visitRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '下单人数', dataIndex: 'orderUsers', width: 100 },
      { title: '下单率', dataIndex: 'orderRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '商家活动成本', dataIndex: 'merchantActivityCost', width: 130, render: value => `¥${money(value)}` },
      { title: '平台补贴', dataIndex: 'platformSubsidy', width: 110, render: value => `¥${money(value)}` },
      { title: '成本率', dataIndex: 'activityCostRate', width: 100, render: value => value === null ? '-' : rateText(value) }
    ];
    const detailColumns: TableColumnsType<BusinessDailyRecord> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, render: value => <Tag>{value}</Tag> },
      { title: '备注', width: 180, render: (_, row) => renderBusinessNoteTags(businessMemoNotesForRecord(row)) },
      { title: '实收', dataIndex: 'actualReceipt', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.actualReceipt - b.actualReceipt },
      { title: '营业额', dataIndex: 'grossSales', width: 110, render: value => `¥${money(value)}` },
      { title: '有效订单', dataIndex: 'validOrders', width: 100 },
      { title: '无效订单', dataIndex: 'invalidOrders', width: 100 },
      { title: '单均实付', dataIndex: 'averageReceipt', width: 100, render: value => `¥${money(value)}` },
      { title: '曝光', dataIndex: 'exposureUsers', width: 90 },
      { title: '入店', dataIndex: 'visitUsers', width: 90 },
      { title: '入店率', dataIndex: 'visitRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '下单', dataIndex: 'orderUsers', width: 90 },
      { title: '下单率', dataIndex: 'orderRate', width: 100, render: value => value === null ? '-' : rateText(value) },
      { title: '商家活动成本', dataIndex: 'merchantActivityCost', width: 130, render: value => `¥${money(value)}` },
      { title: '平台补贴', dataIndex: 'platformSubsidy', width: 110, render: value => `¥${money(value)}` },
      {
        title: '商品结构',
        width: 180,
        render: (_, row) => row.listedProducts > 0
          ? `${row.tradedProducts}/${row.listedProducts} 动销，缺货 ${row.outOfStockProducts}`
          : <Text type="secondary">日报未提供</Text>
      },
      { title: '来源', dataIndex: 'sourceFileName', width: 220, ellipsis: true }
    ];
    const dailyFunnelColumns: TableColumnsType<BusinessDailyRecord> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '漏斗阶段', width: 320, render: (_, row) => businessFunnelStageText(row) },
      { title: '入店率', width: 100, render: (_, row) => businessFunnelMetrics(row).visitRate === null ? '-' : rateText(businessFunnelMetrics(row).visitRate) },
      { title: '曝光到入店流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.exposureVisitLoss} / ${funnel.exposureVisitLossRate === null ? '-' : rateText(funnel.exposureVisitLossRate)}`;
      } },
      { title: '下单率', width: 100, render: (_, row) => businessFunnelMetrics(row).orderRate === null ? '-' : rateText(businessFunnelMetrics(row).orderRate) },
      { title: '入店到下单流失', width: 150, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return `${funnel.visitOrderLoss} / ${funnel.visitOrderLossRate === null ? '-' : rateText(funnel.visitOrderLossRate)}`;
      } },
      { title: '有效订单转化', width: 130, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.orderValidRate === null ? '-' : rateText(funnel.orderValidRate);
      } },
      { title: '全链路订单转化', width: 140, render: (_, row) => {
        const funnel = businessFunnelMetrics(row);
        return funnel.exposureValidRate === null ? '-' : rateText(funnel.exposureValidRate);
      } },
      { title: '主要断点', width: 120, render: (_, row) => <Tag color="orange">{businessFunnelMetrics(row).bottleneck}</Tag> }
    ];
    const customerDetailColumns: TableColumnsType<BusinessDailyRecord> = [
      { title: '日期', dataIndex: 'date', width: 120, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, fixed: 'left', render: value => <Tag>{value}</Tag> },
      { title: '新客曝光', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newExposureUsers : '-' },
      { title: '新客入店', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newVisitUsers : '-' },
      { title: '新客入店率', width: 110, render: (_, row) => row.newVisitRate === null ? '-' : rateText(row.newVisitRate) },
      { title: '新客下单', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.newOrderUsers : '-' },
      { title: '新客下单率', width: 110, render: (_, row) => row.newOrderRate === null ? '-' : rateText(row.newOrderRate) },
      { title: '老客曝光', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldExposureUsers : '-' },
      { title: '老客入店', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldVisitUsers : '-' },
      { title: '老客入店率', width: 110, render: (_, row) => row.oldVisitRate === null ? '-' : rateText(row.oldVisitRate) },
      { title: '老客下单', width: 100, render: (_, row) => row.customerBreakdownProvided ? row.oldOrderUsers : '-' },
      { title: '老客下单率', width: 110, render: (_, row) => row.oldOrderRate === null ? '-' : rateText(row.oldOrderRate) },
      { title: '复购', width: 230, render: (_, row) => row.repeatDataProvided ? businessRepeatSummaryText(row) : <Text type="secondary">日报未提供</Text> },
      { title: '来源', dataIndex: 'sourceFileName', width: 220, ellipsis: true }
    ];
    const diagnosticColumns: TableColumnsType<BusinessDiagnosticItem> = [
      {
        title: '等级',
        dataIndex: 'severity',
        width: 90,
        render: value => <Tag color={businessDiagnosticColor(value)}>{businessDiagnosticSeverityText(value)}</Tag>
      },
      { title: '问题', dataIndex: 'title', width: 180 },
      { title: '当前', dataIndex: 'currentText', width: 120 },
      { title: '对比', dataIndex: 'baselineText', width: 120 },
      { title: '判断', dataIndex: 'description', width: 360 },
      { title: '建议', dataIndex: 'suggestion', width: 360 }
    ];
    const trendInflectionColumns: TableColumnsType<BusinessTrendInflectionRow> = [
      { title: '范围', dataIndex: 'dateLabel', width: 200, fixed: 'left' },
      { title: '平台', dataIndex: 'platformName', width: 90, render: value => <Tag>{value}</Tag> },
      {
        title: '拐点',
        width: 180,
        render: (_, row) => (
          <Space direction="vertical" size={2}>
            <Tag color={businessTrendInflectionColor(row.severity)}>{businessTrendInflectionText(row.severity)}</Tag>
            <Text>{row.metricName}</Text>
          </Space>
        )
      },
      { title: '来源图表', dataIndex: 'chartTitle', width: 220, ellipsis: true },
      {
        title: '当前 / 对比',
        width: 170,
        render: (_, row) => `${businessTrendValueText(row.unit, row.currentValue)} / ${businessTrendValueText(row.unit, row.baselineValue)}`
      },
      {
        title: '变化',
        width: 150,
        render: (_, row) => (
          <Text type={row.severity === 'drop' ? 'danger' : row.severity === 'rise' ? 'success' : 'warning'}>
            {businessTrendChangeText(row)}
          </Text>
        )
      },
      { title: '排查方向', dataIndex: 'reason', width: 360 },
      { title: '备忘', width: 260, render: (_, row) => row.memoText || <Text type="secondary">暂无匹配备忘</Text> },
      {
        title: '操作',
        width: 100,
        render: (_, row) => (
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => openBusinessMemoNoteEditorWithContext({
              dateStart: row.dateStart,
              dateEnd: row.dateEnd,
              platform: row.platform,
              title: `${row.dateLabel} ${row.metricName}原因`,
              content: `拐点：${businessTrendInflectionText(row.severity)}；图表：${row.chartTitle}；指标：${row.metricName}；当前：${businessTrendValueText(row.unit, row.currentValue)}；对比：${businessTrendValueText(row.unit, row.baselineValue)}；变化：${businessTrendChangeText(row)}。原因：`
            })}
          >
            记原因
          </Button>
        )
      }
    ];
    const importColumns: TableColumnsType<BusinessDataImportBatch> = [
      { title: '导入时间', dataIndex: 'importedAt', width: 170, render: value => businessImportedAtText(String(value || '')) },
      { title: '平台', dataIndex: 'platformName', width: 90, render: value => <Tag>{value}</Tag> },
      { title: '日期范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '天数', dataIndex: 'rowCount', width: 80 },
      { title: '覆盖日期', width: 220, render: (_, row) => row.replacedDates.length ? row.replacedDates.join('、') : <Text type="secondary">无</Text> },
      { title: '文件', dataIndex: 'fileName', width: 260, ellipsis: true },
      { title: '提示', width: 260, render: (_, row) => row.warnings.length ? row.warnings.join('；') : <Text type="secondary">无</Text> }
    ];
    const noteColumns: TableColumnsType<BusinessAnalysisNote> = [
      { title: '保存时间', dataIndex: 'createdAt', width: 170, render: value => businessImportedAtText(String(value || '')) },
      { title: '类型', dataIndex: 'kind', width: 90, render: value => <Tag color={value === 'memo' ? 'purple' : 'blue'}>{value === 'memo' ? '备忘' : '诊断'}</Tag> },
      { title: '范围', width: 210, render: (_, row) => businessDateRangeText(row.dateStart, row.dateEnd) },
      { title: '平台', dataIndex: 'platform', width: 90, render: value => value === 'all' ? '全部' : PLATFORM_NAMES[value as Platform] },
      { title: '标题', dataIndex: 'title', width: 180, ellipsis: true },
      { title: '内容', render: (_, row) => row.items.length ? businessNoteItemsText(row) : <Text type="secondary">无</Text> },
      {
        title: '操作',
        width: 130,
        render: (_, row) => (
          <Space>
            {row.kind === 'memo' ? <Button size="small" icon={<EditOutlined />} onClick={() => openBusinessMemoNoteEditor(row)} /> : null}
            <Button size="small" danger icon={<DeleteOutlined />} onClick={() => deleteBusinessAnalysisNote(row)} />
          </Space>
        )
      }
    ];
    const renderBusinessMetric = (label: string, value: React.ReactNode, secondary?: string) => (
      <div className="field">
        <Text type="secondary">{label}</Text>
        <div className="field-value">{value}</div>
        {secondary ? <Text type="secondary">{secondary}</Text> : null}
      </div>
    );
    type BusinessChartDatum = Record<string, unknown>;
    type BusinessChartClickEvent = { data?: unknown };
    type BusinessChartReadyContext = {
      chart?: {
        on?: (eventName: string, handler: (event: BusinessChartClickEvent) => void) => void;
      };
    };
    const normalizeBusinessChartDatum = (value: unknown): BusinessChartDatum | null => {
      if (Array.isArray(value)) return normalizeBusinessChartDatum(value[0]);
      if (!value || typeof value !== 'object') return null;
      const row = value as BusinessChartDatum;
      if (row.data && typeof row.data === 'object' && row.data !== row) return normalizeBusinessChartDatum(row.data);
      return row;
    };
    const businessChartMemoValueText = (value: unknown, unit: BusinessChartMemoUnit) => {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return '';
      if (unit === 'rate') return `${money(amount)}%`;
      if (unit === 'money') return `¥${money(amount)}`;
      return `${Math.round(amount)}`;
    };
    const openBusinessMemoFromChartDatum = (value: unknown, chartTitle: string, unit: BusinessChartMemoUnit) => {
      const datum = normalizeBusinessChartDatum(value);
      const date = normalizeBusinessDate(datum?.date);
      const weekStart = normalizeBusinessDate(datum?.weekStart);
      const dateStart = date || weekStart;
      const dateEnd = date || (weekStart ? businessAddDays(weekStart, 6) : dateStart);
      if (!dateStart || !dateEnd) {
        message.warning('没有识别到图表日期，无法新增备忘。');
        return;
      }
      const platform: Platform | 'all' = datum?.platform === 'meituan' || datum?.platform === 'eleme'
        ? datum.platform
        : businessAnalysisPlatform;
      const metricName = String(datum?.series || datum?.metric || chartTitle);
      const valueText = businessChartMemoValueText(datum?.value, unit);
      const rangeText = businessDateRangeText(dateStart, dateEnd);
      openBusinessMemoNoteEditorWithContext({
        dateStart,
        dateEnd,
        platform,
        title: `${rangeText} ${metricName}备忘`,
        content: `图表：${chartTitle}；指标：${metricName}${valueText ? `；数值：${valueText}` : ''}。原因：`
      });
    };
    const businessChartMemoOnReady = (chartTitle: string, unit: BusinessChartMemoUnit) => (
      ({ chart }: BusinessChartReadyContext) => {
        chart?.on?.('element:click', event => {
          const rawDatum = normalizeBusinessChartDatum(event.data);
          openBusinessMemoFromChartDatum(rawDatum, chartTitle, unit);
        });
      }
    );
    const renderBusinessLineChart = (
      rows: Array<BusinessTrendChartDatum & { series: string }>,
      xField: string,
      xTitle: string,
      yTitle: string,
      unit: BusinessChartMemoUnit,
      memoTitle = yTitle
    ) => {
      if (!rows.length) return <div className="chart-empty">暂无{yTitle}数据</div>;
      const seriesNames = Array.from(new Set(rows.map(row => row.series)));
      const isWeekdaySeries = seriesNames.some(series => BUSINESS_WEEKDAY_LABELS.includes(series) || series === BUSINESS_WEEK_TOTAL_LABEL);
      return (
        <div className="chart-frame">
          <AntvLine
            data={rows}
            height={260}
            autoFit
            xField={xField}
            yField="value"
            colorField="series"
            shapeField="smooth"
            axis={{
              x: { title: xTitle, labelAutoRotate: false },
              y: {
                title: yTitle,
                labelFormatter: (value: number | string) => (
                  unit === 'rate' ? `${money(value)}%` : unit === 'money' ? `¥${money(value)}` : `${Math.round(Number(value))}`
                )
              }
            }}
            scale={{
              color: {
                domain: isWeekdaySeries ? [...BUSINESS_WEEKDAY_LABELS, BUSINESS_WEEK_TOTAL_LABEL] : seriesNames,
                range: isWeekdaySeries ? BUSINESS_WEEKDAY_CHART_COLORS : BUSINESS_LINE_CHART_COLORS
              }
            }}
            style={{ lineWidth: 2.4 }}
            interaction={{
              tooltip: {
                marker: true
              }
            }}
            slider={{
              x: {
                labelFormatter: (value: number | string) => String(value)
              }
            }}
            onReady={businessChartMemoOnReady(memoTitle, unit)}
          />
        </div>
      );
    };
    const renderBusinessStackedColumnChart = (
      rows: Array<BusinessTrendChartDatum & { series: string }>,
      xField: string,
      xTitle: string,
      yTitle: string,
      unit: BusinessChartMemoUnit,
      memoTitle = yTitle
    ) => {
      if (!rows.length) return <div className="chart-empty">暂无{yTitle}数据</div>;
      const seriesNames = Array.from(new Set(rows.map(row => row.series)));
      return (
        <div className="chart-frame">
          <AntvColumn
            data={rows}
            height={260}
            autoFit
            xField={xField}
            yField="value"
            colorField="series"
            transform={[{ type: 'stackY' }]}
            axis={{
              x: { title: xTitle, labelAutoRotate: false },
              y: {
                title: yTitle,
                labelFormatter: (value: number | string) => (
                  unit === 'rate' ? `${money(value)}%` : unit === 'money' ? `¥${money(value)}` : `${Math.round(Number(value))}`
                )
              }
            }}
            scale={{
              color: {
                domain: seriesNames,
                range: BUSINESS_LINE_CHART_COLORS
              }
            }}
            style={{ insetRight: 2, stroke: '#fff', lineWidth: 1 }}
            tooltip={{
              title: (datum: BusinessTrendChartDatum) => String(datum.date || datum.weekLabel || ''),
              items: [
                (datum: BusinessTrendChartDatum) => ({
                  name: String(datum.series || ''),
                  value: businessTrendValueText(unit, Number(datum.value) || 0)
                })
              ]
            }}
            onReady={businessChartMemoOnReady(memoTitle, unit)}
          />
        </div>
      );
    };
    const renderBusinessTimeSeriesAnomalyChart = (
      rows: BusinessTimeSeriesAnomalyRow[],
      deltaRows: BusinessAnomalyDeltaRow[],
      title: string,
      yTitle: string,
      unit: BusinessChartMemoUnit
    ) => {
      if (!rows.length) return <div className="chart-empty">暂无{yTitle}时序数据</div>;
      const seriesNames = Array.from(new Set(rows.map(row => row.series)));
      const anomalySeriesNames = Array.from(new Set(deltaRows.map(row => row.series)));
      const seriesColorRange = [...BUSINESS_WEEKDAY_CHART_COLORS, ...BUSINESS_LINE_CHART_COLORS];
      return (
        <div className="business-anomaly-chart">
          <div className="chart-frame business-anomaly-trend">
            <AntvLine
              data={rows}
              height={300}
              autoFit
              xField="xLabel"
              yField="value"
              colorField="series"
              shapeField="smooth"
              axis={{
                x: { title: '日期', labelAutoRotate: false },
                y: {
                  title: yTitle,
                  labelFormatter: (value: number | string) => (
                    unit === 'rate' ? `${money(value)}%` : unit === 'money' ? `¥${money(value)}` : `${Math.round(Number(value))}`
                  )
                }
              }}
              scale={{
                color: {
                  domain: seriesNames,
                  range: seriesColorRange
                }
              }}
              style={{ lineWidth: 2.5, strokeOpacity: 0.92 }}
              point={{
                sizeField: 'pointSize',
                style: (datum: BusinessTimeSeriesAnomalyRow) => ({
                  fill: datum.anomalySeverityText === '下降拐点' ? '#cf1322' : datum.anomalySeverityText === '回升拐点' ? '#237804' : '#d48806',
                  stroke: '#fff',
                  lineWidth: 1.6
                })
              }}
              label={[
                {
                  text: (datum: BusinessTimeSeriesAnomalyRow) => datum.anomalyLabel,
                  position: 'top',
                  transform: [{ type: 'overlapHide' }],
                  style: { dy: -14, fill: '#111827', fontSize: 11, fontWeight: 700 }
                }
              ]}
              tooltip={{
                title: (datum: BusinessTimeSeriesAnomalyRow) => datum.xLabel,
                items: [
                  (datum: BusinessTimeSeriesAnomalyRow) => ({
                    name: datum.series,
                    value: `${businessTrendValueText(unit, Number(datum.value) || 0)}${datum.baselineValue !== null ? `；对比 ${businessTrendValueText(unit, datum.baselineValue)}` : ''}${datum.anomalyDetail ? `；${datum.anomalyDetail}` : ''}`
                  })
                ]
              }}
              interaction={{
                tooltip: {
                  marker: true
                }
              }}
              slider={{
                x: {
                  labelFormatter: (value: number | string) => String(value)
                }
              }}
              onReady={businessChartMemoOnReady(title, unit)}
            />
          </div>
          <div className="chart-frame business-anomaly-delta">
            {deltaRows.length ? (
              <AntvColumn
                data={deltaRows}
                height={176}
                autoFit
                xField="xLabel"
                yField="value"
                colorField="series"
                axis={{
                  x: { title: '异常日期', labelAutoRotate: false },
                  y: {
                    title: '相对对比值变化',
                    labelFormatter: (value: number | string) => businessTrendDeltaText(unit, Number(value))
                  }
                }}
                scale={{
                  color: {
                    domain: anomalySeriesNames,
                    range: seriesColorRange
                  }
                }}
                style={(datum: BusinessAnomalyDeltaRow) => ({
                  inset: 3,
                  radiusTopLeft: Number(datum.value) >= 0 ? 4 : 0,
                  radiusTopRight: Number(datum.value) >= 0 ? 4 : 0,
                  radiusBottomLeft: Number(datum.value) < 0 ? 4 : 0,
                  radiusBottomRight: Number(datum.value) < 0 ? 4 : 0,
                  fillOpacity: datum.anomalySeverityText === '异常波动' ? 0.72 : 0.88
                })}
                label={[
                  {
                    text: (datum: BusinessAnomalyDeltaRow) => businessTrendDeltaText(unit, Number(datum.value)),
                    position: (datum: BusinessAnomalyDeltaRow) => Number(datum.value) >= 0 ? 'top' : 'bottom',
                    transform: [{ type: 'overlapHide' }],
                    style: { fill: '#111827', fontSize: 11, fontWeight: 700 }
                  }
                ]}
                tooltip={{
                  title: (datum: BusinessAnomalyDeltaRow) => datum.xLabel,
                  items: [
                    (datum: BusinessAnomalyDeltaRow) => ({
                      name: datum.series,
                      value: `当前 ${businessTrendValueText(unit, datum.currentValue)}；对比 ${businessTrendValueText(unit, datum.baselineValue)}；变化 ${businessTrendDeltaText(unit, datum.value)}${datum.changeRate === null ? '' : ` / ${money(datum.changeRate * 100)}%`}`
                    })
                  ]
                }}
                onReady={businessChartMemoOnReady(`${title}异常偏离`, unit)}
              />
            ) : <div className="chart-empty business-anomaly-delta-empty">当前筛选范围没有达到阈值的异常偏离</div>}
          </div>
        </div>
      );
    };
    const renderBusinessFunnelChart = (
      rows: BusinessFunnelChartRow[],
      emptyText: string,
      colors: string[],
      height = 240
    ) => rows.length ? (
      <div className="chart-frame">
        <AntvFunnel
          data={rows}
          height={height}
          autoFit
          paddingRight={82}
          xField="stage"
          yField="value"
          label={[
            {
              text: (datum: BusinessFunnelChartRow) => datum.stage,
              position: 'inside',
              transform: [{ type: 'contrastReverse' }],
              style: { dy: -8, fontSize: 12, fontWeight: 600 }
            },
            {
              text: (datum: BusinessFunnelChartRow) => datum.valueText,
              position: 'inside',
              transform: [{ type: 'contrastReverse' }],
              style: { dy: 10, fontSize: 12 }
            },
            {
              text: (datum: BusinessFunnelChartRow) => datum.conversionTitleText,
              position: 'top-right',
              style: {
                dx: 36,
                dy: 8,
                fill: '#6b7280',
                fontSize: 11,
                textAlign: 'left',
                textBaseline: 'middle'
              }
            },
            {
              text: (datum: BusinessFunnelChartRow) => datum.conversionRateText,
              position: 'top-right',
              style: {
                dx: 36,
                dy: 24,
                fill: '#111827',
                fontSize: 12,
                fontWeight: 600,
                textAlign: 'left',
                textBaseline: 'middle'
              }
            }
          ]}
          tooltip={{
            title: false,
            items: [
              (datum: BusinessFunnelChartRow) => ({
                name: datum.stage,
                value: `${datum.valueText}；${datum.conversionText}；${datum.totalConversionText}`
              })
            ]
          }}
          scale={{ color: { range: colors } }}
          legend={false}
        />
      </div>
    ) : <div className="chart-empty">{emptyText}</div>;

    return (
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Card
          title="经营数据分析"
          extra={
            <Space wrap>
              <Upload {...uploadProps(importBusinessReport)}><Button icon={<UploadOutlined />}>导入经营日报</Button></Upload>
              <Button icon={<PlusOutlined />} onClick={() => openBusinessMemoNoteEditor()}>新增备忘</Button>
              <Button icon={<DownloadOutlined />} onClick={exportBusinessAnalysis}>导出明细</Button>
              <Button icon={<SaveOutlined />} onClick={saveBusinessAnalysisNote}>保存诊断</Button>
            </Space>
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Select
                style={{ width: 140 }}
                value={businessAnalysisPlatform}
                onChange={setBusinessAnalysisPlatform}
                options={[
                  { value: 'all', label: '全部平台' },
                  ...PLATFORMS.map(platform => ({ value: platform, label: PLATFORM_NAMES[platform] }))
                ]}
              />
              <RangePicker
                allowClear
                disabled={!businessStoreRecords.length}
                format="YYYY-MM-DD"
                placeholder={['开始日期', '结束日期']}
                presets={businessDateRangePresets}
                style={{ width: 360 }}
                value={businessDateRangePickerValue}
                onChange={(_, dateStrings) => updateBusinessAnalysisDateRange(Array.isArray(dateStrings) ? dateStrings : [])}
              />
              <Tag color="blue">{businessStoreRecords.length} 条日报</Tag>
              <Tag>数据范围：{businessDateRangeText(businessDataDateBounds.start, businessDataDateBounds.end)}</Tag>
              <Tag color="green">当前统计：{businessActiveDateRangeText}</Tag>
            </Space>
            <Text type="secondary">当前按订单日期和平台分别统计；日期选择器内可用预设范围选择全部数据、最近天数、自然周和月份，也可以直接自定义日期范围。</Text>
          </Space>
        </Card>

        <Card title="总计汇总（辅助）">
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Text type="secondary">这里用于快速看当前筛选范围的全店合计；经营判断和后续拆解以平台分开统计为准。</Text>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}>{renderBusinessMetric('实收', `¥${money(businessSummary.actualReceipt)}`, `${businessSummary.validOrders} 单`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('入店率', businessSummary.visitRate === null ? '-' : rateText(businessSummary.visitRate), `${businessSummary.exposureUsers} 曝光`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('下单率', businessSummary.orderRate === null ? '-' : rateText(businessSummary.orderRate), `${businessSummary.visitUsers} 入店`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('单均实付', `¥${money(businessSummary.averageReceipt)}`, `${businessSummary.dayCount} 天`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('商家活动成本', `¥${money(businessSummary.merchantActivityCost)}`, businessSummary.merchantCostPerOrder === null ? undefined : `单均 ¥${money(businessSummary.merchantCostPerOrder)}`)}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('活动成本率', businessSummary.activityCostRate === null ? '-' : rateText(businessSummary.activityCostRate), '按营业额计算')}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('平台补贴', `¥${money(businessSummary.platformSubsidy)}`, '不计入成本')}</Col>
              <Col xs={12} md={6}>{renderBusinessMetric('动销率', businessSummary.tradedProductRate === null ? '-' : rateText(businessSummary.tradedProductRate), '按日报字段')}</Col>
            </Row>
          </Space>
        </Card>

        <Card title="平台汇总（主口径）" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Table rowKey="key" size="small" columns={platformSummaryColumns} dataSource={businessPlatformRows} pagination={false} scroll={{ x: 1510 }} />
        </Card>

        <Card title="客户结构与复购（平台口径）" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Text type="secondary">新客、老客直接使用平台日报字段汇总，算法和总漏斗一致：曝光、入店、下单人数求和，入店率和下单率按汇总后的分子/分母重新计算；不同平台的复购周期不强行合并。</Text>
            {businessCustomerPlatformGroups.length ? businessCustomerPlatformGroups.map(group => {
              const row = group.row;
              if (!row) return null;
              const primaryRepeat = businessPrimaryRepeatRate(row);
              return (
                <Space key={group.platform} direction="vertical" style={{ width: '100%' }} size="small">
                  <Space wrap>
                    <Tag color="blue">{group.platformName}</Tag>
                    <Text type="secondary">客户结构日报 {group.customerRows.length} 天，复购日报 {group.rows.filter(item => item.repeatDataProvided).length} 天。</Text>
                  </Space>
                  <Row gutter={[12, 12]}>
                    <Col xs={12} md={4}>{renderBusinessMetric('新客下单', row.customerBreakdownProvided ? row.newOrderUsers : '-', row.newOrderRate === null ? undefined : `下单率 ${rateText(row.newOrderRate)}`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('老客下单', row.customerBreakdownProvided ? row.oldOrderUsers : '-', row.oldOrderRate === null ? undefined : `下单率 ${rateText(row.oldOrderRate)}`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('新客入店率', row.newVisitRate === null ? '-' : rateText(row.newVisitRate), `${row.newExposureUsers} 曝光`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('老客入店率', row.oldVisitRate === null ? '-' : rateText(row.oldVisitRate), `${row.oldExposureUsers} 曝光`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric('新客下单占比', row.newOrderShare === null ? '-' : rateText(row.newOrderShare), row.oldOrderShare === null ? undefined : `老客 ${rateText(row.oldOrderShare)}`)}</Col>
                    <Col xs={12} md={4}>{renderBusinessMetric(primaryRepeat.label, primaryRepeat.value === null ? '-' : rateText(primaryRepeat.value), businessRepeatSummaryText(row))}</Col>
                  </Row>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>新老客下单人数</Text>
                        {renderBusinessStackedColumnChart(group.orderRows, 'date', '日期', '下单人数', 'count', `${group.platformName}新老客下单人数趋势`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>新老客转化率</Text>
                        {renderBusinessLineChart(group.rateRows, 'date', '日期', '转化率', 'rate', `${group.platformName}新老客转化率趋势`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>复购率趋势</Text>
                        {renderBusinessLineChart(group.repeatRows, 'date', '日期', '复购率', 'rate', `${group.platformName}复购率趋势`)}
                      </Space>
                    </Col>
                  </Row>
                </Space>
              );
            }) : <div className="chart-empty">当前筛选范围暂无新客、老客或复购字段</div>}
            <Table
              rowKey="key"
              size="small"
              columns={customerSummaryColumns}
              dataSource={businessPlatformRows.filter(row => row.customerBreakdownProvided || row.repeatDataProvided)}
              pagination={false}
              scroll={{ x: 1800 }}
            />
          </Space>
        </Card>

        <Card title="漏斗模型（平台对比）" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Text type="secondary">按当前日期范围比较总、新客、老客从曝光到入店、入店到下单的转化链路；周、月和自定义日期筛选会同步影响漏斗图和明细表。</Text>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              {businessFunnelChartGroups.map(group => (
                <Space key={group.platform} direction="vertical" style={{ width: '100%' }} size="small">
                  <Space wrap>
                    <Tag color="blue">{group.platformName}</Tag>
                    {group.row ? <Text type="secondary">{businessFunnelStageText(group.row)}</Text> : <Text type="secondary">当前范围暂无数据</Text>}
                  </Space>
                  <Row gutter={[12, 12]}>
                    {group.funnels.map(funnel => (
                      <Col xs={24} lg={8} key={`${group.platform}-${funnel.key}`}>
                        <Space direction="vertical" style={{ width: '100%' }} size="small">
                          <Text strong>{funnel.title}</Text>
                          {renderBusinessFunnelChart(funnel.rows, funnel.emptyText, funnel.colors)}
                        </Space>
                      </Col>
                    ))}
                  </Row>
                </Space>
              ))}
            </Space>
            <Table rowKey="key" size="small" columns={funnelSummaryColumns} dataSource={businessPlatformRows} pagination={false} scroll={{ x: 1500 }} />
          </Space>
        </Card>

        <Card title="趋势拐点排查" extra={<Tag color="green">{businessActiveDateRangeText}</Tag>}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Text type="secondary">系统按同平台、同指标、同曲线对比明显变化；长周期优先看同星期跨周变化，短周期按前序点辅助判断。每个平台单独展示趋势线，并在下方用异常偏离柱标出当前值相对对比值的变化幅度。</Text>
            {businessTrendAnomalyChartGroups.length ? (
              <Row gutter={[12, 12]}>
                {businessTrendAnomalyChartGroups.map(group => (
                  <Col xs={24} key={group.key}>
                    <Space direction="vertical" style={{ width: '100%' }} size="small">
                      <Text strong>{group.title}</Text>
                      {group.anomalies.length ? (
                        <Space wrap size={[4, 4]}>
                          {group.anomalies.slice(0, 6).map(row => (
                            <Tooltip key={`${group.key}-${row.key}-anomaly`} title={row.anomalyDetail}>
                              <Tag color={row.anomalySeverityText === '下降拐点' ? 'red' : row.anomalySeverityText === '回升拐点' ? 'green' : 'orange'}>
                                {row.xLabel} {row.series} {row.anomalyLabel}
                              </Tag>
                            </Tooltip>
                          ))}
                          {group.anomalies.length > 6 ? <Tag>+{group.anomalies.length - 6}</Tag> : null}
                        </Space>
                      ) : <Text type="secondary">该图没有达到阈值的异常点。</Text>}
                      {renderBusinessTimeSeriesAnomalyChart(group.rows, group.deltaRows, group.title, group.yTitle, group.unit)}
                    </Space>
                  </Col>
                ))}
              </Row>
            ) : <div className="chart-empty">当前筛选范围暂无可用于时序异常分析的趋势数据</div>}
            {businessTrendInflectionRows.length ? (
                <Table
                  rowKey="key"
                  size="small"
                  columns={trendInflectionColumns}
                  dataSource={businessTrendInflectionRows}
                  pagination={false}
                  scroll={{ x: 1730 }}
                />
            ) : <div className="chart-empty">当前筛选范围没有达到阈值的明显拐点</div>}
          </Space>
        </Card>

        <Card title={businessTrendCardTitle}>
          <Space direction="vertical" style={{ width: '100%' }} size="large">
            <Text type="secondary">{businessTrendDescription}</Text>
            {weeklyTrendPlatformGroups.length ? weeklyTrendPlatformGroups.map(group => {
              const exposureRows = group.rows.map(row => ({ ...row, value: row.exposureUsers }));
              const visitRows = group.rows.map(row => ({ ...row, value: row.visitUsers }));
              const orderUserRows = group.rows.map(row => ({ ...row, value: row.orderUsers }));
              return (
                <Space key={group.platform} direction="vertical" style={{ width: '100%' }} size="small">
                  <Space wrap>
                    <Tag color="blue">{group.platformName}</Tag>
                    <Text type="secondary">{businessTrendGroupDescription}</Text>
                  </Space>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>曝光人数{isBusinessShortTrendRange ? '按天变化' : '按周变化'}</Text>
                        {renderBusinessLineChart(exposureRows, businessTrendXField, businessTrendXTitle, '曝光人数', 'count', `${group.platformName}曝光人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>入店人数{isBusinessShortTrendRange ? '按天变化' : '按周变化'}</Text>
                        {renderBusinessLineChart(visitRows, businessTrendXField, businessTrendXTitle, '入店人数', 'count', `${group.platformName}入店人数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`)}
                      </Space>
                    </Col>
                    <Col xs={24} xl={8}>
                      <Space direction="vertical" style={{ width: '100%' }} size="small">
                        <Text strong>下单数{isBusinessShortTrendRange ? '按天变化' : '按周变化'}</Text>
                        {renderBusinessLineChart(orderUserRows, businessTrendXField, businessTrendXTitle, '下单数', 'count', `${group.platformName}下单数${isBusinessShortTrendRange ? '按天变化' : '按周变化'}`)}
                      </Space>
                    </Col>
                  </Row>
                </Space>
              );
            }) : <div className="chart-empty">暂无{isBusinessShortTrendRange ? '按天' : '按周'}变化数据</div>}
          </Space>
        </Card>

        <Row gutter={[12, 12]}>
          <Col xs={24} xl={12}>
            <Card title="金额趋势（按平台）">
              {moneyTrendRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={moneyTrendRows}
                    height={260}
                    autoFit
                    xField="date"
                    yField="value"
                    colorField="metric"
                    shapeField="smooth"
                    axis={{
                      x: { title: '日期', labelAutoRotate: false },
                      y: { title: '金额', labelFormatter: (value: number | string) => `¥${money(value)}` }
                    }}
                    scale={{ color: { range: ['#496f5d', '#5b7c99', '#b85f32'] } }}
                    interaction={{ tooltip: { marker: true } }}
                    onReady={businessChartMemoOnReady('金额趋势（按平台）', 'money')}
                  />
                </div>
              ) : <div className="chart-empty">暂无金额趋势数据</div>}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title="入店率趋势（按平台）">
              {visitRateTrendRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={visitRateTrendRows}
                    height={260}
                    autoFit
                    xField="date"
                    yField="value"
                    colorField="platformName"
                    shapeField="smooth"
                    axis={{
                      x: { title: '日期', labelAutoRotate: false },
                      y: { title: '入店率', labelFormatter: (value: number | string) => `${money(value)}%` }
                    }}
                    scale={{ color: { range: ['#d95b18', '#6d6aa8'] } }}
                    interaction={{ tooltip: { marker: true } }}
                    onReady={businessChartMemoOnReady('入店率趋势（按平台）', 'rate')}
                  />
                </div>
              ) : <div className="chart-empty">暂无入店率趋势数据</div>}
            </Card>
          </Col>
          <Col xs={24} xl={12}>
            <Card title="下单率趋势（按平台）">
              {orderRateTrendRows.length ? (
                <div className="chart-frame">
                  <AntvLine
                    data={orderRateTrendRows}
                    height={260}
                    autoFit
                    xField="date"
                    yField="value"
                    colorField="platformName"
                    shapeField="smooth"
                    axis={{
                      x: { title: '日期', labelAutoRotate: false },
                      y: { title: '下单率', labelFormatter: (value: number | string) => `${money(value)}%` }
                    }}
                    scale={{ color: { range: ['#d95b18', '#6d6aa8'] } }}
                    interaction={{ tooltip: { marker: true } }}
                    onReady={businessChartMemoOnReady('下单率趋势（按平台）', 'rate')}
                  />
                </div>
              ) : <div className="chart-empty">暂无下单率趋势数据</div>}
            </Card>
          </Col>
        </Row>

        <Card title="诊断摘要">
          <Table rowKey="key" size="small" columns={diagnosticColumns} dataSource={businessDiagnostics} pagination={false} scroll={{ x: 1250 }} />
        </Card>

        <Card title="备忘录与诊断记录" extra={<Button icon={<PlusOutlined />} onClick={() => openBusinessMemoNoteEditor()}>新增备忘</Button>}>
          <Space direction="vertical" style={{ width: '100%' }} size="small">
            <Space wrap>
              <Tag color="green">{businessActiveDateRangeText}</Tag>
              <Tag color="purple">{businessVisibleNotes.length} 条记录</Tag>
            </Space>
            <Table rowKey="id" size="small" columns={noteColumns} dataSource={businessVisibleNotes} pagination={{ pageSize: 5 }} scroll={{ x: 980 }} />
          </Space>
        </Card>

        <Card title="每日总计（辅助）">
          <Table rowKey="key" size="small" columns={dailyColumns} dataSource={businessDailyRows} pagination={{ pageSize: 8 }} scroll={{ x: 1540 }} />
        </Card>

        <Card title="每日平台统计（主口径）">
          <Table rowKey="key" size="small" columns={detailColumns} dataSource={filteredBusinessRecords} pagination={{ pageSize: 8 }} scroll={{ x: 1820 }} />
        </Card>

        <Card title="每日漏斗明细（主口径）">
          <Table rowKey="key" size="small" columns={dailyFunnelColumns} dataSource={filteredBusinessRecords} pagination={{ pageSize: 8 }} scroll={{ x: 1500 }} />
        </Card>

        <Card title="每日客户结构明细（平台口径）">
          <Table
            rowKey="key"
            size="small"
            columns={customerDetailColumns}
            dataSource={filteredBusinessRecords.filter(row => row.customerBreakdownProvided || row.repeatDataProvided)}
            pagination={{ pageSize: 8 }}
            scroll={{ x: 1660 }}
          />
        </Card>

        <Card title="导入记录">
          <Table rowKey="id" size="small" columns={importColumns} dataSource={businessImportRows} pagination={{ pageSize: 6 }} scroll={{ x: 1270 }} />
        </Card>

      </Space>
    );
  }

  function renderOrderAnalysisPage() {
    return (
      <OrderAnalysisPage
        platforms={PLATFORMS}
        platformNames={PLATFORM_NAMES}
        orderAnalysisPlatform={orderAnalysisPlatform}
        setOrderAnalysisPlatform={setOrderAnalysisPlatform}
        orderStoreRecords={orderStoreRecords}
        orderDataDateBounds={orderDataDateBounds}
        orderDateRangePresets={orderDateRangePresets}
        orderDateRangePickerValue={orderDateRangePickerValue}
        updateOrderAnalysisDateRange={updateOrderAnalysisDateRange}
        orderActiveDateRangeText={orderActiveDateRangeText}
        uploadProps={uploadProps}
        importOrderAnalysisFile={importOrderAnalysisFile}
        exportOrderAnalysis={exportOrderAnalysis}
        orderSummary={orderSummary}
        orderProfitSummary={orderProfitSummary}
        orderPlatformRows={orderPlatformRows}
        orderPayBandRows={orderPayBandRows}
        orderMealPeriodRows={orderMealPeriodRows}
        orderHourRows={orderHourRows}
        orderActivityRows={orderActivityRows}
        orderActivityComboRows={orderActivityComboRows}
        orderPlatformPayBandRows={orderPlatformPayBandRows}
        orderMealPayBandRows={orderMealPayBandRows}
        orderActivityComboPayBandRows={orderActivityComboPayBandRows}
        orderProductRows={orderProductRows}
        enrichedOrderRecords={enrichedOrderRecords}
        orderImportRows={orderImportRows}
        orderOperationRecommendations={orderOperationRecommendations}
        orderInsights={orderInsights}
        money={money}
        rateText={rateText}
        roundMoney={roundMoney}
        businessDateRangeText={businessDateRangeText}
        orderImportedAtText={orderImportedAtText}
        recommendationPriorityColor={recommendationPriorityColor}
        recommendationPriorityText={recommendationPriorityText}
      />
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
          {renderProductDiscountSuggestionPanel(view.platformRows, {
            source: 'measurementResult',
            title: '商品维度合理成本结论',
            limit: 50,
            includeNeutral: true,
            description: '商品结论按当前平台全部测算组合计算：主商品用活动合理成本和当前成本比较判断降价或涨价空间；凑单品只校验按原价占比分摊的到手价是否覆盖成本。'
          })}
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
              {renderProductDiscountSuggestionPanel(selectedResultProductFilteredRows, {
                source: 'measurementResult',
                title: '当前商品合理成本结论',
                productId: selectedResultProduct.productId,
                limit: 1,
                includeNeutral: true,
                description: '这里只展示当前商品在已筛选相关组合中的活动合理成本结论，用于追溯全局商品结论。'
              })}
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

  function renderBusinessNoteEditorModal() {
    if (!businessNoteEditor) return null;
    const dateStart = businessDateToDayjs(businessNoteEditor.dateStart);
    const dateEnd = businessDateToDayjs(businessNoteEditor.dateEnd);
    const dateRangeValue = dateStart && dateEnd ? [dateStart, dateEnd] as [Dayjs, Dayjs] : null;
    return (
      <Modal
        title={businessNoteEditor.id ? '编辑备忘录' : '新增备忘录'}
        open
        width={680}
        destroyOnHidden
        okText="保存"
        cancelText="取消"
        onOk={saveBusinessMemoNote}
        onCancel={() => setBusinessNoteEditor(null)}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Space wrap>
            <Text type="secondary">日期</Text>
            <RangePicker
              format="YYYY-MM-DD"
              placeholder={['开始日期', '结束日期']}
              value={dateRangeValue}
              onChange={(_, dateStrings) => updateBusinessMemoNoteDateRange(Array.isArray(dateStrings) ? dateStrings : [])}
            />
            <Text type="secondary">平台</Text>
            <Select
              style={{ width: 130 }}
              value={businessNoteEditor.platform}
              onChange={value => setBusinessNoteEditor(prev => prev ? { ...prev, platform: value as Platform | 'all' } : prev)}
              options={[
                { value: 'all', label: '全部平台' },
                ...PLATFORMS.map(platform => ({ value: platform, label: PLATFORM_NAMES[platform] }))
              ]}
            />
          </Space>
          <Input
            value={businessNoteEditor.title}
            placeholder="标题，例如：平台活动、缺货、天气、竞品变化"
            onChange={event => setBusinessNoteEditor(prev => prev ? { ...prev, title: event.target.value } : prev)}
          />
          <Input.TextArea
            rows={5}
            value={businessNoteEditor.content}
            placeholder="记录当天发生的事情，例如：午高峰主推饭团缺货，曝光正常但下单率下降。"
            onChange={event => setBusinessNoteEditor(prev => prev ? { ...prev, content: event.target.value } : prev)}
          />
        </Space>
      </Modal>
    );
  }

  function renderActivityDiscountTierEditorModal() {
    const rows = activityDiscountTierDraft.map((row, index) => ({ ...row, rowIndex: index }));
    const columns: TableColumnsType<ActivityOriginalDiscountTier & { rowIndex: number }> = [
      {
        title: '起始原价',
        dataIndex: 'originalMin',
        width: 120,
        render: (_, row) => (
          <InputNumber
            min={0}
            precision={2}
            value={row.originalMin}
            onChange={value => updateActivityDiscountTierDraft(row.rowIndex, { originalMin: Number(value) || 0 })}
          />
        )
      },
      {
        title: '结束原价',
        dataIndex: 'originalMax',
        width: 120,
        render: (_, row) => (
          <InputNumber
            min={0}
            precision={2}
            placeholder="999=不限"
            value={row.originalMax >= 999 ? 999 : row.originalMax}
            onChange={value => updateActivityDiscountTierDraft(row.rowIndex, { originalMax: value === null ? 999 : Number(value) || 0 })}
          />
        )
      },
      {
        title: '覆盖让利率%',
        dataIndex: 'discountRate',
        width: 140,
        render: (_, row) => (
          <InputNumber
            min={0}
            max={95}
            precision={2}
            value={row.discountRate}
            onChange={value => updateActivityDiscountTierDraft(row.rowIndex, { discountRate: Number(value) || 0 })}
          />
        )
      },
      {
        title: '说明',
        width: 220,
        render: (_, row) => <Text type="secondary">原价 ¥{money(row.originalMin)}-{row.originalMax >= 999 ? '不限' : `¥${money(row.originalMax)}`}，覆盖让利 {money(row.discountRate)}%</Text>
      },
      {
        title: '操作',
        width: 80,
        render: (_, row) => (
          <Button
            danger
            size="small"
            onClick={() => setActivityDiscountTierDraft(prev => prev.filter((_, index) => index !== row.rowIndex))}
          >
            删除
          </Button>
        )
      }
    ];
    return (
      <Modal
        title={activityDiscountTierEditor?.title || '原价让利设置'}
        open={Boolean(activityDiscountTierEditor)}
        width={880}
        destroyOnHidden
        onCancel={closeActivityDiscountTierEditor}
        footer={[
          <Button key="cancel" onClick={closeActivityDiscountTierEditor}>取消</Button>,
          <Button key="save" type="primary" onClick={saveActivityDiscountTierEditor}>保存阶梯</Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">全路线基准让利率在系统策略或门店活动配置中统一设置；下方阶梯只用于覆盖特殊原价段。系统会先扣除默认神券/爆红包已经形成的基准让利，再把剩余空间分给满减、优惠券和加码。</Text>
          <Card size="small" title="批量生成阶梯">
            <Space wrap>
              <Text type="secondary">范围</Text>
              <InputNumber min={0} precision={2} value={activityDiscountTierBatchDraft.start} onChange={value => setActivityDiscountTierBatchDraft(prev => ({ ...prev, start: Number(value) || 0 }))} />
              <InputNumber min={0} precision={2} placeholder="空=不限" value={activityDiscountTierBatchDraft.end === '' ? null : activityDiscountTierBatchDraft.end} onChange={value => setActivityDiscountTierBatchDraft(prev => ({ ...prev, end: value === null ? '' : Number(value) || 0 }))} />
              <Text type="secondary">步长</Text>
              <InputNumber min={1} precision={0} value={activityDiscountTierBatchDraft.step} onChange={value => setActivityDiscountTierBatchDraft(prev => ({ ...prev, step: Math.max(1, Math.floor(Number(value) || 1)) }))} />
              <Text type="secondary">让利率%</Text>
              <InputNumber min={0} max={95} precision={2} value={activityDiscountTierBatchDraft.rate} onChange={value => setActivityDiscountTierBatchDraft(prev => ({ ...prev, rate: Number(value) || 0 }))} />
              <Button onClick={() => setActivityDiscountTierDraft(createActivityDiscountTiersByStep(activityDiscountTierBatchDraft))}>生成阶梯</Button>
              <Button onClick={addActivityDiscountTierDraftRow}>添加一档</Button>
            </Space>
          </Card>
          <Card size="small" title="批量调整利率">
            <Space wrap>
              <Button onClick={() => setActivityDiscountTierDraft(prev => shiftActivityDiscountTierRates(prev, 5))}>全部 +5%</Button>
              <Button onClick={() => setActivityDiscountTierDraft(prev => shiftActivityDiscountTierRates(prev, -5))}>全部 -5%</Button>
              <Button onClick={() => setActivityDiscountTierDraft(prev => setActivityDiscountTierRates(prev, activityDiscountTierBatchDraft.rate))}>全部设为 {money(activityDiscountTierBatchDraft.rate)}%</Button>
              <Button onClick={() => {
                setActivityDiscountTierDraft(activityDiscountTierEditor?.fallback || []);
              }}>恢复默认</Button>
            </Space>
          </Card>
          <Table
            rowKey="rowIndex"
            size="small"
            columns={columns}
            dataSource={rows}
            pagination={false}
            scroll={{ x: 680 }}
            tableLayout="fixed"
          />
        </Space>
      </Modal>
    );
  }

  function pageContent() {
    if (state.activePage === 'store') return renderStorePage();
    if (state.activePage === 'products') return renderProductsPage();
    if (state.activePage === 'system-strategy') return renderSystemStrategyPage();
    if (state.activePage === 'platform') return renderPlatformPage();
    if (state.activePage === 'meituan') return renderActivityPage('meituan');
    if (state.activePage === 'eleme') return renderActivityPage('eleme');
    if (state.activePage === 'activity-design') return renderActivityDesignPage();
    if (state.activePage === 'order-analysis') return renderOrderAnalysisPage();
    if (state.activePage === 'data-analysis') return renderDataAnalysisPage();
    if (state.activePage === 'pricing') return renderPricingEvaluationPage();
    return renderResultsPage();
  }

  return (
    <>
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
              { key: 'system-strategy', label: '系统活动策略' },
              { key: 'platform', label: '平台通用规则' },
              { key: 'meituan', label: '美团活动' },
              { key: 'eleme', label: '饿了么活动' },
              { key: 'activity-design', label: '活动设计' },
              { key: 'order-analysis', label: '订单分析' },
              { key: 'data-analysis', label: '数据分析' },
              { key: 'pricing', label: '定价评估' },
              { key: 'results', label: '测算结果' }
            ]}
          />
        </Sider>
        <Content className="app-content">{pageContent()}</Content>
      </Layout>
    </Layout>
    {renderBusinessNoteEditorModal()}
    {renderActivityDiscountTierEditorModal()}
    </>
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
