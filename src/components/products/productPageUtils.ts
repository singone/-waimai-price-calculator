import { platformPackageFee, platformPrice } from '../../domain/core';
import { normalizeDiscountRate, roundMoney } from '../../domain/money';
import type { Platform, Product, ProductCategory } from '../../domain/types';

export type ProductSortField = 'name' | 'category' | 'stapleServingCount' | 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
export type ProductStatusFilter = 'all' | 'meituanEnabled' | 'meituanDisabled' | 'elemeEnabled' | 'elemeDisabled' | 'nonStandalone' | 'missingCost';
export type ProductBulkPriceField = 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
export type ProductBulkPriceMode = 'set' | 'increase' | 'discount';

export type ProductPageFilters = {
  searchText: string;
  category: ProductCategory | 'all';
  status: ProductStatusFilter;
  sortField: ProductSortField;
  sortAsc: boolean;
};

export type ProductBulkEditState = {
  text: string;
  category: ProductCategory;
  stapleServingCount: number | null;
  priceField: ProductBulkPriceField;
  priceMode: ProductBulkPriceMode;
  priceValue: number | null;
};

export const DEFAULT_PRODUCT_PAGE_FILTERS: ProductPageFilters = {
  searchText: '',
  category: 'all',
  status: 'all',
  sortField: 'name',
  sortAsc: true
};

export const DEFAULT_PRODUCT_BULK_EDIT_STATE: ProductBulkEditState = {
  text: '',
  category: 'staple',
  stapleServingCount: null,
  priceField: 'price',
  priceMode: 'set',
  priceValue: null
};

export function productTextValue(value: unknown) {
  return String(value ?? '').trim();
}

export function compareProductText(a: unknown, b: unknown) {
  return productTextValue(a).localeCompare(productTextValue(b), 'zh-CN');
}

export function compareProductNumber(a: unknown, b: unknown) {
  const left = Number(a);
  const right = Number(b);
  return (Number.isFinite(left) ? left : 0) - (Number.isFinite(right) ? right : 0);
}

export function filterAndSortProducts(
  products: Product[],
  filters: ProductPageFilters,
  productCategoryName: (category: ProductCategory) => string
) {
  try {
    const keyword = String(filters.searchText || '').trim().toLowerCase();
    const filtered = products.filter(product => {
      if (keyword) {
        const text = [
          product.name,
          product.price,
          product.cost,
          product.packageFee,
          product.meituanPrice,
          product.elemePrice,
          product.meituanPackageFee,
          product.elemePackageFee,
          productCategoryName(product.category),
          product.stapleServingCount
        ].map(productTextValue).join(' ').toLowerCase();
        if (!text.includes(keyword)) return false;
      }
      if (filters.category !== 'all' && product.category !== filters.category) return false;
      if (filters.status === 'meituanEnabled') return product.meituanEnabled;
      if (filters.status === 'meituanDisabled') return !product.meituanEnabled;
      if (filters.status === 'elemeEnabled') return product.elemeEnabled;
      if (filters.status === 'elemeDisabled') return !product.elemeEnabled;
      if (filters.status === 'nonStandalone') return product.nonStandalone;
      if (filters.status === 'missingCost') return roundMoney(product.cost) <= 0;
      return true;
    });
    return filtered.slice().sort((a, b) => {
      let result = 0;
      if (filters.sortField === 'name') result = compareProductText(a.name, b.name);
      else if (filters.sortField === 'category') result = compareProductText(productCategoryName(a.category), productCategoryName(b.category));
      else if (filters.sortField === 'stapleServingCount') result = compareProductNumber(a.stapleServingCount, b.stapleServingCount);
      else if (filters.sortField === 'price') result = compareProductNumber(a.price, b.price);
      else if (filters.sortField === 'cost') result = compareProductNumber(a.cost, b.cost);
      else if (filters.sortField === 'packageFee') result = compareProductNumber(a.packageFee, b.packageFee);
      else if (filters.sortField === 'meituanPrice') result = compareProductNumber(platformPrice(a, 'meituan'), platformPrice(b, 'meituan'));
      else if (filters.sortField === 'elemePrice') result = compareProductNumber(platformPrice(a, 'eleme'), platformPrice(b, 'eleme'));
      else if (filters.sortField === 'meituanPackageFee') result = compareProductNumber(platformPackageFee(a, 'meituan'), platformPackageFee(b, 'meituan'));
      else result = compareProductNumber(platformPackageFee(a, 'eleme'), platformPackageFee(b, 'eleme'));
      return filters.sortAsc ? result : -result;
    });
  } catch {
    return products;
  }
}

export function resolveBulkPriceValue(product: Product, field: ProductBulkPriceField, mode: ProductBulkPriceMode, value: number) {
  const current = bulkPriceBaseValue(product, field);
  if (mode === 'set') return Math.max(0, value);
  if (mode === 'increase') return Math.max(0, current + value);
  return Math.max(0, current * normalizeDiscountRate(value));
}

function bulkPriceBaseValue(product: Product, field: ProductBulkPriceField) {
  if (field === 'meituanPrice') return platformPrice(product, 'meituan');
  if (field === 'elemePrice') return platformPrice(product, 'eleme');
  if (field === 'meituanPackageFee') return platformPackageFee(product, 'meituan');
  if (field === 'elemePackageFee') return platformPackageFee(product, 'eleme');
  return Number(product[field]) || 0;
}

function normalizeProductMergeName(value: unknown) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(【［\[].*?[）)】］\]]/g, '')
    .replace(/美团|饿了么|外卖|专享|平台|热销|爆款|招牌|推荐|新品|限时|活动|折扣|单点不送|不可单点/g, '')
    .replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

