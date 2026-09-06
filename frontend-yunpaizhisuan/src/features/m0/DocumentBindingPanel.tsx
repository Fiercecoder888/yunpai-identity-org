import { DeleteOutlined, LinkOutlined } from '@ant-design/icons';
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bindM0Document,
  deleteM0DocumentBinding,
  docTypeLabel,
  entityTypeLabel,
  listM0DocumentBindings,
  updateM0DocumentDocType,
  DOC_TYPE_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  type M0DocumentBindingInput,
  type M0MasterDocument,
} from '../../services/m0DocumentsApi';

type DocumentBindingPanelProps = {
  doc: M0MasterDocument | null;
  onClose: () => void;
};

/**
 * 文档绑定管理：人工绑定/解绑物料、产品、订单，并修正文档类型。
 * 数据建设页上传并入库后提供入口。
 */
export function DocumentBindingPanel({ doc, onClose }: DocumentBindingPanelProps) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<M0DocumentBindingInput>();

  const bindingsQuery = useQuery({
    queryKey: ['m0', 'documents', doc?.id, 'bindings'],
    queryFn: () => listM0DocumentBindings(doc?.id ?? 0),
    enabled: doc !== null,
  });

  const invalidateDocuments = () => {
    void queryClient.invalidateQueries({ queryKey: ['m0', 'documents'] });
  };

  const bindMutation = useMutation({
    mutationFn: (input: M0DocumentBindingInput) =>
      bindM0Document(doc?.id ?? 0, [{ ...input, stage: input.stage ?? '' }]),
    onSuccess: () => {
      void message.success('绑定成功');
      form.resetFields();
      void bindingsQuery.refetch();
      invalidateDocuments();
    },
    onError: (error: Error) => void message.error(`绑定失败：${error.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (bindingId: number) => deleteM0DocumentBinding(bindingId),
    onSuccess: () => {
      void message.success('已解除绑定');
      void bindingsQuery.refetch();
      invalidateDocuments();
    },
    onError: (error: Error) => void message.error(`解除绑定失败：${error.message}`),
  });

  const docTypeMutation = useMutation({
    mutationFn: (docType: string) => updateM0DocumentDocType(doc?.id ?? 0, docType),
    onSuccess: () => {
      void message.success('文档类型已更新');
      invalidateDocuments();
    },
    onError: (error: Error) => void message.error(`更新失败：${error.message}`),
  });

  const bindings = bindingsQuery.data?.bindings ?? [];

  return (
    <Modal
      open={doc !== null}
      title={`文档绑定管理：${doc?.title ?? ''}`}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
    >
      {doc ? (
        <Space direction="vertical" style={{ width: '100%' }} size={16}>
          <Space wrap>
            <Typography.Text type="secondary">文档类型（人工修正）</Typography.Text>
            <Select
              aria-label="文档类型"
              style={{ width: 180 }}
              value={doc.doc_type || undefined}
              placeholder="选择文档类型"
              options={DOC_TYPE_OPTIONS}
              onChange={(value) => docTypeMutation.mutate(value ?? '')}
              allowClear
            />
            {doc.doc_type ? <Tag color="blue">{docTypeLabel(doc.doc_type)}</Tag> : <Tag>未设置</Tag>}
          </Space>

          <Alert
            type="info"
            showIcon
            message="绑定物料/产品/订单后，组长端、工位与业务页可按实体检索并预览该文档。"
          />

          <Form
            form={form}
            layout="inline"
            onFinish={(values) => bindMutation.mutate(values)}
            initialValues={{ entity_type: 'material' }}
          >
            <Form.Item name="entity_type" label="实体类型" rules={[{ required: true }]}>
              <Select
                aria-label="实体类型"
                style={{ width: 120 }}
                options={ENTITY_TYPE_OPTIONS}
              />
            </Form.Item>
            <Form.Item name="entity_id" label="实体编码/编号" rules={[{ required: true, message: '请输入实体编码' }]}>
              <Input placeholder="如 CABLE-2M / SO-2026…" style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="stage" label="工序/阶段">
              <Input placeholder="可选，如 押出" style={{ width: 140 }} />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                htmlType="submit"
                icon={<LinkOutlined />}
                aria-label="添加绑定"
                loading={bindMutation.isPending}
              >
                添加绑定
              </Button>
            </Form.Item>
          </Form>

          <Table
            rowKey="id"
            size="small"
            dataSource={bindings}
            loading={bindingsQuery.isLoading}
            pagination={false}
            columns={[
              {
                title: '实体类型',
                dataIndex: 'entity_type',
                render: (value: string) => <Tag color="geekblue">{entityTypeLabel(value)}</Tag>,
              },
              { title: '实体编码', dataIndex: 'entity_code' },
              { title: '实体名称', dataIndex: 'entity_name' },
              { title: '工序/阶段', dataIndex: 'stage' },
              {
                title: '操作',
                key: 'action',
                width: 100,
                render: (_: unknown, binding: { id: number }) => (
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="解绑"
                    loading={deleteMutation.isPending}
                    onClick={() => deleteMutation.mutate(binding.id)}
                  >
                    解绑
                  </Button>
                ),
              },
            ]}
          />
        </Space>
      ) : null}
    </Modal>
  );
}
