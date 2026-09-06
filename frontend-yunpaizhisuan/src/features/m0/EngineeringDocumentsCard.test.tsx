import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../../tests/testUtils';
import { EngineeringDocumentsCard } from './EngineeringDocumentsCard';

describe('EngineeringDocumentsCard 工程文档库', () => {
  it('展示已绑定文档并可预览', async () => {
    const user = userEvent.setup();
    renderWithApp(<EngineeringDocumentsCard />);

    expect(await screen.findByText('图纸_承认书_ABC-123.pdf')).toBeInTheDocument();
    expect(screen.getByText(/物料：CABLE-2M/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '预览' }));
    expect(document.querySelector('iframe')).not.toBeNull();
  });

  it('支持按实体条件查询', async () => {
    const user = userEvent.setup();
    renderWithApp(<EngineeringDocumentsCard />);

    await screen.findByText('图纸_承认书_ABC-123.pdf');
    await user.type(screen.getByPlaceholderText('如 CABLE-2M'), 'MAT-9');
    await user.click(screen.getByRole('button', { name: '查询' }));

    expect(await screen.findByText('图纸_承认书_ABC-123.pdf')).toBeInTheDocument();
  });
});
