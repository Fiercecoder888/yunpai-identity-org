import { SearchOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  docTypeLabel,
  entityTypeLabel,
  listM0Documents,
  type M0DocumentWithBindings,
} from '../../services/m0DocumentsApi';
import { DocumentPreview } from './DocumentPreview';

type EngineeringDocumentsCardProps = {
  title?: string;
  description?: string;
  className?: string;
  defaultEntity?: { material?: string; product?: string; order?: string };
};

type QueryState = { material: string; product: string; order: string };

/**
 * 工程文档库：按物料/产品/订单绑定关系检索文档并预览。
 * 嵌入组长端首页、工位（SOP 页）与业务追溯工作台。
 */
export function EngineeringDocumentsCard({
  title = '工程文档库',
  description = '按物料 / 产品 / 订单查询已绑定的工程文档（图纸、工艺/包装/测试方法），可在线预览。',
  className,
  defaultEntity,
}: EngineeringDocumentsCardProps) {
  const [query, setQuery] = useState<QueryState>({
    material: defaultEntity?.material ?? '',
    product: defaultEntity?.product ?? '',
    order: defaultEntity?.order ?? '',
  });
  const [applied, setApplied] = useState<QueryState>({ ...query });
  const [form] = Form.useForm<QueryState>();

  const documentsQuery = useQuery({
    queryKey: ['m0', 'documents', applied],
    queryFn: () =>
      listM0Documents({
        material: applied.material || undefined,
        product: applied.product || undefined,
        order: applied.order || undefined,
      }),
  });

  const documents = documentsQuery.data?.documents ?? [];

  return (
    <Card
      className={className}
      title={title}
      extra={
        <Typography.Text type="secondary">
          {documentsQuery.isLoading ? '查询中…' : `共 ${documents.length} 份文档`}
        </Typography.Text>
      }
    >
      <Space direction="vertical" style={{ width: '100%' }} size={12}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {description}
        </Typography.Paragraph>
        <Form
          form={form}
          layout="inline"
          initialValues={query}
          onFinish={(values: QueryState) => {
            setQuery(values);
            setApplied(values);
          }}
        >
          <Form.Item name="material" label="物料编码">
            <Input placeholder="如 CABLE-2M" style={{ width: 200 }} allowClear />
          </Form.Item>
          <Form.Item name="product" label="产品">
            <Input placeholder="如 HDMI 19+1" style={{ width: 180 }} allowClear />
          </Form.Item>
          <Form.Item name="order" label="订单号">
            <Input placeholder="如 SO-2026…" style={{ width: 180 }} allowClear />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SearchOutlined />} aria-label="查询">
              查询
            </Button>
          </Form.Item>
        </Form>

        <Table
          rowKey="id"
          size="small"
          dataSource={documents}
          loading={documentsQuery.isLoading}
          locale={{ emptyText: '未找到绑定文档。可在 M0 数据建设页上传并入库后完成文档绑定。' }}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: '文档', dataIndex: 'title', key: 'title', ellipsis: true },
            {
              title: '文档类型',
              dataIndex: 'doc_type',
              key: 'doc_type',
              render: (value: string) => <Tag color="blue">{docTypeLabel(value)}</Tag>,
            },
            {
              title: '绑定实体',
              key: 'bindings',
              render: (_: unknown, doc: M0DocumentWithBindings) => (
                <Space size={4} wrap>
                  {doc.bindings.length === 0 ? (
                    <Typography.Text type="secondary">未绑定</Typography.Text>
                  ) : (
                    doc.bindings.map((binding) => (
                      <Tag key={binding.id}>
                        {entityTypeLabel(binding.entity_type)}：{binding.entity_code || binding.entity_id}
                      </Tag>
                    ))
                  )}
                </Space>
              ),
            },
            { title: '入库时间', dataIndex: 'created_at', key: 'created_at' },
            {
              title: '操作',
              key: 'action',
              width: 110,
              render: (_: unknown, doc: M0DocumentWithBindings) => (
                <DocumentPreview docId={doc.id} title={doc.title} compact />
              ),
            },
          ]}
        />
      </Space>
    </Card>
  );
}
