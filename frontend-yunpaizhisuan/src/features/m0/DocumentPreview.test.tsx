import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithApp } from '../../tests/testUtils';
import { DocumentPreview } from './DocumentPreview';

describe('DocumentPreview 工程文档预览', () => {
  it('点击预览打开文件流 iframe', async () => {
    const user = userEvent.setup();
    renderWithApp(<DocumentPreview docId={1} title="图纸_承认书_ABC-123.pdf" />);

    await user.click(screen.getByRole('button', { name: '预览' }));

    expect(screen.getByText('图纸_承认书_ABC-123.pdf')).toBeInTheDocument();
    const iframe = document.querySelector('iframe') as HTMLIFrameElement | null;
    expect(iframe).not.toBeNull();
    expect(iframe?.src).toContain('/m0/documents/1/file');
  });
});
