'use client';

import React from 'react';
import { App as AntApp, Button, Card, Input, InputNumber, Select, Space, Switch, Table, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import {
  PLATFORM_PRODUCT_IMPORT_RULES,
  PRODUCT_CATEGORIES
} from '../../config/products';
import { roundMoney } from '../../domain/money';
import { PlatformUtils } from '../../domain/platform';
import type { Product, ProductCategory, Platform } from '../../domain/types';
import { tablePagination } from '../../utils/table';
import { money } from '../../utils/format';
import { uploadProps } from '../../utils/upload';
import { readWorkbook } from '../../utils/workbook';
import { useEditableDraft } from '../shared/useEditableDraft';
import {
  chooseProductMergePrimary,
  compareProductNumber,
  compareProductText,
  DEFAULT_PRODUCT_BULK_EDIT_STATE,
  DEFAULT_PRODUCT_PAGE_FILTERS,
  filterAndSortProducts,
  findDuplicateProductGroups,
  findSimilarProductForPlatformImport,
  inferStapleServingCount,
  isProductListedOnPlatform,
  mergeProductRecords,
  normalizeProduct,
  normalizeProductList,
  normalizeProductMatchName,
  parseCostWorkbook,
  parsePlatformProductWorkbook,
  parseProducts,
  productCategoryName,
  resolveBulkPriceValue,
  type ProductBulkPriceField,
  type ProductBulkPriceMode,
  type ProductPageFilters
} from './productPageUtils';

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
  storeId: string;
  products: Product[];
  onSaveProducts: (products: Product[]) => Promise<boolean>;
};

