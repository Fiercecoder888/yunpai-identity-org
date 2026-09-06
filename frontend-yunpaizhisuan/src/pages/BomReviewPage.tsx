import { Alert, Card, Descriptions, List, Space, Table, Tag, Typography, message } from 'antd';
import type { M2BomLine } from '../schemas/m2';
import { M2ArtifactButton } from '../features/m2/M2ArtifactButton';
import { M2WorkflowPanel } from '../features/m2/M2WorkflowPanel';
import { useM2Workflow } from '../features/m2/useM2Workflow';

export function BomReviewPage() {
  const m2 = useM2Workflow();
  const workflow = m2.workflow;
  const standardBom = workflow?.bom_generation?.standard_bom;
  const header = standardBom?.bom_header[0];
  const lines = standardBom?.bom_lines ?? [];

  return (
    <div className="page-stack">
      <M2WorkflowPanel
        mode="bom"
        loading={m2.isRunning}
        onRun={async (values) => {
          await m2.run(values);
          void message.success('M2 已生成 BOM 工程草稿');
        }}
      />

      {m2.error ? (
        <Alert
          className="stacked-card"
          type="error"
          showIcon
          message="M2 工作流执行失败"
          description={m2.error instanceof Error ? m2.error.message : '请检查 M2 服务。'}
        />
      ) : null}

      <Card
        className="stacked-card"
        title="受控 BOM 草稿"
        extra={
          workflow ? (
            <Space>
              <Tag color={workflow.status === 'draft_created' ? 'success' : 'warning'}>{workflow.status}</Tag>
              <Typography.Text type="secondary">{workflow.run_id}</Typography.Text>
            </Space>
          ) : null
        }
      >
        {!workflow ? (
          <Alert type="info" showIcon message="尚未生成 BOM" description="填写上方产品信息并运行 M2，页面将展示 standard_bom 的真实输出。" />
        ) : null}

        {header ? (
          <Descriptions className="stacked-card" bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
            <Descriptions.Item label="BOM 编号">{header.bom_id}</Descriptions.Item>
            <Descriptions.Item label="父项">{header.parent_item}</Descriptions.Item>
            <Descriptions.Item label="版本">{header.parent_revision}</Descriptions.Item>
            <Descriptions.Item label="状态">{header.status}</Descriptions.Item>
            <Descriptions.Item label="产品">{header.parent_name}</Descriptions.Item>
            <Descriptions.Item label="类型">{header.bom_type}</Descriptions.Item>
            <Descriptions.Item label="生效日期">{header.effective_from || '待确认'}</Descriptions.Item>
            <Descriptions.Item label="置信度">{header.confidence || '待确认'}</Descriptions.Item>
            <Descriptions.Item label="来源依据" span="filled">
              {header.source_basis || '未提供'}
            </Descriptions.Item>
          </Descriptions>
        ) : null}

        {workflow && lines.length === 0 ? (
          <Alert className="stacked-card" type="warning" showIcon message="M2 未返回 BOM 明细" description="请查看待补充问题或调整产品和模板输入后重新运行。" />
        ) : null}

        {lines.length > 0 ? (
          <Table<M2BomLine>
            className="stacked-card"
            rowKey={(row) => `${row.line_no}-${row.component_item}`}
            pagination={false}
            scroll={{ x: 1180 }}
            dataSource={lines}
            columns={[
              { title: '行号', dataIndex: 'line_no', width: 80 },
              { title: '物料编码', dataIndex: 'component_item', width: 160 },
              { title: '物料名称', dataIndex: 'component_name', width: 190 },
              { title: '数量', dataIndex: 'qty_per', width: 90 },
              { title: '单位', dataIndex: 'uom', width: 80 },
              { title: '类别', dataIndex: 'item_category', width: 120 },
              { title: '供应方式', dataIndex: 'supply_type', width: 100 },
              { title: '版本', dataIndex: 'component_revision', width: 90 },
              { title: '备注', dataIndex: 'notes', ellipsis: true },
            ]}
          />
        ) : null}

        {workflow ? (
          <Space className="stacked-card" wrap>
            <M2ArtifactButton label="下载 BOM Excel" path={workflow.artifacts.source_style_bom_xlsx} />
            <M2ArtifactButton label="下载 BOM 明细 CSV" path={workflow.artifacts.bom_lines_csv} />
            <M2ArtifactButton label="下载 BOM JSON" path={workflow.artifacts.bom_response_json} />
          </Space>
        ) : null}
      </Card>

      {workflow && workflow.open_customer_questions.length > 0 ? (
        <Card className="stacked-card" title={`待人工确认（${workflow.open_customer_questions.length}）`}>
          <List
            dataSource={workflow.open_customer_questions}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <Tag color={item.blocking ? 'error' : 'warning'}>{item.field || '待补充'}</Tag>
                      <Typography.Text>{item.question}</Typography.Text>
                    </Space>
                  }
                  description={item.reason || `来源：${item.source || 'M2'}`}
                />
              </List.Item>
            )}
          />
        </Card>
      ) : null}
    </div>
  );
}
