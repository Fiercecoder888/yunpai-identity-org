import userEvent from '@testing-library/user-event';
import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { renderWithApp } from '../tests/testUtils';
import { CockpitPage } from './CockpitPage';

const renderCockpit = () =>
  renderWithApp(
    <MemoryRouter initialEntries={['/cockpit']}>
      <Routes>
        <Route path="/cockpit" element={<CockpitPage />} />
        <Route path="/dashboard" element={<div>dashboard-page</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('CockpitPage', () => {
  it('renders the full-screen cockpit panels and a five-second refresh interval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');

    renderCockpit();

    expect(await screen.findByTestId('cockpit-page')).toBeInTheDocument();
    expect(await screen.findByText('经营 KPI')).toBeInTheDocument();
    expect(await screen.findByText('排程甘特概览')).toBeInTheDocument();
    expect(await screen.findByText('风险预警 TopN')).toBeInTheDocument();
    expect(await screen.findByText('最近 Agent 活动')).toBeInTheDocument();
    expect(screen.getByText(/每 5 秒自动刷新/)).toBeInTheDocument();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    setIntervalSpy.mockRestore();
  });

  it('returns to the operations dashboard from the cockpit', async () => {
    const user = userEvent.setup();

    renderCockpit();

    await screen.findByTestId('cockpit-page');
    await user.click(screen.getByRole('button', { name: '返回运营中心' }));

    expect(await screen.findByText('dashboard-page')).toBeInTheDocument();
  });
});
