export type Platform = 'meituan' | 'eleme';
export type Severity = 'none' | 'critical' | 'high' | 'medium' | 'config';
export type ProductCategory = 'staple' | 'snackDrink' | 'addOn' | 'setMeal' | 'other';
export type StapleScenario = 'single' | 'double' | 'multi';
export type ActivityDesignObjective = string;
export type ActivityDesignCalculationMode = 'priceScan' | 'routeDesign' | 'payValidation';
export type ActivityObjectiveGroup = 'stable' | 'marketing';
export type ActivityAmountRoundingMode = 'floor' | 'nearest' | 'ceil';
export type ActivityFullAmountBasis = 'average' | 'p75' | 'min' | 'max';
export type ActivityCouponScoringMode = 'conservative' | 'balanced' | 'aggressive';
export type ActivityCouponThresholdMode = 'lowThresholdOrder' | 'fullReductionInterleave' | 'addOnCritical' | 'highMarginGuide' | 'retentionRecall';
export type ActivityCouponChannel = 'inStore' | 'orderReturn' | 'reviewReturn' | 'pointsReturn' | 'targeted';
export type ActivityCouponTargetUser = 'all' | 'newCustomer' | 'highFrequency' | 'highAov' | 'lostCustomer' | 'specified';

export type Product = {
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

export type ProfitTarget = {
  enabled: boolean;
  payMin: number;
  payMax: number;
  rateMin: number;
  rateMax: number;
};

export type PricingStrategyTier = {
  enabled: boolean;
  payMin: number;
  payMax: number;
  payRateMin: number;
  payRateTarget: number;
  netRateMin: number;
  netRateTarget: number;
};

export type RedTier = {
  enabled: boolean;
  threshold: number;
  min: number;
  max: number;
};

export type FullReduction = {
  enabled: boolean;
  threshold: number;
  amount: number;
};

export type Coupon = {
  enabled: boolean;
  name: string;
  threshold: number;
  amount: number;
  sceneKey?: string;
  sceneName?: string;
  channel?: ActivityCouponChannel;
  targetUser?: ActivityCouponTargetUser;
  thresholdMode?: ActivityCouponThresholdMode;
};

export type RedAddOn = {
  enabled: boolean;
  threshold: number;
  amount: number;
};

export type DiscountActivity = {
  enabled: boolean;
  name: string;
  productNames: string;
  discountRate: number;
  itemLimit: number | '';
};

export type Activities = {
  fullReductions: FullReduction[];
  coupons: Coupon[];
  redAddOns: RedAddOn[];
  discountActivities: DiscountActivity[];
};

export type PricingEvaluationRule = {
  fallbackTargetProfitRate: number;
  addOnTargetProfitRate: number;
  riceBallTargetProfitRate: number;
  setMealTargetProfitRate: number;
  singleStapleTargetProfitRate: number;
  doubleStapleTargetProfitRate: number;
  multiStapleTargetProfitRate: number;
};

export type FeeRule = {
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

export type Store = {
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
  activityDesignSettings?: ActivityDesignSettings;
};

export type CalculatorState = {
  selectedStoreId: string;
  activePage: string;
  riskSafetyMargin: number;
  activityStrategySettings?: ActivityStrategySettings;
  platformRules: FeeRule;
  stores: Store[];
};

export type ComboItem = {
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

export type Summary = {
  resultCount: number;
  comboCount: number;
  validComboCount: number;
  elapsedTime: number | null;
};

export type CalculationProgress = {
  resultCount: number;
  comboCount: number;
  validComboCount: number;
};

export type CalculationLimits = {
  maxDurationMs?: number;
};

export type ComboRangeSettings = {
  productNameKeyword: string;
  originalMin: number;
  originalMax: number | '';
  payMin: number;
  payMax: number | '';
};

export type ActivityObjectivePayTarget = {
  payMin: number;
  payMax: number;
  targetPayProfitRate: number;
  minPayProfitRate: number;
  minNetProfitRate: number;
  maxLossShare: number;
};

export type ActivityObjectiveTemplate = {
  key: ActivityDesignObjective;
  enabled: boolean;
  name: string;
  group: ActivityObjectiveGroup;
  targetPayLabel: string;
  targetPayMin: number;
  targetPayMax: number;
  description: string;
  baseObjective?: ActivityDesignObjective;
};

export type ActivityOriginalDiscountTier = {
  originalMin: number;
  originalMax: number;
  discountRate: number;
};

export type ActivityObjectiveStrategy = Partial<ActivityObjectivePayTarget> & {
  baseOriginalDiscountRate?: number;
  originalDiscountTiers: ActivityOriginalDiscountTier[];
  fullDiscountShare: number;
  couponDiscountShare: number;
  reserveDiscountShare: number;
  fullThresholdWindow: number;
  fullThresholdMinGap: number;
  minFullAmountIncrease: number;
  fullAmountRounding: ActivityAmountRoundingMode;
  fullAmountBasis: ActivityFullAmountBasis;
  maxFullRuleCount: number;
  minFullHitCount: number;
  minNetPayFloor: number;
  couponScoringMode: ActivityCouponScoringMode;
  couponMergeThresholdGap: number;
  couponMergeAmountTolerance: number;
};

export type ActivityCouponSceneTemplate = {
  key: string;
  enabled: boolean;
  name: string;
  platforms?: Platform[];
  channel: ActivityCouponChannel;
  targetUser: ActivityCouponTargetUser;
  objective: ActivityDesignObjective;
  thresholdMode: ActivityCouponThresholdMode;
  payMin: number;
  payMax: number;
  thresholdMin: number;
  thresholdMax: number;
  thresholdStep: number;
  thresholdWindow: number;
  addOnMin: number;
  addOnMax: number;
  fullReductionOffsetMin: number;
  fullReductionOffsetMax: number;
  couponBudgetShare: number;
  maxCouponCount: number;
  maxCouponAmount: number;
  minPayProfitRate: number;
  minNetProfitRate: number;
  maxLossShare: number;
};

export type ActivityStrategySettings = {
  baseOriginalDiscountRate: number;
  objectiveTemplates?: ActivityObjectiveTemplate[];
  objectiveStrategies: Partial<Record<ActivityDesignObjective, ActivityObjectiveStrategy>>;
  couponSceneTemplates: ActivityCouponSceneTemplate[];
  platformCouponSceneKeys: Record<Platform, string[]>;
};

export type PricingEvaluationSettings = ComboRangeSettings & {
  redAddOnSpace: number;
  lowPayMax: number;
  fixedCostAllocation?: number;
};

export type ActivityDesignSettings = ComboRangeSettings & {
  redAddOnSpace: number;
  baseOriginalDiscountRate?: number;
  calculationMode?: ActivityDesignCalculationMode;
  originalBandsSnapshot?: PriceBandRow[];
  originalPriceBucketsSnapshot?: ActivityPriceBucketRow[];
  stapleMaxCount?: number;
  addOnMaxCount?: number | '';
  selectedRecommendationKey?: string;
  selectedRecommendationSnapshot?: ActivityRecommendationRow;
  targetProfitRate: number;
  couponProfitDrop: number;
  couponDesignBasis: 'original' | 'pay';
  couponDesignThresholdStep: number;
  couponDesignAmountStep: number;
  couponDesignMaxFullAmount: number | '';
  couponDesignMaxCouponAmount: number | '';
  designMode: 'auto' | 'full' | 'coupon' | 'stacked';
  objective?: ActivityDesignObjective;
  useDefaultObjectiveStrategies?: boolean;
  objectivePayTargets?: Partial<Record<ActivityDesignObjective, ActivityObjectivePayTarget>>;
  objectiveStrategies?: Partial<Record<ActivityDesignObjective, Partial<ActivityObjectiveStrategy>>>;
  objectiveTemplates?: ActivityObjectiveTemplate[];
  usePlatformCouponScenes?: boolean;
  enabledCouponSceneKeys?: string[];
  couponSceneTemplates?: ActivityCouponSceneTemplate[];
  minProfitRate?: number;
  originalBandSize?: number;
  payBandSize?: number;
};

export type MeasurementSettings = {
  originalMin: number;
  originalMax: number | '';
  stapleMaxCount: number;
  multiStapleCount: number;
  payMin: number;
  payMax: number | '';
  payBandSize: number;
  addOnMaxCount: number | '';
  ignoreOutOfPayRange: boolean;
};

export type FeeSummary = {
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
};

export type StrategyTarget = {
  scenario: StapleScenario;
  scenarioName: string;
  tier: PricingStrategyTier | null;
  tierName: string;
  requiredPayRate: number;
  targetPayRate: number;
  requiredNetRate: number;
  targetNetRate: number;
};

export type RiskInfo = {
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

export type ComboEvaluationRow = {
  key: string;
  platform: Platform;
  platformName: string;
  items: ComboItem[];
  scenario: StapleScenario;
  scenarioName: string;
  originalTotal: number;
  afterProductDiscount: number;
  finalPay: number;
  netPay: number;
  cost: number;
  activityAmount: number;
  commission: number;
  serviceFee: number;
  freightSubsidy: number;
  profit: number;
  profitRate: number | null;
  netProfitRate: number | null;
  costProfitRate: number | null;
  targetPayRate: number;
  targetNetRate: number;
  requiredPayRate: number;
  requiredNetRate: number;
  profitSpace: number;
  profitRateGap: number | null;
  productDiscount: number;
  full: FullReduction;
  coupons: Coupon[];
  couponAmount: number;
  baseRed: RedTier & { amount: number };
  redAddOn: RedAddOn;
  ignored: boolean;
  ignoreReason: string;
  risk: RiskInfo;
};

export type PriceBandRow = {
  key: string;
  label: string;
  min: number;
  max: number;
  platform: Platform | 'all';
  platformName: string;
  scenario: StapleScenario;
  scenarioName: string;
  comboCount: number;
  ignoredCount: number;
  avgOriginalTotal: number;
  avgFinalPay: number;
  avgNetPay: number;
  avgCost: number;
  avgProfit: number;
  minProfit: number | null;
  maxProfit: number | null;
  avgProfitRate: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  avgProfitSpace: number;
  lowCount: number;
  riskCount: number;
  suggestion: string;
};

export type PricingProductRow = {
  key: string;
  platform: Platform;
  platformName: string;
  productId: string;
  productName: string;
  category: ProductCategory;
  categoryName: string;
  scenario: StapleScenario;
  scenarioName: string;
  currentPrice: number;
  packageFee: number;
  currentOriginalPrice: number;
  productCost: number;
  fixedCostAllocation: number;
  baseCost: number;
  targetProfitRate: number;
  currentProfit: number;
  currentProfitRate: number | null;
  targetOriginalPrice: number;
  suggestedPrice: number;
  suggestedOriginalPrice: number;
  suggestedIncrease: number;
  suggestedIncreaseRate: number | null;
  profitSpace: number;
  severity: Severity;
  reasons: string[];
};

export type PricingEvaluationResult = {
  productRows: PricingProductRow[];
  warnings: string[];
  summary: Summary;
};

export type ActivityBaseComboRow = ComboEvaluationRow & {
  baseFinalPay: number;
  baseNetPay: number;
  baseProfitRate: number | null;
  activityTargetObjective?: ActivityDesignObjective;
  activityTargetObjectiveName?: string;
  activityTargetDiscountRate?: number;
  activityTargetPay?: number;
  activityTargetDiscountAmount?: number;
  activityAlreadyDiscountAmount?: number;
  activityRedAddOnAmount?: number;
  activityDesignSpace?: number;
  activityNetPayBoundarySpace?: number;
  activitySafeDiscountSpace?: number;
  activityTargetPayGap?: number;
};

export type ActivityScanComboPoolRow = {
  key: string;
  platform: Platform;
  qtys: number[];
  priceCents: number;
  totalQty: number;
  originalTotal: number;
  stapleCount: number;
};

export type ActivityOriginalPriceBucketEntry = {
  key: string;
  originalTotalCents: number;
  mainComboIds: string[];
  addOnComboIds: string[];
  comboCount: number;
};

export type ActivityScanComboPools = {
  mainCombos: ActivityScanComboPoolRow[];
  addOnCombos: ActivityScanComboPoolRow[];
  mainComboCountByPlatform: Partial<Record<Platform, number>>;
  addOnComboCountByPlatform: Partial<Record<Platform, number>>;
};

export type ActivityRouteScoreLevel = 'excellent' | 'usable' | 'review' | 'risk';
export type ActivityRouteKind = 'fullReduction' | 'coupon' | 'combined';

export type ActivityPriceBucketRow = {
  key: string;
  platform: Platform;
  platformName: string;
  priceBucket: number;
  label: string;
  min: number;
  max: number;
  comboCount: number;
  weightedComboCount: number;
  avgOriginalTotal: number;
  avgFinalPay: number;
  avgNetPay: number;
  avgCost: number;
  avgProfit: number;
  weightedAvgFinalPay: number;
  weightedAvgNetPay: number;
  avgActivityTargetDiscountRate?: number | null;
  weightedAvgActivityTargetDiscountRate?: number | null;
  avgActivityTargetPay?: number;
  weightedAvgActivityTargetPay?: number;
  avgActivityTargetPayGap?: number;
  weightedAvgActivityTargetPayGap?: number;
  avgActivityTargetDiscountAmount?: number;
  weightedAvgActivityTargetDiscountAmount?: number;
  avgActivityAlreadyDiscountAmount?: number;
  weightedAvgActivityAlreadyDiscountAmount?: number;
  avgActivityRedAddOnAmount?: number;
  weightedAvgActivityRedAddOnAmount?: number;
  avgActivityDesignSpace?: number;
  weightedAvgActivityDesignSpace?: number;
  avgActivityNetPayBoundarySpace?: number;
  weightedAvgActivityNetPayBoundarySpace?: number;
  avgActivitySafeDiscountSpace?: number;
  weightedAvgActivitySafeDiscountSpace?: number;
  weightedAvgCost: number;
  weightedAvgProfit: number;
  weightedProfitRate: number | null;
  avgProfitRate: number | null;
  minProfitRate: number | null;
  maxProfitRate: number | null;
  profitRateSpread: number | null;
  riskCount: number;
  outlierCount: number;
  entries?: ActivityOriginalPriceBucketEntry[];
  sampleRows?: ActivityBaseComboRow[];
  suggestion: string;
};

export type ActivityCouponBucketSuggestion = {
  key: string;
  originalBucket: number;
  threshold: number;
  amount: number;
  targetSpace: number;
  fullDiscountAmount: number;
  remainingSpace: number;
  boundarySpace: number;
  minCoveredBucket: number;
  maxCoveredBucket: number;
  coveredBucketCount: number;
  thresholdScore: number;
  amountScore: number;
  similarityScore: number;
  sceneScore: number;
  totalScore: number;
  scoringMode: ActivityCouponScoringMode;
  sceneKey?: string;
  sceneName?: string;
  selected?: boolean;
  mergedCouponKey?: string;
  diagnosis: string;
};

export type ActivityRouteScoreBreakdown = {
  activeCount: number;
  ignoredCount: number;
  targetGap: number | null;
  avgProfitRate: number | null;
  targetProfitRate: number;
  minProfitRate: number | null;
  payBandSpread: number | null;
  profitRateSpread: number | null;
  lossCount: number;
  lossShare: number;
  maxLossShare: number;
  lossOutOfToleranceCount: number;
  minAllowedProfitRate: number;
  targetPenalty: number;
  spreadPenalty: number;
  lossPenalty: number;
  ignoredPenalty: number;
  discountPenalty: number;
  demandPenalty?: number;
  businessPayWeight?: number;
  corePayShare?: number;
  mainPayShare?: number;
  highPayShare?: number;
  targetPayShareFloor?: number;
  highPayShareLimit?: number;
  totalPenalty: number;
};

export type ActivityRecommendationRow = {
  key: string;
  platform: Platform;
  platformName: string;
  routeKind?: ActivityRouteKind;
  routeGroup?: 'stable' | 'marketing';
  userScenarioName?: string;
  targetPayLabel?: string;
  targetPayMin?: number;
  targetPayMax?: number;
  targetDiscountRate?: number | null;
  targetPayAmount?: number | null;
  targetPayGap?: number | null;
  sourceRouteKeys?: string[];
  objective: ActivityDesignObjective;
  objectiveName: string;
  originalBandKey: string;
  originalBandLabel: string;
  threshold: number;
  fullReductionRules: FullReduction[];
  couponRules: Coupon[];
  couponBucketSuggestions?: ActivityCouponBucketSuggestion[];
  fullAmount: number;
  couponAmount: number;
  productDiscountAmount: number;
  addOnCostSpace: number;
  routeAddOnCostSpace: number;
  totalDiscount: number;
  safeDiscountSpace: number;
  hitCount: number;
  avgProfitBefore: number | null;
  avgProfitAfter: number | null;
  minProfitAfter: number | null;
  profitRateSpreadAfter: number | null;
  avgFinalPayAfter: number;
  targetProfitRate: number;
  score: number;
  scoreLevel?: ActivityRouteScoreLevel;
  scoreLabel?: string;
  scoreDetails?: string[];
  scoreBreakdown?: ActivityRouteScoreBreakdown;
  actionType: string;
  diagnosis: string;
  exampleItems: ComboItem[];
};

export type ActivityComboSimulationRow = ComboEvaluationRow & {
  recommendationKey: string;
  recommendationLabel: string;
  detailReasons?: string[];
};

export type ActivityDesignResult = {
  originalBands: PriceBandRow[];
  originalPriceBuckets?: ActivityPriceBucketRow[];
  originalComboRows?: ActivityBaseComboRow[];
  routeSourceRows?: ActivityBaseComboRow[];
  scanComboPools?: ActivityScanComboPools;
  fullRoutes?: ActivityRecommendationRow[];
  couponRoutes?: ActivityRecommendationRow[];
  recommendations: ActivityRecommendationRow[];
  payBands: PriceBandRow[];
  hitRows: ActivityComboSimulationRow[];
  comboRows: ActivityComboSimulationRow[];
  warnings: string[];
  summary: Summary;
};

export type MeasurementResult = {
  rows: ComboEvaluationRow[];
  payBands: PriceBandRow[];
  warnings: string[];
  summary: Summary & {
    ignoredCount: number;
    riskCount: number;
  };
};
