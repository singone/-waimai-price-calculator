'use client';

import React from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { WaimaiCalculatorInner } from './WaimaiCalculatorInner';

export default function WaimaiCalculator({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#d95b18', borderRadius: 8 } }}>
      <AntApp>
        <WaimaiCalculatorInner>{children}</WaimaiCalculatorInner>
      </AntApp>
    </ConfigProvider>
  );
}
