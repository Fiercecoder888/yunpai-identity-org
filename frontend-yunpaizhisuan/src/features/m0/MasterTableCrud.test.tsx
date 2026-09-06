import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { message } from 'antd';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MasterTableCrud } from './MasterTableCrud';
import { MASTER_TABLE_CONFIGS } from './masterTableConfigs';
import { server } from '../../mocks/server';
import { renderWithApp } from '../../tests/testUtils';

// antd 静态 message 在 jsdom 下不会挂载到 DOM，mock 掉以便断言提示。
vi.mock('antd', async (importOriginal) => {
  const actual = await importOriginal<typeof import('antd')>();
  return {
    ...actual,
    message: {
      success: vi.fn(),
      error: vi.fn(),
      warning: vi.fn(),
      info: vi.fn(),
      loading: vi.fn(),
    },
  };
});

const machineConfig = MASTER_TABLE_CONFIGS.find((c) => c.table === 'm0_master_machine')!;

describe('MasterTableCrud', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders configured columns and 编辑/删除 actions from the machine tab', async () => {
    renderWithApp(<MasterTableCrud config={machineConfig} />);

    expect(await screen.findByText('M-001')).toBeInTheDocument();
    expect(screen.getByText('注塑机')).toBeInTheDocument();
    expect(screen.getByText('M-002')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /新增行/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /编辑/ }).length).toBe(2);
    expect(screen.getAllByRole('button', { name: /删除/ }).length).toBe(2);
  });

  it('edits a row through the modal form and calls PUT', async () => {
    const user = userEvent.setup();
    let putBody: { values: Record<string, unknown> } | undefined;
    server.use(
      http.put('/api/m0/import/master/m0_master_machine/:rowId', async ({ params, request }) => {
        putBody = (await request.json()) as { values: Record<string, unknown> };
        return HttpResponse.json({
          success: true,
          data: {
            row: { id: Number(params.rowId), machine_code: 'M-001', machine_name: '注塑机-改' },
            affected: 1,
          },
          errors: [],
          trace_id: 'msw-m0-trace',
        });
      }),
    );

    renderWithApp(<MasterTableCrud config={machineConfig} />);
    await screen.findByText('M-001');

    await user.click(screen.getAllByRole('button', { name: /编辑/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    const nameInput = within(dialog).getByLabelText('设备名称');
    await user.clear(nameInput);
    await user.type(nameInput, '注塑机-改');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(putBody?.values.machine_name).toBe('注塑机-改');
    });
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('已保存');
    });
  });

  it('creates a new row through the empty form and calls POST', async () => {
    const user = userEvent.setup();
    let postBody: { values: Record<string, unknown> } | undefined;
    server.use(
      http.post('/api/m0/import/master/m0_master_machine', async ({ request }) => {
        postBody = (await request.json()) as { values: Record<string, unknown> };
        return HttpResponse.json({
          success: true,
          data: {
            row: { id: 99, machine_code: postBody?.values.machine_code, machine_name: postBody?.values.machine_name },
            id: 99,
          },
          errors: [],
          trace_id: 'msw-m0-trace',
        });
      }),
    );

    renderWithApp(<MasterTableCrud config={machineConfig} />);
    await screen.findByText('M-001');

    await user.click(screen.getByRole('button', { name: /新增行/ }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('设备编码'), 'M-099');
    await user.type(within(dialog).getByLabelText('设备名称'), '新设备');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    await waitFor(() => {
      expect(postBody?.values).toMatchObject({ machine_code: 'M-099', machine_name: '新设备' });
    });
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('已新增');
    });
  });

  it('requires required fields before creating', async () => {
    const user = userEvent.setup();
    let postCalled = false;
    server.use(
      http.post('/api/m0/import/master/m0_master_machine', async () => {
        postCalled = true;
        return HttpResponse.json({ success: true, data: { row: {}, id: 1 }, errors: [], trace_id: 'msw-m0-trace' });
      }),
    );

    renderWithApp(<MasterTableCrud config={machineConfig} />);
    await screen.findByText('M-001');

    await user.click(screen.getByRole('button', { name: /新增行/ }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: /保\s*存/ }));

    expect(await within(dialog).findByText('请填写设备编码')).toBeInTheDocument();
    expect(postCalled).toBe(false);
  });

  it('deletes a row after the confirm modal and calls DELETE', async () => {
    const user = userEvent.setup();
    let deletedId: string | undefined;
    server.use(
      http.delete('/api/m0/import/master/m0_master_machine/:rowId', async ({ params }) => {
        deletedId = String(params.rowId);
        return HttpResponse.json({
          success: true,
          data: { deleted: Number(params.rowId) },
          errors: [],
          trace_id: 'msw-m0-trace',
        });
      }),
    );

    renderWithApp(<MasterTableCrud config={machineConfig} />);
    await screen.findByText('M-001');

    await user.click(screen.getAllByRole('button', { name: /删除/ })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/确定删除「机器」中的第 #11 行/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(deletedId).toBe('11');
    });
    await waitFor(() => {
      expect(message.success).toHaveBeenCalledWith('已删除');
    });
  });
});
