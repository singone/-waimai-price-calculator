'use client';

import type {
  ActivityDesignSettings,
  ActivityDesignResult,
  ActivityPriceBucketRow,
  ActivityScanComboPools,
  ComboEvaluationRow,
  MeasurementResult,
  MeasurementSettings,
  Platform,
  PriceBandRow,
  StapleScenario
} from '../domain/types';

const STORAGE_KEY = 'waimai_store_activity_calculator_v2';
const DB_NAME = 'waimai-price-calculator';
const DB_VERSION = 3;
const STATE_STORE = 'states';
const MEASUREMENT_RESULTS_STORE = 'measurement_results';
const ACTIVITY_PRICE_SCANS_STORE = 'activity_price_scans';
const REQUIRED_OBJECT_STORES = [STATE_STORE, MEASUREMENT_RESULTS_STORE, ACTIVITY_PRICE_SCANS_STORE] as const;
const DEFAULT_STATE_KEY = 'default';

export type MeasurementPersistenceMeta = {
  generatedAt: string;
  originalMax: number | null;
  payMax: number | null;
  rowCount: number;
};

export type PersistedMeasurementRecord = {
  key: string;
  storeId: string;
  storeName: string;
  scenario: StapleScenario;
  generatedAt: string;
  settings: MeasurementSettings;
  meta: MeasurementPersistenceMeta;
  payBands?: PriceBandRow[];
  chunkKeys?: string[];
  rows: ComboEvaluationRow[];
  warnings: string[];
  summary: MeasurementResult['summary'];
};

export type ActivityPriceScanPersistenceMeta = {
  storeId: string;
  generatedAt: string;
  originalMax: number | null;
  bucketCount: number;
  mainComboCount: number;
  addOnComboCount: number;
  mainComboCountByPlatform?: Partial<Record<Platform, number>>;
  addOnComboCountByPlatform?: Partial<Record<Platform, number>>;
};

export type PersistedActivityPriceScanRecord = {
  key: string;
  storeId: string;
  storeName: string;
  generatedAt: string;
  signature: string;
  meta: ActivityPriceScanPersistenceMeta;
  scanComboPools: ActivityScanComboPools;
  originalPriceBuckets: ActivityPriceBucketRow[];
};

export type MeasurementChunkRecord = {
  key: string;
  parentKey: string;
  index: number;
  rows: ComboEvaluationRow[];
  rowCount: number;
};

type StateRecord<TState> = {
  key: string;
  value: TState;
  updatedAt: string;
};

type BrowserDataRepositoryDeps<TState, TStore extends { id: string; name: string }> = {
  scenarios: StapleScenario[];
  normalizeState: (data: unknown) => TState;
  measurementRecordKey: (storeId: string, scenario: StapleScenario) => string;
  measurementChunkKey: (parentKey: string, runId: string, index: number) => string;
  activityPriceScanRecordKey: (storeId: string) => string;
  buildPersistedMeasurementRecord: (
    store: TStore,
    scenario: StapleScenario,
    settings: MeasurementSettings,
    result: MeasurementResult,
    chunkKeys?: string[]
  ) => PersistedMeasurementRecord;
  buildPersistedActivityPriceScanRecord: (
    state: TState,
    store: TStore,
    settings: ActivityDesignSettings,
    result: ActivityDesignResult
  ) => PersistedActivityPriceScanRecord;
  normalizeCachedMeasurementRows: (value: unknown) => ComboEvaluationRow[];
  isMeasurementRowInDisplayFilters: (row: ComboEvaluationRow, store: TStore, settings: MeasurementSettings) => boolean;
  sortMeasurementRows: (rows: ComboEvaluationRow[]) => ComboEvaluationRow[];
};

export type AppDataRepository<TState, TStore extends { id: string; name: string }> = {
  loadCalculatorState: () => Promise<TState | null>;
  saveCalculatorState: (value: TState) => Promise<void>;
  loadMeasurementRecord: (storeId: string, scenario: StapleScenario) => Promise<PersistedMeasurementRecord | undefined>;
  loadMeasurementRecords: (storeId: string) => Promise<PersistedMeasurementRecord[]>;
  saveMeasurementRecord: (store: TStore, scenario: StapleScenario, settings: MeasurementSettings, result: MeasurementResult) => Promise<PersistedMeasurementRecord>;
  loadActivityPriceScanRecord: (storeId: string) => Promise<PersistedActivityPriceScanRecord | undefined>;
  saveActivityPriceScanRecord: (state: TState, store: TStore, settings: ActivityDesignSettings, result: ActivityDesignResult) => Promise<PersistedActivityPriceScanRecord>;
  deleteMeasurementRecordChunks: (record: PersistedMeasurementRecord | undefined) => Promise<void>;
  createMeasurementChunkWriter: (parentKey: string) => {
    keys: () => string[];
    write: (rows: ComboEvaluationRow[]) => Promise<void>;
  };
  saveChunkedMeasurementRecord: (store: TStore, scenario: StapleScenario, settings: MeasurementSettings, result: MeasurementResult, chunkKeys: string[]) => Promise<PersistedMeasurementRecord>;
  loadMeasurementRows: (
    record: PersistedMeasurementRecord,
    filters: {
      store: TStore;
      settings: MeasurementSettings;
      platform: Platform;
      payBand: PriceBandRow | null;
      limit: number;
    }
  ) => Promise<{ rows: ComboEvaluationRow[]; matchedCount: number; truncated: boolean }>;
};

