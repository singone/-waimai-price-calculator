import * as XLSX from 'xlsx';
import {
  PLATFORM_PRODUCT_IMPORT_RULES,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_NAMES
} from '../../config/products';
import { normalizeDiscountRate, roundMoney } from '../../domain/money';
import { PlatformUtils } from '../../domain/platform';
import type { Platform, Product, ProductCategory } from '../../domain/types';
import { uid } from '../../utils/id';

export type ProductSortField = 'name' | 'category' | 'stapleServingCount' | 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
export type ProductStatusFilter = 'all' | 'meituanEnabled' | 'meituanDisabled' | 'elemeEnabled' | 'elemeDisabled' | 'nonStandalone' | 'missingCost';
export type ProductBulkPriceField = 'price' | 'cost' | 'packageFee' | 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee';
export type ProductBulkPriceMode = 'set' | 'increase' | 'discount';

export type PlatformProductRecord = {
  name: string;
  price: number;
  packageFee?: number;
  platformEnabled?: boolean;
};

export type ParsedPlatformProductWorkbook = {
  products: PlatformProductRecord[];
  disabled: number;
  skipped: number;
  duplicated: number;
  sheetName: string;
  headerRow: number;
};

export type CostRecord = {
  name: string;
  cost: number;
};

export type ParsedCostWorkbook = {
  costs: CostRecord[];
  skipped: number;
  duplicated: number;
  sheetName: string;
  headerRow: number;
};

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

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'y', 'on', '是', '有', '启用', '单点不送', '不可单点', '上架', '售卖中', '在售']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'n', 'off', '否', '无', '停用', '可单点', '下架', '停售', '暂停']);
const COST_IMPORT_RULE = {
  nameHeaders: ['商品名称', '商品名', '名称'],
  costHeaders: ['成本价', '成本', '商品成本', '成本(元)']
};

export function productTextValue(value: unknown) {
  return String(value ?? '').trim();
}

export function toProductMoneyNumber(value: unknown, fallback = Number.NaN) {
  const normalized = String(value ?? '').replace(/,/g, '').replace(/￥|¥|元/g, '').trim();
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function toProductNumber(value: unknown, fallback = 0) {
  const n = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : fallback;
}

function parseBoolean(value: unknown, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value > 0;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === '') return fallback;
  if (TRUE_VALUES.has(text)) return true;
  if (FALSE_VALUES.has(text)) return false;
  return fallback;
}

function parseProductStatus(value: unknown, fallback = true) {
  const text = String(value ?? '').trim();
  if (text === '') return fallback;
  if (/暂停|停售|下架|关闭|停用|不可售|未售/.test(text)) return false;
  if (/售卖中|上架|在售|启用|开启/.test(text)) return true;
  return parseBoolean(text, fallback);
}

function normalizeOptionalPrice(value: unknown): number | '' {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  const n = toProductMoneyNumber(text, Number.NaN);
  return Number.isFinite(n) ? Math.max(0, n) : '';
}

function normalizeOptionalMoney(value: unknown, min: number, fallback: number): number | '' {
  const text = String(value ?? '').trim();
  if (text === '') return '';
  return Math.max(min, toProductMoneyNumber(text, fallback));
}

function inferProductCategory(name: string, nonStandalone = false): ProductCategory {
  const text = String(name || '').toLowerCase();
  if (/套餐|套饭|组合|单人餐|双人|两份|多人餐|combo|set|\+|＋/.test(text)) return 'setMeal';
  if (/饭团|主食/.test(text)) return 'staple';
  if (/加料|加购|小料|配菜|蘸料|调料/.test(text)) return 'addOn';
  if (/饮|奶|茶|豆浆|可乐|雪碧|水|果汁|咖啡|小吃|点心|茶叶蛋|蛋|甜品|布丁/.test(text)) return 'snackDrink';
  return nonStandalone ? 'addOn' : 'other';
}

