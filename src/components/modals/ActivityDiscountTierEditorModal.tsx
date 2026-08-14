'use client';

import { Button, Card, InputNumber, Modal, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ActivityOriginalDiscountTier } from '../../domain/types';
import { roundMoney } from '../../domain/money';

const { Text } = Typography;

export type ActivityDiscountTierBatchDraft = {
  start: number;
  end: number | '';
  step: number;
  rate: number;
};

export type ActivityDiscountTierEditorValue = {
  title: string;
  fallback: ActivityOriginalDiscountTier[];
};

type ActivityDiscountTierEditorModalProps = {
  editor: ActivityDiscountTierEditorValue | null;
  rows: ActivityOriginalDiscountTier[];
  batchDraft: ActivityDiscountTierBatchDraft;
  money: (value: unknown) => string;
  onChangeRows: (rows: ActivityOriginalDiscountTier[]) => void;
  onChangeBatchDraft: (mutator: (draft: ActivityDiscountTierBatchDraft) => ActivityDiscountTierBatchDraft) => void;
  onCancel: () => void;
  onSave: () => void;
};

function normalizeActivityOriginalDiscountTiers(value: unknown, fallback: ActivityOriginalDiscountTier[]) {
  const hasExplicitRows = Array.isArray(value);
  const rows = Array.isArray(value) ? value as Partial<ActivityOriginalDiscountTier>[] : [];
  const normalized = rows
    .map(row => {
      const originalMin = Math.max(0, Number(row?.originalMin) || 0);
      const rawMax = Number(row?.originalMax) || originalMin + 1;
      return {
        originalMin,
        originalMax: Math.max(originalMin + 1, rawMax),
        discountRate: Math.max(0, Math.min(95, Number(row?.discountRate) || 0))
      };
    })
    .filter((row, index, list) => (
      Number.isFinite(row.originalMin)
      && Number.isFinite(row.originalMax)
      && list.findIndex(item => Math.abs(item.originalMin - row.originalMin) < 1e-9 && Math.abs(item.originalMax - row.originalMax) < 1e-9) === index
    ))
    .sort((a, b) => a.originalMin - b.originalMin || a.originalMax - b.originalMax);
  if (normalized.length) return normalized;
  return hasExplicitRows ? [] : fallback.map(row => ({ ...row }));
}

function createActivityDiscountTiersByStep(draft: ActivityDiscountTierBatchDraft) {
  const start = Math.max(0, Number(draft.start) || 0);
  const end = draft.end === '' ? 999 : Math.max(start + 1, Number(draft.end) || start + 1);
  const step = Math.max(1, Number(draft.step) || 1);
  const rate = Math.max(0, Math.min(95, Number(draft.rate) || 0));
  const rows: ActivityOriginalDiscountTier[] = [];
  let current = start;
  while (current < end - 1e-9 && rows.length < 80) {
    const next = Math.min(end, current + step);
    rows.push({ originalMin: roundMoney(current), originalMax: next >= 999 ? 999 : roundMoney(next), discountRate: rate });
    current = next;
  }
  return rows;
}

function shiftActivityDiscountTierRates(tiers: ActivityOriginalDiscountTier[], delta: number) {
  return normalizeActivityOriginalDiscountTiers(tiers.map(tier => ({
    ...tier,
    discountRate: Math.max(0, Math.min(95, roundMoney(tier.discountRate + delta)))
  })), tiers);
}

function setActivityDiscountTierRates(tiers: ActivityOriginalDiscountTier[], rate: number) {
  const nextRate = Math.max(0, Math.min(95, Number(rate) || 0));
  return normalizeActivityOriginalDiscountTiers(tiers.map(tier => ({
    ...tier,
    discountRate: nextRate
  })), tiers);
}

function updateTierRow(rows: ActivityOriginalDiscountTier[], index: number, patch: Partial<ActivityOriginalDiscountTier>, fallback: ActivityOriginalDiscountTier[]) {
  return normalizeActivityOriginalDiscountTiers(rows.map((row, rowIndex) => {
    if (rowIndex !== index) return row;
    const next = { ...row, ...patch };
    const originalMin = Math.max(0, Number(next.originalMin) || 0);
    const originalMax = Math.max(originalMin + 1, Number(next.originalMax) || originalMin + 1);
    return {
      originalMin: roundMoney(originalMin),
      originalMax: originalMax >= 999 ? 999 : roundMoney(originalMax),
      discountRate: Math.max(0, Math.min(95, roundMoney(Number(next.discountRate) || 0)))
    };
  }), fallback);
}

function addTierRow(rows: ActivityOriginalDiscountTier[], fallback: ActivityOriginalDiscountTier[]) {
  const sorted = normalizeActivityOriginalDiscountTiers(rows, fallback);
  const last = sorted[sorted.length - 1];
  const originalMin = last ? (last.originalMax >= 999 ? last.originalMin + 10 : last.originalMax) : 0;
  const originalMax = originalMin + 10;
  return normalizeActivityOriginalDiscountTiers(sorted.concat({
    originalMin: roundMoney(originalMin),
    originalMax: roundMoney(originalMax),
    discountRate: last?.discountRate ?? 30
  }), sorted);
}

