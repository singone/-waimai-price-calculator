import type { Platform, ProductCategory } from '../domain/types';

export const PRODUCT_CATEGORIES: ProductCategory[] = ['staple', 'snackDrink', 'addOn', 'setMeal', 'other'];

export const PRODUCT_CATEGORY_NAMES: Record<ProductCategory, string> = {
  staple: '主食',
  snackDrink: '小吃饮料',
  addOn: '加料',
  setMeal: '套餐',
  other: '其他'
};

export type PlatformProductImportRule = {
  name: string;
  priceField: 'meituanPrice' | 'elemePrice';
  packageFeeField: 'meituanPackageFee' | 'elemePackageFee';
  enabledField: 'meituanEnabled' | 'elemeEnabled';
  nameHeaders: string[];
  priceHeaders: string[];
  packageFeeHeaders: string[];
  statusHeaders: string[];
};

export const PLATFORM_PRODUCT_IMPORT_RULES: Record<Platform, PlatformProductImportRule> = {
  meituan: {
    name: '美团',
    priceField: 'meituanPrice',
    packageFeeField: 'meituanPackageFee',
    enabledField: 'meituanEnabled',
    nameHeaders: ['商品名称', '商品名', '名称'],
    priceHeaders: ['外送价', '美团价', '售价', '价格(元)', '价格'],
    packageFeeHeaders: ['餐盒价格'],
    statusHeaders: ['售卖状态', '上下架', '上架状态']
  },
  eleme: {
    name: '饿了么',
    priceField: 'elemePrice',
    packageFeeField: 'elemePackageFee',
    enabledField: 'elemeEnabled',
    nameHeaders: ['商品名称', '商品名', '名称'],
    priceHeaders: ['价格(元)', '饿了么价', '外送价', '售价', '价格'],
    packageFeeHeaders: ['包装费(元)'],
    statusHeaders: []
  }
};
