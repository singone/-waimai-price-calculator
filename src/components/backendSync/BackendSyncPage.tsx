'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Checkbox, Input, Select, Space, Table, Tag, Typography, Upload } from 'antd';
import type { TableColumnsType } from 'antd';
import * as XLSX from 'xlsx';
import { useCalculatorContext } from '../shared/CalculatorContext';
import { normalizeState } from '../../data/calculatorState';
import { ALL_PLATFORMS, PLATFORM_NAMES } from '../../domain/core';
import { PLATFORM_FEE_FIELDS } from '../../domain/platformFeeFields';
import { importBackendTable } from '../../domain/backendTableImport';
import { applyBackendSnapshot, backendSyncRecordStatus, compareBackendSnapshot, parseBackendSnapshot, revertBackendSync, type BackendDifference, type BackendItem, type BackendSnapshot, type BackendSyncRecord } from '../../domain/backendSync';
import type { CalculatorState, Platform } from '../../domain/types';

const localTime = (date = new Date()) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
function display(value: unknown): string {
  if (value === null || value === undefined) return '未单独配置';
  if (Array.isArray(value)) return value.length ? value.map(item => {
    const row = item as Record<string, unknown>;
    if ('discountRate' in row) return `${row.name}：${row.discountRate} 折（${row.enabled ? '启用' : '停用'}）`;
    if ('min' in row) return `满 ${row.threshold}，承担 ${row.min}–${row.max} 元（${row.enabled ? '启用' : '停用'}）`;
    return `${row.name ? `${row.name}：` : ''}满 ${row.threshold} 减 ${row.amount}${'merchantAmount' in row ? `，商家 ${row.merchantAmount}＋加码 ${row.merchantExtraAmount}，平台 ${row.platformAmount}` : ''}（${row.enabled ? '启用' : '停用'}）`;
  }).join('；') : '无活动（将清空该组）';
  return typeof value === 'boolean' ? value ? '上架' : '下架' : String(value);
}

