# 活动设计技术方案

## 1. 架构目标

活动设计采用“原价扫描快照 + 路线设计 + 路线核验/应用”的分层模型：

```text
商品库
  -> 商品组合生成
  -> 原价整数扫描快照
  -> 基于快照生成活动路线
  -> 路线核验或应用
  -> 当前门店当前平台活动配置
```

核心约束：

- 活动路线生成不读取成本、利润、支付毛利率或到手利润率。
- 活动路线只使用原价、基准用户实付、基准商家到手价、基准目标总让利率、原价阶梯覆盖让利率和活动策略占比。
- 商家到手价最低边界从经营目标策略读取，系统默认 2 元。
- 测算和定价评估缓存可以保留成本字段；原价扫描缓存不得保存成本/利润计算结果，活动设计路线算法也不得使用这些字段。
- 原价扫描任务只生成扫描快照，不生成路线。
- 路线任务基于已确认的扫描快照执行，不重新枚举全量组合。
- 神券/爆红包属于活动优惠；当前版本默认参与，并在原价扫描时计入基准支付价和基准到手价。
- 每条路线独立包含一套阶梯满减、多张互斥券和加码空间。
- 路线评分只看支付区覆盖、高支付价占比、到手价边界和优惠强度。
- 商品折扣属于核验或测算后的二次修正，不参与路线生成和路线评分；应用后写入当前门店当前平台的 `discountActivities`，再通过测算或核验复查。

## 2. 模块划分

### 2.1 系统策略配置

系统策略配置保存在 `CalculatorState.activityStrategySettings`，包含：

- `objectiveTemplates`：经营目标模板。
- `baseOriginalDiscountRate`：全路线基准目标总让利率，默认 50%。
- `objectiveStrategies`：经营目标策略。
- `couponSceneTemplates`：券场景模板。
- `platformCouponSceneKeys`：平台默认启用券场景。

门店级配置保存在 `store.activityDesignSettings`，用于覆盖系统默认值。

门店经营目标模型默认直接使用门店通用规则，也就是 `CalculatorState.activityStrategySettings` 中的经营目标模板和策略。只有 `store.activityDesignSettings.useDefaultObjectiveStrategies=false` 时，才读取门店级 `objectiveTemplates` 和 `objectiveStrategies` 作为覆盖。

系统活动策略页使用独立编辑草稿：

- 展示态读取 `state.activityStrategySettings`。
- 点击编辑后复制为 `systemStrategyDraft`。
- 编辑经营目标、券场景和平台默认启用场景时只修改草稿。
- 保存时执行 `normalizeActivityStrategySettings(systemStrategyDraft)`，通过 `commitState` 写回 `state.activityStrategySettings` 并保存到浏览器数据库。
- 取消编辑时清空草稿，不修改正式配置。
- 恢复默认、新增经营目标、新增券场景只修改草稿，保存后才影响门店继承和活动路线生成。

合并顺序：

```text
DEFAULT_ACTIVITY_STRATEGY_SETTINGS
  -> state.activityStrategySettings
  -> store.activityDesignSettings.objectiveTemplates（仅门店关闭通用规则时）
  -> store.activityDesignSettings.objectiveStrategies（仅门店关闭通用规则时）
  -> store.activityDesignSettings.enabledCouponSceneKeys
```

门店页交互：

- 展示态显示“使用门店通用规则”或“门店自定义规则”。
- 编辑态默认勾选“使用门店通用规则”，经营目标表格只读展示通用规则。
- 取消勾选后，以当前通用规则为底稿生成门店自定义配置，再允许编辑全路线基准让利率、阶梯覆盖、满减占比、券占比和最大满减阶梯数。
- 重新勾选后，门店级经营目标覆盖被忽略，后续路线设计重新跟随通用规则。

历史字段兼容：

- `targetPayProfitRate`
- `minPayProfitRate`
- `minNetProfitRate`
- `maxLossShare`
- `targetProfitRate`
- `couponProfitDrop`
- `minProfitRate`
- `payMin` / `payMax`：旧券场景的支付观察字段，保留兼容读取，但新版路线生成不再使用。

这些字段可以继续存在于旧数据结构中，但新版活动路线生成、评分和页面主视角不使用它们。

### 2.2 原价扫描

原价扫描在 `runActivityDesignCalculation` 的 `priceScan` 模式下执行。

输出：

- `originalBands`：稳定版原价扫描不再生成原价区间明细，保持空数组兼容旧页面结构。
- `originalPriceBuckets`：原价桶统计和桶内组合关系，是生成路线的输入。
- `scanComboPools`：饭团组合池和凑单小吃组合池，是点击桶详情还原商品组合的来源。
- `originalComboRows`：旧缓存兼容字段，新扫描固定为空数组。
- `routeSourceRows`：旧缓存兼容字段，新扫描固定为空数组。
- `warnings`
- `summary`

原价整数桶定义：

```text
priceBucket = floor(originalTotal)
bucketRange = priceBucket <= originalTotal < priceBucket + 1
```

