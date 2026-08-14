import * as XLSX from 'xlsx';
import { PLATFORM_NAMES, PLATFORMS } from './core';
import { average, roundMoney } from './money';
import type { Platform, Product, Severity } from './types';

export type OrderAnalysisPlatformFilter = Platform | 'all';
export type OrderActivityType = 'deliveryDiscount' | 'productDiscount' | 'fullReduction' | 'merchantCoupon' | 'redPacket' | 'platformSubsidy' | 'magicCoupon' | 'pinghaofan' | 'other';
export type OrderCustomerType = 'new' | 'old' | 'unknown';

export type OrderProductItem = {
  name: string;
  quantity: number;
  unitPrice: number;
};

export type OrderActivityFlags = Record<OrderActivityType, boolean>;

export type OrderDetailRecord = {
  key: string;
  storeId: string;
  storeName: string;
  platform: Platform;
  platformName: string;
  orderId: string;
  sourceFileName: string;
  importBatchId: string;
  importedAt: string;
  externalStoreId: string;
  externalStoreName: string;
  orderDate: string;
  orderTime: string;
  orderHour: number;
  mealPeriod: string;
  weekdayIndex: number;
  orderStatus: string;
  isValid: boolean;
  deliveryType: string;
  isPreOrder: boolean;
  isPickup: boolean;
  customerType: OrderCustomerType;
  isMember: boolean;
  isPinghaofan: boolean;
  isMagicCoupon: boolean;
  isOutsitePromotion: boolean;
  productCount: number;
  productItems: OrderProductItem[];
  productNames: string[];
  activityText: string;
  activityFlags: OrderActivityFlags;
  grossOriginal: number;
  productOriginal: number;
  packageFee: number;
  deliveryFee: number;
  customerPay: number;
  totalSubsidy: number;
  merchantSubsidy: number;
  platformSubsidy: number;
  merchantCost: number;
  discountRate: number | null;
};

export type OrderImportBatch = {
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
  replacedOrders: number;
  skippedRows: number;
  warnings: string[];
};

export type OrderAnalysisState = {
  records: OrderDetailRecord[];
  imports: OrderImportBatch[];
};

export type ParsedOrderWorkbook = {
  platform: Platform;
  sheetName: string;
  records: Array<Omit<OrderDetailRecord, 'key' | 'storeId' | 'storeName' | 'sourceFileName' | 'importBatchId' | 'importedAt'>>;
  skippedRows: number;
  warnings: string[];
};

export type OrderSummary = {
  dateStart: string;
  dateEnd: string;
  orderCount: number;
  platformCount: number;
  customerPay: number;
  grossOriginal: number;
  productOriginal: number;
  totalSubsidy: number;
  merchantSubsidy: number;
  platformSubsidy: number;
  avgPay: number;
  avgOriginal: number;
  avgDiscount: number;
  discountRate: number | null;
  merchantSubsidyPerOrder: number;
  platformSubsidyPerOrder: number;
};

export type OrderAggregateRow = OrderSummary & {
  key: string;
  label: string;
  platform?: Platform;
  platformName?: string;
  orderHour?: number;
  mealPeriod?: string;
  payBandMin?: number;
  payBandMax?: number;
};

export type OrderActivityAggregateRow = OrderAggregateRow & {
  activityType: OrderActivityType;
  activityName: string;
};

export type OrderProductAggregateRow = OrderSummary & {
  key: string;
  productName: string;
  normalizedProductName?: string;
  quantity: number;
  orderShare: number | null;
  matchedProductName?: string;
  matchedProductCost?: number;
  matchedOrderCount?: number;
  unmatchedOrderCount?: number;
  avgEstimatedProfit?: number | null;
  estimatedProfitRate?: number | null;
};

export type EnrichedOrderDetailRecord = OrderDetailRecord & {
  activityComboKey: string;
  activityComboName: string;
  estimatedProductCost: number;
  estimatedProfit: number | null;
  estimatedProfitRate: number | null;
  matchedProductCount: number;
  unmatchedProductCount: number;
  matchedProductNames: string[];
  unmatchedProductNames: string[];
};

export type OrderActivityComboRow = OrderSummary & {
  key: string;
  label: string;
  activityTypes: OrderActivityType[];
  avgEstimatedProfit: number | null;
  estimatedProfitRate: number | null;
  profitKnownOrderCount: number;
  lossOrderCount: number;
};

export type OrderCrossAggregateRow = OrderSummary & {
  key: string;
  label: string;
  primary: string;
  secondary: string;
  platform?: Platform;
  platformName?: string;
  payBandLabel?: string;
  mealPeriod?: string;
  activityComboName?: string;
  avgEstimatedProfit: number | null;
  estimatedProfitRate: number | null;
  lossOrderCount: number;
};

export type OrderProfitSummary = {
  knownOrderCount: number;
  unknownOrderCount: number;
  lossOrderCount: number;
  estimatedProductCost: number;
  estimatedProfit: number;
  avgEstimatedProfit: number | null;
  estimatedProfitRate: number | null;
  costCoverageRate: number | null;
  lossOrderRate: number | null;
};

export type OrderOperationRecommendation = {
  key: string;
  priority: Severity;
  title: string;
  evidence: string;
  action: string;
  expectedImpact: string;
};

export type OrderInsightItem = {
  key: string;
  title: string;
  description: string;
  suggestion: string;
};

export const ORDER_PAY_BANDS = [
  { key: '0-10', label: '0-10', min: 0, max: 10 },
  { key: '10-15', label: '10-15', min: 10, max: 15 },
  { key: '15-20', label: '15-20', min: 15, max: 20 },
  { key: '20-25', label: '20-25', min: 20, max: 25 },
  { key: '25-30', label: '25-30', min: 25, max: 30 },
  { key: '30-40', label: '30-40', min: 30, max: 40 },
  { key: '40+', label: '40+', min: 40, max: Infinity }
] as const;

export const ORDER_ACTIVITY_TYPE_LABELS: Record<OrderActivityType, string> = {
  deliveryDiscount: '配送费减免',
  productDiscount: '商品活动',
  fullReduction: '满减',
  merchantCoupon: '商家券',
  redPacket: '红包',
  platformSubsidy: '平台补贴',
  magicCoupon: '神券/爆红包',
  pinghaofan: '拼好饭',
  other: '其他活动'
};

export const ORDER_MEAL_PERIODS = [
  { key: 'breakfast', label: '早餐', startHour: 6, endHour: 10 },
  { key: 'lunch', label: '午餐', startHour: 10, endHour: 14 },
  { key: 'afternoon', label: '下午', startHour: 14, endHour: 17 },
  { key: 'dinner', label: '晚餐', startHour: 17, endHour: 21 },
  { key: 'night', label: '夜间', startHour: 21, endHour: 30 }
] as const;

const TRUE_VALUES = new Set(['true', '1', 'yes', 'y', '是', '有', '开启', '启用']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'n', '否', '无', '关闭', '停用']);

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

function businessWeekdayIndex(date: string) {
  if (!date) return 0;
  const value = new Date(`${date}T00:00:00`);
  if (Number.isNaN(value.getTime())) return 0;
  return (value.getDay() + 6) % 7;
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

function rowHasText(row: unknown[]) {
  return Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '');
}

function businessNumber(row: unknown[], index: number, fallback = 0) {
  return index >= 0 ? toMoneyNumber(row[index], fallback) : fallback;
}

function businessInteger(row: unknown[], index: number, fallback = 0) {
  return Math.max(0, Math.floor(toNumber(index >= 0 ? row[index] : fallback, fallback)));
}

function businessText(row: unknown[], index: number) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

