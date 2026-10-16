'use client';

import * as XLSX from 'xlsx';
import { roundMoney } from '../../domain/money';
import type { Product, ProductCategory } from '../../domain/types';
import { readImportWorkbook } from '../../utils/importWorkbook';
import { money, rateText } from '../../utils/format';

const DB_NAME = 'waimai-price-calculator';
const PRODUCT_ANALYSIS_STORE = 'product_analysis';
const DEFAULT_KEY = 'default';

type ProductMetricField =
  | 'salesAmount'
  | 'quantity'
  | 'orderUsers'
  | 'broughtOrders'
  | 'orderTransactionAmount'
  | 'repeatUsers30d'
  | 'exposureUsers'
  | 'clickUsers'
  | 'addCartUsers'
  | 'likes';

const PRODUCT_METRIC_FIELDS: ProductMetricField[] = [
  'salesAmount',
  'quantity',
  'orderUsers',
  'broughtOrders',
  'orderTransactionAmount',
  'repeatUsers30d',
  'exposureUsers',
  'clickUsers',
  'addCartUsers',
  'likes'
];

const PRODUCT_CATEGORY_NAMES: Record<ProductCategory, string> = {
  staple: '主食',
  snackDrink: '小吃饮料',
  addOn: '加料',
  setMeal: '套餐',
  other: '其他'
};

export type ProductAnalysisReliability = 'high' | 'medium' | 'low';
export type ProductAnalysisSourceGrain = 'daily' | 'range';
export type ProductAnalysisPeriodGrain = 'source' | 'week' | 'month';

export type ProductAnalysisSegment =
  | 'hero'
  | 'wastedExposure'
  | 'interestConversionGap'
  | 'lowExposurePotential'
  | 'cartValue'
  | 'soldOutOpportunity'
  | 'ingredient'
  | 'longTail'
  | 'stable';

export type ProductAnalysisRecord = {
  key: string;
  storeId: string;
  storeName: string;
  dateStart: string;
  dateEnd: string;
  periodLabel: string;
  sourceGrain: ProductAnalysisSourceGrain;
  cityName: string;
  externalStoreName: string;
  externalStoreId: string;
  productName: string;
  productKey: string;
  isNewProduct: boolean;
  isSignature: boolean;
  isSetMeal: boolean;
  isIngredient: boolean;
  isSoldOut: boolean;
  salesAmount: number;
  quantity: number;
  orderUsers: number;
  broughtOrders: number;
  orderTransactionAmount: number;
  repeatUsers30d: number;
  repeatRate30d: number | null;
  exposureUsers: number;
  clickUsers: number;
  addCartUsers: number;
  likes: number;
  sourceFileName: string;
  importBatchId: string;
  importedAt: string;
  warnings: string[];
};

export type ProductAnalysisImportBatch = {
  id: string;
  storeId: string;
  storeName: string;
  fileName: string;
  importedAt: string;
  dateStart: string;
  dateEnd: string;
  rowCount: number;
  replacedRecords: number;
  sheetName: string;
  warnings: string[];
};

export type ProductAnalysisState = {
  records: ProductAnalysisRecord[];
  imports: ProductAnalysisImportBatch[];
};

export type ProductAnalysisSummary = {
  dateStart: string;
  dateEnd: string;
  periodCount: number;
  productCount: number;
  salesAmount: number;
  quantity: number;
  orderUsers: number;
  broughtOrders: number;
  orderTransactionAmount: number;
  repeatUsers30d: number;
  repeatRate30d: number | null;
  exposureUsers: number;
  clickUsers: number;
  addCartUsers: number;
  likes: number;
  newProductCount: number;
  signatureProductCount: number;
  setMealProductCount: number;
  ingredientProductCount: number;
  soldOutProductCount: number;
  clickRate: number | null;
  addCartRate: number | null;
  clickToCartRate: number | null;
  cartToOrderRate: number | null;
  exposureToOrderRate: number | null;
  ordersPerThousandExposure: number | null;
  gmvPerThousandExposure: number | null;
  salesPerThousandExposure: number | null;
  gmvPerCart: number | null;
  salesPerUnit: number | null;
};

export type ProductAnalysisProductRow = ProductAnalysisSummary & {
  key: string;
  productName: string;
  productKey: string;
  isNewProduct: boolean;
  isSignature: boolean;
  isSetMeal: boolean;
  isIngredient: boolean;
  isSoldOut: boolean;
  categoryName: string;
  matchedProductName: string;
  productCost: number | null;
  estimatedGrossProfit: number | null;
  estimatedGrossProfitRate: number | null;
  exposureValueScore: number;
  interestScore: number;
  cartValueScore: number;
  opportunityScore: number;
  reliability: ProductAnalysisReliability;
  segment: ProductAnalysisSegment;
  segmentText: string;
  advice: string;
};

export type ProductAnalysisPeriodRow = ProductAnalysisSummary & {
  key: string;
  periodLabel: string;
  topProductName: string;
  topProductOrders: number;
};

export type ProductAnalysisTrendRow = {
  key: string;
  periodLabel: string;
  dateStart: string;
  dateEnd: string;
  productName: string;
  productKey: string;
  exposureUsers: number;
  addCartUsers: number;
  broughtOrders: number;
  orderTransactionAmount: number;
  repeatRate30d: number | null;
  clickRate: number | null;
  addCartRate: number | null;
  cartToOrderRate: number | null;
  gmvPerThousandExposure: number | null;
};

export type ParsedProductAnalysisWorkbook = {
  sheetName: string;
  records: Array<Omit<ProductAnalysisRecord, 'key' | 'storeId' | 'storeName' | 'sourceFileName' | 'importBatchId' | 'importedAt'>>;
  warnings: string[];
};

type ProductAnalysisRecordSource = Partial<ProductAnalysisRecord>;

type ProductAnalysisRecordGroup = {
  rows: ProductAnalysisRecord[];
  displayName: string;
};

type ImportProductAnalysisInput = {
  file: File;
  currentState: ProductAnalysisState;
  storeId: string;
  storeName: string;
};

type ImportProductAnalysisResult = {
  state: ProductAnalysisState;
  importedCount: number;
  replacedRecords: number;
  dateStart: string;
  dateEnd: string;
  warnings: string[];
};

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toNumber(value: unknown, fallback = 0) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  const text = String(value ?? '')
    .trim()
    .replace(/[¥￥元,%]/g, '')
    .replace(/,/g, '');
  if (!text) return fallback;
  const n = Number(text);
  return Number.isFinite(n) ? n : fallback;
}

