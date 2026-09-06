import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithApp } from '../tests/testUtils';
import { QualitySupervisionPage } from './QualitySupervisionPage';

describe('QualitySupervisionPage', () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it('shows the expanded M1-M5 supervision flow without chat or write actions', async () => {
    renderWithApp(
      <MemoryRouter initialEntries={['/quality']}>
        <QualitySupervisionPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '全流程监督' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '订单业务流程' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '订单流程详情' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看 M1 流程任务' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '查看 M5 流程任务' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '运行' })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText('询问订单、风险或排程状态')).not.toBeInTheDocument();
    expect(screen.queryByText('上传或导入')).not.toBeInTheDocument();
  });
});