function money(value: unknown) {
  return roundMoney(value).toFixed(2);
}

function rateText(rate: number | null | undefined) {
  return Number.isFinite(rate) ? `${((rate as number) * 100).toFixed(2)}%` : '无法计算';
}

export function emptyOrderActivityFlags(): OrderActivityFlags {
  return {
    deliveryDiscount: false,
    productDiscount: false,
    fullReduction: false,
    merchantCoupon: false,
    redPacket: false,
    platformSubsidy: false,
    magicCoupon: false,
    pinghaofan: false,
    other: false
  };
}

function normalizeOrderProductItem(row: Partial<OrderProductItem> | undefined): OrderProductItem | null {
  const name = String(row?.name || '').trim();
  if (!name) return null;
  return {
    name,
    quantity: Math.max(1, Math.floor(toNumber(row?.quantity, 1))),
    unitPrice: Math.max(0, toMoneyNumber(row?.unitPrice, 0))
  };
}

function normalizeOrderCustomerType(value: unknown): OrderCustomerType {
  const text = String(value ?? '').trim();
  if (/^新/.test(text)) return 'new';
  if (/^老/.test(text)) return 'old';
  return 'unknown';
}

export function normalizeOrderDetailRecord(row: Partial<OrderDetailRecord> | undefined): OrderDetailRecord | null {
  const platform = row?.platform === 'eleme' ? 'eleme' : row?.platform === 'meituan' ? 'meituan' : null;
  const orderId = String(row?.orderId || '').trim();
  const orderDate = normalizeBusinessDate(row?.orderDate);
  if (!platform || !orderId || !orderDate) return null;
  const productItems = (Array.isArray(row?.productItems) ? row.productItems : [])
    .map(item => normalizeOrderProductItem(item))
    .filter((item): item is OrderProductItem => Boolean(item));
  const activityFlags: OrderActivityFlags = { ...emptyOrderActivityFlags(), ...(row?.activityFlags || {}) };
  const grossOriginal = Math.max(0, toMoneyNumber(row?.grossOriginal, 0));
  const customerPay = Math.max(0, toMoneyNumber(row?.customerPay, 0));
  const totalSubsidy = Math.max(0, toMoneyNumber(row?.totalSubsidy, 0));
  return {
    key: orderId,
    storeId: String(row?.storeId || ''),
    storeName: String(row?.storeName || ''),
    platform,
    platformName: PLATFORM_NAMES[platform],
    orderId,
    sourceFileName: String(row?.sourceFileName || ''),
    importBatchId: String(row?.importBatchId || ''),
    importedAt: String(row?.importedAt || ''),
    externalStoreId: String(row?.externalStoreId || ''),
    externalStoreName: String(row?.externalStoreName || ''),
    orderDate,
    orderTime: String(row?.orderTime || ''),
    orderHour: Math.max(0, Math.min(23, Math.floor(toNumber(row?.orderHour, 0)))),
    mealPeriod: String(row?.mealPeriod || orderMealPeriodLabel(toNumber(row?.orderHour, 0))),
    weekdayIndex: Math.max(0, Math.min(6, Math.floor(toNumber(row?.weekdayIndex, businessWeekdayIndex(orderDate))))),
    orderStatus: String(row?.orderStatus || ''),
    isValid: row?.isValid !== false,
    deliveryType: String(row?.deliveryType || ''),
    isPreOrder: Boolean(row?.isPreOrder),
    isPickup: Boolean(row?.isPickup),
    customerType: normalizeOrderCustomerType(row?.customerType),
    isMember: Boolean(row?.isMember),
    isPinghaofan: Boolean(row?.isPinghaofan) || Boolean(activityFlags.pinghaofan),
    isMagicCoupon: Boolean(row?.isMagicCoupon) || Boolean(activityFlags.magicCoupon),
    isOutsitePromotion: Boolean(row?.isOutsitePromotion),
    productCount: Math.max(0, Math.floor(toNumber(row?.productCount, productItems.reduce((sum, item) => sum + item.quantity, 0)))),
    productItems,
    productNames: Array.isArray(row?.productNames)
      ? row.productNames.map(item => String(item || '').trim()).filter(Boolean)
      : productItems.map(item => item.name),
    activityText: String(row?.activityText || ''),
    activityFlags,
    grossOriginal,
    productOriginal: Math.max(0, toMoneyNumber(row?.productOriginal, 0)),
    packageFee: Math.max(0, toMoneyNumber(row?.packageFee, 0)),
    deliveryFee: Math.max(0, toMoneyNumber(row?.deliveryFee, 0)),
    customerPay,
    totalSubsidy,
    merchantSubsidy: Math.max(0, toMoneyNumber(row?.merchantSubsidy, 0)),
    platformSubsidy: Math.max(0, toMoneyNumber(row?.platformSubsidy, 0)),
    merchantCost: Math.max(0, toMoneyNumber(row?.merchantCost, 0)),
    discountRate: grossOriginal > 0 ? totalSubsidy / grossOriginal : null
  };
}

export function normalizeOrderAnalysisState(value: Partial<OrderAnalysisState> | undefined): OrderAnalysisState {
  const records = (Array.isArray(value?.records) ? value.records : [])
    .map(row => normalizeOrderDetailRecord(row))
    .filter((row): row is OrderDetailRecord => Boolean(row))
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime) || a.orderId.localeCompare(b.orderId));
  const imports = (Array.isArray(value?.imports) ? value.imports : [])
    .map(row => {
      const platform: Platform = row?.platform === 'eleme' ? 'eleme' : 'meituan';
      return {
        id: String(row?.id || uid('order-import')),
        storeId: String(row?.storeId || ''),
        storeName: String(row?.storeName || ''),
        platform,
        platformName: PLATFORM_NAMES[platform],
        fileName: String(row?.fileName || ''),
        importedAt: String(row?.importedAt || ''),
        dateStart: normalizeBusinessDate(row?.dateStart),
        dateEnd: normalizeBusinessDate(row?.dateEnd),
        rowCount: Math.max(0, Math.floor(toNumber(row?.rowCount, 0))),
        replacedOrders: Math.max(0, Math.floor(toNumber(row?.replacedOrders, 0))),
        skippedRows: Math.max(0, Math.floor(toNumber(row?.skippedRows, 0))),
        warnings: Array.isArray(row?.warnings) ? row.warnings.map(item => String(item || '')).filter(Boolean) : []
      };
    })
    .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return { records, imports };
}

function orderColumn(row: unknown[], candidates: string[]) {
  return findImportColumnIndex(row, candidates);
}

function detectOrderWorkbookPlatform(header: unknown[]): Platform | null {
  const hasMeituanOrder = orderColumn(header, ['订单编号']) >= 0 && orderColumn(header, ['订单实付']) >= 0 && orderColumn(header, ['商品原价']) >= 0;
  if (hasMeituanOrder) return 'meituan';
  const hasElemeOrder = orderColumn(header, ['订单单号']) >= 0 && orderColumn(header, ['顾客实付']) >= 0 && orderColumn(header, ['订单原价']) >= 0;
  if (hasElemeOrder) return 'eleme';
  return null;
}

export function findOrderWorkbookHeader(rows: unknown[][]) {
  const limit = Math.min(rows.length, 30);
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    if (orderColumn(row, ['下单时间']) < 0 || orderColumn(row, ['商品信息']) < 0) continue;
    const platform = detectOrderWorkbookPlatform(row);
    if (platform) return { rowIndex, header: row, platform };
  }
  return null;
}

function normalizeOrderId(value: unknown) {
  return String(value ?? '').trim().replace(/^ID[:：]\s*/i, '');
}

