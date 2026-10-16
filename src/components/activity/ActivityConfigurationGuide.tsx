'use client';

import { Alert, Card, Space, Typography } from 'antd';
import Link from 'next/link';
import type { Platform } from '../../domain/types';

const descriptions: Record<Platform, string> = {
  meituan: '分别维护门店满减、店内/定向/返券、神券加码与商品折扣。订单券金额填写商家承担；平台补贴券面额不能直接计入商家成本。',
  eleme: '分别维护门店满减、店内/定向/返券、爆红包加码与商品折扣。减配送费在本店平台费用中维护，不再作为满减或订单券重复扣除。',
  jingdong: '普通商家订单券与京东补贴券分开维护。补贴券分别填写基础券面额、基础商家承担、平台承担和最大可叠加码；基础商家与平台承担之和等于基础券面额，加码另计。小额券与大额券是否同享按后台填写。'
};

export function ActivityConfigurationGuide({ platform }: { platform: Platform }) {
  return <Card title="后台活动配置口径">
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text>{descriptions[platform]}</Typography.Text>
      <Typography.Text type="secondary">订单券之间的同享设置参与测算，留空沿用门店最多优惠券张数。发放渠道、人群和核对备注仅用于记录；测算假设所选券已领取且符合资格，下单返券不等于当前订单即时优惠。</Typography.Text>
      <Alert type="info" showIcon message="核对影响最低价与商家到手的规则" description="测算假设已领取所选优惠且符合资格，不预测平均成交价。人群、时段等条件可人工归纳为最大可用金额；重点确认商品范围、门槛、同享和出资分摊。仅当现有配置无法表达且会改变测算结果时，才需要调整功能。" />
      <Link href="/backend-sync">导入后台活动，查看差异与来源记录 →</Link>
    </Space>
  </Card>;
}
