'use client';

import { Button, Layout, Menu, Select, Space, Upload } from 'antd';
import type { UploadProps } from 'antd';
import { DownloadOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons';
import { isPageKey, type PageKey } from '../../pageRoutes';

const { Header, Sider, Content } = Layout;

type CalculatorShellStoreOption = {
  id: string;
  name: string;
};

type CalculatorShellProps = {
  activePage: PageKey;
  selectedStoreId: string;
  stores: CalculatorShellStoreOption[];
  children: React.ReactNode;
  uploadProps: (handler: (file: File) => void) => UploadProps;
  onNavigate: (page: PageKey) => void;
  onSelectStore: (storeId: string) => void;
  onAddStore: () => void;
  onSaveState: () => void;
  onLoadState: () => void;
  onExportConfig: () => void;
  onImportConfig: (file: File) => void;
  onResetState: () => void;
};

const MENU_ITEMS: Array<{ key: PageKey; label: string }> = [
  { key: 'store', label: '门店维护' },
  { key: 'products', label: '商品维护' },
  { key: 'system-strategy', label: '系统活动策略' },
  { key: 'platform', label: '平台通用规则' },
  { key: 'meituan', label: '美团活动' },
  { key: 'eleme', label: '饿了么活动' },
  { key: 'activity-design', label: '活动设计' },
  { key: 'order-analysis', label: '订单分析' },
  { key: 'data-analysis', label: '数据分析' },
  { key: 'pricing', label: '定价评估' },
  { key: 'results', label: '测算结果' }
];

export function CalculatorShell({
  activePage,
  selectedStoreId,
  stores,
  children,
  uploadProps,
  onNavigate,
  onSelectStore,
  onAddStore,
  onSaveState,
  onLoadState,
  onExportConfig,
  onImportConfig,
  onResetState
}: CalculatorShellProps) {
  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div>
          <h1 className="app-title">外卖门店活动测算工具</h1>
          <p className="app-subtitle">按门店维护商品、平台活动和利润率阶梯，测算组合利润并导出结果。</p>
        </div>
        <Space wrap>
          <Select
            style={{ width: 220 }}
            value={selectedStoreId}
            onChange={onSelectStore}
            options={stores.map(item => ({ value: item.id, label: item.name }))}
          />
          <Button icon={<PlusOutlined />} onClick={onAddStore}>新增门店</Button>
          <Button icon={<SaveOutlined />} onClick={onSaveState}>保存设置</Button>
          <Button onClick={onLoadState}>读取保存</Button>
          <Button icon={<DownloadOutlined />} onClick={onExportConfig}>导出配置</Button>
          <Upload {...uploadProps(onImportConfig)}><Button icon={<UploadOutlined />}>导入配置</Button></Upload>
          <Button danger icon={<ReloadOutlined />} onClick={onResetState}>恢复示例</Button>
        </Space>
      </Header>
      <Layout>
        <Sider width={210} theme="light" breakpoint="lg" collapsedWidth={0}>
          <Menu
            className="side-menu"
            selectedKeys={[activePage]}
            onClick={item => {
              if (isPageKey(item.key)) onNavigate(item.key);
            }}
            items={MENU_ITEMS}
          />
        </Sider>
        <Content className="app-content">{children}</Content>
      </Layout>
    </Layout>
  );
}
