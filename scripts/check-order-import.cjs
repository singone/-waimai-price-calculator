// 验证订单导入、有效订单筛选、持久化恢复和平台汇总。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const XLSX = require('xlsx');
require.extensions['.ts'] = (module, filename) => {
  module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText, filename);
};
const { parseOrderWorkbook, normalizeOrderAnalysisState, aggregateOrdersByPlatform, aggregateOrdersByPlatformPayBand, enrichOrderRecords, orderMerchantReceivable, summarizeOrderRecords, summarizeOrderProfit } = require('../src/domain/orderAnalysis.ts');
function workbook(rows) {
  const value = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(value, XLSX.utils.aoa_to_sheet(rows), '数据');
  return value;
}
const header = ['日期', '门店名称', '门店id', '订单编号', '下单时间', '完成时间', '商品信息', '配送类型', '顾客实付', '商品原价', '配送费', '包装费', '活动补贴', '商家活动支出', '是否商责取消'];
const row = ['2026-09-08', '测试门店', 123, '3615467007861798   ', '2026-09-08 17:06:23', '2026-09-08 17:17:41', '饭团 默认,26.9000,2/配菜,0.0100,1', '到店自提', 12.9, 53.81, 3, 1, 17.7, 13.7, '否'];
const canceled = [...row]; canceled[3] = 'canceled'; canceled[14] = '是';
const incomplete = [...row]; incomplete[3] = 'incomplete'; incomplete[5] = '';
const parsed = parseOrderWorkbook(workbook([['导出订单'], header, row, canceled, incomplete]), '京东.xlsx');
assert.equal(parsed.platform, 'jingdong');
assert.equal(parsed.records.length, 1);
assert.equal(parsed.skippedRows, 2);
const record = parsed.records[0];
assert.equal(record.orderId, '3615467007861798');
assert.equal(record.orderHour, 17);
assert.equal(record.isPickup, true);
assert.equal(record.productCount, 3);
assert.deepEqual(record.productItems, [{ name: '饭团 默认', unitPrice: 26.9, quantity: 2 }, { name: '配菜', unitPrice: 0.01, quantity: 1 }]);
assert.equal(record.platformSubsidy, 4);
assert.equal(orderMerchantReceivable(record), 16.9);
assert.equal(orderMerchantReceivable({ customerPay: 2.9, platformSubsidy: 14 }), 16.9);
assert.equal(orderMerchantReceivable({ customerPay: 12.9, platformSubsidy: 0 }), 12.9);
assert.equal(record.grossOriginal, 54.81);
assert.equal(record.orderOriginal, 57.81);
assert.equal(record.activityFlags.fullReduction, false);
assert.ok(parsed.warnings.some(value => value.includes('未提供活动明细')));
const restored = normalizeOrderAnalysisState(JSON.parse(JSON.stringify({ records: parsed.records, imports: [{ platform: 'jingdong' }] })));
assert.equal(restored.records.length, 1);
assert.equal(restored.imports[0].platform, 'jingdong');
assert.equal(summarizeOrderRecords(restored.records).avgMerchantReceivable, 16.9);
const costed = enrichOrderRecords(restored.records, [{ name: '饭团 默认', cost: 5 }, { name: '配菜', cost: 1 }]);
assert.equal(costed[0].estimatedProfit, 5.9);
assert.equal(costed[0].estimatedProfitRate, 5.9 / 16.9);
assert.equal(summarizeOrderProfit(costed).estimatedProfitRate, 5.9 / 16.9);
assert.equal(enrichOrderRecords([{ ...restored.records[0], productItems: [] }], [])[0].estimatedProfit, null);
assert.equal(aggregateOrdersByPlatform(restored.records)[0].platform, 'jingdong');
assert.equal(aggregateOrdersByPlatformPayBand(enrichOrderRecords(restored.records, []))[0].platform, 'jingdong');
for (const [platform, columns, values] of [
  ['meituan', ['订单编号', '订单实付', '商品原价', '订单状态'], ['mt', 12, 20, '已完成']],
  ['eleme', ['订单单号', '顾客实付', '订单原价', '订单状态'], ['el', 12, 20, '订单完结']]
]) {
  const result = parseOrderWorkbook(workbook([['下单时间', '商品信息', ...columns], ['2026-09-08 12:00:00', '', ...values]]), '旧平台.xlsx');
  assert.equal(result.platform, platform);
  assert.equal(result.records.length, 1);
}
if (process.argv[2]) {
  const source = XLSX.readFile(process.argv[2]);
  const result = parseOrderWorkbook(source, '京东真实订单.xlsx');
  assert.equal(result.platform, 'jingdong');
  const sourceRows = XLSX.utils.sheet_to_json(source.Sheets[source.SheetNames[0]]);
  const validRows = sourceRows.filter(value => value['完成时间'] && value['是否商责取消'] !== '是');
  assert.equal(result.records.length, validRows.length);
  assert.equal(result.skippedRows, sourceRows.length - validRows.length);
  assert.ok(result.records.every(value => value.productItems.length > 0));
  for (const [field, column] of [['customerPay', '顾客实付'], ['totalSubsidy', '活动补贴'], ['merchantSubsidy', '商家活动支出']]) {
    assert.equal(Math.round(result.records.reduce((sum, value) => sum + value[field], 0) * 100), Math.round(validRows.reduce((sum, value) => sum + Number(value[column]), 0) * 100));
  }
  console.log(`真实京东文件：有效 ${result.records.length} 单，跳过 ${result.skippedRows} 单，金额核对通过。`);
}
console.log('订单导入：京东解析、取消筛选、商品数量、补贴、保存恢复、平台汇总及美团/饿了么兼容检查通过。');