function toMoneyNumber(value: unknown, fallback = 0) {
  return roundMoney(toNumber(value, fallback));
}

function toInteger(value: unknown, fallback = 0) {
  return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function toRate(value: unknown, fallback: number | null = null) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return fallback;
  const parsed = toNumber(text, Number.NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return text.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

function parseBooleanText(value: unknown, fallback = false) {
  const text = String(value ?? '').trim();
  if (!text) return fallback;
  if (/^(是|有|true|1|yes|y)$/i.test(text)) return true;
  if (/^(否|无|false|0|no|n)$/i.test(text)) return false;
  return fallback;
}

function normalizeImportHeader(value: unknown) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .toLowerCase();
}

function findImportColumnIndex(row: unknown[], candidates: string[]) {
  const cells = row.map(normalizeImportHeader);
  const normalizedCandidates = candidates.map(normalizeImportHeader);
  for (const candidate of normalizedCandidates) {
    const exactIndex = cells.indexOf(candidate);
    if (exactIndex >= 0) return exactIndex;
  }
  for (const candidate of normalizedCandidates) {
    const partialIndex = cells.findIndex(cell => cell.includes(candidate));
    if (partialIndex >= 0) return partialIndex;
  }
  return -1;
}

function rowHasText(row: unknown[]) {
  return Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '');
}

function textCell(row: unknown[], index: number) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

function metricNumber(row: unknown[], index: number) {
  return index >= 0 ? toMoneyNumber(row[index], 0) : 0;
}

function metricInteger(row: unknown[], index: number) {
  return index >= 0 ? toInteger(row[index], 0) : 0;
}

export function normalizeProductAnalysisDate(value: unknown) {
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

export function normalizeProductAnalysisDateRange(startText: string, endText: string) {
  const start = normalizeProductAnalysisDate(startText);
  const end = normalizeProductAnalysisDate(endText);
  if (!start && !end) return { dateStart: '', dateEnd: '' };
  if (!start) return { dateStart: end, dateEnd: end };
  if (!end) return { dateStart: start, dateEnd: start };
  return start <= end ? { dateStart: start, dateEnd: end } : { dateStart: end, dateEnd: start };
}

export function parseProductAnalysisDateRange(value: unknown) {
  const text = String(value ?? '').trim();
  const dates = text.match(/\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2}/g) || [];
  if (dates.length >= 2) return normalizeProductAnalysisDateRange(dates[0] || '', dates[1] || '');
  const date = normalizeProductAnalysisDate(value);
  return { dateStart: date, dateEnd: date };
}

export function productAnalysisDateRangeText(start: string, end: string) {
  if (start && end && start !== end) return `${start} 至 ${end}`;
  return start || end || '全部日期';
}

