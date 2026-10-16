import type { PageKey } from '../app/routes';

export const GUIDE_UPDATED_AT = '2026-10-12';

// 页面名称和路径由统一路由表提供，这里只维护用途与功能边界。
export const PAGE_GUIDES: Record<PageKey, { group: string; purpose: string; input: string; output: string; boundary: string }> = {
  guide: { group: '使用与核对', purpose: '查找功能、了解平台差异及后续任务', input: '功能关键词', output: '网站地图、差异说明、任务 CSV', boundary: '任务是开发计划，不能视为已交付功能' },
  news: { group: '使用与核对', purpose: '查看平台公告、门店通知与经营观察', input: '平台、主题、关键词', output: '来源、经营影响和待核实事项', boundary: '静态整理资料，非实时资讯；门店通知不代表全国政策' },
  'backend-sync': { group: '使用与核对', purpose: '将商家后台导出值与工具配置逐项核对', input: '同店同平台 Excel / CSV / JSON 或粘贴表格、来源与有效期', output: '差异预览、选择同步、记录与受保护的撤回', boundary: '不直接连接平台，不写回后台；特殊规则与未知字段需先处理' },
  store: { group: '基础配置', purpose: '维护门店和测算范围', input: '起送价、距离、时段、组合参数、利润率阶梯', output: '当前门店独立配置', boundary: '示例配置需按实际门店核实' },
  products: { group: '基础配置', purpose: '维护商品、成本、套餐及三平台价格', input: '商品表、成本表、售价、包装费、上下架与套餐组成', output: '门店商品库、平台定价和套餐价格核对', boundary: '导入平台价格不会自动取得真实成本' },
  'system-strategy': { group: '基础配置', purpose: '配置活动设计使用的系统策略', input: '活动策略参数', output: '设计和扫描的策略约束', boundary: '工具策略不等于平台活动资格' },
  platform: { group: '基础配置', purpose: '维护通用费用与基础优惠规则', input: '佣金、保底、配送阶梯、减配成本、利润率与红包', output: '通用配置和门店继承基础', boundary: '固定阶梯模型不覆盖所有平台合同' },
  meituan: { group: '平台活动', purpose: '维护美团满减、订单券、红包加码与商品折扣', input: '当前门店美团活动和费用', output: '参与美团测算的活动配置', boundary: '混合分摊券、特殊互斥与门槛口径待核实' },
  eleme: { group: '平台活动', purpose: '维护淘宝闪购 / 饿了么活动', input: '当前门店满减、订单券、红包加码、折扣和费用', output: '参与饿了么测算的活动配置', boundary: '商家减配成本应独立录入；不同门店不能沿用同一活动金额' },
  jingdong: { group: '平台活动', purpose: '维护京东券并分析补贴分摊和触发范围', input: '券门槛、面额、商家承担、平台承担、加码和满减', output: '券命中组合、接近触发组合及分摊测算', boundary: '当前能力侧重券分析；仍需用真实结算单验证模型' },
  'activity-design': { group: '测算与决策', purpose: '设计活动并检查组合利润安全边界', input: '商品、平台费用、利润目标与策略', output: '活动建议、价格扫描和风险边界', boundary: '修改商品或费用后需重新扫描；建议不自动发布' },
  pricing: { group: '测算与决策', purpose: '评估价格与活动组合的利润表现', input: '价格方案、商品成本、平台费用和活动', output: '定价评估与方案比较', boundary: '利润依赖配置口径，不预测订单增量' },
  results: { group: '测算与决策', purpose: '生成商品组合并测算利润和风险', input: '当前门店商品、活动、费用及平台筛选', output: '实付、费用、利润、风险筛选与 CSV', boundary: '组合枚举受范围限制；测算结果不是平台最终账单' },
  'order-analysis': { group: '经营复盘', purpose: '分析订单支付价、时段和活动组合', input: '订单导出文件与筛选条件', output: '订单总览、平台对比、商品偏好与运营建议', boundary: '活动归因是描述性分析，不能直接证明活动带来增量' },
  'data-analysis': { group: '经营复盘', purpose: '分析经营日报、客户结构与转化趋势', input: '经营日报、日期范围与平台', output: '平台汇总、漏斗、趋势诊断、备忘与导出', boundary: '缺失的新老客、复购字段不应补成零；平台指标口径需核对' },
  'product-analysis': { group: '经营复盘', purpose: '分析商品阶段表现和价值分层', input: '商品经营数据与阶段范围', output: '商品排名、趋势、分层及导入记录', boundary: '经营数据与商品成本的匹配关系需复核' }
};

