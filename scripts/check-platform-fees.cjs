// 用真实结算场景验证平台隔离、减配承担和旧配置兼容，不依赖额外测试库。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => {
  const source = fs.readFileSync(filename, 'utf8');
  module._compile(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, filename);
};
const { buildFeeSummary, calculateServiceFee, effectiveFeeRule } = require('../src/domain/core.ts');
const rule = {
  commissionRate: 4.8, minCommission: 0.96, baseDeliveryFee: 2.7,
  extraDeliveryFee: 0.05, midPriceRate: 0.13, highPriceRate: 0.15,
  freightWithin3: 2.7, freightWithin5: 4, freightAbove5: 5,
  profitTargets: [], pricingStrategy: {}, redTiers: {}, pricingEvaluation: {}
};
const store = {
  id: 'hongjin', usePlatformFee: true, customFeeRule: null,
  deliveryDistance: 3, orderTime: '12:00',
  platformFeeOverrides: {
    eleme: { commissionRate: 2, minCommission: 0, baseDeliveryFee: 1,
      freightWithin3: 3.2, freightWithin5: 3.2, freightAbove5: 3.2, timeFeeOverride: 0 },
    jingdong: { commissionRate: 0, minCommission: 0, baseDeliveryFee: 2,
      freightWithin3: 0, timeFeeOverride: 0 }
  }
};
const state = { platformRules: rule, stores: [store], selectedStoreId: store.id };
assert.deepEqual(buildFeeSummary(state, store, 20, 'eleme'), { commission: 0.4, serviceFee: 1, freightSubsidy: 3.2 });
assert.deepEqual(buildFeeSummary(state, store, 20, 'jingdong'), { commission: 0, serviceFee: 2, freightSubsidy: 0 });
assert.deepEqual(buildFeeSummary(state, store, 20, 'meituan'), { commission: 0.96, serviceFee: 2.7, freightSubsidy: 2.7 });
assert.deepEqual(buildFeeSummary(state, { ...store, platformFeeOverrides: undefined }, 20, 'eleme'), buildFeeSummary(state, store, 20));
const otherStore = { ...store, id: 'jinghong', platformFeeOverrides: undefined };
assert.equal(buildFeeSummary(state, otherStore, 20, 'eleme').freightSubsidy, 2.7);
assert.equal(buildFeeSummary(state, { ...store, deliveryDistance: 6 }, 20, 'eleme').freightSubsidy, 3.2);
assert.equal(calculateServiceFee(effectiveFeeRule(state, store, 'eleme'), { ...store, orderTime: '03:00' }, 20), 1);
assert.equal(calculateServiceFee(rule, { ...store, deliveryDistance: 3.1 }, 25), 3.4);
assert.equal(state.platformRules.freightWithin3, 2.7);
console.log('平台隔离、跨门店隔离、弘金减配分摊、旧配置兼容、时段覆盖、距离与金额边界：通过');

const { runPricingEvaluationCalculation } = require('../src/domain/pricing/pricingEvaluation.ts');
async function checkPricing() {
  const pricingSettings = {
    productNameKeyword: '', originalMin: 0, originalMax: '', enabledPlanKeys: ['balanced'],
    stapleTargetCostShare: 40, setMealTargetCostShare: 40, addOnTargetCostShare: 40,
    addOnStapleRatioShare: 40, addOnMinimumOriginalPrice: 1, addOnPromotionRiskShare: 0,
    setMealDiscountRate: 100, fixedActivityCost: 0, baseRedAmountMode: 'min'
  };
  const product = {
    id: 'rice', name: '饭团', category: 'staple', stapleServingCount: 1,
    cost: 5, price: 20, packageFee: 0, meituanPackageFee: '', elemePackageFee: '', jingdongPackageFee: ''
  };
  const emptyActivities = { fullReductions: [], coupons: [], redAddOns: [], discountActivities: [] };
  const pricingStore = { ...store, products: [product], activities: { meituan: emptyActivities, eleme: emptyActivities, jingdong: emptyActivities } };
  const pricingState = { ...state, stores: [pricingStore], platformRules: { ...rule, pricingEvaluation: { ...pricingSettings, fallbackTargetCostShare: 40 } } };
  const result = await runPricingEvaluationCalculation(pricingState, 'eleme', pricingSettings);
  const row = result.productRows[0];
  assert.ok(row, '应生成饭团定价评估');
  assert.equal(row.finalPay, 20, '商家减配成本不应减少商品实付');
  assert.equal(row.commission, 0.4, '佣金按未混入配送补贴的商品实付计');
  assert.equal(row.netRevenue, 15.4, '20 - 0.4 佣金 - 1 履约 - 3.2 商家减配');
  assert.equal(row.currentProfit, 10.4, '到手收入再扣 5 元商品成本');
  console.log('定价评估实付、到手收入及利润口径：通过');
}
checkPricing().catch(error => { console.error(error); process.exitCode = 1; });