export function productAnalysisUtcDate(dateText: string) {
  const normalized = normalizeProductAnalysisDate(dateText);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function productAnalysisDateFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function productAnalysisAddDays(dateText: string, days: number) {
  const date = productAnalysisUtcDate(dateText);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return productAnalysisDateFromUtc(date);
}

export function productAnalysisDateSpanDays(startText: string, endText: string) {
  const start = productAnalysisUtcDate(startText);
  const end = productAnalysisUtcDate(endText);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

export function productAnalysisWeekStart(dateText: string) {
  const date = productAnalysisUtcDate(dateText);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return productAnalysisDateFromUtc(date);
}

export function productAnalysisWeekEnd(weekStart: string) {
  return productAnalysisAddDays(weekStart, 6);
}

export function productAnalysisMonthStart(dateText: string) {
  const normalized = normalizeProductAnalysisDate(dateText);
  if (!normalized) return '';
  return `${normalized.slice(0, 7)}-01`;
}

export function productAnalysisMonthEnd(monthStart: string) {
  const date = productAnalysisUtcDate(monthStart);
  if (!date) return '';
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return productAnalysisDateFromUtc(date);
}

function periodBoundsForRecord(row: Pick<ProductAnalysisRecord, 'dateStart' | 'dateEnd' | 'sourceGrain'>, grain: ProductAnalysisPeriodGrain) {
  if (grain === 'source' || row.sourceGrain !== 'daily') {
    return { dateStart: row.dateStart, dateEnd: row.dateEnd };
  }
  if (grain === 'week') {
    const weekStart = productAnalysisWeekStart(row.dateStart);
    return { dateStart: weekStart, dateEnd: productAnalysisWeekEnd(weekStart) };
  }
  const monthStart = productAnalysisMonthStart(row.dateStart);
  return { dateStart: monthStart, dateEnd: productAnalysisMonthEnd(monthStart) };
}

export function normalizeProductAnalysisName(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function normalizeProductAnalysisGroupName(value: unknown) {
  const baseName = String(value ?? '').split(/[｜|]/)[0] || value;
  return String(baseName)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(【［\[].*?[）)】］\]]/g, '')
    .replace(/美团|饿了么|外卖|专享|平台|热销|爆款|招牌|推荐|新品|限时|活动|折扣/g, '')
    .replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

function productAnalysisDisplayName(value: unknown) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  const baseName = text.split(/[｜|]/)[0]?.trim();
  return baseName || text || '未命名商品';
}

function inferCategoryName(name: string, isIngredient: boolean, isSetMeal = false) {
  const text = normalizeProductAnalysisName(name);
  if (isIngredient || /不要|加料|加购|小料|配菜|蘸料|调料|增量|\d+\s*g/.test(text)) return '加料/选项';
  if (isSetMeal) return '套餐';
  if (/套餐|单人|双人|多人|餐|组合|任选/.test(text)) return '套餐';
  if (/饭团|主食/.test(text)) return '主食';
  if (/饮|奶|茶|豆乳|豆浆|可乐|雪碧|水|果汁|咖啡|ad钙奶/.test(text)) return '小吃饮料';
  return '其他';
}

function findMatchedProduct(products: Product[], name: string) {
  const groupName = normalizeProductAnalysisGroupName(name);
  const exact = products.find(product => normalizeProductAnalysisGroupName(product.name) === groupName);
  if (exact) return exact;
  const normalized = normalizeProductAnalysisName(name);
  return products.find(product => normalizeProductAnalysisName(product.name) === normalized) || null;
}

function safeRate(numerator: number, denominator: number): number | null {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

function clampScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function relativeScore(value: number | null, benchmark: number | null) {
  if (value === null || benchmark === null || !Number.isFinite(value) || !Number.isFinite(benchmark) || benchmark <= 0) {
    return 0;
  }
  return clampScore(value / benchmark * 50);
}

function weightedScore(items: Array<{ score: number; weight: number }>) {
  const weight = items.reduce((sum, item) => sum + item.weight, 0);
  if (weight <= 0) return 0;
  return clampScore(items.reduce((sum, item) => sum + item.score * item.weight, 0) / weight);
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reliabilityFor(row: ProductAnalysisSummary): ProductAnalysisReliability {
  if (row.exposureUsers >= 500 && (row.clickUsers >= 20 || row.broughtOrders >= 10)) return 'high';
  if (row.exposureUsers >= 100 && (row.clickUsers >= 5 || row.addCartUsers >= 5 || row.broughtOrders >= 2)) return 'medium';
  return 'low';
}

function segmentText(segment: ProductAnalysisSegment) {
  return {
    hero: '主推放量',
    wastedExposure: '曝光浪费',
    interestConversionGap: '兴趣强转化弱',
    lowExposurePotential: '低曝光潜力',
    cartValue: '加购强成交好',
    soldOutOpportunity: '售罄影响',
    ingredient: '配料/选项',
    longTail: '长尾观察',
    stable: '稳定观察'
  }[segment];
}

function segmentAdvice(segment: ProductAnalysisSegment, row: Pick<ProductAnalysisProductRow, 'productName' | 'reliability'>) {
  const lowSamplePrefix = row.reliability === 'low' ? '样本偏少，先补足曝光或延长观察期。' : '';
  const advice = {
    hero: '保持主图、排序和活动资源，优先作为套餐锚点或首页主推商品。',
    wastedExposure: '降低无效曝光占位，优先检查商品图、价格、标题利益点和缺货状态。',
    interestConversionGap: '用户愿意点看或加购，但成交不足，优先检查到手价、券门槛、规格和加购后凑单路径。',
    lowExposurePotential: '转化效率高但曝光不足，可提高列表排序、活动标签或组合入口，测试放量。',
    cartValue: '加购后成交效率较好，适合做加购推荐、凑单品或套餐组件。',
    soldOutOpportunity: '售罄会截断转化，优先恢复库存；恢复后再判断真实曝光价值和加购价值。',
    ingredient: '按配料/选项看补充价值，不宜和主商品直接比较曝光效率。',
    longTail: '低曝光低成交，先观察是否为必要选项；非必要商品可下架、改名或合并。',
    stable: '维持当前资源，继续观察下一阶段是否出现流量或转化变化。'
  }[segment];
  return `${lowSamplePrefix}${advice}`;
}

function classifyProductRow(
  row: Omit<ProductAnalysisProductRow, 'segment' | 'segmentText' | 'advice'>,
  medianExposure: number
): ProductAnalysisSegment {
  const highExposure = row.exposureUsers >= Math.max(100, medianExposure);
  const lowExposure = row.exposureUsers < Math.max(100, medianExposure);
  if (row.isIngredient || row.categoryName === '加料/选项') return 'ingredient';
  if (row.isSoldOut && (row.addCartUsers >= 3 || row.broughtOrders >= 2 || row.interestScore >= 55)) return 'soldOutOpportunity';
  if (highExposure && row.exposureValueScore >= 65 && row.interestScore >= 50 && row.broughtOrders >= 5) return 'hero';
  if (highExposure && (row.exposureValueScore < 40 || row.interestScore < 40)) return 'wastedExposure';
  if (row.interestScore >= 65 && row.cartValueScore < 45 && row.addCartUsers >= 5) return 'interestConversionGap';
  if (lowExposure && row.interestScore >= 60 && row.exposureValueScore >= 60) return 'lowExposurePotential';
  if (row.cartValueScore >= 65 && row.addCartUsers >= 5) return 'cartValue';
  if (row.exposureUsers < 100 && row.broughtOrders <= 1) return 'longTail';
  return 'stable';
}

function buildRecordKey(row: Pick<ProductAnalysisRecord, 'storeId' | 'dateStart' | 'dateEnd' | 'productKey'>) {
  return `${row.storeId}:${row.dateStart}:${row.dateEnd}:${row.productKey}`;
}

function buildPeriodKey(row: Pick<ProductAnalysisRecord, 'dateStart' | 'dateEnd'>) {
  return `${row.dateStart}:${row.dateEnd}`;
}

function buildPeriodKeyForGrain(row: Pick<ProductAnalysisRecord, 'dateStart' | 'dateEnd' | 'sourceGrain'>, grain: ProductAnalysisPeriodGrain) {
  const bounds = periodBoundsForRecord(row, grain);
  return `${bounds.dateStart}:${bounds.dateEnd}`;
}

function normalizeRecordSource(row: ProductAnalysisRecordSource | undefined): ProductAnalysisRecord | null {
  const dateRange = normalizeProductAnalysisDateRange(String(row?.dateStart || ''), String(row?.dateEnd || ''));
  const productName = productAnalysisDisplayName(row?.productName);
  const productKey = String(row?.productKey || normalizeProductAnalysisGroupName(productName)).trim();
  if (!dateRange.dateStart || !dateRange.dateEnd || !productKey) return null;
  const record: ProductAnalysisRecord = {
    key: '',
    storeId: String(row?.storeId || ''),
    storeName: String(row?.storeName || ''),
    dateStart: dateRange.dateStart,
    dateEnd: dateRange.dateEnd,
    periodLabel: productAnalysisDateRangeText(dateRange.dateStart, dateRange.dateEnd),
    sourceGrain: row?.sourceGrain === 'range' || row?.sourceGrain === 'daily'
      ? row.sourceGrain
      : dateRange.dateStart === dateRange.dateEnd ? 'daily' : 'range',
    cityName: String(row?.cityName || ''),
    externalStoreName: String(row?.externalStoreName || ''),
    externalStoreId: String(row?.externalStoreId || ''),
    productName,
    productKey,
    isNewProduct: Boolean(row?.isNewProduct),
    isSignature: Boolean(row?.isSignature),
    isSetMeal: Boolean(row?.isSetMeal),
    isIngredient: Boolean(row?.isIngredient),
    isSoldOut: Boolean(row?.isSoldOut),
    salesAmount: Math.max(0, toMoneyNumber(row?.salesAmount, 0)),
    quantity: toInteger(row?.quantity, 0),
    orderUsers: toInteger(row?.orderUsers, row?.broughtOrders || 0),
    broughtOrders: toInteger(row?.broughtOrders, 0),
    orderTransactionAmount: Math.max(0, toMoneyNumber(row?.orderTransactionAmount, 0)),
    repeatUsers30d: toInteger(row?.repeatUsers30d, 0),
    repeatRate30d: toRate(row?.repeatRate30d),
    exposureUsers: toInteger(row?.exposureUsers, 0),
    clickUsers: toInteger(row?.clickUsers, 0),
    addCartUsers: toInteger(row?.addCartUsers, 0),
    likes: toInteger(row?.likes, 0),
    sourceFileName: String(row?.sourceFileName || ''),
    importBatchId: String(row?.importBatchId || ''),
    importedAt: String(row?.importedAt || ''),
    warnings: Array.isArray(row?.warnings) ? row.warnings.map(item => String(item || '')).filter(Boolean) : []
  };
  return {
    ...record,
    key: String(row?.key || buildRecordKey(record))
  };
}

export function normalizeProductAnalysisState(value: Partial<ProductAnalysisState> | undefined): ProductAnalysisState {
  const records = (Array.isArray(value?.records) ? value.records : [])
    .map(row => normalizeRecordSource(row))
    .filter((row): row is ProductAnalysisRecord => Boolean(row))
    .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.dateStart.localeCompare(b.dateStart) || a.productName.localeCompare(b.productName, 'zh-CN'));
  const imports = (Array.isArray(value?.imports) ? value.imports : [])
    .map(row => {
      const range = normalizeProductAnalysisDateRange(String(row?.dateStart || ''), String(row?.dateEnd || ''));
      return {
        id: String(row?.id || uid('product-analysis-import')),
        storeId: String(row?.storeId || ''),
        storeName: String(row?.storeName || ''),
        fileName: String(row?.fileName || ''),
        importedAt: String(row?.importedAt || ''),
        dateStart: range.dateStart,
        dateEnd: range.dateEnd,
        rowCount: toInteger(row?.rowCount, 0),
        replacedRecords: toInteger(row?.replacedRecords, 0),
        sheetName: String(row?.sheetName || ''),
        warnings: Array.isArray(row?.warnings) ? row.warnings.map(item => String(item || '')).filter(Boolean) : []
      };
    })
    .filter(row => row.dateStart && row.dateEnd)
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return { records, imports };
}

function findProductAnalysisHeader(rows: unknown[][]) {
  const limit = Math.min(rows.length, 30);
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    const hasProduct = findImportColumnIndex(row, ['商品名称', '商品名', '名称']) >= 0;
    const hasExposure = findImportColumnIndex(row, ['曝光人数', '曝光']) >= 0;
    const hasCart = findImportColumnIndex(row, ['加购人数', '加购']) >= 0;
    const hasOrders = findImportColumnIndex(row, ['带来订单数', '订单数', '成交订单数']) >= 0;
    if (hasProduct && hasExposure && hasCart && hasOrders) return { rowIndex, header: row };
  }
  return null;
}

function parseProductAnalysisRecord(row: unknown[], header: unknown[], warnings: string[]) {
  const productName = productAnalysisDisplayName(textCell(row, findImportColumnIndex(header, ['商品名称', '商品名', '名称'])));
  const productKey = normalizeProductAnalysisGroupName(productName);
  if (!productKey) return null;
  const dateRange = parseProductAnalysisDateRange(textCell(row, findImportColumnIndex(header, ['日期', '统计日期', '时间'])));
  if (!dateRange.dateStart || !dateRange.dateEnd) {
    warnings.push(`${productName} 缺少可识别的日期区间，已跳过。`);
    return null;
  }
  const isNewProduct = parseBooleanText(row[findImportColumnIndex(header, ['是否新品', '新品'])], false);
  const isSignature = parseBooleanText(row[findImportColumnIndex(header, ['是否招牌', '招牌'])], false);
  const isSetMeal = parseBooleanText(row[findImportColumnIndex(header, ['是否套餐', '套餐'])], false);
  const isIngredient = parseBooleanText(row[findImportColumnIndex(header, ['是否配料', '配料'])], false);
  const isSoldOut = parseBooleanText(row[findImportColumnIndex(header, ['是否售罄', '售罄', '是否售空'])], false);
  const broughtOrdersIndex = findImportColumnIndex(header, ['带来订单数', '订单数', '成交订单数']);
  const broughtOrders = metricInteger(row, broughtOrdersIndex);
  const orderUsersIndex = findImportColumnIndex(header, ['下单人数', '下单用户数']);
  return {
    dateStart: dateRange.dateStart,
    dateEnd: dateRange.dateEnd,
    periodLabel: productAnalysisDateRangeText(dateRange.dateStart, dateRange.dateEnd),
    sourceGrain: dateRange.dateStart === dateRange.dateEnd ? 'daily' as ProductAnalysisSourceGrain : 'range' as ProductAnalysisSourceGrain,
    cityName: textCell(row, findImportColumnIndex(header, ['城市名称', '城市'])),
    externalStoreName: textCell(row, findImportColumnIndex(header, ['门店名称', '店铺名称'])),
    externalStoreId: textCell(row, findImportColumnIndex(header, ['门店编号', '门店id', '门店ID'])),
    productName,
    productKey,
    isNewProduct,
    isSignature,
    isSetMeal,
    isIngredient,
    isSoldOut,
    salesAmount: metricNumber(row, findImportColumnIndex(header, ['销售额', '商品销售额'])),
    quantity: metricInteger(row, findImportColumnIndex(header, ['销量', '销售数量'])),
    orderUsers: orderUsersIndex >= 0 ? metricInteger(row, orderUsersIndex) : broughtOrders,
    broughtOrders,
    orderTransactionAmount: metricNumber(row, findImportColumnIndex(header, ['订单交易额', '交易额', '带来交易额'])),
    repeatUsers30d: metricInteger(row, findImportColumnIndex(header, ['近30日复购人数', '30日复购人数'])),
    repeatRate30d: toRate(row[findImportColumnIndex(header, ['近30日复购率', '30日复购率'])]),
    exposureUsers: metricInteger(row, findImportColumnIndex(header, ['曝光人数', '曝光'])),
    clickUsers: metricInteger(row, findImportColumnIndex(header, ['点击人数', '点击'])),
    addCartUsers: metricInteger(row, findImportColumnIndex(header, ['加购人数', '加购'])),
    likes: metricInteger(row, findImportColumnIndex(header, ['点赞数', '点赞'])),
    warnings: []
  };
}

function mergeParsedRecords(
  rows: Array<ReturnType<typeof parseProductAnalysisRecord>>
): ParsedProductAnalysisWorkbook['records'] {
  const groups = new Map<string, ParsedProductAnalysisWorkbook['records'][number]>();
  rows.filter((row): row is NonNullable<typeof row> => Boolean(row)).forEach(row => {
    const key = `${row.dateStart}:${row.dateEnd}:${row.externalStoreId}:${row.productKey}`;
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, { ...row });
      return;
    }
    const existingRepeatUsers = Number(existing.repeatUsers30d) || 0;
    const rowRepeatUsers = Number(row.repeatUsers30d) || 0;
    const repeatRates = [
      existing.repeatRate30d === null ? null : { users: existingRepeatUsers, rate: existing.repeatRate30d },
      row.repeatRate30d === null ? null : { users: rowRepeatUsers, rate: row.repeatRate30d }
    ].filter((item): item is { users: number; rate: number } => Boolean(item));
    PRODUCT_METRIC_FIELDS.forEach(field => {
      existing[field] = roundMoney((Number(existing[field]) || 0) + (Number(row[field]) || 0));
    });
    const repeatUserDenominator = repeatRates.reduce((sum, item) => sum + item.users, 0);
    existing.repeatRate30d = repeatRates.length
      ? repeatUserDenominator > 0
        ? repeatRates.reduce((sum, item) => sum + item.users * item.rate, 0) / repeatUserDenominator
        : repeatRates.reduce((sum, item) => sum + item.rate, 0) / repeatRates.length
      : null;
    existing.isNewProduct = existing.isNewProduct || row.isNewProduct;
    existing.isSignature = existing.isSignature || row.isSignature;
    existing.isSetMeal = existing.isSetMeal || row.isSetMeal;
    existing.isIngredient = existing.isIngredient || row.isIngredient;
    existing.isSoldOut = existing.isSoldOut || row.isSoldOut;
    existing.warnings = Array.from(new Set(existing.warnings.concat(row.warnings)));
    if (row.productName.length < existing.productName.length) existing.productName = row.productName;
  });
  return Array.from(groups.values());
}