export function normalizeProductCategory(value: unknown, name = '', nonStandalone = false): ProductCategory {
  const text = String(value ?? '').trim();
  const lowered = text.toLowerCase();
  const aliases: Record<string, ProductCategory> = {
    staple: 'staple',
    riceball: 'staple',
    rice_ball: 'staple',
    主食: 'staple',
    饭团主食: 'staple',
    饭团: 'staple',
    snackdrink: 'snackDrink',
    snack_drink: 'snackDrink',
    小吃饮料: 'snackDrink',
    小吃: 'snackDrink',
    饮料: 'snackDrink',
    add_on: 'addOn',
    addon: 'addOn',
    addOn: 'addOn',
    加料: 'addOn',
    加购: 'addOn',
    set_meal: 'setMeal',
    setmeal: 'setMeal',
    套餐: 'setMeal',
    组合: 'setMeal',
    other: 'other',
    其他: 'other'
  };
  if (PRODUCT_CATEGORIES.includes(lowered as ProductCategory)) return lowered as ProductCategory;
  if (aliases[text]) return aliases[text];
  if (aliases[lowered]) return aliases[lowered];
  return inferProductCategory(name, nonStandalone);
}

export function inferStapleServingCount(name: string, category: ProductCategory) {
  if (category === 'staple') return 1;
  if (category !== 'setMeal') return 0;
  const text = String(name || '').toLowerCase();
  if (/四人|四份/.test(text)) return 4;
  if (/三人|三份|多人/.test(text)) return 3;
  if (/双人|两份|二人|2人|2份/.test(text)) return 2;
  return 1;
}

function normalizeStapleServingCount(value: unknown, name: string, category: ProductCategory) {
  const text = String(value ?? '').trim();
  if (text === '') return inferStapleServingCount(name, category);
  return Math.max(0, Math.floor(toProductNumber(text, inferStapleServingCount(name, category))));
}

export function productCategoryName(category: ProductCategory) {
  return PRODUCT_CATEGORY_NAMES[category] || PRODUCT_CATEGORY_NAMES.other;
}

export function normalizeProduct(product: Partial<Product>): Product {
  const nonStandalone = parseBoolean(product.nonStandalone);
  const name = String(product.name || '').trim() || '未命名商品';
  const category = normalizeProductCategory(product.category, name, nonStandalone);
  return {
    id: String(product.id || uid('p')),
    name,
    price: Math.max(0, toProductMoneyNumber(product.price, 0)),
    cost: Math.max(0, toProductMoneyNumber(product.cost, 0)),
    packageFee: Math.max(0, toProductMoneyNumber(product.packageFee, 0)),
    meituanPrice: normalizeOptionalPrice(product.meituanPrice),
    elemePrice: normalizeOptionalPrice(product.elemePrice),
    meituanPackageFee: normalizeOptionalMoney(product.meituanPackageFee, 0, 0),
    elemePackageFee: normalizeOptionalMoney(product.elemePackageFee, 0, 0),
    meituanEnabled: parseBoolean(product.meituanEnabled, true),
    elemeEnabled: parseBoolean(product.elemeEnabled, true),
    category,
    stapleServingCount: normalizeStapleServingCount(product.stapleServingCount, name, category),
    nonStandalone
  };
}

export function normalizeProductList(value: unknown): Product[] {
  if (!Array.isArray(value)) return [];
  const seenIds = new Set<string>();
  return value
    .map(row => normalizeProduct(row as Partial<Product>))
    .filter(product => product.name)
    .map(product => {
      const id = String(product.id || '').trim() || uid('p');
      if (!seenIds.has(id)) {
        seenIds.add(id);
        return { ...product, id };
      }
      const nextId = uid('p');
      seenIds.add(nextId);
      return { ...product, id: nextId };
    });
}

