'use client';

import { Button, Card, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type {
  ProductDiscountSuggestionAction,
  ProductDiscountSuggestionRiskLevel,
  ProductDiscountSuggestionRole,
  ProductDiscountSuggestionViewRow
} from './productDiscountSuggestionUtils';

export type {
  ProductDiscountSuggestionAction,
  ProductDiscountSuggestionRiskLevel,
  ProductDiscountSuggestionRole,
  ProductDiscountSuggestionViewRow
} from './productDiscountSuggestionUtils';

const { Text } = Typography;

type ProductDiscountSuggestionPanelProps<T extends ProductDiscountSuggestionViewRow> = {
  title?: string;
  description?: React.ReactNode;
  suggestions: T[];
  allowApply: boolean;
  money: (value: unknown) => string;
  onApply: (suggestion: T) => void;
};

function productDiscountRiskLabel(level: ProductDiscountSuggestionRiskLevel) {
  if (level === 'safe') return '可执行';
  if (level === 'watch') return '需复核';
  return '不可直接应用';
}

function productDiscountRiskColor(level: ProductDiscountSuggestionRiskLevel) {
  if (level === 'safe') return 'green';
  if (level === 'watch') return 'orange';
  return 'red';
}

function productDiscountRoleLabel(role: ProductDiscountSuggestionRole) {
  if (role === 'main') return '主商品';
  if (role === 'addOn') return '凑单品';
  return '混合';
}

export function ProductDiscountSuggestionPanel<T extends ProductDiscountSuggestionViewRow>({
  title,
  description,
  suggestions,
  allowApply,
  money,
  onApply
}: ProductDiscountSuggestionPanelProps<T>) {
  const columns: TableColumnsType<T> = [
    { title: '状态', dataIndex: 'riskLevel', width: 95, render: value => <Tag color={productDiscountRiskColor(value as ProductDiscountSuggestionRiskLevel)}>{productDiscountRiskLabel(value as ProductDiscountSuggestionRiskLevel)}</Tag> },
    { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: value => <Text className="table-text-wrap">{String(value || '')}</Text> },
    { title: '分类', dataIndex: 'categoryName', width: 90, render: value => <Tag>{String(value || '-')}</Tag> },
    { title: '角色', dataIndex: 'role', width: 90, render: value => <Tag color={value === 'addOn' ? 'cyan' : 'blue'}>{productDiscountRoleLabel(value as ProductDiscountSuggestionRole)}</Tag> },
    { title: '结论', dataIndex: 'actionLabel', width: 120, render: (_, row) => <Tag color={productDiscountRiskColor(row.riskLevel)}>{row.actionLabel}</Tag> },
    { title: '售价', dataIndex: 'unitPrice', width: 90, render: value => `¥${money(value)}`, sorter: (a, b) => a.unitPrice - b.unitPrice },
    { title: '当前成本', dataIndex: 'avgUnitCost', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgUnitCost - b.avgUnitCost },
    { title: '活动合理成本', dataIndex: 'avgReasonableCost', width: 125, render: value => `¥${money(value)}`, sorter: (a, b) => a.avgReasonableCost - b.avgReasonableCost },
    { title: '合理空间', dataIndex: 'avgCostGap', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.avgCostGap - b.avgCostGap },
    { title: '合理标价', dataIndex: 'reasonablePriceFromCost', width: 105, render: value => value === null ? '-' : `¥${money(value)}`, sorter: (a, b) => (a.reasonablePriceFromCost || 0) - (b.reasonablePriceFromCost || 0) },
    { title: '差值范围', width: 130, render: (_, row) => row.minCostGap === null ? '-' : `${money(row.minCostGap)} ~ ${money(row.maxCostGap)}` },
    { title: '建议折扣', width: 115, render: (_, row) => row.actionType === 'discount' ? `${money(row.discountRate)}折 / ¥${money(row.discountAmountPerUnit)}` : '-' },
    { title: '影响组合', width: 115, render: (_, row) => `${row.affectedComboCount} 条`, sorter: (a, b) => a.affectedComboCount - b.affectedComboCount },
    { title: '风险/空间', width: 115, render: (_, row) => `${row.riskComboCount}/${row.opportunityComboCount}`, sorter: (a, b) => a.riskComboCount - b.riskComboCount || a.opportunityComboCount - b.opportunityComboCount },
    { title: '说明', dataIndex: 'reason', width: 360, render: value => <Text type="secondary" className="table-text-wrap">{String(value || '')}</Text> },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
      render: (_, row) => allowApply && row.actionType === 'discount'
        ? <Button size="small" disabled={row.riskLevel === 'blocked'} onClick={() => onApply(row)}>应用</Button>
        : <Text type="secondary">只观察</Text>
    }
  ];

  return (
    <Card size="small" title={title || '商品维度活动合理成本结论'}>
      <Space direction="vertical" style={{ width: '100%' }} size="small">
        <Text type="secondary">{description || '商品结论按当前活动路线下的合理成本反推；主商品比较活动合理成本和当前成本，凑单品只判断分摊到手是否覆盖成本。'}</Text>
        {suggestions.length ? (
          <Table
            rowKey="key"
            size="small"
            columns={columns}
            dataSource={suggestions}
            pagination={false}
            scroll={{ x: 1925 }}
            tableLayout="fixed"
          />
        ) : (
          <Text type="secondary">当前范围没有需要商品折扣、调价或凑单风险处理的商品。</Text>
        )}
      </Space>
    </Card>
  );
}
