'use client';

import React from 'react';
import type {
  CalculatorState,
  Store
} from '../../domain/types';

export type CalculatorContextValue = {
  calculatorState: CalculatorState;
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>;
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
