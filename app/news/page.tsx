import type { Metadata } from 'next';
import { PlatformNewsPage } from '@/src/components/news/PlatformNewsPage';

export const metadata: Metadata = { title: '平台动态 · 饭团店经营观察', description: '面向弘金饭团与井弘饭团的外卖政策变化、来源与经营建议。' };

export default function Page() {
  return <PlatformNewsPage />;
}