export function ActivityDiscountTierEditorModal({
  editor,
  rows,
  batchDraft,
  money,
  onChangeRows,
  onChangeBatchDraft,
  onCancel,
  onSave
}: ActivityDiscountTierEditorModalProps) {
  const fallback = editor?.fallback || [];
  const tableRows = rows.map((row, index) => ({ ...row, rowIndex: index }));
  const columns: TableColumnsType<ActivityOriginalDiscountTier & { rowIndex: number }> = [
    {
      title: '起始原价',
      dataIndex: 'originalMin',
      width: 120,
      render: (_, row) => (
        <InputNumber
          min={0}
          precision={2}
          value={row.originalMin}
          onChange={value => onChangeRows(updateTierRow(rows, row.rowIndex, { originalMin: Number(value) || 0 }, fallback))}
        />
      )
    },
    {
      title: '结束原价',
      dataIndex: 'originalMax',
      width: 120,
      render: (_, row) => (
        <InputNumber
          min={0}
          precision={2}
          placeholder="999=不限"
          value={row.originalMax >= 999 ? 999 : row.originalMax}
          onChange={value => onChangeRows(updateTierRow(rows, row.rowIndex, { originalMax: value === null ? 999 : Number(value) || 0 }, fallback))}
        />
      )
    },
    {
      title: '覆盖让利率%',
      dataIndex: 'discountRate',
      width: 140,
      render: (_, row) => (
        <InputNumber
          min={0}
          max={95}
          precision={2}
          value={row.discountRate}
          onChange={value => onChangeRows(updateTierRow(rows, row.rowIndex, { discountRate: Number(value) || 0 }, fallback))}
        />
      )
    },
    {
      title: '说明',
      width: 220,
      render: (_, row) => <Text type="secondary">原价 ¥{money(row.originalMin)}-{row.originalMax >= 999 ? '不限' : `¥${money(row.originalMax)}`}，覆盖让利 {money(row.discountRate)}%</Text>
    },
    {
      title: '操作',
      width: 80,
      render: (_, row) => (
        <Button
          danger
          size="small"
          onClick={() => onChangeRows(rows.filter((_, index) => index !== row.rowIndex))}
        >
          删除
        </Button>
      )
    }
  ];

  return (
    <Modal
      title={editor?.title || '原价让利设置'}
      open={Boolean(editor)}
      width={880}
      destroyOnHidden
      onCancel={onCancel}
      footer={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button key="save" type="primary" onClick={onSave}>保存阶梯</Button>
      ]}
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Text type="secondary">全路线基准让利率在系统策略或门店活动配置中统一设置；下方阶梯只用于覆盖特殊原价段。系统会先扣除默认神券/爆红包已经形成的基准让利，再把剩余空间分给满减、优惠券和加码。</Text>
        <Card size="small" title="批量生成阶梯">
          <Space wrap>
            <Text type="secondary">范围</Text>
            <InputNumber min={0} precision={2} value={batchDraft.start} onChange={value => onChangeBatchDraft(prev => ({ ...prev, start: Number(value) || 0 }))} />
            <InputNumber min={0} precision={2} placeholder="空=不限" value={batchDraft.end === '' ? null : batchDraft.end} onChange={value => onChangeBatchDraft(prev => ({ ...prev, end: value === null ? '' : Number(value) || 0 }))} />
            <Text type="secondary">步长</Text>
            <InputNumber min={1} precision={0} value={batchDraft.step} onChange={value => onChangeBatchDraft(prev => ({ ...prev, step: Math.max(1, Math.floor(Number(value) || 1)) }))} />
            <Text type="secondary">让利率%</Text>
            <InputNumber min={0} max={95} precision={2} value={batchDraft.rate} onChange={value => onChangeBatchDraft(prev => ({ ...prev, rate: Number(value) || 0 }))} />
            <Button onClick={() => onChangeRows(createActivityDiscountTiersByStep(batchDraft))}>生成阶梯</Button>
            <Button onClick={() => onChangeRows(addTierRow(rows, fallback))}>添加一档</Button>
          </Space>
        </Card>
        <Card size="small" title="批量调整利率">
          <Space wrap>
            <Button onClick={() => onChangeRows(shiftActivityDiscountTierRates(rows, 5))}>全部 +5%</Button>
            <Button onClick={() => onChangeRows(shiftActivityDiscountTierRates(rows, -5))}>全部 -5%</Button>
            <Button onClick={() => onChangeRows(setActivityDiscountTierRates(rows, batchDraft.rate))}>全部设为 {money(batchDraft.rate)}%</Button>
            <Button onClick={() => onChangeRows(fallback)}>恢复默认</Button>
          </Space>
        </Card>
        <Table
          rowKey="rowIndex"
          size="small"
          columns={columns}
          dataSource={tableRows}
          pagination={false}
          scroll={{ x: 680 }}
          tableLayout="fixed"
        />
      </Space>
    </Modal>
  );
}
