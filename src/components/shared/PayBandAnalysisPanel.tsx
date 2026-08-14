'use client';

import dynamic from 'next/dynamic';
import { Button, Card, Col, Row, Select, Space, Table, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { PriceBandRow } from '../../domain/types';
import { roundMoney } from '../../domain/money';

const AntvLine = dynamic(() => import('@ant-design/charts').then(mod => mod.Line), { ssr: false });
const AntvDualAxes = dynamic(() => import('@ant-design/charts').then(mod => mod.DualAxes), { ssr: false });
const { Text } = Typography;

type PayBandAnalysisPanelProps = {
  title: string;
  chartTitle: string;
  platformName: string;
  payBands: PriceBandRow[];
  selectedPayBandKey: string;
  rowCount: number;
  riskCount: number;
  loading: boolean;
  columns: TableColumnsType<PriceBandRow>;
  money: (value: unknown) => string;
  pagination: ReturnType<(defaultPageSize: number) => object>;
  onSelectPayBand: (key: string) => void;
};

function PriceBandVolumeProfitChart({
  rows,
  title,
  money
}: {
  rows: PriceBandRow[];
  title: string;
  money: (value: unknown) => string;
}) {
  const data = rows.slice(0, 24).map(row => ({
    key: row.key,
    label: row.label,
    comboCount: row.comboCount,
    avgProfitRate: row.avgProfitRate === null ? null : roundMoney(row.avgProfitRate * 100),
    riskCount: row.riskCount,
    platformName: row.platformName
  }));
  if (!data.length) return <div className="chart-empty">暂无{title}区间数据</div>;
  return (
    <div className="chart-frame">
      <AntvDualAxes
        data={data}
        height={280}
        autoFit
        xField="label"
        axis={{
          x: { title, labelAutoRotate: false },
          y: { title: '组合数', labelFormatter: (value: number | string) => `${Math.round(Number(value))}` }
        }}
        scale={{
          y: { independent: true, nice: true },
          color: { range: ['#5b7c99', '#b85f32'] }
        }}
        children={[
          {
            type: 'interval',
            yField: 'comboCount',
            style: {
              fill: '#5b7c99',
              radiusTopLeft: 4,
              radiusTopRight: 4
            }
          },
          {
            type: 'line',
            yField: 'avgProfitRate',
            shapeField: 'smooth',
            axis: {
              y: {
                position: 'right',
                title: '平均利润率',
                labelFormatter: (value: number | string) => `${Number(value).toFixed(0)}%`
              }
            },
            style: {
              stroke: '#b85f32',
              lineWidth: 2.4
            },
            point: {
              sizeField: 4,
              style: {
                fill: (datum: { riskCount?: number }) => (datum.riskCount || 0) > 0 ? '#d4380d' : '#b85f32',
                stroke: '#fff',
                lineWidth: 1
              }
            }
          }
        ]}
        tooltip={{
          title: (datum: { platformName?: string; label?: string }) => `${datum.platformName || ''} ${datum.label || ''}`.trim(),
          items: [
            { field: 'comboCount', name: '组合数' },
            { field: 'avgProfitRate', name: '平均利润率', valueFormatter: (value: number) => Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)}%` : '-' },
            { field: 'riskCount', name: '异常数' }
          ]
        }}
      />
    </div>
  );
}

function PriceBandMoneyTrendChart({ rows, money }: { rows: PriceBandRow[]; money: (value: unknown) => string }) {
  const data = rows.slice(0, 24).flatMap(row => [
    { key: `${row.key}-avg-profit`, label: row.label, metric: '平均利润', amount: roundMoney(row.avgProfit) },
    { key: `${row.key}-min-profit`, label: row.label, metric: '最低利润', amount: roundMoney(row.minProfit ?? 0) },
    { key: `${row.key}-max-profit`, label: row.label, metric: '最高利润', amount: roundMoney(row.maxProfit ?? 0) }
  ]);
  if (!data.length) return <div className="chart-empty">暂无价格趋势数据</div>;
  return (
    <div className="chart-frame">
      <AntvLine
        data={data}
        height={280}
        autoFit
        xField="label"
        yField="amount"
        colorField="metric"
        shapeField="smooth"
        axis={{
          x: { title: '支付价区间', labelAutoRotate: false },
          y: { title: '金额', labelFormatter: (value: number | string) => `¥${money(value)}` }
        }}
        scale={{
          y: { nice: true },
          color: { range: ['#496f5d', '#a66a3f', '#6d6aa8'] }
        }}
        style={{
          lineWidth: 2.2
        }}
        point={{
          sizeField: 3.5,
          style: {
            stroke: '#fff',
            lineWidth: 1
          }
        }}
        tooltip={{
          title: (datum: { label?: string }) => datum.label || '',
          items: [
            { field: 'metric', name: '指标' },
            { field: 'amount', name: '金额', valueFormatter: (value: number) => `¥${money(value)}` }
          ]
        }}
      />
    </div>
  );
}

export function PayBandAnalysisPanel({
  title,
  chartTitle,
  platformName,
  payBands,
  selectedPayBandKey,
  rowCount,
  riskCount,
  loading,
  columns,
  money,
  pagination,
  onSelectPayBand
}: PayBandAnalysisPanelProps) {
  const effectiveSelectedKey = payBands.some(row => row.key === selectedPayBandKey) ? selectedPayBandKey : 'all';
  return (
    <Card title={title}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap>
          <Text type="secondary">查看区间</Text>
          <Select
            style={{ width: 260 }}
            value={effectiveSelectedKey}
            onChange={onSelectPayBand}
            options={[
              { value: 'all', label: '全部支付价区间' },
              ...payBands.map(row => ({
                value: row.key,
                label: `${row.platformName}${row.scenarioName === '全部组合' ? '' : ` / ${row.scenarioName}`} / ¥${row.label}`
              }))
            ]}
          />
          <Button onClick={() => onSelectPayBand('all')}>查看全部组合</Button>
          <Text type="secondary">{platformName} 当前 {rowCount} 条，风险 {riskCount} 条</Text>
        </Space>
        <Row gutter={[12, 12]}>
          <Col xs={24} lg={12}><PriceBandVolumeProfitChart rows={payBands} title={chartTitle} money={money} /></Col>
          <Col xs={24} lg={12}><PriceBandMoneyTrendChart rows={payBands} money={money} /></Col>
        </Row>
        <Table
          loading={loading}
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={payBands}
          pagination={pagination}
          scroll={{ x: 1760 }}
          tableLayout="fixed"
          rowClassName={row => row.key === effectiveSelectedKey ? 'risk-config' : ''}
          onRow={row => ({
            onClick: () => onSelectPayBand(row.key)
          })}
        />
      </Space>
    </Card>
  );
}
