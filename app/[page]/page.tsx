import WaimaiCalculator from '@/src/WaimaiCalculator';
import { DEFAULT_PAGE_KEY, isPageKey, ROUTED_PAGE_KEYS } from '@/src/pageRoutes';

export const dynamicParams = false;

export function generateStaticParams() {
  return ROUTED_PAGE_KEYS.map(page => ({ page }));
}

export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  const activePage = isPageKey(page) ? page : DEFAULT_PAGE_KEY;
  return <WaimaiCalculator activePage={activePage} />;
}
