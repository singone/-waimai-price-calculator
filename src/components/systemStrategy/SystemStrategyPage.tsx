'use client';

import React from 'react';
import { Button, Card, Col, Input, InputNumber, Row, Select, Space, Switch, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { EditOutlined, PlusOutlined, QuestionCircleOutlined, SaveOutlined } from '@ant-design/icons';
import { ActivityDiscountTierEditorModal, type ActivityDiscountTierBatchDraft, type ActivityDiscountTierEditorValue } from '../modals/ActivityDiscountTierEditorModal';
import { useEditableDraft } from '../shared/useEditableDraft';
import { roundMoney } from '../../domain/money';
import type {
  ActivityCouponRecommendationMode,
  ActivityCouponRecommendationPolicy,
  ActivityDesignObjective,
  ActivityObjectiveStrategy,
  ActivityObjectiveTemplate,
  ActivityOriginalDiscountTier,
  ActivityStrategySettings
} from '../../domain/types';

const { Text } = Typography;

type ActivityObjectiveOption = ActivityObjectiveTemplate & {
  value: ActivityDesignObjective;
  label: string;
};

type SystemStrategyRow = ActivityObjectiveOption & {
  strategy: ActivityObjectiveStrategy;
};

type SystemStrategyPageProps = {
  strategySettings: ActivityStrategySettings | undefined;
  defaultStrategySettings: ActivityStrategySettings;
  defaultTargetProfitRate: number;
  defaultObjectiveTemplate: ActivityObjectiveTemplate;
  fullAmountBasisOptions: Array<{ value: ActivityObjectiveStrategy['fullAmountBasis']; label: string }>;
  couponRecommendationModeOptions: Array<{ value: ActivityCouponRecommendationMode; label: string }>;
  money: (value: unknown) => string;
  formatActivityOriginalDiscountTiers: (tiers: ActivityOriginalDiscountTier[]) => string;
  defaultActivityCouponRecommendationPolicy: (mode: ActivityCouponRecommendationMode) => ActivityCouponRecommendationPolicy;
  normalizeActivityStrategySettings: (settings: Partial<ActivityStrategySettings> | undefined) => ActivityStrategySettings;
  normalizeActivityObjectiveTemplates: (templates: Partial<ActivityObjectiveTemplate>[] | undefined) => ActivityObjectiveTemplate[];
  normalizeActivityObjectiveTemplate: (template: Partial<ActivityObjectiveTemplate>, fallback: ActivityObjectiveTemplate) => ActivityObjectiveTemplate;
  activityObjectiveOptionFromTemplate: (template: ActivityObjectiveTemplate) => ActivityObjectiveOption;
  normalizeActivityObjectiveStrategies: (
    value: Partial<Record<ActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined,
    baseTargetProfitRate: number,
    objectiveOptions: ActivityObjectiveOption[]
  ) => Record<ActivityDesignObjective, ActivityObjectiveStrategy>;
  defaultActivityObjectiveStrategies: (
    baseTargetProfitRate?: number,
    objectiveOptions?: ActivityObjectiveOption[]
  ) => Record<ActivityDesignObjective, ActivityObjectiveStrategy>;
  deepClone: <T>(value: T) => T;
  uid: (prefix: string) => string;
  onBeforeEdit?: () => void;
  onSaveSettings: (settings: ActivityStrategySettings) => Promise<boolean>;
};

function optionText<T extends string>(options: Array<{ value: T; label: string }>, value: T) {
  return options.find(option => option.value === value)?.label || value;
}

function strategyTitle(title: string, help: string) {
  return (
    <Space size={4}>
      <span>{title}</span>
      <Tooltip title={help}>
        <QuestionCircleOutlined />
      </Tooltip>
    </Space>
  );
}

function renderEnabled(enabled: boolean) {
  return <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag>;
}

export function SystemStrategyPage({
  strategySettings,
  defaultStrategySettings,
  defaultTargetProfitRate,
  defaultObjectiveTemplate,
  fullAmountBasisOptions,
  couponRecommendationModeOptions,
  money,
  formatActivityOriginalDiscountTiers,
  defaultActivityCouponRecommendationPolicy,
  normalizeActivityStrategySettings,
  normalizeActivityObjectiveTemplates,
  normalizeActivityObjectiveTemplate,
  activityObjectiveOptionFromTemplate,
  normalizeActivityObjectiveStrategies,
  defaultActivityObjectiveStrategies,
  deepClone,
  uid,
  onBeforeEdit,
  onSaveSettings
}: SystemStrategyPageProps) {
  const [discountTierEditor, setDiscountTierEditor] = React.useState<(ActivityDiscountTierEditorValue & { objective: ActivityDesignObjective }) | null>(null);
  const [discountTierDraft, setDiscountTierDraft] = React.useState<ActivityOriginalDiscountTier[]>([]);
  const [discountTierBatchDraft, setDiscountTierBatchDraft] = React.useState<ActivityDiscountTierBatchDraft>({ start: 0, end: 80, step: 10, rate: 30 });
  const closeDiscountTierEditor = React.useCallback(() => {
    setDiscountTierEditor(null);
    setDiscountTierDraft([]);
  }, []);
  const strategyEditor = useEditableDraft<ActivityStrategySettings>({
    source: normalizeActivityStrategySettings(strategySettings),
    clone: deepClone,
    normalize: normalizeActivityStrategySettings,
    onBeforeEdit,
    onExitEdit: closeDiscountTierEditor
  });
  const {
    isEditing,
    value: pageStrategySettings,
    startEdit,
    cancelEdit,
    saveEdit: saveStrategyEdit,
    updateDraft: updateSettings,
    replaceDraft
  } = strategyEditor;
  const objectiveOptions = normalizeActivityObjectiveTemplates(pageStrategySettings.objectiveTemplates).map(activityObjectiveOptionFromTemplate);
  const objectiveStrategies = normalizeActivityObjectiveStrategies(pageStrategySettings.objectiveStrategies, defaultTargetProfitRate, objectiveOptions);
  const rows = objectiveOptions.map(option => ({
    ...option,
    strategy: objectiveStrategies[option.value]
  }));

  const saveEdit = async () => {
    await saveStrategyEdit(onSaveSettings);
  };
  const restoreDefault = () => replaceDraft(defaultStrategySettings);
  const updateObjectiveTemplate = (objective: ActivityDesignObjective, patch: Partial<ActivityObjectiveTemplate>) => {
    updateSettings(settings => {
      settings.objectiveTemplates = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).map(template => (
        template.key === objective ? normalizeActivityObjectiveTemplate({ ...template, ...patch, key: template.key }, template) : template
      ));
    });
  };
  const updateObjectiveStrategy = (objective: ActivityDesignObjective, patch: Partial<ActivityObjectiveStrategy>) => {
    updateSettings(settings => {
      const options = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).map(activityObjectiveOptionFromTemplate);
      const current = normalizeActivityObjectiveStrategies(settings.objectiveStrategies, defaultTargetProfitRate, options)[objective];
      settings.objectiveStrategies[objective] = { ...current, ...patch };
    });
  };
  const addObjective = () => {
    updateSettings(settings => {
      const key = uid('objective');
      const template = normalizeActivityObjectiveTemplate({
        key,
        enabled: true,
        name: '新经营目标',
        group: 'marketing',
        targetPayLabel: '0-25 自定义目标区',
        targetPayMin: 0,
        targetPayMax: 25,
        description: '自定义经营目标。'
      }, defaultObjectiveTemplate);
      settings.objectiveTemplates = normalizeActivityObjectiveTemplates(settings.objectiveTemplates).concat(template);
      const strategy = defaultActivityObjectiveStrategies(defaultTargetProfitRate, [activityObjectiveOptionFromTemplate(template)])[key];
      settings.objectiveStrategies[key] = strategy;
    });
  };
  const openDiscountTierEditor = (
    objective: ActivityDesignObjective,
    title: string,
    tiers: ActivityOriginalDiscountTier[],
    fallback: ActivityOriginalDiscountTier[]
  ) => {
    const normalized = tiers.length ? tiers.map(row => ({ ...row })) : fallback.map(row => ({ ...row }));
    setDiscountTierEditor({ objective, title, fallback });
    setDiscountTierDraft(normalized);
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    setDiscountTierBatchDraft({
      start: first?.originalMin ?? 0,
      end: last?.originalMax && last.originalMax < 999 ? last.originalMax : '',
      step: Math.max(1, roundMoney((first?.originalMax ?? 10) - (first?.originalMin ?? 0)) || 10),
      rate: first?.discountRate ?? 30
    });
  };
  const saveDiscountTierEditor = () => {
    if (!discountTierEditor) return;
    updateObjectiveStrategy(discountTierEditor.objective, { originalDiscountTiers: discountTierDraft });
    setDiscountTierEditor(null);
    setDiscountTierDraft([]);
  };
  const columns: TableColumnsType<SystemStrategyRow> = [
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 70,
      fixed: 'left',
      render: (_, row) => isEditing
        ? <Switch checked={row.enabled} onChange={checked => updateObjectiveTemplate(row.value, { enabled: checked })} />
        : renderEnabled(row.enabled)
    },
    {
      title: '经营目标',
      dataIndex: 'label',
      width: 150,
      fixed: 'left',
      render: (_, row) => isEditing
        ? <Input value={row.label} onChange={event => updateObjectiveTemplate(row.value, { name: event.target.value })} />
        : <Text strong>{row.label}</Text>
    },
    {
      title: '目标类型',
      dataIndex: 'group',
      width: 120,
      render: (_, row) => isEditing
        ? <Select value={row.group} options={[{ value: 'stable', label: '稳定目标' }, { value: 'marketing', label: '营销目标' }]} onChange={value => updateObjectiveTemplate(row.value, { group: value })} />
        : <Tag color={row.group === 'stable' ? 'blue' : 'purple'}>{row.group === 'stable' ? '稳定目标' : '营销目标'}</Tag>
    },
    {
      title: '活动倾向',
      dataIndex: 'description',
      width: 220,
      render: (_, row) => isEditing
        ? <Input value={row.description} onChange={event => updateObjectiveTemplate(row.value, { description: event.target.value })} />
        : <Text className="table-text-wrap">{row.description || '-'}</Text>
    },
    {
      title: strategyTitle('阶梯覆盖', '按原价桶覆盖全路线基准让利率，命中阶梯用阶梯让利率，未命中用基准让利率。'),
      width: 300,
      render: (_, row) => isEditing ? (
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Text className="table-text-wrap">{formatActivityOriginalDiscountTiers(row.strategy.originalDiscountTiers)}</Text>
          <Button
            size="small"
            onClick={() => {
              const fallbackStrategy = defaultActivityObjectiveStrategies(defaultTargetProfitRate, objectiveOptions)[row.value] || row.strategy;
              openDiscountTierEditor(
                row.value,
                `${row.label} 原价让利设置`,
                row.strategy.originalDiscountTiers,
                fallbackStrategy.originalDiscountTiers
              );
            }}
          >
            编辑阶梯
          </Button>
        </Space>
      ) : <Text className="table-text-wrap">{formatActivityOriginalDiscountTiers(row.strategy.originalDiscountTiers)}</Text>
    },
    {
      title: strategyTitle('满减占比%', '当前原价桶可设计活动空间中，优先分给公开满减底盘的比例。'),
      width: 110,
      render: (_, row) => isEditing
        ? <InputNumber min={0} max={100} precision={2} value={row.strategy.fullDiscountShare} onChange={value => updateObjectiveStrategy(row.value, { fullDiscountShare: Number(value) || 0 })} />
        : `${money(row.strategy.fullDiscountShare)}%`
    },
    {
      title: strategyTitle('券占比%', '当前原价桶可设计活动空间中，分给订单券建议和最终推荐券的比例参考。'),
      width: 95,
      render: (_, row) => isEditing
        ? <InputNumber min={0} max={100} precision={2} value={row.strategy.couponDiscountShare} onChange={value => updateObjectiveStrategy(row.value, { couponDiscountShare: Number(value) || 0 })} />
        : `${money(row.strategy.couponDiscountShare)}%`
    },
    {
      title: strategyTitle('预留占比%', '不直接发放的活动空间，可用于神券/爆红包加码、人工调整或安全冗余。'),
      width: 105,
      render: (_, row) => isEditing
        ? <InputNumber min={0} max={100} precision={2} value={row.strategy.reserveDiscountShare} onChange={value => updateObjectiveStrategy(row.value, { reserveDiscountShare: Number(value) || 0 })} />
        : `${money(row.strategy.reserveDiscountShare)}%`
    },
    {
      title: '占比合计',
      width: 90,
      render: (_, row) => {
        const total = row.strategy.fullDiscountShare + row.strategy.couponDiscountShare + row.strategy.reserveDiscountShare;
        return <Tag color={Math.abs(total - 100) <= 1e-9 ? 'green' : 'orange'}>{money(total)}%</Tag>;
      }
    },
    {
      title: strategyTitle('窗口桶数', '每一档从起始原价桶向上取多少个有效原价桶，用这些桶的活动空间计算该档满减金额。'),
      width: 105,
      render: (_, row) => isEditing
        ? <InputNumber min={1} precision={0} value={row.strategy.fullThresholdWindow} onChange={value => updateObjectiveStrategy(row.value, { fullThresholdWindow: Math.max(1, Number(value) || 1) })} />
        : money(row.strategy.fullThresholdWindow)
    },
    {
      title: strategyTitle('梯度间距', '生成一档后，下一档从当前门槛加该间距开始向上寻找；找不到合适金额则继续后移窗口。'),
      width: 105,
      render: (_, row) => isEditing
        ? <InputNumber min={1} precision={0} value={row.strategy.fullThresholdMinGap} onChange={value => updateObjectiveStrategy(row.value, { fullThresholdMinGap: Math.max(1, Number(value) || 1) })} />
        : money(row.strategy.fullThresholdMinGap)
    },
    {
      title: strategyTitle('满减增量', '候选减额未高于上一档时，优先尝试抬升到该增量；抬升受安全空间限制。'),
      width: 105,
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={1} value={row.strategy.minFullAmountIncrease} onChange={value => updateObjectiveStrategy(row.value, { minFullAmountIncrease: Number(value) || 0 })} />
        : money(row.strategy.minFullAmountIncrease)
    },
    {
      title: strategyTitle('金额口径', '满减金额取当前阶梯活动空间的统计口径。'),
      width: 120,
      render: (_, row) => isEditing
        ? <Select value={row.strategy.fullAmountBasis} options={fullAmountBasisOptions} onChange={value => updateObjectiveStrategy(row.value, { fullAmountBasis: value })} />
        : optionText(fullAmountBasisOptions, row.strategy.fullAmountBasis)
    },
    {
      title: strategyTitle('到手核验线', '不参与路线生成；仅在路线评分和支付价核验中标记低到手风险。'),
      width: 115,
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={2} value={row.strategy.minNetPayFloor} onChange={value => updateObjectiveStrategy(row.value, { minNetPayFloor: Number(value) || 0 })} />
        : `¥${money(row.strategy.minNetPayFloor)}`
    },
    {
      title: strategyTitle('券策略', '只决定最终建议券的稀疏度、代表门槛和风险容忍；桶级券空间仍按原逻辑生成。'),
      width: 115,
      render: (_, row) => {
        const mode = row.strategy.couponRecommendationPolicy?.mode || row.strategy.couponScoringMode;
        return isEditing
          ? <Select style={{ width: 100 }} value={mode} options={couponRecommendationModeOptions} onChange={value => updateObjectiveStrategy(row.value, { couponRecommendationPolicy: defaultActivityCouponRecommendationPolicy(value), couponScoringMode: value })} />
          : optionText(couponRecommendationModeOptions, mode);
      }
    },
    {
      title: strategyTitle('最大阶梯', '当前经营目标最多生成多少档满减。'),
      width: 95,
      render: (_, row) => isEditing
        ? <InputNumber min={1} max={10} precision={0} value={row.strategy.maxFullRuleCount} onChange={value => updateObjectiveStrategy(row.value, { maxFullRuleCount: Math.max(1, Math.floor(Number(value) || 1)) })} />
        : row.strategy.maxFullRuleCount
    },
    {
      title: strategyTitle('最小命中', '分段样本不足时会扩大附近桶取样，避免极少数组合决定满减金额。'),
      width: 95,
      render: (_, row) => isEditing
        ? <InputNumber min={0} precision={0} value={row.strategy.minFullHitCount} onChange={value => updateObjectiveStrategy(row.value, { minFullHitCount: Math.max(0, Math.floor(Number(value) || 0)) })} />
        : row.strategy.minFullHitCount
    }
  ];

  return (
    <div className="section-stack">
      <Card
        title="系统活动策略"
        extra={isEditing ? (
          <Space>
            <Button onClick={restoreDefault}>恢复默认策略</Button>
            <Button icon={<PlusOutlined />} onClick={addObjective}>新增经营目标</Button>
            <Button onClick={cancelEdit}>取消</Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存系统策略</Button>
          </Space>
        ) : (
          <Button type="primary" icon={<EditOutlined />} onClick={startEdit}>编辑系统策略</Button>
        )}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Text type="secondary">系统策略是全局默认值。活动路线会先按经营目标生成满减底盘，再按券策略从桶级券空间生成金额阶梯推荐券。</Text>
          <Row gutter={[12, 12]}>
            <Col xs={24} md={6}>
              <div className="field">
                <Text type="secondary">全路线基准让利率</Text>
                {isEditing ? (
                  <InputNumber
                    min={0}
                    max={95}
                    precision={2}
                    value={pageStrategySettings.baseOriginalDiscountRate}
                    onChange={value => updateSettings(settings => {
                      settings.baseOriginalDiscountRate = Math.max(0, Math.min(95, Number(value) || 0));
                    })}
                  />
                ) : <div className="field-value">{money(pageStrategySettings.baseOriginalDiscountRate)}%</div>}
              </div>
            </Col>
            <Col xs={24} md={18}>
              <div className="field">
                <Text type="secondary">使用方式</Text>
                <div className="field-value">未命中经营目标阶梯时，全路线统一按该比例计算可活动空间；系统默认 50%，用于最大化暴露活动机会。</div>
              </div>
            </Col>
          </Row>
          <Table rowKey="value" size="small" columns={columns} dataSource={rows} pagination={false} scroll={{ x: 2920 }} tableLayout="fixed" />
        </Space>
      </Card>
      <ActivityDiscountTierEditorModal
        editor={discountTierEditor}
        rows={discountTierDraft}
        batchDraft={discountTierBatchDraft}
        money={money}
        onChangeRows={setDiscountTierDraft}
        onChangeBatchDraft={mutator => setDiscountTierBatchDraft(prev => mutator(prev))}
        onCancel={() => {
          setDiscountTierEditor(null);
          setDiscountTierDraft([]);
        }}
        onSave={saveDiscountTierEditor}
      />
    </div>
  );
}
