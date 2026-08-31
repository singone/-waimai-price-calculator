'use client';

import type {
  AppDataRepository,
  MeasurementChunkRecord,
  PersistedActivityPriceScanRecord,
  PersistedMeasurementRecord
} from './browserDataRepository';
import type {
  ActivityDesignResult,
  ActivityDesignSettings,
  CalculatorState,
  ComboEvaluationRow,
  MeasurementResult,
  MeasurementSettings,
  StapleScenario
} from '../domain/types';
import { backendRequest } from './backendClient';

type BackendDataRepositoryDeps<TState, TStore extends { id: string; name: string }> = {
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

/**
 * 创建通过后台 API 持久化数据的仓库实现。
 */
export function createBackendDataRepository<TState extends CalculatorState, TStore extends { id: string; name: string }>(
  deps: BackendDataRepositoryDeps<TState, TStore>
): AppDataRepository<TState, TStore> {
  const loadMeasurementRecord = async (storeId: string, scenario: StapleScenario) => {
    const key = deps.measurementRecordKey(storeId, scenario);
    const payload = await backendRequest<{ record: PersistedMeasurementRecord | null }>(`/api/calculator/measurements?key=${encodeURIComponent(key)}`);
    return payload.record || undefined;
  };

  const loadMeasurementChunk = async (key: string) => {
    const payload = await backendRequest<{ record: MeasurementChunkRecord | null }>(`/api/calculator/measurement-chunks?key=${encodeURIComponent(key)}`);
    return payload.record || undefined;
  };

  return {
    loadCalculatorState: async () => {
      const payload = await backendRequest<{ state: unknown | null }>('/api/calculator/state');
      return payload.state ? deps.normalizeState(payload.state) : null;
    },
    saveCalculatorState: async value => {
      await backendRequest('/api/calculator/state', {
        method: 'PUT',
        body: JSON.stringify({ state: value })
      });
    },
    loadMeasurementRecord,
    loadMeasurementRecords: async storeId => {
      const records = await Promise.all(deps.scenarios.map(scenario => loadMeasurementRecord(storeId, scenario)));
      return records.filter((record): record is PersistedMeasurementRecord => Boolean(record));
    },
    saveMeasurementRecord: async (store, scenario, settings, result) => {
      const record = deps.buildPersistedMeasurementRecord(store, scenario, settings, result);
      await backendRequest('/api/calculator/measurements', {
        method: 'PUT',
        body: JSON.stringify({ record })
      });
      return record;
    },
    loadActivityPriceScanRecord: async storeId => {
      const key = deps.activityPriceScanRecordKey(storeId);
      const payload = await backendRequest<{ record: PersistedActivityPriceScanRecord | null }>(`/api/calculator/activity-price-scans?key=${encodeURIComponent(key)}`);
      return payload.record || undefined;
    },
    saveActivityPriceScanRecord: async (state, store, settings, result) => {
      const record = deps.buildPersistedActivityPriceScanRecord(state, store, settings, result);
      await backendRequest('/api/calculator/activity-price-scans', {
        method: 'PUT',
        body: JSON.stringify({ record })
      });
      return record;
    },
    deleteMeasurementRecordChunks: async record => {
      const keys = record?.chunkKeys || [];
      if (!keys.length) return;
      await backendRequest('/api/calculator/measurement-chunks', {
        method: 'DELETE',
        body: JSON.stringify({ keys })
      });
    },
    createMeasurementChunkWriter: parentKey => {
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
          await backendRequest('/api/calculator/measurement-chunks', {
            method: 'PUT',
            body: JSON.stringify({ record })
          });
          chunkKeys.push(key);
        }
      };
    },
    saveChunkedMeasurementRecord: async (store, scenario, settings, result, chunkKeys) => {
      const record = deps.buildPersistedMeasurementRecord(store, scenario, settings, result, chunkKeys);
      await backendRequest('/api/calculator/measurements', {
        method: 'PUT',
        body: JSON.stringify({ record })
      });
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
