'use client';

import { Button, Card, Form, Input, Space, Typography } from 'antd';

const { Text, Title } = Typography;

type BackendLoginPanelProps = {
  loading: boolean;
  onLogin: (username: string, password: string) => Promise<void>;
  onUseLocalMode: () => void;
};

/**
 * 后台模式登录面板，登录成功后继续使用统一计算器页面。
 */
export function BackendLoginPanel({ loading, onLogin, onUseLocalMode }: BackendLoginPanelProps) {
  return (
    <div className="backend-login-wrap">
      <Card className="backend-login-card">
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <div>
            <Title level={3}>后台模式登录</Title>
            <Text type="secondary">登录后，门店、商品、活动配置和测算缓存会保存到后台数据库。</Text>
          </div>
          <Form
            layout="vertical"
            initialValues={{ username: 'admin' }}
            onFinish={values => onLogin(String(values.username || ''), String(values.password || ''))}
          >
            <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input autoComplete="username" />
            </Form.Item>
            <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password autoComplete="current-password" />
            </Form.Item>
            <Space wrap>
              <Button type="primary" htmlType="submit" loading={loading}>登录后台</Button>
              <Button onClick={onUseLocalMode}>返回本地模式</Button>
            </Space>
          </Form>
        </Space>
      </Card>
    </div>
  );
}