扫描下界：

```text
scanOriginalMin = max(store.startPrice, settings.originalMin)
```

低于门店起送价的组合不进入原价整数桶。后续满减和券路线只基于已经扫描到的原价桶，不再用历史门槛、测算最低总价或手动门槛偏好额外抬高第一档门槛。

扫描算法：

1. 调用组合池构建器生成饭团组合池 `mainCombos` 和凑单小吃组合池 `addOnCombos`；`addOnCombos` 必须包含空组合。
2. 扫描前仅在内存里把组合池按平台、价格分、组合件数和主食份数归组，得到临时价格组。
3. 原价扫描遍历饭团价格组和小吃价格组，而不是遍历所有饭团组合和小吃组合的商品笛卡尔积。
4. 每个价格组对的真实商品组合数为 `mainComboIds.length * addOnComboIds.length`。
5. 命中原价整数桶后写入桶内 `entries`，包含 `originalTotalCents`、`mainComboIds`、`addOnComboIds` 和 `comboCount`。

路线生成前通过 `activityBucketRowsToRouteRows(originalPriceBuckets, platforms)` 把桶统计映射为桶级路线输入：

- `originalTotal` 使用桶均值原价，缺失时使用整数桶值。
- `finalPay` 使用桶级平均基准实付价。
- `netPay` 使用桶级平均基准到手价。
- `activityDesignSpace`、`activitySafeDiscountSpace` 和基准已让利使用桶级扫描统计。
- `items` 固定为空数组，路线表不得展示代表商品组合。
- `hitCount` 在路线对象里表示覆盖原价桶数，而不是商品组合数。

聚合指标：

```text
comboCount = count(combo)
avgOriginalTotal = avg(originalTotal)
avgFinalPay = avg(baseFinalPay)
avgNetPay = avg(baseNetPay)
avgActivityTargetDiscountAmount = avg(targetTotalDiscount)
avgActivityAlreadyDiscountAmount = avg(alreadyDiscount)
avgActivityDesignSpace = avg(designSpace)
avgActivitySafeDiscountSpace = avg(safeDiscountSpace)
```

成本和利润相关聚合字段只为旧类型兼容保留。稳定版原价扫描不计算成本、利润、支付毛利率、到手利润率或商品折扣建议；原价桶页面展示活动空间字段，用于解释后续路线为什么生成或不生成满减/券。

原价桶诊断：

- `avgNetPay < minNetPayFloor`：不适合继续让利。
- 存在到手边界风险组合：提示查看明细确认商品组合。
- 存在支付价或到手价背离组合：提示判断是否为策略组合。
- `avgFinalPay > 30`：支付价偏高，路线应优先检查满减梯度和券门槛。
- `avgFinalPay <= 25`：已覆盖主要支付场景。

### 2.3 扫描缓存

本地 MVP 使用 IndexedDB `activity_price_scans` 保存原价扫描快照。

缓存 key：

```text
storeId + activityPriceScanModelVersion
```

签名包含：

- 门店起送价。活动设计扫描使用起送价过滤低原价桶。
- 测算最高总价。活动设计不使用测算最低总价过滤原价桶。
- 主食和凑单组合边界。
- 平台费用规则。
- 商品价格、平台价、打包费、上下架状态、分类、主食份数、单点不送。
- 门店折扣活动。
- 全路线基准让利率、原价阶梯覆盖让利率、满减/券/预留占比、满减分段阈值、金额取整策略、最大满减阶梯数、券场景、步长和加码空间。

签名不包含：

- 商品成本。
- 门店利润目标。
- 风险安全边际。
- 测算最低总价。
- 活动设计旧版毛利字段。

原因：这些字段不再影响原价扫描和活动路线设计，不能导致扫描缓存无意义失效。

缓存结构：

```ts
type PersistedActivityPriceScanRecord = {
  key: string;
  storeId: string;
  storeName: string;
  generatedAt: string;
  signature: string;
  meta: {
    storeId: string;
    generatedAt: string;
    bucketCount: number;
    mainComboCount: number;
    addOnComboCount: number;
    mainComboCountByPlatform?: Partial<Record<Platform, number>>;
    addOnComboCountByPlatform?: Partial<Record<Platform, number>>;
  };
  scanComboPools: ActivityScanComboPools;
  originalPriceBuckets: ActivityPriceBucketRow[];
};

type ActivityScanComboPoolRow = {
  key: string;
  platform: Platform;
  qtys: number[];
  priceCents: number;
  totalQty: number;
  originalTotal: number;
  stapleCount: number;
};

type ActivityScanComboPools = {
  mainCombos: ActivityScanComboPoolRow[];
  addOnCombos: ActivityScanComboPoolRow[];
  mainComboCountByPlatform: Partial<Record<Platform, number>>;
  addOnComboCountByPlatform: Partial<Record<Platform, number>>;
};

type ActivityOriginalPriceBucketEntry = {
  key: string;
  originalTotalCents: number;
  mainComboIds: string[];
  addOnComboIds: string[];
  comboCount: number;
};
```

