'use client';

import dayjs, { type Dayjs } from 'dayjs';
import * as XLSX from 'xlsx';
import { PLATFORM_NAMES, PLATFORMS } from '../../domain/core';
import { average, roundMoney } from '../../domain/money';
import type { Platform, Severity } from '../../domain/types';
import { readImportWorkbook } from '../../utils/importWorkbook';

export { roundMoney };

const DB_NAME = 'waimai-price-calculator';
const BUSINESS_DATA_STORE = 'business_data';
const LEGACY_STATE_STORE = 'states';
const DEFAULT_KEY = 'default';

export function money(value: unknown) {
  return roundMoney(value).toFixed(2);
}

export function rateText(rate: number | null | undefined) {
  return Number.isFinite(rate) ? `${((rate as number) * 100).toFixed(2)}%` : '无法计算';
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


export type BusinessDataMetricKey = 'actualReceipt' | 'validOrders' | 'exposureUsers' | 'visitRate' | 'orderRate' | 'merchantActivityCost' | 'tradedProductRate' | 'newOrderUsers' | 'oldOrderUsers' | 'newOrderRate' | 'oldOrderRate' | 'repeatRate7d' | 'repeatRate30d' | 'platformRepeatRate';

export type BusinessDailyRecord = {
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

export type BusinessDataImportBatch = {
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

export type BusinessAnalysisNoteKind = 'memo' | 'diagnostic';

export type BusinessAnalysisNote = {
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

export type BusinessNoteEditorState = {
  id?: string;
  dateStart: string;
  dateEnd: string;
  platform: Platform | 'all';
  title: string;
  content: string;
};

export type BusinessDiagnosticItem = {
  key: string;
  severity: Severity;
  title: string;
  description: string;
  suggestion: string;
  currentText: string;
  baselineText: string;
};

export type BusinessDataState = {
  records: BusinessDailyRecord[];
  imports: BusinessDataImportBatch[];
  notes: BusinessAnalysisNote[];
};

export type BusinessDataSummary = {
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

export type BusinessDailyAggregate = BusinessDataSummary & {
  key: string;
  date: string;
};

export type BusinessPlatformAggregate = BusinessDataSummary & {
  key: string;
  platform: Platform;
  platformName: string;
};

export type BusinessWeekdayCell = BusinessDataSummary & {
  date: string;
  weekdayIndex: number;
};

export type BusinessWeekComparisonRow = {
  key: string;
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  platform: Platform;
  platformName: string;
  days: Record<number, BusinessWeekdayCell | undefined>;
  total: BusinessDataSummary;
};

export type BusinessFunnelMetricSource = Pick<BusinessDataSummary, 'exposureUsers' | 'visitUsers' | 'orderUsers' | 'validOrders' | 'visitRate' | 'orderRate'>;
export type BusinessFunnelChartRow = {
  key: string;
  stage: string;
  value: number;
  valueText: string;
  conversionTitleText: string;
  conversionRateText: string;
  conversionText: string;
  totalConversionText: string;
};

export type ParsedBusinessReport = {
  platform: Platform;
  sheetName: string;
  records: Array<Omit<BusinessDailyRecord, 'key' | 'storeId' | 'storeName' | 'sourceFileName' | 'importBatchId' | 'importedAt'>>;
  warnings: string[];
};

export function normalizeBusinessDate(value: unknown) {
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

export function normalizeBusinessRate(value: unknown, fallback: number | null = null) {
  const text = String(value ?? '').trim();
  if (!text || text === '-') return fallback;
  const parsed = toNumber(text.replace('%', ''), Number.NaN);
  if (!Number.isFinite(parsed)) return fallback;
  return text.includes('%') || parsed > 1 ? parsed / 100 : parsed;
}

export function normalizeBusinessDailyRecord(row: Partial<BusinessDailyRecord> | undefined): BusinessDailyRecord | null {
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

export function normalizeBusinessData(value: Partial<BusinessDataState> | undefined): BusinessDataState {
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

export function businessNumber(row: unknown[], index: number, fallback = 0) {
  return index >= 0 ? toMoneyNumber(row[index], fallback) : fallback;
}

export function businessInteger(row: unknown[], index: number, fallback = 0) {
  return Math.max(0, Math.floor(toNumber(index >= 0 ? row[index] : fallback, fallback)));
}

export function businessOptionalInteger(row: unknown[], index: number) {
  return index >= 0 ? Math.max(0, Math.floor(toNumber(row[index], 0))) : 0;
}

export function businessText(row: unknown[], index: number) {
  return index >= 0 ? String(row[index] ?? '').trim() : '';
}

export function businessRate(row: unknown[], index: number) {
  return index >= 0 ? normalizeBusinessRate(row[index]) : null;
}

export function businessColumn(row: unknown[], candidates: string[]) {
  return findImportColumnIndex(row, candidates);
}

export function businessExactColumn(row: unknown[], candidates: string[]) {
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

export function businessReportWorkbookHeaderScore(workbook: XLSX.WorkBook) {
  let score = 0;
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    if (findBusinessReportHeader(rows)) score = Math.max(score, 90);
    rows.slice(0, 30).forEach(row => {
      const matchedFields = [
        '日期',
        '门店名称',
        '有效订单'
      ].filter(field => findImportColumnIndex(row || [], [field]) >= 0).length;
      score = Math.max(score, matchedFields);
    });
  });
  return score;
}

const readBusinessReportWorkbook = (file: File) => readImportWorkbook(file, businessReportWorkbookHeaderScore);

export function businessDateRangeText(start: string, end: string) {
  if (start && end && start !== end) return `${start} 至 ${end}`;
  return start || end || '全部日期';
}

export const BUSINESS_NOTE_LIMIT = 300;

export function businessUtcDate(dateText: string) {
  const normalized = normalizeBusinessDate(dateText);
  if (!normalized) return null;
  const [year, month, day] = normalized.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

export function businessDateFromUtc(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function businessAddDays(dateText: string, days: number) {
  const date = businessUtcDate(dateText);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return businessDateFromUtc(date);
}

export function businessWeekdayIndex(dateText: string) {
  const date = businessUtcDate(dateText);
  if (!date) return 0;
  return (date.getUTCDay() + 6) % 7;
}

export function businessWeekStart(dateText: string) {
  const date = businessUtcDate(dateText);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return businessDateFromUtc(date);
}

export function businessWeekLabel(weekStart: string) {
  const weekEnd = businessAddDays(weekStart, 6);
  return businessDateRangeText(weekStart, weekEnd);
}

export function businessDateSpanDays(startText: string, endText: string) {
  const start = businessUtcDate(startText);
  const end = businessUtcDate(endText);
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}

export function normalizeBusinessDateRange(startText: string, endText: string) {
  const start = normalizeBusinessDate(startText);
  const end = normalizeBusinessDate(endText);
  if (!start && !end) return { dateStart: '', dateEnd: '' };
  if (!start) return { dateStart: end, dateEnd: end };
  if (!end) return { dateStart: start, dateEnd: start };
  return start <= end ? { dateStart: start, dateEnd: end } : { dateStart: end, dateEnd: start };
}

export function businessNoteDateStart(note: BusinessAnalysisNote) {
  return note.dateStart || note.dateEnd;
}

export function businessNoteDateEnd(note: BusinessAnalysisNote) {
  return note.dateEnd || note.dateStart;
}

export function businessNoteContainsDate(note: BusinessAnalysisNote, dateText: string) {
  const date = normalizeBusinessDate(dateText);
  if (!date) return false;
  const start = businessNoteDateStart(note);
  const end = businessNoteDateEnd(note);
  return (!start || date >= start) && (!end || date <= end);
}

export function businessNoteOverlapsDateRange(note: BusinessAnalysisNote, startText: string, endText: string) {
  const range = normalizeBusinessDateRange(startText, endText);
  if (!range.dateStart && !range.dateEnd) return true;
  const noteStart = businessNoteDateStart(note);
  const noteEnd = businessNoteDateEnd(note);
  if (!noteStart && !noteEnd) return true;
  if (range.dateStart && noteEnd && noteEnd < range.dateStart) return false;
  if (range.dateEnd && noteStart && noteStart > range.dateEnd) return false;
  return true;
}

export function businessNoteMatchesPlatformFilter(note: BusinessAnalysisNote, platform: Platform | 'all') {
  return platform === 'all' || note.platform === 'all' || note.platform === platform;
}

export function businessNoteMatchesRecord(note: BusinessAnalysisNote, row: BusinessDailyRecord) {
  return note.kind === 'memo'
    && businessNoteContainsDate(note, row.date)
    && (note.platform === 'all' || note.platform === row.platform);
}

export function businessNoteItemsText(note: BusinessAnalysisNote) {
  return note.items.join('；');
}

export function businessMonthStart(dateText: string) {
  const normalized = normalizeBusinessDate(dateText);
  if (!normalized) return '';
  return `${normalized.slice(0, 7)}-01`;
}

export function businessMonthEnd(monthStart: string) {
  const date = businessUtcDate(monthStart);
  if (!date) return '';
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return businessDateFromUtc(date);
}

export function businessDateToDayjs(dateText: string): Dayjs | null {
  const normalized = normalizeBusinessDate(dateText);
  return normalized ? dayjs(normalized) : null;
}

export function businessSummaryEmpty(): BusinessDataSummary {
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

export function businessRollingRepeatRate(records: BusinessDailyRecord[], usersField: keyof BusinessDailyRecord, rateField: keyof BusinessDailyRecord) {
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

export function summarizeBusinessRecords(records: BusinessDailyRecord[]): BusinessDataSummary {
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

export function aggregateBusinessRecordsByDate(records: BusinessDailyRecord[]): BusinessDailyAggregate[] {
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

export function aggregateBusinessRecordsByPlatform(records: BusinessDailyRecord[]): BusinessPlatformAggregate[] {
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

export function aggregateBusinessRecordsByWeekday(records: BusinessDailyRecord[]): BusinessWeekComparisonRow[] {
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

export function businessMetricValue(row: BusinessDataSummary, metric: BusinessDataMetricKey) {
  if (metric === 'tradedProductRate') return row.tradedProductRate;
  return row[metric];
}

export function businessMetricName(metric: BusinessDataMetricKey) {
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

export function businessMetricText(metric: BusinessDataMetricKey, value: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-';
  if (metric === 'visitRate' || metric === 'orderRate' || metric === 'tradedProductRate' || metric === 'newOrderRate' || metric === 'oldOrderRate' || metric === 'repeatRate7d' || metric === 'repeatRate30d' || metric === 'platformRepeatRate') return rateText(value);
  if (metric === 'validOrders' || metric === 'exposureUsers' || metric === 'newOrderUsers' || metric === 'oldOrderUsers') return `${Math.round(value)}`;
  return `¥${money(value)}`;
}

export function businessFunnelMetrics(row: BusinessFunnelMetricSource) {
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

export function businessFunnelStageText(row: BusinessFunnelMetricSource) {
  return `曝光 ${row.exposureUsers} → 入店 ${row.visitUsers} → 下单 ${row.orderUsers}`;
}

export function businessFunnelChartRows(row: BusinessFunnelMetricSource): BusinessFunnelChartRow[] {
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

export function businessCustomerFunnelChartRows(row: BusinessDataSummary, segment: 'new' | 'old'): BusinessFunnelChartRow[] {
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

export function businessPrimaryRepeatRate(row: Pick<BusinessDataSummary, 'repeatRate7d' | 'repeatRate30d' | 'platformRepeatRate'>) {
  if (row.repeatRate30d !== null) return { label: '近30日复购率', value: row.repeatRate30d };
  if (row.repeatRate7d !== null) return { label: '近7日复购率', value: row.repeatRate7d };
  if (row.platformRepeatRate !== null) return { label: '平台复购率', value: row.platformRepeatRate };
  return { label: '复购率', value: null };
}

export function businessRepeatSummaryText(row: Pick<BusinessDataSummary, 'repeatUsers7d' | 'repeatRate7d' | 'repeatUsers30d' | 'repeatRate30d' | 'platformRepeatRate'>) {
  const parts = [
    row.repeatRate7d === null ? '' : `近7日 ${rateText(row.repeatRate7d)}${row.repeatUsers7d ? ` / ${row.repeatUsers7d}人` : ''}`,
    row.repeatRate30d === null ? '' : `近30日 ${rateText(row.repeatRate30d)}${row.repeatUsers30d ? ` / ${row.repeatUsers30d}人` : ''}`,
    row.platformRepeatRate === null ? '' : `平台原始 ${rateText(row.platformRepeatRate)}`
  ].filter(Boolean);
  return parts.length ? parts.join('；') : '日报未提供';
}

export function businessChangeText(metric: BusinessDataMetricKey, current: number | null, baseline: number | null) {
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

export function businessDiagnosticColor(severity: Severity) {
  if (severity === 'critical') return 'red';
  if (severity === 'high') return 'orange';
  if (severity === 'medium') return 'gold';
  if (severity === 'config') return 'blue';
  return 'green';
}

export function businessDiagnosticSeverityText(severity: Severity) {
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

export function diagnoseBusinessRecords(records: BusinessDailyRecord[]): BusinessDiagnosticItem[] {
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

export function businessReportExportRows(records: BusinessDailyRecord[], notes: BusinessAnalysisNote[] = []) {
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

export function businessImportedAtText(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

type BusinessDataRecord = {
  key: string;
  value: BusinessDataState;
  updatedAt: string;
};

type ImportBusinessReportInput = {
  file: File;
  currentState: BusinessDataState;
  storeId: string;
  storeName: string;
};

type ImportBusinessReportResult = {
  state: BusinessDataState;
  importedCount: number;
  replacedDates: string[];
  platformName: string;
  warnings: string[];
};

function openBusinessDataDatabase(repaired = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(BUSINESS_DATA_STORE)) {
        request.result.createObjectStore(BUSINESS_DATA_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(BUSINESS_DATA_STORE)) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      if (repaired) {
        reject(new Error('经营分析数据表升级失败，请刷新页面后重试。'));
        return;
      }
      const upgradeRequest = indexedDB.open(DB_NAME, nextVersion);
      upgradeRequest.onupgradeneeded = () => {
        if (!upgradeRequest.result.objectStoreNames.contains(BUSINESS_DATA_STORE)) {
          upgradeRequest.result.createObjectStore(BUSINESS_DATA_STORE, { keyPath: 'key' });
        }
      };
      upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
      upgradeRequest.onerror = () => reject(upgradeRequest.error || new Error('经营分析数据库升级失败'));
    };
    request.onerror = () => reject(request.error || new Error('打开经营分析数据库失败'));
  });
}

function businessDataStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openBusinessDataDatabase().then(db => new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>;
    try {
      const transaction = db.transaction(storeName, mode);
      request = executor(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('经营分析数据库操作失败'));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('经营分析数据库事务失败'));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

async function loadLegacyBusinessDataState() {
  try {
    const record = await businessDataStoreTransaction<{ value?: { businessData?: BusinessDataState } } | undefined>(
      LEGACY_STATE_STORE,
      'readonly',
      store => store.get(DEFAULT_KEY)
    );
    return normalizeBusinessData(record?.value?.businessData);
  } catch {
    return normalizeBusinessData(undefined);
  }
}

export async function loadBusinessDataState() {
  try {
    const record = await businessDataStoreTransaction<BusinessDataRecord | undefined>(
      BUSINESS_DATA_STORE,
      'readonly',
      store => store.get(DEFAULT_KEY)
    );
    if (record?.value) return normalizeBusinessData(record.value);

    const legacy = await loadLegacyBusinessDataState();
    if (legacy.records.length || legacy.imports.length || legacy.notes.length) {
      await saveBusinessDataState(legacy);
    }
    return legacy;
  } catch {
    return normalizeBusinessData(undefined);
  }
}

export function saveBusinessDataState(value: BusinessDataState) {
  const record: BusinessDataRecord = {
    key: DEFAULT_KEY,
    value: normalizeBusinessData(value),
    updatedAt: new Date().toISOString()
  };
  return businessDataStoreTransaction<IDBValidKey>(
    BUSINESS_DATA_STORE,
    'readwrite',
    store => store.put(record)
  );
}

export async function importBusinessReportFileToState({
  file,
  currentState,
  storeId,
  storeName
}: ImportBusinessReportInput): Promise<ImportBusinessReportResult> {
  const parsed = parseBusinessReportWorkbook(await readBusinessReportWorkbook(file), file.name);
  const rowsByDate = new Map<string, ParsedBusinessReport['records'][number]>();
  parsed.records.forEach(row => {
    rowsByDate.set(row.date, row);
  });
  const sourceRows = Array.from(rowsByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
  if (!sourceRows.length) {
    throw new Error('没有识别到有效经营日报，请确认文件包含日期、门店名称和有效订单。');
  }

  const importedAt = new Date().toISOString();
  const importBatchId = uid('business-import');
  const dateSet = new Set(sourceRows.map(row => row.date));
  const replacedDates = Array.from(new Set(
    currentState.records
      .filter(row => row.storeId === storeId && row.platform === parsed.platform && dateSet.has(row.date))
      .map(row => row.date)
  )).sort();
  const warnings = Array.from(new Set([
    ...parsed.warnings,
    ...sourceRows.flatMap(row => row.warnings || [])
  ])).filter(Boolean);
  const nextRecords = sourceRows
    .map(row => normalizeBusinessDailyRecord({
      ...row,
      key: `${storeId}:${row.platform}:${row.date}`,
      storeId,
      storeName,
      sourceFileName: file.name,
      importBatchId,
      importedAt
    }))
    .filter((row): row is BusinessDailyRecord => Boolean(row));
  const dateStart = nextRecords[0]?.date || '';
  const dateEnd = nextRecords[nextRecords.length - 1]?.date || '';
  const state = normalizeBusinessData({
    records: currentState.records
      .filter(row => !(row.storeId === storeId && row.platform === parsed.platform && dateSet.has(row.date)))
      .concat(nextRecords)
      .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.date.localeCompare(b.date) || a.platform.localeCompare(b.platform)),
    imports: [{
      id: importBatchId,
      storeId,
      storeName,
      platform: parsed.platform,
      platformName: PLATFORM_NAMES[parsed.platform],
      fileName: file.name,
      importedAt,
      dateStart,
      dateEnd,
      rowCount: nextRecords.length,
      replacedDates,
      warnings
    }, ...currentState.imports].slice(0, 100),
    notes: currentState.notes
  });

  return {
    state,
    importedCount: nextRecords.length,
    replacedDates,
    platformName: PLATFORM_NAMES[parsed.platform],
    warnings
  };
}
