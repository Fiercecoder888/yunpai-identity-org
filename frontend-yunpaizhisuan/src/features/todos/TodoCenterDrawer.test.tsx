import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { TodoCenterDrawer } from './TodoCenterDrawer';

const renderDrawer = () =>
  renderWithApp(
    <MemoryRouter initialEntries={['/home']}>
      <TodoCenterDrawer open onClose={() => undefined} />
    </MemoryRouter>,
  );

describe('TodoCenterDrawer', () => {
  it('aggregates module todo items and shows the source summary', async () => {
    renderDrawer();

    expect(await screen.findByText('我的待办')).toBeInTheDocument();
    expect(await screen.findByText('M0 文档解析待确认 2 项')).toBeInTheDocument();
    expect(await screen.findByText(/M3 缺料计划 1 个 · 缺料 2 项/)).toBeInTheDocument();
    expect(await screen.findByText('M4 逾期采购预警 1 项')).toBeInTheDocument();
    expect(await screen.findByText('M5 流程需关注 1 个版本')).toBeInTheDocument();

    expect(screen.getByText('M0 解析待审')).toBeInTheDocument();
    expect(screen.getByText('M5 需处理')).toBeInTheDocument();
  });

  it('filters todo sources by the current role permissions', async () => {
    // 组长只有 schedule:read，应只看到 M5 流程关注，看不到 M1/M3/M4。
    window.localStorage.setItem('mockRoleId', 'team-leader');
    renderDrawer();

    expect(await screen.findByText('M5 流程需关注 1 个版本')).toBeInTheDocument();
    expect(screen.queryByText('M1 待人工确认 2 项')).not.toBeInTheDocument();
    expect(screen.queryByText(/M3 缺料计划 1 个 · 缺料 2 项/)).not.toBeInTheDocument();
    expect(screen.queryByText('M4 逾期采购预警 1 项')).not.toBeInTheDocument();
  });
});
