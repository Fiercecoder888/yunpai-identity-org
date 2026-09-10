import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { renderWithApp } from '../tests/testUtils';
import { CommandPalette } from './CommandPalette';
import { clearIndexCache } from '../features/command/searchIndex';

const renderPalette = (initialEntries: string[] = ['/']) =>
  renderWithApp(
    <MemoryRouter initialEntries={initialEntries}>
      <Routes>
        <Route path="/" element={<div>home-page</div>} />
        <Route path="/worker" element={<div>worker-page</div>} />
        <Route path="/leader" element={<div>leader-page</div>} />
        <Route path="/org" element={<div>org-page</div>} />
        <Route path="/accounts" element={<div>accounts-page</div>} />
        <Route path="/roles" element={<div>roles-page</div>} />
        <Route path="/modules/purchase-warnings" element={<div>purchase-warnings-page</div>} />
      </Routes>
      <CommandPalette />
    </MemoryRouter>,
  );

describe('CommandPalette', () => {
  it('opens with the Ctrl+K shortcut and lists module jump commands', () => {
    renderPalette();

    expect(screen.queryByTestId('command-palette-input')).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });

    expect(screen.getByTestId('command-palette-input')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /工人工作台/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /组织架构/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /角色与权限/ })).toBeInTheDocument();
  });

  it('filters commands by the typed query', () => {
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: '组织' } });

    expect(screen.getByRole('button', { name: /组织架构/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /工人工作台/ })).not.toBeInTheDocument();
  });

  it('shows an empty hint when no command matches', () => {
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: '不存在的页面' } });

    expect(screen.getByText('没有匹配的命令')).toBeInTheDocument();
  });

  it('navigates to the selected route on click', () => {
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: /工人工作台/ }));

    expect(screen.getByText('worker-page')).toBeInTheDocument();
  });

  it('aggregates entity results and switches tabs', async () => {
    clearIndexCache();
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: 'MAT' } });

    expect((await screen.findAllByText('轴承')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /物料/ }));

    expect(screen.getAllByRole('button', { name: /轴承/ }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /排程甘特图/ })).not.toBeInTheDocument();
  });

  it('navigates with keyboard arrow and enter', async () => {
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: '工人' } });

    await waitFor(() => expect(screen.getByRole('button', { name: /工人工作台/ })).toBeInTheDocument());
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByText('worker-page')).toBeInTheDocument();
  });

  it('remembers recent selections in localStorage and shows them on reopen', async () => {
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    fireEvent.change(screen.getByTestId('command-palette-input'), { target: { value: '工人' } });
    fireEvent.click(await screen.findByRole('button', { name: /工人工作台/ }));

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(await screen.findByText('最近使用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /工人工作台/ })).toBeInTheDocument();
  });

  it('opens an entity result via keyboard from the entity tab', async () => {
    clearIndexCache();
    renderPalette();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByTestId('command-palette-input');
    fireEvent.change(input, { target: { value: '华南电子' } });

    await waitFor(() => expect(screen.getByRole('tab', { name: /供应商 \(\d+\)/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /供应商/ }));

    expect(await screen.findByRole('button', { name: /华南电子供应商/ })).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(screen.getByText('purchase-warnings-page')).toBeInTheDocument());
  });
});
