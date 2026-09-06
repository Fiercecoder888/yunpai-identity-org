import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { fireEvent, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { TaskBoardPage } from './TaskBoardPage';

describe('TaskBoardPage', () => {
  it('renders loading state before data resolves', () => {
    const { container } = renderWithApp(<TaskBoardPage />);

    expect(container.querySelector('.ant-skeleton')).toBeInTheDocument();
  });

  it('renders normal task data', async () => {
    renderWithApp(<TaskBoardPage />);

    expect(await screen.findByText('任务列表、状态、负责人和风险等级。')).toBeInTheDocument();
    expect(await screen.findByText('确认订单图纸低置信度字段')).toBeInTheDocument();
    expect(await screen.findByText('跟进供应商交期回复')).toBeInTheDocument();
  });

  it('filters tasks by risk level', async () => {
    renderWithApp(<TaskBoardPage />);

    await screen.findByText('确认订单图纸低置信度字段');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: '风险筛选' }));
    await userEvent.click(await screen.findByTitle('中风险'));

    expect(await screen.findByText('复核 BOM 草稿异常物料')).toBeInTheDocument();
    expect(screen.queryByText('确认订单图纸低置信度字段')).not.toBeInTheDocument();
    expect(screen.queryByText('跟进供应商交期回复')).not.toBeInTheDocument();
  });

  it('renders empty state when no tasks are returned', async () => {
    server.use(http.get('/api/tasks', () => HttpResponse.json([])));

    renderWithApp(<TaskBoardPage />);

    expect((await screen.findAllByText('暂无数据')).length).toBeGreaterThan(0);
  });

  it('renders a combined risk and status tag for every task', async () => {
    renderWithApp(<TaskBoardPage />);

    await screen.findByText('确认订单图纸低置信度字段');
    const tags = screen.getAllByTestId('risk-status-tag');
    expect(tags).toHaveLength(3);
    expect(tags[0]).toHaveTextContent('高风险');
    expect(tags[0]).toHaveTextContent('待审核');
    expect(tags[1]).toHaveTextContent('中风险');
    expect(tags[1]).toHaveTextContent('进行中');
  });

  it('filters tasks by keyword across title and owner', async () => {
    const user = userEvent.setup();
    renderWithApp(<TaskBoardPage />);

    await screen.findByText('确认订单图纸低置信度字段');
    await user.type(screen.getByRole('textbox', { name: '任务搜索' }), '采购员');

    expect(await screen.findByText('跟进供应商交期回复')).toBeInTheDocument();
    expect(screen.queryByText('确认订单图纸低置信度字段')).not.toBeInTheDocument();
    expect(screen.queryByText('复核 BOM 草稿异常物料')).not.toBeInTheDocument();
  });

  it('falls back to real M1 tasks when the aggregate endpoint is not implemented', async () => {
    server.use(
      http.get('/api/tasks', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () =>
        HttpResponse.json([
          {
            task_id: 'm1-review-001',
            filename: '真实订单图纸.pdf',
            status: 'needs_review',
            needs_review: true,
            updated_at: '2026-07-14T08:00:00Z',
          },
          {
            task_id: 'm1-failed-001',
            filename: '异常图纸.pdf',
            status: 'failed',
            updated_at: '2026-07-14T07:00:00Z',
          },
        ]),
      ),
    );

    renderWithApp(<TaskBoardPage />);

    expect(await screen.findByText('M0 文档解析：真实订单图纸.pdf')).toBeInTheDocument();
    expect(await screen.findByText('M0 文档解析：异常图纸.pdf')).toBeInTheDocument();

    const board = screen.getByTestId('task-kanban');
    expect(within(board).getAllByText('高风险')).toHaveLength(2);
    expect(within(board).getByText('待审核')).toBeInTheDocument();
    expect(within(board).getByText('失败')).toBeInTheDocument();
  });

  it('renders the stats row and kanban board by default', async () => {
    renderWithApp(<TaskBoardPage />);

    await screen.findByTestId('task-kanban');
    expect(screen.getByTestId('task-board-stats-row')).toBeInTheDocument();
    expect(screen.getByText('任务总数')).toBeInTheDocument();
    expect(screen.getAllByText('我的任务').length).toBeGreaterThan(0);
  });

  it('switches between kanban and table views', async () => {
    const user = userEvent.setup();
    renderWithApp(<TaskBoardPage />);

    await screen.findByTestId('task-kanban');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await user.click(screen.getByText('表格'));
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('task-kanban')).not.toBeInTheDocument();

    await user.click(screen.getByText('看板'));
    expect(screen.getByTestId('task-kanban')).toBeInTheDocument();
  });

  it('filters to my tasks only when the checkbox is enabled', async () => {
    window.localStorage.setItem('yunpai-taskboard-current-user', '工艺员');
    const user = userEvent.setup();
    renderWithApp(<TaskBoardPage />);

    await screen.findByText('确认订单图纸低置信度字段');
    await user.click(screen.getByRole('checkbox', { name: '我的任务' }));

    expect(await screen.findByText('确认订单图纸低置信度字段')).toBeInTheDocument();
    expect(screen.queryByText('复核 BOM 草稿异常物料')).not.toBeInTheDocument();
    expect(screen.queryByText('跟进供应商交期回复')).not.toBeInTheDocument();
  });

  it('renders a disabled dispatch button in kanban and table views', async () => {
    const user = userEvent.setup();
    renderWithApp(<TaskBoardPage />);

    await screen.findByTestId('task-kanban');
    const kanbanButtons = screen.getAllByRole('button', { name: '分派' });
    expect(kanbanButtons.length).toBeGreaterThan(0);
    expect(kanbanButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    await user.click(screen.getByText('表格'));
    const tableButtons = screen.getAllByRole('button', { name: '分派' });
    expect(tableButtons.length).toBe(3);
    expect(tableButtons.every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
  });

  it('never renders a 1970 timestamp in table view for tasks without a timestamp', async () => {
    server.use(
      http.get('/api/tasks', () => HttpResponse.json({ code: 'NOT_IMPLEMENTED' }, { status: 501 })),
      http.get('/api/m0/parser-compat/tasks', () =>
        HttpResponse.json([{ task_id: 'no-ts-1', filename: '无时间戳图纸.pdf', status: 'completed' }]),
      ),
    );
    const user = userEvent.setup();
    renderWithApp(<TaskBoardPage />);

    await screen.findByText('M0 文档解析：无时间戳图纸.pdf');
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();

    await user.click(screen.getByText('表格'));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByText(/1970/)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});
