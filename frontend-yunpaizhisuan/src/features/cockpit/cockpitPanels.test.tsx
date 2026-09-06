import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from '../../tests/testUtils';
import { CockpitActivityFeed } from './CockpitActivityFeed';
import { CockpitAlertsPanel } from './CockpitAlertsPanel';
import { CockpitGanttPreview } from './CockpitGanttPreview';
import { CockpitKpiPanel } from './CockpitKpiPanel';

describe('CockpitKpiPanel', () => {
  it('renders the six KPI tiles from useDashboardKpis', async () => {
    renderWithApp(<CockpitKpiPanel />);

    expect(await screen.findByText('经营 KPI')).toBeInTheDocument();
    expect(await screen.findByText('本月订单数')).toBeInTheDocument();
    expect(screen.getByText('准交率')).toBeInTheDocument();
    expect(screen.getByText('缺料物料数')).toBeInTheDocument();
    expect(screen.getByText('逾期采购金额')).toBeInTheDocument();
    expect(screen.getByText('在产工单数')).toBeInTheDocument();
    expect(screen.getByText('良率')).toBeInTheDocument();
  });
});

describe('CockpitAlertsPanel', () => {
  it('renders the top risk alerts derived from the KPI buckets', async () => {
    renderWithApp(<CockpitAlertsPanel />);

    expect(await screen.findByText('风险预警 TopN')).toBeInTheDocument();
    expect((await screen.findAllByRole('listitem')).length).toBeGreaterThan(0);
  });

  it('shows an empty hint when there are no alerts', () => {
    renderWithApp(<CockpitAlertsPanel buckets={[]} />);
    expect(screen.getByText('暂无风险预警')).toBeInTheDocument();
  });
});

describe('CockpitActivityFeed', () => {
  it('renders the agent activity feed', async () => {
    renderWithApp(<CockpitActivityFeed />);

    expect(await screen.findByText('最近 Agent 活动')).toBeInTheDocument();
    expect((await screen.findAllByRole('listitem')).length).toBeGreaterThan(0);
  });

  it('shows an empty hint when activities are missing', () => {
    renderWithApp(<CockpitActivityFeed activities={[]} />);
    expect(screen.getByText('暂无活动')).toBeInTheDocument();
  });
});

describe('CockpitGanttPreview', () => {
  it('renders the read-only mini gantt and the dark capacity heat', async () => {
    renderWithApp(<CockpitGanttPreview />);

    expect(await screen.findByText('排程甘特概览')).toBeInTheDocument();
    expect(await screen.findByText('产能负载（暗色）')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '产能负载热力' })).toBeInTheDocument();
    expect(screen.getAllByRole('cell').length).toBeGreaterThan(0);
  });
});
