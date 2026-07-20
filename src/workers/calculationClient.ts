import type {
  ActivityDesignResult,
  ActivityDesignSettings,
  CalculatorState,
  CalculationLimits,
  CalculationProgress,
  ComboEvaluationRow,
  MeasurementResult,
  MeasurementSettings,
  Platform,
  PricingEvaluationResult,
  PricingEvaluationSettings
} from '../domain/types';

type CalculationPayloadMap = {
  pricingEvaluation: {
    state: CalculatorState;
    platformFilter: Platform | 'all';
    settings: PricingEvaluationSettings;
  };
  activityDesign: {
    state: CalculatorState;
    platformFilter: Platform | 'all';
    settings: ActivityDesignSettings;
  };
  measurement: {
    state: CalculatorState;
    platformFilter: Platform | 'all';
    settings: MeasurementSettings;
  };
};

type CalculationResultMap = {
  pricingEvaluation: PricingEvaluationResult;
  activityDesign: ActivityDesignResult;
  measurement: MeasurementResult;
};

type WorkerResponse<T> =
  | { id: string; status: 'progress'; progress: CalculationProgress }
  | { id: string; status: 'chunk'; rows: ComboEvaluationRow[] }
  | { id: string; status: 'done'; result: T }
  | { id: string; status: 'error'; message: string };

export type CalculationTaskOptions = CalculationLimits & {
  timeoutMs?: number;
  signal?: AbortSignal;
  onRowsChunk?: (rows: ComboEvaluationRow[]) => void | Promise<void>;
};

const DEFAULT_TASK_MAX_DURATION_MS = 30000;
const WORKER_TIMEOUT_BUFFER_MS = 5000;
const reusableWorkers: Partial<Record<keyof CalculationPayloadMap, Worker>> = {};

function createTaskId(type: string) {
  return `${type}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizedDuration(value: unknown, fallback: number) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0) return fallback;
  return Math.max(1000, Math.floor(duration));
}

function createAbortError(message: string) {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function calculationWorkerFor(type: keyof CalculationPayloadMap) {
  const current = reusableWorkers[type];
  if (current) return current;
  const worker = new Worker(new URL('./calculation.worker.ts', import.meta.url), { type: 'module' });
  reusableWorkers[type] = worker;
  return worker;
}

function disposeCalculationWorker(type: keyof CalculationPayloadMap, worker: Worker) {
  if (reusableWorkers[type] === worker) delete reusableWorkers[type];
  worker.terminate();
}

export function isCalculationAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError';
}

export function runCalculationTask<T extends keyof CalculationPayloadMap>(
  type: T,
  payload: CalculationPayloadMap[T],
  onProgress?: (progress: CalculationProgress) => void,
  options?: CalculationTaskOptions
): Promise<CalculationResultMap[T]> {
  if (typeof Worker === 'undefined') {
    return Promise.reject(new Error('当前浏览器不支持后台计算 Worker'));
  }
  if (options?.signal?.aborted) {
    return Promise.reject(createAbortError('后台计算已取消'));
  }
  const id = createTaskId(type);
  const maxDurationMs = normalizedDuration(options?.maxDurationMs, DEFAULT_TASK_MAX_DURATION_MS);
  const timeoutMs = normalizedDuration(options?.timeoutMs, maxDurationMs + WORKER_TIMEOUT_BUFFER_MS);
  const worker = calculationWorkerFor(type);
  return new Promise((resolve, reject) => {
    let settled = false;
    let chunkWriteError: unknown = null;
    const chunkWrites: Promise<void>[] = [];
    let chunkWriteChain = Promise.resolve();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const cleanup = (terminateWorker: boolean) => {
      if (timeoutId) clearTimeout(timeoutId);
      options?.signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      if (terminateWorker) disposeCalculationWorker(type, worker);
    };
    const settle = (callback: () => void, terminateWorker = false) => {
      if (settled) return;
      settled = true;
      cleanup(terminateWorker);
      callback();
    };
    const abort = () => {
      settle(() => reject(createAbortError('后台计算已取消')), true);
    };
    options?.signal?.addEventListener('abort', abort, { once: true });
    timeoutId = setTimeout(() => {
      settle(() => reject(new Error(`后台计算超过 ${Math.round(timeoutMs / 1000)} 秒，已自动终止。请缩小商品组合范围或降低最大检查次数。`)), true);
    }, timeoutMs);
    worker.onmessage = event => {
      const message = event.data as WorkerResponse<CalculationResultMap[T]>;
      if (message.id !== id) return;
      if (message.status === 'chunk') {
        if (settled || !options?.onRowsChunk) return;
        chunkWriteChain = chunkWriteChain
          .then(() => options.onRowsChunk?.(message.rows))
          .then(() => undefined)
          .catch(error => {
            chunkWriteError = error;
            settle(() => reject(error instanceof Error ? error : new Error('测算分块写入失败')), true);
          });
        chunkWrites.push(chunkWriteChain);
        return;
      }
      if (message.status === 'progress') {
        if (!settled) onProgress?.(message.progress);
        return;
      }
      if (message.status === 'done') {
        Promise.all(chunkWrites)
          .then(() => {
            if (chunkWriteError) {
              settle(() => reject(chunkWriteError instanceof Error ? chunkWriteError : new Error('测算分块写入失败')));
              return;
            }
            settle(() => resolve(message.result));
          })
          .catch(error => settle(() => reject(error instanceof Error ? error : new Error('测算分块写入失败'))));
        return;
      }
      settle(() => reject(new Error(message.message)));
    };
    worker.onerror = event => {
      settle(() => reject(new Error(event.message || '后台计算 Worker 执行失败')), true);
    };
    worker.postMessage({ id, type, payload, limits: { maxDurationMs } });
  });
}
