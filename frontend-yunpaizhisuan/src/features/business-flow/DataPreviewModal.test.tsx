import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DataPreviewModal } from './DataPreviewModal';

const columns = [
  { key: 'code', title: '编码' },
  { key: 'name', title: '名称' },
  { key: 'qty', title: '用量' },
];

const rows = [
  { code: 'CBL-01', name: '线材', qty: '1' },
  { code: 'CBL-02', name: 'PE袋', qty: '2' },
];

describe('DataPreviewModal 通用人工确认明细预览', () => {
  it('打开时渲染标题与表格行', () => {
    render(<DataPreviewModal open title="测试明细（2 行）" columns={columns} rows={rows} onClose={() => undefined} />);
    expect(screen.getByText('测试明细（2 行）')).toBeInTheDocument();
    expect(screen.getAllByText('编码').length).toBeGreaterThan(0);
    expect(screen.getByText('CBL-01')).toBeInTheDocument();
    expect(screen.getByText('PE袋')).toBeInTheDocument();
  });

  it('关闭时触发 onClose', () => {
    const onClose = vi.fn();
    render(<DataPreviewModal open title="测试" columns={columns} rows={rows} onClose={onClose} />);
    fireEvent.click(screen.getAllByLabelText('Close')[0] as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('支持自定义 render 列', () => {
    const withRender = [
      ...columns,
      { key: 'type', title: '类型', render: (row: Record<string, unknown>) => (row.code === 'CBL-01' ? '采购件' : '自制件') },
    ];
    render(<DataPreviewModal open title="测试" columns={withRender} rows={rows} onClose={() => undefined} />);
    expect(screen.getByText('采购件')).toBeInTheDocument();
    expect(screen.getByText('自制件')).toBeInTheDocument();
  });
});
