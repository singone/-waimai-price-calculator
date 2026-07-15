import WaimaiCalculator from '@/src/WaimaiCalculator';
import { ROUTED_PAGE_KEYS } from '@/src/pageRoutes';

export const dynamicParams = false;

export function generateStaticParams() {
  return ROUTED_PAGE_KEYS.map(page => ({ page }));
}

export default function Page() {
  return <WaimaiCalculator />;
}
