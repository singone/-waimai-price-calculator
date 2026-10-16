'use client';

import React from 'react';
import { Alert, Button, Card, Checkbox, Col, Drawer, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CalculatorOutlined, EyeOutlined } from '@ant-design/icons';
import type { AppDataRepository } from '../../data/browserDataRepository';
import { currentStoreFrom, deepClone } from '../../data/calculatorState';
import type { ActivityDesignResult, ActivityDesignSettings, ActivityPriceBucketRow, ActivityScanComboPools, CalculatorState, Store } from '../../domain/types';
import {
  buildJingdongAnalysisRowsFromActivityBaseRows,
  runJingdongSubsidyAnalysis,
  type JingdongCouponScanMode,
  type JingdongSubsidyAnalysisResult,
  type JingdongSubsidyAnalysisRow,
  type JingdongSubsidyBucketRiskRow
} from '../../domain/jingdongSubsidyAnalysis';
import { money, rateText, severityColor } from '../../utils/format';
import { tablePagination } from '../../utils/table';
import { activityPriceScanRecordToResult, buildActivityPriceScanSignature, expandActivityOriginalBucketCombos } from '../activityDesign/activityDesignCalculationUtils';
import { buildActivityDesignCalculationSettings, normalizeActivityScanComboPools } from '../activityDesign/activityDesignPageUtils';

const { Text, Title } = Typography;
const BUCKET_DETAIL_ROW_LIMIT = 1000;

type JingdongSubsidyResultPanelProps = {
  calculatorState: CalculatorState;
  dataRepository: AppDataRepository<CalculatorState, Store>;
  store: Store;
  storeActivityDesignSettings: ActivityDesignSettings;
};

type JingdongRiskDisplayRow = Pick<JingdongSubsidyAnalysisRow, 'riskType' | 'severity'>;

function jingdongOriginalBuckets(result: ActivityDesignResult | null): ActivityPriceBucketRow[] {
  return (result?.originalPriceBuckets || [])
    .filter(bucket => bucket.platform === 'jingdong' && Math.max(0, Number(bucket.comboCount) || 0) > 0)
    .sort((a, b) => a.priceBucket - b.priceBucket || a.key.localeCompare(b.key, 'zh-CN'));
}

function riskText(row: JingdongRiskDisplayRow) {
  if (row.riskType === 'loss') return '亏损';
  if (row.riskType === 'lowProfit') return '低利润';
  return '正常';
}

function riskTag(row: JingdongRiskDisplayRow) {
  return <Tag color={severityColor(row.severity)}>{riskText(row)}</Tag>;
}

function couponText(coupon: JingdongSubsidyAnalysisRow['subsidySelection']['coupons'][number]) {
  const extraAmount = coupon.kind === 'large' ? Math.max(0, Number(coupon.merchantExtraAmount) || 0) : 0;
  const extraText = extraAmount > 0 ? `+加码${money(extraAmount)}` : '';
  const merchantText = extraAmount > 0 ? `商${money(coupon.merchantAmount)}+${money(extraAmount)}` : `商${money(coupon.merchantAmount)}`;
  return `满${money(coupon.threshold)}减${money(coupon.amount)}${extraText} / ${merchantText} 平${money(coupon.platformAmount)}`;
}

function summaryCards(result: JingdongSubsidyAnalysisResult | null, progress: JingdongSubsidyAnalysisResult['summary'] | null) {
  const summary = result?.summary || progress;
  const isBucketSummary = summary?.source === 'bucketSummary';
  return (
    <Row gutter={[12, 12]}>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">{isBucketSummary ? '桶券组合' : '券组合'}</Text><Title level={3}>{summary?.resultCount ?? 0}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">{isBucketSummary ? '亏损桶' : '亏损组合'}</Text><Title level={3}>{summary?.lossCount ?? 0}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">{isBucketSummary ? '低利润桶' : '低利润组合'}</Text><Title level={3}>{summary?.lowProfitCount ?? 0}</Title></Card></Col>
      <Col xs={12} md={6}><Card size="small"><Text type="secondary">最低利润</Text><Title level={3}>{summary?.worstProfit === null || summary?.worstProfit === undefined ? '-' : `¥${money(summary.worstProfit)}`}</Title></Card></Col>
    </Row>
  );
}