export function isProductListedOnPlatform(product: Product, platform: Platform) {
  return PlatformUtils.isListed(product, platform);
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
      else if (filters.sortField === 'meituanPrice') result = compareProductNumber(PlatformUtils.price(a, PlatformUtils.MEITUAN), PlatformUtils.price(b, PlatformUtils.MEITUAN));
      else if (filters.sortField === 'elemePrice') result = compareProductNumber(PlatformUtils.price(a, PlatformUtils.ELEME), PlatformUtils.price(b, PlatformUtils.ELEME));
      else if (filters.sortField === 'meituanPackageFee') result = compareProductNumber(PlatformUtils.packageFee(a, PlatformUtils.MEITUAN), PlatformUtils.packageFee(b, PlatformUtils.MEITUAN));
      else result = compareProductNumber(PlatformUtils.packageFee(a, PlatformUtils.ELEME), PlatformUtils.packageFee(b, PlatformUtils.ELEME));
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
  if (field === 'meituanPrice') return PlatformUtils.price(product, PlatformUtils.MEITUAN);
  if (field === 'elemePrice') return PlatformUtils.price(product, PlatformUtils.ELEME);
  if (field === 'meituanPackageFee') return PlatformUtils.packageFee(product, PlatformUtils.MEITUAN);
  if (field === 'elemePackageFee') return PlatformUtils.packageFee(product, PlatformUtils.ELEME);
  return Number(product[field]) || 0;
}

