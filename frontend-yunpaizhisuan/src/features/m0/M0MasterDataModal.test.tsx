import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { M0MasterDataModal } from './M0MasterDataModal';
import { MASTER_TABLE_CONFIGS } from './masterTableConfigs';

const TAB_LABELS = MASTER_TABLE_CONFIGS.map((config) => config.label);

describe('M0MasterDataModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows all 13 master table tabs with the first table active when opened', async () => {
    renderWithApp(<M0MasterDataModal open onClose={() => undefined} />);

    // 13 张主数据表 Tab 全部出现（2026-08-20 新增计件单价表）。
    expect(TAB_LABELS).toHaveLength(13);
    for (const label of TAB_LABELS) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument();
    }

    // 默认选中第一个表（机器）：MSW 返回 M-001 / 注塑机 两行。
    expect(await screen.findByText('M-001')).toBeInTheDocument();
    expect(screen.getByText('注塑机')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '机器' })).toHaveAttribute('aria-selected', 'true');

    // 至少一个表的「新增行」按钮出现。
    expect(screen.getAllByRole('button', { name: /新增行/ }).length).toBeGreaterThan(0);
  });

  it('switches to another table tab when clicked', async () => {
    const user = userEvent.setup();
    renderWithApp(<M0MasterDataModal open onClose={() => undefined} />);

    await screen.findByText('M-001');
    await user.click(screen.getByRole('tab', { name: '仓库' }));

    expect(screen.getByRole('tab', { name: '仓库' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '机器' })).toHaveAttribute('aria-selected', 'false');
    // 仓库表（空数据）渲染出来，机器表面板转为隐藏。
    expect(await screen.findByText('共 0 条')).toBeInTheDocument();
    expect(screen.getByText('M-001').closest('.ant-tabs-tabpane')).toHaveClass('ant-tabs-tabpane-hidden');
  });

  it('calls onClose when the modal close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    renderWithApp(<M0MasterDataModal open onClose={onClose} />);

    await screen.findByText('M-001');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
