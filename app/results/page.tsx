'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { ResultsPage } from '@/src/components/results/ResultsPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <ResultsPage />
    </WaimaiCalculator>
  );
}