function parseOrderDateTime(value: unknown, fallbackDateValue?: unknown) {
  const text = String(value ?? '').trim().replace('T', ' ');
  const normalized = text.match(/^(\d{4}[-/.年]?\d{1,2}[-/.月]?\d{1,2})\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?)/);
  const shortDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}:\d{1,2}(?::\d{1,2})?))?/);
  const shortDateText = shortDate
    ? `${shortDate[3].length === 2 ? 2000 + toNumber(shortDate[3], 0) : toNumber(shortDate[3], 0)}-${shortDate[1].padStart(2, '0')}-${shortDate[2].padStart(2, '0')}`
    : '';
  const date = normalizeBusinessDate(text) || normalizeBusinessDate(shortDateText) || normalizeBusinessDate(fallbackDateValue);
  const timeText = normalized?.[2] || shortDate?.[4] || '';
  let hour = 0;
  if (timeText) hour = Math.max(0, Math.min(23, Math.floor(toNumber(timeText.split(':')[0], 0))));
  return {
    date,
    time: date && timeText ? `${date} ${timeText}` : text || date,
    hour
  };
}

function orderMealPeriodLabel(hour: number) {
  const safeHour = Math.max(0, Math.min(23, Math.floor(Number(hour) || 0)));
  const normalizedHour = safeHour < 6 ? safeHour + 24 : safeHour;
  const period = ORDER_MEAL_PERIODS.find(item => normalizedHour >= item.startHour && normalizedHour < item.endHour);
  return period?.label || '夜间';
}

function parseOrderYesNo(value: unknown) {
  return parseBoolean(value, false);
}

function parseMeituanOrderProducts(value: unknown): OrderProductItem[] {
  const text = String(value ?? '').trim();
  if (!text) return [];
  return text
    .split('/')
    .map(part => {
      const itemText = part.trim();
      if (!itemText) return null;
      const match = itemText.match(/^(.*?)(?:\([^)]*\))?,单价([\d.]+)\*数量(\d+)/);
      if (match) {
        return {
          name: match[1].trim(),
          unitPrice: roundMoney(toMoneyNumber(match[2], 0)),
          quantity: Math.max(1, Math.floor(toNumber(match[3], 1)))
        };
      }
      const fallbackName = itemText.split(',单价')[0].trim();
      return fallbackName ? { name: fallbackName, unitPrice: 0, quantity: 1 } : null;
    })
    .filter((item): item is OrderProductItem => Boolean(item));
}

function parseElemeOrderProducts(value: unknown): OrderProductItem[] {
  const text = String(value ?? '').trim();
  if (!text) return [];
  const normalized = text.replace(/\[[^\]]*\]/g, '');
  const wholeMatch = normalized.match(/^(.*?)_(\d+)\*([\d.]+)$/);
  if (wholeMatch) {
    return [{
      name: wholeMatch[1].trim(),
      quantity: Math.max(1, Math.floor(toNumber(wholeMatch[2], 1))),
      unitPrice: roundMoney(toMoneyNumber(wholeMatch[3], 0))
    }].filter(item => Boolean(item.name));
  }
  return normalized
    .split(/[+\/]/)
    .map(part => {
      const itemText = part.trim();
      if (!itemText) return null;
      const match = itemText.match(/^(.*?)_(\d+)\*([\d.]+)/);
      if (match) {
        return {
          name: match[1].trim(),
          quantity: Math.max(1, Math.floor(toNumber(match[2], 1))),
          unitPrice: roundMoney(toMoneyNumber(match[3], 0))
        };
      }
      const optionMatch = itemText.match(/^(.*?)_(\d+)$/);
      if (optionMatch) {
        return {
          name: optionMatch[1].trim(),
          quantity: Math.max(1, Math.floor(toNumber(optionMatch[2], 1))),
          unitPrice: 0
        };
      }
      return { name: itemText, quantity: 1, unitPrice: 0 };
    })
    .filter((item): item is OrderProductItem => Boolean(item?.name));
}

function parseOrderActivityFlags(activityText: unknown, extras: Partial<OrderActivityFlags> = {}): OrderActivityFlags {
  const text = String(activityText ?? '');
  const flags: OrderActivityFlags = {
    ...emptyOrderActivityFlags(),
    deliveryDiscount: /配送费|减配送费|配送费减免/.test(text),
    productDiscount: /商品活动|单品特价|现价|商品折扣|购买.*原价.*现价/.test(text),
    fullReduction: /满\s*\d|店铺满减|满减/.test(text),
    merchantCoupon: /商家代金券|商家券|无门槛券|收藏营销|优惠券/.test(text),
    redPacket: /红包|支付红包|爆单红包|首单/.test(text),
    platformSubsidy: /平台补贴|美团承担|饿了么补贴|代理商承担/.test(text),
    magicCoupon: /神券|爆红包|爆单红包/.test(text),
    pinghaofan: /拼好饭|拼好送/.test(text),
    other: Boolean(text.trim())
  };
  Object.assign(flags, extras);
  flags.other = flags.other && !Object.entries(flags).some(([key, value]) => key !== 'other' && value);
  return flags;
}

function orderRecordBaseFromRow(row: unknown[], header: unknown[], platform: Platform, warnings: string[]) {
  const orderIdIndex = platform === 'meituan' ? orderColumn(header, ['订单编号']) : orderColumn(header, ['订单单号']);
  const orderId = normalizeOrderId(row[orderIdIndex]);
  const orderDateTime = parseOrderDateTime(row[orderColumn(header, ['下单时间'])], row[orderColumn(header, ['日期'])]);
  if (!orderId || !orderDateTime.date) return null;
  const orderStatus = businessText(row, orderColumn(header, ['订单状态']));
  const isValid = platform === 'meituan' ? orderStatus === '已完成' : orderStatus === '订单完结';
  if (!isValid) return null;
  const externalStoreName = businessText(row, orderColumn(header, ['门店名称']));
  const externalStoreId = businessText(row, orderColumn(header, platform === 'meituan' ? ['门店id'] : ['门店编号']));
  const activityText = businessText(row, orderColumn(header, ['活动信息']));
  if (!activityText) warnings.push(`${PLATFORM_NAMES[platform]}订单 ${orderId} 缺少活动信息，活动类型可能低估。`);
  return {
    orderId,
    externalStoreName,
    externalStoreId,
    orderDateTime,
    orderStatus,
    activityText
  };
}

