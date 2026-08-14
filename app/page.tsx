import WaimaiCalculator from '@/src/WaimaiCalculator';
import { DEFAULT_PAGE_KEY } from '@/src/pageRoutes';

export default function Page() {
  return <WaimaiCalculator activePage={DEFAULT_PAGE_KEY} />;
}
