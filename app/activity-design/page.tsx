'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { ActivityDesignPage } from '@/src/components/activityDesign/ActivityDesignPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <ActivityDesignPage />
    </WaimaiCalculator>
  );
}
