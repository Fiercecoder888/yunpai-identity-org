import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { compareJsonScalars, JsonDebugCollapse, RecordsTable, StructuredJson, StructuredSection } from './StructuredJson';

const renderWithAntd = (ui: ReactElement) => render(<ConfigProvider locale={zhCN}>{ui}</ConfigProvider>);

describe('StructuredJson', () => {
  it('renders scalar fields as descriptions', () => {
    renderWithAntd(<StructuredJson data={{ order_id: 'SO-1', tenant_id: 't1', status: 'confirmed' }} />);

    expect(screen.getByText('order_id')).toBeInTheDocument();
    expect(screen.getByText('SO-1')).toBeInTheDocument();
    expect(screen.getByText('status')).toBeInTheDocument();
    expect(screen.getByText('confirmed')).toBeInTheDocument();
  });

  it('renders an array of records as a table', () => {
    renderWithAntd(
      <RecordsTable rows={[{ material_id: 'MAT-1', name: '轴承' }, { material_id: 'MAT-2', name: '传感器' }]} />,
    );

    expect(screen.getAllByText('material_id').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MAT-1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('MAT-2').length).toBeGreaterThan(0);
    expect(screen.getAllByText('传感器').length).toBeGreaterThan(0);
  });

  it('renders nested arrays recursively', () => {
    renderWithAntd(<StructuredJson data={{ lots: [{ lot_id: 'LOT-A', qty: 10 }] }} />);

    expect(screen.getByText('lots')).toBeInTheDocument();
    expect(screen.getAllByText('lot_id').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LOT-A').length).toBeGreaterThan(0);
  });

  it('renders empty arrays with an empty state', () => {
    renderWithAntd(<StructuredJson data={[]} />);

    expect(screen.getByText('无数据')).toBeInTheDocument();
  });

  it('folds nested fields into a collapse beyond maxDepth', () => {
    const { container } = renderWithAntd(
      <StructuredJson data={{ outer: { inner: { deep: { leaf: 1 } } } }} maxDepth={1} />,
    );

    expect(container.querySelector('.structured-json-fold')).not.toBeNull();
    expect(screen.getByText(/嵌套字段（1）/)).toBeInTheDocument();
  });

  it('shows a copy button for every scalar value', () => {
    renderWithAntd(<StructuredJson data={{ order_id: 'SO-1' }} />);

    expect(screen.getByRole('button', { name: '复制 SO-1' })).toBeInTheDocument();
  });

  it('bounds a multi-megabyte record array before rendering table rows', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      id: `movement-${index}`,
      sequence: index,
      payload: 'x'.repeat(600),
    }));

    const { container } = renderWithAntd(<StructuredJson data={{ inventory_movements: rows }} />);

    expect(screen.getByText('仅显示前 100 条，共 10000 条')).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-table-tbody .ant-table-row').length).toBeLessThanOrEqual(20);
    expect(screen.getByText('movement-0')).toBeInTheDocument();
    expect(screen.queryByText('movement-100')).not.toBeInTheDocument();
  });

  it('reveals all records only after the user explicitly requests them', () => {
    renderWithAntd(
      <StructuredJson
        data={[{ id: 'movement-0' }, { id: 'movement-1' }, { id: 'movement-2' }]}
        maxRows={2}
      />,
    );

    expect(screen.queryByText('movement-2')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '显示全部记录' }));
    expect(screen.getByText('movement-2')).toBeInTheDocument();
  });

  it('discovers fields that first appear after the row preview limit', () => {
    renderWithAntd(
      <RecordsTable
        rows={[
          { id: 'movement-0', sequence: 0 },
          { id: 'movement-1', sequence: 1, late_field: 'preserved' },
        ]}
        maxRows={1}
      />,
    );

    expect(screen.getAllByText('late_field').length).toBeGreaterThan(0);
    expect(screen.queryByText('preserved')).not.toBeInTheDocument();
  });

  it('bounds object fields and long scalar text', () => {
    const data = Object.fromEntries(
      Array.from({ length: 30 }, (_, index) => [`field_${index}`, index === 0 ? 'x'.repeat(2_000) : index]),
    );

    renderWithAntd(<StructuredJson data={data} />);

    expect(screen.getByText('仅显示前 16 个标量字段，共 30 个')).toBeInTheDocument();
    expect(screen.getByText(/已截断，共 2000 字符/)).toBeInTheDocument();
    expect(screen.queryByText('field_29')).not.toBeInTheDocument();
  });

  it('reveals fields beyond the initial object limit on demand', () => {
    const data = Object.fromEntries(
      Array.from({ length: 17 }, (_, index) => [`field_${index}`, index]),
    );
    renderWithAntd(<StructuredJson data={data} />);

    expect(screen.queryByText('field_16')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '显示全部字段' }));
    expect(screen.getByText('field_16')).toBeInTheDocument();
  });
});

