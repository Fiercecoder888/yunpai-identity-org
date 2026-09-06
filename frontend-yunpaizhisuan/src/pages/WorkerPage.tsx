import { Typography } from 'antd';
import { WorkerSection } from '../features/roles/WorkerSection';

export function WorkerPage() {
  return (
    <>
      <div className="role-shell-heading">
        <Typography.Title level={3} style={{ margin: 0 }}>工人工作台</Typography.Title>
        <Typography.Text type="secondary">输入工号查看你绑定的订单，并去对话页自然语言报工。</Typography.Text>
      </div>
      <WorkerSection />
    </>
  );
}