export const PLATFORM_GAPS = [
  { area: '费用与履约', meituan: '官方说明区分技术服务费与履约服务费；具体店铺合同未取得', eleme: '已有弘金减配活动记录；佣金与履约合同仍待核实', jingdong: '具体门店合同与免佣有效期未取得', current: '支持门店 × 平台费用覆盖、保底、既有配送阶梯及本次时段附加费', gap: '尚未支持任意合同阶梯、不同佣金基数及天气等动态费用', task: 'T01、T03' },
  { area: '优惠分摊与叠加', meituan: '具体神券、满减、折扣互斥和门槛待核实', eleme: '2026-10-10 留存记录：弘金减配商家 3.2 元、平台 1.5 元，与其他活动同享；当前状态需复核', jingdong: '支持录入平台 / 商家券分摊；完整叠加规则待核实', current: '满减、订单券、基础红包、加码和折扣；京东独立券分摊', gap: '美团 / 饿了么通用券按录入的商家承担计算，未完整模拟混合分摊券与特殊互斥', task: 'T02' },
  { area: '商品与活动发布', meituan: '需要后台确认实际上架状态、套餐与活动生效状态', eleme: '需要后台确认商品、活动、展示与审核状态', jingdong: '需要后台确认券资格及商品 / 活动生效状态', current: '维护三平台价格、包装费与上架状态，按导出数据核对差异', gap: '无直接后台连接、实时库存或活动发布；工具保存不代表后台生效', task: 'T06' },
  { area: '订单结算与利润', meituan: '以实际结算明细及合同为准', eleme: '顾客实付与活动效果投入产出比不能替代商家结算', jingdong: '平台补贴入账及券分摊需以结算单核对', current: '提供组合利润、订单分析与经营日报分析', gap: '尚无逐订单预计结算与实际到账的差额闭环', task: 'T01' },
  { area: '来源与有效期', meituan: '公开费用结构已于 2026-10-12 复核；本店规则仍待核实', eleme: '既有资料仅覆盖弘金钱江世纪城店，井弘店未独立核查', jingdong: '既有后台观察未取得完整合同', current: '核对摘录支持来源、采集时间、有效期和同步历史', gap: '规则保存后到期不会自动停用，需统一提醒和测算前检查', task: 'T04' },
  { area: '经营数据与资讯', meituan: '按实际导出的订单、日报与商品统计核对口径', eleme: '按实际导出的订单、日报与商品统计核对口径', jingdong: '按实际导出的订单、日报与商品统计核对口径', current: '文件导入、筛选、趋势与静态平台动态', gap: '未自动拉取数据；无统一导入质量报告与资讯刷新流程', task: 'T05、T07' }
];

export const FOLLOW_UP_TASKS = [
  { id: 'T01', priority: 'P0', status: '待采集证据', title: '真实订单结算核对', scope: '两店 × 三平台，取得合同与结算样本，拆分实付、补贴、佣金、履约和减配', dependency: '取得脱敏合同及订单结算明细', acceptance: '逐单展示预计与实际结算及差额原因；典型距离、时段、券场景覆盖；差额按平台舍入规则解释', page: 'backend-sync' as PageKey },
  { id: 'T02', priority: 'P0', status: '待采集证据', title: '优惠分摊与叠加规则', scope: '美团 / 饿了么混合分摊券、互斥、门槛基数、起送口径；复核京东叠加', dependency: 'T01 的订单样本及各店活动规则全文', acceptance: '同一场景的顾客实付与商家结算均匹配；不支持规则明确阻止按已验证模型计算', page: 'activity-design' as PageKey },
  { id: 'T03', priority: 'P1', status: '待采集证据', title: '按合同配置费用模型', scope: '佣金基数、任意距离 / 金额阶梯、时段和附加费用', dependency: 'T01 确认实际合同结构后再实现', acceptance: '各平台和门店独立；阶梯边界与保底有回归验证；旧配置保持兼容', page: 'platform' as PageKey },
  { id: 'T04', priority: 'P1', status: '待开发', title: '规则有效期与复核提醒', scope: '规则来源、核实状态、到期提醒及测算前复核提示', dependency: '复用现有后台核对记录，先提醒；自动停用需另定规则', acceptance: '区分未核实、已核实、已过期及同步后变更；到期提醒能跳转对应门店平台规则', page: 'backend-sync' as PageKey },
  { id: 'T05', priority: 'P1', status: '待开发', title: '统一导入质量报告', scope: '订单、日报、商品导入中的缺失、重复、未匹配、日期与单位问题', dependency: '各平台脱敏导出样本与现有导入流程', acceptance: '导入前预览新增 / 覆盖 / 跳过数量及原因；缺失值不当作零；导入失败不覆盖原数据', page: 'data-analysis' as PageKey },
  { id: 'T06', priority: 'P2', status: '待开发', title: '活动执行与复盘清单', scope: '将已选活动建议整理为后台录入清单，记录实际生效时间与复盘范围', dependency: 'T02 验证的活动规则；继续采用人工后台录入', acceptance: '明确建议、待录入、已生效状态；生效证据与方案可追溯；复盘不混入未生效日期', page: 'activity-design' as PageKey },
  { id: 'T07', priority: 'P2', status: '待开发', title: '平台动态更新流程', scope: '来源、采集日期、门店适用范围和失效状态；按复核结果更新', dependency: '可核实公告或已登录后台资料', acceptance: '显示资料截止日期；不把历史通知当新政策；新资料关联受影响规则及复核任务', page: 'news' as PageKey }
];
