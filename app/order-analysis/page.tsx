'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { OrderAnalysisPage } from '@/src/components/orderAnalysis/OrderAnalysisPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <OrderAnalysisPage />
    </WaimaiCalculator>
  );
}
