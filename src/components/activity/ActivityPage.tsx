'use client';

import { Button, Card, Input, InputNumber, Space, Switch, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, PlusOutlined, SaveOutlined } from '@ant-design/icons';
import type { Activities, Coupon, DiscountActivity, FullReduction, Platform, RedAddOn } from '../../domain/types';

const { Text } = Typography;

const PLATFORM_NAMES: Record<Platform, string> = { meituan: '美团', eleme: '饿了么' };

type ActivityPageProps = {
  platform: Platform;
  storeName: string;
  isEditing: boolean;
  activities: Activities;
  money: (value: unknown) => string;
  startEdit: (platform: Platform) => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  changeFullReductions: (rows: FullReduction[]) => void;
  changeCoupons: (rows: Coupon[]) => void;
  changeRedAddOns: (rows: RedAddOn[]) => void;
  changeDiscountActivities: (rows: DiscountActivity[]) => void;
};

function SimpleActivityTable<T extends FullReduction | RedAddOn>({
  title,
  rows,
  change,
  blank,
  disabled,
  money
}: {
  title: string;
  rows: T[];
  change: (rows: T[]) => void;
  blank: T;
  disabled: boolean;
  money: (value: unknown) => string;
}) {
  const columns: TableColumnsType<T> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (_, row, index) => disabled
        ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
        : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
    },
    {
      title: '门槛',
      dataIndex: 'threshold',
      render: (_, row, index) => disabled
        ? `¥${money(row.threshold)}`
        : <InputNumber precision={2} value={row.threshold} onChange={value => change(rows.map((item, i) => i === index ? { ...item, threshold: Number(value) || 0 } : item))} />
    },
    {
      title: '金额',
      dataIndex: 'amount',
      render: (_, row, index) => disabled
        ? `¥${money(row.amount)}`
        : <InputNumber precision={2} value={row.amount} onChange={value => change(rows.map((item, i) => i === index ? { ...item, amount: Number(value) || 0 } : item))} />
    },
    ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: T, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
  ];

  return (
    <Card title={title} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat(blank))}>添加</Button>}>
      <Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} />
    </Card>
  );
}

function CouponTable({
  platform,
  rows,
  change,
  disabled,
  money
}: {
  platform: Platform;
  rows: Coupon[];
  change: (rows: Coupon[]) => void;
  disabled: boolean;
  money: (value: unknown) => string;
}) {
  const columns: TableColumnsType<Coupon> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (_, row, index) => disabled
        ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
        : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
    },
    {
      title: '名称',
      dataIndex: 'name',
      render: (_, row, index) => disabled
        ? <Text>{row.name || '-'}</Text>
        : <Input value={row.name} onChange={event => change(rows.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
    },
    {
      title: '门槛',
      dataIndex: 'threshold',
      render: (_, row, index) => disabled
        ? `¥${money(row.threshold)}`
        : <InputNumber precision={2} value={row.threshold} onChange={value => change(rows.map((item, i) => i === index ? { ...item, threshold: Number(value) || 0 } : item))} />
    },
    {
      title: '金额',
      dataIndex: 'amount',
      render: (_, row, index) => disabled
        ? `¥${money(row.amount)}`
        : <InputNumber precision={2} value={row.amount} onChange={value => change(rows.map((item, i) => i === index ? { ...item, amount: Number(value) || 0 } : item))} />
    },
    ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: Coupon, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
  ];

  return (
    <Card title={`${PLATFORM_NAMES[platform]}订单优惠券`} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat({ enabled: true, name: '订单优惠券', threshold: 0, amount: 0 }))}>添加券</Button>}>
      <Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 760 }} />
    </Card>
  );
}

