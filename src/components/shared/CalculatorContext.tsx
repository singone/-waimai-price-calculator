'use client';

import React from 'react';
import type {
  Activities,
  ActivityDesignObjective,
  ActivityDesignSettings,
  ActivityObjectiveStrategy,
  ActivityStrategySettings,
  CalculatorState,
  FeeRule,
  Platform,
  Product,
  Store
} from '../../domain/types';
import type {
  activityObjectiveOptionsFromSettings,
  normalizeActivityObjectiveStrategies
} from '../../data/calculatorState';
import type { ActivityObjectiveOption } from '../../config/activityStrategy';

export type CalculatorContextValue = {
  calculatorState: CalculatorState;
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>;
  store: Store;
  storeId: string;
  storeName: string;
  products: Product[];
  fee: FeeRule;
  activities: Record<Platform, Activities>;
  pricingRule: FeeRule['pricingEvaluation'];
  pricingStrategy: FeeRule['pricingStrategy'];
  activityObjectiveOptionsFromSettings: typeof activityObjectiveOptionsFromSettings;
  normalizeActivityObjectiveStrategies: typeof normalizeActivityObjectiveStrategies;
  onSaveProducts: (products: Product[]) => Promise<boolean>;
  onSaveFee: (fee: FeeRule) => Promise<boolean>;
  onSaveActivities: (platform: Platform, activities: Activities) => Promise<boolean>;
  onApplySuggestedPrice: (row: {
    suggestedPrice: number | null;
    productId: string;
    platform: Platform;
    platformName: string;
  }) => void;
};

const CalculatorContext = React.createContext<CalculatorContextValue | null>(null);

export function CalculatorProvider({
  value,
  children
}: {
  value: CalculatorContextValue;
  children: React.ReactNode;
}) {
  return (
    <CalculatorContext.Provider value={value}>
      {children}
    </CalculatorContext.Provider>
  );
}

export function useCalculatorContext() {
  const context = React.useContext(CalculatorContext);
  if (!context) {
    throw new Error('CalculatorContext provider is missing.');
  }
  return context;
}

export function useCalculatorPageProps<T extends object>(pageProps: T): CalculatorContextValue & T {
  const context = useCalculatorContext();
  return { ...context, ...pageProps };
}

export type StoreActivityObjectiveOptionsGetter = (
  settings: Pick<ActivityStrategySettings | ActivityDesignSettings, 'objectiveTemplates' | 'objectiveStrategies'> | undefined
) => ActivityObjectiveOption[];

export type StoreActivityObjectiveStrategiesNormalizer = (
  value: Partial<Record<ActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined,
  baseTargetProfitRate: number,
  objectiveOptions: ActivityObjectiveOption[]
) => Record<ActivityDesignObjective, ActivityObjectiveStrategy>;
