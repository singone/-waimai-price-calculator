import type { Metadata } from 'next';
import { SiteGuidePage } from '@/src/components/guide/SiteGuidePage';

export const metadata: Metadata = {
  title: '网站地图与说明 · 外卖门店活动测算工具',
  description: '当前功能、使用流程、三平台后台差异与后续开发任务。'
};

export default function Page() {
  return <SiteGuidePage />;
}
