import { runActivityDesignCalculation } from '../domain/activity/activityDesigner';
import { runPricingEvaluationCalculation } from '../domain/pricing/pricingEvaluation';
import { runMeasurementCalculation } from '../domain/results/resultAggregator';
import type {
  ActivityDesignSettings,
  CalculatorState,
  CalculationLimits,
  CalculationProgress,
  ComboEvaluationRow,
  MeasurementSettings,
  Platform,
  PricingEvaluationSettings
} from '../domain/types';

type CalculationTask =
  | {
    id: string;
    type: 'pricingEvaluation';
    limits?: CalculationLimits;
    payload: {
      state: CalculatorState;
      platformFilter: Platform | 'all';
      settings: PricingEvaluationSettings;
    };
  }
  | {
    id: string;
    type: 'activityDesign';
    limits?: CalculationLimits;
    payload: {
      state: CalculatorState;
      platformFilter: Platform | 'all';
      settings: ActivityDesignSettings;
    };
  }
  | {
    id: string;
    type: 'measurement';
    limits?: CalculationLimits;
    payload: {
      state: CalculatorState;
      platformFilter: Platform | 'all';
      settings: MeasurementSettings;
    };
  };

type WorkerResponse =
  | { id: string; status: 'progress'; progress: CalculationProgress }
  | { id: string; status: 'chunk'; rows: ComboEvaluationRow[] }
  | { id: string; status: 'done'; result: unknown }
  | { id: string; status: 'error'; message: string };

const workerContext = self as unknown as {
  postMessage: (response: WorkerResponse) => void;
  onmessage: ((event: MessageEvent<CalculationTask>) => void) | null;
};

function post(response: WorkerResponse) {
  workerContext.postMessage(response);
}

workerContext.onmessage = async event => {
  const task = event.data as CalculationTask;
  try {
    const progress = (value: CalculationProgress) => post({ id: task.id, status: 'progress', progress: value });
    if (task.type === 'pricingEvaluation') {
      const result = await runPricingEvaluationCalculation(task.payload.state, task.payload.platformFilter, task.payload.settings, task.limits);
      post({ id: task.id, status: 'done', result });
      return;
    }
    if (task.type === 'activityDesign') {
      const rowsChunk = (rows: ComboEvaluationRow[]) => post({ id: task.id, status: 'chunk', rows });
      const result = await runActivityDesignCalculation(task.payload.state, task.payload.platformFilter, task.payload.settings, progress, task.limits, rowsChunk);
      post({ id: task.id, status: 'done', result });
      return;
    }
    const rowsChunk = (rows: ComboEvaluationRow[]) => post({ id: task.id, status: 'chunk', rows });
    const result = await runMeasurementCalculation(task.payload.state, task.payload.platformFilter, task.payload.settings, progress, task.limits, rowsChunk);
    post({ id: task.id, status: 'done', result });
  } catch (error) {
    post({ id: task.id, status: 'error', message: error instanceof Error ? error.message : '后台计算失败' });
  }
};
