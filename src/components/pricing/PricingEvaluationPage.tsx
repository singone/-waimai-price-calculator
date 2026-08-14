'use client';

import React from 'react';
import { Button, Card, Col, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType, TableProps } from 'antd';
import { stapleScenarioName } from '../../domain/core';
import type {
  FeeRule,
  Platform,
  PricingEvaluationResult,
  PricingEvaluationRule,
  PricingEvaluationSettings,
  PricingProductRow,
  PricingStrategyTier,
  Severity,
  StapleScenario,
  Summary
} from '../../domain/types';

const { Text, Title } = Typography;

const STAPLE_SCENARIOS: StapleScenario[] = ['single', 'double', 'multi'];
const SHOW_LG: Array<'lg'> = ['lg'];
const SHOW_XL: Array<'xl'> = ['xl'];
const DEFAULT_PRICING_EVALUATION_SETTINGS: PricingEvaluationSettings = {
  productNameKeyword: '',
  originalMin: 0,
  originalMax: '',
  payMin: 0,
  payMax: '',
  redAddOnSpace: 0,
  lowPayMax: 25,
  fixedCostAllocation: 0
};

type PricingPlatformFilter = Platform | 'all';

type PricingEvaluationPageProps = {
  pricingEvaluation: PricingEvaluationResult | null;
  isLoading: boolean;
  fallbackSummary: Summary;
  pricingRule: PricingEvaluationRule;
  pricingStrategy: FeeRule['pricingStrategy'];
  money: (value: unknown) => string;
  rateText: (rate: number | null | undefined) => string;
  severityLabel: (severity: Severity) => string;
  severityColor: (severity: Severity) => string;
  severityRank: (severity: Severity) => number;
  tablePagination: (defaultPageSize: number) => TableProps<PricingProductRow>['pagination'];
  onRunPricingEvaluation: (settings: PricingEvaluationSettings, platformFilter: PricingPlatformFilter) => void;
  onApplySuggestedPrice: (row: Pick<PricingProductRow, 'suggestedPrice' | 'productId' | 'platform' | 'platformName'>) => void;
};

function pricingSettingNumber(value: number | null) {
  return Number(value) || 0;
}

function filterPricingIssues(rows: PricingProductRow[], keyword: string, severityLabel: (severity: Severity) => string) {
  const normalizedKeyword = keyword.trim().toLowerCase();
  if (!normalizedKeyword) return rows;
  return rows.filter(issue => [
    severityLabel(issue.severity),
    issue.platformName,
    issue.productName,
    issue.categoryName,
    issue.scenarioName,
    issue.currentPrice,
    issue.packageFee,
    issue.currentOriginalPrice,
    issue.productCost,
    issue.fixedCostAllocation,
    issue.baseCost,
    issue.targetProfitRate,
    issue.currentProfitRate,
    issue.profitSpace,
    issue.suggestedPrice,
    issue.suggestedOriginalPrice,
    issue.suggestedIncrease,
    issue.reasons.join(' ')
  ].join(' ').toLowerCase().includes(normalizedKeyword));
}

function enabledPricingStrategyCount(strategy: Record<StapleScenario, PricingStrategyTier[]>, scenario: StapleScenario) {
  return (strategy[scenario] || []).filter(row => row.enabled).length;
}

