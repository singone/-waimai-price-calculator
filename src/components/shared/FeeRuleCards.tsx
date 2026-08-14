'use client';

import React from 'react';
import { Button, Card, InputNumber, Space, Switch, Table, Tabs, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import type { PricingStrategyTier, ProfitTarget, RedTier, StapleScenario } from '../../domain/types';

const { Text } = Typography;

type MoneyFormatter = (value: unknown) => string;

type ProfitTargetsCardProps = {
  title: string;
  rows: ProfitTarget[];
  disabled: boolean;
  extra?: React.ReactNode;
  money: MoneyFormatter;
  onChange: (rows: ProfitTarget[]) => void;
  onAdd: () => void;
};

export function ProfitTargetsCard({ title, rows, disabled, extra, money, onChange, onAdd }: ProfitTargetsCardProps) {
  const columns: TableColumnsType<ProfitTarget> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (_, row, index) => disabled
        ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
        : <Switch checked={row.enabled} onChange={checked => onChange(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
    },
    {
      title: '实付最低',
      dataIndex: 'payMin',
      render: (_, row, index) => disabled
        ? `¥${money(row.payMin)}`
        : <InputNumber precision={2} value={row.payMin} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, payMin: Number(value) || 0 } : item))} />
    },
    {
      title: '实付最高',
      dataIndex: 'payMax',
      render: (_, row, index) => disabled
        ? `¥${money(row.payMax)}`
        : <InputNumber precision={2} value={row.payMax} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, payMax: Number(value) || 0 } : item))} />
    },
    {
      title: '利润率低%',
      dataIndex: 'rateMin',
      render: (_, row, index) => disabled
        ? `${money(row.rateMin)}%`
        : <InputNumber precision={2} value={row.rateMin} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, rateMin: Number(value) || 0 } : item))} />
    },
    {
      title: '利润率高%',
      dataIndex: 'rateMax',
      render: (_, row, index) => disabled
        ? `${money(row.rateMax)}%`
        : <InputNumber precision={2} value={row.rateMax} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, rateMax: Number(value) || 0 } : item))} />
    },
    ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: ProfitTarget, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => onChange(rows.filter((_, i) => i !== index))} /> }])
  ];
  return (
    <Card title={title} extra={<Space>{extra}{disabled ? null : <Button icon={<PlusOutlined />} onClick={onAdd}>添加阶梯</Button>}</Space>}>
      <Table size="small" rowKey={(_, index) => String(index)} columns={columns} dataSource={rows} pagination={false} scroll={{ x: 760 }} />
    </Card>
  );
}

type PricingStrategyCardProps = {
  title: string;
  strategy: Record<StapleScenario, PricingStrategyTier[]>;
  disabled: boolean;
  scenarios: StapleScenario[];
  money: MoneyFormatter;
  stapleScenarioName: (scenario: StapleScenario) => string;
  onChange: (strategy: Record<StapleScenario, PricingStrategyTier[]>) => void;
};

