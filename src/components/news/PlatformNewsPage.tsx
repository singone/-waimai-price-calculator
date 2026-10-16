'use client';

import { useState } from 'react';
import { observationStatus, platformNews } from '../../data/platformNews';
import styles from './PlatformNewsPage.module.css';

const platforms = ['全部平台', '美团', '饿了么 / 淘宝闪购', '京东外卖'];
const topics = ['全部主题', '平台抽佣', '配送补贴', '优惠券叠加', '满减活动', '定价规则', '流量扶持'];

export function PlatformNewsPage() {
  const [platform, setPlatform] = useState('全部平台');
  const [topic, setTopic] = useState('全部主题');
  const [query, setQuery] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const news = platformNews.filter(item =>
    (platform === '全部平台' || item.platform === platform) &&
    (topic === '全部主题' || item.topic === topic) &&
    (!pendingOnly || item.checks.length > 0) &&
    `${item.title} ${item.summary} ${item.scope} ${item.platform} ${item.topic}`.toLowerCase().includes(query.trim().toLowerCase())
  );

  return <div className={styles.page}>
    <header className={styles.hero}>
      <div className={styles.eyebrow}>经营观察 / PLATFORM WATCH</div>
      <h1>平台在变，<br />每一单的利润要看清。</h1>
      <p>弘金饭团 · 井弘饭团 <span>面向饭团店的外卖政策与经营建议</span></p>
      <div className={styles.period}>首期观察　2026.10.03 — 10.10　<span>资料截至 2026.10.10 · 非实时更新</span></div>
    </header>

    <section aria-label="平台观察状态" className={styles.statusGrid}>
      {observationStatus.map(item => <div className={styles.status} key={item.platform}>
        <strong>{item.platform}</strong><p>{item.text}</p>
        <a href={item.source} target="_blank" rel="noopener noreferrer">进入商家后台（需登录） ↗</a>
      </div>)}
    </section>
    <p className={styles.notice}>本次已读取三个平台的弘金饭团钱江世纪城店后台，井弘店尚未核查。区分平台公告、门店活动通知及当前功能观察；活动创建或审核通过不等于当前生效。费用、资格与叠加规则以完整规则及账单为准。</p>

    <section className={styles.list} aria-label="新闻列表">
      <div className={styles.heading}><h2>后台动态与经营观察</h2><span>公告、门店通知与功能观察分别标注</span></div>
      <div className={styles.filters}>
        <label>平台<select value={platform} onChange={e => setPlatform(e.target.value)}>{platforms.map(value => <option key={value}>{value}</option>)}</select></label>
        <label>主题<select value={topic} onChange={e => setTopic(e.target.value)}>{topics.map(value => <option key={value}>{value}</option>)}</select></label>
        <label className={styles.search}>关键词<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索政策、套餐或地区" /></label>
        <label className={styles.checkbox}><input type="checkbox" checked={pendingOnly} onChange={e => setPendingOnly(e.target.checked)} />仅看后台待确认</label>
      </div>
      <p className={styles.count} role="status">共 {news.length} 条变化</p>
      {news.map(item => <article className={styles.card} key={item.id}>
        <div className={styles.meta}><span>{item.platform}</span><span>{item.topic}</span><time dateTime={item.date}>{item.dateLabel || '发布于'} {item.date}</time></div>
        <h3>{item.title}</h3><p className={styles.scope}>{item.scope}</p><p className={styles.summary}>{item.summary}</p>
        <div className={styles.impacts}>{item.impacts.map(impact => <div key={impact.label}><h4>{impact.label}</h4><p>{impact.text}</p></div>)}</div>
        <div className={styles.action}><strong>建议行动</strong><p>{item.action}</p></div>
        <details className={styles.details}><summary>需商家后台确认 · {item.checks.length} 项</summary><ul>{item.checks.map(check => <li key={check}>{check}</li>)}</ul></details>
        {item.sourcePath && <p className={styles.scope}>后台查阅路径：{item.sourcePath}</p>}
        <footer className={styles.source}><span>{item.verification || '政府公告 · 已核实公开内容'}</span><a href={item.source.url} target="_blank" rel="noopener noreferrer">{item.source.name} ↗</a></footer>
      </article>)}
      {news.length === 0 && <div className={styles.empty}><h3>当前筛选下暂无已核实变化</h3><p>不以旧闻填充列表；可清除筛选查看本期全部内容。</p><button onClick={() => { setPlatform('全部平台'); setTopic('全部主题'); setQuery(''); setPendingOnly(false); }}>清除筛选</button></div>}
    </section>
    <footer className={styles.bottom}>每周一经营简报 · 关注收入、毛利、获客与复购<br />本页承接首期整理结果，定时简报尚未自动同步到网页。</footer>
  </div>;
}
