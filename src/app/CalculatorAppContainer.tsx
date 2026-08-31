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
import { BackendLoginPanel } from '../components/auth/BackendLoginPanel';
import { CalculatorProvider, type CalculatorContextValue } from '../components/shared/CalculatorContext';
import {
  backendDataRepository,
  browserDataRepository,
  currentStoreFrom,
  deepClone,
  defaultState,
  normalizeState,
  uid
} from '../data/calculatorState';
import {
  loadBackendSession,
  loginBackend,
  logoutBackend,
  type BackendAuthSession,
  type PersistenceMode
} from '../data/backendClient';
import type { CalculatorState } from '../domain/types';
import { exportConfigFile } from '../utils/configExport';

const PERSISTENCE_MODE_STORAGE_KEY = 'waimai_price_calculator_persistence_mode';
const EMPTY_BACKEND_SESSION: BackendAuthSession = { authenticated: false, user: null };

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
  const [persistenceMode, setPersistenceModeState] = useState<PersistenceMode>('local');
  const [isPersistenceModeReady, setIsPersistenceModeReady] = useState(false);
  const [backendSession, setBackendSession] = useState<BackendAuthSession>(EMPTY_BACKEND_SESSION);
  const [isBackendLoginLoading, setIsBackendLoginLoading] = useState(false);

  const store = useMemo(() => currentStoreFrom(state), [state]);
  const dataRepository = useMemo(() => (
    persistenceMode === 'backend' && backendSession.authenticated
      ? backendDataRepository
      : browserDataRepository
  ), [backendSession.authenticated, persistenceMode]);
  const isBackendLoginGate = isPersistenceModeReady && persistenceMode === 'backend' && !backendSession.authenticated;
  const isNavigationLocked = !isPersistenceModeReady || isBackendLoginGate;

  React.useEffect(() => {
    activePageRef.current = activePage;
    setState(prev => prev.activePage === activePage ? prev : normalizeState({ ...prev, activePage }));
  }, [activePage]);

  React.useEffect(() => {
    const savedMode = typeof localStorage === 'undefined'
      ? null
      : localStorage.getItem(PERSISTENCE_MODE_STORAGE_KEY);
    if (savedMode === 'backend' || savedMode === 'local') {
      setPersistenceModeState(savedMode);
    }
    setIsPersistenceModeReady(true);
  }, []);

  React.useEffect(() => {
    if (!isPersistenceModeReady) return undefined;
    let ignore = false;
    if (persistenceMode === 'local') {
      browserDataRepository.loadCalculatorState()
        .then(loaded => {
          if (!ignore && loaded) setState(stateWithCurrentRoutePage(loaded));
        })
        .catch(() => undefined);
      return () => {
        ignore = true;
      };
    }

    loadBackendSession()
      .then(session => {
        if (ignore) return;
        setBackendSession(session);
        if (session.authenticated) {
          backendDataRepository.loadCalculatorState()
            .then(loaded => {
              if (!ignore && loaded) setState(stateWithCurrentRoutePage(loaded));
            })
            .catch(() => {
              if (!ignore) message.warning('后台状态读取失败，请重新登录或检查后台数据库。');
            });
        }
      })
      .catch(() => {
        if (!ignore) setBackendSession(EMPTY_BACKEND_SESSION);
      });
    return () => {
      ignore = true;
    };
  }, [isPersistenceModeReady, message, persistenceMode]);

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
   * 切换本地/后台数据模式，并把选择保存到浏览器。
   */
  function changePersistenceMode(mode: PersistenceMode) {
    setPersistenceModeState(mode);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(PERSISTENCE_MODE_STORAGE_KEY, mode);
    }
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
    if (persistenceMode === 'backend' && !backendSession.authenticated) {
      message.warning('后台模式需要先登录。');
      return;
    }
    try {
      await dataRepository.saveCalculatorState(state);
      message.success(`已保存到${persistenceMode === 'backend' ? '后台数据库' : '浏览器数据库'}。`);
    } catch {
      message.error('保存失败，当前数据模式不可用。');
    }
  }

  /**
   * 从浏览器数据库恢复配置，并保持当前路由页不变。
   */
  async function loadState() {
    if (persistenceMode === 'backend' && !backendSession.authenticated) {
      message.warning('后台模式需要先登录。');
      return;
    }
    try {
      const loaded = await dataRepository.loadCalculatorState();
      if (!loaded) {
        message.warning(`当前${persistenceMode === 'backend' ? '后台数据库' : '浏览器数据库'}没有保存过配置。`);
        return;
      }
      setState(stateWithCurrentRoutePage(loaded));
      message.success(`已从${persistenceMode === 'backend' ? '后台数据库' : '浏览器数据库'}读取配置。`);
    } catch {
      message.error('读取失败，当前数据模式的数据可能已损坏。');
    }
  }

  /**
   * 登录后台模式，成功后自动读取后台保存的状态。
   */
  async function loginBackendMode(username: string, password: string) {
    setIsBackendLoginLoading(true);
    try {
      const session = await loginBackend(username, password);
      setBackendSession(session);
      const loaded = await backendDataRepository.loadCalculatorState();
      if (loaded) setState(stateWithCurrentRoutePage(loaded));
      message.success('已登录后台模式。');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '后台登录失败。');
    } finally {
      setIsBackendLoginLoading(false);
    }
  }

  /**
   * 退出后台登录，保留当前模式并显示登录面板。
   */
  async function logoutBackendMode() {
    try {
      await logoutBackend();
      setBackendSession(EMPTY_BACKEND_SESSION);
      message.success('已退出后台模式。');
    } catch {
      message.error('退出后台失败。');
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
    dataRepository,
    persistenceMode,
    backendSession,
    store,
    storeId: store.id,
    storeName: store.name
  };

  return (
    <CalculatorProvider value={calculatorContextValue}>
      <CalculatorShell
        activePage={activePage}
        navigationItems={APP_NAVIGATION_ITEMS}
        persistenceMode={persistenceMode}
        backendSession={backendSession}
        isNavigationLocked={isNavigationLocked}
        selectedStoreId={state.selectedStoreId}
        stores={state.stores}
        onNavigate={navigatePage}
        onChangePersistenceMode={changePersistenceMode}
        onSelectStore={value => {
          mutateState(draft => { draft.selectedStoreId = value; });
        }}
        onAddStore={addStore}
        onSaveState={saveState}
        onLoadState={loadState}
        onExportConfig={() => exportConfigFile(state)}
        onImportConfig={importConfig}
        onLogoutBackend={logoutBackendMode}
        onResetState={resetState}
      >
        {!isPersistenceModeReady ? (
          <div className="backend-login-wrap">
            <div className="backend-login-loading">正在读取数据模式...</div>
          </div>
        ) : isBackendLoginGate ? (
          <BackendLoginPanel
            loading={isBackendLoginLoading}
            onLogin={loginBackendMode}
            onUseLocalMode={() => changePersistenceMode('local')}
          />
        ) : children}
      </CalculatorShell>
    </CalculatorProvider>
  );
}
