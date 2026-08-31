'use client';

import { useState } from 'react';
import { Button, Layout, Menu, Popover, Select, Space, Tag, Upload } from 'antd';
import { DownloadOutlined, LogoutOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { isPageKey, type AppNavigationItem, type PageKey } from '../../app/routes';
import type { BackendAuthSession, PersistenceMode } from '../../data/backendClient';
import { uploadProps } from '../../utils/upload';

const { Header, Sider, Content } = Layout;

type CalculatorShellStoreOption = {
  id: string;
  name: string;
};

type CalculatorShellProps = {
  activePage: PageKey;
  navigationItems: AppNavigationItem[];
  persistenceMode: PersistenceMode;
  backendSession: BackendAuthSession;
  isNavigationLocked: boolean;
  selectedStoreId: string;
  stores: CalculatorShellStoreOption[];
  children: React.ReactNode;
  onNavigate: (page: PageKey) => void;
  onChangePersistenceMode: (mode: PersistenceMode) => void;
  onSelectStore: (storeId: string) => void;
  onAddStore: () => void;
  onSaveState: () => void;
  onLoadState: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  onLogoutBackend: () => void;
  onResetState: () => void;
};

/**
 * 渲染计算器的全局头部、门店操作区、侧边导航和页面内容区域。
 */
export function CalculatorShell({
  activePage,
  navigationItems,
  persistenceMode,
  backendSession,
  isNavigationLocked,
  selectedStoreId,
  stores,
  children,
  onNavigate,
  onChangePersistenceMode,
  onSelectStore,
  onAddStore,
  onSaveState,
  onLoadState,
  onExportConfig,
  onImportConfig,
  onLogoutBackend,
  onResetState
}: CalculatorShellProps) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const navigationOptions = navigationItems.map(item => ({ value: item.key, label: item.label }));
  const storeOptions = stores.map(item => ({ value: item.id, label: item.name }));
  const persistenceModeOptions = [
    { value: 'local', label: '本地模式' },
    { value: 'backend', label: '后台模式' }
  ];
  const backendLoggedIn = persistenceMode === 'backend' && backendSession.authenticated;

  const runMobileAction = (handler: () => void) => {
    setMobileActionsOpen(false);
    handler();
  };

  const mobileActions = (
    <div className="mobile-actions-popover">
      <div className="mobile-actions-field">
        <span className="mobile-actions-label">数据模式</span>
        <Select
          value={persistenceMode}
          onChange={onChangePersistenceMode}
          options={persistenceModeOptions}
        />
      </div>
      <Button block icon={<SaveOutlined />} onClick={() => runMobileAction(onSaveState)}>保存设置</Button>
      <Button block onClick={() => runMobileAction(onLoadState)}>读取保存</Button>
      <Button block icon={<DownloadOutlined />} onClick={() => runMobileAction(onExportConfig)}>导出配置</Button>
      <Upload
        className="mobile-actions-upload"
        {...uploadProps(file => {
          setMobileActionsOpen(false);
          onImportConfig(file);
        })}
      >
        <Button block icon={<UploadOutlined />}>导入配置</Button>
      </Upload>
      {backendLoggedIn ? (
        <Button block icon={<LogoutOutlined />} onClick={() => runMobileAction(onLogoutBackend)}>退出后台</Button>
      ) : null}
      <Button block danger icon={<ReloadOutlined />} onClick={() => runMobileAction(onResetState)}>恢复示例</Button>
    </div>
  );

  if (isNavigationLocked) {
    return (
      <Layout className="app-shell app-shell-locked">
        <Content className="app-content app-lock-content">{children}</Content>
      </Layout>
    );
  }

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="app-header-main">
          <h1 className="app-title">外卖门店活动测算工具</h1>
          <p className="app-subtitle">按门店维护商品、平台活动和利润率阶梯，测算组合利润并导出结果。</p>
        </div>
        <Space className="app-header-actions desktop-header-actions" wrap>
          <Select
            className="store-select"
            value={selectedStoreId}
            onChange={onSelectStore}
            options={storeOptions}
          />
          <Select
            className="mode-select"
            value={persistenceMode}
            onChange={onChangePersistenceMode}
            options={persistenceModeOptions}
          />
          {persistenceMode === 'backend' ? (
            backendLoggedIn
              ? <Tag color="green">后台：{backendSession.user?.username}</Tag>
              : <Tag color="orange">后台未登录</Tag>
          ) : null}
          <Button icon={<PlusOutlined />} onClick={onAddStore}>新增门店</Button>
          <Button icon={<SaveOutlined />} onClick={onSaveState}>保存设置</Button>
          <Button onClick={onLoadState}>读取保存</Button>
          <Button icon={<DownloadOutlined />} onClick={onExportConfig}>导出配置</Button>
          <Upload {...uploadProps(onImportConfig)}><Button icon={<UploadOutlined />}>导入配置</Button></Upload>
          {backendLoggedIn ? <Button icon={<LogoutOutlined />} onClick={onLogoutBackend}>退出后台</Button> : null}
          <Button danger icon={<ReloadOutlined />} onClick={onResetState}>恢复示例</Button>
        </Space>
        <div className="mobile-header-controls">
          <Select
            className="mobile-store-select"
            value={selectedStoreId}
            onChange={onSelectStore}
            options={storeOptions}
          />
          <Select
            className="mobile-page-select"
            value={activePage}
            onChange={value => {
              if (isPageKey(value)) onNavigate(value);
            }}
            options={navigationOptions}
          />
          <Button
            className="mobile-icon-button"
            icon={<PlusOutlined />}
            onClick={onAddStore}
            title="新增门店"
            aria-label="新增门店"
          />
          <Popover
            content={mobileActions}
            open={mobileActionsOpen}
            onOpenChange={setMobileActionsOpen}
            placement="bottomRight"
            trigger="click"
          >
            <Button className="mobile-icon-button" icon={<MoreOutlined />} title="更多操作" aria-label="更多操作" />
          </Popover>
        </div>
      </Header>
      <Layout className="app-main-layout">
        <Sider className="desktop-sider" width={210} theme="light" breakpoint="lg" collapsedWidth={0}>
          <Menu
            className="side-menu"
            selectedKeys={[activePage]}
            onClick={item => {
              if (isPageKey(item.key)) onNavigate(item.key);
            }}
            items={navigationItems}
          />
        </Sider>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
