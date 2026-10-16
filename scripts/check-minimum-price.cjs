// 以最低实付和对应承担验证跨档选券，复用现有 TypeScript 加载器。
require('./check-platform-fees.cjs');
const assert = require('node:assert/strict');
const { defaultState, normalizeState, createDefaultJingdongSubsidyCoupons, appendMissingJingdongReferenceCoupons } = require('../src/data/calculatorState.ts');
const { bestCouponOption, evaluateComboWithCurrentActivities } = require('../src/domain/core.ts');
const { bestJingdongStoreCouponOption, buildEligibleJingdongCouponSelections, jingdongCouponEffectiveAmount, jingdongCouponEffectiveMerchantAmount } = require('../src/domain/jingdongSubsidyAnalysis.ts');

const defaults = createDefaultJingdongSubsidyCoupons();
assert.equal(defaults.find(row => row.name === '散店9月金秋券40-12').threshold, 40);
assert.equal(defaults.find(row => row.name === '冲刺券满0.01减3').threshold, 0.01);
assert.ok(defaults.some(row => row.threshold === 109 && row.merchantAmount === 25 && row.platformAmount === 2 && !row.enabled));
assert.ok(defaults.some(row => row.threshold === 90 && row.merchantAmount === 20 && row.platformAmount === 2 && !row.enabled));
assert.ok(defaults.some(row => row.threshold === 128 && row.merchantAmount === 30 && row.platformAmount === 2 && !row.enabled));
assert.ok(defaults.some(row => row.threshold === 8 && row.merchantAmount === 3.5 && row.platformAmount === 1.5 && !row.enabled));
const oldRows = defaults.filter(row => row.enabled).map(row => ({ ...row, merchantExtraAmount: row.kind === 'large' ? 3 : 0 }));
const supplemented = appendMissingJingdongReferenceCoupons(oldRows);
assert.equal(supplemented.length, oldRows.length + 4);
assert.deepEqual(supplemented.slice(0, oldRows.length), oldRows, '补参考项不覆盖已有配置和加码');
assert.ok(supplemented.slice(oldRows.length).every(row => !row.enabled));
assert.deepEqual(appendMissingJingdongReferenceCoupons(supplemented), supplemented, '反复补齐不重复添加');

const coupon = (name, amount, stackableWithCoupons = false) => ({ enabled: true, name, threshold: 0, amount, stackableWithCoupons });
const state = JSON.parse(JSON.stringify(defaultState));
const store = state.stores[0];
store.startPrice = 0;
store.calculationMin = 0;
store.maxCoupons = 1;
store.products = [{ id: 'rice', name: '饭团', category: 'staple', stapleServingCount: 1, nonStandalone: false,
  price: 30, cost: 5, packageFee: 0, meituanPrice: '', elemePrice: '', jingdongPrice: '',
  meituanPackageFee: '', elemePackageFee: '', jingdongPackageFee: '', meituanEnabled: true, elemeEnabled: true, jingdongEnabled: true }];