function ensureBrowserObjectStores(db: IDBDatabase) {
  REQUIRED_OBJECT_STORES.forEach(storeName => {
    if (!db.objectStoreNames.contains(storeName)) {
      db.createObjectStore(storeName, { keyPath: 'key' });
    }
  });
}

function hasRequiredObjectStores(db: IDBDatabase) {
  return REQUIRED_OBJECT_STORES.every(storeName => db.objectStoreNames.contains(storeName));
}

function openBrowserDatabase(targetVersion?: number, repaired = false): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持 IndexedDB'));
      return;
    }
    const request = targetVersion === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, targetVersion);
    request.onupgradeneeded = () => {
      ensureBrowserObjectStores(request.result);
    };
    request.onsuccess = () => {
      const db = request.result;
      if (hasRequiredObjectStores(db)) {
        resolve(db);
        return;
      }
      const nextVersion = Math.max(db.version + 1, DB_VERSION);
      db.close();
      if (repaired) {
        reject(new Error('浏览器数据库结构升级失败，请刷新页面后重试。'));
        return;
      }
      openBrowserDatabase(nextVersion, true).then(resolve, reject);
    };
    request.onerror = () => reject(request.error || new Error('打开 IndexedDB 失败'));
  });
}

function browserDbStoreTransaction<T>(storeName: string, mode: IDBTransactionMode, executor: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openBrowserDatabase().then(db => new Promise<T>((resolve, reject) => {
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      request = executor(store);
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 操作失败'));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('IndexedDB 事务失败'));
    };
  }));
}

