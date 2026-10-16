'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Card, Input, Select, Space, Table, Tag, Typography } from 'antd';
import { APP_ROUTES, pathForPage } from '../../app/routes';
import { FOLLOW_UP_TASKS, GUIDE_UPDATED_AT, PAGE_GUIDES, PLATFORM_GAPS } from '../../data/siteGuide';
import { downloadCsv } from '../../utils/csv';

const groups = [...new Set(Object.values(PAGE_GUIDES).map(item => item.group))];

export function SiteGuidePage() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('全部');
  const [priority, setPriority] = useState('全部');
  const pages = APP_ROUTES.map(route => ({ ...route, ...PAGE_GUIDES[route.key] })).filter(page =>
    (group === '全部' || page.group === group)
    && `${page.label} ${page.purpose} ${page.input} ${page.output} ${page.boundary}`.toLowerCase().includes(query.trim().toLowerCase())
  );
  const tasks = FOLLOW_UP_TASKS.filter(task => priority === '全部' || task.priority === priority);

  return <div className="section-stack">
    <Card title="网站地图与功能说明" extra={<Tag>整理于 {GUIDE_UPDATED_AT}</Tag>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Paragraph>网站用于按门店配置价格和活动、测算利润、导入经营数据复盘。功能清单根据当前代码整理；平台后台差异依据既有核查记录与公开资料标注，尚未取得的规则保留待核实。</Typography.Paragraph>
        <Alert type="info" showIcon title="工具后台模式用于保存本网站数据，商家后台是各外卖平台的经营系统" description="后台核对通过导出文件或粘贴表格完成。同步只更新本网站配置，活动建议需要在平台后台另行录入并确认生效。" />
        <Space wrap>
          <Input.Search aria-label="搜索网站功能" placeholder="搜索功能，例如：成本、红包、结算" value={query} onChange={event => setQuery(event.target.value)} allowClear style={{ width: 300, maxWidth: '100%' }} />
          <Select aria-label="功能分组" value={group} onChange={setGroup} options={['全部', ...groups].map(value => ({ value, label: value }))} style={{ width: 160 }} />
          <Typography.Text role="status">共 {pages.length} / {APP_ROUTES.length} 个页面</Typography.Text>
        </Space>
        <Table rowKey="key" size="small" dataSource={pages} pagination={false} scroll={{ x: 1100 }} columns={[
          { title: '分组', dataIndex: 'group', width: 120 },
          { title: '页面 / 路径', width: 190, render: (_, row) => <Space orientation="vertical"><Link href={row.path}>{row.label} →</Link><Typography.Text type="secondary">{row.path}</Typography.Text></Space> },
          { title: '用途', dataIndex: 'purpose', width: 230 },
          { title: '输入', dataIndex: 'input', width: 240 },
          { title: '输出', dataIndex: 'output', width: 240 },
          { title: '使用边界', dataIndex: 'boundary', width: 280 }
        ]} />
      </Space>
    </Card>
    <Card title="推荐使用流程">
      <ol>
        <li><Link href="/">维护门店</Link> → <Link href="/products">商品与成本</Link> → <Link href="/platform">通用规则</Link>，先建立可用配置。</li>
        <li><Link href="/backend-sync">后台核对</Link> → <Link href="/meituan">美团</Link> / <Link href="/eleme">淘宝闪购</Link> / <Link href="/jingdong">京东</Link>，分别确认当前门店费用和优惠。</li>
        <li><Link href="/system-strategy">系统策略</Link> → <Link href="/activity-design">活动设计</Link> → <Link href="/pricing">定价评估</Link> → <Link href="/results">测算与风险</Link>，修改费用或商品后重新计算。</li>
        <li>在平台后台录入已选方案并确认生效，再用<Link href="/order-analysis">订单分析</Link>、<Link href="/data-analysis">经营数据分析</Link>与<Link href="/product-analysis">商品分析</Link>复盘。</li>
      </ol>
      <Typography.Text type="secondary">本地模式保存到当前浏览器，后台模式登录后保存到工具服务器；跨设备使用前请确认保存模式。平台动态页用于发现待复核变化。</Typography.Text>
    </Card>
    <Card title="与各平台商家后台的差异">
      <Table rowKey="area" size="small" dataSource={PLATFORM_GAPS} pagination={false} scroll={{ x: 1500 }} columns={[
        { title: '范围', dataIndex: 'area', width: 130 },
        { title: '美团证据 / 待核实', dataIndex: 'meituan', width: 240 },
        { title: '淘宝闪购 / 饿了么证据 / 待核实', dataIndex: 'eleme', width: 280 },
        { title: '京东证据 / 待核实', dataIndex: 'jingdong', width: 240 },
        { title: '网站已有能力', dataIndex: 'current', width: 260 },
        { title: '差异与缺口', dataIndex: 'gap', width: 280 },
        { title: '关联任务', dataIndex: 'task', width: 120 }
      ]} />
      <Typography.Paragraph style={{ marginTop: 16 }}>资料：<a href="https://www.meituan.com/zh-HK/news/NN241225051008799" target="_blank" rel="noopener noreferrer">美团官方费用说明（2024-12-25，2026-10-12 复核）</a>；淘宝闪购与京东采用项目 2026-10-10 核查留存。公开费率和历史活动不能替代当前门店合同。本次未重新登录各平台后台。</Typography.Paragraph>
    </Card>
    <Card title="后续更改任务" extra={<Button onClick={() => downloadCsv(`网站后续任务-${GUIDE_UPDATED_AT}.csv`, tasks.map(task => ({ 编号: task.id, 优先级: task.priority, 状态: task.status, 任务: task.title, 范围: task.scope, 前置条件: task.dependency, 验收标准: task.acceptance, 入口: pathForPage(task.page) })))}>导出当前任务 CSV</Button>}>
      <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
        <Typography.Text>P0 先保证测算口径可验证；P1 补齐规则与数据可靠性；P2 完善执行复盘。以下为确定的开发顺序与验收要求，尚未实施，也未指定完成日期。</Typography.Text>
        <Select aria-label="任务优先级" value={priority} onChange={setPriority} options={['全部', 'P0', 'P1', 'P2'].map(value => ({ value, label: value }))} style={{ width: 140 }} />
        <Table rowKey="id" size="small" dataSource={tasks} pagination={false} scroll={{ x: 1200 }} columns={[
          { title: '编号 / 优先级', width: 140, render: (_, row) => <Space><span>{row.id}</span><Tag color={row.priority === 'P0' ? 'red' : row.priority === 'P1' ? 'orange' : 'blue'}>{row.priority}</Tag></Space> },
          { title: '任务 / 状态', width: 220, render: (_, row) => <Space orientation="vertical"><Link href={pathForPage(row.page)}>{row.title} →</Link><Tag>{row.status}</Tag></Space> },
          { title: '实施范围', dataIndex: 'scope', width: 280 },
          { title: '前置条件', dataIndex: 'dependency', width: 230 },
          { title: '验收标准', dataIndex: 'acceptance', width: 350 }
        ]} />
      </Space>
    </Card>
  </div>;
}
