export type PageKey = 'store' | 'products' | 'system-strategy' | 'platform' | 'meituan' | 'eleme' | 'activity-design' | 'pricing' | 'results';

export const DEFAULT_PAGE_KEY: PageKey = 'store';

export const PAGE_KEYS: PageKey[] = ['store', 'products', 'system-strategy', 'platform', 'meituan', 'eleme', 'activity-design', 'pricing', 'results'];

export const ROUTED_PAGE_KEYS: PageKey[] = PAGE_KEYS.filter(page => page !== DEFAULT_PAGE_KEY);

export const PAGE_PATHS: Record<PageKey, string> = {
  store: '/',
  products: '/products',
  'system-strategy': '/system-strategy',
  platform: '/platform',
  meituan: '/meituan',
  eleme: '/eleme',
  'activity-design': '/activity-design',
  pricing: '/pricing',
  results: '/results'
};

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && PAGE_KEYS.includes(value as PageKey);
}

export function pageFromPathname(pathname: string) {
  const segment = pathname.split('/').filter(Boolean)[0];
  return isPageKey(segment) ? segment : DEFAULT_PAGE_KEY;
}

export function pathForPage(page: PageKey) {
  return PAGE_PATHS[page] || PAGE_PATHS[DEFAULT_PAGE_KEY];
}
