import type { Metadata } from 'next';
import 'antd/dist/reset.css';
import './globals.css';

export const metadata: Metadata = {
  title: '外卖门店活动测算工具',
  description: '按门店维护商品、平台活动和利润率阶梯，测算组合利润并导出结果。'
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
