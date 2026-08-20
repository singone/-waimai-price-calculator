'use client';

import React from 'react';
import { App as AntApp } from 'antd';
import {
  browserDataRepository,
  deepClone,
  normalizeState
} from '../../data/calculatorState';
import type { CalculatorState } from '../../domain/types';

export type CommitCalculatorState = (
  mutator: (draft: CalculatorState) => void,
  successMessage: string
) => Promise<boolean>;

export function useCalculatorStateCommit(
  calculatorState: CalculatorState,
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>
): CommitCalculatorState {
  const { message } = AntApp.useApp();

  return React.useCallback(async (mutator, successMessage) => {
    const draft = deepClone(calculatorState);
    mutator(draft);
    const normalized = normalizeState(draft);
    setCalculatorState(normalized);
    try {
      await browserDataRepository.saveCalculatorState(normalized);
      message.success(successMessage);
      return true;
    } catch {
      message.warning('已更新当前页面，但保存到浏览器数据库失败。');
      return false;
    }
  }, [calculatorState, message, setCalculatorState]);
}