export function PricingEvaluationPage({
  pricingEvaluation,
  isLoading,
  fallbackSummary,
  pricingRule,
  pricingStrategy,
  money,
  rateText,
  severityLabel,
  severityColor,
  severityRank,
  tablePagination,
  onRunPricingEvaluation,
  onApplySuggestedPrice
}: PricingEvaluationPageProps) {
  const [platformFilter, setPlatformFilter] = React.useState<PricingPlatformFilter>('all');
  const [pricingSettings, setPricingSettings] = React.useState<PricingEvaluationSettings>(DEFAULT_PRICING_EVALUATION_SETTINGS);
  const [pricingResultSearchText, setPricingResultSearchText] = React.useState('');
  const [selectedPricingProductKey, setSelectedPricingProductKey] = React.useState('');
  const pricingSummary = pricingEvaluation?.summary || (isLoading ? fallbackSummary : { resultCount: 0, comboCount: 0, validComboCount: 0, elapsedTime: null });
  const pricingIssues = pricingEvaluation?.productRows || [];
  const visiblePricingIssues = React.useMemo(
    () => filterPricingIssues(pricingIssues, pricingResultSearchText, severityLabel),
    [pricingIssues, pricingResultSearchText, severityLabel]
  );
  const abnormalPricingIssueCount = React.useMemo(
    () => pricingIssues.filter(issue => issue.severity !== 'none').length,
    [pricingIssues]
  );
  const selectedPricingIssue = React.useMemo(
    () => pricingIssues.find(issue => issue.key === selectedPricingProductKey),
    [pricingIssues, selectedPricingProductKey]
  );

  const updateSettings = (patch: Partial<PricingEvaluationSettings>) => {
    setPricingSettings(prev => ({ ...prev, ...patch }));
  };

  const pricingProductColumns = React.useMemo<TableColumnsType<PricingProductRow>>(() => [
    { title: '等级', dataIndex: 'severity', width: 80, fixed: 'left', render: value => <Tag color={severityColor(value as Severity)}>{severityLabel(value as Severity)}</Tag>, sorter: (a, b) => severityRank(a.severity) - severityRank(b.severity), defaultSortOrder: 'descend' },
    { title: '平台', dataIndex: 'platformName', width: 80, fixed: 'left', sorter: (a, b) => a.platformName.localeCompare(b.platformName, 'zh-CN') },
    { title: '商品', dataIndex: 'productName', width: 220, fixed: 'left', render: (_, row) => <Button className="table-link-wrap" type="link" title={row.productName} onClick={() => setSelectedPricingProductKey(row.key)}>{row.productName}</Button>, sorter: (a, b) => a.productName.localeCompare(b.productName, 'zh-CN') },
    { title: '分类', dataIndex: 'categoryName', width: 95, render: value => <Tag>{String(value || '-')}</Tag> },
    { title: '场景', dataIndex: 'scenarioName', width: 80, render: value => <Tag color="blue">{String(value || '-')}</Tag> },
    { title: '当前售价', dataIndex: 'currentPrice', width: 105, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentPrice - b.currentPrice },
    { title: '打包费', dataIndex: 'packageFee', width: 90, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.packageFee - b.packageFee },
    { title: '销售价合计', dataIndex: 'currentOriginalPrice', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.currentOriginalPrice - b.currentOriginalPrice },
    { title: '商品成本', dataIndex: 'productCost', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.productCost - b.productCost },
    { title: '固定成本分摊', dataIndex: 'fixedCostAllocation', width: 125, responsive: SHOW_LG, render: value => `¥${money(value)}`, sorter: (a, b) => a.fixedCostAllocation - b.fixedCostAllocation },
    { title: '基础成本', dataIndex: 'baseCost', width: 100, render: value => `¥${money(value)}`, sorter: (a, b) => a.baseCost - b.baseCost },
    { title: '目标利润率', dataIndex: 'targetProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => a.targetProfitRate - b.targetProfitRate },
    { title: '当前利润率', dataIndex: 'currentProfitRate', width: 110, render: value => rateText(value as number | null), sorter: (a, b) => (a.currentProfitRate || 0) - (b.currentProfitRate || 0) },
    { title: '利润空间', dataIndex: 'profitSpace', width: 105, render: value => <Text type={Number(value) < 0 ? 'danger' : 'success'}>¥{money(value)}</Text>, sorter: (a, b) => a.profitSpace - b.profitSpace },
    { title: '目标销售价', dataIndex: 'suggestedOriginalPrice', width: 115, render: value => `¥${money(value)}`, sorter: (a, b) => a.suggestedOriginalPrice - b.suggestedOriginalPrice },
    { title: '建议平台价', dataIndex: 'suggestedPrice', width: 110, render: value => `¥${money(value)}`, sorter: (a, b) => a.suggestedPrice - b.suggestedPrice },
    { title: '建议调价', dataIndex: 'suggestedIncrease', width: 125, render: (_, row) => row.suggestedIncrease === 0 ? '-' : <Text type={row.suggestedIncrease > 0 ? 'danger' : 'success'}>{row.suggestedIncrease > 0 ? '+' : ''}¥{money(row.suggestedIncrease)} / {rateText(row.suggestedIncreaseRate)}</Text>, sorter: (a, b) => a.suggestedIncrease - b.suggestedIncrease },
    { title: '诊断', dataIndex: 'reasons', width: 260, responsive: SHOW_XL, render: (reasons: string[]) => reasons.join('，') },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space>
          <Button size="small" onClick={() => setSelectedPricingProductKey(row.key)}>查看</Button>
          <Button size="small" disabled={Math.abs(row.suggestedIncrease) < 0.01} onClick={() => onApplySuggestedPrice(row)}>应用建议价</Button>
        </Space>
      )
    }
  ], [money, onApplySuggestedPrice, rateText, severityColor, severityLabel, severityRank]);

  return (
    <div className="section-stack">
      <Card title="定价评估" extra={
        <Space wrap>
          <Select value={platformFilter} onChange={setPlatformFilter} options={[{ value: 'all', label: '全部平台' }, { value: 'meituan', label: '只看美团' }, { value: 'eleme', label: '只看饿了么' }]} />
          <Button type="primary" loading={isLoading} onClick={() => onRunPricingEvaluation(pricingSettings, platformFilter)}>生成定价评估</Button>
        </Space>
      }>
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">基于商品成本、主食/套餐固定成本分摊和分类目标利润率评估销售价。单点不送商品不分摊固定成本，只按商品成本和目标利润率计算；活动影响由活动设计和测算结果页校验。</Text>
          <Card size="small" title="定价评估参数">
            <Row gutter={[12, 12]}>
              <Col xs={24} md={8}>
                <div className="field">
                  <Text type="secondary">商品名称筛选</Text>
                  <Input allowClear placeholder="空=全部商品，支持模糊匹配" value={pricingSettings.productNameKeyword} onChange={event => updateSettings({ productNameKeyword: event.target.value })} />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">原价小计最低</Text>
                  <InputNumber min={0} precision={2} value={pricingSettings.originalMin} onChange={value => updateSettings({ originalMin: pricingSettingNumber(value) })} />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">原价小计最高</Text>
                  <InputNumber min={0} precision={2} placeholder="空=不限" value={pricingSettings.originalMax === '' ? null : pricingSettings.originalMax} onChange={value => updateSettings({ originalMax: value === null ? '' : pricingSettingNumber(value) })} />
                </div>
              </Col>
              <Col xs={12} md={4}>
                <div className="field">
                  <Text type="secondary">主食/套餐固定成本分摊</Text>
                  <InputNumber min={0} precision={2} value={pricingSettings.fixedCostAllocation ?? 0} onChange={value => updateSettings({ fixedCostAllocation: pricingSettingNumber(value) })} />
                </div>
              </Col>
              <Col xs={24}>
                <Space wrap>
                  <Text type="secondary">分类目标利润率</Text>
                  <Tag>普通 {money(pricingRule.fallbackTargetProfitRate)}%</Tag>
                  <Tag>加料 {money(pricingRule.addOnTargetProfitRate)}%</Tag>
                  <Tag>主食 {money(pricingRule.riceBallTargetProfitRate)}%</Tag>
                  <Tag>套餐 {money(pricingRule.setMealTargetProfitRate)}%</Tag>
                  <Text type="secondary">场景策略</Text>
                  {STAPLE_SCENARIOS.map(scenario => <Tag key={scenario}>{stapleScenarioName(scenario)} {enabledPricingStrategyCount(pricingStrategy, scenario)} 档</Tag>)}
                </Space>
              </Col>
            </Row>
          </Card>
          <Row gutter={[12, 12]}>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">商品诊断</Text><Title level={3}>{pricingSummary.resultCount}</Title></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">检查商品</Text><Title level={3}>{pricingSummary.comboCount}</Title></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">可用结果</Text><Title level={3}>{pricingSummary.validComboCount}</Title></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Text type="secondary">异常商品</Text><Title level={3}>{abnormalPricingIssueCount}</Title></Card></Col>
          </Row>
          {pricingEvaluation?.warnings.length ? <Card size="small">{pricingEvaluation.warnings.map(item => <Text key={item} type="warning">{item}</Text>)}</Card> : null}
          <Card size="small">
            <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
              <Input.Search
                allowClear
                placeholder="搜索商品、平台、类型、诊断或价格"
                style={{ width: 320, maxWidth: '100%' }}
                value={pricingResultSearchText}
                onChange={event => setPricingResultSearchText(event.target.value)}
              />
              <Text type="secondary">当前显示 {visiblePricingIssues.length} / {pricingIssues.length} 个结果</Text>
            </Space>
          </Card>
          <Table loading={isLoading} rowKey="key" size="small" columns={pricingProductColumns} dataSource={visiblePricingIssues} pagination={tablePagination(20)} scroll={{ x: 2240 }} tableLayout="fixed" />
        </Space>
      </Card>

      <Modal
        title={selectedPricingIssue ? `${selectedPricingIssue.platformName} / ${selectedPricingIssue.productName} 定价诊断` : '定价诊断'}
        open={Boolean(selectedPricingIssue)}
        width={960}
        className="cost-analysis-modal"
        style={{ top: 16, paddingBottom: 0 }}
        footer={null}
        onCancel={() => setSelectedPricingProductKey('')}
      >
        {selectedPricingIssue ? (
          <Space direction="vertical" style={{ width: '100%' }} size="middle">
            <Space wrap>
              <Tag color={severityColor(selectedPricingIssue.severity)}>{severityLabel(selectedPricingIssue.severity)}</Tag>
              <Text type="secondary">定价评估只看商品自身的基础成本和目标利润率，活动空间由后续页面继续校验。</Text>
            </Space>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前平台价</Text><Title level={4}>¥{money(selectedPricingIssue.currentPrice)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">含打包费价</Text><Title level={4}>¥{money(selectedPricingIssue.currentOriginalPrice)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">商品成本</Text><Title level={4}>¥{money(selectedPricingIssue.productCost)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">固定成本分摊</Text><Title level={4}>¥{money(selectedPricingIssue.fixedCostAllocation)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">目标利润率</Text><Title level={4}>{rateText(selectedPricingIssue.targetProfitRate)}</Title></Card></Col>
              <Col xs={12} md={4}><Card size="small"><Text type="secondary">当前利润率</Text><Title level={4}>{rateText(selectedPricingIssue.currentProfitRate)}</Title></Card></Col>
            </Row>
            <Card size="small" title="建议">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Text>{selectedPricingIssue.reasons.join('，')}</Text>
                <Text type="secondary">目标销售价 = (商品成本 + 适用固定成本分摊) / (1 - 目标利润率)，并按 x.9 尾价向上取整；单点不送商品的适用固定成本分摊为 0。</Text>
              </Space>
            </Card>
            <Row gutter={[12, 12]}>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">目标销售价</Text><Title level={4}>¥{money(selectedPricingIssue.suggestedOriginalPrice)}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">建议平台价</Text><Title level={4}>¥{money(selectedPricingIssue.suggestedPrice)}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">建议调价</Text><Title level={4}>{selectedPricingIssue.suggestedIncrease > 0 ? '+' : ''}¥{money(selectedPricingIssue.suggestedIncrease)}</Title></Card></Col>
              <Col xs={12} md={6}><Card size="small"><Text type="secondary">利润空间</Text><Title level={4}>¥{money(selectedPricingIssue.profitSpace)}</Title></Card></Col>
            </Row>
          </Space>
        ) : null}
      </Modal>
    </div>
  );
}