export function parseProductAnalysisWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedProductAnalysisWorkbook {
  let selected: { sheetName: string; rows: unknown[][]; rowIndex: number; header: unknown[] } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    const header = findProductAnalysisHeader(rows);
    if (header) {
      selected = { sheetName, rows, rowIndex: header.rowIndex, header: header.header };
      break;
    }
  }
  if (!selected) throw new Error('没有找到可识别的商品汇总表头。');

  const warnings: string[] = [];
  const parsedRows = selected.rows
    .slice(selected.rowIndex + 1)
    .filter(rowHasText)
    .map(row => parseProductAnalysisRecord(row, selected.header, warnings));
  const records = mergeParsedRecords(parsedRows);
  if (!records.length) throw new Error('没有识别到有效商品数据，请确认文件包含商品名称、日期、曝光人数、加购人数和带来订单数。');
  const skippedRows = parsedRows.filter(row => !row).length;
  if (skippedRows > 0) warnings.push(`${fileName} 有 ${skippedRows} 行未能识别为有效商品。`);
  return {
    sheetName: selected.sheetName,
    records,
    warnings: Array.from(new Set(warnings))
  };
}

export function productAnalysisWorkbookHeaderScore(workbook: XLSX.WorkBook) {
  let score = 0;
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    if (findProductAnalysisHeader(rows)) score = Math.max(score, 100);
    rows.slice(0, 30).forEach(row => {
      const matchedFields = [
        ['商品名称', '商品名', '名称'],
        ['曝光人数', '曝光'],
        ['加购人数', '加购'],
        ['带来订单数', '订单数']
      ].filter(candidates => findImportColumnIndex(row || [], candidates) >= 0).length;
      score = Math.max(score, matchedFields);
    });
  });
  return score;
}