const empty = { fullReductions: [], coupons: [], redAddOns: [], discountActivities: [], jingdongSubsidyCoupons: [] };
const settings = { payMin: 0, payMax: '', ignoreOutOfPayRange: false };
for (const platform of ['meituan', 'eleme']) {
  store.activities[platform] = { ...empty, coupons: [coupon('大券', 5), coupon('小券', 2)] };
  store.platformFeeOverrides = { [platform]: { redTiers: { [platform]: [{ enabled: true, threshold: 28, min: 10, max: 10 }] } } };
  let [row] = evaluateComboWithCurrentActivities(state, store, platform, [1], settings);
  assert.ok(row);
  assert.equal(row.finalPay, 18, '小券2＋红包10比大券5更便宜');
  assert.equal(row.couponAmount, 2);
  assert.equal(row.baseRed.amount, 10);
  assert.equal(row.profit, Math.round((row.netPay - row.cost) * 100) / 100);

  store.activities[platform].coupons = [coupon('大券', 5)];
  store.platformFeeOverrides[platform].redTiers[platform] = [{ enabled: true, threshold: 30, min: 10, max: 10 }];
  [row] = evaluateComboWithCurrentActivities(state, store, platform, [1], settings);
  assert.equal(row.finalPay, 20, '不使用订单券也要参与最低价比较');
  assert.equal(row.couponAmount, 0);

  store.platformFeeOverrides[platform].redTiers[platform] = [];
  store.activities[platform] = { ...empty, coupons: [coupon('大券', 5), coupon('小券', 2)], redAddOns: [{ enabled: true, threshold: 28, amount: 10 }] };
  [row] = evaluateComboWithCurrentActivities(state, store, platform, [1], settings);
  assert.equal(row.finalPay, 18, '红包加码跨档同样按最终实付选券');
  assert.equal(row.couponAmount, 2);
  assert.equal(row.redAddOn.amount, 10);
}
const options = [coupon('互斥大券', 10), coupon('叠加券A', 8, true), coupon('叠加券B', 7, true)];
assert.equal(bestCouponOption(options, 30, 2, amount => 30 - amount).amount, 15);
assert.equal(bestCouponOption(options, 30, 1, amount => 30 - amount).amount, 10);
assert.equal(bestCouponOption(options, 30, 0, amount => 30 - amount).amount, 0);

const jd = (threshold, amount, merchantAmount, platformAmount, extra = 0, kind = 'large', stack = false) => ({
  enabled: true, name: `券${threshold}-${amount}-${merchantAmount}`, kind, threshold, amount, merchantAmount, platformAmount, merchantExtraAmount: extra, stackableWithLarge: stack
});
for (const [threshold, amount, merchant, platform, extra] of [[109,27,25,2,4],[40,12,10,2,3],[60,18,16,2,2],[90,22,20,2,2],[128,32,30,2,2],[15,10,7.5,2.5,1]]) {
  const row = jd(threshold, amount, merchant, platform, extra);
  assert.equal(jingdongCouponEffectiveAmount(row), amount + extra);
  assert.equal(jingdongCouponEffectiveMerchantAmount(row), merchant + extra);
  const saved = JSON.parse(JSON.stringify(state));
  saved.stores[0].activities.jingdong.jingdongSubsidyCoupons = [row];
  assert.equal(normalizeState(saved).stores[0].activities.jingdong.jingdongSubsidyCoupons[0].merchantExtraAmount, extra);
}
const large = jd(40, 12, 10, 2, 3);
store.activities.jingdong = { ...empty, coupons: [coupon('大券', 5), coupon('小券', 2)], jingdongSubsidyCoupons: [jd(28, 10, 8, 2)] };
assert.equal(bestJingdongStoreCouponOption(store, 30, 30).amount, 2, '京东店铺券不能挤掉更大的平台补贴券');
store.activities.jingdong.jingdongSubsidyCoupons = [jd(30, 20, 15, 5)];
assert.equal(bestJingdongStoreCouponOption(store, 30, 30).amount, 0, '京东不用店铺券时更便宜');
const small = jd(0.01, 3, 1.5, 1.5, 0, 'small', true);
assert.equal(buildEligibleJingdongCouponSelections([small], 0).length, 0);
assert.equal(buildEligibleJingdongCouponSelections([small], 0.01)[0].amount, 3);
assert.ok(!buildEligibleJingdongCouponSelections([large, small], 39.99).some(row => row.largeCoupon));
const [best] = buildEligibleJingdongCouponSelections([large, small], 40);
assert.equal(best.amount, 18);
assert.equal(best.merchantAmount, 14.5);
assert.equal(best.platformAmount, 3.5);
assert.equal(best.amount, best.merchantAmount + best.platformAmount);
assert.ok(buildEligibleJingdongCouponSelections([large, { ...small, stackableWithLarge: false }], 40).every(row => row.coupons.length === 1));
console.log('最低价：跨红包门槛择券、不用券候选、互斥与张数、京东最大加码与分摊、保存往返及门槛边界：通过');
