import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { useAuthStore } from '../auth/useAuthStore';

/**
 * 改密页。`forced` = 首登强制改密（`must_change_password`），改完才放行主应用。
 */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const changePassword = useAuthStore((state) => state.changePassword);
  const logout = useAuthStore((state) => state.logout);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="auth-state">
      <Card style={{ width: 420 }} data-testid="change-password-page">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            {forced ? '首次登录 · 请修改初始密码' : '修改密码'}
          </Typography.Title>
          {forced ? (
            <Typography.Text type="secondary">
              当前使用的是厂长分配的初始密码，请设置自己的密码后继续。
            </Typography.Text>
          ) : null}
        </Space>
        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} /> : null}
        <Form
          layout="vertical"
          style={{ marginTop: 12 }}
          onFinish={async (values: {
            old_password: string;
            new_password: string;
            confirm_password: string;
          }) => {
            setSubmitting(true);
            setError(undefined);
            try {
              await changePassword(values.old_password, values.new_password);
              if (forced) window.location.replace('/');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item
            name="old_password"
            label="当前密码"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item
            name="new_password"
            label="新密码"
            rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '至少 8 位' }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认新密码"
            dependencies={['new_password']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator: (_rule, value) =>
                  !value || getFieldValue('new_password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Space style={{ width: '100%' }} direction="vertical" size={8}>
            <Button type="primary" htmlType="submit" block loading={submitting}>
              保存并继续
            </Button>
            {forced ? (
              <Button type="link" block onClick={() => void logout()}>
                换个账号登录
              </Button>
            ) : null}
          </Space>
        </Form>
      </Card>
    </div>
  );
}