稳定版缓存只写入 `scanComboPools` 和 `originalPriceBuckets`。`originalComboRows`、`routeSourceRows`、原价扫描分块明细、range key 明细、饭团价格组索引和小吃价格组索引不得作为新扫描缓存写入。临时价格组只在扫描进程中使用，桶详情通过 `originalPriceBuckets.entries` 中的组合 ID 从 `scanComboPools` 还原商品组合。

稳定版冻结约束：未来改动如果没有明确提及修改原价扫描稳定版存储结构或价格组方案，不得改变三类缓存数据、`entries` 结构、点击桶即时还原组合的职责边界，也不得重新引入成本/利润扫描或全量组合分块缓存。

## 3. 数据结构

### 3.1 ActivityPriceBucketRow

关键字段：

```ts
type ActivityPriceBucketRow = {
  key: string;
  platform: Platform;
  priceBucket: number;
  label: string;
  comboCount: number;
  avgOriginalTotal: number;
  avgFinalPay: number;
  avgNetPay: number;
  avgActivityTargetDiscountRate: number | null;
  avgActivityTargetPay: number;
  avgActivityTargetPayGap: number; // 兼容旧字段，页面不作为主视角展示
  avgActivityTargetDiscountAmount: number;
  avgActivityAlreadyDiscountAmount: number;
  avgActivityDesignSpace: number;
  avgActivityNetPayBoundarySpace: number;
  avgActivitySafeDiscountSpace: number;
  riskCount: number;
  outlierCount: number;
  entries?: ActivityOriginalPriceBucketEntry[];
  sampleRows?: ActivityBaseComboRow[]; // 旧缓存兼容，新扫描不写入
  suggestion: string;
};
```

`entries` 是稳定版桶内组合关系：

```ts
type ActivityOriginalPriceBucketEntry = {
  key: string;
  originalTotalCents: number;
  mainComboIds: string[];
  addOnComboIds: string[];
  comboCount: number;
};
```

`sampleRows` 只为旧缓存兼容保留，新扫描不得写入。

### 3.2 ActivityObjectiveStrategy

新版路线设计使用字段：

```ts
type ActivityStrategySettings = {
  baseOriginalDiscountRate: number;
  objectiveTemplates?: ActivityObjectiveTemplate[];
  objectiveStrategies: Partial<Record<ActivityDesignObjective, ActivityObjectiveStrategy>>;
  couponSceneTemplates: ActivityCouponSceneTemplate[];
  platformCouponSceneKeys: Record<Platform, string[]>;
};

type ActivityObjectiveStrategy = {
  originalDiscountTiers: ActivityOriginalDiscountTier[];
  fullDiscountShare: number;
  couponDiscountShare: number;
  reserveDiscountShare: number;
  fullThresholdWindow: number;
  fullThresholdMinGap: number;
  fullThresholdMaxGap: number;
  fullDiscountDriftThreshold: number;
  fullDiscountJumpThreshold: number;
  minFullAmountIncrease: number;
  fullAmountRounding: 'floor' | 'nearest' | 'ceil';
  fullAmountBasis: 'average' | 'p75' | 'min' | 'max';
  maxFullRuleCount: number;
  minFullHitCount: number;
  minNetPayFloor: number;
  fullBoundaryMode: 'conservative' | 'balanced' | 'aggressive';
  couponBoundaryMode: 'conservative' | 'balanced' | 'aggressive';
  couponScoringMode: 'conservative' | 'balanced' | 'aggressive';
  couponMergeThresholdGap: number;
  couponMergeAmountTolerance: number;
};

type ActivityOriginalDiscountTier = {
  originalMin: number;
  originalMax: number;
  discountRate: number;
};
```

### 3.3 ActivityCouponBucketSuggestion

原价桶券建议只用于诊断和最终推荐券合并，不直接应用到门店活动。

```ts
type ActivityCouponBucketSuggestion = {
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
  scoringMode: 'conservative' | 'balanced' | 'aggressive';
  sceneKey?: string;
  sceneName?: string;
  selected?: boolean;
  mergedCouponKey?: string;
  diagnosis: string;
};
```

`profitConvergence` 是历史枚举值，页面展示为“支付区收敛优先”。

### 3.4 ActivityCouponSceneTemplate

新版路线设计使用字段：

```ts
type ActivityCouponSceneTemplate = {
  key: string;
  enabled: boolean;
  name: string;
  platforms?: Platform[];
  channel: ActivityCouponChannel;
  targetUser: ActivityCouponTargetUser;
  objective: ActivityDesignObjective;
  thresholdMode: ActivityCouponThresholdMode;
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
};
```

`highMarginGuide` 是历史枚举值，页面展示为“高到手引导”。

### 3.5 ActivityRecommendationRow

每条路线必须包含：

- `objective`
- `objectiveName`
- `fullReductionRules`
- `couponRules`
- `couponBucketSuggestions`
- `addOnCostSpace`
- `routeAddOnCostSpace`
- `totalDiscount`
- `score`
- `scoreLevel`
- `scoreBreakdown`
- `diagnosis`
- `sourceRouteKeys`