const readProductAnalysisWorkbook = (file: File) => readImportWorkbook(file, productAnalysisWorkbookHeaderScore);

export function summaryEmpty(): ProductAnalysisSummary {
  return {
    dateStart: '',
    dateEnd: '',
    periodCount: 0,
    productCount: 0,
    salesAmount: 0,
    quantity: 0,
    orderUsers: 0,
    broughtOrders: 0,
    orderTransactionAmount: 0,
    repeatUsers30d: 0,
    repeatRate30d: null,
    exposureUsers: 0,
    clickUsers: 0,
    addCartUsers: 0,
    likes: 0,
    newProductCount: 0,
    signatureProductCount: 0,
    setMealProductCount: 0,
    ingredientProductCount: 0,
    soldOutProductCount: 0,
    clickRate: null,
    addCartRate: null,
    clickToCartRate: null,
    cartToOrderRate: null,
    exposureToOrderRate: null,
    ordersPerThousandExposure: null,
    gmvPerThousandExposure: null,
    salesPerThousandExposure: null,
    gmvPerCart: null,
    salesPerUnit: null
  };
}

type ProductAnalysisSummarySource = Pick<
  ProductAnalysisRecord,
  ProductMetricField
  | 'dateStart'
  | 'dateEnd'
  | 'productKey'
  | 'repeatRate30d'
  | 'isNewProduct'
  | 'isSignature'
  | 'isSetMeal'
  | 'isIngredient'
  | 'isSoldOut'
>;

function countFlaggedProducts(records: ProductAnalysisSummarySource[], field: 'isNewProduct' | 'isSignature' | 'isSetMeal' | 'isIngredient' | 'isSoldOut') {
  return new Set(records.filter(row => row[field]).map(row => row.productKey)).size;
}

function summarizeRepeatRate30d(records: ProductAnalysisSummarySource[]) {
  const rows = records
    .filter(row => typeof row.repeatRate30d === 'number' && Number.isFinite(row.repeatRate30d))
    .map(row => ({ users: Number(row.repeatUsers30d) || 0, rate: row.repeatRate30d as number }));
  if (!rows.length) return null;
  const denominator = rows.reduce((sum, row) => sum + row.users, 0);
  if (denominator > 0) return rows.reduce((sum, row) => sum + row.users * row.rate, 0) / denominator;
  return rows.reduce((sum, row) => sum + row.rate, 0) / rows.length;
}

