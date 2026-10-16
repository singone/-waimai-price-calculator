export const APP_ROUTES = [
  { key: 'guide', path: '/guide', label: '网站地图与说明' },
  { key: 'news', path: '/news', label: '平台动态' },
  { key: 'backend-sync', path: '/backend-sync', label: '后台核对与同步' },
  { key: 'store', path: '/', label: '门店维护' },
  { key: 'products', path: '/products', label: '商品维护' },
  { key: 'product-analysis', path: '/product-analysis', label: '商品分析' },
  { key: 'system-strategy', path: '/system-strategy', label: '系统活动策略' },
  { key: 'platform', path: '/platform', label: '平台通用规则' },
  { key: 'meituan', path: '/meituan', label: '美团活动' },
  { key: 'eleme', path: '/eleme', label: '饿了么活动' },
  { key: 'jingdong', path: '/jingdong', label: '京东券维护' },
  { key: 'activity-design', path: '/activity-design', label: '活动设计' },
  { key: 'order-analysis', path: '/order-analysis', label: '订单分析' },
  { key: 'data-analysis', path: '/data-analysis', label: '数据分析' },
  { key: 'pricing', path: '/pricing', label: '定价评估' },
  { key: 'results', path: '/results', label: '测算结果' }
] as const;

export type AppRoute = (typeof APP_ROUTES)[number];
export type PageKey = AppRoute['key'];
export type AppNavigationItem = Pick<AppRoute, 'key' | 'label'>;

export const DEFAULT_PAGE_KEY: PageKey = 'store';

export const PAGE_KEYS = APP_ROUTES.map(route => route.key) as PageKey[];

export const PAGE_PATHS = Object.fromEntries(
  APP_ROUTES.map(route => [route.key, route.path])
) as Record<PageKey, string>;

export const APP_NAVIGATION_ITEMS = APP_ROUTES.map(({ key, label }) => ({
  key,
  label
})) as AppNavigationItem[];

const PAGE_KEY_SET = new Set<PageKey>(PAGE_KEYS);

/**
 * 判断外部输入是否是应用支持的页面 key。
 */
export function isPageKey(value: unknown): value is PageKey {
  return typeof value === 'string' && PAGE_KEY_SET.has(value as PageKey);
}

/**
 * 根据页面 key 返回 App Router 路径。
 */
export function pathForPage(page: PageKey) {
  return PAGE_PATHS[page] || PAGE_PATHS[DEFAULT_PAGE_KEY];
}

/**
 * 根据当前 URL 路径反推出页面 key，用于菜单高亮和状态同步。
 */
export function pageForPath(pathname: string | null | undefined): PageKey {
  const normalizedPath = pathname && pathname !== '/' ? pathname.replace(/\/$/, '') : '/';
  const matched = APP_ROUTES.find(route => route.path === normalizedPath);
  return matched?.key || DEFAULT_PAGE_KEY;
}