兼容字段 `targetPayLabel`、`targetPayMin`、`targetPayMax`、`targetDiscountRate`、`targetPayAmount`、`targetPayGap` 可以保留在类型中，但新活动路线可以置空，页面不展示这些字段。

### 3.6 ProductDiscountSuggestion

商品折扣建议是页面层的二次修正结构，不保存到活动路线结果中。

```ts
type ProductDiscountSuggestion = {
  source: 'measurementResult' | 'activityValidation';
  platform: Platform;
  productId: string;
  productName: string;
  discountRate: number;
  discountAmountPerUnit: number;
  itemLimit: number | '';
  affectedComboCount: number;
  highProfitComboCount: number;
  avgPaymentGrossRate: number | null;
  medianPaymentGrossRate: number | null;
  avgNetProfitRate: number | null;
  avgProfitSpace: number;
  minProfitAfterDiscount: number | null;
  minNetPayAfterDiscount: number | null;
  minFinalPayAfterDiscount: number | null;
  riskLevel: 'safe' | 'watch' | 'blocked';
  reason: string;
};
```

字段说明：

- `source` 标记建议来自测算结果、支付价核验或原价扫描。
- `discountRate` 沿用商品折扣活动的“几折”口径，例如 `8.8` 表示 8.8 折。
- `itemLimit` 默认使用 `1`，避免同一 SKU 多件组合被一次应用打穿；用户可以在活动维护中手动调整。
- `riskLevel=blocked` 时不允许直接应用。

## 4. 核心算法

### 4.1 基准让利率与原价阶梯覆盖

系统先配置一个全路线基准目标总让利率，默认 50%；每个经营目标再用原价阶梯覆盖特殊价格段。未命中任何覆盖阶梯的原价都按全路线基准让利率计算，不需要为了覆盖全价格段手动维护所有阶梯。

```text
baseOriginalDiscountRate = 50%
originalDiscountTiers = 0-18:0%，30-45:25%，45-60:20%，60+:15%
```

全路线基准让利率和经营目标阶梯覆盖率都表示“当前原价最终希望由全部活动承担的总让利”，包含平台默认神券/爆红包、门店满减、订单券和加码。原价扫描阶段已经默认命中平台基础神券/爆红包，所以路线生成只补足剩余空间。

```ts
function activityOriginalDiscountRate(settings, objective, originalTotal) {
  const profile = activityObjectivePayProfile(settings, objective);
  const tier = profile.originalDiscountTiers.find(row => (
    originalTotal >= row.originalMin && originalTotal < row.originalMax
  ));
  const discountRate = tier?.discountRate ?? settings.baseOriginalDiscountRate ?? 50;
  return clamp(discountRate, 0, 95) / 100;
}
```

### 4.2 安全让利空间

```text
targetTotalDiscount = originalTotal * activityOriginalDiscountRate(settings, objective, originalTotal)
alreadyDiscount = max(0, originalTotal - baseFinalPay)
targetSpace = max(0, targetTotalDiscount - alreadyDiscount)
netPayFloorSpace = max(0, baseNetPay - activityObjective.minNetPayFloor)
safeDiscountSpace = min(targetSpace, netPayFloorSpace)
```

说明：

- `targetTotalDiscount` 是全路线基准让利率或经营目标阶梯覆盖要求的总活动金额。
- `alreadyDiscount` 是基准支付价里已经由默认活动产生的优惠。
- `targetSpace` 是满减、券和加码仍需要补足的空间。
- `netPayFloorSpace` 代表商家到手价还能承受的最大优惠，最低到手价默认 2 元，也可以按经营目标配置。
- 经营目标不再配置手动目标支付区，路线页不展示目标支付均价、距目标或让利指导价。
- `safeDiscountSpace` 是满减、券和加码共享的剩余设计空间。
- 这里不计算成本，不反推目标毛利。

档位聚合规则：

```text
comboSpace = safeDiscountSpace(combo)
positiveSpaces = comboSpaces.filter(space > 0.1)
averageTargetSpace = avg(positiveSpaces)
lossBoundSpace = boundaryMetric(positiveSpaces, objectiveBoundaryMode)
routeSafeDiscountSpace = min(averageTargetSpace, lossBoundSpace)
```

说明：

- `boundaryMetric` 由经营目标边界口径决定：保守取最低命中桶，平稳取均值或经营目标分位，激进允许取更高分位。

- 只有正向可让利组合参与档位空间估算。
- 0 空间组合仍保留在覆盖率、风险、忽略数和明细中，但不能把整个原价档位的活动空间压成 0。
- 例如原价 25、覆盖让利率 50%、基准支付价 17.47 时，总活动金额要求为 12.50，已发生基准让利为 7.53，剩余空间应约为 4.97。
- 例如原价桶 23、覆盖让利率 50%、基准默认神券/爆红包已优惠 8 时，`targetTotalDiscount=11.50`，`alreadyDiscount=8.00`，`targetSpace=3.50`。后续满减和券只能分配这部分剩余活动空间，并由支付价核验检查到手价 2 元边界。

