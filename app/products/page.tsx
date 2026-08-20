'use client';

import WaimaiCalculator from '@/src/WaimaiCalculator';
import { ProductsPage } from '@/src/components/products/ProductsPage';

export default function Page() {
  return (
    <WaimaiCalculator>
      <ProductsPage />
    </WaimaiCalculator>
  );
}
