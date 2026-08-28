'use client';

import React from 'react';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { CalculatorAppContainer } from './CalculatorAppContainer';

/**
 * 统一挂载 Ant Design 配置和计算器应用容器。
 */
export default function CalculatorAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#d95b18', borderRadius: 8 } }}>
      <AntApp>
        <CalculatorAppContainer>{children}</CalculatorAppContainer>
      </AntApp>
    </ConfigProvider>
  );
}
