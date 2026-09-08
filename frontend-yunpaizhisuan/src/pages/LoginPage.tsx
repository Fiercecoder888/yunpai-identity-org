import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { useAuthStore } from '../auth/useAuthStore';
import { roleLandingConfigById } from '../features/roles/roleConfig';

/** 登录后按角色跳落地页（多角色取第一个有落地配置的）。 */
export const landingPathForRoles = (roles: readonly string[]): string => {
  for (const role of roles) {
    const config = roleLandingConfigById[role];
    if (config) return config.landingPath;
  }
  return '/';
};

export function LoginPage() {
  const login = useAuthStore((state) => state.login);
  const companyName = useAuthStore((state) => state.companyName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="auth-state">
      <Card style={{ width: 380 }} data-testid="login-page">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {companyName ? `${companyName} · 登录` : '云湃智算 · 登录'}
          </Typography.Title>
          <Typography.Text type="secondary">请使用厂长分配的账号登录</Typography.Text>
        </Space>
        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} /> : null}
        <Form
          layout="vertical"
          style={{ marginTop: 12 }}
          onFinish={async (values: { user_id: string; password: string }) => {
            setSubmitting(true);
            setError(undefined);
            try {
              const me = await login(values.user_id.trim(), values.password);
              window.location.replace(landingPathForRoles(me.roles));
            } catch (submitError) {
              setError(submitError instanceof Error ? submitError.message : '登录失败');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item name="user_id" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input autoComplete="username" placeholder="工号 / 账号" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password autoComplete="current-password" placeholder="密码" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
