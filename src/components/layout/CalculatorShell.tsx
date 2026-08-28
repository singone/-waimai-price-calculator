'use client';

import { useState } from 'react';
import { Button, Layout, Menu, Popover, Select, Space, Upload } from 'antd';
import { DownloadOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { isPageKey, type AppNavigationItem, type PageKey } from '../../app/routes';
import { uploadProps } from '../../utils/upload';

const { Header, Sider, Content } = Layout;

type CalculatorShellStoreOption = {
  id: string;
  name: string;
};

type CalculatorShellProps = {
  activePage: PageKey;
  navigationItems: AppNavigationItem[];
  selectedStoreId: string;
  stores: CalculatorShellStoreOption[];
  children: React.ReactNode;
  onNavigate: (page: PageKey) => void;
  onSelectStore: (storeId: string) => void;
  onAddStore: () => void;
  onSaveState: () => void;
  onLoadState: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  onResetState: () => void;
};

/**
 * 渲染计算器的全局头部、门店操作区、侧边导航和页面内容区域。
 */
export function CalculatorShell({
  activePage,
  navigationItems,
  selectedStoreId,
  stores,
  children,
  onNavigate,
  onSelectStore,
  onAddStore,
  onSaveState,
  onLoadState,
  onExportConfig,
  onImportConfig,
  onResetState
}: CalculatorShellProps) {
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const navigationOptions = navigationItems.map(item => ({ value: item.key, label: item.label }));
  const storeOptions = stores.map(item => ({ value: item.id, label: item.name }));

  const runMobileAction = (handler: () => void) => {
    setMobileActionsOpen(false);
    handler();
  };

  const mobileActions = (
    <div className="mobile-actions-popover">
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
      <Button block danger icon={<ReloadOutlined />} onClick={() => runMobileAction(onResetState)}>恢复示例</Button>
    </div>
  );

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
          <Button icon={<PlusOutlined />} onClick={onAddStore}>新增门店</Button>
          <Button icon={<SaveOutlined />} onClick={onSaveState}>保存设置</Button>
          <Button onClick={onLoadState}>读取保存</Button>
          <Button icon={<DownloadOutlined />} onClick={onExportConfig}>导出配置</Button>
          <Upload {...uploadProps(onImportConfig)}><Button icon={<UploadOutlined />}>导入配置</Button></Upload>
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
