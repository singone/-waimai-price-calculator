'use client';

import React from 'react';
import {
  effectiveActivityDesignSettingsFromStore,
  normalizeActivityStrategySettings
} from '../../data/calculatorState';
import type { CalculatorState, Store } from '../../domain/types';

export function useStoreActivityDesignSettings(calculatorState: Pick<CalculatorState, 'activityStrategySettings'>, store: Store) {
  return React.useMemo(
    () => effectiveActivityDesignSettingsFromStore(store, normalizeActivityStrategySettings(calculatorState.activityStrategySettings)),
    [calculatorState.activityStrategySettings, store]
  );
}
