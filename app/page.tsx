'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { StorePage } from '@/src/components/store/StorePage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <StorePage />
    </WaimaiCalculator>
  );
}