function summarizeProductAnalysisMetrics(records: ProductAnalysisSummarySource[]): ProductAnalysisSummary {
  if (!records.length) return summaryEmpty();
  const sorted = records.slice().sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.dateEnd.localeCompare(b.dateEnd));
  const sums = PRODUCT_METRIC_FIELDS.reduce((result, field) => {
    result[field] = roundMoney(records.reduce((sum, row) => sum + (Number(row[field]) || 0), 0));
    return result;
  }, {} as Record<ProductMetricField, number>);
  return {
    dateStart: sorted[0].dateStart,
    dateEnd: sorted[sorted.length - 1].dateEnd,
    periodCount: new Set(records.map(row => buildPeriodKey(row))).size,
    productCount: new Set(records.map(row => row.productKey)).size,
    ...sums,
    quantity: Math.round(sums.quantity),
    orderUsers: Math.round(sums.orderUsers),
    broughtOrders: Math.round(sums.broughtOrders),
    repeatUsers30d: Math.round(sums.repeatUsers30d),
    repeatRate30d: summarizeRepeatRate30d(records),
    exposureUsers: Math.round(sums.exposureUsers),
    clickUsers: Math.round(sums.clickUsers),
    addCartUsers: Math.round(sums.addCartUsers),
    likes: Math.round(sums.likes),
    newProductCount: countFlaggedProducts(records, 'isNewProduct'),
    signatureProductCount: countFlaggedProducts(records, 'isSignature'),
    setMealProductCount: countFlaggedProducts(records, 'isSetMeal'),
    ingredientProductCount: countFlaggedProducts(records, 'isIngredient'),
    soldOutProductCount: countFlaggedProducts(records, 'isSoldOut'),
    clickRate: safeRate(sums.clickUsers, sums.exposureUsers),
    addCartRate: safeRate(sums.addCartUsers, sums.exposureUsers),
    clickToCartRate: safeRate(sums.addCartUsers, sums.clickUsers),
    cartToOrderRate: safeRate(sums.broughtOrders, sums.addCartUsers),
    exposureToOrderRate: safeRate(sums.broughtOrders, sums.exposureUsers),
    ordersPerThousandExposure: sums.exposureUsers > 0 ? sums.broughtOrders * 1000 / sums.exposureUsers : null,
    gmvPerThousandExposure: sums.exposureUsers > 0 ? sums.orderTransactionAmount * 1000 / sums.exposureUsers : null,
    salesPerThousandExposure: sums.exposureUsers > 0 ? sums.salesAmount * 1000 / sums.exposureUsers : null,
    gmvPerCart: sums.addCartUsers > 0 ? sums.orderTransactionAmount / sums.addCartUsers : null,
    salesPerUnit: sums.quantity > 0 ? sums.salesAmount / sums.quantity : null
  };
}

export function summarizeProductAnalysisRecords(records: ProductAnalysisRecord[]): ProductAnalysisSummary {
  return summarizeProductAnalysisMetrics(records);
}

function groupProductRecords(records: ProductAnalysisRecord[]) {
  const groups = new Map<string, ProductAnalysisRecordGroup>();
  records.forEach(row => {
    const group = groups.get(row.productKey) || { rows: [], displayName: row.productName };
    group.rows.push(row);
    if (row.productName.length < group.displayName.length) group.displayName = row.productName;
    groups.set(row.productKey, group);
  });
  return groups;
}

