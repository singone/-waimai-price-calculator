'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { ActivityPage } from '@/src/components/activity/ActivityPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <ActivityPage platform="meituan" />
    </WaimaiCalculator>
  );
}
