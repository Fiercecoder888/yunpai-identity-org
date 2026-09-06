import { Typography } from 'antd';
import { DataFlowPanel } from '../features/business-flow/DataFlowPanel';

export function QualitySupervisionPage() {
  return (
    <section className="quality-supervision-page" aria-labelledby="quality-supervision-title">
      <div className="role-shell-heading quality-supervision-heading">
        <Typography.Title id="quality-supervision-title" level={2}>全流程监督</Typography.Title>
        <Typography.Text type="secondary">
          选择订单查看 M1 至 M5 实时进度；点击流程卡片可查看对应任务、异常和历史记录。
        </Typography.Text>
      </div>
      <DataFlowPanel readOnly initiallyExpanded />
    </section>
  );
}
