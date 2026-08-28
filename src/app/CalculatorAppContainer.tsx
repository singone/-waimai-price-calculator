'use client';

import { usePathname, useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { App as AntApp } from 'antd';
import {
  APP_NAVIGATION_ITEMS,
  DEFAULT_PAGE_KEY,
  pageForPath,
  pathForPage,
  type PageKey
} from './routes';
import { CalculatorShell } from '../components/layout/CalculatorShell';
import { CalculatorProvider, type CalculatorContextValue } from '../components/shared/CalculatorContext';
import {
  browserDataRepository,
  currentStoreFrom,
  deepClone,
  defaultState,
  normalizeState,
  uid
} from '../data/calculatorState';
import type { CalculatorState } from '../domain/types';
import { exportConfigFile } from '../utils/configExport';

/**
 * 负责应用级状态、浏览器持久化、门店操作和路由跳转。
 */
export function CalculatorAppContainer({ children }: { children: React.ReactNode }) {
  const { message, modal } = AntApp.useApp();
  const router = useRouter();
  const pathname = usePathname();
  const activePage = pageForPath(pathname);
  const activePageRef = React.useRef(activePage);
  const [state, setState] = useState<CalculatorState>(() => deepClone(defaultState));

  const store = useMemo(() => currentStoreFrom(state), [state]);

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

  /**
   * 以草稿方式更新计算器状态，并在提交前统一做数据归一化。
   */
  function mutateState(mutator: (draft: CalculatorState) => void) {
    setState(prev => {
      const draft = deepClone(prev);
      mutator(draft);
      return normalizeState(draft);
    });
  }

  /**
   * 导入或读取缓存状态时保留当前路由页，避免配置里的旧 activePage 覆盖 URL。
   */
  function stateWithCurrentRoutePage(value: unknown) {
    const next = normalizeState(value);
    next.activePage = activePageRef.current;
    return next;
  }

  /**
   * 同步更新浏览器路径和状态中的活动页面。
   */
  function navigatePage(page: PageKey) {
    router.push(pathForPage(page));
    mutateState(draft => {
      draft.activePage = page;
    });
  }

  /**
   * 基于示例门店结构创建一个空商品的新门店。
   */
  function addStore() {
    router.push(pathForPage(DEFAULT_PAGE_KEY));
    mutateState(draft => {
      const next = deepClone(defaultState.stores[0]);
      next.id = uid('store');
      next.name = `新门店${draft.stores.length + 1}`;
      next.products = [];
      draft.stores.push(next);
      draft.selectedStoreId = next.id;
      draft.activePage = DEFAULT_PAGE_KEY;
    });
  }

  /**
   * 将当前配置保存到浏览器数据库。
   */
  async function saveState() {
    try {
      await browserDataRepository.saveCalculatorState(state);
      message.success('已保存到浏览器数据库。');
    } catch {
      message.error('保存失败，当前浏览器数据库不可用。');
    }
  }

  /**
   * 从浏览器数据库恢复配置，并保持当前路由页不变。
   */
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

  /**
   * 导入 JSON 配置文件并归一化为当前状态结构。
   */
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

  /**
   * 经用户确认后恢复示例配置。
   */
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

  const calculatorContextValue: CalculatorContextValue = {
    calculatorState: state,
    setCalculatorState: setState,
    store,
    storeId: store.id,
    storeName: store.name
  };

  return (
    <CalculatorProvider value={calculatorContextValue}>
      <CalculatorShell
        activePage={activePage}
        navigationItems={APP_NAVIGATION_ITEMS}
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