function priceChain(row: JingdongSubsidyAnalysisRow) {
  return (
    <div className="table-metric-stack">
      <span>原价 ¥{money(row.originalTotal)}</span>
      <span>折扣后 ¥{money(row.afterProductDiscount)}</span>
      <span>门店后 ¥{money(row.afterStoreDiscount)}</span>
      <span>实付 ¥{money(row.finalPay)}</span>
    </div>
  );
}

function bucketPriceChain(row: JingdongSubsidyBucketRiskRow) {
  return (
    <div className="table-metric-stack">
      <span>桶均原价 ¥{money(row.originalTotal)}</span>
      <span>满减 ¥{money(row.full.amount)}</span>
      <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
      <span>券前价 ¥{money(row.afterStoreDiscount)}</span>
      <span>实付 ¥{money(row.finalPay)}</span>
    </div>
  );
}

function merchantCost(row: Pick<JingdongSubsidyAnalysisRow, 'subsidySelection' | 'freightSubsidy' | 'merchantActivityAmount'>) {
  return (
    <div className="table-metric-stack">
      <span>券商家承担 ¥{money(row.subsidySelection.merchantAmount)}</span>
      {row.subsidySelection.merchantExtraAmount > 0 ? <span>其中加码 ¥{money(row.subsidySelection.merchantExtraAmount)}</span> : null}
      <span>运费减免 ¥{money(row.freightSubsidy)}</span>
      <span>商家活动合计 ¥{money(row.merchantActivityAmount)}</span>
    </div>
  );
}

function feeStack(row: Pick<JingdongSubsidyAnalysisRow, 'commission' | 'serviceFee' | 'merchantSettlement'>) {
  return (
    <div className="table-metric-stack">
      <span>佣金 ¥{money(row.commission)}</span>
      <span>配送服务 ¥{money(row.serviceFee)}</span>
      <span>商家结算 ¥{money(row.merchantSettlement)}</span>
    </div>
  );
}

function profitStack(row: JingdongSubsidyAnalysisRow) {
  return (
    <div className="table-metric-stack">
      <span>到手 ¥{money(row.netPay)}</span>
      <span>成本 ¥{money(row.cost)}</span>
      <span>利润 ¥{money(row.profit)}</span>
      <span>利润率 {rateText(row.profitRate)}</span>
    </div>
  );
}

function bucketProfitStack(row: JingdongSubsidyBucketRiskRow) {
  return (
    <div className="table-metric-stack">
      <span>平均成本 ¥{money(row.avgCost)} / 利润 ¥{money(row.avgProfit)}</span>
      <span>最高成本 ¥{money(row.maxCost)} / 最低利润 ¥{money(row.worstProfit)}</span>
      <span>最低利润率 {rateText(row.worstProfitRate)}</span>
      <span>最低利润空间 ¥{money(row.worstProfitSpace)}</span>
    </div>
  );
}

function subsidySelectionStack(row: Pick<JingdongSubsidyAnalysisRow, 'subsidySelection'>) {
  return (
    <Space direction="vertical" size={2}>
      <Text>{row.subsidySelection.name}</Text>
      <Text type="secondary">{row.subsidySelection.coupons.map(couponText).join('；')}</Text>
      {row.subsidySelection.isUserBest ? <Tag color="blue">用户最优</Tag> : null}
    </Space>
  );
}

function suggestionStack(row: JingdongSubsidyAnalysisRow) {
  return (
    <Space direction="vertical" size={2}>
      {row.avoidSuggestion ? <Text type="secondary">{row.avoidSuggestion.text}</Text> : null}
      {row.increaseSuggestion ? <Text>{row.increaseSuggestion.text}</Text> : null}
      {!row.avoidSuggestion && !row.increaseSuggestion ? <Text type="secondary">无需调价</Text> : null}
    </Space>
  );
}