function parseMeituanOrderRecord(row: unknown[], header: unknown[], warnings: string[]): ParsedOrderWorkbook['records'][number] | null {
  const base = orderRecordBaseFromRow(row, header, 'meituan', warnings);
  if (!base) return null;
  const productItems = parseMeituanOrderProducts(row[orderColumn(header, ['商品信息'])]);
  const productOriginal = businessNumber(row, orderColumn(header, ['商品原价']));
  const packageFee = businessNumber(row, orderColumn(header, ['包装费']));
  const deliveryType = businessText(row, orderColumn(header, ['配送类型']));
  const customerPay = businessNumber(row, orderColumn(header, ['订单实付']));
  const totalSubsidy = businessNumber(row, orderColumn(header, ['活动补贴(平台+商家)', '活动补贴']));
  const merchantSubsidy = businessNumber(row, orderColumn(header, ['商家活动支出']));
  const platformSubsidy = Math.max(0, roundMoney(totalSubsidy - merchantSubsidy));
  const isPinghaofan = parseOrderYesNo(row[orderColumn(header, ['是否拼好饭订单'])]) || /拼好/.test(deliveryType);
  const isMagicCoupon = parseOrderYesNo(row[orderColumn(header, ['神券订单'])]);
  const isOutsitePromotion = parseOrderYesNo(row[orderColumn(header, ['神券-站外推广订单'])]);
  const activityFlags = parseOrderActivityFlags(base.activityText, {
    pinghaofan: isPinghaofan,
    magicCoupon: isMagicCoupon
  });
  const grossOriginal = roundMoney(productOriginal + packageFee);
  return {
    platform: 'meituan',
    platformName: PLATFORM_NAMES.meituan,
    orderId: base.orderId,
    externalStoreId: base.externalStoreId,
    externalStoreName: base.externalStoreName,
    orderDate: base.orderDateTime.date,
    orderTime: base.orderDateTime.time,
    orderHour: base.orderDateTime.hour,
    mealPeriod: orderMealPeriodLabel(base.orderDateTime.hour),
    weekdayIndex: businessWeekdayIndex(base.orderDateTime.date),
    orderStatus: base.orderStatus,
    isValid: true,
    deliveryType,
    isPreOrder: parseOrderYesNo(row[orderColumn(header, ['是否预订单'])]),
    isPickup: parseOrderYesNo(row[orderColumn(header, ['是否到店自取'])]) || /自取/.test(deliveryType),
    customerType: 'unknown',
    isMember: false,
    isPinghaofan,
    isMagicCoupon,
    isOutsitePromotion,
    productCount: productItems.reduce((sum, item) => sum + item.quantity, 0),
    productItems,
    productNames: productItems.map(item => item.name),
    activityText: base.activityText,
    activityFlags,
    grossOriginal,
    productOriginal,
    packageFee,
    deliveryFee: businessNumber(row, orderColumn(header, ['配送费'])),
    customerPay,
    totalSubsidy,
    merchantSubsidy,
    platformSubsidy,
    merchantCost: merchantSubsidy,
    discountRate: grossOriginal > 0 ? totalSubsidy / grossOriginal : null
  };
}

function parseElemeOrderRecord(row: unknown[], header: unknown[], warnings: string[]): ParsedOrderWorkbook['records'][number] | null {
  const base = orderRecordBaseFromRow(row, header, 'eleme', warnings);
  if (!base) return null;
  const productItems = parseElemeOrderProducts(row[orderColumn(header, ['商品信息'])]);
  const productOriginal = businessNumber(row, orderColumn(header, ['菜品原价']));
  const packageFee = businessNumber(row, orderColumn(header, ['餐盒费']));
  const platformSubsidy = businessNumber(row, orderColumn(header, ['平台补贴']));
  const merchantSubsidy = businessNumber(row, orderColumn(header, ['商家成本']));
  const totalSubsidy = businessNumber(row, orderColumn(header, ['活动总补贴']), roundMoney(platformSubsidy + merchantSubsidy));
  const deliveryType = businessText(row, orderColumn(header, ['配送方式']));
  const isMagicCoupon = /爆单红包|爆红包/.test(base.activityText);
  const activityFlags = parseOrderActivityFlags(base.activityText, {
    magicCoupon: isMagicCoupon,
    platformSubsidy: platformSubsidy > 0 || /平台补贴/.test(base.activityText)
  });
  const grossOriginal = roundMoney(productOriginal + packageFee);
  return {
    platform: 'eleme',
    platformName: PLATFORM_NAMES.eleme,
    orderId: base.orderId,
    externalStoreId: base.externalStoreId,
    externalStoreName: base.externalStoreName,
    orderDate: base.orderDateTime.date,
    orderTime: base.orderDateTime.time,
    orderHour: base.orderDateTime.hour,
    mealPeriod: orderMealPeriodLabel(base.orderDateTime.hour),
    weekdayIndex: businessWeekdayIndex(base.orderDateTime.date),
    orderStatus: base.orderStatus,
    isValid: true,
    deliveryType,
    isPreOrder: parseOrderYesNo(row[orderColumn(header, ['是否预订单'])]),
    isPickup: /自取/.test(deliveryType),
    customerType: normalizeOrderCustomerType(row[orderColumn(header, ['新老顾客'])]),
    isMember: /会员/.test(businessText(row, orderColumn(header, ['是否品牌会员']))) && !/非会员/.test(businessText(row, orderColumn(header, ['是否品牌会员']))),
    isPinghaofan: false,
    isMagicCoupon,
    isOutsitePromotion: false,
    productCount: Math.max(businessInteger(row, orderColumn(header, ['商品数'])), productItems.reduce((sum, item) => sum + item.quantity, 0)),
    productItems,
    productNames: productItems.map(item => item.name),
    activityText: base.activityText,
    activityFlags,
    grossOriginal,
    productOriginal,
    packageFee,
    deliveryFee: businessNumber(row, orderColumn(header, ['配送费'])),
    customerPay: businessNumber(row, orderColumn(header, ['顾客实付'])),
    totalSubsidy,
    merchantSubsidy,
    platformSubsidy,
    merchantCost: merchantSubsidy,
    discountRate: grossOriginal > 0 ? totalSubsidy / grossOriginal : null
  };
}

export function parseOrderWorkbook(workbook: XLSX.WorkBook, fileName: string): ParsedOrderWorkbook {
  const sheetRows = workbook.SheetNames.map(sheetName => ({
    sheetName,
    rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false })
  }));
  const headerInfo = sheetRows
    .map(sheet => {
      const header = findOrderWorkbookHeader(sheet.rows);
      return header ? { ...header, sheetName: sheet.sheetName, rows: sheet.rows } : null;
    })
    .find(Boolean);
  if (!headerInfo) throw new Error('没有找到可识别的订单明细表头。');
  const warnings: string[] = [];
  let skippedRows = 0;
  const records = headerInfo.rows.slice(headerInfo.rowIndex + 1)
    .filter(rowHasText)
    .map(row => {
      const parsed = headerInfo.platform === 'meituan'
        ? parseMeituanOrderRecord(row, headerInfo.header, warnings)
        : parseElemeOrderRecord(row, headerInfo.header, warnings);
      if (!parsed) skippedRows++;
      return parsed;
    })
    .filter((row): row is ParsedOrderWorkbook['records'][number] => Boolean(row));
  const duplicatedOrders = records
    .map(row => row.orderId)
    .filter((orderId, index, list) => list.indexOf(orderId) !== index);
  if (duplicatedOrders.length) warnings.push(`${fileName} 内存在重复订单号，导入时会保留最后一条。`);
  return {
    platform: headerInfo.platform,
    sheetName: headerInfo.sheetName,
    records,
    skippedRows,
    warnings: Array.from(new Set(warnings)).slice(0, 20)
  };
}

export function summarizeOrderRecords(records: OrderDetailRecord[]): OrderSummary {
  const dates = records.map(row => row.orderDate).filter(Boolean).sort();
  const orderCount = records.length;
  const customerPay = roundMoney(records.reduce((sum, row) => sum + row.customerPay, 0));
  const grossOriginal = roundMoney(records.reduce((sum, row) => sum + row.grossOriginal, 0));
  const productOriginal = roundMoney(records.reduce((sum, row) => sum + row.productOriginal, 0));
  const totalSubsidy = roundMoney(records.reduce((sum, row) => sum + row.totalSubsidy, 0));
  const merchantSubsidy = roundMoney(records.reduce((sum, row) => sum + row.merchantSubsidy, 0));
  const platformSubsidy = roundMoney(records.reduce((sum, row) => sum + row.platformSubsidy, 0));
  return {
    dateStart: dates[0] || '',
    dateEnd: dates[dates.length - 1] || '',
    orderCount,
    platformCount: new Set(records.map(row => row.platform)).size,
    customerPay,
    grossOriginal,
    productOriginal,
    totalSubsidy,
    merchantSubsidy,
    platformSubsidy,
    avgPay: orderCount > 0 ? roundMoney(customerPay / orderCount) : 0,
    avgOriginal: orderCount > 0 ? roundMoney(grossOriginal / orderCount) : 0,
    avgDiscount: orderCount > 0 ? roundMoney(totalSubsidy / orderCount) : 0,
    discountRate: grossOriginal > 0 ? totalSubsidy / grossOriginal : null,
    merchantSubsidyPerOrder: orderCount > 0 ? roundMoney(merchantSubsidy / orderCount) : 0,
    platformSubsidyPerOrder: orderCount > 0 ? roundMoney(platformSubsidy / orderCount) : 0
  };
}

