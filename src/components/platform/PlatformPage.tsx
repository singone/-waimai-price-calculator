'use client';

import { useEffect, useState } from 'react';
import { Button, Card, Col, InputNumber, Row, Space, Typography } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import { STAPLE_SCENARIOS } from '../../config/calculation';
import { deepClone, stapleScenarioName } from '../../domain/core';
import { money as formatMoney } from '../../utils/format';
import { PricingStrategyCard, ProfitTargetsCard, RedTierCard } from '../shared/FeeRuleCards';
import type { FeeRule, StapleScenario } from '../../domain/types';

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
  money: (value: unknown) => string;
  stapleScenarioName: (scenario: StapleScenario) => string;
  deepClone: <T>(value: T) => T;
  onSaveFee: (fee: FeeRule) => Promise<unknown> | unknown;
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

export function PlatformPage(props: Partial<PlatformPageProps> = {}) {
  const fee = props.fee as FeeRule;
  const money = props.money || formatMoney;
  const onSaveFee = props.onSaveFee as (fee: FeeRule) => Promise<unknown> | unknown;
  const [draft, setDraft] = useState<FeeRule | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isEditing = draft !== null;
  const pageFee = draft || fee;

  useEffect(() => {
    setDraft(null);
  }, [fee]);

  const startEdit = () => {
    setDraft(deepClone(fee));
  };

  const cancelEdit = () => {
    setDraft(null);
  };

  const updateDraft = (mutator: (value: FeeRule) => void) => {
    setDraft(prev => {
      const next = deepClone(prev || fee);
      mutator(next);
      return next;
    });
  };

  const saveEdit = async () => {
    if (!draft) return;
    setIsSaving(true);
    try {
      await onSaveFee(deepClone(draft));
      setDraft(null);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="section-stack">
      <Card
        title="平台费用规则"
        extra={isEditing ? (
          <Space>
            <Button onClick={cancelEdit}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={isSaving} onClick={saveEdit}>保存平台规则</Button>
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
                  <InputNumber precision={2} value={Number(pageFee[field])} onChange={value => updateDraft(next => { (next as unknown as Record<PlatformFeeField, number>)[field] = Number(value) || 0; })} />
                ) : (
                  <div className="field-value">{money(pageFee[field])}</div>
                )}
              </div>
            </Col>
          ))}
        </Row>
      </Card>
      <ProfitTargetsCard
        title="平台通用利润率阶梯"
        rows={pageFee.profitTargets}
        disabled={!isEditing}
        money={money}
        onChange={rows => updateDraft(next => { next.profitTargets = rows; })}
        onAdd={() => updateDraft(next => { next.profitTargets.push({ enabled: true, payMin: 0, payMax: 20, rateMin: 20, rateMax: 30 }); })}
      />
      <PricingStrategyCard
        title="平台通用定价策略阶梯"
        strategy={pageFee.pricingStrategy}
        disabled={!isEditing}
        scenarios={STAPLE_SCENARIOS}
        money={money}
        stapleScenarioName={stapleScenarioName}
        onChange={strategy => updateDraft(next => { next.pricingStrategy = strategy; })}
      />
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <RedTierCard title="美团基础神券" rows={pageFee.redTiers.meituan} disabled={!isEditing} money={money} onChange={rows => updateDraft(next => { next.redTiers.meituan = rows; })} />
        </Col>
        <Col xs={24} lg={12}>
          <RedTierCard title="饿了么基础爆红包" rows={pageFee.redTiers.eleme} disabled={!isEditing} money={money} onChange={rows => updateDraft(next => { next.redTiers.eleme = rows; })} />
        </Col>
      </Row>
    </div>
  );
}