function bucketReasonStack(row: JingdongSubsidyBucketRiskRow) {
  return (
    <Space direction="vertical" size={2}>
      {row.reasons.map(reason => <Text key={reason} type={row.severity === 'none' ? 'secondary' : undefined}>{reason}</Text>)}
    </Space>
  );
}

function bucketSuggestionStack(row: JingdongSubsidyBucketRiskRow) {
  return (
    <Space direction="vertical" size={2}>
      {row.avoidSuggestion ? <Text type="secondary">{row.avoidSuggestion.text}</Text> : null}
      {row.increaseSuggestion ? <Text>{row.increaseSuggestion.text}</Text> : null}
      {!row.avoidSuggestion && !row.increaseSuggestion ? <Text type="secondary">无需调价</Text> : null}
    </Space>
  );
}

export function JingdongSubsidyResultPanel({
  calculatorState,
  dataRepository,
  store,
  storeActivityDesignSettings
}: JingdongSubsidyResultPanelProps) {
  const [isRunning, setIsRunning] = React.useState(false);
  const [riskOnly, setRiskOnly] = React.useState(true);
  const [couponScanMode, setCouponScanMode] = React.useState<JingdongCouponScanMode>('settlement');
  const [analysis, setAnalysis] = React.useState<JingdongSubsidyAnalysisResult | null>(null);
  const [progressSummary, setProgressSummary] = React.useState<JingdongSubsidyAnalysisResult['summary'] | null>(null);
  const [activityScanResult, setActivityScanResult] = React.useState<ActivityDesignResult | null>(null);
  const [activityScanComboPools, setActivityScanComboPools] = React.useState<ActivityScanComboPools | null>(null);
  const [activityScanCacheText, setActivityScanCacheText] = React.useState('');
  const [isActivityScanCacheLoading, setIsActivityScanCacheLoading] = React.useState(false);
  const [bucketDetailOpen, setBucketDetailOpen] = React.useState(false);
  const [selectedBucketRisk, setSelectedBucketRisk] = React.useState<JingdongSubsidyBucketRiskRow | null>(null);
  const [bucketDetailRows, setBucketDetailRows] = React.useState<JingdongSubsidyAnalysisRow[]>([]);
  const [bucketDetailText, setBucketDetailText] = React.useState('');

  React.useEffect(() => {
    setAnalysis(null);
    setProgressSummary(null);
    setBucketDetailOpen(false);
    setSelectedBucketRisk(null);
    setBucketDetailRows([]);
    setBucketDetailText('');
  }, [store.id]);

  React.useEffect(() => {
    let ignore = false;
    setActivityScanResult(null);
    setActivityScanComboPools(null);
    setActivityScanCacheText('');
    setIsActivityScanCacheLoading(true);
    const scanSettings = buildActivityDesignCalculationSettings(store, storeActivityDesignSettings, { calculationMode: 'priceScan' });
    const expectedSignature = buildActivityPriceScanSignature(calculatorState, store, scanSettings);
    dataRepository.loadActivityPriceScanRecord(store.id)
      .then(record => {
        if (ignore) return;
        if (!record) {
          setActivityScanCacheText('未找到活动设计原价扫描缓存，京东券结果会临时现算商品组合。');
          return;
        }
        if (record.signature !== expectedSignature) {
          setActivityScanCacheText('活动设计原价扫描缓存已过期，请在活动设计页重新扫描后再复用京东组合。');
          return;
        }
        const scanResult = activityPriceScanRecordToResult(record);
        const jingdongBucketCount = jingdongOriginalBuckets(scanResult).length;
        const pools = normalizeActivityScanComboPools(record.scanComboPools);
        const mainCount = pools.mainComboCountByPlatform.jingdong ?? pools.mainCombos.filter(row => row.platform === 'jingdong').length;
        const addOnCount = pools.addOnComboCountByPlatform.jingdong ?? pools.addOnCombos.filter(row => row.platform === 'jingdong').length;
        if (!jingdongBucketCount && !mainCount) {
          setActivityScanCacheText('活动设计原价扫描缓存未包含京东原价桶，请在活动设计页重新扫描。');
          return;
        }
        setActivityScanResult(scanResult);
        if (mainCount) setActivityScanComboPools(pools);
        const detailText = mainCount ? `主组合 ${mainCount}，凑单组合 ${addOnCount}` : '缺少组合池，暂不能展开明细';
        setActivityScanCacheText(`已复用活动设计京东原价桶 ${jingdongBucketCount} 个；${detailText}`);
      })
      .catch(() => {
        if (!ignore) setActivityScanCacheText('活动设计原价扫描缓存读取失败，京东券结果会临时现算商品组合。');
      })
      .finally(() => {
        if (!ignore) setIsActivityScanCacheLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [calculatorState, dataRepository, store, storeActivityDesignSettings]);

  const activityBucketCount = React.useMemo(() => jingdongOriginalBuckets(activityScanResult).length, [activityScanResult]);
  const usingBucketSummary = Boolean(analysis?.bucketRows?.length);
  const displayRows = React.useMemo(() => {
    const rows = analysis?.rows || [];
    return riskOnly ? rows.filter(row => row.severity !== 'none') : rows;
  }, [analysis, riskOnly]);
  const displayBucketRows = React.useMemo(() => {
    const rows = analysis?.bucketRows || [];
    return riskOnly ? rows.filter(row => row.severity !== 'none') : rows;
  }, [analysis, riskOnly]);

  const runAnalysis = async () => {
    if (isRunning) return;
    const initialBucketCount = activityBucketCount;
    setIsRunning(true);
    setAnalysis(null);
    setProgressSummary({
      resultCount: 0,
      comboCount: 0,
      validComboCount: 0,
      lossCount: 0,
      lowProfitCount: 0,
      safeCount: 0,
      worstProfit: null,
      bucketCount: initialBucketCount,
      source: initialBucketCount ? 'bucketSummary' : 'comboDetail',
      elapsedTime: null
    });
    try {
      const analysisState = deepClone(calculatorState);
      const result = await runJingdongSubsidyAnalysis(analysisState, progress => {
        setProgressSummary(prev => ({
          resultCount: progress.resultCount,
          comboCount: progress.comboCount,
          validComboCount: progress.validComboCount,
          lossCount: prev?.lossCount ?? 0,
          lowProfitCount: prev?.lowProfitCount ?? 0,
          safeCount: prev?.safeCount ?? 0,
          worstProfit: prev?.worstProfit ?? null,
          bucketCount: prev?.bucketCount,
          bucketResultCount: prev?.bucketResultCount,
          displayedBucketResultCount: prev?.displayedBucketResultCount,
          source: prev?.source,
          elapsedTime: null
        }));
      }, {
        couponScanMode,
        scanComboPools: activityScanComboPools,
        originalPriceBuckets: activityScanResult?.originalPriceBuckets || null
      });
      setAnalysis(result);
      setProgressSummary(result.summary);
    } finally {
      setIsRunning(false);
    }
  };

  const openBucketDetail = (row: JingdongSubsidyBucketRiskRow) => {
    setSelectedBucketRisk(row);
    setBucketDetailOpen(true);
    setBucketDetailRows([]);
    const scanResult = activityScanResult;
    const bucket = jingdongOriginalBuckets(scanResult).find(item => item.key === row.bucketKey) || null;
    if (!scanResult || !bucket) {
      setBucketDetailText('未找到活动设计原价桶缓存，请先在活动设计页重新扫描。');
      return;
    }
    const scanPools = activityScanComboPools || normalizeActivityScanComboPools(scanResult.scanComboPools);
    const hasJingdongComboPool = scanPools.mainCombos.some(item => item.platform === 'jingdong')
      && scanPools.addOnCombos.some(item => item.platform === 'jingdong');
    if (!hasJingdongComboPool) {
      setBucketDetailText('活动设计缓存缺少京东组合池，当前只能查看汇总风险，请先在活动设计页重新扫描。');
      return;
    }
    const analysisState = deepClone(calculatorState);
    const analysisStore = currentStoreFrom(analysisState);
    const maxChecks = Math.max(1, Math.floor(Number(analysisStore.maxChecks) || BUCKET_DETAIL_ROW_LIMIT));
    const detailLimit = Math.min(BUCKET_DETAIL_ROW_LIMIT, maxChecks);
    const baseRows = expandActivityOriginalBucketCombos(
      scanResult,
      bucket,
      analysisState,
      analysisStore,
      storeActivityDesignSettings,
      { limit: detailLimit }
    );
    const detailRows = buildJingdongAnalysisRowsFromActivityBaseRows(analysisState, baseRows, row.subsidySelection, detailLimit);
    setBucketDetailRows(detailRows);
    const omittedCount = Math.max(0, Math.floor(Number(bucket.comboCount) || 0) - baseRows.length);
    setBucketDetailText(omittedCount > 0
      ? `已按当前京东配置复核 ${detailRows.length} 条；该桶组合较多，另有约 ${omittedCount} 条未展开。`
      : `已按当前京东配置复核 ${detailRows.length} 条组合明细。`
    );
  };

  const columns: TableColumnsType<JingdongSubsidyAnalysisRow> = [
    { title: '风险', dataIndex: 'riskType', width: 90, fixed: 'left', render: (_, row) => riskTag(row) },
    { title: '商品组合', dataIndex: 'comboText', width: 280, fixed: 'left', render: value => <Text className="table-text-wrap">{value}</Text> },
    { title: '补贴券组合', dataIndex: 'subsidySelection', width: 300, render: (_, row) => subsidySelectionStack(row) },
    { title: '价格链路', width: 180, render: (_, row) => priceChain(row) },
    {
      title: '门店活动',
      width: 190,
      render: (_, row) => (
        <div className="table-metric-stack">
          <span>商品折扣 ¥{money(row.productDiscount)}</span>
          <span>满减 ¥{money(row.full.amount)}</span>
          <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
        </div>
      )
    },
    { title: '商家承担', width: 210, render: (_, row) => merchantCost(row) },
    { title: '费用', width: 170, render: (_, row) => feeStack(row) },
    { title: '到手利润', width: 175, render: (_, row) => profitStack(row) },
    { title: '建议', width: 430, render: (_, row) => suggestionStack(row) }
  ];

  const bucketColumns: TableColumnsType<JingdongSubsidyBucketRiskRow> = [
    { title: '风险', dataIndex: 'riskType', width: 90, fixed: 'left', render: (_, row) => riskTag(row) },
    {
      title: '原价桶',
      dataIndex: 'label',
      width: 180,
      fixed: 'left',
      render: (_, row) => (
        <Space direction="vertical" size={2}>
          <Text>¥{row.label}</Text>
          <Text type="secondary">覆盖 {row.comboCount} 个组合</Text>
          {row.riskComboCount > 0 ? <Tag color="orange">活动设计已有风险 {row.riskComboCount}</Tag> : null}
        </Space>
      )
    },
    { title: '补贴券组合', dataIndex: 'subsidySelection', width: 300, render: (_, row) => subsidySelectionStack(row) },
    { title: '价格链路', width: 190, render: (_, row) => bucketPriceChain(row) },
    {
      title: '门店活动',
      width: 170,
      render: (_, row) => (
        <div className="table-metric-stack">
          <span>商品折扣 ¥{money(row.productDiscount)}</span>
          <span>满减 ¥{money(row.full.amount)}</span>
          <span>店铺券 ¥{money(row.storeCouponAmount)}</span>
        </div>
      )
    },
    { title: '商家承担', width: 210, render: (_, row) => merchantCost(row) },
    { title: '费用', width: 170, render: (_, row) => feeStack(row) },
    { title: '利润风险', width: 250, sorter: (a, b) => a.worstProfit - b.worstProfit, render: (_, row) => bucketProfitStack(row) },
    { title: '原因', width: 300, render: (_, row) => bucketReasonStack(row) },
    { title: '建议', width: 390, render: (_, row) => bucketSuggestionStack(row) },
    {
      title: '明细',
      width: 110,
      fixed: 'right',
      render: (_, row) => <Button size="small" icon={<EyeOutlined />} onClick={() => openBucketDetail(row)}>查看</Button>
    }
  ];

  return (
    <div className="section-stack">
      <Card
        title="京东补贴券风险测算"
        extra={(
          <Space wrap>
            <Button type="primary" icon={<CalculatorOutlined />} loading={isRunning} onClick={runAnalysis}>生成京东券结果</Button>
            <Select
              value={couponScanMode}
              style={{ width: 132 }}
              onChange={setCouponScanMode}
              options={[
                { value: 'settlement', label: '结算页最优' },
                { value: 'pressure', label: '全量压测' }
              ]}
            />
            <Checkbox checked={riskOnly} onChange={event => setRiskOnly(event.target.checked)}>只看风险</Checkbox>
          </Space>
        )}
      >
        <Space wrap>
          <Tag color="blue">当前门店：{store.name}</Tag>
          <Tag color={activityBucketCount ? 'green' : isActivityScanCacheLoading ? 'blue' : 'orange'}>
            {activityBucketCount ? '复用活动设计汇总' : isActivityScanCacheLoading ? '读取原价缓存' : '未复用原价缓存'}
          </Tag>
          <Tag>大额券 {store.activities.jingdong.jingdongSubsidyCoupons.filter(row => row.enabled && row.kind === 'large').length}</Tag>
          <Tag>小额券 {store.activities.jingdong.jingdongSubsidyCoupons.filter(row => row.enabled && row.kind === 'small').length}</Tag>
        </Space>
        {activityScanCacheText ? (
          <div style={{ marginTop: 8 }}>
            <Text type={activityBucketCount ? 'secondary' : 'warning'}>{activityScanCacheText}</Text>
          </div>
        ) : null}
      </Card>

      {summaryCards(analysis, progressSummary)}

      {(analysis?.warnings || []).map(warning => (
        <Alert key={warning} type="warning" showIcon message={warning} />
      ))}

      <Card
        title={usingBucketSummary ? '券组合风险汇总' : '券组合风险结果'}
        extra={analysis ? (
          <Text type="secondary">
            展示 {usingBucketSummary ? displayBucketRows.length : displayRows.length} / {analysis.summary.resultCount}
          </Text>
        ) : null}
      >
        {usingBucketSummary ? (
          <Table
            rowKey={row => row.key}
            size="small"
            columns={bucketColumns}
            dataSource={displayBucketRows}
            pagination={tablePagination(20)}
            scroll={{ x: 2180, y: 620 }}
            tableLayout="fixed"
            loading={isRunning}
          />
        ) : (
          <Table
            rowKey={row => row.key}
            size="small"
            columns={columns}
            dataSource={displayRows}
            pagination={tablePagination(20)}
            scroll={{ x: 2025, y: 620 }}
            tableLayout="fixed"
            loading={isRunning}
          />
        )}
      </Card>

      <Drawer
        title={selectedBucketRisk ? `原价桶 ¥${selectedBucketRisk.label} 组合明细` : '原价桶组合明细'}
        open={bucketDetailOpen}
        onClose={() => setBucketDetailOpen(false)}
        width="min(1180px, 96vw)"
      >
        <div className="section-stack">
          {selectedBucketRisk ? (
            <Card size="small">
              <Space wrap size={[8, 8]}>
                {riskTag(selectedBucketRisk)}
                <Tag color="blue">覆盖 {selectedBucketRisk.comboCount} 个组合</Tag>
                <Tag>券前价 ¥{money(selectedBucketRisk.afterStoreDiscount)}</Tag>
                <Tag>补贴 ¥{money(selectedBucketRisk.subsidySelection.amount)}</Tag>
                <Tag>商家承担 ¥{money(selectedBucketRisk.subsidySelection.merchantAmount)}</Tag>
              </Space>
              <div style={{ marginTop: 8 }}>
                <Text type="secondary">{bucketDetailText}</Text>
              </div>
            </Card>
          ) : null}
          <Table
            rowKey={row => row.key}
            size="small"
            columns={columns}
            dataSource={bucketDetailRows}
            pagination={tablePagination(20)}
            scroll={{ x: 2025, y: 560 }}
            tableLayout="fixed"
          />
        </div>
      </Drawer>
    </div>
  );
}