export function buildProductAnalysisRows(records: ProductAnalysisRecord[], products: Product[] = []): ProductAnalysisProductRow[] {
  const groups = groupProductRecords(records);
  const rawRows = Array.from(groups.entries()).map(([productKey, group]) => {
    const summary = summarizeProductAnalysisMetrics(group.rows);
    const matchedProduct = findMatchedProduct(products, group.displayName);
    const productCost = matchedProduct && matchedProduct.cost > 0 ? matchedProduct.cost : null;
    const estimatedGrossProfit = productCost === null ? null : roundMoney(summary.salesAmount - productCost * summary.quantity);
    const estimatedGrossProfitRate = estimatedGrossProfit === null || summary.salesAmount <= 0
      ? null
      : estimatedGrossProfit / summary.salesAmount;
    return {
      ...summary,
      key: productKey,
      productName: group.displayName,
      productKey,
      isNewProduct: group.rows.some(row => row.isNewProduct),
      isSignature: group.rows.some(row => row.isSignature),
      isSetMeal: group.rows.some(row => row.isSetMeal),
      isIngredient: group.rows.some(row => row.isIngredient),
      isSoldOut: group.rows.some(row => row.isSoldOut),
      categoryName: matchedProduct
        ? PRODUCT_CATEGORY_NAMES[matchedProduct.category]
        : inferCategoryName(group.displayName, group.rows.some(row => row.isIngredient), group.rows.some(row => row.isSetMeal)),
      matchedProductName: matchedProduct?.name || '',
      productCost,
      estimatedGrossProfit,
      estimatedGrossProfitRate
    };
  });
  const benchmark = summarizeProductAnalysisRecords(records);
  const medianExposure = median(rawRows.map(row => row.exposureUsers));
  const overallOrdersPerCart = benchmark.cartToOrderRate;
  const overallGmvPerCart = benchmark.gmvPerCart;
  const likeRate = safeRate(benchmark.likes, benchmark.exposureUsers);
  const hasRepeatBenchmark = benchmark.repeatRate30d !== null && benchmark.repeatRate30d > 0;

  return rawRows
    .map(row => {
      const exposureValueScore = weightedScore([
        { score: relativeScore(row.ordersPerThousandExposure, benchmark.ordersPerThousandExposure), weight: 0.45 },
        { score: relativeScore(row.gmvPerThousandExposure, benchmark.gmvPerThousandExposure), weight: 0.55 }
      ]);
      const interestScore = weightedScore([
        { score: relativeScore(row.clickRate, benchmark.clickRate), weight: 0.38 },
        { score: relativeScore(row.addCartRate, benchmark.addCartRate), weight: 0.52 },
        { score: relativeScore(safeRate(row.likes, row.exposureUsers), likeRate), weight: 0.10 },
        ...(hasRepeatBenchmark ? [{ score: relativeScore(row.repeatRate30d, benchmark.repeatRate30d), weight: 0.14 }] : [])
      ]);
      const cartValueScore = weightedScore([
        { score: relativeScore(row.cartToOrderRate, overallOrdersPerCart), weight: 0.58 },
        { score: relativeScore(row.gmvPerCart, overallGmvPerCart), weight: 0.42 }
      ]);
      const reliability = reliabilityFor(row);
      const opportunityScore = weightedScore([
        { score: exposureValueScore, weight: 0.42 },
        { score: interestScore, weight: 0.33 },
        { score: cartValueScore, weight: 0.25 }
      ]);
      const prepared = {
        ...row,
        exposureValueScore,
        interestScore,
        cartValueScore,
        opportunityScore,
        reliability
      };
      const segment = classifyProductRow(prepared, medianExposure);
      return {
        ...prepared,
        segment,
        segmentText: segmentText(segment),
        advice: segmentAdvice(segment, { productName: row.productName, reliability })
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore || b.broughtOrders - a.broughtOrders || a.productName.localeCompare(b.productName, 'zh-CN'));
}

export function aggregateProductAnalysisByPeriod(records: ProductAnalysisRecord[], grain: ProductAnalysisPeriodGrain = 'source'): ProductAnalysisPeriodRow[] {
  const byPeriod = new Map<string, ProductAnalysisRecord[]>();
  const periodBounds = new Map<string, { dateStart: string; dateEnd: string }>();
  records.forEach(row => {
    const bounds = periodBoundsForRecord(row, grain);
    const key = `${bounds.dateStart}:${bounds.dateEnd}`;
    periodBounds.set(key, bounds);
    byPeriod.set(key, (byPeriod.get(key) || []).concat(row));
  });
  return Array.from(byPeriod.entries())
    .map(([key, rows]) => {
      const summary = summarizeProductAnalysisRecords(rows);
      const topProduct = buildProductAnalysisRows(rows)[0];
      const bounds = periodBounds.get(key) || { dateStart: summary.dateStart, dateEnd: summary.dateEnd };
      return {
        ...summary,
        dateStart: bounds.dateStart,
        dateEnd: bounds.dateEnd,
        key,
        periodLabel: productAnalysisDateRangeText(bounds.dateStart, bounds.dateEnd),
        topProductName: topProduct?.productName || '-',
        topProductOrders: topProduct?.broughtOrders || 0
      };
    })
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.dateEnd.localeCompare(b.dateEnd));
}

export function buildProductAnalysisTrendRows(
  records: ProductAnalysisRecord[],
  productRows: ProductAnalysisProductRow[],
  selectedProductKey = '',
  grain: ProductAnalysisPeriodGrain = 'source'
): ProductAnalysisTrendRow[] {
  const selectedKeys = selectedProductKey
    ? [selectedProductKey]
    : productRows
      .filter(row => !row.isIngredient)
      .slice()
      .sort((a, b) => b.broughtOrders - a.broughtOrders || b.exposureValueScore - a.exposureValueScore)
      .slice(0, 5)
      .map(row => row.productKey);
  if (!selectedKeys.length) return [];
  const selectedSet = new Set(selectedKeys);
  const grouped = new Map<string, ProductAnalysisRecord[]>();
  const periodBounds = new Map<string, { dateStart: string; dateEnd: string }>();
  records
    .filter(row => selectedSet.has(row.productKey))
    .forEach(row => {
      const bounds = periodBoundsForRecord(row, grain);
      const periodKey = buildPeriodKeyForGrain(row, grain);
      const key = `${periodKey}:${row.productKey}`;
      periodBounds.set(key, bounds);
      grouped.set(key, (grouped.get(key) || []).concat(row));
    });
  return Array.from(grouped.values())
    .map(rows => {
      const first = rows[0];
      const summary = summarizeProductAnalysisRecords(rows);
      const bounds = periodBounds.get(`${buildPeriodKeyForGrain(first, grain)}:${first.productKey}`) || { dateStart: summary.dateStart, dateEnd: summary.dateEnd };
      return {
        key: `${buildPeriodKeyForGrain(first, grain)}:${first.productKey}`,
        periodLabel: productAnalysisDateRangeText(bounds.dateStart, bounds.dateEnd),
        dateStart: bounds.dateStart,
        dateEnd: bounds.dateEnd,
        productName: first.productName,
        productKey: first.productKey,
        exposureUsers: summary.exposureUsers,
        addCartUsers: summary.addCartUsers,
        broughtOrders: summary.broughtOrders,
        orderTransactionAmount: summary.orderTransactionAmount,
        repeatRate30d: summary.repeatRate30d,
        clickRate: summary.clickRate,
        addCartRate: summary.addCartRate,
        cartToOrderRate: summary.cartToOrderRate,
        gmvPerThousandExposure: summary.gmvPerThousandExposure
      };
    })
    .sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.productName.localeCompare(b.productName, 'zh-CN'));
}

export function productAnalysisRecordsOverlapRange(row: ProductAnalysisRecord, startText: string, endText: string) {
  const range = normalizeProductAnalysisDateRange(startText, endText);
  if (!range.dateStart && !range.dateEnd) return true;
  if (range.dateStart && row.dateEnd < range.dateStart) return false;
  if (range.dateEnd && row.dateStart > range.dateEnd) return false;
  return true;
}

export function productAnalysisImportedAtText(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function openProductAnalysisDatabase(repaired = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(PRODUCT_ANALYSIS_STORE)) {
        request.result.createObjectStore(PRODUCT_ANALYSIS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(PRODUCT_ANALYSIS_STORE)) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      if (repaired) {
        reject(new Error('商品分析数据表升级失败，请刷新页面后重试。'));
        return;
      }
      const upgradeRequest = indexedDB.open(DB_NAME, nextVersion);
      upgradeRequest.onupgradeneeded = () => {
        if (!upgradeRequest.result.objectStoreNames.contains(PRODUCT_ANALYSIS_STORE)) {
          upgradeRequest.result.createObjectStore(PRODUCT_ANALYSIS_STORE, { keyPath: 'key' });
        }
      };
      upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
      upgradeRequest.onerror = () => reject(upgradeRequest.error || new Error('商品分析数据库升级失败'));
    };
    request.onerror = () => reject(request.error || new Error('打开商品分析数据库失败'));
  });
}

function productAnalysisStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openProductAnalysisDatabase().then(db => new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>;
    try {
      const transaction = db.transaction(storeName, mode);
      request = executor(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('商品分析数据库操作失败'));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('商品分析数据库事务失败'));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

type ProductAnalysisDataRecord = {
  key: string;
  value: ProductAnalysisState;
  updatedAt: string;
};

export async function loadProductAnalysisState() {
  try {
    const record = await productAnalysisStoreTransaction<ProductAnalysisDataRecord | undefined>(
      PRODUCT_ANALYSIS_STORE,
      'readonly',
      store => store.get(DEFAULT_KEY)
    );
    return normalizeProductAnalysisState(record?.value);
  } catch {
    return normalizeProductAnalysisState(undefined);
  }
}

export function saveProductAnalysisState(value: ProductAnalysisState) {
  const record: ProductAnalysisDataRecord = {
    key: DEFAULT_KEY,
    value: normalizeProductAnalysisState(value),
    updatedAt: new Date().toISOString()
  };
  return productAnalysisStoreTransaction<IDBValidKey>(
    PRODUCT_ANALYSIS_STORE,
    'readwrite',
    store => store.put(record)
  );
}

export async function importProductAnalysisFileToState({
  file,
  currentState,
  storeId,
  storeName
}: ImportProductAnalysisInput): Promise<ImportProductAnalysisResult> {
  const parsed = parseProductAnalysisWorkbook(await readProductAnalysisWorkbook(file), file.name);
  const importedAt = new Date().toISOString();
  const importBatchId = uid('product-analysis-import');
  const sourceRows = parsed.records.map(row => normalizeRecordSource({
    ...row,
    storeId,
    storeName,
    sourceFileName: file.name,
    importBatchId,
    importedAt
  })).filter((row): row is ProductAnalysisRecord => Boolean(row));
  if (!sourceRows.length) {
    throw new Error('没有识别到有效商品数据，请确认文件是商品汇总导出。');
  }

  const isOverlappedImportRecord = (existing: ProductAnalysisRecord) => (
    existing.storeId === storeId
    && sourceRows.some(source => (
      source.productKey === existing.productKey
      && productAnalysisRecordsOverlapRange(existing, source.dateStart, source.dateEnd)
    ))
  );
  const replacedRecords = currentState.records.filter(isOverlappedImportRecord).length;
  const sortedRows = sourceRows.slice().sort((a, b) => a.dateStart.localeCompare(b.dateStart) || a.productName.localeCompare(b.productName, 'zh-CN'));
  const first = sortedRows[0];
  const dateEnds = sortedRows.map(row => row.dateEnd).sort();
  const sourceGrains = new Set(sourceRows.map(row => row.sourceGrain));
  const warnings = Array.from(new Set(parsed.warnings.concat(
    sourceGrains.has('daily') ? ['文件包含按日商品数据，已按天保存，可按周或按月聚合查看。'] : [],
    new Set(sourceRows.map(row => row.periodLabel)).size > 1 ? ['文件内存在多个日期区间，已按区间分别保存。'] : [],
    replacedRecords > 0 ? ['已覆盖同商品的重叠日期旧记录，避免汇总表和按日表重复计入。'] : []
  ))).filter(Boolean);
  const state = normalizeProductAnalysisState({
    records: currentState.records
      .filter(row => !isOverlappedImportRecord(row))
      .concat(sortedRows)
      .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.dateStart.localeCompare(b.dateStart) || a.productName.localeCompare(b.productName, 'zh-CN')),
    imports: [{
      id: importBatchId,
      storeId,
      storeName,
      fileName: file.name,
      importedAt,
      dateStart: first.dateStart,
      dateEnd: dateEnds[dateEnds.length - 1] || first.dateEnd,
      rowCount: sortedRows.length,
      replacedRecords,
      sheetName: parsed.sheetName,
      warnings
    }, ...currentState.imports].slice(0, 100)
  });

  return {
    state,
    importedCount: sortedRows.length,
    replacedRecords,
    dateStart: first.dateStart,
    dateEnd: dateEnds[dateEnds.length - 1] || first.dateEnd,
    warnings
  };
}

export function productAnalysisExportRows(rows: ProductAnalysisProductRow[]) {
  return rows.map(row => ({
    商品: row.productName,
    分类: row.categoryName,
    分层: row.segmentText,
    样本稳定性: reliabilityText(row.reliability),
    是否新品: row.isNewProduct ? '是' : '否',
    是否招牌: row.isSignature ? '是' : '否',
    是否套餐: row.isSetMeal ? '是' : '否',
    是否配料: row.isIngredient ? '是' : '否',
    是否售罄: row.isSoldOut ? '是' : '否',
    阶段数: row.periodCount,
    日期范围: productAnalysisDateRangeText(row.dateStart, row.dateEnd),
    销售额: money(row.salesAmount),
    销量: row.quantity,
    下单人数: row.orderUsers,
    带来订单数: row.broughtOrders,
    订单交易额: money(row.orderTransactionAmount),
    近30日复购人数: row.repeatUsers30d,
    近30日复购率: row.repeatRate30d === null ? '' : rateText(row.repeatRate30d),
    曝光人数: row.exposureUsers,
    点击人数: row.clickUsers,
    加购人数: row.addCartUsers,
    点赞数: row.likes,
    点击率: row.clickRate === null ? '' : rateText(row.clickRate),
    加购率: row.addCartRate === null ? '' : rateText(row.addCartRate),
    点击到加购率: row.clickToCartRate === null ? '' : rateText(row.clickToCartRate),
    加购到订单效率: row.cartToOrderRate === null ? '' : rateText(row.cartToOrderRate),
    曝光成交率: row.exposureToOrderRate === null ? '' : rateText(row.exposureToOrderRate),
    千曝光订单: row.ordersPerThousandExposure === null ? '' : money(row.ordersPerThousandExposure),
    千曝光交易额: row.gmvPerThousandExposure === null ? '' : money(row.gmvPerThousandExposure),
    单加购交易额: row.gmvPerCart === null ? '' : money(row.gmvPerCart),
    曝光价值分: row.exposureValueScore,
    兴趣价值分: row.interestScore,
    加购价值分: row.cartValueScore,
    机会分: row.opportunityScore,
    匹配商品: row.matchedProductName,
    估算毛利: row.estimatedGrossProfit === null ? '' : money(row.estimatedGrossProfit),
    估算毛利率: row.estimatedGrossProfitRate === null ? '' : rateText(row.estimatedGrossProfitRate),
    建议: row.advice
  }));
}

export function reliabilityText(reliability: ProductAnalysisReliability) {
  return {
    high: '较稳定',
    medium: '可参考',
    low: '样本少'
  }[reliability];
}

export function productAnalysisSegmentColor(segment: ProductAnalysisSegment) {
  return {
    hero: 'green',
    wastedExposure: 'red',
    interestConversionGap: 'orange',
    lowExposurePotential: 'blue',
    cartValue: 'cyan',
    soldOutOpportunity: 'magenta',
    ingredient: 'purple',
    longTail: 'default',
    stable: 'geekblue'
  }[segment];
}