function aggregateOrderRecords(
  records: OrderDetailRecord[],
  groups: Array<{ key: string; label: string; predicate: (row: OrderDetailRecord) => boolean; extra?: Partial<OrderAggregateRow> }>
): OrderAggregateRow[] {
  return groups.map(group => ({
    key: group.key,
    label: group.label,
    ...summarizeOrderRecords(records.filter(group.predicate)),
    ...(group.extra || {})
  }));
}

export function aggregateOrdersByPlatform(records: OrderDetailRecord[]): OrderAggregateRow[] {
  return aggregateOrderRecords(records, PLATFORMS.map(platform => ({
    key: platform,
    label: PLATFORM_NAMES[platform],
    predicate: row => row.platform === platform,
    extra: { platform, platformName: PLATFORM_NAMES[platform] }
  }))).filter(row => row.orderCount > 0);
}

export function aggregateOrdersByMealPeriod(records: OrderDetailRecord[]): OrderAggregateRow[] {
  return aggregateOrderRecords(records, ORDER_MEAL_PERIODS.map(period => ({
    key: period.key,
    label: period.label,
    predicate: row => row.mealPeriod === period.label,
    extra: { mealPeriod: period.label }
  })));
}

export function aggregateOrdersByHour(records: OrderDetailRecord[]): OrderAggregateRow[] {
  return aggregateOrderRecords(records, Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour),
    label: `${String(hour).padStart(2, '0')}:00`,
    predicate: row => row.orderHour === hour,
    extra: { orderHour: hour }
  }))).filter(row => row.orderCount > 0);
}

export function aggregateOrdersByPayBand(records: OrderDetailRecord[]): OrderAggregateRow[] {
  return aggregateOrderRecords(records, ORDER_PAY_BANDS.map(band => ({
    key: band.key,
    label: band.label,
    predicate: row => row.customerPay >= band.min && row.customerPay < band.max,
    extra: { payBandMin: band.min, payBandMax: band.max }
  })));
}

export function aggregateOrdersByActivityType(records: OrderDetailRecord[]): OrderActivityAggregateRow[] {
  return (Object.keys(ORDER_ACTIVITY_TYPE_LABELS) as OrderActivityType[])
    .map(activityType => ({
      key: activityType,
      label: ORDER_ACTIVITY_TYPE_LABELS[activityType],
      activityType,
      activityName: ORDER_ACTIVITY_TYPE_LABELS[activityType],
      ...summarizeOrderRecords(records.filter(row => row.activityFlags[activityType]))
    }))
    .filter(row => row.orderCount > 0);
}

export function aggregateOrdersByProduct(records: OrderDetailRecord[]): OrderProductAggregateRow[] {
  const groups = new Map<string, { records: OrderDetailRecord[]; quantity: number }>();
  records.forEach(row => {
    const orderSeen = new Set<string>();
    row.productItems.forEach(item => {
      const name = normalizeImportedProductName(item.name);
      if (!name) return;
      const group = groups.get(name) || { records: [], quantity: 0 };
      group.quantity += item.quantity;
      if (!orderSeen.has(name)) {
        group.records.push(row);
        orderSeen.add(name);
      }
      groups.set(name, group);
    });
  });
  return Array.from(groups.entries())
    .map(([productName, group]) => ({
      key: productName,
      productName,
      quantity: group.quantity,
      orderShare: records.length > 0 ? group.records.length / records.length : null,
      ...summarizeOrderRecords(group.records)
    }))
    .sort((a, b) => b.orderCount - a.orderCount || b.quantity - a.quantity || a.productName.localeCompare(b.productName, 'zh-CN'));
}