让利步长取整：

```text
floorValue = floor(value / amountStep) * amountStep
if value 接近下一个步长，允许取到下一个步长
```

当 `value=4.97` 且 `amountStep=5` 时，路线空间按 5 元参与满减、券和加码分配；后续支付价核验负责检查是否打穿到手价 2 元边界。

### 4.3 满减规则生成

满减规则不再按配置门槛生成，而是从原价整数桶自适应分段。候选门槛直接使用触发分段的整数原价桶。
第一档门槛从当前原价桶快照的最低有效原价桶开始，不取 `max(store.startPrice, minBucket)`，避免起送价或历史高门槛把 23、24、25 这类主要支付场景排除。
满减分段使用当前平台完整原价桶快照，不再使用经营目标筛选后的组合样本、目标支付样本或代表商品组合。

输入桶：

```text
当前平台完整原价整数桶
AND comboCount > 0
AND 桶级 baseNetPay >= minNetPayFloor 的桶优先
```

分段流程：

```text
bucket = floor(originalTotal)
bucketTarget = basisMetric(targetSpace)
firstThreshold = min(valid bucket)

满足以下条件之一时开启新满减段：
1. 当前段宽度 >= fullThresholdMaxGap
2. 当前段宽度 >= fullThresholdMinGap，且 bucketTarget 相对上一阶梯起点桶的 targetSpace 偏离 >= fullDiscountDriftThreshold
3. 当前段宽度 >= fullThresholdMinGap，且相邻整数桶跳变 >= fullDiscountJumpThreshold
```

例如最低有效桶 24 的活动空间为 4 元，36 桶活动空间为 8 元；当 `fullThresholdMinGap <= 12` 且 `fullDiscountDriftThreshold <= 4` 时，36 桶必须成为下一档满减候选。后续 53 桶相对 36 桶再次偏离约 4 元，也必须继续成为下一档候选，除非达到 `maxFullRuleCount`、满减最大减额或到手价硬边界。

门槛确定：

```text
rawThreshold = segment.firstBucket
threshold = floor(rawThreshold)
threshold >= min(valid bucket)
```

系统不再维护手动门槛列表或门槛取整策略。最大满减阶梯数只控制路线复杂度上限，不改变候选门槛位置。

满减减额：

```text
segmentTarget = mean / p75 / min / max
rawFullAmount = segmentTarget * fullDiscountShare
firstAffectedBucket = min(floor(basis) where basis >= threshold)
firstBucketCap = min(targetSpace of firstAffectedBucket) * fullDiscountShare
rawFullAmount = min(rawFullAmount, firstBucketCap)
fullAmount = round(rawFullAmount, fullAmountRounding)
fullAmount <= couponDesignMaxFullAmount
fullAmount <= netPayFloorRouteDiscountSpace
```

`netPayFloorRouteDiscountSpace` 通过活动后 `finalPay` 重新计算佣金、履约服务费和运费补贴，再反推出仍满足最低到手价的最大活动金额。不能直接使用 `netPay - minNetPayFloor` 作为活动金额上限，否则会把佣金随支付价下降带来的回补忽略掉，导致低价桶满减金额被过度压低。

满减金额生成使用 1 元粒度。`couponDesignAmountStep` 仍可用于券和加码的金额步长，但不能把满减从 2.8 元按 2 元步长压成 2 元。首轮分段生成时，`netPayFloorRouteDiscountSpace` 和 `firstBucketCap` 只取当前门槛实际起始桶的边界；后续桶的异常低边界不提前压死该门槛，风险由支付价核验暴露。

新满减档还必须满足：

```text
threshold - previousThreshold >= fullThresholdMinGap
fullAmount > previousFullAmount
```

如果候选门槛太近，仍不生成更密满减，剩余活动空间交给优惠券规则生成。`minFullAmountIncrease` 是优先抬升目标：当候选已触发分段但减额没有高于上一档，或高于上一档但不足配置增量时，先尝试把减额抬到 `previousFullAmount + max(amountStep, minFullAmountIncrease)`；如果到手边界、首个命中桶空间或满减最大减额不允许抬升，则保留原候选减额；只有安全上限也无法让减额高于上一档时，才把缺口交给优惠券。每个经营目标最多生成 `maxFullRuleCount` 个阶梯。
如果 `rawFullAmount > 0` 但按金额步长取整为 0，保留不超过 `maxAllowedAmount` 的原始小额减额，避免 23、24、25 这类低价桶被取整策略吞掉。
自适应分段生成后，需要再次按原价整数桶扫描剩余候选；当某个桶的门槛满足 `fullThresholdMinGap`，并且目标满减额相对上一档出现 `fullDiscountDriftThreshold` 偏离、相邻桶出现 `fullDiscountJumpThreshold` 跳档，或门槛距离达到 `fullThresholdMaxGap` 时，补生成下一档满减，直到达到 `maxFullRuleCount`。

