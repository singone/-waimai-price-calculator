'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { DataAnalysisPage } from '@/src/components/dataAnalysis/DataAnalysisPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <DataAnalysisPage />
    </WaimaiCalculator>
  );
}
