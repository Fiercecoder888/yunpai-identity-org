import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import {
  Button,
  Form,
  Input,
  InputNumber,
  Modal,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  createM0MasterRow,
  deleteM0MasterRow,
  listM0Master,
  updateM0MasterRow,
  type M0MasterRow,
} from '../../services/m0Api';

export type MasterFieldType = 'text' | 'number' | 'textarea';

export type MasterColumnConfig = {
  key: string;
  title: string;
  type?: MasterFieldType;
  required?: boolean;
  /** 默认 true；id/created_at/batch_id 等系统列设为 false，不在表单中出现。 */
  editable?: boolean;
  /** 表单里字段的说明文字。 */
  placeholder?: string;
};

export type MasterTableConfig = {
  table: string;
  label: string;
  columns: MasterColumnConfig[];
};

/** 系统管理列：不出现在编辑/新增表单（后端自动维护）。 */
const SYSTEM_COLUMNS = new Set(['id', 'created_at', 'batch_id']);

const editableColumns = (config: MasterColumnConfig[]) =>
  config.filter((column) => column.editable !== false && !SYSTEM_COLUMNS.has(column.key));

/**
 * 列配置兜底：未提供明确配置（或未知表）时，从第一行数据的 keys 动态渲染。
 * 仅把非系统列作为可编辑字段。
 */
export const resolveMasterColumns = (
  config: MasterColumnConfig[] | undefined,
  rows: M0MasterRow[],
): MasterColumnConfig[] => {
  if (config && config.length > 0) return config;
  const first = rows[0] ?? {};
  return Object.keys(first)
    .filter((key) => !SYSTEM_COLUMNS.has(key))
    .map((key) => ({ key, title: key, type: 'text' as const }));
};

const fieldValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/**
 * 配置驱动的主数据 CRUD 表格：
 * - 行内「编辑」→ Modal 表单 → PUT
 * - 「新增行」→ 空表单 → POST
 * - 「删除」→ 确认弹窗 → DELETE
 * - 操作后 invalidate ['m0'] 刷新
 */
export function MasterTableCrud({ config }: { config: MasterTableConfig }) {
  const queryClient = useQueryClient();
  const { table, label } = config;
  const [form] = Form.useForm();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<M0MasterRow | null>(null);
  const [deletingRow, setDeletingRow] = useState<M0MasterRow | null>(null);

  const rowsQuery = useQuery({
    queryKey: ['m0', 'master', table],
    queryFn: () => listM0Master(table, 200),
  });
  const rows = rowsQuery.data?.items ?? [];
  const columns = resolveMasterColumns(config.columns, rows);
  const editable = editableColumns(columns);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['m0'] });
  };

  const updateMutation = useMutation({
    mutationFn: (vars: { rowId: number; values: Record<string, unknown> }) =>
      updateM0MasterRow(table, vars.rowId, vars.values),
    onSuccess: () => {
      void message.success('已保存');
      setModalOpen(false);
      form.resetFields();
      invalidate();
    },
    onError: (error: Error) => void message.error(`保存失败：${error.message}`),
  });

  const createMutation = useMutation({
    mutationFn: (values: Record<string, unknown>) => createM0MasterRow(table, values),
    onSuccess: () => {
      void message.success('已新增');
      setModalOpen(false);
      form.resetFields();
      invalidate();
    },
    onError: (error: Error) => void message.error(`新增失败：${error.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (rowId: number) => deleteM0MasterRow(table, rowId),
    onSuccess: () => {
      void message.success('已删除');
      setDeletingRow(null);
      invalidate();
    },
    onError: (error: Error) => void message.error(`删除失败：${error.message}`),
  });

  const openCreate = () => {
    setEditingRow(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEdit = (row: M0MasterRow) => {
    setEditingRow(row);
    form.setFieldsValue(
      Object.fromEntries(
        editable.map((column) => [column.key, row[column.key] ?? '']),
      ),
    );
    setModalOpen(true);
  };

  const handleSubmit = () => {
    form
      .validateFields()
      .then((values) => {
        const normalized: Record<string, unknown> = {};
        for (const column of editable) {
          const value = values[column.key];
          if (value === undefined || value === '') continue;
          normalized[column.key] = column.type === 'number' ? Number(value) : value;
        }
        if (editingRow && editingRow.id !== undefined) {
          updateMutation.mutate({ rowId: Number(editingRow.id), values: normalized });
        } else {
          createMutation.mutate(normalized);
        }
      })
      // 校验失败时 antd 已在表单内展示错误，静默忽略 reject。
      .catch(() => undefined);
  };

  const tableColumns = [
    ...columns.map((column) => ({
      title: column.title,
      dataIndex: column.key,
      key: column.key,
      ellipsis: true,
      render: (value: unknown) => (
        <Typography.Text style={{ fontSize: 12 }} ellipsis={{ tooltip: fieldValue(value) }}>
          {fieldValue(value)}
        </Typography.Text>
      ),
    })),
    {
      title: '操作',
      key: 'action',
      width: 130,
      fixed: 'right' as const,
      render: (_: unknown, row: M0MasterRow) => (
        <Space size={4}>
          <Button size="small" type="link" icon={<EditOutlined />} onClick={() => openEdit(row)}>
            编辑
          </Button>
          <Button size="small" type="link" danger icon={<DeleteOutlined />} onClick={() => setDeletingRow(row)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 8 }} wrap>
        <Button type="primary" size="small" ghost icon={<PlusOutlined />} onClick={openCreate}>
          新增行
        </Button>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          共 {rows.length} 条
        </Typography.Text>
      </Space>
      <Table
        rowKey={(row) => String(row.id ?? JSON.stringify(row))}
        size="small"
        dataSource={rows}
        columns={tableColumns}
        loading={rowsQuery.isLoading}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 10 }}
      />

      <Modal
        title={editingRow ? `编辑${label}行 #${editingRow.id ?? ''}` : `新增${label}行`}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        confirmLoading={updateMutation.isPending || createMutation.isPending}
        okText="保存"
        width={560}
        destroyOnClose
      >
        <Form form={form} layout="vertical" name={`master-${table}-form`}>
          {editable.map((column) => (
            <Form.Item
              key={column.key}
              name={column.key}
              label={column.title}
              rules={column.required ? [{ required: true, message: `请填写${column.title}` }] : undefined}
            >
              {column.type === 'number' ? (
                <InputNumber style={{ width: '100%' }} placeholder={column.placeholder} />
              ) : column.type === 'textarea' ? (
                <Input.TextArea rows={3} placeholder={column.placeholder} />
              ) : (
                <Input placeholder={column.placeholder} />
              )}
            </Form.Item>
          ))}
        </Form>
      </Modal>

      <Modal
        title="删除确认"
        open={deletingRow !== null}
        onOk={() => deletingRow && deleteMutation.mutate(Number(deletingRow.id))}
        onCancel={() => setDeletingRow(null)}
        okText="确认删除"
        okButtonProps={{ danger: true }}
        confirmLoading={deleteMutation.isPending}
        width={440}
      >
        <Typography.Text>
          确定删除「{label}」中的第 #{String(deletingRow?.id ?? '')} 行吗？该操作会立即生效并记录审计，且无法撤销。
        </Typography.Text>
      </Modal>
    </div>
  );
}
