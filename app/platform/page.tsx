'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { PlatformPage } from '@/src/components/platform/PlatformPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <PlatformPage />
    </WaimaiCalculator>
  );
}