describe('compareJsonScalars', () => {
  it('sorts numbers numerically and strings with a stable locale compare', () => {
    expect(compareJsonScalars(10, 2)).toBeGreaterThan(0);
    expect(compareJsonScalars(1, 2)).toBeLessThan(0);
    expect(compareJsonScalars('a', 'b')).toBeLessThan(0);
    expect(compareJsonScalars('b', 'a')).toBeGreaterThan(0);
    expect(compareJsonScalars(null, 'a')).toBeLessThan(0);
    expect(compareJsonScalars(1, 1)).toBe(0);
  });
});

describe('RecordsTable sorting', () => {
  it('sorts rows when a scalar column header is clicked', () => {
    renderWithAntd(
      <RecordsTable rows={[{ id: 1, qty: 3 }, { id: 2, qty: 1 }, { id: 3, qty: 2 }]} />,
    );

    const cells = () =>
      Array.from(document.querySelectorAll('.ant-table-tbody .ant-table-row')).map((row) => row.textContent);
    expect(cells()[0]).toContain('3');

    const header = screen.getAllByText('qty')[0] as HTMLElement;
    fireEvent.click(header);

    expect(cells()[0]).toContain('1');
    expect(cells()[1]).toContain('2');
  });
});

describe('JsonDebugCollapse', () => {
  it('renders raw JSON only when debug is enabled', () => {
    const { container } = renderWithAntd(<JsonDebugCollapse title="测试" data={{ a: 1 }} debug />);

    expect(container.querySelector('.json-debug-collapse')).toBeInTheDocument();
    expect(container.querySelector('.raw-json-block')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('测试 · JSON（调试）'));
    expect(container.querySelector('.raw-json-block')?.textContent).toContain('"a"');
  });

  it('hides raw JSON when debug is disabled', () => {
    const { container } = renderWithAntd(<JsonDebugCollapse title="测试" data={{ a: 1 }} debug={false} />);

    expect(container.querySelector('.json-debug-collapse')).not.toBeInTheDocument();
  });

  it('renders a bounded preview only after a large debug payload is expanded', () => {
    const data = {
      inventory_movements: Array.from({ length: 10_000 }, (_, index) => ({
        id: `movement-${index}`,
        payload: 'x'.repeat(600),
      })),
    };
    const { container } = renderWithAntd(<JsonDebugCollapse title="大追踪" data={data} debug />);

    expect(container.querySelector('.raw-json-block')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('大追踪 · JSON（调试）'));

    const preview = container.querySelector('.raw-json-block')?.textContent ?? '';
    expect(preview).toContain('movement-0');
    expect(preview).not.toContain('movement-20');
    expect(preview).toContain('[truncated: 9980 items omitted]');
    expect(preview.length).toBeLessThan(20_000);
  });
});

describe('StructuredSection', () => {
  it('renders structured content with a title', () => {
    renderWithAntd(<StructuredSection title="批次" data={{ lot_id: 'LOT-1' }} debug={false} />);

    expect(screen.getByText('批次')).toBeInTheDocument();
    expect(screen.getByText('LOT-1')).toBeInTheDocument();
  });

  it('renders as a collapse when collapsible is enabled', () => {
    const { container } = renderWithAntd(
      <StructuredSection title="批次" data={{ lot_id: 'LOT-1' }} debug={false} collapsible />,
    );

    expect(container.querySelector('.structured-section-collapse')).toBeInTheDocument();
    expect(screen.getByText('批次')).toBeInTheDocument();
  });

  it('copies the complete JSON even when the visible rows are bounded', async () => {
    const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      renderWithAntd(
        <StructuredSection
          title="完整追溯"
          data={[{ id: 'row-0' }, { id: 'row-1' }, { id: 'row-2' }]}
          maxRows={2}
        />,
      );

      expect(screen.queryByText('row-2')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '复制完整 JSON：完整追溯' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      expect(writeText.mock.calls[0]?.[0]).toContain('row-2');
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, 'clipboard', originalClipboard);
      } else {
        Reflect.deleteProperty(navigator, 'clipboard');
      }
    }
  });
});
