import { Alert, Space, Tag, Typography, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { M2ArtifactButton } from '../features/m2/M2ArtifactButton';
import { M2WorkflowPanel } from '../features/m2/M2WorkflowPanel';
import { SopFlowSheet, type SopFlowSheetStep } from '../features/m2/SopFlowSheet';
import { loadM2ParsedSop } from '../features/m2/m2Workflow';
import { useM2Workflow } from '../features/m2/useM2Workflow';
import { EngineeringDocumentsCard } from '../features/m0/EngineeringDocumentsCard';

export function SopPage() {
  const m2 = useM2Workflow();
  const workflow = m2.workflow;
  const sop = workflow?.sop_generation;
  const parsedSopPath = workflow?.artifacts.sop_parsed_sop_json ?? sop?.artifacts.parsed_sop_json;
  const parsedSopQuery = useQuery({
    queryKey: ['m2', 'parsed-sop', parsedSopPath],
    queryFn: () => loadM2ParsedSop(parsedSopPath as string),
    enabled: Boolean(parsedSopPath),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const normalizedSteps = sop?.model.normalization?.shape_normalization ?? [];
  const parsedSteps = parsedSopQuery.data?.step_slots ?? [];
  const steps = parsedSteps.length > 0 ? parsedSteps : normalizedSteps.map((step, index) => ({
    slot_no: index + 1,
    title: step.name,
    description: '',
    visual_type: step.rendered_shape === 'diamond' ? 'inspection' : 'process',
  }));
  const timeRowsByAction = new Map((parsedSopQuery.data?.ie_time_study_rows ?? []).map((row) => [row.action, row]));
  const flowSteps: SopFlowSheetStep[] = steps.map((step, index) => {
    const timeRow = timeRowsByAction.get(step.title);
    return {
      key: `${step.slot_no}-${step.title}-${index}`,
      title: step.title,
      description: step.description,
      visualType: step.visual_type,
      machineModel: timeRow?.machine_model,
      standardTime: timeRow?.standard_time_s ? `${timeRow.standard_time_s} 秒` : undefined,
    };
  });

  return (
    <div className="page-stack">
      <M2WorkflowPanel
        mode="sop"
        loading={m2.isRunning}
        onRun={async (values) => {
          await m2.run(values);
          void message.success('M2 已生成 SOP 工程草稿');
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

      {!workflow ? (
        <Alert
          className="stacked-card"
          type="info"
          showIcon
          message="尚未生成 SOP"
          description="填写 SOP 参数并生成后，本页将按工程流程图样式展示工序。"
        />
      ) : null}

      {workflow && !sop ? (
        <Alert
          className="stacked-card"
          type="warning"
          showIcon
          message="当前工作流未生成 SOP"
          description="M2 在前置输入不足时会停止 SOP 生成，请补充参数后重新运行。"
        />
      ) : null}

      {sop ? (
        <>
          <div className="page-heading stacked-card">
            <div>
              <Typography.Title level={4}>SOP 工艺流程图</Typography.Title>
              <Space>
                <Tag color="warning">{sop.status}</Tag>
                <Typography.Text type="secondary">{sop.run_id}</Typography.Text>
              </Space>
            </div>
            <Space wrap>
              <M2ArtifactButton label="下载 SOP Word" path={workflow.artifacts.sop_docx ?? sop.artifacts.document_docx} />
              <M2ArtifactButton label="下载流程图 PNG" path={workflow.artifacts.sop_center_flowchart_png ?? sop.artifacts.center_flowchart_png} />
              <M2ArtifactButton label="下载 SOP 结构化 JSON" path={workflow.artifacts.sop_parsed_sop_json ?? sop.artifacts.parsed_sop_json} />
              <M2ArtifactButton label="下载格式校验 JSON" path={workflow.artifacts.sop_format_check_json ?? sop.artifacts.format_check_json} />
            </Space>
          </div>
          <Alert
            className="stacked-card"
            type="warning"
            showIcon
            message="SOP 为工程草稿，不可直接发布"
            description={sop.ai_boundary || '现场 IE 工时、设备状态、EHS、试产结果和人工签核仍需业务人员确认。'}
          />
          {parsedSopQuery.isError ? (
            <Alert
              className="stacked-card"
              type="warning"
              showIcon
              message="SOP 结构化制品读取失败"
              description="页面已回退到工作流响应中的流程节点，SOP 制品仍可下载。"
            />
          ) : null}
          {flowSteps.length > 0 ? (
            <SopFlowSheet productName={sop.product_name} documentNo={sop.document_no} station={sop.station} steps={flowSteps} />
          ) : (
            <Alert className="stacked-card" type="warning" showIcon message="M2 未返回 SOP 流程节点" />
          )}
        </>
      ) : null}

      <EngineeringDocumentsCard
        className="stacked-card"
        title="工位工程文档"
        description="按工位所生产物料/产品查询已绑定的工程图纸与工艺/测试方法文档，可在线预览。"
      />
    </div>
  );
}
