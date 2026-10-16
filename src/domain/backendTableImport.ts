import type { BackendItem } from './backendSync';
import { COUPON_CHANNELS, COUPON_TARGETS } from './activity/configuration';
import { PLATFORM_FEE_FIELDS } from './platformFeeFields';

type Row = Record<string, unknown>;
function pick(row: Row, keys: string[]) {
  for (const key of keys) if (row[key] !== undefined && row[key] !== '') return row[key];
  return undefined;
}
function numeric(value: unknown, label: string) {
  if (value === undefined || value === null || String(value).trim() === '') throw new Error(`${label}为空，不能按 0 导入。`);
  const number = Number(String(value).replace(/[¥￥,，]/g, '').trim());
  if (!Number.isFinite(number)) throw new Error(`${label}不是有效数字。`);
  return number;
}
function enabled(value: unknown) {
  if ([true, 1, '1', 'true', '启用', '上架', '已上架', '进行中', '是'].includes(value as never)) return true;
  if ([false, 0, '0', 'false', '停用', '下架', '已下架', '否'].includes(value as never)) return false;
  throw new Error('请明确填写状态：启用／停用或上架／下架。');
}

/** 接受统一核对表，以及含商品名称、售价、包装费的常见商品导出表。 */
export function importBackendTable(rows: Row[]): { items: BackendItem[]; unsupportedRules: string[] } {
  const items: BackendItem[] = [];
  const groups = new Map<string, unknown[]>();
  const unsupportedRules: string[] = [];
  rows.forEach((original, index) => {
    const row = Object.fromEntries(Object.entries(original).map(([key, value]) => [key.replace(/^\uFEFF/, '').trim(), typeof value === 'string' ? value.trim() : value]));
    if (Object.values(row).every(value => value === undefined || value === '')) return;
    try {
      const category = String(pick(row, ['类别', '类型']) || '商品');
      const field = String(pick(row, ['项目', '字段']) || '');
      const value = pick(row, ['后台值', '值']);
      if (category === '特殊规则') {
        const note = String(value || field || '');
        if (!note) throw new Error('特殊规则内容不能为空。');
        unsupportedRules.push(note); return;
      }
      if (category === '费用') {
        const key = PLATFORM_FEE_FIELDS.find(([key, label]) => field === key || field === label)?.[0];
        if (!key) throw new Error(`费用项目不支持：${field}`);
        // 空白费用表示未取得，不能覆盖既有配置。
        if (value === undefined) return;
        items.push({ kind: 'fee', field: key, value: numeric(value, field) }); return;
      }
      if (category === '商品') {
        const productName = String(pick(row, ['商品名称', '商品名', '名称']) || '');
        const productCode = String(pick(row, ['商家商品编码', '商品编码', '商家编码', '商家自编码', 'SKU编码']) || '');
        const productId = String(pick(row, ['工具商品ID']) || '');
        const identity = { productName, productCode, productId };
        if (field) {
          const target = ({ 售价: 'price', 价格: 'price', 包装费: 'packageFee', 打包费: 'packageFee', 上架状态: 'enabled', price: 'price', packageFee: 'packageFee', enabled: 'enabled' } as Record<string, string>)[field];
          if (!target) throw new Error(`商品项目不支持：${field}`);
          if (value === undefined) return;
          items.push({ kind: 'product', field: target, value: target === 'enabled' ? enabled(value) : numeric(value, field), ...identity });
        } else {
          const price = pick(row, ['售价', '商品售价', '价格', '原价']);
          const packageFee = pick(row, ['包装费', '打包费']);
          const status = pick(row, ['上架状态', '商品状态']);
          if (price === undefined && packageFee === undefined && status === undefined) throw new Error('未识别商品售价、包装费或上架状态列。');
          if (price !== undefined) items.push({ kind: 'product', field: 'price', value: numeric(price, '售价'), ...identity });
          if (packageFee !== undefined) items.push({ kind: 'product', field: 'packageFee', value: numeric(packageFee, '包装费'), ...identity });
          if (status !== undefined) items.push({ kind: 'product', field: 'enabled', value: enabled(status), ...identity });
        }
        return;
      }
      const activityField = ({ 满减: 'fullReductions', 订单券: 'coupons', 红包加码: 'redAddOns', 商品折扣: 'discountActivities', 京东补贴券: 'jingdongSubsidyCoupons', 基础红包: 'redTiers' } as Record<string, string>)[category];
      if (!activityField) throw new Error(`不支持的类别：${category}`);
      const activity: Row = { enabled: enabled(pick(row, ['状态', '启用'])) };
      if (activityField !== 'discountActivities') activity.threshold = numeric(pick(row, ['门槛']), '门槛');
      if (activityField === 'redTiers') {
        activity.min = numeric(row['最低承担'], '最低承担'); activity.max = numeric(row['最高承担'], '最高承担');
      } else if (activityField === 'discountActivities') {
        delete activity.threshold;
        activity.name = row['名称']; activity.productNames = row['商品关键字'];
        activity.discountRate = numeric(row['折扣'], '折扣');
        activity.itemLimit = row['件数上限'] === '不限' ? '' : numeric(row['件数上限'], '件数上限');
      } else {
        activity.amount = numeric(row['金额'], '金额');
        if (activityField === 'coupons' || activityField === 'jingdongSubsidyCoupons') activity.name = row['名称'];
        if (activityField === 'coupons') {
          const channel = pick(row, ['发放渠道']);
          const target = pick(row, ['适用人群']);
          if (channel !== undefined) {
            const option = COUPON_CHANNELS.find(option => option.label === channel || option.value === channel);
            if (!option) throw new Error('未识别订单券发放渠道。');
            activity.channel = option.value;
          }
          if (target !== undefined) {
            const option = COUPON_TARGETS.find(option => option.label === target || option.value === target);
            if (!option) throw new Error('未识别订单券适用人群。');
            activity.targetUser = option.value;
          }
          const stacking = pick(row, ['可叠加其他订单券']);
          if (stacking !== undefined) activity.stackableWithCoupons = enabled(stacking);
          const note = pick(row, ['后台核对备注']);
          if (note !== undefined) activity.usageSuggestion = String(note);
        }
        if (activityField === 'jingdongSubsidyCoupons') {
          activity.kind = row['券类型'] === '大额券' ? 'large' : row['券类型'] === '小额券' ? 'small' : row['券类型'];
          activity.merchantAmount = numeric(row['商家承担'], '商家承担');
          activity.merchantExtraAmount = numeric(row['商家加码'], '商家加码');
          activity.platformAmount = numeric(row['平台承担'], '平台承担');
          activity.stackableWithLarge = enabled(row['可叠加大额券']);
        }
      }
      groups.set(activityField, [...(groups.get(activityField) || []), activity]);
    } catch (error) { throw new Error(`表格第 ${index + 2} 行：${(error as Error).message}`); }
  });
  groups.forEach((value, field) => items.push({ kind: field === 'redTiers' ? 'redTiers' : 'activity', field, value }));
  return { items, unsupportedRules };
}
