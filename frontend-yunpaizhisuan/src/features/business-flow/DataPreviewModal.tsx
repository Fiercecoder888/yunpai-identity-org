import { Modal, Table } from 'antd';
import type { TableColumnsType } from 'antd';
import type { ReactNode } from 'react';

export type DataPreviewColumn = {
  key: string;
  title: string;
  /** 自定义单元格渲染；入参为整行数据，便于跨列取值 */
  render?: (row: Record<string, unknown>, index: number) => ReactNode;
};

export type DataPreviewModalProps = {
  open: boolean;
  title: string;
  columns: DataPreviewColumn[];
  rows: Array<Record<string, unknown>>;
  onClose: () => void;
};

/**
 * 通用「人工确认明细预览」弹窗：M1 订单明细 / M2 物料明细 / M3 BOM 明细共用。
 * 受控组件：open 由父级控制；内部用 antd Table（small、横向滚动、每页 10 行）。
 */
export function DataPreviewModal({ open, title, columns, rows, onClose }: DataPreviewModalProps) {
  const dataSource = rows.map((row, index) => ({ __rowIndex: index, ...row }));
  const tableColumns: TableColumnsType<Record<string, unknown>> = columns.map((column) => ({
    key: column.key,
    title: column.title,
    dataIndex: column.key,
    render: column.render
      ? (_: unknown, record: Record<string, unknown>, index: number) => column.render?.(record, index)
      : undefined,
  }));

  return (
    <Modal title={title} open={open} width={880} footer={null} onCancel={onClose} destroyOnHidden>
      <Table
        size="small"
        rowKey="__rowIndex"
        dataSource={dataSource}
        columns={tableColumns}
        scroll={{ x: 'max-content' }}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
      />
    </Modal>
  );
}
