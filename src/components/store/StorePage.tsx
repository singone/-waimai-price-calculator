'use client';

import React from 'react';
import { Button, Card, Checkbox, Col, Input, InputNumber, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { CopyOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { ActivityDiscountTierEditorModal, type ActivityDiscountTierBatchDraft, type ActivityDiscountTierEditorValue } from '../modals/ActivityDiscountTierEditorModal';
import { ProfitTargetsCard } from '../shared/FeeRuleCards';
import { useEditableDraft } from '../shared/useEditableDraft';
import { roundMoney } from '../../domain/money';
import type {
  ActivityCouponRecommendationMode,
  ActivityCouponRecommendationPolicy,
  ActivityDesignObjective,
  ActivityDesignSettings,
  ActivityObjectiveStrategy,
  ActivityOriginalDiscountTier,
  ActivityStrategySettings,
  FeeRule,
  ProfitTarget,
  Store
} from '../../domain/types';

const { Text } = Typography;

type ActivityObjectiveOption = {
  key: ActivityDesignObjective;
  value: ActivityDesignObjective;
  label: string;
  enabled: boolean;
  name: string;
  group: 'stable' | 'marketing';
  targetPayLabel: string;
  targetPayMin: number;
  targetPayMax: number;
  description: string;
  baseObjective?: ActivityDesignObjective;
};

type FeeRuleField =
  | 'commissionRate'
  | 'minCommission'
  | 'baseDeliveryFee'
  | 'extraDeliveryFee'
  | 'freightWithin3'
  | 'freightWithin5'
  | 'freightAbove5';

type StorePageProps = {
  store: Store;
  platformProfitTargets: ProfitTarget[];
  activityStrategySettings: ActivityStrategySettings | undefined;
  systemStrategySettings: ActivityStrategySettings;
  fullAmountBasisOptions: Array<{ value: ActivityObjectiveStrategy['fullAmountBasis']; label: string }>;
  couponRecommendationModeOptions: Array<{ value: ActivityCouponRecommendationMode; label: string }>;
  activityMinNetPay: number;
  money: (value: unknown) => string;
  activityDesignModeName: (mode: ActivityDesignSettings['designMode']) => string;
  formatActivityOriginalDiscountTiers: (tiers: ActivityOriginalDiscountTier[]) => string;
  defaultActivityCouponRecommendationPolicy: (mode: ActivityCouponRecommendationMode) => ActivityCouponRecommendationPolicy;
  normalizeActivityObjectiveStrategies: (
    value: Partial<Record<ActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined,
    baseTargetProfitRate: number,
    objectiveOptions: ActivityObjectiveOption[]
  ) => Record<ActivityDesignObjective, ActivityObjectiveStrategy>;
  activityDesignSettingsFromStore: (store: Pick<Store, 'activityDesignSettings'>) => ActivityDesignSettings;
  effectiveActivityDesignSettingsFromStore: (store: Pick<Store, 'activityDesignSettings'>, strategySettings?: ActivityStrategySettings) => ActivityDesignSettings;
  activityObjectiveOptionsFromSettings: (settings: Pick<ActivityStrategySettings | ActivityDesignSettings, 'objectiveTemplates' | 'objectiveStrategies'> | undefined) => ActivityObjectiveOption[];
  effectiveFeeRule: (store: Store) => FeeRule;
  normalizeActivityDesignSettings: (settings: Partial<ActivityDesignSettings> | undefined) => ActivityDesignSettings;
  deepClone: <T>(value: T) => T;
  onBeforeEdit?: () => void;
  onSaveStore: (store: Store) => Promise<boolean>;
  duplicateStore: () => void;
  deleteStore: () => void;
};

const FEE_RULE_FIELDS: Array<[FeeRuleField, string]> = [
  ['commissionRate', '佣金率%'],
  ['minCommission', '保底佣金'],
  ['baseDeliveryFee', '3公里内配送费'],
  ['extraDeliveryFee', '超3公里每0.1公里'],
  ['freightWithin3', '3公里内运费补贴'],
  ['freightWithin5', '3-5公里运费补贴'],
  ['freightAbove5', '5公里以上运费补贴']
];

function optionText<T extends string>(options: Array<{ value: T; label: string }>, value: T) {
  return options.find(option => option.value === value)?.label || value;
}

function StoreField({
  label,
  value,
  control,
  isEditing,
  span = { xs: 12, md: 4 }
}: {
  label: string;
  value: React.ReactNode;
  control: React.ReactNode;
  isEditing: boolean;
  span?: { xs?: number; md?: number };
}) {
  return (
    <Col xs={span.xs ?? 12} md={span.md ?? 4}>
      <div className="field">
        <Text type="secondary">{label}</Text>
        {isEditing ? control : <div className="field-value">{value}</div>}
      </div>
    </Col>
  );
}

export function StorePage({
  store,
  platformProfitTargets,
  activityStrategySettings,
  systemStrategySettings,
  fullAmountBasisOptions,
  couponRecommendationModeOptions,
  activityMinNetPay,
  money,
  activityDesignModeName,
  formatActivityOriginalDiscountTiers,
  defaultActivityCouponRecommendationPolicy,
  normalizeActivityObjectiveStrategies,
  activityDesignSettingsFromStore,
  effectiveActivityDesignSettingsFromStore,
  activityObjectiveOptionsFromSettings,
  effectiveFeeRule,
  normalizeActivityDesignSettings,
  deepClone,
  onBeforeEdit,
  onSaveStore,
  duplicateStore,
  deleteStore
}: StorePageProps) {
  const [discountTierEditor, setDiscountTierEditor] = React.useState<(ActivityDiscountTierEditorValue & { objective: ActivityDesignObjective }) | null>(null);
  const [discountTierDraft, setDiscountTierDraft] = React.useState<ActivityOriginalDiscountTier[]>([]);
  const [discountTierBatchDraft, setDiscountTierBatchDraft] = React.useState<ActivityDiscountTierBatchDraft>({ start: 0, end: 80, step: 10, rate: 30 });
  const closeDiscountTierEditor = React.useCallback(() => {
    setDiscountTierEditor(null);
    setDiscountTierDraft([]);
  }, []);
  const normalizeStoreDraft = React.useCallback((value: Store) => ({
    ...deepClone(value),
    activityDesignSettings: normalizeActivityDesignSettings(value.activityDesignSettings)
  }), [deepClone, normalizeActivityDesignSettings]);
  const storeEditor = useEditableDraft<Store>({
    source: store,
    clone: deepClone,
    normalize: normalizeStoreDraft,
    onBeforeEdit,
    onExitEdit: closeDiscountTierEditor,
    resetKey: store.id
  });
  const { isEditing, value: pageStore, startEdit, cancelEdit, updateDraft: updateStore } = storeEditor;
  const feeRule = effectiveFeeRule(pageStore);
  const activityDesignSettings = activityDesignSettingsFromStore(pageStore);
  const effectiveActivityDesignSettings = effectiveActivityDesignSettingsFromStore(pageStore, activityStrategySettings);
  const objectiveOptions = activityObjectiveOptionsFromSettings(effectiveActivityDesignSettings);
  const effectiveObjectiveStrategies = normalizeActivityObjectiveStrategies(effectiveActivityDesignSettings.objectiveStrategies, effectiveActivityDesignSettings.targetProfitRate, objectiveOptions);
  const usesDefaultObjectiveStrategies = activityDesignSettings.useDefaultObjectiveStrategies !== false;
  const canEditStoreObjectiveModel = isEditing && !usesDefaultObjectiveStrategies;
  const saveEdit = async () => {
    await storeEditor.saveEdit(onSaveStore, draft => {
      const nextStore = deepClone(draft);
      if (nextStore.calculationTotalMax !== '' && nextStore.calculationTotalMax < nextStore.calculationTotalMin) {
        nextStore.calculationTotalMax = nextStore.calculationTotalMin;
      }
      if (nextStore.stapleCountMax !== '' && nextStore.stapleCountMax < nextStore.stapleCountMin) {
        nextStore.stapleCountMax = nextStore.stapleCountMin;
      }
      nextStore.activityDesignSettings = normalizeActivityDesignSettings(nextStore.activityDesignSettings);
      return nextStore;
    });
  };
  const updateActivityDesign = (mutator: (settings: ActivityDesignSettings) => void) => {
    updateStore(draft => {
      const nextSettings = normalizeActivityDesignSettings(draft.activityDesignSettings);
      mutator(nextSettings);
      draft.activityDesignSettings = normalizeActivityDesignSettings(nextSettings);
    });
  };
  const setUsesDefaultObjectiveStrategies = (checked: boolean) => {
    updateActivityDesign(settings => {
      settings.useDefaultObjectiveStrategies = checked;
      if (checked) {
        settings.baseOriginalDiscountRate = undefined;
        settings.objectiveTemplates = [];
        settings.objectivePayTargets = {};
        settings.objectiveStrategies = {};
      } else {
        settings.baseOriginalDiscountRate = effectiveActivityDesignSettings.baseOriginalDiscountRate ?? systemStrategySettings.baseOriginalDiscountRate;
        settings.objectiveTemplates = objectiveOptions.map(option => ({
          key: option.value,
          enabled: option.enabled,
          name: option.label,
          group: option.group,
          targetPayLabel: option.targetPayLabel,
          targetPayMin: option.targetPayMin,
          targetPayMax: option.targetPayMax,
          description: option.description,
          baseObjective: option.baseObjective
        }));
        settings.objectiveStrategies = effectiveObjectiveStrategies;
      }
    });
  };
  const updateObjectiveStrategy = (objective: ActivityDesignObjective, patch: Partial<ActivityObjectiveStrategy>) => {
    updateActivityDesign(settings => {
      settings.useDefaultObjectiveStrategies = false;
      const rawStrategies = (settings.objectiveStrategies || settings.objectivePayTargets) as Partial<Record<ActivityDesignObjective, Partial<ActivityObjectiveStrategy>>> | undefined;
      const strategies = normalizeActivityObjectiveStrategies(rawStrategies, settings.targetProfitRate, objectiveOptions);
      strategies[objective] = { ...strategies[objective], ...patch };
      settings.objectiveStrategies = strategies;
      settings.objectiveTemplates = objectiveOptions.map(option => ({
        key: option.value,
        enabled: option.enabled,
        name: option.label,
        group: option.group,
        targetPayLabel: option.targetPayLabel,
        targetPayMin: option.targetPayMin,
        targetPayMax: option.targetPayMax,
        description: option.description,
        baseObjective: option.baseObjective
      }));
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
  const objectiveStrategyColumns: TableColumnsType<ActivityObjectiveOption> = [
    { title: '经营目标', dataIndex: 'label', width: 120, render: value => <Tag color="blue">{String(value)}</Tag> },
    { title: '活动倾向', dataIndex: 'description', width: 240, render: value => <Text className="table-text-wrap">{String(value)}</Text> },
    {
      title: '阶梯覆盖',
      width: 300,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel ? (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text className="table-text-wrap">{formatActivityOriginalDiscountTiers(target.originalDiscountTiers)}</Text>
            <Button
              size="small"
              onClick={() => {
                const fallbackStrategy = normalizeActivityObjectiveStrategies(
                  systemStrategySettings.objectiveStrategies,
                  effectiveActivityDesignSettings.targetProfitRate,
                  objectiveOptions
                )[row.value] || target;
                openDiscountTierEditor(
                  row.value,
                  `${row.label} 原价让利设置`,
                  target.originalDiscountTiers,
                  fallbackStrategy.originalDiscountTiers
                );
              }}
            >
              编辑阶梯
            </Button>
          </Space>
        ) : <Text className="table-text-wrap">{formatActivityOriginalDiscountTiers(target.originalDiscountTiers)}</Text>;
      }
    },
    {
      title: '满减占比%',
      width: 120,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel
          ? <InputNumber min={0} max={100} precision={2} value={target.fullDiscountShare} onChange={value => updateObjectiveStrategy(row.value, { fullDiscountShare: Number(value) || 0 })} />
          : `${money(target.fullDiscountShare)}%`;
      }
    },
    {
      title: '券占比%',
      width: 105,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel
          ? <InputNumber min={0} max={100} precision={2} value={target.couponDiscountShare} onChange={value => updateObjectiveStrategy(row.value, { couponDiscountShare: Number(value) || 0 })} />
          : `${money(target.couponDiscountShare)}%`;
      }
    },
    {
      title: '窗口桶数',
      width: 105,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel
          ? <InputNumber min={1} precision={0} value={target.fullThresholdWindow} onChange={value => updateObjectiveStrategy(row.value, { fullThresholdWindow: Math.max(1, Number(value) || 1) })} />
          : money(target.fullThresholdWindow);
      }
    },
    {
      title: '梯度间距',
      width: 105,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel
          ? <InputNumber min={1} precision={0} value={target.fullThresholdMinGap} onChange={value => updateObjectiveStrategy(row.value, { fullThresholdMinGap: Math.max(1, Number(value) || 1) })} />
          : money(target.fullThresholdMinGap);
      }
    },
    {
      title: '最大阶梯',
      width: 95,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel
          ? <InputNumber min={1} max={10} precision={0} value={target.maxFullRuleCount} onChange={value => updateObjectiveStrategy(row.value, { maxFullRuleCount: Math.max(1, Math.floor(Number(value) || 1)) })} />
          : target.maxFullRuleCount;
      }
    },
    {
      title: '金额口径',
      width: 110,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        return canEditStoreObjectiveModel
          ? <Select style={{ width: 100 }} value={target.fullAmountBasis} options={fullAmountBasisOptions} onChange={value => updateObjectiveStrategy(row.value, { fullAmountBasis: value })} />
          : optionText(fullAmountBasisOptions, target.fullAmountBasis);
      }
    },
    {
      title: '核验/券',
      width: 170,
      render: (_, row) => {
        const target = effectiveObjectiveStrategies[row.value];
        const couponMode = target.couponRecommendationPolicy?.mode || target.couponScoringMode;
        return canEditStoreObjectiveModel ? (
          <Space.Compact>
            <InputNumber style={{ width: 80 }} min={0} precision={2} value={target.minNetPayFloor} onChange={value => updateObjectiveStrategy(row.value, { minNetPayFloor: Number(value) || 0 })} />
            <Select
              style={{ width: 90 }}
              value={couponMode}
              options={couponRecommendationModeOptions}
              onChange={value => updateObjectiveStrategy(row.value, {
                couponRecommendationPolicy: defaultActivityCouponRecommendationPolicy(value),
                couponScoringMode: value
              })}
            />
          </Space.Compact>
        ) : `到手核验¥${money(target.minNetPayFloor)} / 券策略${optionText(couponRecommendationModeOptions, couponMode)}`;
      }
    }
  ];

  return (
    <div className="section-stack">
      <Card
        title="门店维护"
        extra={
          <Space>
            {isEditing ? (
              <>
                <Button onClick={cancelEdit}>取消</Button>
                <Button type="primary" icon={<SaveOutlined />} onClick={saveEdit}>保存门店</Button>
              </>
            ) : (
              <Button type="primary" onClick={startEdit}>编辑门店</Button>
            )}
            <Button icon={<CopyOutlined />} onClick={duplicateStore}>复制门店</Button>
            <Button danger icon={<DeleteOutlined />} onClick={deleteStore}>删除门店</Button>
          </Space>
        }
      >
        <Row gutter={[12, 12]}>
          <StoreField label="门店名称" value={pageStore.name} isEditing={isEditing} span={{ xs: 24, md: 8 }} control={<Input value={pageStore.name} onChange={event => updateStore(store => { store.name = event.target.value; })} />} />
          <StoreField label="起送价" value={`¥${money(pageStore.startPrice)}`} isEditing={isEditing} control={<InputNumber min={0} precision={2} value={pageStore.startPrice} onChange={value => updateStore(store => { store.startPrice = Number(value) || 0; })} />} />
          <StoreField label="测算最低总价" value={`¥${money(pageStore.calculationTotalMin)}`} isEditing={isEditing} control={<InputNumber min={0} precision={2} value={pageStore.calculationTotalMin} onChange={value => updateStore(store => { store.calculationTotalMin = Number(value) || 0; })} />} />
          <StoreField label="测算最高总价" value={pageStore.calculationTotalMax === '' ? '不限' : `¥${money(pageStore.calculationTotalMax)}`} isEditing={isEditing} control={<InputNumber min={0} precision={2} placeholder="空=不限" value={pageStore.calculationTotalMax === '' ? null : pageStore.calculationTotalMax} onChange={value => updateStore(store => { store.calculationTotalMax = value === null ? '' : Number(value) || 0; })} />} />
          <StoreField label="主食份数最低" value={pageStore.stapleCountMin} isEditing={isEditing} control={<InputNumber min={0} precision={0} value={pageStore.stapleCountMin} onChange={value => updateStore(store => { store.stapleCountMin = Number(value) || 0; })} />} />
          <StoreField label="主食份数最高" value={pageStore.stapleCountMax === '' ? '不限' : pageStore.stapleCountMax} isEditing={isEditing} control={<InputNumber min={0} precision={0} placeholder="空=不限" value={pageStore.stapleCountMax === '' ? null : pageStore.stapleCountMax} onChange={value => updateStore(store => { store.stapleCountMax = value === null ? '' : Number(value) || 0; })} />} />
          <StoreField label="配送距离" value={`${pageStore.deliveryDistance} 公里`} isEditing={isEditing} control={<InputNumber min={0} precision={1} value={pageStore.deliveryDistance} onChange={value => updateStore(store => { store.deliveryDistance = Number(value) || 0; })} />} />
          <StoreField label="下单时段" value={pageStore.orderTime} isEditing={isEditing} control={<Input value={pageStore.orderTime} onChange={event => updateStore(store => { store.orderTime = event.target.value; })} />} />
          <StoreField label="最多商品件数" value={pageStore.maxItems} isEditing={isEditing} control={<InputNumber min={1} max={10} value={pageStore.maxItems} onChange={value => updateStore(store => { store.maxItems = Number(value) || 1; })} />} />
          <StoreField label="单SKU最多数量" value={pageStore.maxQtyPerSku} isEditing={isEditing} control={<InputNumber min={1} max={10} value={pageStore.maxQtyPerSku} onChange={value => updateStore(store => { store.maxQtyPerSku = Number(value) || 1; })} />} />
          <StoreField label="最多优惠券张数" value={pageStore.maxCoupons} isEditing={isEditing} control={<InputNumber min={0} max={8} value={pageStore.maxCoupons} onChange={value => updateStore(store => { store.maxCoupons = Number(value) || 0; })} />} />
          <StoreField label="整单折扣商品上限" value={pageStore.maxDiscountItems === '' ? '不限' : pageStore.maxDiscountItems} isEditing={isEditing} control={<InputNumber min={0} placeholder="空=不限" value={pageStore.maxDiscountItems === '' ? null : pageStore.maxDiscountItems} onChange={value => updateStore(store => { store.maxDiscountItems = value === null ? '' : Number(value) || 0; })} />} />
          <StoreField label="最多检查组合数" value={pageStore.maxChecks} isEditing={isEditing} control={<InputNumber min={1000} step={1000} value={pageStore.maxChecks} onChange={value => updateStore(store => { store.maxChecks = Number(value) || 1000; })} />} />
        </Row>
      </Card>

      <Card title="活动设计配置">
        <Row gutter={[12, 12]}>
          <StoreField label="饭团最大组合数" value={activityDesignSettings.stapleMaxCount} isEditing={isEditing} control={<InputNumber min={1} precision={0} value={activityDesignSettings.stapleMaxCount ?? 2} onChange={value => updateActivityDesign(settings => { settings.stapleMaxCount = Math.max(1, Math.floor(Number(value) || 2)); })} />} />
          <StoreField label="凑单小吃最多件数" value={activityDesignSettings.addOnMaxCount === '' ? '不限' : activityDesignSettings.addOnMaxCount} isEditing={isEditing} control={<InputNumber min={0} precision={0} placeholder="空=不限" value={activityDesignSettings.addOnMaxCount === '' ? null : activityDesignSettings.addOnMaxCount} onChange={value => updateActivityDesign(settings => { settings.addOnMaxCount = value === null ? '' : Math.max(0, Math.floor(Number(value) || 0)); })} />} />
          <StoreField label="神券/爆红包加码空间" value={`¥${money(activityDesignSettings.redAddOnSpace)}`} isEditing={isEditing} control={<InputNumber min={0} precision={2} value={activityDesignSettings.redAddOnSpace} onChange={value => updateActivityDesign(settings => { settings.redAddOnSpace = Number(value) || 0; })} />} />
          <StoreField label="全路线基准让利率" value={`${money(effectiveActivityDesignSettings.baseOriginalDiscountRate ?? 50)}%${usesDefaultObjectiveStrategies ? '（通用）' : ''}`} isEditing={isEditing} control={<InputNumber disabled={usesDefaultObjectiveStrategies} min={0} max={95} precision={2} value={effectiveActivityDesignSettings.baseOriginalDiscountRate ?? 50} onChange={value => updateActivityDesign(settings => { settings.useDefaultObjectiveStrategies = false; settings.baseOriginalDiscountRate = Math.max(0, Math.min(95, Number(value) || 0)); })} />} />
          <StoreField label="优惠券设计基准" value={activityDesignSettings.couponDesignBasis === 'pay' ? '支付价' : '商品原价'} isEditing={isEditing} control={<Select value={activityDesignSettings.couponDesignBasis} onChange={value => updateActivityDesign(settings => { settings.couponDesignBasis = value; })} options={[{ value: 'original', label: '商品原价' }, { value: 'pay', label: '支付价' }]} />} />
          <StoreField label="活动设计模式" value={activityDesignModeName(activityDesignSettings.designMode)} isEditing={isEditing} control={<Select value={activityDesignSettings.designMode} onChange={value => updateActivityDesign(settings => { settings.designMode = value; })} options={[{ value: 'auto', label: '自动' }, { value: 'full', label: '只看满减' }, { value: 'coupon', label: '只看优惠券' }, { value: 'stacked', label: '满减+券' }]} />} />
          <StoreField label="默认关注目标" value={objectiveOptions.find(option => option.value === (activityDesignSettings.objective || 'longTerm'))?.label || (activityDesignSettings.objective || 'longTerm')} isEditing={isEditing} control={<Select value={activityDesignSettings.objective || 'longTerm'} onChange={value => updateActivityDesign(settings => { settings.objective = value; })} options={objectiveOptions.map(option => ({ value: option.value, label: option.label }))} />} />
          <StoreField label="门槛步长" value={activityDesignSettings.couponDesignThresholdStep} isEditing={isEditing} control={<InputNumber min={1} precision={0} value={activityDesignSettings.couponDesignThresholdStep} onChange={value => updateActivityDesign(settings => { settings.couponDesignThresholdStep = Math.max(1, Math.floor(Number(value) || 1)); })} />} />
          <StoreField label="满减最大减额" value={activityDesignSettings.couponDesignMaxFullAmount === '' ? '不限' : `¥${money(activityDesignSettings.couponDesignMaxFullAmount)}`} isEditing={isEditing} control={<InputNumber min={0} precision={2} placeholder="空=不限" value={activityDesignSettings.couponDesignMaxFullAmount === '' ? null : activityDesignSettings.couponDesignMaxFullAmount} onChange={value => updateActivityDesign(settings => { settings.couponDesignMaxFullAmount = value === null ? '' : Number(value) || 0; })} />} />
          <StoreField label="券最大减额" value={activityDesignSettings.couponDesignMaxCouponAmount === '' ? '不限' : `¥${money(activityDesignSettings.couponDesignMaxCouponAmount)}`} isEditing={isEditing} control={<InputNumber min={0} precision={2} placeholder="空=不限" value={activityDesignSettings.couponDesignMaxCouponAmount === '' ? null : activityDesignSettings.couponDesignMaxCouponAmount} onChange={value => updateActivityDesign(settings => { settings.couponDesignMaxCouponAmount = value === null ? '' : Number(value) || 0; })} />} />
          <StoreField label="原价区间步长" value={activityDesignSettings.originalBandSize ?? 5} isEditing={isEditing} control={<InputNumber min={1} precision={0} value={activityDesignSettings.originalBandSize ?? 5} onChange={value => updateActivityDesign(settings => { settings.originalBandSize = Math.max(1, Math.floor(Number(value) || 5)); })} />} />
          <StoreField label="支付价区间步长" value={activityDesignSettings.payBandSize ?? 5} isEditing={isEditing} control={<InputNumber min={1} precision={0} value={activityDesignSettings.payBandSize ?? 5} onChange={value => updateActivityDesign(settings => { settings.payBandSize = Math.max(1, Math.floor(Number(value) || 5)); })} />} />
        </Row>
        <Space direction="vertical" style={{ width: '100%', marginTop: 16 }} size="small">
          <Space wrap>
            <Text strong>经营目标模型</Text>
            {isEditing ? (
              <Checkbox
                checked={usesDefaultObjectiveStrategies}
                onChange={event => setUsesDefaultObjectiveStrategies(event.target.checked)}
              >
                使用门店通用规则
              </Checkbox>
            ) : (
              <Tag color={usesDefaultObjectiveStrategies ? 'green' : 'orange'}>
                {usesDefaultObjectiveStrategies ? '使用门店通用规则' : '门店自定义规则'}
              </Tag>
            )}
            <Text type="secondary">满减按全路线基准让利率和目标阶梯覆盖生成公开优惠底盘，优惠券按券策略从桶级券空间生成金额阶梯推荐券；商家到手价最低 ¥{money(activityMinNetPay)} 只在后续核验中标记。</Text>
          </Space>
          <Table
            rowKey="value"
            size="small"
            columns={objectiveStrategyColumns}
            dataSource={objectiveOptions}
            pagination={false}
            scroll={{ x: 2110 }}
            tableLayout="fixed"
          />
        </Space>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title="费用规则" extra={isEditing ? <Button onClick={() => updateStore(store => { store.usePlatformFee = true; store.customFeeRule = null; })}>重置到平台规则</Button> : null}>
            <Space direction="vertical" style={{ width: '100%' }}>
              {isEditing ? (
                <Checkbox
                  checked={pageStore.usePlatformFee}
                  onChange={event => updateStore(store => {
                    store.usePlatformFee = event.target.checked;
                    if (event.target.checked) store.customFeeRule = null;
                    else store.customFeeRule = feeRule;
                  })}
                >
                  继承平台费用规则
                </Checkbox>
              ) : (
                <Tag color={pageStore.usePlatformFee ? 'green' : 'blue'}>{pageStore.usePlatformFee ? '继承平台费用规则' : '门店自定义费用规则'}</Tag>
              )}
              <Row gutter={[12, 12]}>
                {FEE_RULE_FIELDS.map(([field, label]) => (
                  <Col xs={12} md={8} key={field}>
                    <div className="field">
                      <Text type="secondary">{label}</Text>
                      {isEditing ? (
                        <InputNumber
                          disabled={pageStore.usePlatformFee}
                          precision={2}
                          value={Number(feeRule[field])}
                          onChange={value => updateStore(store => {
                            store.customFeeRule = { ...(store.customFeeRule || {}), [field]: Number(value) || 0 };
                          })}
                        />
                      ) : (
                        <div className="field-value">{money(feeRule[field])}</div>
                      )}
                    </div>
                  </Col>
                ))}
              </Row>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <ProfitTargetsCard
            title="门店利润率阶梯"
            rows={pageStore.usePlatformTargets ? platformProfitTargets : pageStore.profitTargets}
            disabled={!isEditing || pageStore.usePlatformTargets}
            extra={isEditing ? (
              <Checkbox checked={pageStore.usePlatformTargets} onChange={event => updateStore(store => { store.usePlatformTargets = event.target.checked; })}>继承平台阶梯</Checkbox>
            ) : (
              <Tag color={pageStore.usePlatformTargets ? 'green' : 'blue'}>{pageStore.usePlatformTargets ? '继承平台阶梯' : '门店自定义阶梯'}</Tag>
            )}
            money={money}
            onChange={rows => updateStore(store => { store.profitTargets = rows; })}
            onAdd={() => updateStore(store => { store.profitTargets.push({ enabled: true, payMin: 0, payMax: 20, rateMin: 20, rateMax: 30 }); })}
          />
        </Col>
      </Row>
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
