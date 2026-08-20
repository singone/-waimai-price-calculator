export type PageKey = 'store' | 'products' | 'system-strategy' | 'platform' | 'meituan' | 'eleme' | 'activity-design' | 'order-analysis' | 'data-analysis' | 'pricing' | 'results';

export const DEFAULT_PAGE_KEY: PageKey = 'store';

export const PAGE_KEYS: PageKey[] = ['store', 'products', 'system-strategy', 'platform', 'meituan', 'eleme', 'activity-design', 'order-analysis', 'data-analysis', 'pricing', 'results'];

export const PAGE_PATHS: Record<PageKey, string> = {
  store: '/',
  products: '/products',
  'system-strategy': '/system-strategy',
  platform: '/platform',
  meituan: '/meituan',
  eleme: '/eleme',
  'activity-design': '/activity-design',
  'order-analysis': '/order-analysis',
  'data-analysis': '/data-analysis',
  pricing: '/pricing',
  results: '/results'
};

export function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && PAGE_KEYS.includes(value as PageKey);
}

export function pathForPage(page: PageKey) {
  return PAGE_PATHS[page] || PAGE_PATHS[DEFAULT_PAGE_KEY];
}

export function pageForPath(pathname: string | null | undefined): PageKey {
  const normalizedPath = pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : '/';
  const matched = PAGE_KEYS.find(page => PAGE_PATHS[page] === normalizedPath);
  return matched || DEFAULT_PAGE_KEY;
}