function browserDbStoreAction<T>(storeName: string, mode: IDBTransactionMode, executor: (store: IDBObjectStore) => T): Promise<T> {
  return openBrowserDatabase().then(db => new Promise<T>((resolve, reject) => {
    let result: T;
    try {
      const transaction = db.transaction(storeName, mode);
      const store = transaction.objectStore(storeName);
      result = executor(store);
      transaction.oncomplete = () => {
        db.close();
        resolve(result);
      };
      transaction.onerror = () => {
        db.close();
        reject(transaction.error || new Error('IndexedDB 事务失败'));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error || new Error('IndexedDB 事务已中断'));
      };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

function browserDbTransaction<T>(mode: IDBTransactionMode, executor: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return browserDbStoreTransaction(STATE_STORE, mode, executor);
}

function saveStateToBrowserDb<TState>(value: TState) {
  const record: StateRecord<TState> = {
    key: DEFAULT_STATE_KEY,
    value,
    updatedAt: new Date().toISOString()
  };
  return browserDbTransaction<IDBValidKey>('readwrite', store => store.put(record));
}

async function loadStateFromBrowserDb<TState>(normalizeState: (data: unknown) => TState) {
  const record = await browserDbTransaction<StateRecord<TState> | undefined>('readonly', store => store.get(DEFAULT_STATE_KEY));
  if (record?.value) return normalizeState(record.value);

  const legacy = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
  if (!legacy) return null;
  const migrated = normalizeState(JSON.parse(legacy));
  await saveStateToBrowserDb(migrated);
  return migrated;
}

export function createBrowserDataRepository<TState, TStore extends { id: string; name: string }>(deps: BrowserDataRepositoryDeps<TState, TStore>): AppDataRepository<TState, TStore> {
  const loadMeasurementRecord = async (storeId: string, scenario: StapleScenario) => (
    browserDbStoreTransaction<PersistedMeasurementRecord | undefined>(
      MEASUREMENT_RESULTS_STORE,
      'readonly',
      store => store.get(deps.measurementRecordKey(storeId, scenario))
    )
  );

  const loadActivityPriceScanRecord = async (storeId: string) => (
    browserDbStoreTransaction<PersistedActivityPriceScanRecord | undefined>(
      ACTIVITY_PRICE_SCANS_STORE,
      'readonly',
      store => store.get(deps.activityPriceScanRecordKey(storeId))
    )
  );

  const deleteLegacyActivityPriceScanRecordChunks = async (record: unknown) => {
    const chunkKeys = Array.isArray((record as { chunkKeys?: unknown } | undefined)?.chunkKeys)
      ? (record as { chunkKeys: string[] }).chunkKeys
      : [];
    if (!chunkKeys.length) return;
    await browserDbStoreAction(ACTIVITY_PRICE_SCANS_STORE, 'readwrite', objectStore => {
      chunkKeys.forEach(key => objectStore.delete(key));
      return undefined;
    });
  };

  const deleteMeasurementRecordChunks = async (record: PersistedMeasurementRecord | undefined) => {
    if (!record?.chunkKeys?.length) return;
    await browserDbStoreAction(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => {
      record.chunkKeys?.forEach(key => objectStore.delete(key));
      return undefined;
    });
  };

  const createMeasurementChunkWriter = (parentKey: string) => {
    const chunkKeys: string[] = [];
    const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let index = 0;
    return {
      keys: () => chunkKeys.slice(),
      async write(rows: ComboEvaluationRow[]) {
        if (!rows.length) return;
        const key = deps.measurementChunkKey(parentKey, runId, index++);
        const record: MeasurementChunkRecord = {
          key,
          parentKey,
          index: index - 1,
          rows: deps.normalizeCachedMeasurementRows(rows),
          rowCount: rows.length
        };
        await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
        chunkKeys.push(key);
      }
    };
  };

  const loadMeasurementChunk = async (key: string) => (
    browserDbStoreTransaction<MeasurementChunkRecord | undefined>(MEASUREMENT_RESULTS_STORE, 'readonly', store => store.get(key))
  );

  return {
    loadCalculatorState: () => loadStateFromBrowserDb(deps.normalizeState),
    saveCalculatorState: async value => {
      await saveStateToBrowserDb(value);
    },
    loadMeasurementRecord,
    loadMeasurementRecords: async storeId => {
      const records = await Promise.all(deps.scenarios.map(scenario => loadMeasurementRecord(storeId, scenario)));
      return records.filter((record): record is PersistedMeasurementRecord => Boolean(record));
    },
    saveMeasurementRecord: async (store, scenario, settings, result) => {
      const record = deps.buildPersistedMeasurementRecord(store, scenario, settings, result);
      await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
      return record;
    },
    loadActivityPriceScanRecord,
    saveActivityPriceScanRecord: async (state, store, settings, result) => {
      const previousRecord = await loadActivityPriceScanRecord(store.id);
      const record = deps.buildPersistedActivityPriceScanRecord(state, store, settings, result);
      await browserDbStoreTransaction<IDBValidKey>(ACTIVITY_PRICE_SCANS_STORE, 'readwrite', objectStore => objectStore.put(record));
      await deleteLegacyActivityPriceScanRecordChunks(previousRecord);
      return record;
    },
    deleteMeasurementRecordChunks,
    createMeasurementChunkWriter,
    saveChunkedMeasurementRecord: async (store, scenario, settings, result, chunkKeys) => {
      const record = deps.buildPersistedMeasurementRecord(store, scenario, settings, result, chunkKeys);
      await browserDbStoreTransaction<IDBValidKey>(MEASUREMENT_RESULTS_STORE, 'readwrite', objectStore => objectStore.put(record));
      return record;
    },
    loadMeasurementRows: async (record, filters) => {
      const rows: ComboEvaluationRow[] = [];
      let matchedCount = 0;
      const accept = (row: ComboEvaluationRow) => {
        if (row.platform !== filters.platform) return false;
        if (filters.payBand && (row.finalPay + 1e-9 < filters.payBand.min || row.finalPay >= filters.payBand.max - 1e-9)) return false;
        return deps.isMeasurementRowInDisplayFilters(row, filters.store, filters.settings);
      };
      const consumeRows = (sourceRows: ComboEvaluationRow[]) => {
        for (const row of sourceRows) {
          if (!accept(row)) continue;
          matchedCount++;
          if (rows.length < filters.limit) rows.push(row);
        }
      };

      if (record.chunkKeys?.length) {
        for (const key of record.chunkKeys) {
          const chunk = await loadMeasurementChunk(key);
          if (chunk?.rows?.length) consumeRows(deps.normalizeCachedMeasurementRows(chunk.rows));
        }
      } else {
        consumeRows(deps.normalizeCachedMeasurementRows(record.rows));
      }

      return {
        rows: deps.sortMeasurementRows(rows),
        matchedCount,
        truncated: matchedCount > rows.length
      };
    }
  };
}