function normalizeImportedProductName(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeProductMatchName(value: unknown) {
  return normalizeImportedProductName(value).toLowerCase();
}

function normalizeProductMergeName(value: unknown) {
  return normalizeImportedProductName(value)
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

function platformImportPriceField(platform: Platform): 'meituanPrice' | 'elemePrice' {
  return platform === 'meituan' ? 'meituanPrice' : 'elemePrice';
}

export function findSimilarProductForPlatformImport(products: Product[], item: PlatformProductRecord, platform: Platform) {
  const priceField = platformImportPriceField(platform);
  const imported = normalizeProduct({ name: item.name, price: item.price });
  let best: { product: Product; score: number } | null = null;
  for (const product of products) {
    if (product[priceField] !== '') continue;
    if (product.category !== imported.category && product.category !== 'other' && imported.category !== 'other') continue;
    if (product.stapleServingCount > 0 && imported.stapleServingCount > 0 && product.stapleServingCount !== imported.stapleServingCount) continue;
    const similarity = productNameSimilarity(product.name, item.name);
    if (similarity < 0.88) continue;
    const priceBasis = Number(product.price) || 0;
    const priceGap = priceBasis > 0 ? Math.abs(priceBasis - item.price) : 0;
    const priceCompatible = priceBasis <= 0 || priceGap <= Math.max(5, item.price * 0.35);
    if (!priceCompatible) continue;
    if (!best || similarity > best.score) best = { product, score: similarity };
  }
  return best?.product || null;
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

function splitCsvLine(line: string) {
  const result: string[] = [];
  let current = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

function normalizeHeader(value: unknown) {
  const text = String(value ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const map: Record<string, string> = {
    商品: 'name',
    商品名: 'name',
    商品名称: 'name',
    name: 'name',
    名称: 'name',
    价格: 'price',
    售价: 'price',
    price: 'price',
    成本: 'cost',
    成本价: 'cost',
    cost: 'cost',
    包装费: 'packageFee',
    餐盒费: 'packageFee',
    packagefee: 'packageFee',
    美团价: 'meituanPrice',
    meituanprice: 'meituanPrice',
    饿了么价: 'elemePrice',
    elemeprice: 'elemePrice',
    美团包装费: 'meituanPackageFee',
    美团餐盒费: 'meituanPackageFee',
    meituanpackagefee: 'meituanPackageFee',
    饿了么包装费: 'elemePackageFee',
    饿了么餐盒费: 'elemePackageFee',
    elemepackagefee: 'elemePackageFee',
    美团上架: 'meituanEnabled',
    meituanenabled: 'meituanEnabled',
    饿了么上架: 'elemeEnabled',
    elemeenabled: 'elemeEnabled',
    单点不送: 'nonStandalone',
    不可单点: 'nonStandalone',
    nonstandalone: 'nonStandalone',
    分类: 'category',
    category: 'category',
    主食份数: 'stapleServingCount',
    stapleservingcount: 'stapleServingCount'
  };
  return map[text] || text;
}

function objectFromHeaders(headers: string[], fields: string[]) {
  return headers.reduce<Record<string, string>>((row, header, index) => {
    row[header] = fields[index] ?? '';
    return row;
  }, {});
}

function normalizeImportedProduct(row: Record<string, unknown>) {
  const name = String(row.name ?? '').trim();
  const price = toProductMoneyNumber(row.price, Number.NaN);
  if (!name || !(price > 0)) return null;
  return normalizeProduct({
    id: uid('p'),
    name,
    price,
    cost: Math.max(0, toProductMoneyNumber(row.cost, 0)),
    packageFee: Math.max(0, toProductMoneyNumber(row.packageFee, 0)),
    meituanPrice: normalizeOptionalPrice(row.meituanPrice),
    elemePrice: normalizeOptionalPrice(row.elemePrice),
    meituanPackageFee: normalizeOptionalMoney(row.meituanPackageFee, 0, 0),
    elemePackageFee: normalizeOptionalMoney(row.elemePackageFee, 0, 0),
    meituanEnabled: parseProductStatus(row.meituanEnabled, true),
    elemeEnabled: parseProductStatus(row.elemeEnabled, true),
    category: normalizeProductCategory(row.category, name, parseBoolean(row.nonStandalone)),
    stapleServingCount: String(row.stapleServingCount ?? '').trim() === '' ? undefined : Math.max(0, Math.floor(toProductNumber(row.stapleServingCount, 0))),
    nonStandalone: parseBoolean(row.nonStandalone)
  });
}

export function parseProducts(raw: string) {
  const text = String(raw ?? '').trim();
  if (!text) return [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const products: Product[] = [];
  let headers: string[] | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const fields = splitCsvLine(line).map(field => field.trim());
    if (!headers && /商品|名称|name/i.test(fields[0] || '')) {
      headers = fields.map(normalizeHeader);
      continue;
    }
    const row = headers ? objectFromHeaders(headers, fields) : {
      name: fields[0],
      price: fields[1],
      cost: fields[2],
      meituanPrice: fields[3],
      elemePrice: fields[4],
      nonStandalone: fields[5],
      meituanEnabled: fields[6],
      elemeEnabled: fields[7],
      packageFee: fields[8],
      meituanPackageFee: fields[9],
      elemePackageFee: fields[10],
      category: fields[11],
      stapleServingCount: fields[12]
    };
    const product = normalizeImportedProduct(row);
    if (product) products.push(product);
  }
  return products;
}

function normalizeImportHeader(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
}

function isExcludedImportPriceHeader(header: string) {
  return /餐盒|包装/.test(header);
}

function findImportColumnIndex(row: unknown[], candidates: string[]) {
  if (!candidates.length) return -1;
  const cells = row.map(normalizeImportHeader);
  const normalizedCandidates = candidates.map(normalizeImportHeader);
  for (const candidate of normalizedCandidates) {
    const exactIndex = cells.indexOf(candidate);
    if (exactIndex >= 0) return exactIndex;
  }
  for (const candidate of normalizedCandidates) {
    const partialIndex = cells.findIndex(cell => cell.includes(candidate) && !isExcludedImportPriceHeader(cell));
    if (partialIndex >= 0) return partialIndex;
  }
  return -1;
}

function rowHasText(row: unknown[]) {
  return Array.isArray(row) && row.some(cell => String(cell ?? '').trim() !== '');
}

function firstSheetRows(workbook: XLSX.WorkBook) {
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('工作簿没有可读取的工作表');
  const sheet = workbook.Sheets[sheetName];
  return {
    sheetName,
    rows: XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: false })
  };
}

export function parsePlatformProductWorkbook(workbook: XLSX.WorkBook, platform: Platform): ParsedPlatformProductWorkbook {
  const rule = PLATFORM_PRODUCT_IMPORT_RULES[platform];
  const { sheetName, rows } = firstSheetRows(workbook);
  const limit = Math.min(rows.length, 50);
  let header: { rowIndex: number; nameIndex: number; priceIndex: number } | null = null;
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    const nameIndex = findImportColumnIndex(row, rule.nameHeaders);
    const priceIndex = findImportColumnIndex(row, rule.priceHeaders);
    if (nameIndex >= 0 && priceIndex >= 0) {
      header = { rowIndex, nameIndex, priceIndex };
      break;
    }
  }
  if (!header) throw new Error('没有找到商品名称或价格列');
  const statusIndex = findImportColumnIndex(rows[header.rowIndex] || [], rule.statusHeaders || []);
  const packageFeeIndex = findImportColumnIndex(rows[header.rowIndex] || [], rule.packageFeeHeaders || []);
  const productsByName = new Map<string, PlatformProductRecord>();
  let skipped = 0;
  let duplicated = 0;
  let disabled = 0;
  rows.slice(header.rowIndex + 1).forEach(row => {
    const rawName = String(row[header.nameIndex] ?? '').trim();
    const price = toProductMoneyNumber(row[header.priceIndex], Number.NaN);
    if (!rawName || !(price > 0)) {
      if (rowHasText(row)) skipped++;
      return;
    }
    const name = normalizeImportedProductName(rawName);
    const key = normalizeProductMatchName(name);
    const platformEnabled = statusIndex >= 0 ? parseProductStatus(row[statusIndex], true) : undefined;
    const packageFeeText = packageFeeIndex >= 0 ? String(row[packageFeeIndex] ?? '').trim() : '';
    const packageFee = packageFeeText === '' ? undefined : Math.max(0, toProductMoneyNumber(packageFeeText, 0));
    if (platformEnabled === false) disabled++;
    if (productsByName.has(key)) duplicated++;
    productsByName.set(key, { name, price, packageFee, platformEnabled });
  });
  return { products: Array.from(productsByName.values()), skipped, duplicated, disabled, sheetName, headerRow: header.rowIndex + 1 };
}

export function parseCostWorkbook(workbook: XLSX.WorkBook): ParsedCostWorkbook {
  const { sheetName, rows } = firstSheetRows(workbook);
  const limit = Math.min(rows.length, 50);
  let header: { rowIndex: number; nameIndex: number; costIndex: number } | null = null;
  for (let rowIndex = 0; rowIndex < limit; rowIndex++) {
    const row = rows[rowIndex] || [];
    const nameIndex = findImportColumnIndex(row, COST_IMPORT_RULE.nameHeaders);
    const costIndex = findImportColumnIndex(row, COST_IMPORT_RULE.costHeaders);
    if (nameIndex >= 0 && costIndex >= 0) {
      header = { rowIndex, nameIndex, costIndex };
      break;
    }
  }
  if (!header) throw new Error('没有找到商品名称或成本价列');
  const costsByName = new Map<string, CostRecord>();
  let skipped = 0;
  let duplicated = 0;
  rows.slice(header.rowIndex + 1).forEach(row => {
    const rawName = String(row[header.nameIndex] ?? '').trim();
    const cost = toProductMoneyNumber(row[header.costIndex], Number.NaN);
    if (!rawName || !Number.isFinite(cost) || cost < 0) {
      if (rowHasText(row)) skipped++;
      return;
    }
    const name = normalizeImportedProductName(rawName);
    const key = normalizeProductMatchName(name);
    if (costsByName.has(key)) duplicated++;
    costsByName.set(key, { name, cost: roundMoney(cost) });
  });
  return { costs: Array.from(costsByName.values()), skipped, duplicated, sheetName, headerRow: header.rowIndex + 1 };
}