function productNameSimilarity(a: unknown, b: unknown) {
  const left = normalizeProductMergeName(a);
  const right = normalizeProductMergeName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length > right.length ? left : right;
  const leftSet = new Set(Array.from(left));
  const rightSet = new Set(Array.from(right));
  let intersection = 0;
  leftSet.forEach(char => {
    if (rightSet.has(char)) intersection++;
  });
  const union = new Set([...Array.from(leftSet), ...Array.from(rightSet)]).size || 1;
  const jaccard = intersection / union;
  const coverage = intersection / Math.max(1, Math.min(leftSet.size, rightSet.size));
  const containsScore = longer.includes(shorter) && shorter.length >= 4
    ? Math.min(0.96, 0.72 + shorter.length / Math.max(longer.length, 1) * 0.24)
    : 0;
  return Math.max(containsScore, coverage * 0.65 + jaccard * 0.35);
}

function productHasPlatformOverride(product: Product, platform: Platform) {
  if (platform === 'meituan') return product.meituanPrice !== '' || product.meituanPackageFee !== '';
  return product.elemePrice !== '' || product.elemePackageFee !== '';
}

function productMergeCompatible(a: Product, b: Product) {
  const similarity = productNameSimilarity(a.name, b.name);
  if (similarity < 0.82) return false;
  if (a.category !== b.category && a.category !== 'other' && b.category !== 'other') return false;
  if (a.stapleServingCount > 0 && b.stapleServingCount > 0 && a.stapleServingCount !== b.stapleServingCount) return false;
  return true;
}

function productDataCompleteness(product: Product) {
  return [
    product.cost > 0,
    product.packageFee > 0,
    product.meituanPrice !== '',
    product.elemePrice !== '',
    product.meituanPackageFee !== '',
    product.elemePackageFee !== '',
    product.category !== 'other',
    product.stapleServingCount > 0
  ].filter(Boolean).length;
}

function mergeOptionalPrice<T extends 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee'>(target: Product, source: Product, field: T) {
  if (target[field] === '' && source[field] !== '') target[field] = source[field];
}

function normalizeMergedProduct(product: Product): Product {
  return {
    ...product,
    id: String(product.id || '').trim(),
    name: String(product.name || '').trim(),
    price: Math.max(0, Number(product.price) || 0),
    cost: Math.max(0, Number(product.cost) || 0),
    packageFee: Math.max(0, Number(product.packageFee) || 0),
    meituanPrice: product.meituanPrice === '' ? '' : Math.max(0, Number(product.meituanPrice) || 0),
    elemePrice: product.elemePrice === '' ? '' : Math.max(0, Number(product.elemePrice) || 0),
    meituanPackageFee: product.meituanPackageFee === '' ? '' : Math.max(0, Number(product.meituanPackageFee) || 0),
    elemePackageFee: product.elemePackageFee === '' ? '' : Math.max(0, Number(product.elemePackageFee) || 0),
    meituanEnabled: product.meituanEnabled !== false,
    elemeEnabled: product.elemeEnabled !== false,
    stapleServingCount: Math.max(0, Math.floor(Number(product.stapleServingCount) || 0)),
    nonStandalone: Boolean(product.nonStandalone)
  };
}

export function mergeProductRecords(primary: Product, duplicates: Product[]) {
  const merged = normalizeMergedProduct(primary);
  duplicates.forEach(source => {
    if (merged.price <= 0 && source.price > 0) merged.price = source.price;
    if (merged.cost <= 0 && source.cost > 0) merged.cost = source.cost;
    if (merged.packageFee <= 0 && source.packageFee > 0) merged.packageFee = source.packageFee;
    const hadMeituanOverride = productHasPlatformOverride(merged, 'meituan');
    const hadElemeOverride = productHasPlatformOverride(merged, 'eleme');
    mergeOptionalPrice(merged, source, 'meituanPrice');
    mergeOptionalPrice(merged, source, 'elemePrice');
    mergeOptionalPrice(merged, source, 'meituanPackageFee');
    mergeOptionalPrice(merged, source, 'elemePackageFee');
    if (productHasPlatformOverride(source, 'meituan') && !hadMeituanOverride) {
      merged.meituanEnabled = source.meituanEnabled;
    } else {
      merged.meituanEnabled = merged.meituanEnabled || source.meituanEnabled;
    }
    if (productHasPlatformOverride(source, 'eleme') && !hadElemeOverride) {
      merged.elemeEnabled = source.elemeEnabled;
    } else {
      merged.elemeEnabled = merged.elemeEnabled || source.elemeEnabled;
    }
    if (merged.category === 'other' && source.category !== 'other') merged.category = source.category;
    merged.stapleServingCount = Math.max(merged.stapleServingCount, source.stapleServingCount);
    merged.nonStandalone = merged.nonStandalone || source.nonStandalone;
  });
  return normalizeMergedProduct(merged);
}

export function chooseProductMergePrimary(products: Product[]) {
  return products
    .slice()
    .sort((a, b) => productDataCompleteness(b) - productDataCompleteness(a) || a.name.length - b.name.length || a.name.localeCompare(b.name, 'zh-CN'))[0];
}

export function findDuplicateProductGroups(products: Product[]) {
  const groups: Product[][] = [];
  const used = new Set<string>();
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    if (used.has(product.id)) continue;
    const group = [product];
    for (let j = i + 1; j < products.length; j++) {
      const candidate = products[j];
      if (used.has(candidate.id)) continue;
      if (group.some(item => productMergeCompatible(item, candidate))) group.push(candidate);
    }
    if (group.length > 1) {
      group.forEach(item => used.add(item.id));
      groups.push(group);
    }
  }
  return groups.sort((a, b) => b.length - a.length || b.reduce((sum, item) => sum + productDataCompleteness(item), 0) - a.reduce((sum, item) => sum + productDataCompleteness(item), 0));
}
