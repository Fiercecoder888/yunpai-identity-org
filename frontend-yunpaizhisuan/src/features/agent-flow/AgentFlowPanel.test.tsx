import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { server } from '../../mocks/server';
import { renderWithApp } from '../../tests/testUtils';
import { useWorkbenchStore } from '../../store/useWorkbenchStore';
import { AgentFlowPanel } from './AgentFlowPanel';

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}</span>;
}

function renderAgentFlowPanel() {
  return renderWithApp(
    <MemoryRouter initialEntries={['/dashboard']}>
      <AgentFlowPanel />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('AgentFlowPanel', () => {
  it('renders custom nodes and opens detail drawer on click', async () => {
    server.use(http.get('/api/m0/parser-compat/health', () => HttpResponse.json({ status: 'degraded' })));
    renderAgentFlowPanel();

    await screen.findByTestId('agent-flow-canvas');
    fireEvent.click(await screen.findByText('M0 订单解析'));

    await waitFor(() => expect(useWorkbenchStore.getState().selectedFlowNodeId).toBe('m1'));
    expect(await screen.findByText('节点详情')).toBeInTheDocument();
    expect(await screen.findByText('人工节点')).toBeInTheDocument();
    expect(await screen.findByText('PDF、图纸、ZIP')).toBeInTheDocument();
  });

  it('uses store status filter when rendering nodes', async () => {
    useWorkbenchStore.getState().setFlowStatusFilter('success');

    renderAgentFlowPanel();

    expect(await screen.findByText('M5 PMC 排程')).toBeInTheDocument();
    expect(screen.getByText('M0 订单解析')).toBeInTheDocument();
    expect(screen.getByText('M3 物料计划')).toBeInTheDocument();
  });

  it('opens the M4 module from the Agent Flow detail drawer', async () => {
    renderAgentFlowPanel();

    await screen.findByTestId('agent-flow-canvas');
    fireEvent.click(await screen.findByText('M4 采购追踪'));

    await waitFor(() => expect(useWorkbenchStore.getState().selectedFlowNodeId).toBe('m4'));
    fireEvent.click(await screen.findByRole('button', { name: '进入 M4 采购追踪' }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/modules/purchase-warnings');
    await waitFor(() => expect(useWorkbenchStore.getState().selectedFlowNodeId).toBeNull());
  });
});
