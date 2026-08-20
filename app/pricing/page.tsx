'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { PricingEvaluationPage } from '@/src/components/pricing/PricingEvaluationPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <PricingEvaluationPage />
    </WaimaiCalculator>
  );
}