export function ProductsPage(pageProps: Partial<ProductsPageProps> = {}) {
  const {
  storeId,
  products,
  onSaveProducts
  } = pageProps as ProductsPageProps;
  const productCategories = PRODUCT_CATEGORIES;
  const platformProductImportRules = PLATFORM_PRODUCT_IMPORT_RULES;
  const { message, modal } = AntApp.useApp();
  const [filters, setFilters] = React.useState<ProductPageFilters>(DEFAULT_PRODUCT_PAGE_FILTERS);
  const [selectedProductRowKeys, setSelectedProductRowKeys] = React.useState<React.Key[]>([]);
  const [bulk, setBulk] = React.useState(DEFAULT_PRODUCT_BULK_EDIT_STATE);
  const resetSelection = React.useCallback(() => {
    setSelectedProductRowKeys([]);
    setBulk(DEFAULT_PRODUCT_BULK_EDIT_STATE);
  }, []);
  const cloneProducts = React.useCallback((value: Product[]) => value.map(product => ({ ...product })), []);
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

  const selectedProductCount = selectedProductRowKeys.length;
  const duplicateGroupCount = productDuplicateGroups.length;
  const disabled = selectedProductCount === 0;
  const pricePlaceholder = bulk.priceMode === 'discount' ? '如 8.8 表示 8.8折' : bulk.priceMode === 'increase' ? '可输入负数' : '输入金额';
  const resetKey = `${storeId}-${isEditing ? 'edit' : 'view'}-${productSource.length}-${filters.searchText}-${filters.category}-${filters.status}-${filters.sortField}-${filters.sortAsc ? 'asc' : 'desc'}`;
  const productRowSelection = isEditing ? {
    selectedRowKeys: selectedProductRowKeys,
    onChange: (keys: React.Key[]) => setSelectedProductRowKeys(keys)
  } : undefined;

  const saveEdit = async () => {
    await productEditor.saveEdit(onSaveProducts);
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
      draft.push(normalizeProduct({ name: '新商品', price: 0, cost: 0, meituanEnabled: true, elemeEnabled: true }));
    });
  };
  const syncUnifiedPackageFeeFromImport = (product: Product, importedPackageFee: number | undefined) => {
    if (importedPackageFee === undefined || importedPackageFee <= 0) return false;
    const nextPackageFee = roundMoney(importedPackageFee);
    if (roundMoney(product.packageFee) === nextPackageFee) return false;
    product.packageFee = nextPackageFee;
    return true;
  };
  const importPlatformProducts = async (file: File, platform: Platform) => {
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
      const rule = platformProductImportRules[platform];
      let added = 0;
      let updated = 0;
      let unchanged = 0;
      let similarMerged = 0;
      updateProductsDraft(draft => {
        const productMap = new Map(draft.map(product => [normalizeProductMatchName(product.name), product]));
        parsed.products.forEach(item => {
          const key = normalizeProductMatchName(item.name);
          const exactExisting = productMap.get(key);
          const similarExisting = exactExisting ? null : findSimilarProductForPlatformImport(draft, item, platform);
          const existing = exactExisting || similarExisting;
          if (existing) {
            const oldValue = existing[rule.priceField] === '' ? '' : roundMoney(existing[rule.priceField]);
            const oldPackageFee = existing[rule.packageFeeField];
            const oldEnabled = isProductListedOnPlatform(existing, platform);
            existing[rule.priceField] = item.price;
            if (item.packageFee !== undefined) existing[rule.packageFeeField] = item.packageFee;
            const unifiedPackageFeeChanged = syncUnifiedPackageFeeFromImport(existing, item.packageFee);
            if (item.platformEnabled !== undefined) existing[rule.enabledField] = item.platformEnabled;
            const enabledChanged = item.platformEnabled !== undefined && oldEnabled !== item.platformEnabled;
            const packageFeeChanged = item.packageFee !== undefined && oldPackageFee !== item.packageFee;
            if (oldValue === item.price && !enabledChanged && !packageFeeChanged && !unifiedPackageFeeChanged) unchanged++;
            else updated++;
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
            meituanEnabled: true,
            elemeEnabled: true,
            nonStandalone: false
          });
          product[rule.priceField] = item.price;
          if (item.packageFee !== undefined) product[rule.packageFeeField] = item.packageFee;
          syncUnifiedPackageFeeFromImport(product, item.packageFee);
          if (item.platformEnabled !== undefined) product[rule.enabledField] = item.platformEnabled;
          draft.push(product);
          productMap.set(key, product);
          added++;
        });
      });
      message.success(`已导入${rule.name}商品：识别 ${parsed.products.length} 个，更新 ${updated} 个，新增 ${added} 个，相似合并 ${similarMerged} 个，未变化 ${unchanged} 个。`);
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
  const bulkSetProductFlag = (field: 'meituanEnabled' | 'elemeEnabled' | 'nonStandalone', value: boolean) => {
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
  const bulkClearPlatformOverride = (field: 'meituanPrice' | 'elemePrice' | 'meituanPackageFee' | 'elemePackageFee') => {
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
      (product.elemePrice === '' || roundMoney(product.elemePrice) <= 0)
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
              { value: 'meituanPackageFee', label: '美团打包费' },
              { value: 'elemePackageFee', label: '饿了么打包费' }
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
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('meituanPackageFee')}>清空美团打包费</Button>
          <Button disabled={disabled} onClick={() => bulkClearPlatformOverride('elemePackageFee')}>清空饿了么打包费</Button>
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
    <Card title="商品维护" extra={
      <Space wrap>
        {isEditing ? (
          <>
            <Upload {...uploadProps(file => importPlatformProducts(file, 'meituan'))}><Button icon={<UploadOutlined />}>导入美团商品表</Button></Upload>
            <Upload {...uploadProps(file => importPlatformProducts(file, 'eleme'))}><Button icon={<UploadOutlined />}>导入饿了么商品表</Button></Upload>
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
        <Text type="secondary">当前门店商品 {productSource.length} 个，当前展示 {displayedProducts.length} 个。平台商品表按商品名称更新对应平台价，并会对高置信相似名称做合并；低置信重复可在编辑状态下选择疑似重复组后手动合并。</Text>
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
                { value: 'meituanPackageFee', label: '按美团打包费' },
                { value: 'elemePackageFee', label: '按饿了么打包费' }
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
          </Space>
        </Card>
        {isEditing ? (
          <>
            {bulkToolbar}
            <Input.TextArea rows={4} value={bulk.text} onChange={event => setBulk(prev => ({ ...prev, text: event.target.value }))} placeholder={'商品名,销售价,成本价,美团价,饿了么价,单点不送,美团上架,饿了么上架,统一打包费,美团打包费,饿了么打包费,商品分类,主食份数\n海鸭蛋和风饭团,15,6,,,否,是,是,0,,,主食,1'} />
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
            scroll={{ x: 1800, y: 620 }}
            virtual
            tableLayout="fixed"
          />
        </ProductTableBoundary>
      </Space>
    </Card>
  );
}