export function PricingStrategyCard({ title, strategy, disabled, scenarios, money, stapleScenarioName, onChange }: PricingStrategyCardProps) {
  const updateRows = (scenario: StapleScenario, rows: PricingStrategyTier[]) => {
    onChange({ ...strategy, [scenario]: rows });
  };
  const columnsFor = (scenario: StapleScenario): TableColumnsType<PricingStrategyTier> => {
    const rows = strategy[scenario] || [];
    return [
      {
        title: '启用',
        dataIndex: 'enabled',
        width: 70,
        render: (_, row, index) => disabled
          ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
          : <Switch checked={row.enabled} onChange={checked => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
      },
      {
        title: '实付最低',
        dataIndex: 'payMin',
        width: 115,
        render: (_, row, index) => disabled
          ? `¥${money(row.payMin)}`
          : <InputNumber min={0} precision={2} value={row.payMin} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payMin: Number(value) || 0 } : item))} />
      },
      {
        title: '实付最高',
        dataIndex: 'payMax',
        width: 115,
        render: (_, row, index) => disabled
          ? (row.payMax >= 9999 ? '不限' : `¥${money(row.payMax)}`)
          : <InputNumber min={0} precision={2} value={row.payMax} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payMax: Number(value) || 0 } : item))} />
      },
      {
        title: '实付下限%',
        dataIndex: 'payRateMin',
        width: 115,
        render: (_, row, index) => disabled
          ? `${money(row.payRateMin)}%`
          : <InputNumber min={0} precision={2} value={row.payRateMin} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payRateMin: Number(value) || 0 } : item))} />
      },
      {
        title: '实付目标%',
        dataIndex: 'payRateTarget',
        width: 115,
        render: (_, row, index) => disabled
          ? `${money(row.payRateTarget)}%`
          : <InputNumber min={0} precision={2} value={row.payRateTarget} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, payRateTarget: Number(value) || 0 } : item))} />
      },
      {
        title: '到手下限%',
        dataIndex: 'netRateMin',
        width: 115,
        render: (_, row, index) => disabled
          ? `${money(row.netRateMin)}%`
          : <InputNumber min={0} precision={2} value={row.netRateMin} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, netRateMin: Number(value) || 0 } : item))} />
      },
      {
        title: '到手目标%',
        dataIndex: 'netRateTarget',
        width: 115,
        render: (_, row, index) => disabled
          ? `${money(row.netRateTarget)}%`
          : <InputNumber min={0} precision={2} value={row.netRateTarget} onChange={value => updateRows(scenario, rows.map((item, i) => i === index ? { ...item, netRateTarget: Number(value) || 0 } : item))} />
      },
      ...(disabled ? [] : [{
        title: '',
        width: 70,
        render: (_: unknown, __: PricingStrategyTier, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => updateRows(scenario, rows.filter((_, i) => i !== index))} />
      }])
    ];
  };
  return (
    <Card title={title}>
      <Text type="secondary">按用户实付匹配阶梯；下限用于预警，目标用于定价建议和活动设计。最后一档可把实付最高设置为 9999 表示不限。</Text>
      <Tabs
        items={scenarios.map(scenario => ({
          key: scenario,
          label: stapleScenarioName(scenario),
          children: (
            <Space direction="vertical" style={{ width: '100%' }}>
              {disabled ? null : <Button icon={<PlusOutlined />} onClick={() => updateRows(scenario, (strategy[scenario] || []).concat({ enabled: true, payMin: 0, payMax: 9999, payRateMin: 0, payRateTarget: 0, netRateMin: 0, netRateTarget: 0 }))}>添加{stapleScenarioName(scenario)}阶梯</Button>}
              <Table size="small" rowKey={(_, index) => String(index)} columns={columnsFor(scenario)} dataSource={strategy[scenario] || []} pagination={false} scroll={{ x: 850 }} />
            </Space>
          )
        }))}
      />
    </Card>
  );
}

type RedTierCardProps = {
  title: string;
  rows: RedTier[];
  disabled: boolean;
  money: MoneyFormatter;
  onChange: (rows: RedTier[]) => void;
};

export function RedTierCard({ title, rows, disabled, money, onChange }: RedTierCardProps) {
  const columns: TableColumnsType<RedTier> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      render: (_, row, index) => disabled
        ? <Tag color={row.enabled ? 'green' : 'default'}>{row.enabled ? '启用' : '停用'}</Tag>
        : <Switch checked={row.enabled} onChange={checked => onChange(rows.map((item, i) => i === index ? { ...item, enabled: checked } : item))} />
    },
    {
      title: '门槛',
      dataIndex: 'threshold',
      render: (_, row, index) => disabled
        ? `¥${money(row.threshold)}`
        : <InputNumber precision={2} value={row.threshold} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, threshold: Number(value) || 0 } : item))} />
    },
    {
      title: '最小',
      dataIndex: 'min',
      render: (_, row, index) => disabled
        ? `¥${money(row.min)}`
        : <InputNumber precision={2} value={row.min} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, min: Number(value) || 0 } : item))} />
    },
    {
      title: '最大',
      dataIndex: 'max',
      render: (_, row, index) => disabled
        ? `¥${money(row.max)}`
        : <InputNumber precision={2} value={row.max} onChange={value => onChange(rows.map((item, i) => i === index ? { ...item, max: Number(value) || 0 } : item))} />
    },
    ...(disabled ? [] : [{ title: '', width: 70, render: (_: unknown, __: RedTier, index: number) => <Button danger icon={<DeleteOutlined />} onClick={() => onChange(rows.filter((_, i) => i !== index))} /> }])
  ];
  return (
    <Card title={title} extra={disabled ? null : <Button icon={<PlusOutlined />} onClick={() => onChange(rows.concat({ enabled: true, threshold: 0, min: 0, max: 0 }))}>添加档位</Button>}>
      <Table rowKey={(_, index) => String(index)} size="small" columns={columns} dataSource={rows} pagination={false} />
    </Card>
  );
}
