import { Alert, Button, Card, Form, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { useAuthStore } from '../auth/useAuthStore';
import { landingPathForRoles } from './LoginPage';

/**
 * 厂长自助注册（全系统唯一一次）。
 *
 * 只有系统还没有任何账号时才会被 `AuthBoundary` 渲染；注册成功后自动登录，
 * 该账号同时绑 factory-director + org-admin（业务总控 + 组织管理员）。
 */
export function RegisterAdminPage() {
  const registerAdmin = useAuthStore((state) => state.registerAdmin);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();

  return (
    <div className="auth-state">
      <Card style={{ width: 460 }} data-testid="register-admin-page">
        <Space direction="vertical" size={4} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            首次使用 · 厂长注册
          </Typography.Title>
          <Typography.Text type="secondary">
            系统尚未初始化。厂长注册后，由厂长在「账号管理」里给员工分配账号。
          </Typography.Text>
        </Space>
        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} /> : null}
        <Form
          layout="vertical"
          style={{ marginTop: 12 }}
          onFinish={async (values: {
            company_name: string;
            display_name: string;
            user_id: string;
            password: string;
            confirm_password: string;
          }) => {
            setSubmitting(true);
            setError(undefined);
            try {
              const me = await registerAdmin({
                company_name: values.company_name.trim(),
                display_name: values.display_name.trim(),
                user_id: values.user_id.trim(),
                password: values.password,
              });
              window.location.replace(landingPathForRoles(me.roles));
            } catch (submitError) {
              setError(submitError instanceof Error ? submitError.message : '注册失败');
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Form.Item
            name="company_name"
            label="公司 / 工厂名称"
            rules={[{ required: true, message: '请输入公司名称' }]}
          >
            <Input placeholder="如 桐庐云湃电子有限公司" />
          </Form.Item>
          <Form.Item name="display_name" label="你的姓名" rules={[{ required: true, message: '请输入姓名' }]}>
            <Input placeholder="如 陈厂长" />
          </Form.Item>
          <Form.Item
            name="user_id"
            label="登录账号"
            rules={[
              { required: true, message: '请输入账号' },
              { pattern: /^[A-Za-z0-9_.@-]{3,64}$/, message: '字母/数字/_ . @ -，长度 3~64' },
            ]}
          >
            <Input autoComplete="username" placeholder="如 boss" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}
          >
            <Input.Password autoComplete="new-password" placeholder="至少 8 位" />
          </Form.Item>
          <Form.Item
            name="confirm_password"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入密码' },
              ({ getFieldValue }) => ({
                validator: (_rule, value) =>
                  !value || getFieldValue('password') === value
                    ? Promise.resolve()
                    : Promise.reject(new Error('两次输入的密码不一致')),
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" placeholder="再输一次" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting}>
            注册并进入系统
          </Button>
        </Form>
      </Card>
    </div>
  );
}