function normalizeOrderProductAnalysisName(value: unknown) {
  return normalizeImportedProductName(value)
    .normalize('NFKC')
    .replace(/[｜|].*$/g, '')
    .replace(/[（(【［\[].*?[）)】］\]]/g, '')
    .replace(/[-－—|｜].*?(?:限量|特惠|热销|销量|人气).*$/g, '')
    .replace(/\b\d+\s*(?:个|份|人份|杯|盒)\b/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function orderActivityComboTypes(row: Pick<OrderDetailRecord, 'activityFlags'>): OrderActivityType[] {
  return (Object.keys(ORDER_ACTIVITY_TYPE_LABELS) as OrderActivityType[])
    .filter(type => type !== 'other' && row.activityFlags[type]);
}

function orderActivityComboName(types: OrderActivityType[]) {
  if (!types.length) return '无明确活动';
  return types.map(type => ORDER_ACTIVITY_TYPE_LABELS[type]).join(' + ');
}

function orderActivityComboKey(types: OrderActivityType[]) {
  return types.length ? types.join('+') : 'none';
}

function findOrderMatchedProduct(products: Product[], item: OrderProductItem): Product | null {
  const normalizedName = normalizeOrderProductAnalysisName(item.name);
  if (!normalizedName) return null;
  const exact = products.find(product => normalizeOrderProductAnalysisName(product.name) === normalizedName);
  if (exact) return exact;
  let best: { product: Product; score: number } | null = null;
  for (const product of products) {
    const productName = normalizeOrderProductAnalysisName(product.name);
    if (!productName) continue;
    const similarity = productNameSimilarity(productName, normalizedName);
    const contains = productName.includes(normalizedName) || normalizedName.includes(productName);
    const score = contains ? Math.max(similarity, 0.9) : similarity;
    if (score < 0.72) continue;
    if (!best || score > best.score) best = { product, score };
  }
  return best?.product || null;
}

export function enrichOrderRecords(records: OrderDetailRecord[], products: Product[]): EnrichedOrderDetailRecord[] {
  return records.map(row => {
    const matchedProductNames: string[] = [];
    const unmatchedProductNames: string[] = [];
    let estimatedProductCost = 0;
    let matchedProductCount = 0;
    let unmatchedProductCount = 0;
    row.productItems.forEach(item => {
      const product = findOrderMatchedProduct(products, item);
      const quantity = Math.max(1, Math.floor(toNumber(item.quantity, 1)));
      if (product && product.cost > 0) {
        estimatedProductCost += product.cost * quantity;
        matchedProductCount += quantity;
        matchedProductNames.push(product.name);
      } else {
        unmatchedProductCount += quantity;
        unmatchedProductNames.push(item.name);
      }
    });
    const activityTypes = orderActivityComboTypes(row);
    const estimatedProfit = unmatchedProductCount > 0 ? null : roundMoney(row.customerPay - estimatedProductCost);
    return {
      ...row,
      activityComboKey: orderActivityComboKey(activityTypes),
      activityComboName: orderActivityComboName(activityTypes),
      estimatedProductCost: roundMoney(estimatedProductCost),
      estimatedProfit,
      estimatedProfitRate: estimatedProfit !== null && row.customerPay > 0 ? estimatedProfit / row.customerPay : null,
      matchedProductCount,
      unmatchedProductCount,
      matchedProductNames: Array.from(new Set(matchedProductNames)),
      unmatchedProductNames: Array.from(new Set(unmatchedProductNames))
    };
  });
}

export function summarizeOrderProfit(records: EnrichedOrderDetailRecord[]): OrderProfitSummary {
  const knownRows = records.filter(row => row.estimatedProfit !== null);
  const estimatedProductCost = roundMoney(knownRows.reduce((sum, row) => sum + row.estimatedProductCost, 0));
  const estimatedProfit = roundMoney(knownRows.reduce((sum, row) => sum + (row.estimatedProfit || 0), 0));
  const customerPay = roundMoney(knownRows.reduce((sum, row) => sum + row.customerPay, 0));
  const lossOrderCount = knownRows.filter(row => (row.estimatedProfit || 0) < 0).length;
  return {
    knownOrderCount: knownRows.length,
    unknownOrderCount: records.length - knownRows.length,
    lossOrderCount,
    estimatedProductCost,
    estimatedProfit,
    avgEstimatedProfit: knownRows.length ? roundMoney(estimatedProfit / knownRows.length) : null,
    estimatedProfitRate: customerPay > 0 ? estimatedProfit / customerPay : null,
    costCoverageRate: records.length ? knownRows.length / records.length : null,
    lossOrderRate: knownRows.length ? lossOrderCount / knownRows.length : null
  };
}

function summarizeEstimatedProfitForOrders(records: EnrichedOrderDetailRecord[]) {
  const profit = summarizeOrderProfit(records);
  return {
    avgEstimatedProfit: profit.avgEstimatedProfit,
    estimatedProfitRate: profit.estimatedProfitRate,
    lossOrderCount: profit.lossOrderCount,
    profitKnownOrderCount: profit.knownOrderCount
  };
}

function aggregateEnrichedOrders(
  records: EnrichedOrderDetailRecord[],
  groups: Array<{ key: string; label: string; predicate: (row: EnrichedOrderDetailRecord) => boolean; extra?: Partial<OrderCrossAggregateRow> }>
): OrderCrossAggregateRow[] {
  return groups.map(group => {
    const rows = records.filter(group.predicate);
    const profit = summarizeEstimatedProfitForOrders(rows);
    return {
      key: group.key,
      primary: group.label,
      secondary: '',
      label: group.label,
      ...summarizeOrderRecords(rows),
      avgEstimatedProfit: profit.avgEstimatedProfit,
      estimatedProfitRate: profit.estimatedProfitRate,
      lossOrderCount: profit.lossOrderCount,
      ...(group.extra || {})
    };
  });
}

export function aggregateOrdersByActivityCombo(records: EnrichedOrderDetailRecord[]): OrderActivityComboRow[] {
  const groups = new Map<string, EnrichedOrderDetailRecord[]>();
  records.forEach(row => {
    const group = groups.get(row.activityComboKey) || [];
    group.push(row);
    groups.set(row.activityComboKey, group);
  });
  return Array.from(groups.entries())
    .map(([key, rows]) => {
      const first = rows[0];
      const activityTypes = key === 'none' ? [] : key.split('+') as OrderActivityType[];
      const profit = summarizeEstimatedProfitForOrders(rows);
      return {
        key,
        label: first?.activityComboName || orderActivityComboName(activityTypes),
        activityTypes,
        ...summarizeOrderRecords(rows),
        avgEstimatedProfit: profit.avgEstimatedProfit,
        estimatedProfitRate: profit.estimatedProfitRate,
        profitKnownOrderCount: profit.profitKnownOrderCount,
        lossOrderCount: profit.lossOrderCount
      };
    })
    .sort((a, b) => b.orderCount - a.orderCount || b.merchantSubsidyPerOrder - a.merchantSubsidyPerOrder);
}

export function aggregateOrdersByPlatformPayBand(records: EnrichedOrderDetailRecord[]): OrderCrossAggregateRow[] {
  return PLATFORMS.flatMap(platform => ORDER_PAY_BANDS.map(band => {
    const label = `${PLATFORM_NAMES[platform]} / ${band.label}`;
    return aggregateEnrichedOrders(records, [{
      key: `${platform}-${band.key}`,
      label,
      predicate: row => row.platform === platform && row.customerPay >= band.min && row.customerPay < band.max,
      extra: {
        primary: PLATFORM_NAMES[platform],
        secondary: band.label,
        platform,
        platformName: PLATFORM_NAMES[platform],
        payBandLabel: band.label
      }
    }])[0];
  })).filter(row => row.orderCount > 0);
}

export function aggregateOrdersByMealPeriodPayBand(records: EnrichedOrderDetailRecord[]): OrderCrossAggregateRow[] {
  return ORDER_MEAL_PERIODS.flatMap(period => ORDER_PAY_BANDS.map(band => {
    const label = `${period.label} / ${band.label}`;
    return aggregateEnrichedOrders(records, [{
      key: `${period.key}-${band.key}`,
      label,
      predicate: row => row.mealPeriod === period.label && row.customerPay >= band.min && row.customerPay < band.max,
      extra: {
        primary: period.label,
        secondary: band.label,
        mealPeriod: period.label,
        payBandLabel: band.label
      }
    }])[0];
  })).filter(row => row.orderCount > 0);
}

export function aggregateOrdersByActivityComboPayBand(records: EnrichedOrderDetailRecord[]): OrderCrossAggregateRow[] {
  const combos = aggregateOrdersByActivityCombo(records).slice(0, 12);
  return combos.flatMap(combo => ORDER_PAY_BANDS.map(band => {
    const label = `${combo.label} / ${band.label}`;
    return aggregateEnrichedOrders(records, [{
      key: `${combo.key}-${band.key}`,
      label,
      predicate: row => row.activityComboKey === combo.key && row.customerPay >= band.min && row.customerPay < band.max,
      extra: {
        primary: combo.label,
        secondary: band.label,
        activityComboName: combo.label,
        payBandLabel: band.label
      }
    }])[0];
  })).filter(row => row.orderCount > 0);
}

export function aggregateEnrichedOrdersByProduct(records: EnrichedOrderDetailRecord[], products: Product[]): OrderProductAggregateRow[] {
  const groups = new Map<string, { records: EnrichedOrderDetailRecord[]; quantity: number; matchedProduct: Product | null; rawNames: Set<string> }>();
  records.forEach(row => {
    const orderSeen = new Set<string>();
    row.productItems.forEach(item => {
      const normalizedName = normalizeOrderProductAnalysisName(item.name) || normalizeImportedProductName(item.name);
      if (!normalizedName) return;
      const group = groups.get(normalizedName) || { records: [], quantity: 0, matchedProduct: null, rawNames: new Set<string>() };
      group.quantity += Math.max(1, Math.floor(toNumber(item.quantity, 1)));
      group.rawNames.add(normalizeImportedProductName(item.name));
      if (!group.matchedProduct) group.matchedProduct = findOrderMatchedProduct(products, item);
      if (!orderSeen.has(normalizedName)) {
        group.records.push(row);
        orderSeen.add(normalizedName);
      }
      groups.set(normalizedName, group);
    });
  });
  return Array.from(groups.entries())
    .map(([normalizedProductName, group]) => {
      const summary = summarizeOrderRecords(group.records);
      const profit = summarizeOrderProfit(group.records);
      const productName = group.matchedProduct?.name || Array.from(group.rawNames).sort((a, b) => a.length - b.length)[0] || normalizedProductName;
      const matchedOrderCount = group.records.filter(row => row.matchedProductNames.includes(group.matchedProduct?.name || '')).length;
      return {
        key: normalizedProductName,
        productName,
        normalizedProductName,
        quantity: group.quantity,
        orderShare: records.length > 0 ? group.records.length / records.length : null,
        matchedProductName: group.matchedProduct?.name,
        matchedProductCost: group.matchedProduct?.cost,
        matchedOrderCount: group.matchedProduct ? matchedOrderCount : 0,
        unmatchedOrderCount: group.matchedProduct ? group.records.length - matchedOrderCount : group.records.length,
        avgEstimatedProfit: profit.avgEstimatedProfit,
        estimatedProfitRate: profit.estimatedProfitRate,
        ...summary
      };
    })
    .sort((a, b) => b.orderCount - a.orderCount || b.quantity - a.quantity || a.productName.localeCompare(b.productName, 'zh-CN'));
}

export function buildOrderOperationRecommendations(
  summary: OrderSummary,
  profit: OrderProfitSummary,
  payBands: OrderAggregateRow[],
  platformPayBands: OrderCrossAggregateRow[],
  mealPayBands: OrderCrossAggregateRow[],
  activityCombos: OrderActivityComboRow[],
  products: OrderProductAggregateRow[]
): OrderOperationRecommendation[] {
  const items: OrderOperationRecommendation[] = [];
  if (!summary.orderCount) return items;
  const lowPayRows = payBands.filter(row => row.payBandMax !== undefined && row.payBandMax <= 15);
  const lowPayOrders = lowPayRows.reduce((sum, row) => sum + row.orderCount, 0);
  const lowPayMerchantSubsidy = average(lowPayRows.filter(row => row.orderCount > 0).map(row => row.merchantSubsidyPerOrder));
  const highSubsidyLowBand = lowPayRows
    .filter(row => row.orderCount >= Math.max(5, summary.orderCount * 0.05))
    .sort((a, b) => (b.discountRate || 0) - (a.discountRate || 0))[0];
  if (highSubsidyLowBand && (highSubsidyLowBand.discountRate || 0) >= 0.65) {
    items.push({
      key: 'low-pay-subsidy',
      priority: 'high',
      title: '低支付价补贴过重',
      evidence: `${highSubsidyLowBand.label} 元区间 ${highSubsidyLowBand.orderCount} 单，让利率 ${rateText(highSubsidyLowBand.discountRate)}，商家单均补贴 ¥${money(highSubsidyLowBand.merchantSubsidyPerOrder)}。`,
      action: '收紧该区间的商家券/商品折扣叠加，只保留平台强补或拼好饭入口；普通活动不要继续把成交压到该支付价。',
      expectedImpact: '减少低价亏损单，把补贴预算转到 15-25 元主成交区。'
    });
  }
  if (lowPayOrders / summary.orderCount >= 0.45) {
    items.push({
      key: 'pay-band-upgrade',
      priority: 'medium',
      title: '成交过度集中在低客单',
      evidence: `0-15 元订单 ${lowPayOrders} 单，占 ${rateText(lowPayOrders / summary.orderCount)}，低价区平均商家补贴约 ¥${money(lowPayMerchantSubsidy || 0)}。`,
      action: '设计“饭团 + 饮品/蛋/小食”的 15-20 元套餐，低门槛券改成加购券或组合券。',
      expectedImpact: '在不明显牺牲订单量的前提下，把主成交带从 10-15 元推向 15-20 元。'
    });
  }
  const costlyPlatformBand = platformPayBands
    .filter(row => row.orderCount >= Math.max(5, summary.orderCount * 0.04))
    .sort((a, b) => b.merchantSubsidyPerOrder - a.merchantSubsidyPerOrder)[0];
  if (costlyPlatformBand && costlyPlatformBand.merchantSubsidyPerOrder > summary.merchantSubsidyPerOrder * 1.2) {
    items.push({
      key: 'platform-band-cost',
      priority: 'medium',
      title: '平台与支付价需要分开控补贴',
      evidence: `${costlyPlatformBand.primary} ${costlyPlatformBand.secondary} 元区间 ${costlyPlatformBand.orderCount} 单，商家单均补贴 ¥${money(costlyPlatformBand.merchantSubsidyPerOrder)}，高于整体 ¥${money(summary.merchantSubsidyPerOrder)}。`,
      action: '对该平台该价位单独调整券门槛和商品活动，不用全平台统一活动力度。',
      expectedImpact: '保留平台订单量，同时降低高补贴区间的商家承担。'
    });
  }
  const topMeal = mealPayBands
    .filter(row => row.orderCount >= Math.max(6, summary.orderCount * 0.04))
    .sort((a, b) => b.orderCount - a.orderCount)[0];
  if (topMeal && topMeal.avgPay < summary.avgPay) {
    items.push({
      key: 'meal-pay-upgrade',
      priority: 'medium',
      title: '高峰餐段支付价偏低',
      evidence: `${topMeal.primary} ${topMeal.secondary} 元区间 ${topMeal.orderCount} 单，单均实付 ¥${money(topMeal.avgPay)}，低于整体 ¥${money(summary.avgPay)}。`,
      action: '高峰时段减少纯降价活动，优先上架组合套餐和加购券，主推能把实付拉到 15-20 元的商品组。',
      expectedImpact: '用高峰订单量承接客单提升，而不是继续买低价单。'
    });
  }
  const costlyCombo = activityCombos
    .filter(row => row.orderCount >= Math.max(5, summary.orderCount * 0.04))
    .sort((a, b) => b.merchantSubsidyPerOrder - a.merchantSubsidyPerOrder)[0];
  if (costlyCombo && costlyCombo.merchantSubsidyPerOrder > summary.merchantSubsidyPerOrder * 1.15) {
    items.push({
      key: 'activity-combo-cost',
      priority: 'high',
      title: '活动组合叠加成本偏高',
      evidence: `${costlyCombo.label} 覆盖 ${costlyCombo.orderCount} 单，商家单均补贴 ¥${money(costlyCombo.merchantSubsidyPerOrder)}，单均实付 ¥${money(costlyCombo.avgPay)}。`,
      action: '把该组合拆开看：保留转化贡献大的入口，限制商家券、商品折扣、配送减免同时叠加。',
      expectedImpact: '降低重复让利，避免同一订单被多种活动同时补贴。'
    });
  }
  const lossProduct = products
    .filter(row => (row.avgEstimatedProfit ?? 0) < 0 && row.orderCount >= 3)
    .sort((a, b) => (a.avgEstimatedProfit || 0) - (b.avgEstimatedProfit || 0))[0];
  if (lossProduct) {
    items.push({
      key: 'product-loss',
      priority: 'high',
      title: '存在疑似亏损商品成交',
      evidence: `${lossProduct.productName} 关联 ${lossProduct.orderCount} 单，估算单均毛利 ¥${money(lossProduct.avgEstimatedProfit || 0)}。`,
      action: '优先检查该商品成本、规格和活动价；若成本匹配正确，应减少折扣或改为套餐加价项。',
      expectedImpact: '减少单品亏损，同时保留热销商品的流量价值。'
    });
  }
  if (profit.costCoverageRate !== null && profit.costCoverageRate < 0.7) {
    items.push({
      key: 'cost-coverage',
      priority: 'config',
      title: '成本匹配覆盖不足',
      evidence: `当前只有 ${rateText(profit.costCoverageRate)} 的订单能完整估算成本，${profit.unknownOrderCount} 单存在未匹配商品。`,
      action: '先在商品表补齐成本，并合并同名/规格变体；成本覆盖不足时，不宜直接按毛利结论调活动。',
      expectedImpact: '提高订单分析可信度，让系统能识别真实亏损订单和高毛利组合。'
    });
  }
  const priorityRank: Record<Severity, number> = { critical: 4, high: 3, medium: 2, config: 1, none: 0 };
  return items
    .sort((a, b) => priorityRank[b.priority] - priorityRank[a.priority])
    .slice(0, 8);
}

export function orderPayBandTargetText(row: OrderAggregateRow | null) {
  if (!row || row.orderCount <= 0) return '暂无足够订单判断支付价主战场。';
  if (row.avgPay < 15) return '成交集中在低支付价，活动方向以拉单、爆品和低门槛券为主，注意回到测算结果校验低价风险。';
  if (row.avgPay < 25) return '这是当前较健康的主支付区，活动方向以稳定覆盖和少量加购券为主。';
  return '支付价偏高但订单仍集中，活动方向可以测试加购和高门槛券，不必继续压低基础成交价。';
}

export function buildOrderInsights(summary: OrderSummary, payBands: OrderAggregateRow[], mealPeriods: OrderAggregateRow[], activities: OrderActivityAggregateRow[]): OrderInsightItem[] {
  const insights: OrderInsightItem[] = [];
  if (!summary.orderCount) return insights;
  const topPayBand = payBands.slice().sort((a, b) => b.orderCount - a.orderCount || a.avgPay - b.avgPay)[0] || null;
  if (topPayBand) {
    insights.push({
      key: 'top-pay-band',
      title: '支付价主战场',
      description: `${topPayBand.label} 元区间贡献 ${topPayBand.orderCount} 单，单均实付 ¥${money(topPayBand.avgPay)}。`,
      suggestion: orderPayBandTargetText(topPayBand)
    });
  }
  const topMealPeriod = mealPeriods.slice().sort((a, b) => b.orderCount - a.orderCount)[0] || null;
  if (topMealPeriod) {
    insights.push({
      key: 'top-meal-period',
      title: '时间偏好',
      description: `${topMealPeriod.label}订单最多，共 ${topMealPeriod.orderCount} 单，单均实付 ¥${money(topMealPeriod.avgPay)}。`,
      suggestion: topMealPeriod.avgPay < summary.avgPay
        ? '高峰时段成交价低于整体均值，优先稳住订单量，再用小额加购券拉高搭配。'
        : '高峰时段支付能力不低，可以围绕该时段配置主推组合和高门槛活动。'
    });
  }
  const topActivity = activities.slice().sort((a, b) => b.orderCount - a.orderCount || b.avgPay - a.avgPay)[0] || null;
  if (topActivity) {
    insights.push({
      key: 'top-activity',
      title: '活动偏好',
      description: `${topActivity.activityName}覆盖 ${topActivity.orderCount} 单，单均商家补贴 ¥${money(topActivity.merchantSubsidyPerOrder)}。`,
      suggestion: topActivity.avgPay < summary.avgPay
        ? '该活动更偏低价成交，适合拉单或爆品，不宜作为全时段主活动无限叠加。'
        : '该活动能承接较高支付价订单，可优先和提高客单价目标联动。'
    });
  }
  if (summary.discountRate !== null) {
    insights.push({
      key: 'discount-rate',
      title: '让利强度',
      description: `当前订单平均让利率 ${rateText(summary.discountRate)}，单均总补贴 ¥${money(summary.avgDiscount)}。`,
      suggestion: summary.discountRate > 0.45
        ? '让利偏重，后续活动方向应重点比较订单量是否真的随低支付价增加。'
        : '让利强度仍有观察空间，可优先把优惠集中到订单集中的支付价和时段。'
    });
  }
  return insights;
}

export function orderAnalysisExportRows(
  summary: OrderSummary,
  payBands: OrderAggregateRow[],
  mealPeriods: OrderAggregateRow[],
  activities: OrderActivityAggregateRow[],
  products: OrderProductAggregateRow[],
  profit: OrderProfitSummary,
  activityCombos: OrderActivityComboRow[],
  platformPayBands: OrderCrossAggregateRow[],
  mealPayBands: OrderCrossAggregateRow[],
  recommendations: OrderOperationRecommendation[]
) {
  const summaryRows = [{
    类型: '总览',
    名称: '当前筛选',
    订单数: summary.orderCount,
    单均实付: money(summary.avgPay),
    单均原价: money(summary.avgOriginal),
    单均补贴: money(summary.avgDiscount),
    平均让利率: summary.discountRate === null ? '' : rateText(summary.discountRate),
    商家单均补贴: money(summary.merchantSubsidyPerOrder),
    平台单均补贴: money(summary.platformSubsidyPerOrder),
    估算单均毛利: profit.avgEstimatedProfit === null ? '' : money(profit.avgEstimatedProfit),
    估算毛利率: profit.estimatedProfitRate === null ? '' : rateText(profit.estimatedProfitRate),
    亏损订单数: profit.lossOrderCount,
    成本覆盖率: profit.costCoverageRate === null ? '' : rateText(profit.costCoverageRate),
    行动建议: ''
  }];
  const mapAggregate = (type: string, rows: Array<OrderAggregateRow | OrderActivityComboRow | OrderCrossAggregateRow>) => rows.map(row => ({
    类型: type,
    名称: row.label,
    订单数: row.orderCount,
    单均实付: money(row.avgPay),
    单均原价: money(row.avgOriginal),
    单均补贴: money(row.avgDiscount),
    平均让利率: row.discountRate === null ? '' : rateText(row.discountRate),
    商家单均补贴: money(row.merchantSubsidyPerOrder),
    平台单均补贴: money(row.platformSubsidyPerOrder),
    估算单均毛利: 'avgEstimatedProfit' in row && row.avgEstimatedProfit !== null && row.avgEstimatedProfit !== undefined ? money(row.avgEstimatedProfit) : '',
    估算毛利率: 'estimatedProfitRate' in row && row.estimatedProfitRate !== null && row.estimatedProfitRate !== undefined ? rateText(row.estimatedProfitRate) : '',
    亏损订单数: 'lossOrderCount' in row ? row.lossOrderCount : '',
    成本覆盖率: '',
    行动建议: ''
  }));
  const productRows = products.slice(0, 100).map(row => ({
    类型: '商品',
    名称: row.productName,
    订单数: row.orderCount,
    单均实付: money(row.avgPay),
    单均原价: money(row.avgOriginal),
    单均补贴: money(row.avgDiscount),
    平均让利率: row.discountRate === null ? '' : rateText(row.discountRate),
    商家单均补贴: money(row.merchantSubsidyPerOrder),
    平台单均补贴: money(row.platformSubsidyPerOrder),
    估算单均毛利: row.avgEstimatedProfit === null || row.avgEstimatedProfit === undefined ? '' : money(row.avgEstimatedProfit),
    估算毛利率: row.estimatedProfitRate === null || row.estimatedProfitRate === undefined ? '' : rateText(row.estimatedProfitRate),
    亏损订单数: '',
    成本覆盖率: '',
    行动建议: row.matchedProductName ? `匹配：${row.matchedProductName}` : '未匹配商品表'
  }));
  const recommendationRows = recommendations.map(row => ({
    类型: '运营建议',
    名称: row.title,
    订单数: '',
    单均实付: '',
    单均原价: '',
    单均补贴: '',
    平均让利率: '',
    商家单均补贴: '',
    平台单均补贴: '',
    估算单均毛利: '',
    估算毛利率: '',
    亏损订单数: '',
    成本覆盖率: '',
    行动建议: `${row.evidence}；${row.action}；${row.expectedImpact}`
  }));
  return [
    ...summaryRows,
    ...recommendationRows,
    ...mapAggregate('支付价区间', payBands),
    ...mapAggregate('餐段', mealPeriods),
    ...mapAggregate('活动类型', activities),
    ...mapAggregate('活动组合', activityCombos),
    ...mapAggregate('平台×支付价', platformPayBands),
    ...mapAggregate('餐段×支付价', mealPayBands),
    ...productRows
  ];
}