function DiscountActivityTable({
  platform,
  rows,
  change,
  disabled,
  money
}: {
  platform: Platform;
  rows: DiscountActivity[];
  change: (rows: DiscountActivity[]) => void;
  disabled: boolean;
  money: (value: unknown) => string;
}) {
  const columns: TableColumnsType<DiscountActivity> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (_, row, index) => disabled
        ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
        : <Switch checked={row.enabled} onChange={checked => change(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
    },
    {
      title: '名称',
      dataIndex: 'name',
      render: (_, row, index) => disabled
        ? <Text>{row.name || '-'}</Text>
        : <Input value={row.name} onChange={event => change(rows.map((item, i) => i === index ? { ...item, name: event.target.value } : item))} />
    },
    {
      title: '商品关键字',
      dataIndex: 'productNames',
      render: (_, row, index) => disabled
        ? <Text>{row.productNames || '全部商品'}</Text>
        : <Input placeholder="空=全部，多个用逗号" value={row.productNames} onChange={event => change(rows.map((item, i) => i === index ? { ...item, productNames: event.target.value } : item))} />
    },
    {
      title: '折扣',
      dataIndex: 'discountRate',
      render: (_, row, index) => disabled
        ? `${money(row.discountRate)}折`
        : <InputNumber precision={2} value={row.discountRate} onChange={value => change(rows.map((item, i) => i === index ? { ...item, discountRate: Number(value) || 0 } : item))} />
    },
    {
      title: '活动件数上限',
      dataIndex: 'itemLimit',
      render: (_, row, index) => disabled
        ? (row.itemLimit === '' ? '不限' : row.itemLimit)
        : <InputNumber min={0} placeholder="空=不限" value={row.itemLimit === '' ? null : row.itemLimit} onChange={value => change(rows.map((item, i) => i === index ? { ...item, itemLimit: value === null ? '' : Number(value) || 0 } : item))} />
    },
    ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: DiscountActivity, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => change(rows.filter((_, i) => i !== index))} /> }])
  ];

  return (
    <Card title={`${PLATFORM_NAMES[platform]}商品折扣活动`} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => change(rows.concat({ enabled: true, name: '商品折扣', productNames: '', discountRate: 8.8, itemLimit: '' }))}>添加折扣</Button>}>
      <Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 920 }} />
    </Card>
  );
}

export function ActivityPage({
  platform,
  storeName,
  isEditing,
  activities,
  money,
  startEdit,
  cancelEdit,
  saveEdit,
  changeFullReductions,
  changeCoupons,
  changeRedAddOns,
  changeDiscountActivities
}: ActivityPageProps) {
  const platformName = PLATFORM_NAMES[platform];

  return (
    <div className="section-stack">
      <Card
        title={`${platformName}活动维护`}
        extra={isEditing ? (
          <Space>
            <Button onClick={cancelEdit}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存活动</Button>
          </Space>
        ) : (
          <Button type="primary" onClick={() => startEdit(platform)}>编辑活动</Button>
        )}
      >
        <Text type="secondary">活动配置归属于当前门店「{storeName}」。基础{platform === 'meituan' ? '神券' : '爆红包'}阶梯来自平台通用规则，本页只维护门店加码和门店承担的活动。</Text>
      </Card>

      <SimpleActivityTable
        title={`${platformName}门店满减`}
        rows={activities.fullReductions}
        change={changeFullReductions}
        blank={{ enabled: true, threshold: 0, amount: 0 }}
        disabled={!isEditing}
        money={money}
      />
      <CouponTable
        platform={platform}
        rows={activities.coupons}
        change={changeCoupons}
        disabled={!isEditing}
        money={money}
      />
      <SimpleActivityTable
        title={`${platformName}${platform === 'meituan' ? '神券' : '爆红包'}加码`}
        rows={activities.redAddOns}
        change={changeRedAddOns}
        blank={{ enabled: true, threshold: 0, amount: 0 }}
        disabled={!isEditing}
        money={money}
      />
      <DiscountActivityTable
        platform={platform}
        rows={activities.discountActivities}
        change={changeDiscountActivities}
        disabled={!isEditing}
        money={money}
      />
    </div>
  );
}
