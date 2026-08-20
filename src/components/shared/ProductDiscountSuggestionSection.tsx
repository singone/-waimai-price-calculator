'use client';

import type React from 'react';
import type { ComboEvaluationRow } from '../../domain/types';
import { ProductDiscountSuggestionPanel } from './ProductDiscountSuggestionPanel';
import {
  buildProductDiscountSuggestions,
  type ProductDiscountSuggestion,
  type ProductDiscountSuggestionSource
} from './productDiscountSuggestionUtils';

type ProductDiscountSuggestionSectionProps = {
  rows: ComboEvaluationRow[];
  source: ProductDiscountSuggestionSource;
  title?: string;
  productId?: string;
  allowApply?: boolean;
  limit?: number;
  analysisRows?: ComboEvaluationRow[];
  description?: React.ReactNode;
  includeNeutral?: boolean;
  money: (value: unknown) => string;
  onApply: (suggestion: ProductDiscountSuggestion) => void;
};

export function ProductDiscountSuggestionSection({
  rows,
  source,
  title,
  productId,
  allowApply = true,
  limit,
  analysisRows,
  description,
  includeNeutral,
  money,
  onApply
}: ProductDiscountSuggestionSectionProps) {
  const suggestions = buildProductDiscountSuggestions(analysisRows || rows, {
    source,
    productId,
    limit: limit ?? 6,
    includeBlocked: true,
    includeNeutral
  });

  return (
    <ProductDiscountSuggestionPanel
      title={title}
      description={description}
      suggestions={suggestions}
      allowApply={allowApply}
      money={money}
      onApply={onApply}
    />
  );
}