门槛位置由原价整数桶、最小/最大梯度间距、偏离阈值和跳档阈值共同决定；让利强度由全路线 `baseOriginalDiscountRate`、经营目标 `originalDiscountTiers`、分段统计口径和满减占比共同决定。原价让利设置使用弹框表格编辑，支持逐档修改覆盖阶梯、添加档位、删除档位、批量生成阶梯、整体上调或下调覆盖利率、统一设置覆盖利率和恢复默认阶梯。允许覆盖阶梯为空，此时全部原价按全路线基准让利率计算。

### 4.4 优惠券规则生成

券规则不再先由场景铺大量候选门槛，而是在当前满减确定后，先生成“原价桶券列表”，再合并为“最终推荐券表”。

原价桶券建议：

```text
bucket = floor(originalTotal)
fullOnlyRow = simulate(fullReductionRules, noCoupons, bucketRows)
remainingSpace = safeDiscountSpace(fullOnlyRow, objective)
boundarySpace = netPayFloorSpace(fullOnlyRow, objective.minNetPayFloor)
couponAmount = round(min(remainingSpace, boundarySpace, scene.maxCouponAmount), fullAmountRounding)
couponThreshold = bucket
```

说明：

- 原价桶是整数桶，不处理 26.9 这类商品小数价。
- `couponThreshold` 默认等于当前原价桶。
- `remainingSpace` 表示在既定满减后，该桶还需要由券补足的活动空间。
- `boundarySpace` 由 `couponBoundaryMode` 决定，保守看最低命中桶，平稳看均值或分位，激进允许看高位桶。
- 券场景只参与场景分和最终券元数据，不再覆盖原价桶券建议的核心门槛和金额。

原价桶券建议评分：

```text
thresholdScore = f(couponScoringMode, bucket)
amountScore = f(couponAmount / remainingSpace, couponScoringMode)
sceneScore = f(scene.thresholdMode, bucket, fullReductionRules)
totalScore = thresholdScore * 0.25 + amountScore * 0.5 + sceneScore * 0.25
```

三种模式：

- 保守：最低桶也应达到目标优惠，优先低门槛覆盖。
- 平稳：覆盖桶平均达到目标，最低桶允许轻微不足，适合长期券。
- 激进：允许最低桶明显不足，优先更高门槛或下一阶梯前的高位桶。

最终推荐券合并：

```text
sort bucketSuggestions by threshold
if thresholdGap <= couponMergeThresholdGap
and amountDiff <= couponMergeAmountTolerance
then merge into one coupon group
```

合并后选择代表券：

- 保守/平稳：选择组内较低门槛，保证长期覆盖。
- 激进：选择组内较高门槛，用于提门槛、促加购或定向推品。

最终活动应用只使用 `couponRules`。`couponBucketSuggestions` 保存在路线对象里，用于诊断、定向发券和人工选择，不直接写入门店活动。活动路线表只展示券列表摘要；二级弹框展示全量 `couponBucketSuggestions`，用 `selected` 标识是否进入最终推荐券表，并展示对应 `sceneName`、覆盖原价桶范围和评分明细。券推荐诊断只出现在券列表弹框顶部，用 `couponRules` 和 `couponBucketSuggestions` 汇总最终推荐券数量、推荐覆盖桶、主推荐场景、未合并桶和桶级满减后缺口。

路线诊断 `ActivityRecommendationRow.diagnosis` 只描述满减底盘，不描述券推荐：包含满减档数、首档门槛、最高档、主要支付覆盖、高支付价和到手边界。需要说明券为什么推荐、哪些桶被合并、哪些桶未进入最终推荐时，只读取 `couponBucketSuggestions` 在券列表弹框展示。

### 4.5 路线评分

评分输入：

```text
businessPayWeight
mainPayShare
highPayShare
ignoredCount
totalDiscount
```

评分公式：

```text
demandPenalty =
  max(0, 1 - businessPayWeight) * 70
  + max(0, targetPayShareFloor - mainPayShare) * 180
  + max(0, highPayShare - highPayShareLimit) * 150
  + highPayShare * 35

ignoredPenalty = ignoredCount * 70
discountPenalty = totalDiscount * discountWeight

score = demandPenalty + ignoredPenalty + discountPenalty
```

评分等级：

- `excellent`：主要支付场景覆盖好、到手边界稳定、优惠力度合理。
- `usable`：可用但需核验。
- `review`：主要支付场景覆盖不足或高支付价占比偏高。
- `risk`：无有效组合、全部忽略或明显偏离经营目标。

评分不使用：

- 平均成本。
- 平均利润。
- 支付毛利率。
- 到手利润率。
- 负利润占比。

### 4.6 支付价核验

核验仍按真实活动叠加顺序计算：

