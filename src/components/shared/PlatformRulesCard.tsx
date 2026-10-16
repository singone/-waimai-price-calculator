'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Col, InputNumber, Row, Space, Typography } from 'antd';
import { currentStoreFrom, deepClone, effectiveFeeRule, PLATFORM_NAMES } from '../../domain/core';
import type { FeeRule, Platform } from '../../domain/types';
import { useCalculatorContext } from './CalculatorContext';
import { useCalculatorStateCommit } from './useCalculatorStateCommit';
import { PLATFORM_FEE_FIELDS as FIELDS } from '../../domain/platformFeeFields';

const RULE_NOTES: Record<Platform, { confirmed: string; pending: string; url: string; source: string }> = {
  meituan: {
    confirmed: '技术服务费（佣金）与履约服务费分开计算。履约费用受订单金额、距离和时段影响。弘金后台另有折扣规则与起送价提醒，但计算口径全文尚未核实。',
    pending: '两店各自的佣金计费基数、保底金额、配送阶梯、时段附加费；折扣商品与满减、神券的同享及起送门槛口径。工具中的既有数值不是全国统一费率。',
    url: 'https://www.meituan.com/zh-HK/news/NN241225051008799', source: '美团官方费用说明'
  },
  eleme: {
    confirmed: '弘金（钱江世纪城店）减配活动：每单减 4.7 元，平台承担 1.5 元、商家承担 3.2 元；每天全天，与其他活动同享，2026-10-09 至 2027-10-03，不自动延期。仅此门店此活动已确认。',
    pending: '两店佣金、计费基数、履约收费；具体红包、满减和商品折扣的叠加顺序。井弘店减配金额尚未核实。平台承担的 1.5 元不能再次作为商家活动成本扣除。',
    url: 'https://melody.shop.ele.me/', source: '淘宝闪购后台 → 平台消息 → 减配送费 → 查看详情 → 活动规则'
  },
  jingdong: {
    confirmed: '测算中将补贴券面额与商家承担、商家加码、平台承担分别记录，顾客实付与商家结算分别计算。当前未核实两店最新佣金合同，不能根据早期免佣宣传直接填 0。',
    pending: '各店免佣资格和到期时间、保底收费、履约收费、补贴券分摊、大小券同享及满减资格。即时零售规则须确认餐饮适用范围。',
    url: 'https://store.jddj.com/notify/index', source: '京东秒送商家后台（需登录核实费用及活动）'
  }
};

type FeeFields = typeof FIELDS[number][0];
type FeeDraft = Pick<FeeRule, FeeFields>;

export function PlatformRulesCard({ platform }: { platform: Platform }) {
  const { calculatorState, setCalculatorState, store } = useCalculatorContext();
  const commit = useCalculatorStateCommit(calculatorState, setCalculatorState);
  const [draft, setDraft] = useState<FeeDraft | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(null); }, [store.id, platform, store.platformFeeOverrides]);
  const rule = effectiveFeeRule(calculatorState, store, platform);
  const note = RULE_NOTES[platform];
  const override = store.platformFeeOverrides?.[platform];
  const startEdit = () => setDraft(Object.fromEntries(FIELDS.map(([key]) => [key, rule[key]])) as FeeDraft);
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const saved = await commit(state => {
        const target = currentStoreFrom(state);
        target.platformFeeOverrides = { ...target.platformFeeOverrides, [platform]: deepClone(draft) };
      }, `${PLATFORM_NAMES[platform]}费用参数已保存，仅用于当前门店测算。`);
      if (saved) setDraft(null);
    } finally { setSaving(false); }
  };
  return <Card title={`${PLATFORM_NAMES[platform]}规则与费用 · ${store.name}`} extra={draft
    ? <Space><Button onClick={() => setDraft(null)}>取消</Button><Button type="primary" loading={saving} onClick={save}>保存本店参数</Button></Space>
    : <Button onClick={startEdit}>编辑本店平台费用</Button>}>
    <Space direction="vertical" style={{ width: '100%' }} size="middle">
      <Typography.Link href="/backend-sync">导入或粘贴后台数据，排查差异并同步本店规则 →</Typography.Link>
      {store.backendSyncHistory?.filter(record => record.platform === platform && !record.revertedAt).slice(-1).map(record => <Typography.Text type="secondary" key={record.id}>最近后台核对：{new Date(record.observedAt).toLocaleDateString('zh-CN')} · {record.source}。核对记录及同步后的变更请查看后台核对页。</Typography.Text>)}
      <Typography.Text>{note.confirmed}</Typography.Text>
      <Typography.Link href={note.url} target="_blank" rel="noreferrer">{note.source}</Typography.Link>
      <Alert type="warning" showIcon message="需商家后台确认" description={note.pending} />
      <Typography.Text type="secondary">{override ? '当前使用本店的平台费用参数；保存不代表平台规则已核实。' : '当前继承通用／门店费用参数，请按该平台合同核实后保存。'} 佣金暂按优惠后的商品及包装金额计算；若合同计费基数不同，本模型暂不适用。配送费采用 3 公里、20/25 元阶梯模型；其他收费方式须用实际订单校准。时段附加费留空沿用旧时段模型，填 0 表示本次无附加费。</Typography.Text>
      <Row gutter={[12, 12]}>{FIELDS.map(([key, label]) => <Col xs={24} sm={12} lg={8} key={key}>
        <div className="field"><Typography.Text type="secondary">{label}</Typography.Text>
          {draft ? <InputNumber min={0} max={key === 'commissionRate' ? 100 : undefined} precision={2} value={draft[key]} placeholder={key === 'timeFeeOverride' ? '沿用旧时段模型' : undefined} onChange={value => setDraft(previous => previous ? { ...previous, [key]: key === 'timeFeeOverride' && value === null ? undefined : Number(value) || 0 } : previous)} />
            : <div className="field-value">{rule[key] === undefined ? '沿用旧时段模型' : Number(rule[key]).toFixed(2)}</div>}
        </div>
      </Col>)}</Row>
      {platform === 'eleme' && <Typography.Text type="secondary">若当前门店确为弘金钱江世纪城店且使用上述活动，三个“商家减配成本”距离档可填 3.20 元（替代原减配参数，勿重复相加）；井弘店按自己的活动填写。活动结束后需重新核实参数。</Typography.Text>}
      <Typography.Text type="secondary">到手收入＝商品及包装金额－商家承担的商品优惠／满减／券－佣金－履约费－商家减配成本；利润再扣食材与包装成本。顾客配送费与平台补贴不能重复扣除，流量扶持不直接折算成收入。通用券与红包配置目前按商家承担金额及所设叠加数量测算，不能把平台承担的券面额录成商家成本。</Typography.Text>
    </Space>
  </Card>;
}
