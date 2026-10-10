'use client';

import React from 'react';
import { App as AntApp, Button, Card, Input, InputNumber, Modal, Popover, Select, Space, Switch, Table, Tabs, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import {
  type PlatformProductImportPlatform,
  PLATFORM_PRODUCT_IMPORT_RULES,
  PRODUCT_CATEGORIES
} from '../../config/products';
import { roundMoney } from '../../domain/money';
import { PlatformUtils } from '../../domain/platform';
import type { CalculatorState, Product, ProductBundleChoiceGroup, ProductCategory, Severity, Store } from '../../domain/types';
import { tablePagination } from '../../utils/table';
import { money, rateText, severityColor, severityLabel, severityRank } from '../../utils/format';
import { uploadProps } from '../../utils/upload';
import { readWorkbook } from '../../utils/workbook';
import { uid } from '../../utils/id';
import { useCalculatorPageProps } from '../shared/CalculatorContext';
import { useCalculatorStateCommit } from '../shared/useCalculatorStateCommit';
import { useEditableDraft } from '../shared/useEditableDraft';
import {
  currentStoreFrom,
  normalizeProductList as normalizeCalculatorProductList
} from '../../data/calculatorState';
import {
  chooseProductMergePrimary,
  compareProductNumber,
  compareProductText,
  DEFAULT_PRODUCT_BULK_EDIT_STATE,
  DEFAULT_PRODUCT_PAGE_FILTERS,
  filterAndSortProducts,
  findDuplicateProductGroups,
  findSimilarProductByName,
  findSimilarProductMatchForPlatformImport,
  findSimilarProductForPlatformImport,
  inferStapleServingCount,
  isProductListedOnPlatform,
  mergeProductRecords,
  normalizeProduct,
  normalizeProductCode,
  normalizeProductList,
  normalizeProductMatchName,
  parseCostWorkbook,
  parsePlatformProductWorkbook,
  parseProducts,
  productCategoryName,
  resolveBulkPriceValue,
  type ParsedPlatformProductWorkbook,
  type ProductBulkPriceField,
  type ProductBulkPriceMode,
  type ProductPageFilters,
  type PlatformProductRecord
} from './productPageUtils';
import {
  buildBundlePriceCheckRows,
  bundleCostTotalByMode,
  type BundleCostSyncMode,
  type BundlePriceCheckRow
} from './productBundlePriceCheck';

const { Text } = Typography;

type ProductTableBoundaryProps = {
  children: React.ReactNode;
  fallback: React.ReactNode;
  resetKey: string;
};

class ProductTableBoundary extends React.Component<ProductTableBoundaryProps, { hasError: boolean; resetKey: string }> {
  constructor(props: ProductTableBoundaryProps) {
    super(props);
    this.state = { hasError: false, resetKey: props.resetKey };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  static getDerivedStateFromProps(props: ProductTableBoundaryProps, state: { hasError: boolean; resetKey: string }) {
    if (props.resetKey !== state.resetKey) return { hasError: false, resetKey: props.resetKey };
    return null;
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

type ProductsPageProps = {
  calculatorState: CalculatorState;
  setCalculatorState: React.Dispatch<React.SetStateAction<CalculatorState>>;
  store: Store;
  storeId: string;
  products: Product[];
};

type JingdongImportSimilarMatch = {
  key: string;
  item: PlatformProductRecord;
  product: Product;
  score: number;
};

type PendingJingdongImport = {
  fileName: string;
  parsed: ParsedPlatformProductWorkbook;
  matches: JingdongImportSimilarMatch[];
};

export function ProductsPage(pageProps: Partial<ProductsPageProps> = {}) {
  const {
    calculatorState,
    setCalculatorState,
    store,
    storeId,
    products: pageProducts
  } = useCalculatorPageProps(pageProps);
  const products = React.useMemo(
    () => pageProducts ?? normalizeCalculatorProductList(store.products),
    [pageProducts, store.products]
  );
  const productCategories = PRODUCT_CATEGORIES;
  const platformProductImportRules = PLATFORM_PRODUCT_IMPORT_RULES;
  const { message, modal } = AntApp.useApp();
  const [filters, setFilters] = React.useState<ProductPageFilters>(DEFAULT_PRODUCT_PAGE_FILTERS);
  const [selectedProductRowKeys, setSelectedProductRowKeys] = React.useState<React.Key[]>([]);
  const [editingBundleProductId, setEditingBundleProductId] = React.useState('');
  const [bulk, setBulk] = React.useState(DEFAULT_PRODUCT_BULK_EDIT_STATE);
  const [pendingJingdongImport, setPendingJingdongImport] = React.useState<PendingJingdongImport | null>(null);
  const [jingdongImportMergeByKey, setJingdongImportMergeByKey] = React.useState<Record<string, boolean>>({});
  const [bundlePriceCheckModalOpen, setBundlePriceCheckModalOpen] = React.useState(false);
  const [bundlePriceCheckActivePlatform, setBundlePriceCheckActivePlatform] = React.useState<PlatformProductImportPlatform>(PlatformUtils.ELEME);
  const [bundlePriceDiscountPercent, setBundlePriceDiscountPercent] = React.useState(10);
  const [bundleCostSyncMode, setBundleCostSyncMode] = React.useState<BundleCostSyncMode>('max');
  const [bundleDetailPopoverProductId, setBundleDetailPopoverProductId] = React.useState('');
  const resetSelection = React.useCallback(() => {
    setSelectedProductRowKeys([]);
    setBulk(DEFAULT_PRODUCT_BULK_EDIT_STATE);
  }, []);
  const cloneProducts = React.useCallback((value: Product[]) => value.map(product => ({
    ...product,
    bundleItems: (product.bundleItems || []).map(item => ({ ...item })),
    bundleChoiceGroups: (product.bundleChoiceGroups || []).map(group => ({
      ...group,
      items: group.items.map(item => ({ ...item }))
    }))
  })), []);
  const productEditor = useEditableDraft<Product[]>({
    source: products,
    clone: cloneProducts,
    normalize: normalizeProductList,
    onExitEdit: resetSelection,
    resetKey: storeId
  });
  const { isEditing, value: productSource, startEdit, cancelEdit, updateDraft: updateProductsDraft } = productEditor;
  const displayedProducts = React.useMemo(
    () => filterAndSortProducts(productSource, filters, productCategoryName),
    [filters, productCategoryName, productSource]
  );
  const bundlePriceCheckRowsByPlatform = React.useMemo(
    () => Object.fromEntries(
      PlatformUtils.ALL_PLATFORMS.map(platform => [platform, buildBundlePriceCheckRows(productSource, platform)])
    ) as Record<PlatformProductImportPlatform, BundlePriceCheckRow[]>,
    [productSource]
  );
  const bundlePriceCheckSetMealCount = React.useMemo(
    () => productSource.filter(product => product.category === 'setMeal').length,
    [productSource]
  );
  const bundlePriceCheckIssueCount = React.useMemo(
    () => PlatformUtils.ALL_PLATFORMS.reduce(
      (sum, platform) => sum + bundlePriceCheckRowsByPlatform[platform].filter(row => row.severity !== 'none').length,
      0
    ),
    [bundlePriceCheckRowsByPlatform]
  );
  const activeBundlePriceCheckRows = bundlePriceCheckRowsByPlatform[bundlePriceCheckActivePlatform] || [];
  const productDuplicateGroups = React.useMemo(
    () => (isEditing ? findDuplicateProductGroups(productSource) : []),
    [isEditing, productSource]
  );
  React.useEffect(() => {
    if (!isEditing) {
      setSelectedProductRowKeys([]);
      setBulk(DEFAULT_PRODUCT_BULK_EDIT_STATE);
      return;
    }
    const availableIds = new Set(productSource.map(product => product.id));
    setSelectedProductRowKeys(prev => {
      const next = prev.filter(key => availableIds.has(String(key)));
      return next.length === prev.length ? prev : next;
    });
  }, [isEditing, productSource]);
  React.useEffect(resetSelection, [resetSelection, storeId]);
  React.useEffect(() => {
    setEditingBundleProductId('');
    setBundleDetailPopoverProductId('');
  }, [storeId]);

  const selectedProductCount = selectedProductRowKeys.length;
  const duplicateGroupCount = productDuplicateGroups.length;
  const disabled = selectedProductCount === 0;
  const pricePlaceholder = bulk.priceMode === 'discount' ? '如 8.8 表示 8.8折' : bulk.priceMode === 'increase' ? '可输入负数' : '输入金额';
  const resetKey = `${storeId}-${isEditing ? 'edit' : 'view'}-${productSource.length}-${filters.searchText}-${filters.category}-${filters.status}-${filters.sortField}-${filters.sortAsc ? 'asc' : 'desc'}`;
  const productRowSelection = isEditing ? {
    selectedRowKeys: selectedProductRowKeys,
    onChange: (keys: React.Key[]) => setSelectedProductRowKeys(keys)
  } : undefined;
  const commitCalculatorState = useCalculatorStateCommit(calculatorState, setCalculatorState);
  const saveProducts = React.useCallback(async (nextProducts: Product[]) => (
    commitCalculatorState(draft => {
      currentStoreFrom(draft).products = normalizeCalculatorProductList(nextProducts);
    }, '商品信息已保存到浏览器数据库。')
  ), [commitCalculatorState]);

  const saveEdit = async () => {
    await productEditor.saveEdit(saveProducts);
  };
  const updateProductDraft = (productId: string, patch: Partial<Product>) => {
    updateProductsDraft(draft => {
      const index = draft.findIndex(product => product.id === productId);
      if (index < 0) return;
      draft[index] = normalizeProduct({ ...draft[index], ...patch });
    });
  };
  const deleteProductDraft = (productId: string) => {
    const product = productSource.find(item => item.id === productId);
    if (!product) return;
    modal.confirm({
      title: '删除商品',
      content: `确定删除「${product.name}」吗？删除后当前门店的该商品价格、成本和上下架状态都会移除。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        updateProductsDraft(draft => {
          const index = draft.findIndex(item => item.id === productId);
          if (index < 0) return;
          draft.splice(index, 1);
        });
      }
    });
  };
  const addProduct = () => {
    updateProductsDraft(draft => {
      draft.push(normalizeProduct({ name: '新商品', price: 0, cost: 0, meituanEnabled: true, elemeEnabled: true, jingdongEnabled: true }));
    });
  };
  const editingBundleProduct = React.useMemo(
    () => productSource.find(product => product.id === editingBundleProductId && product.category === 'setMeal') || null,
    [editingBundleProductId, productSource]
  );
  const bundleComponentOptions = React.useMemo(
    () => productSource
      .filter(product => product.id !== editingBundleProductId && product.category !== 'setMeal')
      .map(product => ({ value: product.id, label: product.name })),
    [editingBundleProductId, productSource]
  );
  const bundleComponentName = React.useCallback((productId: string) => (
    productSource.find(product => product.id === productId)?.name || '失效商品'
  ), [productSource]);
  const normalizeBundleItemList = (items: NonNullable<Product['bundleItems']>) => {
    const merged = new Map<string, number>();
    items.forEach(item => {
      const productId = String(item.productId || '').trim();
      if (!productId) return;
      const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
      merged.set(productId, (merged.get(productId) || 0) + qty);
    });
    return Array.from(merged.entries()).map(([productId, qty]) => ({ productId, qty }));
  };
  const updateBundleItems = (productId: string, mutator: (items: NonNullable<Product['bundleItems']>) => void) => {
    updateProductsDraft(draft => {
      const index = draft.findIndex(product => product.id === productId);
      if (index < 0 || draft[index].category !== 'setMeal') return;
      const items = (draft[index].bundleItems || []).map(item => ({ ...item }));
      mutator(items);
      draft[index] = normalizeProduct({ ...draft[index], bundleItems: normalizeBundleItemList(items) });
    });
  };
  const updateBundleChoiceGroups = (productId: string, mutator: (groups: ProductBundleChoiceGroup[]) => void) => {
    updateProductsDraft(draft => {
      const index = draft.findIndex(product => product.id === productId);
      if (index < 0 || draft[index].category !== 'setMeal') return;
      const groups = (draft[index].bundleChoiceGroups || []).map(group => ({
        ...group,
        items: group.items.map(item => ({ ...item }))
      }));
      mutator(groups);
      draft[index] = normalizeProduct({ ...draft[index], bundleChoiceGroups: groups });
    });
  };
  const addBundleItem = () => {
    if (!editingBundleProduct || !bundleComponentOptions.length) return;
    updateBundleItems(editingBundleProduct.id, items => {
      items.push({ productId: bundleComponentOptions[0].value, qty: 1 });
    });
  };
  const addBundleChoiceGroup = () => {
    if (!editingBundleProduct || !bundleComponentOptions.length) return;
    updateBundleChoiceGroups(editingBundleProduct.id, groups => {
      groups.push({
        id: uid('bundle_group'),
        name: '任选组',
        selectionQty: 1,
        items: [{ productId: bundleComponentOptions[0].value, qty: 1 }]
      });
    });
  };
  const addBundleChoiceItem = (groupIndex: number) => {
    if (!editingBundleProduct || !bundleComponentOptions.length) return;
    updateBundleChoiceGroups(editingBundleProduct.id, groups => {
      const group = groups[groupIndex];
      if (!group) return;
      group.items.push({ productId: bundleComponentOptions[0].value, qty: 1 });
    });
  };
  const resolveImportedBundleProduct = (rows: Product[], itemName: string, bundleProductId: string) => (
    findSimilarProductByName(rows.filter(row => row.category !== 'setMeal'), itemName, {
      excludeProductIds: new Set([bundleProductId]),
      minScore: 0.72
    })
  );
  const bundleItemsFromImportedNames = (rows: Product[], names: string[], bundleProductId: string) => {
    const items: NonNullable<Product['bundleItems']> = [];
    let unmatchedCount = 0;
    names.forEach(name => {
      const product = resolveImportedBundleProduct(rows, name, bundleProductId);
      if (!product) {
        unmatchedCount++;
        return;
      }
      items.push({ productId: product.id, qty: 1 });
    });
    return { items: normalizeBundleItemList(items), unmatchedCount };
  };
  const applyImportedBundleComposition = (
    product: Product,
    item: PlatformProductRecord,
    rows: Product[]
  ) => {
    const fixedNames = item.bundleFixedItemNames || [];
    const choiceGroupRecords = item.bundleChoiceGroups || [];
    if (!fixedNames.length && !choiceGroupRecords.length) {
      return { changed: false, fixedItemCount: 0, choiceGroupCount: 0, choiceOptionCount: 0, unmatchedCount: 0 };
    }
    const before = JSON.stringify({
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      bundleItems: product.bundleItems || [],
      bundleChoiceGroups: product.bundleChoiceGroups || []
    });
    if (product.category !== 'setMeal') {
      product.category = 'setMeal';
      product.stapleServingCount = inferStapleServingCount(product.name, 'setMeal');
    }
    const fixed = bundleItemsFromImportedNames(rows, fixedNames, product.id);
    const existingChoiceGroups = product.bundleChoiceGroups || [];
    const choiceGroups: ProductBundleChoiceGroup[] = [];
    let unmatchedCount = fixed.unmatchedCount;
    let choiceOptionCount = 0;
    choiceGroupRecords.forEach(group => {
      const resolved = bundleItemsFromImportedNames(rows, group.itemNames, product.id);
      unmatchedCount += resolved.unmatchedCount;
      if (!resolved.items.length) return;
      const existingGroup = existingChoiceGroups.find(item => item.name === group.name);
      choiceGroups.push({
        id: existingGroup?.id || uid('bundle_group'),
        name: group.name || '任选组',
        selectionQty: Math.max(1, Math.floor(Number(group.selectionQty) || 1)),
        items: resolved.items
      });
      choiceOptionCount += resolved.items.length;
    });
    product.bundleItems = fixed.items;
    product.bundleChoiceGroups = choiceGroups;
    const after = JSON.stringify({
      category: product.category,
      stapleServingCount: product.stapleServingCount,
      bundleItems: product.bundleItems || [],
      bundleChoiceGroups: product.bundleChoiceGroups || []
    });
    return {
      changed: before !== after,
      fixedItemCount: fixed.items.reduce((sum, row) => sum + row.qty, 0),
      choiceGroupCount: choiceGroups.length,
      choiceOptionCount,
      unmatchedCount
    };
  };
  const syncUnifiedPackageFeeFromImport = (product: Product, importedPackageFee: number | undefined) => {
    if (importedPackageFee === undefined || importedPackageFee <= 0) return false;
    const nextPackageFee = roundMoney(importedPackageFee);
    if (roundMoney(product.packageFee) === nextPackageFee) return false;
    product.packageFee = nextPackageFee;
    return true;
  };
  const platformImportItemKey = (item: PlatformProductRecord, index: number) => {
    const code = normalizeProductCode(item.merchantProductCode);
    return `${code ? `code:${code}` : `name:${normalizeProductMatchName(item.name)}`}::${index}`;
  };
  const findProductByMerchantCode = (rows: Product[], code: unknown) => {
    const normalizedCode = normalizeProductCode(code);
    if (!normalizedCode) return null;
    return rows.find(product => normalizeProductCode(product.merchantProductCode) === normalizedCode) || null;
  };
  const buildJingdongImportSimilarMatches = (items: PlatformProductRecord[]) => {
    const productMap = new Map(productSource.map(product => [normalizeProductMatchName(product.name), product]));
    const reservedProductIds = new Set<string>();
    const matches: JingdongImportSimilarMatch[] = [];
    items.forEach((item, index) => {
      if (findProductByMerchantCode(productSource, item.merchantProductCode)) return;
      if (productMap.has(normalizeProductMatchName(item.name))) return;
      const match = findSimilarProductMatchForPlatformImport(productSource, item, 'jingdong', {
        allowPlatformOverride: true,
        excludeProductIds: reservedProductIds
      });
      if (!match) return;
      reservedProductIds.add(match.product.id);
      matches.push({
        key: platformImportItemKey(item, index),
        item,
        product: match.product,
        score: match.score
      });
    });
    return matches;
  };
  const applyPlatformProductImport = (
    product: Product,
    item: PlatformProductRecord,
    platform: PlatformProductImportPlatform
  ) => {
    const rule = platformProductImportRules[platform];
    const before = JSON.stringify({
      price: product[rule.priceField],
      packageFee: product[rule.packageFeeField],
      enabled: product[rule.enabledField],
      unifiedPackageFee: product.packageFee,
      merchantProductCode: product.merchantProductCode || '',
      barcode: product.barcode || '',
      jingdongSkuCode: product.jingdongSkuCode || ''
    });
    product[rule.priceField] = item.price;
    if (item.packageFee !== undefined) product[rule.packageFeeField] = item.packageFee;
    syncUnifiedPackageFeeFromImport(product, item.packageFee);
    if (item.platformEnabled !== undefined) product[rule.enabledField] = item.platformEnabled;
    if (platform === 'jingdong') {
      product[rule.enabledField] = item.platformEnabled !== false;
      if (item.merchantProductCode) product.merchantProductCode = normalizeProductCode(item.merchantProductCode);
      if (item.barcode) product.barcode = normalizeProductCode(item.barcode);
      if (item.platformSkuCode) product.jingdongSkuCode = normalizeProductCode(item.platformSkuCode);
    }
    const after = JSON.stringify({
      price: product[rule.priceField],
      packageFee: product[rule.packageFeeField],
      enabled: product[rule.enabledField],
      unifiedPackageFee: product.packageFee,
      merchantProductCode: product.merchantProductCode || '',
      barcode: product.barcode || '',
      jingdongSkuCode: product.jingdongSkuCode || ''
    });
    return before !== after;
  };
  const applyJingdongProductImport = (
    parsed: ParsedPlatformProductWorkbook,
    mergeByKey: Record<string, boolean>,
    confirmedMatches?: JingdongImportSimilarMatch[]
  ) => {
    const rule = platformProductImportRules.jingdong;
    let added = 0;
    let updated = 0;
    let unchanged = 0;
    let exactMerged = 0;
    let codeMerged = 0;
    let userMerged = 0;
    let unlistedDisabled = 0;
    updateProductsDraft(draft => {
      const matchedProductIds = new Set<string>();
      const similarMatchByKey = new Map(
        (confirmedMatches || buildJingdongImportSimilarMatches(parsed.products)).map(match => [match.key, match])
      );
      const productNameMap = () => new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
      parsed.products.forEach((item, index) => {
        const itemKey = platformImportItemKey(item, index);
        const codeExisting = findProductByMerchantCode(draft, item.merchantProductCode);
        const exactExisting = codeExisting || productNameMap().get(normalizeProductMatchName(item.name)) || null;
        const similarMatch = exactExisting ? null : similarMatchByKey.get(itemKey) || null;
        const similarExisting = similarMatch && mergeByKey[itemKey]
          ? draft.find(product => product.id === similarMatch.product.id) || null
          : null;
        const existing = exactExisting || similarExisting;
        if (existing) {
          const changed = applyPlatformProductImport(existing, item, 'jingdong');
          matchedProductIds.add(existing.id);
          if (changed) updated++;
          else unchanged++;
          if (codeExisting) codeMerged++;
          else if (similarMatch) userMerged++;
          else exactMerged++;
          return;
        }
        const product = normalizeProduct({
          name: item.name,
          merchantProductCode: item.merchantProductCode,
          barcode: item.barcode,
          jingdongSkuCode: item.platformSkuCode,
          price: item.price,
          cost: 0,
          meituanPrice: '',
          elemePrice: '',
          jingdongPrice: item.price,
          meituanEnabled: false,
          elemeEnabled: false,
          jingdongEnabled: item.platformEnabled !== false,
          nonStandalone: false
        });
        if (item.packageFee !== undefined) product.jingdongPackageFee = item.packageFee;
        syncUnifiedPackageFeeFromImport(product, item.packageFee);
        draft.push(product);
        matchedProductIds.add(product.id);
        added++;
      });
      draft.forEach(product => {
        if (matchedProductIds.has(product.id)) return;
        if (!product.jingdongEnabled) return;
        product.jingdongEnabled = false;
        unlistedDisabled++;
      });
    });
    setPendingJingdongImport(null);
    setJingdongImportMergeByKey({});
    message.success(`已导入${rule.name}商品：识别 ${parsed.products.length} 个，按编码合并 ${codeMerged} 个，按名称合并 ${exactMerged} 个，确认合并 ${userMerged} 个，新增 ${added} 个，更新 ${updated} 个，未变化 ${unchanged} 个，未在表内下架 ${unlistedDisabled} 个。`);
    if (parsed.disabled) message.info(`其中 ${parsed.disabled} 个商品在京东表内为下架或暂停售卖状态。`);
  };
  const importPlatformProducts = async (file: File, platform: PlatformProductImportPlatform) => {
    if (!isEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    try {
      const parsed = parsePlatformProductWorkbook(await readWorkbook(file), platform);
      if (!parsed.products.length) {
        message.warning(`没有识别到有效${platformProductImportRules[platform].name}商品，请确认表格包含商品名称和价格列。`);
        return;
      }
      if (platform === 'jingdong') {
        const matches = buildJingdongImportSimilarMatches(parsed.products);
        if (matches.length) {
          setPendingJingdongImport({ fileName: file.name, parsed, matches });
          setJingdongImportMergeByKey(Object.fromEntries(matches.map(match => [match.key, true])));
          return;
        }
        applyJingdongProductImport(parsed, {});
        return;
      }
      const rule = platformProductImportRules[platform];
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      let similarMerged = 0;
      let bundleUpdated = 0;
      let bundleFixedItemCount = 0;
      let bundleChoiceGroupCount = 0;
      let bundleChoiceOptionCount = 0;
      let bundleUnmatchedCount = 0;
      updateProductsDraft(draft => {
        const productMap = new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
        const importedRows: Array<{ item: PlatformProductRecord; product: Product; isNew: boolean; productChanged: boolean }> = [];
        parsed.products.forEach(item => {
          const key = normalizeProductMatchName(item.name);
          const exactExisting = productMap.get(key);
          const similarExisting = exactExisting ? null : findSimilarProductForPlatformImport(draft, item, platform);
          const existing = exactExisting || similarExisting;
          if (existing) {
            const productChanged = applyPlatformProductImport(existing, item, platform);
            importedRows.push({ item, product: existing, isNew: false, productChanged });
            if (similarExisting) {
              similarMerged++;
              productMap.set(key, existing);
            }
            return;
          }
          const product = normalizeProduct({
            name: item.name,
            price: item.price,
            cost: 0,
            meituanPrice: '',
            elemePrice: '',
            jingdongPrice: '',
            meituanEnabled: true,
            elemeEnabled: true,
            jingdongEnabled: true,
            nonStandalone: false
          });
          product[rule.priceField] = item.price;
          if (item.packageFee !== undefined) product[rule.packageFeeField] = item.packageFee;
          syncUnifiedPackageFeeFromImport(product, item.packageFee);
          if (item.platformEnabled !== undefined) product[rule.enabledField] = item.platformEnabled;
          draft.push(product);
          productMap.set(key, product);
          importedRows.push({ item, product, isNew: true, productChanged: true });
          added++;
        });
        importedRows.forEach(row => {
          const bundleResult = platform === 'eleme'
            ? applyImportedBundleComposition(row.product, row.item, draft)
            : { changed: false, fixedItemCount: 0, choiceGroupCount: 0, choiceOptionCount: 0, unmatchedCount: 0 };
          if (bundleResult.changed) bundleUpdated++;
          bundleFixedItemCount += bundleResult.fixedItemCount;
          bundleChoiceGroupCount += bundleResult.choiceGroupCount;
          bundleChoiceOptionCount += bundleResult.choiceOptionCount;
          bundleUnmatchedCount += bundleResult.unmatchedCount;
          if (row.isNew) return;
          if (row.productChanged || bundleResult.changed) updated++;
          else unchanged++;
        });
      });
      const bundleMessage = platform === 'eleme' && (bundleUpdated || bundleFixedItemCount || bundleChoiceGroupCount || bundleUnmatchedCount)
        ? `，套餐组成更新 ${bundleUpdated} 个，固定项 ${bundleFixedItemCount} 个，任选组 ${bundleChoiceGroupCount} 个/选项 ${bundleChoiceOptionCount} 个${bundleUnmatchedCount ? `，未匹配子品 ${bundleUnmatchedCount} 个` : ''}`
        : '';
      message.success(`已导入${rule.name}商品：识别 ${parsed.products.length} 个，更新 ${updated} 个，新增 ${added} 个，相似合并 ${similarMerged} 个，未变化 ${unchanged} 个${bundleMessage}。`);
      if (parsed.disabled) message.info(`其中 ${parsed.disabled} 个商品为下架或暂停售卖状态。`);
    } catch {
      message.error(`导入${platformProductImportRules[platform].name}商品表失败，请确认文件格式。`);
    }
  };
  const importCostFile = async (file: File) => {
    if (!isEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    try {
      const parsed = parseCostWorkbook(await readWorkbook(file));
      if (!parsed.costs.length) {
        message.warning('没有识别到有效成本数据，请确认表格包含商品名称和成本价列。');
        return;
      }
      let updated = 0;
      let unchanged = 0;
      let unmatched = 0;
      updateProductsDraft(draft => {
        const productMap = new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
        parsed.costs.forEach(item => {
          const product = productMap.get(normalizeProductMatchName(item.name));
          if (!product) {
            unmatched++;
            return;
          }
          const oldCost = roundMoney(product.cost);
          product.cost = item.cost;
          if (oldCost === item.cost) unchanged++;
          else updated++;
        });
      });
      message.success(`成本导入完成：识别 ${parsed.costs.length} 条，更新 ${updated} 个，未变化 ${unchanged} 个，未匹配 ${unmatched} 个。`);
    } catch {
      message.error('导入成本表失败，请确认文件包含商品名称和成本价列。');
    }
  };
  const importProductsFile = (file: File, onImported?: () => void) => {
    if (!isEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    file.text().then(text => {
      const importedProducts = parseProducts(text);
      if (!importedProducts.length) {
        message.warning('没有识别到有效商品。');
        return;
      }
      updateProductsDraft(draft => {
        draft.push(...importedProducts);
      });
      onImported?.();
      message.success(`已导入 ${importedProducts.length} 个商品。`);
    });
  };

  const clearProductFilters = () => setFilters(DEFAULT_PRODUCT_PAGE_FILTERS);
  const clearSelectedProducts = () => setSelectedProductRowKeys([]);
  const selectedProductIdSet = () => new Set(selectedProductRowKeys.map(String));
  const requireSelectedProducts = () => {
    if (selectedProductRowKeys.length > 0) return true;
    message.warning('请先选择需要批量操作的商品。');
    return false;
  };
  const updateSelectedProducts = (mutator: (product: Product) => void) => {
    if (!requireSelectedProducts()) return false;
    const selectedIds = selectedProductIdSet();
    updateProductsDraft(draft => {
      draft.forEach(product => {
        if (selectedIds.has(product.id)) mutator(product);
      });
    });
    return true;
  };
  const bulkSetProductFlag = (field: 'meituanEnabled' | 'elemeEnabled' | 'jingdongEnabled' | 'nonStandalone', value: boolean) => {
    const ok = updateSelectedProducts(product => {
      product[field] = value;
    });
    if (ok) message.success(`已批量更新 ${selectedProductRowKeys.length} 个商品。`);
  };
  const bulkSetProductCategory = () => {
    const ok = updateSelectedProducts(product => {
      product.category = bulk.category;
      product.stapleServingCount = inferStapleServingCount(product.name, bulk.category);
    });
    if (ok) message.success(`已批量设置 ${selectedProductRowKeys.length} 个商品分类。`);
  };
  const bulkSetStapleServingCount = () => {
    if (bulk.stapleServingCount === null || !Number.isFinite(bulk.stapleServingCount)) {
      message.warning('请输入主食份数。');
      return;
    }
    const nextCount = Math.max(0, Math.floor(bulk.stapleServingCount));
    const ok = updateSelectedProducts(product => {
      product.stapleServingCount = nextCount;
    });
    if (ok) message.success(`已批量设置 ${selectedProductRowKeys.length} 个商品主食份数。`);
  };
  const bulkClearPlatformOverride = (field: 'meituanPrice' | 'elemePrice' | 'jingdongPrice' | 'meituanPackageFee' | 'elemePackageFee' | 'jingdongPackageFee') => {
    const ok = updateSelectedProducts(product => {
      product[field] = '';
    });
    if (ok) message.success(`已清空 ${selectedProductRowKeys.length} 个商品的平台覆盖值。`);
  };
  const applyBulkPriceEdit = () => {
    if (!requireSelectedProducts()) return;
    if (bulk.priceValue === null || !Number.isFinite(bulk.priceValue)) {
      message.warning('请输入批量调整的数值。');
      return;
    }
    const selectedIds = selectedProductIdSet();
    updateProductsDraft(draft => {
      draft.forEach(product => {
        if (!selectedIds.has(product.id)) return;
        product[bulk.priceField] = roundMoney(resolveBulkPriceValue(product, bulk.priceField, bulk.priceMode, bulk.priceValue as number));
      });
    });
    message.success(`已批量调整 ${selectedProductRowKeys.length} 个商品。`);
  };
  const bulkDeleteProducts = () => {
    if (!requireSelectedProducts()) return;
    const selectedIds = selectedProductIdSet();
    const selectedProducts = displayedProducts.filter(product => selectedIds.has(product.id));
    const preview = selectedProducts.slice(0, 5).map(product => product.name).join('、');
    modal.confirm({
      title: '批量删除商品',
      content: `确定删除选中的 ${selectedProducts.length} 个商品吗？${preview ? `包括：${preview}${selectedProducts.length > 5 ? '等' : ''}` : ''}。删除只会先进入编辑草稿，保存商品后才会生效。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        updateProductsDraft(draft => {
          for (let index = draft.length - 1; index >= 0; index--) {
            if (selectedIds.has(draft[index].id)) draft.splice(index, 1);
          }
        });
        setSelectedProductRowKeys([]);
      }
    });
  };
  const deleteZeroPriceProducts = () => {
    const zeroProducts = displayedProducts.filter(product =>
      roundMoney(product.price) <= 0 &&
      (product.meituanPrice === '' || roundMoney(product.meituanPrice) <= 0) &&
      (product.elemePrice === '' || roundMoney(product.elemePrice) <= 0) &&
      (product.jingdongPrice === '' || roundMoney(product.jingdongPrice) <= 0)
    );
    if (!zeroProducts.length) {
      message.info('当前没有 0 元商品。');
      return;
    }
    const zeroIds = new Set(zeroProducts.map(product => product.id));
    const preview = zeroProducts.slice(0, 5).map(product => product.name).join('、');
    modal.confirm({
      title: '删除0元商品',
      content: `确定删除 ${zeroProducts.length} 个 0 元商品吗？${preview ? `包括：${preview}${zeroProducts.length > 5 ? '等' : ''}` : ''}。删除只会先进入编辑草稿，保存商品后才会生效。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        updateProductsDraft(draft => {
          for (let index = draft.length - 1; index >= 0; index--) {
            if (zeroIds.has(draft[index].id)) draft.splice(index, 1);
          }
        });
        setSelectedProductRowKeys(prev => prev.filter(key => !zeroIds.has(String(key))));
      }
    });
  };
  const selectFirstDuplicateProductGroup = () => {
    if (!productDuplicateGroups.length) {
      message.info('当前没有识别到高置信疑似重复商品。');
      return;
    }
    setSelectedProductRowKeys(productDuplicateGroups[0].map(product => product.id));
    message.info(`已选择疑似重复商品：${productDuplicateGroups[0].map(product => product.name).join('、')}`);
  };
  const mergeSelectedDuplicateProducts = () => {
    if (selectedProductRowKeys.length < 2) {
      message.warning('请至少选择 2 个需要合并的商品。');
      return;
    }
    const selectedIds = selectedProductIdSet();
    const selectedProducts = productSource.filter(product => selectedIds.has(product.id));
    if (selectedProducts.length < 2) {
      message.warning('请至少选择 2 个需要合并的商品。');
      return;
    }
    const primary = chooseProductMergePrimary(selectedProducts);
    const duplicates = selectedProducts.filter(product => product.id !== primary.id);
    const merged = mergeProductRecords(primary, duplicates);
    modal.confirm({
      title: '合并选中商品',
      content: (
          <Space direction="vertical">
          <Text>将 {selectedProducts.length} 个商品合并为「{merged.name}」。</Text>
          <Text type="secondary">主商品：{primary.name}。合并会保留主商品已有字段，并用其他商品补齐缺失的平台价、打包费、成本、分类和上下架状态。</Text>
          <Text type="secondary">被合并商品：{duplicates.map(product => product.name).join('、')}</Text>
          <Text type="secondary">该操作只修改当前编辑草稿，点击“保存商品”后才会生效。</Text>
        </Space>
      ),
      okText: '合并',
      cancelText: '取消',
      onOk: () => {
        updateProductsDraft(draft => {
          const duplicateIds = new Set(duplicates.map(product => product.id));
          const primaryIndex = draft.findIndex(product => product.id === primary.id);
          if (primaryIndex >= 0) draft[primaryIndex] = merged;
          for (let index = draft.length - 1; index >= 0; index--) {
            if (duplicateIds.has(draft[index].id)) draft.splice(index, 1);
          }
        });
        setSelectedProductRowKeys([merged.id]);
        message.success(`已合并 ${selectedProducts.length} 个商品，保存商品后生效。`);
      }
    });
  };
  const applyBulkProducts = (mode: 'append' | 'replace') => {
    if (!isEditing) {
      message.warning('请先进入商品编辑状态。');
      return;
    }
    const products = parseProducts(bulk.text);
    if (!products.length) {
      message.warning('没有识别到有效商品。');
      return;
    }
    const apply = () => {
      updateProductsDraft(draft => {
        if (mode === 'replace') {
          draft.splice(0, draft.length, ...products);
          return;
        }
        draft.push(...products);
      });
      if (mode === 'replace') setSelectedProductRowKeys([]);
      setBulk(prev => ({ ...prev, text: '' }));
    };
    if (mode === 'replace') {
      modal.confirm({
        title: '替换商品',
        content: `确定用 ${products.length} 个商品替换当前门店商品吗？当前门店原商品会被移除。`,
        okText: '替换',
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: apply
      });
      return;
    }
    apply();
  };

  const bundleItemsText = (product: Product) => {
    const fixedItems = product.bundleItems || [];
    const choiceGroups = product.bundleChoiceGroups || [];
    const parts: string[] = [];
    if (fixedItems.length) {
      parts.push(`固定：${fixedItems.map(item => `${bundleComponentName(item.productId)}×${item.qty}`).join('、')}`);
    }
    choiceGroups.forEach(group => {
      const itemText = group.items.map(item => bundleComponentName(item.productId)).join(' / ');
      parts.push(`${group.name}任选${group.selectionQty}：${itemText}`);
    });
    return parts.join('；');
  };
  const bundleConfiguredCount = (product: Product) => (
    (product.bundleItems || []).length + (product.bundleChoiceGroups || []).length
  );
  const bundleFixedItemQty = (product: Product) => (
    (product.bundleItems || []).reduce((sum, item) => sum + Math.max(1, Math.floor(Number(item.qty) || 1)), 0)
  );
  const bundleSummaryText = (product: Product) => {
    const fixedQty = bundleFixedItemQty(product);
    const choiceCount = (product.bundleChoiceGroups || []).length;
    const parts = [
      fixedQty ? `固定${fixedQty}件` : '',
      choiceCount ? `任选${choiceCount}组` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' / ') : '未配置';
  };
  const bundleComponentProduct = React.useCallback((productId: string) => (
    productSource.find(product => product.id === productId) || null
  ), [productSource]);
  const bundleItemAmount = (item: NonNullable<Product['bundleItems']>[number]) => {
    const component = bundleComponentProduct(item.productId);
    const qty = Math.max(1, Math.floor(Number(item.qty) || 1));
    const unitPrice = component ? Number(component.price) || 0 : 0;
    const unitCost = component ? Number(component.cost) || 0 : 0;
    return {
      component,
      qty,
      price: component ? roundMoney(unitPrice * qty) : 0,
      cost: component ? roundMoney(unitCost * qty) : 0,
      missingCost: Boolean(component && unitCost <= 0)
    };
  };
  const bundleAmountRangeText = (min: number, average: number, max: number) => {
    if (Math.abs(min - max) <= 0.01) return `¥${money(max)}`;
    return `¥${money(min)}-${money(max)}（均¥${money(average)}）`;
  };
  const bundleFixedAmountSummary = (items: NonNullable<Product['bundleItems']>) => {
    const amounts = items.map(bundleItemAmount).filter(amount => amount.component);
    const price = roundMoney(amounts.reduce((sum, amount) => sum + amount.price, 0));
    const cost = roundMoney(amounts.reduce((sum, amount) => sum + amount.cost, 0));
    return {
      priceMin: price,
      priceAverage: price,
      priceMax: price,
      costMin: cost,
      costAverage: cost,
      costMax: cost,
      missingCostCount: amounts.filter(amount => amount.missingCost).length
    };
  };
  const bundleChoiceAmountSummary = (items: NonNullable<Product['bundleItems']>, selectionQty: number) => {
    const amounts = items.map(bundleItemAmount).filter(amount => amount.component);
    const pickedCount = Math.min(Math.max(1, Math.floor(Number(selectionQty) || 1)), amounts.length);
    const sumField = (values: typeof amounts, field: 'price' | 'cost') => roundMoney(values.reduce((sum, amount) => sum + amount[field], 0));
    const averageField = (field: 'price' | 'cost') => {
      if (!amounts.length || pickedCount <= 0) return 0;
      return roundMoney((amounts.reduce((sum, amount) => sum + amount[field], 0) / amounts.length) * pickedCount);
    };
    const byPriceAsc = [...amounts].sort((a, b) => a.price - b.price).slice(0, pickedCount);
    const byPriceDesc = [...amounts].sort((a, b) => b.price - a.price).slice(0, pickedCount);
    const byCostAsc = [...amounts].sort((a, b) => a.cost - b.cost).slice(0, pickedCount);
    const byCostDesc = [...amounts].sort((a, b) => b.cost - a.cost).slice(0, pickedCount);
    return {
      priceMin: sumField(byPriceAsc, 'price'),
      priceAverage: averageField('price'),
      priceMax: sumField(byPriceDesc, 'price'),
      costMin: sumField(byCostAsc, 'cost'),
      costAverage: averageField('cost'),
      costMax: sumField(byCostDesc, 'cost'),
      missingCostCount: amounts.filter(amount => amount.missingCost).length
    };
  };
  const bundleAmountSummaryTags = (summary: ReturnType<typeof bundleFixedAmountSummary>, isRange: boolean) => (
    <Space wrap size={[4, 4]}>
      <Tag color="green">总价 {isRange ? bundleAmountRangeText(summary.priceMin, summary.priceAverage, summary.priceMax) : `¥${money(summary.priceMax)}`}</Tag>
      <Tag color={summary.missingCostCount ? 'red' : 'orange'}>
        总成本 {isRange ? bundleAmountRangeText(summary.costMin, summary.costAverage, summary.costMax) : `¥${money(summary.costMax)}`}
        {summary.missingCostCount ? `，${summary.missingCostCount}项未填` : ''}
      </Tag>
    </Space>
  );
  const bundleDetailCostTarget = (product: Product) => {
    const fixedItems = product.bundleItems || [];
    const choiceGroups = product.bundleChoiceGroups || [];
    const blockers: string[] = [];
    let targetCost = 0;
    let invalidItemCount = fixedItems.filter(item => !bundleComponentProduct(item.productId)).length;
    let missingCostCount = 0;
    if (!fixedItems.length && !choiceGroups.length) blockers.push('套餐未配置组成');
    if (fixedItems.length) {
      const summary = bundleFixedAmountSummary(fixedItems);
      targetCost = roundMoney(targetCost + summary.costMax);
      missingCostCount += summary.missingCostCount;
    }
    choiceGroups.forEach(group => {
      const selectionQty = Math.max(1, Math.floor(Number(group.selectionQty) || 1));
      const validOptionCount = group.items.filter(item => bundleComponentProduct(item.productId)).length;
      invalidItemCount += group.items.length - validOptionCount;
      if (!group.items.length) blockers.push(`${group.name || '任选组'}未配置可选商品`);
      if (validOptionCount < selectionQty) blockers.push(`${group.name || '任选组'}可选项少于任选数量`);
      const summary = bundleChoiceAmountSummary(group.items, selectionQty);
      targetCost = roundMoney(targetCost + (bundleCostSyncMode === 'max' ? summary.costMax : summary.costAverage));
      missingCostCount += summary.missingCostCount;
    });
    if (invalidItemCount) blockers.push(`有 ${invalidItemCount} 个组成商品失效`);
    if (missingCostCount) blockers.push(`有 ${missingCostCount} 个组成商品缺成本`);
    return {
      targetCost: blockers.length ? null : roundMoney(targetCost),
      blockers
    };
  };
  const syncBundleCostFromDetails = (product: Product) => {
    if (!isEditing) {
      message.warning('请先进入商品编辑状态，再同步套餐成本。');
      return;
    }
    const result = bundleDetailCostTarget(product);
    if (result.targetCost === null) {
      message.warning(`暂不能同步成本：${result.blockers.join('；')}。`);
      return;
    }
    const targetCost = result.targetCost;
    let changed = false;
    updateProductsDraft(draft => {
      const index = draft.findIndex(item => item.id === product.id);
      if (index < 0) return;
      if (roundMoney(draft[index].cost) === targetCost) return;
      draft[index].cost = targetCost;
      changed = true;
    });
    setBundleDetailPopoverProductId('');
    const modeText = bundleCostSyncMode === 'max' ? '最高成本' : '平均成本';
    if (changed) message.success(`已按${modeText}同步「${product.name}」套餐成本为 ¥${money(targetCost)}。`);
    else message.info(`「${product.name}」套餐成本已是 ¥${money(targetCost)}，无需更新。`);
  };
  const bundleItemPriceCard = (item: NonNullable<Product['bundleItems']>[number], index: number, accentColor = '#d9d9d9') => {
    const amount = bundleItemAmount(item);
    const priceText = amount.component ? `¥${money(amount.price)}` : '-';
    const costText = amount.component ? amount.missingCost ? '未填' : `¥${money(amount.cost)}` : '-';
    return (
      <div
        key={`${item.productId}-${item.qty}-${index}`}
        style={{
          border: `1px solid ${accentColor}`,
          borderRadius: 6,
          padding: '6px 8px',
          minWidth: 158,
          maxWidth: 178,
          background: '#fff'
        }}
      >
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <Text strong style={{ fontSize: 12, lineHeight: '18px' }}>
            售 {priceText}
            <Text type={amount.missingCost ? 'danger' : 'secondary'} style={{ fontSize: 12 }}> / 成本 {costText}</Text>
          </Text>
          <Text className="table-text-wrap" title={amount.component?.name || '失效商品'}>
            {amount.component?.name || '失效商品'} × {amount.qty}
          </Text>
        </Space>
      </div>
    );
  };
  const bundleDetailContent = (product: Product) => {
    const fixedItems = product.bundleItems || [];
    const choiceGroups = product.bundleChoiceGroups || [];
    const hasConfig = Boolean(fixedItems.length || choiceGroups.length);
    const costTarget = bundleDetailCostTarget(product);
    const modeText = bundleCostSyncMode === 'max' ? '最高成本' : '平均成本';
    return (
      <Space direction="vertical" style={{ width: 460, maxWidth: '72vw' }} size="middle">
        <Space direction="vertical" style={{ width: '100%' }} size={2}>
          <Text strong className="table-text-wrap">{product.name || '未命名套餐'}</Text>
          <Text type="secondary">
            {hasConfig ? `共 ${bundleFixedItemQty(product)} 个固定商品，${choiceGroups.length} 个任选组。` : '暂无套餐组成。'}
          </Text>
          <Text type="secondary">
            当前套餐成本 ¥{money(product.cost)}；按明细{modeText} {costTarget.targetCost === null ? '暂不能计算' : `¥${money(costTarget.targetCost)}`}
          </Text>
        </Space>
        {fixedItems.length ? (
          <Space direction="vertical" style={{ width: '100%' }} size={4}>
            {bundleAmountSummaryTags(bundleFixedAmountSummary(fixedItems), false)}
            <Text strong>固定组合</Text>
            <Text type="secondary">明细</Text>
            <Space wrap size={[6, 6]}>{fixedItems.map((item, index) => bundleItemPriceCard(item, index))}</Space>
          </Space>
        ) : null}
        {choiceGroups.length ? (
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            <Text strong>任选组合</Text>
            {choiceGroups.map((group, groupIndex) => (
              <Space key={group.id || groupIndex} direction="vertical" style={{ width: '100%' }} size={4}>
                {bundleAmountSummaryTags(bundleChoiceAmountSummary(group.items, group.selectionQty), true)}
                <Space wrap size={4}>
                  <Text>{group.name || '任选组'}</Text>
                  <Tag color="blue">任选 {Math.max(1, Math.floor(Number(group.selectionQty) || 1))} 项</Tag>
                </Space>
                <Text type="secondary">明细</Text>
                {group.items.length
                  ? <Space wrap size={[6, 6]}>{group.items.map((item, index) => bundleItemPriceCard(item, index, '#91caff'))}</Space>
                  : <Tag color="purple">未配置可选商品</Tag>}
              </Space>
            ))}
          </Space>
        ) : null}
        {isEditing ? (
          <Space wrap>
            <Select
              size="small"
              style={{ width: 150 }}
              value={bundleCostSyncMode}
              onChange={(value: BundleCostSyncMode) => setBundleCostSyncMode(value)}
              options={[
                { value: 'max', label: '最高成本（推荐）' },
                { value: 'average', label: '平均成本' }
              ]}
            />
            <Button
              size="small"
              disabled={costTarget.targetCost === null}
              onClick={() => syncBundleCostFromDetails(product)}
            >
              同步套餐成本
            </Button>
            <Button
              type="primary"
              size="small"
              onClick={() => {
                setBundleDetailPopoverProductId('');
                setEditingBundleProductId(product.id);
              }}
            >
              {hasConfig ? '编辑组成' : '配置组成'}
            </Button>
          </Space>
        ) : null}
      </Space>
    );
  };
  const renderBundleCompositionCell = (product: Product) => {
    if (product.category !== 'setMeal') return '-';
    const text = bundleItemsText(product);
    const summary = bundleSummaryText(product);
    const isConfigured = bundleConfiguredCount(product) > 0;
    return (
      <Popover
        trigger="click"
        placement="rightTop"
        open={bundleDetailPopoverProductId === product.id}
        onOpenChange={open => setBundleDetailPopoverProductId(open ? product.id : '')}
        content={bundleDetailContent(product)}
      >
        <Button
          size="small"
          type={isConfigured ? 'default' : 'dashed'}
          style={{ width: '100%', justifyContent: 'flex-start' }}
          title={text || summary}
        >
          <span style={{ display: 'block', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {summary}
          </span>
        </Button>
      </Popover>
    );
  };
  const bundlePriceDiscountRate = Math.max(0, Math.min(90, Number(bundlePriceDiscountPercent) || 0)) / 100;
  const bundlePriceTargetTotal = (row: BundlePriceCheckRow) => (
    row.componentAverageTotal === null ? null : roundMoney(row.componentAverageTotal * (1 - bundlePriceDiscountRate))
  );
  const canSyncBundlePrice = (row: BundlePriceCheckRow) => (
    row.componentAverageTotal !== null && !row.invalidItemCount && !row.choiceShortageCount
  );
  const canSyncBundleCost = (row: BundlePriceCheckRow) => (
    bundleCostTotalByMode(row, bundleCostSyncMode) !== null &&
    !row.invalidItemCount &&
    !row.choiceShortageCount &&
    !row.missingCostCount
  );
  const requireBundleSyncEditing = () => {
    if (isEditing) return true;
    message.warning('请先进入商品编辑状态，再写回套餐售价或成本。');
    return false;
  };
  const applyBundlePlatformPrices = (rows: BundlePriceCheckRow[]) => {
    if (!requireBundleSyncEditing()) return;
    const usableRows = rows.filter(canSyncBundlePrice);
    if (!usableRows.length) {
      message.warning('没有可写回售价的套餐，请先补齐套餐组成。');
      return;
    }
    let updated = 0;
    let unchanged = 0;
    let skipped = rows.length - usableRows.length;
    updateProductsDraft(draft => {
      usableRows.forEach(row => {
        const product = draft.find(item => item.id === row.productId);
        const targetTotal = bundlePriceTargetTotal(row);
        if (!product || targetTotal === null) {
          skipped++;
          return;
        }
        const rule = platformProductImportRules[row.platform];
        const packageFee = PlatformUtils.packageFee(product, row.platform);
        const nextPrice = roundMoney(Math.max(0, targetTotal - packageFee));
        if (roundMoney(product[rule.priceField]) === nextPrice) {
          unchanged++;
          return;
        }
        product[rule.priceField] = nextPrice;
        updated++;
      });
    });
    message.success(`已按 ${money(bundlePriceDiscountPercent)}% 优惠率写回套餐售价：更新 ${updated} 个，未变化 ${unchanged} 个，跳过 ${skipped} 个。`);
  };
  const applyBundleCosts = (rows: BundlePriceCheckRow[]) => {
    if (!requireBundleSyncEditing()) return;
    const usableRows = rows.filter(canSyncBundleCost);
    if (!usableRows.length) {
      message.warning('没有可同步成本的套餐，请先补齐组成商品成本。');
      return;
    }
    const rowByProductId = new Map<string, BundlePriceCheckRow>();
    usableRows.forEach(row => {
      if (!rowByProductId.has(row.productId)) rowByProductId.set(row.productId, row);
    });
    let updated = 0;
    let unchanged = 0;
    let skipped = rows.length - rowByProductId.size;
    updateProductsDraft(draft => {
      rowByProductId.forEach(row => {
        const product = draft.find(item => item.id === row.productId);
        const nextCost = bundleCostTotalByMode(row, bundleCostSyncMode);
        if (!product || nextCost === null) {
          skipped++;
          return;
        }
        if (roundMoney(product.cost) === nextCost) {
          unchanged++;
          return;
        }
        product.cost = nextCost;
        updated++;
      });
    });
    const modeText = bundleCostSyncMode === 'max' ? '最高成本' : '平均成本';
    message.success(`已按${modeText}同步套餐成本：更新 ${updated} 个，未变化 ${unchanged} 个，跳过 ${skipped} 个。`);
  };
  const bundlePriceCheckColumns: TableColumnsType<BundlePriceCheckRow> = [
    {
      title: '等级',
      dataIndex: 'severity',
      width: 80,
      fixed: 'left',
      render: value => <Tag color={severityColor(value as Severity)}>{severityLabel(value as Severity)}</Tag>,
      sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity),
      defaultSortOrder: 'descend'
    },
    {
      title: '套餐',
      dataIndex: 'productName',
      width: 220,
      fixed: 'left',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text className="table-text-wrap" title={row.productName}>{row.productName || '-'}</Text>
        </Space>
      ),
      sorter: (a, b) => compareProductText(a.productName, b.productName)
    },
    {
      title: '套餐总价',
      dataIndex: 'setMealPrice',
      width: 105,
      render: value => `¥${money(value)}`,
      sorter: (a, b) => compareProductNumber(a.setMealPrice, b.setMealPrice)
    },
    {
      title: '单品合计',
      width: 210,
      render: (_, row) => row.componentAverageTotal === null
        ? '-'
        : (
          <Space direction="vertical" size={0}>
            <Text>均值 ¥{money(row.componentAverageTotal)}</Text>
            <Text type="secondary">最低 ¥{money(row.componentMinTotal)} / 最高 ¥{money(row.componentMaxTotal)}</Text>
          </Space>
        ),
      sorter: (a, b) => compareProductNumber(a.componentAverageTotal, b.componentAverageTotal)
    },
    {
      title: '目标总价',
      width: 105,
      render: (_, row) => {
        const targetTotal = bundlePriceTargetTotal(row);
        return targetTotal === null ? '-' : `¥${money(targetTotal)}`;
      },
      sorter: (a, b) => compareProductNumber(bundlePriceTargetTotal(a), bundlePriceTargetTotal(b))
    },
    {
      title: '优惠差额',
      dataIndex: 'discountAmount',
      width: 115,
      render: value => {
        if (value === null) return '-';
        const amount = Number(value) || 0;
        if (Math.abs(amount) <= 0.01) return '持平';
        return <Text type={amount > 0 ? 'success' : 'danger'}>{amount > 0 ? '省' : '贵'} ¥{money(Math.abs(amount))}</Text>;
      },
      sorter: (a, b) => compareProductNumber(a.discountAmount, b.discountAmount)
    },
    {
      title: '折扣率',
      dataIndex: 'discountRate',
      width: 100,
      render: value => value === null ? '-' : rateText(value as number),
      sorter: (a, b) => compareProductNumber(a.discountRate, b.discountRate)
    },
    {
      title: '套餐成本',
      width: 185,
      render: (_, row) => row.componentAverageCostTotal === null || row.componentMaxCostTotal === null
        ? '-'
        : (
          <Space direction="vertical" size={0}>
            <Text>当前 ¥{money(row.productCost)}</Text>
            <Text type="secondary">均值 ¥{money(row.componentAverageCostTotal)} / 最高 ¥{money(row.componentMaxCostTotal)}</Text>
          </Space>
        ),
      sorter: (a, b) => compareProductNumber(a.productCost, b.productCost)
    },
    {
      title: '最高成本余量',
      width: 145,
      render: (_, row) => row.componentMaxCostTotal === null || row.profitAtMaxCost === null
        ? '-'
        : (
          <Space direction="vertical" size={0}>
            <Text>成本 ¥{money(row.componentMaxCostTotal)}</Text>
            <Text type={row.profitAtMaxCost <= 0.01 ? 'danger' : 'secondary'}>余量 ¥{money(row.profitAtMaxCost)}</Text>
          </Space>
        ),
      sorter: (a, b) => compareProductNumber(a.profitAtMaxCost, b.profitAtMaxCost)
    },
    {
      title: '核对结果',
      width: 360,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text type={row.severity === 'none' ? 'secondary' : 'danger'} className="table-text-wrap" title={row.reasons.join('；')}>
            {row.reasons.join('；')}
          </Text>
          <Text type="secondary" className="table-text-wrap" title={row.compositionText}>{row.compositionText}</Text>
        </Space>
      )
    },
    {
      title: '写回',
      width: 165,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4} wrap>
          <Button size="small" disabled={!isEditing || !canSyncBundlePrice(row)} onClick={() => applyBundlePlatformPrices([row])}>设售价</Button>
          <Button size="small" disabled={!isEditing || !canSyncBundleCost(row)} onClick={() => applyBundleCosts([row])}>同步成本</Button>
        </Space>
      )
    }
  ];
  const bundlePriceCheckTabs = PlatformUtils.ALL_PLATFORMS.map(platform => {
    const rows = bundlePriceCheckRowsByPlatform[platform];
    const issueCount = rows.filter(row => row.severity !== 'none').length;
    return {
      key: platform,
      label: (
        <Space size={4}>
          <span>{PlatformUtils.NAMES[platform]}</span>
          <Tag color={issueCount ? 'orange' : 'green'}>{issueCount ? `需复核 ${issueCount}` : '正常'}</Tag>
        </Space>
      ),
      children: (
        <Space direction="vertical" style={{ width: '100%' }} size="small">
          <Space wrap>
            <Tag color={rows.length ? 'blue' : 'default'}>上架套餐 {rows.length} 条</Tag>
            <Tag color={issueCount ? 'orange' : 'green'}>需复核 {issueCount} 条</Tag>
            <Text type="secondary">{PlatformUtils.NAMES[platform]}按该平台商品价和打包费核对，平台价为空时沿用销售价。</Text>
          </Space>
          <Table
            rowKey="key"
            size="small"
            columns={bundlePriceCheckColumns}
            dataSource={rows}
            pagination={rows.length > 10 ? tablePagination(10) : false}
            scroll={{ x: 1790, y: 520 }}
            tableLayout="fixed"
            locale={{ emptyText: '当前平台没有上架套餐。' }}
          />
        </Space>
      )
    };
  });

  const productColumns: TableColumnsType<Product> = [
    {
      title: '商品名',
      dataIndex: 'name',
      width: 260,
      sorter: (a, b) => compareProductText(a.name, b.name),
      render: (_, row) => isEditing
        ? <Input value={row.name} onChange={e => updateProductDraft(row.id, { name: e.target.value })} />
        : <Text>{row.name || '-'}</Text>
    },
    {
      title: '商家编码',
      dataIndex: 'merchantProductCode',
      width: 150,
      sorter: (a, b) => compareProductText(a.merchantProductCode, b.merchantProductCode),
      render: (_, row) => isEditing
        ? <Input value={row.merchantProductCode || ''} onChange={event => updateProductDraft(row.id, { merchantProductCode: event.target.value })} />
        : <Text>{row.merchantProductCode || '-'}</Text>
    },
    {
      title: '分类',
      dataIndex: 'category',
      width: 125,
      sorter: (a, b) => compareProductText(productCategoryName(a.category), productCategoryName(b.category)),
      render: (_, row) => isEditing
        ? (
          <Select
            value={row.category}
            style={{ width: 110 }}
            onChange={(value: ProductCategory) => updateProductDraft(row.id, { category: value, stapleServingCount: inferStapleServingCount(row.name, value) })}
            options={productCategories.map(category => ({ value: category, label: productCategoryName(category) }))}
          />
        )
        : <Tag>{productCategoryName(row.category)}</Tag>
    },
    {
      title: '主食份数',
      dataIndex: 'stapleServingCount',
      width: 110,
      align: 'center',
      sorter: (a, b) => compareProductNumber(a.stapleServingCount, b.stapleServingCount),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={0} value={row.stapleServingCount} onChange={value => updateProductDraft(row.id, { stapleServingCount: Number(value) || 0 })} />
        : <Tag color={row.stapleServingCount > 0 ? 'blue' : 'default'}>{row.stapleServingCount}</Tag>
    },
    {
      title: '套餐组成',
      dataIndex: 'bundleItems',
      width: 150,
      render: (_, row) => renderBundleCompositionCell(row)
    },
    {
      title: '销售价',
      dataIndex: 'price',
      width: 120,
      sorter: (a, b) => compareProductNumber(a.price, b.price),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} value={row.price} onChange={value => updateProductDraft(row.id, { price: Number(value) || 0 })} />
        : `¥${money(row.price)}`
    },
    {
      title: '成本价',
      dataIndex: 'cost',
      width: 120,
      sorter: (a, b) => compareProductNumber(a.cost, b.cost),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} value={row.cost} onChange={value => updateProductDraft(row.id, { cost: Number(value) || 0 })} />
        : `¥${money(row.cost)}`
    },
    {
      title: '统一打包费',
      dataIndex: 'packageFee',
      width: 130,
      sorter: (a, b) => compareProductNumber(a.packageFee, b.packageFee),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} value={row.packageFee} onChange={value => updateProductDraft(row.id, { packageFee: Number(value) || 0 })} />
        : `¥${money(row.packageFee)}`
    },
    {
      title: '美团价',
      dataIndex: 'meituanPrice',
      width: 120,
      sorter: (a, b) => compareProductNumber(PlatformUtils.price(a, PlatformUtils.MEITUAN), PlatformUtils.price(b, PlatformUtils.MEITUAN)),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} placeholder="空=销售价" value={row.meituanPrice === '' ? null : row.meituanPrice} onChange={value => updateProductDraft(row.id, { meituanPrice: value === null ? '' : Number(value) })} />
        : (row.meituanPrice === '' ? '同销售价' : `¥${money(row.meituanPrice)}`)
    },
    {
      title: '美团打包费',
      dataIndex: 'meituanPackageFee',
      width: 130,
      sorter: (a, b) => compareProductNumber(PlatformUtils.packageFee(a, PlatformUtils.MEITUAN), PlatformUtils.packageFee(b, PlatformUtils.MEITUAN)),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} placeholder="空=统一" value={row.meituanPackageFee === '' ? null : row.meituanPackageFee} onChange={value => updateProductDraft(row.id, { meituanPackageFee: value === null ? '' : Number(value) })} />
        : (row.meituanPackageFee === '' ? '同统一' : `¥${money(row.meituanPackageFee)}`)
    },
    {
      title: '饿了么价',
      dataIndex: 'elemePrice',
      width: 120,
      sorter: (a, b) => compareProductNumber(PlatformUtils.price(a, PlatformUtils.ELEME), PlatformUtils.price(b, PlatformUtils.ELEME)),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} placeholder="空=销售价" value={row.elemePrice === '' ? null : row.elemePrice} onChange={value => updateProductDraft(row.id, { elemePrice: value === null ? '' : Number(value) })} />
        : (row.elemePrice === '' ? '同销售价' : `¥${money(row.elemePrice)}`)
    },
    {
      title: '饿了么打包费',
      dataIndex: 'elemePackageFee',
      width: 140,
      sorter: (a, b) => compareProductNumber(PlatformUtils.packageFee(a, PlatformUtils.ELEME), PlatformUtils.packageFee(b, PlatformUtils.ELEME)),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} placeholder="空=统一" value={row.elemePackageFee === '' ? null : row.elemePackageFee} onChange={value => updateProductDraft(row.id, { elemePackageFee: value === null ? '' : Number(value) })} />
        : (row.elemePackageFee === '' ? '同统一' : `¥${money(row.elemePackageFee)}`)
    },
    {
      title: '京东价',
      dataIndex: 'jingdongPrice',
      width: 120,
      sorter: (a, b) => compareProductNumber(PlatformUtils.price(a, PlatformUtils.JINGDONG), PlatformUtils.price(b, PlatformUtils.JINGDONG)),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} placeholder="空=销售价" value={row.jingdongPrice === '' ? null : row.jingdongPrice} onChange={value => updateProductDraft(row.id, { jingdongPrice: value === null ? '' : Number(value) })} />
        : (row.jingdongPrice === '' ? '同销售价' : `¥${money(row.jingdongPrice)}`)
    },
    {
      title: '京东打包费',
      dataIndex: 'jingdongPackageFee',
      width: 130,
      sorter: (a, b) => compareProductNumber(PlatformUtils.packageFee(a, PlatformUtils.JINGDONG), PlatformUtils.packageFee(b, PlatformUtils.JINGDONG)),
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} placeholder="空=统一" value={row.jingdongPackageFee === '' ? null : row.jingdongPackageFee} onChange={value => updateProductDraft(row.id, { jingdongPackageFee: value === null ? '' : Number(value) })} />
        : (row.jingdongPackageFee === '' ? '同统一' : `¥${money(row.jingdongPackageFee)}`)
    },
    {
      title: '美团上架',
      dataIndex: 'meituanEnabled',
      width: 100,
      align: 'center',
      sorter: (a, b) => Number(a.meituanEnabled) - Number(b.meituanEnabled),
      render: (_, row) => isEditing
        ? <Switch checked={row.meituanEnabled} onChange={checked => updateProductDraft(row.id, { meituanEnabled: checked })} />
        : <Tag color={row.meituanEnabled ? 'green' : 'default'}>{row.meituanEnabled ? '上架' : '下架'}</Tag>
    },
    {
      title: '饿了么上架',
      dataIndex: 'elemeEnabled',
      width: 110,
      align: 'center',
      sorter: (a, b) => Number(a.elemeEnabled) - Number(b.elemeEnabled),
      render: (_, row) => isEditing
        ? <Switch checked={row.elemeEnabled} onChange={checked => updateProductDraft(row.id, { elemeEnabled: checked })} />
        : <Tag color={row.elemeEnabled ? 'green' : 'default'}>{row.elemeEnabled ? '上架' : '下架'}</Tag>
    },
    {
      title: '京东上架',
      dataIndex: 'jingdongEnabled',
      width: 100,
      align: 'center',
      sorter: (a, b) => Number(a.jingdongEnabled) - Number(b.jingdongEnabled),
      render: (_, row) => isEditing
        ? <Switch checked={row.jingdongEnabled} onChange={checked => updateProductDraft(row.id, { jingdongEnabled: checked })} />
        : <Tag color={row.jingdongEnabled ? 'green' : 'default'}>{row.jingdongEnabled ? '上架' : '下架'}</Tag>
    },
    {
      title: '单点不送',
      dataIndex: 'nonStandalone',
      width: 100,
      align: 'center',
      sorter: (a, b) => Number(a.nonStandalone) - Number(b.nonStandalone),
      render: (_, row) => isEditing
        ? <Switch checked={row.nonStandalone} onChange={checked => updateProductDraft(row.id, { nonStandalone: checked })} />
        : <Tag color={row.nonStandalone ? 'orange' : 'green'}>{row.nonStandalone ? '是' : '否'}</Tag>
    },
    ...(isEditing ? [{
      title: '',
      width: 70,
      render: (_: unknown, row: Product) => <Button danger icon={<DeleteOutlined />} onClick={() => deleteProductDraft(row.id)} />
    }] : [])
  ];
  const pendingJingdongMatches = pendingJingdongImport?.matches || [];
  const pendingJingdongMergeCount = pendingJingdongMatches.filter(match => jingdongImportMergeByKey[match.key]).length;
  const jingdongImportSimilarColumns: TableColumnsType<JingdongImportSimilarMatch> = [
    {
      title: '处理方式',
      width: 105,
      fixed: 'left',
      render: (_, row) => (
        <Switch
          checked={jingdongImportMergeByKey[row.key] !== false}
          checkedChildren="合并"
          unCheckedChildren="新增"
          onChange={checked => setJingdongImportMergeByKey(prev => ({ ...prev, [row.key]: checked }))}
        />
      )
    },
    {
      title: '京东商品',
      width: 300,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text className="table-text-wrap">{row.item.name}</Text>
          <Text type="secondary">商家编码 {row.item.merchantProductCode || '-'}</Text>
          <Text type="secondary">京东价 ¥{money(row.item.price)}</Text>
        </Space>
      )
    },
    {
      title: '疑似现有商品',
      width: 300,
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text className="table-text-wrap">{row.product.name}</Text>
          <Text type="secondary">商家编码 {row.product.merchantProductCode || '-'}</Text>
          <Text type="secondary">当前京东价 {row.product.jingdongPrice === '' ? '同销售价' : `¥${money(row.product.jingdongPrice)}`}</Text>
        </Space>
      )
    },
    {
      title: '相似度',
      dataIndex: 'score',
      width: 95,
      render: value => `${Math.round((Number(value) || 0) * 100)}%`,
      sorter: (a, b) => a.score - b.score
    }
  ];

  const bulkToolbar = (
    <Card size="small" title="批量操作">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Tag color={selectedProductCount ? 'blue' : 'default'}>已选 {selectedProductCount} 个商品</Tag>
          <Tag color={duplicateGroupCount ? 'orange' : 'green'}>疑似重复 {duplicateGroupCount} 组</Tag>
          <Button onClick={() => setSelectedProductRowKeys(displayedProducts.map(product => product.id))}>全选全部商品</Button>
          <Button onClick={() => setSelectedProductRowKeys(displayedProducts.filter(product => product.cost <= 0).map(product => product.id))}>选择缺成本商品</Button>
          <Button disabled={!duplicateGroupCount} onClick={selectFirstDuplicateProductGroup}>选择首组疑似重复</Button>
          <Button disabled={selectedProductCount < 2} onClick={mergeSelectedDuplicateProducts}>合并选中商品</Button>
          <Button disabled={!selectedProductCount} onClick={clearSelectedProducts}>清空选择</Button>
        </Space>

        <Space wrap>
          <Text type="secondary">状态</Text>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('meituanEnabled', true)}>美团上架</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('meituanEnabled', false)}>美团下架</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('elemeEnabled', true)}>饿了么上架</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('elemeEnabled', false)}>饿了么下架</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('jingdongEnabled', true)}>京东上架</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('jingdongEnabled', false)}>京东下架</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('nonStandalone', true)}>设为单点不送</Button>
          <Button disabled={disabled} onClick={() => bulkSetProductFlag('nonStandalone', false)}>允许单点</Button>
        </Space>

        <Space wrap>
          <Text type="secondary">分类</Text>
          <Select
            style={{ width: 130 }}
            value={bulk.category}
            onChange={category => setBulk(prev => ({ ...prev, category }))}
            options={productCategories.map(category => ({ value: category, label: productCategoryName(category) }))}
          />
          <Button disabled={disabled} onClick={bulkSetProductCategory}>设置分类</Button>
          <InputNumber min={0} precision={0} placeholder="主食份数" value={bulk.stapleServingCount} onChange={value => setBulk(prev => ({ ...prev, stapleServingCount: value === null ? null : Number(value) }))} />
          <Button disabled={disabled} onClick={bulkSetStapleServingCount}>设置主食份数</Button>
        </Space>

        <Space wrap>
          <Text type="secondary">价格</Text>
          <Select
            style={{ width: 150 }}
            value={bulk.priceField}
            onChange={(priceField: ProductBulkPriceField) => setBulk(prev => ({ ...prev, priceField }))}
            options={[
              { value: 'price', label: '销售价' },
              { value: 'cost', label: '成本价' },
              { value: 'packageFee', label: '统一打包费' },
              { value: 'meituanPrice', label: '美团价' },
              { value: 'elemePrice', label: '饿了么价' },
              { value: 'jingdongPrice', label: '京东价' },
              { value: 'meituanPackageFee', label: '美团打包费' },
              { value: 'elemePackageFee', label: '饿了么打包费' },
              { value: 'jingdongPackageFee', label: '京东打包费' }
            ]}
          />
          <Select
            style={{ width: 130 }}
            value={bulk.priceMode}
            onChange={(priceMode: ProductBulkPriceMode) => setBulk(prev => ({ ...prev, priceMode }))}
            options={[
              { value: 'set', label: '设置为' },
              { value: 'increase', label: '加减金额' },
              { value: 'discount', label: '按折扣' }
            ]}
          />
          <InputNumber placeholder={pricePlaceholder} precision={2} value={bulk.priceValue} onChange={value => setBulk(prev => ({ ...prev, priceValue: value === null ? null : Number(value) }))} />
          <Button type="primary" disabled={disabled} onClick={applyBulkPriceEdit}>应用价格调整</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('meituanPrice')}>清空美团价</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('elemePrice')}>清空饿了么价</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('jingdongPrice')}>清空京东价</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('meituanPackageFee')}>清空美团打包费</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('elemePackageFee')}>清空饿了么打包费</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('jingdongPackageFee')}>清空京东打包费</Button>
        </Space>

        <Space wrap>
          <Text type="secondary">危险操作</Text>
          <Button danger icon={<DeleteOutlined />} onClick={deleteZeroPriceProducts}>删除0元商品</Button>
          <Button danger disabled={disabled} icon={<DeleteOutlined />} onClick={bulkDeleteProducts}>删除选中商品</Button>
          <Text type="secondary">批量操作只修改当前草稿，保存商品后才会生效。</Text>
        </Space>
      </Space>
    </Card>
  );

  return (
    <>
    <Card title="商品维护" extra={
      <Space wrap>
        {isEditing ? (
          <>
            <Upload {...uploadProps(file => importPlatformProducts(file, 'meituan'))}><Button icon={<UploadOutlined />}>导入美团商品表</Button></Upload>
            <Upload {...uploadProps(file => importPlatformProducts(file, 'eleme'))}><Button icon={<UploadOutlined />}>导入饿了么商品表</Button></Upload>
            <Upload {...uploadProps(file => importPlatformProducts(file, 'jingdong'))}><Button icon={<UploadOutlined />}>导入京东商品表</Button></Upload>
            <Upload {...uploadProps(importCostFile)}><Button icon={<UploadOutlined />}>导入成本表</Button></Upload>
            <Upload {...uploadProps(file => importProductsFile(file, () => setSelectedProductRowKeys([])))}><Button icon={<UploadOutlined />}>导入商品CSV</Button></Upload>
            <Button icon={<PlusOutlined />} onClick={addProduct}>添加商品</Button>
            <Button onClick={cancelEdit}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存商品</Button>
          </>
        ) : (
          <Button type="primary" onClick={startEdit}>编辑商品</Button>
        )}
      </Space>
    }>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Text type="secondary">当前门店商品 {productSource.length} 个，当前展示 {displayedProducts.length} 个。平台商品表按商品名称更新对应平台价；京东表会优先按商家编码合并，相似名称需要确认，未出现在京东表内的旧商品会设为京东下架。</Text>
        <Card size="small" title="搜索和排序">
          <Space wrap>
            <Input.Search
              allowClear
              style={{ width: 260 }}
              placeholder="搜索商品名、分类、价格、成本"
              value={filters.searchText}
              onChange={event => setFilters(prev => ({ ...prev, searchText: event.target.value }))}
            />
            <Select
              style={{ width: 140 }}
              value={filters.category}
              onChange={category => setFilters(prev => ({ ...prev, category }))}
              options={[
                { value: 'all', label: '全部分类' },
                ...productCategories.map(category => ({ value: category, label: productCategoryName(category) }))
              ]}
            />
            <Select
              style={{ width: 150 }}
              value={filters.status}
              onChange={status => setFilters(prev => ({ ...prev, status }))}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'meituanEnabled', label: '美团上架' },
                { value: 'meituanDisabled', label: '美团下架' },
                { value: 'elemeEnabled', label: '饿了么上架' },
                { value: 'elemeDisabled', label: '饿了么下架' },
                { value: 'jingdongEnabled', label: '京东上架' },
                { value: 'jingdongDisabled', label: '京东下架' },
                { value: 'nonStandalone', label: '单点不送' },
                { value: 'missingCost', label: '缺成本价' }
              ]}
            />
            <Select
              style={{ width: 160 }}
              value={filters.sortField}
              onChange={sortField => setFilters(prev => ({ ...prev, sortField }))}
              options={[
                { value: 'name', label: '按商品名' },
                { value: 'category', label: '按分类' },
                { value: 'stapleServingCount', label: '按主食份数' },
                { value: 'price', label: '按销售价' },
                { value: 'cost', label: '按成本价' },
                { value: 'packageFee', label: '按统一打包费' },
                { value: 'meituanPrice', label: '按美团价' },
                { value: 'elemePrice', label: '按饿了么价' },
                { value: 'jingdongPrice', label: '按京东价' },
                { value: 'meituanPackageFee', label: '按美团打包费' },
                { value: 'elemePackageFee', label: '按饿了么打包费' },
                { value: 'jingdongPackageFee', label: '按京东打包费' }
              ]}
            />
            <Select
              style={{ width: 100 }}
              value={filters.sortAsc ? 'asc' : 'desc'}
              onChange={value => setFilters(prev => ({ ...prev, sortAsc: value === 'asc' }))}
              options={[
                { value: 'asc', label: '升序' },
                { value: 'desc', label: '降序' }
              ]}
            />
            <Button onClick={clearProductFilters}>清空筛选</Button>
            <Button onClick={() => setBundlePriceCheckModalOpen(true)}>套餐价格核对</Button>
          </Space>
        </Card>
        {isEditing ? (
          <>
            {bulkToolbar}
            <Input.TextArea rows={4} value={bulk.text} onChange={event => setBulk(prev => ({ ...prev, text: event.target.value }))} placeholder={'商品名,销售价,成本价,美团价,饿了么价,单点不送,美团上架,饿了么上架,统一打包费,美团打包费,饿了么打包费,商品分类,主食份数,京东价,京东上架,京东打包费,商家编码,条码,京东SKU编码\n海鸭蛋和风饭团,15,6,,,否,是,是,0,,,主食,1,,是,,288793007001,6945173152115,10234758452507'} />
            <Space><Button onClick={() => applyBulkProducts('append')}>追加批量商品</Button><Button danger onClick={() => applyBulkProducts('replace')}>替换当前商品</Button></Space>
          </>
        ) : null}
        <ProductTableBoundary
          resetKey={resetKey}
          fallback={
            <Card size="small">
              <Space direction="vertical">
                <Text type="danger">商品列表渲染异常，已阻止页面继续崩溃。</Text>
                <Text type="secondary">请先清空筛选或退出编辑后重新进入；异常通常来自重复商品标识或导入数据字段异常。</Text>
                <Space>
                  <Button onClick={clearProductFilters}>清空筛选</Button>
                  {isEditing ? <Button onClick={cancelEdit}>退出编辑</Button> : null}
                </Space>
              </Space>
            </Card>
          }
        >
          <Table
            rowKey={row => row.id}
            size="small"
            rowSelection={productRowSelection}
            columns={productColumns}
            dataSource={displayedProducts}
            pagination={tablePagination(30)}
            scroll={{ x: 2440, y: 620 }}
            virtual
            tableLayout="fixed"
          />
        </ProductTableBoundary>
      </Space>
    </Card>
    <Modal
      title="套餐价格核对"
      open={bundlePriceCheckModalOpen}
      width={1180}
      footer={null}
      destroyOnHidden
      onCancel={() => setBundlePriceCheckModalOpen(false)}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Tag color={bundlePriceCheckSetMealCount ? 'blue' : 'default'}>套餐 {bundlePriceCheckSetMealCount} 个</Tag>
          <Tag color={bundlePriceCheckIssueCount ? 'orange' : 'green'}>需复核 {bundlePriceCheckIssueCount} 条</Tag>
          <Text type="secondary">不同平台售价会分开核对；单品合计按“商品价+打包费”，任选组用均值算差额，并展示最低/最高区间。</Text>
          <Text type="secondary">优惠率</Text>
          <InputNumber
            min={0}
            max={90}
            precision={2}
            addonAfter="%"
            style={{ width: 120 }}
            value={bundlePriceDiscountPercent}
            onChange={value => setBundlePriceDiscountPercent(value === null ? 0 : Number(value))}
          />
          <Text type="secondary">成本口径</Text>
          <Select
            style={{ width: 150 }}
            value={bundleCostSyncMode}
            onChange={(value: BundleCostSyncMode) => setBundleCostSyncMode(value)}
            options={[
              { value: 'max', label: '最高成本（推荐）' },
              { value: 'average', label: '平均成本' }
            ]}
          />
          <Button disabled={!isEditing || !activeBundlePriceCheckRows.length} onClick={() => applyBundlePlatformPrices(activeBundlePriceCheckRows)}>
            批量设当前平台售价
          </Button>
          <Button disabled={!isEditing || !activeBundlePriceCheckRows.length} onClick={() => applyBundleCosts(activeBundlePriceCheckRows)}>
            批量同步套餐成本
          </Button>
          {!isEditing ? <Text type="secondary">进入编辑商品后可写回售价和成本。</Text> : null}
        </Space>
        <Tabs
          activeKey={bundlePriceCheckActivePlatform}
          onChange={key => setBundlePriceCheckActivePlatform(key as PlatformProductImportPlatform)}
          items={bundlePriceCheckTabs}
        />
      </Space>
    </Modal>
    <Modal
      title="确认京东相似商品合并"
      open={Boolean(pendingJingdongImport)}
      width={920}
      destroyOnHidden
      onCancel={() => {
        setPendingJingdongImport(null);
        setJingdongImportMergeByKey({});
      }}
      footer={[
        <Button key="new" onClick={() => setJingdongImportMergeByKey(Object.fromEntries(pendingJingdongMatches.map(match => [match.key, false])))}>
          全部新增
        </Button>,
        <Button key="merge" onClick={() => setJingdongImportMergeByKey(Object.fromEntries(pendingJingdongMatches.map(match => [match.key, true])))}>
          全部合并
        </Button>,
        <Button key="cancel" onClick={() => {
          setPendingJingdongImport(null);
          setJingdongImportMergeByKey({});
        }}>
          取消
        </Button>,
        <Button
          key="ok"
          type="primary"
          onClick={() => {
            if (!pendingJingdongImport) return;
            applyJingdongProductImport(pendingJingdongImport.parsed, jingdongImportMergeByKey, pendingJingdongImport.matches);
          }}
        >
          应用导入
        </Button>
      ]}
    >
      {pendingJingdongImport ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">
            {pendingJingdongImport.fileName} 识别到 {pendingJingdongImport.parsed.products.length} 个京东商品，其中 {pendingJingdongMatches.length} 个和现有商品名称相似。当前选择合并 {pendingJingdongMergeCount} 个，其余会新增为京东商品；确认后，不在表内的旧商品会设为京东下架。
          </Text>
          <Table
            rowKey="key"
            size="small"
            columns={jingdongImportSimilarColumns}
            dataSource={pendingJingdongMatches}
            pagination={tablePagination(12)}
            scroll={{ x: 800 }}
            tableLayout="fixed"
          />
        </Space>
      ) : null}
    </Modal>
    <Modal
      title={editingBundleProduct ? `${editingBundleProduct.name} 套餐组成` : '套餐组成'}
      open={Boolean(editingBundleProduct)}
      width={860}
      footer={null}
      onCancel={() => setEditingBundleProductId('')}
    >
      {editingBundleProduct ? (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">套餐建议价会汇总固定组成，并按任选组中较高的建议价和成本做保守估算，再扣套餐折扣。</Text>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text strong>固定组成</Text>
            {(editingBundleProduct.bundleItems || []).length ? (editingBundleProduct.bundleItems || []).map((item, index) => (
              <Space key={`${item.productId}-${index}`} wrap>
                <Select
                  showSearch
                  style={{ width: 420, maxWidth: '100%' }}
                  value={item.productId}
                  optionFilterProp="label"
                  options={bundleComponentOptions.concat(
                    bundleComponentOptions.some(option => option.value === item.productId)
                      ? []
                      : [{ value: item.productId, label: bundleComponentName(item.productId) }]
                  )}
                  onChange={productId => updateBundleItems(editingBundleProduct.id, items => {
                    items[index] = { ...items[index], productId };
                  })}
                />
                <InputNumber
                  min={1}
                  precision={0}
                  value={item.qty}
                  onChange={value => updateBundleItems(editingBundleProduct.id, items => {
                    items[index] = { ...items[index], qty: Math.max(1, Math.floor(Number(value) || 1)) };
                  })}
                />
                <Button danger icon={<DeleteOutlined />} onClick={() => updateBundleItems(editingBundleProduct.id, items => { items.splice(index, 1); })} />
              </Space>
            )) : <Text type="secondary">暂无固定组成。</Text>}
            <Space>
              <Button icon={<PlusOutlined />} disabled={!bundleComponentOptions.length} onClick={addBundleItem}>添加固定商品</Button>
              {!bundleComponentOptions.length ? <Text type="secondary">当前没有可作为套餐组成的非套餐商品。</Text> : null}
            </Space>
          </Space>
          <Space direction="vertical" style={{ width: '100%' }}>
            <Text strong>任选组</Text>
            {(editingBundleProduct.bundleChoiceGroups || []).length ? (editingBundleProduct.bundleChoiceGroups || []).map((group, groupIndex) => (
              <Card
                key={group.id || groupIndex}
                size="small"
                title={(
                  <Space wrap>
                    <Input
                      style={{ width: 180 }}
                      value={group.name}
                      onChange={event => updateBundleChoiceGroups(editingBundleProduct.id, groups => {
                        groups[groupIndex] = { ...groups[groupIndex], name: event.target.value };
                      })}
                    />
                    <Text type="secondary">任选</Text>
                    <InputNumber
                      min={1}
                      precision={0}
                      value={group.selectionQty}
                      onChange={value => updateBundleChoiceGroups(editingBundleProduct.id, groups => {
                        groups[groupIndex] = { ...groups[groupIndex], selectionQty: Math.max(1, Math.floor(Number(value) || 1)) };
                      })}
                    />
                    <Text type="secondary">项</Text>
                    <Button danger size="small" icon={<DeleteOutlined />} onClick={() => updateBundleChoiceGroups(editingBundleProduct.id, groups => { groups.splice(groupIndex, 1); })} />
                  </Space>
                )}
              >
                <Space direction="vertical" style={{ width: '100%' }}>
                  {group.items.map((item, itemIndex) => (
                    <Space key={`${group.id}-${item.productId}-${itemIndex}`} wrap>
                      <Select
                        showSearch
                        style={{ width: 420, maxWidth: '100%' }}
                        value={item.productId}
                        optionFilterProp="label"
                        options={bundleComponentOptions.concat(
                          bundleComponentOptions.some(option => option.value === item.productId)
                            ? []
                            : [{ value: item.productId, label: bundleComponentName(item.productId) }]
                        )}
                        onChange={productId => updateBundleChoiceGroups(editingBundleProduct.id, groups => {
                          groups[groupIndex].items[itemIndex] = { ...groups[groupIndex].items[itemIndex], productId };
                        })}
                      />
                      <InputNumber
                        min={1}
                        precision={0}
                        value={item.qty}
                        onChange={value => updateBundleChoiceGroups(editingBundleProduct.id, groups => {
                          groups[groupIndex].items[itemIndex] = { ...groups[groupIndex].items[itemIndex], qty: Math.max(1, Math.floor(Number(value) || 1)) };
                        })}
                      />
                      <Button danger icon={<DeleteOutlined />} onClick={() => updateBundleChoiceGroups(editingBundleProduct.id, groups => { groups[groupIndex].items.splice(itemIndex, 1); })} />
                    </Space>
                  ))}
                  <Button icon={<PlusOutlined />} disabled={!bundleComponentOptions.length} onClick={() => addBundleChoiceItem(groupIndex)}>添加可选商品</Button>
                </Space>
              </Card>
            )) : <Text type="secondary">暂无任选组。</Text>}
            <Button icon={<PlusOutlined />} disabled={!bundleComponentOptions.length} onClick={addBundleChoiceGroup}>添加任选组</Button>
          </Space>
        </Space>
      ) : null}
    </Modal>
    </>
  );
}
