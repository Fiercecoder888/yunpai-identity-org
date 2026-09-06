import { Alert, Descriptions, Empty, Space, Table, Tabs, Tag, Typography } from 'antd';
import type {
  M0AgentEvidence,
  M0AgentState,
  M0AgentTraceEntry,
  M0Document,
} from '../../services/m0Api';

const parseObject = <T extends Record<string, unknown>>(raw: string | undefined): T | null => {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
};

const parseArray = <T extends Record<string, unknown>>(raw: string | undefined): T[] => {
  if (!raw?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is T => item !== null && typeof item === 'object' && !Array.isArray(item))
      : [];
  } catch {
    return [];
  }
};

const jsonText = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
};

const inlineValue = (value: unknown) => {
  const text = jsonText(value);
  return text.length > 240 ? `${text.slice(0, 240)}...` : text;
};

export const hasM0AgentData = (document: M0Document) => {
  const state = document.agent_state?.trim();
  return Boolean(state && state !== '{}');
};

const FactTable = ({ rows, emptyText }: { rows: Array<Record<string, unknown>>; emptyText: string }) => (
  <Table
    rowKey={(row) => JSON.stringify(row)}
    size="small"
    pagination={false}
    dataSource={rows}
    locale={{ emptyText }}
    columns={[
      {
        title: '名称',
        key: 'name',
        width: 180,
        render: (_value: unknown, row: Record<string, unknown>) =>
          String(row.name ?? row.kind ?? row.object_type ?? row.question ?? '-'),
      },
      {
        title: '内容',
        key: 'value',
        render: (_value: unknown, row: Record<string, unknown>) => (
          <Typography.Text style={{ whiteSpace: 'pre-wrap' }}>
            {inlineValue(row.value ?? row.attributes ?? row.reason ?? row)}
          </Typography.Text>
        ),
      },
      {
        title: '证据',
        dataIndex: 'evidence_ids',
        key: 'evidence_ids',
        width: 180,
        render: (ids: unknown) =>
          Array.isArray(ids) && ids.length > 0
            ? ids.map((id) => <Tag key={String(id)}>{String(id)}</Tag>)
            : '-',
      },
    ]}
  />
);

export function AgentEvidencePanel({ document }: { document: M0Document }) {
  const state = parseObject<M0AgentState>(document.agent_state);
  if (!state) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="该文档没有 Agent 运行记录" />;
  }

  const trace = parseArray<M0AgentTraceEntry>(document.agent_trace);
  const evidence = Array.isArray(state.evidence) ? state.evidence : [];
  const proposedSchema =
    parseObject<Record<string, unknown>>(document.proposed_schema) ?? state.proposed_schema ?? {};
  const reviewReasons = Array.isArray(state.review_reasons) ? state.review_reasons : [];
  const confidence = typeof state.confidence === 'number' ? `${Math.round(state.confidence * 100)}%` : '-';

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {reviewReasons.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="需要人工审核"
          description={reviewReasons.join('；')}
        />
      ) : null}
      <Descriptions size="small" column={3} bordered>
        <Descriptions.Item label="内容类型">
          {state.document_kind || document.document_kind || '动态文档'}
        </Descriptions.Item>
        <Descriptions.Item label="模型">{state.model_name || '-'}</Descriptions.Item>
        <Descriptions.Item label="模型层级">{state.model_level ?? '-'}</Descriptions.Item>
        <Descriptions.Item label="置信度">{confidence}</Descriptions.Item>
        <Descriptions.Item label="Agent 状态">
          <Tag color={state.status === 'complete' ? 'green' : 'gold'}>{state.status || '-'}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="兼容入库适配器">
          {state.compatibility_domain || '通用动态文档'}
        </Descriptions.Item>
      </Descriptions>
      {state.document_summary ? (
        <Typography.Paragraph style={{ marginBottom: 0 }}>{state.document_summary}</Typography.Paragraph>
      ) : null}
      <Tabs
        items={[
          {
            key: 'understanding',
            label: '理解结果',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Typography.Text strong>内容假设</Typography.Text>
                <FactTable rows={state.content_hypotheses ?? []} emptyText="没有内容假设" />
                <Typography.Text strong>已确认事实</Typography.Text>
                <FactTable rows={state.known_facts ?? []} emptyText="没有已确认事实" />
                <Typography.Text strong>未知项与不确定性</Typography.Text>
                <FactTable
                  rows={[...(state.unknowns ?? []), ...(state.uncertainties ?? [])]}
                  emptyText="没有未解决项"
                />
              </Space>
            ),
          },
          {
            key: 'evidence',
            label: `证据 (${evidence.length})`,
            children: (
              <Table<M0AgentEvidence>
                rowKey={(row) => row.id || JSON.stringify(row)}
                size="small"
                pagination={false}
                dataSource={evidence}
                columns={[
                  { title: 'ID', dataIndex: 'id', key: 'id', width: 90 },
                  { title: '工具', dataIndex: 'tool', key: 'tool', width: 190 },
                  { title: '类型', dataIndex: 'kind', key: 'kind', width: 170 },
                  { title: '摘要', dataIndex: 'summary', key: 'summary' },
                  {
                    title: '位置',
                    dataIndex: 'locator',
                    key: 'locator',
                    width: 220,
                    render: (value: unknown) => inlineValue(value),
                  },
                ]}
                expandable={{
                  expandedRowRender: (row) => (
                    <pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 360, overflow: 'auto' }}>
                      {jsonText(row.payload)}
                    </pre>
                  ),
                  rowExpandable: (row) => row.payload !== undefined,
                }}
              />
            ),
          },
          {
            key: 'trace',
            label: `工具轨迹 (${trace.length})`,
            children: (
              <Table<M0AgentTraceEntry>
                rowKey={(row) => JSON.stringify(row)}
                size="small"
                pagination={false}
                dataSource={trace.length > 0 ? trace : state.tool_history ?? []}
                columns={[
                  { title: '步', dataIndex: 'step', key: 'step', width: 60 },
                  { title: '动作', dataIndex: 'action', key: 'action', width: 150 },
                  { title: '工具/查询', key: 'tool', width: 220, render: (_, row) => row.tool || row.query || row.model || '-' },
                  { title: '原因', dataIndex: 'reason', key: 'reason' },
                  {
                    title: '结果',
                    key: 'status',
                    width: 170,
                    render: (_, row) => (
                      <Tag color={row.status === 'ok' ? 'green' : row.status === 'failed' ? 'red' : 'gold'}>
                        {row.error || row.status || '-'}
                      </Tag>
                    ),
                  },
                ]}
              />
            ),
          },
          {
            key: 'schema',
            label: '动态 Schema',
            children: (
              <pre style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 520, overflow: 'auto' }}>
                {jsonText(proposedSchema)}
              </pre>
            ),
          },
        ]}
      />
    </Space>
  );
}
