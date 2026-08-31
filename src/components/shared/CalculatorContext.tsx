'use client';

import React from 'react';
import type {
  CalculatorState,
  Store
} from '../../domain/types';
import type { AppDataRepository } from '../../data/browserDataRepository';
import type { BackendAuthSession, PersistenceMode } from '../../data/backendClient';

export type CalculatorContextValue = {
  calculatorState: CalculatorState;
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>;
  dataRepository: AppDataRepository<CalculatorState, Store>;
  persistenceMode: PersistenceMode;
  backendSession: BackendAuthSession;
  store: Store;
  storeId: string;
  storeName: string;
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
