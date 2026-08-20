'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { App as AntApp } from 'antd';
import { DEFAULT_PAGE_KEY, pageForPath, pathForPage, type PageKey } from './pageRoutes';
import { CalculatorShell } from './components/layout/CalculatorShell';
import { CalculatorProvider, type CalculatorContextValue } from './components/shared/CalculatorContext';
import { useCalculatorStateCommit } from './components/shared/useCalculatorStateCommit';
import {
  activityObjectiveOptionsFromSettings,
  browserDataRepository,
  currentStoreFrom,
  deepClone,
  defaultState,
  effectiveFeeRule,
  normalizeActivityObjectiveStrategies,
  normalizePricingStrategy,
  normalizeProductList,
  normalizeState,
  uid
} from './data/calculatorState';
import { PLATFORM_NAMES } from './domain/core';
import { PlatformUtils } from './domain/platform';
import type {
  Activities,
  CalculatorState,
  FeeRule,
  Platform,
  Product,
  Store
} from './domain/types';
import { exportConfigFile } from './utils/configExport';

export function WaimaiCalculatorInner({ children }: { children: React.ReactNode }) {
  const { message, modal } = AntApp.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const activePage = pageForPath(pathname);
  const activePageRef = React.useRef(activePage);
  const [state, setState] = useState<CalculatorState>(() => deepClone(defaultState));

  const store = useMemo(() => currentStoreFrom(state), [state]);
  const commitCalculatorState = useCalculatorStateCommit(state, setState);

  React.useEffect(() => {
    activePageRef.current = activePage;
    setState(prev => prev.activePage === activePage ? prev : normalizeState({ ...prev, activePage }));
  }, [activePage]);

  React.useEffect(() => {
    let ignore = false;
    browserDataRepository.loadCalculatorState()
      .then(loaded => {
        if (!ignore && loaded) {
          setState(stateWithCurrentRoutePage(loaded));
        }
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  function mutateState(mutator: (draft: CalculatorState) => void) {
    setState(prev => {
      const draft = deepClone(prev);
      mutator(draft);
      return normalizeState(draft);
    });
  }

  function stateWithCurrentRoutePage(value: unknown) {
    const next = normalizeState(value);
    next.activePage = activePageRef.current;
    return next;
  }

  function mutateStore(mutator: (draft: Store, root: CalculatorState) => void) {
    mutateState(draft => {
      const draftStore = currentStoreFrom(draft);
      mutator(draftStore, draft);
    });
  }

  async function saveConfigState(mutator: (draft: CalculatorState) => void, successMessage: string) {
    return commitCalculatorState(mutator, successMessage);
  }

  async function saveProducts(products: Product[]) {
    return saveConfigState(draft => {
      currentStoreFrom(draft).products = normalizeProductList(products);
    }, '商品信息已保存到浏览器数据库。');
  }

  async function savePlatformFee(fee: FeeRule) {
    return saveConfigState(draft => {
      draft.platformRules = deepClone(fee);
    }, '平台通用规则已保存到浏览器数据库。');
  }

  async function saveActivities(platform: Platform, activities: Activities) {
    return saveConfigState(draft => {
      currentStoreFrom(draft).activities[platform] = deepClone(activities);
    }, `${PLATFORM_NAMES[platform]}活动已保存到浏览器数据库。`);
  }

  function navigatePage(page: PageKey) {
    router.push(pathForPage(page));
    mutateState(draft => {
      draft.activePage = page;
    });
  }

  function addStore() {
    router.push(pathForPage(DEFAULT_PAGE_KEY));
    mutateState(draft => {
      const next = deepClone(defaultState.stores[0]);
      next.id = uid('store');
      next.name = `新门店${draft.stores.length + 1}`;
      next.products = [];
      draft.stores.push(next);
      draft.selectedStoreId = next.id;
      draft.activePage = 'store';
    });
  }

  async function saveState() {
    try {
      await browserDataRepository.saveCalculatorState(state);
      message.success('已保存到浏览器数据库。');
    } catch {
      message.error('保存失败，当前浏览器数据库不可用。');
    }
  }

  async function loadState() {
    try {
      const loaded = await browserDataRepository.loadCalculatorState();
      if (!loaded) {
        message.warning('当前浏览器数据库没有保存过配置。');
        return;
      }
      setState(stateWithCurrentRoutePage(loaded));
      message.success('已从浏览器数据库读取配置。');
    } catch {
      message.error('读取失败，浏览器数据库数据可能已损坏。');
    }
  }

  function importConfig(file: File) {
    file.text().then(text => {
      try {
        setState(stateWithCurrentRoutePage(JSON.parse(text)));
        message.success('配置已导入。');
      } catch {
        message.error('导入失败，请确认是新版配置 JSON。');
      }
    });
  }

  function resetState() {
    modal.confirm({
      title: '恢复示例',
      content: '确定恢复示例配置吗？当前未保存的修改会丢失。',
      okText: '恢复',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        setState(stateWithCurrentRoutePage(deepClone(defaultState)));
      }
    });
  }

  function applyPricingSuggestedPrice(row: { suggestedPrice: number | null; productId: string; platform: Platform; platformName: string }) {
    if (row.suggestedPrice === null) {
      message.warning('当前商品没有可应用的建议价。');
      return;
    }
    const suggestedPrice = row.suggestedPrice;
    mutateStore(draftStore => {
      const product = draftStore.products.find(item => item.id === row.productId);
      if (!product) return;
      product[PlatformUtils.priceField(row.platform)] = suggestedPrice === product.price ? '' : suggestedPrice;
    });
    message.success(`已应用到${row.platformName}价，请重新生成定价评估查看结果。`);
  }

  const productSource = useMemo(() => normalizeProductList(store.products), [store.products]);


  const calculatorContextValue: CalculatorContextValue = {
    calculatorState: state,
    setCalculatorState: setState,
    store,
    storeId: store.id,
    storeName: store.name,
    products: productSource,
    fee: state.platformRules,
    activities: store.activities,
    pricingRule: state.platformRules.pricingEvaluation,
    pricingStrategy: normalizePricingStrategy(effectiveFeeRule(state, store).pricingStrategy),
    activityObjectiveOptionsFromSettings,
    normalizeActivityObjectiveStrategies,
    onSaveProducts: saveProducts,
    onSaveFee: savePlatformFee,
    onSaveActivities: saveActivities,
    onApplySuggestedPrice: applyPricingSuggestedPrice
  };

  return (
    <CalculatorProvider value={calculatorContextValue}>
      <CalculatorShell
        activePage={activePage}
        selectedStoreId={state.selectedStoreId}
        stores={state.stores}
        onNavigate={navigatePage}
        onSelectStore={value => {
          mutateState(draft => { draft.selectedStoreId = value; });
        }}
        onAddStore={addStore}
        onSaveState={saveState}
        onLoadState={loadState}
        onExportConfig={() => exportConfigFile(state)}
        onImportConfig={importConfig}
        onResetState={resetState}
      >
        {children}
      </CalculatorShell>
    </CalculatorProvider>
  );
}
