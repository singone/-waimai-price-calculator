// 复用费用回归检查中的 TypeScript 加载器，同时运行原有费用测试。
require('./check-platform-fees.cjs');
const assert = require('node:assert/strict');
const { defaultState, normalizeState } = require('../src/data/calculatorState.ts');
const { parseBackendSnapshot, compareBackendSnapshot, applyBackendSnapshot, revertBackendSync } = require('../src/domain/backendSync.ts');
const { importBackendTable } = require('../src/domain/backendTableImport.ts');
const { buildFeeSummary, bestBaseRed } = require('../src/domain/core.ts');

const state = JSON.parse(JSON.stringify(defaultState));
const store = state.stores[0];
store.name = '弘金饭团（钱江世纪城店）';
store.deliveryDistance = 3;
store.products = [{ id: 'rice', name: '饭团', merchantProductCode: '001', price: 20, cost: 5, packageFee: 1,
  meituanPrice: '', elemePrice: '', jingdongPrice: '', meituanPackageFee: '', elemePackageFee: '', jingdongPackageFee: '',
  meituanEnabled: true, elemeEnabled: true, jingdongEnabled: true, category: 'staple', stapleServingCount: 1, nonStandalone: false }];
const raw = { version: 1, platform: 'eleme', storeName: store.name, observedAt: new Date().toISOString(), source: '平台消息 → 减配活动',
  unsupportedRules: [], items: [
    { kind: 'fee', field: 'freightWithin3', value: 3.2 },
    { kind: 'product', field: 'price', productCode: '001', value: 22 },
    { kind: 'redTiers', field: 'redTiers', value: [{ enabled: true, threshold: 15, min: 1, max: 1 }] }
  ] };
const snapshot = parseBackendSnapshot(raw);
const preview = compareBackendSnapshot(state, store, snapshot);
assert.equal(preview.filter(row => row.status === 'change').length, 3);
const updated = applyBackendSnapshot(state, store.id, snapshot, preview.map(row => row.key), preview);
const changedStore = updated.stores[0];
assert.equal(buildFeeSummary(updated, changedStore, 20, 'eleme').freightSubsidy, 3.2);
assert.equal(buildFeeSummary(updated, changedStore, 20, 'meituan').freightSubsidy, state.platformRules.freightWithin3);
assert.equal(changedStore.products[0].elemePrice, 22);
assert.equal(changedStore.products[0].cost, 5);
assert.equal(changedStore.products[0].meituanPrice, '');
assert.equal(bestBaseRed(updated, 'eleme', 20, changedStore).amount, 1);
assert.equal(normalizeState(updated).stores[0].backendSyncHistory.length, 1);
const reverted = revertBackendSync(updated, store.id, changedStore.backendSyncHistory[0].id);
assert.equal(reverted.stores[0].products[0].elemePrice, '');
assert.equal(buildFeeSummary(reverted, reverted.stores[0], 20, 'eleme').freightSubsidy, state.platformRules.freightWithin3);
assert.equal(bestBaseRed(reverted, 'eleme', 20, reverted.stores[0]).amount, bestBaseRed(state, 'eleme', 20, store).amount);
assert.ok(reverted.stores[0].backendSyncHistory[0].revertedAt);
assert.throws(() => revertBackendSync(reverted, store.id, changedStore.backendSyncHistory[0].id));
const edited = JSON.parse(JSON.stringify(updated)); edited.stores[0].products[0].elemePrice = 23;
assert.throws(() => revertBackendSync(edited, store.id, changedStore.backendSyncHistory[0].id), /又被修改/);
const concurrent = JSON.parse(JSON.stringify(state)); concurrent.stores[0].products[0].elemePrice = 21;
assert.throws(() => applyBackendSnapshot(concurrent, store.id, snapshot, preview.map(row => row.key), preview), /发生变化/);
const mismatched = parseBackendSnapshot({ ...raw, storeName: '井弘饭团' });
assert.ok(compareBackendSnapshot(state, store, mismatched).every(row => row.status === 'blocked'));
const special = parseBackendSnapshot({ ...raw, unsupportedRules: ['折扣商品与满减互斥'] });
assert.ok(compareBackendSnapshot(state, store, special).every(row => row.status === 'blocked'));
const duplicates = parseBackendSnapshot({ ...raw, items: [raw.items[0], raw.items[0]] });
assert.ok(compareBackendSnapshot(state, store, duplicates).every(row => row.status === 'blocked'));
assert.throws(() => parseBackendSnapshot({ ...raw, items: [{ kind: 'fee', field: 'commissionRate', value: '' }] }), /空白/);
assert.throws(() => parseBackendSnapshot({ ...raw, source: 'https://example.com/?token=secret' }), /凭证/);
const imported = importBackendTable([{ 商品名称: '饭团', 商家商品编码: '001', 售价: '22', 包装费: '', 上架状态: '下架' }]);
assert.equal(imported.items.length, 2);
assert.equal(imported.items[1].value, false);
assert.equal(importBackendTable([{ 类别: '费用', 项目: '佣金率（%）', 后台值: '' }]).items.length, 0);
assert.throws(() => parseBackendSnapshot({ ...raw, items: [{ kind: 'activity', field: 'jingdongSubsidyCoupons', value: [] }] }), /只能同步到京东/);
console.log('后台同步：差异核对、范围隔离、商品成本保留、红包实际生效、保存兼容、撤回冲突、重复项目及空值校验：通过');
