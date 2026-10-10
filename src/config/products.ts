import type { Platform, ProductCategory } from '../domain/types';

export const PRODUCT_CATEGORIES: ProductCategory[] = ['staple', 'snackDrink', 'addOn', 'setMeal', 'other'];

export const PRODUCT_CATEGORY_NAMES: Record<ProductCategory, string> = {
  staple: '主食',
  snackDrink: '小吃饮料',
  addOn: '加料',
  setMeal: '套餐',
  other: '其他'
};

export type PlatformProductImportPlatform = Platform;

export type PlatformProductImportRule = {
  name: string;
  priceField: 'meituanPrice' | 'elemePrice' | 'jingdongPrice';
  packageFeeField: 'meituanPackageFee' | 'elemePackageFee' | 'jingdongPackageFee';
  enabledField: 'meituanEnabled' | 'elemeEnabled' | 'jingdongEnabled';
  nameHeaders: string[];
  priceHeaders: string[];
  packageFeeHeaders: string[];
  statusHeaders: string[];
  merchantCodeHeaders?: string[];
  barcodeHeaders?: string[];
  platformSkuHeaders?: string[];
  bundleHeaders?: string[];
};

export const PLATFORM_PRODUCT_IMPORT_RULES: Record<PlatformProductImportPlatform, PlatformProductImportRule> = {
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
    statusHeaders: [],
    bundleHeaders: ['加料/子品']
  },
  jingdong: {
    name: '京东外卖',
    priceField: 'jingdongPrice',
    packageFeeField: 'jingdongPackageFee',
    enabledField: 'jingdongEnabled',
    nameHeaders: ['商品名称', '商品名', '名称'],
    priceHeaders: ['实时价', '门店价格', '京东价', '京东外卖价', '售价', '价格(元)', '价格'],
    packageFeeHeaders: ['包装费', '餐盒费', '包装费(元)', '餐盒价格'],
    statusHeaders: ['商品状态', '库存状态', '售卖状态', '上下架', '上架状态'],
    merchantCodeHeaders: ['商家商品编号', '商家编码', '商家SKU编码', '商家sku编码', '商品编码'],
    barcodeHeaders: ['条码', '商品条码'],
    platformSkuHeaders: ['京东SKU编码', '京东sku编码', 'SKU编码', 'sku编码']
  }
};
