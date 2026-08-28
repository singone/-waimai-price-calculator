import type {
  ComboEvaluationRow,
  Platform,
  PriceBandRow
} from '../../domain/types';

export type SelectedResultProduct = {
  platform: Platform;
  payBandKey: string;
  productId: string;
  productName: string;
};

export type SelectedResultBand = {
  platform: Platform;
  payBandKey: string;
};

export type LoadedResultBandRows = {
  platform: Platform;
  payBandKey: string;
  rows: ComboEvaluationRow[];
  matchedCount: number;
  truncated: boolean;
};

export type ResultPlatformView = {
  platform: Platform;
  platformName: string;
  payBands: PriceBandRow[];
  selectedPayBandKey: string;
  selectedPayBand: PriceBandRow | null;
  platformRows: ComboEvaluationRow[];
  payBandRows: ComboEvaluationRow[];
  productRows: ComboEvaluationRow[];
  riskRows: ComboEvaluationRow[];
  visibleRows: ComboEvaluationRow[];
};
