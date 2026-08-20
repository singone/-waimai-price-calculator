'use client';

import * as XLSX from 'xlsx';
import { PLATFORM_NAMES } from '../../domain/core';
import {
  findOrderWorkbookHeader,
  normalizeOrderAnalysisState,
  normalizeOrderDetailRecord,
  parseOrderWorkbook
} from '../../domain/orderAnalysis';
import type {
  OrderAnalysisState,
  OrderDetailRecord,
  ParsedOrderWorkbook
} from '../../domain/orderAnalysis';
import { readImportWorkbook } from '../../utils/importWorkbook';

const DB_NAME = 'waimai-price-calculator';
const ORDER_ANALYSIS_STORE = 'order_analysis';
const LEGACY_STATE_STORE = 'states';
const DEFAULT_KEY = 'default';

type OrderAnalysisRecord = {
  key: string;
  value: OrderAnalysisState;
  updatedAt: string;
};

type ImportOrderAnalysisInput = {
  file: File;
  currentState: OrderAnalysisState;
  storeId: string;
  storeName: string;
};

type ImportOrderAnalysisResult = {
  state: OrderAnalysisState;
  importedCount: number;
  replacedOrders: number;
  platformName: string;
  warnings: string[];
};

function uid(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function openOrderAnalysisDatabase(repaired = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }

    const request = indexedDB.open(DB_NAME);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(ORDER_ANALYSIS_STORE)) {
        request.result.createObjectStore(ORDER_ANALYSIS_STORE, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (db.objectStoreNames.contains(ORDER_ANALYSIS_STORE)) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      if (repaired) {
        reject(new Error('订单分析数据表升级失败，请刷新页面后重试。'));
        return;
      }
      const upgradeRequest = indexedDB.open(DB_NAME, nextVersion);
      upgradeRequest.onupgradeneeded = () => {
        if (!upgradeRequest.result.objectStoreNames.contains(ORDER_ANALYSIS_STORE)) {
          upgradeRequest.result.createObjectStore(ORDER_ANALYSIS_STORE, { keyPath: 'key' });
        }
      };
      upgradeRequest.onsuccess = () => resolve(upgradeRequest.result);
      upgradeRequest.onerror = () => reject(upgradeRequest.error || new Error('订单分析数据库升级失败'));
    };
    request.onerror = () => reject(request.error || new Error('打开订单分析数据库失败'));
  });
}

function orderAnalysisStoreTransaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openOrderAnalysisDatabase().then(db => new Promise<T>((resolve, reject) => {
    let request: IDBRequest<T>;
    try {
      const transaction = db.transaction(storeName, mode);
      request = executor(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('订单分析数据库操作失败'));
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('订单分析数据库事务失败'));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

async function loadLegacyOrderAnalysisState() {
  try {
    const record = await orderAnalysisStoreTransaction<{ value?: { orderAnalysis?: OrderAnalysisState } } | undefined>(
      LEGACY_STATE_STORE,
      'readonly',
      store => store.get(DEFAULT_KEY)
    );
    return normalizeOrderAnalysisState(record?.value?.orderAnalysis);
  } catch {
    return normalizeOrderAnalysisState(undefined);
  }
}

export async function loadOrderAnalysisState() {
  try {
    const record = await orderAnalysisStoreTransaction<OrderAnalysisRecord | undefined>(
      ORDER_ANALYSIS_STORE,
      'readonly',
      store => store.get(DEFAULT_KEY)
    );
    if (record?.value) return normalizeOrderAnalysisState(record.value);

    const legacy = await loadLegacyOrderAnalysisState();
    if (legacy.records.length || legacy.imports.length) {
      await saveOrderAnalysisState(legacy);
    }
    return legacy;
  } catch {
    return normalizeOrderAnalysisState(undefined);
  }
}

export function saveOrderAnalysisState(value: OrderAnalysisState) {
  const record: OrderAnalysisRecord = {
    key: DEFAULT_KEY,
    value: normalizeOrderAnalysisState(value),
    updatedAt: new Date().toISOString()
  };
  return orderAnalysisStoreTransaction<IDBValidKey>(
    ORDER_ANALYSIS_STORE,
    'readwrite',
    store => store.put(record)
  );
}

function orderWorkbookHeaderScore(workbook: XLSX.WorkBook) {
  let score = 0;
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false });
    if (findOrderWorkbookHeader(rows)) score = Math.max(score, 100);
  });
  return score;
}

export async function importOrderAnalysisFileToState({
  file,
  currentState,
  storeId,
  storeName
}: ImportOrderAnalysisInput): Promise<ImportOrderAnalysisResult> {
  const parsed = parseOrderWorkbook(await readImportWorkbook(file, orderWorkbookHeaderScore), file.name);
  const rowsByOrderId = new Map<string, ParsedOrderWorkbook['records'][number]>();
  parsed.records.forEach(row => {
    rowsByOrderId.set(row.orderId, row);
  });
  const sourceRows = Array.from(rowsByOrderId.values())
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime));
  if (!sourceRows.length) {
    throw new Error('没有识别到有效订单，请确认文件是美团或饿了么订单明细导出。');
  }

  const importedAt = new Date().toISOString();
  const importBatchId = uid('order-import');
  const orderIds = new Set(sourceRows.map(row => row.orderId));
  const replacedOrders = currentState.records
    .filter(row => row.storeId === storeId && orderIds.has(row.orderId))
    .length;
  const warnings = Array.from(new Set(parsed.warnings)).filter(Boolean);
  const nextRecords = sourceRows
    .map(row => normalizeOrderDetailRecord({
      ...row,
      key: row.orderId,
      storeId,
      storeName,
      sourceFileName: file.name,
      importBatchId,
      importedAt
    }))
    .filter((row): row is OrderDetailRecord => Boolean(row));
  const dateStart = nextRecords[0]?.orderDate || '';
  const dateEnd = nextRecords[nextRecords.length - 1]?.orderDate || '';
  const state = normalizeOrderAnalysisState({
    records: currentState.records
      .filter(row => !(row.storeId === storeId && orderIds.has(row.orderId)))
      .concat(nextRecords)
      .sort((a, b) => a.storeId.localeCompare(b.storeId) || a.orderDate.localeCompare(b.orderDate) || a.orderTime.localeCompare(b.orderTime)),
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
      replacedOrders,
      skippedRows: parsed.skippedRows,
      warnings
    }, ...currentState.imports].slice(0, 100)
  });

  return {
    state,
    importedCount: nextRecords.length,
    replacedOrders,
    platformName: PLATFORM_NAMES[parsed.platform],
    warnings
  };
}
