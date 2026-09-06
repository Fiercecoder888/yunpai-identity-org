import { createElement } from 'react';
import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { M2_WORKFLOW_STORAGE_KEY } from '../features/m2/m2Workflow';
import m2WorkflowResult from '../mocks/fixtures/m2WorkflowResult.json';
import { server } from '../mocks/server';
import { renderWithApp } from '../tests/testUtils';
import { SopPage } from './SopPage';

describe('SopPage', () => {
  beforeEach(() => {
    window.localStorage.removeItem(M2_WORKFLOW_STORAGE_KEY);
  });

  it('renders SOP metadata and flow steps from the latest real M2 result', async () => {
    window.localStorage.setItem(M2_WORKFLOW_STORAGE_KEY, JSON.stringify(m2WorkflowResult));

    renderWithApp(createElement(SopPage));

    expect(await screen.findByText('SOP-USBC-1M-BLK-001')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'SOP 工艺流程图' })).toBeInTheDocument();
    expect(screen.getByText('工序1')).toBeInTheDocument();
    expect(screen.getByText('来料核对')).toBeInTheDocument();
    expect(screen.getByText('线材盘绕')).toBeInTheDocument();
    expect(await screen.findByText('设备：封口机')).toBeInTheDocument();
    expect(screen.getByText('草稿工时：11.0 秒')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /下载 SOP Word/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成 BOM 工程草稿/ })).not.toBeInTheDocument();
    expect(screen.queryByText('当前展示模拟 SOP 数据')).not.toBeInTheDocument();
  });

  it('can run M2 directly from the SOP page', async () => {
    const user = userEvent.setup();
    server.use(http.post('/api/m2/run', () => HttpResponse.json({ result: m2WorkflowResult })));

    renderWithApp(createElement(SopPage));
    await user.click(screen.getByRole('button', { name: /生成 SOP 工程草稿/ }));

    expect(await screen.findByText('装箱')).toBeInTheDocument();
  });
});