1. 商品原价。
2. 命中商品折扣，得到商品折扣后金额。
3. 在商品折扣后金额基础上命中满减。
4. 在满减后金额基础上命中订单优惠券。
5. 命中平台基础神券/爆红包。
6. 扣除神券/爆红包加码。
7. 计算用户实付。
8. 计算商家到手价。
9. 标记到手价低于当前经营目标最低到手价的组合。
10. 聚合支付价区间。
11. 保存全量明细。

活动路线设计阶段不读取成本和利润率；支付价核验阶段需要展示成本、利润和利润率等多维指标，用于判断路线结果是否可接受，并重点标识支付价或到手价已经打穿成本的组合。

活动设计页的支付价核验区间表展示：

- 区间。
- 组合数。
- 忽略数。
- 平均原价。
- 平均支付价。
- 平均到手价。
- 平均成本。
- 平均利润。
- 最低利润。
- 最高利润。
- 平均利润率。
- 利润率范围。
- 平均利润空间。
- 到手风险数。
- 诊断。

组合明细展示：

- 商品组合。
- 状态。
- 原价。
- 用户实付。
- 商家到手。
- 成本。
- 利润。
- 支付毛利率。
- 到手利润率。
- 实付利润率。
- 利润空间。
- 活动金额。
- 满减。
- 优惠券。
- 神券/爆红包和加码。
- 到手边界。
- 异常原因。
- 商品折扣建议操作。

这些成本和利润率字段只用于支付价核验展示，不回流到活动路线生成、排序或评分。

### 4.7 商品折扣建议

商品折扣建议在页面层基于组合明细即时计算，不写入路线结果，也不影响活动路线生成。

输入来源：

- `measurementResult`：测算结果区间明细和商品相关组合明细。
- `activityValidation`：活动路线支付价核验明细。

基础筛选：

```text
baseRows = 非忽略组合
paymentGrossRate = (finalPay - cost) / finalPay
medianPaymentGrossRate = median(baseRows.paymentGrossRate)
```

高毛利离散组合识别：

```text
targetRate = max(row.targetPayRate, medianPaymentGrossRate)
targetGap = paymentGrossRate - targetRate
medianGap = paymentGrossRate - medianPaymentGrossRate

isHighProfit =
  row.profit > 0
  AND row.profitSpace > 0
  AND (
    targetGap >= 6%
    OR medianGap >= 8%
    OR (row.profitSpace >= 2 AND targetGap >= 3%)
  )
```

SKU 聚合：

```text
candidateProducts = highProfitRows.items.productId
affectedRows = baseRows 包含该 productId 的组合
highProfitComboCount = highProfitRows 包含该 productId 的组合数
affectedComboCount = affectedRows 数量
```

单件让利估算：

```text
avgExcessSpace = avg(max(0, finalPay * (paymentGrossRate - targetRate)))
avgProfitSpace = avg(max(0, row.profitSpace))
avgEligibleQty = avg(min(productQty, itemLimit))

rawAmount = min(
  productUnitPrice * 25%,
  5,
  max(0.2, avgExcessSpace * 55% / avgEligibleQty, avgProfitSpace * 35% / avgEligibleQty)
)
```

安全上限：

```text
safeByProfit = (row.profit - 0) / eligibleQty
safeByNetPay = (row.netPay - 2) / eligibleQty
safeByFinalPay = (row.finalPay - 2) / eligibleQty
safePerUnit = min(safeByProfit, safeByNetPay, safeByFinalPay)
discountAmountPerUnit = min(rawAmount, safePerUnit * 90%)
```

折扣率换算：

```text
discountRate = ceil((1 - discountAmountPerUnit / productUnitPrice) * 10, 0.1)
```

风险等级：

- `safe`：折后最低利润、最低到手价和最低支付价均满足边界。
- `watch`：未打穿边界，但折后最低利润或到手价贴近边界，需要人工复核。
- `blocked`：折后最低利润小于 0、最低到手价小于 2 元或最低支付价小于 2 元，禁止直接应用。

应用逻辑：

```text
DiscountActivity = {
  enabled: true,
  name: `折扣修正-${productName}`,
  productNames: productName,
  discountRate,
  itemLimit: 1
}
```

写入规则：

- 如果当前平台已存在 `productNames` 完全等于商品名，或名称等于 `折扣修正-商品名` 的折扣活动，则更新该活动。
- 否则将新折扣活动插入当前平台折扣活动列表顶部。
- 应用后清空旧测算、旧核验和旧路线状态，要求用户重新生成测算或重新核验。

## 5. UI 状态

活动设计页状态机：

```text
priceScan -> routeDesign -> payValidation
```

状态说明：

- `priceScan`：展示原价整数扫描、原价桶图表和原价桶列表。
- `routeDesign`：展示当前平台活动路线表格。
- `payValidation`：展示所选路线的支付价核验。

操作边界：

- “重新扫描”：重新生成原价扫描快照，并清空旧路线和旧核验。
- “生成活动路线”：基于当前扫描快照生成路线。
- “核验”：基于所选路线生成支付价核验结果。
- “应用”：覆盖当前门店当前平台满减和优惠券配置。
- “应用商品折扣”：新增或更新当前门店当前平台商品折扣活动，不覆盖满减、优惠券、红包、加码或商品售价。

