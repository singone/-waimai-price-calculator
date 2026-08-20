import type {
  ComboEvaluationRow,
  Coupon,
  FullReduction,
  Platform,
  PriceBandRow,
  ProfitTarget,
  RedAddOn
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

export type OptimizationRow = {
  key: string;
  platform: Platform;
  platformName: string;
  full: FullReduction;
  coupon: Coupon;
  redAddOn: RedAddOn;
  target: ProfitTarget;
  coverage: number;
  score: number;
  finalPay: number;
  profitRate: number | null;
  example: {
    items: ComboEvaluationRow['items'];
    finalPay: number;
    profitRate: number | null;
    score: number;
  };
};
