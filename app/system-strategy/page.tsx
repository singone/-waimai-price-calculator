'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { SystemStrategyPage } from '@/src/components/systemStrategy/SystemStrategyPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <SystemStrategyPage />
    </WaimaiCalculator>
  );
}