平台 tab 使用 `destroyOnHidden`，避免双平台表格同时渲染造成卡顿。

商品折扣建议入口：

- 支付价核验明细：顶部显示聚合建议，组合明细行内显示当前组合的最佳折扣建议。
- 测算结果区间明细：顶部显示聚合建议，组合明细行内显示当前组合的最佳折扣建议。
- 测算结果商品明细：按当前商品过滤建议，便于直接修正该 SKU。

## 6. IndexedDB

本地对象仓库：

- `states`
- `measurement_results`
- `activity_price_scans`

`activity_price_scans` 保存：

```ts
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
```

当前 MVP 每个门店只保留最近一次签名一致的扫描快照。新扫描不得再向 `activity_price_scans` 写入原价组合分块记录；旧 `chunkKeys` 只允许在保存新记录后清理。

## 7. 后端迁移建议

后端化后建议拆表：

- `activity_strategy_settings`
- `activity_coupon_scene_templates`
- `store_activity_design_settings`
- `activity_price_scan_snapshots`
- `activity_scan_main_combos`
- `activity_scan_add_on_combos`
- `activity_price_bucket_rows`
- `activity_price_bucket_entries`
- `activity_route_packages`
- `activity_route_validation_rows`
- `activity_pay_band_rows`
- `product_discount_adjustment_logs`

### 7.1 activity_strategy_settings

保存系统默认经营目标和券场景引用。

关键字段：

- `id`
- `objective_templates`
- `objective_strategies`
- `platform_coupon_scene_keys`
- `created_at`
- `updated_at`

### 7.2 store_activity_design_settings

保存门店覆盖项。

关键字段：

- `store_id`
- `staple_max_count`
- `add_on_max_count`
- `red_add_on_space`
- `coupon_design_basis`
- `coupon_design_threshold_step`
- `coupon_design_amount_step`
- `coupon_design_max_full_amount`
- `coupon_design_max_coupon_amount`
- `objective_templates`
- `objective_strategies`
- `use_platform_coupon_scenes`
- `enabled_coupon_scene_keys`
- `design_mode`
- `objective`
- `original_band_size`
- `pay_band_size`

不需要保存活动设计专用的成本或利润率配置。

### 7.3 activity_price_scan_snapshots

关键字段：

- `id`
- `store_id`
- `signature`
- `settings_snapshot`
- `status`
- `generated_at`
- `bucket_count`
- `main_combo_count`
- `add_on_combo_count`

### 7.4 activity_scan_main_combos / activity_scan_add_on_combos

关键字段：

- `snapshot_id`
- `combo_id`
- `platform`
- `qtys`
- `price_cents`
- `total_qty`
- `staple_count`

### 7.5 activity_price_bucket_rows / activity_price_bucket_entries

桶行关键字段：

- `snapshot_id`
- `bucket_id`
- `platform`
- `price_bucket`
- `combo_count`
- `avg_original_total`
- `avg_final_pay`
- `avg_net_pay`
- `avg_activity_safe_discount_space`

桶 entry 关键字段：

- `bucket_id`
- `entry_id`
- `original_total_cents`
- `main_combo_ids`
- `add_on_combo_ids`
- `combo_count`

### 7.6 activity_route_packages

关键字段：

- `id`
- `snapshot_id`
- `store_id`
- `platform`
- `objective`
- `target_pay_min`
- `target_pay_max`
- `full_reduction_rules`
- `coupon_rules`
- `red_add_on_rules`
- `score`
- `score_breakdown`
- `diagnosis`
- `created_at`

### 7.7 activity_route_validation_rows

关键字段：

- `activity_route_id`
- `combo_key`
- `items_snapshot`
- `original_total`
- `final_pay`
- `net_pay`
- `cost_amount`
- `profit_amount`
- `payment_gross_rate`
- `final_pay_profit_rate`
- `net_pay_profit_rate`
- `profit_space`
- `activity_amount`
- `full_reduction_snapshot`
- `coupon_snapshot`
- `red_add_on_snapshot`
- `ignored`
- `ignore_reason`
- `risk_snapshot`

支付价核验明细需要保存成本、利润和利润率结果，用于和定价评估/测算结果做多维对比；这些字段不得反向影响活动路线生成和评分。

### 7.8 product_discount_adjustment_logs

商品折扣应用日志用于追踪二次修正来源。

关键字段：

- `id`
- `store_id`
- `platform`
- `source`
- `product_id`
- `product_name`
- `discount_rate`
- `discount_amount_per_unit`
- `item_limit`
- `affected_combo_count`
- `high_profit_combo_count`
- `avg_payment_gross_rate`
- `median_payment_gross_rate`
- `min_profit_after_discount`
- `min_net_pay_after_discount`
- `risk_level`
- `reason`
- `created_at`

当前本地 MVP 不单独建日志表，折扣活动直接保存在门店活动配置 `discountActivities` 中；后端化后可以补日志用于审计和回滚。
