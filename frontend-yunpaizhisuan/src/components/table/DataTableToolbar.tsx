import { Space } from 'antd';
import type { ReactNode } from 'react';

type DataTableToolbarProps = {
  title?: ReactNode;
  /** 右侧动作组（常驻）。 */
  extra?: ReactNode;
  /** 批量操作区，selectedCount 大于 0 时渲染。 */
  batch?: ReactNode;
  selectedCount?: number;
};

export function DataTableToolbar({ title, extra, batch, selectedCount = 0 }: DataTableToolbarProps) {
  return (
    <div className="data-table-toolbar" data-testid="data-table-toolbar">
      {title ? <div className="data-table-toolbar-title">{title}</div> : <div />}
      <Space className="data-table-toolbar-actions" wrap>
        {batch && selectedCount > 0 ? <div className="data-table-toolbar-batch">{batch}</div> : null}
        {extra}
      </Space>
    </div>
  );
}
