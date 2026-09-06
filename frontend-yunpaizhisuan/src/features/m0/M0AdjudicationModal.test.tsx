import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { M0AdjudicationModal } from './M0AdjudicationModal';

describe('M0AdjudicationModal', () => {
  it('requires a valid target and reason before approving a mapping', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <M0AdjudicationModal
        decision={{ kind: 'mapping', recordId: 7, action: 'approve' }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: '确认裁决' }));
    expect(onSubmit).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('目标引用'), 'master:inventory:42');
    await user.type(screen.getByLabelText('裁决理由'), '唯一物料编码与已批准库存一致');
    await user.click(screen.getByRole('button', { name: '确认裁决' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        targetRef: 'master:inventory:42',
        reason: '唯一物料编码与已批准库存一致',
      });
    });
  });

  it('requires a reason but no target when rejecting an entity', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <M0AdjudicationModal
        decision={{ kind: 'entity', recordId: 9, action: 'reject' }}
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.queryByLabelText('目标引用')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('裁决理由'), '同编码对应实质不同规格，拒绝合并');
    await user.click(screen.getByRole('button', { name: '确认裁决' }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        targetRef: '',
        reason: '同编码对应实质不同规格，拒绝合并',
      });
    });
  });
});
