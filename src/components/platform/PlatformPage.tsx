'use client';

import { Button, Card, Col, InputNumber, Row, Space, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { PricingStrategyCard, ProfitTargetsCard, RedTierCard } from '../shared/FeeRuleCards';
import type { FeeRule, Platform, PricingStrategyTier, ProfitTarget, RedTier, StapleScenario } from '../../domain/types';

const { Text } = Typography;

type PlatformFeeField =
  | 'commissionRate'
  | 'minCommission'
  | 'baseDeliveryFee'
  | 'extraDeliveryFee'
  | 'midPriceRate'
  | 'highPriceRate'
  | 'freightWithin3'
  | 'freightWithin5'
  | 'freightAbove5';

type PlatformPageProps = {
  fee: FeeRule;
  isEditing: boolean;
  scenarios: StapleScenario[];
  money: (value: unknown) => string;
  stapleScenarioName: (scenario: StapleScenario) => string;
  startEdit: () => void;
  cancelEdit: () => void;
  saveEdit: () => void;
  updateFeeField: (field: PlatformFeeField, value: number) => void;
  changeProfitTargets: (rows: ProfitTarget[]) => void;
  addProfitTarget: () => void;
  changePricingStrategy: (strategy: Record<StapleScenario, PricingStrategyTier[]>) => void;
  changeRedTiers: (platform: Platform, rows: RedTier[]) => void;
};

const PLATFORM_FEE_FIELDS: Array<[PlatformFeeField, string]> = [
  ['commissionRate', '佣金率%'],
  ['minCommission', '保底佣金'],
  ['baseDeliveryFee', '3公里内配送费'],
  ['extraDeliveryFee', '超3公里每0.1公里'],
  ['midPriceRate', '20-25元价格费率'],
  ['highPriceRate', '25元以上价格费率'],
  ['freightWithin3', '3公里内运费补贴'],
  ['freightWithin5', '3-5公里运费补贴'],
  ['freightAbove5', '5公里以上运费补贴']
];

export function PlatformPage({
  fee,
  isEditing,
  scenarios,
  money,
  stapleScenarioName,
  startEdit,
  cancelEdit,
  saveEdit,
  updateFeeField,
  changeProfitTargets,
  addProfitTarget,
  changePricingStrategy,
  changeRedTiers
}: PlatformPageProps) {
  return (
    <div className="section-stack">
      <Card
        title="平台费用规则"
        extra={isEditing ? (
          <Space>
            <Button onClick={cancelEdit}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存平台规则</Button>
          </Space>
        ) : (
          <Button type="primary" onClick={startEdit}>编辑平台规则</Button>
        )}
      >
        <Row gutter={[12, 12]}>
          {PLATFORM_FEE_FIELDS.map(([field, label]) => (
            <Col xs={12} md={6} key={field}>
              <div className="field">
                <Text type="secondary">{label}</Text>
                {isEditing ? (
                  <InputNumber precision={2} value={Number(fee[field])} onChange={value => updateFeeField(field, Number(value) || 0)} />
                ) : (
                  <div className="field-value">{money(fee[field])}</div>
                )}
              </div>
            </Col>
          ))}
        </Row>
      </Card>
      <ProfitTargetsCard
        title="平台通用利润率阶梯"
        rows={fee.profitTargets}
        disabled={!isEditing}
        money={money}
        onChange={changeProfitTargets}
        onAdd={addProfitTarget}
      />
      <PricingStrategyCard
        title="平台通用定价策略阶梯"
        strategy={fee.pricingStrategy}
        disabled={!isEditing}
        scenarios={scenarios}
        money={money}
        stapleScenarioName={stapleScenarioName}
        onChange={changePricingStrategy}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <RedTierCard title="美团基础神券" rows={fee.redTiers.meituan} disabled={!isEditing} money={money} onChange={rows => changeRedTiers('meituan', rows)} />
        </Col>
        <Col xs={24} lg={12}>
          <RedTierCard title="饿了么基础爆红包" rows={fee.redTiers.eleme} disabled={!isEditing} money={money} onChange={rows => changeRedTiers('eleme', rows)} />
        </Col>
      </Row>
    </div>
  );
}