export function BackendSyncPage() {
  const context = useCalculatorContext();
  const { calculatorState, setCalculatorState, store, dataRepository, persistenceMode } = context;
  const latest = useRef(calculatorState);
  latest.current = calculatorState;
  const { message, modal } = App.useApp();
  const [platform, setPlatform] = useState<Platform>('meituan');
  const [storeName, setStoreName] = useState(store.name);
  const [source, setSource] = useState('');
  const [observedAt, setObservedAt] = useState(localTime());
  const [expiresAt, setExpiresAt] = useState('');
  const [input, setInput] = useState('');
  const [items, setItems] = useState<BackendItem[]>([]);
  const [specialRules, setSpecialRules] = useState('');
  const [importedRules, setImportedRules] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [snapshot, setSnapshot] = useState<BackendSnapshot | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const differences = snapshot ? compareBackendSnapshot(calculatorState, store, snapshot) : [];
  const history = [...(store.backendSyncHistory || [])].reverse();

  useEffect(() => {
    setStoreName(store.name); setSource(''); setInput(''); setItems([]); setFileName('');
    setSpecialRules(''); setImportedRules([]); setSnapshot(null); setSelected([]); setReviewed(false); setError('');
  }, [store.id, platform]);
  useEffect(() => { setSnapshot(null); setSelected([]); setReviewed(false); }, [storeName, source, observedAt, expiresAt, items, specialRules, importedRules, input]);

  const importRows = (rows: Record<string, unknown>[]) => {
    // 导出表有身份列时必须与选择的平台及门店一致，不能忽略混合导出。
    for (const row of rows) {
      const declaredStore = row['门店名称'] ?? row['门店'];
      if (declaredStore && String(declaredStore).replace(/\s/g, '') !== storeName.replace(/\s/g, '')) throw new Error('导出表门店名称与所填后台门店不一致，请分店导出。');
      const declaredPlatform = row['平台'];
      const aliases = { meituan: ['美团', 'meituan'], eleme: ['饿了么', '淘宝闪购', 'eleme'], jingdong: ['京东', '京东外卖', '京东秒送', 'jingdong'] };
      if (declaredPlatform && !aliases[platform].includes(String(declaredPlatform))) throw new Error('导出表平台与当前选择不一致，请分平台导出。');
    }
    const result = importBackendTable(rows);
    if (!result.items.length) throw new Error('没有取得可核对数据。空白值不会按 0 同步。');
    setItems(result.items); setImportedRules(result.unsupportedRules); setError('');
  };
  const importFile = async (file: File) => {
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('请使用 2 MB 以内的分店导出文件。');
      if (file.name.toLowerCase().endsWith('.json')) {
        const parsed = parseBackendSnapshot(JSON.parse(await file.text()));
        if (parsed.platform !== platform) throw new Error('请先选择文件所属平台，再重新导入文件。');
        setStoreName(parsed.storeName); setSource(parsed.source);
        setObservedAt(localTime(new Date(parsed.observedAt))); setExpiresAt(parsed.expiresAt?.slice(0, 10) || '');
        setItems(parsed.items); setImportedRules(parsed.unsupportedRules);
      } else {
        const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
        const rows = book.SheetNames.flatMap(name => XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[name], { defval: '', raw: false }));
        importRows(rows);
      }
      setFileName(file.name); setInput(''); setError('');
    } catch (error) { setError((error as Error).message); setItems([]); }
    return false;
  };
  const importPaste = () => {
    try {
      if (!input.trim()) throw new Error('请先粘贴后台表格。');
      if (input.trim().startsWith('{')) {
        const parsed = parseBackendSnapshot(JSON.parse(input));
        if (parsed.platform !== platform) throw new Error('粘贴数据的平台不一致，请先切换平台。');
        setStoreName(parsed.storeName); setSource(parsed.source); setObservedAt(localTime(new Date(parsed.observedAt)));
        setExpiresAt(parsed.expiresAt?.slice(0, 10) || ''); setItems(parsed.items); setImportedRules(parsed.unsupportedRules);
      } else {
        const book = XLSX.read(input, { type: 'string', raw: true });
        importRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(book.Sheets[book.SheetNames[0]], { defval: '' }));
      }
      setFileName('粘贴的后台数据'); setError('');
    } catch (error) { setError((error as Error).message); setItems([]); }
  };
  const downloadTemplate = () => {
    const rows = PLATFORM_FEE_FIELDS.map(([, label]) => ({ 类别: '费用', 项目: label, 后台值: '', 商品名称: '', 商家商品编码: '', 名称: '', 门槛: '', 金额: '', 状态: '' }));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), '费用');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 商品名称: '', 商家商品编码: '', 售价: '', 包装费: '', 上架状态: '' }]), '商品');
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ 类别: '', 名称: '', 门槛: '', 金额: '', 状态: '', 商品关键字: '', 折扣: '', 件数上限: '', 最低承担: '', 最高承担: '', 券类型: '', 商家承担: '', 商家加码: '', 平台承担: '', 可叠加大额券: '', 发放渠道: '', 适用人群: '', 可叠加其他订单券: '', 后台核对备注: '' }]), '活动');
    XLSX.writeFile(book, '后台核对空白模板.xlsx');
  };
  const preview = () => {
    try {
      const next = parseBackendSnapshot({ version: 1, platform, storeName, source, observedAt: new Date(observedAt).toISOString(),
        expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : undefined,
        unsupportedRules: [...importedRules, ...specialRules.split('\n').map(item => item.trim()).filter(Boolean)], items });
      setSnapshot(next); setSelected([]); setReviewed(false); setError('');
    } catch (error) { setError((error as Error).message); }
  };
  const persist = async (next: CalculatorState) => {
    setSaving(true);
    try {
      const normalized = normalizeState(next);
      await dataRepository.saveCalculatorState(normalized);
      setCalculatorState(normalized);
      setSelected([]); setReviewed(false);
      message.success('已保存核对结果，请重新运行测算。');
    } catch { throw new Error(`保存到${persistenceMode === 'backend' ? '工具后台' : '当前浏览器'}失败，当前配置未更新，请重试。`); }
    finally { setSaving(false); }
  };
  const confirmSync = () => {
    if (!snapshot || !reviewed || !selected.length) return;
    const approved = differences.filter(row => selected.includes(row.key));
    modal.confirm({ title: `同步 ${PLATFORM_NAMES[platform]} · ${store.name} 的 ${approved.length} 项数据`,
      content: <Space direction="vertical"><Typography.Text>仅更新所选项目。活动组会以本次导出列表替换；未导出的项目保留。</Typography.Text>{approved.map(row => <Typography.Text key={row.key}>{row.label}：{display(row.before)} → {display(row.after)}</Typography.Text>)}</Space>,
      okText: '确认同步到测算工具', cancelText: '返回核对',
      onOk: async () => {
        try {
          if (latest.current.selectedStoreId !== store.id) throw new Error('当前门店已切换，请重新核对。');
          await persist(applyBackendSnapshot(latest.current, store.id, snapshot, selected, approved));
        }
        catch (error) { message.error((error as Error).message); throw error; }
      }
    });
  };
  const confirmRevert = (record: BackendSyncRecord) => modal.confirm({ title: '撤回此次同步',
    content: '恢复此次同步前的参数；如项目后来又被修改，将阻止撤回，避免覆盖新数据。', okText: '确认撤回', cancelText: '取消',
    onOk: async () => { try { await persist(revertBackendSync(latest.current, store.id, record.id)); } catch (error) { message.error((error as Error).message); throw error; } }
  });
  const columns: TableColumnsType<BackendDifference> = [
    { title: '项目', dataIndex: 'label', width: 200 },
    { title: '工具当前值', dataIndex: 'before', render: display },
    { title: '后台值', dataIndex: 'after', render: display },
    { title: '核对结果', render: (_, row) => <Space direction="vertical"><Tag color={row.status === 'same' ? 'green' : row.status === 'blocked' ? 'red' : 'orange'}>{row.status === 'same' ? '一致' : row.status === 'blocked' ? '不可同步' : '有差异'}</Tag>{row.reason && <Typography.Text type="danger">{row.reason}</Typography.Text>}</Space> }
  ];
  return <div className="section-stack">
    <Card title="后台核对与同步">
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text>当前工具门店：{store.name}。从已登录的商家后台导出文件或复制表格，在此对比商品、费用、活动和红包规则，再选择同步。</Typography.Text>
        <Alert type="info" showIcon message="文件在本地解析，不需要平台账号密码" description="当前不直接连接平台后台。核对结果跟随工具当前保存方式存储；请填写无登录凭证的来源路径。各店各平台独立同步，不修改商家后台。" />
        <Space wrap><Typography.Text>平台</Typography.Text><Select value={platform} onChange={setPlatform} options={ALL_PLATFORMS.map(value => ({ value, label: value === 'eleme' ? '淘宝闪购 / 饿了么' : PLATFORM_NAMES[value] }))} style={{ width: 190 }} />
          <Button onClick={downloadTemplate}>下载核对模板</Button><Upload accept=".xlsx,.xls,.csv,.json" showUploadList={false} beforeUpload={importFile} disabled={saving}><Button>导入后台导出文件</Button></Upload></Space>
        <label>后台门店名称<Input value={storeName} onChange={event => setStoreName(event.target.value)} /></label>
        <label>来源／后台菜单路径<Input value={source} placeholder="例如：财务管理 → 费用规则；或活动中心 → 活动详情" onChange={event => setSource(event.target.value)} /></label>
        <Space wrap><label>采集时间<Input type="datetime-local" value={observedAt} onChange={event => setObservedAt(event.target.value)} /></label><label>规则有效至（可选）<Input type="date" value={expiresAt} onChange={event => setExpiresAt(event.target.value)} /></label></Space>
        <Input.TextArea value={input} onChange={event => setInput(event.target.value)} rows={5} placeholder="粘贴带表头的后台表格。商品表支持：商品名称、商家商品编码、售价、包装费、上架状态；费用表支持：类别、项目、后台值。" />
        <Space wrap><Button onClick={importPaste}>读取粘贴内容</Button><Typography.Text type="secondary">{fileName ? `${fileName} · 已取得 ${items.length} 项` : '尚未读取数据'}</Typography.Text></Space>
        <Typography.Text type="secondary">空白值不覆盖配置。费用按模板项目填写；活动类别支持满减、订单券、红包加码、商品折扣、基础红包和京东补贴券，状态必须明确。只导出同一门店、同一平台的完整活动组；订单券及基础红包金额须为商家承担。</Typography.Text>
        <label>不同于当前模型的特殊规则（每行一项）<Input.TextArea value={specialRules} onChange={event => setSpecialRules(event.target.value)} rows={2} placeholder="例如：折扣商品不能与满减同享；佣金按优惠前商品额计算。此类规则会阻止同步，需先调整测算模型。" /></label>
        <Button type="primary" disabled={!items.length || saving} onClick={preview}>排查差异</Button>
        {error && <Alert type="error" showIcon message={error} />}
      </Space>
    </Card>
    {snapshot && <Card title={`差异预览 · ${snapshot.storeName} · ${PLATFORM_NAMES[snapshot.platform]}`}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Typography.Text>来源：{snapshot.source}；采集：{new Date(snapshot.observedAt).toLocaleString('zh-CN')}。一致 {differences.filter(row => row.status === 'same').length} 项，有差异 {differences.filter(row => row.status === 'change').length} 项，不可同步 {differences.filter(row => row.status === 'blocked').length} 项。</Typography.Text>
        <Alert type="warning" showIcon message="同步活动列表会替换该平台对应的整组活动" description="只提交后台已生效且完整导出的活动组。未导出的商品和项目不会自动下架或清空；商品名称重名时须提供工具商品 ID 或商家商品编码。" />
        <Table size="small" rowKey={row => `${row.key}:${differences.indexOf(row)}`} columns={columns} dataSource={differences} pagination={false} scroll={{ x: 850 }} rowSelection={{ selectedRowKeys: differences.filter(row => selected.includes(row.key)).map(row => `${row.key}:${differences.indexOf(row)}`), onChange: (_, rows) => { setSelected(rows.map(row => row.key)); setReviewed(false); }, getCheckboxProps: row => ({ disabled: row.status !== 'change' || saving }) }} />
        <Checkbox checked={reviewed} onChange={event => setReviewed(event.target.checked)}>已核对门店、平台、有效期、分摊金额及活动列表完整性，以上所选项目与后台一致</Checkbox>
        <Button type="primary" loading={saving} disabled={!reviewed || !selected.length} onClick={confirmSync}>同步所选 {selected.length} 项到测算工具</Button>
      </Space>
    </Card>}
    <Card title="本店同步记录">
      <Table size="small" rowKey="id" dataSource={history} pagination={{ pageSize: 5 }} scroll={{ x: 760 }} columns={[
        { title: '同步时间', dataIndex: 'appliedAt', render: value => new Date(value).toLocaleString('zh-CN') },
        { title: '平台', dataIndex: 'platform', render: (value: Platform) => PLATFORM_NAMES[value] },
        { title: '来源', dataIndex: 'source' }, { title: '项目', render: (_, record) => record.changes.map(row => row.label).join('；') },
        { title: '状态', render: (_, record) => {
          const status = backendSyncRecordStatus(store, record);
          return <Space direction="vertical"><Tag color={status === 'current' ? 'green' : status === 'changed' ? 'orange' : undefined}>{status === 'reverted' ? '已撤回' : status === 'current' ? '现值与此次记录一致' : '同步后有变更，需复核'}</Tag>{status !== 'reverted' && <Button disabled={saving || status === 'changed'} onClick={() => confirmRevert(record)}>撤回此次同步</Button>}</Space>;
        } }
      ]} />
    </Card>
  </div>;
}
