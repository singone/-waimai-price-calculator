import type { StapleScenario, Summary } from '../domain/types';

export const EMPTY_SUMMARY: Summary = {
  resultCount: 0,
  comboCount: 0,
  validComboCount: 0,
  elapsedTime: null
};

export const STAPLE_SCENARIOS: StapleScenario[] = ['single', 'double', 'multi'];

export const MEASUREMENT_DETAIL_ROW_LIMIT = 5000;
